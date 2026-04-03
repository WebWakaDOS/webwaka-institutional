-- WebWaka Institutional Suite — D1 Database Schema
-- Invariant 5: Nigeria First — All amounts in kobo integers

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  matricNumber TEXT NOT NULL,
  status TEXT NOT NULL,
  programmeId TEXT NOT NULL,
  level INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_students_tenantId ON students(tenantId);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  status TEXT NOT NULL,
  department TEXT NOT NULL,
  role TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_tenantId ON staff(tenantId);

CREATE TABLE IF NOT EXISTS feeRecords (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  studentId TEXT NOT NULL,
  feeType TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  status TEXT NOT NULL,
  academicYear TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feeRecords_tenantId ON feeRecords(tenantId);

-- T-INS-01: Qualification Verifications (JAMB/WAEC)
CREATE TABLE IF NOT EXISTS qualificationVerifications (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  studentId TEXT NOT NULL,
  jambRegNumber TEXT,
  jambScore INTEGER,
  jambVerifiedAt TEXT,
  waecExamNumber TEXT,
  waecScratchCardPin TEXT,
  waecExamYear TEXT,
  waecVerifiedAt TEXT,
  verificationMode TEXT NOT NULL DEFAULT 'auto',
  verificationStatus TEXT NOT NULL DEFAULT 'pending',
  jambApiRaw TEXT,
  waecApiRaw TEXT,
  documentKeys TEXT,
  reviewedBy TEXT,
  reviewNote TEXT,
  reviewedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qualVerif_tenantId ON qualificationVerifications(tenantId);
CREATE INDEX IF NOT EXISTS idx_qualVerif_studentId ON qualificationVerifications(studentId);
CREATE INDEX IF NOT EXISTS idx_qualVerif_status ON qualificationVerifications(verificationStatus);
