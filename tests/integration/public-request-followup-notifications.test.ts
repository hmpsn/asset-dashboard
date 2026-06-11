/**
 * Regression tests: POST /api/public/requests/:workspaceId/:requestId/notes
 * fires the notifyTeamRequestFollowup email notification.
 *
 * These tests cover the notification side-effect added in PR #946
 * ("Patch notification gaps for client decisions and request followups").
 * The basic CRUD behavior is covered by public-requests-routes.test.ts;
 * this file focuses exclusively on the email notification contract.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const emailState = vi.hoisted(() => ({
  newRequests: [] as Array<{
    workspaceName: string;
    workspaceId: string;
    title: string;
    description: string;
    category: string;
  }>,
}));

const broadcastState = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn((event: string, payload: unknown) => {
    broadcastState.calls.push({ event, payload });
  }),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/email.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return {
    ...actual,
    notifyTeamNewRequest: vi.fn((payload: typeof emailState.newRequests[0]) => {
      emailState.newRequests.push(payload);
    }),
  };
});

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createRequest } from '../../server/requests.js';
import db from '../../server/db/index.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let wsName = '';

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

beforeAll(async () => {
  await startTestServer();
  wsName = 'RequestFollowupNotif-Test';
  // E3: admin HMAC injected by withPublicTestAuth; workspace needs no client password
  wsId = createWorkspace(wsName).id;
}, 30_000);

beforeEach(() => {
  emailState.newRequests = [];
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM requests WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  delete process.env.APP_PASSWORD;
}, 30_000);

// ── Note followup notifications ───────────────────────────────────────────────

describe('POST .../notes — follow-up notification', () => {
  it('fires notifyTeamNewRequest with Follow-up title when a client adds a note', async () => {
    const request = createRequest(wsId, {
      title: 'Fix contact form',
      description: 'Contact form is broken',
      category: 'other',
    });

    const res = await postJson(`/api/public/requests/${wsId}/${request.id}/notes`, {
      content: 'Any update on this?',
    });
    expect(res.status).toBe(200);

    expect(emailState.newRequests).toHaveLength(1);
    const notification = emailState.newRequests[0];
    expect(notification.workspaceId).toBe(wsId);
    expect(notification.workspaceName).toBe(wsName);
    expect(notification.title).toBe('Follow-up: Fix contact form');
    expect(notification.description).toBe('Any update on this?');
    expect(notification.category).toBe('other');
  });

  it('fires with the note content as the description', async () => {
    const request = createRequest(wsId, {
      title: 'SEO title review',
      description: 'Please review our homepage title',
      category: 'seo',
    });
    const noteContent = 'We would like to prioritize this for the product launch next week';

    const res = await postJson(`/api/public/requests/${wsId}/${request.id}/notes`, {
      content: noteContent,
    });
    expect(res.status).toBe(200);

    expect(emailState.newRequests).toHaveLength(1);
    expect(emailState.newRequests[0].description).toBe(noteContent);
  });

  it('fires exactly once per note submission', async () => {
    const request = createRequest(wsId, {
      title: 'Content request follow-up',
      description: 'Following up on our blog post',
      category: 'content',
    });

    await postJson(`/api/public/requests/${wsId}/${request.id}/notes`, { content: 'Note one' });
    await postJson(`/api/public/requests/${wsId}/${request.id}/notes`, { content: 'Note two' });

    expect(emailState.newRequests).toHaveLength(2);
    expect(emailState.newRequests[0].title).toBe('Follow-up: Content request follow-up');
    expect(emailState.newRequests[1].title).toBe('Follow-up: Content request follow-up');
    expect(emailState.newRequests[0].description).toBe('Note one');
    expect(emailState.newRequests[1].description).toBe('Note two');
  });

  it('does not fire when the request does not belong to the workspace', async () => {
    const otherWs = createWorkspace('OtherWs-FollowupTest');
    const request = createRequest(otherWs.id, {
      title: 'Wrong workspace request',
      description: 'This belongs to a different workspace',
      category: 'other',
    });

    try {
      const res = await postJson(`/api/public/requests/${wsId}/${request.id}/notes`, {
        content: 'Cross-workspace note attempt',
      });
      // Should return 404 — wrong workspace
      expect(res.status).toBe(404);
      expect(emailState.newRequests).toHaveLength(0);
    } finally {
      db.prepare('DELETE FROM requests WHERE workspace_id = ?').run(otherWs.id);
      deleteWorkspace(otherWs.id);
    }
  });

  it('does not fire when content is empty (Zod validation rejects)', async () => {
    const request = createRequest(wsId, {
      title: 'Empty note test',
      description: 'Testing empty note',
      category: 'other',
    });

    const res = await postJson(`/api/public/requests/${wsId}/${request.id}/notes`, {
      content: '',
    });
    expect(res.status).toBe(400);
    expect(emailState.newRequests).toHaveLength(0);
  });

  it('does not fire when the request id does not exist', async () => {
    const res = await postJson(`/api/public/requests/${wsId}/req_nonexistent_999/notes`, {
      content: 'Note for ghost request',
    });
    expect(res.status).toBe(404);
    expect(emailState.newRequests).toHaveLength(0);
  });
});

// ── New request notification (baseline — already covered, included for context) ──

describe('POST /api/public/requests/:workspaceId — new request notification', () => {
  it('fires notifyTeamNewRequest on request creation (not a Follow-up)', async () => {
    const res = await postJson(`/api/public/requests/${wsId}`, {
      title: 'New feature request',
      description: 'We need a chat widget',
      category: 'other',
      priority: 'medium',
    });
    expect(res.status).toBe(200);

    expect(emailState.newRequests).toHaveLength(1);
    // New request title is the actual title, not prefixed with "Follow-up:"
    expect(emailState.newRequests[0].title).toBe('New feature request');
    expect(emailState.newRequests[0].title).not.toMatch(/^Follow-up:/);
  });
});
