import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { procurementRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/procurement', procurementRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Procurement — Vendors', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/procurement/inst_vendors — creates vendor (201)', async () => {
    const res = await ctx.req('POST', '/api/procurement/inst_vendors', { name: 'Tech Supplies Ltd', category: 'IT' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/procurement/inst_vendors — 400 when name missing', async () => {
    const res = await ctx.req('POST', '/api/procurement/inst_vendors', {});
    expect(res.status).toBe(400);
  });

  it('GET /api/procurement/inst_vendors — lists inst_vendors', async () => {
    await ctx.req('POST', '/api/procurement/inst_vendors', { name: 'Tech Supplies' });
    const res = await ctx.req('GET', '/api/procurement/inst_vendors');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/procurement/inst_vendors/:id — returns vendor', async () => {
    const createRes = await ctx.req('POST', '/api/procurement/inst_vendors', { name: 'Office Depot' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/procurement/inst_vendors/${id}`);
    expect(res.status).toBe(200);
  });

  it('PATCH /api/procurement/inst_vendors/:id — updates vendor', async () => {
    const createRes = await ctx.req('POST', '/api/procurement/inst_vendors', { name: 'Old Vendor' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/procurement/inst_vendors/${id}`, { status: 'inactive' });
    expect(res.status).toBe(200);
  });
});

describe('Procurement — Requisitions', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  const validPR = {
    title: 'Laptops for Lab',
    items: [{ description: '15" Laptop', qty: 10, unitPriceKobo: 50000000 }],
  };

  it('POST /api/procurement/requisitions — creates PR (201)', async () => {
    const res = await ctx.req('POST', '/api/procurement/requisitions', validPR);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.totalKobo).toBe(500000000);
  });

  it('POST /api/procurement/requisitions — 400 when items empty', async () => {
    const res = await ctx.req('POST', '/api/procurement/requisitions', { title: 'Test', items: [] });
    expect(res.status).toBe(400);
  });

  it('POST /api/procurement/requisitions — 400 when required missing', async () => {
    const res = await ctx.req('POST', '/api/procurement/requisitions', { title: 'No items' });
    expect(res.status).toBe(400);
  });

  it('GET /api/procurement/requisitions — lists PRs', async () => {
    await ctx.req('POST', '/api/procurement/requisitions', validPR);
    const res = await ctx.req('GET', '/api/procurement/requisitions');
    expect(res.status).toBe(200);
  });

  it('GET /api/procurement/requisitions/:id — returns PR', async () => {
    const createRes = await ctx.req('POST', '/api/procurement/requisitions', validPR);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/procurement/requisitions/${id}`);
    expect(res.status).toBe(200);
  });

  it('PATCH /api/procurement/requisitions/:id/approve — approves PR', async () => {
    const createRes = await ctx.req('POST', '/api/procurement/requisitions', validPR);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/procurement/requisitions/${id}/approve`, { notes: 'Approved' });
    expect(res.status).toBe(200);
  });

  it('PATCH /api/procurement/requisitions/:id/reject — rejects PR', async () => {
    const createRes = await ctx.req('POST', '/api/procurement/requisitions', validPR);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/procurement/requisitions/${id}/reject`, { notes: 'Over budget' });
    expect(res.status).toBe(200);
  });
});
