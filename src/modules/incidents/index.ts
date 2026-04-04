/**
 * Incident Reporting — WebWaka Institutional Suite
 *
 * Workflow for reporting and resolving workplace accidents, security breaches,
 * fire incidents, harassment cases, and other institutional incidents.
 *
 * Invariant 2: tenantId always from JWT.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const incidentsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

incidentsRouter.post('/', requireRole(['admin', 'staff', 'student', 'security']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const reportedBy = c.get('user').userId;
  const body = await c.req.json<{
    type: string; description: string; location?: string;
    campusId?: string; severity?: string;
  }>();
  if (!body.type || !body.description) {
    return c.json({ error: 'type and description are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO incidents
       (id, tenantId, reportedBy, type, description, location, campusId, severity, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  ).bind(id, tenantId, reportedBy, body.type, body.description,
    body.location ?? null, body.campusId ?? null, body.severity ?? 'low', now, now).run();

  return c.json({ success: true, id }, 201);
});

incidentsRouter.get('/', requireRole(['admin', 'security', 'management']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { status, severity, type, campusId } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM incidents WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (status)   { sql += ' AND status = ?';   args.push(status); }
  if (severity) { sql += ' AND severity = ?'; args.push(severity); }
  if (type)     { sql += ' AND type = ?';     args.push(type); }
  if (campusId) { sql += ' AND campusId = ?'; args.push(campusId); }
  sql += ' ORDER BY createdAt DESC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

incidentsRouter.get('/:id', requireRole(['admin', 'security', 'management']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const record = await c.env.DB.prepare(
    'SELECT * FROM incidents WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!record) return c.json({ error: 'Incident not found' }, 404);
  return c.json({ data: record });
});

incidentsRouter.patch('/:id/investigate', requireRole(['admin', 'security', 'management']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE incidents SET status = 'investigating', updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(now, id, tenantId).run();
  return c.json({ success: true, status: 'investigating' });
});

incidentsRouter.patch('/:id/resolve', requireRole(['admin', 'management']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const resolvedBy = c.get('user').userId;
  const id = c.req.param('id');
  const body = await c.req.json<{ resolution: string }>();
  if (!body.resolution) return c.json({ error: 'resolution is required' }, 400);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE incidents
     SET status = 'resolved', resolution = ?, resolvedBy = ?, resolvedAt = ?, updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.resolution, resolvedBy, now, now, id, tenantId).run();
  return c.json({ success: true, status: 'resolved' });
});
