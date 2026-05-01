/**
 * Integration test: PageElementSlice flows through buildWorkspaceIntelligence.
 *
 * Verifies the slice contract end-to-end:
 *   1. upsertPageElements writes a catalog to the DB
 *   2. buildWorkspaceIntelligence({ slices: ['pageElements'], pagePath })
 *      reads it back via assemblePageElements
 *   3. The slice shape matches PageElementSlice (pagePath + catalog)
 *   4. Omitting pagePath returns no slice (the assembler is page-scoped)
 *
 * This pins the wiring rule from CLAUDE.md "Wire new data sources into
 * the intelligence engine" — any future reorganization of the slice
 * dispatch must preserve this contract.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import { upsertPageElements } from '../../server/page-elements-store.js';
import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { EMPTY_CATALOG } from '../../server/schemas/page-elements-schema.js';
import type { PageElementCatalog } from '../../shared/types/page-elements.js';

const WS_ID = 'ws_test_pe_slice';
const PAGE_PATH = '/blog/slice-integration-test';

const sampleCatalog: PageElementCatalog = {
  ...EMPTY_CATALOG,
  extractedAt: new Date().toISOString(),
  sourcePublishedAt: '2026-04-15T00:00:00Z',
  videos: [{ provider: 'youtube', embedUrl: 'https://www.youtube.com/embed/test' }],
  citations: [{ url: 'https://example.com', text: 'Example', isExternal: true }],
};

describe('PageElementSlice integration', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM page_elements WHERE workspace_id = ?').run(WS_ID);
    // Workspace seed so buildWorkspaceIntelligence finds a row.
    // workspaces table has no updated_at column — only created_at.
    db.prepare(`
      INSERT OR REPLACE INTO workspaces (id, name, folder, created_at)
      VALUES (?, ?, ?, ?)
    `).run(WS_ID, 'Test PE Slice WS', 'test-pe-slice', new Date().toISOString());
    upsertPageElements(WS_ID, PAGE_PATH, sampleCatalog);
  });

  it('returns the catalog when pagePath is provided', async () => {
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['pageElements'], pagePath: PAGE_PATH });
    expect(intel.pageElements).toBeDefined();
    expect(intel.pageElements!.pagePath).toBe(PAGE_PATH);
    expect(intel.pageElements!.catalog.videos).toHaveLength(1);
    expect(intel.pageElements!.catalog.videos[0].embedUrl).toBe('https://www.youtube.com/embed/test');
    expect(intel.pageElements!.catalog.citations).toHaveLength(1);
  });

  it('returns undefined when pagePath is omitted (slice is page-scoped)', async () => {
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['pageElements'] });
    expect(intel.pageElements).toBeUndefined();
  });

  it('returns undefined when pagePath has no stored row (no fallback to empty catalog)', async () => {
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['pageElements'], pagePath: '/nonexistent' });
    expect(intel.pageElements).toBeUndefined();
  });

  it('does not include pageElements when slice is not requested', async () => {
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['operational'], pagePath: PAGE_PATH });
    expect(intel.pageElements).toBeUndefined();
  });
});
