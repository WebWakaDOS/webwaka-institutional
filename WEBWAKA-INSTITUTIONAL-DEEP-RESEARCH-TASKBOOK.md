# WEBWAKA-INSTITUTIONAL — DEEP RESEARCH + ENHANCEMENT TASKBOOK + QA PROMPT FACTORY

**Repository:** `webwaka-institutional` (`@webwaka/institutional`)
**Platform:** WebWaka OS v4
**Runtime:** Cloudflare Workers + Hono + Cloudflare D1 + KV + R2
**Date:** April 2026
**Author:** Deep Research & Enhancement Agent

---

## TABLE OF CONTENTS

1. [Repo Deep Understanding](#1-repo-deep-understanding)
2. [External Best-Practice Research](#2-external-best-practice-research)
3. [Synthesis and Gap Analysis](#3-synthesis-and-gap-analysis)
4. [Top 20 Enhancements](#4-top-20-enhancements)
5. [Bug Fix Recommendations](#5-bug-fix-recommendations)
6. [Task Breakdown — All Tasks](#6-task-breakdown)
7. [QA Plans — All Tasks](#7-qa-plans)
8. [Implementation Prompts — All Tasks](#8-implementation-prompts)
9. [QA Prompts — All Tasks](#9-qa-prompts)
10. [Priority Order](#10-priority-order)
11. [Dependencies Map](#11-dependencies-map)
12. [Phase 1 / Phase 2 Split](#12-phase-split)
13. [Repo Context and Ecosystem Notes](#13-ecosystem-notes)
14. [Governance and Reminder Block](#14-governance-and-reminder-block)
15. [Execution Readiness Notes](#15-execution-readiness-notes)

---

## 1. REPO DEEP UNDERSTANDING

### 1.1 Repository Identity

The `webwaka-institutional` repository is one component of the **WebWaka multi-repo platform**, a comprehensive, cloud-native, mobile-first, offline-first vertical SaaS ecosystem targeting the African market. This specific repo is the **institutional management layer** — targeting Nigerian and African schools, universities, polytechnics, vocational centres, and training institutions.

It is not a standalone product. It depends on:
- `@webwaka/core` (npm package) for JWT auth, CORS, role enforcement, rate limiting
- Cloudflare infrastructure: D1 (SQL), KV (sessions, rate limiting), R2 (document storage)
- Paystack (payment gateway — kobo-denominated)
- OpenRouter (AI abstraction layer)
- Termii (SMS/notifications)
- JAMB API (exam body, Nigeria)
- WAEC API (exam body, West Africa)

### 1.2 Current Module Inventory

| Module | Routes | Status |
|--------|--------|--------|
| `student-mgmt` | `GET /`, `POST /`, `GET /:id` | Minimal — no PATCH, no DELETE, no pagination, no filtering, schema mismatch |
| `staff-mgmt` | `GET /`, `POST /` | Very minimal — no GET /:id, no PATCH, schema mismatch |
| `fee-collection` | `GET /`, `POST /` | Minimal — Paystack never called, schema mismatch |
| `qualification-verification` | `POST /`, `GET /`, `GET /:id`, `POST /:id/document`, `PATCH /:id/review` | Most complete module |

### 1.3 Core Infrastructure Files

**`src/worker.ts`** — Main Hono app. Wires up global middleware (CORS, rate limit on `/api/auth/*`, JWT auth on all `/api/*`) and mounts routers. Health check at `/health`.

**`src/core/types.ts`** — TypeScript interfaces: `Bindings`, `AppVariables`, `Student`, `FeeRecord`, `QualificationVerification`, and enum types. **Critical issue**: The `Student` and `FeeRecord` TypeScript interfaces contain many fields that do NOT exist in the D1 schema or INSERT statements.

**`src/core/ai.ts`** — OpenRouter abstraction (`getAICompletion`). Supports arbitrary model selection, system prompts, temperature, and token limits. **Currently wired to nothing** — no route in the entire codebase calls this function.

**`src/core/paystack.ts`** — Paystack integration: `initializePayment`, `verifyPayment`, `generatePaymentReference`. **Currently wired to nothing** — no route calls these functions.

**`src/core/qualifications.ts`** — JAMB and WAEC API clients with full fallback logic. Both return structured results without throwing. This is the most production-ready piece of the codebase.

**`src/db/schema.sql`** — Canonical D1 schema. Mirrors `migrations/0001` and `migrations/0002`.

**`src/db/db.ts`** — Dexie (IndexedDB) offline store. Defines `InstitutionalOfflineDB` with versioned stores for students, feeRecords, qualificationVerifications, and a mutationQueue. `processMutationQueue` function exists but has **no trigger mechanism** (no service worker registration, no `/api/sync` endpoint).

**`src/i18n/index.ts`** — 7-locale support (en-NG, en-GH, en-KE, en-ZA, fr-CI, yo-NG, ha-NG). Currency subunit conversions, institution type labels, fee type labels.

**`src/middleware/auth.ts`** — Re-exports all auth primitives from `@webwaka/core`. Nothing custom here.

**`src/__mocks__/@webwaka/core.ts`** — Test mock for the core package. Bypasses JWT verification and role checking. Used in vitest via `vitest.config.ts` alias.

### 1.4 Database Schema Analysis

**`students` table:**
- Has: `id, tenantId, matricNumber, status, programmeId, level, createdAt`
- Missing from DB but in TypeScript: `firstName, lastName, email, phone, admissionDate, updatedAt`
- The INSERT statement only inserts 7 fields, losing all personal data

**`staff` table:**
- Has: `id, tenantId, staffId, status, department, role, createdAt`
- No `firstName`, `lastName`, `email`, `phone`, `updatedAt` in DB
- Missing many fields from the `StaffRole` type usage

**`feeRecords` table:**
- Has: `id, tenantId, studentId, feeType, amountKobo, status, academicYear, createdAt`
- TypeScript `FeeRecord` interface also has: `paidKobo, balanceKobo, semester, dueDate` — none in DB
- INSERT only stores 8 fields; `paidKobo`, `balanceKobo` are never persisted

**`qualificationVerifications` table:**
- Most complete. All TypeScript interface fields match DB columns.
- Sensitive issue: `waecScratchCardPin` stored plaintext in DB.

### 1.5 Migrations

- `0001_initial_schema.sql` — students, staff, feeRecords + tenant indexes
- `0002_qualification_verifications.sql` — qualificationVerifications table + 3 indexes
- **No migration runner script** — wrangler migration run must be done manually
- **No migration for CI/CD** — the deploy pipeline has no `wrangler d1 migrations apply` step

### 1.6 Testing

- `src/core/paystack.test.ts` — 1 test: `generatePaymentReference` uniqueness only
- `src/i18n/index.test.ts` — 4 tests: `toSubunit`, `formatCurrency`, label lookups
- `src/modules/qualification-verification/index.test.ts` — 15 tests: comprehensive auto path, manual fallback, partial, admin review, document upload, tenant isolation
- **No tests for**: student-mgmt, staff-mgmt, fee-collection, ai.ts, worker.ts
- Coverage thresholds: 80% lines/functions/statements, 75% branches
- The D1 stub in tests is hand-rolled and fragile — misidentifies rows by heuristics rather than SQL parsing

### 1.7 CI/CD Pipeline

`.github/workflows/deploy.yml`:
- Runs on push to main and PRs to main
- Steps: checkout → node 20 → install → typecheck → test → deploy staging (PR) → deploy production (main)
- **Critical gap**: No `wrangler d1 migrations apply` step — new migrations never run in CI/CD
- **Critical bug**: Staging and production share the same D1 database ID (`ee93377c-8000-45d6-ae54-f0d4c588bf04` appears in both `env.staging` and `env.production` in `wrangler.toml`)

### 1.8 Dependencies on Other WebWaka Repos

| Dependency | Source | Purpose |
|-----------|--------|---------|
| `@webwaka/core` v1.3.2 | External npm package (another WebWaka repo) | JWT auth, CORS, rate limiting, role enforcement |
| WebWaka Event Bus | NOT YET INTEGRATED | Platform-wide event propagation (payment events, admission events) |
| WebWaka Fintech repo | SEPARATE REPO | Institutional wallets, NIBSS transfers for fee refunds |
| WebWaka Analytics repo | SEPARATE REPO | Cross-institutional reporting and dashboards |

### 1.9 What is Intentionally Missing (Lives Elsewhere)

Per the multi-repo platform architecture:
- **Wallet and ledger management** — lives in `webwaka-fintech`
- **Push notification infrastructure** — lives in `@webwaka/core` or a notifications repo
- **Global reporting dashboard** — lives in a separate analytics repo
- **Super-admin institution onboarding** — likely in a platform-admin repo
- **Payment gateway webhook infrastructure** — partially shared with core

---

## 2. EXTERNAL BEST-PRACTICE RESEARCH

### 2.1 Nigerian Higher Education SIS Best Practices

From research into Nigerian university systems (NUC guidelines, leading SIS products):

- **JAMB Central Admissions Processing System (CAPS)**: Institutions must integrate with CAPS for admission processing. Applicants accept offers via CAPS, which then notifies the institution. This repo does not model the CAPS workflow.
- **NUC Portal**: Requires student bio-data, programme accreditation status, and annual returns. Integration opportunity.
- **Matric Number Format**: Nigerian universities follow strict formats (e.g., `FCA/2021/001`). Validation is absent here.
- **Student lifecycle**: Nigerian HEIs manage: Application → Admission → Registration → Academic Records → Graduation/Withdrawal. Only basic student record exists; no lifecycle management.
- **Multi-semester academic calendar**: Semesters, sessions (academic years), and course registration per semester are all standard but absent.

### 2.2 Hono + Cloudflare Workers Security Best Practices

Research findings from Cloudflare documentation and Hono community:

- **Zod + @hono/zod-validator**: Industry standard for type-safe input validation in Hono. Returns structured 400 errors on validation failure. Currently absent — all inputs are raw `c.req.json()` with no schema enforcement.
- **Request size limits**: R2 uploads should enforce file size limits. Currently none.
- **Content-type validation**: File uploads should validate MIME types beyond the basic PDF/JPG check currently present.
- **CORS headers**: `secureCORS()` from core handles this, but specific allowed origins should be environment-specific and logged.
- **Error handler**: Hono supports `app.onError()` for global error handling. Currently absent — all unhandled errors return generic 500s.
- **Structured error responses**: Production APIs should return `{ error: string, code: string }` consistently. Currently inconsistent.
- **Idempotency keys**: For financial operations (Paystack initialization), idempotency keys prevent double-charges. Currently absent.

### 2.3 EdTech Institutional Management in Africa

Research into leading African EdTech institutional products:

- **Schoology, Canvas, Moodle**: LMS integration is standard for universities. SCORM/xAPI support.
- **SMIS (School Management Information System)**: Biometric attendance is standard in Nigerian secondary schools.
- **Africa's Talking integration**: Alternative SMS provider to Termii; multi-provider resilience needed.
- **Fee payment portals**: Nigerian parents expect **Remita**, **Interswitch**, and **Paystack** options. Only Paystack is modeled here.
- **WAEC e-Checker**: WAEC provides a public e-Checker; scratch card verification is just one pathway. The API approach here is forward-looking but the e-Checker fallback (manual URL check) is not modeled.
- **NECO verification**: National Examinations Council (NECO) is another major Nigerian exam body not modeled here at all.
- **Result computation**: GPA/CGPA computation from course scores is a standard requirement not addressed.

### 2.4 Multi-Tenant SaaS on Cloudflare D1

Key research findings:

- **Database-per-tenant vs. shared table**: D1's recommended pattern is many small databases, not one large shared table. The current `tenantId` column approach is functional but will hit D1's 10 GB limit at scale.
- **Row-Level Security simulation**: Cloudflare D1 doesn't have native RLS. Every query must include `AND tenantId = ?`. This is done in the qualification module but inconsistently applied elsewhere.
- **Connection limits**: D1 has limits on concurrent queries. Batch operations should use D1 batch API for atomicity.
- **Indexes**: Current schema only indexes `tenantId`. Compound indexes (e.g., `tenantId, status`) would improve common query patterns.

### 2.5 Paystack Integration Best Practices

Research findings:

- **Webhook verification**: Paystack webhooks must verify the `x-paystack-signature` header using HMAC-SHA512 of the raw body. No webhook handler exists in this repo.
- **Idempotent references**: Payment references must be globally unique and stored before the API call to prevent double-charging on retry.
- **Fee breakdown**: Paystack allows passing metadata for fee line items, enabling itemized receipts.
- **Split payment**: Paystack subaccounts allow splitting fees between institution and platform — powerful for SaaS billing.
- **Bank transfer channel**: USSD and bank transfer channels are important for students without cards (very common in Nigeria).

### 2.6 Offline-First PWA Patterns

Key research from Dexie.js and Workbox documentation:

- **Background Sync API**: Service workers can register background sync tasks (`navigator.serviceWorker.ready.then(sw => sw.sync.register('sync-mutations'))`). No service worker is defined in this repo.
- **Conflict resolution**: When offline edits sync, last-write-wins is insufficient for financial records. The mutation queue here has no conflict resolution strategy.
- **Queue retry limits**: The mutation queue increments `retryCount` but never abandons after a max count. Infinite retries would fill the queue.
- **Encryption at rest**: IndexedDB data is not encrypted by default. For sensitive student/fee data on mobile devices, encryption is recommended.
- **Sync status UI**: Users need feedback on pending mutations count and last sync time.

### 2.7 AI in Education (OpenRouter)

Research findings on AI use in EdTech:

- **Performance prediction**: ML models for at-risk student identification based on attendance + grades. Requires historical data not yet collected.
- **Fee defaulter prediction**: Classification models predicting payment default risk. Requires payment history.
- **Timetable optimization**: Constraint satisfaction problems; LLMs can generate initial drafts.
- **Admission essay analysis**: Automated screening of personal statements for completeness and quality.
- **Parent chatbot**: AI assistant for fee enquiries, results, and schedules.
- **Fraud detection**: AI can flag suspicious qualification submissions (e.g., duplicate exam numbers across tenants).

---

## 3. SYNTHESIS AND GAP ANALYSIS

### 3.1 Critical Bugs (Must Fix Before Any Enhancement)

| Bug | Severity | Description |
|-----|----------|-------------|
| BUG-01 | CRITICAL | Staging and production share the same D1 database ID |
| BUG-02 | CRITICAL | `students` DB schema missing personal data fields; INSERT loses all personal info |
| BUG-03 | CRITICAL | `feeRecords` DB schema missing `paidKobo`, `balanceKobo`, `semester`, `dueDate` |
| BUG-04 | CRITICAL | No input validation on any route — malformed requests cause runtime crashes |
| BUG-05 | HIGH | CI/CD never runs D1 migrations — new tables never created in staging/production |
| BUG-06 | HIGH | No Paystack webhook handler — payments initialize but never confirm |
| BUG-07 | HIGH | `waecScratchCardPin` stored plaintext in DB (sensitive credential) |
| BUG-08 | HIGH | `staff` DB schema missing personal data fields (name, email, phone) |
| BUG-09 | MEDIUM | No global error handler — unhandled errors return raw 500s |
| BUG-10 | MEDIUM | `processMutationQueue` exists but has no trigger (no service worker, no endpoint) |

### 3.2 Enhancement Opportunities (From Synthesis)

| Gap | Category | Priority |
|-----|----------|----------|
| No PATCH/DELETE on students, staff, fees | Core CRUD | P1 |
| No pagination or filtering on any list endpoint | Core CRUD | P1 |
| No input validation (Zod) | Security | P1 |
| No programme/course management | Domain | P1 |
| Paystack payment flow never wired | Payments | P1 |
| AI module never wired | AI | P2 |
| Termii SMS never wired | Notifications | P2 |
| No timetable module | Domain | P2 |
| No attendance tracking | Domain | P2 |
| No admission workflow | Domain | P2 |
| No audit log | Governance | P2 |
| No NECO verification | Domain | P2 |
| No reporting endpoints | Analytics | P2 |
| Service worker for offline sync | PWA | P2 |
| No academic calendar | Domain | P3 |
| No GPA/CGPA computation | Domain | P3 |
| No Remita/Interswitch support | Payments | P3 |
| No CAPS integration | Domain | P3 |
| No rate limiting on mutations | Security | P1 |
| No compound DB indexes | Performance | P2 |

---

## 4. TOP 20 ENHANCEMENTS

### ENH-01: Input Validation with Zod + @hono/zod-validator
Add schema validation to all routes. Return structured 400 errors on invalid input.

### ENH-02: Fix Student Schema and Complete Student CRUD
Align DB schema with TypeScript interface. Add `firstName, lastName, email, phone, admissionDate, updatedAt`. Add PATCH and DELETE routes with soft-delete.

### ENH-03: Fix FeeRecord Schema and Wire Paystack Payment Flow
Add missing columns (`paidKobo, balanceKobo, semester, dueDate`). Implement `POST /api/fees/:id/pay` to initialize Paystack. Implement webhook handler `POST /api/webhooks/paystack`.

### ENH-04: Fix Staff Schema and Complete Staff CRUD
Add personal data fields to staff table. Add `GET /:id`, `PATCH /:id`, soft-delete.

### ENH-05: Fix Critical CI/CD and DB Configuration Bugs
Separate staging/production D1 database IDs. Add migration runner to CI/CD pipeline.

### ENH-06: Paginate and Filter All List Endpoints
Add `limit`, `offset`, `status`, `academicYear`, `search` query params to all list routes.

### ENH-07: Programme and Course Management Module
New module: programmes (name, code, durationYears, institutionType) and courses (code, title, credits, semester). Referenced by students.

### ENH-08: Timetable Management Module
New module: timetable slots (day, period, course, staff, venue, class). Conflict detection. Per-tenant, per-semester.

### ENH-09: Attendance Tracking Module
New module: `attendanceRecords` (studentId, courseId, date, status: present/absent/late). Summary endpoint for attendance rate per student.

### ENH-10: Student Admission Workflow
Structured admission flow: `application → review → offered → accepted → enrolled`. Status transition validation. CAPS-compatible design.

### ENH-11: Termii SMS Notifications
Wire `TERMII_API_KEY` to send SMS on: fee payment confirmation, qualification verification result, admission offer.

### ENH-12: AI-Powered Analytics Endpoints
Wire `getAICompletion` into: `POST /api/ai/insights/fee-defaulters`, `POST /api/ai/insights/at-risk-students`, `POST /api/ai/insights/admissions-summary`.

### ENH-13: NECO Verification Support
Extend qualification verification to include NECO (National Examinations Council) alongside JAMB and WAEC. Same auto/manual fallback pattern.

### ENH-14: Audit Log Trail
New `auditLog` table. Record every sensitive operation (student status change, fee payment, qualification review) with `actorId, tenantId, action, entityId, before, after, timestamp`.

### ENH-15: Global Error Handler and Structured Error Responses
Add `app.onError()` in `worker.ts`. Standardize all error responses to `{ error: string, code: string, requestId: string }`.

### ENH-16: Rate Limiting on All Mutation Endpoints
Extend rate limiting beyond `/api/auth/*` to cover all POST/PATCH/DELETE endpoints.

### ENH-17: WAEC PIN Security — Remove from Storage
Stop persisting `waecScratchCardPin` in the database. Use it only in-memory during the verification call. Add migration to remove or null the column.

### ENH-18: Offline Sync Trigger Endpoint and Service Worker
Implement `POST /api/sync/flush` (authenticated) to receive queued mutations from client. Add service worker registration and background sync wiring instructions to README.

### ENH-19: Reporting and Analytics Endpoints
Add read-only reporting endpoints: `GET /api/reports/fee-summary`, `GET /api/reports/admission-stats`, `GET /api/reports/attendance-summary`. Use D1 aggregate queries.

### ENH-20: Compound Database Indexes and Query Optimization
Add compound indexes: `(tenantId, status)` on students and feeRecords. Add `(tenantId, academicYear)` on feeRecords. Add `LIMIT/OFFSET` as a baseline to all queries.

---

## 5. BUG FIX RECOMMENDATIONS

### BUG-01 — Critical: Shared D1 Database ID Between Staging and Production

**File:** `wrangler.toml`
**Problem:** Both `env.staging` and `env.production` have `database_id = "ee93377c-8000-45d6-ae54-f0d4c588bf04"`. Every staging deployment writes to production data.
**Fix:** Create a separate D1 database for staging via `wrangler d1 create webwaka-institutional-db-staging`. Update `wrangler.toml` with the new staging database ID.

### BUG-02 — Critical: Student Table Missing Personal Data Columns

**Files:** `src/db/schema.sql`, `migrations/0001_initial_schema.sql`, `src/modules/student-mgmt/index.ts`
**Problem:** `Student` TypeScript interface has `firstName, lastName, email, phone, admissionDate, updatedAt` but none exist in DB or INSERT.
**Fix:** Migration `0003_student_personal_fields.sql` to add columns. Update INSERT to include all fields.

### BUG-03 — Critical: FeeRecord Table Missing Balance and Semester Columns

**Files:** `src/db/schema.sql`, `migrations/0001_initial_schema.sql`, `src/modules/fee-collection/index.ts`
**Problem:** `FeeRecord` has `paidKobo, balanceKobo, semester, dueDate` not in DB.
**Fix:** Migration `0004_feerecord_balance_fields.sql`. Update INSERT.

### BUG-04 — Critical: No Input Validation

**Files:** All `src/modules/*/index.ts`
**Problem:** `c.req.json()` is called with no schema validation. Missing fields cause runtime errors or silent bad data.
**Fix:** Install `zod` and `@hono/zod-validator`. Add `zValidator` middleware to every route.

### BUG-05 — High: CI/CD Never Runs D1 Migrations

**File:** `.github/workflows/deploy.yml`
**Problem:** `wrangler d1 migrations apply` is not in the deploy pipeline.
**Fix:** Add migration steps after deploy for both staging and production.

### BUG-06 — High: No Paystack Webhook Handler

**File:** `src/worker.ts` / missing `src/modules/fee-collection/webhook.ts`
**Problem:** `initializePayment` is defined but no webhook endpoint exists to confirm payments. Fee status never updates after Paystack redirect.
**Fix:** Implement `POST /webhooks/paystack` with HMAC-SHA512 signature verification.

### BUG-07 — High: WAEC Scratch Card PIN Stored in Database

**Files:** `migrations/0002_qualification_verifications.sql`, `src/modules/qualification-verification/index.ts`
**Problem:** `waecScratchCardPin` is persisted to D1. This is a credential used by WAEC to authenticate result access and should not be stored after use.
**Fix:** Use PIN only in-memory during verification. Add migration to remove column or set to null after use.

### BUG-08 — High: Staff Table Missing Personal Data

**Files:** `src/db/schema.sql`, `src/modules/staff-mgmt/index.ts`
**Problem:** Staff `INSERT` and table have no name, email, or phone fields.
**Fix:** Migration to add personal data columns. Update INSERT.

### BUG-09 — Medium: No Global Error Handler

**File:** `src/worker.ts`
**Problem:** Unhandled promise rejections from D1, R2, or external APIs return raw Cloudflare error responses with inconsistent structure.
**Fix:** Add `app.onError((err, c) => c.json({ error: err.message, code: 'INTERNAL_ERROR' }, 500))`.

### BUG-10 — Medium: processMutationQueue Has No Trigger

**File:** `src/db/db.ts`
**Problem:** The sync function is defined but can never be called from a Worker context (Dexie runs client-side only). No service worker or sync endpoint exists.
**Fix:** Document clearly that `db.ts` is client-only code. Add `POST /api/sync` endpoint server-side to receive queued mutations as a batch.

---

## 6. TASK BREAKDOWN

---

### TASK INS-T01: Fix Critical Infrastructure Bugs (Schema, CI/CD, DB Config)

**Objective:** Fix the foundational bugs that make the system unusable in production.

**Why it matters:** Without these fixes, staging and production share a database, student personal data is lost on every INSERT, fee balances are never tracked, and migrations never run.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** None (must be first)

**Prerequisites:**
- Access to Cloudflare account to create a staging D1 database
- Wrangler authenticated

**Impacted modules:** All modules, CI/CD, schema

**Files to change:**
- `wrangler.toml` — separate staging DB ID
- `src/db/schema.sql` — add missing columns to students, staff, feeRecords
- `migrations/0003_student_personal_fields.sql` — new migration
- `migrations/0004_feerecord_balance_fields.sql` — new migration
- `migrations/0005_staff_personal_fields.sql` — new migration
- `src/modules/student-mgmt/index.ts` — update INSERT
- `src/modules/staff-mgmt/index.ts` — update INSERT
- `src/modules/fee-collection/index.ts` — update INSERT
- `.github/workflows/deploy.yml` — add migration apply step

**Expected output:**
- Staging uses its own D1 database
- student INSERT persists firstName, lastName, email, phone, admissionDate
- feeRecord INSERT persists paidKobo, balanceKobo, semester, dueDate
- staff INSERT persists firstName, lastName, email, phone
- CI/CD applies migrations automatically on deploy

**Acceptance criteria:**
- `wrangler.toml` has two distinct D1 database IDs
- Three new migration files exist and are syntactically valid
- `schema.sql` matches the TypeScript interfaces exactly
- All INSERT statements include all fields
- CI/CD YAML runs `wrangler d1 migrations apply` for both environments

**Tests required:**
- Unit tests for student CREATE with all personal fields
- Unit tests for feeRecord CREATE with balance fields
- Verify DB stub in tests reflects new columns

**Risks:**
- Breaking existing tests that expect the old schema
- Cloudflare account may not have permission to create new D1 databases without user intervention

**Governance documents to consult:** WebWaka invariants (Invariant 2: Multi-Tenant)

**Important reminders:**
- All amounts ALWAYS in kobo
- tenantId ALWAYS from JWT, never from request body
- Never use the same database for staging and production

---

### TASK INS-T02: Add Input Validation with Zod to All Routes

**Objective:** Add Zod schema validation to every route using `@hono/zod-validator`.

**Why it matters:** Currently any malformed request causes unhandled runtime errors. This is a security risk and reliability failure. Industry standard for Hono on Cloudflare Workers.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01 (need final schemas to define Zod shapes)

**Prerequisites:** `npm install zod @hono/zod-validator`

**Impacted modules:** student-mgmt, staff-mgmt, fee-collection, qualification-verification

**Files to change:**
- `package.json` — add zod, @hono/zod-validator
- `src/modules/student-mgmt/index.ts`
- `src/modules/staff-mgmt/index.ts`
- `src/modules/fee-collection/index.ts`
- `src/modules/qualification-verification/index.ts`
- `src/core/types.ts` — export Zod schemas alongside TypeScript types

**Expected output:**
- Every POST/PATCH route validates body with `zValidator('json', schema)`
- Every GET route with query params validates with `zValidator('query', schema)`
- Invalid requests return `{ error: 'Validation failed', issues: [...] }` with 400 status
- Valid requests type-narrow correctly (no `any` needed)

**Acceptance criteria:**
- All POST routes have Zod validation
- Missing required fields return 400 with structured issues array
- Extra unknown fields are stripped (`.strip()`)
- `amountKobo` validated as positive integer (not float)
- `email` validated as valid email format
- `phone` validated as Nigerian phone format (e.g., `/^(\+234|0)[789]\d{9}$/`)
- `academicYear` validated as format `YYYY/YYYY`

**Tests required:**
- Test that missing `studentId` returns 400 (already exists for qualifications)
- Test that negative `amountKobo` returns 400
- Test that invalid email returns 400
- Test that valid payloads still return 201

**Risks:** Zod bundle size adds ~12 KB to Worker bundle. Monitor total bundle size.

**Governance documents to consult:** WebWaka invariants (Invariant 5: Nigeria First — kobo validation)

---

### TASK INS-T03: Add Global Error Handler and Structured Error Responses

**Objective:** Add `app.onError()` and `app.notFound()` consistent handlers to `worker.ts`.

**Why it matters:** Unhandled errors leak stack traces and return inconsistent response shapes. Production APIs must never expose internal errors.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** None (independent of schema work)

**Impacted modules:** `src/worker.ts`

**Files to change:**
- `src/worker.ts` — add error handler
- `src/core/types.ts` — add `ErrorResponse` interface

**Expected output:**
- All uncaught errors return `{ error: string, code: string, requestId: string }` with appropriate HTTP status
- 404s return `{ error: 'Not found', code: 'NOT_FOUND' }`
- 500s return `{ error: 'Internal server error', code: 'INTERNAL_ERROR' }` (no stack trace in production)
- Stack traces logged in development/staging via `console.error`
- `requestId` is a UUID generated per request using `crypto.randomUUID()`

**Acceptance criteria:**
- Throwing inside any route returns structured JSON with 500
- D1 errors are caught and return 500 with `code: 'DB_ERROR'`
- `ENVIRONMENT === 'production'` suppresses stack trace in response
- `requestId` is present on all error responses

**Tests required:**
- Test that a route that throws returns 500 with structured body
- Test that requestId is a UUID
- Test that production mode suppresses error details

---

### TASK INS-T04: Rate Limiting on All Mutation Endpoints

**Objective:** Extend rate limiting beyond `/api/auth/*` to all POST, PATCH, and DELETE routes.

**Why it matters:** Currently anyone with a valid JWT can hammer mutation endpoints without throttling. This is a denial-of-service and abuse vector.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** None

**Impacted modules:** `src/worker.ts`, all module routers

**Files to change:**
- `src/worker.ts` — add `rateLimit` middleware for mutation methods

**Expected output:**
- POST/PATCH/DELETE requests limited to 30 per minute per user
- Exceeded requests return `429 Too Many Requests`
- Rate limit uses `RATE_LIMIT_KV` binding (already in `Bindings`)

**Acceptance criteria:**
- 31 rapid POST requests return 429 on the 31st
- GET requests are NOT rate limited (read-only)
- Rate limit key includes `userId + tenantId` (not just IP)

**Tests required:**
- Test that exceeding rate limit returns 429
- Test that GET requests bypass mutation rate limit

---

### TASK INS-T05: Complete Student CRUD (PATCH, Soft Delete, Pagination, Filtering)

**Objective:** Complete the student management module with full CRUD, pagination, and filtering.

**Why it matters:** Currently students can only be created and fetched. No updates, no status changes, no search, no pagination. This makes the module unusable beyond basic data entry.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01 (schema fix), TASK INS-T02 (validation)

**Impacted modules:** `src/modules/student-mgmt/index.ts`

**Files to change:**
- `src/modules/student-mgmt/index.ts` — add PATCH, DELETE (soft), pagination, filtering
- `migrations/0006_student_soft_delete.sql` — add `deletedAt TEXT` column

**Expected output:**
- `PATCH /api/students/:id` — update status, level, email, phone (partial update, tenant-scoped)
- `DELETE /api/students/:id` — soft delete (sets `deletedAt`, status → `withdrawn`)
- `GET /api/students?status=active&limit=20&offset=0&search=chike` — filtered, paginated list
- All list queries exclude soft-deleted records
- `updatedAt` updated on every PATCH

**Acceptance criteria:**
- PATCH only updates provided fields (partial update)
- Cannot change `matricNumber` or `tenantId` via PATCH
- Deleted students return 404 on GET /:id
- Pagination: default limit 20, max 100
- Search by `matricNumber`, `firstName`, `lastName` (LIKE query)
- Status filter works with all StudentStatus values

**Tests required:**
- PATCH updates status correctly
- PATCH ignores unknown fields
- DELETE soft-deletes (record still in DB but inaccessible via API)
- Pagination returns correct count and total
- Cross-tenant PATCH attempt returns 404

---

### TASK INS-T06: Complete Staff CRUD (GET Single, PATCH, Soft Delete, Pagination)

**Objective:** Complete the staff management module.

**Why it matters:** Staff module has only list and create. No fetch single, no update, no deactivation.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01, TASK INS-T02

**Impacted modules:** `src/modules/staff-mgmt/index.ts`

**Files to change:**
- `src/modules/staff-mgmt/index.ts`
- `migrations/0007_staff_soft_delete.sql`

**Expected output:**
- `GET /api/staff/:id` — fetch single staff record (admin only)
- `PATCH /api/staff/:id` — update role, department, status, email
- `DELETE /api/staff/:id` — soft delete
- `GET /api/staff?role=teacher&department=science&limit=20&offset=0`

**Acceptance criteria:**
- Same quality bar as student CRUD
- Role transitions validated against `StaffRole` enum
- Soft-deleted staff not visible in list

**Tests required:**
- Full CRUD lifecycle test
- Cross-tenant isolation test
- Role validation test

---

### TASK INS-T07: Complete Fee Collection Module (Paystack Integration, Webhook Handler)

**Objective:** Wire the Paystack payment flow into the fee collection module. Implement webhook handler for payment confirmation.

**Why it matters:** Fees can be created but never paid. The most critical revenue workflow is completely unwired.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01 (schema — paidKobo, balanceKobo), TASK INS-T02

**Impacted modules:** `src/modules/fee-collection/index.ts`, `src/worker.ts`

**Files to change:**
- `src/modules/fee-collection/index.ts` — add payment initialization, fee update
- `src/modules/fee-collection/webhook.ts` — new Paystack webhook handler
- `src/worker.ts` — mount webhook route (unauthenticated, with signature verification)
- `src/core/paystack.ts` — add HMAC-SHA512 signature verification utility

**Expected output:**
- `POST /api/fees/:id/pay` — initializes Paystack transaction, returns `authorization_url`
- `POST /webhooks/paystack` — handles `charge.success` event, updates `paidKobo`, `balanceKobo`, `status`
- `GET /api/fees/:id` — returns fee record with current balance
- `GET /api/fees?studentId=:id&academicYear=2024/2025` — filtered fee records
- Idempotency: duplicate webhook delivery handled gracefully

**Acceptance criteria:**
- Paystack HMAC signature verified on every webhook (reject if invalid)
- `paidKobo + balanceKobo = amountKobo` invariant maintained
- Partial payment sets `status = 'partial'`
- Full payment sets `status = 'success'`
- `generatePaymentReference` called before API call, reference stored in DB
- No double-processing of same Paystack reference

**Tests required:**
- Payment initialization returns authorization_url
- Valid webhook updates fee status
- Invalid webhook signature returns 400
- Duplicate webhook is idempotent (second call makes no change)
- Partial payment correctly sets `status = 'partial'`

**Risks:** Paystack webhook endpoint must NOT be behind JWT auth middleware. Mount carefully.

---

### TASK INS-T08: Programme and Course Management Module

**Objective:** Create a programme and course management module so `programmeId` references are meaningful.

**Why it matters:** Every student has a `programmeId` but there is no programmes table or API. This is a dangling foreign key reference.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01, TASK INS-T02

**Impacted modules:** New module `src/modules/programme-mgmt/`

**Files to change:**
- `src/modules/programme-mgmt/index.ts` — new router
- `src/worker.ts` — mount at `/api/programmes`
- `migrations/0008_programmes_courses.sql` — new tables
- `src/db/schema.sql` — update canonical schema
- `src/core/types.ts` — add `Programme`, `Course` interfaces

**Expected output:**
- `programmes` table: `id, tenantId, name, code, durationYears, institutionType, createdAt, updatedAt`
- `courses` table: `id, tenantId, programmeId, code, title, creditUnits, semester, createdAt`
- Full CRUD for programmes and courses (admin only)
- Validation that `programmeId` exists when creating a student (foreign key via query)

**Acceptance criteria:**
- Programmes are tenant-scoped
- Course codes are unique per tenant + programme
- Attempting to create a student with non-existent programmeId returns 422
- `institutionType` validates against the `InstitutionType` enum

**Tests required:**
- Programme CRUD lifecycle
- Course CRUD lifecycle
- Student creation rejected for invalid programmeId
- Cross-tenant programme isolation

---

### TASK INS-T09: Timetable Management Module

**Objective:** Create a timetable module for scheduling classes per semester, with conflict detection.

**Why it matters:** Core institutional requirement. A school without a timetable cannot operate. No product in this vertical can succeed without it.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T08 (courses), TASK INS-T01, TASK INS-T02

**Impacted modules:** New module `src/modules/timetable/`

**Files to change:**
- `src/modules/timetable/index.ts` — new router
- `migrations/0009_timetable.sql`
- `src/core/types.ts` — add `TimetableSlot` interface
- `src/worker.ts` — mount at `/api/timetable`

**Expected output:**
- `timetableSlots` table: `id, tenantId, programmeId, courseId, staffId, dayOfWeek, periodStart, periodEnd, venue, semester, academicYear, createdAt`
- `POST /api/timetable` — create slot (admin only) with conflict detection
- `GET /api/timetable?programmeId=&academicYear=&semester=` — fetch schedule
- `GET /api/timetable/staff/:staffId` — staff teaching schedule
- `DELETE /api/timetable/:id` — remove slot
- Conflict: same staff cannot teach in overlapping time slots

**Acceptance criteria:**
- Overlap detection: same staffId, same dayOfWeek, overlapping period returns 409
- Overlap detection: same venue, same time returns 409
- `dayOfWeek` validates as 1–7 (Mon–Sun)
- `periodStart` and `periodEnd` are HH:MM format strings

**Tests required:**
- Conflict detection on staff double-booking
- Conflict detection on venue double-booking
- Valid slot creation succeeds
- GET filtered by programme returns correct slots

---

### TASK INS-T10: Attendance Tracking Module

**Objective:** Track student attendance per course per day.

**Why it matters:** Attendance tracking is a NUC requirement for Nigerian universities and a core feature for all school types.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T08 (courses, students), TASK INS-T01, TASK INS-T02

**Impacted modules:** New module `src/modules/attendance/`

**Files to change:**
- `src/modules/attendance/index.ts` — new router
- `migrations/0010_attendance.sql`
- `src/core/types.ts` — add `AttendanceRecord` interface
- `src/worker.ts` — mount at `/api/attendance`

**Expected output:**
- `attendanceRecords` table: `id, tenantId, studentId, courseId, date, status (present/absent/late/excused), markedBy, createdAt`
- `POST /api/attendance` — mark attendance for a student (teacher/admin)
- `POST /api/attendance/bulk` — mark attendance for a whole class at once
- `GET /api/attendance?studentId=&courseId=&from=&to=` — get records
- `GET /api/attendance/summary/:studentId` — attendance rate per course

**Acceptance criteria:**
- Duplicate attendance record for same student+course+date returns 409 or upsert
- `status` validates as `present | absent | late | excused`
- `markedBy` captured from JWT user ID
- Attendance summary: percentage present = (present + late) / total × 100

**Tests required:**
- Mark present/absent/late
- Bulk mark for class
- Duplicate submission handled
- Summary calculation correct
- Cross-tenant isolation

---

### TASK INS-T11: Student Admission Workflow with Status Transitions

**Objective:** Model a structured admission process with validated status transitions.

**Why it matters:** Currently students jump directly from nothing to `active`. A proper admission workflow (application → shortlisted → offered → accepted → enrolled) is required for Nigerian HEIs.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01, TASK INS-T05, TASK INS-T02

**Impacted modules:** New module `src/modules/admissions/`, updates to student-mgmt

**Files to change:**
- `src/modules/admissions/index.ts` — new router
- `migrations/0011_admissions.sql`
- `src/core/types.ts` — add `AdmissionStatus`, `AdmissionApplication` types

**Expected output:**
- `admissions` table: `id, tenantId, studentId, programmeId, status, academicYear, appliedAt, offeredAt, acceptedAt, enrolledAt, notes, createdAt, updatedAt`
- `POST /api/admissions` — submit application
- `PATCH /api/admissions/:id/status` — transition status (admin only)
- Valid transitions: `applied → shortlisted → offered → accepted → enrolled` or `→ rejected`
- On enrollment: auto-update student `status = 'active'`

**Acceptance criteria:**
- Invalid status transitions (e.g., `applied → enrolled`) return 422
- All transitions logged with timestamp in `admissions` table
- Transition `offered → accepted` sends Termii SMS notification (calls ENH-11)
- Cross-tenant isolation enforced

**Tests required:**
- Valid transition accepted
- Invalid transition rejected with 422
- SMS trigger on offer acceptance (mocked)

---

### TASK INS-T12: Termii SMS Notification Integration

**Objective:** Wire `TERMII_API_KEY` to send SMS notifications on key institutional events.

**Why it matters:** Nigerian institutional operations are highly phone-driven. Parents and students expect SMS confirmation for fees, results, and admissions.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** None (add to existing modules)

**Impacted modules:** New `src/core/termii.ts`, fee-collection, qualification-verification, admissions

**Files to change:**
- `src/core/termii.ts` — new Termii SMS client
- `src/modules/fee-collection/index.ts` — send SMS on payment success
- `src/modules/qualification-verification/index.ts` — send SMS on verification
- `src/modules/admissions/index.ts` — send SMS on offer/enrollment

**Expected output:**
- `sendSMS(apiKey, to, message)` function in `src/core/termii.ts`
- SMS sent (fire-and-forget, non-blocking) on:
  - Fee payment confirmed
  - Qualification verified / rejected
  - Admission offer made
  - Enrollment confirmed
- Failed SMS does NOT fail the main operation

**Acceptance criteria:**
- SMS failure is caught and logged, not propagated
- `to` phone number formatted to Nigerian international format (`+234...`)
- Messages are under 160 characters for single SMS

**Tests required:**
- Termii client sends correct payload
- SMS failure does not cause route to return 500
- Phone number formatting: `08012345678 → +2348012345678`

---

### TASK INS-T13: NECO Verification Support

**Objective:** Extend qualification verification to support NECO (National Examinations Council) alongside JAMB and WAEC.

**Why it matters:** NECO is the second-largest exam body in Nigeria. Many students have NECO results instead of or in addition to WAEC.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** INS-T01 (qualification schema)

**Impacted modules:** `src/core/qualifications.ts`, `src/modules/qualification-verification/index.ts`

**Files to change:**
- `src/core/qualifications.ts` — add `verifyNecoResult`
- `src/core/types.ts` — add NECO fields to `QualificationVerification`
- `migrations/0012_neco_fields.sql` — add `necoExamNumber, necoVerifiedAt, necoApiRaw` columns
- `src/modules/qualification-verification/index.ts` — include NECO in verification logic
- `src/db/schema.sql` — update canonical schema

**Expected output:**
- Same auto/manual fallback pattern as JAMB/WAEC
- `NECO_API_KEY` added to `Bindings` type and `wrangler.toml` secrets comment
- NECO verification result stored alongside JAMB/WAEC

**Acceptance criteria:**
- NECO fields optional (backward compatible)
- NECO API fallback tested
- Combined verification status considers JAMB + WAEC + NECO

**Tests required:**
- NECO auto verify success
- NECO fallback to manual
- Mixed JAMB verified + NECO fallback = manual overall

---

### TASK INS-T14: AI Analytics Endpoints

**Objective:** Wire `getAICompletion` into actionable analytics endpoints.

**Why it matters:** `ai.ts` has been defined but never called. This is stated on-box capability that is completely inactive.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01, TASK INS-T10 (attendance data), TASK INS-T07 (fee data)

**Impacted modules:** New `src/modules/ai-insights/index.ts`

**Files to change:**
- `src/modules/ai-insights/index.ts` — new router
- `src/worker.ts` — mount at `/api/ai`

**Expected output:**
- `POST /api/ai/insights/at-risk-students` — fetches attendance < 70% + outstanding fees, sends to OpenRouter, returns plain-language risk analysis
- `POST /api/ai/insights/fee-defaulter-prediction` — analyzes fee payment patterns, returns risk scores
- `POST /api/ai/insights/admissions-summary` — summarizes admission pipeline
- All endpoints: admin only, results cached in KV for 1 hour to control cost

**Acceptance criteria:**
- OPENROUTER_API_KEY used (never hardcoded)
- Model defaults to `anthropic/claude-3-haiku` (already in ai.ts)
- KV cache: key = `ai:${tenantId}:${insightType}:${cacheKey}`, TTL = 3600
- Response includes `model`, `cachedAt`, `analysis`
- If AI call fails, return 502 with informative error (not 500)

**Tests required:**
- Mocked OpenRouter returns parsed analysis
- KV cache hit returns cached response
- Missing API key returns 503 with message
- Admin-only: non-admin returns 403

---

### TASK INS-T15: Audit Log Module

**Objective:** Record all sensitive data changes in an append-only audit log.

**Why it matters:** NUC and regulatory compliance requires audit trails. Security investigations require knowing who changed what and when.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01

**Impacted modules:** New `src/core/audit.ts`, integrated into all modules

**Files to change:**
- `src/core/audit.ts` — `logAudit(db, entry)` utility function
- `migrations/0013_audit_log.sql` — new append-only `auditLog` table
- `src/modules/student-mgmt/index.ts` — call `logAudit` on PATCH/DELETE
- `src/modules/fee-collection/index.ts` — call on payment update
- `src/modules/qualification-verification/index.ts` — call on review
- `src/modules/admissions/index.ts` — call on status transition

**Expected output:**
- `auditLog` table: `id, tenantId, actorId, action, entityType, entityId, previousState (JSON), newState (JSON), createdAt`
- NO update or delete operations on `auditLog` — append-only
- `GET /api/audit?entityType=student&entityId=:id` — admin reads audit trail

**Acceptance criteria:**
- Every PATCH/DELETE writes to audit log in same D1 transaction (batch)
- Audit log entries are immutable (no PATCH or DELETE route for audit)
- `previousState` and `newState` JSON are correct diffs

**Tests required:**
- Student status change creates audit entry
- Audit entries have correct actor, tenant, action
- Admin can list audit trail for entity
- Attempted DELETE of audit entry returns 405

---

### TASK INS-T16: Reporting and Analytics Endpoints

**Objective:** Add aggregate reporting endpoints for institutional dashboards.

**Why it matters:** Administrators need summary data: total enrolled, total fees collected, attendance rates, verification pipeline status.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01, TASK INS-T10, TASK INS-T07

**Impacted modules:** New `src/modules/reports/index.ts`

**Files to change:**
- `src/modules/reports/index.ts`
- `src/worker.ts` — mount at `/api/reports`

**Expected output:**
- `GET /api/reports/students/summary` — count by status, count by programme, count by level
- `GET /api/reports/fees/summary?academicYear=` — total billed, total collected, outstanding balance
- `GET /api/reports/attendance/summary?courseId=&semester=` — avg attendance rate
- `GET /api/reports/qualifications/summary` — count by verificationStatus

**Acceptance criteria:**
- All amounts in kobo integers
- All reports scoped to `tenantId` from JWT
- Results cached in KV for 5 minutes
- Return `{ data: {...}, generatedAt: ISO8601, cachedUntil: ISO8601 }`

**Tests required:**
- Fee summary returns correct totals
- Attendance summary calculates correct average
- Results cached correctly

---

### TASK INS-T17: WAEC PIN Security Fix

**Objective:** Stop persisting `waecScratchCardPin` in the database.

**Why it matters:** Scratch card PINs are single-use credentials. Storing them creates unnecessary security risk. If the DB is compromised, PINs could be used to fraudulently access WAEC results.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01

**Impacted modules:** `src/modules/qualification-verification/index.ts`

**Files to change:**
- `migrations/0014_remove_waec_pin.sql` — set `waecScratchCardPin = NULL` on all existing rows, then migrate
- `src/modules/qualification-verification/index.ts` — remove from INSERT
- `src/db/schema.sql` — mark column as deprecated (keep for now, remove in future)
- `src/core/types.ts` — mark `waecScratchCardPin` as deprecated

**Expected output:**
- PIN used in-memory for API call only
- PIN not present in any INSERT or SELECT response
- Existing rows have PIN set to NULL

**Acceptance criteria:**
- `SELECT waecScratchCardPin FROM qualificationVerifications` returns NULL for all rows
- API response does not include `waecScratchCardPin`
- Existing WAEC verification tests still pass without PIN in DB

**Tests required:**
- Verify PIN not in DB row after creation
- Verify PIN not in API response body
- WAEC verification still works without PIN being stored

---

### TASK INS-T18: Offline Sync Endpoint and Service Worker Documentation

**Objective:** Create a server-side sync endpoint to receive batched mutations from offline clients. Document service worker integration.

**Why it matters:** The Dexie offline store and mutation queue exist but have no server counterpart to receive queued data when connectivity is restored.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01, TASK INS-T02

**Impacted modules:** New route in `src/worker.ts` or `src/modules/sync/`

**Files to change:**
- `src/modules/sync/index.ts` — new sync module
- `src/worker.ts` — mount at `/api/sync`
- `src/db/db.ts` — add `MAX_RETRY_COUNT = 5` constant and prune logic
- `docs/service-worker-integration.md` — service worker registration guide

**Expected output:**
- `POST /api/sync/mutations` — accepts array of queued mutations, processes each, returns per-item results
- Each mutation applied as if calling the original route
- Failed mutations returned with error details (client can keep in queue)
- Successful mutations removed from client queue

**Acceptance criteria:**
- Accepts up to 100 mutations per batch
- Each mutation includes `endpoint`, `method`, `payload`, `tenantId`
- tenantId verified against JWT (cannot sync other tenant's data)
- Returns `{ processed: N, failed: [{index, error}] }`
- Mutations with retryCount > 5 are auto-rejected and marked for review

**Tests required:**
- Batch of 5 valid mutations all processed
- One invalid mutation does not fail others
- Cross-tenant mutation rejected
- Large batch (100 items) processed correctly

---

### TASK INS-T19: Compound Database Indexes and Query Optimization

**Objective:** Add compound indexes to improve query performance for common access patterns.

**Why it matters:** As institutions grow, `SELECT * WHERE tenantId = ?` becomes slow without compound indexes. Fee queries always include `academicYear`; student queries always include `status`.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** TASK INS-T01

**Impacted modules:** Schema only

**Files to change:**
- `migrations/0015_compound_indexes.sql`
- `src/db/schema.sql` — update canonical schema

**Expected output:**
- `CREATE INDEX idx_students_tenant_status ON students(tenantId, status)`
- `CREATE INDEX idx_students_tenant_level ON students(tenantId, level)`
- `CREATE INDEX idx_feeRecords_tenant_year ON feeRecords(tenantId, academicYear)`
- `CREATE INDEX idx_feeRecords_tenant_status ON feeRecords(tenantId, status)`
- `CREATE INDEX idx_feeRecords_studentId ON feeRecords(studentId)`
- `CREATE INDEX idx_staff_tenant_role ON staff(tenantId, role)`
- `CREATE INDEX idx_staff_tenant_dept ON staff(tenantId, department)`

**Acceptance criteria:**
- All indexes created successfully
- No duplicate indexes (check existing single-column indexes)
- `EXPLAIN QUERY PLAN` output for common queries shows index usage

**Tests required:**
- Migration runs without error
- Schema file reflects all new indexes

---

### TASK INS-T20: Health Check Enhancement and Readiness Probe

**Objective:** Enhance the `/health` endpoint to include D1 connectivity, KV availability, and version information.

**Why it matters:** The current health check only returns static JSON. It doesn't detect when the database is down, making load balancer health checks useless.

**Repo scope:** `webwaka-institutional` only

**Dependencies:** None

**Impacted modules:** `src/worker.ts`

**Files to change:**
- `src/worker.ts` — enhance `/health` endpoint

**Expected output:**
- `GET /health` returns:
  ```json
  {
    "status": "ok" | "degraded" | "unhealthy",
    "service": "webwaka-institutional",
    "version": "0.1.0",
    "environment": "production",
    "checks": {
      "d1": { "status": "ok" | "error", "latencyMs": 12 },
      "kv": { "status": "ok" | "error" }
    },
    "timestamp": "2026-04-04T..."
  }
  ```
- D1 check: `SELECT 1` query with timing
- KV check: `get('health-ping')` with timing
- `status: 'degraded'` if any check fails but service still responds
- Returns 200 even if degraded (load balancer keeps it in rotation); returns 503 if `status = 'unhealthy'`

**Acceptance criteria:**
- Response time < 500ms including checks
- D1 failure sets `d1.status = 'error'` and overall `status = 'degraded'`
- Timing values are accurate
- No auth required (remains public)

**Tests required:**
- Mocked D1 failure returns degraded status
- Healthy checks return 200 with all statuses ok

---

## 7. QA PLANS

---

### QA-INS-T01: Infrastructure Bugs QA Plan

**What to verify:**
1. `wrangler.toml` has two different D1 database IDs for staging vs production
2. `migrations/0003`, `0004`, `0005` files exist and are syntactically valid SQL
3. Student INSERT in module code includes all personal data fields
4. FeeRecord INSERT includes `paidKobo`, `balanceKobo`, `semester`, `dueDate`
5. Staff INSERT includes `firstName`, `lastName`, `email`, `phone`
6. CI/CD YAML includes `wrangler d1 migrations apply --env staging` and `--env production`

**Bugs to look for:**
- `wrangler.toml` still sharing DB ID
- Migration file missing a column
- INSERT statement still missing fields
- Column count mismatch between INSERT `(?)` placeholders and `.bind()` arguments

**Edge cases:**
- Empty firstName or lastName (should be required by Zod — see INS-T02)
- admissionDate in wrong format

**Regression detection:**
- Run existing test suite — no regressions allowed

**Cross-repo assumptions:**
- `@webwaka/core` `AuthUser` type contains `tenantId` — verify the field name matches in `jwtAuthMiddleware`

**Deployment checks:**
- After deploy to staging, run: `wrangler d1 execute webwaka-institutional-staging --command "SELECT name FROM sqlite_master WHERE type='table'"` — must show all 5 tables

**Done when:**
- Two distinct D1 IDs confirmed in wrangler.toml
- All migration files valid SQL
- All INSERT statements complete
- CI/CD runs migrations
- Tests pass

---

### QA-INS-T02: Input Validation QA Plan

**What to verify:**
1. Every POST route has `zValidator('json', schema)` middleware
2. Missing required fields return 400 with `issues` array
3. Invalid email returns 400
4. Negative `amountKobo` returns 400
5. Unknown extra fields are stripped (not stored)
6. Valid payloads return expected 201

**Bugs to look for:**
- Validation applied to wrong route
- `.strict()` used instead of `.strip()` (breaks forward compatibility)
- Required vs optional fields mislabeled in schema
- `amountKobo` accepting floats

**Edge cases:**
- Empty string for required field
- `amountKobo = 0` (should probably be invalid)
- Very long strings in name fields
- SQL injection strings in free text fields (Zod should strip, D1 prepared statements prevent injection)

**Regression:**
- All existing tests must still pass (validation should not break valid payloads)

**Done when:**
- All routes validated
- Invalid inputs consistently return 400 with structured body
- No `any` type in route handlers (TypeScript strict mode)

---

### QA-INS-T03: Global Error Handler QA Plan

**What to verify:**
1. Throwing inside any route returns JSON (not raw text/HTML)
2. Error body has `{ error, code, requestId }`
3. `requestId` is a valid UUID
4. Production mode hides stack trace
5. Development mode shows stack trace

**Bugs to look for:**
- Error handler not registered before routes
- requestId not generated per request (singleton instead of per-request)
- Stack trace leaking in production

**Edge cases:**
- D1 throws during request
- External API throws during request (Paystack, OpenRouter)
- JSON parse error on request body

**Done when:**
- All error paths return JSON
- No stack traces in production response
- requestId present on all error responses

---

### QA-INS-T04: Rate Limiting QA Plan

**What to verify:**
1. 30 POST requests within 60 seconds succeed
2. 31st POST returns 429
3. GET requests not rate limited
4. Rate limit key is per-user (different users have separate limits)

**Bugs to look for:**
- Rate limit applied to GET requests
- Rate limit key is IP-only (not user-specific)
- KV binding not used

**Edge cases:**
- Rate limit window resets correctly after 60 seconds
- Multi-tenant: user from tenant A does not count against tenant B's limits

**Done when:**
- 429 returned after limit exceeded
- GETs not affected
- Per-user isolation confirmed

---

### QA-INS-T05: Student CRUD QA Plan

**What to verify:**
1. PATCH updates only provided fields
2. PATCH rejects changes to `matricNumber`, `tenantId`
3. GET /:id returns 404 for soft-deleted student
4. List endpoint respects `limit` (max 100) and `offset`
5. Search by matricNumber, firstName, lastName works
6. Status filter works
7. Cross-tenant PATCH/DELETE returns 404

**Bugs to look for:**
- PATCH overwrites fields not in the request body with NULL
- Soft-delete not excluding records from list
- Search LIKE query vulnerable to `%` and `_` injection (Zod should sanitize)
- `updatedAt` not updated on PATCH

**Edge cases:**
- PATCH with empty body (should succeed with no changes)
- Status transition to invalid value
- Offset beyond total record count (should return empty array, not error)
- PATCH on deleted student (should return 404)

**Done when:**
- All acceptance criteria met
- Tests cover cross-tenant isolation
- Pagination tested with > 20 records

---

### QA-INS-T06: Staff CRUD QA Plan

Same quality bar as INS-T05. Additional:
- Verify `GET /api/staff/:id` is admin-only
- Verify role enum validation

---

### QA-INS-T07: Fee Collection + Paystack QA Plan

**What to verify:**
1. `POST /api/fees/:id/pay` returns `authorization_url`
2. `POST /webhooks/paystack` signature verified before processing
3. Invalid signature returns 400 (not 200)
4. Valid webhook updates `paidKobo`, `balanceKobo`, `status`
5. Partial payment sets `status = 'partial'`
6. Full payment sets `status = 'success'`
7. Same Paystack reference processed twice is idempotent

**Bugs to look for:**
- Webhook route behind JWT auth (must be unauthenticated with signature verification)
- `paidKobo + balanceKobo ≠ amountKobo` after update
- Reference not stored before API call (double-charge risk)
- `charge.success` vs `charge.completed` event name mismatch

**Edge cases:**
- Webhook with unknown event type (should return 200 and ignore)
- Fee already fully paid, another webhook arrives (idempotent)
- `amountKobo` in webhook doesn't match fee record

**Cross-repo:** If `webwaka-fintech` handles institutional wallets, check if a `fee.paid` event should be emitted to the Event Bus.

**Done when:**
- All payment lifecycle tests pass
- Signature verification tested with correct and incorrect signatures
- Idempotency confirmed

---

### QA-INS-T08: Programme + Course QA Plan

**What to verify:**
1. Programme CRUD works with tenant isolation
2. Course creation validates `programmeId` exists
3. Student creation rejected for invalid `programmeId`
4. `institutionType` validated against enum

**Bugs to look for:**
- Foreign key check (programmeId) not scoped to tenant (could accept another tenant's programme)
- Course code uniqueness not enforced at DB level

**Done when:**
- All acceptance criteria met
- Cross-tenant programmeId rejected

---

### QA-INS-T09: Timetable QA Plan

**What to verify:**
1. Conflict detection prevents staff double-booking
2. Conflict detection prevents venue double-booking
3. Valid slots created successfully
4. GET returns correct slots for programme/semester

**Bugs to look for:**
- Overlap detection using `>` vs `>=` (boundary condition)
- Conflict check not scoped to `tenantId`

**Edge cases:**
- Slot ending exactly when another starts (should NOT be a conflict)
- Same staff, different academic year (should NOT conflict)

**Done when:**
- Overlap tests pass for all boundary cases

---

### QA-INS-T10: Attendance QA Plan

**What to verify:**
1. All status values accepted
2. Duplicate same-day attendance handled
3. Summary percentage correct
4. Bulk mark marks all students in class

**Done when:**
- Attendance lifecycle tests pass
- Summary math verified manually

---

### QA-INS-T11: Admissions Workflow QA Plan

**What to verify:**
1. Valid transitions accepted
2. Invalid transitions rejected with 422
3. SMS triggered on offer (mocked)
4. Student status updated on enrollment

**Bugs to look for:**
- State machine allows skipping states
- SMS failure causes admission route to fail

**Done when:**
- State machine fully tested
- All valid transitions work
- All invalid transitions rejected

---

### QA-INS-T12: Termii SMS QA Plan

**What to verify:**
1. Termii client sends correct API payload
2. Phone number formatted correctly
3. SMS failure does not propagate to caller
4. Message is < 160 characters

**Done when:**
- Termii mock tests pass
- Failure isolation confirmed

---

### QA-INS-T13: NECO Verification QA Plan

**What to verify:**
1. NECO fields optional and backward-compatible
2. NECO API fallback works
3. Combined status (JAMB verified + NECO failed) = manual

**Done when:**
- All three verification paths tested (JAMB only, WAEC only, NECO only, all three, combinations)

---

### QA-INS-T14: AI Analytics QA Plan

**What to verify:**
1. OpenRouter API called with correct model and prompt
2. KV cache hit returns cached response
3. Cache miss calls OpenRouter and stores result
4. Admin-only enforcement
5. Failed OpenRouter call returns 502 (not 500)

**Bugs to look for:**
- API key hardcoded instead of using env
- Cache key collision between tenants
- Large prompt exceeding token limits

**Done when:**
- Mocked OpenRouter tests pass
- Cache logic tested

---

### QA-INS-T15: Audit Log QA Plan

**What to verify:**
1. Every PATCH/DELETE creates an audit entry
2. Audit entries are immutable (no delete route)
3. `previousState` and `newState` are correct JSON diffs
4. Admin can list audit trail

**Bugs to look for:**
- Audit write not in same D1 batch as main write (partial failure possible)
- `previousState` captured after update instead of before

**Done when:**
- Immutability confirmed
- All sensitive operations logged

---

### QA-INS-T16: Reports QA Plan

**What to verify:**
1. Fee summary totals are correct
2. Reports scoped to tenant
3. KV cache returns stale data correctly within TTL

**Done when:**
- Math verified on known test data
- Cache tested

---

### QA-INS-T17: WAEC PIN Security QA Plan

**What to verify:**
1. `SELECT waecScratchCardPin FROM qualificationVerifications` returns NULL for all rows
2. API response does not include `waecScratchCardPin`
3. WAEC verification still works

**Done when:**
- PIN not in DB
- PIN not in API response
- Verification tests pass

---

### QA-INS-T18: Sync Endpoint QA Plan

**What to verify:**
1. Batch of valid mutations processed
2. One invalid mutation doesn't fail batch
3. Cross-tenant mutations rejected
4. Max batch size enforced (100)

**Done when:**
- All batch scenarios tested

---

### QA-INS-T19: Database Indexes QA Plan

**What to verify:**
1. Migration runs without error
2. All 7 new indexes present in schema
3. No duplicate indexes

**Done when:**
- `SELECT name FROM sqlite_master WHERE type='index'` shows all expected indexes

---

### QA-INS-T20: Health Check QA Plan

**What to verify:**
1. `/health` returns all three top-level fields
2. D1 failure causes `status: degraded`
3. Response time includes latency measurements
4. No auth required

**Done when:**
- Healthy and degraded states both tested
- Latency values present in response

---

## 8. IMPLEMENTATION PROMPTS

---

### IMPL-PROMPT-INS-T01: Fix Critical Infrastructure Bugs

```markdown
You are a Replit execution agent responsible for fixing critical infrastructure bugs in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional` (`@webwaka/institutional`)
**Task ID:** INS-T01
**Task Title:** Fix Critical Infrastructure Bugs (Schema, CI/CD, DB Config)

**ECOSYSTEM CAVEAT:** This repository is NOT standalone. It is one component of the multi-repo WebWaka OS v4 platform. Auth comes from `@webwaka/core`. Do not re-implement auth primitives. Focus only on this repo.

**Objective:** Fix the foundational bugs that make the system unusable in production:
1. Staging and production share the same D1 database ID in `wrangler.toml`
2. `students` table and INSERT are missing `firstName, lastName, email, phone, admissionDate, updatedAt`
3. `feeRecords` table and INSERT are missing `paidKobo, balanceKobo, semester, dueDate`
4. `staff` table and INSERT are missing `firstName, lastName, email, phone, updatedAt`
5. CI/CD pipeline never runs D1 migrations

**Prerequisites:** Read `wrangler.toml`, `src/db/schema.sql`, `migrations/`, `src/modules/*/index.ts`, `.github/workflows/deploy.yml` before acting.

**Required Actions:**
1. In `wrangler.toml`: Create a staging section with a placeholder D1 database ID comment. Document that admin must run `wrangler d1 create webwaka-institutional-db-staging` and update the ID.
2. Create `migrations/0003_student_personal_fields.sql`:
   ```sql
   ALTER TABLE students ADD COLUMN firstName TEXT;
   ALTER TABLE students ADD COLUMN lastName TEXT;
   ALTER TABLE students ADD COLUMN email TEXT;
   ALTER TABLE students ADD COLUMN phone TEXT;
   ALTER TABLE students ADD COLUMN admissionDate TEXT;
   ALTER TABLE students ADD COLUMN updatedAt TEXT;
   ```
3. Create `migrations/0004_feerecord_balance_fields.sql`:
   ```sql
   ALTER TABLE feeRecords ADD COLUMN paidKobo INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE feeRecords ADD COLUMN balanceKobo INTEGER;
   ALTER TABLE feeRecords ADD COLUMN semester TEXT;
   ALTER TABLE feeRecords ADD COLUMN dueDate TEXT;
   ```
   After migration, set `balanceKobo = amountKobo` for all existing records.
4. Create `migrations/0005_staff_personal_fields.sql`:
   ```sql
   ALTER TABLE staff ADD COLUMN firstName TEXT;
   ALTER TABLE staff ADD COLUMN lastName TEXT;
   ALTER TABLE staff ADD COLUMN email TEXT;
   ALTER TABLE staff ADD COLUMN phone TEXT;
   ALTER TABLE staff ADD COLUMN updatedAt TEXT;
   ```
5. Update `src/db/schema.sql` to include all new columns.
6. Update student POST INSERT to include all personal fields.
7. Update staff POST INSERT to include all personal fields.
8. Update feeRecord POST INSERT to include `paidKobo = 0`, `balanceKobo = amountKobo`, `semester`, `dueDate`.
9. Update `.github/workflows/deploy.yml` to add migration steps after each deploy.
10. Update existing tests that use the D1 stub to reflect new column counts.

**Important Reminders:**
- All monetary amounts ALWAYS in kobo (integers)
- tenantId ALWAYS from JWT payload, NEVER from request body
- Read all files before editing
- Do not remove existing columns or change existing column types

**Acceptance Criteria:**
- `wrangler.toml` staging and production have different (or clearly distinct) D1 database IDs
- Three migration files exist and are valid SQLite ALTER TABLE statements
- All INSERT statements include all fields defined in TypeScript interfaces
- CI/CD YAML runs `wrangler d1 migrations apply` after each deploy
- All existing tests still pass

**Deliverables:**
- Modified `wrangler.toml`
- 3 new migration files
- Updated `src/db/schema.sql`
- Updated `src/modules/student-mgmt/index.ts`
- Updated `src/modules/staff-mgmt/index.ts`
- Updated `src/modules/fee-collection/index.ts`
- Updated `.github/workflows/deploy.yml`
- Updated tests if needed
```

---

### IMPL-PROMPT-INS-T02: Add Zod Input Validation

```markdown
You are a Replit execution agent implementing input validation in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T02
**Task Title:** Add Input Validation with Zod to All Routes

**ECOSYSTEM CAVEAT:** This is NOT a standalone application. Auth from `@webwaka/core`. Do not rebuild auth. Focus only on request validation.

**Objective:** Add Zod schema validation to every route in all modules using `@hono/zod-validator`. No route should accept raw unvalidated JSON.

**Prerequisites:** Read `package.json`, `src/modules/*/index.ts`, `src/core/types.ts` before acting.

**Required Actions:**
1. Run: `npm install zod @hono/zod-validator`
2. Update `package.json` (it should update automatically from npm install).
3. In `src/core/types.ts`, export Zod schemas alongside TypeScript types:
   - `StudentCreateSchema`, `StudentPatchSchema`
   - `StaffCreateSchema`, `StaffPatchSchema`
   - `FeeRecordCreateSchema`
   - `QualificationSubmitSchema`
4. Apply `zValidator('json', schema)` middleware to every POST and PATCH route.
5. Apply `zValidator('query', schema)` to list endpoints that accept query params.
6. Ensure validation for:
   - `amountKobo`: `z.number().int().positive()`
   - `email`: `z.string().email().optional()`
   - `phone`: `z.string().regex(/^(\+234|0)[789]\d{9}$/).optional()`
   - `academicYear`: `z.string().regex(/^\d{4}\/\d{4}$/)`
   - Status enums: use `z.enum([...])` matching TypeScript enums
7. All schema objects should use `.strip()` (not `.strict()`) to drop unknown fields.
8. Update tests to verify 400 on missing required fields.

**Important Reminders:**
- Do not use `z.any()` as it defeats the purpose
- Zod adds bundle weight — confirm total Worker size remains under Cloudflare's 10 MB limit
- Kobo amounts must be integers, not floats
- Use `.transform()` if needed to coerce string query params to integers

**Acceptance Criteria:**
- `npm run typecheck` passes (no TypeScript errors)
- Every POST/PATCH route has Zod validation
- Missing required field returns `{ error: 'Validation failed', issues: [...] }` with 400
- Extra fields stripped silently

**Deliverables:**
- Updated `package.json`
- Updated `src/core/types.ts` with Zod schemas
- Updated `src/modules/student-mgmt/index.ts`
- Updated `src/modules/staff-mgmt/index.ts`
- Updated `src/modules/fee-collection/index.ts`
- Updated `src/modules/qualification-verification/index.ts`
- Updated tests
```

---

### IMPL-PROMPT-INS-T03: Global Error Handler

```markdown
You are a Replit execution agent implementing a global error handler in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T03
**Task Title:** Add Global Error Handler and Structured Error Responses

**Objective:** Add `app.onError()` in `src/worker.ts` to standardize all error responses.

**Prerequisites:** Read `src/worker.ts` and `src/core/types.ts` before acting.

**Required Actions:**
1. In `src/core/types.ts`, add:
   ```typescript
   export interface ErrorResponse {
     error: string;
     code: string;
     requestId: string;
   }
   ```
2. In `src/worker.ts`, before all routes, add a request ID middleware that sets a UUID on each request using Hono's context.
3. Add `app.onError((err, c) => { ... })` that:
   - Logs `console.error` with stack trace always
   - Returns `{ error: 'Internal server error', code: 'INTERNAL_ERROR', requestId }` in production
   - Returns `{ error: err.message, code: 'INTERNAL_ERROR', requestId, stack: err.stack }` in development/staging
4. Update `app.notFound()` to return `{ error: 'Not found', code: 'NOT_FOUND', requestId }`.
5. Check `c.env.ENVIRONMENT` to determine if stack trace should be included.

**Important Reminders:**
- Never expose stack traces in production (`ENVIRONMENT === 'production'`)
- requestId must be generated per request (UUID)
- Error handler must be registered AFTER routes in Hono

**Acceptance Criteria:**
- All errors return JSON with `error`, `code`, `requestId`
- Production mode hides stack trace
- requestId is a valid UUID

**Deliverables:**
- Updated `src/worker.ts`
- Updated `src/core/types.ts`
```

---

### IMPL-PROMPT-INS-T04: Rate Limiting on Mutations

```markdown
You are a Replit execution agent implementing rate limiting on mutation endpoints in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T04
**Task Title:** Rate Limiting on All Mutation Endpoints

**Objective:** Extend the existing rate limiting (currently only on `/api/auth/*`) to cover all POST, PATCH, and DELETE endpoints.

**Prerequisites:** Read `src/worker.ts` and understand how `rateLimit()` from `@webwaka/core` works. Read the existing rate limit usage at `/api/auth/*`.

**Required Actions:**
1. In `src/worker.ts`, add a new `rateLimit` middleware scoped to mutation methods only.
2. Use method-based routing or middleware that checks `c.req.method` to apply rate limit to POST/PATCH/DELETE only.
3. Configure: 30 requests per 60 seconds per user (use `userId + tenantId` as key prefix).
4. Rate limit key prefix: `'institutional-mutation'`.
5. Update test mock if needed to simulate rate limit behavior.

**Important Reminders:**
- `RATE_LIMIT_KV` binding is already in `Bindings` — use it
- GET requests must NOT be rate limited
- rateLimit comes from `@webwaka/core` — do not re-implement

**Acceptance Criteria:**
- 31st POST within window returns 429
- GET requests not affected
- Rate limit uses user-scoped key

**Deliverables:**
- Updated `src/worker.ts`
```

---

### IMPL-PROMPT-INS-T05: Complete Student CRUD

```markdown
You are a Replit execution agent completing the student management module in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T05
**Task Title:** Complete Student CRUD (PATCH, Soft Delete, Pagination, Filtering)

**ECOSYSTEM CAVEAT:** Not standalone. All auth from `@webwaka/core`. tenantId always from JWT.

**Objective:** Add PATCH, soft delete, pagination, search, and status filtering to the student module.

**Prerequisites:**
- TASK INS-T01 must be complete (schema has all personal data columns)
- TASK INS-T02 must be complete (Zod validation)
- Read `src/modules/student-mgmt/index.ts` and `src/core/types.ts` before acting.

**Required Actions:**
1. Create `migrations/0006_student_soft_delete.sql`:
   ```sql
   ALTER TABLE students ADD COLUMN deletedAt TEXT;
   CREATE INDEX IF NOT EXISTS idx_students_deleted ON students(tenantId, deletedAt);
   ```
2. Add `PATCH /api/students/:id`:
   - Validate body with `StudentPatchSchema` (all fields optional)
   - Cannot change `matricNumber`, `tenantId`, `id`
   - Update `updatedAt = NOW()`
   - Log to audit (if INS-T15 complete) or leave TODO comment
   - Return updated record
3. Add `DELETE /api/students/:id` (soft delete):
   - Set `deletedAt = NOW()`, `status = 'withdrawn'`
   - Return 200 with `{ success: true }`
4. Update `GET /api/students` to:
   - Accept `?status=`, `?limit=20`, `?offset=0`, `?search=`
   - WHERE clause: `tenantId = ? AND deletedAt IS NULL`
   - Search: `LIKE '%' || ? || '%'` on `matricNumber`, `firstName`, `lastName`
   - Validate limit: max 100
   - Return `{ data: [...], total: N, limit: 20, offset: 0 }`
5. Update `GET /api/students/:id` to exclude soft-deleted records.

**Important Reminders:**
- tenantId ALWAYS from JWT
- Soft delete: record stays in DB, just inaccessible via API
- PATCH must be a partial update (only fields present in body are updated)

**Acceptance Criteria:**
- PATCH updates only provided fields
- Deleted students return 404
- Pagination includes total count
- Search works on matricNumber, firstName, lastName
- Cross-tenant operations return 404

**Deliverables:**
- Updated `src/modules/student-mgmt/index.ts`
- New migration file
- Updated tests
```

---

### IMPL-PROMPT-INS-T06: Complete Staff CRUD

```markdown
You are a Replit execution agent completing the staff management module in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T06
**Task Title:** Complete Staff CRUD

**Objective:** Add GET /:id, PATCH, soft delete, pagination, and filtering to the staff module.

**Prerequisites:** TASK INS-T01 (schema), TASK INS-T02 (validation). Read `src/modules/staff-mgmt/index.ts` before acting.

**Required Actions:**
1. Create `migrations/0007_staff_soft_delete.sql` (same pattern as students).
2. Add `GET /api/staff/:id` — admin only.
3. Add `PATCH /api/staff/:id` — update role, department, status, email, phone.
4. Add `DELETE /api/staff/:id` — soft delete, set status to 'inactive'.
5. Update `GET /api/staff` to support `?role=`, `?department=`, `?limit=`, `?offset=`.
6. Validate role against `StaffRole` enum in Zod schema.

**Acceptance Criteria:** Same quality as student CRUD.
**Deliverables:** Updated module, migration, tests.
```

---

### IMPL-PROMPT-INS-T07: Fee Collection + Paystack Integration

```markdown
You are a Replit execution agent implementing the Paystack payment flow in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T07
**Task Title:** Complete Fee Collection Module with Paystack Integration and Webhook Handler

**ECOSYSTEM CAVEAT:** Not standalone. `@webwaka/core` handles auth. If a WebWaka Event Bus exists, emit a `fee.paid` event after successful payment (document this even if the event bus integration is not yet available).

**Objective:** Wire Paystack into the fee module. Create a webhook handler for payment confirmation.

**Prerequisites:** TASK INS-T01 (schema — paidKobo etc.), TASK INS-T02 (validation). Read `src/core/paystack.ts`, `src/modules/fee-collection/index.ts`, `src/worker.ts`.

**Required Actions:**
1. In `src/core/paystack.ts`, add `verifyWebhookSignature(rawBody, signature, secretKey): boolean` using HMAC-SHA512.
2. Create `src/modules/fee-collection/webhook.ts`:
   - `POST /webhooks/paystack` — NOT behind JWT middleware
   - Verify `x-paystack-signature` header
   - Handle `charge.success` event
   - Update `paidKobo`, `balanceKobo`, `status` in `feeRecords`
   - Idempotency: check if reference already processed
3. In `src/modules/fee-collection/index.ts`:
   - Add `POST /api/fees/:id/pay` — initialize Paystack transaction
   - Store generated reference in DB before API call
   - Return `{ authorization_url, reference }`
   - Add `GET /api/fees/:id`
   - Update list to support `?studentId=`, `?academicYear=`, `?status=`
4. In `src/worker.ts`, mount webhook BEFORE the JWT middleware:
   ```typescript
   app.route('/webhooks', paystackWebhookRouter); // before app.use('/api/*', jwtAuthMiddleware())
   ```

**Important Reminders:**
- Webhook must be unauthenticated but signature-verified
- `generatePaymentReference` must be called and stored BEFORE Paystack API call
- `paidKobo + balanceKobo = amountKobo` ALWAYS
- `amountKobo` ALWAYS in kobo (integers)
- PAYSTACK_SECRET_KEY comes from `c.env.PAYSTACK_SECRET_KEY`, never hardcoded

**Acceptance Criteria:**
- Signature verification tested with correct and incorrect signatures
- Idempotency confirmed
- Balance invariant maintained

**Deliverables:**
- Updated `src/core/paystack.ts`
- New `src/modules/fee-collection/webhook.ts`
- Updated `src/modules/fee-collection/index.ts`
- Updated `src/worker.ts`
- Tests for all scenarios
```

---

### IMPL-PROMPT-INS-T08: Programme and Course Management

```markdown
You are a Replit execution agent implementing programme and course management in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T08
**Task Title:** Programme and Course Management Module

**ECOSYSTEM CAVEAT:** Not standalone. Auth from `@webwaka/core`. tenantId always from JWT.

**Objective:** Create a programme and course management module so `programmeId` in students refers to real data.

**Prerequisites:** TASK INS-T01, TASK INS-T02. Read all existing files before acting.

**Required Actions:**
1. Create `migrations/0008_programmes_courses.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS programmes (
     id TEXT PRIMARY KEY,
     tenantId TEXT NOT NULL,
     name TEXT NOT NULL,
     code TEXT NOT NULL,
     durationYears INTEGER NOT NULL,
     institutionType TEXT NOT NULL,
     createdAt TEXT NOT NULL,
     updatedAt TEXT NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS idx_programmes_tenant_code ON programmes(tenantId, code);
   CREATE TABLE IF NOT EXISTS courses (
     id TEXT PRIMARY KEY,
     tenantId TEXT NOT NULL,
     programmeId TEXT NOT NULL,
     code TEXT NOT NULL,
     title TEXT NOT NULL,
     creditUnits INTEGER NOT NULL DEFAULT 3,
     semester INTEGER NOT NULL,
     createdAt TEXT NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_tenant_code ON courses(tenantId, programmeId, code);
   ```
2. Add `Programme` and `Course` interfaces to `src/core/types.ts`.
3. Create `src/modules/programme-mgmt/index.ts` with full CRUD for programmes and courses.
4. Mount at `/api/programmes` in `src/worker.ts`.
5. Update student CREATE to validate `programmeId` exists via a SELECT query.

**Important Reminders:**
- `institutionType` must validate against `InstitutionType` enum
- Unique code per tenant (not globally)

**Acceptance Criteria:**
- Programme CRUD works
- Course CRUD works
- Student creation rejected for invalid programmeId
- Cross-tenant isolation enforced

**Deliverables:**
- Migration, new module, updated types, updated worker, tests
```

---

### IMPL-PROMPT-INS-T09: Timetable Management

```markdown
You are a Replit execution agent implementing a timetable management module in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T09
**Task Title:** Timetable Management Module

**Objective:** Create a timetable module with conflict detection.

**Prerequisites:** TASK INS-T08 (courses), TASK INS-T01, TASK INS-T02. Read all existing code.

**Required Actions:**
1. Create `migrations/0009_timetable.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS timetableSlots (
     id TEXT PRIMARY KEY,
     tenantId TEXT NOT NULL,
     programmeId TEXT NOT NULL,
     courseId TEXT NOT NULL,
     staffId TEXT NOT NULL,
     dayOfWeek INTEGER NOT NULL,
     periodStart TEXT NOT NULL,
     periodEnd TEXT NOT NULL,
     venue TEXT NOT NULL,
     semester INTEGER NOT NULL,
     academicYear TEXT NOT NULL,
     createdAt TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_timetable_tenant ON timetableSlots(tenantId);
   CREATE INDEX IF NOT EXISTS idx_timetable_staff ON timetableSlots(tenantId, staffId, dayOfWeek);
   ```
2. Implement conflict detection before INSERT:
   - Query: same `tenantId + staffId + dayOfWeek` where periods overlap
   - Query: same `tenantId + venue + dayOfWeek` where periods overlap
3. Full CRUD in `src/modules/timetable/index.ts`.
4. Mount at `/api/timetable` in worker.

**Conflict detection logic:**
A slot A conflicts with slot B if: `A.start < B.end AND A.end > B.start` (standard interval overlap).

**Acceptance Criteria:**
- Staff double-booking returns 409
- Venue double-booking returns 409
- Adjacent slots (one ends at 10:00, other starts at 10:00) do NOT conflict

**Deliverables:** Migration, module, tests.
```

---

### IMPL-PROMPT-INS-T10: Attendance Tracking

```markdown
You are a Replit execution agent implementing attendance tracking in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T10
**Task Title:** Attendance Tracking Module

**Objective:** Track student attendance per course per day with summary reporting.

**Prerequisites:** TASK INS-T08 (courses), TASK INS-T01, TASK INS-T02.

**Required Actions:**
1. Create `migrations/0010_attendance.sql`.
2. Create `src/modules/attendance/index.ts` with:
   - `POST /api/attendance` — single attendance mark
   - `POST /api/attendance/bulk` — mark whole class
   - `GET /api/attendance` — filtered list
   - `GET /api/attendance/summary/:studentId` — per-course attendance percentage
3. Upsert logic for duplicate same-day entries.
4. Summary: `{ courseId, totalClasses, attended, percentage }[]`

**Acceptance Criteria:** All acceptance criteria from task description met.
**Deliverables:** Migration, module, tests.
```

---

### IMPL-PROMPT-INS-T11: Admission Workflow

```markdown
You are a Replit execution agent implementing the student admission workflow in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T11
**Task Title:** Student Admission Workflow with Status Transitions

**Objective:** Model a structured admission process with validated status transitions.

**Prerequisites:** TASK INS-T01, TASK INS-T05, TASK INS-T08.

**Required Actions:**
1. Create `migrations/0011_admissions.sql`.
2. Create `src/modules/admissions/index.ts`.
3. Implement state machine:
   - Valid forward transitions: `applied → shortlisted`, `shortlisted → offered`, `offered → accepted`, `accepted → enrolled`, any → `rejected`
   - Invalid transitions return 422 with message
4. On `accepted → enrolled`: update student `status = 'active'` in same D1 batch.
5. Fire Termii SMS on `offered` (if INS-T12 complete) — leave TODO if not.

**Acceptance Criteria:** State machine fully tested.
**Deliverables:** Migration, module, tests.
```

---

### IMPL-PROMPT-INS-T12: Termii SMS Integration

```markdown
You are a Replit execution agent implementing Termii SMS notifications in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T12
**Task Title:** Termii SMS Notification Integration

**Objective:** Create a Termii SMS client and wire it to key institutional events.

**Prerequisites:** Read `src/core/types.ts` (Bindings has TERMII_API_KEY). Read Termii API documentation pattern.

**Required Actions:**
1. Create `src/core/termii.ts`:
   ```typescript
   export async function sendSMS(apiKey: string, to: string, message: string): Promise<void>
   ```
   - POST to `https://api.ng.termii.com/api/sms/send`
   - Format: `{ to, from: 'WebWaka', sms: message, type: 'plain', channel: 'dnd', api_key: apiKey }`
   - Normalize phone: `08012345678 → +2348012345678`
   - fire-and-forget (do not await in routes, or wrap in try/catch and log failure)
2. Wire into fee-collection webhook (on charge.success)
3. Wire into qualification-verification (on verified/rejected)
4. Wire into admissions (on offered, enrolled)
5. Message templates under 160 chars:
   - Fee paid: `"Fee payment confirmed: ₦{amount} for {academicYear}. Ref: {reference}"`
   - Verified: `"Your qualifications have been verified for {programme}."`
   - Offered: `"Congratulations! You have been offered admission to {programme} at {institution}."`

**Important Reminders:**
- TERMII_API_KEY from `c.env.TERMII_API_KEY` — never hardcoded
- SMS failure MUST NOT fail the parent operation
- Phone formatting: strip leading 0, add +234

**Acceptance Criteria:** Termii client tested, failure isolation confirmed.
**Deliverables:** `src/core/termii.ts`, updates to modules, tests.
```

---

### IMPL-PROMPT-INS-T13: NECO Verification

```markdown
You are a Replit execution agent extending JAMB/WAEC verification to include NECO in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T13
**Task Title:** NECO Verification Support

**Objective:** Add NECO (National Examinations Council) verification alongside JAMB and WAEC.

**Prerequisites:** TASK INS-T01. Read `src/core/qualifications.ts` and `src/modules/qualification-verification/index.ts`.

**Required Actions:**
1. Create `migrations/0012_neco_fields.sql`:
   ```sql
   ALTER TABLE qualificationVerifications ADD COLUMN necoExamNumber TEXT;
   ALTER TABLE qualificationVerifications ADD COLUMN necoVerifiedAt TEXT;
   ALTER TABLE qualificationVerifications ADD COLUMN necoApiRaw TEXT;
   ```
2. In `src/core/qualifications.ts`, add:
   - `NecoVerifyParams`, `NecoVerifyResult` interfaces
   - `verifyNecoResult(params)` function (same pattern as JAMB/WAEC, same fallback contract)
   - Target: `https://api.neco.gov.ng/v1/result/verify` (placeholder — same structure assumption)
3. In `src/core/types.ts`, add NECO fields to `QualificationVerification` interface.
4. Add `NECO_API_KEY` to `Bindings` interface.
5. Update `wrangler.toml` secrets comment to include NECO_API_KEY.
6. Update qualification verification router to include NECO fields.
7. Combined status logic:
   - If ALL APIs that were requested succeeded → `verified`
   - If ANY requested API failed → `awaiting_review`

**Acceptance Criteria:** All verification combinations tested (JAMB only, WAEC only, NECO only, all three, mixed success/failure).
**Deliverables:** Migration, updated qualifications.ts, updated types, updated router, tests.
```

---

### IMPL-PROMPT-INS-T14: AI Analytics Endpoints

```markdown
You are a Replit execution agent implementing AI-powered analytics endpoints in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T14
**Task Title:** AI Analytics Endpoints via OpenRouter

**ECOSYSTEM CAVEAT:** Not standalone. AI must use OpenRouter ONLY (Invariant 7: Vendor Neutral AI). NEVER call OpenAI, Anthropic, or Google APIs directly.

**Objective:** Wire the existing `getAICompletion` function into actionable analytics endpoints.

**Prerequisites:** TASK INS-T07 (fee data), TASK INS-T10 (attendance data). Read `src/core/ai.ts`.

**Required Actions:**
1. Create `src/modules/ai-insights/index.ts` with:
   - `POST /api/ai/insights/at-risk-students` — admin only
   - `POST /api/ai/insights/fee-defaulter-prediction` — admin only
   - `POST /api/ai/insights/admissions-summary` — admin only
2. For each endpoint:
   - Fetch relevant DB data (attendance, fees, admissions)
   - Build a structured prompt with real data
   - Call `getAICompletion(c.env.OPENROUTER_API_KEY, { prompt, systemPrompt, model })`
   - Cache result in `SESSIONS_KV` for 1 hour: key = `ai:insights:${tenantId}:${type}`
   - Return `{ analysis: string, model: string, cachedAt: ISO8601, cachedUntil: ISO8601 }`
3. Cache hit: return cached without calling OpenRouter
4. OpenRouter failure: return 502 (not 500) with `{ error: 'AI service temporarily unavailable' }`

**Important Reminders:**
- OPENROUTER_API_KEY from `c.env.OPENROUTER_API_KEY` — never hardcoded
- Default model `anthropic/claude-3-haiku` (already in ai.ts)
- Cache key MUST include tenantId to prevent cross-tenant data leakage
- Large datasets: summarize before sending to AI (do not send raw 10K records)

**Acceptance Criteria:**
- All endpoints admin-only
- Cache hit tested
- API failure returns 502
- No cross-tenant data in prompts

**Deliverables:** New module, updated worker, tests with mocked OpenRouter.
```

---

### IMPL-PROMPT-INS-T15: Audit Log

```markdown
You are a Replit execution agent implementing an audit log system in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T15
**Task Title:** Audit Log Trail for All Sensitive Operations

**Objective:** Record all sensitive data changes in an append-only audit log.

**Prerequisites:** TASK INS-T01. Read all module files.

**Required Actions:**
1. Create `migrations/0013_audit_log.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS auditLog (
     id TEXT PRIMARY KEY,
     tenantId TEXT NOT NULL,
     actorId TEXT NOT NULL,
     action TEXT NOT NULL,
     entityType TEXT NOT NULL,
     entityId TEXT NOT NULL,
     previousState TEXT,
     newState TEXT,
     createdAt TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_auditLog_entity ON auditLog(tenantId, entityType, entityId);
   CREATE INDEX IF NOT EXISTS idx_auditLog_tenant ON auditLog(tenantId, createdAt);
   ```
2. Create `src/core/audit.ts`:
   ```typescript
   export async function logAudit(db: D1Database, entry: {...}): Promise<void>
   ```
   - Use D1 batch API to write audit log atomically with the main write
3. Call `logAudit` in:
   - Student PATCH and DELETE
   - Fee status updates
   - Qualification verification review
   - Admission status transitions
4. Add `GET /api/audit?entityType=&entityId=` — admin only, read audit trail.
5. No PUT, PATCH, or DELETE route for auditLog — append-only.

**Important Reminders:**
- `previousState` must be captured BEFORE the update, not after
- Use D1 batch for atomicity
- Audit log entries MUST NOT be modifiable

**Acceptance Criteria:** Every sensitive change logged. Immutability confirmed.
**Deliverables:** Migration, `src/core/audit.ts`, updated modules, new read endpoint, tests.
```

---

### IMPL-PROMPT-INS-T16: Reporting Endpoints

```markdown
You are a Replit execution agent implementing reporting endpoints in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T16
**Task Title:** Reporting and Analytics Endpoints

**Objective:** Aggregate reporting endpoints for institutional dashboards.

**Prerequisites:** TASK INS-T01, TASK INS-T07, TASK INS-T10.

**Required Actions:**
1. Create `src/modules/reports/index.ts`:
   - `GET /api/reports/students/summary` — count by status, count by programme
   - `GET /api/reports/fees/summary?academicYear=` — total amountKobo, total paidKobo, outstanding
   - `GET /api/reports/attendance/summary?courseId=` — avg attendance rate
   - `GET /api/reports/qualifications/summary` — count by verificationStatus
2. Cache each report in KV for 5 minutes.
3. All responses include `{ data: {...}, generatedAt, cachedUntil }`.
4. All amounts in kobo integers.

**Acceptance Criteria:** Math correct, tenant-scoped, cached.
**Deliverables:** Module, updated worker, tests.
```

---

### IMPL-PROMPT-INS-T17: WAEC PIN Security Fix

```markdown
You are a Replit execution agent fixing a security vulnerability in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T17
**Task Title:** WAEC PIN Security Fix — Remove from Storage

**Objective:** Stop persisting waecScratchCardPin in the database.

**Prerequisites:** Read `src/modules/qualification-verification/index.ts` and `migrations/0002_qualification_verifications.sql`.

**Required Actions:**
1. Create `migrations/0014_remove_waec_pin.sql`:
   ```sql
   UPDATE qualificationVerifications SET waecScratchCardPin = NULL;
   ```
2. Update `src/modules/qualification-verification/index.ts` INSERT to NOT include `waecScratchCardPin`.
3. Keep `waecScratchCardPin` column in DB for now (it's a migration rollback concern) but make it always NULL.
4. Update `src/core/types.ts` to mark `waecScratchCardPin` as `@deprecated`.
5. Ensure `GET /api/qualifications/:id` response does not return `waecScratchCardPin`.
6. Update tests.

**Acceptance Criteria:** PIN not in DB, not in API response, verification still works.
**Deliverables:** Migration, updated module, updated tests.
```

---

### IMPL-PROMPT-INS-T18: Offline Sync Endpoint

```markdown
You are a Replit execution agent implementing an offline sync endpoint in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T18
**Task Title:** Offline Sync Trigger Endpoint

**Objective:** Create a server-side batch mutation endpoint to receive queued offline mutations from Dexie.

**Prerequisites:** Read `src/db/db.ts`. Read `src/worker.ts`.

**Required Actions:**
1. Create `src/modules/sync/index.ts`:
   - `POST /api/sync/mutations` — authenticated, accepts array of `{ endpoint, method, payload }` (max 100)
   - For each mutation: validate method is POST/PATCH/DELETE, validate endpoint starts with `/api/`
   - Route each mutation to the appropriate internal handler (or use `app.fetch` pattern)
   - Return `{ processed: N, failed: [{ index, error }] }`
2. Add `MAX_RETRY_COUNT = 5` to `src/db/db.ts` as exported constant.
3. Document service worker pattern in `docs/service-worker-integration.md`.

**Important Reminders:**
- tenantId from JWT always — ignore any tenantId in mutation payload
- Mutations over retryCount 5 auto-rejected
- This is the bridge between the Dexie offline layer and the D1 server layer

**Acceptance Criteria:** Batch processing tested, cross-tenant rejection tested.
**Deliverables:** Module, updated db.ts, documentation.
```

---

### IMPL-PROMPT-INS-T19: Compound Database Indexes

```markdown
You are a Replit execution agent adding database performance optimizations to the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T19
**Task Title:** Compound Database Indexes and Query Optimization

**Objective:** Add compound indexes to improve performance for the most common query patterns.

**Prerequisites:** TASK INS-T01. Read `src/db/schema.sql` and all migration files.

**Required Actions:**
1. Create `migrations/0015_compound_indexes.sql` with all 7 compound indexes (listed in task description).
2. Update `src/db/schema.sql` to include all new indexes.
3. Add `LIMIT 20` as a default cap to all existing list queries that don't already have it.

**Acceptance Criteria:** Migration runs without error. All indexes confirmed present.
**Deliverables:** Migration file, updated schema.
```

---

### IMPL-PROMPT-INS-T20: Enhanced Health Check

```markdown
You are a Replit execution agent enhancing the health check endpoint in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T20
**Task Title:** Health Check Enhancement

**Objective:** Make the `/health` endpoint actually check D1 and KV connectivity.

**Prerequisites:** Read `src/worker.ts`.

**Required Actions:**
1. In `src/worker.ts`, update `GET /health`:
   - Run `SELECT 1` on D1, measure latency
   - Run `KV.get('health-ping')`, measure latency
   - Return structured health response with all check results
   - `status: 'ok'` if all checks pass, `'degraded'` if any fail
   - Return 200 for ok/degraded, 503 for unhealthy (catch all checks failing)
2. Keep it unauthenticated.
3. Keep response time < 500ms (use Promise.allSettled for parallel checks).

**Acceptance Criteria:** D1 failure causes degraded status. Latency values present.
**Deliverables:** Updated `src/worker.ts`, tests.
```

---

## 9. QA PROMPTS

---

### QA-PROMPT-INS-T01

```markdown
You are a Replit QA and Bug-Fix agent verifying TASK INS-T01 in the `webwaka-institutional` repository.

**Repository:** `webwaka-institutional`
**Task ID:** INS-T01 QA
**Scope:** Critical infrastructure bug fixes (schema, CI/CD, DB config)

**ECOSYSTEM CAVEAT:** This repo is part of the WebWaka multi-repo platform. Auth from `@webwaka/core`. Do not question the JWT/auth design — focus on the bugs listed.

**Verification Steps:**
1. Open `wrangler.toml` — confirm staging and production have DIFFERENT D1 database IDs. If same, FIX IT immediately.
2. Open `migrations/0003_student_personal_fields.sql` — confirm it exists and adds `firstName, lastName, email, phone, admissionDate, updatedAt` to students. If missing, CREATE IT.
3. Open `migrations/0004_feerecord_balance_fields.sql` — confirm adds `paidKobo, balanceKobo, semester, dueDate`. If missing, CREATE IT.
4. Open `migrations/0005_staff_personal_fields.sql` — confirm adds `firstName, lastName, email, phone, updatedAt` to staff. If missing, CREATE IT.
5. Open `src/modules/student-mgmt/index.ts` — confirm INSERT includes all student fields. If not, FIX IT.
6. Open `src/modules/fee-collection/index.ts` — confirm INSERT includes `paidKobo = 0, balanceKobo = amountKobo`. If not, FIX IT.
7. Open `.github/workflows/deploy.yml` — confirm `wrangler d1 migrations apply` steps exist. If not, ADD THEM.
8. Run `npm test` — all tests must pass.
9. Run `npm run typecheck` — no TypeScript errors.

**If any issue is found, FIX THE CODE DIRECTLY. Do not merely report.**

**Re-test after fixes.**

**Certification report:** List all fixes applied, confirm all checks pass.
```

---

### QA-PROMPT-INS-T02

```markdown
You are a Replit QA and Bug-Fix agent verifying TASK INS-T02 in the `webwaka-institutional` repository.

**Task ID:** INS-T02 QA — Input Validation

**Verification Steps:**
1. Confirm `zod` and `@hono/zod-validator` in `package.json`.
2. For each POST/PATCH route, confirm `zValidator('json', schema)` is applied.
3. Send a request with missing `studentId` to `POST /api/students` — expect 400 with `issues` array.
4. Send `amountKobo: 50.5` (float) — expect 400.
5. Send `email: "not-an-email"` — expect 400.
6. Send valid payload — expect 201.
7. Confirm no `any` types used in route handlers (TypeScript).
8. Confirm schemas use `.strip()` not `.strict()`.

**Fix any issue found directly. Re-test after fixes.**
```

---

### QA-PROMPT-INS-T03

```markdown
You are a Replit QA and Bug-Fix agent verifying TASK INS-T03 in the `webwaka-institutional` repository.

**Task ID:** INS-T03 QA — Global Error Handler

**Verification Steps:**
1. Confirm `app.onError()` exists in `src/worker.ts`.
2. Add a test route that throws, confirm it returns JSON (not HTML/text).
3. Confirm response body has `{ error, code, requestId }`.
4. Confirm `requestId` is a UUID.
5. Confirm `ENVIRONMENT = 'production'` hides stack trace in response.
6. Confirm `ENVIRONMENT = 'development'` includes stack trace.
7. Run all tests — no regressions.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T04

```markdown
You are a Replit QA and Bug-Fix agent verifying TASK INS-T04 in the `webwaka-institutional` repository.

**Task ID:** INS-T04 QA — Rate Limiting on Mutations

**Verification Steps:**
1. Confirm rate limit middleware applied to POST/PATCH/DELETE in `worker.ts`.
2. Write a test simulating 31 rapid POST requests — 31st must return 429.
3. Confirm GET requests are NOT rate limited.
4. Confirm rate limit key includes userId (not just IP).

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T05

```markdown
You are a Replit QA and Bug-Fix agent verifying TASK INS-T05 in the `webwaka-institutional` repository.

**Task ID:** INS-T05 QA — Student CRUD

**Verification Steps:**
1. PATCH with only `status` — confirm only status changed, other fields unchanged.
2. PATCH attempting to change `matricNumber` — confirm 422 or ignored.
3. DELETE student — confirm GET/:id returns 404.
4. GET list with `limit=5, offset=0` — confirm max 5 records returned.
5. GET list with `search=chike` — confirm results filtered.
6. GET list with `status=active` — confirm only active students.
7. Attempt PATCH on another tenant's student — confirm 404.
8. Confirm `updatedAt` changes after PATCH.
9. Run `npm test` — all tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T06

```markdown
You are a Replit QA and Bug-Fix agent verifying TASK INS-T06 — Staff CRUD. Same quality bar as INS-T05. Apply same verification steps to staff module. Fix any issue found directly.
```

---

### QA-PROMPT-INS-T07

```markdown
You are a Replit QA and Bug-Fix agent verifying TASK INS-T07 in the `webwaka-institutional` repository.

**Task ID:** INS-T07 QA — Fee Collection + Paystack

**Verification Steps:**
1. Confirm `POST /api/fees/:id/pay` returns `{ authorization_url, reference }`.
2. Confirm `POST /webhooks/paystack` does NOT require JWT (unauthenticated route).
3. Confirm webhook verifies `x-paystack-signature` header using HMAC-SHA512.
4. Send webhook with invalid signature — confirm 400.
5. Send valid `charge.success` webhook — confirm fee `status = 'success'`, `paidKobo` updated, `balanceKobo = 0`.
6. Send same webhook a second time — confirm idempotent (no double-update).
7. Partial payment: `amount_paid < amountKobo` — confirm `status = 'partial'`.
8. Confirm `paidKobo + balanceKobo = amountKobo` after any update.
9. Confirm `PAYSTACK_SECRET_KEY` not hardcoded anywhere.
10. Run all tests — pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T08

```markdown
You are a Replit QA agent verifying TASK INS-T08 — Programme and Course Management.

**Verification Steps:**
1. Programme CRUD works, tenant-scoped.
2. Course CRUD works, linked to programme.
3. Student creation with invalid programmeId returns 422.
4. Cross-tenant programmeId rejected.
5. `institutionType` validates against enum.
6. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T09

```markdown
You are a Replit QA agent verifying TASK INS-T09 — Timetable Management.

**Verification Steps:**
1. Create slot A: staff X, Monday, 09:00-10:00. Succeeds.
2. Create slot B: staff X, Monday, 09:30-10:30. Must return 409 (conflict).
3. Create slot C: staff X, Monday, 10:00-11:00 (adjacent). Must SUCCEED (not conflict).
4. Create slot D: venue Room1, Monday 09:00-10:00. Succeeds.
5. Create slot E: venue Room1, Monday 09:30-10:30. Must return 409.
6. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T10

```markdown
You are a Replit QA agent verifying TASK INS-T10 — Attendance Tracking.

**Verification Steps:**
1. Mark student present for course on date X. Succeeds.
2. Mark same student for same course on same date again — idempotent or 409.
3. Summary returns correct percentage: 3 present out of 5 classes = 60%.
4. Bulk mark marks all students in one request.
5. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T11

```markdown
You are a Replit QA agent verifying TASK INS-T11 — Admission Workflow.

**Verification Steps:**
1. `applied → shortlisted` — succeeds.
2. `shortlisted → offered` — succeeds.
3. `applied → enrolled` — returns 422 (invalid transition).
4. `offered → accepted` — succeeds.
5. `accepted → enrolled` — succeeds, student.status = 'active'.
6. Any → `rejected` — succeeds from any state.
7. SMS trigger on offered (mocked, does not fail).
8. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T12

```markdown
You are a Replit QA agent verifying TASK INS-T12 — Termii SMS.

**Verification Steps:**
1. `sendSMS` sends correct payload to Termii API.
2. `08012345678` normalized to `+2348012345678`.
3. Termii failure does NOT cause calling route to return 5xx.
4. All messages under 160 chars.
5. TERMII_API_KEY not hardcoded.
6. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T13

```markdown
You are a Replit QA agent verifying TASK INS-T13 — NECO Verification.

**Verification Steps:**
1. NECO verify success path tested.
2. NECO API unreachable → manual fallback.
3. JAMB verified + NECO failed = `awaiting_review`.
4. Backward compatibility: existing records without NECO fields still load.
5. NECO_API_KEY not hardcoded.
6. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T14

```markdown
You are a Replit QA agent verifying TASK INS-T14 — AI Analytics.

**Verification Steps:**
1. `POST /api/ai/insights/at-risk-students` — admin only.
2. Non-admin gets 403.
3. Mocked OpenRouter returns analysis — response includes `analysis`, `model`, `cachedAt`.
4. Second call within 1 hour — returns cached, does NOT call OpenRouter again.
5. OpenRouter failure — returns 502.
6. Cache key includes tenantId — different tenants get different caches.
7. No actual OpenRouter API key needed in tests (fully mocked).
8. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T15

```markdown
You are a Replit QA agent verifying TASK INS-T15 — Audit Log.

**Verification Steps:**
1. Student PATCH creates audit entry with correct `previousState` and `newState`.
2. `previousState` captured before update.
3. No DELETE route for auditLog — attempting returns 405.
4. No PATCH route for auditLog.
5. Admin GET returns audit trail for entity.
6. Cross-tenant audit entries not visible.
7. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T16

```markdown
You are a Replit QA agent verifying TASK INS-T16 — Reports.

**Verification Steps:**
1. Fee summary: seed 3 fee records, check totals are correct kobo integers.
2. All reports scoped to tenant (different tenant sees different data).
3. KV cache hit within 5 minutes returns same data.
4. All responses include `generatedAt` and `cachedUntil`.
5. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T17

```markdown
You are a Replit QA agent verifying TASK INS-T17 — WAEC PIN Security.

**Verification Steps:**
1. Create qualification verification with WAEC fields.
2. Query DB directly: `SELECT waecScratchCardPin FROM qualificationVerifications WHERE id = ?` — must return NULL.
3. GET /api/qualifications/:id — response must not include `waecScratchCardPin` (or returns null).
4. WAEC verification still works correctly.
5. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T18

```markdown
You are a Replit QA agent verifying TASK INS-T18 — Offline Sync.

**Verification Steps:**
1. POST /api/sync/mutations with 5 valid mutations — all processed, `processed: 5, failed: []`.
2. Batch with 1 invalid mutation — `processed: 4, failed: [{ index: X, error: '...' }]`.
3. Cross-tenant mutation in batch — rejected, does not affect others.
4. Batch > 100 items — returns 400.
5. All tests pass.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T19

```markdown
You are a Replit QA agent verifying TASK INS-T19 — Database Indexes.

**Verification Steps:**
1. Migration `0015_compound_indexes.sql` runs without error.
2. `SELECT name FROM sqlite_master WHERE type='index'` returns all 7 new compound indexes.
3. No duplicate indexes (compare with existing single-column indexes).
4. `src/db/schema.sql` updated to reflect all indexes.

**Fix any issue found directly.**
```

---

### QA-PROMPT-INS-T20

```markdown
You are a Replit QA agent verifying TASK INS-T20 — Health Check Enhancement.

**Verification Steps:**
1. GET /health with healthy D1 and KV — status: 'ok', all checks pass.
2. Mocked D1 failure — status: 'degraded', d1.status: 'error'.
3. Response includes `checks.d1.latencyMs` and `checks.kv.latencyMs` as numbers.
4. Endpoint requires no auth.
5. Response time < 500ms.
6. All tests pass.

**Fix any issue found directly.**
```

---

## 10. PRIORITY ORDER

### Phase 1 — Foundation (Must do first; unblocks everything)

| # | Task | Why First |
|---|------|-----------|
| P1.1 | INS-T01 | Fixes critical bugs; all other tasks depend on correct schema |
| P1.2 | INS-T03 | Error handling needed before adding more routes |
| P1.3 | INS-T02 | Validation needed before any CRUD expansion |
| P1.4 | INS-T04 | Security hardening before exposing more endpoints |
| P1.5 | INS-T17 | Security fix — remove sensitive data from storage |

### Phase 2 — Core Domain Completion (Main delivery)

| # | Task | Why This Order |
|---|------|----------------|
| P2.1 | INS-T05 | Student CRUD completion (most critical entity) |
| P2.2 | INS-T06 | Staff CRUD completion |
| P2.3 | INS-T07 | Fee payment flow — revenue-critical |
| P2.4 | INS-T08 | Programmes — enables timetable and attendance |
| P2.5 | INS-T09 | Timetable — core institutional operation |
| P2.6 | INS-T10 | Attendance — depends on courses |
| P2.7 | INS-T11 | Admissions workflow |
| P2.8 | INS-T12 | SMS notifications (wired into admission/payment/verification) |
| P2.9 | INS-T13 | NECO verification (extends existing pattern) |
| P2.10 | INS-T15 | Audit log (cross-cutting) |

### Phase 3 — Intelligence and Operations

| # | Task | Notes |
|---|------|-------|
| P3.1 | INS-T14 | AI analytics (requires Phase 2 data) |
| P3.2 | INS-T16 | Reporting endpoints |
| P3.3 | INS-T18 | Offline sync endpoint |
| P3.4 | INS-T19 | Database optimization |
| P3.5 | INS-T20 | Health check enhancement |

---

## 11. DEPENDENCIES MAP

```
INS-T01 (Schema Fixes)
  └── INS-T02 (Validation) 
        └── INS-T05 (Student CRUD)
              └── INS-T11 (Admissions)
        └── INS-T06 (Staff CRUD)
        └── INS-T07 (Fee + Paystack)
              └── INS-T14 (AI Analytics)
              └── INS-T16 (Reports)
        └── INS-T08 (Programmes)
              └── INS-T09 (Timetable)
              └── INS-T10 (Attendance)
                    └── INS-T14 (AI Analytics)
                    └── INS-T16 (Reports)
  └── INS-T17 (WAEC PIN)
  └── INS-T13 (NECO)
  └── INS-T15 (Audit Log)
  └── INS-T19 (Indexes)

INS-T03 (Error Handler) — Independent, do early
INS-T04 (Rate Limiting) — Independent, do early
INS-T12 (Termii SMS) — Depends on modules being complete
INS-T18 (Sync) — Independent
INS-T20 (Health Check) — Independent
```

---

## 12. PHASE SPLIT

### Phase 1 Tasks (Immediate — Foundation and Bug Fixes)

- INS-T01: Fix Critical Infrastructure Bugs
- INS-T02: Add Input Validation (Zod)
- INS-T03: Global Error Handler
- INS-T04: Rate Limiting on Mutations
- INS-T17: WAEC PIN Security Fix

**Phase 1 Deliverable:** A secure, schema-correct, validating API with proper error handling. CI/CD runs migrations. Staging and production separated.

### Phase 2 Tasks (Core Domain — Main Product Features)

- INS-T05: Complete Student CRUD
- INS-T06: Complete Staff CRUD
- INS-T07: Fee Collection + Paystack
- INS-T08: Programme and Course Management
- INS-T09: Timetable Management
- INS-T10: Attendance Tracking
- INS-T11: Admission Workflow
- INS-T12: Termii SMS
- INS-T13: NECO Verification
- INS-T15: Audit Log

**Phase 2 Deliverable:** A complete institutional management platform: student lifecycle, staff management, fee collection with Paystack, timetabling, attendance, admissions, SMS notifications, NECO support, and audit trails.

### Phase 3 Tasks (Intelligence and Optimization)

- INS-T14: AI Analytics
- INS-T16: Reporting Endpoints
- INS-T18: Offline Sync Endpoint
- INS-T19: Compound Database Indexes
- INS-T20: Enhanced Health Check

**Phase 3 Deliverable:** An AI-powered, analytics-rich, offline-resilient, production-optimized institutional platform.

---

## 13. ECOSYSTEM NOTES

### This Repo is NOT Standalone

The `webwaka-institutional` repository is one of at least 11 WebWaka repos. The following capabilities intentionally live elsewhere:

| Capability | Where it Lives | Integration Point |
|-----------|----------------|-------------------|
| Institutional wallet / ledger | `webwaka-fintech` | After fee payment, emit `fee.paid` event to Event Bus |
| Super-admin institution onboarding | Platform-admin repo | Tenant creation happens outside this repo |
| Cross-institutional analytics | Analytics repo | This repo exposes data via APIs for that service |
| Push notifications (mobile) | `@webwaka/core` or notifications repo | Termii SMS is this repo's responsibility |
| NIBSS transfers / fee refunds | `webwaka-fintech` | Refund workflows live in fintech, not here |
| Authentication infrastructure | `@webwaka/core` npm package | NEVER re-implement auth primitives here |

### Event Bus Integration (Future)

When the WebWaka Event Bus is available, this repo should emit:
- `student.enrolled` — on admission enrollment
- `fee.paid` — on successful Paystack webhook
- `qualification.verified` — on verification success or manual review
- `admission.offered` — on offer made

Document these as TODOs in the code until the Event Bus integration is formalized.

### `@webwaka/core` Version Dependency

Currently pinned to `^1.3.2`. The mock in `src/__mocks__/@webwaka/core.ts` uses different type definitions than what the production package likely exports. Specifically:
- Mock uses `role: 'admin'` (string)
- The mock defines `WebWakaRole` as `'SUPER_ADMIN' | 'TENANT_ADMIN' | 'INSTITUTION_ADMIN' | 'STAFF' | 'VIEWER'`
- But routes use `requireRole(['admin', 'teacher', 'student'])` — these roles may not match the production package's role system

This is a critical alignment issue that should be clarified with the `@webwaka/core` team before production deployment.

---

## 14. GOVERNANCE AND REMINDER BLOCK

Every agent or engineer working in this repository MUST observe the following invariants at all times. These are non-negotiable.

### WebWaka OS v4 Invariants

1. **Build Once Use Infinitely** — All auth primitives come from `@webwaka/core`. NEVER re-implement `verifyJWT`, `requireRole`, `jwtAuthMiddleware`, `secureCORS`, or `rateLimit`. If they need to be extended, contribute back to core.

2. **Mobile First** — Every API response should be lean and efficient. Do not return unbounded lists. Always paginate. Minimize response payload.

3. **PWA First** — APIs must support offline-first clients. Always consider Dexie mutation queue integration. APIs should be idempotent where possible.

4. **Offline First** — The Dexie layer in `src/db/db.ts` is the client-side truth store. Server-side D1 is the durable store. Design APIs to be sync-friendly.

5. **Nigeria First** — All monetary amounts MUST be integers in kobo (NGN × 100). NEVER store naira floats. NEVER pass naira to Paystack. Always label amounts with `Kobo` suffix in variable names.

6. **Africa First** — Support 7 locales: `en-NG, en-GH, en-KE, en-ZA, fr-CI, yo-NG, ha-NG`. Use `Intl` APIs for formatting. Never hardcode "₦" — use `formatCurrency` from `src/i18n/index.ts`.

7. **Vendor Neutral AI** — ALL AI calls go through OpenRouter. NEVER call OpenAI, Anthropic, or Google APIs directly. Model selection is configurable per request.

### Multi-Tenancy Rules

- `tenantId` MUST come from the verified JWT payload — NEVER from request headers, body, or query parameters
- Every SQL query MUST include `AND tenantId = ?`
- Cross-tenant access MUST return 404 (not 403 — do not confirm existence)

### Security Rules

- Never hardcode API keys, secrets, or tokens in code
- Use `c.env.<KEY>` for all secrets
- Secrets set via `wrangler secret put <KEY> --env <env>`
- Never log secret values — log only the first 4 characters for debugging

### CI/CD Rules

- CI/CD must pass before merge to main
- Typecheck must pass
- Tests must pass
- Coverage thresholds: 80% lines/functions/statements, 75% branches
- Migrations MUST run in CI/CD before deploy

---

## 15. EXECUTION READINESS NOTES

### Before Starting Any Task

1. Read `replit.md` for project context
2. Read `wrangler.toml` for environment configuration
3. Read relevant module files (do not rely on memory)
4. Confirm `npm run typecheck` passes before making changes
5. Confirm `npm test` passes before making changes

### Environment Setup

The project runs locally with:
```bash
npm run dev  # Starts Wrangler dev server on port 5000
```

Tests run with:
```bash
npm test
npm run test:coverage
```

TypeCheck:
```bash
npm run typecheck
```

### What Agents Cannot Do Without Human Intervention

1. Create actual Cloudflare D1 databases (requires Cloudflare account access + `wrangler d1 create`)
2. Set production secrets (requires `wrangler secret put`)
3. Deploy to production Cloudflare Workers
4. Access real JAMB, WAEC, NECO, or Termii APIs without valid API keys

### Mock Strategy for Testing

All external services MUST be mocked in tests:
- D1 database: use the existing `makeD1Stub()` pattern from `src/modules/qualification-verification/index.test.ts`
- R2 storage: use the existing `makeR2Stub()` pattern
- `@webwaka/core`: already aliased to mock via `vitest.config.ts`
- Paystack, OpenRouter, Termii, JAMB, WAEC: mock with `vi.spyOn(module, 'function')` or `globalThis.fetch = vi.fn()`

### Known External API Uncertainty

- The JAMB API URL `https://api.jamb.gov.ng/v1/result/verify` is assumed (JAMB does not publish a public REST API). The actual institutional partner endpoint may differ.
- The WAEC API URL `https://api.waec.org.ng/v1/result/verify` is similarly assumed.
- The NECO API is entirely assumed and will need validation with NECO directly.
- All three APIs require institutional partnership agreements before real credentials are issued.

### Document Outputs

When complete, each task should produce:
- All code changes committed
- New migration files in `migrations/`
- Updated `src/db/schema.sql`
- Updated `replit.md` if architecture changes
- All tests passing (`npm test`)
- No TypeScript errors (`npm run typecheck`)
- Coverage above thresholds (`npm run test:coverage`)

---

*End of WEBWAKA-INSTITUTIONAL-DEEP-RESEARCH-TASKBOOK.md*
*Version 1.0 — April 2026*
*Repository: webwaka-institutional | Platform: WebWaka OS v4*
