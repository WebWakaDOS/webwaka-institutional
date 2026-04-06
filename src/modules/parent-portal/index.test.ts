import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { parentPortalRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/parents', parentPortalRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Parent Portal — Links', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/parents/links — creates link (201)', async () => {
    const res = await ctx.req('POST', '/api/parents/links', {
      parentUserId: 'parent-user-001', studentId: 'student-001', relationship: 'father',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/parents/links — 400 when required missing', async () => {
    const res = await ctx.req('POST', '/api/parents/links', { parentUserId: 'x' });
    expect(res.status).toBe(400);
  });

  it('POST /api/parents/links — 409 on duplicate link', async () => {
    await ctx.req('POST', '/api/parents/links', { parentUserId: 'parent-user-002', studentId: 'student-002' });
    const res = await ctx.req('POST', '/api/parents/links', { parentUserId: 'parent-user-002', studentId: 'student-002' });
    expect(res.status).toBe(409);
  });

  it('GET /api/parents/links — lists links', async () => {
    await ctx.req('POST', '/api/parents/links', { parentUserId: 'parent-user-001', studentId: 'student-001' });
    const res = await ctx.req('GET', '/api/parents/links');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/parents/links?parentUserId — filters by parent', async () => {
    await ctx.req('POST', '/api/parents/links', { parentUserId: 'parent-user-001', studentId: 'student-003' });
    const res = await ctx.req('GET', '/api/parents/links?parentUserId=parent-user-001');
    expect(res.status).toBe(200);
  });

  it('GET /api/parents/links?studentId — filters by student', async () => {
    await ctx.req('POST', '/api/parents/links', { parentUserId: 'parent-user-001', studentId: 'student-004' });
    const res = await ctx.req('GET', '/api/parents/links?studentId=student-004');
    expect(res.status).toBe(200);
  });
});

describe('Parent Portal — Dashboard', () => {
  it('GET /api/parents/dashboard — returns empty when no links', async () => {
    const db = makeD1Stub();
    const app = new Hono<any>();
    const env = makeEnv(db);
    app.use('*', async (c, next) => {
      c.set('user', { userId: 'parent-user-100', tenantId: 'tenant-inst-123', role: 'parent', permissions: [] });
      await next();
    });
    app.route('/api/parents', parentPortalRouter);
    const res = await app.fetch(new Request('http://localhost/api/parents/dashboard', {
      headers: { Authorization: 'Bearer mock' },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.students).toHaveLength(0);
  });

  it('GET /api/parents/dashboard — returns linked student data', async () => {
    const db = makeD1Stub();
    const env = makeEnv(db);
    const app = new Hono<any>();
    const parentUserId = 'parent-user-200';
    const tenantId = 'tenant-inst-123';
    app.use('*', async (c, next) => {
      c.set('user', { userId: parentUserId, tenantId, role: 'parent', permissions: [] });
      await next();
    });
    app.route('/api/parents', parentPortalRouter);

    // Seed: parent link with status 'active'
    db._rows.push({
      id: 'link-001', tenantId, parentUserId, studentId: 'student-dash-001',
      relationship: 'mother', status: 'active',
    });

    const res = await app.fetch(new Request('http://localhost/api/parents/dashboard', {
      headers: { Authorization: 'Bearer mock' },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data.students)).toBe(true);
    expect(body.data.students.length).toBe(1);
  });
});
