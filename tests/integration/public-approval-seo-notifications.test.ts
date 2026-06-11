/**
 * Integration tests: SEO approval notification payloads.
 *
 * The existing public-approval-broadcasts.test.ts mocks notifyTeamChangesRequested
 * and checks toHaveLength(1) for the rejection case, but:
 *
 * 1. notifyTeamActionApproved is NOT mocked — the real email function runs silently
 * 2. The rejection notification payload is never verified (topic, keyword, feedback)
 * 3. The bulk-approve endpoint's notification is entirely untested
 *
 * This file covers:
 * - Individual item approval: notifyTeamActionApproved fires with correct sourceType,
 *   actionTitle (SEO change approved: {fieldLabel}), and actionSummary (page label)
 * - Individual item rejection: notifyTeamChangesRequested fires with correct payload
 *   (topic, targetKeyword, feedback) — payload verification was missing
 * - Bulk approve: notifyTeamActionApproved fires with sourceType seo_approval and
 *   actionTitle showing batch name and item count
 * - Status-unchanged path: no notification fires when status doesn't change
 *   (e.g. approving an already-approved item)
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
  };
});

import { createBatch, updateItem } from '../../server/approvals.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

// ── Server setup ──────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
const wsName = 'SeoApprovalNotif-Test';
const siteId = 'site_seo_notif_test';
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
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

function makeBatch(name: string, field: 'seoTitle' | 'seoDescription' = 'seoTitle') {
  return createBatch(wsId, siteId, name, [
    {
      pageId: `page_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      pageTitle: `${name} Page`,
      pageSlug: `/${name.toLowerCase().replace(/\s+/g, '-')}`,
      field,
      currentValue: 'Current value',
      proposedValue: 'Proposed value',
    },
  ]);
}

function makeMultiItemBatch(name: string) {
  return createBatch(wsId, siteId, name, [
    {
      pageId: `page_multi_${Date.now()}`,
      pageTitle: `${name} Page A`,
      pageSlug: '/page-a',
      field: 'seoTitle',
      currentValue: 'Old title A',
      proposedValue: 'New title A',
    },
    {
      pageId: `page_multi_${Date.now() + 1}`,
      pageTitle: `${name} Page B`,
      pageSlug: '/page-b',
      field: 'seoDescription',
      currentValue: 'Old description B',
      proposedValue: 'New description B',
    },
  ]);
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
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
}, 30_000);

// ── Individual item approval notifications ────────────────────────────────────

describe('PATCH .../approvals/:batchId/:itemId — individual item approve', () => {
  it('fires notifyTeamActionApproved with seo_approval sourceType', async () => {
    const batch = makeBatch('Title Approval');
    const item = batch.items[0];

    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batch.id}/${item.id}`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    const n = emailState.actionApproved[0];
    expect(n.workspaceId).toBe(wsId);
    expect(n.workspaceName).toBe(wsName);
    expect(n.sourceType).toBe('seo_approval');
    // fieldLabel for seoTitle is 'SEO title' (from APPROVAL_FIELD_LABELS)
    expect(n.actionTitle).toBe('SEO change approved: SEO title');
    // actionSummary is the page label (pageTitle)
    expect(n.actionSummary).toBe('Title Approval Page');
  });

  it('includes clientNote in notification when provided', async () => {
    const batch = makeBatch('Note Approval');
    const item = batch.items[0];

    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batch.id}/${item.id}`,
      { status: 'approved', clientNote: 'LGTM!' },
    );
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    expect(emailState.actionApproved[0].clientNote).toBe('LGTM!');
  });

  it('uses fieldLabel "description" for seoDescription field', async () => {
    const batch = makeBatch('Desc Approval', 'seoDescription');
    const item = batch.items[0];

    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batch.id}/${item.id}`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    // fieldLabel for seoDescription is 'meta description' (from APPROVAL_FIELD_LABELS)
    expect(emailState.actionApproved[0].actionTitle).toBe('SEO change approved: meta description');
  });

  it('does NOT fire notification when approving an already-approved item (status unchanged)', async () => {
    const batch = makeBatch('Already Approved');
    const item = batch.items[0];
    updateItem(wsId, batch.id, item.id, { status: 'approved' });

    // Approve again — status doesn't change
    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batch.id}/${item.id}`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);
    expect(emailState.actionApproved).toHaveLength(0);
  });
});

// ── Individual item rejection notifications ───────────────────────────────────

describe('PATCH .../approvals/:batchId/:itemId — individual item reject', () => {
  it('fires notifyTeamChangesRequested with correct topic and feedback', async () => {
    const batch = makeBatch('Reject Feedback');
    const item = batch.items[0];

    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batch.id}/${item.id}`,
      { status: 'rejected', clientNote: 'Please keep the original phrasing.' },
    );
    expect(res.status).toBe(200);

    expect(emailState.changesRequested).toHaveLength(1);
    const n = emailState.changesRequested[0];
    expect(n.workspaceId).toBe(wsId);
    expect(n.workspaceName).toBe(wsName);
    // topic is "SEO revision requested: {fieldLabel}" — seoTitle maps to 'SEO title'
    expect(n.topic).toBe('SEO revision requested: SEO title');
    // targetKeyword is pageLabel (pageTitle)
    expect(n.targetKeyword).toBe('Reject Feedback Page');
    expect(n.feedback).toBe('Please keep the original phrasing.');
  });

  it('fires with empty feedback string when no clientNote provided', async () => {
    const batch = makeBatch('Reject No Feedback');
    const item = batch.items[0];

    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batch.id}/${item.id}`,
      { status: 'rejected' },
    );
    expect(res.status).toBe(200);

    expect(emailState.changesRequested).toHaveLength(1);
    expect(emailState.changesRequested[0].feedback).toBe('');
  });

  it('does NOT fire when rejecting an already-rejected item (status unchanged)', async () => {
    const batch = makeBatch('Already Rejected');
    const item = batch.items[0];
    updateItem(wsId, batch.id, item.id, { status: 'rejected' });

    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batch.id}/${item.id}`,
      { status: 'rejected' },
    );
    expect(res.status).toBe(200);
    expect(emailState.changesRequested).toHaveLength(0);
  });

  it('does not fire changesRequested when status changes pending → approved (fires actionApproved)', async () => {
    const batch = makeBatch('Pending Then Approve');
    const item = batch.items[0];
    // Item starts pending — approve it directly

    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batch.id}/${item.id}`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);

    // Approval fires actionApproved, not changesRequested
    expect(emailState.actionApproved).toHaveLength(1);
    expect(emailState.changesRequested).toHaveLength(0);
  });
});

// ── Bulk approve notifications ────────────────────────────────────────────────

describe('PATCH .../approvals/:batchId/approve — bulk approve', () => {
  it('fires notifyTeamActionApproved with batch name and item count', async () => {
    const batch = makeMultiItemBatch('Bulk Approval Batch');

    const res = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/approve`, {});
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    const n = emailState.actionApproved[0];
    expect(n.workspaceId).toBe(wsId);
    expect(n.workspaceName).toBe(wsName);
    expect(n.sourceType).toBe('seo_approval');
    expect(n.actionTitle).toBe('SEO batch approved: Bulk Approval Batch');
    expect(n.actionSummary).toBe('2 approved changes');
  });

  it('uses singular "change" when only one item is approved', async () => {
    const batch = makeBatch('Single Item Bulk');

    const res = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/approve`, {});
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    expect(emailState.actionApproved[0].actionSummary).toBe('1 approved change');
  });

  it('includes clientNote when provided to bulk approve', async () => {
    const batch = makeBatch('Bulk With Note');

    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batch.id}/approve`,
      { clientNote: 'All looks great!' },
    );
    expect(res.status).toBe(200);

    expect(emailState.actionApproved).toHaveLength(1);
    expect(emailState.actionApproved[0].clientNote).toBe('All looks great!');
  });

  it('returns 400 and does not notify when batch has no pending items', async () => {
    const batch = makeBatch('No Pending');
    // Pre-approve the item so there are no pending items left
    updateItem(wsId, batch.id, batch.items[0].id, { status: 'approved' });

    const res = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/approve`, {});
    expect(res.status).toBe(400);
    expect(emailState.actionApproved).toHaveLength(0);
  });

  it('broadcasts APPROVAL_UPDATE after bulk approve', async () => {
    const batch = makeBatch('Bulk Broadcast Check');

    const res = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/approve`, {});
    expect(res.status).toBe(200);

    const approvalUpdates = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.APPROVAL_UPDATE && (c.payload as { batchId?: string })?.batchId === batch.id,
    );
    expect(approvalUpdates).toHaveLength(1);
    expect(approvalUpdates[0].payload).toMatchObject({ batchId: batch.id, status: 'approved' });
  });
});
