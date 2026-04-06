/**
 * Tests — Staff Management Module
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { staffMgmtRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/staff', staffMgmtRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

const validStaff = {
  staffId: 'STF/001', firstName: 'Ngozi', lastName: 'Adichie',
  phone: '08099887766', department: 'English', role: 'lecturer',
  grossSalaryKobo: 50000000, pensionDeductionKobo: 2500000, otherDeductionsKobo: 0,
  ndprConsent: true,
};

describe('Staff Management', () => {
  let ctx: ReturnType<typeof makeApp>;

  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/staff — creates staff and returns 201', async () => {
    const res = await ctx.req('POST', '/api/staff', validStaff);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(typeof body.id).toBe('string');
  });

  it('POST /api/staff — returns 400 when required fields missing', async () => {
    const res = await ctx.req('POST', '/api/staff', { staffId: 'X', ndprConsent: true });
    expect(res.status).toBe(400);
  });

  it('POST /api/staff — rejects missing NDPR consent', async () => {
    const res = await ctx.req('POST', '/api/staff', { ...validStaff, ndprConsent: false });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/staff — returns 409 on duplicate staffId', async () => {
    await ctx.req('POST', '/api/staff', validStaff);
    const res = await ctx.req('POST', '/api/staff', validStaff);
    expect(res.status).toBe(409);
  });

  it('GET /api/staff — returns list of staff (admin)', async () => {
    await ctx.req('POST', '/api/staff', validStaff);
    const res = await ctx.req('GET', '/api/staff');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
  });

  it('GET /api/staff/:id — returns staff member', async () => {
    const createRes = await ctx.req('POST', '/api/staff', validStaff);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/staff/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.staffId).toBe('STF/001');
  });

  it('GET /api/staff/:id — returns 404 for unknown', async () => {
    const res = await ctx.req('GET', '/api/staff/tenant-inst-123-no-such-id');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/staff/:id — updates profile fields', async () => {
    const createRes = await ctx.req('POST', '/api/staff', validStaff);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/staff/${id}`, { grossSalaryKobo: 60000000 });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('DELETE /api/staff/:id — soft deletes', async () => {
    const createRes = await ctx.req('POST', '/api/staff', validStaff);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('DELETE', `/api/staff/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });
});
