import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings } from '../../core/types';

export const studentMgmtRouter = new Hono<{ Bindings: Bindings }>();

// Invariant 1: Build Once Use Infinitely
// Role-based access control via @webwaka/core primitives

studentMgmtRouter.get('/', requireRole(['admin', 'teacher']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM students WHERE tenantId = ? ORDER BY createdAt DESC'
  )
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

studentMgmtRouter.post('/', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO students (id, tenantId, matricNumber, status, programmeId, level, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, body.matricNumber, body.status || 'active', body.programmeId, body.level, createdAt)
    .run();

  return c.json({ success: true, id }, 201);
});

studentMgmtRouter.get('/:id', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const student = await c.env.DB.prepare(
    'SELECT * FROM students WHERE id = ? AND tenantId = ?'
  )
    .bind(id, tenantId)
    .first();

  if (!student) {
    return c.json({ error: 'Student not found' }, 404);
  }

  return c.json({ data: student });
});
