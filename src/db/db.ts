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
 *   v1 — inst_students, inst_feeRecords, mutationQueue
 *   v2 — inst_qualificationVerifications
 *   v3 — inst_payrollRuns, inst_payslips, inst_courses, inst_gradeRecords, inst_campuses,
 *         inst_assets, inst_attendanceLogs, inst_incidents, inst_schedules
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
  inst_students!: Table<Student>;
  inst_feeRecords!: Table<FeeRecord>;
  mutationQueue!: Table<MutationQueueEntry>;

  // v2
  inst_qualificationVerifications!: Table<QualificationVerification>;

  // v3 — ERP & operational modules
  inst_payrollRuns!: Table<PayrollRun>;
  inst_payslips!: Table<Payslip>;
  inst_gradeRecords!: Table<GradeRecord>;
  inst_courses!: Table<OfflineCourse>;
  inst_campuses!: Table<Campus>;
  inst_assets!: Table<OfflineAsset>;
  inst_attendanceLogs!: Table<OfflineAttendanceLog>;
  inst_incidents!: Table<OfflineIncident>;
  inst_schedules!: Table<Schedule>;

  constructor() {
    super('webwaka-institutional');

    this.version(1).stores({
      inst_students: 'id, tenantId, matricNumber, status, programmeId, level',
      inst_feeRecords: 'id, tenantId, studentId, feeType, status, academicYear',
      mutationQueue: '++id, tenantId, createdAt',
    });

    this.version(2).stores({
      inst_students: 'id, tenantId, matricNumber, status, programmeId, level',
      inst_feeRecords: 'id, tenantId, studentId, feeType, status, academicYear',
      inst_qualificationVerifications: 'id, tenantId, studentId, verificationStatus',
      mutationQueue: '++id, tenantId, createdAt',
    });

    this.version(3).stores({
      inst_students: 'id, tenantId, matricNumber, status, programmeId, level',
      inst_feeRecords: 'id, tenantId, studentId, feeType, status, academicYear',
      inst_qualificationVerifications: 'id, tenantId, studentId, verificationStatus',
      mutationQueue: '++id, tenantId, createdAt',
      // Phase 1 — ERP
      inst_payrollRuns: 'id, tenantId, period, status',
      inst_payslips: 'id, tenantId, payrollRunId, staffId, status',
      // Phase 2 — Education
      inst_gradeRecords: 'id, tenantId, studentId, academicYear, semester',
      inst_courses: 'id, tenantId, code, instructorId, status',
      // Campus & Operational
      inst_campuses: 'id, tenantId, status',
      inst_assets: 'id, tenantId, category, status',
      inst_attendanceLogs: 'id, tenantId, memberId, timestamp',
      inst_incidents: 'id, tenantId, type, severity, status',
      // Phase 3 — AI
      inst_schedules: 'id, tenantId, type, status',
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
