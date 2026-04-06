import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { insuranceRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/insurance', insuranceRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

const validClaim = {
  patientId: 'patient-001', policyNumber: 'NHIS-2024-001',
  provider: 'NHIS', claimType: 'outpatient', amountKobo: 50000_00,
};

describe('Insurance Claims', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/insurance — creates claim (201)', async () => {
    const res = await ctx.req('POST', '/api/insurance', validClaim);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(typeof body.referenceNo).toBe('string');
  });

  it('POST /api/insurance — 400 when required missing', async () => {
    const res = await ctx.req('POST', '/api/insurance', { patientId: 'p1' });
    expect(res.status).toBe(400);
  });

  it('POST /api/insurance — 400 for invalid claimType', async () => {
    const res = await ctx.req('POST', '/api/insurance', { ...validClaim, claimType: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('GET /api/insurance — lists claims', async () => {
    await ctx.req('POST', '/api/insurance', validClaim);
    const res = await ctx.req('GET', '/api/insurance');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/insurance/:id — returns claim', async () => {
    const createRes = await ctx.req('POST', '/api/insurance', validClaim);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/insurance/${id}`);
    expect(res.status).toBe(200);
  });

  it('GET /api/insurance/:id — 404 for unknown', async () => {
    const res = await ctx.req('GET', '/api/insurance/no-such-claim');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/insurance/:id/review — approves claim', async () => {
    const createRes = await ctx.req('POST', '/api/insurance', validClaim);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/insurance/${id}/review`, {
      status: 'approved', approvedKobo: 5000000,
    });
    expect(res.status).toBe(200);
  });
});

describe('Insurance — Document Upload', () => {
  let ctx: ReturnType<typeof makeApp>;
  let claimId: string;

  beforeEach(async () => {
    ctx = makeApp();
    const r = await ctx.req('POST', '/api/insurance', validClaim);
    claimId = ((await r.json()) as any).id;
    // Ensure documents field is set in stub row
    const row = ctx.db._rows.find((rr: any) => rr.id === claimId);
    if (row) row['documents'] = '[]';
  });

  it('POST /api/insurance/:id/documents — uploads document', async () => {
    const res = await ctx.app.fetch(new Request(`http://localhost/api/insurance/${claimId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', Authorization: 'Bearer mock' },
      body: new TextEncoder().encode('pdf content'),
    }), makeEnv(ctx.db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(typeof body.r2Key).toBe('string');
  });

  it('POST /api/insurance/:id/documents — 400 when body empty', async () => {
    const res = await ctx.app.fetch(new Request(`http://localhost/api/insurance/${claimId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', Authorization: 'Bearer mock' },
      body: new Uint8Array(0),
    }), makeEnv(ctx.db));
    expect(res.status).toBe(400);
  });

  it('POST /api/insurance/:id/documents — 404 for unknown claim', async () => {
    const res = await ctx.app.fetch(new Request('http://localhost/api/insurance/no-such-claim/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', Authorization: 'Bearer mock' },
      body: new TextEncoder().encode('pdf'),
    }), makeEnv(ctx.db));
    expect(res.status).toBe(404);
  });
});
