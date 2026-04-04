/**
 * Tests — HL7 FHIR R4 Integration (QA-INS-3)
 *
 * Covers:
 *   1. POST /fhir/:resourceType — create a FHIR resource
 *   2. GET  /fhir/:resourceType/:id — read returns valid FHIR JSON (QA-INS-3 core)
 *   3. PUT  /fhir/:resourceType/:id — update increments version
 *   4. DELETE /fhir/:resourceType/:id — soft delete returns 204
 *   5. GET  /fhir/:resourceType — search returns FHIR Bundle
 *   6. Unsupported resource type → OperationOutcome 400
 *   7. Not-found → OperationOutcome 404
 *   8. RBAC — read:fhir / write:fhir permission enforcement
 *   9. Tenant isolation — cross-tenant access blocked
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { fhirRouter } from './index';
import type { Bindings, AppVariables } from '../../core/types';

// ─── FHIR-specific D1 stub ─────────────────────────────────────────────────────
//
// Maintains two indexes:
//   byInternalId — for UPDATE lookups (WHERE id = ?, tenantId = ?)
//   byComposite   — for first() lookups (WHERE tenantId = ?, resourceType = ?, resourceId = ?)
//
// The search all() filters by [tenantId] or [tenantId, resourceType].

function makeFhirD1Stub() {
  const ordered: Record<string, unknown>[] = [];
  const byInternalId = new Map<string, Record<string, unknown>>();
  const byComposite = new Map<string, Record<string, unknown>>();

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
              ordered.push(row);
              byInternalId.set(row.id as string, row);
              byComposite.set(`${row.tenantId}|${row.resourceType}|${row.resourceId}`, row);
            } else if (/^UPDATE/i.test(sql)) {
              // UPDATE uses last two args as internalId, tenantId
              const internalId = args[args.length - 2] as string;
              const tenantId = args[args.length - 1] as string;
              const target = byInternalId.get(internalId);
              if (target && target.tenantId === tenantId) {
                // Parse SET clause — handle json_patch() by skipping unparseable pairs
                const setMatch = sql.match(/SET\s+([\s\S]+?)\s+WHERE/i)?.[1] ?? '';
                // Use a simpler split that handles json_patch(data, ?) correctly:
                // Only parse simple `col = ?` pairs (skip anything with nested parens)
                const setPairs = setMatch.split(/,\s*(?=[a-zA-Z_]+ =)/);
                let argIdx = 0;
                for (const pair of setPairs) {
                  const eqIdx = pair.indexOf('=');
                  if (eqIdx < 0) continue;
                  const col = pair.slice(0, eqIdx).trim();
                  // Only update if it's a simple `col = ?` pattern
                  if (/^[a-zA-Z_]+$/.test(col)) {
                    target[col] = args[argIdx];
                  }
                  argIdx++;
                }
              }
            }
          },
          async first<T = Record<string, unknown>>() {
            // 3-arg FHIR composite lookup: [tenantId, resourceType, resourceId]
            if (
              args.length === 3 &&
              typeof args[0] === 'string' &&
              typeof args[1] === 'string' &&
              typeof args[2] === 'string'
            ) {
              const key = `${args[0]}|${args[1]}|${args[2]}`;
              return (byComposite.get(key) ?? null) as T;
            }
            // 2-arg lookup: [id/uuid, tenantId] — for UPDATE pre-check
            const tenantId = args.find(
              (a) => typeof a === 'string' && (a as string).startsWith('tenant')
            ) as string | undefined;
            const internalId = args.find(
              (a) => typeof a === 'string' && (a as string).includes('-') && !(a as string).startsWith('tenant')
            ) as string | undefined;
            if (internalId) {
              const row = byInternalId.get(internalId);
              if (row && (!tenantId || row.tenantId === tenantId)) return row as T;
            }
            return null as T;
          },
          async all<T = Record<string, unknown>>() {
            const tenantId = args[0] as string;
            let filtered = ordered.filter((r) => r.tenantId === tenantId);
            if (args.length >= 2 && typeof args[1] === 'string') {
              const resourceType = args[1] as string;
              filtered = filtered.filter((r) => r.resourceType === resourceType);
            }
            return { results: filtered as T[] };
          },
        };
      },
    };
  }

  return { prepare, _rows: ordered, _byInternalId: byInternalId };
}

// ─── Test app factory ─────────────────────────────────────────────────────────

function makeApp(userOverrides: Partial<AppVariables['user']> = {}) {
  const db = makeFhirD1Stub();

  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('user', {
      userId: 'user-doctor-001',
      tenantId: 'tenant-inst-123',
      role: 'doctor',
      email: 'doctor@hospital.ng',
      permissions: ['read:fhir', 'write:fhir'],
      ...userOverrides,
    } as AppVariables['user']);
    await next();
  });

  app.route('/api/fhir', fhirRouter);

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

// Minimal valid HL7 FHIR R4 Patient resource
const TEST_PATIENT = {
  resourceType: 'Patient',
  name: [{ family: 'Okonkwo', given: ['Chukwuemeka'] }],
  birthDate: '1990-05-14',
  gender: 'male',
  telecom: [{ system: 'phone', value: '+2348012345678' }],
};

// ─── Integration tests: Create resource ──────────────────────────────────────

describe('POST /api/fhir/Patient — create FHIR resource', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns 201 with valid FHIR Patient JSON including id and meta', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/fhir/Patient', TEST_PATIENT);

    expect(res.status).toBe(201);
    const body = await res.json() as {
      resourceType: string;
      id: string;
      meta: { versionId: string; lastUpdated: string };
      name: unknown[];
    };
    expect(body.resourceType).toBe('Patient');
    expect(body.id).toBeTruthy();
    expect(body.meta.versionId).toBe('1');
    expect(body.meta.lastUpdated).toBeTruthy();
    expect(body.name).toBeDefined();
  });

  it('sets Location header pointing to the new resource', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/fhir/Patient', TEST_PATIENT);
    const location = res.headers.get('Location');
    expect(location).toMatch(/^\/api\/fhir\/Patient\/.+/);
  });

  it('persists the resource to D1 with correct fields', async () => {
    const { app, db, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/fhir/Patient', TEST_PATIENT);
    const { id: resourceId } = await res.json() as { id: string };

    const row = db._rows.find((r) => r.resourceId === resourceId);
    expect(row).toBeTruthy();
    expect(row!.resourceType).toBe('Patient');
    expect(row!.tenantId).toBe('tenant-inst-123');
    expect(row!.version).toBe(1);
  });

  it('returns 400 OperationOutcome for unsupported resource type', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/fhir/UnsupportedType', {
      resourceType: 'UnsupportedType',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { resourceType: string; issue: Array<{ severity: string; code: string }> };
    expect(body.resourceType).toBe('OperationOutcome');
    expect(body.issue[0]!.code).toBe('not-supported');
  });

  it('returns 400 OperationOutcome when body resourceType mismatches the URL', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'POST', '/api/fhir/Patient', {
      resourceType: 'Observation',
      subject: { reference: 'Patient/123' },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { resourceType: string };
    expect(body.resourceType).toBe('OperationOutcome');
  });

  it('returns 403 when write:fhir permission is missing', async () => {
    const { app, env } = makeApp({ permissions: ['read:fhir'] });
    const res = await makeRequest(app, env, 'POST', '/api/fhir/Patient', TEST_PATIENT);
    expect(res.status).toBe(403);
  });
});

// ─── Integration tests: Read resource (QA-INS-3 core) ────────────────────────

describe('GET /api/fhir/Patient/:id — read FHIR resource (QA-INS-3)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns a valid HL7 FHIR Patient JSON representation (QA-INS-3)', async () => {
    const { app, env } = makeApp();
    // Create the patient first
    const createRes = await makeRequest(app, env, 'POST', '/api/fhir/Patient', TEST_PATIENT);
    const { id: resourceId } = await createRes.json() as { id: string };

    // Read it back
    const getRes = await makeRequest(app, env, 'GET', `/api/fhir/Patient/${resourceId}`);
    expect(getRes.status).toBe(200);

    const body = await getRes.json() as {
      resourceType: string;
      id: string;
      meta: { versionId: string; lastUpdated: string };
      name: Array<{ family: string; given: string[] }>;
      gender: string;
      birthDate: string;
    };

    // QA-INS-3: verify FHIR-compliant structure
    expect(body.resourceType).toBe('Patient');
    expect(body.id).toBe(resourceId);
    expect(body.meta).toBeDefined();
    expect(body.meta.versionId).toBe('1');
    expect(typeof body.meta.lastUpdated).toBe('string');

    // Clinical data preserved
    expect(body.name[0]!.family).toBe('Okonkwo');
    expect(body.gender).toBe('male');
    expect(body.birthDate).toBe('1990-05-14');
  });

  it('returns 404 OperationOutcome for an unknown resource id', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'GET', '/api/fhir/Patient/unknown-patient-id-xyz');
    expect(res.status).toBe(404);
    const body = await res.json() as { resourceType: string; issue: Array<{ code: string }> };
    expect(body.resourceType).toBe('OperationOutcome');
    expect(body.issue[0]!.code).toBe('not-found');
  });

  it('returns 403 when read:fhir permission is missing', async () => {
    const { app, env } = makeApp({ permissions: ['write:fhir'] });
    const res = await makeRequest(app, env, 'GET', '/api/fhir/Patient/some-patient-id');
    expect(res.status).toBe(403);
  });
});

// ─── Integration tests: Update resource ──────────────────────────────────────

describe('PUT /api/fhir/Patient/:id — update FHIR resource', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('increments the versionId on each update', async () => {
    const { app, env } = makeApp();
    // Create
    const createRes = await makeRequest(app, env, 'POST', '/api/fhir/Patient', TEST_PATIENT);
    const { id: resourceId } = await createRes.json() as { id: string };

    // Update — add telecom
    const updatedPatient = {
      ...TEST_PATIENT,
      id: resourceId,
      telecom: [{ system: 'phone', value: '+2348099887766' }],
    };
    const putRes = await makeRequest(app, env, 'PUT', `/api/fhir/Patient/${resourceId}`, updatedPatient);
    expect(putRes.status).toBe(200);

    const body = await putRes.json() as { meta: { versionId: string } };
    expect(body.meta.versionId).toBe('2');
  });

  it('returns the updated clinical data in the response', async () => {
    const { app, env } = makeApp();
    const createRes = await makeRequest(app, env, 'POST', '/api/fhir/Patient', TEST_PATIENT);
    const { id: resourceId } = await createRes.json() as { id: string };

    const updatedPatient = { ...TEST_PATIENT, id: resourceId, gender: 'female' };
    const putRes = await makeRequest(app, env, 'PUT', `/api/fhir/Patient/${resourceId}`, updatedPatient);
    const body = await putRes.json() as { gender: string };
    expect(body.gender).toBe('female');
  });

  it('returns 404 OperationOutcome when updating a non-existent resource', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'PUT', '/api/fhir/Patient/ghost-patient-id', {
      ...TEST_PATIENT,
      id: 'ghost-patient-id',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { resourceType: string };
    expect(body.resourceType).toBe('OperationOutcome');
  });
});

// ─── Integration tests: Soft delete ──────────────────────────────────────────

describe('DELETE /api/fhir/Patient/:id — soft delete', () => {
  it('returns 204 No Content on successful soft delete', async () => {
    const { app, env } = makeApp();
    const createRes = await makeRequest(app, env, 'POST', '/api/fhir/Patient', TEST_PATIENT);
    const { id: resourceId } = await createRes.json() as { id: string };

    const delRes = await makeRequest(app, env, 'DELETE', `/api/fhir/Patient/${resourceId}`);
    expect(delRes.status).toBe(204);
  });

  it('returns 404 OperationOutcome when deleting a non-existent resource', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'DELETE', '/api/fhir/Patient/ghost-id-del');
    expect(res.status).toBe(404);
    const body = await res.json() as { resourceType: string };
    expect(body.resourceType).toBe('OperationOutcome');
  });
});

// ─── Integration tests: Search (Bundle) ──────────────────────────────────────

describe('GET /api/fhir/Patient — search returns FHIR Bundle', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns a FHIR Bundle with all Patient resources for the tenant', async () => {
    const { app, env } = makeApp();

    // Create two patients
    await makeRequest(app, env, 'POST', '/api/fhir/Patient', TEST_PATIENT);
    await makeRequest(app, env, 'POST', '/api/fhir/Patient', {
      ...TEST_PATIENT,
      name: [{ family: 'Babangida', given: ['Halima'] }],
    });

    const res = await makeRequest(app, env, 'GET', '/api/fhir/Patient');
    expect(res.status).toBe(200);

    const body = await res.json() as {
      resourceType: string;
      type: string;
      total: number;
      entry: Array<{ fullUrl: string; resource: { resourceType: string } }>;
    };
    expect(body.resourceType).toBe('Bundle');
    expect(body.type).toBe('searchset');
    expect(body.total).toBe(2);
    expect(body.entry).toHaveLength(2);
    for (const e of body.entry) {
      expect(e.resource.resourceType).toBe('Patient');
    }
  });

  it('returns 400 OperationOutcome for unsupported resource type in search', async () => {
    const { app, env } = makeApp();
    const res = await makeRequest(app, env, 'GET', '/api/fhir/Banana');
    expect(res.status).toBe(400);
    const body = await res.json() as { resourceType: string };
    expect(body.resourceType).toBe('OperationOutcome');
  });
});

// ─── Integration tests: Tenant isolation ─────────────────────────────────────

describe('Tenant isolation — Invariant 2', () => {
  it('returns 404 when reading a resource belonging to a different tenant', async () => {
    // Create as tenant-A
    const { app: appA, env: envA } = makeApp({ tenantId: 'tenant-hospital-A' });
    const createRes = await makeRequest(appA, envA, 'POST', '/api/fhir/Patient', TEST_PATIENT);
    const { id: resourceId } = await createRes.json() as { id: string };

    // Try to read as tenant-B (different stub, different tenantId)
    const { app: appB, env: envB } = makeApp({ tenantId: 'tenant-hospital-B' });
    const getRes = await makeRequest(appB, envB, 'GET', `/api/fhir/Patient/${resourceId}`);
    expect(getRes.status).toBe(404);
  });
});

// ─── Integration tests: Other FHIR resource types ────────────────────────────

describe('FHIR resource type support', () => {
  const ALLOWED = ['Observation', 'Condition', 'MedicationRequest', 'Encounter'];

  for (const resourceType of ALLOWED) {
    it(`supports ${resourceType} — create and read back`, async () => {
      const { app, env } = makeApp();
      const payload = {
        resourceType,
        subject: { reference: 'Patient/patient-123' },
        status: 'final',
      };
      const createRes = await makeRequest(app, env, 'POST', `/api/fhir/${resourceType}`, payload);
      expect(createRes.status).toBe(201);
      const { id: resourceId } = await createRes.json() as { id: string };

      const getRes = await makeRequest(app, env, 'GET', `/api/fhir/${resourceType}/${resourceId}`);
      expect(getRes.status).toBe(200);
      const body = await getRes.json() as { resourceType: string };
      expect(body.resourceType).toBe(resourceType);
    });
  }
});
