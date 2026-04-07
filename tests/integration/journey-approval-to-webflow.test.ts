/**
 * Journey Test: Approval-to-Webflow Publish
 *
 * Full approval-to-publish journey: Create SEO edit batch -> client reviews ->
 * client approves items -> apply to Webflow -> changes verified.
 *
 * Failure modes covered:
 *   FM-2 (phantom success) — Webflow fails but item is marked applied anyway
 *   FM-5 (partial application) — some items succeed, some fail, wrong set marked
 *   FM-12 (broken chain) — state transitions break mid-workflow
 *
 * Tests work at function level (no HTTP server). Webflow calls are mocked via
 * setupWebflowMocks() which intercepts webflow-client.js at module level.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setupWebflowMocks,
  mockWebflowSuccess,
  mockWebflowError,
  getCapturedRequests,
  resetWebflowMocks,
} from '../mocks/webflow.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type { ApprovalItem } from '../../shared/types/approvals.js';

// ── Module-level mocks (hoisted by Vitest) ──
setupWebflowMocks();

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// ── Server imports (after mock registration) ──
import {
  createBatch,
  getBatch,
  updateItem,
  markBatchApplied,
} from '../../server/approvals.js';
import { updatePageSeo } from '../../server/webflow.js';
import { parseJsonFallback } from '../../server/db/json-validation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Replicate the apply loop from server/routes/approvals.ts.
 * Iterates approved items, calls updatePageSeo per item, catches per-item
 * errors, and only marks successful items as applied.
 */
