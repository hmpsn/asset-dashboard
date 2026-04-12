/**
 * Journey test: Schema Publish — approval through Webflow custom code injection.
 *
 * Failure modes covered:
 *   FM-2  (Phantom Success) — Webflow API fails but item incorrectly marked 'applied'
 *   FM-12 (Broken Chain)    — a link in the approval→publish chain silently drops
 *
 * Journey flow:
 *   1. Create approval batch with schema item (field='schema', proposedValue = JSON-LD)
 *   2. Approve the schema item
 *   3. Run apply loop — calls publishSchemaToPage() for schema items
 *   4. publishSchemaToPage() registers inline script, reads existing custom code,
 *      adds the schema script block, writes back via Webflow Custom Code API
 *   5. After apply: item marked 'applied', page has schema injected
 *   6. Error paths: Webflow fails → item NOT marked applied (no phantom success)
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

// ── Module-level mocks (hoisted before imports) ──
setupWebflowMocks();

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));

// ── Server imports (after mock registration) ──
import {
  createBatch,
  getBatch,
  updateItem,
  markBatchApplied,
} from '../../server/approvals.js';
import { publishSchemaToPage, updatePageSeo } from '../../server/webflow-pages.js';
import { parseJsonFallback } from '../../server/db/json-validation.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SCHEMA: Record<string, unknown> = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  'name': 'Test Business',
  'url': 'https://test.example.com',
};

const VALID_SCHEMA_V2: Record<string, unknown> = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  'name': 'Test Business Updated',
  'url': 'https://test.example.com',
  'telephone': '+1-555-0199',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approve all items in a batch. */
function approveAllItems(workspaceId: string, batchId: string, itemIds: string[]): void {
  for (const itemId of itemIds) {
    updateItem(workspaceId, batchId, itemId, { status: 'approved' });
  }
}

/**
 * Mock helpers for the publishSchemaToPage call chain.
 * publishSchemaToPage makes 4 Webflow calls in sequence:
 *   1. GET  /sites/:siteId/registered_scripts     — list existing scripts
 *   2. POST /sites/:siteId/registered_scripts/inline — register new inline script
 *   3. GET  /pages/:pageId/custom_code             — read existing page custom code
 *   4. PUT  /pages/:pageId/custom_code             — write updated custom code
 */
function mockSchemaHappyPath(siteId: string, pageId: string, scriptId: string = 'script-001'): void {
  mockWebflowSuccess(`/sites/${siteId}/registered_scripts`, { registeredScripts: [] });
  mockWebflowSuccess(`/sites/${siteId}/registered_scripts/inline`, {
    id: scriptId,
    displayName: `JSON-LD Schema (${pageId.slice(0, 8)})`,
    version: '1.0.test',
  });
  mockWebflowSuccess(`/pages/${pageId}/custom_code`, { scripts: [] });
  // PUT to the same endpoint also matches — last rule wins by method isn't distinguished,
  // but mockWebflowSuccess returns 200 for both GET and PUT, which is what we need.
}

