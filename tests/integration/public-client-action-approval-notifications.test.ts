/**
 * Integration tests: client action approval notification payloads.
 *
 * The existing client-actions-routes.test.ts has NO email mock — the real
 * notifyTeamActionApproved ran silently. This file covers:
 *
 * - Approved status: notifyTeamActionApproved fires with correct payload fields
 * - Approved status with clientNote: clientNote is passed through
 * - Approved status without clientNote: clientNote is omitted/undefined
 * - Fires exactly once per approval
 * - Returns 200 with updated action showing status='approved'
 * - Broadcasts CLIENT_ACTION_UPDATE after approval
 *
 * - changes_requested: notifyTeamActionApproved does NOT fire
 * - changes_requested: Returns 200 with status='changes_requested'
 * - changes_requested: Broadcasts CLIENT_ACTION_UPDATE
 *
 * - Error paths: 409 when action already approved, 409 when already changes_requested,
 *   404 when action does not exist
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
    clientNote?: string;
    dashboardUrl?: string;
  }>,
  approvalReady: [] as unknown[],
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
    notifyTeamActionApproved: vi.fn((p: (typeof emailState.actionApproved)[0]) => {
      emailState.actionApproved.push(p);
    }),
    notifyApprovalReady: vi.fn((p: unknown) => {
      emailState.approvalReady.push(p);
    }),
  };
});

import { createClientAction } from '../../server/client-actions.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

// ── Server setup ──────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
const wsName = 'ClientActionNotif-Test';
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

// ── Seed helpers ──────────────────────────────────────────────────────────────

function makeAction(title = 'Fix heading hierarchy', summary = 'H1 missing on service pages') {
  return createClientAction({
    workspaceId: wsId,
    sourceType: 'aeo_change',
    title,
    summary,
    payload: {},
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace(wsName).id;
}, 30_000);

beforeEach(() => {
  emailState.actionApproved = [];
  emailState.approvalReady = [];
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
}, 30_000);

// ── Approved — notifyTeamActionApproved ───────────────────────────────────────

describe('PATCH .../respond with approved — notifyTeamActionApproved', () => {
  it('fires notifyTeamActionApproved with correct workspaceId, workspaceName, actionTitle, sourceType, actionSummary', async () => {
    const action = makeAction('Fix heading hierarchy', 'H1 missing on service pages');

    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    const n = emailState.actionApproved[0];
    expect(n.workspaceId).toBe(wsId);
    expect(n.workspaceName).toBe(wsName);
    expect(n.actionTitle).toBe('Fix heading hierarchy');
    expect(n.sourceType).toBe('aeo_change');
    expect(n.actionSummary).toBe('H1 missing on service pages');
  });

  it('fires with clientNote when provided', async () => {
    const action = makeAction('Update meta descriptions', 'Meta descriptions are too short');

    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved', clientNote: 'Looks great!' },
    );
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    expect(emailState.actionApproved[0].clientNote).toBe('Looks great!');
  });

  it('does NOT include clientNote field when not provided', async () => {
    const action = makeAction('Add alt text to images', 'Several images lack descriptive alt text');

    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    // clientNote should be undefined (not provided in payload)
    expect(emailState.actionApproved[0].clientNote).toBeUndefined();
  });

  it('fires exactly once per approval', async () => {
    const action = makeAction('Optimize page speed', 'LCP is above 4 seconds');

    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
  });

  it('returns 200 with updated action showing status="approved"', async () => {
    const action = makeAction('Fix broken links', 'Several internal links return 404');

    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved', clientNote: 'Please fix these.' },
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; clientNote: string };
    expect(body.status).toBe('approved');
    expect(body.clientNote).toBe('Please fix these.');
  });

  it('broadcasts CLIENT_ACTION_UPDATE after approval', async () => {
    const action = makeAction('Improve schema markup', 'Missing FAQ schema on product pages');

    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);

    const actionUpdates = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.CLIENT_ACTION_UPDATE,
    );
    expect(actionUpdates.length).toBeGreaterThanOrEqual(1);
    const match = actionUpdates.find(
      c => (c.payload as { actionId?: string })?.actionId === action.id,
    );
    expect(match).toBeDefined();
  });
});

// ── changes_requested — no notification ──────────────────────────────────────

describe('PATCH .../respond with changes_requested — no notification', () => {
  it('does NOT fire notifyTeamActionApproved for changes_requested response', async () => {
    const action = makeAction('Revise title tags', 'Title tags are too long');

    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'changes_requested', clientNote: 'Please shorten them more.' },
    );
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(0);
  });

  it('returns 200 with status="changes_requested"', async () => {
    const action = makeAction('Remove duplicate content', 'Duplicate content detected on /about');

    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'changes_requested' },
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string };
    expect(body.status).toBe('changes_requested');
  });

  it('broadcasts CLIENT_ACTION_UPDATE after changes_requested response', async () => {
    const action = makeAction('Add canonical tags', 'Several pages lack canonical tags');

    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'changes_requested' },
    );
    expect(res.status).toBe(200);

    const actionUpdates = broadcastState.calls.filter(
      c =>
        c.event === WS_EVENTS.CLIENT_ACTION_UPDATE &&
        (c.payload as { actionId?: string })?.actionId === action.id,
    );
    expect(actionUpdates).toHaveLength(1);
  });
});

// ── Error paths ───────────────────────────────────────────────────────────────

describe('PATCH .../respond — error paths', () => {
  it('returns 409 when action is already approved (not pending)', async () => {
    const action = makeAction('Fix 404 pages', 'Several pages return 404');

    // First approval succeeds
    const first = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(first.status).toBe(200);

    // Second attempt on non-pending action returns 409
    const second = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'changes_requested' },
    );
    expect(second.status).toBe(409);
  });

  it('returns 409 when action is already changes_requested (not pending)', async () => {
    const action = makeAction('Update footer links', 'Footer links point to old domain');

    // First response succeeds
    const first = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'changes_requested' },
    );
    expect(first.status).toBe(200);

    // Second attempt on non-pending action returns 409
    const second = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(second.status).toBe(409);
  });

  it('returns 404 when actionId does not exist', async () => {
    const res = await patchJson(
      `/api/public/client-actions/${wsId}/ca_nonexistent_00000000/respond`,
      { status: 'approved' },
    );
    expect(res.status).toBe(404);
  });
});
