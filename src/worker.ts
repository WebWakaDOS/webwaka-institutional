/**
 * WebWaka Institutional Suite — Worker Entry Point
 *
 * Platform: Cloudflare Workers + Hono
 * Invariants enforced:
 *   1. Build Once Use Infinitely — all auth from @webwaka/core
 *   2. Mobile First — Hono lightweight API
 *   3. PWA First — Cloudflare Workers + Pages
 *   4. Offline First — Dexie offline store in client
 *   5. Nigeria First — Paystack kobo, en-NG locale
 *   6. Africa First — 7-locale i18n
 *   7. Vendor Neutral AI — OpenRouter abstraction only
 */

import { Hono } from 'hono';
import { jwtAuthMiddleware, secureCORS, rateLimit } from '@webwaka/core';
import type { Bindings, AppVariables } from './core/types';

// ─── Existing Modules ─────────────────────────────────────────────────────────
import { studentMgmtRouter }                  from './modules/student-mgmt/index';
import { staffMgmtRouter }                    from './modules/staff-mgmt/index';
import { feeCollectionRouter }                from './modules/fee-collection/index';
import { qualificationVerificationRouter }    from './modules/qualification-verification/index';

// ─── Phase 1: Core ERP & HR ───────────────────────────────────────────────────
import { payrollRouter }                      from './modules/hr/payroll';
import { procurementRouter }                  from './modules/procurement/index';

// ─── Phase 2a: Education Vertical ────────────────────────────────────────────
import { sisRouter }                          from './modules/sis/index';
import { lmsRouter }                          from './modules/lms/index';

// ─── Phase 2b: Healthcare Vertical ───────────────────────────────────────────
import { ehrRouter }                          from './modules/ehr/index';
import { telemedicineRouter }                 from './modules/telemedicine/index';
import { fhirRouter }                         from './modules/fhir/index';

// ─── Phase 3: AI & Optimization ──────────────────────────────────────────────
import { schedulerRouter }                    from './modules/operations/scheduler';
import { dataAnonRouter }                     from './modules/data-anon/index';

// ─── Operational Modules ──────────────────────────────────────────────────────
import { assetsRouter }                       from './modules/assets/index';
import { visitorRouter }                      from './modules/visitor/index';
import { alumniRouter }                       from './modules/alumni/index';
import { libraryRouter }                      from './modules/library/index';
import { cafeteriaRouter }                    from './modules/cafeteria/index';
import { attendanceRouter }                   from './modules/attendance/index';
import { incidentsRouter }                    from './modules/incidents/index';
import { dmsRouter }                          from './modules/dms/index';
import { campusRouter }                       from './modules/campus/index';
import { parentPortalRouter }                 from './modules/parent-portal/index';
import { insuranceRouter }                    from './modules/insurance/index';

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Global Middleware ────────────────────────────────────────────────────────

// Invariant: No wildcard CORS — environment-aware allowlist only
app.use('*', secureCORS());

// Rate limiting on auth and mutation endpoints
app.use('/api/auth/*', rateLimit({ limit: 10, windowSeconds: 60, keyPrefix: 'institutional-auth' }));

// JWT authentication on all /api/* routes
// tenantId is ALWAYS extracted from JWT payload — NEVER from headers or body
app.use('/api/*', jwtAuthMiddleware());

// ─── Health Check (unauthenticated) ──────────────────────────────────────────
app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'webwaka-institutional',
  version: '0.2.0',
  modules: 24,
}));

// ─── Existing Routes ──────────────────────────────────────────────────────────
app.route('/api/inst_students',       studentMgmtRouter);
app.route('/api/inst_staff',          staffMgmtRouter);
app.route('/api/fees',           feeCollectionRouter);
app.route('/api/qualifications', qualificationVerificationRouter);

// ─── Phase 1: Core ERP & HR ───────────────────────────────────────────────────
app.route('/api/payroll',        payrollRouter);
app.route('/api/procurement',    procurementRouter);

// ─── Phase 2a: Education Vertical ────────────────────────────────────────────
app.route('/api/sis',            sisRouter);
app.route('/api/lms',            lmsRouter);

// ─── Phase 2b: Healthcare Vertical ───────────────────────────────────────────
app.route('/api/ehr',            ehrRouter);
app.route('/api/telemedicine',   telemedicineRouter);
app.route('/api/fhir',           fhirRouter);

// ─── Phase 3: AI & Optimization ──────────────────────────────────────────────
app.route('/api/scheduler',      schedulerRouter);
app.route('/api/anon',           dataAnonRouter);

// ─── Operational Modules ──────────────────────────────────────────────────────
app.route('/api/inst_assets',         assetsRouter);
app.route('/api/visitors',       visitorRouter);
app.route('/api/inst_alumni',         alumniRouter);
app.route('/api/library',        libraryRouter);
app.route('/api/cafeteria',      cafeteriaRouter);
app.route('/api/attendance',     attendanceRouter);
app.route('/api/inst_incidents',      incidentsRouter);
app.route('/api/dms',            dmsRouter);
app.route('/api/campus',         campusRouter);
app.route('/api/parents',        parentPortalRouter);
app.route('/api/insurance',      insuranceRouter);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
