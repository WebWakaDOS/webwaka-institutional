/**
 * Document Management System (DMS) — WebWaka Institutional Suite
 *
 * Centralised repository for institutional policies, procedures, contracts,
 * and reports stored in R2 with version tracking and access control.
 *
 * Invariant 2: tenantId always from JWT.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const dmsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

dmsRouter.post('/', requireRole(['admin', 'management']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const uploadedBy = c.get('user').userId;

  const contentType = c.req.header('Content-Type') ?? 'application/octet-stream';
  const title = c.req.header('X-Doc-Title');
  const category = c.req.header('X-Doc-Category') ?? 'other';
  const description = c.req.header('X-Doc-Description') ?? null;
  const version = c.req.header('X-Doc-Version') ?? '1.0';
  const tags = c.req.header('X-Doc-Tags') ?? null;

  if (!title) return c.json({ error: 'X-Doc-Title header is required' }, 400);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'Empty file body' }, 400);

  const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('word') ? 'docx' : 'bin';
  const id = crypto.randomUUID();
  const r2Key = `dms/${tenantId}/${category}/${id}.${ext}`;

  await c.env.MEDIA_BUCKET.put(r2Key, body, {
    httpMetadata: { contentType },
    customMetadata: { tenantId, documentId: id, title, category },
  });

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO documents
       (id, tenantId, title, category, description, r2Key, version, uploadedBy, status, tags, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).bind(id, tenantId, title, category, description ?? null, r2Key, version,
    uploadedBy, tags ?? null, now, now).run();

  return c.json({ success: true, id, r2Key }, 201);
});

dmsRouter.get('/', requireRole(['admin', 'management', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { category, status, search } = c.req.query() as Record<string, string>;
  let sql = 'SELECT id, title, category, description, version, uploadedBy, status, tags, createdAt FROM documents WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (category) { sql += ' AND category = ?'; args.push(category); }
  if (status)   { sql += ' AND status = ?';   args.push(status); }
  if (search)   { sql += ' AND title LIKE ?'; args.push(`%${search}%`); }
  sql += ' ORDER BY createdAt DESC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

dmsRouter.get('/:id', requireRole(['admin', 'management', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const doc = await c.env.DB.prepare(
    'SELECT * FROM documents WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!doc) return c.json({ error: 'Document not found' }, 404);
  return c.json({ data: doc });
});

dmsRouter.patch('/:id/archive', requireRole(['admin', 'management']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE documents SET status = 'archived', updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(now, id, tenantId).run();
  return c.json({ success: true, status: 'archived' });
});
