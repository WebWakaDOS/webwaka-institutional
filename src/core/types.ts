/**
 * Shared types for WebWaka Institutional Suite
 * All monetary values are in kobo (NGN × 100) — Invariant 5: Nigeria First
 */

import type { AuthUser } from '@webwaka/core';

export interface Bindings {
  DB: D1Database;
  SESSIONS_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  MEDIA_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  PAYSTACK_SECRET_KEY: string;
  OPENROUTER_API_KEY: string;
  TERMII_API_KEY: string;
  /** JAMB institutional API key — set via: wrangler secret put JAMB_API_KEY */
  JAMB_API_KEY: string;
  /** WAEC institutional API key — set via: wrangler secret put WAEC_API_KEY */
  WAEC_API_KEY: string;
  /** AI platform worker URL — used by the scheduler module */
  AI_PLATFORM_URL?: string;
  /** Inter-service auth secret for AI platform calls */
  INTER_SERVICE_SECRET?: string;
}

/**
 * Hono Variables — typed context values injected by jwtAuthMiddleware.
 * Use with Hono<{ Bindings: Bindings; Variables: AppVariables }>.
 */
export interface AppVariables {
  /** Authenticated user — set by jwtAuthMiddleware from @webwaka/core */
  user: AuthUser;
  /** Tenant ID — ALWAYS sourced from JWT payload, NEVER from headers */
  tenantId: string;
}

// ─── Enumerations ─────────────────────────────────────────────────────────────

export type InstitutionType = 'primary_school' | 'secondary_school' | 'university' | 'polytechnic' | 'vocational' | 'training_centre';
export type StudentStatus = 'active' | 'graduated' | 'suspended' | 'withdrawn' | 'deferred';
export type StaffRole = 'teacher' | 'lecturer' | 'admin' | 'support' | 'management';
export type FeeType = 'tuition' | 'hostel' | 'exam' | 'library' | 'sports' | 'other';
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'partial';
export type VerificationMode = 'auto' | 'manual';
export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'awaiting_review';

// ─── Existing Entity Types ────────────────────────────────────────────────────

export interface QualificationVerification {
  id: string;
  tenantId: string;
  studentId: string;
  jambRegNumber?: string;
  jambScore?: number;
  jambVerifiedAt?: string;
  jambApiRaw?: string;
  waecExamNumber?: string;
  waecScratchCardPin?: string;
  waecExamYear?: string;
  waecVerifiedAt?: string;
  waecApiRaw?: string;
  verificationMode: VerificationMode;
  verificationStatus: VerificationStatus;
  documentKeys: string;
  reviewedBy?: string;
  reviewNote?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Student {
  id: string;
  tenantId: string;
  matricNumber: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone: string;
  status: StudentStatus;
  programmeId: string;
  level: number;
  admissionDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeeRecord {
  id: string;
  tenantId: string;
  studentId: string;
  feeType: FeeType;
  amountKobo: number;
  paidKobo: number;
  balanceKobo: number;
  status: PaymentStatus;
  semester: string;
  academicYear: string;
  dueDate: string;
  createdAt: string;
}

// ─── Phase 1: Payroll ─────────────────────────────────────────────────────────

export interface PayrollRun {
  id: string;
  tenantId: string;
  period: string;
  status: 'draft' | 'processing' | 'completed' | 'failed';
  totalGrossKobo: number;
  totalNetKobo: number;
  runAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payslip {
  id: string;
  tenantId: string;
  payrollRunId: string;
  staffId: string;
  grossKobo: number;
  taxKobo: number;
  deductionsKobo: number;
  netKobo: number;
  payoutRef?: string;
  status: 'pending' | 'paid' | 'failed';
  createdAt: string;
}

// ─── Phase 1: Procurement ─────────────────────────────────────────────────────

export interface Vendor {
  id: string;
  tenantId: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  category?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseRequisition {
  id: string;
  tenantId: string;
  requestedBy: string;
  title: string;
  items: string;
  totalKobo: number;
  vendorId?: string;
  status: 'pending' | 'approved' | 'rejected' | 'ordered' | 'received';
  approvedBy?: string;
  approvedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Phase 2a: SIS ────────────────────────────────────────────────────────────

export interface GradeRecord {
  id: string;
  tenantId: string;
  studentId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  semester: string;
  academicYear: string;
  score?: number;
  grade?: string;
  gradePoints?: number;
  units: number;
  remarks?: string;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Phase 3: Schedules ───────────────────────────────────────────────────────

export interface Schedule {
  id: string;
  tenantId: string;
  title: string;
  type: string;
  inputData: string;
  data?: string;
  model?: string;
  tokensUsed?: number;
  status: 'pending' | 'generated' | 'failed';
  generatedAt?: string;
  createdBy: string;
  createdAt: string;
}

// ─── Campus ───────────────────────────────────────────────────────────────────

export interface Campus {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
  address?: string;
  city?: string;
  state?: string;
  country: string;
  phone?: string;
  email?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}
