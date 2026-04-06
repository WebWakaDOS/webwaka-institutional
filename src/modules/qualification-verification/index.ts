/**
 * Qualification Verification Module — WebWaka Institutional Suite
 *
 * Task T-INS-01: JAMB/WAEC Result Verification
 *
 * Invariant 1 (Nigeria-First): Falls back to manual document upload + admin
 * review whenever the JAMB or WAEC API is unavailable.
 * Invariant 2 (Multi-Tenant): Every query and insert is scoped to tenantId
 * sourced exclusively from the verified JWT payload.
 *
 * Routes:
 *   POST   /api/qualifications          — Submit a new verification request
 *   GET    /api/qualifications          — List all verifications (admin)
 *   GET    /api/qualifications/:id      — Get single record
 *   POST   /api/qualifications/:id/document  — Upload a manual-review document
 *   PATCH  /api/qualifications/:id/review   — Admin approves/rejects (manual path)
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';
import { verifyJambResult, verifyWaecResult } from '../../core/qualifications';

export const qualificationVerificationRouter = new Hono<{
  Bindings: Bindings;
  Variables: AppVariables;
}>();

/**
 * Mask the WAEC scratch-card PIN in any outbound record.
 * The PIN is a single-use credential stored for audit; it must never be
 * returned to API consumers after the initial submission.
 */
function maskSensitiveFields(record: Record<string, unknown>): Record<string, unknown> {
  if (record.waecScratchCardPin != null) {
    return { ...record, waecScratchCardPin: '***' };
  }
  return record;
}

