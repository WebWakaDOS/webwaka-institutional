/**
 * Learning Management System (LMS) — WebWaka Institutional Suite
 *
 * Course catalogue, materials, inst_assignments, and student inst_submissions.
 *
 * Invariant 2: tenantId always from JWT.
 *
 * Routes:
 *   POST  /api/lms/inst_courses                         — Create course
 *   GET   /api/lms/inst_courses                         — List inst_courses
 *   GET   /api/lms/inst_courses/:id                     — Get course
 *   PATCH /api/lms/inst_courses/:id                     — Update course
 *
 *   POST  /api/lms/inst_courses/:id/materials           — Upload material
 *   GET   /api/lms/inst_courses/:id/materials           — List materials
 *
 *   POST  /api/lms/inst_courses/:id/inst_assignments         — Create assignment
 *   GET   /api/lms/inst_courses/:id/inst_assignments         — List inst_assignments
 *   GET   /api/lms/inst_assignments/:id                 — Get assignment
 *
 *   POST  /api/lms/inst_assignments/:id/submit          — Student submits
 *   GET   /api/lms/inst_assignments/:id/inst_submissions     — List inst_submissions (instructor)
 *   PATCH /api/lms/inst_submissions/:id/grade           — Grade a submission
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const lmsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Courses ──────────────────────────────────────────────────────────────────

lmsRouter.post('/inst_courses', requireRole(['admin', 'teacher']), async (c) => {
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
    `INSERT INTO inst_courses
       (id, tenantId, code, title, description, instructorId, units, semester, academicYear, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).bind(id, tenantId, body.code, body.title, body.description ?? null,
    instructorId, body.units ?? 3, body.semester ?? null, body.academicYear ?? null, now, now).run();

  return c.json({ success: true, id }, 201);
});

lmsRouter.get('/inst_courses', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const user = c.get('user');
  let sql = 'SELECT * FROM inst_courses WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (user.role === 'teacher') { sql += ' AND instructorId = ?'; args.push(user.userId); }
  sql += ' ORDER BY createdAt DESC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

lmsRouter.get('/inst_courses/:id', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const course = await c.env.DB.prepare(
    'SELECT * FROM inst_courses WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!course) return c.json({ error: 'Course not found' }, 404);
  return c.json({ data: course });
});

lmsRouter.patch('/inst_courses/:id', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ title?: string; description?: string; status?: string }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE inst_courses SET title = COALESCE(?, title), description = COALESCE(?, description),
       status = COALESCE(?, status), updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(body.title ?? null, body.description ?? null, body.status ?? null, now, id, tenantId).run();
  return c.json({ success: true });
});

// ─── Course Materials ─────────────────────────────────────────────────────────

lmsRouter.post('/inst_courses/:id/materials', requireRole(['admin', 'teacher']), async (c) => {
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
    `INSERT INTO inst_courseMaterials (id, tenantId, courseId, title, type, r2Key, url, uploadedBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, courseId, body.title, body.type,
    body.r2Key ?? null, body.url ?? null, uploadedBy, now).run();

  return c.json({ success: true, id }, 201);
});

lmsRouter.get('/inst_courses/:id/materials', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const courseId = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM inst_courseMaterials WHERE tenantId = ? AND courseId = ? ORDER BY createdAt DESC'
  ).bind(tenantId, courseId).all();
  return c.json({ data: results });
});

// ─── Assignments ──────────────────────────────────────────────────────────────

lmsRouter.post('/inst_courses/:id/inst_assignments', requireRole(['admin', 'teacher']), async (c) => {
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
    `INSERT INTO inst_assignments (id, tenantId, courseId, title, description, dueDate, maxPoints, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, courseId, body.title, body.description ?? null,
    body.dueDate, body.maxPoints ?? 100, createdBy, now, now).run();

  return c.json({ success: true, id }, 201);
});

lmsRouter.get('/inst_courses/:id/inst_assignments', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const courseId = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM inst_assignments WHERE tenantId = ? AND courseId = ? ORDER BY dueDate ASC'
  ).bind(tenantId, courseId).all();
  return c.json({ data: results });
});

lmsRouter.get('/inst_assignments/:id', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const assignment = await c.env.DB.prepare(
    'SELECT * FROM inst_assignments WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!assignment) return c.json({ error: 'Assignment not found' }, 404);
  return c.json({ data: assignment });
});

// ─── Submissions ──────────────────────────────────────────────────────────────

lmsRouter.post('/inst_assignments/:id/submit', requireRole(['student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const studentId = c.get('user').userId;
  const assignmentId = c.req.param('id');
  const body = await c.req.json<{ content?: string; r2Key?: string }>();

  if (!body.content && !body.r2Key) {
    return c.json({ error: 'content or r2Key is required' }, 400);
  }

  // Prevent duplicate inst_submissions
  const existing = await c.env.DB.prepare(
    'SELECT id FROM inst_submissions WHERE assignmentId = ? AND studentId = ? AND tenantId = ?'
  ).bind(assignmentId, studentId, tenantId).first();
  if (existing) return c.json({ error: 'Already submitted for this assignment' }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO inst_submissions
       (id, tenantId, assignmentId, studentId, content, r2Key, submittedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, assignmentId, studentId,
    body.content ?? null, body.r2Key ?? null, now, now).run();

  return c.json({ success: true, id, submittedAt: now }, 201);
});

lmsRouter.get('/inst_assignments/:id/inst_submissions', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const assignmentId = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM inst_submissions WHERE tenantId = ? AND assignmentId = ? ORDER BY submittedAt ASC'
  ).bind(tenantId, assignmentId).all();
  return c.json({ data: results });
});

lmsRouter.patch('/inst_submissions/:id/grade', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const gradedBy = c.get('user').userId;
  const id = c.req.param('id');
  const body = await c.req.json<{ grade: number; feedback?: string }>();
  if (body.grade === undefined) return c.json({ error: 'grade is required' }, 400);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE inst_submissions SET grade = ?, feedback = COALESCE(?, feedback), gradedBy = ?, gradedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.grade, body.feedback ?? null, gradedBy, now, id, tenantId).run();

  return c.json({ success: true, grade: body.grade });
});
