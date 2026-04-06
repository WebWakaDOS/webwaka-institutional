import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { visitorRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/visitors', visitorRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Visitor Management', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/visitors — checks in visitor (201)', async () => {
    const res = await ctx.req('POST', '/api/visitors', {
      visitorName: 'John Doe', phone: '08012345678',
      host: 'Prof. Adeyemi', purpose: 'Parent visit',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(typeof body.badgeCode).toBe('string');
  });

  it('POST /api/visitors — 400 when required fields missing', async () => {
    const res = await ctx.req('POST', '/api/visitors', { visitorName: 'John' });
    expect(res.status).toBe(400);
  });

  it('GET /api/visitors — lists visitors', async () => {
    await ctx.req('POST', '/api/visitors', { visitorName: 'Jane Doe', host: 'Dr. Bello', purpose: 'Meeting' });
    const res = await ctx.req('GET', '/api/visitors');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('PATCH /api/visitors/:id/checkout — checks out visitor', async () => {
    const createRes = await ctx.req('POST', '/api/visitors', { visitorName: 'Jane', host: 'Dr. A', purpose: 'Visit' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/visitors/${id}/checkout`, {});
    expect(res.status).toBe(200);
  });
});
