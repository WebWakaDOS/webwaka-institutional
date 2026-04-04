/**
 * Data Anonymization Engine — WebWaka Institutional Suite
 *
 * Task: Phase 3 — AI & Optimization
 *
 * Automatically strips PII from tenant records for research or public reporting.
 * Supports field-level redaction across configured tables with audit logging.
 *
 * Fields redacted: name, email, phone, dob, nationalId, address, etc.
 * Output: anonymised NDJSON exported to R2 bucket.
 *
 * Invariant 2: tenantId always from JWT.
 * Data access invariant: anonymization never mutates source data — it
 * produces a separate export, leaving originals intact.
 *
 * Routes:
 *   POST  /api/anon/jobs        — Create an anonymization job
 *   GET   /api/anon/jobs        — List jobs
 *   GET   /api/anon/jobs/:id    — Get job status + result URL
 *   POST  /api/anon/jobs/:id/run — Execute the job (async-safe)
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const dataAnonRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// Tables we permit anonymization of and their PII columns
const ANONYMIZABLE_TABLES: Record<string, string[]> = {
  students:         ['firstName', 'lastName', 'email', 'phone'],
  staff:            ['firstName', 'lastName', 'email', 'phone', 'nationalId'],
  patientRecords:   ['dob', 'allergies'],
  alumni:           ['firstName', 'lastName', 'email', 'phone', 'currentOrg'],
  donations:        ['donorName', 'donorEmail'],
  visitorLogs:      ['visitorName', 'phone'],
  insuranceClaims:  ['policyNumber'],
};

const PII_FIELDS = new Set([
  'firstName', 'lastName', 'email', 'phone', 'dob', 'nationalId',
  'address', 'donorName', 'donorEmail', 'visitorName', 'policyNumber',
  'allergies', 'currentOrg',
]);

function anonymizeRecord(
  record: Record<string, unknown>,
  fieldsToStrip: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  for (const field of fieldsToStrip) {
    if (field in out) {
      out[field] = '[REDACTED]';
    }
  }
  return out;
}

// ─── POST /api/anon/jobs ──────────────────────────────────────────────────────
dataAnonRouter.post('/jobs', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const createdBy = c.get('user').userId;
  const body = await c.req.json<{
    sourceTable: string;
    fieldsToStrip?: string[];
    conditions?: Record<string, unknown>;
  }>();

  if (!body.sourceTable) return c.json({ error: 'sourceTable is required' }, 400);

  if (!ANONYMIZABLE_TABLES[body.sourceTable]) {
    return c.json({
      error: `sourceTable '${body.sourceTable}' is not permitted for anonymization`,
      allowedTables: Object.keys(ANONYMIZABLE_TABLES),
    }, 400);
  }

  // Default to all known PII fields for the table if none specified
  const fieldsToStrip = (body.fieldsToStrip ?? ANONYMIZABLE_TABLES[body.sourceTable] ?? [])
    .filter((f) => PII_FIELDS.has(f));

  if (fieldsToStrip.length === 0) {
    return c.json({ error: 'No valid PII fields specified for stripping' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO anonymizationJobs
       (id, tenantId, sourceTable, conditions, fieldsToStrip, status, processedCount, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).bind(id, tenantId, body.sourceTable,
    body.conditions ? JSON.stringify(body.conditions) : null,
    JSON.stringify(fieldsToStrip), createdBy, now).run();

  return c.json({ success: true, id, fieldsToStrip }, 201);
});

// ─── GET /api/anon/jobs ───────────────────────────────────────────────────────
dataAnonRouter.get('/jobs', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM anonymizationJobs WHERE tenantId = ? ORDER BY createdAt DESC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── GET /api/anon/jobs/:id ───────────────────────────────────────────────────
dataAnonRouter.get('/jobs/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const job = await c.env.DB.prepare(
    'SELECT * FROM anonymizationJobs WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!job) return c.json({ error: 'Anonymization job not found' }, 404);
  return c.json({ data: job });
});

// ─── POST /api/anon/jobs/:id/run ─────────────────────────────────────────────
dataAnonRouter.post('/jobs/:id/run', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const job = await c.env.DB.prepare(
    'SELECT * FROM anonymizationJobs WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<{
    id: string; sourceTable: string; fieldsToStrip: string;
    conditions: string | null; status: string;
  }>();

  if (!job) return c.json({ error: 'Job not found' }, 404);
  if (job.status === 'running') return c.json({ error: 'Job is already running' }, 409);
  if (job.status === 'completed') return c.json({ error: 'Job already completed' }, 409);

  // Mark running
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE anonymizationJobs SET status = 'running' WHERE id = ? AND tenantId = ?`
  ).bind(id, tenantId).run();

  const fieldsToStrip: string[] = JSON.parse(job.fieldsToStrip);

  try {
    // Fetch source data (tenant-isolated)
    const { results: rows } = await c.env.DB.prepare(
      `SELECT * FROM ${job.sourceTable} WHERE tenantId = ?`
    ).bind(tenantId).all<Record<string, unknown>>();

    // Anonymize
    const anonymised = rows.map((r) => anonymizeRecord(r, fieldsToStrip));

    // Write to R2
    const r2Key = `anon/${tenantId}/${id}/export.ndjson`;
    const ndjson = anonymised.map((r) => JSON.stringify(r)).join('\n');
    await c.env.MEDIA_BUCKET.put(r2Key, new TextEncoder().encode(ndjson), {
      httpMetadata: { contentType: 'application/x-ndjson' },
      customMetadata: { tenantId, jobId: id, sourceTable: job.sourceTable },
    });

    const completedAt = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE anonymizationJobs
       SET status = 'completed', processedCount = ?, outputR2Key = ?, completedAt = ?
       WHERE id = ? AND tenantId = ?`
    ).bind(anonymised.length, r2Key, completedAt, id, tenantId).run();

    return c.json({
      success: true,
      processedCount: anonymised.length,
      outputR2Key: r2Key,
      completedAt,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await c.env.DB.prepare(
      `UPDATE anonymizationJobs SET status = 'failed' WHERE id = ? AND tenantId = ?`
    ).bind(id, tenantId).run();
    return c.json({ success: false, error: msg }, 500);
  }
});
