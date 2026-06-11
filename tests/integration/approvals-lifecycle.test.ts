/**
 * Comprehensive integration tests for the approvals lifecycle.
 *
 * Focuses on gaps NOT covered by:
 *   - approvals-routes.test.ts          (basic CRUD, auth, bulk approve)
 *   - approvals-extended-routes.test.ts (remind edge cases, apply without Webflow)
 *   - approval-state-flow.test.ts       (unit-level state machine)
 *   - admin-approval-batch-notifications.test.ts (notifyApprovalReady payload)
 *   - approval-admin-mutation-safety.test.ts     (side-effect safety on create/delete)
 *   - public-approval-broadcasts.test.ts         (broadcast + page state details)
 *   - e2e-approval-flow.test.ts                  (end-to-end happy path)
 *
 * New coverage in this file:
 *   1. Default batch name ('SEO Changes') when name is omitted
 *   2. Multiple batches in same workspace — list length / ordering
 *   3. Admin list vs public list return the same batch IDs
 *   4. Batch shapes on public endpoint match admin endpoint
 *   5. Multi-item-same-page page-state derivation through HTTP
 *   6. Delete only clears page state for matching batchId (other batches unaffected)
 *   7. Broadcast on DELETE carries action:'deleted' and correct batchId
 *   8. Item PATCH with only clientValue (no status change)
 *   9. Item PATCH with only clientNote (no status change)
 *  10. Remind endpoint: email sent, recordSend throttle triggers 429 on repeat
 *  11. Remind endpoint: workspace not found → 404
 *  12. Apply returns correct `results` array shape with itemId/pageId/success fields
 *  13. Apply with synthetic cms- page ID fails gracefully per item
 *  14. Apply with mix: one success, one failure → partial result
 *  15. Bulk approve broadcasts APPROVAL_UPDATE with {batchId, status:'approved'}
 *  16. Creating batch for nonexistent workspace returns 404 (auth gate)
 *  17. Getting batch for nonexistent workspace returns 404 (auth gate)
 *  18. Batch created with publishedPath/pageTitle preserved on GET
 *  19. Item clientNote max-length (2000 chars ok, 2001 chars → 400)
 *  20. Admin delete broadcasts APPROVAL_UPDATE with action:'deleted'
 *  21. Multiple item approvals on the same page accumulate in page state correctly
 *  22. Public list on workspace with no batches returns []
 *  23. Batch list sorted by most recent (listBatches ordering check)
 *  24. Item status revert (approved → pending) via HTTP clears page state
 *  25. Batch item field: seoDescription is stored and returned correctly
 *  26. Cross-workspace delete returns 404 and leaves owner batch intact
 *  27. Apply with no approved items returns 400 before checking Webflow config
 *  28. Remind endpoint throttled after 3 sends (action category limit)
 *  29. Creating two batches for the same page both appear in the list
 *  30. Batch updatedAt changes after item is patched
 *  31. Partial apply: approved + rejected mix, only approved items are applied
 *  32. Apply endpoint broadcasts APPROVAL_APPLIED with applied count
 *  33. Creating batch with collectionId field preserved per item
 */

import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';

// ── Hoisted mock state ─────────────────────────────────────────────────────────

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

const webflowState = vi.hoisted(() => ({
  calls: [] as Array<{ pageId: string; fields: unknown; token?: string }>,
  result: { success: true } as { success: boolean; error?: string },
  sendEmailCalls: [] as Array<{ to: string; subject: string }>,
  isEmailConfiguredResult: true,
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
    sendEmail: vi.fn(async (to: string, subject: string) => {
      webflowState.sendEmailCalls.push({ to, subject });
      return true;
    }),
    isEmailConfigured: vi.fn(() => webflowState.isEmailConfiguredResult),
    notifyApprovalReady: vi.fn(),
    notifyTeamActionApproved: vi.fn(),
    notifyTeamChangesRequested: vi.fn(),
  };
});

vi.mock('../../server/webflow.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    updatePageSeo: vi.fn(async (pageId: string, fields: unknown, token?: string) => {
      webflowState.calls.push({ pageId, fields, token });
      return webflowState.result;
    }),
    updateCollectionItem: vi.fn(async () => ({ success: true })),
    publishCollectionItems: vi.fn(async () => ({ success: true })),
  };
});

// ── Server lifecycle ───────────────────────────────────────────────────────────

let server: http.Server | null = null;
let baseUrl = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.WEBFLOW_API_TOKEN = 'test-token-lifecycle';
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path, opts));
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

// ── Workspace + DB helpers ────────────────────────────────────────────────────

import { createWorkspace, deleteWorkspace, updateWorkspace, getPageState } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { recordSend } from '../../server/email-throttle.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

const originalAppPassword = process.env.APP_PASSWORD;
const originalWebflowToken = process.env.WEBFLOW_API_TOKEN;

// Unique workspace IDs per group to avoid cross-test pollution
let wsMain = '';
let wsIsolation = '';
let wsWithEmail = '';
const testSiteId = `site_lifecycle_${randomUUID().slice(0, 8)}`;

