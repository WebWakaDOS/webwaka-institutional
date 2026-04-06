/**
 * Student Management — WebWaka Institutional Suite
 *
 * Full student lifecycle: registration (with NDPR consent), profile management,
 * and deactivation.
 *
 * Invariant 1: Build Once Use Infinitely — all auth from @webwaka/core
 * Invariant 2: tenantId always from JWT, never from headers or body
 * Invariant 5: Nigeria First — en-NG defaults
 *
 * WI-003: NDPR consent is asserted and recorded on every new student registration.
 * WI-010: Full profile fields captured; inst_staff-only mutation endpoints enforced.
 *
 * Routes:
 *   POST  /api/inst_students          — Register new student (requires NDPR consent)
 *   GET   /api/inst_students          — List inst_students (admin/teacher)
 *   GET   /api/inst_students/:id      — Get student (self, teacher, admin)
 *   PATCH /api/inst_students/:id      — Update profile (admin only)
 *   DELETE /api/inst_students/:id     — Deactivate student (admin only)
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import { assertNdprConsent, recordNdprConsent } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const studentMgmtRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── POST /api/inst_students ───────────────────────────────────────────────────────

studentMgmtRouter.post('/', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    matricNumber: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone: string;
    programmeId: string;
    level: number;
    admissionDate?: string;
    status?: string;
    ndprConsent: boolean;
  }>();

  if (!body.matricNumber || !body.firstName || !body.lastName || !body.phone ||
      !body.programmeId || !body.level) {
    return c.json({
      error: 'matricNumber, firstName, lastName, phone, programmeId, level are required',
    }, 400);
  }

  // WI-003: Assert NDPR data-processing consent before storing any PII
  assertNdprConsent(body);

  // Prevent duplicate matric numbers within the same tenant
  const existing = await c.env.DB.prepare(
    'SELECT id FROM inst_students WHERE matricNumber = ? AND tenantId = ?'
  ).bind(body.matricNumber, tenantId).first();
  if (existing) {
    return c.json({ error: 'A student with this matric number already exists' }, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const admissionDate = body.admissionDate ?? now.split('T')[0];

  await c.env.DB.prepare(
    `INSERT INTO inst_students
       (id, tenantId, matricNumber, firstName, lastName, email, phone,
        programmeId, level, admissionDate, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tenantId, body.matricNumber,
    body.firstName, body.lastName, body.email ?? null, body.phone,
    body.programmeId, body.level, admissionDate,
    body.status ?? 'active', now, now,
  ).run();

  // WI-003: Record consent to the NDPR audit log (non-blocking; best-effort)
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? null;
  const ua = c.req.header('User-Agent') ?? null;
  await recordNdprConsent(c.env.DB, id, 'student', ip, ua).catch(() => {});

  return c.json({ success: true, id }, 201);
});

// ─── GET /api/inst_students ────────────────────────────────────────────────────────

studentMgmtRouter.get('/', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { status, programmeId } = c.req.query() as Record<string, string>;

  let sql = 'SELECT id, tenantId, matricNumber, firstName, lastName, email, phone, programmeId, level, admissionDate, status, createdAt, updatedAt FROM inst_students WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (programmeId) { sql += ' AND programmeId = ?'; args.push(programmeId); }
  sql += ' ORDER BY lastName ASC, firstName ASC';

  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

// ─── GET /api/inst_students/:id ────────────────────────────────────────────────────

studentMgmtRouter.get('/:id', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  // Students may only view their own record
  if (user.role === 'student' && id !== user.userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const student = await c.env.DB.prepare(
    `SELECT id, tenantId, matricNumber, firstName, lastName, email, phone,
            programmeId, level, admissionDate, status, createdAt, updatedAt
     FROM inst_students WHERE id = ? AND tenantId = ?`
  ).bind(id, tenantId).first();

  if (!student) return c.json({ error: 'Student not found' }, 404);
  return c.json({ data: student });
});

// ─── PATCH /api/inst_students/:id ──────────────────────────────────────────────────

studentMgmtRouter.patch('/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    programmeId?: string;
    level?: number;
    status?: string;
  }>();

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE inst_students
     SET firstName   = COALESCE(?, firstName),
         lastName    = COALESCE(?, lastName),
         email       = COALESCE(?, email),
         phone       = COALESCE(?, phone),
         programmeId = COALESCE(?, programmeId),
         level       = COALESCE(?, level),
         status      = COALESCE(?, status),
         updatedAt   = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(
    body.firstName ?? null, body.lastName ?? null,
    body.email ?? null, body.phone ?? null,
    body.programmeId ?? null, body.level ?? null,
    body.status ?? null, now, id, tenantId,
  ).run();

  return c.json({ success: true });
});

// ─── DELETE /api/inst_students/:id ─────────────────────────────────────────────────
// Soft delete — sets status to 'withdrawn' to preserve historical records.

studentMgmtRouter.delete('/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE inst_students SET status = 'withdrawn', updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(now, id, tenantId).run();

  return c.json({ success: true, status: 'withdrawn' });
});
