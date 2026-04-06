import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { cafeteriaRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/cafeteria', cafeteriaRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Cafeteria Meal Plans', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/cafeteria/plans — creates meal plan (201)', async () => {
    const res = await ctx.req('POST', '/api/cafeteria/plans', {
      studentId: 'student-001', academicYear: '2024/2025',
      plan: 'full', initialBalanceKobo: 50000_00,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/cafeteria/plans — 400 when required missing', async () => {
    const res = await ctx.req('POST', '/api/cafeteria/plans', { studentId: 'student-001' });
    expect(res.status).toBe(400);
  });

  it('POST /api/cafeteria/plans — 409 on duplicate plan for same year', async () => {
    await ctx.req('POST', '/api/cafeteria/plans', { studentId: 'student-001', academicYear: '2024/2025' });
    const res = await ctx.req('POST', '/api/cafeteria/plans', { studentId: 'student-001', academicYear: '2024/2025' });
    expect(res.status).toBe(409);
  });

  it('GET /api/cafeteria/plans — lists meal plans', async () => {
    await ctx.req('POST', '/api/cafeteria/plans', { studentId: 'student-001', academicYear: '2024/2025' });
    const res = await ctx.req('GET', '/api/cafeteria/plans');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/cafeteria/plans/:id — returns plan', async () => {
    const createRes = await ctx.req('POST', '/api/cafeteria/plans', { studentId: 'student-001', academicYear: '2024/2025' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/cafeteria/plans/${id}`);
    expect(res.status).toBe(200);
  });

  it('PATCH /api/cafeteria/plans/:id/topup — tops up balance', async () => {
    const createRes = await ctx.req('POST', '/api/cafeteria/plans', { studentId: 'student-001', academicYear: '2024/2025', initialBalanceKobo: 10000_00 });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/cafeteria/plans/${id}/topup`, { amountKobo: 5000_00 });
    expect(res.status).toBe(200);
  });
});

describe('Cafeteria Transactions', () => {
  let ctx: ReturnType<typeof makeApp>;
  let planId: string;

  beforeEach(async () => {
    ctx = makeApp();
    const r = await ctx.req('POST', '/api/cafeteria/plans', {
      studentId: 'student-txn-001', academicYear: '2024/2025', initialBalanceKobo: 20000,
    });
    planId = ((await r.json()) as any).id;
    // Ensure balanceKobo is in the stub row
    const row = ctx.db._rows.find((rr: any) => rr.id === planId);
    if (row) row['balanceKobo'] = 20000;
  });

  it('POST /api/cafeteria/plans/:id/transact — deducts balance (201)', async () => {
    const res = await ctx.req('POST', `/api/cafeteria/plans/${planId}/transact`, {
      item: 'Rice and chicken', amountKobo: 5000,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.remainingBalanceKobo).toBe(15000);
  });

  it('POST /api/cafeteria/plans/:id/transact — 402 on insufficient balance', async () => {
    const res = await ctx.req('POST', `/api/cafeteria/plans/${planId}/transact`, {
      item: 'Premium meal', amountKobo: 50000,
    });
    expect(res.status).toBe(402);
  });

  it('POST /api/cafeteria/plans/:id/transact — 400 when required missing', async () => {
    const res = await ctx.req('POST', `/api/cafeteria/plans/${planId}/transact`, { item: 'Rice' });
    expect(res.status).toBe(400);
  });

  it('POST /api/cafeteria/plans/:id/transact — 404 for unknown plan', async () => {
    const res = await ctx.req('POST', '/api/cafeteria/plans/no-such-plan/transact', {
      item: 'Meal', amountKobo: 100,
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /api/cafeteria/plans/:id/topup — 400 for invalid amount', async () => {
    const res = await ctx.req('PATCH', `/api/cafeteria/plans/${planId}/topup`, { amountKobo: 0 });
    expect(res.status).toBe(400);
  });
});
