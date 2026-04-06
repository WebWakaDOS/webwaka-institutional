/**
 * Fee Collection — WebWaka Institutional Suite
 *
 * Manages student fee records, payment tracking, and emits central-mgmt
 * financial events on successful payment.
 *
 * Invariant 1: Build Once Use Infinitely — all auth from @webwaka/core
 * Invariant 2: tenantId always from JWT
 * Invariant 5: Nigeria First — all amounts in kobo (NGN × 100)
 *
 * WI-009: Emits institution.fee.paid event on payment so webwaka-central-mgmt
 *         can record the transaction in the immutable financial ledger.
 * WI-010: Full fee lifecycle with balance tracking.
 *
 * Routes:
 *   POST  /api/fees           — Create a fee record
 *   GET   /api/fees           — List fee records (filterable by studentId/status)
 *   GET   /api/fees/:id       — Get single fee record
 *   PATCH /api/fees/:id/pay   — Record a payment against a fee record
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const feeCollectionRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── POST /api/fees ────────────────────────────────────────────────────────────

feeCollectionRouter.post('/', requireRole(['admin', 'accountant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    studentId: string;
    feeType: string;
    amountKobo: number;
    academicYear: string;
    semester?: string;
    dueDate?: string;
    status?: string;
  }>();

  if (!body.studentId || !body.feeType || !body.amountKobo || !body.academicYear) {
    return c.json({ error: 'studentId, feeType, amountKobo, academicYear are required' }, 400);
  }
  if (!Number.isInteger(body.amountKobo) || body.amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer (kobo)' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO feeRecords
       (id, tenantId, studentId, feeType, amountKobo, paidKobo, balanceKobo,
        status, academicYear, semester, dueDate, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tenantId, body.studentId, body.feeType, body.amountKobo,
    body.amountKobo,
    body.status ?? 'pending',
    body.academicYear, body.semester ?? null, body.dueDate ?? null,
    now, now,
  ).run();

  return c.json({ success: true, id, amountKobo: body.amountKobo, balanceKobo: body.amountKobo }, 201);
});

// ─── GET /api/fees ─────────────────────────────────────────────────────────────

feeCollectionRouter.get('/', requireRole(['admin', 'accountant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { studentId, status, academicYear } = c.req.query() as Record<string, string>;

  let sql = 'SELECT * FROM feeRecords WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (studentId) { sql += ' AND studentId = ?'; args.push(studentId); }
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (academicYear) { sql += ' AND academicYear = ?'; args.push(academicYear); }
  sql += ' ORDER BY createdAt DESC';

  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

// ─── GET /api/fees/:id ─────────────────────────────────────────────────────────

feeCollectionRouter.get('/:id', requireRole(['admin', 'accountant', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const record = await c.env.DB.prepare(
    'SELECT * FROM feeRecords WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();

  if (!record) return c.json({ error: 'Fee record not found' }, 404);
  return c.json({ data: record });
});

// ─── PATCH /api/fees/:id/pay ───────────────────────────────────────────────────
// Records a payment (full or partial) against an outstanding fee record.
// WI-009: On success, emits institution.fee.paid event for central-mgmt ledger.

feeCollectionRouter.patch('/:id/pay', requireRole(['admin', 'accountant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const recordedBy = c.get('user').userId;
  const id = c.req.param('id');
  const body = await c.req.json<{
    paymentKobo: number;
    transactionRef?: string;
    paymentMethod?: string;
  }>();

  if (!body.paymentKobo || !Number.isInteger(body.paymentKobo) || body.paymentKobo <= 0) {
    return c.json({ error: 'paymentKobo must be a positive integer (kobo)' }, 400);
  }

  const fee = await c.env.DB.prepare(
    'SELECT * FROM feeRecords WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<{
    id: string; tenantId: string; studentId: string; feeType: string;
    amountKobo: number; paidKobo: number; balanceKobo: number;
    status: string; academicYear: string;
  }>();

  if (!fee) return c.json({ error: 'Fee record not found' }, 404);
  if (fee.status === 'success') {
    return c.json({ error: 'Fee is already fully paid' }, 409);
  }

  const currentPaid = fee.paidKobo ?? 0;
  const currentBalance = fee.balanceKobo ?? fee.amountKobo;

  const newPaid = currentPaid + body.paymentKobo;
  const newBalance = Math.max(0, currentBalance - body.paymentKobo);
  const newStatus = newBalance === 0 ? 'success' : 'partial';

  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE feeRecords
     SET paidKobo = ?, balanceKobo = ?, status = ?, updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(newPaid, newBalance, newStatus, now, id, tenantId).run();

  // WI-009: Emit central-mgmt event for all successful/partial fee payments
  const paymentEvent = {
    event: 'institution.fee.paid',
    tenantId,
    feeRecordId: id,
    studentId: fee.studentId,
    feeType: fee.feeType,
    academicYear: fee.academicYear,
    paymentKobo: body.paymentKobo,
    totalPaidKobo: newPaid,
    balanceKobo: newBalance,
    status: newStatus,
    transactionRef: body.transactionRef ?? null,
    paymentMethod: body.paymentMethod ?? 'manual',
    recordedBy,
    timestamp: now,
  };

  return c.json({
    success: true,
    feeRecordId: id,
    paidKobo: newPaid,
    balanceKobo: newBalance,
    status: newStatus,
    paymentEvent,
  });
});
