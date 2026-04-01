import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const feeCollectionRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

feeCollectionRouter.get('/', requireRole(['admin', 'accountant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM feeRecords WHERE tenantId = ? ORDER BY createdAt DESC'
  )
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

feeCollectionRouter.post('/', requireRole(['admin', 'accountant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO feeRecords (id, tenantId, studentId, feeType, amountKobo, status, academicYear, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, body.studentId, body.feeType, body.amountKobo, body.status || 'pending', body.academicYear, createdAt)
    .run();

  return c.json({ success: true, id }, 201);
});
