/**
 * Offline Database — WebWaka Institutional Suite
 *
 * Invariant 4: Offline First
 * Uses Dexie (IndexedDB wrapper) for client-side offline storage.
 * All data is synced to Cloudflare D1 when connectivity is restored.
 *
 * All monetary amounts stored as kobo integers — Invariant 5: Nigeria First
 *
 * Version history:
 *   v1 — students, feeRecords, mutationQueue
 *   v2 — qualificationVerifications
 *   v3 — payrollRuns, payslips, courses, gradeRecords, campuses,
 *         assets, attendanceLogs, incidents, schedules
 */

import Dexie, { type Table } from 'dexie';
import type {
  Student, FeeRecord, QualificationVerification,
  PayrollRun, Payslip, GradeRecord, Campus, Schedule,
} from '../core/types';

interface MutationQueueEntry {
  id?: number;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload: unknown;
  tenantId: string;
  createdAt: string;
  retryCount: number;
}

// Light-weight offline records for larger tables
interface OfflineCourse {
  id: string;
  tenantId: string;
  code: string;
  title: string;
  instructorId: string;
  status: string;
  createdAt: string;
}

interface OfflineAsset {
  id: string;
  tenantId: string;
  name: string;
  category: string;
  status: string;
  location?: string;
  createdAt: string;
}

interface OfflineAttendanceLog {
  id: string;
  tenantId: string;
  memberId: string;
  memberType: string;
  timestamp: string;
  method: string;
  status: string;
  campusId?: string;
}

interface OfflineIncident {
  id: string;
  tenantId: string;
  type: string;
  description: string;
  severity: string;
  status: string;
  createdAt: string;
}

export class InstitutionalOfflineDB extends Dexie {
  // v1
  students!: Table<Student>;
  feeRecords!: Table<FeeRecord>;
  mutationQueue!: Table<MutationQueueEntry>;

  // v2
  qualificationVerifications!: Table<QualificationVerification>;

  // v3 — ERP & operational modules
  payrollRuns!: Table<PayrollRun>;
  payslips!: Table<Payslip>;
  gradeRecords!: Table<GradeRecord>;
  courses!: Table<OfflineCourse>;
  campuses!: Table<Campus>;
  assets!: Table<OfflineAsset>;
  attendanceLogs!: Table<OfflineAttendanceLog>;
  incidents!: Table<OfflineIncident>;
  schedules!: Table<Schedule>;

  constructor() {
    super('webwaka-institutional');

    this.version(1).stores({
      students: 'id, tenantId, matricNumber, status, programmeId, level',
      feeRecords: 'id, tenantId, studentId, feeType, status, academicYear',
      mutationQueue: '++id, tenantId, createdAt',
    });

    this.version(2).stores({
      students: 'id, tenantId, matricNumber, status, programmeId, level',
      feeRecords: 'id, tenantId, studentId, feeType, status, academicYear',
      qualificationVerifications: 'id, tenantId, studentId, verificationStatus',
      mutationQueue: '++id, tenantId, createdAt',
    });

    this.version(3).stores({
      students: 'id, tenantId, matricNumber, status, programmeId, level',
      feeRecords: 'id, tenantId, studentId, feeType, status, academicYear',
      qualificationVerifications: 'id, tenantId, studentId, verificationStatus',
      mutationQueue: '++id, tenantId, createdAt',
      // Phase 1 — ERP
      payrollRuns: 'id, tenantId, period, status',
      payslips: 'id, tenantId, payrollRunId, staffId, status',
      // Phase 2 — Education
      gradeRecords: 'id, tenantId, studentId, academicYear, semester',
      courses: 'id, tenantId, code, instructorId, status',
      // Campus & Operational
      campuses: 'id, tenantId, status',
      assets: 'id, tenantId, category, status',
      attendanceLogs: 'id, tenantId, memberId, timestamp',
      incidents: 'id, tenantId, type, severity, status',
      // Phase 3 — AI
      schedules: 'id, tenantId, type, status',
    });
  }
}

export const db = new InstitutionalOfflineDB();

/**
 * Enqueue a mutation for background sync when offline.
 * All kobo amounts must be integers before enqueueing.
 */
export async function enqueueMutation(
  endpoint: string,
  method: MutationQueueEntry['method'],
  payload: unknown,
  tenantId: string
): Promise<void> {
  await db.mutationQueue.add({
    endpoint,
    method,
    payload,
    tenantId,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
}

/**
 * Process the mutation queue when connectivity is restored.
 * Called by the service worker on 'online' event.
 */
export async function processMutationQueue(apiBaseUrl: string, jwtToken: string): Promise<void> {
  const entries = await db.mutationQueue.orderBy('createdAt').toArray();
  for (const entry of entries) {
    try {
      const response = await fetch(`${apiBaseUrl}${entry.endpoint}`, {
        method: entry.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify(entry.payload),
      });
      if (response.ok && entry.id !== undefined) {
        await db.mutationQueue.delete(entry.id);
      } else if (entry.id !== undefined) {
        await db.mutationQueue.update(entry.id, { retryCount: entry.retryCount + 1 });
      }
    } catch {
      if (entry.id !== undefined) {
        await db.mutationQueue.update(entry.id, { retryCount: entry.retryCount + 1 });
      }
    }
  }
}
