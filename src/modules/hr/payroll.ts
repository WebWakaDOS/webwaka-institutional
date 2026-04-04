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
 * RBAC:
 *   - requireRole(['admin'])        — coarse-grained: HR admin or institution admin
 *   - requirePermissions(['manage:payroll']) — fine-grained: guards process + payslip routes
 *
 * Routes:
 *   POST  /api/payroll/runs          — Initiate a payroll run for a period
 *   GET   /api/payroll/runs          — List payroll runs
 *   GET   /api/payroll/runs/:id      — Get run detail + payslips
 *   GET   /api/payroll/payslips/:id  — Get individual payslip
 *   POST  /api/payroll/runs/:id/process — Execute calculation & emit payouts
 */

import { Hono } from 'hono';
import { requireRole, requirePermissions } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const payrollRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// Nigerian PAYE tax brackets (kobo per annum)
// Source: Finance Act 2021
//
// Each entry is the SIZE of the bracket in kobo (not cumulative upper-bound).
// Amounts in naira × 100 to convert to kobo:
//   NGN   300,000 → 300_000_00 =  30,000,000 kobo
//   NGN   500,000 → 500_000_00 =  50,000,000 kobo
//   NGN 1,600,000 → 1_600_000_00 = 160,000,000 kobo
const PAYE_BRACKETS = [
  { upToKobo: 300_000_00,      ratePercent: 7  },  // First NGN 300,000 at 7%
  { upToKobo: 300_000_00,      ratePercent: 11 },  // Next  NGN 300,000 at 11%
  { upToKobo: 500_000_00,      ratePercent: 15 },  // Next  NGN 500,000 at 15%
  { upToKobo: 500_000_00,      ratePercent: 19 },  // Next  NGN 500,000 at 19%
  { upToKobo: 1_600_000_00,    ratePercent: 21 },  // Next  NGN 1,600,000 at 21%
  { upToKobo: Infinity,        ratePercent: 24 },  // Above NGN 3,200,000 at 24%
] as const;

/**
 * Calculate Nigerian PAYE income tax on annual gross income (kobo).
 * Returns annual tax in kobo.
 *
 * Exported for unit testing.
 *
 * Steps:
 *   1. Compute Consolidated Relief Allowance (CRA):
 *        max(NGN 200,000, 1% of gross) + 20% of gross
 *   2. Taxable income = gross − CRA (floored at 0)
 *   3. Apply progressive brackets
 */
export function calculatePayeTax(annualGrossKobo: number): number {
  const craKobo =
    Math.max(20_000_000, Math.round(annualGrossKobo * 0.01)) +
    Math.round(annualGrossKobo * 0.20);
  let taxableKobo = Math.max(0, annualGrossKobo - craKobo);
  let taxKobo = 0;

  for (const bracket of PAYE_BRACKETS) {
    if (taxableKobo <= 0) break;
    const chunkKobo =
      bracket.upToKobo === Infinity
        ? taxableKobo
        : Math.min(taxableKobo, bracket.upToKobo);
    taxKobo += Math.round((chunkKobo * bracket.ratePercent) / 100);
    taxableKobo -= chunkKobo;
  }

  return taxKobo;
}

// ─── POST /api/payroll/runs ───────────────────────────────────────────────────
payrollRouter.post('/runs', requireRole(['admin']), requirePermissions(['manage:payroll']), async (c) => {
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
    `INSERT INTO payrollRuns
       (id, tenantId, period, status, totalGrossKobo, totalNetKobo, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.period, 'draft', 0, 0, createdBy, now, now).run();

  return c.json({ success: true, id, period: body.period, status: 'draft' }, 201);
});

// ─── GET /api/payroll/runs ────────────────────────────────────────────────────
payrollRouter.get('/runs', requireRole(['admin']), requirePermissions(['manage:payroll']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM payrollRuns WHERE tenantId = ? ORDER BY period DESC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── GET /api/payroll/runs/:id ────────────────────────────────────────────────
payrollRouter.get('/runs/:id', requireRole(['admin']), requirePermissions(['manage:payroll']), async (c) => {
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
payrollRouter.get(
  '/payslips/:id',
  requireRole(['admin', 'staff']),
  requirePermissions(['manage:payroll']),
  async (c) => {
    const tenantId = c.get('user').tenantId;
    const id = c.req.param('id');
    const user = c.get('user');

    const payslip = await c.env.DB.prepare(
      'SELECT * FROM payslips WHERE id = ? AND tenantId = ?'
    ).bind(id, tenantId).first<Record<string, unknown>>();

    if (!payslip) return c.json({ error: 'Payslip not found' }, 404);

    if (user.role === 'staff' && payslip.staffId !== user.userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ data: payslip });
  }
);

// ─── POST /api/payroll/runs/:id/process ──────────────────────────────────────
// Main calculation engine: reads all active staff salaries, computes PAYE,
// generates payslips, emits fintech.payout.requested events.
payrollRouter.post(
  '/runs/:id/process',
  requireRole(['admin']),
  requirePermissions(['manage:payroll']),
  async (c) => {
    const tenantId = c.get('user').tenantId;
    const runId = c.req.param('id');

    const run = await c.env.DB.prepare(
      'SELECT * FROM payrollRuns WHERE id = ? AND tenantId = ?'
    ).bind(runId, tenantId).first<{ id: string; period: string; status: string }>();

    if (!run) return c.json({ error: 'Payroll run not found' }, 404);
    if (run.status !== 'draft') {
      return c.json({ error: `Cannot process a run with status '${run.status}'` }, 409);
    }

    const { results: staffList } = await c.env.DB.prepare(
      `SELECT id, grossSalaryKobo, pensionDeductionKobo, otherDeductionsKobo
       FROM staff WHERE tenantId = ? AND status = ?`
    ).bind(tenantId, 'active').all<{
      id: string;
      grossSalaryKobo: number;
      pensionDeductionKobo: number;
      otherDeductionsKobo: number;
    }>();

    const now = new Date().toISOString();
    let totalGross = 0;
    let totalNet = 0;
    const events: unknown[] = [];
    let staffProcessed = 0;

    for (const member of staffList) {
      const grossKobo = member.grossSalaryKobo ?? 0;

      // Guard: skip rows that have no salary (e.g. non-staff rows from join tables)
      if (!grossKobo) continue;

      const pensionKobo = member.pensionDeductionKobo ?? 0;
      const otherKobo = member.otherDeductionsKobo ?? 0;

      const annualGrossKobo = grossKobo * 12;
      const annualTaxKobo = calculatePayeTax(annualGrossKobo);
      const monthlyTaxKobo = Math.round(annualTaxKobo / 12);

      const deductionsKobo = pensionKobo + otherKobo;
      const netKobo = Math.max(0, grossKobo - monthlyTaxKobo - deductionsKobo);

      const payslipId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO payslips
           (id, tenantId, payrollRunId, staffId, grossKobo, taxKobo, deductionsKobo, netKobo, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(payslipId, tenantId, runId, member.id, grossKobo, monthlyTaxKobo, deductionsKobo, netKobo, 'pending', now).run();

      totalGross += grossKobo;
      totalNet += netKobo;
      staffProcessed += 1;

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
       SET status = ?, totalGrossKobo = ?, totalNetKobo = ?, runAt = ?, updatedAt = ?
       WHERE id = ? AND tenantId = ?`
    ).bind('completed', totalGross, totalNet, now, now, runId, tenantId).run();

    return c.json({
      success: true,
      runId,
      staffProcessed,
      totalGrossKobo: totalGross,
      totalNetKobo: totalNet,
      payoutEvents: events,
    });
  }
);
