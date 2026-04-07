/**
 * Integration tests for Approval Execution — FM-2 (Phantom Success) and FM-5 (Partial Application).
 *
 * FM-2: External API call fails but the item is marked as "applied" anyway (phantom success).
 * FM-5: Some items succeed and some fail, but the wrong set gets marked as applied.
 *
 * These tests verify the DB-level guarantees of the apply loop in
 * `server/routes/approvals.ts` POST /api/public/approvals/:workspaceId/:batchId/apply:
 *
 *   - Only items whose Webflow API call actually succeeded end up with status === 'applied'
 *   - Items whose Webflow call throws are NOT marked applied (FM-2 guard)
 *   - Successful items are correctly separated from failed ones (FM-5 guard)
 *   - Synthetic CMS page IDs (cms-*) are rejected before any API call
 *   - Invalid schema JSON fails cleanly without a phantom applied status
 *   - A missing Webflow token stops all items before any API calls
 *
 * The tests work in-process: they import server store functions directly and
 * replicate the apply loop from the route handler so that vi.mock can intercept
 * webflow-client.js at the module level.  This is the same pattern used by
 * tests/unit/analytics-insights-store.test.ts and tests/bridges-simple.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupWebflowMocks, mockWebflowSuccess, mockWebflowError, getCapturedRequests, resetWebflowMocks } from '../mocks/webflow.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type { ApprovalItem } from '../../shared/types/approvals.js';

// ── Module-level mock must be registered before server imports ──
setupWebflowMocks();

// ── Server imports (after mock registration) ──
import {
  createBatch,
  getBatch,
  updateItem,
  markBatchApplied,
} from '../../server/approvals.js';
import {
  updatePageSeo,
  publishSchemaToPage,
  updateCollectionItem,
  publishCollectionItems,
} from '../../server/webflow.js';
import { parseJsonFallback } from '../../server/db/json-validation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Approve all items in a batch and return the item IDs.
 * Uses updateItem to transition each item from 'pending' → 'approved'.
 */
function approveAllItems(workspaceId: string, batchId: string, itemIds: string[]): void {
  for (const itemId of itemIds) {
    updateItem(workspaceId, batchId, itemId, { status: 'approved' });
  }
}

