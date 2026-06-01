/**
 * Integration test for FIX H — content delivery/publish enqueues the debounced
 * post-update follow-ons (recommendation regen + llms.txt) when it makes a target
 * page live.
 *
 * PATCH /api/content-requests/:workspaceId/:id transitioning to 'delivered' or
 * 'published' with a targetPageId writes live page state. A live page change alters
 * the page inventory the recommendation engine ranks on, so the route calls
 * queueKeywordStrategyPostUpdateFollowOns({ workspaceId }) (the same mechanism
 * content-publish.ts + keyword-strategy paths use). When there is no targetPageId,
 * no page goes live, so the follow-on must NOT fire.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const followOnState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string }>,
}));

vi.mock('../../server/keyword-strategy-follow-ons.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/keyword-strategy-follow-ons.js')>();
  return {
    ...actual,
    queueKeywordStrategyPostUpdateFollowOns: vi.fn((opts: { workspaceId: string }) => {
      followOnState.calls.push({ workspaceId: opts.workspaceId });
    }),
  };
});

// The in-process createApp() server never calls setBroadcast(); the content-requests
// route broadcasts CONTENT_REQUEST_UPDATE, so stub broadcast to a no-op.
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
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

import {
  createContentRequest,
  updateContentRequest,
} from '../../server/content-requests.js';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
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

async function patchJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Seed a request and advance it to in_progress (the state delivered is reachable from). */
function seedInProgress(workspaceId: string, targetPageId?: string): string {
  const req = createContentRequest(workspaceId, {
    topic: `Delivery Followon Test ${unique('topic')}`,
    targetKeyword: unique('keyword'),
    intent: 'informational',
    priority: 'medium',
    rationale: 'Follow-on regression test',
    initialStatus: 'requested',
    targetPageId,
    dedupe: false,
  });
  for (const s of ['brief_generated', 'client_review', 'approved', 'in_progress']) {
    updateContentRequest(workspaceId, req.id, { status: s });
  }
  return req.id;
}

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace('Content Delivery Follow-on Test').id;
}, 25_000);

beforeEach(() => {
  followOnState.calls = [];
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
});

afterAll(async () => {
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

describe('content delivery/publish enqueues post-update follow-ons', () => {
  it('delivered WITH a targetPageId enqueues queueKeywordStrategyPostUpdateFollowOns', async () => {
    const id = seedInProgress(wsId, 'wf-target-page-001');

    const res = await patchJson(`/api/content-requests/${wsId}/${id}`, { status: 'delivered' });
    expect(res.status).toBe(200);

    expect(followOnState.calls).toEqual([{ workspaceId: wsId }]);
  });

  it('published WITH a targetPageId enqueues the follow-on', async () => {
    const id = seedInProgress(wsId, 'wf-target-page-002');
    // delivered first (publish is reachable from delivered)
    await patchJson(`/api/content-requests/${wsId}/${id}`, { status: 'delivered' });
    followOnState.calls = [];

    const res = await patchJson(`/api/content-requests/${wsId}/${id}`, { status: 'published' });
    expect(res.status).toBe(200);

    expect(followOnState.calls).toEqual([{ workspaceId: wsId }]);
  });

  it('delivered WITHOUT a targetPageId does NOT enqueue the follow-on (no page went live)', async () => {
    const id = seedInProgress(wsId, undefined);

    const res = await patchJson(`/api/content-requests/${wsId}/${id}`, { status: 'delivered' });
    expect(res.status).toBe(200);

    expect(followOnState.calls).toHaveLength(0);
  });
});
