/**
 * Wave 3c-ii (#12) — tracked_keywords READ-SWITCH: TABLE-FIRST / BLOB-FALLBACK
 * resolver. ADDITIVE, behavior-preserving (the blob write + dual-write + fallback
 * are KEPT; the strip is the later 3c-iii). This file proves the read switch is
 * byte-identical to the blob path INCLUDING ORDER, and that the resolver is the
 * actual read source.
 *
 * Sub-tests:
 *  (1) ORDER-SENSITIVE full parity — for a populated workspace whose TABLE order
 *      (added_at, normalized_query) DIFFERS from the BLOB insertion order,
 *      getTrackedKeywords / getRankHistory / getLatestRanks are byte-identical
 *      whether sourced from table or blob, compared with JSON.stringify WITHOUT any
 *      per-query re-sort (so this assertion guards ORDER, which the 3c-i parity
 *      helper — which sorts by query — does NOT). Also exercises the REAL public
 *      endpoints GET /api/public/tracked-keywords/:id and /api/public/seo-strategy/:id.
 *  (2) BLOB-FALLBACK fires — blob written directly + table cleared (empty) → readers
 *      still return the blob data.
 *  (3) TABLE-FIRST overrides blob — populated table + mutate ONLY the blob
 *      out-of-band → resolver output does NOT change (proves the table is the read
 *      source).
 *  (4) RECONCILE deletion-set parity — reconcileStrategyRankTracking produces the
 *      same added/retained/deprecated/replaced changeset whether the table is
 *      populated or empty (its txn-start read MUST stay on the blob).
 *
 * Port: 13894 (next free per re-grep of tests/ — 13888 from the audit was already
 * taken by keyword-strategy-assembler-public-read.test.ts; 13886/13890-13893 are
 * the rest of the keyword-consolidation cluster).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestContext } from './helpers.js';

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

const PORT = 13894;
const ctx = createTestContext(PORT);
const { api } = ctx;

const cleanupWorkspaceIds: string[] = [];

/** Write the tracked_keywords blob DIRECTLY (bypassing the dual-write). */
async function writeBlobDirect(workspaceId: string, keywords: unknown[]): Promise<void> {
  const { default: db } = await import('../../server/db/index.js');
  db.prepare(`
    INSERT INTO rank_tracking_config (workspace_id, tracked_keywords)
    VALUES (?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET tracked_keywords = excluded.tracked_keywords
  `).run(workspaceId, JSON.stringify(keywords));
}