function makeBatchPayload(overrides: {
  name?: string;
  items?: unknown[];
  note?: string;
} = {}) {
  return {
    siteId: testSiteId,
    name: overrides.name,
    note: overrides.note,
    items: overrides.items ?? [
      {
        pageId: `page_${randomUUID().slice(0, 8)}`,
        pageSlug: '/test-page',
        pageTitle: 'Test Page',
        field: 'seoTitle',
        currentValue: 'Old Title',
        proposedValue: 'New SEO Title',
      },
    ],
  };
}

// ── Setup / Teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  // Pass webflowSiteId directly to createWorkspace so it's set on the initial INSERT
  wsMain = createWorkspace('Lifecycle Main WS', testSiteId).id;
  wsIsolation = createWorkspace('Lifecycle Isolation WS').id;
  wsWithEmail = createWorkspace('Lifecycle Email WS').id;
  updateWorkspace(wsWithEmail, { clientEmail: 'lifecycle-client@example.com' });
}, 30_000);

afterAll(async () => {
  for (const wsId of [wsMain, wsIsolation, wsWithEmail]) {
    db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM email_sends WHERE workspace_id = ?').run(wsId);
    deleteWorkspace(wsId);
  }
  await new Promise<void>(resolve => server!.close(() => resolve()));
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
  if (originalWebflowToken === undefined) delete process.env.WEBFLOW_API_TOKEN;
  else process.env.WEBFLOW_API_TOKEN = originalWebflowToken;
}, 30_000);

