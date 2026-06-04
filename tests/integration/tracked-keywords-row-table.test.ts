/**
 * Wave 3c-i (#12) — tracked_keywords row table: ADDITIVE SHADOW half.
 *
 * Table + backfill + DUAL-WRITE inside withTrackedKeywordsTxn. READS STAY ON THE
 * BLOB (zero behavior change). NO read-switch, NO strip here.
 *
 * Coverage (mirrors the contract test assertions):
 *  (a) PARITY INVARIANT — after a sequence of real writer ops (public add/remove
 *      routes, in-process admin writers, withTrackedKeywordsTxn directly, incl. an
 *      empty-clear op), listTrackedKeywordRows(ws) EXACTLY equals
 *      getTrackedKeywords(ws, { includeInactive }) — same set, same fields,
 *      NULL→undefined. Proves the shadow stays in sync incl. the empty-clear case.
 *  (b) boot backfill populates a legacy blob-only workspace (idempotent; blob
 *      kept; source stamped where inferrable).
 *  (c) the NESTING case — a write inside an outer KCC-style db.transaction()
 *      writes BOTH blob and table without throwing.
 *  (d) PRAGMA column assertion + CASCADE on workspace delete.
 *
 * The existing tracked-keywords-concurrency.test.ts (port 13886) covers the
 * IMMEDIATE/nesting safety net and MUST still pass unchanged (reads still blob;
 * the dual-write is inside the same IMMEDIATE txn).
 *
 * Port: 13891 (next free per the audit's port budget).
 */
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

const PORT = 13891;
const ctx = createTestContext(PORT);
const { api, postJson } = ctx;

