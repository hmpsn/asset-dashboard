/**
 * Integration tests: notification payload correctness for content request
 * approval and changes-requested actions via the public client portal.
 *
 * The existing public-content-request-workflow-broadcasts.test.ts verifies
 * that notifications fire (toHaveLength(1)) but does NOT verify payload
 * content. This file:
 *
 * 1. Verifies the full notifyTeamActionApproved payload for brief approval
 * 2. Verifies the full notifyTeamChangesRequested payload for brief changes
 * 3. Covers the entirely untested approve-post endpoint (post_review → delivered)
 *    including its notifyTeamActionApproved payload
 * 4. Covers the entirely untested request-post-changes endpoint
 *    including its notifyTeamChangesRequested payload
 * 5. Tests status-guard rejection for both post endpoints
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Hoisted state ─────────────────────────────────────────────────────────────

const emailState = vi.hoisted(() => ({
  actionApproved: [] as Array<{
    workspaceId: string;
    workspaceName: string;
    actionTitle: string;
    sourceType: string;
    actionSummary: string;
  }>,
  changesRequested: [] as Array<{
    workspaceName: string;
    workspaceId: string;
    topic: string;
    targetKeyword: string;
    feedback: string;
  }>,
}));

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

vi.mock('../../server/email.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return {
    ...actual,
    notifyTeamActionApproved: vi.fn((p: typeof emailState.actionApproved[0]) => {
      emailState.actionApproved.push(p);
    }),
    notifyTeamChangesRequested: vi.fn((p: typeof emailState.changesRequested[0]) => {
      emailState.changesRequested.push(p);
    }),
    notifyTeamContentRequest: vi.fn(),
  };
});

import { createContentRequest, updateContentRequest } from '../../server/content-requests.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

// ── Server setup ──────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
const wsName = 'ContentApprovalNotif-Test';
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

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

function makeRequest(keyword?: string) {
  return createContentRequest(wsId, {
    topic: `Test Topic ${Date.now()}`,
    targetKeyword: keyword ?? `kw-notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    intent: 'informational',
    priority: 'medium',
    rationale: 'notification payload regression test',
    serviceType: 'brief_only',
    initialStatus: 'brief_generated',
    dedupe: false,
  });
}

function advanceToClientReview(id: string) {
  return updateContentRequest(wsId, id, { status: 'client_review' })!;
}

function advanceToPostReview(id: string) {
  // brief_generated → client_review → approved → in_progress → post_review
  updateContentRequest(wsId, id, { status: 'client_review' });
  updateContentRequest(wsId, id, { status: 'approved' });
  updateContentRequest(wsId, id, { status: 'in_progress' });
  return updateContentRequest(wsId, id, { status: 'post_review' })!;
}

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace(wsName).id;
}, 30_000);

beforeEach(() => {
  emailState.actionApproved = [];
  emailState.changesRequested = [];
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
}, 30_000);

// ── Brief approval notification payload ──────────────────────────────────────

describe('POST .../approve — brief approval notification payload', () => {
  it('fires notifyTeamActionApproved with correct sourceType and title', async () => {
    const req = makeRequest('plumbing services near me');
    advanceToClientReview(req.id);

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/approve`, {});
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    const n = emailState.actionApproved[0];
    expect(n.workspaceId).toBe(wsId);
    expect(n.workspaceName).toBe(wsName);
    expect(n.sourceType).toBe('content_brief');
    expect(n.actionTitle).toBe(`Brief approved: ${req.topic}`);
    expect(n.actionSummary).toBe(`Keyword: plumbing services near me`);
  });

  it('broadcasts CONTENT_REQUEST_UPDATE with approved status', async () => {
    const req = makeRequest();
    advanceToClientReview(req.id);

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/approve`, {});
    expect(res.status).toBe(200);

    const updates = broadcastState.calls.filter(c => c.event === WS_EVENTS.CONTENT_REQUEST_UPDATE);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ id: req.id, status: 'approved' });
  });

  it('rejects with 409 when request is not in client_review status', async () => {
    const req = makeRequest();
    // Still in brief_generated — not ready for client review

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/approve`, {});
    expect(res.status).toBe(409);
    expect(emailState.actionApproved).toHaveLength(0);
    // No CONTENT_REQUEST_UPDATE broadcast for this request
    const updates = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.CONTENT_REQUEST_UPDATE && (c.payload as { id?: string })?.id === req.id,
    );
    expect(updates).toHaveLength(0);
  });
});

// ── Brief changes requested notification payload ──────────────────────────────

describe('POST .../request-changes — brief changes notification payload', () => {
  it('fires notifyTeamChangesRequested with correct topic and feedback', async () => {
    const kw = `emergency plumber-${Date.now()}`;
    const req = makeRequest(kw);
    advanceToClientReview(req.id);

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/request-changes`, {
      feedback: 'Please include emergency service pricing information.',
    });
    expect(res.status).toBe(200);

    expect(emailState.changesRequested).toHaveLength(1);
    const n = emailState.changesRequested[0];
    expect(n.workspaceId).toBe(wsId);
    expect(n.workspaceName).toBe(wsName);
    expect(n.topic).toBe(req.topic);
    expect(n.targetKeyword).toBe(kw);
    expect(n.feedback).toBe('Please include emergency service pricing information.');
  });

  it('fires with empty string feedback when feedback is omitted', async () => {
    const req = makeRequest();
    advanceToClientReview(req.id);

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/request-changes`, {});
    expect(res.status).toBe(200);

    expect(emailState.changesRequested).toHaveLength(1);
    expect(emailState.changesRequested[0].feedback).toBe('');
  });

  it('does not fire when request is not in client_review status', async () => {
    const req = makeRequest();
    // Still in brief_generated

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/request-changes`, {
      feedback: 'Change this',
    });
    expect(res.status).toBe(409);
    expect(emailState.changesRequested).toHaveLength(0);
  });
});

// ── Post approval (approve-post) — untested endpoint ─────────────────────────

describe('POST .../approve-post — post approval notification', () => {
  it('fires notifyTeamActionApproved with sourceType content_post', async () => {
    const kw = `drain cleaning services-${Date.now()}`;
    const req = makeRequest(kw);
    advanceToPostReview(req.id);

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/approve-post`, {});
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    const n = emailState.actionApproved[0];
    expect(n.workspaceId).toBe(wsId);
    expect(n.workspaceName).toBe(wsName);
    expect(n.sourceType).toBe('content_post');
    expect(n.actionTitle).toBe(`Post approved: ${req.topic}`);
    expect(n.actionSummary).toBe(`Keyword: ${kw}`);
  });

  it('transitions request to delivered status', async () => {
    const req = makeRequest();
    advanceToPostReview(req.id);

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/approve-post`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('delivered');
  });

  it('broadcasts CONTENT_REQUEST_UPDATE with delivered status', async () => {
    const req = makeRequest();
    advanceToPostReview(req.id);

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/approve-post`, {});
    expect(res.status).toBe(200);

    const updates = broadcastState.calls.filter(c => c.event === WS_EVENTS.CONTENT_REQUEST_UPDATE);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ id: req.id, status: 'delivered' });
  });

  it('rejects with 400 when request is not in post_review status', async () => {
    const req = makeRequest();
    advanceToClientReview(req.id);
    // in client_review, not post_review

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/approve-post`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/post_review/);
    expect(emailState.actionApproved).toHaveLength(0);
  });

  it('does not fire notification when request does not exist', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}/req_ghost_9999/approve-post`, {});
    expect(res.status).toBe(404);
    expect(emailState.actionApproved).toHaveLength(0);
  });
});

// ── Post changes requested (request-post-changes) — untested endpoint ─────────

describe('POST .../request-post-changes — post changes notification', () => {
  it('fires notifyTeamChangesRequested with correct payload', async () => {
    const kw = `water heater repair-${Date.now()}`;
    const req = makeRequest(kw);
    advanceToPostReview(req.id);

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/request-post-changes`, {
      feedback: 'The post needs a pricing section.',
    });
    expect(res.status).toBe(200);

    expect(emailState.changesRequested).toHaveLength(1);
    const n = emailState.changesRequested[0];
    expect(n.workspaceId).toBe(wsId);
    expect(n.workspaceName).toBe(wsName);
    expect(n.topic).toBe(req.topic);
    expect(n.targetKeyword).toBe(kw);
    expect(n.feedback).toBe('The post needs a pricing section.');
  });

  it('transitions request to changes_requested status', async () => {
    const req = makeRequest();
    advanceToPostReview(req.id);

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/request-post-changes`, {
      feedback: 'Needs more examples.',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; clientFeedback: string };
    expect(body.status).toBe('changes_requested');
    expect(body.clientFeedback).toBe('Needs more examples.');
  });

  it('broadcasts CONTENT_REQUEST_UPDATE with changes_requested status', async () => {
    const req = makeRequest();
    advanceToPostReview(req.id);

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/request-post-changes`, {
      feedback: 'Add a FAQ section.',
    });
    expect(res.status).toBe(200);

    const updates = broadcastState.calls.filter(c => c.event === WS_EVENTS.CONTENT_REQUEST_UPDATE);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ id: req.id, status: 'changes_requested' });
  });

  it('rejects with 400 when request is not in post_review status', async () => {
    const req = makeRequest();
    advanceToClientReview(req.id);
    // in client_review, not post_review

    const res = await postJson(`/api/public/content-request/${wsId}/${req.id}/request-post-changes`, {
      feedback: 'Some changes',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/post_review/);
    expect(emailState.changesRequested).toHaveLength(0);
  });

  it('does not fire notification when request does not exist', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}/req_ghost_8888/request-post-changes`, {
      feedback: 'Some feedback',
    });
    expect(res.status).toBe(404);
    expect(emailState.changesRequested).toHaveLength(0);
  });
});
