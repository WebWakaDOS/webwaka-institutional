/**
 * Multi-Campus Support — WebWaka Institutional Suite
 *
 * Manage data and resources across multiple physical locations.
 * Every other module can reference campusId for filtering.
 *
 * Invariant 2: tenantId always from JWT.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const campusRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

campusRouter.post('/', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    name: string; code?: string; address?: string; city?: string;
    state?: string; country?: string; phone?: string; email?: string;
  }>();
  if (!body.name) return c.json({ error: 'name is required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO campuses
       (id, tenantId, name, code, address, city, state, country, phone, email, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).bind(id, tenantId, body.name, body.code ?? null, body.address ?? null,
    body.city ?? null, body.state ?? null, body.country ?? 'Nigeria',
    body.phone ?? null, body.email ?? null, now, now).run();

  return c.json({ success: true, id }, 201);
});

campusRouter.get('/', requireRole(['admin', 'staff', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM campuses WHERE tenantId = ? AND status = 'active' ORDER BY name ASC`
  ).bind(tenantId).all();
  return c.json({ data: results });
});

campusRouter.get('/:id', requireRole(['admin', 'staff', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const campus = await c.env.DB.prepare(
    'SELECT * FROM campuses WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!campus) return c.json({ error: 'Campus not found' }, 404);
  return c.json({ data: campus });
});

campusRouter.patch('/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string; address?: string; city?: string; state?: string;
    phone?: string; email?: string; status?: string;
  }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE campuses
     SET name = COALESCE(?, name), address = COALESCE(?, address), city = COALESCE(?, city),
         state = COALESCE(?, state), phone = COALESCE(?, phone), email = COALESCE(?, email),
         status = COALESCE(?, status), updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.name ?? null, body.address ?? null, body.city ?? null, body.state ?? null,
    body.phone ?? null, body.email ?? null, body.status ?? null, now, id, tenantId).run();
  return c.json({ success: true });
});
