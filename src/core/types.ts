/**
 * Shared types for WebWaka Institutional Suite
 * All monetary values are in kobo (NGN × 100) — Invariant 5: Nigeria First
 */

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
}

export type InstitutionType = 'primary_school' | 'secondary_school' | 'university' | 'polytechnic' | 'vocational' | 'training_centre';
export type StudentStatus = 'active' | 'graduated' | 'suspended' | 'withdrawn' | 'deferred';
export type StaffRole = 'teacher' | 'lecturer' | 'admin' | 'support' | 'management';
export type FeeType = 'tuition' | 'hostel' | 'exam' | 'library' | 'sports' | 'other';
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'partial';

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
