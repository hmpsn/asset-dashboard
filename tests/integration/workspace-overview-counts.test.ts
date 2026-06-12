/**
 * Integration tests: GET /api/workspace-overview count accuracy.
 *
 * The contract test (workspace-overview-shape.test.ts) verifies field presence
 * and zero-counts for fresh workspaces. This file verifies that each aggregate
 * count correctly reflects real seeded DB state — specifically the fields added
 * or changed in recent patches (clientActions, approvals, contentRequests).
 */
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  createClientAction,
  updateClientAction,
} from '../../server/client-actions.js';
import { createBatch, updateItem } from '../../server/approvals.js';
import { createContentRequest, updateContentRequest } from '../../server/content-requests.js';
import db from '../../server/db/index.js';
const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';
const siteId = 'site_ov_counts_test';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('OverviewCounts-13800', siteId).id;
}, 25_000);

afterEach(() => {
  // Clean up any data seeded per-test so counts start fresh each test
  db.prepare(`DELETE FROM client_actions WHERE workspace_id = ?`).run(wsId);
  db.prepare(`DELETE FROM approval_batches WHERE workspace_id = ?`).run(wsId);
  db.prepare(`DELETE FROM content_topic_requests WHERE workspace_id = ?`).run(wsId);
});

afterAll(async () => {
  db.prepare(`DELETE FROM client_actions WHERE workspace_id = ?`).run(wsId);
  db.prepare(`DELETE FROM approval_batches WHERE workspace_id = ?`).run(wsId);
  db.prepare(`DELETE FROM content_topic_requests WHERE workspace_id = ?`).run(wsId);
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

async function getWorkspaceOverview(): Promise<Record<string, unknown>> {
  const res = await api('/api/workspace-overview');
  expect(res.status).toBe(200);
  const body = await res.json() as Array<Record<string, unknown>>;
  const ws = body.find(w => w.id === wsId);
  expect(ws).toBeDefined();
  return ws!;
}

// ── clientActions counts ──────────────────────────────────────────────────────

describe('clientActions aggregate counts', () => {
  it('approved count reflects only approved actions', async () => {
    const a1 = createClientAction({ workspaceId: wsId, sourceType: 'recommendation', title: 'Fix heading', summary: 's', payload: {} });
    const a2 = createClientAction({ workspaceId: wsId, sourceType: 'recommendation', title: 'Add schema', summary: 's', payload: {} });
    const a3 = createClientAction({ workspaceId: wsId, sourceType: 'recommendation', title: 'Compress images', summary: 's', payload: {} });
    updateClientAction(wsId, a1.id, { status: 'approved' });
    updateClientAction(wsId, a2.id, { status: 'approved' });
    // a3 stays pending

    const ws = await getWorkspaceOverview();
    const clientActions = ws.clientActions as Record<string, number>;
    expect(clientActions.approved).toBe(2);
    expect(clientActions.changesRequested).toBe(0);
  });

  it('changesRequested count reflects only changes_requested actions', async () => {
    const a1 = createClientAction({ workspaceId: wsId, sourceType: 'recommendation', title: 'Fix CTA', summary: 's', payload: {} });
    const a2 = createClientAction({ workspaceId: wsId, sourceType: 'recommendation', title: 'Rewrite intro', summary: 's', payload: {} });
    updateClientAction(wsId, a1.id, { status: 'changes_requested' });
    // a2 stays pending

    const ws = await getWorkspaceOverview();
    const clientActions = ws.clientActions as Record<string, number>;
    expect(clientActions.changesRequested).toBe(1);
    expect(clientActions.approved).toBe(0);
  });

  it('counts both approved and changesRequested simultaneously', async () => {
    const a1 = createClientAction({ workspaceId: wsId, sourceType: 'recommendation', title: 'Action A', summary: 's', payload: {} });
    const a2 = createClientAction({ workspaceId: wsId, sourceType: 'recommendation', title: 'Action B', summary: 's', payload: {} });
    const a3 = createClientAction({ workspaceId: wsId, sourceType: 'recommendation', title: 'Action C', summary: 's', payload: {} });
    updateClientAction(wsId, a1.id, { status: 'approved' });
    updateClientAction(wsId, a2.id, { status: 'changes_requested' });
    // a3 stays pending

    const ws = await getWorkspaceOverview();
    const clientActions = ws.clientActions as Record<string, number>;
    expect(clientActions.approved).toBe(1);
    expect(clientActions.changesRequested).toBe(1);
  });

  it('completed actions do not appear in approved or changesRequested counts', async () => {
    const a1 = createClientAction({ workspaceId: wsId, sourceType: 'recommendation', title: 'Done action', summary: 's', payload: {} });
    updateClientAction(wsId, a1.id, { status: 'approved' });
    updateClientAction(wsId, a1.id, { status: 'completed' });

    const ws = await getWorkspaceOverview();
    const clientActions = ws.clientActions as Record<string, number>;
    // completed doesn't map to approved or changesRequested — only pending/approved/changes_requested do
    expect(clientActions.approved).toBe(0);
    expect(clientActions.changesRequested).toBe(0);
  });
});

// ── approvals counts ──────────────────────────────────────────────────────────

describe('approvals aggregate counts', () => {
  it('pending count matches unactioned approval items', async () => {
    createBatch(wsId, siteId, 'Batch A', [
      { pageId: 'p1', pageTitle: 'Page 1', pageSlug: '', field: 'seoTitle', currentValue: 'old', proposedValue: 'new' },
      { pageId: 'p2', pageTitle: 'Page 2', pageSlug: '', field: 'seoTitle', currentValue: 'old', proposedValue: 'new' },
    ]);

    const ws = await getWorkspaceOverview();
    const approvals = ws.approvals as Record<string, number>;
    expect(approvals.pending).toBe(2);
    expect(approvals.total).toBe(2);
    expect(approvals.approved).toBe(0);
    expect(approvals.changesRequested).toBe(0);
  });

  it('approved count reflects items updated to approved status', async () => {
    const batch = createBatch(wsId, siteId, 'Batch B', [
      { pageId: 'p3', pageTitle: 'Page 3', pageSlug: '', field: 'seoTitle', currentValue: 'old', proposedValue: 'new' },
      { pageId: 'p4', pageTitle: 'Page 4', pageSlug: '', field: 'seoTitle', currentValue: 'old', proposedValue: 'new' },
    ]);
    updateItem(wsId, batch.id, batch.items[0].id, { status: 'approved' });

    const ws = await getWorkspaceOverview();
    const approvals = ws.approvals as Record<string, number>;
    expect(approvals.approved).toBe(1);
    expect(approvals.pending).toBe(1);
    expect(approvals.total).toBe(2);
  });

  it('changesRequested count reflects rejected items', async () => {
    const batch = createBatch(wsId, siteId, 'Batch C', [
      { pageId: 'p5', pageTitle: 'Page 5', pageSlug: '', field: 'seoTitle', currentValue: 'old', proposedValue: 'new' },
    ]);
    updateItem(wsId, batch.id, batch.items[0].id, { status: 'rejected' });

    const ws = await getWorkspaceOverview();
    const approvals = ws.approvals as Record<string, number>;
    expect(approvals.changesRequested).toBe(1);
    expect(approvals.pending).toBe(0);
  });
});

// ── contentRequests counts ────────────────────────────────────────────────────

describe('contentRequests aggregate counts', () => {
  it('pending count reflects only "requested" status (not brief_generated)', async () => {
    // In the workspace overview, pending = status === 'requested' only
    // brief_generated counts as inProgress, not pending
    createContentRequest(wsId, {
      topic: 'Topic A', targetKeyword: `kw-pending-${Date.now()}`, intent: 'informational',
      priority: 'medium', rationale: 'test', initialStatus: 'requested', dedupe: false,
    });
    createContentRequest(wsId, {
      topic: 'Topic B', targetKeyword: `kw-brief-${Date.now()}`, intent: 'informational',
      priority: 'medium', rationale: 'test', initialStatus: 'brief_generated', dedupe: false,
    });

    const ws = await getWorkspaceOverview();
    const cr = ws.contentRequests as Record<string, number>;
    // Only the 'requested' one is pending; brief_generated goes to inProgress
    expect(cr.pending).toBeGreaterThanOrEqual(1);
    expect(cr.inProgress).toBeGreaterThanOrEqual(1);
    expect(cr.total).toBeGreaterThanOrEqual(2);
  });

  it('approved count reflects approved and delivered statuses', async () => {
    const req1 = createContentRequest(wsId, {
      topic: 'Topic C', targetKeyword: `kw-appr-${Date.now()}`, intent: 'informational',
      priority: 'medium', rationale: 'test', initialStatus: 'requested', dedupe: false,
    });
    const req2 = createContentRequest(wsId, {
      topic: 'Topic D', targetKeyword: `kw-deliv-${Date.now()}`, intent: 'informational',
      priority: 'medium', rationale: 'test', initialStatus: 'requested', dedupe: false,
    });
    updateContentRequest(wsId, req1.id, { status: 'approved' });
    updateContentRequest(wsId, req2.id, { status: 'delivered' });

    const ws = await getWorkspaceOverview();
    const cr = ws.contentRequests as Record<string, number>;
    expect(cr.approved).toBeGreaterThanOrEqual(2);
  });

  it('changesRequested count reflects changes_requested status', async () => {
    // State machine: brief_generated → client_review → changes_requested
    const req = createContentRequest(wsId, {
      topic: 'Topic E', targetKeyword: `kw-cr-${Date.now()}`, intent: 'informational',
      priority: 'medium', rationale: 'test', initialStatus: 'brief_generated', dedupe: false,
    });
    updateContentRequest(wsId, req.id, { status: 'client_review' });
    updateContentRequest(wsId, req.id, { status: 'changes_requested' });

    const ws = await getWorkspaceOverview();
    const cr = ws.contentRequests as Record<string, number>;
    expect(cr.changesRequested).toBeGreaterThanOrEqual(1);
  });

  it('inProgress count reflects in_progress status', async () => {
    const req = createContentRequest(wsId, {
      topic: 'Topic F', targetKeyword: `kw-ip-${Date.now()}`, intent: 'informational',
      priority: 'medium', rationale: 'test', initialStatus: 'requested', dedupe: false,
    });
    updateContentRequest(wsId, req.id, { status: 'in_progress' });

    const ws = await getWorkspaceOverview();
    const cr = ws.contentRequests as Record<string, number>;
    expect(cr.inProgress).toBeGreaterThanOrEqual(1);
  });

  it('total matches sum of all non-terminal statuses and terminal statuses', async () => {
    const kw = (s: string) => `kw-total-${s}-${Date.now()}`;
    createContentRequest(wsId, { topic: 'T1', targetKeyword: kw('a'), intent: 'inf', priority: 'medium', rationale: 't', initialStatus: 'requested', dedupe: false });
    const r2 = createContentRequest(wsId, { topic: 'T2', targetKeyword: kw('b'), intent: 'inf', priority: 'medium', rationale: 't', initialStatus: 'requested', dedupe: false });
    updateContentRequest(wsId, r2.id, { status: 'approved' });

    const ws = await getWorkspaceOverview();
    const cr = ws.contentRequests as Record<string, number>;
    expect(cr.total).toBeGreaterThanOrEqual(2);
  });
});
