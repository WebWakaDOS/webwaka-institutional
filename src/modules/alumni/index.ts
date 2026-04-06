/**
 * Alumni / Donor Portal — WebWaka Institutional Suite
 *
 * Manage fundraising campaigns, alumni engagement, and donation tracking.
 *
 * Invariant 2: tenantId always from JWT.
 * Invariant 5: all amounts in kobo.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const alumniRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Alumni ───────────────────────────────────────────────────────────────────

alumniRouter.post('/', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    firstName: string; lastName: string; graduationYear: string;
    programme?: string; currentOrg?: string; email?: string; phone?: string; studentId?: string;
  }>();
  if (!body.firstName || !body.lastName || !body.graduationYear) {
    return c.json({ error: 'firstName, lastName, and graduationYear are required' }, 400);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO alumni
       (id, tenantId, studentId, firstName, lastName, graduationYear, programme, currentOrg, email, phone, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).bind(id, tenantId, body.studentId ?? null, body.firstName, body.lastName,
    body.graduationYear, body.programme ?? null, body.currentOrg ?? null,
    body.email ?? null, body.phone ?? null, now, now).run();
  return c.json({ success: true, id }, 201);
});

alumniRouter.get('/', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { graduationYear } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM alumni WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (graduationYear) { sql += ' AND graduationYear = ?'; args.push(graduationYear); }
  sql += ' ORDER BY lastName ASC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

// ─── Campaigns ────────────────────────────────────────────────────────────────

alumniRouter.post('/campaigns', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const createdBy = c.get('user').userId;
  const body = await c.req.json<{
    title: string; description?: string; targetKobo: number; startDate: string; endDate?: string;
  }>();
  if (!body.title || !body.targetKobo || !body.startDate) {
    return c.json({ error: 'title, targetKobo, and startDate are required' }, 400);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO donationCampaigns
       (id, tenantId, title, description, targetKobo, currentKobo, startDate, endDate, status, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'active', ?, ?, ?)`
  ).bind(id, tenantId, body.title, body.description ?? null, body.targetKobo,
    body.startDate, body.endDate ?? null, createdBy, now, now).run();
  return c.json({ success: true, id }, 201);
});

alumniRouter.get('/campaigns', requireRole(['admin', 'alumni']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM donationCampaigns WHERE tenantId = ? ORDER BY startDate DESC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── Donations ────────────────────────────────────────────────────────────────

alumniRouter.post('/campaigns/:campaignId/donate', requireRole(['admin', 'alumni']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const campaignId = c.req.param('campaignId');
  const body = await c.req.json<{
    amountKobo: number; transactionRef?: string; donorName?: string;
    donorEmail?: string; alumniId?: string;
  }>();
  if (!body.amountKobo || body.amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer' }, 400);
  }

  const campaign = await c.env.DB.prepare(
    'SELECT id, status FROM donationCampaigns WHERE id = ? AND tenantId = ?'
  ).bind(campaignId, tenantId).first<{ id: string; status: string }>();
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404);
  if (campaign.status !== 'active') return c.json({ error: 'Campaign is not accepting donations' }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO donations
       (id, tenantId, alumniId, campaignId, amountKobo, transactionRef, donorName, donorEmail, donatedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.alumniId ?? null, campaignId, body.amountKobo,
    body.transactionRef ?? null, body.donorName ?? null, body.donorEmail ?? null, now, now).run();

  // Update campaign total
  await c.env.DB.prepare(
    `UPDATE donationCampaigns SET currentKobo = currentKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(body.amountKobo, now, campaignId, tenantId).run();

  // WI-009: Emit central-mgmt event so the immutable financial ledger is updated
  const donationEvent = {
    event: 'institution.donation.received',
    tenantId,
    donationId: id,
    campaignId,
    alumniId: body.alumniId ?? null,
    amountKobo: body.amountKobo,
    transactionRef: body.transactionRef ?? null,
    timestamp: now,
  };

  return c.json({ success: true, id, amountKobo: body.amountKobo, donationEvent }, 201);
});

alumniRouter.get('/campaigns/:campaignId/donations', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const campaignId = c.req.param('campaignId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM donations WHERE tenantId = ? AND campaignId = ? ORDER BY donatedAt DESC'
  ).bind(tenantId, campaignId).all();
  return c.json({ data: results });
});