async function runApplyLoop(
  workspaceId: string,
  batchId: string,
  siteId: string,
  token: string,
): Promise<{
  results: Array<{ itemId: string; pageId: string; success: boolean; error?: string }>;
  appliedIds: string[];
}> {
  const batch = getBatch(workspaceId, batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  const approved = batch.items.filter(i => i.status === 'approved');
  const results: Array<{ itemId: string; pageId: string; success: boolean; error?: string }> = [];
  const appliedIds: string[] = [];

  for (const item of approved) {
    try {
      if (item.pageId.startsWith('cms-')) {
        throw new Error(
          'CMS pages discovered via sitemap must be updated directly in Webflow — synthetic page ID cannot be written via the API',
        );
      }

      const value = item.clientValue || item.proposedValue;

      if (item.field === 'schema') {
        const schema = parseJsonFallback(value, null);
        if (!schema) throw new Error('Invalid schema JSON');
        // Schema publishing not tested in this journey file; covered in approval-execution.test.ts
        throw new Error('Schema field not supported in this journey test');
      } else {
        const fields =
          item.field === 'seoTitle'
            ? { seo: { title: value } }
            : { seo: { description: value } };
        const seoResult = await updatePageSeo(item.pageId, fields, token);
        if (!seoResult.success) throw new Error(seoResult.error || 'SEO update failed');
      }

      appliedIds.push(item.id);
      results.push({ itemId: item.id, pageId: item.pageId, success: true });
    } catch (err) {
      results.push({
        itemId: item.id,
        pageId: item.pageId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (appliedIds.length > 0) {
    markBatchApplied(workspaceId, batchId, appliedIds);
  }

  return { results, appliedIds };
}

/** Helper: build an array of SEO title items for createBatch */
function makeItems(count: number, field: 'seoTitle' | 'seoDescription' = 'seoTitle') {
  return Array.from({ length: count }, (_, i) => ({
    pageId: `page-${String(i + 1).padStart(3, '0')}`,
    pageTitle: `Page ${i + 1}`,
    pageSlug: `page-${i + 1}`,
    field,
    currentValue: `Old Title ${i + 1}`,
    proposedValue: `New Title ${i + 1}`,
  }));
}

/** Helper: index batch items by pageId for readable assertions */
function itemsByPage(batch: { items: ApprovalItem[] }): Record<string, ApprovalItem> {
  const map: Record<string, ApprovalItem> = {};
  for (const item of batch.items) map[item.pageId] = item;
  return map;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let ws: SeededFullWorkspace;

beforeEach(() => {
  ws = seedWorkspace();
  resetWebflowMocks();
});

afterEach(() => {
  ws.cleanup();
  resetWebflowMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Journey tests
// ---------------------------------------------------------------------------

describe('Journey: Approval-to-Webflow Publish', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. Full journey: create -> approve -> apply -> verified
  // ──────────────────────────────────────────────────────────────────────────

  it('full journey: create 3 items, approve all, apply all, all become applied', async () => {
    // Mock all 3 page endpoints to succeed
    mockWebflowSuccess(/\/pages\/page-001/, { id: 'page-001' });
    mockWebflowSuccess(/\/pages\/page-002/, { id: 'page-002' });
    mockWebflowSuccess(/\/pages\/page-003/, { id: 'page-003' });

    // Step 1: Create batch with 3 SEO title items
    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'SEO Titles Batch', makeItems(3));
    expect(batch.items).toHaveLength(3);
    expect(batch.status).toBe('pending');
    expect(batch.items.every(i => i.status === 'pending')).toBe(true);

    // Step 2: Approve all 3 items
    for (const item of batch.items) {
      updateItem(ws.workspaceId, batch.id, item.id, { status: 'approved' });
    }
    const afterApprove = getBatch(ws.workspaceId, batch.id)!;
    expect(afterApprove.items.length).toBeGreaterThan(0);
    expect(afterApprove.items.every(i => i.status === 'approved')).toBe(true);
    expect(afterApprove.status).toBe('approved');

    // Step 3: Run apply loop
    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId, batch.id, ws.webflowSiteId, ws.webflowToken,
    );

    // Step 4: Verify all 3 succeeded
    expect(appliedIds).toHaveLength(3);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);

    // Step 5: DB verification — all items 'applied', batch status 'applied'
    const final = getBatch(ws.workspaceId, batch.id)!;
    expect(final.items).toHaveLength(3);
    expect(final.items.every(i => i.status === 'applied')).toBe(true);
    expect(final.status).toBe('applied');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Selective approval: approve 2 of 3, only approved items sent to Webflow
  // ──────────────────────────────────────────────────────────────────────────

  it('selective approval: approve 2 of 3, only approved items sent to Webflow', async () => {
    mockWebflowSuccess(/\/pages\/page-001/, { id: 'page-001' });
    mockWebflowSuccess(/\/pages\/page-002/, { id: 'page-002' });

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Selective Batch', makeItems(3));

    // Approve items 0 and 1, leave item 2 as pending
    updateItem(ws.workspaceId, batch.id, batch.items[0].id, { status: 'approved' });
    updateItem(ws.workspaceId, batch.id, batch.items[1].id, { status: 'approved' });
    // items[2] stays 'pending'

    const afterApprove = getBatch(ws.workspaceId, batch.id)!;
    expect(afterApprove.status).toBe('partial');

    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId, batch.id, ws.webflowSiteId, ws.webflowToken,
    );

    // Only 2 items processed
    expect(results).toHaveLength(2);
    expect(appliedIds).toHaveLength(2);

    // Webflow called exactly 2 times
    const captured = getCapturedRequests();
    const pagePuts = captured.filter(r => r.method === 'PUT' && r.endpoint.includes('/pages/'));
    expect(pagePuts).toHaveLength(2);

    // DB: 2 applied, 1 still pending
    const final = getBatch(ws.workspaceId, batch.id)!;
    const byPage = itemsByPage(final);
    expect(byPage['page-001'].status).toBe('applied');
    expect(byPage['page-002'].status).toBe('applied');
    expect(byPage['page-003'].status).toBe('pending');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Partial failure (FM-5): 1 of 2 Webflow calls fail
  // ──────────────────────────────────────────────────────────────────────────

  it('partial failure (FM-5): 1 of 2 succeeds, failed item stays approved', async () => {
    mockWebflowSuccess(/\/pages\/page-001/, { id: 'page-001' });
    mockWebflowError(/\/pages\/page-002/, 500, 'Internal Server Error');

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Partial Failure', [
      { pageId: 'page-001', pageTitle: 'Page 1', pageSlug: 'page-1', field: 'seoTitle', currentValue: 'Old 1', proposedValue: 'New 1' },
      { pageId: 'page-002', pageTitle: 'Page 2', pageSlug: 'page-2', field: 'seoTitle', currentValue: 'Old 2', proposedValue: 'New 2' },
    ]);

    // Approve both
    for (const item of batch.items) {
      updateItem(ws.workspaceId, batch.id, item.id, { status: 'approved' });
    }

    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId, batch.id, ws.webflowSiteId, ws.webflowToken,
    );

    // Only page-001 succeeded
    expect(appliedIds).toHaveLength(1);
    expect(results).toHaveLength(2);

    const successResult = results.find(r => r.pageId === 'page-001');
    const failResult = results.find(r => r.pageId === 'page-002');
    expect(successResult!.success).toBe(true);
    expect(failResult!.success).toBe(false);
    expect(failResult!.error).toBeTruthy();

    // DB: page-001 applied, page-002 stays approved
    const final = getBatch(ws.workspaceId, batch.id)!;
    const byPage = itemsByPage(final);
    expect(byPage['page-001'].status).toBe('applied');
    expect(byPage['page-002'].status).toBe('approved');

    // Batch status should NOT be 'applied' (partial)
    expect(final.status).not.toBe('applied');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. All fail -> no items applied (FM-2)
  // ──────────────────────────────────────────────────────────────────────────

  it('all Webflow calls fail (FM-2): zero items applied, all stay approved', async () => {
    mockWebflowError(/\/pages\//, 500, 'Internal Server Error');

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'All Fail', makeItems(3));

    // Approve all
    for (const item of batch.items) {
      updateItem(ws.workspaceId, batch.id, item.id, { status: 'approved' });
    }

    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId, batch.id, ws.webflowSiteId, ws.webflowToken,
    );

    expect(appliedIds).toHaveLength(0);
    expect(results).toHaveLength(3);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.success === false)).toBe(true);

    // DB: no items applied
    const final = getBatch(ws.workspaceId, batch.id)!;
    expect(final.items.length).toBeGreaterThan(0);
    expect(final.items.every(i => i.status === 'approved')).toBe(true);
    expect(final.status).not.toBe('applied');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Client edits: clientValue overrides proposedValue
  // ──────────────────────────────────────────────────────────────────────────

  it('client edits: clientValue overrides proposedValue sent to Webflow', async () => {
    mockWebflowSuccess(/\/pages\/page-001/, { id: 'page-001' });

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Client Edit', [
      { pageId: 'page-001', pageTitle: 'Page 1', pageSlug: 'page-1', field: 'seoTitle', currentValue: 'Old Title', proposedValue: 'Proposed Title' },
    ]);

    // Client edits the value and approves
    updateItem(ws.workspaceId, batch.id, batch.items[0].id, {
      clientValue: 'Client Edited Title',
    });
    updateItem(ws.workspaceId, batch.id, batch.items[0].id, {
      status: 'approved',
    });

    // Verify clientValue is persisted
    const beforeApply = getBatch(ws.workspaceId, batch.id)!;
    expect(beforeApply.items[0].clientValue).toBe('Client Edited Title');

    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId, batch.id, ws.webflowSiteId, ws.webflowToken,
    );

    expect(appliedIds).toHaveLength(1);
    expect(results[0].success).toBe(true);

    // Verify Webflow received the client-edited value, not the proposed value
    const captured = getCapturedRequests();
    const pagePut = captured.find(r => r.method === 'PUT' && r.endpoint.includes('/pages/page-001'));
    expect(pagePut).toBeDefined();
    expect(pagePut!.body).toEqual({ seo: { title: 'Client Edited Title' } });

    // DB: item applied
    const final = getBatch(ws.workspaceId, batch.id)!;
    expect(final.items[0].status).toBe('applied');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Reject item: rejected items skipped in apply loop
  // ──────────────────────────────────────────────────────────────────────────

  it('rejected items are skipped during apply loop', async () => {
    mockWebflowSuccess(/\/pages\/page-001/, { id: 'page-001' });

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Reject Test', [
      { pageId: 'page-001', pageTitle: 'Page 1', pageSlug: 'page-1', field: 'seoTitle', currentValue: 'Old 1', proposedValue: 'New 1' },
      { pageId: 'page-002', pageTitle: 'Page 2', pageSlug: 'page-2', field: 'seoTitle', currentValue: 'Old 2', proposedValue: 'New 2' },
    ]);

    // Approve item 1, reject item 2
    updateItem(ws.workspaceId, batch.id, batch.items[0].id, { status: 'approved' });
    updateItem(ws.workspaceId, batch.id, batch.items[1].id, { status: 'rejected' });

    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId, batch.id, ws.webflowSiteId, ws.webflowToken,
    );

    // Only 1 item processed (the approved one)
    expect(results).toHaveLength(1);
    expect(appliedIds).toHaveLength(1);
    expect(results[0].pageId).toBe('page-001');
    expect(results[0].success).toBe(true);

    // Webflow called exactly once
    const captured = getCapturedRequests();
    const pagePuts = captured.filter(r => r.method === 'PUT' && r.endpoint.includes('/pages/'));
    expect(pagePuts).toHaveLength(1);

    // DB: page-001 applied, page-002 still rejected
    const final = getBatch(ws.workspaceId, batch.id)!;
    const byPage = itemsByPage(final);
    expect(byPage['page-001'].status).toBe('applied');
    expect(byPage['page-002'].status).toBe('rejected');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Re-apply after partial failure
  // ──────────────────────────────────────────────────────────────────────────

  it('re-apply after partial failure: second run succeeds for previously failed item', async () => {
    // First run: page-001 succeeds, page-002 fails
    mockWebflowSuccess(/\/pages\/page-001/, { id: 'page-001' });
    mockWebflowError(/\/pages\/page-002/, 503, 'Service Unavailable');

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Re-apply Test', [
      { pageId: 'page-001', pageTitle: 'Page 1', pageSlug: 'page-1', field: 'seoTitle', currentValue: 'Old 1', proposedValue: 'New 1' },
      { pageId: 'page-002', pageTitle: 'Page 2', pageSlug: 'page-2', field: 'seoTitle', currentValue: 'Old 2', proposedValue: 'New 2' },
    ]);

    // Approve both
    for (const item of batch.items) {
      updateItem(ws.workspaceId, batch.id, item.id, { status: 'approved' });
    }

    // First apply: partial success
    const first = await runApplyLoop(
      ws.workspaceId, batch.id, ws.webflowSiteId, ws.webflowToken,
    );
    expect(first.appliedIds).toHaveLength(1);

    const afterFirst = getBatch(ws.workspaceId, batch.id)!;
    const byPageFirst = itemsByPage(afterFirst);
    expect(byPageFirst['page-001'].status).toBe('applied');
    expect(byPageFirst['page-002'].status).toBe('approved'); // still approved, not applied

    // Reset mocks and configure page-002 to succeed this time
    resetWebflowMocks();
    mockWebflowSuccess(/\/pages\/page-002/, { id: 'page-002' });

    // Second apply: page-002 should now succeed
    // (page-001 is already 'applied' so it won't be in the approved set)
    const second = await runApplyLoop(
      ws.workspaceId, batch.id, ws.webflowSiteId, ws.webflowToken,
    );
    expect(second.results).toHaveLength(1);
    expect(second.appliedIds).toHaveLength(1);
    expect(second.results[0].pageId).toBe('page-002');
    expect(second.results[0].success).toBe(true);

    // DB: both items now applied
    const final = getBatch(ws.workspaceId, batch.id)!;
    const byPageFinal = itemsByPage(final);
    expect(byPageFinal['page-001'].status).toBe('applied');
    expect(byPageFinal['page-002'].status).toBe('applied');
    expect(final.status).toBe('applied');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Description field: correct field mapping to Webflow
  // ──────────────────────────────────────────────────────────────────────────

  it('seoDescription items send { seo: { description } } to Webflow', async () => {
    mockWebflowSuccess(/\/pages\/page-001/, { id: 'page-001' });

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Description Batch', [
      { pageId: 'page-001', pageTitle: 'Page 1', pageSlug: 'page-1', field: 'seoDescription', currentValue: 'Old desc', proposedValue: 'New description for page' },
    ]);

    updateItem(ws.workspaceId, batch.id, batch.items[0].id, { status: 'approved' });

    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId, batch.id, ws.webflowSiteId, ws.webflowToken,
    );

    expect(appliedIds).toHaveLength(1);
    expect(results[0].success).toBe(true);

    // Verify Webflow received description, not title
    const captured = getCapturedRequests();
    const pagePut = captured.find(r => r.method === 'PUT' && r.endpoint.includes('/pages/page-001'));
    expect(pagePut).toBeDefined();
    expect(pagePut!.body).toEqual({ seo: { description: 'New description for page' } });

    // Confirm it did NOT include a title field
    const body = pagePut!.body as Record<string, unknown>;
    const seo = body.seo as Record<string, unknown>;
    expect(seo.title).toBeUndefined();
  });
});
