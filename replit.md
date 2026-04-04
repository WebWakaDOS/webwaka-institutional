# WebWaka Institutional Suite

A cloud-native, mobile-first, and offline-first institutional management platform (schools, universities, training centres, clinics) built on WebWaka OS v4.

## Tech Stack

- **Runtime**: Cloudflare Workers (via Wrangler v4)
- **Framework**: Hono (TypeScript)
- **Database**: Cloudflare D1 (SQLite) for server-side, Dexie.js (IndexedDB) for client-side offline
- **Auth**: JWT via `@webwaka/core` — `requireRole` + `requirePermissions`
- **Payments**: Paystack (NGN kobo)
- **AI**: OpenRouter / webwaka-ai-platform (vendor-neutral abstraction)
- **SMS**: Termii
- **Package Manager**: npm

## Project Structure

```
src/
  worker.ts              # Main Hono app — registers all 24 route prefixes
  core/                  # Shared types, AI client, Paystack abstractions
  modules/
    student-mgmt/        # Student management
    staff-mgmt/          # Staff management
    fee-collection/      # Fee collection + Paystack
    qualification-verification/  # JAMB/WAEC auto + manual fallback
    hr/payroll.ts        # Nigerian PAYE payroll engine (Finance Act 2021)
    procurement/         # Vendor registry + purchase requisition workflow
    sis/                 # Student Information System (GPA, transcripts)
    lms/                 # Learning Management (courses, assignments)
    ehr/                 # Electronic Health Records
    telemedicine/        # Telemedicine portal
    fhir/                # HL7 FHIR R4 (Patient, Observation, Bundle, NDJSON export)
    operations/scheduler # AI resource allocation / timetable scheduling
    data-anon/           # Field-level PII anonymisation → R2 NDJSON
    assets/              # Asset lifecycle + depreciation
    visitor/             # Visitor management + badge generation
    alumni/              # Alumni portal + donation campaigns
    library/             # Library inventory + checkout/return
    cafeteria/           # Meal plans + balance management
    attendance/          # Biometric attendance (fingerprint/face/card/manual)
    incidents/           # Incident reporting + status workflow
    dms/                 # Document management (R2-backed)
    campus/              # Multi-campus registry
    parent-portal/       # Parent-student linking + dashboard
    insurance/           # Insurance claims + review workflow
  db/                    # Dexie offline store v3 schema (9 tables)
  i18n/                  # 7-locale African i18n support
  __mocks__/             # Test mocks (@webwaka/core)
migrations/              # SQL migration files for D1
  0001_initial.sql
  0002_qualification_verification.sql
  0003_erp_modules.sql   # 25 new tables across all modules
wrangler.toml            # Cloudflare Workers config
```

## Running Locally

```bash
WRANGLER_SEND_METRICS=false npx wrangler dev --port 5000 --ip 0.0.0.0
```

## Test Suite

```bash
npm test        # vitest run — 82 tests, 6 test files
npm run typecheck
```

Test files:
- `src/core/paystack.test.ts` — Paystack client
- `src/i18n/index.test.ts` — 7-locale i18n
- `src/modules/qualification-verification/index.test.ts` — JAMB/WAEC (25 tests)
- `src/modules/hr/payroll.test.ts` — PAYE engine + RBAC (18 tests) **QA-INS-1**
- `src/modules/operations/scheduler.test.ts` — AI scheduler + outage resilience (13 tests) **QA-INS-2**
- `src/modules/fhir/index.test.ts` — HL7 FHIR R4 (21 tests) **QA-INS-3**

## Key Endpoints

### Core
- `GET /health` — Health check (unauthenticated) — returns `{"version":"0.2.0","modules":24}`
- `GET|POST /api/students/*` — Student management
- `GET|POST /api/staff/*` — Staff management
- `GET|POST /api/fees/*` — Fee collection (Paystack)
- `POST|GET|PATCH /api/qualifications/*` — JAMB/WAEC verification

### Phase 1 — ERP & HR
- `POST /api/payroll/runs` — Create draft payroll run (`manage:payroll` required)
- `POST /api/payroll/runs/:id/process` — Execute PAYE calculation + emit `fintech.payout.requested` events
- `POST|GET /api/procurement/*` — Vendor registry + purchase requisitions

