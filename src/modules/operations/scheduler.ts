/**
 * AI Resource Allocation / Scheduler — WebWaka Institutional Suite
 *
 * Task: Phase 3 — AI & Optimization
 *
 * Takes a list of required sessions (classes, meetings, procedures) and available
 * rooms/resources, calls getAICompletion() from the ai-platform-client to generate
 * a conflict-free optimal schedule, then saves to the `schedules` D1 table.
 *
 * Invariant 2: tenantId always from JWT.
 *
 * Routes:
 *   POST  /api/scheduler/schedules        — Generate a new AI schedule
 *   GET   /api/scheduler/schedules        — List schedules
 *   GET   /api/scheduler/schedules/:id    — Get schedule detail
 *   DELETE /api/scheduler/schedules/:id   — Remove schedule
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';
import { getAICompletion } from '../../core/ai-platform-client';

export const schedulerRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

interface Room {
  id: string;
  name: string;
  capacity: number;
  facilities?: string[];
}

interface Session {
  id: string;
  name: string;
  requiredCapacity: number;
  durationMinutes: number;
  instructor?: string;
  preferredFacilities?: string[];
}

// ─── POST /api/scheduler/schedules ───────────────────────────────────────────
schedulerRouter.post('/schedules', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const createdBy = c.get('user').userId;
  const body = await c.req.json<{
    title: string;
    type?: string;
    rooms: Room[];
    sessions: Session[];
    constraints?: string;
  }>();

  if (!body.title || !Array.isArray(body.rooms) || !Array.isArray(body.sessions)) {
    return c.json({ error: 'title, rooms[], and sessions[] are required' }, 400);
  }
  if (body.rooms.length === 0 || body.sessions.length === 0) {
    return c.json({ error: 'At least one room and one session are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const inputData = { rooms: body.rooms, sessions: body.sessions, constraints: body.constraints };

  // Persist as pending immediately so caller has an id to poll
  await c.env.DB.prepare(
    `INSERT INTO schedules (id, tenantId, title, type, inputData, status, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(id, tenantId, body.title, body.type ?? 'room', JSON.stringify(inputData), createdBy, now).run();

  // Build AI prompt
  const prompt = `You are an expert academic/facility scheduler.

Generate a conflict-free, optimal schedule for the following:

ROOMS:
${body.rooms.map((r) => `- ${r.name} (capacity: ${r.capacity}, facilities: ${(r.facilities ?? []).join(', ') || 'standard'})`).join('\n')}

SESSIONS TO SCHEDULE:
${body.sessions.map((s) => `- ${s.name}: needs capacity ${s.requiredCapacity}, duration ${s.durationMinutes}min${s.instructor ? `, instructor: ${s.instructor}` : ''}${(s.preferredFacilities ?? []).length ? `, prefers: ${s.preferredFacilities!.join(', ')}` : ''}`).join('\n')}

${body.constraints ? `ADDITIONAL CONSTRAINTS:\n${body.constraints}` : ''}

Return a JSON object with this exact structure:
{
  "schedule": [
    {
      "sessionId": "...",
      "sessionName": "...",
      "roomId": "...",
      "roomName": "...",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "day": "Monday"
    }
  ],
  "conflicts": [],
  "notes": "any scheduling notes or warnings"
}`;

  let scheduleData: unknown = null;
  let model = 'unknown';
  let tokensUsed = 0;
  let finalStatus = 'generated';

  try {
    const aiEnv = {
      AI_PLATFORM_URL: (c.env as unknown as Record<string, string>)['AI_PLATFORM_URL'] ?? '',
      INTER_SERVICE_SECRET: (c.env as unknown as Record<string, string>)['INTER_SERVICE_SECRET'] ?? '',
    };

    const completion = await getAICompletion(
      aiEnv,
      {
        prompt,
        capabilityId: 'ai.institutional.scheduling',
        maxTokens: 2048,
        temperature: 0.3,
        systemPrompt: 'You are a precise scheduling assistant. Always return valid JSON only, no markdown.',
      },
      tenantId,
    );

    model = completion.model;
    tokensUsed = completion.usage.totalTokens;

    // Parse AI response — strip markdown fences if present
    const raw = completion.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    scheduleData = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    finalStatus = 'failed';
    scheduleData = { error: msg };
  }

  const generatedAt = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE schedules SET data = ?, model = ?, tokensUsed = ?, status = ?, generatedAt = ?
     WHERE id = ? AND tenantId = ?`
  ).bind(JSON.stringify(scheduleData), model, tokensUsed, finalStatus, generatedAt, id, tenantId).run();

  return c.json({ success: finalStatus === 'generated', id, status: finalStatus, data: scheduleData }, 201);
});

// ─── GET /api/scheduler/schedules ─────────────────────────────────────────────
schedulerRouter.get('/schedules', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const { results } = await c.env.DB.prepare(
    'SELECT id, tenantId, title, type, status, generatedAt, tokensUsed, createdAt FROM schedules WHERE tenantId = ? ORDER BY createdAt DESC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── GET /api/scheduler/schedules/:id ─────────────────────────────────────────
schedulerRouter.get('/schedules/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const record = await c.env.DB.prepare(
    'SELECT * FROM schedules WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();
  if (!record) return c.json({ error: 'Schedule not found' }, 404);
  return c.json({ data: record });
});

// ─── DELETE /api/scheduler/schedules/:id ─────────────────────────────────────
schedulerRouter.delete('/schedules/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM schedules WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).run();
  return c.json({ success: true });
});
