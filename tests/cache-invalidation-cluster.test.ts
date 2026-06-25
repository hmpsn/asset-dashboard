/**
 * Task 4.1 — Cache-invalidation cluster wiring guard.
 *
 * These tests verify that every workspace-scoped write site that was missing
 * `invalidateIntelligenceCache` (audit finding A-9/11/12/13) now calls it, so
 * the advisor is never served stale data after a write.
 *
 * Two layers:
 *  1. Bounded source-file static analysis — each slice is bounded to the NEXT
 *     export/function/route declaration so the assertion cannot be satisfied by a
 *     DIFFERENT function's call further down the file (the vacuity bug fixed here:
 *     the old markBatchApplied slice ran to EOF and was satisfied by deleteBatch's
 *     call; the old schema-publish slice spanned the whole file).
 *  2. A real BEHAVIORAL test — spies on invalidateIntelligenceCache and asserts it
 *     is actually called with the workspaceId when the service function runs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { boundedSection, readProjectFile } from './helpers/source-contracts';

const read = readProjectFile;

describe('Task 4.1 — Cache-invalidation cluster (A-9/11/12/13) — bounded source guards', () => {
  // ── approvals.ts service fns (bounded to the next export function) ─────────

  it('server/approvals.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/approvals.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/approvals.ts calls invalidateIntelligenceCache in createBatch (bounded)', () => {
    const src = read('server/approvals.ts');
    const section = boundedSection(src, 'export function createBatch', ['export function listBatches']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  it('server/approvals.ts calls invalidateIntelligenceCache in updateItem (bounded)', () => {
    const src = read('server/approvals.ts');
    // updateItem → next export is markBatchApplied. recalcBatchStatus (a private
    // helper) sits between them but is NOT an export boundary, so bound on the
    // next EXPORTED function to keep the slice tight to updateItem's own body.
    const section = boundedSection(src, 'export function updateItem', ['function recalcBatchStatus']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  it('server/approvals.ts calls invalidateIntelligenceCache in markBatchApplied (bounded — not satisfied by deleteBatch)', () => {
    const src = read('server/approvals.ts');
    // Bound to deleteBatch so the old EOF-spanning slice (which was satisfied by
    // deleteBatch's own call) can no longer pass vacuously.
    const section = boundedSection(src, 'export function markBatchApplied', ['export function deleteBatch']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  it('server/approvals.ts calls invalidateIntelligenceCache in deleteBatch (bounded)', () => {
    const src = read('server/approvals.ts');
    // deleteBatch is the last export; bound on a stable trailing marker to avoid
    // EOF-span. Fall back to EOF only if no trailing export exists.
    const section = boundedSection(src, 'export function deleteBatch', ['\nexport function ', '\nfunction ']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  // ── webflow-schema.ts write endpoints (bounded to the next router. decl) ───

  it('server/routes/webflow-schema.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/webflow-schema.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-schema.ts calls invalidateIntelligenceCache on schema-publish (bounded — not whole-file)', () => {
    const src = read('server/routes/webflow-schema.ts');
    // The old slice ran to EOF (whole file). Bound it to the next route decl.
    const section = boundedSection(src, "router.post('/api/webflow/schema-publish/:siteId'", ['\nrouter.']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-schema.ts calls invalidateIntelligenceCache on schema-rollback (bounded)', () => {
    const src = read('server/routes/webflow-schema.ts');
    const section = boundedSection(src, "router.post('/api/webflow/schema-rollback/:siteId'", ['\nrouter.']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  it('server/domains/schema/schema-plan-admin-mutations.ts calls invalidateIntelligenceCache on schema-plan DELETE (bounded)', () => {
    const src = read('server/domains/schema/schema-plan-admin-mutations.ts');
    const section = boundedSection(src, 'export function deleteSchemaPlanForAdmin', ['\nexport function ']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-schema.ts calls invalidateIntelligenceCache on schema-retract (bounded)', () => {
    const src = read('server/routes/webflow-schema.ts');
    // Previously untested. schema-retract flips a page state and must invalidate.
    const section = boundedSection(src, "router.delete('/api/webflow/schema-retract/:siteId/:pageId'", ['\nrouter.']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  // ── outcomes.ts write endpoints ───────────────────────────────────────────

  it('server/routes/outcomes.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/outcomes.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/outcomes.ts calls invalidateIntelligenceCache in record-action POST (bounded)', () => {
    const src = read('server/routes/outcomes.ts');
    const section = boundedSection(src, "/api/outcomes/:workspaceId/actions'", ['\nrouter.']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  // ── webflow-analysis.ts ───────────────────────────────────────────────────

  it('server/routes/webflow-analysis.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/webflow-analysis.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-analysis.ts calls invalidateIntelligenceCache after internal-links recordAction (bounded)', () => {
    const src = read('server/routes/webflow-analysis.ts');
    const section = boundedSection(src, "/api/webflow/internal-links/:siteId", ['\nrouter.']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  // ── SEO-change writers ────────────────────────────────────────────────────

  it('server/routes/webflow.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/webflow.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow.ts calls invalidateIntelligenceCache in the seo-update PUT (bounded)', () => {
    const src = read('server/routes/webflow.ts');
    const section = boundedSection(src, "/api/webflow/pages/:pageId/seo", ['\nrouter.']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  it('server/webflow-seo-bulk-accept-fixes-job.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/webflow-seo-bulk-accept-fixes-job.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/webflow-seo-bulk-accept-fixes-job.ts calls invalidateIntelligenceCache after applying fixes (bounded to success path)', () => {
    const src = read('server/webflow-seo-bulk-accept-fixes-job.ts');
    // Bound from BULK_OPERATION_COMPLETE to the outer catch so the assertion is
    // tied to the success path, not the whole file.
    const section = boundedSection(src, 'BULK_OPERATION_COMPLETE', ['} catch (err) {']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-seo-suggestions.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/webflow-seo-suggestions.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-seo-suggestions.ts calls invalidateIntelligenceCache in apply endpoint (bounded)', () => {
    const src = read('server/routes/webflow-seo-suggestions.ts');
    const section = boundedSection(src, "/api/webflow/seo-suggestions/:workspaceId/apply", ['\nrouter.', '\nexport default']);
    expect(section).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-seo-apply.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/webflow-seo-apply.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-seo-apply.ts calls invalidateIntelligenceCache in seo-pattern-apply (bounded)', () => {
    const src = read('server/routes/webflow-seo-apply.ts');
    const section = boundedSection(src, "/api/webflow/seo-pattern-apply/:siteId", ['\nrouter.', '\nexport default']);
    expect(section).toContain('invalidateIntelligenceCache');
  });
});

// ── Behavioral test — actually invoke the service fn and assert the spy fired.
// Mock the invalidation leaf so invalidateIntelligenceCache is a spy; everything
// else in approvals.ts (db, state machine) runs for real against the worker DB.
vi.mock('../server/intelligence/cache-invalidation.js', () => {
  return { invalidateIntelligenceCache: vi.fn() };
});

describe('Task 4.1 — Cache-invalidation cluster — behavioral (spy fires with workspaceId)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('markBatchApplied calls invalidateIntelligenceCache with the workspaceId', async () => {
    const { invalidateIntelligenceCache } = await import('../server/intelligence/cache-invalidation.js');
    const { createBatch, updateItem, markBatchApplied } = await import('../server/approvals.js');
    const { createWorkspace, deleteWorkspace } = await import('../server/workspaces.js');

    const ws = createWorkspace('Cache Invalidation Behavioral Test');
    try {
      const batch = createBatch(ws.id, `site-${ws.id}`, 'Behavioral batch', [
        { pageId: 'page-1', pageTitle: 'Page 1', pageSlug: 'page-1', field: 'seoTitle', currentValue: 'old', proposedValue: 'new' },
      ]);
      const itemId = batch.items[0].id;

      // markBatchApplied only transitions APPROVED → applied, so approve first.
      updateItem(ws.id, batch.id, itemId, { status: 'approved' });

      vi.mocked(invalidateIntelligenceCache).mockClear();

      const result = markBatchApplied(ws.id, batch.id, [itemId]);
      expect(result).not.toBeNull();
      expect(result!.items[0].status).toBe('applied');

      // The actual behavioral assertion: the cache was invalidated for THIS workspace.
      expect(invalidateIntelligenceCache).toHaveBeenCalledWith(ws.id);
    } finally {
      deleteWorkspace(ws.id);
    }
  });

  it('updateItem calls invalidateIntelligenceCache with the workspaceId', async () => {
    const { invalidateIntelligenceCache } = await import('../server/intelligence/cache-invalidation.js');
    const { createBatch, updateItem } = await import('../server/approvals.js');
    const { createWorkspace, deleteWorkspace } = await import('../server/workspaces.js');

    const ws = createWorkspace('Cache Invalidation updateItem Test');
    try {
      const batch = createBatch(ws.id, `site-${ws.id}`, 'updateItem batch', [
        { pageId: 'page-1', pageTitle: 'Page 1', pageSlug: 'page-1', field: 'seoTitle', currentValue: 'old', proposedValue: 'new' },
      ]);
      vi.mocked(invalidateIntelligenceCache).mockClear();

      updateItem(ws.id, batch.id, batch.items[0].id, { status: 'approved' });

      expect(invalidateIntelligenceCache).toHaveBeenCalledWith(ws.id);
    } finally {
      deleteWorkspace(ws.id);
    }
  });
});
