/**
 * Asset Management — WebWaka Institutional Suite
 *
 * Track lifecycle, depreciation, and maintenance of physical assets.
 *
 * Invariant 2: tenantId always from JWT.
 * Invariant 5: all monetary values in kobo.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const assetsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

assetsRouter.post('/', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    name: string; category: string; serialNumber?: string;
    purchasePriceKobo?: number; purchaseDate?: string; campusId?: string;
    location?: string; assignedTo?: string; depreciationRatePct?: number;
  }>();
  if (!body.name || !body.category) return c.json({ error: 'name and category are required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO assets
       (id, tenantId, name, category, serialNumber, purchasePriceKobo, purchaseDate,
        campusId, location, status, assignedTo, depreciationRatePct, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).bind(id, tenantId, body.name, body.category,
    body.serialNumber ?? null, body.purchasePriceKobo ?? null, body.purchaseDate ?? null,
    body.campusId ?? null, body.location ?? null, body.assignedTo ?? null,
    body.depreciationRatePct ?? 20, now, now).run();

  return c.json({ success: true, id }, 201);
});

assetsRouter.get('/', requireRole(['admin', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { category, status, campusId } = c.req.query() as Record<string, string>;
  let sql = 'SELECT * FROM assets WHERE tenantId = ?';
  const args: unknown[] = [tenantId];
  if (category) { sql += ' AND category = ?'; args.push(category); }
  if (status)   { sql += ' AND status = ?';   args.push(status); }
  if (campusId) { sql += ' AND campusId = ?'; args.push(campusId); }
  sql += ' ORDER BY name ASC';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ data: results });
});

assetsRouter.get('/:id', requireRole(['admin', 'staff']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const asset = await c.env.DB.prepare(
    'SELECT * FROM assets WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!asset) return c.json({ error: 'Asset not found' }, 404);
  return c.json({ data: asset });
});

assetsRouter.patch('/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{
    status?: string; assignedTo?: string; location?: string; lastMaintenanceAt?: string;
  }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE assets SET status = COALESCE(?, status), assignedTo = COALESCE(?, assignedTo),
       location = COALESCE(?, location), lastMaintenanceAt = COALESCE(?, lastMaintenanceAt), updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(body.status ?? null, body.assignedTo ?? null, body.location ?? null,
    body.lastMaintenanceAt ?? null, now, id, tenantId).run();
  return c.json({ success: true });
});

// Book value after depreciation (straight-line)
assetsRouter.get('/:id/book-value', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const asset = await c.env.DB.prepare(
    'SELECT purchasePriceKobo, purchaseDate, depreciationRatePct FROM assets WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first<{
    purchasePriceKobo: number; purchaseDate: string; depreciationRatePct: number;
  }>();
  if (!asset) return c.json({ error: 'Asset not found' }, 404);
  if (!asset.purchasePriceKobo || !asset.purchaseDate) {
    return c.json({ error: 'Purchase price and date required for depreciation calculation' }, 422);
  }
  const years = (Date.now() - new Date(asset.purchaseDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  const depreciation = Math.min(1, (asset.depreciationRatePct / 100) * years);
  const bookValueKobo = Math.max(0, Math.round(asset.purchasePriceKobo * (1 - depreciation)));
  return c.json({ bookValueKobo, yearsOld: Math.round(years * 10) / 10 });
});
