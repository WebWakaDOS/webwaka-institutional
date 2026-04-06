import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { libraryRouter } from './index';
import { makeD1Stub, makeEnv } from '../../__mocks__/d1-stub';

function makeApp(role = 'admin', userId = 'user-test-123', tenantId = 'tenant-inst-123') {
  const db = makeD1Stub();
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', { userId, tenantId, role, permissions: [] });
    await next();
  });
  app.route('/api/library', libraryRouter);
  const env = makeEnv(db);
  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.fetch(new Request(`http://localhost${path}`, init), env);
  };
  return { app, db, req };
}

describe('Library', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('POST /api/library/inst_books — creates book (201)', async () => {
    const res = await ctx.req('POST', '/api/library/inst_books', {
      title: 'Introduction to Algorithms', author: 'Cormen et al.',
      isbn: '978-0262033848', totalCopies: 5,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('POST /api/library/inst_books — 400 when title or author missing', async () => {
    const res = await ctx.req('POST', '/api/library/inst_books', { title: 'Only Title' });
    expect(res.status).toBe(400);
  });

  it('GET /api/library/inst_books — lists inst_books', async () => {
    await ctx.req('POST', '/api/library/inst_books', { title: 'Clean Code', author: 'Uncle Bob' });
    const res = await ctx.req('GET', '/api/library/inst_books');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST /api/library/checkout — checks out book', async () => {
    const bookRes = await ctx.req('POST', '/api/library/inst_books', { title: 'CLRS', author: 'Cormen', totalCopies: 2 });
    const { id: bookId } = await bookRes.json() as any;
    const res = await ctx.req('POST', '/api/library/checkout', { bookId, memberId: 'student-001' });
    expect(res.status).toBe(201);
  });

  it('POST /api/library/checkout — 400 when required missing', async () => {
    const res = await ctx.req('POST', '/api/library/checkout', { bookId: 'some-book' });
    expect(res.status).toBe(400);
  });

  it('GET /api/library/checkouts — lists checkouts', async () => {
    const res = await ctx.req('GET', '/api/library/checkouts');
    expect(res.status).toBe(200);
  });
});

describe('Library — Returns', () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => { ctx = makeApp(); });

  it('PATCH /api/library/:id/return — returns a checked-out book', async () => {
    // Create book and checkout
    const bookRes = await ctx.req('POST', '/api/library/inst_books', { title: 'CLRS', author: 'Cormen', totalCopies: 3 });
    const { id: bookId } = await bookRes.json() as any;
    // Set availableCopies in stub
    const bookRow = ctx.db._rows.find((r: any) => r.id === bookId);
    if (bookRow) bookRow['availableCopies'] = 3;

    const coRes = await ctx.req('POST', '/api/library/checkout', { bookId, memberId: 'student-ret-001' });
    const { id: checkoutId } = await coRes.json() as any;
    // Set dueDate and ensure returnedAt is null in stub row
    const coRow = ctx.db._rows.find((r: any) => r.id === checkoutId);
    if (coRow) { coRow['dueDate'] = new Date(Date.now() + 86400_000 * 14).toISOString(); coRow['returnedAt'] = null; }

    const res = await ctx.req('PATCH', `/api/library/${checkoutId}/return`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.daysOverdue).toBe(0);
    expect(body.lateFeeKobo).toBe(0);
  });

  it('PATCH /api/library/:id/return — 404 for unknown checkout', async () => {
    const res = await ctx.req('PATCH', '/api/library/no-such-checkout/return', {});
    expect(res.status).toBe(404);
  });

  it('PATCH /api/library/:id/return — 409 for already returned', async () => {
    const bookRes = await ctx.req('POST', '/api/library/inst_books', { title: 'Algo', author: 'Smith', totalCopies: 1 });
    const { id: bookId } = await bookRes.json() as any;
    const bookRow = ctx.db._rows.find((r: any) => r.id === bookId);
    if (bookRow) bookRow['availableCopies'] = 1;
    const coRes = await ctx.req('POST', '/api/library/checkout', { bookId, memberId: 'student-ret-002' });
    const { id: checkoutId } = await coRes.json() as any;
    const coRow = ctx.db._rows.find((r: any) => r.id === checkoutId);
    if (coRow) {
      coRow['dueDate'] = new Date(Date.now() + 86400_000 * 14).toISOString();
      coRow['returnedAt'] = new Date().toISOString();
    }
    const res = await ctx.req('PATCH', `/api/library/${checkoutId}/return`, {});
    expect(res.status).toBe(409);
  });

  it('GET /api/library/checkouts?overdue=true — filters overdue', async () => {
    const res = await ctx.req('GET', '/api/library/checkouts?overdue=true');
    expect(res.status).toBe(200);
  });
});