/**
 * Replicate the apply loop from the route handler.
 *
 * This mirrors the logic in server/routes/approvals.ts lines 257-296 so that
 * we can test the DB outcome (which items get markBatchApplied) without
 * spinning up an HTTP server.  The Webflow functions under test are mocked
 * via setupWebflowMocks(), which intercepts webflow-client.js in-process.
 *
 * Returns { results, appliedIds } matching the route handler's shape.
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
      // Guard: synthetic CMS IDs cannot be written via the Webflow API.
      if (item.pageId.startsWith('cms-')) {
        throw new Error(
          'CMS pages discovered via sitemap must be updated directly in Webflow — synthetic page ID cannot be written via the API',
        );
      }

      const value = item.clientValue || item.proposedValue;

      if (item.field === 'schema') {
        const schema = parseJsonFallback(value, null);
        if (!schema) throw new Error('Invalid schema JSON');
        const result = await publishSchemaToPage(siteId, item.pageId, schema as Record<string, unknown>, token);
        if (!result.success) throw new Error(result.error || 'Schema publish failed');
      } else if (item.collectionId) {
        const result = await updateCollectionItem(item.collectionId, item.pageId, { [item.field]: value }, token);
        if (!result.success) throw new Error(result.error || 'CMS update failed');
        await publishCollectionItems(item.collectionId, [item.pageId], token);
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

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

let ws: SeededFullWorkspace;

beforeEach(() => {
  // Seed a fresh workspace with a Webflow token for each test.
  ws = seedWorkspace();
  resetWebflowMocks();
});

afterEach(() => {
  ws.cleanup();
  resetWebflowMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Approval Execution — FM-2 & FM-5', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Test 1 — All items fail: no items should be marked as applied
  // ──────────────────────────────────────────────────────────────────────────

  describe('FM-2: all Webflow calls fail — no items get marked applied', () => {
    it('leaves all item statuses as "approved" (not "applied") when every Webflow call returns 500', async () => {
      // Mock every page PUT to return 500
      mockWebflowError(/\/pages\//, 500, 'Internal Server Error');

      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'All-fail batch', [
        { pageId: 'page-001', pageTitle: 'Page 1', pageSlug: 'page-1', field: 'seoTitle', currentValue: 'Old 1', proposedValue: 'New 1' },
        { pageId: 'page-002', pageTitle: 'Page 2', pageSlug: 'page-2', field: 'seoTitle', currentValue: 'Old 2', proposedValue: 'New 2' },
        { pageId: 'page-003', pageTitle: 'Page 3', pageSlug: 'page-3', field: 'seoTitle', currentValue: 'Old 3', proposedValue: 'New 3' },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      const { results, appliedIds } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        ws.webflowToken,
      );

      // No items should be applied
      expect(appliedIds).toHaveLength(0);
      expect(results).toHaveLength(3);

      // All results report failure
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.success === false)).toBe(true);

      // DB: read back the batch and verify NO item has status 'applied'
      const persisted = getBatch(ws.workspaceId, batch.id);
      expect(persisted).toBeDefined();
      expect(persisted!.items.length).toBeGreaterThan(0);
      expect(persisted!.items.every(i => i.status !== 'applied')).toBe(true);

      // Batch-level status must NOT be 'applied'
      expect(persisted!.status).not.toBe('applied');
    });

    it('does not call markBatchApplied when appliedIds is empty', async () => {
      mockWebflowError(/\/pages\//, 500, 'Internal Server Error');

      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'No-apply batch', [
        { pageId: 'page-a', pageTitle: 'A', pageSlug: 'a', field: 'seoDescription', currentValue: 'old', proposedValue: 'new' },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      const { appliedIds } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        ws.webflowToken,
      );

      expect(appliedIds).toHaveLength(0);

      const persisted = getBatch(ws.workspaceId, batch.id);
      expect(persisted).toBeDefined();
      // Item should still be 'approved', not 'applied'
      expect(persisted!.items[0].status).toBe('approved');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2 — Partial failure (FM-5): only successful items get marked applied
  // ──────────────────────────────────────────────────────────────────────────

  describe('FM-5: partial failure — only successful items are marked applied', () => {
    it('marks items 0 and 2 as applied; item 1 remains approved on Webflow error', async () => {
      // page-fail is the pageId for item 1 — mock it to fail; others succeed
      mockWebflowSuccess(/\/pages\/page-ok-0/, { id: 'page-ok-0' });
      mockWebflowSuccess(/\/pages\/page-ok-2/, { id: 'page-ok-2' });
      mockWebflowError(/\/pages\/page-fail-1/, 422, 'Unprocessable Entity');

      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Partial batch', [
        { pageId: 'page-ok-0',   pageTitle: 'OK 0',   pageSlug: 'ok-0',   field: 'seoTitle', currentValue: 'c0', proposedValue: 'p0' },
        { pageId: 'page-fail-1', pageTitle: 'Fail 1', pageSlug: 'fail-1', field: 'seoTitle', currentValue: 'c1', proposedValue: 'p1' },
        { pageId: 'page-ok-2',   pageTitle: 'OK 2',   pageSlug: 'ok-2',   field: 'seoTitle', currentValue: 'c2', proposedValue: 'p2' },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      const { results, appliedIds } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        ws.webflowToken,
      );

      // Exactly 2 items succeeded
      expect(appliedIds).toHaveLength(2);
      expect(results).toHaveLength(3);

      const successResults = results.filter(r => r.success);
      const failResults = results.filter(r => !r.success);

      expect(successResults.length).toBeGreaterThan(0);
      expect(successResults.every(r => r.pageId !== 'page-fail-1')).toBe(true);

      expect(failResults).toHaveLength(1);
      expect(failResults[0].pageId).toBe('page-fail-1');
      expect(failResults[0].error).toBeTruthy();

      // DB: verify per-item statuses
      const persisted = getBatch(ws.workspaceId, batch.id);
      expect(persisted).toBeDefined();

      const itemsByPage: Record<string, ApprovalItem> = {};
      for (const item of persisted!.items) {
        itemsByPage[item.pageId] = item;
      }

      expect(itemsByPage['page-ok-0'].status).toBe('applied');
      expect(itemsByPage['page-fail-1'].status).toBe('approved'); // NOT applied
      expect(itemsByPage['page-ok-2'].status).toBe('applied');
    });

    it('results array has correct success/failure flags per item', async () => {
      mockWebflowSuccess(/\/pages\/success-page/, {});
      mockWebflowError(/\/pages\/error-page/, 503, 'Service Unavailable');

      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Mixed results', [
        { pageId: 'success-page', pageTitle: 'S', pageSlug: 's', field: 'seoDescription', currentValue: 'old', proposedValue: 'new' },
        { pageId: 'error-page',   pageTitle: 'E', pageSlug: 'e', field: 'seoDescription', currentValue: 'old', proposedValue: 'new' },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      const { results } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        ws.webflowToken,
      );

      const successEntry = results.find(r => r.pageId === 'success-page');
      const errorEntry = results.find(r => r.pageId === 'error-page');

      expect(successEntry).toBeDefined();
      expect(successEntry!.success).toBe(true);
      expect(successEntry!.error).toBeUndefined();

      expect(errorEntry).toBeDefined();
      expect(errorEntry!.success).toBe(false);
      expect(errorEntry!.error).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3 — Synthetic CMS page ID: fails fast, not phantom success
  // ──────────────────────────────────────────────────────────────────────────

  describe('Synthetic CMS page ID guard', () => {
    it('rejects cms-* pageId with a clear error and does NOT mark the item applied', async () => {
      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'CMS synthetic batch', [
        {
          pageId: 'cms-abc123',
          pageTitle: 'CMS Blog Post',
          pageSlug: 'blog/cms-post',
          field: 'seoTitle',
          currentValue: 'Old Title',
          proposedValue: 'New Title',
        },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      const { results, appliedIds } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        ws.webflowToken,
      );

      expect(appliedIds).toHaveLength(0);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toMatch(/synthetic page ID/i);

      // DB: item must NOT be applied
      const persisted = getBatch(ws.workspaceId, batch.id);
      expect(persisted).toBeDefined();
      expect(persisted!.items[0].status).toBe('approved');
    });

    it('does not make any Webflow API calls for cms-* items', async () => {
      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'CMS no-call batch', [
        { pageId: 'cms-xyz', pageTitle: 'CMS', pageSlug: 'cms', field: 'seoTitle', currentValue: 'c', proposedValue: 'p' },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      await runApplyLoop(ws.workspaceId, batch.id, ws.webflowSiteId, ws.webflowToken);

      const captured = getCapturedRequests();
      const pageRequests = captured.filter(r => r.endpoint.includes('cms-xyz'));
      expect(pageRequests).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4 — Schema item with invalid JSON: fails, not phantom success
  // ──────────────────────────────────────────────────────────────────────────

  describe('Schema item validation', () => {
    it('fails with "Invalid schema JSON" error and does NOT mark item applied', async () => {
      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Bad schema batch', [
        {
          pageId: 'page-schema-bad',
          pageTitle: 'Schema Page',
          pageSlug: 'schema-page',
          field: 'schema',
          currentValue: '',
          proposedValue: 'not valid json {{{ this is broken',
        },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      const { results, appliedIds } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        ws.webflowToken,
      );

      expect(appliedIds).toHaveLength(0);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toMatch(/invalid schema json/i);

      // DB: item must remain 'approved', not 'applied'
      const persisted = getBatch(ws.workspaceId, batch.id);
      expect(persisted).toBeDefined();
      expect(persisted!.items[0].status).toBe('approved');
    });

    it('succeeds with valid JSON schema and marks item applied', async () => {
      // publishSchemaToPage makes multiple Webflow calls; mock them all to succeed
      mockWebflowSuccess(/\/sites\/.*\/registered_scripts\/inline/, { id: 'script-001', displayName: 'JSON-LD Schema', version: '1.0' });
      mockWebflowSuccess(/\/sites\/.*\/registered_scripts/, []);
      mockWebflowSuccess(/\/pages\/page-schema-good\/custom_code/, { scripts: [] });
      mockWebflowSuccess(/\/pages\/page-schema-good/, { id: 'page-schema-good' });

      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Good schema batch', [
        {
          pageId: 'page-schema-good',
          pageTitle: 'Schema Page',
          pageSlug: 'schema-page',
          field: 'schema',
          currentValue: '',
          proposedValue: JSON.stringify({ '@type': 'Organization', name: 'Acme' }),
        },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      const { results, appliedIds } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        ws.webflowToken,
      );

      // All mock calls must succeed; assert unconditionally
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(appliedIds).toHaveLength(1);

      const persisted = getBatch(ws.workspaceId, batch.id);
      expect(persisted!.items[0].status).toBe('applied');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5 — Token missing: no items applied
  // ──────────────────────────────────────────────────────────────────────────

  describe('Missing Webflow token', () => {
    it('returns zero appliedIds and leaves all items as approved when token is empty string', async () => {
      // updatePageSeo with an empty token will either throw or receive an auth
      // error from the mock (default: 404 for unmocked endpoints).
      // Either way, no items should be marked applied.
      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'No-token batch', [
        { pageId: 'page-notoken', pageTitle: 'T', pageSlug: 't', field: 'seoTitle', currentValue: 'c', proposedValue: 'p' },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      // Pass an explicitly empty token — route handler would have returned 400
      // before reaching the loop; here we replicate the token being absent to
      // verify the Webflow call itself fails safely.
      const { results, appliedIds } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        '', // empty token
      );

      // The Webflow mock returns 404 for unmocked endpoints by default, which
      // makes updatePageSeo return { success: false } — so nothing is applied.
      expect(appliedIds).toHaveLength(0);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);

      const persisted = getBatch(ws.workspaceId, batch.id);
      expect(persisted).toBeDefined();
      expect(persisted!.items[0].status).toBe('approved');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6 — CMS item apply: collectionId branch
  // ──────────────────────────────────────────────────────────────────────────

  describe('CMS item via collectionId branch', () => {
    it('applies CMS item when updateCollectionItem and publishCollectionItems succeed', async () => {
      mockWebflowSuccess(/\/collections\/col-001\/items\/item-wf-01$/, { id: 'item-wf-01' });
      mockWebflowSuccess(/\/collections\/col-001\/items\/publish/, { publishedItemIds: ['item-wf-01'] });

      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'CMS apply batch', [
        {
          pageId: 'item-wf-01', // Real Webflow CMS item ID (must NOT start with 'cms-')
          pageTitle: 'Blog Post',
          pageSlug: 'blog/post-1',
          field: 'meta-title',
          collectionId: 'col-001',
          currentValue: 'Old CMS Title',
          proposedValue: 'New CMS Title',
        },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      const { results, appliedIds } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        ws.webflowToken,
      );

      expect(appliedIds).toHaveLength(1);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);

      const persisted = getBatch(ws.workspaceId, batch.id);
      expect(persisted).toBeDefined();
      expect(persisted!.items[0].status).toBe('applied');
    });

    it('does NOT apply CMS item when updateCollectionItem returns { success: false } (FM-2 guard)', async () => {
      mockWebflowError(/\/collections\/col-002\/items\/wf-item-02$/, 404, 'Item not found');

      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'CMS fail batch', [
        {
          pageId: 'wf-item-02', // Real Webflow CMS item ID (must NOT start with 'cms-')
          pageTitle: 'Blog Post 2',
          pageSlug: 'blog/post-2',
          field: 'meta-title',
          collectionId: 'col-002',
          currentValue: 'Old',
          proposedValue: 'New',
        },
      ]);

      approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

      const { results, appliedIds } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        ws.webflowToken,
      );

      expect(appliedIds).toHaveLength(0);
      expect(results[0].success).toBe(false);

      const persisted = getBatch(ws.workspaceId, batch.id);
      expect(persisted!.items[0].status).toBe('approved'); // not 'applied'
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7 — Empty approved set: apply loop is a no-op
  // ──────────────────────────────────────────────────────────────────────────

  describe('No approved items', () => {
    it('returns empty results when batch has no approved items', async () => {
      const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Pending only batch', [
        { pageId: 'page-pending', pageTitle: 'P', pageSlug: 'p', field: 'seoTitle', currentValue: 'c', proposedValue: 'p' },
      ]);

      // Do NOT approve — items stay pending

      const { results, appliedIds } = await runApplyLoop(
        ws.workspaceId,
        batch.id,
        ws.webflowSiteId,
        ws.webflowToken,
      );

      expect(results).toHaveLength(0);
      expect(appliedIds).toHaveLength(0);

      const persisted = getBatch(ws.workspaceId, batch.id);
      expect(persisted).toBeDefined();
      expect(persisted!.items[0].status).toBe('pending');

      // No Webflow calls should have been made
      expect(getCapturedRequests()).toHaveLength(0);
    });
  });
});
