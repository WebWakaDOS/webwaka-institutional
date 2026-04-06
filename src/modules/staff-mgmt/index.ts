/**
 * Staff Management — WebWaka Institutional Suite
 *
 * Full staff lifecycle: registration (with NDPR consent), profile + salary
 * management, and deactivation.
 *
 * Invariant 1: Build Once Use Infinitely — all auth from @webwaka/core
 * Invariant 2: tenantId always from JWT
 * Invariant 5: Nigeria First — all monetary values in kobo
 *
 * WI-003: NDPR consent recorded on registration.
 * WI-010: Full profile including salary columns required by the payroll engine.
 *
 * Routes:
 *   POST  /api/staff        — Register staff member (requires NDPR consent)
 *   GET   /api/staff        — List staff (admin)
 *   GET   /api/staff/:id    — Get staff member (self, admin)
 *   PATCH /api/staff/:id    — Update profile / salary (admin)
 *   DELETE /api/staff/:id   — Deactivate staff (admin)
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import { assertNdprConsent, recordNdprConsent } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const staffMgmtRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── POST /api/staff ──────────────────────────────────────────────────────────

staffMgmtRouter.post('/', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    staffId: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    department: string;
    role: string;
    grossSalaryKobo?: number;
    pensionDeductionKobo?: number;
    otherDeductionsKobo?: number;
    status?: string;
    ndprConsent: boolean;
  }>();

  if (!body.staffId || !body.firstName || !body.lastName || !body.department || !body.role) {
    return c.json({
      error: 'staffId, firstName, lastName, department, role are required',
    }, 400);
  }

  // WI-003: Assert NDPR data-processing consent before storing any PII
  assertNdprConsent(body);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM staff WHERE staffId = ? AND tenantId = ?'
  ).bind(body.staffId, tenantId).first();
  if (existing) {
    return c.json({ error: 'A staff member with this staffId already exists' }, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO staff
       (id, tenantId, staffId, firstName, lastName, email, phone, department, role,
        grossSalaryKobo, pensionDeductionKobo, otherDeductionsKobo, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tenantId, body.staffId,
    body.firstName, body.lastName, body.email ?? null, body.phone ?? null,
    body.department, body.role,
    body.grossSalaryKobo ?? 0,
    body.pensionDeductionKobo ?? 0,
    body.otherDeductionsKobo ?? 0,
    body.status ?? 'active', now, now,
  ).run();

  // WI-003: Record consent to the NDPR audit log
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? null;
  const ua = c.req.header('User-Agent') ?? null;
  await recordNdprConsent(c.env.DB, id, 'staff', ip, ua).catch(() => {});

  return c.json({ success: true, id }, 201);
});

// ─── GET /api/staff ───────────────────────────────────────────────────────────

staffMgmtRouter.get('/', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { status, department, role } = c.req.query() as Record<string, string>;

  let sql = `SELECT id, tenantId, staffId, firstName, lastName, email, phone,
                    department, role, grossSalaryKobo, pensionDeductionKobo,
                    otherDeductionsKobo, status, createdAt, updatedAt
             FROM staff WHERE tenantId = ?`;
  const args: unknown[] = [tenantId];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (department) { sql += ' AND department = ?'; args.push(department); }
  if (role) { sql += ' AND role = ?'; args.push(role); }
  sql += ' ORDER BY lastName ASC, firstName ASC';

  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

// ─── GET /api/staff/:id ───────────────────────────────────────────────────────

staffMgmtRouter.get('/:id', requireRole(['admin', 'staff']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  // Staff may only view their own record
  if (user.role === 'staff' && id !== user.userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const member = await c.env.DB.prepare(
    `SELECT id, tenantId, staffId, firstName, lastName, email, phone,
            department, role, grossSalaryKobo, pensionDeductionKobo,
            otherDeductionsKobo, status, createdAt, updatedAt
     FROM staff WHERE id = ? AND tenantId = ?`
  ).bind(id, tenantId).first();

  if (!member) return c.json({ error: 'Staff member not found' }, 404);
  return c.json({ data: member });
});

// ─── PATCH /api/staff/:id ─────────────────────────────────────────────────────

staffMgmtRouter.patch('/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    department?: string;
    role?: string;
    grossSalaryKobo?: number;
    pensionDeductionKobo?: number;
    otherDeductionsKobo?: number;
    status?: string;
  }>();

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE staff
     SET firstName            = COALESCE(?, firstName),
         lastName             = COALESCE(?, lastName),
         email                = COALESCE(?, email),
         phone                = COALESCE(?, phone),
         department           = COALESCE(?, department),
         role                 = COALESCE(?, role),
         grossSalaryKobo      = COALESCE(?, grossSalaryKobo),
         pensionDeductionKobo = COALESCE(?, pensionDeductionKobo),
         otherDeductionsKobo  = COALESCE(?, otherDeductionsKobo),
         status               = COALESCE(?, status),
         updatedAt            = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(
    body.firstName ?? null, body.lastName ?? null,
    body.email ?? null, body.phone ?? null,
    body.department ?? null, body.role ?? null,
    body.grossSalaryKobo ?? null, body.pensionDeductionKobo ?? null,
    body.otherDeductionsKobo ?? null, body.status ?? null,
    now, id, tenantId,
  ).run();

  return c.json({ success: true });
});

// ─── DELETE /api/staff/:id ────────────────────────────────────────────────────
// Soft delete — sets status to 'inactive' to preserve payslip history.

staffMgmtRouter.delete('/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE staff SET status = 'inactive', updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(now, id, tenantId).run();

  return c.json({ success: true, status: 'inactive' });
});
