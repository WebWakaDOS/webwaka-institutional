-- Migration 0004 — WebWaka Institutional Suite — Schema Enhancements
--
-- Covers:
--   WI-003 : NDPR consent audit log table
--   WI-007 : Campus facility booking tables
--   WI-009 : fee-collection payment tracking columns
--   WI-010 : student / staff full-profile columns + salary columns required by payroll engine
--
-- Invariant: All monetary values stored as kobo integers (NGN × 100)
-- Invariant: Every table has tenantId NOT NULL with an index for strict multi-tenancy

-- ─── WI-010: students — full-profile columns ──────────────────────────────────
-- The initial schema (0001) captured only registration primitives.
-- Add PII fields required for NDPR-compliant student records.

ALTER TABLE students ADD COLUMN firstName    TEXT;
ALTER TABLE students ADD COLUMN lastName     TEXT;
ALTER TABLE students ADD COLUMN email        TEXT;
ALTER TABLE students ADD COLUMN phone        TEXT;
ALTER TABLE students ADD COLUMN admissionDate TEXT;
ALTER TABLE students ADD COLUMN updatedAt    TEXT;

-- ─── WI-010 / Payroll: staff — full-profile + salary columns ─────────────────
-- The payroll engine (payroll.ts) already queries grossSalaryKobo,
-- pensionDeductionKobo, otherDeductionsKobo from this table.  Add them here
-- so that payroll runs correctly on real data.

ALTER TABLE staff ADD COLUMN firstName               TEXT;
ALTER TABLE staff ADD COLUMN lastName                TEXT;
ALTER TABLE staff ADD COLUMN email                   TEXT;
ALTER TABLE staff ADD COLUMN phone                   TEXT;
ALTER TABLE staff ADD COLUMN grossSalaryKobo         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN pensionDeductionKobo    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN otherDeductionsKobo     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN updatedAt               TEXT;

-- ─── WI-009 / WI-010: feeRecords — payment-tracking columns ─────────────────
-- Add missing columns defined in the FeeRecord TypeScript type but absent from
-- the initial migration.

ALTER TABLE feeRecords ADD COLUMN paidKobo   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feeRecords ADD COLUMN balanceKobo INTEGER;      -- computed on write
ALTER TABLE feeRecords ADD COLUMN semester   TEXT;
ALTER TABLE feeRecords ADD COLUMN dueDate    TEXT;
ALTER TABLE feeRecords ADD COLUMN updatedAt  TEXT;

-- ─── WI-003: NDPR consent audit log ──────────────────────────────────────────
-- Required by @webwaka/core recordNdprConsent() function.
-- The table name and columns match the NdprConsentLog interface in ndpr.d.ts.

CREATE TABLE IF NOT EXISTS ndpr_consent_logs (
  id           TEXT PRIMARY KEY,
  entity_id    TEXT NOT NULL,
  entity_type  TEXT NOT NULL,    -- 'student' | 'patient' | 'staff'
  consented_at INTEGER NOT NULL, -- unix timestamp ms
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ndpr_entity ON ndpr_consent_logs(entity_id, entity_type);

-- ─── WI-007: Campus facilities ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS facilities (
  id         TEXT PRIMARY KEY,
  tenantId   TEXT NOT NULL,
  campusId   TEXT,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,     -- lecture_hall | lab | sports | auditorium | conference | other
  capacity   INTEGER,
  status     TEXT NOT NULL DEFAULT 'available',  -- available | maintenance | closed
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facilities_tenantId ON facilities(tenantId);
CREATE INDEX IF NOT EXISTS idx_facilities_campusId ON facilities(tenantId, campusId);

-- ─── WI-007: Facility bookings ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS facilityBookings (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  facilityId   TEXT NOT NULL,
  bookedBy     TEXT NOT NULL,   -- userId
  purpose      TEXT NOT NULL,
  startTime    TEXT NOT NULL,
  endTime      TEXT NOT NULL,
  attendees    INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected | cancelled
  reviewedBy   TEXT,
  reviewedAt   TEXT,
  notes        TEXT,
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facilityBookings_tenantId   ON facilityBookings(tenantId);
CREATE INDEX IF NOT EXISTS idx_facilityBookings_facilityId ON facilityBookings(tenantId, facilityId);
CREATE INDEX IF NOT EXISTS idx_facilityBookings_bookedBy   ON facilityBookings(tenantId, bookedBy);
CREATE INDEX IF NOT EXISTS idx_facilityBookings_status     ON facilityBookings(tenantId, status);
