/**
 * Wave 3c-iii-b (#12) — tracked_keywords STRIP: the row table is the SOLE store.
 *
 * The blob is no longer a data store: writeConfig writes the clean empty sentinel
 * `'[]'`, and the txn-start read in withTrackedKeywordsTxn reads FULL ROWS from the
 * tracked_keywords TABLE (carrying provenance). This file is the DATA-LOSS-CRITICAL
 * proof that the atomic pair (writeConfig strip + txn-start read switch) holds.
 *
 * Sub-tests:
 *  (1) READS COME FROM THE TABLE, blob written `'[]'` (no fallback) — populate the
 *      table via the real writer, assert the persisted blob is literally `'[]'`, and
 *      reads still return the keywords (so the table is the source, not the blob).
 *      Also: an EMPTY table returns EMPTY (no blob fallback) even when a stale legacy
 *      blob is written directly out-of-band.
 *  (2) A WRITE DOES NOT WIPE EXISTING KEYWORDS (the data-loss atomic pair) — seed
 *      keywords, then add another / run a reconcile; the pre-existing keywords MUST
 *      survive. If the txn-start read had stayed on the (now-`'[]'`) blob, the updater
 *      would receive nothing and replaceAllTrackedKeywordRows([]) would wipe the table.
 *  (3) ORDER PRESERVED TABLE-ONLY — the table's sort_order drives read order with no
 *      blob involvement.
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

const noopMiddleware = (_req: unknown, _res: unknown, next: () => void) => next();
vi.mock('../../server/middleware.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/middleware.js')>();
  return {
    ...original,
    publicWriteLimiter: noopMiddleware,
    publicApiLimiter: noopMiddleware,
    globalPublicLimiter: noopMiddleware,
  };
});
const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

const cleanupWorkspaceIds: string[] = [];

/** Read the raw blob column directly (to assert it is `'[]'` post-strip). */
async function readBlobColumn(workspaceId: string): Promise<string | undefined> {
  const { default: db } = await import('../../server/db/index.js');
  const row = db.prepare('SELECT tracked_keywords FROM rank_tracking_config WHERE workspace_id = ?')
    .get(workspaceId) as { tracked_keywords: string } | undefined;
  return row?.tracked_keywords;
}

/** Write the tracked_keywords blob DIRECTLY (bypassing the writer) — used to prove
 *  reads ignore a stale legacy blob. */
async function writeBlobDirect(workspaceId: string, keywords: unknown[]): Promise<void> {
  const { default: db } = await import('../../server/db/index.js');
  db.prepare(`
    INSERT INTO rank_tracking_config (workspace_id, tracked_keywords)
    VALUES (?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET tracked_keywords = excluded.tracked_keywords
  `).run(workspaceId, JSON.stringify(keywords));
}

beforeAll(async () => {
  await ctx.startServer();
}, 40_000);

afterAll(async () => {
  const { deleteWorkspace } = await import('../../server/workspaces.js');
  for (const id of cleanupWorkspaceIds) {
    try { deleteWorkspace(id); } catch { /* best-effort */ }
  }
  await ctx.stopServer();
});

