/**
 * Integration tests: admin client action creation — notifyApprovalReady.
 *
 * Covers:
 * - Fires with correct payload (clientEmail, workspaceName, workspaceId, batchName, itemCount=1)
 *   when the workspace has a clientEmail set.
 * - Does NOT fire when the workspace has no clientEmail.
 * - dashboardUrl is undefined when APP_URL env var is not set.
 * - Fires for each non-duplicate action; dedup does NOT re-fire.
 * - Returns created action with correct shape.
 * - Broadcasts CLIENT_ACTION_UPDATE with action:'created'.
 * - Dedup returns existing action and does NOT broadcast again.
 * - Missing title returns 400 and no notification fires.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Hoisted state ─────────────────────────────────────────────────────────────

const emailState = vi.hoisted(() => ({
  approvalReady: [] as Array<{
    clientEmail: string;
    workspaceName: string;
    workspaceId?: string;
    batchName: string;
    itemCount: number;
    dashboardUrl?: string;
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
    notifyApprovalReady: vi.fn((p: typeof emailState.approvalReady[0]) => {
      emailState.approvalReady.push(p);
    }),
  };
});

import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

// ── Server setup ──────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsIdWithEmail = '';
let wsIdNoEmail = '';
const wsNameWithEmail = 'ClientAction-NotifWithEmail-Test';
const wsNameNoEmail = 'ClientAction-NotifNoEmail-Test';
const clientEmail = 'test@example.com';
const originalAppPassword = process.env.APP_PASSWORD;
const originalAppUrl = process.env.APP_URL;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  delete process.env.APP_URL;
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

// ── Action body helpers ───────────────────────────────────────────────────────

let sourceIdCounter = 0;

function makeActionBody(title: string, sourceId?: string) {
  return {
    sourceType: 'aeo_change' as const,
    sourceId: sourceId ?? `src_${Date.now()}_${++sourceIdCounter}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    summary: 'Test summary for notification integration test',
    payload: {},
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsIdWithEmail = createWorkspace(wsNameWithEmail).id;
  updateWorkspace(wsIdWithEmail, { clientEmail });
  wsIdNoEmail = createWorkspace(wsNameNoEmail).id;
}, 30_000);

beforeEach(() => {
  emailState.approvalReady = [];
  broadcastState.calls = [];
});

afterAll(async () => {
  for (const wsId of [wsIdWithEmail, wsIdNoEmail]) {
    db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
    deleteWorkspace(wsId);
  }
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
  if (originalAppUrl === undefined) {
    delete process.env.APP_URL;
  } else {
    process.env.APP_URL = originalAppUrl;
  }
}, 30_000);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/client-actions/:workspaceId — notifyApprovalReady', () => {
  it('fires notifyApprovalReady with correct payload when workspace has clientEmail', async () => {
    const title = 'Fix heading hierarchy';
    const res = await postJson(`/api/client-actions/${wsIdWithEmail}`, makeActionBody(title));
    expect(res.status).toBe(200);

    expect(emailState.approvalReady).toHaveLength(1);
    const n = emailState.approvalReady[0];
    expect(n.clientEmail).toBe(clientEmail);
    expect(n.workspaceName).toBe(wsNameWithEmail);
    expect(n.workspaceId).toBe(wsIdWithEmail);
    expect(n.batchName).toBe(title);
    expect(n.itemCount).toBe(1);
  });

  it('does NOT fire notifyApprovalReady when workspace has no clientEmail', async () => {
    const res = await postJson(`/api/client-actions/${wsIdNoEmail}`, makeActionBody('Action Without Email'));
    expect(res.status).toBe(200);

    expect(emailState.approvalReady).toHaveLength(0);
  });

  it('dashboardUrl is undefined when APP_URL env var is not set', async () => {
    // APP_URL is deleted in startTestServer — verify it remains unset
    expect(process.env.APP_URL).toBeUndefined();

    const res = await postJson(`/api/client-actions/${wsIdWithEmail}`, makeActionBody('Action No URL'));
    expect(res.status).toBe(200);

    expect(emailState.approvalReady).toHaveLength(1);
    expect(emailState.approvalReady[0].dashboardUrl).toBeUndefined();
  });

  it('fires for each distinct action (non-duplicate)', async () => {
    const title1 = 'Distinct Action One';
    const title2 = 'Distinct Action Two';

    const res1 = await postJson(`/api/client-actions/${wsIdWithEmail}`, makeActionBody(title1));
    const res2 = await postJson(`/api/client-actions/${wsIdWithEmail}`, makeActionBody(title2));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    expect(emailState.approvalReady).toHaveLength(2);
    const titles = emailState.approvalReady.map(n => n.batchName);
    expect(titles).toContain(title1);
    expect(titles).toContain(title2);
  });

  it('returns created action with correct shape (id, title, status, sourceType)', async () => {
    const title = 'Shape Check Action';
    const body = makeActionBody(title);
    const res = await postJson(`/api/client-actions/${wsIdWithEmail}`, body);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(typeof data.id).toBe('string');
    expect(data.title).toBe(title);
    expect(data.status).toBe('pending');
    expect(data.sourceType).toBe('aeo_change');
  });
});

describe('POST /api/client-actions/:workspaceId — deduplication', () => {
  it('second POST with same sourceType + sourceId returns existing action (isDuplicate path)', async () => {
    const sourceId = `dedup_src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const title = 'Dedup Action';
    const body = makeActionBody(title, sourceId);

    const res1 = await postJson(`/api/client-actions/${wsIdWithEmail}`, body);
    expect(res1.status).toBe(200);
    const first = (await res1.json()) as Record<string, unknown>;

    // Reset state between the two sends so we can check the second independently
    emailState.approvalReady = [];
    broadcastState.calls = [];

    const res2 = await postJson(`/api/client-actions/${wsIdWithEmail}`, body);
    expect(res2.status).toBe(200);
    const second = (await res2.json()) as Record<string, unknown>;

    // Same action returned
    expect(second.id).toBe(first.id);
    expect(second.title).toBe(title);
  });

  it('duplicate creation does NOT fire notifyApprovalReady again', async () => {
    const sourceId = `dedup_notif_src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const body = makeActionBody('Dedup Notif Action', sourceId);

    // First send
    const res1 = await postJson(`/api/client-actions/${wsIdWithEmail}`, body);
    expect(res1.status).toBe(200);

    // Reset
    emailState.approvalReady = [];
    broadcastState.calls = [];

    // Second send (duplicate)
    const res2 = await postJson(`/api/client-actions/${wsIdWithEmail}`, body);
    expect(res2.status).toBe(200);

    expect(emailState.approvalReady).toHaveLength(0);
  });
});

describe('POST /api/client-actions/:workspaceId — broadcasts', () => {
  it('broadcasts CLIENT_ACTION_UPDATE with action id and action="created"', async () => {
    const res = await postJson(`/api/client-actions/${wsIdWithEmail}`, makeActionBody('Broadcast Action'));
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    const actionId = data.id as string;

    const actionUpdates = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.CLIENT_ACTION_UPDATE &&
        (c.payload as { actionId?: string })?.actionId === actionId,
    );
    expect(actionUpdates).toHaveLength(1);
    expect(actionUpdates[0].workspaceId).toBe(wsIdWithEmail);
    expect(actionUpdates[0].payload).toMatchObject({ actionId, action: 'created' });
  });

  it('duplicate creation does NOT broadcast CLIENT_ACTION_UPDATE', async () => {
    const sourceId = `dedup_broadcast_src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const body = makeActionBody('Dedup Broadcast Action', sourceId);

    // First send (sets up the duplicate)
    const res1 = await postJson(`/api/client-actions/${wsIdWithEmail}`, body);
    expect(res1.status).toBe(200);

    // Reset broadcast state
    broadcastState.calls = [];

    // Second send (duplicate — should NOT broadcast)
    const res2 = await postJson(`/api/client-actions/${wsIdWithEmail}`, body);
    expect(res2.status).toBe(200);

    const actionUpdates = broadcastState.calls.filter(c => c.event === WS_EVENTS.CLIENT_ACTION_UPDATE);
    expect(actionUpdates).toHaveLength(0);
  });
});

describe('POST /api/client-actions/:workspaceId — validation', () => {
  it('missing title returns 400 and no notification fires', async () => {
    const res = await postJson(`/api/client-actions/${wsIdWithEmail}`, {
      sourceType: 'aeo_change',
      summary: 'Summary without a title',
      payload: {},
    });
    expect(res.status).toBe(400);
    expect(emailState.approvalReady).toHaveLength(0);
  });
});
