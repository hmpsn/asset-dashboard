/**
 * Integration tests: client signal notification payloads.
 *
 * The existing client-signals-routes.test.ts has no email mock — the real
 * notifyTeamClientSignal runs silently and its payload is never verified.
 *
 * This file covers:
 * - notifyTeamClientSignal fires with correct workspaceId, workspaceName, signalType,
 *   and triggerMessage for both content_interest and service_interest types
 * - No notification fires when workspace does not exist (404)
 * - No notification fires when Zod validation fails (400)
 * - No notification fires when triggerMessage exceeds 500 chars (400)
 * - Exactly one notification fires per signal submission
 * - CLIENT_SIGNAL_CREATED is broadcast with signalId after successful creation
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Hoisted state ─────────────────────────────────────────────────────────────

const emailState = vi.hoisted(() => ({
  clientSignals: [] as Array<{
    workspaceId: string;
    workspaceName: string;
    signalType: string;
    triggerMessage: string;
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
    notifyTeamClientSignal: vi.fn(
      (workspaceId: string, workspaceName: string, signalType: string, triggerMessage: string) => {
        emailState.clientSignals.push({ workspaceId, workspaceName, signalType, triggerMessage });
      },
    ),
    notifyTeamNewRequest: vi.fn(),
    notifyTeamActionApproved: vi.fn(),
    notifyTeamContentRequest: vi.fn(),
    notifyTeamChangesRequested: vi.fn(),
    notifyTeamPaymentReceived: vi.fn(),
    notifyTeamChurnSignal: vi.fn(),
  };
});

import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

// ── Server setup ──────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
const wsName = 'SignalNotif-Test';
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
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace(wsName).id;
}, 30_000);

beforeEach(() => {
  emailState.clientSignals = [];
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM client_signals WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
}, 30_000);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/public/signal/:workspaceId — notifyTeamClientSignal', () => {
  it('fires notifyTeamClientSignal with correct workspaceId, workspaceName, type, and triggerMessage (content_interest)', async () => {
    const res = await postJson(`/api/public/signal/${wsId}`, {
      type: 'content_interest',
      triggerMessage: 'I want more content about SEO',
      chatContext: [],
    });
    expect(res.status).toBe(200);

    expect(emailState.clientSignals).toHaveLength(1);
    const n = emailState.clientSignals[0];
    expect(n.workspaceId).toBe(wsId);
    expect(n.workspaceName).toBe(wsName);
    expect(n.signalType).toBe('content_interest');
    expect(n.triggerMessage).toBe('I want more content about SEO');
  });

  it('fires with service_interest type', async () => {
    const res = await postJson(`/api/public/signal/${wsId}`, {
      type: 'service_interest',
      triggerMessage: 'Tell me about your link building service',
      chatContext: [],
    });
    expect(res.status).toBe(200);

    expect(emailState.clientSignals).toHaveLength(1);
    const n = emailState.clientSignals[0];
    expect(n.signalType).toBe('service_interest');
    expect(n.triggerMessage).toBe('Tell me about your link building service');
  });

  it('does NOT fire when workspace does not exist (404)', async () => {
    const res = await postJson('/api/public/signal/nonexistent-workspace-id', {
      type: 'content_interest',
      triggerMessage: 'Should not fire',
      chatContext: [],
    });
    expect(res.status).toBe(404);
    expect(emailState.clientSignals).toHaveLength(0);
  });

  it('does NOT fire when Zod validation fails — missing type field (400)', async () => {
    const res = await postJson(`/api/public/signal/${wsId}`, {
      triggerMessage: 'No type field',
      chatContext: [],
    });
    expect(res.status).toBe(400);
    expect(emailState.clientSignals).toHaveLength(0);
  });

  it('does NOT fire when triggerMessage exceeds 500 chars (400)', async () => {
    const res = await postJson(`/api/public/signal/${wsId}`, {
      type: 'content_interest',
      triggerMessage: 'x'.repeat(501),
      chatContext: [],
    });
    expect(res.status).toBe(400);
    expect(emailState.clientSignals).toHaveLength(0);
  });

  it('fires exactly once per signal submission', async () => {
    const res = await postJson(`/api/public/signal/${wsId}`, {
      type: 'content_interest',
      triggerMessage: 'Single fire check',
      chatContext: [],
    });
    expect(res.status).toBe(200);
    expect(emailState.clientSignals).toHaveLength(1);
  });

  it('broadcasts CLIENT_SIGNAL_CREATED with signalId after successful signal creation', async () => {
    const res = await postJson(`/api/public/signal/${wsId}`, {
      type: 'service_interest',
      triggerMessage: 'Broadcast check',
      chatContext: [],
    });
    expect(res.status).toBe(200);

    const signalBroadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.CLIENT_SIGNAL_CREATED,
    );
    expect(signalBroadcasts).toHaveLength(1);

    const broadcastPayload = signalBroadcasts[0].payload as { signalId?: string };
    expect(broadcastPayload.signalId).toBeDefined();
    expect(typeof broadcastPayload.signalId).toBe('string');
    expect(broadcastPayload.signalId!.length).toBeGreaterThan(0);
  });
});
