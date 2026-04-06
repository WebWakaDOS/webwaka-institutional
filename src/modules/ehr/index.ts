/**
 * Electronic Health Records (EHR) — WebWaka Institutional Suite
 *
 * Stores patient medical histories, inst_prescriptions, and lab results.
 *
 * Invariant 2: tenantId always from JWT.
 *
 * Routes:
 *   POST  /api/ehr/patients           — Create patient record
 *   GET   /api/ehr/patients           — List patient records
 *   GET   /api/ehr/patients/:id       — Get patient record
 *   PATCH /api/ehr/patients/:id       — Update patient record
 *
 *   POST  /api/ehr/patients/:id/inst_prescriptions      — Add prescription
 *   GET   /api/ehr/patients/:id/inst_prescriptions      — List inst_prescriptions
 *   PATCH /api/ehr/inst_prescriptions/:id/status        — Update prescription status
 *
 *   POST  /api/ehr/patients/:id/labs               — Add lab result
 *   GET   /api/ehr/patients/:id/labs               — List lab results
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const ehrRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Patient Records ──────────────────────────────────────────────────────────

ehrRouter.post('/patients', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    patientId: string; dob?: string; bloodGroup?: string; genotype?: string;
    allergies?: string[]; medicalHistory?: Array<{ date: string; condition: string; notes: string }>;
  }>();
  if (!body.patientId) return c.json({ error: 'patientId is required' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM inst_patientRecords WHERE patientId = ? AND tenantId = ?'
  ).bind(body.patientId, tenantId).first();
  if (existing) return c.json({ error: 'Patient record already exists' }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO inst_patientRecords
       (id, tenantId, patientId, dob, bloodGroup, genotype, allergies, medicalHistory, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.patientId, body.dob ?? null, body.bloodGroup ?? null,
    body.genotype ?? null,
    JSON.stringify(body.allergies ?? []),
    JSON.stringify(body.medicalHistory ?? []),
    now, now).run();

  return c.json({ success: true, id }, 201);
});

ehrRouter.get('/patients', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM inst_patientRecords WHERE tenantId = ? ORDER BY createdAt DESC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

ehrRouter.get('/patients/:id', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const record = await c.env.DB.prepare(
    'SELECT * FROM inst_patientRecords WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!record) return c.json({ error: 'Patient record not found' }, 404);
  return c.json({ data: record });
});

ehrRouter.patch('/patients/:id', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{
    bloodGroup?: string; genotype?: string;
    allergies?: string[]; medicalHistory?: unknown[];
  }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE inst_patientRecords
     SET bloodGroup = COALESCE(?, bloodGroup), genotype = COALESCE(?, genotype),
         allergies = COALESCE(?, allergies), medicalHistory = COALESCE(?, medicalHistory), updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(
    body.bloodGroup ?? null, body.genotype ?? null,
    body.allergies ? JSON.stringify(body.allergies) : null,
    body.medicalHistory ? JSON.stringify(body.medicalHistory) : null,
    now, id, tenantId
  ).run();
  return c.json({ success: true });
});

// ─── Prescriptions ────────────────────────────────────────────────────────────

ehrRouter.post('/patients/:id/inst_prescriptions', requireRole(['admin', 'doctor']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const prescribedBy = c.get('user').userId;
  const patientId = c.req.param('id');
  const body = await c.req.json<{
    medication: string; dosage: string; frequency?: string; duration?: string;
  }>();
  if (!body.medication || !body.dosage) {
    return c.json({ error: 'medication and dosage are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO inst_prescriptions
       (id, tenantId, patientId, medication, dosage, frequency, duration, prescribedBy, prescribedAt, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
  ).bind(id, tenantId, patientId, body.medication, body.dosage,
    body.frequency ?? null, body.duration ?? null, prescribedBy, now, now).run();

  return c.json({ success: true, id }, 201);
});

ehrRouter.get('/patients/:id/inst_prescriptions', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const patientId = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM inst_prescriptions WHERE tenantId = ? AND patientId = ? ORDER BY prescribedAt DESC'
  ).bind(tenantId, patientId).all();
  return c.json({ data: results });
});

ehrRouter.patch('/inst_prescriptions/:id/status', requireRole(['admin', 'doctor']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ status: string }>();
  if (!['active', 'completed', 'cancelled'].includes(body.status ?? '')) {
    return c.json({ error: 'status must be active, completed, or cancelled' }, 400);
  }
  await c.env.DB.prepare(
    'UPDATE inst_prescriptions SET status = ? WHERE id = ? AND tenantId = ?'
  ).bind(body.status, id, tenantId).run();
  return c.json({ success: true });
});

// ─── Lab Results ──────────────────────────────────────────────────────────────

ehrRouter.post('/patients/:id/labs', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const testedBy = c.get('user').userId;
  const patientId = c.req.param('id');
  const body = await c.req.json<{
    testName: string; result: string; unit?: string; refRange?: string;
    testedAt?: string; r2Key?: string;
  }>();
  if (!body.testName || !body.result) {
    return c.json({ error: 'testName and result are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO inst_labResults
       (id, tenantId, patientId, testName, result, unit, refRange, testedAt, testedBy, r2Key, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, patientId, body.testName, body.result,
    body.unit ?? null, body.refRange ?? null,
    body.testedAt ?? now, testedBy, body.r2Key ?? null, now).run();

  return c.json({ success: true, id }, 201);
});

ehrRouter.get('/patients/:id/labs', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const patientId = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM inst_labResults WHERE tenantId = ? AND patientId = ? ORDER BY testedAt DESC'
  ).bind(tenantId, patientId).all();
  return c.json({ data: results });
});
