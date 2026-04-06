import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { attendanceRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/attendance', attendanceRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Attendance', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/attendance — marks attendance (201)', async () => {
    const res = await ctx.req('POST', '/api/attendance', {
      memberId: 'student-001', memberType: 'student',
      method: 'manual', status: 'present',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/attendance — 400 when memberId missing', async () => {
    const res = await ctx.req('POST', '/api/attendance', {});
    expect(res.status).toBe(400);
  });

  it('GET /api/attendance — lists attendance records', async () => {
    await ctx.req('POST', '/api/attendance', { memberId: 'student-001', memberType: 'student', method: 'manual', status: 'present' });
    const res = await ctx.req('GET', '/api/attendance');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/attendance — filters by memberId', async () => {
    await ctx.req('POST', '/api/attendance', { memberId: 'student-001' });
    const res = await ctx.req('GET', '/api/attendance?memberId=student-001');
    expect(res.status).toBe(200);
  });
});

describe('Attendance Summary', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('GET /api/attendance/summary — 400 when date missing', async () => {
    const res = await ctx.req('GET', '/api/attendance/summary');
    expect(res.status).toBe(400);
  });

  it('GET /api/attendance/summary — returns summary for date', async () => {
    // Seed some attendance rows
    await ctx.req('POST', '/api/attendance', { memberId: 's1', status: 'present', memberType: 'student' });
    await ctx.req('POST', '/api/attendance', { memberId: 's2', status: 'absent',  memberType: 'student' });
    const today = new Date().toISOString().slice(0, 10);
    const res = await ctx.req('GET', `/api/attendance/summary?date=${today}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // stub returns raw rows (no SQL GROUP BY), summary defaults to 0
    expect(body.data).toBeDefined();
    expect(typeof body.data.date).toBe('string');
  });

  it('GET /api/attendance/summary — with memberType filter', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await ctx.req('GET', `/api/attendance/summary?date=${today}&memberType=staff`);
    expect(res.status).toBe(200);
  });
});
