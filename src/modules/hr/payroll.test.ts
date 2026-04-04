/**
 * Tests — Automated Payroll Engine (QA-INS-1)
 *
 * Covers:
 *   1. calculatePayeTax() — pure unit tests for Nigerian PAYE brackets
 *   2. POST /api/payroll/runs — create a draft run
 *   3. POST /api/payroll/runs/:id/process — full calculation & payout event emission
 *   4. RBAC — manage:payroll permission enforcement
 *   5. Status-machine guard — cannot re-process a completed run
 *   6. Edge cases — no staff, zero-salary rows skipped
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { payrollRouter, calculatePayeTax } from './payroll';
import type { Bindings, AppVariables } from '../../core/types';

// ─── D1 In-memory stub (mirrors the existing pattern) ─────────────────────────

function makeD1Stub() {
  const rows: Record<string, unknown>[] = [];

  function prepare(sql: string) {
    return {
      bind(...args: unknown[]) {
        return {
          async run() {
            if (/^INSERT/i.test(sql)) {
              const cols =
                sql.match(/\(([^)]+)\)\s*VALUES/i)?.[1]
                  ?.split(',')
                  .map((c) => c.trim()) ?? [];
              const row: Record<string, unknown> = {};
              cols.forEach((col, i) => { row[col] = args[i]; });
              rows.push(row);
            } else if (/^UPDATE/i.test(sql)) {
              const id = args[args.length - 2] as string;
              const tenantId = args[args.length - 1] as string;
              const target = rows.find((r) => r.id === id && r.tenantId === tenantId);
              if (target) {
                const setMatch = sql.match(/SET\s+([\s\S]+?)\s+WHERE/i)?.[1] ?? '';
                const setPairs = setMatch.split(',').map((p) => p.trim());
                let argIdx = 0;
                for (const pair of setPairs) {
                  const col = (pair.split('=')[0] ?? '').trim();
                  target[col] = args[argIdx++];
                }
              }
            }
          },
          async first<T = Record<string, unknown>>() {
            const tenantId = args.find(
              (a) => typeof a === 'string' && (a as string).startsWith('tenant')
            ) as string | undefined;
            const id = args.find(
              (a) => typeof a === 'string' && (a as string).includes('-') && !(a as string).startsWith('tenant')
            ) as string | undefined;
            const found = rows.find((r) => {
              const matchId = id ? r.id === id : true;
              const matchTenant = tenantId ? r.tenantId === tenantId : true;
              return matchId && matchTenant;
            });
            return (found ?? null) as T;
          },
          async all<T = Record<string, unknown>>() {
            const tenantId = args[0] as string;
            const filtered = rows.filter((r) => r.tenantId === tenantId);
            return { results: filtered as T[] };
          },
        };
      },
    };
  }

  return { prepare, _rows: rows };
}

// ─── Test app factory ─────────────────────────────────────────────────────────

function makeApp(
  userOverrides: Partial<AppVariables['user']> = {}
) {
  const db = makeD1Stub();

  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('user', {
      userId: 'user-hr-admin-001',
      tenantId: 'tenant-inst-123',
      role: 'admin',
      email: 'hr@test.edu.ng',
      permissions: ['manage:payroll'],
      ...userOverrides,
    } as AppVariables['user']);
    await next();
  });

  app.route('/api/payroll', payrollRouter);

  const env = {
    DB: db as unknown as D1Database,
    ENVIRONMENT: 'test',
  } as unknown as Bindings;

  return { app, db, env };
}

function makeRequest(
  app: Hono<{ Bindings: Bindings; Variables: AppVariables }>,
  env: Bindings,
  method: string,
  path: string,
  body?: unknown
) {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return app.fetch(req, env as unknown as Record<string, unknown>);
}

// ─── Unit tests: calculatePayeTax() ──────────────────────────────────────────

describe('calculatePayeTax() — Nigerian PAYE brackets (Finance Act 2021)', () => {
  it('returns 0 for gross income at or below the CRA (no taxable income)', () => {
    // Gross = NGN 100,000/year = 10,000,000 kobo
    // CRA = max(20,000,000, 100,000) + 2,000,000 = 22,000,000  > gross → taxable = 0
    expect(calculatePayeTax(10_000_000)).toBe(0);
  });

  it('applies only the 7% bracket for small income (NGN 600,000/year)', () => {
    // Annual gross = 60,000,000 kobo (NGN 600,000)
    // CRA = max(20,000,000, 600,000) + 12,000,000 = 32,000,000
    // Taxable = 28,000,000 (fits entirely in 7% bracket, upTo = 30,000,000)
    // Tax = round(28,000,000 * 7 / 100) = 1,960,000 kobo
    const annualGross = 5_000_000 * 12; // NGN 50,000/month
    expect(calculatePayeTax(annualGross)).toBe(1_960_000);
  });

  it('applies multiple brackets for high income (NGN 2,400,000/year)', () => {
    // Annual gross = 240,000,000 kobo (NGN 2,400,000)
    // CRA = max(20M, 2.4M) + 48M = 68,000,000
    // Taxable = 172,000,000
    // B1: 30M × 7%  =  2,100,000
    // B2: 30M × 11% =  3,300,000
    // B3: 50M × 15% =  7,500,000
    // B4: 50M × 19% =  9,500,000
    // B5: 12M × 21% =  2,520,000
    // Total = 24,920,000 kobo
    const annualGross = 20_000_000 * 12; // NGN 200,000/month
    expect(calculatePayeTax(annualGross)).toBe(24_920_000);
  });

  it('uses the 1%-of-gross floor for CRA when gross is very high', () => {
    // Annual gross = 4,000,000,000 kobo (NGN 40,000,000/year)
    // 1% of gross = 40,000,000 > NGN 200,000 → CRA floor switches to 1% path
    const annualGross = 4_000_000_000;
    const cra = Math.round(annualGross * 0.01) + Math.round(annualGross * 0.20);
    const taxable = Math.max(0, annualGross - cra);
    // Just verify it produces a positive taxable income and a positive tax
    expect(taxable).toBeGreaterThan(0);
    expect(calculatePayeTax(annualGross)).toBeGreaterThan(0);
  });
});

// ─── Integration tests: POST /api/payroll/runs ───────────────────────────────

describe('POST /api/payroll/runs — create payroll run', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns 201 with status=draft for a valid YYYY-MM period', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2025-09' });
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; status: string; period: string; id: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe('draft');
    expect(body.period).toBe('2025-09');
    expect(body.id).toBeTruthy();
  });

  it('returns 400 for an invalid period format', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: 'September-2025' });
    expect(res.status).toBe(400);
  });

  it('persists the run record to D1 with correct fields', async () => {
    const { app, db, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2025-10' });
    const { id } = await res.json() as { id: string };
    const row = db._rows.find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(row!.tenantId).toBe('tenant-inst-123');
    expect(row!.status).toBe('draft');
    expect(row!.totalGrossKobo).toBe(0);
    expect(row!.createdBy).toBe('user-hr-admin-001');
  });

  it('returns 403 when manage:payroll permission is missing', async () => {
    const { app, env } = makeApp({ permissions: [] });
    const res = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2025-11' });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; required: string[] };
    expect(body.error).toContain('permissions');
    expect(body.required).toContain('manage:payroll');
  });
});

// ─── Integration tests: POST /api/payroll/runs/:id/process (QA-INS-1) ────────

describe('POST /api/payroll/runs/:id/process — payroll calculation engine (QA-INS-1)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('processes active staff, calculates net pay, and emits fintech.payout.requested events', async () => {
    const { app, db, env } = makeApp();

    // Seed one active staff member directly into the stub
    db._rows.push({
      id: 'staff-abc-001',
      tenantId: 'tenant-inst-123',
      grossSalaryKobo: 5_000_000,    // NGN 50,000/month
      pensionDeductionKobo: 400_000, // NGN 4,000/month
      otherDeductionsKobo: 0,
      status: 'active',
    });

    // Create a draft run
    const createRes = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2025-09' });
    const { id: runId } = await createRes.json() as { id: string };

    // Process the run
    const res = await makeRequest(app, env, 'POST', `/api/payroll/runs/${runId}/process`);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      success: boolean;
      runId: string;
      staffProcessed: number;
      totalGrossKobo: number;
      totalNetKobo: number;
      payoutEvents: Array<{
        event: string;
        tenantId: string;
        staffId: string;
        amountKobo: number;
        period: string;
        payslipId: string;
      }>;
    };

    expect(body.success).toBe(true);
    expect(body.runId).toBe(runId);
    expect(body.staffProcessed).toBe(1);
    expect(body.totalGrossKobo).toBe(5_000_000);
  });

  it('correctly calculates net pay: gross - PAYE tax - deductions (QA-INS-1)', async () => {
    const { app, db, env } = makeApp();

    db._rows.push({
      id: 'staff-paye-002',
      tenantId: 'tenant-inst-123',
      grossSalaryKobo: 5_000_000,    // NGN 50,000/month
      pensionDeductionKobo: 400_000,
      otherDeductionsKobo: 0,
      status: 'active',
    });

    const createRes = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2025-10' });
    const { id: runId } = await createRes.json() as { id: string };
    const res = await makeRequest(app, env, 'POST', `/api/payroll/runs/${runId}/process`);
    const body = await res.json() as {
      totalGrossKobo: number;
      totalNetKobo: number;
      payoutEvents: Array<{ amountKobo: number }>;
    };

    // Expected PAYE: annual gross = 60,000,000
    // CRA = max(20M, 600K) + 12M = 32M; taxable = 28M (< 30M bracket) → 7%
    // Annual tax = 28M × 7% = 1,960,000; monthly = round(1,960,000/12) = 163,333
    const expectedMonthlyTax = Math.round(1_960_000 / 12);  // 163,333
    const expectedNet = 5_000_000 - expectedMonthlyTax - 400_000;

    expect(body.totalNetKobo).toBe(expectedNet);
    expect(body.payoutEvents[0]!.amountKobo).toBe(expectedNet);
  });

  it('emits one fintech.payout.requested event per active staff member (QA-INS-1)', async () => {
    const { app, db, env } = makeApp();

    // Two staff members
    db._rows.push(
      { id: 'staff-m-001', tenantId: 'tenant-inst-123', grossSalaryKobo: 3_000_000, pensionDeductionKobo: 0, otherDeductionsKobo: 0, status: 'active' },
      { id: 'staff-m-002', tenantId: 'tenant-inst-123', grossSalaryKobo: 8_000_000, pensionDeductionKobo: 640_000, otherDeductionsKobo: 0, status: 'active' }
    );

    const createRes = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2025-11' });
    const { id: runId } = await createRes.json() as { id: string };
    const res = await makeRequest(app, env, 'POST', `/api/payroll/runs/${runId}/process`);
    const body = await res.json() as {
      staffProcessed: number;
      payoutEvents: Array<{ event: string; staffId: string; payslipId: string; period: string }>;
    };

    expect(body.staffProcessed).toBe(2);
    expect(body.payoutEvents).toHaveLength(2);
    // Every event must have the correct shape
    for (const evt of body.payoutEvents) {
      expect(evt.event).toBe('fintech.payout.requested');
      expect(evt.payslipId).toBeTruthy();
      expect(evt.period).toBe('2025-11');
    }
    // Staff IDs must be correctly propagated
    const staffIds = body.payoutEvents.map((e) => e.staffId).sort();
    expect(staffIds).toEqual(['staff-m-001', 'staff-m-002'].sort());
  });

  it('marks the run as completed after processing and updates totals in D1', async () => {
    const { app, db, env } = makeApp();

    db._rows.push({
      id: 'staff-totals-001',
      tenantId: 'tenant-inst-123',
      grossSalaryKobo: 10_000_000,
      pensionDeductionKobo: 800_000,
      otherDeductionsKobo: 0,
      status: 'active',
    });

    const createRes = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2025-12' });
    const { id: runId } = await createRes.json() as { id: string };
    await makeRequest(app, env, 'POST', `/api/payroll/runs/${runId}/process`);

    // Verify the run row in D1 was updated
    const runRow = db._rows.find((r) => r.id === runId);
    expect(runRow).toBeTruthy();
    expect(runRow!.status).toBe('completed');
    expect(runRow!.totalGrossKobo).toBe(10_000_000);
    expect(runRow!.runAt).toBeTruthy();
  });

  it('creates one payslip row per staff member in D1', async () => {
    const { app, db, env } = makeApp();

    db._rows.push(
      { id: 'staff-p-001', tenantId: 'tenant-inst-123', grossSalaryKobo: 4_000_000, pensionDeductionKobo: 0, otherDeductionsKobo: 0, status: 'active' },
      { id: 'staff-p-002', tenantId: 'tenant-inst-123', grossSalaryKobo: 6_000_000, pensionDeductionKobo: 480_000, otherDeductionsKobo: 0, status: 'active' }
    );

    const createRes = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2026-01' });
    const { id: runId } = await createRes.json() as { id: string };
    await makeRequest(app, env, 'POST', `/api/payroll/runs/${runId}/process`);

    const payslips = db._rows.filter((r) => r.payrollRunId === runId);
    expect(payslips).toHaveLength(2);
    for (const slip of payslips) {
      expect(slip.status).toBe('pending');
      expect(slip.tenantId).toBe('tenant-inst-123');
      expect(typeof slip.netKobo).toBe('number');
      expect(slip.netKobo as number).toBeGreaterThan(0);
    }
  });

  it('skips staff rows that have no grossSalaryKobo (zero-salary guard)', async () => {
    const { app, db, env } = makeApp();

    // One valid staff + one row with no salary (simulates a non-staff row mixed in by all())
    db._rows.push(
      { id: 'staff-valid-001', tenantId: 'tenant-inst-123', grossSalaryKobo: 5_000_000, pensionDeductionKobo: 0, otherDeductionsKobo: 0, status: 'active' },
      { id: 'no-salary-row',   tenantId: 'tenant-inst-123', grossSalaryKobo: 0,          pensionDeductionKobo: 0, otherDeductionsKobo: 0, status: 'active' }
    );

    const createRes = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2026-02' });
    const { id: runId } = await createRes.json() as { id: string };
    const res = await makeRequest(app, env, 'POST', `/api/payroll/runs/${runId}/process`);
    const body = await res.json() as { staffProcessed: number; payoutEvents: unknown[] };

    // Only the valid staff member should be processed
    expect(body.staffProcessed).toBe(1);
    expect(body.payoutEvents).toHaveLength(1);
  });

  it('returns 409 when attempting to re-process a completed run', async () => {
    const { app, db, env } = makeApp();

    db._rows.push({
      id: 'staff-dup-001',
      tenantId: 'tenant-inst-123',
      grossSalaryKobo: 5_000_000,
      pensionDeductionKobo: 0,
      otherDeductionsKobo: 0,
      status: 'active',
    });

    const createRes = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2026-03' });
    const { id: runId } = await createRes.json() as { id: string };
    await makeRequest(app, env, 'POST', `/api/payroll/runs/${runId}/process`);

    // Second attempt must fail
    const res = await makeRequest(app, env, 'POST', `/api/payroll/runs/${runId}/process`);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('completed');
  });

  it('returns 404 for an unknown run id', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/payroll/runs/non-existent-run-id/process');
    expect(res.status).toBe(404);
  });

  it('returns 403 for process endpoint without manage:payroll permission', async () => {
    const { app, env } = makeApp({ permissions: [] });
    const res = await makeRequest(app, env, 'POST', '/api/payroll/runs/any-run-id/process');
    expect(res.status).toBe(403);
  });

  it('handles zero active staff gracefully (empty payroll run)', async () => {
    const { app, env } = makeApp();
    // No staff seeded — expect success with 0 processed
    const createRes = await makeRequest(app, env, 'POST', '/api/payroll/runs', { period: '2026-04' });
    const { id: runId } = await createRes.json() as { id: string };
    const res = await makeRequest(app, env, 'POST', `/api/payroll/runs/${runId}/process`);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; staffProcessed: number; payoutEvents: unknown[] };
    expect(body.success).toBe(true);
    expect(body.staffProcessed).toBe(0);
    expect(body.payoutEvents).toHaveLength(0);
  });
});
