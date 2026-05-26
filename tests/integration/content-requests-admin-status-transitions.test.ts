/**
 * Integration tests for PATCH /api/content-requests/:workspaceId/:id
 *
 * Covers:
 *  - Each individual status transition (valid and invalid)
 *  - Field update responses (deliveryUrl, briefId, clientFeedback, notes)
 *  - Broadcast shape after status change vs. non-status-only update
 *  - Workspace isolation (cross-workspace PATCH returns 404, list returns own data only)
 *
 * Port: 13854
 * Avoid duplication with content-request-mutation-safety.test.ts (full lifecycle,
 * post_review auto-populate, page-state write, delete, public endpoints).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Mock broadcast & email before any server import ────────────────────────

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  notifyApprovalReady: vi.fn(),
  notifyClientAuditComplete: vi.fn(),
  notifyClientBriefingReady: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientFixesApplied: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientRecommendationsReady: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyClientTeamResponse: vi.fn(),
  notifyClientWelcome: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamChurnSignal: vi.fn(),
  notifyTeamClientSignal: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyTeamPaymentReceived: vi.fn(),
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
}));

// ── Server imports (must come after mocks) ──────────────────────────────────

import {
  createContentRequest,
  updateContentRequest,
  getContentRequest,
} from '../../server/content-requests.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

// ── Server setup ────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsAId = '';
let wsBId = '';
const originalAppPassword = process.env.APP_PASSWORD;

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

async function patchJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getJson(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

// ── Seed helpers ────────────────────────────────────────────────────────────

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Create a content request and advance it to the given status using direct DB
 * calls (bypasses HTTP so we don't depend on the API for fixture setup).
 */
function seedRequest(
  workspaceId: string,
  targetStatus: string = 'requested',
): { id: string } {
  const req = createContentRequest(workspaceId, {
    topic: `Status Transition Test ${unique(targetStatus)}`,
    targetKeyword: unique('keyword'),
    intent: 'informational',
    priority: 'medium',
    rationale: 'Status transition regression test',
    initialStatus: 'requested',
    dedupe: false,
  });

  const pipeline: string[] = [];
  switch (targetStatus) {
    case 'brief_generated': pipeline.push('brief_generated'); break;
    case 'client_review':   pipeline.push('brief_generated', 'client_review'); break;
    case 'approved':        pipeline.push('brief_generated', 'client_review', 'approved'); break;
    case 'in_progress':     pipeline.push('brief_generated', 'client_review', 'approved', 'in_progress'); break;
    case 'delivered':
      pipeline.push('brief_generated', 'client_review', 'approved', 'in_progress');
      // Skip post_review (requires a linked post); jump directly to delivered which is allowed from in_progress
      pipeline.push('delivered');
      break;
    default: break;
  }

  for (const s of pipeline) {
    updateContentRequest(workspaceId, req.id, { status: s });
  }

  return { id: req.id };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsAId = createWorkspace('Content Request Status Transitions A').id;
  wsBId = createWorkspace('Content Request Status Transitions B').id;
}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PATCH /api/content-requests/:workspaceId/:id — status transitions', () => {
  it('requested → brief_generated: returns 200 with updated status in body', async () => {
    const { id } = seedRequest(wsAId, 'requested');

    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, { status: 'brief_generated' });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; status: string };
    expect(body.status).toBe('brief_generated');
    expect(body.id).toBe(id);
    expect(getContentRequest(wsAId, id)?.status).toBe('brief_generated');
  });

  it('brief_generated → client_review: returns 200 with updated status', async () => {
    const { id } = seedRequest(wsAId, 'brief_generated');

    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, { status: 'client_review' });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('client_review');
    expect(getContentRequest(wsAId, id)?.status).toBe('client_review');
  });

  it('client_review → approved: returns 200 with updated status', async () => {
    const { id } = seedRequest(wsAId, 'client_review');

    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, { status: 'approved' });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('approved');
    expect(getContentRequest(wsAId, id)?.status).toBe('approved');
  });

  it('approved → in_progress: returns 200 with updated status', async () => {
    const { id } = seedRequest(wsAId, 'approved');

    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, { status: 'in_progress' });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('in_progress');
    expect(getContentRequest(wsAId, id)?.status).toBe('in_progress');
  });

  it('in_progress → delivered: returns 200 with updated status (skips post_review for brief-only)', async () => {
    // in_progress → delivered is valid per CONTENT_REQUEST_TRANSITIONS (brief-only path)
    const { id } = seedRequest(wsAId, 'in_progress');

    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, { status: 'delivered' });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('delivered');
    expect(getContentRequest(wsAId, id)?.status).toBe('delivered');
  });

  it('delivered → published: returns 200 with updated status', async () => {
    const { id } = seedRequest(wsAId, 'delivered');

    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, { status: 'published' });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('published');
    expect(getContentRequest(wsAId, id)?.status).toBe('published');
  });

  it('invalid transition (published → in_progress) returns 400 with error message', async () => {
    // published is a terminal state — no outbound transitions
    const { id } = seedRequest(wsAId, 'delivered');
    updateContentRequest(wsAId, id, { status: 'published' });

    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, { status: 'in_progress' });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/invalid/i);
    // Status must remain unchanged
    expect(getContentRequest(wsAId, id)?.status).toBe('published');
  });

  it('unknown request id returns 404', async () => {
    const res = await patchJson(`/api/content-requests/${wsAId}/nonexistent_request_id`, {
      status: 'brief_generated',
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });
});

