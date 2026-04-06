/**
 * Insurance Claims Processing — WebWaka Institutional Suite
 *
 * Automated workflow for submitting and tracking healthcare insurance claims,
 * supporting inpatient, outpatient, dental, optical, and maternity claims.
 *
 * Invariant 2: tenantId always from JWT.
 * Invariant 5: all amounts in kobo.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const insuranceRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const VALID_CLAIM_TYPES = ['inpatient', 'outpatient', 'dental', 'optical', 'maternity'];

insuranceRouter.post('/', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    patientId: string; policyNumber: string; provider?: string;
    claimType: string; amountKobo: number; inst_documents?: string[]; notes?: string;
  }>();

  if (!body.patientId || !body.policyNumber || !body.claimType || !body.amountKobo) {
    return c.json({ error: 'patientId, policyNumber, claimType, and amountKobo are required' }, 400);
  }
  if (!VALID_CLAIM_TYPES.includes(body.claimType)) {
    return c.json({ error: `claimType must be one of: ${VALID_CLAIM_TYPES.join(', ')}` }, 400);
  }

  const id = crypto.randomUUID();
  const referenceNo = `WW-${Date.now().toString(36).toUpperCase()}`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO inst_insuranceClaims
       (id, tenantId, patientId, policyNumber, provider, claimType, amountKobo,
        status, submittedAt, referenceNo, inst_documents, notes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.patientId, body.policyNumber, body.provider ?? null,
    body.claimType, body.amountKobo, now, referenceNo,
    JSON.stringify(body.inst_documents ?? []), body.notes ?? null, now, now).run();

  return c.json({ success: true, id, referenceNo }, 201);
});

insuranceRouter.get('/', requireRole(['admin', 'doctor', 'finance']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { patientId, status, claimType } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM inst_insuranceClaims WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (patientId)  { sql += ' AND patientId = ?';  args.push(patientId); }
  if (status)     { sql += ' AND status = ?';     args.push(status); }
  if (claimType)  { sql += ' AND claimType = ?';  args.push(claimType); }
  sql += ' ORDER BY submittedAt DESC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

insuranceRouter.get('/:id', requireRole(['admin', 'doctor', 'finance']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const claim = await c.env.DB.prepare(
    'SELECT * FROM inst_insuranceClaims WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!claim) return c.json({ error: 'Insurance claim not found' }, 404);
  return c.json({ data: claim });
});

insuranceRouter.patch('/:id/review', requireRole(['admin', 'finance']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{
    status: string; approvedKobo?: number; notes?: string;
  }>();

  const validStatuses = ['under_review', 'approved', 'partially_approved', 'rejected', 'paid'];
  if (!validStatuses.includes(body.status)) {
    return c.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, 400);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE inst_insuranceClaims
     SET status = ?, approvedKobo = COALESCE(?, approvedKobo),
         notes = COALESCE(?, notes), processedAt = ?, updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.status, body.approvedKobo ?? null, body.notes ?? null, now, now, id, tenantId).run();

  return c.json({ success: true, status: body.status });
});

insuranceRouter.post('/:id/inst_documents', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const claim = await c.env.DB.prepare(
    'SELECT inst_documents FROM inst_insuranceClaims WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<{ inst_documents: string }>();
  if (!claim) return c.json({ error: 'Insurance claim not found' }, 404);

  const contentType = c.req.header('Content-Type') ?? 'application/octet-stream';
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'Empty file body' }, 400);

  const ext = contentType.includes('pdf') ? 'pdf' : 'jpg';
  const r2Key = `insurance/${tenantId}/${id}/${crypto.randomUUID()}.${ext}`;
  await c.env.MEDIA_BUCKET.put(r2Key, body, {
    httpMetadata: { contentType },
    customMetadata: { tenantId, claimId: id },
  });

  const docs: string[] = JSON.parse(claim.inst_documents || '[]');
  docs.push(r2Key);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'UPDATE inst_insuranceClaims SET inst_documents = ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
  ).bind(JSON.stringify(docs), now, id, tenantId).run();

  return c.json({ success: true, r2Key });
});
