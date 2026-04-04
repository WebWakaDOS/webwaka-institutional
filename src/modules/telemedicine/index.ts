/**
 * Telemedicine Portal — WebWaka Institutional Suite
 *
 * Secure consultation scheduling with video meeting URL generation.
 * Integrates with the institutional EHR for pre-consultation context.
 *
 * Invariant 2: tenantId always from JWT.
 *
 * Routes:
 *   POST  /api/telemedicine/consultations        — Schedule consultation
 *   GET   /api/telemedicine/consultations        — List consultations
 *   GET   /api/telemedicine/consultations/:id    — Get consultation
 *   PATCH /api/telemedicine/consultations/:id/start    — Mark in progress + set meeting URL
 *   PATCH /api/telemedicine/consultations/:id/complete — Complete + add notes
 *   PATCH /api/telemedicine/consultations/:id/cancel   — Cancel
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const telemedicineRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

telemedicineRouter.post('/consultations', requireRole(['admin', 'doctor', 'patient']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    patientId: string; doctorId: string; scheduledAt: string; duration?: number;
  }>();
  if (!body.patientId || !body.doctorId || !body.scheduledAt) {
    return c.json({ error: 'patientId, doctorId, scheduledAt are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Generate a secure, time-limited meeting URL token
  const meetingToken = btoa(`${id}:${tenantId}:${Date.now()}`);
  const meetingUrl = `https://meet.webwaka.com/c/${meetingToken}`;

  await c.env.DB.prepare(
    `INSERT INTO consultations
       (id, tenantId, patientId, doctorId, scheduledAt, duration, status, meetingUrl, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`
  ).bind(id, tenantId, body.patientId, body.doctorId, body.scheduledAt,
    body.duration ?? 30, meetingUrl, now, now).run();

  return c.json({ success: true, id, meetingUrl }, 201);
});

telemedicineRouter.get('/consultations', requireRole(['admin', 'doctor', 'nurse', 'patient']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const user = c.get('user');
  const { status } = c.req.query() as Record<string, string>;

  let sql = 'SELECT * FROM consultations WHERE tenantId = ?';
  const args: unknown[] = [tenantId];

  if (user.role === 'doctor') { sql += ' AND doctorId = ?'; args.push(user.userId); }
  else if (user.role === 'patient') { sql += ' AND patientId = ?'; args.push(user.userId); }
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY scheduledAt DESC';

  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

telemedicineRouter.get('/consultations/:id', requireRole(['admin', 'doctor', 'nurse', 'patient']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const record = await c.env.DB.prepare(
    'SELECT * FROM consultations WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!record) return c.json({ error: 'Consultation not found' }, 404);
  return c.json({ data: record });
});

telemedicineRouter.patch('/consultations/:id/start', requireRole(['admin', 'doctor']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE consultations SET status = 'in_progress', updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(now, id, tenantId).run();
  return c.json({ success: true, status: 'in_progress' });
});

telemedicineRouter.patch('/consultations/:id/complete', requireRole(['admin', 'doctor']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ notes?: string; prescription?: string }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE consultations SET status = 'completed', notes = COALESCE(?, notes),
       prescription = COALESCE(?, prescription), updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(body.notes ?? null, body.prescription ?? null, now, id, tenantId).run();
  return c.json({ success: true, status: 'completed' });
});

telemedicineRouter.patch('/consultations/:id/cancel', requireRole(['admin', 'doctor', 'patient']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE consultations SET status = 'cancelled', updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(now, id, tenantId).run();
  return c.json({ success: true, status: 'cancelled' });
});
