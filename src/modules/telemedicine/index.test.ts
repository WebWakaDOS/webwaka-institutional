/**
 * Tests — Telemedicine Module
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { telemedicineRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/telemedicine', telemedicineRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

const validConsult = {
  patientId: 'patient-001', doctorId: 'doctor-001',
  scheduledAt: '2025-02-01T10:00:00Z', duration: 30,
};

describe('Telemedicine', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/telemedicine/consultations — creates consultation (201)', async () => {
    const res = await ctx.req('POST', '/api/telemedicine/consultations', validConsult);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(typeof body.meetingUrl).toBe('string');
  });

  it('POST /api/telemedicine/consultations — 400 when required missing', async () => {
    const res = await ctx.req('POST', '/api/telemedicine/consultations', { patientId: 'x' });
    expect(res.status).toBe(400);
  });

  it('GET /api/telemedicine/consultations — lists consultations', async () => {
    await ctx.req('POST', '/api/telemedicine/consultations', validConsult);
    const res = await ctx.req('GET', '/api/telemedicine/consultations');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/telemedicine/consultations/:id — returns consultation', async () => {
    const createRes = await ctx.req('POST', '/api/telemedicine/consultations', validConsult);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/telemedicine/consultations/${id}`);
    expect(res.status).toBe(200);
  });

  it('GET /api/telemedicine/consultations/:id — 404 for unknown', async () => {
    const res = await ctx.req('GET', '/api/telemedicine/consultations/tenant-inst-123-no-consult');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/telemedicine/consultations/:id/start — marks in progress', async () => {
    const createRes = await ctx.req('POST', '/api/telemedicine/consultations', validConsult);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/telemedicine/consultations/${id}/start`, { meetingUrl: 'https://meet.test/room1' });
    expect(res.status).toBe(200);
  });

  it('PATCH /api/telemedicine/consultations/:id/complete — completes consultation', async () => {
    const createRes = await ctx.req('POST', '/api/telemedicine/consultations', validConsult);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/telemedicine/consultations/${id}/complete`, { notes: 'Patient recovering well' });
    expect(res.status).toBe(200);
  });

  it('PATCH /api/telemedicine/consultations/:id/cancel — cancels consultation', async () => {
    const createRes = await ctx.req('POST', '/api/telemedicine/consultations', validConsult);
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/telemedicine/consultations/${id}/cancel`, {});
    expect(res.status).toBe(200);
  });
});
