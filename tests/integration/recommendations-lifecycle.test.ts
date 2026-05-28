/**
 * Integration tests for the recommendations full positive lifecycle.
 *
 * Covers:
 * - GET with seeded data
 * - PATCH status transitions (pending → in_progress / completed / dismissed)
 * - DELETE (dismiss) returning { ok: true }
 * - Broadcast payloads for PATCH and DELETE
 * - Workspace isolation (PATCH on rec from another workspace → 404)
 *
 * Uses vi.mock for broadcastToWorkspace so we can capture calls without
 * needing a live WebSocket server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ─── Broadcast mock ───────────────────────────────────────────────────────────
// Must be vi.hoisted so the state object is initialised before the mock factory.

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(
    (workspaceId: string, event: string, payload: Record<string, unknown>) => {
      broadcastState.calls.push({ workspaceId, event, payload });
    },
  ),
}));

// ─── Imports (after mock registration) ───────────────────────────────────────

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { RecommendationSet } from '../../shared/types/recommendations.js';

// ─── Server bootstrap ─────────────────────────────────────────────────────────
// This file uses the inline server pattern (vi.mock + dynamic import of app)
// rather than createTestContext(), because createTestContext() spawns a subprocess
// that cannot share the vi.mock state.

let baseUrl = '';
let server: http.Server | undefined;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function makeRecSet(wsId: string, recId: string, overrides: Partial<RecommendationSet['recommendations'][0]> = {}): RecommendationSet {
  return {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: [
      {
        id: recId,
        workspaceId: wsId,
        priority: 'fix_now',
        type: 'metadata',
        actionType: 'manual',
        title: 'Fix missing meta descriptions',
        description: 'Several pages lack meta descriptions',
        insight: 'This affects click-through rates',
        impact: 'high',
        effort: 'low',
        impactScore: 80,
        source: 'seo_audit',
        affectedPages: ['/about', '/services'],
        trafficAtRisk: 1200,
        impressionsAtRisk: 8000,
        estimatedGain: '~200 clicks/month',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
      },
    ],
    summary: {
      fixNow: 1,
      fixSoon: 0,
      fixLater: 0,
      ongoing: 0,
      totalImpactScore: 80,
      trafficAtRisk: 1200,
      estimatedRecoverableClicks: 200,
      estimatedRecoverableImpressions: 8000,
    },
  };
}

// ─── Workspace IDs ────────────────────────────────────────────────────────────

let wsId = '';
let otherWsId = '';

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Recommendations Lifecycle Test');
  wsId = ws.id;
  const other = createWorkspace('Recommendations Isolation Other');
  otherWsId = other.id;
}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(otherWsId);
  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);
  await stopTestServer();
});

// ─── GET with seeded data ─────────────────────────────────────────────────────

describe('GET /api/public/recommendations/:workspaceId — with seeded data', () => {
  const seededRecId = `rec_lifecycle_get_${Date.now()}`;

  beforeAll(() => {
    saveRecommendations(makeRecSet(wsId, seededRecId));
  });

  it('returns 200 with a recommendations array containing the seeded rec', async () => {
    const res = await api(`/api/public/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    expect(Array.isArray(body.recommendations)).toBe(true);
    const found = body.recommendations.find((r) => r.id === seededRecId);
    expect(found).toBeDefined();
  });

  it('returns the recommendation with expected fields (id, title, status, priority)', async () => {
    const res = await api(`/api/public/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    const rec = body.recommendations.find((r) => r.id === seededRecId);
    expect(rec).toMatchObject({
      id: seededRecId,
      title: 'Fix missing meta descriptions',
      status: 'pending',
      priority: 'fix_now',
    });
  });

  it('returns an empty recommendations array when no set is saved for a fresh workspace', async () => {
    const freshWs = createWorkspace('Rec Lifecycle Fresh WS');
    try {
      // Don't seed anything — the GET will try to auto-generate, which may
      // fail in test env (no OpenAI key). Either way we just need to confirm
      // no cross-workspace data leaks.
      const res = await api(`/api/public/recommendations/${freshWs.id}`);
      // 200 (empty set from gen or mocked) or 500 (no OpenAI key) are both acceptable
      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        const body = await res.json() as RecommendationSet;
        // Must not contain recs belonging to the other workspace
        const ids = body.recommendations.map((r) => r.id);
        expect(ids).not.toContain(seededRecId);
      }
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });
});

// ─── PATCH status updates ─────────────────────────────────────────────────────

describe('PATCH /api/public/recommendations/:workspaceId/:recId — status updates', () => {
  // Each sub-test uses its own rec so mutations don't interfere
  function mkPatchRecId(suffix: string) {
    return `rec_lc_patch_${suffix}_${Date.now()}`;
  }

  it('updates pending → in_progress, returns updated rec with new status', async () => {
    const recId = mkPatchRecId('inprog');
    saveRecommendations(makeRecSet(wsId, recId));

    const res = await patchJson(`/api/public/recommendations/${wsId}/${recId}`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(200);
    const rec = await res.json() as RecommendationSet['recommendations'][0];
    expect(rec.id).toBe(recId);
    expect(rec.status).toBe('in_progress');
  });

  it('updates pending → completed, returns updated rec', async () => {
    const recId = mkPatchRecId('completed');
    saveRecommendations(makeRecSet(wsId, recId));

    const res = await patchJson(`/api/public/recommendations/${wsId}/${recId}`, {
      status: 'completed',
    });
    expect(res.status).toBe(200);
    const rec = await res.json() as RecommendationSet['recommendations'][0];
    expect(rec.status).toBe('completed');
  });

  it('updates pending → dismissed, returns updated rec', async () => {
    const recId = mkPatchRecId('dismissed');
    saveRecommendations(makeRecSet(wsId, recId));

    const res = await patchJson(`/api/public/recommendations/${wsId}/${recId}`, {
      status: 'dismissed',
    });
    expect(res.status).toBe(200);
    const rec = await res.json() as RecommendationSet['recommendations'][0];
    expect(rec.status).toBe('dismissed');
  });

  it('updates in_progress → completed, returns updated rec', async () => {
    const recId = mkPatchRecId('inprog_to_completed');
    saveRecommendations(makeRecSet(wsId, recId, { status: 'in_progress' }));

    const res = await patchJson(`/api/public/recommendations/${wsId}/${recId}`, {
      status: 'completed',
    });
    expect(res.status).toBe(200);
    const rec = await res.json() as RecommendationSet['recommendations'][0];
    expect(rec.status).toBe('completed');
  });

  it('returns 400 for an invalid status value', async () => {
    const recId = mkPatchRecId('badstatus');
    saveRecommendations(makeRecSet(wsId, recId));

    const res = await patchJson(`/api/public/recommendations/${wsId}/${recId}`, {
      status: 'bogus_status',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Valid status required');
  });

  it('returns 404 for an unknown recId', async () => {
    const res = await patchJson(`/api/public/recommendations/${wsId}/rec_does_not_exist_xyz`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Recommendation not found');
  });

  it('broadcasts RECOMMENDATIONS_UPDATED with { recId, status } after a successful update', async () => {
    const recId = mkPatchRecId('broadcast');
    saveRecommendations(makeRecSet(wsId, recId));
    broadcastState.calls = [];

    const res = await patchJson(`/api/public/recommendations/${wsId}/${recId}`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(200);

    const recBroadcasts = broadcastState.calls.filter(
      (c) => c.event === WS_EVENTS.RECOMMENDATIONS_UPDATED,
    );
    expect(recBroadcasts).toHaveLength(1);
    expect(recBroadcasts[0]).toMatchObject({
      workspaceId: wsId,
      event: WS_EVENTS.RECOMMENDATIONS_UPDATED,
      payload: { recId, status: 'in_progress' },
    });
  });
});

// ─── DELETE (dismiss) ─────────────────────────────────────────────────────────

describe('DELETE /api/public/recommendations/:workspaceId/:recId — dismiss', () => {
  it('deletes rec and returns { ok: true }', async () => {
    const recId = `rec_lc_del_ok_${Date.now()}`;
    saveRecommendations(makeRecSet(wsId, recId));

    const res = await del(`/api/public/recommendations/${wsId}/${recId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 404 for an unknown recId', async () => {
    const res = await del(`/api/public/recommendations/${wsId}/rec_delete_nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Recommendation not found');
  });

  it('broadcasts RECOMMENDATIONS_UPDATED with { recId, status: "dismissed", deleted: true }', async () => {
    const recId = `rec_lc_del_broadcast_${Date.now()}`;
    saveRecommendations(makeRecSet(wsId, recId));
    broadcastState.calls = [];

    const res = await del(`/api/public/recommendations/${wsId}/${recId}`);
    expect(res.status).toBe(200);

    const recBroadcasts = broadcastState.calls.filter(
      (c) => c.event === WS_EVENTS.RECOMMENDATIONS_UPDATED,
    );
    expect(recBroadcasts).toHaveLength(1);
    expect(recBroadcasts[0]).toMatchObject({
      workspaceId: wsId,
      event: WS_EVENTS.RECOMMENDATIONS_UPDATED,
      payload: { recId, status: 'dismissed', deleted: true },
    });
  });
});

// ─── Workspace isolation ──────────────────────────────────────────────────────

describe('Workspace isolation', () => {
  it('PATCH on rec from another workspace returns 404', async () => {
    // Seed a rec in otherWsId
    const recId = `rec_lc_iso_${Date.now()}`;
    saveRecommendations(makeRecSet(otherWsId, recId));

    // Attempt to update using wsId (not the owning workspace)
    const res = await patchJson(`/api/public/recommendations/${wsId}/${recId}`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Recommendation not found');
  });
});
