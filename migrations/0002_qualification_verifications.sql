-- Migration 0002 — Qualification Verifications
-- Task T-INS-01: JAMB/WAEC Result Verification
-- Invariant 2: Multi-Tenant — tenantId on every row, indexed

CREATE TABLE IF NOT EXISTS qualificationVerifications (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  studentId TEXT NOT NULL,

  -- JAMB fields
  jambRegNumber TEXT,
  jambScore INTEGER,
  jambVerifiedAt TEXT,

  -- WAEC fields
  waecExamNumber TEXT,
  waecScratchCardPin TEXT,
  waecExamYear TEXT,
  waecVerifiedAt TEXT,

  -- Verification outcome
  verificationMode TEXT NOT NULL DEFAULT 'auto',
  -- 'auto'   = API verified successfully
  -- 'manual' = API unavailable; admin reviews uploaded documents

  verificationStatus TEXT NOT NULL DEFAULT 'pending',
  -- 'pending'         = just submitted, not yet checked
  -- 'verified'        = auto API or admin approved
  -- 'rejected'        = API returned invalid or admin rejected
  -- 'awaiting_review' = API unavailable; documents uploaded, awaiting admin

  jambApiRaw TEXT,   -- raw JSON from JAMB API (for audit)
  waecApiRaw TEXT,   -- raw JSON from WAEC API (for audit)

  -- Manual fallback document storage (R2 object keys)
  documentKeys TEXT, -- JSON array of R2 object keys

  -- Admin review
  reviewedBy TEXT,
  reviewNote TEXT,
  reviewedAt TEXT,

  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qualVerif_tenantId ON qualificationVerifications(tenantId);
CREATE INDEX IF NOT EXISTS idx_qualVerif_studentId ON qualificationVerifications(studentId);
CREATE INDEX IF NOT EXISTS idx_qualVerif_status ON qualificationVerifications(verificationStatus);
