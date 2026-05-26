/**
 * Integration tests: admin approval batch creation — notifyApprovalReady.
 *
 * The existing mutation safety tests mock notifyApprovalReady but never verify
 * the payload or the conditional (clientEmail present vs absent) branch.
 *
 * This file covers:
 * - Fires with correct payload (clientEmail, workspaceName, workspaceId, batchName, itemCount)
 *   when the workspace has a clientEmail set.
 * - Does NOT fire when the workspace has no clientEmail.
 * - Fires with correct itemCount for a multi-item batch.
 * - dashboardUrl is undefined when APP_URL env var is not set.
 * - Broadcasts APPROVAL_UPDATE with action:'created' after batch creation.
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
const wsNameWithEmail = 'BatchNotif-WithEmail-Test';
const wsNameNoEmail = 'BatchNotif-NoEmail-Test';
const siteId = 'site_batch_notif_test';
const clientEmail = 'client@example.com';
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

// ── Batch body helpers ────────────────────────────────────────────────────────

function makeBatchBody(name: string, itemCount = 1) {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    pageId: `page_batchnotif_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
    pageTitle: `${name} Page ${i + 1}`,
    pageSlug: `/${name.toLowerCase().replace(/\s+/g, '-')}-${i + 1}`,
    field: 'seoTitle',
    currentValue: 'Old title',
    proposedValue: 'New title',
  }));
  return { siteId, name, items };
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
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ?').run(wsId);
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

describe('POST /api/approvals/:workspaceId — notifyApprovalReady on batch creation', () => {
  it('fires with correct payload when workspace has clientEmail', async () => {
    const batchName = 'Ready Notify Batch';
    const res = await postJson(`/api/approvals/${wsIdWithEmail}`, makeBatchBody(batchName));
    expect(res.status).toBe(200);

    expect(emailState.approvalReady).toHaveLength(1);
    const n = emailState.approvalReady[0];
    expect(n.clientEmail).toBe(clientEmail);
    expect(n.workspaceName).toBe(wsNameWithEmail);
    expect(n.workspaceId).toBe(wsIdWithEmail);
    expect(n.batchName).toBe(batchName);
    expect(n.itemCount).toBe(1);
  });

  it('does NOT fire when workspace has no clientEmail', async () => {
    const res = await postJson(`/api/approvals/${wsIdNoEmail}`, makeBatchBody('No Email Batch'));
    expect(res.status).toBe(200);

    expect(emailState.approvalReady).toHaveLength(0);
  });

  it('fires with correct itemCount for multi-item batch', async () => {
    const batchName = 'Multi Item Batch';
    const res = await postJson(`/api/approvals/${wsIdWithEmail}`, makeBatchBody(batchName, 3));
    expect(res.status).toBe(200);

    expect(emailState.approvalReady).toHaveLength(1);
    expect(emailState.approvalReady[0].itemCount).toBe(3);
    expect(emailState.approvalReady[0].batchName).toBe(batchName);
  });

  it('dashboardUrl is undefined when APP_URL env var is not set', async () => {
    // APP_URL is deleted in startTestServer — verify it remains unset
    expect(process.env.APP_URL).toBeUndefined();

    const res = await postJson(`/api/approvals/${wsIdWithEmail}`, makeBatchBody('No URL Batch'));
    expect(res.status).toBe(200);

    expect(emailState.approvalReady).toHaveLength(1);
    expect(emailState.approvalReady[0].dashboardUrl).toBeUndefined();
  });

  it('broadcasts APPROVAL_UPDATE with action:created after batch creation', async () => {
    const res = await postJson(`/api/approvals/${wsIdWithEmail}`, makeBatchBody('Broadcast Check Batch'));
    expect(res.status).toBe(200);

    const body = (await res.clone().json()) as { id: string };
    const batchId = body.id;

    const approvalUpdates = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.APPROVAL_UPDATE &&
        (c.payload as { batchId?: string })?.batchId === batchId,
    );
    expect(approvalUpdates).toHaveLength(1);
    expect(approvalUpdates[0].workspaceId).toBe(wsIdWithEmail);
    expect(approvalUpdates[0].payload).toMatchObject({ batchId, action: 'created' });
  });
});