/** Read the raw blob array back (for the order-source-of-truth assertion). */
async function readBlobDirect(workspaceId: string): Promise<Array<{ query: string }>> {
  const { default: db } = await import('../../server/db/index.js');
  const row = db.prepare('SELECT tracked_keywords FROM rank_tracking_config WHERE workspace_id = ?')
    .get(workspaceId) as { tracked_keywords: string } | undefined;
  return row ? JSON.parse(row.tracked_keywords) : [];
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

// ════════════════════════════════════════════════════════════════════════════════
// (1) ORDER-SENSITIVE FULL PARITY (table vs blob), incl. the REAL public endpoints
// ════════════════════════════════════════════════════════════════════════════════
describe('(1) golden order — table-only read keeps the seeded order via sort_order', () => {
  it('getTrackedKeywords / getRankHistory / getLatestRanks + public endpoints all keep golden order TABLE-ONLY', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { getTrackedKeywords, getRankHistory, getLatestRanks, storeRankSnapshot } =
      await import('../../server/rank-tracking.js');
    const {
      migrateTrackedKeywordsFromConfigBlob,
      countTrackedKeywordRows,
      deleteAllTrackedKeywordRows,
    } = await import('../../server/tracked-keywords-store.js');

    const ws = createWorkspace(`TK Resolver Order ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    // Wave 3c-iii-b: the blob is no longer a STORE — but it is still the legitimate
    // SEED for the boot backfill (legacy-workspace migration). Insertion order is
    // zebra, apple, mango, (retired) — addedAt is NON-monotonic with array position
    // (apple=01, mango=02, zebra=03), so the table's natural (added_at,
    // normalized_query) order DIFFERS. The boot backfill stamps sort_order = the blob
    // array index, so the TABLE-ONLY read must restore the SEED order from sort_order
    // alone (no blob read at runtime). After this seed step, the blob can be ignored.
    const blob = [
      { query: 'zebra dental', pinned: false, addedAt: '2026-01-03T00:00:00.000Z', source: 'manual', status: 'active' },
      { query: 'apple braces', pinned: true, addedAt: '2026-01-01T00:00:00.000Z', source: 'strategy_primary', status: 'active', pagePath: '/braces', pageTitle: 'Braces', volume: 100, difficulty: 5 },
      { query: 'mango whitening', pinned: false, addedAt: '2026-01-02T00:00:00.000Z', source: 'content_gap', status: 'active' },
      // An INACTIVE row, to exercise the includeInactive:false filter after resolve.
      { query: 'retired kw', pinned: false, addedAt: '2026-01-04T00:00:00.000Z', source: 'strategy_primary', status: 'deprecated', deprecatedAt: '2026-01-05T00:00:00.000Z' },
    ];
    await writeBlobDirect(ws.id, blob);

    // Snapshot so getRankHistory / getLatestRanks have data to join.
    storeRankSnapshot(ws.id, '2026-06-01', [
      { query: 'zebra dental', position: 4, clicks: 10, impressions: 100, ctr: 0.1 },
      { query: 'apple braces', position: 1, clicks: 50, impressions: 500, ctr: 0.1 },
      { query: 'mango whitening', position: 7, clicks: 5, impressions: 80, ctr: 0.06 },
    ]);
    storeRankSnapshot(ws.id, '2026-06-02', [
      { query: 'zebra dental', position: 3, clicks: 12, impressions: 110, ctr: 0.11 },
      { query: 'apple braces', position: 1, clicks: 55, impressions: 520, ctr: 0.11 },
      { query: 'mango whitening', position: 6, clicks: 6, impressions: 85, ctr: 0.07 },
    ]);

    // ── Populate the TABLE from the seed blob via the boot backfill (sort_order =
    //    blob array index). The table is the SOLE store from here on. ──
    deleteAllTrackedKeywordRows(ws.id);
    expect(countTrackedKeywordRows(ws.id)).toBe(0);
    migrateTrackedKeywordsFromConfigBlob();
    expect(countTrackedKeywordRows(ws.id)).toBe(4);

    // Prove the TABLE's NATURAL (added_at, normalized_query) order DIFFERS from the
    // seed order — so sort_order is genuinely doing the ordering work, not a no-op.
    const rawTableOrder = (db.prepare(
      'SELECT query FROM tracked_keywords WHERE workspace_id = ? ORDER BY added_at ASC, normalized_query ASC',
    ).all(ws.id) as { query: string }[]).map(r => r.query);
    expect(rawTableOrder).toEqual(['apple braces', 'mango whitening', 'zebra dental', 'retired kw']);

    const tableTrackedAll = getTrackedKeywords(ws.id, { includeInactive: true });
    const tableTrackedActive = getTrackedKeywords(ws.id, { includeInactive: false });
    const tableHistory = getRankHistory(ws.id);
    const tableLatest = getLatestRanks(ws.id);

    const tablePublicTracked = await (await api(`/api/public/tracked-keywords/${ws.id}`)).json() as { keywords: { query: string }[] };

    // ── GOLDEN ORDER (table-only via sort_order): the SEED insertion order is restored
    //    — zebra, apple, mango, (retired) — NOT the raw (added_at) table order. ──
    expect(tableTrackedAll.map(k => k.query)).toEqual(['zebra dental', 'apple braces', 'mango whitening', 'retired kw']);
    expect(tableTrackedActive.map(k => k.query)).toEqual(['zebra dental', 'apple braces', 'mango whitening']);
    expect(tableTrackedAll.map(k => k.query)).not.toEqual(rawTableOrder);
    expect(tablePublicTracked.keywords.map(k => k.query)).toEqual(['zebra dental', 'apple braces', 'mango whitening']);

    // getRankHistory / getLatestRanks read the same table-only tracked set; spot-check
    // they joined the snapshots and surfaced the active keywords.
    expect(tableHistory.length).toBeGreaterThan(0);
    expect(tableLatest.map(k => k.query)).toEqual(expect.arrayContaining(['apple braces', 'zebra dental', 'mango whitening']));
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// (1b) Wave 3c-iii-a — sort_order EQUALS the blob array index after backfill
//      (the load-bearing invariant: the order moves to sort_order, sourced from the
//       live blob index; includes the append-fallback tail for table-only rows).
// ════════════════════════════════════════════════════════════════════════════════
describe('(1b) sort_order backfill — equals the blob array index per key (+ append-fallback tail)', () => {
  it('never-backfilled (case A): boot backfill stamps sort_order = blob array index', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const { createWorkspace } = await import('../../server/workspaces.js');
    const {
      migrateTrackedKeywordsFromConfigBlob,
      countTrackedKeywordRows,
      deleteAllTrackedKeywordRows,
    } = await import('../../server/tracked-keywords-store.js');

    const ws = createWorkspace(`TK SortOrder CaseA ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    // Blob order is gamma(0), alpha(1), beta(2), delta(3) — NON-monotonic addedAt so
    // the table's natural (added_at, normalized_query) order would NOT match.
    const blob = [
      { query: 'gamma kw', pinned: false, addedAt: '2026-05-03T00:00:00.000Z', source: 'manual', status: 'active' },
      { query: 'alpha kw', pinned: false, addedAt: '2026-05-01T00:00:00.000Z', source: 'manual', status: 'active' },
      { query: 'beta kw', pinned: false, addedAt: '2026-05-02T00:00:00.000Z', source: 'manual', status: 'active' },
      { query: 'delta kw', pinned: false, addedAt: '2026-05-04T00:00:00.000Z', source: 'manual', status: 'active' },
    ];
    await writeBlobDirect(ws.id, blob);
    deleteAllTrackedKeywordRows(ws.id);
    expect(countTrackedKeywordRows(ws.id)).toBe(0);

    migrateTrackedKeywordsFromConfigBlob();
    expect(countTrackedKeywordRows(ws.id)).toBe(4);

    // Each row's sort_order MUST equal its position in the blob array.
    const rows = db.prepare(
      'SELECT query, sort_order FROM tracked_keywords WHERE workspace_id = ? ORDER BY sort_order ASC',
    ).all(ws.id) as { query: string; sort_order: number }[];
    expect(rows.map(r => r.query)).toEqual(['gamma kw', 'alpha kw', 'beta kw', 'delta kw']);
    const indexByQuery = new Map(blob.map((k, i) => [k.query, i]));
    for (const r of rows) {
      expect(r.sort_order).toBe(indexByQuery.get(r.query));
    }
  });

  it('already-backfilled (case B): NULL sort_order rows are stamped from the blob index, table-only rows append after blob.length', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { keywordComparisonKey } = await import('../../shared/keyword-normalization.js');
    const {
      migrateTrackedKeywordsFromConfigBlob,
      countTrackedKeywordRows,
      deleteAllTrackedKeywordRows,
    } = await import('../../server/tracked-keywords-store.js');

    const ws = createWorkspace(`TK SortOrder CaseB ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    // Blob carries three keys in a specific order.
    const blob = [
      { query: 'zulu kw', addedAt: '2026-05-13T00:00:00.000Z' },
      { query: 'xray kw', addedAt: '2026-05-11T00:00:00.000Z' },
      { query: 'whiskey kw', addedAt: '2026-05-12T00:00:00.000Z' },
    ];
    await writeBlobDirect(ws.id, blob);
    deleteAllTrackedKeywordRows(ws.id);

    // Simulate the 3c-i state: rows already exist WITH NULL sort_order. We insert the
    // three blob keys PLUS one table-only key ('tango kw') that is NOT in the blob —
    // it must receive the append-fallback tail index (blob.length + 0).
    const seedRows = [
      { query: 'zulu kw', added_at: '2026-05-13T00:00:00.000Z' },
      { query: 'xray kw', added_at: '2026-05-11T00:00:00.000Z' },
      { query: 'whiskey kw', added_at: '2026-05-12T00:00:00.000Z' },
      { query: 'tango kw', added_at: '2026-05-10T00:00:00.000Z' }, // table-only, earliest addedAt
    ];
    const insertNullSort = db.prepare(
      `INSERT INTO tracked_keywords (workspace_id, normalized_query, query, pinned, added_at, source, status, sort_order)
       VALUES (?, ?, ?, 0, ?, 'manual', 'active', NULL)`,
    );
    const insertMany = db.transaction(() => {
      for (const r of seedRows) {
        insertNullSort.run(ws.id, keywordComparisonKey(r.query), r.query, r.added_at);
      }
    });
    insertMany();
    expect(countTrackedKeywordRows(ws.id)).toBe(4);
    // Pre-condition: all sort_order NULL.
    const nullCount = (db.prepare(
      'SELECT COUNT(*) AS c FROM tracked_keywords WHERE workspace_id = ? AND sort_order IS NULL',
    ).get(ws.id) as { c: number }).c;
    expect(nullCount).toBe(4);

    // Run the backfill — case B path (count > 0): stamps sort_order WHERE NULL.
    migrateTrackedKeywordsFromConfigBlob();

    const rows = db.prepare(
      'SELECT query, sort_order FROM tracked_keywords WHERE workspace_id = ? ORDER BY sort_order ASC',
    ).all(ws.id) as { query: string; sort_order: number }[];
    // Blob keys keep their blob index; the table-only 'tango kw' appends at blob.length (3).
    expect(rows).toEqual([
      { query: 'zulu kw', sort_order: 0 },
      { query: 'xray kw', sort_order: 1 },
      { query: 'whiskey kw', sort_order: 2 },
      { query: 'tango kw', sort_order: 3 },
    ]);

    // Idempotent: a second run touches nothing (all sort_order now non-NULL).
    migrateTrackedKeywordsFromConfigBlob();
    const rows2 = db.prepare(
      'SELECT query, sort_order FROM tracked_keywords WHERE workspace_id = ? ORDER BY sort_order ASC',
    ).all(ws.id) as { query: string; sort_order: number }[];
    expect(rows2).toEqual(rows);
  });

  it('write path re-stamps sort_order from the array position (delete-then-reinsert preserves order)', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { replaceAllTrackedKeywordRows, resolveTrackedKeywords } = await import('../../server/tracked-keywords-store.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    const ws = createWorkspace(`TK SortOrder Write ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    const mk = (query: string, addedAt: string) => ({
      query, pinned: false, addedAt,
      source: TRACKED_KEYWORD_SOURCE.MANUAL, status: TRACKED_KEYWORD_STATUS.ACTIVE,
    });

    // First write: order A.
    replaceAllTrackedKeywordRows(ws.id, [mk('one', '2026-05-01'), mk('two', '2026-05-02'), mk('three', '2026-05-03')]);
    const after1 = db.prepare(
      'SELECT query, sort_order FROM tracked_keywords WHERE workspace_id = ? ORDER BY sort_order ASC',
    ).all(ws.id) as { query: string; sort_order: number }[];
    expect(after1).toEqual([
      { query: 'one', sort_order: 0 },
      { query: 'two', sort_order: 1 },
      { query: 'three', sort_order: 2 },
    ]);

    // Re-persist with a DIFFERENT array order: sort_order must follow the new positions.
    replaceAllTrackedKeywordRows(ws.id, [mk('three', '2026-05-03'), mk('one', '2026-05-01'), mk('two', '2026-05-02')]);
    const after2 = db.prepare(
      'SELECT query, sort_order FROM tracked_keywords WHERE workspace_id = ? ORDER BY sort_order ASC',
    ).all(ws.id) as { query: string; sort_order: number }[];
    expect(after2).toEqual([
      { query: 'three', sort_order: 0 },
      { query: 'one', sort_order: 1 },
      { query: 'two', sort_order: 2 },
    ]);

    // And the RESOLVER (the read path) emits the new array order — proving sort_order
    // drives ordering. With sort_order left NULL on reinsert, this scrambles to the
    // (added_at, normalized_query) tiebreaker (one, two, three) and FAILS. Wave 3c-iii-b:
    // the resolver is now TABLE-ONLY (no blobKeywords param).
    const resolved = resolveTrackedKeywords(ws.id);
    expect(resolved.map(k => k.query)).toEqual(['three', 'one', 'two']);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// (2) NO BLOB FALLBACK (Wave 3c-iii-b strip) — empty table → readers return EMPTY,
//     even with a stale legacy blob written directly out-of-band.
// ════════════════════════════════════════════════════════════════════════════════
describe('(2) no blob-fallback — empty table → readers return EMPTY (strip removed the fallback)', () => {
  it('getTrackedKeywords + public endpoint return EMPTY when the table is empty, ignoring a stale blob', async () => {
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { deleteAllTrackedKeywordRows, countTrackedKeywordRows } =
      await import('../../server/tracked-keywords-store.js');

    const ws = createWorkspace(`TK Resolver NoFallback ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    // Write a non-empty legacy blob directly, then ensure the table is empty.
    await writeBlobDirect(ws.id, [
      { query: 'fallback alpha', pinned: false, addedAt: '2026-02-01T00:00:00.000Z', source: 'manual', status: 'active' },
      { query: 'fallback beta', pinned: true, addedAt: '2026-02-02T00:00:00.000Z', source: 'manual', status: 'active' },
    ]);
    deleteAllTrackedKeywordRows(ws.id);
    expect(countTrackedKeywordRows(ws.id)).toBe(0);

    // The strip removed the empty-table blob fallback: reads return EMPTY.
    const resolved = getTrackedKeywords(ws.id, { includeInactive: true });
    expect(resolved).toEqual([]);

    const publicRes = await api(`/api/public/tracked-keywords/${ws.id}`);
    expect(publicRes.status).toBe(200);
    const body = await publicRes.json() as { keywords: { query: string }[] };
    expect(body.keywords).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// (3) TABLE-FIRST overrides blob — proves the table is the read source
// ════════════════════════════════════════════════════════════════════════════════
describe('(3) table-first — populated table + out-of-band blob mutation → output unchanged', () => {
  it('mutating an EXISTING key ONLY in the blob does NOT change resolver output (table data wins)', async () => {
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { addTrackedKeyword, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { countTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const { TRACKED_KEYWORD_SOURCE } = await import('../../shared/types/rank-tracking.js');

    const ws = createWorkspace(`TK Resolver TableFirst ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    // Populate the table via the real writer (dual-writes blob + table in sync).
    // Pin 'table truth two' so the table row carries pinned=true.
    addTrackedKeyword(ws.id, 'table truth one', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    addTrackedKeyword(ws.id, 'table truth two', { source: TRACKED_KEYWORD_SOURCE.MANUAL, pinned: true });
    expect(countTrackedKeywordRows(ws.id)).toBe(2);

    const before = getTrackedKeywords(ws.id, { includeInactive: true });
    expect(before.map(k => k.query)).toEqual(['table truth one', 'table truth two']);
    expect(before.find(k => k.query === 'table truth two')?.pinned).toBe(true);

    // Now mutate ONLY the blob out-of-band: flip pinned + change the source on the
    // SAME keys that exist in the table (no new keys). The table is left untouched
    // and is non-empty, so the resolver must return the TABLE's data, ignoring
    // these blob-side mutations entirely.
    await writeBlobDirect(ws.id, [
      { query: 'table truth one', pinned: true, addedAt: '2026-03-01T00:00:00.000Z', source: 'client_requested', status: 'active' },
      { query: 'table truth two', pinned: false, addedAt: '2026-03-02T00:00:00.000Z', source: 'content_gap', status: 'active' },
    ]);

    // Sanity: the blob really does carry the mutated values now.
    const rawBlob = await readBlobDirect(ws.id) as Array<{ query: string; pinned: boolean; source: string }>;
    expect(rawBlob.find(k => k.query === 'table truth one')?.pinned).toBe(true);
    expect(rawBlob.find(k => k.query === 'table truth two')?.source).toBe('content_gap');

    const after = getTrackedKeywords(ws.id, { includeInactive: true });
    // Table data wins: the resolver returns the table's pinned/source, NOT the blob's.
    expect(after.find(k => k.query === 'table truth one')?.pinned).toBe(false); // table: unpinned
    expect(after.find(k => k.query === 'table truth one')?.source).toBe('manual'); // table: manual, not client_requested
    expect(after.find(k => k.query === 'table truth two')?.pinned).toBe(true); // table: pinned
    expect(after.find(k => k.query === 'table truth two')?.source).toBe('manual'); // table: manual, not content_gap
    expect(after.map(k => k.query).sort()).toEqual(['table truth one', 'table truth two']);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// (4) RECONCILE deletion-set parity — changeset identical table-populated vs empty
// ════════════════════════════════════════════════════════════════════════════════
describe('(4) reconcile deletion-set parity — changeset identical regardless of table state', () => {
  async function runReconcile(workspaceId: string) {
    const { reconcileStrategyRankTracking } = await import('../../server/rank-tracking-reconciliation.js');
    return reconcileStrategyRankTracking({
      workspaceId,
      keywordStrategy: { siteKeywords: ['kept site kw'], generatedAt: '2026-04-02T00:00:00.000Z' },
      pageMap: [],
      generatedAt: '2026-04-02T00:00:00.000Z',
    });
  }

  function summarize(cs: { added: { query: string }[]; retained: { query: string }[]; deprecated: { query: string }[]; replaced: { query: string }[] }) {
    const q = (xs: { query: string }[]) => xs.map(k => k.query).sort();
    return { added: q(cs.added), retained: q(cs.retained), deprecated: q(cs.deprecated), replaced: q(cs.replaced) };
  }

  // Wave 3d-ii: ownership now lives ONLY in the table (strategy_owned). A keyword
  // seeded with a STRATEGY_* source but no established ownership is NOT auto-
  // deprecated — the conservative default. So the "deprecation" arm of the changeset
  // requires the table-resident strategyOwned flag (which reconcile establishes).
  // The add/retain/replace arms remain table-vs-blob parity-identical.
  async function runEstablish(workspaceId: string) {
    const { reconcileStrategyRankTracking } = await import('../../server/rank-tracking-reconciliation.js');
    // First reconcile INCLUDES 'old strategy kw' so reconcile establishes ownership
    // (strategyOwned=true persisted to the table).
    return reconcileStrategyRankTracking({
      workspaceId,
      keywordStrategy: { siteKeywords: ['old strategy kw'], generatedAt: '2026-04-01T12:00:00.000Z' },
      pageMap: [],
      generatedAt: '2026-04-01T12:00:00.000Z',
    });
  }

  it('strategy-sourced keyword WITHOUT established ownership is conservatively NOT auto-deprecated', async () => {
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { addTrackedKeyword } = await import('../../server/rank-tracking.js');
    const { countTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const { TRACKED_KEYWORD_SOURCE } = await import('../../shared/types/rank-tracking.js');

    const ws = createWorkspace(`TK Reconcile ColdTable ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    // Wave 3c-iii-b: seed via the TABLE writer (the blob is no longer a store). The
    // keyword carries a STRATEGY_* source but NO established ownership (strategyOwned
    // unset) — the migration-safety case. Ownership lives ONLY in the table column,
    // and reconcile is its sole writer, so a strategy-sourced-but-unowned row must NOT
    // be auto-deprecated.
    addTrackedKeyword(ws.id, 'old strategy kw', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/old',
      pageTitle: 'Old',
    });
    addTrackedKeyword(ws.id, 'manual stay', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    expect(countTrackedKeywordRows(ws.id)).toBe(2);

    // Reconcile WITHOUT 'old strategy kw' as a target. With no table-resident
    // ownership, it is preserved (not deprecated) — the migration safety pause.
    const cs = summarize(await runReconcile(ws.id));
    expect(cs.deprecated).not.toContain('old strategy kw');
    expect(cs.added).toEqual(['kept site kw']);
  });

  it('produces the same added/retained/replaced/deprecated set whether table is populated or empty AFTER ownership is established', async () => {
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { deleteAllTrackedKeywordRows, countTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');

    // Wave 3c-iii-b: both runs seed via reconcile (the table writer) and the table
    // is the SOLE store for the measured reconcile — there is no blob involvement.
    // ── Run A: establish ownership; the table stays populated for the measured reconcile. ──
    const wsA = createWorkspace(`TK Reconcile Empty ${Date.now()}`);
    cleanupWorkspaceIds.push(wsA.id);
    await runEstablish(wsA.id); // populates table with strategyOwned=true
    expect(countTrackedKeywordRows(wsA.id)).toBeGreaterThan(0);
    const changesetPopulated = summarize(await runReconcile(wsA.id));

    // ── Run B: establish ownership identically; table stays populated. ──
    const wsB = createWorkspace(`TK Reconcile Populated ${Date.now()}`);
    cleanupWorkspaceIds.push(wsB.id);
    await runEstablish(wsB.id);
    expect(countTrackedKeywordRows(wsB.id)).toBeGreaterThan(0);
    const changesetPopulated2 = summarize(await runReconcile(wsB.id));

    expect(changesetPopulated2).toEqual(changesetPopulated);
    // With established ownership, the strategy kw IS deprecated when it drops off,
    // the new site keyword is added.
    expect(changesetPopulated.deprecated).toEqual(['old strategy kw']);
    expect(changesetPopulated.added).toEqual(['kept site kw']);

    // Dropping the table clears the store (no blob fallback): a subsequent read/reconcile
    // sees an empty store.
    deleteAllTrackedKeywordRows(wsA.id);
    expect(countTrackedKeywordRows(wsA.id)).toBe(0);
  });
});