/**
 * Replicate the apply loop from the route handler.
 * Mirrors server/routes/approvals.ts apply logic so we can test
 * the DB outcome without spinning up an HTTP server.
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
        const result = await publishSchemaToPage(siteId, item.pageId, schema as Record<string, unknown>, token);
        if (!result.success) throw new Error(result.error || 'Schema publish failed');
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
  ws = seedWorkspace();
  resetWebflowMocks();
});

afterEach(() => {
  ws.cleanup();
  resetWebflowMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Journey test suite
// ---------------------------------------------------------------------------

describe('Journey: Schema Approval → Publish → Webflow Custom Code', () => {
  // ────────────────────────────────────────────────────────────────────────
  // Test 1 — Happy path: schema approval → publish → item applied
  // ────────────────────────────────────────────────────────────────────────

  it('happy path: schema item approved, published to Webflow, marked applied', async () => {
    const pageId = 'page-schema-happy';
    mockSchemaHappyPath(ws.webflowSiteId, pageId);

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Schema happy path', [
      {
        pageId,
        pageTitle: 'About Us',
        pageSlug: 'about',
        field: 'schema',
        currentValue: '',
        proposedValue: JSON.stringify(VALID_SCHEMA),
      },
    ]);

    approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId,
      batch.id,
      ws.webflowSiteId,
      ws.webflowToken,
    );

    // Item applied successfully
    expect(appliedIds).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);

    // DB: item status is 'applied'
    const persisted = getBatch(ws.workspaceId, batch.id);
    expect(persisted).toBeDefined();
    expect(persisted!.items[0].status).toBe('applied');
    expect(persisted!.status).toBe('applied');

    // Webflow received the correct calls
    const captured = getCapturedRequests();
    expect(captured.length).toBeGreaterThan(0);

    // Verify the register-inline-script call included our schema JSON
    const registerCall = captured.find(r =>
      r.endpoint.includes('registered_scripts/inline') && r.method === 'POST',
    );
    expect(registerCall).toBeDefined();
    expect(registerCall!.body).toBeDefined();
    const sourceCode = (registerCall!.body as Record<string, unknown>).sourceCode as string;
    expect(sourceCode).toContain('application/ld+json');
    expect(sourceCode).toContain('Test Business');

    // Verify the custom code upsert call
    const upsertCall = captured.find(r =>
      r.endpoint.includes(`/pages/${pageId}/custom_code`) && r.method === 'PUT',
    );
    expect(upsertCall).toBeDefined();
    const upsertBody = upsertCall!.body as { scripts: Array<{ id: string }> };
    expect(upsertBody.scripts.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 2 — Webflow GET fails (listRegisteredScripts) → NOT applied (FM-2)
  // ────────────────────────────────────────────────────────────────────────

  it('Webflow registerInlineScript fails → schema NOT applied (FM-2)', async () => {
    const pageId = 'page-schema-get-fail';

    // listRegisteredScripts succeeds, but registerInlineScript fails
    mockWebflowSuccess(`/sites/${ws.webflowSiteId}/registered_scripts`, { registeredScripts: [] });
    mockWebflowError(`/sites/${ws.webflowSiteId}/registered_scripts/inline`, 500, 'Internal Server Error');

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Schema GET fail', [
      {
        pageId,
        pageTitle: 'Schema Page',
        pageSlug: 'schema-page',
        field: 'schema',
        currentValue: '',
        proposedValue: JSON.stringify(VALID_SCHEMA),
      },
    ]);

    approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId,
      batch.id,
      ws.webflowSiteId,
      ws.webflowToken,
    );

    // FM-2 guard: item must NOT be marked applied
    expect(appliedIds).toHaveLength(0);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeTruthy();

    // DB: item stays 'approved', not 'applied'
    const persisted = getBatch(ws.workspaceId, batch.id);
    expect(persisted).toBeDefined();
    expect(persisted!.items[0].status).toBe('approved');
    expect(persisted!.status).not.toBe('applied');
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 3 — Webflow PUT fails (upsertPageCustomCode) → NOT applied (FM-2)
  // ────────────────────────────────────────────────────────────────────────

  it('Webflow upsertPageCustomCode fails → schema NOT applied (FM-2)', async () => {
    const pageId = 'page-schema-put-fail';

    // Register succeeds, GET custom code succeeds, PUT custom code fails
    mockWebflowSuccess(`/sites/${ws.webflowSiteId}/registered_scripts`, { registeredScripts: [] });
    mockWebflowSuccess(`/sites/${ws.webflowSiteId}/registered_scripts/inline`, {
      id: 'script-put-fail',
      displayName: 'JSON-LD Schema',
      version: '1.0.test',
    });
    mockWebflowSuccess(`/pages/${pageId}/custom_code`, { scripts: [] });
    // Override the PUT — mockWebflowError registered after mockWebflowSuccess takes precedence
    mockWebflowError(`/pages/${pageId}/custom_code`, 500, 'Custom Code Write Failed');

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Schema PUT fail', [
      {
        pageId,
        pageTitle: 'Schema Page',
        pageSlug: 'schema-page',
        field: 'schema',
        currentValue: '',
        proposedValue: JSON.stringify(VALID_SCHEMA),
      },
    ]);

    approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId,
      batch.id,
      ws.webflowSiteId,
      ws.webflowToken,
    );

    // FM-2 guard: item must NOT be marked applied
    expect(appliedIds).toHaveLength(0);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeTruthy();

    // DB: item stays 'approved'
    const persisted = getBatch(ws.workspaceId, batch.id);
    expect(persisted).toBeDefined();
    expect(persisted!.items[0].status).toBe('approved');
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 4 — Invalid schema JSON → item NOT applied
  // ────────────────────────────────────────────────────────────────────────

  it('invalid schema JSON → item NOT applied, error mentions "Invalid schema JSON"', async () => {
    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Bad schema batch', [
      {
        pageId: 'page-bad-schema',
        pageTitle: 'Bad Schema Page',
        pageSlug: 'bad-schema',
        field: 'schema',
        currentValue: '',
        proposedValue: 'not json at all {{{ this is broken',
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

    // DB: item stays 'approved'
    const persisted = getBatch(ws.workspaceId, batch.id);
    expect(persisted).toBeDefined();
    expect(persisted!.items[0].status).toBe('approved');

    // No Webflow calls should have been made (failed before API call)
    const captured = getCapturedRequests();
    expect(captured).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 5 — Schema with existing custom code: preserves existing scripts
  // ────────────────────────────────────────────────────────────────────────

  it('preserves existing page scripts when adding schema', async () => {
    const pageId = 'page-existing-code';
    const existingScriptId = 'existing-analytics-script';

    mockWebflowSuccess(`/sites/${ws.webflowSiteId}/registered_scripts`, { registeredScripts: [] });
    mockWebflowSuccess(`/sites/${ws.webflowSiteId}/registered_scripts/inline`, {
      id: 'new-schema-script',
      displayName: `JSON-LD Schema (${pageId.slice(0, 8)})`,
      version: '1.0.test',
    });
    // GET returns a page that already has a script
    mockWebflowSuccess(`/pages/${pageId}/custom_code`, {
      scripts: [
        { id: existingScriptId, location: 'footer', version: '1.0.0' },
      ],
    });

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Preserve existing', [
      {
        pageId,
        pageTitle: 'Page With Code',
        pageSlug: 'page-with-code',
        field: 'schema',
        currentValue: '',
        proposedValue: JSON.stringify(VALID_SCHEMA),
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
    expect(results[0].success).toBe(true);

    // Verify the PUT body contains both old and new scripts
    const captured = getCapturedRequests();
    const upsertCall = captured.find(r =>
      r.endpoint.includes(`/pages/${pageId}/custom_code`) && r.method === 'PUT',
    );
    expect(upsertCall).toBeDefined();

    const scripts = (upsertCall!.body as { scripts: Array<{ id: string; location: string }> }).scripts;
    expect(scripts.length).toBe(2);

    // Existing analytics script preserved
    const preserved = scripts.find(s => s.id === existingScriptId);
    expect(preserved).toBeDefined();
    expect(preserved!.location).toBe('footer');

    // New schema script added
    const newSchema = scripts.find(s => s.id === 'new-schema-script');
    expect(newSchema).toBeDefined();
    expect(newSchema!.location).toBe('header');
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 6 — Mixed batch: schema + seoTitle items
  // ────────────────────────────────────────────────────────────────────────

  it('mixed batch: schema + seoTitle items both applied on success', async () => {
    const schemaPageId = 'page-mixed-schema';
    const seoPageId = 'page-mixed-seo';

    // Schema item mocks
    mockSchemaHappyPath(ws.webflowSiteId, schemaPageId);

    // SEO title item mocks (updatePageSeo calls PUT /pages/:pageId)
    mockWebflowSuccess(`/pages/${seoPageId}`, { id: seoPageId });

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Mixed batch', [
      {
        pageId: schemaPageId,
        pageTitle: 'Schema Page',
        pageSlug: 'schema-page',
        field: 'schema',
        currentValue: '',
        proposedValue: JSON.stringify(VALID_SCHEMA),
      },
      {
        pageId: seoPageId,
        pageTitle: 'SEO Page',
        pageSlug: 'seo-page',
        field: 'seoTitle',
        currentValue: 'Old Title',
        proposedValue: 'New Optimized Title',
      },
    ]);

    approveAllItems(ws.workspaceId, batch.id, batch.items.map(i => i.id));

    const { results, appliedIds } = await runApplyLoop(
      ws.workspaceId,
      batch.id,
      ws.webflowSiteId,
      ws.webflowToken,
    );

    expect(appliedIds).toHaveLength(2);
    expect(results).toHaveLength(2);
    expect(results.length > 0 && results.every(r => r.success)).toBe(true);

    // DB: both items applied, batch status is 'applied'
    const persisted = getBatch(ws.workspaceId, batch.id);
    expect(persisted).toBeDefined();
    expect(persisted!.items.length > 0 && persisted!.items.every(i => i.status === 'applied')).toBe(true);
    expect(persisted!.status).toBe('applied');

    // Verify both Webflow call chains happened
    const captured = getCapturedRequests();
    const schemaRegister = captured.find(r =>
      r.endpoint.includes('registered_scripts/inline'),
    );
    const seoUpdate = captured.find(r =>
      r.endpoint === `/pages/${seoPageId}` && r.method === 'PUT',
    );
    expect(schemaRegister).toBeDefined();
    expect(seoUpdate).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 7 — Schema re-publish: updates existing schema script
  // ────────────────────────────────────────────────────────────────────────

  it('schema re-publish: replaces previous JSON-LD script with new version', async () => {
    const pageId = 'page-schema-update';
    const oldScriptId = 'old-schema-script';
    const newScriptId = 'new-schema-script';

    // First publish: v1
    mockWebflowSuccess(`/sites/${ws.webflowSiteId}/registered_scripts`, { registeredScripts: [] });
    mockWebflowSuccess(`/sites/${ws.webflowSiteId}/registered_scripts/inline`, {
      id: oldScriptId,
      displayName: `JSON-LD Schema (${pageId.slice(0, 8)})`,
      version: '1.0.first',
    });
    mockWebflowSuccess(`/pages/${pageId}/custom_code`, { scripts: [] });

    const batch1 = createBatch(ws.workspaceId, ws.webflowSiteId, 'Schema v1', [
      {
        pageId,
        pageTitle: 'Schema Page',
        pageSlug: 'schema-page',
        field: 'schema',
        currentValue: '',
        proposedValue: JSON.stringify(VALID_SCHEMA),
      },
    ]);

    approveAllItems(ws.workspaceId, batch1.id, batch1.items.map(i => i.id));
    const { appliedIds: applied1 } = await runApplyLoop(
      ws.workspaceId,
      batch1.id,
      ws.webflowSiteId,
      ws.webflowToken,
    );
    expect(applied1).toHaveLength(1);

    // Reset mocks for second publish
    resetWebflowMocks();

    // Second publish: v2 — the old script ID is now in the registered scripts list
    mockWebflowSuccess(`/sites/${ws.webflowSiteId}/registered_scripts`, {
      registeredScripts: [
        { id: oldScriptId, displayName: `JSON-LD Schema (${pageId.slice(0, 8)})`, version: '1.0.first' },
      ],
    });
    mockWebflowSuccess(`/sites/${ws.webflowSiteId}/registered_scripts/inline`, {
      id: newScriptId,
      displayName: `JSON-LD Schema (${pageId.slice(0, 8)})`,
      version: '1.0.second',
    });
    // Page currently has the old schema script block
    mockWebflowSuccess(`/pages/${pageId}/custom_code`, {
      scripts: [
        { id: oldScriptId, location: 'header', version: '1.0.first' },
      ],
    });

    const batch2 = createBatch(ws.workspaceId, ws.webflowSiteId, 'Schema v2', [
      {
        pageId,
        pageTitle: 'Schema Page',
        pageSlug: 'schema-page',
        field: 'schema',
        currentValue: JSON.stringify(VALID_SCHEMA),
        proposedValue: JSON.stringify(VALID_SCHEMA_V2),
      },
    ]);

    approveAllItems(ws.workspaceId, batch2.id, batch2.items.map(i => i.id));

    const { results, appliedIds: applied2 } = await runApplyLoop(
      ws.workspaceId,
      batch2.id,
      ws.webflowSiteId,
      ws.webflowToken,
    );

    expect(applied2).toHaveLength(1);
    expect(results[0].success).toBe(true);

    // Verify the PUT body has the NEW script, not the old one
    const captured = getCapturedRequests();
    const upsertCall = captured.find(r =>
      r.endpoint.includes(`/pages/${pageId}/custom_code`) && r.method === 'PUT',
    );
    expect(upsertCall).toBeDefined();

    const scripts = (upsertCall!.body as { scripts: Array<{ id: string }> }).scripts;
    // Old script should have been filtered out, only new script remains
    expect(scripts).toHaveLength(1);
    expect(scripts[0].id).toBe(newScriptId);

    // Verify the registered inline script call has the v2 schema
    const registerCall = captured.find(r =>
      r.endpoint.includes('registered_scripts/inline') && r.method === 'POST',
    );
    expect(registerCall).toBeDefined();
    const sourceCode = (registerCall!.body as Record<string, unknown>).sourceCode as string;
    expect(sourceCode).toContain('Test Business Updated');
    expect(sourceCode).toContain('+1-555-0199');
  });
});
