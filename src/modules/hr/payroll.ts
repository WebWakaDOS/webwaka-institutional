/**
 * Automated Payroll Engine — WebWaka Institutional Suite
 *
 * Task: Phase 1 — HR & ERP
 *
 * Calculates net pay (gross – taxes – deductions) for all active staff,
 * persists payslips, and emits a fintech.payout.requested event per employee.
 *
 * Invariant 2 (Multi-Tenant): tenantId always from JWT.
 * Invariant 5 (Nigeria First): all amounts in kobo (NGN × 100).
 *
 * Routes:
 *   POST  /api/payroll/runs          — Initiate a payroll run for a period
 *   GET   /api/payroll/runs          — List payroll runs
 *   GET   /api/payroll/runs/:id      — Get run detail + payslips
 *   GET   /api/payroll/payslips/:id  — Get individual payslip
 *   POST  /api/payroll/runs/:id/process — Execute calculation & emit payouts
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const payrollRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// Nigerian PAYE tax brackets (kobo per annum)
// Source: Finance Act 2021
const PAYE_BRACKETS = [
  { upToKobo: 30_000_00,    ratePercent: 7  },
  { upToKobo: 30_000_00,    ratePercent: 11 },
  { upToKobo: 50_000_00,    ratePercent: 15 },
  { upToKobo: 50_000_00,    ratePercent: 19 },
  { upToKobo: 160_000_00,   ratePercent: 21 },
  { upToKobo: Infinity,      ratePercent: 24 },
] as const;

/** Calculate Nigerian PAYE tax on annual gross income (kobo). Returns tax in kobo. */
function calculatePayeTax(annualGrossKobo: number): number {
  // Consolidated Relief Allowance: higher of NGN 200,000 or 1% of gross income + 20% of gross income
  const craKobo = Math.max(200_000_00, Math.round(annualGrossKobo * 0.01)) + Math.round(annualGrossKobo * 0.20);
  let taxableKobo = Math.max(0, annualGrossKobo - craKobo);
  let taxKobo = 0;

  for (const bracket of PAYE_BRACKETS) {
    if (taxableKobo <= 0) break;
    const taxableInBracket = Math.min(taxableKobo, bracket.upToKobo === Infinity ? taxableKobo : bracket.upToKobo);
    taxKobo += Math.round(taxableInBracket * bracket.ratePercent / 100);
    taxableKobo -= taxableInBracket;
  }

  return taxKobo;
}

// ─── POST /api/payroll/runs ───────────────────────────────────────────────────
payrollRouter.post('/runs', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const createdBy = c.get('user').userId;
  const body = await c.req.json<{ period: string }>();

  if (!body.period || !/^\d{4}-\d{2}$/.test(body.period)) {
    return c.json({ error: 'period must be in YYYY-MM format' }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM payrollRuns WHERE tenantId = ? AND period = ?'
  ).bind(tenantId, body.period).first();

  if (existing) {
    return c.json({ error: `Payroll run for ${body.period} already exists` }, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO payrollRuns (id, tenantId, period, status, totalGrossKobo, totalNetKobo, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, 'draft', 0, 0, ?, ?, ?)`
  ).bind(id, tenantId, body.period, createdBy, now, now).run();

  return c.json({ success: true, id, period: body.period, status: 'draft' }, 201);
});

// ─── GET /api/payroll/runs ────────────────────────────────────────────────────
payrollRouter.get('/runs', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM payrollRuns WHERE tenantId = ? ORDER BY period DESC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── GET /api/payroll/runs/:id ────────────────────────────────────────────────
payrollRouter.get('/runs/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const run = await c.env.DB.prepare(
    'SELECT * FROM payrollRuns WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();

  if (!run) return c.json({ error: 'Payroll run not found' }, 404);

  const { results: payslips } = await c.env.DB.prepare(
    'SELECT * FROM payslips WHERE payrollRunId = ? AND tenantId = ?'
  ).bind(id, tenantId).all();

  return c.json({ data: { ...run, payslips } });
});

// ─── GET /api/payroll/payslips/:id ───────────────────────────────────────────
payrollRouter.get('/payslips/:id', requireRole(['admin', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const user = c.get('user');

  const payslip = await c.env.DB.prepare(
    'SELECT * FROM payslips WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<Record<string, unknown>>();

  if (!payslip) return c.json({ error: 'Payslip not found' }, 404);

  // Staff can only view their own payslip
  if (user.role === 'staff' && payslip.staffId !== user.userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return c.json({ data: payslip });
});

// ─── POST /api/payroll/runs/:id/process ──────────────────────────────────────
// Main calculation engine: reads all active staff salaries, computes PAYE,
// generates payslips, emits fintech.payout.requested events.
payrollRouter.post('/runs/:id/process', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const runId = c.req.param('id');

  const run = await c.env.DB.prepare(
    'SELECT * FROM payrollRuns WHERE id = ? AND tenantId = ?'
  ).bind(runId, tenantId).first<{ id: string; period: string; status: string }>();

  if (!run) return c.json({ error: 'Payroll run not found' }, 404);
  if (run.status !== 'draft') {
    return c.json({ error: `Cannot process a run with status '${run.status}'` }, 409);
  }

  // Fetch all active staff for the tenant (uses existing staff table from migration 0001)
  const { results: staffList } = await c.env.DB.prepare(
    `SELECT id, grossSalaryKobo, pensionDeductionKobo, otherDeductionsKobo
     FROM staff WHERE tenantId = ? AND status = 'active'`
  ).bind(tenantId).all<{
    id: string;
    grossSalaryKobo: number;
    pensionDeductionKobo: number;
    otherDeductionsKobo: number;
  }>();

  const now = new Date().toISOString();
  let totalGross = 0;
  let totalNet = 0;
  const events: unknown[] = [];

  for (const member of staffList) {
    const grossKobo = member.grossSalaryKobo ?? 0;
    const pensionKobo = member.pensionDeductionKobo ?? 0;
    const otherKobo = member.otherDeductionsKobo ?? 0;

    // Monthly → annual for PAYE bracket calc
    const annualGrossKobo = grossKobo * 12;
    const annualTaxKobo = calculatePayeTax(annualGrossKobo);
    const monthlyTaxKobo = Math.round(annualTaxKobo / 12);

    const deductionsKobo = pensionKobo + otherKobo;
    const netKobo = Math.max(0, grossKobo - monthlyTaxKobo - deductionsKobo);

    const payslipId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO payslips
         (id, tenantId, payrollRunId, staffId, grossKobo, taxKobo, deductionsKobo, netKobo, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(payslipId, tenantId, runId, member.id, grossKobo, monthlyTaxKobo, deductionsKobo, netKobo, now).run();

    totalGross += grossKobo;
    totalNet += netKobo;

    // Event payload for fintech payout worker (fire-and-forget; worker handles failures)
    events.push({
      event: 'fintech.payout.requested',
      tenantId,
      payslipId,
      staffId: member.id,
      amountKobo: netKobo,
      period: run.period,
      timestamp: now,
    });
  }

  await c.env.DB.prepare(
    `UPDATE payrollRuns
     SET status = 'completed', totalGrossKobo = ?, totalNetKobo = ?, runAt = ?, updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(totalGross, totalNet, now, now, runId, tenantId).run();

  // In production: push events to a Queue / KV / event bus.
  // Here we return them so the caller or orchestrator can process.
  return c.json({
    success: true,
    runId,
    staffProcessed: staffList.length,
    totalGrossKobo: totalGross,
    totalNetKobo: totalNet,
    payoutEvents: events,
  });
});
