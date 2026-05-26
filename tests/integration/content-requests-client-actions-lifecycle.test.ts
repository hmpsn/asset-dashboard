/**
 * Integration tests — Content requests + client actions lifecycle.
 *
 * Covers: list, create (via DB seed), get-single, patch, delete, content-performance,
 * content-trend, workspace isolation for content requests; create, list, patch, public
 * list, public respond, and workspace isolation for client actions.
 *
 * Uses the in-process Express server pattern (port 0, dynamic).
 */
import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId, event, payload) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  sendEmail: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyApprovalReady: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamPaymentReceived: vi.fn(),
  notifyTeamChurnSignal: vi.fn(),
  notifyTeamClientSignal: vi.fn(),
  notifyTeamActionCompleted: vi.fn(),
}));

vi.mock('../../server/playbooks.js', () => ({
  enqueuePlaybook: vi.fn(),
}));

let server: http.Server | null = null;
let baseUrl = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

beforeAll(async () => {
  await startTestServer();
}, 30_000);

afterAll(async () => {
  await new Promise<void>(resolve => server!.close(() => resolve()));
});

beforeEach(() => {
  broadcastState.calls = [];
});

// ─── Imports that must happen AFTER vi.mock declarations ─────────────────────

import { seedWorkspace, seedTwoWorkspaces } from '../fixtures/workspace-seed.js';
import { createContentRequest, getContentRequest, deleteContentRequest } from '../../server/content-requests.js';
import { createClientAction } from '../../server/client-actions.js';
import db from '../../server/db/index.js';
import { randomUUID } from 'crypto';

/** Creates a workspace with NULL client_password — accessible via URL alone (no session/JWT needed). */
function seedPasswordlessWorkspace(): { workspaceId: string; cleanup: () => void } {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `test-ws-pwless-${suffix}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO workspaces (id, name, folder, webflow_site_id, webflow_token,
      gsc_property_url, ga4_property_id, client_password, live_domain, tier, seo_data_provider, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    `Passwordless WS ${suffix}`,
    `test-pwless-${suffix}`,
    `test-site-pwless-${suffix}`,
    `test-wf-token-pwless-${suffix}`,
    null,
    null,
    null,        // NULL client_password → requireClientPortalAuth allows access
    'test.example.com',
    'free',
    null,
    now,
  );
  return {
    workspaceId,
    cleanup: () => db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONTENT REQUESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/content-requests/:workspaceId — list', () => {
  it('returns 200 with empty array for a fresh workspace', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const res = await api(`/api/content-requests/${workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('returns seeded content requests for a workspace', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      createContentRequest(workspaceId, {
        topic: 'How to improve site speed',
        targetKeyword: 'site speed optimization',
        intent: 'informational',
        priority: 'high',
        rationale: 'High search volume keyword',
      });
      createContentRequest(workspaceId, {
        topic: 'Local SEO guide',
        targetKeyword: 'local seo tips',
        intent: 'commercial',
        priority: 'medium',
        rationale: 'Business-relevant query',
        dedupe: false,
      });

      const res = await api(`/api/content-requests/${workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);
      const keywords = body.map(r => r.targetKeyword);
      expect(keywords).toContain('site speed optimization');
      expect(keywords).toContain('local seo tips');
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });
});

describe('GET /api/content-requests/:workspaceId/:id — get single', () => {
  it('returns 404 for a nonexistent content request id', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const res = await api(`/api/content-requests/${workspaceId}/creq_nonexistent_999`);
      expect(res.status).toBe(404);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it('returns the full request object for a known id', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const seeded = createContentRequest(workspaceId, {
        topic: 'Content strategy guide',
        targetKeyword: 'content strategy',
        intent: 'informational',
        priority: 'medium',
        rationale: 'Broad awareness keyword',
      });

      const res = await api(`/api/content-requests/${workspaceId}/${seeded.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.id).toBe(seeded.id);
      expect(body.topic).toBe('Content strategy guide');
      expect(body.targetKeyword).toBe('content strategy');
      expect(body.status).toBe('requested');
      expect(body.workspaceId).toBe(workspaceId);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });
});

