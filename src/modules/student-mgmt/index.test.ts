/**
 * Tests — Student Management Module
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { studentMgmtRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/students', studentMgmtRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

const validStudent = {
  matricNumber: 'FCA/2024/001', firstName: 'Ada', lastName: 'Lovelace',
  phone: '08012345678', programmeId: 'prog-001', level: 100,
  admissionDate: '2024-09-01', ndprConsent: true,
};

describe('Student Management', () => {
  let ctx: ReturnType<typeof makeApp>;

  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/students — creates student and returns 201', async () => {
    const res = await ctx.req('POST', '/api/students', validStudent);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(typeof body.id).toBe('string');
  });

  it('POST /api/students — returns 400 when required fields missing', async () => {
    const res = await ctx.req('POST', '/api/students', { matricNumber: 'X', ndprConsent: true });
    expect(res.status).toBe(400);
  });

  it('POST /api/students — rejects missing NDPR consent', async () => {
    const res = await ctx.req('POST', '/api/students', { ...validStudent, ndprConsent: false });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/students — returns 409 on duplicate matric number', async () => {
    await ctx.req('POST', '/api/students', validStudent);
    const res = await ctx.req('POST', '/api/students', validStudent);
    expect(res.status).toBe(409);
  });

  it('GET /api/students — returns list of students', async () => {
    await ctx.req('POST', '/api/students', validStudent);
    const res = await ctx.req('GET', '/api/students');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
  });

  it('GET /api/students — filters by status query param', async () => {
    await ctx.req('POST', '/api/students', validStudent);
    const res = await ctx.req('GET', '/api/students?status=active');
    expect(res.status).toBe(200);
  });

  it('GET /api/students/:id — returns single student', async () => {
    const createRes = await ctx.req('POST', '/api/students', validStudent);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/students/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.matricNumber).toBe('FCA/2024/001');
  });

  it('GET /api/students/:id — returns 404 for unknown id', async () => {
    const res = await ctx.req('GET', '/api/students/tenant-inst-123-nonexistent-id');
    expect(res.status).toBe(404);
  });

  it('GET /api/students/:id — student role can only view own record', async () => {
    const ctx2 = makeApp('student', 'other-student', 'tenant-inst-123');
    const createRes = await ctx.req('POST', '/api/students', validStudent);
    const { id } = await createRes.json() as any;
    const res = await ctx2.req('GET', `/api/students/${id}`);
    expect(res.status).toBe(403);
  });

  it('PATCH /api/students/:id — updates student fields', async () => {
    const createRes = await ctx.req('POST', '/api/students', validStudent);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/students/${id}`, { firstName: 'Updated' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('DELETE /api/students/:id — soft deletes (withdrawn)', async () => {
    const createRes = await ctx.req('POST', '/api/students', validStudent);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('DELETE', `/api/students/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('withdrawn');
  });
});
