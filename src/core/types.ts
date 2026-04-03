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

export type InstitutionType = 'primary_school' | 'secondary_school' | 'university' | 'polytechnic' | 'vocational' | 'training_centre';
export type StudentStatus = 'active' | 'graduated' | 'suspended' | 'withdrawn' | 'deferred';
export type StaffRole = 'teacher' | 'lecturer' | 'admin' | 'support' | 'management';
export type FeeType = 'tuition' | 'hostel' | 'exam' | 'library' | 'sports' | 'other';
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'partial';

export type VerificationMode = 'auto' | 'manual';
export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'awaiting_review';

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

  documentKeys: string; // JSON array of R2 object keys

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
  amountKobo: number;   // ALWAYS kobo — Invariant 5
  paidKobo: number;     // ALWAYS kobo
  balanceKobo: number;  // ALWAYS kobo
  status: PaymentStatus;
  semester: string;
  academicYear: string;
  dueDate: string;
  createdAt: string;
}
