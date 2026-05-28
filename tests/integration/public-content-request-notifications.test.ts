/**
 * Integration tests: notifyTeamContentRequest payload correctness for
 * the two public endpoints that fire this notification.
 *
 * The existing content-request-mutation-safety.test.ts captures that these
 * notifications fire (toHaveLength(1)) but does NOT verify payload content.
 * This file verifies the full payload:
 *   workspaceName, workspaceId, topic, targetKeyword, priority, rationale
 *
 * Endpoints under test:
 *  1. POST /api/public/content-request/:workspaceId     — admin creates for client
 *  2. POST /api/public/content-request/:workspaceId/submit — client submits their own topic
 *
 * Auth: workspace is created without a clientPassword so requireClientPortalAuth
 * passes through (passwordless workspace). APP_PASSWORD is deleted so the admin
 * endpoint also requires no auth.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Hoisted state ─────────────────────────────────────────────────────────────

const emailState = vi.hoisted(() => ({
  contentRequests: [] as Array<{
    workspaceName: string;
    workspaceId?: string;
    topic: string;
    targetKeyword: string;
    priority: string;
    rationale: string;
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
    notifyTeamContentRequest: vi.fn(
      (p: (typeof emailState.contentRequests)[0]) => {
        emailState.contentRequests.push(p);
      },
    ),
    // Stub transitive email calls so no real emails fire
    notifyTeamActionApproved: vi.fn(),
    notifyTeamChangesRequested: vi.fn(),
    notifyTeamNewRequest: vi.fn(),
  };
});

import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

// ── Server setup ──────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
const wsName = 'ContentRequestNotif-Test';
const originalAppPassword = process.env.APP_PASSWORD;

async function startTestServer(): Promise<void> {
  // Remove APP_PASSWORD so the admin endpoint (POST /api/public/content-request/:workspaceId)
  // is accessible without auth credentials in tests.
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
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  // Workspace is created without a clientPassword so it is passwordless —
  // requireClientPortalAuth() passes through for all requests to this workspace.
  wsId = createWorkspace(wsName).id;
}, 30_000);

beforeEach(() => {
  emailState.contentRequests = [];
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
}, 30_000);

// ── Admin creates content request for client ──────────────────────────────────

describe('POST /api/public/content-request/:workspaceId — admin content request notification', () => {
  it('fires notifyTeamContentRequest with correct workspaceName, workspaceId, topic, targetKeyword, priority, and rationale', async () => {
    const body = {
      topic: 'How to choose the best HVAC system',
      targetKeyword: 'best HVAC system',
      intent: 'informational',
      priority: 'medium',
      rationale: 'High search volume, low competition.',
      serviceType: 'brief_only',
    };

    const res = await postJson(`/api/public/content-request/${wsId}`, body);
    expect(res.status).toBe(200);

    expect(emailState.contentRequests).toHaveLength(1);
    const n = emailState.contentRequests[0];
    expect(n.workspaceName).toBe(wsName);
    expect(n.workspaceId).toBe(wsId);
    expect(n.topic).toBe('How to choose the best HVAC system');
    expect(n.targetKeyword).toBe('best HVAC system');
    expect(n.priority).toBe('medium');
    expect(n.rationale).toBe('High search volume, low competition.');
  });

  it('fires with different priority values — high priority is forwarded correctly', async () => {
    const body = {
      topic: 'Emergency HVAC repair guide',
      targetKeyword: 'emergency HVAC repair',
      intent: 'transactional',
      priority: 'high',
      rationale: 'Seasonal traffic spike expected.',
      serviceType: 'full_post',
    };

    const res = await postJson(`/api/public/content-request/${wsId}`, body);
    expect(res.status).toBe(200);

    expect(emailState.contentRequests).toHaveLength(1);
    const n = emailState.contentRequests[0];
    expect(n.priority).toBe('high');
    expect(n.topic).toBe('Emergency HVAC repair guide');
    expect(n.targetKeyword).toBe('emergency HVAC repair');
    expect(n.rationale).toBe('Seasonal traffic spike expected.');
  });

  it('does NOT fire when topic is missing (400 response)', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}`, {
      targetKeyword: 'some keyword',
      priority: 'medium',
      rationale: 'Some rationale.',
      serviceType: 'brief_only',
    });
    expect(res.status).toBe(400);
    expect(emailState.contentRequests).toHaveLength(0);
  });

  it('does NOT fire when targetKeyword is missing (400 response)', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}`, {
      topic: 'Some topic',
      priority: 'medium',
      rationale: 'Some rationale.',
      serviceType: 'brief_only',
    });
    expect(res.status).toBe(400);
    expect(emailState.contentRequests).toHaveLength(0);
  });

  it('fires exactly once per request creation (no double-fire)', async () => {
    const body = {
      topic: 'Single-fire topic test',
      targetKeyword: 'single fire test',
      priority: 'low',
      rationale: 'Counting notification fires.',
      serviceType: 'brief_only',
    };

    const res = await postJson(`/api/public/content-request/${wsId}`, body);
    expect(res.status).toBe(200);
    expect(emailState.contentRequests).toHaveLength(1);
  });

  it('also broadcasts CONTENT_REQUEST_CREATED with id and topic', async () => {
    const topic = `Broadcast test topic ${Date.now()}`;
    const body = {
      topic,
      targetKeyword: 'broadcast-test-kw',
      priority: 'medium',
      rationale: 'Verifying broadcast is also fired.',
      serviceType: 'brief_only',
    };

    const res = await postJson(`/api/public/content-request/${wsId}`, body);
    expect(res.status).toBe(200);
    const created = await res.json() as { id: string };

    const broadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.CONTENT_REQUEST_CREATED,
    );
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].payload).toEqual({ id: created.id, topic });
  });
});

// ── Client submits their own topic ────────────────────────────────────────────

describe('POST /api/public/content-request/:workspaceId/submit — client-submitted notification', () => {
  it('fires notifyTeamContentRequest with workspaceName, workspaceId, topic, targetKeyword, priority=medium, and rationale from notes', async () => {
    const body = {
      topic: 'Tips for saving on energy bills',
      targetKeyword: 'save energy bills',
      notes: 'Our customers keep asking about this.',
      serviceType: 'brief_only',
    };

    const res = await postJson(`/api/public/content-request/${wsId}/submit`, body);
    expect(res.status).toBe(200);

    expect(emailState.contentRequests).toHaveLength(1);
    const n = emailState.contentRequests[0];
    expect(n.workspaceName).toBe(wsName);
    expect(n.workspaceId).toBe(wsId);
    expect(n.topic).toBe('Tips for saving on energy bills');
    expect(n.targetKeyword).toBe('save energy bills');
    expect(n.priority).toBe('medium');
    expect(n.rationale).toBe('Our customers keep asking about this.');
  });

  it('fires with empty rationale when notes are omitted', async () => {
    const body = {
      topic: 'How to install a smart thermostat',
      targetKeyword: 'smart thermostat installation',
      serviceType: 'brief_only',
    };

    const res = await postJson(`/api/public/content-request/${wsId}/submit`, body);
    expect(res.status).toBe(200);

    expect(emailState.contentRequests).toHaveLength(1);
    const n = emailState.contentRequests[0];
    // The submit endpoint passes `notes || ''` as rationale
    expect(n.rationale).toBe('');
    expect(n.priority).toBe('medium');
  });

  it('does NOT fire when topic is missing (400 response)', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}/submit`, {
      targetKeyword: 'some keyword',
      notes: 'Some notes.',
    });
    expect(res.status).toBe(400);
    expect(emailState.contentRequests).toHaveLength(0);
  });

  it('does NOT fire when targetKeyword is missing (400 response)', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}/submit`, {
      topic: 'Some topic',
      notes: 'Some notes.',
    });
    expect(res.status).toBe(400);
    expect(emailState.contentRequests).toHaveLength(0);
  });

  it('also broadcasts CONTENT_REQUEST_CREATED with id and topic', async () => {
    const topic = `Submit broadcast test ${Date.now()}`;
    const body = {
      topic,
      targetKeyword: 'submit-broadcast-kw',
      notes: 'Checking broadcast fires too.',
    };

    const res = await postJson(`/api/public/content-request/${wsId}/submit`, body);
    expect(res.status).toBe(200);
    const created = await res.json() as { id: string };

    const broadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.CONTENT_REQUEST_CREATED,
    );
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].payload).toEqual({ id: created.id, topic });
  });
});
