/**
 * Learning Management System (LMS) — WebWaka Institutional Suite
 *
 * Course catalogue, materials, assignments, and student submissions.
 *
 * Invariant 2: tenantId always from JWT.
 *
 * Routes:
 *   POST  /api/lms/courses                         — Create course
 *   GET   /api/lms/courses                         — List courses
 *   GET   /api/lms/courses/:id                     — Get course
 *   PATCH /api/lms/courses/:id                     — Update course
 *
 *   POST  /api/lms/courses/:id/materials           — Upload material
 *   GET   /api/lms/courses/:id/materials           — List materials
 *
 *   POST  /api/lms/courses/:id/assignments         — Create assignment
 *   GET   /api/lms/courses/:id/assignments         — List assignments
 *   GET   /api/lms/assignments/:id                 — Get assignment
 *
 *   POST  /api/lms/assignments/:id/submit          — Student submits
 *   GET   /api/lms/assignments/:id/submissions     — List submissions (instructor)
 *   PATCH /api/lms/submissions/:id/grade           — Grade a submission
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const lmsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Courses ──────────────────────────────────────────────────────────────────

lmsRouter.post('/courses', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const instructorId = c.get('user').userId;
  const body = await c.req.json<{
    code: string; title: string; description?: string;
    units?: number; semester?: string; academicYear?: string;
  }>();
  if (!body.code || !body.title) return c.json({ error: 'code and title are required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO courses
       (id, tenantId, code, title, description, instructorId, units, semester, academicYear, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).bind(id, tenantId, body.code, body.title, body.description ?? null,
    instructorId, body.units ?? 3, body.semester ?? null, body.academicYear ?? null, now, now).run();

  return c.json({ success: true, id }, 201);
});

lmsRouter.get('/courses', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const user = c.get('user');
  let sql = 'SELECT * FROM courses WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (user.role === 'teacher') { sql += ' AND instructorId = ?'; args.push(user.userId); }
  sql += ' ORDER BY createdAt DESC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

lmsRouter.get('/courses/:id', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const course = await c.env.DB.prepare(
    'SELECT * FROM courses WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!course) return c.json({ error: 'Course not found' }, 404);
  return c.json({ data: course });
});

lmsRouter.patch('/courses/:id', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ title?: string; description?: string; status?: string }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE courses SET title = COALESCE(?, title), description = COALESCE(?, description),
       status = COALESCE(?, status), updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(body.title ?? null, body.description ?? null, body.status ?? null, now, id, tenantId).run();
  return c.json({ success: true });
});

// ─── Course Materials ─────────────────────────────────────────────────────────

lmsRouter.post('/courses/:id/materials', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const uploadedBy = c.get('user').userId;
  const courseId = c.req.param('id');
  const body = await c.req.json<{
    title: string; type: string; url?: string; r2Key?: string;
  }>();
  if (!body.title || !body.type) return c.json({ error: 'title and type are required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO courseMaterials (id, tenantId, courseId, title, type, r2Key, url, uploadedBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, courseId, body.title, body.type,
    body.r2Key ?? null, body.url ?? null, uploadedBy, now).run();

  return c.json({ success: true, id }, 201);
});

lmsRouter.get('/courses/:id/materials', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const courseId = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM courseMaterials WHERE tenantId = ? AND courseId = ? ORDER BY createdAt DESC'
  ).bind(tenantId, courseId).all();
  return c.json({ data: results });
});

// ─── Assignments ──────────────────────────────────────────────────────────────

lmsRouter.post('/courses/:id/assignments', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const createdBy = c.get('user').userId;
  const courseId = c.req.param('id');
  const body = await c.req.json<{
    title: string; description?: string; dueDate: string; maxPoints?: number;
  }>();
  if (!body.title || !body.dueDate) return c.json({ error: 'title and dueDate are required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO assignments (id, tenantId, courseId, title, description, dueDate, maxPoints, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, courseId, body.title, body.description ?? null,
    body.dueDate, body.maxPoints ?? 100, createdBy, now, now).run();

  return c.json({ success: true, id }, 201);
});

lmsRouter.get('/courses/:id/assignments', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const courseId = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM assignments WHERE tenantId = ? AND courseId = ? ORDER BY dueDate ASC'
  ).bind(tenantId, courseId).all();
  return c.json({ data: results });
});

lmsRouter.get('/assignments/:id', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const assignment = await c.env.DB.prepare(
    'SELECT * FROM assignments WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!assignment) return c.json({ error: 'Assignment not found' }, 404);
  return c.json({ data: assignment });
});

// ─── Submissions ──────────────────────────────────────────────────────────────

lmsRouter.post('/assignments/:id/submit', requireRole(['student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const studentId = c.get('user').userId;
  const assignmentId = c.req.param('id');
  const body = await c.req.json<{ content?: string; r2Key?: string }>();

  if (!body.content && !body.r2Key) {
    return c.json({ error: 'content or r2Key is required' }, 400);
  }

  // Prevent duplicate submissions
  const existing = await c.env.DB.prepare(
    'SELECT id FROM submissions WHERE assignmentId = ? AND studentId = ? AND tenantId = ?'
  ).bind(assignmentId, studentId, tenantId).first();
  if (existing) return c.json({ error: 'Already submitted for this assignment' }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO submissions
       (id, tenantId, assignmentId, studentId, content, r2Key, submittedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, assignmentId, studentId,
    body.content ?? null, body.r2Key ?? null, now, now).run();

  return c.json({ success: true, id, submittedAt: now }, 201);
});

lmsRouter.get('/assignments/:id/submissions', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const assignmentId = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM submissions WHERE tenantId = ? AND assignmentId = ? ORDER BY submittedAt ASC'
  ).bind(tenantId, assignmentId).all();
  return c.json({ data: results });
});

lmsRouter.patch('/submissions/:id/grade', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const gradedBy = c.get('user').userId;
  const id = c.req.param('id');
  const body = await c.req.json<{ grade: number; feedback?: string }>();
  if (body.grade === undefined) return c.json({ error: 'grade is required' }, 400);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE submissions SET grade = ?, feedback = COALESCE(?, feedback), gradedBy = ?, gradedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.grade, body.feedback ?? null, gradedBy, now, id, tenantId).run();

  return c.json({ success: true, grade: body.grade });
});
