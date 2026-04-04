/**
 * Student Information System (SIS) — WebWaka Institutional Suite
 *
 * Tracks grades, GPA, transcripts, and disciplinary records.
 *
 * Invariant 2: tenantId always from JWT.
 *
 * Routes:
 *   POST  /api/sis/grades                  — Record a grade
 *   GET   /api/sis/grades                  — List grades (filtered by student/year)
 *   GET   /api/sis/grades/:id              — Get grade
 *   PATCH /api/sis/grades/:id              — Update grade
 *
 *   GET   /api/sis/students/:studentId/transcript — Compute & return GPA transcript
 *
 *   POST  /api/sis/disciplinary            — Record disciplinary incident
 *   GET   /api/sis/disciplinary            — List disciplinary records
 *   GET   /api/sis/disciplinary/:id        — Get record
 *   PATCH /api/sis/disciplinary/:id/resolve — Mark resolved
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const sisRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// Grade letter → grade points mapping (Nigerian 5-point scale)
const GRADE_POINTS: Record<string, number> = {
  'A': 5.0, 'B': 4.0, 'C': 3.0, 'D': 2.0, 'E': 1.0, 'F': 0.0,
};

// ─── Grades ──────────────────────────────────────────────────────────────────

sisRouter.post('/grades', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const recordedBy = c.get('user').userId;
  const body = await c.req.json<{
    studentId: string; courseId: string; courseCode: string; courseName: string;
    semester: string; academicYear: string; score: number; units?: number; remarks?: string;
  }>();

  if (!body.studentId || !body.courseId || !body.courseCode || !body.courseName ||
      !body.semester || !body.academicYear || body.score === undefined) {
    return c.json({ error: 'studentId, courseId, courseCode, courseName, semester, academicYear, score are required' }, 400);
  }

  // Derive grade letter from score
  let grade = 'F';
  if (body.score >= 70) grade = 'A';
  else if (body.score >= 60) grade = 'B';
  else if (body.score >= 50) grade = 'C';
  else if (body.score >= 45) grade = 'D';
  else if (body.score >= 40) grade = 'E';

  const gradePoints = GRADE_POINTS[grade] ?? 0;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO gradeRecords
       (id, tenantId, studentId, courseId, courseCode, courseName, semester, academicYear,
        score, grade, gradePoints, units, remarks, recordedBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.studentId, body.courseId, body.courseCode, body.courseName,
    body.semester, body.academicYear, body.score, grade, gradePoints,
    body.units ?? 3, body.remarks ?? null, recordedBy, now, now).run();

  return c.json({ success: true, id, grade, gradePoints }, 201);
});

sisRouter.get('/grades', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const user = c.get('user');
  const { studentId, academicYear, semester } = c.req.query() as Record<string, string>;

  const effectiveStudentId = user.role === 'student' ? user.userId : studentId;
  if (!effectiveStudentId) {
    return c.json({ error: 'studentId query param is required for this role' }, 400);
  }

  let sql = 'SELECT * FROM gradeRecords WHERE tenantId = ? AND studentId = ?';
  const args: unknown[] = [tenantId, effectiveStudentId];
  if (academicYear) { sql += ' AND academicYear = ?'; args.push(academicYear); }
  if (semester) { sql += ' AND semester = ?'; args.push(semester); }
  sql += ' ORDER BY academicYear DESC, semester DESC';

  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

sisRouter.get('/grades/:id', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const record = await c.env.DB.prepare(
    'SELECT * FROM gradeRecords WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!record) return c.json({ error: 'Grade record not found' }, 404);
  return c.json({ data: record });
});

sisRouter.patch('/grades/:id', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ score?: number; remarks?: string }>();
  const now = new Date().toISOString();

  let grade: string | undefined;
  let gradePoints: number | undefined;

  if (body.score !== undefined) {
    if (body.score >= 70) grade = 'A';
    else if (body.score >= 60) grade = 'B';
    else if (body.score >= 50) grade = 'C';
    else if (body.score >= 45) grade = 'D';
    else if (body.score >= 40) grade = 'E';
    else grade = 'F';
    gradePoints = GRADE_POINTS[grade] ?? 0;
  }

  await c.env.DB.prepare(
    `UPDATE gradeRecords
     SET score = COALESCE(?, score), grade = COALESCE(?, grade),
         gradePoints = COALESCE(?, gradePoints), remarks = COALESCE(?, remarks), updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.score ?? null, grade ?? null, gradePoints ?? null,
    body.remarks ?? null, now, id, tenantId).run();

  return c.json({ success: true });
});

// ─── Transcript (GPA calculation) ────────────────────────────────────────────

sisRouter.get('/students/:studentId/transcript', requireRole(['admin', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const user = c.get('user');
  const studentId = c.req.param('studentId');

  // Students may only fetch their own transcript
  if (user.role === 'student' && studentId !== user.userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const { results: records } = await c.env.DB.prepare(
    'SELECT * FROM gradeRecords WHERE tenantId = ? AND studentId = ? ORDER BY academicYear, semester'
  ).bind(tenantId, studentId).all<{
    academicYear: string; semester: string; courseCode: string; courseName: string;
    units: number; score: number; grade: string; gradePoints: number;
  }>();

  // Compute cumulative GPA
  let totalPoints = 0;
  let totalUnits = 0;
  for (const r of records) {
    totalPoints += (r.gradePoints ?? 0) * (r.units ?? 3);
    totalUnits += r.units ?? 3;
  }
  const cgpa = totalUnits > 0 ? Math.round((totalPoints / totalUnits) * 100) / 100 : 0;

  // Group by academic year for semester breakdown
  const byYear: Record<string, typeof records> = {};
  for (const r of records) {
    const key = `${r.academicYear} — ${r.semester}`;
    if (!byYear[key]) byYear[key] = [];
    byYear[key].push(r);
  }

  return c.json({
    data: {
      studentId,
      cgpa,
      classification: cgpa >= 4.5 ? 'First Class' : cgpa >= 3.5 ? 'Second Class Upper' :
        cgpa >= 2.5 ? 'Second Class Lower' : cgpa >= 1.5 ? 'Third Class' : 'Pass',
      totalUnitsEarned: totalUnits,
      semesters: byYear,
    },
  });
});

// ─── Disciplinary Records ─────────────────────────────────────────────────────

sisRouter.post('/disciplinary', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    studentId: string; incidentDate: string; description: string;
    severity?: string; action?: string;
  }>();

  if (!body.studentId || !body.incidentDate || !body.description) {
    return c.json({ error: 'studentId, incidentDate, description are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO disciplinaryRecords
       (id, tenantId, studentId, incidentDate, description, severity, action, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.studentId, body.incidentDate, body.description,
    body.severity ?? 'minor', body.action ?? null, now).run();

  return c.json({ success: true, id }, 201);
});

sisRouter.get('/disciplinary', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { studentId } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM disciplinaryRecords WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (studentId) { sql += ' AND studentId = ?'; args.push(studentId); }
  sql += ' ORDER BY incidentDate DESC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

sisRouter.get('/disciplinary/:id', requireRole(['admin', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const record = await c.env.DB.prepare(
    'SELECT * FROM disciplinaryRecords WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!record) return c.json({ error: 'Disciplinary record not found' }, 404);
  return c.json({ data: record });
});

sisRouter.patch('/disciplinary/:id/resolve', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const resolvedBy = c.get('user').userId;
  const id = c.req.param('id');
  const body = await c.req.json<{ resolution: string }>();
  if (!body.resolution) return c.json({ error: 'resolution is required' }, 400);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE disciplinaryRecords SET action = ?, resolvedAt = ?, resolvedBy = ? WHERE id = ? AND tenantId = ?`
  ).bind(body.resolution, now, resolvedBy, id, tenantId).run();

  return c.json({ success: true, resolvedAt: now });
});
