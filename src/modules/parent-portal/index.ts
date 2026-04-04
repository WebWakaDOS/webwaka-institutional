/**
 * Parent / Guardian Portal — WebWaka Institutional Suite
 *
 * Allows parents to view student progress (grades, attendance, fees)
 * and be linked to specific students with relationship tracking.
 *
 * Invariant 2: tenantId always from JWT.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const parentPortalRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Parent-Student Links ─────────────────────────────────────────────────────

parentPortalRouter.post('/links', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    parentUserId: string; studentId: string; relationship?: string;
  }>();
  if (!body.parentUserId || !body.studentId) {
    return c.json({ error: 'parentUserId and studentId are required' }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM parentLinks WHERE parentUserId = ? AND studentId = ? AND tenantId = ?'
  ).bind(body.parentUserId, body.studentId, tenantId).first();
  if (existing) return c.json({ error: 'Link already exists' }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO parentLinks (id, tenantId, parentUserId, studentId, relationship, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  ).bind(id, tenantId, body.parentUserId, body.studentId,
    body.relationship ?? 'parent', now, now).run();

  return c.json({ success: true, id }, 201);
});

parentPortalRouter.get('/links', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { parentUserId, studentId } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM parentLinks WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (parentUserId) { sql += ' AND parentUserId = ?'; args.push(parentUserId); }
  if (studentId)    { sql += ' AND studentId = ?';    args.push(studentId); }
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

// ─── Parent Dashboard: view linked student's data ─────────────────────────────

parentPortalRouter.get('/dashboard', requireRole(['parent', 'guardian']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const parentUserId = c.get('user').userId;

  // Get all students linked to this parent
  const { results: links } = await c.env.DB.prepare(
    `SELECT studentId FROM parentLinks WHERE tenantId = ? AND parentUserId = ? AND status = 'active'`
  ).bind(tenantId, parentUserId).all<{ studentId: string }>();

  if (links.length === 0) {
    return c.json({ data: { students: [] } });
  }

  const studentIds = links.map((l) => l.studentId);
  const dashboards: unknown[] = [];

  for (const studentId of studentIds) {
    // Student profile
    const student = await c.env.DB.prepare(
      'SELECT * FROM students WHERE id = ? AND tenantId = ?'
    ).bind(studentId, tenantId).first();

    // Recent grades
    const { results: grades } = await c.env.DB.prepare(
      'SELECT courseCode, courseName, grade, gradePoints, academicYear, semester FROM gradeRecords WHERE tenantId = ? AND studentId = ? ORDER BY createdAt DESC LIMIT 10'
    ).bind(tenantId, studentId).all();

    // Outstanding fee balances
    const { results: fees } = await c.env.DB.prepare(
      `SELECT feeType, amountKobo, status, academicYear FROM feeRecords WHERE tenantId = ? AND studentId = ? AND status != 'success' ORDER BY createdAt DESC LIMIT 5`
    ).bind(tenantId, studentId).all();

    // Recent attendance (last 10 days)
    const tenDaysAgo = new Date(Date.now() - 10 * 86400_000).toISOString();
    const { results: attendance } = await c.env.DB.prepare(
      'SELECT timestamp, status FROM attendanceLogs WHERE tenantId = ? AND memberId = ? AND timestamp >= ? ORDER BY timestamp DESC'
    ).bind(tenantId, studentId, tenDaysAgo).all();

    dashboards.push({ student, grades, fees, attendance });
  }

  return c.json({ data: { students: dashboards } });
});