// ─── POST /api/qualifications ─────────────────────────────────────────────────
// Student or admin submits a qualification verification request.
// Tries JAMB + WAEC APIs; falls back to 'awaiting_review' if either is down.
qualificationVerificationRouter.post(
  '/',
  requireRole(['admin', 'student']),
  async (c) => {
    const user = c.get('user');
    // Invariant 2: tenantId ALWAYS from JWT
    const tenantId = user.tenantId;

    const body = await c.req.json<{
      studentId: string;
      jambRegNumber?: string;
      waecExamNumber?: string;
      waecScratchCardPin?: string;
      waecExamYear?: string;
    }>();

    if (!body.studentId) {
      return c.json({ error: 'studentId is required' }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // ── Attempt JAMB verification ────────────────────────────────────────────
    // Track attempted/succeeded/failed independently — do NOT derive success
    // from the absence of failure, because an unattempted call also has no failure.
    let jambScore: number | undefined;
    let jambVerifiedAt: string | undefined;
    let jambApiRaw: string | undefined;
    let jambAttempted = false;
    let jambSucceeded = false;
    let jambFailed = false;

    if (body.jambRegNumber) {
      jambAttempted = true;
      const jambResult = await verifyJambResult({
        regNumber: body.jambRegNumber,
        apiKey: c.env.JAMB_API_KEY ?? '',
      });

      if (jambResult.success) {
        jambSucceeded = true;
        jambScore = jambResult.score;
        jambVerifiedAt = now;
        jambApiRaw = JSON.stringify(jambResult.rawResponse);
      } else {
        jambFailed = true;
        jambApiRaw = JSON.stringify({ error: jambResult.error });
      }
    }

    // ── Attempt WAEC verification ────────────────────────────────────────────
    // All three WAEC fields must be present; a partial submission is NOT
    // treated as a successful WAEC check — it goes straight to manual.
    let waecVerifiedAt: string | undefined;
    let waecApiRaw: string | undefined;
    let waecAttempted = false;
    let waecSucceeded = false;
    let waecFailed = false;

    if (body.waecExamNumber && body.waecScratchCardPin && body.waecExamYear) {
      waecAttempted = true;
      const waecResult = await verifyWaecResult({
        examNumber: body.waecExamNumber,
        scratchCardPin: body.waecScratchCardPin,
        examYear: body.waecExamYear,
        apiKey: c.env.WAEC_API_KEY ?? '',
      });

      if (waecResult.success) {
        waecSucceeded = true;
        waecVerifiedAt = now;
        waecApiRaw = JSON.stringify(waecResult.rawResponse);
      } else {
        waecFailed = true;
        waecApiRaw = JSON.stringify({ error: waecResult.error });
      }
    }

    // ── Determine mode and status ────────────────────────────────────────────
    // Use explicit success/failure booleans — never infer success from
    // !failed, which would be truthy for unattempted calls (Bug fix).
    const anyAttempted = jambAttempted || waecAttempted;
    const anyFailed = jambFailed || waecFailed;
    const anySucceeded = jambSucceeded || waecSucceeded;
    const allAttemptedSucceeded = anyAttempted && !anyFailed;

    let verificationMode: string;
    let verificationStatus: string;

    if (!anyAttempted) {
      // No API was actually called — straight to manual
      verificationMode = 'manual';
      verificationStatus = 'awaiting_review';
    } else if (anyFailed || !anySucceeded) {
      // At least one API failed, or nothing succeeded — fallback to manual
      verificationMode = 'manual';
      verificationStatus = 'awaiting_review';
    } else if (allAttemptedSucceeded) {
      // Every attempted API returned success
      verificationMode = 'auto';
      verificationStatus = 'verified';
    } else {
      // Partial: some succeeded, some failed
      verificationMode = 'manual';
      verificationStatus = 'awaiting_review';
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    await c.env.DB.prepare(
      `INSERT INTO inst_qualificationVerifications (
        id, tenantId, studentId,
        jambRegNumber, jambScore, jambVerifiedAt, jambApiRaw,
        waecExamNumber, waecScratchCardPin, waecExamYear, waecVerifiedAt, waecApiRaw,
        verificationMode, verificationStatus,
        documentKeys,
        createdAt, updatedAt
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?,
        ?, ?
      )`
    )
      .bind(
        id, tenantId, body.studentId,
        body.jambRegNumber ?? null,
        jambScore ?? null,
        jambVerifiedAt ?? null,
        jambApiRaw ?? null,
        body.waecExamNumber ?? null,
        body.waecScratchCardPin ?? null,
        body.waecExamYear ?? null,
        waecVerifiedAt ?? null,
        waecApiRaw ?? null,
        verificationMode, verificationStatus,
        JSON.stringify([]),
        now, now
      )
      .run();

    return c.json(
      {
        success: true,
        id,
        verificationMode,
        verificationStatus,
        message:
          verificationStatus === 'verified'
            ? 'Qualification verified via API.'
            : 'API unavailable or partial. Please upload supporting inst_documents for manual review.',
      },
      201
    );
  }
);

// ─── GET /api/qualifications ──────────────────────────────────────────────────
// Admin lists all verification records for the tenant.
// waecScratchCardPin is masked — single-use credentials must not be re-exposed.
qualificationVerificationRouter.get(
  '/',
  requireRole(['admin']),
  async (c) => {
    const tenantId = c.get('user').tenantId;

    const { results } = await c.env.DB.prepare(
      'SELECT * FROM inst_qualificationVerifications WHERE tenantId = ? ORDER BY createdAt DESC'
    )
      .bind(tenantId)
      .all<Record<string, unknown>>();

    return c.json({ data: results.map(maskSensitiveFields) });
  }
);

// ─── GET /api/qualifications/:id ─────────────────────────────────────────────
// waecScratchCardPin is masked in the response — see maskSensitiveFields.
qualificationVerificationRouter.get(
  '/:id',
  requireRole(['admin', 'student']),
  async (c) => {
    const tenantId = c.get('user').tenantId;
    const id = c.req.param('id');

    // Invariant 2: both id AND tenantId must match
    const record = await c.env.DB.prepare(
      'SELECT * FROM inst_qualificationVerifications WHERE id = ? AND tenantId = ?'
    )
      .bind(id, tenantId)
      .first<Record<string, unknown>>();

    if (!record) {
      return c.json({ error: 'Verification record not found' }, 404);
    }

    return c.json({ data: maskSensitiveFields(record) });
  }
);

// ─── POST /api/qualifications/:id/document ────────────────────────────────────
// Manual-fallback: student uploads a supporting document (certificate scan).
// Document is stored in R2; the key is appended to documentKeys.
qualificationVerificationRouter.post(
  '/:id/document',
  requireRole(['admin', 'student']),
  async (c) => {
    const tenantId = c.get('user').tenantId;
    const id = c.req.param('id');

    // Verify record belongs to tenant
    const record = await c.env.DB.prepare(
      'SELECT * FROM inst_qualificationVerifications WHERE id = ? AND tenantId = ?'
    )
      .bind(id, tenantId)
      .first<{ verificationStatus: string; documentKeys: string }>();

    if (!record) {
      return c.json({ error: 'Verification record not found' }, 404);
    }

    const contentType = c.req.header('Content-Type') ?? 'application/octet-stream';
    const body = await c.req.arrayBuffer();

    if (body.byteLength === 0) {
      return c.json({ error: 'Empty file body' }, 400);
    }

    // R2 key: qualifications/{tenantId}/{verificationId}/{uuid}.{ext}
    const ext = contentType.includes('pdf') ? 'pdf' : 'jpg';
    const objectKey = `qualifications/${tenantId}/${id}/${crypto.randomUUID()}.${ext}`;

    await c.env.MEDIA_BUCKET.put(objectKey, body, {
      httpMetadata: { contentType },
      customMetadata: { tenantId, verificationId: id },
    });

    const existingKeys: string[] = JSON.parse(record.documentKeys || '[]');
    existingKeys.push(objectKey);

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE inst_qualificationVerifications
       SET documentKeys = ?, verificationStatus = ?, updatedAt = ?
       WHERE id = ? AND tenantId = ?`
    )
      .bind(
        JSON.stringify(existingKeys),
        'awaiting_review',
        now,
        id,
        tenantId
      )
      .run();

    return c.json({ success: true, objectKey, message: 'Document uploaded. Awaiting admin review.' });
  }
);

// ─── PATCH /api/qualifications/:id/review ────────────────────────────────────
// Admin manually approves or rejects a verification record.
qualificationVerificationRouter.patch(
  '/:id/review',
  requireRole(['admin']),
  async (c) => {
    const tenantId = c.get('user').tenantId;
    const reviewerId = c.get('user').userId ?? 'unknown';
    const id = c.req.param('id');

    const body = await c.req.json<{
      decision: 'verified' | 'rejected';
      note?: string;
    }>();

    if (!body.decision || !['verified', 'rejected'].includes(body.decision)) {
      return c.json({ error: 'decision must be "verified" or "rejected"' }, 400);
    }

    const record = await c.env.DB.prepare(
      'SELECT * FROM inst_qualificationVerifications WHERE id = ? AND tenantId = ?'
    )
      .bind(id, tenantId)
      .first();

    if (!record) {
      return c.json({ error: 'Verification record not found' }, 404);
    }

    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE inst_qualificationVerifications
       SET verificationStatus = ?,
           verificationMode   = 'manual',
           reviewedBy         = ?,
           reviewNote         = ?,
           reviewedAt         = ?,
           updatedAt          = ?
       WHERE id = ? AND tenantId = ?`
    )
      .bind(
        body.decision,
        reviewerId,
        body.note ?? null,
        now,
        now,
        id,
        tenantId
      )
      .run();

    return c.json({
      success: true,
      verificationStatus: body.decision,
      message: `Verification ${body.decision} by admin.`,
    });
  }
);
