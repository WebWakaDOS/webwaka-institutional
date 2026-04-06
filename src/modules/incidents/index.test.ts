import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { incidentsRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/inst_incidents', incidentsRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Incidents', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/inst_incidents — creates incident (201)', async () => {
    const res = await ctx.req('POST', '/api/inst_incidents', {
      type: 'fire', description: 'False alarm in Block C',
      location: 'Block C', severity: 'moderate',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/inst_incidents — 400 when type and description missing', async () => {
    const res = await ctx.req('POST', '/api/inst_incidents', {});
    expect(res.status).toBe(400);
  });

  it('GET /api/inst_incidents — lists inst_incidents', async () => {
    await ctx.req('POST', '/api/inst_incidents', { type: 'security', description: 'Theft reported' });
    const res = await ctx.req('GET', '/api/inst_incidents');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/inst_incidents/:id — returns incident', async () => {
    const createRes = await ctx.req('POST', '/api/inst_incidents', { type: 'accident', description: 'Slip and fall' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/inst_incidents/${id}`);
    expect(res.status).toBe(200);
  });

  it('PATCH /api/inst_incidents/:id/resolve — resolves incident', async () => {
    const createRes = await ctx.req('POST', '/api/inst_incidents', { type: 'fire', description: 'Fire alarm' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/inst_incidents/${id}/resolve`, { resolution: 'False alarm, all clear' });
    expect(res.status).toBe(200);
  });
});
