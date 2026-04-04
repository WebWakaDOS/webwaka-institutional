/**
 * Biometric Attendance — WebWaka Institutional Suite
 *
 * Records and queries attendance logs from fingerprint, face, card, or manual entry.
 *
 * Invariant 2: tenantId always from JWT.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const attendanceRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

attendanceRouter.post('/', requireRole(['admin', 'staff', 'security', 'device']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    memberId: string; memberType?: string; method?: string;
    status?: string; campusId?: string; deviceId?: string; timestamp?: string;
  }>();
  if (!body.memberId) return c.json({ error: 'memberId is required' }, 400);

  const id = crypto.randomUUID();
  const now = body.timestamp ?? new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO attendanceLogs
       (id, tenantId, memberId, memberType, timestamp, method, status, campusId, deviceId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.memberId, body.memberType ?? 'student',
    now, body.method ?? 'manual', body.status ?? 'present',
    body.campusId ?? null, body.deviceId ?? null, new Date().toISOString()).run();

  return c.json({ success: true, id, timestamp: now }, 201);
});

attendanceRouter.get('/', requireRole(['admin', 'teacher', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { memberId, date, campusId, memberType } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM attendanceLogs WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (memberId)   { sql += ' AND memberId = ?';         args.push(memberId); }
  if (memberType) { sql += ' AND memberType = ?';       args.push(memberType); }
  if (date)       { sql += ' AND timestamp LIKE ?';     args.push(`${date}%`); }
  if (campusId)   { sql += ' AND campusId = ?';         args.push(campusId); }
  sql += ' ORDER BY timestamp DESC LIMIT 500';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

// Summary: present/absent/late count for a given date and memberType
attendanceRouter.get('/summary', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { date, memberType } = c.req.query() as Record<string, string>;
  if (!date) return c.json({ error: 'date query param is required (YYYY-MM-DD)' }, 400);

  const memberTypeFilter = memberType ? 'AND memberType = ?' : '';
  const args: unknown[] = [tenantId, `${date}%`];
  if (memberType) args.push(memberType);

  const { results } = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as count
     FROM attendanceLogs WHERE tenantId = ? AND timestamp LIKE ? ${memberTypeFilter}
     GROUP BY status`
  ).bind(...args).all<{ status: string; count: number }>();

  const summary: Record<string, number> = { present: 0, absent: 0, late: 0 };
  for (const r of results) {
    summary[r.status] = r.count;
  }
  return c.json({ data: { date, memberType: memberType ?? 'all', ...summary } });
});
