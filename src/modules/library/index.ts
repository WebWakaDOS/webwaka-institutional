/**
 * Library Management — WebWaka Institutional Suite
 *
 * Book inventory, checkouts, returns, and late fee calculation.
 *
 * Invariant 2: tenantId always from JWT.
 * Invariant 5: late fees in kobo.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const libraryRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const LATE_FEE_PER_DAY_KOBO = 5_00; // NGN 5 per day

// ─── Books ────────────────────────────────────────────────────────────────────

libraryRouter.post('/books', requireRole(['admin', 'librarian']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    title: string; author: string; isbn?: string; publisher?: string;
    category?: string; totalCopies?: number;
  }>();
  if (!body.title || !body.author) return c.json({ error: 'title and author are required' }, 400);

  const copies = body.totalCopies ?? 1;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO books
       (id, tenantId, isbn, title, author, publisher, category, totalCopies, availableCopies, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.isbn ?? null, body.title, body.author,
    body.publisher ?? null, body.category ?? null, copies, copies, now, now).run();

  return c.json({ success: true, id }, 201);
});

libraryRouter.get('/books', requireRole(['admin', 'librarian', 'student', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { category, search } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM books WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (category) { sql += ' AND category = ?'; args.push(category); }
  if (search)   { sql += ' AND (title LIKE ? OR author LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY title ASC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

// ─── Checkouts ────────────────────────────────────────────────────────────────

libraryRouter.post('/checkout', requireRole(['admin', 'librarian']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    bookId: string; memberId: string; memberType?: string; dueDays?: number;
  }>();
  if (!body.bookId || !body.memberId) return c.json({ error: 'bookId and memberId are required' }, 400);

  const book = await c.env.DB.prepare(
    'SELECT id, availableCopies FROM books WHERE id = ? AND tenantId = ?'
  ).bind(body.bookId, tenantId).first<{ id: string; availableCopies: number }>();
  if (!book) return c.json({ error: 'Book not found' }, 404);
  if (book.availableCopies <= 0) return c.json({ error: 'No copies available for checkout' }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const dueDate = new Date(Date.now() + (body.dueDays ?? 14) * 86400_000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO bookCheckouts
       (id, tenantId, bookId, memberId, memberType, checkedOutAt, dueDate, lateFeeKobo, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(id, tenantId, body.bookId, body.memberId,
    body.memberType ?? 'student', now, dueDate, now).run();

  await c.env.DB.prepare(
    'UPDATE books SET availableCopies = availableCopies - 1, updatedAt = ? WHERE id = ? AND tenantId = ?'
  ).bind(now, body.bookId, tenantId).run();

  return c.json({ success: true, id, dueDate }, 201);
});

libraryRouter.patch('/:id/return', requireRole(['admin', 'librarian']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const checkout = await c.env.DB.prepare(
    'SELECT bookId, dueDate, returnedAt FROM bookCheckouts WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<{ bookId: string; dueDate: string; returnedAt: string | null }>();
  if (!checkout) return c.json({ error: 'Checkout not found' }, 404);
  if (checkout.returnedAt) return c.json({ error: 'Book already returned' }, 409);

  const msOverdue = Math.max(0, Date.now() - new Date(checkout.dueDate).getTime());
  const daysOverdue = Math.floor(msOverdue / 86400_000);
  const lateFeeKobo = daysOverdue * LATE_FEE_PER_DAY_KOBO;

  await c.env.DB.prepare(
    'UPDATE bookCheckouts SET returnedAt = ?, lateFeeKobo = ? WHERE id = ? AND tenantId = ?'
  ).bind(now, lateFeeKobo, id, tenantId).run();

  await c.env.DB.prepare(
    'UPDATE books SET availableCopies = availableCopies + 1, updatedAt = ? WHERE id = ? AND tenantId = ?'
  ).bind(now, checkout.bookId, tenantId).run();

  return c.json({ success: true, returnedAt: now, daysOverdue, lateFeeKobo });
});

libraryRouter.get('/checkouts', requireRole(['admin', 'librarian']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { memberId, overdue } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM bookCheckouts WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (memberId) { sql += ' AND memberId = ?'; args.push(memberId); }
  if (overdue === 'true') {
    sql += ` AND returnedAt IS NULL AND dueDate < ?`;
    args.push(new Date().toISOString());
  }
  sql += ' ORDER BY checkedOutAt DESC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});