### Phase 2 — Education
- `GET|POST /api/sis/*` — GPA, transcripts, disciplinary records
- `GET|POST /api/lms/*` — Courses, assignments, submissions

### Phase 2 — Healthcare
- `GET|POST /api/ehr/*` — Electronic health records, prescriptions, labs
- `GET|POST /api/telemedicine/*` — Consultation scheduling + meeting URLs
- `GET|POST|PUT|DELETE /api/fhir/:resourceType/:id` — HL7 FHIR R4 (`read:fhir`/`write:fhir` required)

### Phase 3 — AI & Optimization
- `POST /api/scheduler/schedules` — AI resource allocation (graceful 503 fallback + retryHint)
- `POST /api/anon/*` — PII anonymisation + NDJSON export to R2

### Operational (11 modules)
- `/api/assets/*`, `/api/visitors/*`, `/api/alumni/*`, `/api/library/*`, `/api/cafeteria/*`
- `/api/attendance/*`, `/api/incidents/*`, `/api/dms/*`, `/api/campus/*`
- `/api/parents/*`, `/api/insurance/*`

## RBAC — Fine-Grained Permissions

Permission checking uses `requirePermissions()` from `@webwaka/core` which reads
`user.permissions[]` from the JWT payload:

| Endpoint group          | Required permission  |
|------------------------|---------------------|
| Payroll all routes      | `manage:payroll`    |
| FHIR GET routes         | `read:fhir`         |
| FHIR POST/PUT/DELETE    | `write:fhir`        |

## Environment Variables / Secrets

Set via `wrangler secret put <KEY> --env <staging|production>`:

- `JWT_SECRET`
- `PAYSTACK_SECRET_KEY`
- `OPENROUTER_API_KEY`
- `TERMII_API_KEY`
- `JAMB_API_KEY` — Institutional partner key for JAMB result verification API
- `WAEC_API_KEY` — Institutional partner key for WAEC result verification API
- `AI_PLATFORM_URL` — (optional) webwaka-ai-platform worker URL for scheduler
- `INTER_SERVICE_SECRET` — (optional) inter-service auth for AI platform calls

## Deployment

```bash
npm run deploy:staging
npm run deploy:production
```

Requires Cloudflare account with D1, KV, and R2 bindings configured in `wrangler.toml`.

## Core Invariants

1. **Build Once Use Infinitely** — all auth from `@webwaka/core`
2. **Mobile First** — Hono lightweight API
3. **PWA First** — Cloudflare Workers + Pages
4. **Offline First** — Dexie offline store v3 (9 client-side tables)
5. **Nigeria First** — Paystack kobo, en-NG locale, Finance Act 2021 PAYE brackets
6. **Africa First** — 7-locale i18n
7. **Vendor Neutral AI** — OpenRouter / webwaka-ai-platform abstraction

## QA Certification (INS_QA_CERTIFICATION)

| ID | Feature | Status |
|----|---------|--------|
| QA-INS-1 | Payroll Engine | **CERTIFIED** — PAYE calculated + `fintech.payout.requested` emitted (18 tests) |
| QA-INS-2 | AI Resource Allocation | **CERTIFIED** — conflict-free schedule generated; 503/network outage → `failed` + `retryHint` (13 tests) |
| QA-INS-3 | HL7 FHIR | **CERTIFIED** — `GET /fhir/Patient/:id` returns valid FHIR R4 JSON with `resourceType`, `id`, `meta.versionId` (21 tests) |
| QA-INS-4 | Unit Tests | **CERTIFIED** — 82/82 pass; TypeScript clean |

## Key Bugs Fixed

- **PAYE bracket off-by-10×**: `30_000_00` (3,000,000 kobo = NGN 30,000) corrected to `300_000_00` (30,000,000 kobo = NGN 300,000) per Finance Act 2021.
- **FHIR `$export` route shadowed**: moved registration before `/:resourceType` dynamic route.
- **SQL literals in D1 bind**: all `'draft'`/`'pending'`/`'completed'`/`1` literals converted to bound params for test stub compatibility and production correctness.
