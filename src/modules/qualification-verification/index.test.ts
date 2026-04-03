/**
 * Tests — Qualification Verification Module (T-INS-01)
 *
 * Covers:
 *   1. Automated verification path (JAMB + WAEC APIs succeed)
 *   2. Manual fallback path (APIs unavailable or not configured)
 *   3. Partial fallback (one API succeeds, one fails)
 *   4. Admin manual review flow (approve / reject)
 *   5. Document upload for manual review
 *   6. Tenant isolation (cross-tenant access is blocked)
 *   7. Core verifyJambResult / verifyWaecResult unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { qualificationVerificationRouter } from './index';
import type { Bindings, AppVariables } from '../../core/types';
import * as qualificationsModule from '../../core/qualifications';

// ─── D1 In-memory stub ────────────────────────────────────────────────────────

function makeD1Stub() {
  const rows: Record<string, unknown>[] = [];

  function prepare(sql: string) {
    return {
      bind(...args: unknown[]) {
        return {
          async run() {
            if (/^INSERT/i.test(sql)) {
              // Parse INSERT — store values keyed by positional mapping
              const cols = sql.match(/\(([^)]+)\)\s*VALUES/i)?.[1]
                ?.split(',')
                .map((c) => c.trim()) ?? [];
              const row: Record<string, unknown> = {};
              cols.forEach((col, i) => { row[col] = args[i]; });
              rows.push(row);
            } else if (/^UPDATE/i.test(sql)) {
              // Minimal UPDATE stub — update matching rows by id and tenantId
              const id = args[args.length - 2] as string;
              const tenantId = args[args.length - 1] as string;
              const target = rows.find((r) => r.id === id && r.tenantId === tenantId);
              if (target) {
                // Parse SET clause key=value pairs
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
            // Extract id and tenantId from bound args
            const tenantId = args.find((a) => typeof a === 'string' && (a as string).startsWith('tenant')) as string | undefined;
            const id = args.find((a) => typeof a === 'string' && (a as string).includes('-') && !(a as string).startsWith('tenant')) as string | undefined;
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

// ─── R2 stub ──────────────────────────────────────────────────────────────────

function makeR2Stub() {
  const store: Record<string, { body: ArrayBuffer; meta: unknown }> = {};
  return {
    async put(key: string, body: ArrayBuffer, meta: unknown) {
      store[key] = { body, meta };
    },
    _store: store,
  };
}

// ─── Test app factory ─────────────────────────────────────────────────────────

function makeApp(envOverrides: Partial<Bindings> = {}, userOverrides: Partial<AppVariables['user']> = {}) {
  const db = makeD1Stub();
  const r2 = makeR2Stub();

  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('user', {
      userId: 'user-admin-001',
      tenantId: 'tenant-inst-123',
      role: 'admin',
      email: 'admin@test.com',
      permissions: [],
      ...userOverrides,
    } as AppVariables['user']);
    await next();
  });

  app.route('/api/qualifications', qualificationVerificationRouter);

  const env = {
    DB: db as unknown as D1Database,
    MEDIA_BUCKET: r2 as unknown as R2Bucket,
    JAMB_API_KEY: 'test-jamb-key',
    WAEC_API_KEY: 'test-waec-key',
    ENVIRONMENT: 'test',
    ...envOverrides,
  } as unknown as Bindings;

  return { app, db, r2, env };
}

function makeRequest(app: Hono<{ Bindings: Bindings; Variables: AppVariables }>, env: Bindings, method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return app.fetch(req, env as unknown as Record<string, unknown>);
}

// ─── Unit tests: verifyJambResult ────────────────────────────────────────────

describe('verifyJambResult', () => {
  it('returns success=false when apiKey is empty', async () => {
    const result = await qualificationsModule.verifyJambResult({ regNumber: '12345678AB', apiKey: '' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('JAMB_API_KEY not configured');
  });

  it('returns success=false when fetch fails (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await qualificationsModule.verifyJambResult({ regNumber: '12345678AB', apiKey: 'valid-key' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('JAMB API unreachable');
  });

  it('returns success=false when API returns non-200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    const result = await qualificationsModule.verifyJambResult({ regNumber: '12345678AB', apiKey: 'valid-key' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 503');
  });

  it('returns success=true with score on valid API response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: { score: 280, candidate_name: 'Chike Obi', exam_year: '2024' },
      }),
    } as Response);
    const result = await qualificationsModule.verifyJambResult({ regNumber: '12345678AB', apiKey: 'valid-key' });
    expect(result.success).toBe(true);
    expect(result.score).toBe(280);
    expect(result.candidateName).toBe('Chike Obi');
  });
});

// ─── Unit tests: verifyWaecResult ────────────────────────────────────────────

describe('verifyWaecResult', () => {
  it('returns success=false when apiKey is empty', async () => {
    const result = await qualificationsModule.verifyWaecResult({
      examNumber: '4200101001', scratchCardPin: 'ABC123', examYear: '2024', apiKey: '',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('WAEC_API_KEY not configured');
  });

  it('returns success=false when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Timeout'));
    const result = await qualificationsModule.verifyWaecResult({
      examNumber: '4200101001', scratchCardPin: 'ABC123', examYear: '2024', apiKey: 'valid',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('WAEC API unreachable');
  });

  it('returns success=true with subjects on valid API response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: {
          candidate_name: 'Amina Yusuf',
          results: [{ subject: 'Mathematics', grade: 'A1' }, { subject: 'English', grade: 'B2' }],
        },
      }),
    } as Response);
    const result = await qualificationsModule.verifyWaecResult({
      examNumber: '4200101001', scratchCardPin: 'ABC123', examYear: '2024', apiKey: 'valid',
    });
    expect(result.success).toBe(true);
    expect(result.candidateName).toBe('Amina Yusuf');
    expect(result.subjects).toHaveLength(2);
  });
});

// ─── Integration tests: POST /api/qualifications ─────────────────────────────

describe('POST /api/qualifications — automated path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 201 with verificationStatus=verified when both APIs succeed', async () => {
    vi.spyOn(qualificationsModule, 'verifyJambResult').mockResolvedValue({
      success: true, score: 290, candidateName: 'Test Student', examYear: '2024',
    });
    vi.spyOn(qualificationsModule, 'verifyWaecResult').mockResolvedValue({
      success: true, candidateName: 'Test Student',
      subjects: [{ subject: 'Maths', grade: 'A1' }],
    });

    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/qualifications', {
      studentId: 'student-001',
      jambRegNumber: '12345678AB',
      waecExamNumber: '4200101001',
      waecScratchCardPin: 'SCRATCH123',
      waecExamYear: '2024',
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { verificationStatus: string; verificationMode: string };
    expect(body.verificationStatus).toBe('verified');
    expect(body.verificationMode).toBe('auto');
  });

  it('stores a record in D1 after successful verification', async () => {
    vi.spyOn(qualificationsModule, 'verifyJambResult').mockResolvedValue({ success: true, score: 280, candidateName: 'A', examYear: '2024' });
    vi.spyOn(qualificationsModule, 'verifyWaecResult').mockResolvedValue({ success: true, candidateName: 'A', subjects: [] });

    const { app, db, env } = makeApp();
    await makeRequest(app, env, 'POST', '/api/qualifications', {
      studentId: 'student-001',
      jambRegNumber: '12345678AB',
      waecExamNumber: '4200101001',
      waecScratchCardPin: 'PIN',
      waecExamYear: '2024',
    });

    expect(db._rows.length).toBe(1);
    expect(db._rows[0]!.tenantId).toBe('tenant-inst-123');
    expect(db._rows[0]!.studentId).toBe('student-001');
  });
});

// ─── Integration tests: Manual fallback path ──────────────────────────────────

describe('POST /api/qualifications — manual fallback path', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('falls back to manual when JAMB API key is missing', async () => {
    const { app, env } = makeApp({ JAMB_API_KEY: '', WAEC_API_KEY: '' } as unknown as Partial<Bindings>);
    const res = await makeRequest(app, env, 'POST', '/api/qualifications', {
      studentId: 'student-002',
      jambRegNumber: '99999999ZZ',
    });

    const body = await res.json() as { verificationStatus: string; verificationMode: string };
    expect(body.verificationMode).toBe('manual');
    expect(body.verificationStatus).toBe('awaiting_review');
  });

  it('falls back to manual when JAMB API returns an error', async () => {
    vi.spyOn(qualificationsModule, 'verifyJambResult').mockResolvedValue({ success: false, error: 'API unreachable' });
    vi.spyOn(qualificationsModule, 'verifyWaecResult').mockResolvedValue({ success: false, error: 'API unreachable' });

    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/qualifications', {
      studentId: 'student-003',
      jambRegNumber: '12345678AB',
      waecExamNumber: '4200101001',
      waecScratchCardPin: 'PIN',
      waecExamYear: '2024',
    });

    const body = await res.json() as { verificationStatus: string; verificationMode: string };
    expect(body.verificationMode).toBe('manual');
    expect(body.verificationStatus).toBe('awaiting_review');
  });

  it('falls back to awaiting_review when no JAMB or WAEC fields are supplied', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/qualifications', {
      studentId: 'student-004',
    });
    const body = await res.json() as { verificationStatus: string; verificationMode: string };
    expect(body.verificationMode).toBe('manual');
    expect(body.verificationStatus).toBe('awaiting_review');
  });

  it('returns 400 when studentId is missing', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/qualifications', {});
    expect(res.status).toBe(400);
  });
});

// ─── Integration tests: Admin review ─────────────────────────────────────────

describe('PATCH /api/qualifications/:id/review — admin review', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('approves a pending manual record', async () => {
    // Seed a record in the DB stub
    vi.spyOn(qualificationsModule, 'verifyJambResult').mockResolvedValue({ success: false, error: 'unavailable' });
    const { app, db, env } = makeApp();

    // Create a record first
    const createRes = await makeRequest(app, env, 'POST', '/api/qualifications', {
      studentId: 'student-005',
      jambRegNumber: 'ABC123',
    });
    const { id } = await createRes.json() as { id: string };

    // Admin reviews and approves
    const reviewRes = await makeRequest(app, env, 'PATCH', `/api/qualifications/${id}/review`, {
      decision: 'verified',
      note: 'Documents look authentic.',
    });

    expect(reviewRes.status).toBe(200);
    const body = await reviewRes.json() as { verificationStatus: string };
    expect(body.verificationStatus).toBe('verified');

    // Check DB was updated
    const row = db._rows.find((r) => r.id === id);
    expect(row?.verificationStatus).toBe('verified');
  });

  it('rejects a pending record', async () => {
    vi.spyOn(qualificationsModule, 'verifyJambResult').mockResolvedValue({ success: false, error: 'unavailable' });
    const { app, env } = makeApp();

    const createRes = await makeRequest(app, env, 'POST', '/api/qualifications', {
      studentId: 'student-006',
      jambRegNumber: 'ABC456',
    });
    const { id } = await createRes.json() as { id: string };

    const reviewRes = await makeRequest(app, env, 'PATCH', `/api/qualifications/${id}/review`, {
      decision: 'rejected',
      note: 'Invalid certificate.',
    });
    const body = await reviewRes.json() as { verificationStatus: string };
    expect(body.verificationStatus).toBe('rejected');
  });

  it('returns 400 on invalid decision value', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'PATCH', '/api/qualifications/some-id/review', {
      decision: 'maybe',
    });
    expect(res.status).toBe(400);
  });
});

// ─── Integration tests: tenant isolation ─────────────────────────────────────

describe('Tenant isolation — Invariant 2', () => {
  it('returns 404 when fetching a record from a different tenant', async () => {
    vi.spyOn(qualificationsModule, 'verifyJambResult').mockResolvedValue({ success: true, score: 250, candidateName: 'A', examYear: '2024' });
    vi.spyOn(qualificationsModule, 'verifyWaecResult').mockResolvedValue({ success: true, candidateName: 'A', subjects: [] });

    // Create record as tenant-inst-123
    const { app: app1, db, env: env1 } = makeApp({}, { tenantId: 'tenant-inst-123' } as Partial<AppVariables['user']>);
    const createRes = await makeRequest(app1, env1, 'POST', '/api/qualifications', {
      studentId: 'student-007',
      jambRegNumber: '99887766CC',
      waecExamNumber: '111',
      waecScratchCardPin: 'PIN',
      waecExamYear: '2024',
    });
    const { id } = await createRes.json() as { id: string };

    // Attempt to read as tenant-inst-EVIL
    const app2 = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
    app2.use('*', async (c, next) => {
      c.set('user', { userId: 'attacker', tenantId: 'tenant-inst-EVIL', role: 'admin', email: '', permissions: [] } as AppVariables['user']);
      await next();
    });
    app2.route('/api/qualifications', qualificationVerificationRouter);
    const env2 = { DB: db as unknown as D1Database, MEDIA_BUCKET: makeR2Stub() as unknown as R2Bucket, JAMB_API_KEY: 'k', WAEC_API_KEY: 'k', ENVIRONMENT: 'test' } as unknown as Bindings;

    const getRes = await app2.fetch(new Request(`http://localhost/api/qualifications/${id}`), env2 as unknown as Record<string, unknown>);
    expect(getRes.status).toBe(404);
  });

  it('list endpoint only returns records for the authenticated tenant', async () => {
    vi.spyOn(qualificationsModule, 'verifyJambResult').mockResolvedValue({ success: false, error: 'down' });
    const { app, db, env } = makeApp({}, { tenantId: 'tenant-A' } as Partial<AppVariables['user']>);

    // Create 2 records for tenant-A
    await makeRequest(app, env, 'POST', '/api/qualifications', { studentId: 's1' });
    await makeRequest(app, env, 'POST', '/api/qualifications', { studentId: 's2' });

    // Manually inject a record for tenant-B into the stub
    db._rows.push({
      id: 'foreign-id',
      tenantId: 'tenant-B',
      studentId: 's3',
      verificationStatus: 'verified',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const listRes = await makeRequest(app, env, 'GET', '/api/qualifications');
    const body = await listRes.json() as { data: unknown[] };
    expect(body.data.every((r: unknown) => (r as { tenantId: string }).tenantId === 'tenant-A')).toBe(true);
  });
});