/** DELETE with a JSON body (the public remove route validates req.body.keyword). */
async function delJson(urlPath: string, body: unknown): Promise<Response> {
  return api(urlPath, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const cleanupWorkspaceIds: string[] = [];

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

/**
 * The core invariant: the row table EXACTLY mirrors what the blob read returns.
 * Same set (keyed by query), same fields (incl. NULL→undefined for absent ones).
 */
async function assertParity(workspaceId: string): Promise<void> {
  const { getTrackedKeywords } = await import('../../server/rank-tracking.js');
  const { listTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');

  const blob = getTrackedKeywords(workspaceId, { includeInactive: true });
  const table = listTrackedKeywordRows(workspaceId);

  // Same set, compared field-by-field after sorting by query (added_at ASC vs the
  // blob's insertion order can legitimately differ; the SET + field identity is
  // the invariant, not ordering).
  const byQuery = <T extends { query: string }>(xs: T[]) =>
    [...xs].sort((a, b) => a.query.localeCompare(b.query));

  // JSON round-trip both sides: this is the strongest "byte-identical" assertion —
  // undefined fields are omitted by JSON.stringify on BOTH sides, so a row that
  // mapped a NULL column to `null` (instead of undefined) would fail here.
  expect(JSON.stringify(byQuery(table))).toBe(JSON.stringify(byQuery(blob)));
}

// ─── (a) PARITY INVARIANT across real writer ops ────────────────────────────────
describe('(a) PARITY INVARIANT — table mirrors blob after every write', () => {
  let wsId: string;

  beforeEach(async () => {
    const { createWorkspace } = await import('../../server/workspaces.js');
    wsId = createWorkspace(`TKRows Parity ${Date.now()}-${Math.random().toString(36).slice(2)}`).id;
    cleanupWorkspaceIds.push(wsId);
  });

  it('public add route → parity', async () => {
    const res = await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'dental implants' });
    expect(res.status).toBe(200);
    await assertParity(wsId);

    const { listTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const rows = listTrackedKeywordRows(wsId);
    expect(rows).toHaveLength(1);
    expect(rows[0].query).toBe('dental implants');
    // CLIENT_REQUESTED source is preserved in the table (not null).
    expect(rows[0].source).toBe('client_requested');
  });

  it('in-process admin writers (add/pin) → parity', async () => {
    const { addTrackedKeyword, togglePinKeyword } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE } = await import('../../shared/types/rank-tracking.js');

    addTrackedKeyword(wsId, 'teeth whitening', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    await assertParity(wsId);

    togglePinKeyword(wsId, 'teeth whitening');
    await assertParity(wsId);

    const { listTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    expect(listTrackedKeywordRows(wsId).find(k => k.query === 'teeth whitening')?.pinned).toBe(true);
  });

  it('withTrackedKeywordsTxn directly (with a fully-populated row) → parity preserves all fields incl. NULL→undefined', async () => {
    const { withTrackedKeywordsTxn } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    withTrackedKeywordsTxn(wsId, () => [
      // One fully-populated row (every optional field set) ...
      {
        query: 'invisalign cost',
        pinned: true,
        addedAt: '2026-01-01T00:00:00.000Z',
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
        pagePath: '/invisalign',
        pageTitle: 'Invisalign',
        strategyGeneratedAt: '2026-01-02T00:00:00.000Z',
        lastStrategySeenAt: '2026-01-03T00:00:00.000Z',
        intent: 'commercial',
        volume: 2900,
        difficulty: 33,
        cpc: 4.2,
        authorityPosture: 'within_current_authority_range',
        baselinePosition: 12,
        baselineClicks: 5,
        baselineImpressions: 400,
        replacedBy: undefined,
        deprecatedAt: undefined,
      },
      // ... and one sparse row (only the required fields; the rest absent).
      {
        query: 'sparse keyword',
        pinned: false,
        addedAt: '2026-01-04T00:00:00.000Z',
      },
    ]);

    await assertParity(wsId);
  });

  it('empty-clear op (remove the last keyword) → table is cleared, parity holds', async () => {
    // Add via the public route, then remove via the public route. Removing the
    // last keyword must CLEAR the table (replaceAll with [] ), matching the blob
    // which writes []. This is the empty-clear case the contract calls out.
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'only keyword' });
    await assertParity(wsId);

    const res = await delJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'only keyword' });
    expect(res.status).toBe(200);

    const { getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { listTrackedKeywordRows, countTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    expect(getTrackedKeywords(wsId, { includeInactive: true })).toHaveLength(0);
    expect(countTrackedKeywordRows(wsId)).toBe(0); // table cleared, not stale
    expect(listTrackedKeywordRows(wsId)).toEqual([]);
    await assertParity(wsId);
  });

  it('full sequence (add, add, pin, remove-one, remove-last) keeps parity at every step', async () => {
    const { addTrackedKeyword, removeTrackedKeyword, togglePinKeyword } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE } = await import('../../shared/types/rank-tracking.js');

    addTrackedKeyword(wsId, 'alpha', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    await assertParity(wsId);
    addTrackedKeyword(wsId, 'beta', { source: TRACKED_KEYWORD_SOURCE.CONTENT_GAP });
    await assertParity(wsId);
    togglePinKeyword(wsId, 'alpha');
    await assertParity(wsId);
    removeTrackedKeyword(wsId, 'alpha');
    await assertParity(wsId);
    removeTrackedKeyword(wsId, 'beta'); // empty-clear
    await assertParity(wsId);

    const { countTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    expect(countTrackedKeywordRows(wsId)).toBe(0);
  });
});

// ─── (b) Boot backfill: legacy blob-only workspace ──────────────────────────────
describe('(b) migrateTrackedKeywordsFromConfigBlob — legacy blob-only workspace', () => {
  it('populates the table from the blob, keeps the blob, stamps inferrable sources', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { migrateTrackedKeywordsFromConfigBlob, countTrackedKeywordRows, listTrackedKeywordRows } =
      await import('../../server/tracked-keywords-store.js');

    const ws = createWorkspace(`TKRows Backfill ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    // Legacy state: an UNKNOWN-source keyword that exists in the strategy
    // siteKeywords (so inference should recover STRATEGY_SITE_KEYWORD), plus a
    // manual keyword that inference CANNOT recover (stays UNKNOWN).
    const { updateWorkspace } = await import('../../server/workspaces.js');
    updateWorkspace(ws.id, { keywordStrategy: {
      siteKeywords: ['recoverable strategy kw'],
      siteKeywordMetrics: [],
      opportunities: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    } as never });

    // Write the blob DIRECTLY (bypassing the dual-write) to simulate a legacy
    // workspace whose table was never populated.
    db.prepare(`
      INSERT INTO rank_tracking_config (workspace_id, tracked_keywords)
      VALUES (?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET tracked_keywords = excluded.tracked_keywords
    `).run(ws.id, JSON.stringify([
      { query: 'recoverable strategy kw', pinned: false, addedAt: '2026-01-01T00:00:00.000Z', source: 'unknown', status: 'active' },
      { query: 'truly manual kw', pinned: true, addedAt: '2026-01-02T00:00:00.000Z', source: 'unknown', status: 'active' },
    ]));
    expect(countTrackedKeywordRows(ws.id)).toBe(0);

    const { inferTrackedKeywordSourcesForWorkspace } = await import('../../server/keyword-command-center.js');
    migrateTrackedKeywordsFromConfigBlob(inferTrackedKeywordSourcesForWorkspace);

    const rows = listTrackedKeywordRows(ws.id);
    expect(rows.map(r => r.query).sort()).toEqual(['recoverable strategy kw', 'truly manual kw']);
    // Inference recovered the strategy keyword ...
    expect(rows.find(r => r.query === 'recoverable strategy kw')?.source).toBe('strategy_site_keyword');
    // ... but left the unrecoverable one UNKNOWN (never guessed).
    expect(rows.find(r => r.query === 'truly manual kw')?.source).toBe('unknown');

    // Blob is KEPT (shadow, not strip).
    const blobRow = db.prepare('SELECT tracked_keywords FROM rank_tracking_config WHERE workspace_id = ?').get(ws.id) as { tracked_keywords: string };
    expect(JSON.parse(blobRow.tracked_keywords)).toHaveLength(2);
  });

  it('is idempotent — a second run does not duplicate or error (CAS skip)', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { migrateTrackedKeywordsFromConfigBlob, countTrackedKeywordRows } =
      await import('../../server/tracked-keywords-store.js');

    const ws = createWorkspace(`TKRows BackfillIdem ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);
    db.prepare(`
      INSERT INTO rank_tracking_config (workspace_id, tracked_keywords)
      VALUES (?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET tracked_keywords = excluded.tracked_keywords
    `).run(ws.id, JSON.stringify([
      { query: 'idem kw', pinned: false, addedAt: '2026-01-01T00:00:00.000Z', source: 'manual', status: 'active' },
    ]));

    migrateTrackedKeywordsFromConfigBlob();
    migrateTrackedKeywordsFromConfigBlob();
    expect(countTrackedKeywordRows(ws.id)).toBe(1);
  });
});

// ─── (c) Nesting case — write inside an outer txn writes BOTH blob and table ─────
describe('(c) nesting — write inside an outer KCC-style db.transaction() writes both', () => {
  it('persists the keyword to BOTH the blob and the table without throwing', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { updateTrackedKeywords, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { listTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    const ws = createWorkspace(`TKRows Nesting ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    // Mimic KCC: an outer wrapped db.transaction() around the writer. The inner
    // withTrackedKeywordsTxn NO-OPs its BEGIN (db.inTransaction guard) and the
    // dual-write runs as another statement inside the SAME outer txn.
    db.transaction(() => {
      updateTrackedKeywords(ws.id, (keywords) => [
        ...keywords,
        {
          query: 'nested write keyword',
          pinned: false,
          addedAt: new Date().toISOString(),
          source: TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
        },
      ]);
    })();

    // Both surfaces reflect the write after the outer commit.
    expect(getTrackedKeywords(ws.id, { includeInactive: true }).some(k => k.query === 'nested write keyword')).toBe(true);
    expect(listTrackedKeywordRows(ws.id).some(k => k.query === 'nested write keyword')).toBe(true);
    await assertParity(ws.id);
  });

  it('a rolled-back outer transaction discards BOTH the blob and the table write', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { updateTrackedKeywords, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { listTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    const ws = createWorkspace(`TKRows NestingRollback ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    expect(() => {
      db.transaction(() => {
        updateTrackedKeywords(ws.id, (keywords) => [
          ...keywords,
          {
            query: 'rolled back row',
            pinned: false,
            addedAt: new Date().toISOString(),
            source: TRACKED_KEYWORD_SOURCE.MANUAL,
            status: TRACKED_KEYWORD_STATUS.ACTIVE,
          },
        ]);
        throw new Error('force outer rollback');
      })();
    }).toThrow('force outer rollback');

    // The dual-write is inside the same txn, so the rollback discards it too.
    expect(getTrackedKeywords(ws.id, { includeInactive: true }).some(k => k.query === 'rolled back row')).toBe(false);
    expect(listTrackedKeywordRows(ws.id).some(k => k.query === 'rolled back row')).toBe(false);
  });
});

// ─── (d) Schema: columns + CASCADE ──────────────────────────────────────────────
describe('(d) tracked_keywords schema — columns + CASCADE', () => {
  it('has every expected column (incl. additive provenance columns)', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const cols = (db.prepare('PRAGMA table_info(tracked_keywords)').all() as Array<{ name: string }>).map(c => c.name);
    for (const col of [
      'workspace_id', 'normalized_query', 'query', 'pinned', 'added_at',
      'source', 'status', 'page_path', 'page_title',
      'strategy_generated_at', 'last_strategy_seen_at', 'intent',
      'volume', 'difficulty', 'cpc', 'authority_posture',
      'baseline_position', 'baseline_clicks', 'baseline_impressions',
      'replaced_by', 'deprecated_at', 'source_page_id', 'source_gap_key',
    ]) {
      expect(cols, `tracked_keywords.${col} should exist`).toContain(col);
    }
  });

  it('has the composite PK and the two indexes', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const pk = (db.prepare('PRAGMA table_info(tracked_keywords)').all() as Array<{ name: string; pk: number }>)
      .filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
    expect(pk).toEqual(['workspace_id', 'normalized_query']);

    const idx = (db.prepare('PRAGMA index_list(tracked_keywords)').all() as Array<{ name: string }>).map(i => i.name);
    expect(idx).toContain('idx_tracked_keywords_workspace');
    expect(idx).toContain('idx_tracked_keywords_status');
  });

  it('cascades on workspace delete', async () => {
    const { default: db } = await import('../../server/db/index.js');
    const { createWorkspace } = await import('../../server/workspaces.js');
    const { addTrackedKeyword } = await import('../../server/rank-tracking.js');
    const { countTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const { TRACKED_KEYWORD_SOURCE } = await import('../../shared/types/rank-tracking.js');

    const ws = createWorkspace(`TKRows Cascade ${Date.now()}`);
    addTrackedKeyword(ws.id, 'cascade keyword', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    expect(countTrackedKeywordRows(ws.id)).toBe(1);

    db.pragma('foreign_keys = ON');
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(ws.id);

    const after = db.prepare('SELECT COUNT(*) as cnt FROM tracked_keywords WHERE workspace_id = ?').get(ws.id) as { cnt: number };
    expect(after.cnt).toBe(0);
  });
});
