/**
 * Integration tests for:
 *   1. Brand identity PATCH — updating content and status fields (with seeded deliverables)
 *   2. Anomalies lifecycle — dismiss, acknowledge, workspace-scoped list
 *
 * Covers gaps left by existing test files:
 *   - brand-identity-read-routes.test.ts  — basic GET + 404/400 cases (no broadcast, no isolation)
 *   - brand-identity-hardening.test.ts    — tier gate + aiLimiter + sanitize (AI generate/refine only)
 *   - anomalies-routes.test.ts            — empty-array GET + 404 for bad ids (no seeded data lifecycle)
 *   - anomaly-boost-reversal.test.ts      — score reversal mechanics (not basic dismiss/acknowledge flow)
 *
 * Architecture: in-process server (listen(0)) so vi.mock works for broadcast verification.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import db from '../../server/db/index.js';

// ── In-process mocks — hoisted so they are registered before any server import ─

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
  notifyApprovalReady: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientFixesApplied: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
}));

// ── Server + HTTP helpers ─────────────────────────────────────────────────────

delete process.env.APP_PASSWORD;

let baseUrl = '';
let server: http.Server | undefined;

// Re-use the native fetch before any polyfill can interfere
const nativeFetch = globalThis.fetch;

async function startTestServer(): Promise<void> {
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${path}`, withPublicTestAuth(path, opts));
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Workspace IDs ────────────────────────────────────────────────────────────

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

let wsA = '';
let wsB = '';

// ── Helpers — seed a brand identity deliverable directly into the DB ─────────

// There is a UNIQUE constraint on (workspace_id, deliverable_type) — migration 056.
// Each call uses the next available type for the given workspace to avoid conflicts.
const DELIVERABLE_TYPES = [
  'mission', 'vision', 'values', 'tagline', 'elevator_pitch',
  'archetypes', 'personality_traits', 'voice_guidelines', 'tone_examples',
  'messaging_pillars', 'differentiators', 'positioning_matrix', 'brand_story',
  'personas', 'customer_journey', 'objection_handling', 'emotional_triggers',
] as const;
type DeliverableTypeVal = typeof DELIVERABLE_TYPES[number];

const typeCounters: Record<string, number> = {};

function nextType(workspaceId: string): DeliverableTypeVal {
  const idx = typeCounters[workspaceId] ?? 0;
  typeCounters[workspaceId] = idx + 1;
  return DELIVERABLE_TYPES[idx % DELIVERABLE_TYPES.length];
}

function seedDeliverable(opts: {
  workspaceId: string;
  id?: string;
  deliverableType?: DeliverableTypeVal;
  content?: string;
  status?: 'draft' | 'approved';
  tier?: string;
  version?: number;
}): string {
  const {
    workspaceId,
    id = `bid_${crypto.randomBytes(8).toString('hex')}`,
    deliverableType = nextType(workspaceId),
    content = 'Original deliverable content.',
    status = 'draft',
    tier = 'essentials',
    version = 1,
  } = opts;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO brand_identity_deliverables
      (id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, deliverableType, content, status, version, tier, now, now);
  return id;
}

// ── Helper — seed an anomaly directly into the DB ───────────────────────────

function seedAnomaly(opts: {
  workspaceId: string;
  id?: string;
  type?: string;
  workspaceName?: string;
  severity?: string;
  source?: string;
}): string {
  const {
    workspaceId,
    id = `anm_${crypto.randomBytes(8).toString('hex')}`,
    type = 'traffic_drop',
    workspaceName = 'Test Workspace',
    severity = 'critical',
    source = 'gsc',
  } = opts;
  db.prepare(`
    INSERT INTO anomalies
      (id, workspace_id, workspace_name, type, severity,
       title, description, metric, current_value, previous_value, change_pct,
       ai_summary, detected_at, dismissed_at, acknowledged_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, workspaceId, workspaceName, type, severity,
    'Test anomaly title', 'Test anomaly description',
    'clicks', 80, 200, -60,
    null, new Date().toISOString(), null, null, source,
  );
  return id;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsA = createWorkspace('Brand+Anomalies WS-A lifecycle').id;
  wsB = createWorkspace('Brand+Anomalies WS-B lifecycle').id;
}, 30_000);

afterAll(async () => {
  db.prepare('DELETE FROM brand_identity_deliverables WHERE workspace_id IN (?, ?)').run(wsA, wsB);
  db.prepare('DELETE FROM anomalies WHERE workspace_id IN (?, ?)').run(wsA, wsB);
  deleteWorkspace(wsA);
  deleteWorkspace(wsB);
  await stopTestServer();
});

beforeEach(() => {
  broadcastState.calls.length = 0;
});

// ═════════════════════════════════════════════════════════════════════════════
// Brand Identity — PATCH /api/brand-identity/:workspaceId/:id
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/brand-identity/:workspaceId/:id — content update', () => {
  it('updates the content field and returns 200 with updated deliverable', async () => {
    const id = seedDeliverable({ workspaceId: wsA, content: 'Original content.' });

    const res = await patchJson(`/api/brand-identity/${wsA}/${id}`, {
      content: 'Rewritten mission statement.',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; content: string; status: string; version: number };
    expect(body.id).toBe(id);
    expect(body.content).toBe('Rewritten mission statement.');
    // Content update resets to draft and increments version
    expect(body.status).toBe('draft');
    expect(body.version).toBe(2);
  });

  it('updates the status field (draft → approved) and returns updated status', async () => {
    const id = seedDeliverable({ workspaceId: wsA, status: 'draft' });

    const res = await patchJson(`/api/brand-identity/${wsA}/${id}`, {
      status: 'approved',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('approved');
  });

  it('persists updates — subsequent GET returns the new content', async () => {
    const id = seedDeliverable({ workspaceId: wsA, content: 'Pre-patch content.', status: 'draft' });

    await patchJson(`/api/brand-identity/${wsA}/${id}`, {
      content: 'Persisted content after patch.',
    });

    const getRes = await api(`/api/brand-identity/${wsA}/${id}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as { content: string };
    expect(body.content).toBe('Persisted content after patch.');
  });

  it('returns 400 for an invalid schema (empty body — no field provided)', async () => {
    const id = seedDeliverable({ workspaceId: wsA });

    const res = await patchJson(`/api/brand-identity/${wsA}/${id}`, {});

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('returns 400 for an invalid status value', async () => {
    const id = seedDeliverable({ workspaceId: wsA });

    const res = await patchJson(`/api/brand-identity/${wsA}/${id}`, {
      status: 'in_review', // not a valid enum value
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 404 for a nonexistent deliverable id', async () => {
    const res = await patchJson(`/api/brand-identity/${wsA}/bid_does_not_exist`, {
      status: 'approved',
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('workspace isolation: PATCH via wsB for a wsA deliverable returns 404', async () => {
    const id = seedDeliverable({ workspaceId: wsA, content: 'wsA content.' });

    // Request routed through wsB's path — deliverable belongs to wsA
    const res = await patchJson(`/api/brand-identity/${wsB}/${id}`, {
      content: 'Should not update.',
    });

    expect(res.status).toBe(404);
  });

  it('broadcasts BRAND_IDENTITY_UPDATED after a successful PATCH', async () => {
    const id = seedDeliverable({ workspaceId: wsA });
    broadcastState.calls.length = 0;

    const res = await patchJson(`/api/brand-identity/${wsA}/${id}`, {
      status: 'approved',
    });

    expect(res.status).toBe(200);
    const relevant = broadcastState.calls.filter(
      c => c.workspaceId === wsA && c.event === 'brand-identity:updated',
    );
    expect(relevant.length).toBeGreaterThanOrEqual(1);
    const payload = relevant[0].payload as { deliverableId: string };
    expect(payload.deliverableId).toBe(id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Brand Identity — GET /api/brand-identity/:workspaceId/export
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brand-identity/:workspaceId/export', () => {
  it('returns markdown with approved deliverable content', async () => {
    // Use a separate workspace to avoid type-counter conflicts with the PATCH suite
    const exportWs = createWorkspace('Brand Export WS lifecycle');
    try {
      seedDeliverable({
        workspaceId: exportWs.id,
        deliverableType: 'vision',
        content: 'Our long-term vision statement.',
        status: 'approved',
      });

      const res = await api(`/api/brand-identity/${exportWs.id}/export`);

      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('text/markdown');

      const text = await res.text();
      expect(text).toContain('Our long-term vision statement.');
    } finally {
      db.prepare('DELETE FROM brand_identity_deliverables WHERE workspace_id = ?').run(exportWs.id);
      deleteWorkspace(exportWs.id);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Anomalies lifecycle
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/anomalies/:workspaceId — empty workspace', () => {
  it('returns 200 with an empty array for a fresh workspace', async () => {
    const freshWs = createWorkspace('Anomalies Fresh WS lifecycle');
    try {
      const res = await api(`/api/anomalies/${freshWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });
});

describe('GET /api/anomalies/:workspaceId — seeded data', () => {
  it('returns seeded anomalies for the workspace', async () => {
    const id1 = seedAnomaly({ workspaceId: wsA, type: 'traffic_drop' });
    const id2 = seedAnomaly({ workspaceId: wsA, type: 'ctr_drop' });

    try {
      const res = await api(`/api/anomalies/${wsA}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{ id: string }>;
      const ids = body.map(a => a.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    } finally {
      db.prepare('DELETE FROM anomalies WHERE id IN (?, ?)').run(id1, id2);
    }
  });
});

describe('POST /api/anomalies/:anomalyId/dismiss', () => {
  it('returns 200 and marks the anomaly as dismissed', async () => {
    const id = seedAnomaly({ workspaceId: wsA });
    try {
      const res = await postJson(`/api/anomalies/${id}/dismiss`, {});
      expect(res.status).toBe(200);
      const body = await res.json() as { dismissed: boolean };
      expect(body.dismissed).toBe(true);

      // Verify DB state
      const row = db.prepare('SELECT dismissed_at FROM anomalies WHERE id = ?').get(id) as
        | { dismissed_at: string | null }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.dismissed_at).not.toBeNull();
    } finally {
      db.prepare('DELETE FROM anomalies WHERE id = ?').run(id);
    }
  });

  it('dismissed anomaly no longer appears in workspace GET (default excludes dismissed)', async () => {
    const id = seedAnomaly({ workspaceId: wsA });
    try {
      // Confirm it appears before dismissal
      const before = await api(`/api/anomalies/${wsA}`);
      const beforeBody = await before.json() as Array<{ id: string }>;
      expect(beforeBody.some(a => a.id === id)).toBe(true);

      // Dismiss it
      await postJson(`/api/anomalies/${id}/dismiss`, {});

      // Should no longer appear in the default (non-dismissed) list
      const after = await api(`/api/anomalies/${wsA}`);
      const afterBody = await after.json() as Array<{ id: string }>;
      expect(afterBody.some(a => a.id === id)).toBe(false);
    } finally {
      db.prepare('DELETE FROM anomalies WHERE id = ?').run(id);
    }
  });

  it('returns 404 for a nonexistent anomaly id', async () => {
    const res = await postJson('/api/anomalies/anm_does_not_exist_ever/dismiss', {});
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Anomaly not found');
  });
});

describe('POST /api/anomalies/:anomalyId/acknowledge', () => {
  it('returns 200 and marks the anomaly as acknowledged', async () => {
    const id = seedAnomaly({ workspaceId: wsA });
    try {
      const res = await postJson(`/api/anomalies/${id}/acknowledge`, {});
      expect(res.status).toBe(200);
      const body = await res.json() as { acknowledged: boolean };
      expect(body.acknowledged).toBe(true);

      // Verify DB state
      const row = db.prepare('SELECT acknowledged_at FROM anomalies WHERE id = ?').get(id) as
        | { acknowledged_at: string | null }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.acknowledged_at).not.toBeNull();
    } finally {
      db.prepare('DELETE FROM anomalies WHERE id = ?').run(id);
    }
  });

  it('acknowledged anomaly still appears in workspace GET (not hidden like dismissed)', async () => {
    const id = seedAnomaly({ workspaceId: wsA });
    try {
      await postJson(`/api/anomalies/${id}/acknowledge`, {});

      // Acknowledged anomalies are NOT dismissed — they should still appear
      const res = await api(`/api/anomalies/${wsA}`);
      const body = await res.json() as Array<{ id: string; acknowledgedAt?: string }>;
      const found = body.find(a => a.id === id);
      expect(found).toBeDefined();
      // The returned anomaly should have acknowledgedAt populated
      expect(found!.acknowledgedAt).toBeTruthy();
    } finally {
      db.prepare('DELETE FROM anomalies WHERE id = ?').run(id);
    }
  });

  it('returns 404 for a nonexistent anomaly id', async () => {
    const res = await postJson('/api/anomalies/anm_does_not_exist_ever/acknowledge', {});
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Anomaly not found');
  });
});

describe('GET /api/public/anomalies/:workspaceId — requires portal auth', () => {
  // Behavior change 2026-05-27 (sprint-platform-health-wave8 Plan A Task 1):
  // the endpoint moved from "no auth required" to
  // `requireAuthenticatedClientPortalAuth`, which rejects passwordless
  // workspaces. This test now asserts the auth gate engages.
  it('returns 401 without authentication headers', async () => {
    const id = seedAnomaly({ workspaceId: wsA });
    try {
      const res = await api(`/api/public/anomalies/${wsA}`, { headers: { 'x-no-auto-public-auth': 'true' } });
      expect(res.status).toBe(401);
    } finally {
      db.prepare('DELETE FROM anomalies WHERE id = ?').run(id);
    }
  });
});

describe('GET /api/anomalies — global admin list', () => {
  it('returns all anomalies across workspaces as an array', async () => {
    const idA = seedAnomaly({ workspaceId: wsA });
    const idB = seedAnomaly({ workspaceId: wsB });
    try {
      const res = await api('/api/anomalies');
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{ id: string }>;
      expect(Array.isArray(body)).toBe(true);
      const ids = body.map(a => a.id);
      expect(ids).toContain(idA);
      expect(ids).toContain(idB);
    } finally {
      db.prepare('DELETE FROM anomalies WHERE id IN (?, ?)').run(idA, idB);
    }
  });
});

describe('Workspace isolation — anomaly list', () => {
  it('anomalies from wsA are not visible in wsB GET, and vice versa', async () => {
    const idA = seedAnomaly({ workspaceId: wsA, type: 'bounce_spike' });
    const idB = seedAnomaly({ workspaceId: wsB, type: 'impressions_drop' });
    try {
      const [resA, resB] = await Promise.all([
        api(`/api/anomalies/${wsA}`),
        api(`/api/anomalies/${wsB}`),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const bodyA = await resA.json() as Array<{ id: string }>;
      const bodyB = await resB.json() as Array<{ id: string }>;

      const idsA = bodyA.map(a => a.id);
      const idsB = bodyB.map(a => a.id);

      expect(idsA).not.toContain(idB);
      expect(idsB).not.toContain(idA);
    } finally {
      db.prepare('DELETE FROM anomalies WHERE id IN (?, ?)').run(idA, idB);
    }
  });
});
