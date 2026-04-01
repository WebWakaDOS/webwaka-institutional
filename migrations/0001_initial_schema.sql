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
