/**
 * HL7 FHIR R4 Integration — WebWaka Institutional Suite
 *
 * Standard healthcare data interoperability: Patient, Observation, Condition,
 * MedicationRequest, and other FHIR resource types stored and served via
 * a RESTful FHIR-compatible interface.
 *
 * Invariant 2: tenantId always from JWT; FHIR resources are tenant-scoped.
 *
 * Routes:
 *   POST  /api/fhir/:resourceType         — Create or update a FHIR resource
 *   GET   /api/fhir/:resourceType         — Search resources (by query params)
 *   GET   /api/fhir/:resourceType/:id     — Read a FHIR resource
 *   PUT   /api/fhir/:resourceType/:id     — Full update (version increment)
 *   DELETE /api/fhir/:resourceType/:id    — Logical delete (soft)
 *   GET   /api/fhir/$export              — Bulk export (NDJSON, tenant-scoped)
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const fhirRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const ALLOWED_RESOURCE_TYPES = new Set([
  'Patient', 'Observation', 'Condition', 'MedicationRequest',
  'Procedure', 'AllergyIntolerance', 'DiagnosticReport',
  'Encounter', 'Immunization', 'Practitioner',
]);

function fhirError(code: string, diagnostics: string, status: number) {
  return {
    status,
    body: {
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code, diagnostics }],
    },
  };
}

// ─── POST /:resourceType — Create ─────────────────────────────────────────────
fhirRouter.post('/:resourceType', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const resourceType = c.req.param('resourceType');

  if (!ALLOWED_RESOURCE_TYPES.has(resourceType)) {
    const err = fhirError('not-supported', `Resource type '${resourceType}' is not supported`, 400);
    return c.json(err.body, err.status as 400);
  }

  const data = await c.req.json<Record<string, unknown>>();
  if (data.resourceType !== resourceType) {
    const err = fhirError('invalid', `resourceType in body must be '${resourceType}'`, 400);
    return c.json(err.body, err.status as 400);
  }

  const resourceId = (data.id as string | undefined) ?? crypto.randomUUID();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  data.id = resourceId;
  data.meta = { versionId: '1', lastUpdated: now };

  await c.env.DB.prepare(
    `INSERT INTO fhirResources (id, tenantId, resourceType, resourceId, version, data, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
  ).bind(id, tenantId, resourceType, resourceId, JSON.stringify(data), now, now).run();

  return c.json(data, 201, { 'Location': `/api/fhir/${resourceType}/${resourceId}` });
});

// ─── GET /:resourceType — Search ─────────────────────────────────────────────
fhirRouter.get('/:resourceType', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const resourceType = c.req.param('resourceType');

  if (!ALLOWED_RESOURCE_TYPES.has(resourceType)) {
    const err = fhirError('not-supported', `Resource type '${resourceType}' is not supported`, 400);
    return c.json(err.body, err.status as 400);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT data FROM fhirResources WHERE tenantId = ? AND resourceType = ? ORDER BY updatedAt DESC LIMIT 100'
  ).bind(tenantId, resourceType).all<{ data: string }>();

  const entries = results.map((r) => ({
    fullUrl: `/api/fhir/${resourceType}`,
    resource: JSON.parse(r.data),
  }));

  return c.json({
    resourceType: 'Bundle',
    type: 'searchset',
    total: entries.length,
    entry: entries,
  });
});

// ─── GET /:resourceType/:id — Read ────────────────────────────────────────────
fhirRouter.get('/:resourceType/:id', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const resourceType = c.req.param('resourceType');
  const resourceId = c.req.param('id');

  const record = await c.env.DB.prepare(
    'SELECT data FROM fhirResources WHERE tenantId = ? AND resourceType = ? AND resourceId = ?'
  ).bind(tenantId, resourceType, resourceId).first<{ data: string }>();

  if (!record) {
    const err = fhirError('not-found', `${resourceType}/${resourceId} not found`, 404);
    return c.json(err.body, err.status as 404);
  }

  return c.json(JSON.parse(record.data));
});

// ─── PUT /:resourceType/:id — Update ─────────────────────────────────────────
fhirRouter.put('/:resourceType/:id', requireRole(['admin', 'doctor', 'nurse']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const resourceType = c.req.param('resourceType');
  const resourceId = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, version FROM fhirResources WHERE tenantId = ? AND resourceType = ? AND resourceId = ?'
  ).bind(tenantId, resourceType, resourceId).first<{ id: string; version: number }>();

  if (!existing) {
    const err = fhirError('not-found', `${resourceType}/${resourceId} not found`, 404);
    return c.json(err.body, err.status as 404);
  }

  const data = await c.req.json<Record<string, unknown>>();
  const newVersion = existing.version + 1;
  const now = new Date().toISOString();
  data.id = resourceId;
  data.meta = { versionId: String(newVersion), lastUpdated: now };

  await c.env.DB.prepare(
    'UPDATE fhirResources SET data = ?, version = ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
  ).bind(JSON.stringify(data), newVersion, now, existing.id, tenantId).run();

  return c.json(data);
});

// ─── DELETE /:resourceType/:id — Soft delete ─────────────────────────────────
fhirRouter.delete('/:resourceType/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const resourceType = c.req.param('resourceType');
  const resourceId = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM fhirResources WHERE tenantId = ? AND resourceType = ? AND resourceId = ?'
  ).bind(tenantId, resourceType, resourceId).first<{ id: string }>();

  if (!existing) {
    const err = fhirError('not-found', `${resourceType}/${resourceId} not found`, 404);
    return c.json(err.body, err.status as 404);
  }

  // Soft delete: mark deleted in the JSON data
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE fhirResources
     SET data = json_patch(data, '{"meta":{"deleted":true,"lastUpdated":"${now}"}}'), updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(now, existing.id, tenantId).run();

  return new Response(null, { status: 204 });
});

// ─── GET /$export — Bulk NDJSON export ───────────────────────────────────────
fhirRouter.get('/\\$export', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { results } = await c.env.DB.prepare(
    'SELECT data FROM fhirResources WHERE tenantId = ? ORDER BY resourceType, updatedAt DESC'
  ).bind(tenantId).all<{ data: string }>();

  const ndjson = results.map((r) => r.data).join('\n');
  return new Response(ndjson, {
    headers: {
      'Content-Type': 'application/fhir+ndjson',
      'Content-Disposition': `attachment; filename="fhir-export-${tenantId}.ndjson"`,
    },
  });
});
