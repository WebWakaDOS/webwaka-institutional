/**
 * Visitor Management System — WebWaka Institutional Suite
 *
 * Digital sign-in with badge code generation and checkout tracking.
 *
 * Invariant 2: tenantId always from JWT.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const visitorRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

visitorRouter.post('/', requireRole(['admin', 'inst_staff', 'security']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    visitorName: string; phone?: string; host: string; purpose: string; campusId?: string;
  }>();
  if (!body.visitorName || !body.host || !body.purpose) {
    return c.json({ error: 'visitorName, host, and purpose are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const badgeCode = `VIS-${now.slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  await c.env.DB.prepare(
    `INSERT INTO inst_visitorLogs
       (id, tenantId, visitorName, phone, host, purpose, checkIn, badgeCode, campusId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.visitorName, body.phone ?? null, body.host, body.purpose,
    now, badgeCode, body.campusId ?? null, now).run();

  return c.json({ success: true, id, badgeCode, checkIn: now }, 201);
});

visitorRouter.get('/', requireRole(['admin', 'inst_staff', 'security']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { date, host } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM inst_visitorLogs WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (date)  { sql += ' AND checkIn LIKE ?'; args.push(`${date}%`); }
  if (host)  { sql += ' AND host = ?';       args.push(host); }
  sql += ' ORDER BY checkIn DESC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

visitorRouter.patch('/:id/checkout', requireRole(['admin', 'inst_staff', 'security']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const log = await c.env.DB.prepare(
    'SELECT checkOut FROM inst_visitorLogs WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<{ checkOut: string | null }>();
  if (!log) return c.json({ error: 'Visitor log not found' }, 404);
  if (log.checkOut) return c.json({ error: 'Visitor already checked out' }, 409);

  await c.env.DB.prepare(
    'UPDATE inst_visitorLogs SET checkOut = ? WHERE id = ? AND tenantId = ?'
  ).bind(now, id, tenantId).run();
  return c.json({ success: true, checkOut: now });
});
