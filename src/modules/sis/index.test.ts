import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { sisRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/sis', sisRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

const validGrade = {
  studentId: 'student-uuid-001', courseId: 'course-uuid-001',
  courseCode: 'CSC401', courseName: 'AI Systems', semester: 'First',
  academicYear: '2024/2025', score: 75, units: 3,
};

describe('SIS — Grades', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/sis/grades — creates grade record (201)', async () => {
    const res = await ctx.req('POST', '/api/sis/grades', validGrade);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.grade).toBe('A');
  });

  it('POST /api/sis/grades — score 65 → B', async () => {
    const res = await ctx.req('POST', '/api/sis/grades', { ...validGrade, score: 65 });
    const body = await res.json() as any;
    expect(body.grade).toBe('B');
  });

  it('POST /api/sis/grades — score 52 → C', async () => {
    const res = await ctx.req('POST', '/api/sis/grades', { ...validGrade, score: 52 });
    const body = await res.json() as any;
    expect(body.grade).toBe('C');
  });

  it('POST /api/sis/grades — score 46 → D', async () => {
    const res = await ctx.req('POST', '/api/sis/grades', { ...validGrade, score: 46 });
    const body = await res.json() as any;
    expect(body.grade).toBe('D');
  });

  it('POST /api/sis/grades — score 41 → E', async () => {
    const res = await ctx.req('POST', '/api/sis/grades', { ...validGrade, score: 41 });
    const body = await res.json() as any;
    expect(body.grade).toBe('E');
  });

  it('POST /api/sis/grades — score 30 → F', async () => {
    const res = await ctx.req('POST', '/api/sis/grades', { ...validGrade, score: 30 });
    const body = await res.json() as any;
    expect(body.grade).toBe('F');
  });

  it('POST /api/sis/grades — 400 when required fields missing', async () => {
    const res = await ctx.req('POST', '/api/sis/grades', { studentId: 'x' });
    expect(res.status).toBe(400);
  });

  // GET /grades requires studentId for admin role
  it('GET /api/sis/grades — returns 400 without studentId (admin role)', async () => {
    const res = await ctx.req('GET', '/api/sis/grades');
    expect(res.status).toBe(400);
  });

  it('GET /api/sis/grades?studentId=... — returns grades for student', async () => {
    await ctx.req('POST', '/api/sis/grades', validGrade);
    const res = await ctx.req('GET', '/api/sis/grades?studentId=student-uuid-001');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/sis/grades/:id — returns grade', async () => {
    const createRes = await ctx.req('POST', '/api/sis/grades', validGrade);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/sis/grades/${id}`);
    expect(res.status).toBe(200);
  });

  it('GET /api/sis/grades/:id — 404 for unknown', async () => {
    const res = await ctx.req('GET', '/api/sis/grades/no-such-grade');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/sis/grades/:id — updates grade', async () => {
    const createRes = await ctx.req('POST', '/api/sis/grades', validGrade);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/sis/grades/${id}`, { score: 90, remarks: 'Excellent' });
    expect(res.status).toBe(200);
  });
});

describe('SIS — Disciplinary', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  const validDisc = {
    studentId: 'student-uuid-001', incidentDate: '2024-11-01',
    description: 'Exam malpractice', severity: 'severe',
  };

  it('POST /api/sis/disciplinary — creates record (201)', async () => {
    const res = await ctx.req('POST', '/api/sis/disciplinary', validDisc);
    expect(res.status).toBe(201);
  });

  it('POST /api/sis/disciplinary — 400 when required missing', async () => {
    const res = await ctx.req('POST', '/api/sis/disciplinary', { studentId: 'x' });
    expect(res.status).toBe(400);
  });

  it('GET /api/sis/disciplinary — lists records', async () => {
    await ctx.req('POST', '/api/sis/disciplinary', validDisc);
    const res = await ctx.req('GET', '/api/sis/disciplinary');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/sis/disciplinary/:id — returns record', async () => {
    const createRes = await ctx.req('POST', '/api/sis/disciplinary', validDisc);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/sis/disciplinary/${id}`);
    expect(res.status).toBe(200);
  });

  it('PATCH /api/sis/disciplinary/:id/resolve — requires resolution field', async () => {
    const createRes = await ctx.req('POST', '/api/sis/disciplinary', validDisc);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/sis/disciplinary/${id}/resolve`, {});
    expect(res.status).toBe(400);
  });

  it('PATCH /api/sis/disciplinary/:id/resolve — resolves record', async () => {
    const createRes = await ctx.req('POST', '/api/sis/disciplinary', validDisc);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/sis/disciplinary/${id}/resolve`, { resolution: 'Suspended 1 semester' });
    expect(res.status).toBe(200);
  });
});

describe('SIS — Transcript', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('GET /api/sis/students/:studentId/transcript — returns transcript', async () => {
    await ctx.req('POST', '/api/sis/grades', validGrade);
    const res = await ctx.req('GET', '/api/sis/students/student-uuid-001/transcript');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body.data.cgpa).toBe('number');
  });

  // Student can only view their own transcript
  it('GET /api/sis/students/:studentId/transcript — student blocked from other student', async () => {
    const studentCtx = makeApp('student', 'student-user-001', 'tenant-inst-123');
    const res = await studentCtx.req('GET', '/api/sis/students/other-student-id/transcript');
    expect(res.status).toBe(403);
  });
});
