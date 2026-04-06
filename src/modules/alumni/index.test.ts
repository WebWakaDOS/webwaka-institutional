import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { alumniRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/alumni', alumniRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Alumni', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/alumni — creates alumni record (201)', async () => {
    const res = await ctx.req('POST', '/api/alumni', {
      firstName: 'Ada', lastName: 'Lovelace', graduationYear: '2024',
      programme: 'Computer Science',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/alumni — 400 when required fields missing', async () => {
    const res = await ctx.req('POST', '/api/alumni', { firstName: 'Ada' });
    expect(res.status).toBe(400);
  });

  it('GET /api/alumni — lists alumni', async () => {
    await ctx.req('POST', '/api/alumni', { firstName: 'Ada', lastName: 'Lovelace', graduationYear: '2024' });
    const res = await ctx.req('GET', '/api/alumni');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/alumni — filters by graduationYear', async () => {
    await ctx.req('POST', '/api/alumni', { firstName: 'Chidi', lastName: 'Okeke', graduationYear: '2023' });
    const res = await ctx.req('GET', '/api/alumni?graduationYear=2023');
    expect(res.status).toBe(200);
  });

  it('POST /api/alumni/campaigns — creates campaign (201)', async () => {
    const res = await ctx.req('POST', '/api/alumni/campaigns', {
      title: 'Library Fund 2025', targetKobo: 5000000_00, startDate: '2025-01-01',
    });
    expect(res.status).toBe(201);
  });

  it('GET /api/alumni/campaigns — lists campaigns', async () => {
    await ctx.req('POST', '/api/alumni/campaigns', { title: 'Fund A', targetKobo: 1000000, startDate: '2025-01-01' });
    const res = await ctx.req('GET', '/api/alumni/campaigns');
    expect(res.status).toBe(200);
  });
});