describe('PATCH /api/content-requests/:workspaceId/:id — field updates', () => {
  it('setting deliveryUrl updates and returns it in the response body', async () => {
    const { id } = seedRequest(wsAId, 'in_progress');
    // Advance to delivered so deliveryUrl is a meaningful field
    updateContentRequest(wsAId, id, { status: 'delivered' });
    broadcastState.calls = [];

    const deliveryUrl = 'https://example.com/delivered-content/page';
    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, { deliveryUrl });

    expect(res.status).toBe(200);
    const body = await res.json() as { deliveryUrl?: string };
    expect(body.deliveryUrl).toBe(deliveryUrl);
    expect(getContentRequest(wsAId, id)?.deliveryUrl).toBe(deliveryUrl);
  });

  it('setting briefId updates and is returned in the response body', async () => {
    const { id } = seedRequest(wsAId, 'requested');
    const briefId = `brief_test_${unique('id')}`;

    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, { briefId });

    expect(res.status).toBe(200);
    const body = await res.json() as { briefId?: string };
    expect(body.briefId).toBe(briefId);
    expect(getContentRequest(wsAId, id)?.briefId).toBe(briefId);
  });

  it('setting clientFeedback updates and is returned in the response body', async () => {
    const { id } = seedRequest(wsAId, 'client_review');
    const clientFeedback = 'Please add more examples to section 2.';

    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, { clientFeedback });

    expect(res.status).toBe(200);
    const body = await res.json() as { clientFeedback?: string };
    expect(body.clientFeedback).toBe(clientFeedback);
    expect(getContentRequest(wsAId, id)?.clientFeedback).toBe(clientFeedback);
  });

  it('partial update (internalNote only) does not change the status', async () => {
    const { id } = seedRequest(wsAId, 'approved');
    const before = getContentRequest(wsAId, id);

    const res = await patchJson(`/api/content-requests/${wsAId}/${id}`, {
      internalNote: 'Admin internal note added.',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    // Status must remain 'approved' — the field update must not cause a transition
    expect(body.status).toBe('approved');
    expect(getContentRequest(wsAId, id)?.status).toBe(before?.status);
  });
});

describe('PATCH /api/content-requests/:workspaceId/:id — broadcasts', () => {
  it('broadcasts CONTENT_REQUEST_UPDATE with { id, status } after a status change', async () => {
    const { id } = seedRequest(wsAId, 'requested');

    await patchJson(`/api/content-requests/${wsAId}/${id}`, { status: 'brief_generated' });

    const statusBroadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.CONTENT_REQUEST_UPDATE,
    );
    expect(statusBroadcasts).toHaveLength(1);
    expect(statusBroadcasts[0]).toEqual({
      workspaceId: wsAId,
      event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
      payload: { id, status: 'brief_generated' },
    });
  });

  it('still broadcasts CONTENT_REQUEST_UPDATE when only non-status fields are updated', async () => {
    // The server always broadcasts after a PATCH regardless of whether status
    // changed — this is by design so clients can refresh the full record.
    const { id } = seedRequest(wsAId, 'requested');
    const briefId = `brief_broadcast_${unique('id')}`;

    await patchJson(`/api/content-requests/${wsAId}/${id}`, { briefId });

    const broadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.CONTENT_REQUEST_UPDATE,
    );
    expect(broadcasts).toHaveLength(1);
    // The payload carries the current (unchanged) status
    expect(broadcasts[0].payload.id).toBe(id);
    expect(broadcasts[0].workspaceId).toBe(wsAId);
  });
});

describe('PATCH /api/content-requests/:workspaceId/:id — workspace isolation', () => {
  it('cannot PATCH a request from another workspace — returns 404', async () => {
    const { id } = seedRequest(wsAId, 'requested');

    // Attempt to PATCH wsA's request using wsBId in the URL
    const res = await patchJson(`/api/content-requests/${wsBId}/${id}`, {
      status: 'brief_generated',
    });

    expect(res.status).toBe(404);
    // The wsA record must be unmodified
    expect(getContentRequest(wsAId, id)?.status).toBe('requested');
    // No broadcasts should have been emitted
    expect(
      broadcastState.calls.filter(c => c.event === WS_EVENTS.CONTENT_REQUEST_UPDATE),
    ).toHaveLength(0);
  });

  it('GET /api/content-requests/:workspaceId lists only requests for that workspace', async () => {
    // Seed one request per workspace
    const { id: idA } = seedRequest(wsAId, 'requested');
    const { id: idB } = seedRequest(wsBId, 'requested');

    const [resA, resB] = await Promise.all([
      getJson(`/api/content-requests/${wsAId}`),
      getJson(`/api/content-requests/${wsBId}`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const listA = await resA.json() as Array<{ id: string }>;
    const listB = await resB.json() as Array<{ id: string }>;

    const idsA = new Set(listA.map(r => r.id));
    const idsB = new Set(listB.map(r => r.id));

    expect(idsA.has(idA)).toBe(true);
    expect(idsA.has(idB)).toBe(false);

    expect(idsB.has(idB)).toBe(true);
    expect(idsB.has(idA)).toBe(false);
  });
});
