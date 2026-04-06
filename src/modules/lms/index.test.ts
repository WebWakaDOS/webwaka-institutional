/**
 * Tests — Learning Management System (LMS)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { lmsRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/lms', lmsRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('LMS — Courses', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/lms/inst_courses — creates course (201)', async () => {
    const res = await ctx.req('POST', '/api/lms/inst_courses', { code: 'CSC401', title: 'AI Systems' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/lms/inst_courses — returns 400 when required fields missing', async () => {
    const res = await ctx.req('POST', '/api/lms/inst_courses', {});
    expect(res.status).toBe(400);
  });

  it('GET /api/lms/inst_courses — lists inst_courses', async () => {
    await ctx.req('POST', '/api/lms/inst_courses', { code: 'CSC401', title: 'AI' });
    const res = await ctx.req('GET', '/api/lms/inst_courses');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/lms/inst_courses/:id — returns course', async () => {
    const createRes = await ctx.req('POST', '/api/lms/inst_courses', { code: 'CSC401', title: 'AI' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/lms/inst_courses/${id}`);
    expect(res.status).toBe(200);
  });

  it('GET /api/lms/inst_courses/:id — 404 for unknown', async () => {
    const res = await ctx.req('GET', '/api/lms/inst_courses/tenant-inst-123-no-course');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/lms/inst_courses/:id — updates course', async () => {
    const createRes = await ctx.req('POST', '/api/lms/inst_courses', { code: 'CSC401', title: 'AI' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/lms/inst_courses/${id}`, { title: 'Updated AI' });
    expect(res.status).toBe(200);
  });
});

describe('LMS — Assignments and Submissions', () => {
  let ctx: ReturnType<typeof makeApp>;
  let courseId: string;

  beforeEach(async () => {
    ctx = makeApp();
    const r = await ctx.req('POST', '/api/lms/inst_courses', { code: 'CSC401', title: 'AI' });
    courseId = ((await r.json()) as any).id;
  });

  it('POST /api/lms/inst_courses/:id/inst_assignments — creates assignment', async () => {
    const res = await ctx.req('POST', `/api/lms/inst_courses/${courseId}/inst_assignments`, {
      title: 'Assignment 1', dueDate: '2025-01-31', maxPoints: 100,
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/lms/inst_courses/:id/inst_assignments — 400 when required missing', async () => {
    const res = await ctx.req('POST', `/api/lms/inst_courses/${courseId}/inst_assignments`, { title: 'x' });
    expect(res.status).toBe(400);
  });

  it('GET /api/lms/inst_courses/:id/inst_assignments — lists inst_assignments', async () => {
    await ctx.req('POST', `/api/lms/inst_courses/${courseId}/inst_assignments`, { title: 'Asgn1', dueDate: '2025-01-31', maxPoints: 100 });
    const res = await ctx.req('GET', `/api/lms/inst_courses/${courseId}/inst_assignments`);
    expect(res.status).toBe(200);
  });

  it('POST /api/lms/inst_assignments/:id/submit — student submits', async () => {
    const asgRes = await ctx.req('POST', `/api/lms/inst_courses/${courseId}/inst_assignments`, { title: 'Asgn1', dueDate: '2025-01-31', maxPoints: 100 });
    const { id: asgId } = await asgRes.json() as any;
    const subCtx = makeApp('student', 'student-001', 'tenant-inst-123');
    const res = await subCtx.req('POST', `/api/lms/inst_assignments/${asgId}/submit`, { content: 'My answer here' });
    expect(res.status).toBe(201);
  });

  it('GET /api/lms/inst_assignments/:id/inst_submissions — lists inst_submissions', async () => {
    const asgRes = await ctx.req('POST', `/api/lms/inst_courses/${courseId}/inst_assignments`, { title: 'Asgn1', dueDate: '2025-01-31', maxPoints: 100 });
    const { id: asgId } = await asgRes.json() as any;
    const res = await ctx.req('GET', `/api/lms/inst_assignments/${asgId}/inst_submissions`);
    expect(res.status).toBe(200);
  });
});
