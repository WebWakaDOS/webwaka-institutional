import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ehrRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'doctor', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/ehr', ehrRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('EHR — Patient Records', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/ehr/patients — creates patient record (201)', async () => {
    const res = await ctx.req('POST', '/api/ehr/patients', {
      patientId: 'student-uuid-001', dob: '2000-01-01', bloodGroup: 'O+', genotype: 'AA',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/ehr/patients — 400 when patientId missing', async () => {
    const res = await ctx.req('POST', '/api/ehr/patients', {});
    expect(res.status).toBe(400);
  });

  it('POST /api/ehr/patients — 409 on duplicate patientId', async () => {
    await ctx.req('POST', '/api/ehr/patients', { patientId: 'student-uuid-002' });
    const res = await ctx.req('POST', '/api/ehr/patients', { patientId: 'student-uuid-002' });
    expect(res.status).toBe(409);
  });

  it('GET /api/ehr/patients — lists patient records', async () => {
    await ctx.req('POST', '/api/ehr/patients', { patientId: 'student-uuid-003' });
    const res = await ctx.req('GET', '/api/ehr/patients');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/ehr/patients/:id — returns patient record', async () => {
    const createRes = await ctx.req('POST', '/api/ehr/patients', { patientId: 'patient-x-001' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/ehr/patients/${id}`);
    expect(res.status).toBe(200);
  });

  it('GET /api/ehr/patients/:id — 404 for unknown', async () => {
    const res = await ctx.req('GET', '/api/ehr/patients/no-such-patient');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/ehr/patients/:id — updates record', async () => {
    const createRes = await ctx.req('POST', '/api/ehr/patients', { patientId: 'patient-y-001' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/ehr/patients/${id}`, { bloodGroup: 'B+' });
    expect(res.status).toBe(200);
  });
});

describe('EHR — Prescriptions', () => {
  let ctx: ReturnType<typeof makeApp>;
  let patientDbId: string;

  beforeEach(async () => {
    ctx = makeApp();
    const r = await ctx.req('POST', '/api/ehr/patients', { patientId: 'patient-presc-001' });
    patientDbId = ((await r.json()) as any).id;
  });

  it('POST /api/ehr/patients/:id/prescriptions — creates prescription (201)', async () => {
    const res = await ctx.req('POST', `/api/ehr/patients/${patientDbId}/prescriptions`, {
      medication: 'Paracetamol', dosage: '500mg', frequency: 'Twice daily', duration: '7 days',
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/ehr/patients/:id/prescriptions — 400 when medication missing', async () => {
    const res = await ctx.req('POST', `/api/ehr/patients/${patientDbId}/prescriptions`, {});
    expect(res.status).toBe(400);
  });

  it('GET /api/ehr/patients/:id/prescriptions — lists prescriptions', async () => {
    await ctx.req('POST', `/api/ehr/patients/${patientDbId}/prescriptions`, {
      medication: 'Ibuprofen', dosage: '200mg', frequency: 'Thrice daily', duration: '5 days',
    });
    const res = await ctx.req('GET', `/api/ehr/patients/${patientDbId}/prescriptions`);
    expect(res.status).toBe(200);
  });
});

describe('EHR — Lab Results', () => {
  let ctx: ReturnType<typeof makeApp>;
  let patientDbId: string;

  beforeEach(async () => {
    ctx = makeApp();
    const r = await ctx.req('POST', '/api/ehr/patients', { patientId: 'patient-lab-001' });
    patientDbId = ((await r.json()) as any).id;
  });

  it('POST /api/ehr/patients/:id/labs — creates lab result (201)', async () => {
    const res = await ctx.req('POST', `/api/ehr/patients/${patientDbId}/labs`, {
      testName: 'Full Blood Count', result: 'Normal', notes: 'Within range',
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/ehr/patients/:id/labs — 400 when required missing', async () => {
    const res = await ctx.req('POST', `/api/ehr/patients/${patientDbId}/labs`, {});
    expect(res.status).toBe(400);
  });

  it('GET /api/ehr/patients/:id/labs — lists lab results', async () => {
    await ctx.req('POST', `/api/ehr/patients/${patientDbId}/labs`, {
      testName: 'CBC', result: 'Normal', notes: 'OK',
    });
    const res = await ctx.req('GET', `/api/ehr/patients/${patientDbId}/labs`);
    expect(res.status).toBe(200);
  });
});
