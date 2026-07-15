import { afterEach, describe, expect, it } from 'vitest';

import { KEYWORD_IDENTITY_BACKFILL_MODES } from '../../shared/types/keyword-identity.js';
import db from '../../server/db/index.js';
import { runKeywordIdentityV2Backfill } from '../../server/keyword-identity-v2-backfill.js';
import { setContentGapVote } from '../../server/content-gap-votes.js';
import { saveKeywordFeedbackDecision } from '../../server/keyword-feedback.js';
import { storeSerpSnapshots } from '../../server/serp-snapshots-store.js';
import { listSiteKeywordMetrics, replaceAllSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import { listTrackedKeywordRows, replaceAllTrackedKeywordRows } from '../../server/tracked-keywords-store.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { parseKeywordIdentityBackfillOptions } from '../../scripts/backfill-keyword-identity-v2.js';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking.js';

const cleanup: string[] = [];
const cacheCleanup: string[] = [];

afterEach(() => {
  db.exec('DROP TRIGGER IF EXISTS test_keyword_identity_backfill_abort');
  for (const workspaceId of cleanup.splice(0)) deleteWorkspace(workspaceId);
  for (const keyword of cacheCleanup.splice(0)) {
    db.prepare('DELETE FROM keyword_metrics_cache WHERE keyword = ?').run(keyword);
  }
});

function workspace(label: string): string {
  const id = createWorkspace(`${label} ${Date.now()} ${Math.random()}`).id;
  cleanup.push(id);
  return id;
}

function insertTracked(
  workspaceId: string,
  query: string,
  normalized: string,
  options: {
    pinned?: boolean;
    sourceGapKey?: string | null;
    sortOrder?: number | null;
    status?: string | null;
    source?: string | null;
    addedAt?: string;
    lastStrategySeenAt?: string | null;
    strategyGeneratedAt?: string | null;
  } = {},
): void {
  db.prepare(`
    INSERT INTO tracked_keywords (
      workspace_id, normalized_query, query, pinned, added_at, source, status,
      source_gap_key, strategy_owned, sort_order, last_strategy_seen_at, strategy_generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(
    workspaceId,
    normalized,
    query,
    options.pinned ? 1 : 0,
    options.addedAt ?? '2026-01-01T00:00:00.000Z',
    options.source === undefined ? 'manual' : options.source,
    options.status === undefined ? 'active' : options.status,
    options.sourceGapKey ?? null,
    options.sortOrder === undefined ? 0 : options.sortOrder,
    options.lastStrategySeenAt ?? null,
    options.strategyGeneratedAt ?? null,
  );
}

function insertSiteMetric(
  workspaceId: string,
  keyword: string,
  normalized: string,
  volume: number | null,
  difficulty: number | null = 20,
): void {
  db.prepare(`
    INSERT INTO site_keyword_metrics (workspace_id, normalized_query, keyword, volume, difficulty)
    VALUES (?, ?, ?, ?, ?)
  `).run(workspaceId, normalized, keyword, volume, difficulty);
}

function insertLocalSnapshot(workspaceId: string, keyword: string, normalized: string): string {
  const marketId = `market-${workspaceId}`;
  const snapshotId = `snapshot-${workspaceId}`;
  db.prepare(`
    INSERT INTO local_seo_markets (
      id, workspace_id, label, city, country, source, status, created_at, updated_at
    ) VALUES (?, ?, 'Tokyo', 'Tokyo', 'JP', 'manual', 'active', ?, ?)
  `).run(marketId, workspaceId, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  db.prepare(`
    INSERT INTO local_visibility_snapshots (
      id, workspace_id, keyword, normalized_keyword, market_id, market_label,
      captured_at, source_endpoint, provider
    ) VALUES (?, ?, ?, ?, ?, 'Tokyo', ?, 'test', 'test')
  `).run(snapshotId, workspaceId, keyword, normalized, marketId, '2026-01-01T00:00:00.000Z');
  return snapshotId;
}

function canonicalTracked(workspaceId: string): { query: string; write_order: number } {
  return db.prepare(`
    SELECT query, write_order FROM tracked_keywords_v2_compat
     WHERE workspace_id = ? AND normalized_query_v2 = 'r and d' AND is_canonical = 1
  `).get(workspaceId) as { query: string; write_order: number };
}

function canonicalSite(workspaceId: string): { keyword: string; write_order: number } {
  return db.prepare(`
    SELECT keyword, write_order FROM site_keyword_metrics_v2_compat
     WHERE workspace_id = ? AND normalized_query_v2 = 'r and d' AND is_canonical = 1
  `).get(workspaceId) as { keyword: string; write_order: number };
}

describe('keyword identity v2 operator backfill', () => {
  it('defaults the CLI to dry-run and requires explicit apply', () => {
    expect(parseKeywordIdentityBackfillOptions([])).toEqual({ mode: 'dry_run' });
    expect(parseKeywordIdentityBackfillOptions(['--apply', '--workspace-id=ws-1'])).toEqual({
      mode: 'apply',
      workspaceId: 'ws-1',
    });
    expect(() => parseKeywordIdentityBackfillOptions(['--apply', '--dry-run'])).toThrow();
    expect(() => parseKeywordIdentityBackfillOptions(['--apply', '--workspace-id='])).toThrow(
      '--workspace-id requires a value',
    );
    expect(() => parseKeywordIdentityBackfillOptions(['--apply', '--workspace='])).toThrow(
      '--workspace requires a value',
    );
    expect(() => parseKeywordIdentityBackfillOptions(['--apply', '--workspace-id', '--unknown-flag'])).toThrow(
      '--workspace-id requires a value',
    );
    expect(() => runKeywordIdentityV2Backfill({
      mode: KEYWORD_IDENTITY_BACKFILL_MODES.APPLY,
      workspaceId: '   ',
    })).toThrow('workspaceId must be non-empty when provided');
  });

  it('dry-runs without writes, applies deterministic collisions and is idempotent', () => {
    const workspaceId = workspace('identity backfill');
    // Reverse comparator order on purpose: pinned wins for tracked; higher volume
    // wins for site metrics, independent of database scan order.
    insertTracked(workspaceId, 'R and D', 'r and d', { sortOrder: 1 });
    insertTracked(workspaceId, 'R&D', 'r d', { pinned: true, sourceGapKey: 'r d', sortOrder: 0 });
    insertTracked(workspaceId, '東京', '', { sortOrder: 2 });
    insertSiteMetric(workspaceId, 'R and D', 'r and d', 100);
    insertSiteMetric(workspaceId, 'R&D', 'r d', 900);
    insertSiteMetric(workspaceId, '東京', '', 500);
    const snapshotId = insertLocalSnapshot(workspaceId, '東京', '');

    const dry = runKeywordIdentityV2Backfill({
      mode: KEYWORD_IDENTITY_BACKFILL_MODES.DRY_RUN,
      workspaceId,
    });
    expect(dry.mode).toBe('dry_run');
    expect(dry.stores.tracked_keywords).toEqual(expect.objectContaining({
      scanned: 3,
      inserted: 3,
      conflictingCollisions: 1,
    }));
    expect(dry.stores.tracked_keywords.aliasesByKind.v2_only).toBe(1);
    expect(dry.stores.site_keyword_metrics).toEqual(expect.objectContaining({ inserted: 3 }));
    expect(dry.stores.site_keyword_metrics.aliasesByKind.v2_only).toBe(1);
    expect(dry.stores.local_visibility_snapshots.aliasesByKind.v2_only).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM tracked_keywords_v2_compat WHERE workspace_id = ?').get(workspaceId))
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT normalized_keyword_v2 FROM local_visibility_snapshots WHERE id = ?').get(snapshotId))
      .toEqual({ normalized_keyword_v2: null });

    const applied = runKeywordIdentityV2Backfill({
      mode: KEYWORD_IDENTITY_BACKFILL_MODES.APPLY,
      workspaceId,
    });
    expect(applied.totals.errors).toBe(0);
    expect(db.prepare(`
      SELECT query, source_gap_key_v2 FROM tracked_keywords_v2_compat
       WHERE workspace_id = ? AND normalized_query_v2 = 'r and d' AND is_canonical = 1
    `).get(workspaceId)).toEqual({ query: 'R&D', source_gap_key_v2: 'r and d' });
    expect(db.prepare(`
      SELECT keyword FROM site_keyword_metrics_v2_compat
       WHERE workspace_id = ? AND normalized_query_v2 = 'r and d' AND is_canonical = 1
    `).get(workspaceId)).toEqual({ keyword: 'R&D' });
    expect(db.prepare('SELECT normalized_keyword_v2 FROM local_visibility_snapshots WHERE id = ?').get(snapshotId))
      .toEqual({ normalized_keyword_v2: '東京' });
    expect(listTrackedKeywordRows(workspaceId).map(row => row.query)).toEqual(['R&D', '東京']);
    expect(listSiteKeywordMetrics(workspaceId).map(row => row.keyword)).toEqual(['R&D', '東京']);
    // Blank-v1 Tokyo remains sidecar-only; deterministic projections retain only
    // canonical nonblank v1 rows.
    expect(db.prepare('SELECT query FROM tracked_keywords WHERE workspace_id = ?').all(workspaceId))
      .toEqual([{ query: 'R&D' }]);

    const second = runKeywordIdentityV2Backfill({
      mode: KEYWORD_IDENTITY_BACKFILL_MODES.APPLY,
      workspaceId,
    });
    expect(second.totals.inserted).toBe(0);
    expect(second.totals.updated).toBe(0);
    expect(second.totals.errors).toBe(0);
    // Compatibility-state census remains visible on an idempotent run.
    expect(second.stores.tracked_keywords.aliasesByKind.raw_variant).toBe(1);
    expect(second.stores.tracked_keywords.aliasesByKind.rollback_projection).toBe(1);
    expect(second.stores.tracked_keywords.aliasesByKind.v2_only).toBe(1);
    expect(second.stores.site_keyword_metrics.aliasesByKind.raw_variant).toBe(1);
    expect(second.stores.site_keyword_metrics.aliasesByKind.rollback_projection).toBe(1);
    expect(second.stores.site_keyword_metrics.aliasesByKind.v2_only).toBe(1);
  });

  it('elects identical canonical rows and write order for opposite legacy insertion order', () => {
    const forward = workspace('identity order forward');
    const reverse = workspace('identity order reverse');
    const seed = (workspaceId: string, reversed: boolean) => {
      const trackedRows = [
        { query: 'R and D', normalized: 'r and d', pinned: false },
        { query: 'R&D', normalized: 'r d', pinned: true },
      ];
      const siteRows = [
        { keyword: 'R and D', normalized: 'r and d', volume: 100 },
        { keyword: 'R&D', normalized: 'r d', volume: 900 },
      ];
      for (const row of reversed ? [...trackedRows].reverse() : trackedRows) {
        insertTracked(workspaceId, row.query, row.normalized, { pinned: row.pinned });
      }
      for (const row of reversed ? [...siteRows].reverse() : siteRows) {
        insertSiteMetric(workspaceId, row.keyword, row.normalized, row.volume);
      }
    };
    seed(forward, false);
    seed(reverse, true);

    for (const workspaceId of [forward, reverse]) {
      runKeywordIdentityV2Backfill({ mode: KEYWORD_IDENTITY_BACKFILL_MODES.APPLY, workspaceId });
    }
    expect(canonicalTracked(forward)).toEqual({ query: 'R&D', write_order: 1 });
    expect(canonicalTracked(reverse)).toEqual(canonicalTracked(forward));
    expect(canonicalSite(forward)).toEqual({ keyword: 'R&D', write_order: 1 });
    expect(canonicalSite(reverse)).toEqual(canonicalSite(forward));
    expect(db.prepare('SELECT query FROM tracked_keywords WHERE workspace_id = ?').all(reverse))
      .toEqual(db.prepare('SELECT query FROM tracked_keywords WHERE workspace_id = ?').all(forward));
    expect(db.prepare('SELECT keyword FROM site_keyword_metrics WHERE workspace_id = ?').all(reverse))
      .toEqual(db.prepare('SELECT keyword FROM site_keyword_metrics WHERE workspace_id = ?').all(forward));
  });

  it('matches runtime UTF-8 group ordering and projections with non-Latin and supplementary identities', () => {
    const runtime = workspace('identity runtime byte parity');
    const backfill = workspace('identity backfill byte parity');
    const values = ['東京', 'C#', 'deseret \u{10400}'];

    replaceAllTrackedKeywordRows(runtime, values.map((query, index) => ({
      query,
      pinned: false,
      addedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
    })));
    replaceAllSiteKeywordMetrics(runtime, values.map((keyword, index) => ({
      keyword,
      volume: index + 1,
      difficulty: 20,
    })));

    for (const [index, query] of values.entries()) {
      const normalized = query === '東京' ? '' : query === 'C#' ? 'c' : query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      insertTracked(backfill, query, normalized, { addedAt: `2026-01-0${index + 1}T00:00:00.000Z`, sortOrder: index });
      insertSiteMetric(backfill, query, normalized, index + 1);
    }
    runKeywordIdentityV2Backfill({ mode: KEYWORD_IDENTITY_BACKFILL_MODES.APPLY, workspaceId: backfill });

    const trackedProjection = (workspaceId: string) => db.prepare(`
      SELECT normalized_query, query FROM tracked_keywords
      WHERE workspace_id = ? ORDER BY normalized_query COLLATE BINARY
    `).all(workspaceId);
    const siteProjection = (workspaceId: string) => db.prepare(`
      SELECT normalized_query, keyword FROM site_keyword_metrics
      WHERE workspace_id = ? ORDER BY normalized_query COLLATE BINARY
    `).all(workspaceId);
    expect(trackedProjection(backfill)).toEqual(trackedProjection(runtime));
    expect(siteProjection(backfill)).toEqual(siteProjection(runtime));

    const trackedOrders = (workspaceId: string) => db.prepare(`
      SELECT normalized_query_v2 FROM tracked_keywords_v2_compat
      WHERE workspace_id = ? AND is_canonical = 1 ORDER BY write_order
    `).all(workspaceId);
    const siteOrders = (workspaceId: string) => db.prepare(`
      SELECT normalized_query_v2 FROM site_keyword_metrics_v2_compat
      WHERE workspace_id = ? AND is_canonical = 1 ORDER BY write_order
    `).all(workspaceId);
    expect(trackedOrders(backfill)).toEqual(trackedOrders(runtime));
    expect(siteOrders(backfill)).toEqual(siteOrders(runtime));
  });

  it('implements every tracked and site canonical comparator dimension exactly', () => {
    const statusOrder: Array<string | null> = ['active', 'paused', 'replaced', 'deprecated', null];
    const sourceOrder: Array<string | null> = [
      'client_requested',
      'manual',
      'content_gap',
      'recommendation',
      'strategy_primary',
      'strategy_site_keyword',
      'unknown',
      null,
    ];
    const trackedCases: Array<{
      label: string;
      a?: Parameters<typeof insertTracked>[3];
      b?: Parameters<typeof insertTracked>[3];
      winner: string;
    }> = [
      { label: 'pinned', b: { pinned: true }, winner: 'R&D' },
      ...statusOrder.slice(0, -1).map((higher, index) => ({
        label: `status ${String(higher)} over ${String(statusOrder[index + 1])}`,
        a: { status: statusOrder[index + 1] },
        b: { status: higher },
        winner: 'R&D',
      })),
      ...sourceOrder.slice(0, -1).map((higher, index) => ({
        label: `source ${String(higher)} over ${String(sourceOrder[index + 1])}`,
        a: { source: sourceOrder[index + 1] },
        b: { source: higher },
        winner: 'R&D',
      })),
      {
        label: 'last seen',
        a: { lastStrategySeenAt: '2026-01-01T00:00:00.000Z' },
        b: { lastStrategySeenAt: '2026-02-01T00:00:00.000Z' },
        winner: 'R&D',
      },
      {
        label: 'generated',
        a: { strategyGeneratedAt: '2026-01-01T00:00:00.000Z' },
        b: { strategyGeneratedAt: '2026-02-01T00:00:00.000Z' },
        winner: 'R&D',
      },
      {
        label: 'added',
        a: { addedAt: '2025-01-01T00:00:00.000Z' },
        b: { addedAt: '2026-01-01T00:00:00.000Z' },
        winner: 'R and D',
      },
      { label: 'sort order', a: { sortOrder: 5 }, b: { sortOrder: 1 }, winner: 'R&D' },
      { label: 'raw binary', winner: 'R and D' },
    ];
    for (const testCase of trackedCases) {
      const workspaceId = workspace(`tracked comparator ${testCase.label}`);
      insertTracked(workspaceId, 'R and D', 'r and d', testCase.a);
      insertTracked(workspaceId, 'R&D', 'r d', testCase.b);
      runKeywordIdentityV2Backfill({ mode: KEYWORD_IDENTITY_BACKFILL_MODES.APPLY, workspaceId });
      expect(canonicalTracked(workspaceId).query, testCase.label).toBe(testCase.winner);
    }

    const siteCases = [
      { label: 'nonnull count', a: [100, null], b: [1, 1], winner: 'R&D' },
      { label: 'volume', a: [10, 20], b: [100, 20], winner: 'R&D' },
      { label: 'difficulty', a: [100, 10], b: [100, 30], winner: 'R&D' },
      { label: 'raw binary', a: [100, 20], b: [100, 20], winner: 'R and D' },
    ] as const;
    for (const testCase of siteCases) {
      const workspaceId = workspace(`site comparator ${testCase.label}`);
      insertSiteMetric(workspaceId, 'R and D', 'r and d', testCase.a[0], testCase.a[1]);
      insertSiteMetric(workspaceId, 'R&D', 'r d', testCase.b[0], testCase.b[1]);
      runKeywordIdentityV2Backfill({ mode: KEYWORD_IDENTITY_BACKFILL_MODES.APPLY, workspaceId });
      expect(canonicalSite(workspaceId).keyword, testCase.label).toBe(testCase.winner);
    }
  });

  it('rolls back a workspace atomically and reports only bounded redacted locators', () => {
    const workspaceId = workspace('identity rollback');
    const secretRaw = 'private patient acquisition phrase';
    insertTracked(workspaceId, secretRaw, 'private patient acquisition phrase');
    const snapshotId = insertLocalSnapshot(workspaceId, '東京', '');
    db.exec(`
      CREATE TRIGGER test_keyword_identity_backfill_abort
      BEFORE INSERT ON tracked_keywords_v2_compat
      WHEN NEW.workspace_id = '${workspaceId}'
      BEGIN SELECT RAISE(ABORT, 'forced backfill rollback'); END;
    `);

    const report = runKeywordIdentityV2Backfill({
      mode: KEYWORD_IDENTITY_BACKFILL_MODES.APPLY,
      workspaceId,
    });
    expect(report.totals.errors).toBe(1);
    expect(report.errors).toEqual([
      expect.objectContaining({
        store: 'tracked_keywords',
        code: 'workspace_backfill_failed',
        count: 1,
        samples: [expect.objectContaining({ workspaceId, rowRefHash: expect.stringMatching(/^[a-f0-9]{24}$/) })],
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain(secretRaw);
    expect(db.prepare('SELECT COUNT(*) AS count FROM tracked_keywords_v2_compat WHERE workspace_id = ?').get(workspaceId))
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT normalized_keyword_v2 FROM local_visibility_snapshots WHERE id = ?').get(snapshotId))
      .toEqual({ normalized_keyword_v2: null });
  });

  it('rolls back tracked/site sidecars, projections, and local writes after a late-store failure', () => {
    const workspaceId = workspace('identity late rollback');
    insertTracked(workspaceId, 'R and D', 'r and d');
    insertTracked(workspaceId, 'R&D', 'r d', { pinned: true });
    insertSiteMetric(workspaceId, 'R and D', 'r and d', 100);
    insertSiteMetric(workspaceId, 'R&D', 'r d', 900);
    const snapshotId = insertLocalSnapshot(workspaceId, '東京', '');
    db.exec(`
      CREATE TRIGGER test_keyword_identity_backfill_abort
      BEFORE UPDATE OF normalized_keyword_v2 ON local_visibility_snapshots
      WHEN NEW.workspace_id = '${workspaceId}'
      BEGIN SELECT RAISE(ABORT, 'forced late backfill rollback'); END;
    `);

    const report = runKeywordIdentityV2Backfill({
      mode: KEYWORD_IDENTITY_BACKFILL_MODES.APPLY,
      workspaceId,
    });
    expect(report.errors).toEqual([
      expect.objectContaining({ store: 'local_visibility_snapshots', code: 'workspace_backfill_failed' }),
    ]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM tracked_keywords_v2_compat WHERE workspace_id = ?').get(workspaceId))
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM site_keyword_metrics_v2_compat WHERE workspace_id = ?').get(workspaceId))
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT query FROM tracked_keywords WHERE workspace_id = ? ORDER BY query').all(workspaceId))
      .toEqual([{ query: 'R and D' }, { query: 'R&D' }]);
    expect(db.prepare('SELECT keyword FROM site_keyword_metrics WHERE workspace_id = ? ORDER BY keyword').all(workspaceId))
      .toEqual([{ keyword: 'R and D' }, { keyword: 'R&D' }]);
    expect(db.prepare('SELECT normalized_keyword_v2 FROM local_visibility_snapshots WHERE id = ?').get(snapshotId))
      .toEqual({ normalized_keyword_v2: null });
  });

  it('keeps feedback, vote, SERP, and metrics-cache v1 rows as aliases or skipped data', () => {
    const workspaceId = workspace('identity aliases');
    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status) VALUES (?, 'legacy-secret-feedback', 'requested')
    `).run(workspaceId);
    db.prepare(`
      INSERT INTO content_gap_votes (workspace_id, keyword, vote, updated_at)
      VALUES (?, 'legacy-secret-vote', 'up', '2026-01-01T00:00:00.000Z')
    `).run(workspaceId);
    db.prepare(`
      INSERT INTO serp_snapshots (workspace_id, date, query, position)
      VALUES (?, '2026-01-01', 'legacy-secret-serp', 8)
    `).run(workspaceId);
    saveKeywordFeedbackDecision({
      workspaceId,
      keyword: 'R&D',
      status: 'requested',
      trackApprovedKeyword: false,
    });
    saveKeywordFeedbackDecision({
      workspaceId,
      keyword: 'R and D',
      status: 'requested',
      trackApprovedKeyword: false,
    });
    setContentGapVote(workspaceId, 'R&D', 'up', 'test');
    setContentGapVote(workspaceId, 'R and D', 'up', 'test');
    storeSerpSnapshots(workspaceId, '2026-02-01', [
      { query: 'R&D', position: 4, features: ['featured_snippet'] },
      { query: 'R and D', position: 4, features: ['featured_snippet'] },
    ]);
    const cacheKeyword = `legacy-secret-cache-${workspaceId}`;
    cacheCleanup.push(cacheKeyword);
    db.prepare(`
      INSERT INTO keyword_metrics_cache (
        keyword, database_region, volume, difficulty, cpc, competition, results, trend, cached_at
      ) VALUES (?, 'us', 10, 20, 1, 0.2, 100, '[]', '2026-01-01T00:00:00.000Z')
    `).run(cacheKeyword);

    const report = runKeywordIdentityV2Backfill({
      mode: KEYWORD_IDENTITY_BACKFILL_MODES.DRY_RUN,
      workspaceId,
    });
    expect(report.stores.keyword_feedback.aliasesByKind.legacy_v1_only).toBe(1);
    expect(report.stores.content_gap_votes.aliasesByKind.legacy_v1_only).toBe(1);
    expect(report.stores.serp_snapshots.aliasesByKind.legacy_v1_only).toBe(1);
    expect(report.stores.keyword_feedback.aliasesByKind.raw_variant).toBe(1);
    expect(report.stores.keyword_feedback.alreadyPresent).toBe(1);
    expect(report.stores.keyword_feedback.aliasesByKind.rollback_projection).toBe(2);
    expect(report.stores.keyword_feedback.equivalentCollisions).toBe(1);
    expect(report.stores.content_gap_votes.aliasesByKind.raw_variant).toBe(1);
    expect(report.stores.content_gap_votes.alreadyPresent).toBe(1);
    expect(report.stores.content_gap_votes.aliasesByKind.rollback_projection).toBe(2);
    expect(report.stores.content_gap_votes.equivalentCollisions).toBe(1);
    expect(report.stores.serp_snapshots.aliasesByKind.raw_variant).toBe(1);
    expect(report.stores.serp_snapshots.alreadyPresent).toBe(2);
    expect(report.stores.serp_snapshots.aliasesByKind.rollback_projection).toBe(2);
    expect(report.stores.serp_snapshots.equivalentCollisions).toBe(1);
    expect(report.stores.keyword_feedback.inserted).toBe(0);
    expect(report.stores.content_gap_votes.inserted).toBe(0);
    expect(report.stores.serp_snapshots.inserted).toBe(0);
    expect(report.stores.keyword_metrics_cache.inserted).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM keyword_metrics_cache_v2 WHERE raw_keyword = ?').get(cacheKeyword))
      .toEqual({ count: 0 });
    expect(JSON.stringify(report)).not.toContain('legacy-secret');
  });
});
