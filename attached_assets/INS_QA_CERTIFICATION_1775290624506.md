# WebWaka Institutional (`webwaka-institutional`) QA Certification

**Prepared by:** Manus AI
**Date:** April 2026
**Target Repository:** `webwaka-institutional`

## 1. Audit Scope

This QA certification covers the implementation of the Automated Payroll Engine, AI Resource Allocation, and HL7 FHIR Integration in `webwaka-institutional`.

## 2. Acceptance Criteria

| ID | Feature | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| QA-INS-1 | Payroll Engine | The payroll run successfully calculates net pay and emits `fintech.payout.requested` events for all active employees. | PENDING |
| QA-INS-2 | AI Resource Allocation | `getAICompletion()` successfully generates a conflict-free schedule for a given list of classes and rooms. | PENDING |
| QA-INS-3 | HL7 FHIR | The `GET /fhir/Patient/:id` endpoint returns a valid HL7 FHIR JSON representation of the patient record. | PENDING |
| QA-INS-4 | Unit Tests | All new HR and operations modules have passing unit tests in `src/**/*.test.ts`. | PENDING |

## 3. Offline Resilience Testing

- The institutional service is a backend API; offline resilience applies to its clients (e.g., campus portals).
- However, the service must gracefully handle upstream provider outages (e.g., AI platform 503s) by returning a clear error message and allowing the user to retry the schedule generation later.

## 4. Security & RBAC Validation

- Verify that the payroll endpoints require a valid HR administrator JWT and the `manage:payroll` permission.
- Ensure that the HL7 FHIR endpoints require strict authentication and authorization (e.g., OAuth2 scopes for healthcare data).
- Confirm that sensitive employee and patient data is encrypted at rest in the D1 database.

## 5. Regression Guards

- Run `npm run test` to ensure 100% pass rate.
- Run `npm run build` to ensure no TypeScript compilation errors.
- Verify that the existing student/patient record management logic still functions correctly and integrates with the new ERP features.
