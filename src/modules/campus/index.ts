/**
 * Multi-Campus Support + Facility Booking — WebWaka Institutional Suite
 *
 * Manages physical campus locations and their bookable inst_facilities.
 *
 * Invariant 1: Build Once Use Infinitely — all auth from @webwaka/core
 * Invariant 2: tenantId always from JWT
 *
 * WI-007: Facility booking with conflict detection and approval workflow.
 *
 * IMPORTANT: All static sub-resource routes (/inst_facilities/*, /bookings/*)
 * are registered BEFORE the dynamic /:id route to prevent Hono matching
 * '/inst_facilities' as an :id parameter.
 *
 * Routes:
 *   POST   /api/campus                          — Create campus
 *   GET    /api/campus                          — List inst_campuses
 *
 *   POST   /api/campus/inst_facilities               — Create facility
 *   GET    /api/campus/inst_facilities               — List inst_facilities
 *   GET    /api/campus/inst_facilities/:id           — Get facility
 *   PATCH  /api/campus/inst_facilities/:id           — Update facility
 *
 *   POST   /api/campus/bookings                 — Request a facility booking
 *   GET    /api/campus/bookings                 — List bookings
 *   GET    /api/campus/bookings/:id             — Get booking
 *   PATCH  /api/campus/bookings/:id/approve     — Approve booking (admin)
 *   PATCH  /api/campus/bookings/:id/reject      — Reject booking (admin)
 *   PATCH  /api/campus/bookings/:id/cancel      — Cancel booking
 *
 *   GET    /api/campus/:id                      — Get campus  ← after static routes
 *   PATCH  /api/campus/:id                      — Update campus
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const campusRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ════════════════════════════════════════════════════════════════════════════
// CAMPUS — root-level list/create (no path param conflicts)
// ════════════════════════════════════════════════════════════════════════════

campusRouter.post('/', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    name: string; code?: string; address?: string; city?: string;
    state?: string; country?: string; phone?: string; email?: string;
  }>();
  if (!body.name) return c.json({ error: 'name is required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO inst_campuses
       (id, tenantId, name, code, address, city, state, country, phone, email, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).bind(id, tenantId, body.name, body.code ?? null, body.address ?? null,
    body.city ?? null, body.state ?? null, body.country ?? 'Nigeria',
    body.phone ?? null, body.email ?? null, now, now).run();

  return c.json({ success: true, id }, 201);
});

campusRouter.get('/', requireRole(['admin', 'inst_staff', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM inst_campuses WHERE tenantId = ? AND status = 'active' ORDER BY name ASC`
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ════════════════════════════════════════════════════════════════════════════
// FACILITY MANAGEMENT — static prefix must be before /:id  (WI-007)
// ════════════════════════════════════════════════════════════════════════════

campusRouter.post('/inst_facilities', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    campusId?: string;
    name: string;
    type: string;
    capacity?: number;
    status?: string;
  }>();
  if (!body.name || !body.type) {
    return c.json({ error: 'name and type are required' }, 400);
  }

  const VALID_TYPES = new Set(['lecture_hall', 'lab', 'sports', 'auditorium', 'conference', 'other']);
  if (!VALID_TYPES.has(body.type)) {
    return c.json({ error: `type must be one of: ${[...VALID_TYPES].join(', ')}` }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO inst_facilities
       (id, tenantId, campusId, name, type, capacity, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.campusId ?? null, body.name, body.type,
    body.capacity ?? null, body.status ?? 'available', now, now).run();

  return c.json({ success: true, id }, 201);
});

campusRouter.get('/inst_facilities', requireRole(['admin', 'inst_staff', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { campusId, type, status } = c.req.query() as Record<string, string>;

  let sql = 'SELECT * FROM inst_facilities WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (campusId) { sql += ' AND campusId = ?'; args.push(campusId); }
  if (type) { sql += ' AND type = ?'; args.push(type); }
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY name ASC';

  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

campusRouter.get('/inst_facilities/:id', requireRole(['admin', 'inst_staff', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const facility = await c.env.DB.prepare(
    'SELECT * FROM inst_facilities WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!facility) return c.json({ error: 'Facility not found' }, 404);
  return c.json({ data: facility });
});

campusRouter.patch('/inst_facilities/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string; type?: string; capacity?: number; status?: string;
  }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE inst_facilities
     SET name = COALESCE(?, name), type = COALESCE(?, type),
         capacity = COALESCE(?, capacity), status = COALESCE(?, status), updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.name ?? null, body.type ?? null, body.capacity ?? null,
    body.status ?? null, now, id, tenantId).run();
  return c.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// FACILITY BOOKINGS — static prefix must be before /:id  (WI-007)
// ════════════════════════════════════════════════════════════════════════════

campusRouter.post('/bookings', requireRole(['admin', 'inst_staff', 'teacher']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    facilityId: string;
    purpose: string;
    startTime: string;
    endTime: string;
    attendees?: number;
    notes?: string;
  }>();

  if (!body.facilityId || !body.purpose || !body.startTime || !body.endTime) {
    return c.json({ error: 'facilityId, purpose, startTime, endTime are required' }, 400);
  }
  if (body.startTime >= body.endTime) {
    return c.json({ error: 'endTime must be after startTime' }, 400);
  }

  // Verify facility exists and belongs to tenant
  const facility = await c.env.DB.prepare(
    `SELECT id, status FROM inst_facilities WHERE id = ? AND tenantId = ?`
  ).bind(body.facilityId, tenantId).first<{ id: string; status: string }>();
  if (!facility) return c.json({ error: 'Facility not found' }, 404);
  if (facility.status !== 'available') {
    return c.json({ error: 'Facility is not available for booking' }, 409);
  }

  // Conflict detection: check for overlapping approved bookings
  const conflict = await c.env.DB.prepare(
    `SELECT id FROM inst_facilityBookings
     WHERE facilityId = ? AND tenantId = ? AND status = 'approved'
       AND startTime < ? AND endTime > ?`
  ).bind(body.facilityId, tenantId, body.endTime, body.startTime).first();
  if (conflict) {
    return c.json({ error: 'Facility is already booked for the requested time slot' }, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO inst_facilityBookings
       (id, tenantId, facilityId, bookedBy, purpose, startTime, endTime,
        attendees, status, notes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).bind(id, tenantId, body.facilityId, user.userId, body.purpose,
    body.startTime, body.endTime, body.attendees ?? null,
    body.notes ?? null, now, now).run();

  return c.json({ success: true, id, status: 'pending' }, 201);
});

campusRouter.get('/bookings', requireRole(['admin', 'inst_staff', 'teacher']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const { facilityId, status } = c.req.query() as Record<string, string>;

  let sql = 'SELECT * FROM inst_facilityBookings WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (user.role !== 'admin') { sql += ' AND bookedBy = ?'; args.push(user.userId); }
  if (facilityId) { sql += ' AND facilityId = ?'; args.push(facilityId); }
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY startTime ASC';

  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

campusRouter.get('/bookings/:id', requireRole(['admin', 'inst_staff', 'teacher']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const booking = await c.env.DB.prepare(
    'SELECT * FROM inst_facilityBookings WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!booking) return c.json({ error: 'Booking not found' }, 404);
  return c.json({ data: booking });
});

campusRouter.patch('/bookings/:id/approve', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const reviewedBy = c.get('user').userId;
  const id = c.req.param('id');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE inst_facilityBookings
     SET status = 'approved', reviewedBy = ?, reviewedAt = ?, updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(reviewedBy, now, now, id, tenantId).run();
  return c.json({ success: true, status: 'approved' });
});

campusRouter.patch('/bookings/:id/reject', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const reviewedBy = c.get('user').userId;
  const id = c.req.param('id');
  const body = await c.req.json<{ reason?: string }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE inst_facilityBookings
     SET status = 'rejected', reviewedBy = ?, reviewedAt = ?,
         notes = COALESCE(?, notes), updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(reviewedBy, now, body.reason ?? null, now, id, tenantId).run();
  return c.json({ success: true, status: 'rejected' });
});

campusRouter.patch('/bookings/:id/cancel', requireRole(['admin', 'inst_staff', 'teacher']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const booking = await c.env.DB.prepare(
    'SELECT id, bookedBy, status FROM inst_facilityBookings WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<{ id: string; bookedBy: string; status: string }>();
  if (!booking) return c.json({ error: 'Booking not found' }, 404);

  if (user.role !== 'admin' && booking.bookedBy !== user.userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (booking.status === 'cancelled') {
    return c.json({ error: 'Booking is already cancelled' }, 409);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE inst_facilityBookings SET status = 'cancelled', updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(now, id, tenantId).run();
  return c.json({ success: true, status: 'cancelled' });
});

// ════════════════════════════════════════════════════════════════════════════
// CAMPUS — dynamic /:id routes LAST (after all static prefixes)
// ════════════════════════════════════════════════════════════════════════════

campusRouter.get('/:id', requireRole(['admin', 'inst_staff', 'teacher', 'student']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const campus = await c.env.DB.prepare(
    'SELECT * FROM inst_campuses WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!campus) return c.json({ error: 'Campus not found' }, 404);
  return c.json({ data: campus });
});

campusRouter.patch('/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string; address?: string; city?: string; state?: string;
    phone?: string; email?: string; status?: string;
  }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE inst_campuses
     SET name = COALESCE(?, name), address = COALESCE(?, address), city = COALESCE(?, city),
         state = COALESCE(?, state), phone = COALESCE(?, phone), email = COALESCE(?, email),
         status = COALESCE(?, status), updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.name ?? null, body.address ?? null, body.city ?? null, body.state ?? null,
    body.phone ?? null, body.email ?? null, body.status ?? null, now, id, tenantId).run();
  return c.json({ success: true });
});