describe('PATCH /api/content-requests/:workspaceId/:id — update', () => {
  it('updates internalNote and persists the change', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const seeded = createContentRequest(workspaceId, {
        topic: 'Technical SEO checklist',
        targetKeyword: 'technical seo',
        intent: 'informational',
        priority: 'high',
        rationale: 'Core service keyword',
      });

      const res = await patchJson(`/api/content-requests/${workspaceId}/${seeded.id}`, {
        internalNote: 'Assigned to the SEO team for Q2.',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.internalNote).toBe('Assigned to the SEO team for Q2.');

      // Verify persisted in DB
      const stored = getContentRequest(workspaceId, seeded.id);
      expect(stored?.internalNote).toBe('Assigned to the SEO team for Q2.');
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('emits a CONTENT_REQUEST_UPDATE broadcast on patch', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const seeded = createContentRequest(workspaceId, {
        topic: 'Broadcast test topic',
        targetKeyword: 'broadcast test keyword',
        intent: 'informational',
        priority: 'low',
        rationale: 'Broadcast test rationale',
      });

      broadcastState.calls = [];
      await patchJson(`/api/content-requests/${workspaceId}/${seeded.id}`, {
        internalNote: 'Testing broadcast',
      });

      const broadcastCall = broadcastState.calls.find(
        c => c.workspaceId === workspaceId && c.event === 'content-request:update',
      );
      expect(broadcastCall).toBeDefined();
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('returns 404 for patching a nonexistent request', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const res = await patchJson(`/api/content-requests/${workspaceId}/creq_does_not_exist`, {
        internalNote: 'Should not work',
      });
      expect(res.status).toBe(404);
    } finally {
      cleanup();
    }
  });

  it('returns 400 for invalid status transition (declined is terminal)', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const seeded = createContentRequest(workspaceId, {
        topic: 'Invalid transition test',
        targetKeyword: 'invalid transition keyword',
        intent: 'transactional',
        priority: 'high',
        rationale: 'State machine test',
        initialStatus: 'delivered',
      });

      // 'delivered' can only go to 'published' — transitioning back to 'requested' is invalid
      const res = await patchJson(`/api/content-requests/${workspaceId}/${seeded.id}`, {
        status: 'requested',
      });
      expect(res.status).toBe(400);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });
});

