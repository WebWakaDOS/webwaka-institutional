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
import { studentMgmtRouter } from './modules/student-mgmt/index';
import { staffMgmtRouter } from './modules/staff-mgmt/index';
import { feeCollectionRouter } from './modules/fee-collection/index';

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Global Middleware ────────────────────────────────────────────────────────

// Invariant: No wildcard CORS — environment-aware allowlist only
// secureCORS() v1.3.0: options-based, reads ENVIRONMENT from c.env internally
app.use('*', secureCORS());

// Rate limiting on all auth and mutation endpoints
// rateLimit() v1.3.0: options-based, reads RATE_LIMIT_KV from c.env internally
app.use('/api/auth/*', rateLimit({ limit: 10, windowSeconds: 60, keyPrefix: 'institutional-auth' }));

// JWT authentication on all /api/* routes
// tenantId is ALWAYS extracted from JWT payload — NEVER from headers or body
// jwtAuthMiddleware() v1.3.0: reads JWT_SECRET from c.env internally
app.use('/api/*', jwtAuthMiddleware());

// ─── Health Check (unauthenticated) ──────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok', service: 'webwaka-institutional', version: '0.1.0' }));

// ─── Module Routes ────────────────────────────────────────────────────────────
app.route('/api/students', studentMgmtRouter);
app.route('/api/staff', staffMgmtRouter);
app.route('/api/fees', feeCollectionRouter);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
