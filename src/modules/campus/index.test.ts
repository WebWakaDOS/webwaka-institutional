import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { campusRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/campus', campusRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Campus', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/campus — creates campus (201)', async () => {
    const res = await ctx.req('POST', '/api/campus', { name: 'Main Campus', city: 'Lagos' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/campus — 400 when name missing', async () => {
    const res = await ctx.req('POST', '/api/campus', {});
    expect(res.status).toBe(400);
  });

  it('GET /api/campus — lists campuses', async () => {
    await ctx.req('POST', '/api/campus', { name: 'Main Campus' });
    const res = await ctx.req('GET', '/api/campus');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/campus/:id — returns campus', async () => {
    const createRes = await ctx.req('POST', '/api/campus', { name: 'South Campus' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/campus/${id}`);
    expect(res.status).toBe(200);
  });

  it('PATCH /api/campus/:id — updates campus', async () => {
    const createRes = await ctx.req('POST', '/api/campus', { name: 'North Campus' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/campus/${id}`, { city: 'Abuja' });
    expect(res.status).toBe(200);
  });
});

describe('Facilities', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/campus/facilities — creates facility (201)', async () => {
    const res = await ctx.req('POST', '/api/campus/facilities', { name: 'Lecture Hall A', type: 'lecture_hall', capacity: 200 });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/campus/facilities — 400 when required missing', async () => {
    const res = await ctx.req('POST', '/api/campus/facilities', {});
    expect(res.status).toBe(400);
  });

  it('GET /api/campus/facilities — lists facilities', async () => {
    await ctx.req('POST', '/api/campus/facilities', { name: 'Lab 1', type: 'lab', capacity: 50 });
    const res = await ctx.req('GET', '/api/campus/facilities');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/campus/facilities/:id — returns facility', async () => {
    const r = await ctx.req('POST', '/api/campus/facilities', { name: 'Lab 1', type: 'lab', capacity: 50 });
    const { id } = await r.json() as any;
    const res = await ctx.req('GET', `/api/campus/facilities/${id}`);
    expect(res.status).toBe(200);
  });

  it('PATCH /api/campus/facilities/:id — updates facility', async () => {
    const r = await ctx.req('POST', '/api/campus/facilities', { name: 'Lab 1', type: 'lab', capacity: 50 });
    const { id } = await r.json() as any;
    const res = await ctx.req('PATCH', `/api/campus/facilities/${id}`, { status: 'maintenance' });
    expect(res.status).toBe(200);
  });
});

describe('Facility Bookings', () => {
  let ctx: ReturnType<typeof makeApp>;
  let facilityId: string;

  beforeEach(async () => {
    ctx = makeApp();
    // Create facility — its status defaults to 'available' in the stub rows
    const r = await ctx.req('POST', '/api/campus/facilities', { name: 'Seminar Room', type: 'conference', capacity: 30 });
    facilityId = ((await r.json()) as any).id;
    // Manually ensure status field is set in DB rows (stub inserts it as 'available' from the SQL default... but our stub doesn't parse DEFAULT)
    // Fix: set the status field directly on the row that was just inserted
    const rows = ctx.db._rows;
    const facilRow = rows.find((r: any) => r.id === facilityId);
    if (facilRow) facilRow['status'] = 'available';
  });

  it('POST /api/campus/bookings — creates booking (201)', async () => {
    const res = await ctx.req('POST', '/api/campus/bookings', {
      facilityId, purpose: 'Team Meeting',
      startTime: '2025-06-10T09:00:00Z', endTime: '2025-06-10T11:00:00Z',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/campus/bookings — 400 when required missing', async () => {
    const res = await ctx.req('POST', '/api/campus/bookings', { facilityId });
    expect(res.status).toBe(400);
  });

  it('POST /api/campus/bookings — 400 when endTime before startTime', async () => {
    const res = await ctx.req('POST', '/api/campus/bookings', {
      facilityId, purpose: 'Test',
      startTime: '2025-06-10T11:00:00Z', endTime: '2025-06-10T09:00:00Z',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/campus/bookings — 404 for unknown facilityId', async () => {
    const res = await ctx.req('POST', '/api/campus/bookings', {
      facilityId: 'non-existent-facility-uuid', purpose: 'Test',
      startTime: '2025-06-10T09:00:00Z', endTime: '2025-06-10T10:00:00Z',
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/campus/bookings — lists bookings', async () => {
    const res = await ctx.req('GET', '/api/campus/bookings');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('PATCH /api/campus/bookings/:id/approve — approves booking', async () => {
    const createRes = await ctx.req('POST', '/api/campus/bookings', {
      facilityId, purpose: 'Seminar',
      startTime: '2025-07-01T09:00:00Z', endTime: '2025-07-01T12:00:00Z',
    });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/campus/bookings/${id}/approve`, {});
    expect(res.status).toBe(200);
  });

  it('PATCH /api/campus/bookings/:id/reject — rejects booking', async () => {
    const createRes = await ctx.req('POST', '/api/campus/bookings', {
      facilityId, purpose: 'Event',
      startTime: '2025-07-02T09:00:00Z', endTime: '2025-07-02T12:00:00Z',
    });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/campus/bookings/${id}/reject`, { notes: 'Double booked' });
    expect(res.status).toBe(200);
  });

  it('PATCH /api/campus/bookings/:id/cancel — cancels booking', async () => {
    const createRes = await ctx.req('POST', '/api/campus/bookings', {
      facilityId, purpose: 'Workshop',
      startTime: '2025-07-03T09:00:00Z', endTime: '2025-07-03T12:00:00Z',
    });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('PATCH', `/api/campus/bookings/${id}/cancel`, {});
    expect(res.status).toBe(200);
  });
});
