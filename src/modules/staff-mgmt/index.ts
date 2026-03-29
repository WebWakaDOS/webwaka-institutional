import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings } from '../../core/types';

export const staffMgmtRouter = new Hono<{ Bindings: Bindings }>();

staffMgmtRouter.get('/', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM staff WHERE tenantId = ? ORDER BY createdAt DESC'
  )
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

staffMgmtRouter.post('/', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO staff (id, tenantId, staffId, status, department, role, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, body.staffId, body.status || 'active', body.department, body.role, createdAt)
    .run();

  return c.json({ success: true, id }, 201);
});
