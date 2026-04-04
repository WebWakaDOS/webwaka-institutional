/**
 * Cafeteria / Meal Plan System — WebWaka Institutional Suite
 *
 * Student/employee meal plans, dietary restrictions, and balance top-ups.
 *
 * Invariant 2: tenantId always from JWT.
 * Invariant 5: all amounts in kobo.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const cafeteriaRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Meal Plans ───────────────────────────────────────────────────────────────

cafeteriaRouter.post('/plans', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    studentId: string; plan?: string; dietaryRestrictions?: string[];
    initialBalanceKobo?: number; academicYear: string;
  }>();
  if (!body.studentId || !body.academicYear) {
    return c.json({ error: 'studentId and academicYear are required' }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM mealPlans WHERE studentId = ? AND academicYear = ? AND tenantId = ?'
  ).bind(body.studentId, body.academicYear, tenantId).first();
  if (existing) return c.json({ error: 'Meal plan already exists for this student and year' }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO mealPlans
       (id, tenantId, studentId, plan, dietaryRestrictions, balanceKobo, academicYear, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).bind(id, tenantId, body.studentId, body.plan ?? 'standard',
    JSON.stringify(body.dietaryRestrictions ?? []),
    body.initialBalanceKobo ?? 0, body.academicYear, now, now).run();

  return c.json({ success: true, id }, 201);
});

cafeteriaRouter.get('/plans', requireRole(['admin', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { studentId, academicYear } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM mealPlans WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (studentId)    { sql += ' AND studentId = ?';    args.push(studentId); }
  if (academicYear) { sql += ' AND academicYear = ?'; args.push(academicYear); }
  sql += ' ORDER BY createdAt DESC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

cafeteriaRouter.get('/plans/:id', requireRole(['admin', 'staff', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const plan = await c.env.DB.prepare(
    'SELECT * FROM mealPlans WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!plan) return c.json({ error: 'Meal plan not found' }, 404);
  return c.json({ data: plan });
});

cafeteriaRouter.patch('/plans/:id/topup', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ amountKobo: number }>();
  if (!body.amountKobo || body.amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer' }, 400);
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'UPDATE mealPlans SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
  ).bind(body.amountKobo, now, id, tenantId).run();
  return c.json({ success: true });
});

// ─── Meal Transactions ────────────────────────────────────────────────────────

cafeteriaRouter.post('/plans/:id/transact', requireRole(['admin', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const mealPlanId = c.req.param('id');
  const body = await c.req.json<{ item: string; amountKobo: number }>();
  if (!body.item || !body.amountKobo || body.amountKobo <= 0) {
    return c.json({ error: 'item and amountKobo are required' }, 400);
  }

  const plan = await c.env.DB.prepare(
    'SELECT balanceKobo FROM mealPlans WHERE id = ? AND tenantId = ?'
  ).bind(mealPlanId, tenantId).first<{ balanceKobo: number }>();
  if (!plan) return c.json({ error: 'Meal plan not found' }, 404);
  if (plan.balanceKobo < body.amountKobo) {
    return c.json({ error: 'Insufficient meal plan balance' }, 402);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO mealTransactions (id, tenantId, mealPlanId, item, amountKobo, transactedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, mealPlanId, body.item, body.amountKobo, now, now).run();

  await c.env.DB.prepare(
    'UPDATE mealPlans SET balanceKobo = balanceKobo - ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
  ).bind(body.amountKobo, now, mealPlanId, tenantId).run();

  return c.json({ success: true, id, remainingBalanceKobo: plan.balanceKobo - body.amountKobo }, 201);
});