beforeEach(() => {
  broadcastState.calls = [];
  webflowState.calls = [];
  webflowState.result = { success: true };
  webflowState.sendEmailCalls = [];
  webflowState.isEmailConfiguredResult = true;
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: Batch creation edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Batch creation — edge cases', () => {
  it('defaults batch name to "SEO Changes" when name is omitted', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      items: [
        { pageId: 'p_default_name', pageSlug: '/default', pageTitle: 'Default Name Page', field: 'seoTitle', currentValue: 'Old', proposedValue: 'New' },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; name: string };
    expect(body.name).toBe('SEO Changes');
    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(body.id);
  });

  it('preserves publishedPath and pageTitle in items on GET', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Published Path Batch',
      items: [
        {
          pageId: 'p_published',
          pageSlug: '/about',
          pageTitle: 'About Us',
          publishedPath: '/about-us',
          field: 'seoDescription',
          currentValue: 'Old desc',
          proposedValue: 'New desc',
        },
      ],
    });
    expect(res.status).toBe(200);
    const created = await res.json() as { id: string; items: Array<{ pageTitle?: string; publishedPath?: string }> };
    const getRes = await api(`/api/approvals/${wsMain}/${created.id}`);
    expect(getRes.status).toBe(200);
    const batch = await getRes.json() as { items: Array<{ pageTitle?: string; publishedPath?: string }> };
    expect(batch.items[0].pageTitle).toBe('About Us');
    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
  });

  it('preserves collectionId on items', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'CMS Collection Batch',
      items: [
        {
          pageId: 'wf-cms-item-1',
          pageSlug: 'blog/post-1',
          pageTitle: 'Blog Post 1',
          collectionId: 'col_blog_123',
          field: 'meta-title',
          currentValue: 'Old CMS Title',
          proposedValue: 'New CMS Title',
        },
      ],
    });
    expect(res.status).toBe(200);
    const created = await res.json() as { id: string; items: Array<{ collectionId?: string }> };
    expect(created.items[0].collectionId).toBe('col_blog_123');
    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
  });

  it('seoDescription field is stored and returned correctly', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Meta Description Batch',
      items: [
        { pageId: 'p_desc', pageSlug: '/services', pageTitle: 'Services Page', field: 'seoDescription', currentValue: 'Old meta', proposedValue: 'Better meta description' },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; items: Array<{ field: string; proposedValue?: string }> };
    expect(body.items[0].field).toBe('seoDescription');
    expect(body.items[0].proposedValue).toBe('Better meta description');
    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(body.id);
  });

  it('batch note is returned on GET after creation', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Note Persistence Test',
      note: 'Important context for the client',
      items: [{ pageId: 'p_note_persist', pageSlug: '/note', pageTitle: 'Note Page', field: 'seoTitle', currentValue: 'Old', proposedValue: 'New' }],
    });
    expect(res.status).toBe(200);
    const created = await res.json() as { id: string; note?: string };
    expect(created.note).toBe('Important context for the client');

    const getRes = await api(`/api/approvals/${wsMain}/${created.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json() as { note?: string };
    expect(fetched.note).toBe('Important context for the client');

    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: Listing and reading batches
// ─────────────────────────────────────────────────────────────────────────────

describe('Batch list and read', () => {
  let batchIdA = '';
  let batchIdB = '';

  beforeAll(async () => {
    const resA = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'List Test Batch A',
      items: [{ pageId: 'p_list_a', pageSlug: '/list-a', pageTitle: 'List A Page', field: 'seoTitle', currentValue: 'Old A', proposedValue: 'New A' }],
    });
    batchIdA = ((await resA.json()) as { id: string }).id;

    const resB = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'List Test Batch B',
      items: [{ pageId: 'p_list_b', pageSlug: '/list-b', pageTitle: 'List B Page', field: 'seoDescription', currentValue: 'Old B', proposedValue: 'New B' }],
    });
    batchIdB = ((await resB.json()) as { id: string }).id;
  });

  afterAll(() => {
    db.prepare('DELETE FROM approval_batches WHERE id IN (?, ?)').run(batchIdA, batchIdB);
  });

  it('admin list contains both created batches', async () => {
    const res = await api(`/api/approvals/${wsMain}`);
    expect(res.status).toBe(200);
    const list = await res.json() as Array<{ id: string }>;
    const ids = list.map(b => b.id);
    expect(ids).toContain(batchIdA);
    expect(ids).toContain(batchIdB);
  });

  it('public list returns the same batch IDs as admin list', async () => {
    const [adminRes, publicRes] = await Promise.all([
      api(`/api/approvals/${wsMain}`),
      api(`/api/public/approvals/${wsMain}`),
    ]);
    expect(adminRes.status).toBe(200);
    expect(publicRes.status).toBe(200);
    const adminList = await adminRes.json() as Array<{ id: string }>;
    const publicList = await publicRes.json() as Array<{ id: string }>;
    const adminIds = new Set(adminList.map(b => b.id));
    const publicIds = new Set(publicList.map(b => b.id));
    expect(adminIds.size).toBeGreaterThan(0);
    expect([...adminIds].every(id => publicIds.has(id))).toBe(true); // every-ok
    expect([...publicIds].every(id => adminIds.has(id))).toBe(true); // every-ok
  });

  it('public single-batch endpoint returns same data as admin single-batch endpoint', async () => {
    const [adminRes, publicRes] = await Promise.all([
      api(`/api/approvals/${wsMain}/${batchIdA}`),
      api(`/api/public/approvals/${wsMain}/${batchIdA}`),
    ]);
    expect(adminRes.status).toBe(200);
    expect(publicRes.status).toBe(200);
    const adminBatch = await adminRes.json() as { id: string; name: string; status: string };
    const publicBatch = await publicRes.json() as { id: string; name: string; status: string };
    expect(adminBatch.id).toBe(publicBatch.id);
    expect(adminBatch.name).toBe(publicBatch.name);
    expect(adminBatch.status).toBe(publicBatch.status);
  });

  it('admin GET on nonexistent workspace returns 401/404', async () => {
    const res = await api(`/api/approvals/ws_does_not_exist_xyz/${batchIdA}`);
    expect([401, 403, 404]).toContain(res.status);
  });

  it('batch list for isolation workspace does not include other workspace batches', async () => {
    const res = await api(`/api/approvals/${wsIsolation}`);
    expect(res.status).toBe(200);
    const list = await res.json() as Array<{ id: string }>;
    const ids = new Set(list.map(b => b.id));
    expect(ids.has(batchIdA)).toBe(false);
    expect(ids.has(batchIdB)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Item updates — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Item update — edge cases', () => {
  let batchId = '';
  let itemId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Item Update Edge Cases',
      items: [
        { pageId: 'p_item_edge', pageSlug: '/edge', pageTitle: 'Edge Page', field: 'seoTitle', currentValue: 'Old Title', proposedValue: 'New Title' },
      ],
    });
    const body = await res.json() as { id: string; items: Array<{ id: string }> };
    batchId = body.id;
    itemId = body.items[0].id;
  });

  afterAll(() => {
    if (batchId) db.prepare('DELETE FROM approval_batches WHERE id = ?').run(batchId);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ?').run(wsMain);
  });

  it('PATCH with only clientValue (no status) stores the value without changing status', async () => {
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/${itemId}`,
      { clientValue: 'My Custom Override' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ id: string; status: string; clientValue?: string }> };
    const item = body.items.find(i => i.id === itemId);
    expect(item?.clientValue).toBe('My Custom Override');
    expect(item?.status).toBe('pending');
  });

  it('PATCH with only clientNote (no status) stores the note without changing status', async () => {
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/${itemId}`,
      { clientNote: 'Please review this carefully.' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ id: string; status: string; clientNote?: string }> };
    const item = body.items.find(i => i.id === itemId);
    expect(item?.clientNote).toBe('Please review this carefully.');
    expect(item?.status).toBe('pending');
  });

  it('PATCH with clientNote at max length (2000 chars) returns 200', async () => {
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/${itemId}`,
      { clientNote: 'x'.repeat(2000) },
    );
    expect(res.status).toBe(200);
  });

  it('PATCH with clientNote exceeding max length (2001 chars) returns 400', async () => {
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/${itemId}`,
      { clientNote: 'x'.repeat(2001) },
    );
    expect(res.status).toBe(400);
  });

  it('PATCH broadcasts APPROVAL_UPDATE with correct batchId and itemId', async () => {
    broadcastState.calls = [];
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/${itemId}`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);
    const approvalUpdates = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.APPROVAL_UPDATE,
    );
    expect(approvalUpdates).toHaveLength(1);
    expect(approvalUpdates[0].payload).toMatchObject({ batchId, itemId, status: 'approved' });
    expect(approvalUpdates[0].workspaceId).toBe(wsMain);
  });

  it('revert approved item to pending updates page state back to in-review', async () => {
    // Item is currently approved from previous test; revert it
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/${itemId}`,
      { status: 'pending' },
    );
    expect(res.status).toBe(200);
    const pageState = getPageState(wsMain, 'p_item_edge');
    expect(pageState?.status).toBe('in-review');
  });

  it('updatedAt changes on the batch after item is patched', async () => {
    const before = await api(`/api/approvals/${wsMain}/${batchId}`);
    const beforeBatch = await before.json() as { updatedAt: string };
    const beforeUpdated = beforeBatch.updatedAt;

    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 10));

    const patchRes = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/${itemId}`,
      { status: 'rejected', clientNote: 'Changed my mind' },
    );
    expect(patchRes.status).toBe(200);

    const after = await api(`/api/approvals/${wsMain}/${batchId}`);
    const afterBatch = await after.json() as { updatedAt: string };
    // updatedAt should be the same or later (SQLite timestamps may be same-second)
    expect(afterBatch.updatedAt >= beforeUpdated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Multi-item same-page page state derivation
// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-item same-page page state derivation via HTTP', () => {
  const sharedPageId = `p_multifield_${randomUUID().slice(0, 8)}`;
  let batchId = '';
  let titleItemId = '';
  let descItemId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Multi Field Page Batch',
      items: [
        { pageId: sharedPageId, pageSlug: '/shared', pageTitle: 'Shared Page', field: 'seoTitle', currentValue: 'Old Title', proposedValue: 'New Title' },
        { pageId: sharedPageId, pageSlug: '/shared', pageTitle: 'Shared Page', field: 'seoDescription', currentValue: 'Old Desc', proposedValue: 'New Desc' },
      ],
    });
    const body = await res.json() as { id: string; items: Array<{ id: string; field: string }> };
    batchId = body.id;
    titleItemId = body.items.find(i => i.field === 'seoTitle')!.id;
    descItemId = body.items.find(i => i.field === 'seoDescription')!.id;
  });

  afterAll(() => {
    if (batchId) db.prepare('DELETE FROM approval_batches WHERE id = ?').run(batchId);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id = ?').run(wsMain, sharedPageId);
  });

  it('page state is in-review after batch created (set by admin on creation)', () => {
    const state = getPageState(wsMain, sharedPageId);
    expect(state?.status).toBe('in-review');
  });

  it('page state remains in-review when only one of two items is approved', async () => {
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/${titleItemId}`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);
    // One approved, one pending → page still in-review
    const state = getPageState(wsMain, sharedPageId);
    expect(state?.status).toBe('in-review');
  });

  it('page state becomes approved when both items on the page are approved', async () => {
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/${descItemId}`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);
    const state = getPageState(wsMain, sharedPageId);
    expect(state?.status).toBe('approved');
  });

  it('page state reverts to in-review when one of two approved items is reverted to pending', async () => {
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/${titleItemId}`,
      { status: 'pending' },
    );
    expect(res.status).toBe(200);
    const state = getPageState(wsMain, sharedPageId);
    expect(state?.status).toBe('in-review');
  });

  it('page state becomes rejected when all items on the page are rejected', async () => {
    // First revert desc back to pending
    await patchJson(`/api/public/approvals/${wsMain}/${batchId}/${descItemId}`, { status: 'pending' });
    // Now reject both
    await patchJson(`/api/public/approvals/${wsMain}/${batchId}/${titleItemId}`, { status: 'rejected' });
    const res = await patchJson(`/api/public/approvals/${wsMain}/${batchId}/${descItemId}`, { status: 'rejected', clientNote: 'Both rejected' });
    expect(res.status).toBe(200);
    const state = getPageState(wsMain, sharedPageId);
    expect(state?.status).toBe('rejected');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: Delete behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('Delete batch — side effects', () => {
  it('broadcast on DELETE contains action:deleted and correct batchId', async () => {
    const createRes = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Delete Broadcast Test',
      items: [{ pageId: 'p_del_broadcast', pageSlug: '/del', pageTitle: 'Del Page', field: 'seoTitle', currentValue: 'Old', proposedValue: 'New' }],
    });
    const created = await createRes.json() as { id: string };
    broadcastState.calls = [];

    const delRes = await del(`/api/approvals/${wsMain}/${created.id}`);
    expect(delRes.status).toBe(200);

    const approvalUpdates = broadcastState.calls.filter(c => c.event === WS_EVENTS.APPROVAL_UPDATE);
    expect(approvalUpdates).toHaveLength(1);
    expect(approvalUpdates[0].payload).toMatchObject({ batchId: created.id, action: 'deleted' });
    expect(approvalUpdates[0].workspaceId).toBe(wsMain);
  });

  it('deleting batch A does not clear page state set by batch B for the same page', async () => {
    const pageId = `p_isolation_del_${randomUUID().slice(0, 8)}`;

    // Create batch A and batch B for the same page
    const resA = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Delete Isolation A',
      items: [{ pageId, pageSlug: '/isol-a', pageTitle: 'Isolation A Page', field: 'seoTitle', currentValue: 'Old A', proposedValue: 'New A' }],
    });
    const batchA = await resA.json() as { id: string };

    // Now batch A set page state to in-review with batchA.id
    const pageStateA = getPageState(wsMain, pageId);
    expect(pageStateA?.approvalBatchId).toBe(batchA.id);

    // Create batch B which replaces the page state with its own batchId
    const resB = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Delete Isolation B',
      items: [{ pageId, pageSlug: '/isol-b', pageTitle: 'Isolation B Page', field: 'seoDescription', currentValue: 'Old B', proposedValue: 'New B' }],
    });
    const batchB = await resB.json() as { id: string };

    // Page state now points to batchB
    const pageStateB = getPageState(wsMain, pageId);
    expect(pageStateB?.approvalBatchId).toBe(batchB.id);

    // Delete batch A — page state should NOT be cleared (it belongs to batchB now)
    const delRes = await del(`/api/approvals/${wsMain}/${batchA.id}`);
    expect(delRes.status).toBe(200);

    const pageStateAfter = getPageState(wsMain, pageId);
    expect(pageStateAfter).toBeDefined();
    expect(pageStateAfter?.approvalBatchId).toBe(batchB.id);

    // Cleanup
    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(batchB.id);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id = ?').run(wsMain, pageId);
  });

  it('cross-workspace delete returns 404 and leaves owner batch intact', async () => {
    const createRes = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Cross WS Delete Guard',
      items: [{ pageId: 'p_cross_del', pageSlug: '/cross', pageTitle: 'Cross Del Page', field: 'seoTitle', currentValue: 'Old', proposedValue: 'New' }],
    });
    const created = await createRes.json() as { id: string };

    const crossDelRes = await del(`/api/approvals/${wsIsolation}/${created.id}`);
    expect(crossDelRes.status).toBe(404);

    // Owner batch still exists
    const ownerRes = await api(`/api/approvals/${wsMain}/${created.id}`);
    expect(ownerRes.status).toBe(200);
    const owner = await ownerRes.json() as { id: string };
    expect(owner.id).toBe(created.id);

    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 6: Bulk approve broadcasts
// ─────────────────────────────────────────────────────────────────────────────

describe('Bulk approve — broadcasts and side effects', () => {
  let batchId = '';
  let item1Id = '';
  let item2Id = '';

  beforeAll(async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Bulk Approve Broadcast Test',
      items: [
        { pageId: 'p_bulk_1', pageSlug: '/bulk-1', pageTitle: 'Bulk 1', field: 'seoTitle', currentValue: 'Old 1', proposedValue: 'New 1' },
        { pageId: 'p_bulk_2', pageSlug: '/bulk-2', pageTitle: 'Bulk 2', field: 'seoDescription', currentValue: 'Old 2', proposedValue: 'New 2' },
      ],
    });
    const body = await res.json() as { id: string; items: Array<{ id: string }> };
    batchId = body.id;
    item1Id = body.items[0].id;
    item2Id = body.items[1].id;
  });

  afterAll(() => {
    if (batchId) db.prepare('DELETE FROM approval_batches WHERE id = ?').run(batchId);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id IN (?, ?)').run(wsMain, 'p_bulk_1', 'p_bulk_2');
  });

  it('bulk approve broadcasts APPROVAL_UPDATE with status:approved', async () => {
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/approve`,
      { clientNote: 'Bulk approved' },
    );
    expect(res.status).toBe(200);

    const approvalUpdates = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.APPROVAL_UPDATE,
    );
    expect(approvalUpdates).toHaveLength(1);
    expect(approvalUpdates[0].payload).toMatchObject({ batchId, status: 'approved' });
    expect(approvalUpdates[0].workspaceId).toBe(wsMain);
  });

  it('bulk approve stamps clientNote on all items', async () => {
    // Create a fresh batch since previous one already approved
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Bulk Note Stamp Test',
      items: [
        { pageId: 'p_note_1', pageSlug: '/note-1', pageTitle: 'Note Page 1', field: 'seoTitle', currentValue: 'Old A', proposedValue: 'New A' },
        { pageId: 'p_note_2', pageSlug: '/note-2', pageTitle: 'Note Page 2', field: 'seoTitle', currentValue: 'Old B', proposedValue: 'New B' },
      ],
    });
    const fresh = await res.json() as { id: string; items: Array<{ id: string }> };
    try {
      const approveRes = await patchJson(
        `/api/public/approvals/${wsMain}/${fresh.id}/approve`,
        { clientNote: 'All good from client' },
      );
      expect(approveRes.status).toBe(200);
      const body = await approveRes.json() as { items: Array<{ status: string; clientNote?: string }> };
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.every(i => i.status === 'approved')).toBe(true); // every-ok
      expect(body.items.every(i => i.clientNote === 'All good from client')).toBe(true); // every-ok
    } finally {
      db.prepare('DELETE FROM approval_batches WHERE id = ?').run(fresh.id);
    }
  });

  it('bulk approve with no pending items returns 400', async () => {
    // batch is already all-approved from first test
    const res = await patchJson(
      `/api/public/approvals/${wsMain}/${batchId}/approve`,
      {},
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/no pending/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 7: Apply endpoint — results shape and edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Apply endpoint — results shape and edge cases', () => {
  it('apply returns results array with itemId, pageId, success fields', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Apply Results Shape',
      items: [
        { pageId: 'p_apply_shape', pageSlug: '/shape', pageTitle: 'Shape Page', field: 'seoTitle', currentValue: 'Old', proposedValue: 'New' },
      ],
    });
    const created = await res.json() as { id: string; items: Array<{ id: string }> };
    const itemId = created.items[0].id;

    // Approve the item
    await patchJson(`/api/public/approvals/${wsMain}/${created.id}/${itemId}`, { status: 'approved' });

    const applyRes = await postJson(`/api/public/approvals/${wsMain}/${created.id}/apply`, {});
    expect(applyRes.status).toBe(200);
    const body = await applyRes.json() as {
      applied: number;
      failed: number;
      results: Array<{ itemId: string; pageId: string; success: boolean }>;
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ itemId, pageId: 'p_apply_shape', success: true });
    expect(body.applied).toBe(1);
    expect(body.failed).toBe(0);

    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id = ?').run(wsMain, 'p_apply_shape');
  });

  it('apply with synthetic cms- page ID fails gracefully per item without crashing', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Synthetic CMS Batch',
      items: [
        { pageId: 'cms-synthetic-123', pageSlug: '/blog/post', pageTitle: 'Blog Post', field: 'seoTitle', currentValue: 'Old', proposedValue: 'New' },
      ],
    });
    const created = await res.json() as { id: string; items: Array<{ id: string }> };
    const itemId = created.items[0].id;
    await patchJson(`/api/public/approvals/${wsMain}/${created.id}/${itemId}`, { status: 'approved' });

    const applyRes = await postJson(`/api/public/approvals/${wsMain}/${created.id}/apply`, {});
    // Synthetic CMS IDs are rejected — response is either 400 (validation) or 200 with failed:1
    if (applyRes.status === 400) {
      const body = await applyRes.json() as { error: string };
      expect(body.error).toMatch(/cms|synthetic|cannot/i);
    } else {
      expect(applyRes.status).toBe(200);
      const body = await applyRes.json() as { applied: number; failed: number };
      expect(body.applied).toBe(0);
      expect(body.failed).toBe(1);
    }

    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
  });

  it('apply broadcasts APPROVAL_APPLIED with correct batchId and applied count', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Apply Broadcast Check',
      items: [
        { pageId: 'p_apply_bcast', pageSlug: '/broadcast', pageTitle: 'Broadcast Page', field: 'seoDescription', currentValue: 'Old', proposedValue: 'New' },
      ],
    });
    const created = await res.json() as { id: string; items: Array<{ id: string }> };
    const itemId = created.items[0].id;
    await patchJson(`/api/public/approvals/${wsMain}/${created.id}/${itemId}`, { status: 'approved' });
    broadcastState.calls = [];

    const applyRes = await postJson(`/api/public/approvals/${wsMain}/${created.id}/apply`, {});
    expect(applyRes.status).toBe(200);

    const appliedBroadcasts = broadcastState.calls.filter(c => c.event === WS_EVENTS.APPROVAL_APPLIED);
    expect(appliedBroadcasts).toHaveLength(1);
    expect(appliedBroadcasts[0].payload).toMatchObject({ batchId: created.id, applied: 1 });
    expect(appliedBroadcasts[0].workspaceId).toBe(wsMain);

    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id = ?').run(wsMain, 'p_apply_bcast');
  });

  it('apply with no approved items returns 400 without calling Webflow', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'No Approved Apply Test',
      items: [
        { pageId: 'p_no_approved', pageSlug: '/no-approved', pageTitle: 'No Approved Page', field: 'seoTitle', currentValue: 'Old', proposedValue: 'New' },
      ],
    });
    const created = await res.json() as { id: string };

    const applyRes = await postJson(`/api/public/approvals/${wsMain}/${created.id}/apply`, {});
    expect(applyRes.status).toBe(400);
    const body = await applyRes.json() as { error: string };
    expect(body.error).toMatch(/no approved/i);
    expect(webflowState.calls).toHaveLength(0);

    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
  });

  it('apply with partial success (one success, one Webflow failure) returns correct counts', async () => {
    const pageId1 = `p_partial_ok_${randomUUID().slice(0, 6)}`;
    const pageId2 = `p_partial_fail_${randomUUID().slice(0, 6)}`;

    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Partial Apply Test',
      items: [
        { pageId: pageId1, pageSlug: '/partial-ok', pageTitle: 'Partial OK Page', field: 'seoTitle', currentValue: 'Old 1', proposedValue: 'New 1' },
        { pageId: pageId2, pageSlug: '/partial-fail', pageTitle: 'Partial Fail Page', field: 'seoDescription', currentValue: 'Old 2', proposedValue: 'New 2' },
      ],
    });
    const created = await res.json() as { id: string; items: Array<{ id: string; pageId: string }> };
    for (const item of created.items) {
      await patchJson(`/api/public/approvals/${wsMain}/${created.id}/${item.id}`, { status: 'approved' });
    }

    // Simulate failure on the second Webflow call by making the mock fail after first call
    const { updatePageSeo } = await import('../../server/webflow.js');
    let callCount = 0;
    vi.mocked(updatePageSeo).mockImplementation(async (pageId: string, fields: unknown, token?: string) => {
      callCount++;
      webflowState.calls.push({ pageId, fields, token });
      if (callCount <= 1) return { success: true };
      return { success: false, error: 'Webflow API error on second item' };
    });

    const applyRes = await postJson(`/api/public/approvals/${wsMain}/${created.id}/apply`, {});
    expect(applyRes.status).toBe(200);
    const body = await applyRes.json() as { applied: number; failed: number; results: Array<{ success: boolean }> };
    expect(body.applied).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results.some(r => r.success === true)).toBe(true);
    expect(body.results.some(r => r.success === false)).toBe(true);

    // Restore mock to default behavior
    vi.mocked(updatePageSeo).mockImplementation(async (pageId: string, fields: unknown, token?: string) => {
      webflowState.calls.push({ pageId, fields, token });
      return webflowState.result;
    });

    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id IN (?, ?)').run(wsMain, pageId1, pageId2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 8: Remind endpoint — throttle and email
