/**
 * Tests — AI Resource Allocation / Scheduler (QA-INS-2)
 *
 * Covers:
 *   1. getAICompletion() is called with a structured scheduling prompt
 *   2. Schedule is persisted with status='generated' on success
 *   3. AI platform outage (503 / network error) → status='failed' + retryHint
 *   4. Response body contains a valid conflict-free schedule array
 *   5. Markdown fence stripping from AI response
 *   6. New schedule can be created after a failure (retry)
 *   7. GET /api/scheduler/schedules list and detail
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { schedulerRouter } from './scheduler';
import type { Bindings, AppVariables } from '../../core/types';
import * as aiClient from '../../core/ai-platform-client';

// ─── D1 In-memory stub ────────────────────────────────────────────────────────

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

function makeApp(userOverrides: Partial<AppVariables['user']> = {}) {
  const db = makeD1Stub();

  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('user', {
      userId: 'user-admin-sched-001',
      tenantId: 'tenant-inst-123',
      role: 'admin',
      email: 'admin@school.edu.ng',
      permissions: [],
      ...userOverrides,
    } as AppVariables['user']);
    await next();
  });

  app.route('/api/scheduler', schedulerRouter);

  const env = {
    DB: db as unknown as D1Database,
    ENVIRONMENT: 'test',
    AI_PLATFORM_URL: 'https://ai.webwaka.test',
    INTER_SERVICE_SECRET: 'test-secret',
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

// Minimal valid payload for schedule generation
const VALID_PAYLOAD = {
  title: 'Semester 1 Timetable',
  type: 'academic',
  rooms: [
    { id: 'room-lh1', name: 'Lecture Hall 1', capacity: 200, facilities: ['projector', 'ac'] },
    { id: 'room-s101', name: 'Seminar Room 101', capacity: 40 },
  ],
  sessions: [
    { id: 'sess-cs101', name: 'CS101 Introduction to Programming', requiredCapacity: 150, durationMinutes: 60, instructor: 'Dr. Okonkwo' },
    { id: 'sess-mt201', name: 'MT201 Calculus', requiredCapacity: 35, durationMinutes: 90 },
  ],
};

// Valid AI response (conflict-free schedule JSON)
const MOCK_AI_SCHEDULE_JSON = JSON.stringify({
  schedule: [
    { sessionId: 'sess-cs101', sessionName: 'CS101 Introduction to Programming', roomId: 'room-lh1', roomName: 'Lecture Hall 1', startTime: '08:00', endTime: '09:00', day: 'Monday' },
    { sessionId: 'sess-mt201', sessionName: 'MT201 Calculus',                    roomId: 'room-s101', roomName: 'Seminar Room 101', startTime: '09:00', endTime: '10:30', day: 'Monday' },
  ],
  conflicts: [],
  notes: 'All sessions scheduled without conflicts.',
});

// ─── Integration tests: POST /api/scheduler/schedules ─────────────────────────

describe('POST /api/scheduler/schedules — AI schedule generation (QA-INS-2)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns 201 with success=true and a schedule array when AI responds correctly', async () => {
    vi.spyOn(aiClient, 'getAICompletion').mockResolvedValue({
      content: MOCK_AI_SCHEDULE_JSON,
      model: 'openai/gpt-4o',
      usage: { promptTokens: 300, completionTokens: 120, totalTokens: 420 },
    });

    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', VALID_PAYLOAD);

    expect(res.status).toBe(201);
    const body = await res.json() as {
      success: boolean;
      status: string;
      id: string;
      data: { schedule: unknown[]; conflicts: unknown[]; notes: string };
    };
    expect(body.success).toBe(true);
    expect(body.status).toBe('generated');
    expect(body.id).toBeTruthy();
    expect(Array.isArray(body.data.schedule)).toBe(true);
    expect(body.data.schedule).toHaveLength(2);
    expect(body.data.conflicts).toHaveLength(0);
  });

  it('calls getAICompletion() with the scheduling prompt containing room and session details', async () => {
    const spy = vi.spyOn(aiClient, 'getAICompletion').mockResolvedValue({
      content: MOCK_AI_SCHEDULE_JSON,
      model: 'openai/gpt-4o',
      usage: { promptTokens: 300, completionTokens: 120, totalTokens: 420 },
    });

    const { app, env } = makeApp();
    await makeRequest(app, env, 'POST', '/api/scheduler/schedules', VALID_PAYLOAD);

    expect(spy).toHaveBeenCalledOnce();
    const [, params, tenantId] = spy.mock.calls[0]!;
    expect(params.prompt).toContain('Lecture Hall 1');
    expect(params.prompt).toContain('Seminar Room 101');
    expect(params.prompt).toContain('CS101 Introduction to Programming');
    expect(params.capabilityId).toBe('ai.institutional.scheduling');
    expect(tenantId).toBe('tenant-inst-123');
  });

  it('strips markdown code fences from AI response before JSON parsing', async () => {
    const markdownWrapped = `\`\`\`json\n${MOCK_AI_SCHEDULE_JSON}\n\`\`\``;
    vi.spyOn(aiClient, 'getAICompletion').mockResolvedValue({
      content: markdownWrapped,
      model: 'openai/gpt-4o',
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    });

    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', VALID_PAYLOAD);
    const body = await res.json() as { success: boolean; data: { schedule: unknown[] } };

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.schedule)).toBe(true);
  });

  it('persists the schedule to D1 with status=generated after AI success', async () => {
    vi.spyOn(aiClient, 'getAICompletion').mockResolvedValue({
      content: MOCK_AI_SCHEDULE_JSON,
      model: 'openai/gpt-4o',
      usage: { promptTokens: 300, completionTokens: 120, totalTokens: 420 },
    });

    const { app, db, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', VALID_PAYLOAD);
    const { id } = await res.json() as { id: string };

    const row = db._rows.find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(row!.status).toBe('generated');
    expect(row!.tenantId).toBe('tenant-inst-123');
    expect(row!.title).toBe('Semester 1 Timetable');
    expect(row!.tokensUsed).toBe(420);
  });
});

// ─── Integration tests: AI upstream outage ─────────────────────────────────────

describe('AI upstream outage resilience — QA-INS-2 + Section 3', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns success=false, status=failed, and a retryHint when AI platform returns 503', async () => {
    vi.spyOn(aiClient, 'getAICompletion').mockRejectedValue(
      new Error('AI Platform error 503: Service Unavailable')
    );

    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', VALID_PAYLOAD);

    // HTTP layer: still 201 (we saved the request)
    expect(res.status).toBe(201);
    const body = await res.json() as {
      success: boolean;
      status: string;
      data: { error: string };
      retryHint: string;
    };

    // Response body must clearly communicate failure
    expect(body.success).toBe(false);
    expect(body.status).toBe('failed');
    expect(body.data.error).toContain('503');
    // retryHint gives human-readable guidance so the caller knows to retry
    expect(typeof body.retryHint).toBe('string');
    expect(body.retryHint.length).toBeGreaterThan(10);
  });

  it('returns success=false when AI platform is unreachable (network error)', async () => {
    vi.spyOn(aiClient, 'getAICompletion').mockRejectedValue(new Error('ETIMEDOUT'));

    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', VALID_PAYLOAD);
    const body = await res.json() as { success: boolean; status: string; retryHint: string };

    expect(body.success).toBe(false);
    expect(body.status).toBe('failed');
    expect(body.retryHint).toBeTruthy();
  });

  it('persists the failed schedule to D1 so the caller can reference it for retry', async () => {
    vi.spyOn(aiClient, 'getAICompletion').mockRejectedValue(new Error('Network error'));

    const { app, db, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', VALID_PAYLOAD);
    const { id } = await res.json() as { id: string };

    const row = db._rows.find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(row!.status).toBe('failed');
  });

  it('allows creating a new schedule after a failure (retry semantics)', async () => {
    // First attempt fails
    vi.spyOn(aiClient, 'getAICompletion').mockRejectedValueOnce(new Error('Timeout'));

    const { app, env } = makeApp();
    const res1 = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', VALID_PAYLOAD);
    const body1 = await res1.json() as { status: string };
    expect(body1.status).toBe('failed');

    // Second attempt succeeds
    vi.spyOn(aiClient, 'getAICompletion').mockResolvedValue({
      content: MOCK_AI_SCHEDULE_JSON,
      model: 'openai/gpt-4o',
      usage: { promptTokens: 300, completionTokens: 120, totalTokens: 420 },
    });

    const res2 = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', {
      ...VALID_PAYLOAD,
      title: 'Semester 1 Timetable — Retry',
    });
    const body2 = await res2.json() as { success: boolean; status: string };
    expect(body2.success).toBe(true);
    expect(body2.status).toBe('generated');
  });
});

// ─── Integration tests: validation ────────────────────────────────────────────

describe('POST /api/scheduler/schedules — validation', () => {
  it('returns 400 when rooms array is empty', async () => {
    vi.spyOn(aiClient, 'getAICompletion').mockResolvedValue({
      content: MOCK_AI_SCHEDULE_JSON,
      model: 'openai/gpt-4o',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', {
      ...VALID_PAYLOAD,
      rooms: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when sessions array is empty', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', {
      ...VALID_PAYLOAD,
      sessions: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is missing', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/scheduler/schedules', {
      rooms: VALID_PAYLOAD.rooms,
      sessions: VALID_PAYLOAD.sessions,
    });
    expect(res.status).toBe(400);
  });
});

// ─── Integration tests: GET endpoints ─────────────────────────────────────────

describe('GET /api/scheduler/schedules', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('lists all schedules for the tenant', async () => {
    vi.spyOn(aiClient, 'getAICompletion').mockResolvedValue({
      content: MOCK_AI_SCHEDULE_JSON,
      model: 'openai/gpt-4o',
      usage: { promptTokens: 300, completionTokens: 120, totalTokens: 420 },
    });

    const { app, env } = makeApp();
    await makeRequest(app, env, 'POST', '/api/scheduler/schedules', VALID_PAYLOAD);
    await makeRequest(app, env, 'POST', '/api/scheduler/schedules', { ...VALID_PAYLOAD, title: 'Exam Schedule' });

    const res = await makeRequest(app, env, 'GET', '/api/scheduler/schedules');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });

  it('returns 404 for an unknown schedule id', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'GET', '/api/scheduler/schedules/non-existent-sched-uuid');
    expect(res.status).toBe(404);
  });
});
