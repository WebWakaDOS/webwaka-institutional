/**
 * Tests — Document Management System (DMS)
 * DMS uses header-based metadata + binary body (arrayBuffer) for uploads.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { dmsRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const env = makeEnv(db);
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/dms', dmsRouter);

  // Upload: send binary body with required headers
  const upload = (title: string, content = 'pdf content') => {
    return app.fetch(new Request('http://localhost/api/dms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Doc-Title': title,
        'X-Doc-Category': 'policy',
        Authorization: 'Bearer mock',
      },
      body: new TextEncoder().encode(content),
    }), env);
  };

  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };

  return { app, db, env, upload, req };
}

describe('Document Management System', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/dms — uploads document (201)', async () => {
    const res = await ctx.upload('Student Handbook 2025');
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(typeof body.r2Key).toBe('string');
  });

  it('POST /api/dms — 400 when X-Doc-Title header missing', async () => {
    const res = await ctx.app.fetch(new Request('http://localhost/api/dms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', Authorization: 'Bearer mock' },
      body: new TextEncoder().encode('pdf'),
    }), ctx.env);
    expect(res.status).toBe(400);
  });

  it('POST /api/dms — 400 when body is empty', async () => {
    const res = await ctx.app.fetch(new Request('http://localhost/api/dms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'X-Doc-Title': 'Test', Authorization: 'Bearer mock' },
      body: new Uint8Array(0),
    }), ctx.env);
    expect(res.status).toBe(400);
  });

  it('GET /api/dms — lists documents', async () => {
    await ctx.upload('Academic Calendar');
    const res = await ctx.req('GET', '/api/dms');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/dms/:id — returns document', async () => {
    const createRes = await ctx.upload('Admission Policy');
    const { id } = await createRes.json() as any;
    const res = await ctx.req('GET', `/api/dms/${id}`);
    expect(res.status).toBe(200);
  });
});
