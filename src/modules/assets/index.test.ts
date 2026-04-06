import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { assetsRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/inst_assets', assetsRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Assets', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/inst_assets — creates asset (201)', async () => {
    const res = await ctx.req('POST', '/api/inst_assets', {
      name: 'Dell Laptop #001', category: 'IT',
      serialNumber: 'DL001', purchasePriceKobo: 250000_00,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/inst_assets — 400 when name or category missing', async () => {
    const res = await ctx.req('POST', '/api/inst_assets', { name: 'Laptop' });
    expect(res.status).toBe(400);
  });

  it('GET /api/inst_assets — lists inst_assets', async () => {
    await ctx.req('POST', '/api/inst_assets', { name: 'HP Printer', category: 'IT' });
    const res = await ctx.req('GET', '/api/inst_assets');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/inst_assets/:id — returns asset', async () => {
    const createRes = await ctx.req('POST', '/api/inst_assets', { name: 'HP Printer', category: 'IT' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/inst_assets/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('HP Printer');
  });

  it('GET /api/inst_assets/:id — 404 for unknown', async () => {
    const res = await ctx.req('GET', '/api/inst_assets/no-such-asset');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/inst_assets/:id — updates asset', async () => {
    const createRes = await ctx.req('POST', '/api/inst_assets', { name: 'Old Printer', category: 'IT' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/inst_assets/${id}`, { location: 'Lab 2', status: 'maintenance' });
    expect(res.status).toBe(200);
  });

  it('GET /api/inst_assets/:id/book-value — returns depreciated value', async () => {
    const createRes = await ctx.req('POST', '/api/inst_assets', { name: 'Server', category: 'IT', purchasePriceKobo: 500000_00, purchaseDate: '2022-01-01' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/inst_assets/${id}/book-value`);
    expect(res.status).toBe(200);
  });
});