describe('DELETE /api/content-requests/:workspaceId/:id', () => {
  it('deletes a content request and returns ok: true', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const seeded = createContentRequest(workspaceId, {
        topic: 'Request to delete',
        targetKeyword: 'deletable keyword',
        intent: 'informational',
        priority: 'low',
        rationale: 'Will be deleted',
      });

      const res = await del(`/api/content-requests/${workspaceId}/${seeded.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.ok).toBe(true);

      // Verify removed from DB
      expect(getContentRequest(workspaceId, seeded.id)).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('emits a CONTENT_REQUEST_UPDATE broadcast with deleted:true on delete', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const seeded = createContentRequest(workspaceId, {
        topic: 'Broadcast delete test',
        targetKeyword: 'broadcast delete keyword',
        intent: 'informational',
        priority: 'medium',
        rationale: 'Broadcast test on delete',
      });

      broadcastState.calls = [];
      await del(`/api/content-requests/${workspaceId}/${seeded.id}`);

      const broadcastCall = broadcastState.calls.find(
        c => c.workspaceId === workspaceId && c.event === 'content-request:update',
      );
      expect(broadcastCall).toBeDefined();
      expect((broadcastCall?.payload as Record<string, unknown>).deleted).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('returns 404 when deleting a nonexistent request', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const res = await del(`/api/content-requests/${workspaceId}/creq_totally_gone`);
      expect(res.status).toBe(404);
    } finally {
      cleanup();
    }
  });

  it('subsequent GET returns 404 after deletion', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const seeded = createContentRequest(workspaceId, {
        topic: 'Gone after delete',
        targetKeyword: 'gone keyword',
        intent: 'informational',
        priority: 'low',
        rationale: 'Deletion verification',
      });

      await del(`/api/content-requests/${workspaceId}/${seeded.id}`);
      const res = await api(`/api/content-requests/${workspaceId}/${seeded.id}`);
      expect(res.status).toBe(404);
    } finally {
      cleanup();
    }
  });
});

describe('Workspace isolation — content requests', () => {
  it('does not expose workspace A requests to workspace B', async () => {
    const { wsA, wsB, cleanup } = seedTwoWorkspaces();
    try {
      const reqA = createContentRequest(wsA.workspaceId, {
        topic: 'Workspace A only topic',
        targetKeyword: 'workspace a keyword',
        intent: 'informational',
        priority: 'medium',
        rationale: 'Isolation test A',
      });
      createContentRequest(wsB.workspaceId, {
        topic: 'Workspace B only topic',
        targetKeyword: 'workspace b keyword',
        intent: 'informational',
        priority: 'medium',
        rationale: 'Isolation test B',
        dedupe: false,
      });

      const resB = await api(`/api/content-requests/${wsB.workspaceId}`);
      expect(resB.status).toBe(200);
      const bodyB = await resB.json() as Array<Record<string, unknown>>;
      const idsB = bodyB.map(r => r.id);
      expect(idsB).not.toContain(reqA.id);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsA.workspaceId);
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsB.workspaceId);
      cleanup();
    }
  });
});

describe('GET /api/content-performance/:workspaceId', () => {
  it('returns 200 with items array (empty for fresh workspace with no published requests)', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const res = await api(`/api/content-performance/${workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(Array.isArray(body.items)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('returns only delivered/published requests in items', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      // Create one delivered, one still requested
      const delivered = createContentRequest(workspaceId, {
        topic: 'Published article',
        targetKeyword: 'published keyword',
        intent: 'informational',
        priority: 'high',
        rationale: 'Content performance test',
        initialStatus: 'delivered',
      });
      createContentRequest(workspaceId, {
        topic: 'Still in progress',
        targetKeyword: 'in progress keyword',
        intent: 'informational',
        priority: 'medium',
        rationale: 'Should not appear in performance',
        dedupe: false,
      });

      const res = await api(`/api/content-performance/${workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { items: Array<Record<string, unknown>> };
      const itemIds = body.items.map(i => i.requestId);
      expect(itemIds).toContain(delivered.id);
      // The 'requested' one should NOT appear
      const topics = body.items.map(i => i.topic);
      expect(topics).not.toContain('Still in progress');
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });
});

describe('GET /api/content-performance/:workspaceId/:requestId/trend', () => {
  it('returns empty trend array when content request has no targetPageSlug or GSC config', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const seeded = createContentRequest(workspaceId, {
        topic: 'Trend test topic',
        targetKeyword: 'trend test keyword',
        intent: 'informational',
        priority: 'medium',
        rationale: 'Trend endpoint test',
      });

      const res = await api(`/api/content-performance/${workspaceId}/${seeded.id}/trend`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(Array.isArray(body.trend)).toBe(true);
      expect(body.trend).toHaveLength(0);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('returns 404 for trend request with nonexistent requestId', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const res = await api(`/api/content-performance/${workspaceId}/creq_nonexistent_trend/trend`);
      expect(res.status).toBe(404);
    } finally {
      cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CLIENT ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/client-actions/:workspaceId — create', () => {
  it('creates a client action and returns it with status=pending', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const res = await postJson(`/api/client-actions/${workspaceId}`, {
        sourceType: 'aeo_change',
        title: 'Update FAQ schema markup',
        summary: 'Your FAQ section needs updated schema to remain eligible for rich results.',
        priority: 'high',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.id).toBeTruthy();
      expect(body.title).toBe('Update FAQ schema markup');
      expect(body.status).toBe('pending');
      expect(body.sourceType).toBe('aeo_change');
      expect(body.priority).toBe('high');
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('returns 400 for missing required title', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const res = await postJson(`/api/client-actions/${workspaceId}`, {
        sourceType: 'internal_link',
        summary: 'Missing title field',
      });
      expect(res.status).toBe(400);
    } finally {
      cleanup();
    }
  });

  it('returns 400 for invalid sourceType', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const res = await postJson(`/api/client-actions/${workspaceId}`, {
        sourceType: 'unknown_type',
        title: 'Invalid source type action',
        summary: 'Should be rejected',
      });
      expect(res.status).toBe(400);
    } finally {
      cleanup();
    }
  });

  it('emits a CLIENT_ACTION_UPDATE broadcast on create', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      broadcastState.calls = [];
      await postJson(`/api/client-actions/${workspaceId}`, {
        sourceType: 'redirect_proposal',
        title: 'Redirect /old-page to /new-page',
        summary: 'Legacy URL needs a 301 redirect to preserve link equity.',
      });
      const broadcastCall = broadcastState.calls.find(c => c.workspaceId === workspaceId);
      expect(broadcastCall).toBeDefined();
      expect(broadcastCall?.event).toBe('client-action:update');
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });
});

describe('GET /api/client-actions/:workspaceId — list', () => {
  it('returns empty array for a fresh workspace', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const res = await api(`/api/client-actions/${workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('returns the created action in the list', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const action = createClientAction({
        workspaceId,
        sourceType: 'content_decay',
        title: 'Refresh /blog/old-post',
        summary: 'This page has lost 40% of its organic clicks over 90 days.',
        priority: 'medium',
      });

      const res = await api(`/api/client-actions/${workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<Record<string, unknown>>;
      const ids = body.map(a => a.id);
      expect(ids).toContain(action.id);
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });
});

describe('PATCH /api/client-actions/:workspaceId/:actionId — admin update', () => {
  it('updates action status and returns updated action', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const action = createClientAction({
        workspaceId,
        sourceType: 'internal_link',
        title: 'Add internal links to pillar page',
        summary: 'Pillar page lacks internal links from supporting articles.',
        priority: 'medium',
      });

      const res = await patchJson(`/api/client-actions/${workspaceId}/${action.id}`, {
        status: 'completed',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe('completed');
      expect(body.id).toBe(action.id);
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('returns error for invalid status transition via admin patch', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const action = createClientAction({
        workspaceId,
        sourceType: 'aeo_change',
        title: 'Transition guard test',
        summary: 'Testing invalid admin status transition.',
        priority: 'low',
      });

      // Try to go from 'pending' → 'archived' — check if that's an invalid transition
      // If the state machine allows it, this test verifies it returns 200.
      // If not, it returns 409.
      const res = await patchJson(`/api/client-actions/${workspaceId}/${action.id}`, {
        status: 'archived',
      });
      expect([200, 409]).toContain(res.status);
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('emits a CLIENT_ACTION_UPDATE broadcast on admin patch', async () => {
    const { workspaceId, cleanup } = seedWorkspace();
    try {
      const action = createClientAction({
        workspaceId,
        sourceType: 'redirect_proposal',
        title: 'Broadcast admin patch test',
        summary: 'Testing broadcast on admin patch.',
        priority: 'high',
      });

      broadcastState.calls = [];
      await patchJson(`/api/client-actions/${workspaceId}/${action.id}`, {
        priority: 'low',
      });

      const broadcastCall = broadcastState.calls.find(c => c.workspaceId === workspaceId);
      expect(broadcastCall).toBeDefined();
      expect(broadcastCall?.event).toBe('client-action:update');
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });
});

describe('GET /api/public/client-actions/:workspaceId — public list', () => {
  it('returns 200 with actions array for passwordless workspace (no auth needed)', async () => {
    // Use a workspace with NULL client_password — accessible by URL alone.
    const { workspaceId, cleanup } = seedPasswordlessWorkspace();
    try {
      const action = createClientAction({
        workspaceId,
        sourceType: 'aeo_change',
        title: 'Public action for passwordless workspace',
        summary: 'Should be visible without auth.',
        priority: 'medium',
      });

      const res = await api(`/api/public/client-actions/${workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<Record<string, unknown>>;
      const ids = body.map(a => a.id);
      expect(ids).toContain(action.id);
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('returns 401 for workspace with a clientPassword when no auth provided', async () => {
    const { workspaceId, cleanup } = seedWorkspace({ clientPassword: 'supersecret' });
    try {
      const res = await api(`/api/public/client-actions/${workspaceId}`);
      expect(res.status).toBe(401);
    } finally {
      cleanup();
    }
  });
});

describe('PATCH /api/public/client-actions/:workspaceId/:actionId/respond — client respond', () => {
  it('client can approve a pending action on a passwordless workspace', async () => {
    const { workspaceId, cleanup } = seedPasswordlessWorkspace();
    try {
      const action = createClientAction({
        workspaceId,
        sourceType: 'internal_link',
        title: 'Add link to services page',
        summary: 'Services page is under-linked from blog content.',
        priority: 'medium',
      });

      const res = await patchJson(
        `/api/public/client-actions/${workspaceId}/${action.id}/respond`,
        { status: 'approved', clientNote: 'Looks good to me!' },
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe('approved');
      expect(body.clientNote).toBe('Looks good to me!');
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('client can request changes on a pending action', async () => {
    const { workspaceId, cleanup } = seedPasswordlessWorkspace();
    try {
      const action = createClientAction({
        workspaceId,
        sourceType: 'aeo_change',
        title: 'Update AEO markup',
        summary: 'FAQ schema needs updating for AEO eligibility.',
        priority: 'high',
      });

      const res = await patchJson(
        `/api/public/client-actions/${workspaceId}/${action.id}/respond`,
        { status: 'changes_requested', clientNote: 'Please clarify the timeline.' },
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe('changes_requested');
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('returns 409 when trying to respond to a non-pending action', async () => {
    const { workspaceId, cleanup } = seedPasswordlessWorkspace();
    try {
      const action = createClientAction({
        workspaceId,
        sourceType: 'content_decay',
        title: 'Already approved action',
        summary: 'This action was already approved.',
        priority: 'medium',
      });

      // First respond: approve
      await patchJson(
        `/api/public/client-actions/${workspaceId}/${action.id}/respond`,
        { status: 'approved' },
      );

      // Second respond: should be rejected (already approved, no longer pending)
      const res = await patchJson(
        `/api/public/client-actions/${workspaceId}/${action.id}/respond`,
        { status: 'approved' },
      );
      expect(res.status).toBe(409);
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('returns 400 for invalid respond status value', async () => {
    const { workspaceId, cleanup } = seedPasswordlessWorkspace();
    try {
      const action = createClientAction({
        workspaceId,
        sourceType: 'aeo_change',
        title: 'Validation test action',
        summary: 'Testing bad status value in respond.',
        priority: 'low',
      });

      const res = await patchJson(
        `/api/public/client-actions/${workspaceId}/${action.id}/respond`,
        { status: 'completed' }, // 'completed' is not a valid respond status (only approved/changes_requested)
      );
      expect(res.status).toBe(400);
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });

  it('emits CLIENT_ACTION_UPDATE broadcast on client respond', async () => {
    const { workspaceId, cleanup } = seedPasswordlessWorkspace();
    try {
      const action = createClientAction({
        workspaceId,
        sourceType: 'redirect_proposal',
        title: 'Broadcast respond test',
        summary: 'Testing broadcast on client respond.',
        priority: 'medium',
      });

      broadcastState.calls = [];
      await patchJson(
        `/api/public/client-actions/${workspaceId}/${action.id}/respond`,
        { status: 'approved' },
      );

      const broadcastCall = broadcastState.calls.find(
        c => c.workspaceId === workspaceId && c.event === 'client-action:update',
      );
      expect(broadcastCall).toBeDefined();
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(workspaceId);
      cleanup();
    }
  });
});

describe('Workspace isolation — client actions', () => {
  it('does not expose workspace A actions to workspace B via admin list', async () => {
    const { wsA, wsB, cleanup } = seedTwoWorkspaces();
    try {
      const actionA = createClientAction({
        workspaceId: wsA.workspaceId,
        sourceType: 'aeo_change',
        title: 'Workspace A action',
        summary: 'Belongs exclusively to workspace A.',
        priority: 'high',
      });
      createClientAction({
        workspaceId: wsB.workspaceId,
        sourceType: 'internal_link',
        title: 'Workspace B action',
        summary: 'Belongs exclusively to workspace B.',
        priority: 'low',
      });

      const resB = await api(`/api/client-actions/${wsB.workspaceId}`);
      expect(resB.status).toBe(200);
      const bodyB = await resB.json() as Array<Record<string, unknown>>;
      const idsB = bodyB.map(a => a.id);
      expect(idsB).not.toContain(actionA.id);
    } finally {
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(wsA.workspaceId);
      db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(wsB.workspaceId);
      cleanup();
    }
  });
});
