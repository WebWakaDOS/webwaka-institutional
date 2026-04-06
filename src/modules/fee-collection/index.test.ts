import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { feeCollectionRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/fees', feeCollectionRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

// NGN 250,000 = 25,000,000 kobo
const AMOUNT = 25000000;
const PARTIAL = 10000000;

const validFee = {
  studentId: 'student-uuid-001', feeType: 'tuition',
  amountKobo: AMOUNT, academicYear: '2024/2025',
  semester: 'First', dueDate: '2024-10-01',
};

describe('Fee Collection', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/fees — creates fee record (201)', async () => {
    const res = await ctx.req('POST', '/api/fees', validFee);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.balanceKobo).toBe(AMOUNT);
  });

  it('POST /api/fees — 400 when required missing', async () => {
    const res = await ctx.req('POST', '/api/fees', { studentId: 'x' });
    expect(res.status).toBe(400);
  });

  it('POST /api/fees — 400 for non-integer amountKobo', async () => {
    const res = await ctx.req('POST', '/api/fees', { ...validFee, amountKobo: 1000.50 });
    expect(res.status).toBe(400);
  });

  it('POST /api/fees — 400 for zero amountKobo', async () => {
    const res = await ctx.req('POST', '/api/fees', { ...validFee, amountKobo: 0 });
    expect(res.status).toBe(400);
  });

  it('GET /api/fees — lists fee records', async () => {
    await ctx.req('POST', '/api/fees', validFee);
    const res = await ctx.req('GET', '/api/fees');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
  });

  it('GET /api/fees?studentId — filters records', async () => {
    await ctx.req('POST', '/api/fees', validFee);
    const res = await ctx.req('GET', '/api/fees?studentId=student-uuid-001');
    expect(res.status).toBe(200);
  });

  it('GET /api/fees/:id — returns fee record', async () => {
    const createRes = await ctx.req('POST', '/api/fees', validFee);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/fees/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.feeType).toBe('tuition');
  });

  it('GET /api/fees/:id — 404 for unknown', async () => {
    const res = await ctx.req('GET', '/api/fees/no-such-fee');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/fees/:id/pay — records partial payment', async () => {
    const createRes = await ctx.req('POST', '/api/fees', validFee);
    const { id } = await createRes.json() as any;
    const payRes = await ctx.req('PATCH', `/api/fees/${id}/pay`, { paymentKobo: PARTIAL });
    expect(payRes.status).toBe(200);
    const body = await payRes.json() as any;
    expect(body.paidKobo).toBe(PARTIAL);
    expect(body.balanceKobo).toBe(AMOUNT - PARTIAL);
    expect(body.status).toBe('partial');
  });

  it('PATCH /api/fees/:id/pay — records full payment → status success', async () => {
    const createRes = await ctx.req('POST', '/api/fees', validFee);
    const { id } = await createRes.json() as any;
    const payRes = await ctx.req('PATCH', `/api/fees/${id}/pay`, { paymentKobo: AMOUNT });
    expect(payRes.status).toBe(200);
    const body = await payRes.json() as any;
    expect(body.status).toBe('success');
    expect(body.balanceKobo).toBe(0);
  });

  it('PATCH /api/fees/:id/pay — 400 for invalid paymentKobo', async () => {
    const createRes = await ctx.req('POST', '/api/fees', validFee);
    const { id } = await createRes.json() as any;
    const payRes = await ctx.req('PATCH', `/api/fees/${id}/pay`, { paymentKobo: 0 });
    expect(payRes.status).toBe(400);
  });

  it('PATCH /api/fees/:id/pay — 404 for unknown fee', async () => {
    const res = await ctx.req('PATCH', '/api/fees/no-such-fee/pay', { paymentKobo: 100 });
    expect(res.status).toBe(404);
  });

  it('PATCH /api/fees/:id/pay — paymentEvent in response', async () => {
    const createRes = await ctx.req('POST', '/api/fees', validFee);
    const { id } = await createRes.json() as any;
    const payRes = await ctx.req('PATCH', `/api/fees/${id}/pay`, {
      paymentKobo: 50000, transactionRef: 'TX123', paymentMethod: 'bank_transfer',
    });
    const body = await payRes.json() as any;
    expect(body.paymentEvent.event).toBe('institution.fee.paid');
    expect(body.paymentEvent.transactionRef).toBe('TX123');
  });

  it('PATCH /api/fees/:id/pay — 409 if fee already fully paid', async () => {
    const createRes = await ctx.req('POST', '/api/fees', { ...validFee, status: 'success' });
    const { id } = await createRes.json() as any;
    // Set status to success in stub manually
    const row = ctx.db._rows.find((r: any) => r.id === id);
    if (row) row['status'] = 'success';
    const payRes = await ctx.req('PATCH', `/api/fees/${id}/pay`, { paymentKobo: 100 });
    expect(payRes.status).toBe(409);
  });
});
