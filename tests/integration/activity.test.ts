/**
 * Integration tests for activity log API endpoints.
 *
 * Tests:
 * - GET /api/activity (list all, optionally filtered by workspace)
 * - POST /api/activity (add entry)
 * - GET /api/public/activity/:workspaceId (client-visible entries)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13204);
const { api, postJson } = ctx;

const testWsId = 'ws_integ_activity_' + Date.now();

beforeAll(async () => {
  // Seed workspace so FK constraints on activity_log.workspace_id are satisfied
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(testWsId, 'Test Activity WS', testWsId, new Date().toISOString());
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  ctx.stopServer();
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(testWsId);
});

describe('Activity Log API', () => {
  it('GET /api/activity returns 200 with array', async () => {
    const res = await api('/api/activity');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/activity with missing fields returns 400', async () => {
    const res = await postJson('/api/activity', {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
  });

  it('POST /api/activity creates an entry', async () => {
    const res = await postJson('/api/activity', {
      workspaceId: testWsId,
      type: 'audit_completed',
      title: 'Integration test activity',
      description: 'Created by integration test',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.workspaceId).toBe(testWsId);
    expect(body.type).toBe('audit_completed');
    expect(body.title).toBe('Integration test activity');
  });

  it('GET /api/activity?workspaceId= filters by workspace', async () => {
    const res = await api(`/api/activity?workspaceId=${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    // All entries should be for our workspace
    for (const entry of body) {
      expect(entry.workspaceId).toBe(testWsId);
    }
  });

  it('GET /api/activity?limit= respects limit', async () => {
    // Add a second entry
    await postJson('/api/activity', {
      workspaceId: testWsId,
      type: 'tier_upgraded',
      title: 'Second activity',
    });

    const res = await api(`/api/activity?workspaceId=${testWsId}&limit=1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it('GET /api/public/activity/:wsId returns client-visible entries', async () => {
    const res = await api(`/api/public/activity/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Client-visible entries are filtered by type
  });
});
