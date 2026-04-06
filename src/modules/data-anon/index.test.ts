import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { dataAnonRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/anon', dataAnonRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Data Anonymisation', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/anon/jobs — creates job (201)', async () => {
    const res = await ctx.req('POST', '/api/anon/jobs', { sourceTable: 'students' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.fieldsToStrip)).toBe(true);
  });

  it('POST /api/anon/jobs — 400 when sourceTable missing', async () => {
    const res = await ctx.req('POST', '/api/anon/jobs', {});
    expect(res.status).toBe(400);
  });

  it('POST /api/anon/jobs — 400 for non-permitted sourceTable', async () => {
    const res = await ctx.req('POST', '/api/anon/jobs', { sourceTable: 'passwords' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(Array.isArray(body.allowedTables)).toBe(true);
  });

  it('POST /api/anon/jobs — 400 when fieldsToStrip contains no valid PII', async () => {
    const res = await ctx.req('POST', '/api/anon/jobs', {
      sourceTable: 'students', fieldsToStrip: ['createdAt', 'id'],
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/anon/jobs — custom fieldsToStrip', async () => {
    const res = await ctx.req('POST', '/api/anon/jobs', {
      sourceTable: 'staff', fieldsToStrip: ['email', 'phone'],
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.fieldsToStrip).toContain('email');
  });

  it('GET /api/anon/jobs — lists jobs', async () => {
    await ctx.req('POST', '/api/anon/jobs', { sourceTable: 'students' });
    const res = await ctx.req('GET', '/api/anon/jobs');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('GET /api/anon/jobs/:id — returns job', async () => {
    const createRes = await ctx.req('POST', '/api/anon/jobs', { sourceTable: 'alumni' });
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/anon/jobs/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.sourceTable).toBe('alumni');
  });

  it('GET /api/anon/jobs/:id — 404 for unknown', async () => {
    const res = await ctx.req('GET', '/api/anon/jobs/no-such-job');
    expect(res.status).toBe(404);
  });

  it('POST /api/anon/jobs/:id/run — executes job and returns processed count', async () => {
    const createRes = await ctx.req('POST', '/api/anon/jobs', { sourceTable: 'visitorLogs' });
    const { id } = await createRes.json() as any;
    // Seed some source rows in the stub
    ctx.db._rows.push({
      id: 'v1', tenantId: 'tenant-inst-123', visitorName: 'John Doe',
      phone: '08011111111', host: 'Prof. A', purpose: 'Visit',
    });
    const res = await ctx.req('POST', `/api/anon/jobs/${id}/run`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.processedCount).toBeGreaterThanOrEqual(0);
    expect(typeof body.outputR2Key).toBe('string');
  });

  it('POST /api/anon/jobs/:id/run — 404 for unknown job', async () => {
    const res = await ctx.req('POST', '/api/anon/jobs/no-such-job/run', {});
    expect(res.status).toBe(404);
  });

  it('POST /api/anon/jobs/:id/run — 409 if job already completed', async () => {
    const createRes = await ctx.req('POST', '/api/anon/jobs', { sourceTable: 'students' });
    const { id } = await createRes.json() as any;
    // Manually set status to completed
    const row = ctx.db._rows.find((r: any) => r.id === id);
    if (row) row['status'] = 'completed';
    const res = await ctx.req('POST', `/api/anon/jobs/${id}/run`, {});
    expect(res.status).toBe(409);
  });

  it('POST /api/anon/jobs/:id/run — 409 if job already running', async () => {
    const createRes = await ctx.req('POST', '/api/anon/jobs', { sourceTable: 'students' });
    const { id } = await createRes.json() as any;
    const row = ctx.db._rows.find((r: any) => r.id === id);
    if (row) row['status'] = 'running';
    const res = await ctx.req('POST', `/api/anon/jobs/${id}/run`, {});
    expect(res.status).toBe(409);
  });
});
