import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { createTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13229);
const { api } = ctx;

let wsA: SeededFullWorkspace;
let wsB: SeededFullWorkspace;

beforeAll(async () => {
  await ctx.startServer();
  wsA = seedWorkspace();
  wsB = seedWorkspace();
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM audit_schedules WHERE workspace_id IN (?, ?)').run(wsA.workspaceId, wsB.workspaceId);
  wsA.cleanup();
  wsB.cleanup();
  await ctx.stopServer();
});

describe('Audit schedule routes', () => {
  it('GET /api/audit-schedules/:workspaceId returns 404 when no schedule exists', async () => {
    const res = await api(`/api/audit-schedules/${wsA.workspaceId}`);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'No schedule found' });
  });

  it('PUT /api/audit-schedules/:workspaceId creates a schedule with explicit values', async () => {
    const res = await api(`/api/audit-schedules/${wsA.workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: false,
        intervalDays: 14,
        scoreDropThreshold: 9,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      workspaceId: wsA.workspaceId,
      enabled: false,
      intervalDays: 14,
      scoreDropThreshold: 9,
    });
  });

  it('PUT /api/audit-schedules/:workspaceId merges partial updates', async () => {
    const res = await api(`/api/audit-schedules/${wsA.workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intervalDays: 30,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      workspaceId: wsA.workspaceId,
      enabled: false,
      intervalDays: 30,
      scoreDropThreshold: 9,
    });
  });

  it('PUT /api/audit-schedules/:workspaceId applies defaults when body is empty', async () => {
    const res = await api(`/api/audit-schedules/${wsB.workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      workspaceId: wsB.workspaceId,
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
    });
  });

  it('GET /api/audit-schedules returns all saved schedules', async () => {
    const res = await api('/api/audit-schedules');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);

    const scheduleA = body.find((schedule: { workspaceId: string }) => schedule.workspaceId === wsA.workspaceId);
    const scheduleB = body.find((schedule: { workspaceId: string }) => schedule.workspaceId === wsB.workspaceId);

    expect(scheduleA).toMatchObject({
      workspaceId: wsA.workspaceId,
      enabled: false,
      intervalDays: 30,
      scoreDropThreshold: 9,
    });
    expect(scheduleB).toMatchObject({
      workspaceId: wsB.workspaceId,
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
    });
  });

  it('DELETE /api/audit-schedules/:workspaceId removes schedule and returns ok', async () => {
    const deleteRes = await api(`/api/audit-schedules/${wsA.workspaceId}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toEqual({ ok: true });

    const fetchRes = await api(`/api/audit-schedules/${wsA.workspaceId}`);
    expect(fetchRes.status).toBe(404);
    await expect(fetchRes.json()).resolves.toEqual({ error: 'No schedule found' });
  });
});
