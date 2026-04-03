# WebWaka Institutional Suite

A cloud-native, mobile-first, and offline-first institutional management platform (schools, universities, training centres) built on WebWaka OS v4.

## Tech Stack

- **Runtime**: Cloudflare Workers (via Wrangler v4)
- **Framework**: Hono (TypeScript)
- **Database**: Cloudflare D1 (SQLite) for server-side, Dexie.js (IndexedDB) for client-side offline
- **Auth**: JWT via `@webwaka/core`
- **Payments**: Paystack (NGN kobo)
- **AI**: OpenRouter (vendor-neutral abstraction)
- **SMS**: Termii
- **Package Manager**: npm

## Project Structure

```
src/
  worker.ts          # Main Hono app entry point
  core/              # Shared types, AI, and Paystack abstractions
  modules/           # Feature modules (student-mgmt, staff-mgmt, fee-collection)
  db/                # Dexie offline store + schema.sql
  middleware/        # Auth middleware
  i18n/              # 7-locale African i18n support
  __mocks__/         # Test mocks
migrations/          # SQL migration files for D1
docs/                # Project documentation
wrangler.toml        # Cloudflare Workers config (staging + production environments)
```

## Running Locally

```bash
npm run dev
```

This starts the Cloudflare Workers dev server on port 5000 using Wrangler v4.

## Key Endpoints

- `GET /health` — Health check (unauthenticated)
- `GET|POST /api/students/*` — Student management (JWT required)
- `GET|POST /api/staff/*` — Staff management (JWT required)
- `GET|POST /api/fees/*` — Fee collection (JWT required)
- `POST /api/qualifications` — Submit JAMB/WAEC verification request (auto + manual fallback)
- `GET /api/qualifications` — List verification records for tenant (admin)
- `GET /api/qualifications/:id` — Get single verification record
- `POST /api/qualifications/:id/document` — Upload supporting document to R2 (manual fallback)
- `PATCH /api/qualifications/:id/review` — Admin approve/reject (manual review path)

## Environment Variables / Secrets

Set via `wrangler secret put <KEY> --env <staging|production>`:

- `JWT_SECRET`
- `PAYSTACK_SECRET_KEY`
- `OPENROUTER_API_KEY`
- `TERMII_API_KEY`
- `JAMB_API_KEY` — Institutional partner key for JAMB result verification API (T-INS-01)
- `WAEC_API_KEY` — Institutional partner key for WAEC result verification API (T-INS-01)

## Deployment

This project is designed for Cloudflare Workers deployment:

```bash
npm run deploy:staging
npm run deploy:production
```

Requires Cloudflare account with D1, KV, and R2 bindings configured in `wrangler.toml`.

## Core Invariants

1. **Build Once Use Infinitely** — all auth from `@webwaka/core`
2. **Mobile First** — Hono lightweight API
3. **PWA First** — Cloudflare Workers + Pages
4. **Offline First** — Dexie offline store in client
5. **Nigeria First** — Paystack kobo, en-NG locale
6. **Africa First** — 7-locale i18n
7. **Vendor Neutral AI** — OpenRouter abstraction only