let wsId = '';
beforeEach(async () => {
  const { createWorkspace } = await import('../../server/workspaces.js');
  wsId = createWorkspace(`TK Strip ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).id;
  cleanupWorkspaceIds.push(wsId);
});

// ════════════════════════════════════════════════════════════════════════════════
// (1) Reads come from the TABLE; the blob is written `'[]'` with NO fallback.
// ════════════════════════════════════════════════════════════════════════════════
describe('(1) table-only reads — blob written "[]" with no fallback', () => {
  it('after a write, the blob column is literally "[]" but reads return the keywords (from the table)', async () => {
    const { addTrackedKeyword, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { countTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const { TRACKED_KEYWORD_SOURCE } = await import('../../shared/types/rank-tracking.js');

    addTrackedKeyword(wsId, 'strip alpha', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    addTrackedKeyword(wsId, 'strip beta', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    // The blob is the empty sentinel — it is NO LONGER a data store.
    expect(await readBlobColumn(wsId)).toBe('[]');
    // But the table holds the real rows, and the read returns them.
    expect(countTrackedKeywordRows(wsId)).toBe(2);
    expect(getTrackedKeywords(wsId, { includeInactive: true }).map(k => k.query))
      .toEqual(['strip alpha', 'strip beta']);

    // The PUBLIC endpoint (real client-facing serialization) also returns the table data.
    const body = await (await api(`/api/public/tracked-keywords/${wsId}`)).json() as { keywords: { query: string }[] };
    expect(body.keywords.map(k => k.query)).toEqual(['strip alpha', 'strip beta']);
  });

  it('an EMPTY table returns EMPTY even with a stale legacy blob written out-of-band (NO fallback)', async () => {
    const { getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { countTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');

    // No writer ran → table empty. Write a non-empty legacy blob directly.
    await writeBlobDirect(wsId, [
      { query: 'ghost from the blob', pinned: false, addedAt: '2026-01-01T00:00:00.000Z', source: 'manual', status: 'active' },
    ]);
    expect(countTrackedKeywordRows(wsId)).toBe(0);

    // The strip removed the empty-table blob fallback: reads return EMPTY.
    expect(getTrackedKeywords(wsId, { includeInactive: true })).toEqual([]);
    const body = await (await api(`/api/public/tracked-keywords/${wsId}`)).json() as { keywords: { query: string }[] };
    expect(body.keywords).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// (2) A write does NOT wipe existing keywords — the data-loss atomic pair holds.
// ════════════════════════════════════════════════════════════════════════════════
describe('(2) a subsequent write does NOT wipe existing keywords (data-loss atomic pair)', () => {
  it('adding a NEW keyword preserves the pre-existing ones (txn-start read is the table, not "[]")', async () => {
    const { addTrackedKeyword, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE } = await import('../../shared/types/rank-tracking.js');

    addTrackedKeyword(wsId, 'survivor one', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    addTrackedKeyword(wsId, 'survivor two', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    // A THIRD write (the one that would wipe if the read had stayed on the "[]" blob).
    addTrackedKeyword(wsId, 'survivor three', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    const queries = getTrackedKeywords(wsId, { includeInactive: true }).map(k => k.query);
    expect(queries).toEqual(['survivor one', 'survivor two', 'survivor three']);
    // Blob stays the empty sentinel throughout.
    expect(await readBlobColumn(wsId)).toBe('[]');
  });

  it('a reconcile RMW preserves a client-requested keyword (and reads its provenance/ownership from the table)', async () => {
    const { saveKeywordFeedback } = await import('../../server/keyword-feedback.js');
    const { reconcileStrategyRankTracking } = await import('../../server/rank-tracking-reconciliation.js');
    const { getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { listTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const { keywordComparisonKey } = await import('../../shared/keyword-normalization.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    // A client approval from a gap surface — carries sourceGapKey + CLIENT_REQUESTED.
    saveKeywordFeedback({ workspaceId: wsId, keyword: 'client gap keyword', status: 'approved', source: 'content_gap' });
    const gapKey = keywordComparisonKey('client gap keyword');
    // Provenance is on the table (full-row read source).
    expect(listTrackedKeywordRows(wsId).find(r => keywordComparisonKey(r.query) === gapKey)?.sourceGapKey).toBe(gapKey);

    // Reconcile whose targets EXCLUDE the client keyword. The txn-start read is the
    // FULL-ROW table read, so the updater sees sourceGapKey + the existing rows — the
    // client keyword is protected and survives, and a NEW strategy keyword is added.
    const generatedAt = '2026-06-04T10:00:00.000Z';
    reconcileStrategyRankTracking({
      workspaceId: wsId,
      generatedAt,
      keywordStrategy: { siteKeywords: ['fresh strategy keyword'], generatedAt },
      pageMap: [],
    });

    const after = new Map(listTrackedKeywordRows(wsId).map(r => [keywordComparisonKey(r.query), r]));
    const clientRow = after.get(gapKey);
    expect(clientRow).toBeDefined();
    expect(clientRow!.status).toBe(TRACKED_KEYWORD_STATUS.ACTIVE);
    // A content_gap approval stores source=CONTENT_GAP; it is sourceGapKey-protected
    // (isProtected) so reconcile never auto-deprecates it.
    expect(clientRow!.source).toBe(TRACKED_KEYWORD_SOURCE.CONTENT_GAP);
    // FILL-IF-EMPTY: the existing sourceGapKey survived the read→mutate→write loop.
    expect(clientRow!.sourceGapKey).toBe(gapKey);
    // The newly-added strategy keyword is reconcile-owned (strategyOwned read from the table).
    const strategyRow = after.get(keywordComparisonKey('fresh strategy keyword'));
    expect(strategyRow?.strategyOwned).toBe(true);

    // Both visible in the active read; the blob is still the empty sentinel.
    const active = getTrackedKeywords(wsId).map(k => keywordComparisonKey(k.query));
    expect(active).toContain(gapKey);
    expect(active).toContain(keywordComparisonKey('fresh strategy keyword'));
    expect(await readBlobColumn(wsId)).toBe('[]');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// (3) Order preserved table-only (sort_order drives read order, no blob involvement).
// ════════════════════════════════════════════════════════════════════════════════
describe('(3) order preserved table-only', () => {
  it('a re-persist in a new order re-stamps sort_order, and reads follow it (blob stays "[]")', async () => {
    const { withTrackedKeywordsTxn, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    const mk = (query: string, addedAt: string) => ({
      query, pinned: false, addedAt,
      source: TRACKED_KEYWORD_SOURCE.MANUAL, status: TRACKED_KEYWORD_STATUS.ACTIVE,
    });

    // Initial order. addedAt is NON-monotonic with array position so the only thing
    // that can produce this exact order on read is sort_order (the array index).
    withTrackedKeywordsTxn(wsId, () => [
      mk('order gamma', '2026-05-03T00:00:00.000Z'),
      mk('order alpha', '2026-05-01T00:00:00.000Z'),
      mk('order beta', '2026-05-02T00:00:00.000Z'),
    ]);
    expect(getTrackedKeywords(wsId, { includeInactive: true }).map(k => k.query))
      .toEqual(['order gamma', 'order alpha', 'order beta']);

    // Re-persist in a DIFFERENT order; reads must follow the NEW positions.
    withTrackedKeywordsTxn(wsId, existing => {
      const byQuery = new Map(existing.map(k => [k.query, k]));
      return [byQuery.get('order beta')!, byQuery.get('order gamma')!, byQuery.get('order alpha')!];
    });
    expect(getTrackedKeywords(wsId, { includeInactive: true }).map(k => k.query))
      .toEqual(['order beta', 'order gamma', 'order alpha']);

    expect(await readBlobColumn(wsId)).toBe('[]');
  });
});