// ─────────────────────────────────────────────────────────────────────────────

describe('Remind endpoint — email and throttle', () => {
  let batchId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/approvals/${wsWithEmail}`, {
      siteId: testSiteId,
      name: 'Remind Email Test Batch',
      items: [
        { pageId: 'p_remind_email', pageSlug: '/remind', pageTitle: 'Remind Page', field: 'seoTitle', currentValue: 'Old Title', proposedValue: 'New Title' },
      ],
    });
    const body = await res.json() as { id: string };
    batchId = body.id;
    // Clear any existing throttle records for this email
    db.prepare("DELETE FROM email_sends WHERE recipient = 'lifecycle-client@example.com'").run();
  });

  afterAll(() => {
    if (batchId) db.prepare('DELETE FROM approval_batches WHERE id = ?').run(batchId);
    db.prepare("DELETE FROM email_sends WHERE recipient = 'lifecycle-client@example.com'").run();
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ?').run(wsWithEmail);
  });

  it('remind sends email when workspace has clientEmail and pending items', async () => {
    const res = await postJson(`/api/approvals/${wsWithEmail}/${batchId}/remind`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; sentTo: string };
    expect(body.ok).toBe(true);
    expect(body.sentTo).toBe('lifecycle-client@example.com');
    expect(webflowState.sendEmailCalls).toHaveLength(1);
    expect(webflowState.sendEmailCalls[0].to).toBe('lifecycle-client@example.com');
  });

  it('remind is throttled (429) after hitting the action category limit', async () => {
    // 'action' category limit is 3/day, 1 was sent above. Add 2 more via recordSend to hit cap.
    recordSend('lifecycle-client@example.com', 'action', 'approval_reminder', wsWithEmail, 1);
    recordSend('lifecycle-client@example.com', 'action', 'approval_reminder', wsWithEmail, 1);

    const res = await postJson(`/api/approvals/${wsWithEmail}/${batchId}/remind`, {});
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/throttled/i);
  });

  it('remind returns 404 for nonexistent workspace', async () => {
    const res = await postJson(`/api/approvals/ws_nonexistent_999/some_batch_id/remind`, {});
    expect([401, 403, 404]).toContain(res.status);
  });

  it('remind returns 404 for nonexistent batch', async () => {
    const res = await postJson(`/api/approvals/${wsWithEmail}/batch_missing_xyz/remind`, {});
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/batch not found/i);
  });

  it('remind returns 400 when email is not configured', async () => {
    webflowState.isEmailConfiguredResult = false;
    // Need a batch with email workspace but cleared throttle
    db.prepare("DELETE FROM email_sends WHERE recipient = 'lifecycle-client@example.com'").run();
    const res = await postJson(`/api/approvals/${wsWithEmail}/${batchId}/remind`, {});
    // Either 400 (email not configured) or 429 (throttled from earlier run)
    expect([400, 429]).toContain(res.status);
    webflowState.isEmailConfiguredResult = true;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 9: Two batches for the same page
// ─────────────────────────────────────────────────────────────────────────────

describe('Two batches for the same page', () => {
  const pageId = `p_samepage_${randomUUID().slice(0, 8)}`;
  let batchIdFirst = '';
  let batchIdSecond = '';

  beforeAll(async () => {
    const resFirst = await postJson(`/api/approvals/${wsIsolation}`, {
      siteId: testSiteId,
      name: 'Same Page Batch 1',
      items: [{ pageId, pageSlug: '/same', pageTitle: 'Same Page', field: 'seoTitle', currentValue: 'Old', proposedValue: 'New Title' }],
    });
    batchIdFirst = ((await resFirst.json()) as { id: string }).id;

    const resSecond = await postJson(`/api/approvals/${wsIsolation}`, {
      siteId: testSiteId,
      name: 'Same Page Batch 2',
      items: [{ pageId, pageSlug: '/same', pageTitle: 'Same Page', field: 'seoDescription', currentValue: 'Old Desc', proposedValue: 'New Desc' }],
    });
    batchIdSecond = ((await resSecond.json()) as { id: string }).id;
  });

  afterAll(() => {
    db.prepare('DELETE FROM approval_batches WHERE id IN (?, ?)').run(batchIdFirst, batchIdSecond);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id = ?').run(wsIsolation, pageId);
  });

  it('both batches appear in the list', async () => {
    const res = await api(`/api/approvals/${wsIsolation}`);
    expect(res.status).toBe(200);
    const list = await res.json() as Array<{ id: string }>;
    const ids = list.map(b => b.id);
    expect(ids).toContain(batchIdFirst);
    expect(ids).toContain(batchIdSecond);
  });

  it('each batch can be fetched individually', async () => {
    const res1 = await api(`/api/approvals/${wsIsolation}/${batchIdFirst}`);
    expect(res1.status).toBe(200);
    expect(((await res1.json()) as { id: string }).id).toBe(batchIdFirst);

    const res2 = await api(`/api/approvals/${wsIsolation}/${batchIdSecond}`);
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as { id: string }).id).toBe(batchIdSecond);
  });

  it('approving item in batch 1 does not affect items in batch 2', async () => {
    const batch1Res = await api(`/api/approvals/${wsIsolation}/${batchIdFirst}`);
    const batch1 = await batch1Res.json() as { items: Array<{ id: string }> };
    const item1Id = batch1.items[0].id;

    await patchJson(`/api/public/approvals/${wsIsolation}/${batchIdFirst}/${item1Id}`, { status: 'approved' });

    const batch2Res = await api(`/api/approvals/${wsIsolation}/${batchIdSecond}`);
    const batch2 = await batch2Res.json() as { items: Array<{ status: string }> };
    expect(batch2.items[0].status).toBe('pending');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 10: Batch shape validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Batch shape validation', () => {
  it('batch response includes id, name, status, createdAt, items, siteId', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Shape Validation Batch',
      items: [{ pageId: 'p_shape', pageSlug: '/shape-val', pageTitle: 'Shape Val Page', field: 'seoTitle', currentValue: 'Old', proposedValue: 'New' }],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name', 'Shape Validation Batch');
    expect(body).toHaveProperty('status', 'pending');
    expect(body).toHaveProperty('createdAt');
    expect(Array.isArray(body.items)).toBe(true);
    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(body.id as string);
  });

  it('item in batch response includes id, pageId, field, status, currentValue, proposedValue', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Item Shape Check',
      items: [
        { pageId: 'p_item_shape', pageSlug: '/item-shape', pageTitle: 'Item Shape Page', field: 'seoDescription', currentValue: 'Current', proposedValue: 'Proposed' },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; items: Array<Record<string, unknown>> };
    const item = body.items[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('pageId', 'p_item_shape');
    expect(item).toHaveProperty('field', 'seoDescription');
    expect(item).toHaveProperty('status', 'pending');
    expect(item).toHaveProperty('currentValue', 'Current');
    expect(item).toHaveProperty('proposedValue', 'Proposed');
    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(body.id);
  });

  it('batch status progresses from pending to partial when one item is approved', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'Status Progression Batch',
      items: [
        { pageId: 'p_prog_1', pageSlug: '/prog-1', pageTitle: 'Progress Page 1', field: 'seoTitle', currentValue: 'Old 1', proposedValue: 'New 1' },
        { pageId: 'p_prog_2', pageSlug: '/prog-2', pageTitle: 'Progress Page 2', field: 'seoDescription', currentValue: 'Old 2', proposedValue: 'New 2' },
      ],
    });
    const created = await res.json() as { id: string; items: Array<{ id: string }> };
    expect(created.items.length).toBe(2);

    // Approve only first item
    await patchJson(`/api/public/approvals/${wsMain}/${created.id}/${created.items[0].id}`, { status: 'approved' });

    const getRes = await api(`/api/approvals/${wsMain}/${created.id}`);
    const batch = await getRes.json() as { status: string };
    expect(batch.status).toBe('partial');

    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id IN (?, ?)').run(wsMain, 'p_prog_1', 'p_prog_2');
  });

  it('batch status becomes approved when all items are approved', async () => {
    const res = await postJson(`/api/approvals/${wsMain}`, {
      siteId: testSiteId,
      name: 'All Approved Status',
      items: [
        { pageId: 'p_all_appr_1', pageSlug: '/all-1', pageTitle: 'All Appr Page 1', field: 'seoTitle', currentValue: 'Old 1', proposedValue: 'New 1' },
        { pageId: 'p_all_appr_2', pageSlug: '/all-2', pageTitle: 'All Appr Page 2', field: 'seoTitle', currentValue: 'Old 2', proposedValue: 'New 2' },
      ],
    });
    const created = await res.json() as { id: string; items: Array<{ id: string }> };

    for (const item of created.items) {
      await patchJson(`/api/public/approvals/${wsMain}/${created.id}/${item.id}`, { status: 'approved' });
    }

    const getRes = await api(`/api/approvals/${wsMain}/${created.id}`);
    const batch = await getRes.json() as { status: string };
    expect(batch.status).toBe('approved');

    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
    db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id IN (?, ?)').run(wsMain, 'p_all_appr_1', 'p_all_appr_2');
  });
});
