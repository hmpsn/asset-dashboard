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
describe('(1) order-sensitive parity — table read is byte-identical to blob incl. order', () => {
  it('getTrackedKeywords / getRankHistory / getLatestRanks + public endpoints all match', async () => {
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

    // Blob insertion order is zebra, apple, mango — but addedAt is NON-monotonic
    // with array position (apple=01, mango=02, zebra=03). So the table, ordered by
    // (added_at, normalized_query), lists apple, mango, zebra — a DIFFERENT order.
    // A correct Option-A reorder must restore the BLOB order (zebra, apple, mango).
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

    // ── PHASE A: table EMPTY → readers serve the BLOB (capture the golden output). ──
    deleteAllTrackedKeywordRows(ws.id);
    expect(countTrackedKeywordRows(ws.id)).toBe(0);

    const blobTrackedAll = getTrackedKeywords(ws.id, { includeInactive: true });
    const blobTrackedActive = getTrackedKeywords(ws.id, { includeInactive: false });
    const blobHistory = getRankHistory(ws.id);
    const blobLatest = getLatestRanks(ws.id);

    // The blob path preserves insertion order: zebra, apple, mango, (retired).
    expect(blobTrackedAll.map(k => k.query)).toEqual(['zebra dental', 'apple braces', 'mango whitening', 'retired kw']);

    const blobPublicTracked = await (await api(`/api/public/tracked-keywords/${ws.id}`)).json() as { keywords: { query: string }[] };
    const blobPublicStrategy = await (await api(`/api/public/seo-strategy/${ws.id}`)).json() as { trackedKeywords?: { query: string }[] } | null;

    // ── PHASE B: populate the TABLE from the blob (backfill), then re-read. ──
    migrateTrackedKeywordsFromConfigBlob();
    expect(countTrackedKeywordRows(ws.id)).toBe(4);

    // Prove the TABLE's natural order DIFFERS from the blob order (so the reorder
    // is actually doing work, not a no-op).
    const rawTableOrder = (db.prepare(
      'SELECT query FROM tracked_keywords WHERE workspace_id = ? ORDER BY added_at ASC, normalized_query ASC',
    ).all(ws.id) as { query: string }[]).map(r => r.query);
    expect(rawTableOrder).toEqual(['apple braces', 'mango whitening', 'zebra dental', 'retired kw']);
    expect(rawTableOrder).not.toEqual(blobTrackedAll.map(k => k.query));

    const tableTrackedAll = getTrackedKeywords(ws.id, { includeInactive: true });
    const tableTrackedActive = getTrackedKeywords(ws.id, { includeInactive: false });
    const tableHistory = getRankHistory(ws.id);
    const tableLatest = getLatestRanks(ws.id);

    const tablePublicTracked = await (await api(`/api/public/tracked-keywords/${ws.id}`)).json() as { keywords: { query: string }[] };
    const tablePublicStrategy = await (await api(`/api/public/seo-strategy/${ws.id}`)).json() as { trackedKeywords?: { query: string }[] } | null;

    // ── PARITY: byte-identical via JSON.stringify, NO per-query re-sort (guards order). ──
    expect(JSON.stringify(tableTrackedAll)).toBe(JSON.stringify(blobTrackedAll));
    expect(JSON.stringify(tableTrackedActive)).toBe(JSON.stringify(blobTrackedActive));
    expect(JSON.stringify(tableHistory)).toBe(JSON.stringify(blobHistory));
    expect(JSON.stringify(tableLatest)).toBe(JSON.stringify(blobLatest));
    expect(JSON.stringify(tablePublicTracked)).toBe(JSON.stringify(blobPublicTracked));
    expect(JSON.stringify(tablePublicStrategy)).toBe(JSON.stringify(blobPublicStrategy));

    // And explicitly: the resolved order matches the BLOB order, not the raw table order.
    expect(tableTrackedAll.map(k => k.query)).toEqual(['zebra dental', 'apple braces', 'mango whitening', 'retired kw']);
    expect(tablePublicTracked.keywords.map(k => k.query)).toEqual(['zebra dental', 'apple braces', 'mango whitening']);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// (2) BLOB-FALLBACK fires when the table is empty
// ════════════════════════════════════════════════════════════════════════════════
describe('(2) blob-fallback — empty table → readers return the blob', () => {
  it('getTrackedKeywords + public endpoint serve the blob when the table is empty', async () => {
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { deleteAllTrackedKeywordRows, countTrackedKeywordRows } =
      await import('../../server/tracked-keywords-store.js');

    const ws = createWorkspace(`TK Resolver Fallback ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    await writeBlobDirect(ws.id, [
      { query: 'fallback alpha', pinned: false, addedAt: '2026-02-01T00:00:00.000Z', source: 'manual', status: 'active' },
      { query: 'fallback beta', pinned: true, addedAt: '2026-02-02T00:00:00.000Z', source: 'manual', status: 'active' },
    ]);
    deleteAllTrackedKeywordRows(ws.id);
    expect(countTrackedKeywordRows(ws.id)).toBe(0);

    const resolved = getTrackedKeywords(ws.id, { includeInactive: true });
    expect(resolved.map(k => k.query)).toEqual(['fallback alpha', 'fallback beta']);

    const publicRes = await api(`/api/public/tracked-keywords/${ws.id}`);
    expect(publicRes.status).toBe(200);
    const body = await publicRes.json() as { keywords: { query: string }[] };
    expect(body.keywords.map(k => k.query)).toEqual(['fallback alpha', 'fallback beta']);
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

  it('produces the same added/retained/deprecated/replaced set whether table is populated or empty', async () => {
    const { createWorkspace } = await import('../../server/workspaces.js');
    const {
      migrateTrackedKeywordsFromConfigBlob,
      deleteAllTrackedKeywordRows,
      countTrackedKeywordRows,
    } = await import('../../server/tracked-keywords-store.js');

    // Seed a strategy-owned keyword that is NOT in the next strategy (so it gets
    // deprecated), plus a manual keyword (preserved).
    const seed = [
      { query: 'old strategy kw', pinned: false, addedAt: '2026-04-01T00:00:00.000Z', source: 'strategy_primary', status: 'active', pagePath: '/old', pageTitle: 'Old' },
      { query: 'manual stay', pinned: false, addedAt: '2026-04-01T01:00:00.000Z', source: 'manual', status: 'active' },
    ];

    // ── Run A: table EMPTY (blob fallback feeds getLatestSnapshotRanks join). ──
    const wsA = createWorkspace(`TK Reconcile Empty ${Date.now()}`);
    cleanupWorkspaceIds.push(wsA.id);
    await writeBlobDirect(wsA.id, seed);
    deleteAllTrackedKeywordRows(wsA.id);
    expect(countTrackedKeywordRows(wsA.id)).toBe(0);
    const changesetEmpty = summarize(await runReconcile(wsA.id));

    // ── Run B: table POPULATED from the same blob. ──
    const wsB = createWorkspace(`TK Reconcile Populated ${Date.now()}`);
    cleanupWorkspaceIds.push(wsB.id);
    await writeBlobDirect(wsB.id, seed);
    migrateTrackedKeywordsFromConfigBlob();
    expect(countTrackedKeywordRows(wsB.id)).toBe(2);
    const changesetPopulated = summarize(await runReconcile(wsB.id));

    expect(changesetPopulated).toEqual(changesetEmpty);
    // And the deletion set is what we expect: the strategy kw is deprecated, the
    // new site keyword is added, the manual stays retained.
    expect(changesetEmpty.deprecated).toEqual(['old strategy kw']);
    expect(changesetEmpty.added).toEqual(['kept site kw']);
  });
});
