/**
 * Procurement Workflow — WebWaka Institutional Suite
 *
 * End-to-end purchase requisitions, approval workflow, and vendor management.
 *
 * Invariant 2: tenantId always from JWT.
 * Invariant 5: all monetary values in kobo.
 *
 * Routes:
 *   POST  /api/procurement/vendors           — Register vendor
 *   GET   /api/procurement/vendors           — List vendors
 *   GET   /api/procurement/vendors/:id       — Get vendor
 *   PATCH /api/procurement/vendors/:id       — Update vendor
 *
 *   POST  /api/procurement/requisitions      — Create purchase requisition
 *   GET   /api/procurement/requisitions      — List requisitions
 *   GET   /api/procurement/requisitions/:id  — Get requisition
 *   PATCH /api/procurement/requisitions/:id/approve — Approve
 *   PATCH /api/procurement/requisitions/:id/reject  — Reject
 *   PATCH /api/procurement/requisitions/:id/receive — Mark as received
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const procurementRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Vendors ──────────────────────────────────────────────────────────────────

procurementRouter.post('/vendors', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    name: string; email?: string; phone?: string; address?: string; category?: string;
  }>();
  if (!body.name) return c.json({ error: 'name is required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO vendors (id, tenantId, name, email, phone, address, category, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).bind(id, tenantId, body.name, body.email ?? null, body.phone ?? null,
    body.address ?? null, body.category ?? null, now, now).run();

  return c.json({ success: true, id }, 201);
});

procurementRouter.get('/vendors', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM vendors WHERE tenantId = ? ORDER BY name ASC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

procurementRouter.get('/vendors/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const vendor = await c.env.DB.prepare(
    'SELECT * FROM vendors WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!vendor) return c.json({ error: 'Vendor not found' }, 404);
  return c.json({ data: vendor });
});

procurementRouter.patch('/vendors/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string; email?: string; phone?: string; address?: string; category?: string; status?: string;
  }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE vendors SET name = COALESCE(?, name), email = COALESCE(?, email),
       phone = COALESCE(?, phone), address = COALESCE(?, address),
       category = COALESCE(?, category), status = COALESCE(?, status), updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.name ?? null, body.email ?? null, body.phone ?? null, body.address ?? null,
    body.category ?? null, body.status ?? null, now, id, tenantId).run();
  return c.json({ success: true });
});

// ─── Purchase Requisitions ────────────────────────────────────────────────────

procurementRouter.post('/requisitions', requireRole(['admin', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const requestedBy = c.get('user').userId;
  const body = await c.req.json<{
    title: string;
    items: Array<{ description: string; qty: number; unitPriceKobo: number }>;
    vendorId?: string;
    notes?: string;
  }>();

  if (!body.title || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'title and at least one item are required' }, 400);
  }

  const totalKobo = body.items.reduce(
    (sum, item) => sum + Math.round(item.qty * item.unitPriceKobo), 0
  );

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO purchaseRequisitions
       (id, tenantId, requestedBy, title, items, totalKobo, vendorId, status, notes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).bind(id, tenantId, requestedBy, body.title, JSON.stringify(body.items), totalKobo,
    body.vendorId ?? null, body.notes ?? null, now, now).run();

  return c.json({ success: true, id, totalKobo }, 201);
});

procurementRouter.get('/requisitions', requireRole(['admin', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const user = c.get('user');
  const status = c.req.query('status');

  let sql = 'SELECT * FROM purchaseRequisitions WHERE tenantId = ?';
  const args: unknown[] = [tenantId];

  if (user.role === 'staff') {
    sql += ' AND requestedBy = ?';
    args.push(user.userId);
  }
  if (status) {
    sql += ' AND status = ?';
    args.push(status);
  }
  sql += ' ORDER BY createdAt DESC';

  const stmt = c.env.DB.prepare(sql);
  const { results } = await stmt.bind(...args).all();
  return c.json({ data: results });
});

procurementRouter.get('/requisitions/:id', requireRole(['admin', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const req = await c.env.DB.prepare(
    'SELECT * FROM purchaseRequisitions WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!req) return c.json({ error: 'Requisition not found' }, 404);
  return c.json({ data: req });
});

procurementRouter.patch('/requisitions/:id/approve', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const approvedBy = c.get('user').userId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const req = await c.env.DB.prepare(
    'SELECT status FROM purchaseRequisitions WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<{ status: string }>();
  if (!req) return c.json({ error: 'Requisition not found' }, 404);
  if (req.status !== 'pending') return c.json({ error: `Cannot approve a ${req.status} requisition` }, 409);

  await c.env.DB.prepare(
    `UPDATE purchaseRequisitions SET status = 'approved', approvedBy = ?, approvedAt = ?, updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(approvedBy, now, now, id, tenantId).run();

  return c.json({ success: true, status: 'approved' });
});

procurementRouter.patch('/requisitions/:id/reject', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ notes?: string }>();
  const now = new Date().toISOString();

  const req = await c.env.DB.prepare(
    'SELECT status FROM purchaseRequisitions WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<{ status: string }>();
  if (!req) return c.json({ error: 'Requisition not found' }, 404);
  if (!['pending', 'approved'].includes(req.status)) {
    return c.json({ error: `Cannot reject a ${req.status} requisition` }, 409);
  }

  await c.env.DB.prepare(
    `UPDATE purchaseRequisitions SET status = 'rejected', notes = COALESCE(?, notes), updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.notes ?? null, now, id, tenantId).run();

  return c.json({ success: true, status: 'rejected' });
});

procurementRouter.patch('/requisitions/:id/receive', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const req = await c.env.DB.prepare(
    'SELECT status FROM purchaseRequisitions WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<{ status: string }>();
  if (!req) return c.json({ error: 'Requisition not found' }, 404);
  if (req.status !== 'approved' && req.status !== 'ordered') {
    return c.json({ error: `Cannot mark a ${req.status} requisition as received` }, 409);
  }

  await c.env.DB.prepare(
    `UPDATE purchaseRequisitions SET status = 'received', updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(now, id, tenantId).run();

  return c.json({ success: true, status: 'received' });
});
