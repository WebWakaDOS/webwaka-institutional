-- Migration 0003 — WebWaka Institutional ERP Modules
-- Covers all 20 backlog items from the Implementation Plan
-- Invariant: Every table has tenantId NOT NULL with an index for strict multi-tenancy
-- Invariant: All monetary amounts stored as kobo integers (NGN × 100)

-- ─── PHASE 1: HR / Payroll ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payrollRuns (
  id          TEXT PRIMARY KEY,
  tenantId    TEXT NOT NULL,
  period      TEXT NOT NULL,           -- e.g. "2025-03"
  status      TEXT NOT NULL DEFAULT 'draft',
  -- draft | processing | completed | failed
  totalGrossKobo   INTEGER NOT NULL DEFAULT 0,
  totalNetKobo     INTEGER NOT NULL DEFAULT 0,
  runAt       TEXT,
  createdBy   TEXT NOT NULL,
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payrollRuns_tenantId ON payrollRuns(tenantId);
CREATE INDEX IF NOT EXISTS idx_payrollRuns_period   ON payrollRuns(tenantId, period);

CREATE TABLE IF NOT EXISTS payslips (
  id              TEXT PRIMARY KEY,
  tenantId        TEXT NOT NULL,
  payrollRunId    TEXT NOT NULL,
  staffId         TEXT NOT NULL,
  grossKobo       INTEGER NOT NULL,
  taxKobo         INTEGER NOT NULL DEFAULT 0,
  deductionsKobo  INTEGER NOT NULL DEFAULT 0,
  netKobo         INTEGER NOT NULL,
  payoutRef       TEXT,               -- fintech payout reference
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending | paid | failed
  createdAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payslips_tenantId    ON payslips(tenantId);
CREATE INDEX IF NOT EXISTS idx_payslips_runId       ON payslips(tenantId, payrollRunId);
CREATE INDEX IF NOT EXISTS idx_payslips_staffId     ON payslips(tenantId, staffId);

-- ─── PHASE 1: Procurement ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendors (
  id        TEXT PRIMARY KEY,
  tenantId  TEXT NOT NULL,
  name      TEXT NOT NULL,
  email     TEXT,
  phone     TEXT,
  address   TEXT,
  category  TEXT,
  status    TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendors_tenantId ON vendors(tenantId);

CREATE TABLE IF NOT EXISTS purchaseRequisitions (
  id            TEXT PRIMARY KEY,
  tenantId      TEXT NOT NULL,
  requestedBy   TEXT NOT NULL,
  title         TEXT NOT NULL,
  items         TEXT NOT NULL,         -- JSON array of {description, qty, unitPriceKobo}
  totalKobo     INTEGER NOT NULL,
  vendorId      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected | ordered | received
  approvedBy    TEXT,
  approvedAt    TEXT,
  notes         TEXT,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pr_tenantId ON purchaseRequisitions(tenantId);
CREATE INDEX IF NOT EXISTS idx_pr_status   ON purchaseRequisitions(tenantId, status);

-- ─── PHASE 2a: Student Information System (SIS) ───────────────────────────────

CREATE TABLE IF NOT EXISTS gradeRecords (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  studentId    TEXT NOT NULL,
  courseId     TEXT NOT NULL,
  courseCode   TEXT NOT NULL,
  courseName   TEXT NOT NULL,
  semester     TEXT NOT NULL,         -- e.g. "First"
  academicYear TEXT NOT NULL,         -- e.g. "2024/2025"
  score        REAL,
  grade        TEXT,                  -- A, B, C, D, E, F
  gradePoints  REAL,                  -- GPA weight
  units        INTEGER NOT NULL DEFAULT 3,
  remarks      TEXT,
  recordedBy   TEXT NOT NULL,
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grades_tenantId   ON gradeRecords(tenantId);
CREATE INDEX IF NOT EXISTS idx_grades_studentId  ON gradeRecords(tenantId, studentId);
CREATE INDEX IF NOT EXISTS idx_grades_year       ON gradeRecords(tenantId, academicYear);

CREATE TABLE IF NOT EXISTS disciplinaryRecords (
  id            TEXT PRIMARY KEY,
  tenantId      TEXT NOT NULL,
  studentId     TEXT NOT NULL,
  incidentDate  TEXT NOT NULL,
  description   TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'minor',  -- minor | moderate | severe
  action        TEXT,
  resolvedAt    TEXT,
  resolvedBy    TEXT,
  createdAt     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_disciplinary_tenantId  ON disciplinaryRecords(tenantId);
CREATE INDEX IF NOT EXISTS idx_disciplinary_studentId ON disciplinaryRecords(tenantId, studentId);

-- ─── PHASE 2a: Learning Management System (LMS) ───────────────────────────────

CREATE TABLE IF NOT EXISTS courses (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  code         TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  instructorId TEXT NOT NULL,
  units        INTEGER NOT NULL DEFAULT 3,
  semester     TEXT,
  academicYear TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courses_tenantId ON courses(tenantId);

CREATE TABLE IF NOT EXISTS courseMaterials (
  id          TEXT PRIMARY KEY,
  tenantId    TEXT NOT NULL,
  courseId    TEXT NOT NULL,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,    -- pdf | video | link | quiz
  r2Key       TEXT,
  url         TEXT,
  uploadedBy  TEXT NOT NULL,
  createdAt   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_materials_tenantId ON courseMaterials(tenantId);
CREATE INDEX IF NOT EXISTS idx_materials_courseId ON courseMaterials(tenantId, courseId);

CREATE TABLE IF NOT EXISTS assignments (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  courseId     TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  dueDate      TEXT NOT NULL,
  maxPoints    INTEGER NOT NULL DEFAULT 100,
  createdBy    TEXT NOT NULL,
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignments_tenantId ON assignments(tenantId);
CREATE INDEX IF NOT EXISTS idx_assignments_courseId ON assignments(tenantId, courseId);

CREATE TABLE IF NOT EXISTS submissions (
  id            TEXT PRIMARY KEY,
  tenantId      TEXT NOT NULL,
  assignmentId  TEXT NOT NULL,
  studentId     TEXT NOT NULL,
  content       TEXT,
  r2Key         TEXT,
  submittedAt   TEXT NOT NULL,
  grade         REAL,
  feedback      TEXT,
  gradedBy      TEXT,
  gradedAt      TEXT,
  createdAt     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_tenantId    ON submissions(tenantId);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment  ON submissions(tenantId, assignmentId);
CREATE INDEX IF NOT EXISTS idx_submissions_student     ON submissions(tenantId, studentId);

-- ─── PHASE 2b: Electronic Health Records (EHR) ───────────────────────────────

CREATE TABLE IF NOT EXISTS patientRecords (
  id              TEXT PRIMARY KEY,
  tenantId        TEXT NOT NULL,
  patientId       TEXT NOT NULL,
  dob             TEXT,
  bloodGroup      TEXT,
  genotype        TEXT,
  allergies       TEXT,            -- JSON array
  medicalHistory  TEXT,            -- JSON array of {date, condition, notes}
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patientRecords_tenantId   ON patientRecords(tenantId);
CREATE INDEX IF NOT EXISTS idx_patientRecords_patientId  ON patientRecords(tenantId, patientId);

CREATE TABLE IF NOT EXISTS prescriptions (
  id            TEXT PRIMARY KEY,
  tenantId      TEXT NOT NULL,
  patientId     TEXT NOT NULL,
  medication    TEXT NOT NULL,
  dosage        TEXT NOT NULL,
  frequency     TEXT,
  duration      TEXT,
  prescribedBy  TEXT NOT NULL,
  prescribedAt  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | completed | cancelled
  createdAt     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_tenantId  ON prescriptions(tenantId);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patientId ON prescriptions(tenantId, patientId);

CREATE TABLE IF NOT EXISTS labResults (
  id         TEXT PRIMARY KEY,
  tenantId   TEXT NOT NULL,
  patientId  TEXT NOT NULL,
  testName   TEXT NOT NULL,
  result     TEXT NOT NULL,
  unit       TEXT,
  refRange   TEXT,
  testedAt   TEXT NOT NULL,
  testedBy   TEXT,
  r2Key      TEXT,               -- scan of result document
  createdAt  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_labResults_tenantId  ON labResults(tenantId);
CREATE INDEX IF NOT EXISTS idx_labResults_patientId ON labResults(tenantId, patientId);

-- ─── PHASE 2b: Telemedicine ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS consultations (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  patientId    TEXT NOT NULL,
  doctorId     TEXT NOT NULL,
  scheduledAt  TEXT NOT NULL,
  duration     INTEGER NOT NULL DEFAULT 30,   -- minutes
  status       TEXT NOT NULL DEFAULT 'scheduled',
  -- scheduled | in_progress | completed | cancelled | no_show
  meetingUrl   TEXT,
  notes        TEXT,
  prescription TEXT,            -- free-text summary post-consult
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consultations_tenantId  ON consultations(tenantId);
CREATE INDEX IF NOT EXISTS idx_consultations_patientId ON consultations(tenantId, patientId);
CREATE INDEX IF NOT EXISTS idx_consultations_doctorId  ON consultations(tenantId, doctorId);

-- ─── PHASE 2b: HL7 FHIR Resources ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fhirResources (
  id            TEXT PRIMARY KEY,
  tenantId      TEXT NOT NULL,
  resourceType  TEXT NOT NULL,    -- Patient | Observation | Condition | MedicationRequest …
  resourceId    TEXT NOT NULL,    -- FHIR logical id
  version       INTEGER NOT NULL DEFAULT 1,
  data          TEXT NOT NULL,    -- Full FHIR JSON
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fhir_tenantId      ON fhirResources(tenantId);
CREATE INDEX IF NOT EXISTS idx_fhir_resourceType  ON fhirResources(tenantId, resourceType);
CREATE INDEX IF NOT EXISTS idx_fhir_resourceId    ON fhirResources(tenantId, resourceId);

-- ─── PHASE 3: AI Schedules ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schedules (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'room',  -- room | staff | bed
  inputData    TEXT NOT NULL,   -- JSON of rooms + sessions/requirements
  data         TEXT,            -- AI-generated schedule JSON
  model        TEXT,
  tokensUsed   INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | generated | failed
  generatedAt  TEXT,
  createdBy    TEXT NOT NULL,
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_tenantId ON schedules(tenantId);
CREATE INDEX IF NOT EXISTS idx_schedules_type     ON schedules(tenantId, type);

-- ─── PHASE 3: Data Anonymization ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS anonymizationJobs (
  id              TEXT PRIMARY KEY,
  tenantId        TEXT NOT NULL,
  sourceTable     TEXT NOT NULL,
  conditions      TEXT,           -- JSON filter criteria
  fieldsToStrip   TEXT NOT NULL,  -- JSON array of column names
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending | running | completed | failed
  processedCount  INTEGER NOT NULL DEFAULT 0,
  outputR2Key     TEXT,           -- anonymised export stored in R2
  createdBy       TEXT NOT NULL,
  createdAt       TEXT NOT NULL,
  completedAt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_anonJobs_tenantId ON anonymizationJobs(tenantId);

-- ─── Asset Management ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS assets (
  id                   TEXT PRIMARY KEY,
  tenantId             TEXT NOT NULL,
  name                 TEXT NOT NULL,
  category             TEXT NOT NULL,   -- laptop | projector | medical_equipment | vehicle …
  serialNumber         TEXT,
  purchasePriceKobo    INTEGER,
  purchaseDate         TEXT,
  campusId             TEXT,
  location             TEXT,
  status               TEXT NOT NULL DEFAULT 'active',
  -- active | under_maintenance | retired | disposed
  assignedTo           TEXT,            -- staffId or dept
  lastMaintenanceAt    TEXT,
  depreciationRatePct  REAL DEFAULT 20, -- % per annum
  createdAt            TEXT NOT NULL,
  updatedAt            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_tenantId ON assets(tenantId);
CREATE INDEX IF NOT EXISTS idx_assets_status   ON assets(tenantId, status);

-- ─── Visitor Management ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visitorLogs (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  visitorName  TEXT NOT NULL,
  phone        TEXT,
  host         TEXT NOT NULL,   -- staffId of person being visited
  purpose      TEXT NOT NULL,
  checkIn      TEXT NOT NULL,
  checkOut     TEXT,
  badgeCode    TEXT,
  campusId     TEXT,
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visitorLogs_tenantId ON visitorLogs(tenantId);
CREATE INDEX IF NOT EXISTS idx_visitorLogs_host     ON visitorLogs(tenantId, host);

-- ─── Alumni / Donor Portal ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alumni (
  id               TEXT PRIMARY KEY,
  tenantId         TEXT NOT NULL,
  studentId        TEXT,
  firstName        TEXT NOT NULL,
  lastName         TEXT NOT NULL,
  graduationYear   TEXT NOT NULL,
  programme        TEXT,
  currentOrg       TEXT,
  email            TEXT,
  phone            TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  createdAt        TEXT NOT NULL,
  updatedAt        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alumni_tenantId ON alumni(tenantId);

CREATE TABLE IF NOT EXISTS donationCampaigns (
  id            TEXT PRIMARY KEY,
  tenantId      TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  targetKobo    INTEGER NOT NULL,
  currentKobo   INTEGER NOT NULL DEFAULT 0,
  startDate     TEXT NOT NULL,
  endDate       TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  createdBy     TEXT NOT NULL,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenantId ON donationCampaigns(tenantId);

CREATE TABLE IF NOT EXISTS donations (
  id              TEXT PRIMARY KEY,
  tenantId        TEXT NOT NULL,
  alumniId        TEXT,
  campaignId      TEXT NOT NULL,
  amountKobo      INTEGER NOT NULL,
  transactionRef  TEXT,
  donorName       TEXT,
  donorEmail      TEXT,
  donatedAt       TEXT NOT NULL,
  createdAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_donations_tenantId  ON donations(tenantId);
CREATE INDEX IF NOT EXISTS idx_donations_campaign  ON donations(tenantId, campaignId);

-- ─── Library Management ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS books (
  id              TEXT PRIMARY KEY,
  tenantId        TEXT NOT NULL,
  isbn            TEXT,
  title           TEXT NOT NULL,
  author          TEXT NOT NULL,
  publisher       TEXT,
  category        TEXT,
  totalCopies     INTEGER NOT NULL DEFAULT 1,
  availableCopies INTEGER NOT NULL DEFAULT 1,
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_tenantId ON books(tenantId);

CREATE TABLE IF NOT EXISTS bookCheckouts (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  bookId       TEXT NOT NULL,
  memberId     TEXT NOT NULL,
  memberType   TEXT NOT NULL DEFAULT 'student',  -- student | staff
  checkedOutAt TEXT NOT NULL,
  dueDate      TEXT NOT NULL,
  returnedAt   TEXT,
  lateFeeKobo  INTEGER NOT NULL DEFAULT 0,
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkouts_tenantId ON bookCheckouts(tenantId);
CREATE INDEX IF NOT EXISTS idx_checkouts_memberId ON bookCheckouts(tenantId, memberId);
CREATE INDEX IF NOT EXISTS idx_checkouts_bookId   ON bookCheckouts(tenantId, bookId);

-- ─── Cafeteria / Meal Plan ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mealPlans (
  id                   TEXT PRIMARY KEY,
  tenantId             TEXT NOT NULL,
  studentId            TEXT NOT NULL,
  plan                 TEXT NOT NULL DEFAULT 'standard',  -- standard | premium | special
  dietaryRestrictions  TEXT,   -- JSON array: ["vegetarian","nut_free"]
  balanceKobo          INTEGER NOT NULL DEFAULT 0,
  academicYear         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active',
  createdAt            TEXT NOT NULL,
  updatedAt            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mealPlans_tenantId  ON mealPlans(tenantId);
CREATE INDEX IF NOT EXISTS idx_mealPlans_studentId ON mealPlans(tenantId, studentId);

CREATE TABLE IF NOT EXISTS mealTransactions (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  mealPlanId   TEXT NOT NULL,
  item         TEXT NOT NULL,
  amountKobo   INTEGER NOT NULL,
  transactedAt TEXT NOT NULL,
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mealTx_tenantId    ON mealTransactions(tenantId);
CREATE INDEX IF NOT EXISTS idx_mealTx_mealPlanId  ON mealTransactions(tenantId, mealPlanId);

-- ─── Biometric Attendance ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendanceLogs (
  id          TEXT PRIMARY KEY,
  tenantId    TEXT NOT NULL,
  memberId    TEXT NOT NULL,
  memberType  TEXT NOT NULL DEFAULT 'student',  -- student | staff
  timestamp   TEXT NOT NULL,
  method      TEXT NOT NULL DEFAULT 'manual',   -- fingerprint | face | card | manual
  status      TEXT NOT NULL DEFAULT 'present',  -- present | absent | late
  campusId    TEXT,
  deviceId    TEXT,
  createdAt   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attendance_tenantId ON attendanceLogs(tenantId);
CREATE INDEX IF NOT EXISTS idx_attendance_memberId ON attendanceLogs(tenantId, memberId);
CREATE INDEX IF NOT EXISTS idx_attendance_date     ON attendanceLogs(tenantId, timestamp);

-- ─── Incident Reporting ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS incidents (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  reportedBy   TEXT NOT NULL,
  type         TEXT NOT NULL,   -- accident | security | fire | harassment | other
  description  TEXT NOT NULL,
  location     TEXT,
  campusId     TEXT,
  severity     TEXT NOT NULL DEFAULT 'low',  -- low | medium | high | critical
  status       TEXT NOT NULL DEFAULT 'open', -- open | investigating | resolved | closed
  resolvedBy   TEXT,
  resolvedAt   TEXT,
  resolution   TEXT,
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_tenantId ON incidents(tenantId);
CREATE INDEX IF NOT EXISTS idx_incidents_status   ON incidents(tenantId, status);

-- ─── Document Management System (DMS) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  tenantId     TEXT NOT NULL,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,  -- policy | procedure | template | report | contract | other
  description  TEXT,
  r2Key        TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT '1.0',
  uploadedBy   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',  -- active | archived | superseded
  tags         TEXT,           -- JSON array
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_tenantId ON documents(tenantId);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(tenantId, category);

-- ─── Multi-Campus Support ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS campuses (
  id        TEXT PRIMARY KEY,
  tenantId  TEXT NOT NULL,
  name      TEXT NOT NULL,
  code      TEXT,
  address   TEXT,
  city      TEXT,
  state     TEXT,
  country   TEXT NOT NULL DEFAULT 'Nigeria',
  phone     TEXT,
  email     TEXT,
  status    TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campuses_tenantId ON campuses(tenantId);

-- ─── Parent / Guardian Portal ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parentLinks (
  id             TEXT PRIMARY KEY,
  tenantId       TEXT NOT NULL,
  parentUserId   TEXT NOT NULL,
  studentId      TEXT NOT NULL,
  relationship   TEXT NOT NULL DEFAULT 'parent',  -- parent | guardian | sibling
  status         TEXT NOT NULL DEFAULT 'active',
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parentLinks_tenantId     ON parentLinks(tenantId);
CREATE INDEX IF NOT EXISTS idx_parentLinks_parentUserId ON parentLinks(tenantId, parentUserId);
CREATE INDEX IF NOT EXISTS idx_parentLinks_studentId    ON parentLinks(tenantId, studentId);

-- ─── Insurance Claims Processing ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS insuranceClaims (
  id             TEXT PRIMARY KEY,
  tenantId       TEXT NOT NULL,
  patientId      TEXT NOT NULL,
  policyNumber   TEXT NOT NULL,
  provider       TEXT,
  claimType      TEXT NOT NULL,  -- inpatient | outpatient | dental | optical | maternity
  amountKobo     INTEGER NOT NULL,
  approvedKobo   INTEGER,
  status         TEXT NOT NULL DEFAULT 'submitted',
  -- submitted | under_review | approved | partially_approved | rejected | paid
  submittedAt    TEXT NOT NULL,
  processedAt    TEXT,
  referenceNo    TEXT,
  documents      TEXT,           -- JSON array of R2 keys
  notes          TEXT,
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_insurance_tenantId  ON insuranceClaims(tenantId);
CREATE INDEX IF NOT EXISTS idx_insurance_patientId ON insuranceClaims(tenantId, patientId);
CREATE INDEX IF NOT EXISTS idx_insurance_status    ON insuranceClaims(tenantId, status);
