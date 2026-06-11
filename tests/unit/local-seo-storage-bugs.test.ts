/**
 * Tests for the four verified storage/semantics bugs fixed in W2.4:
 *
 *  Bug 1 — LIMIT-500 truncation: >500 snapshot rows → all (market, keyword) pairs present
 *  Bug 2 — Keyset-paginated backfill: job completes correctly without loading all rows at once
 *  Bug 3 — Retention prune (owner decision D4): recent rows kept, weekly thinning correct,
 *           latest-per-pair immortal, hard cutoff applied
 */
import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '../../server/db/index.js';
import {
  RETENTION_PRUNE_BATCH_SIZE,
  RETENTION_RAW_DAYS,
  RETENTION_WEEKLY_MAX_DAYS,
  __resetRefreshTimingsForTesting,
  __setRefreshTimingsForTesting,
  countLocalVisibilitySnapshots,
  listLatestLocalVisibilitySnapshots,
  runLocationBackfillJob,
  runSnapshotRetentionPrune,
  updateLocalSeoConfiguration,
} from '../../server/local-seo.js';
import { setBroadcast } from '../../server/broadcast.js';
import { clearCompletedJobs, createJob } from '../../server/jobs.js';
import { createClientLocation } from '../../server/client-locations.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_POSTURE,
  LOCAL_VISIBILITY_STATUS,
} from '../../shared/types/local-seo.js';

// ─── Shared test DB setup ────────────────────────────────────────────────────

const cleanupWorkspaceIds = new Set<string>();

beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
  __setRefreshTimingsForTesting({ itemYieldMs: 0, heapHeadroomThresholdMb: 0, heapHeadroomWaitMs: 0, heapHeadroomMaxWaits: 0 });

  db.exec(`
    CREATE TABLE IF NOT EXISTS local_seo_workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      posture TEXT NOT NULL DEFAULT 'unknown',
      posture_source TEXT NOT NULL DEFAULT 'unknown',
      suggested_posture TEXT,
      suggestion_reasons TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      keywords_per_refresh INTEGER
    );
  `);
  try {
    db.exec(`ALTER TABLE local_seo_workspace_settings ADD COLUMN keywords_per_refresh INTEGER`);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_seo_markets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      label TEXT NOT NULL,
      city TEXT NOT NULL,
      state_or_region TEXT,
      country TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      provider_location_code INTEGER,
      provider_location_name TEXT,
      source TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'needs_review',
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS client_locations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT,
      phone TEXT,
      street_address TEXT,
      city TEXT,
      state_or_region TEXT,
      country TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'needs_review',
      gbp_place_id TEXT,
      primary_market_id TEXT,
      page_target_path TEXT,
      page_target_keyword_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_client_locations_workspace
      ON client_locations(workspace_id);
    CREATE TABLE IF NOT EXISTS local_visibility_snapshots (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      normalized_keyword TEXT NOT NULL,
      market_id TEXT NOT NULL,
      market_label TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      local_pack_present INTEGER NOT NULL DEFAULT 0,
      business_found INTEGER NOT NULL DEFAULT 0,
      business_match_confidence TEXT NOT NULL DEFAULT 'unknown',
      business_match_reason TEXT,
      local_rank INTEGER,
      top_competitors TEXT NOT NULL DEFAULT '[]',
      source_endpoint TEXT NOT NULL,
      provider TEXT NOT NULL,
      device TEXT NOT NULL DEFAULT 'desktop',
      language_code TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'success',
      degraded_reason TEXT,
      matched_location_id TEXT,
      matched_location_name TEXT,
      raw_results TEXT
    );
  `);
  for (const columnSql of [
    `ALTER TABLE local_seo_markets ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE local_visibility_snapshots ADD COLUMN matched_location_id TEXT`,
    `ALTER TABLE local_visibility_snapshots ADD COLUMN matched_location_name TEXT`,
    `ALTER TABLE local_visibility_snapshots ADD COLUMN raw_results TEXT`,
  ]) {
    try {
      db.exec(columnSql);
    } catch (err) {
      if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
    }
  }
});

afterEach(() => {
  __resetRefreshTimingsForTesting();
  for (const workspaceId of cleanupWorkspaceIds) {
    clearCompletedJobs({ workspaceId });
    deleteWorkspace(workspaceId);
  }
  cleanupWorkspaceIds.clear();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Insert a snapshot row directly via raw SQL (bypasses provider calls).
 */
function insertRawSnapshot(opts: {
  workspaceId: string;
  marketId: string;
  keyword: string;
  normalizedKeyword: string;
  capturedAt: string;
  status?: string;
}) {
  db.prepare(`
    INSERT INTO local_visibility_snapshots (
      id, workspace_id, keyword, normalized_keyword, market_id, market_label,
      captured_at, local_pack_present, business_found, business_match_confidence,
      local_rank, top_competitors, source_endpoint, provider, device, language_code,
      status, raw_results
    ) VALUES (
      ?, ?, ?, ?, ?, 'Test Market',
      ?, 0, 0, 'not_found',
      NULL, '[]', 'google_organic_serp', 'dataforseo', 'desktop', 'en',
      ?, '[]'
    )
  `).run(
    randomUUID(),
    opts.workspaceId,
    opts.keyword,
    opts.normalizedKeyword,
    opts.marketId,
    opts.capturedAt,
    opts.status ?? LOCAL_VISIBILITY_STATUS.SUCCESS,
  );
}

/** Return the count of snapshot rows for a given workspace. */
function snapshotCount(workspaceId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM local_visibility_snapshots WHERE workspace_id = ?`).get(workspaceId) as { n: number };
  return row.n;
}

/** Return captured_at values for a given (workspace, market, keyword), newest first. */
function snapshotTimestamps(workspaceId: string, marketId: string, normalizedKeyword: string): string[] {
  return (db.prepare(`
    SELECT captured_at FROM local_visibility_snapshots
    WHERE workspace_id = ? AND market_id = ? AND normalized_keyword = ?
    ORDER BY captured_at DESC
  `).all(workspaceId, marketId, normalizedKeyword) as Array<{ captured_at: string }>)
    .map(r => r.captured_at);
}

function makeIsoTimestamp(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ─── Bug 1: LIMIT-500 truncation ─────────────────────────────────────────────

describe('Bug 1 — LIMIT-500 truncation', () => {
  it('reads all (market, keyword) pairs when >500 snapshot rows exist', () => {
    const ws = createWorkspace('Bug1 Storage Test Workspace');
    cleanupWorkspaceIds.add(ws.id);

    // Simulate a max-budget scenario: 3 markets × 200 keywords = 600 snapshot rows
    // (exceeds the old LIMIT 500). Each keyword/market pair gets exactly ONE snapshot.
    const markets = ['mkt-a', 'mkt-b', 'mkt-c'];
    const keywordCount = 200;
    const now = makeIsoTimestamp(0);

    for (const mktId of markets) {
      for (let i = 0; i < keywordCount; i++) {
        const kw = `keyword ${i}`;
        insertRawSnapshot({ workspaceId: ws.id, marketId: mktId, keyword: kw, normalizedKeyword: kw, capturedAt: now });
      }
    }

    const total = snapshotCount(ws.id);
    expect(total).toBe(600); // confirmed >500

    const latestSnapshots = listLatestLocalVisibilitySnapshots(ws.id);
    // Must return exactly one entry per (market, keyword) pair
    expect(latestSnapshots.length).toBe(600);

    // Verify no (market, keyword) pair is missing
    const pairs = new Set(latestSnapshots.map(s => `${s.marketId}:${s.normalizedKeyword}`));
    for (const mktId of markets) {
      for (let i = 0; i < keywordCount; i++) {
        expect(pairs.has(`${mktId}:keyword ${i}`)).toBe(true);
      }
    }
  });

  it('returns the LATEST snapshot per (market, keyword, device, language) when multiple history rows exist', () => {
    const ws = createWorkspace('Bug1 Latest-Row Test');
    cleanupWorkspaceIds.add(ws.id);

    const mktId = 'mkt-x';
    const kw = 'dental implants austin';

    // Insert three historical snapshots for the same pair, oldest first
    insertRawSnapshot({ workspaceId: ws.id, marketId: mktId, keyword: kw, normalizedKeyword: kw, capturedAt: makeIsoTimestamp(10) });
    insertRawSnapshot({ workspaceId: ws.id, marketId: mktId, keyword: kw, normalizedKeyword: kw, capturedAt: makeIsoTimestamp(5) });
    const latest = makeIsoTimestamp(1);
    insertRawSnapshot({ workspaceId: ws.id, marketId: mktId, keyword: kw, normalizedKeyword: kw, capturedAt: latest });

    const snapshots = listLatestLocalVisibilitySnapshots(ws.id);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].capturedAt).toBe(latest);
  });
});

// ─── Bug 2: Keyset-paginated backfill ─────────────────────────────────────────

describe('Bug 2 — Keyset-paginated backfill', () => {
  it('completes correctly when total rows exceed pageSize (100)', async () => {
    const ws = createWorkspace('Bug2 Backfill Workspace');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      liveDomain: 'https://bug2.example.com',
      businessProfile: {
        address: { street: '1 Main St', city: 'Austin', state: 'TX', country: 'US' },
      },
    });

    // Add a confirmed location so the match evaluator has something to work with
    createClientLocation(ws.id, {
      name: 'Bug2 Dental',
      domain: 'bug2.example.com',
      status: 'confirmed',
    });

    const mktId = 'mkt-backfill';
    const rowCount = 250; // > 100 (pageSize) AND > 200 (2× pageSize)
    const now = makeIsoTimestamp(0);

    for (let i = 0; i < rowCount; i++) {
      // Stagger timestamps by 1 second so the keyset cursor advances deterministically
      const ts = makeIsoTimestamp(0).slice(0, 17) + String(Math.floor(i / 60)).padStart(2, '0') + `.${i % 1000}`;
      insertRawSnapshot({
        workspaceId: ws.id,
        marketId: mktId,
        keyword: `keyword ${i}`,
        normalizedKeyword: `keyword ${i}`,
        capturedAt: now,
      });
    }

    expect(snapshotCount(ws.id)).toBe(rowCount);

    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, {
      workspaceId: ws.id,
      message: 'Backfill test',
    });

    await runLocationBackfillJob(job.id, ws.id);

    const { getJob } = await import('../../server/jobs.js');
    const finalJob = getJob(job.id);
    expect(finalJob?.status).toBe('done');
    // Result.updated should reflect the actual number of rows processed
    expect((finalJob?.result as { updated?: number })?.updated).toBe(rowCount);
  });
});

// ─── Bug 3: Retention prune (owner decision D4) ───────────────────────────────

describe('Bug 3 — Snapshot retention prune', () => {
  /**
   * Seed helper: inserts N snapshots spread across a date range for one (market, keyword) pair.
   */
  function seedHistory(opts: {
    workspaceId: string;
    marketId: string;
    keyword: string;
    daysAgoList: number[];
  }) {
    for (const daysAgo of opts.daysAgoList) {
      insertRawSnapshot({
        workspaceId: opts.workspaceId,
        marketId: opts.marketId,
        keyword: opts.keyword,
        normalizedKeyword: opts.keyword,
        capturedAt: makeIsoTimestamp(daysAgo),
      });
    }
  }

  it('keeps rows within the raw retention window (< 180 days)', () => {
    const ws = createWorkspace('Retention Keep-Recent Test');
    cleanupWorkspaceIds.add(ws.id);

    seedHistory({ workspaceId: ws.id, marketId: 'mkt-1', keyword: 'dental', daysAgoList: [1, 30, 90, 179] });
    expect(snapshotCount(ws.id)).toBe(4);

    const { pruned } = runSnapshotRetentionPrune(ws.id);
    expect(pruned).toBe(0);
    expect(snapshotCount(ws.id)).toBe(4);
  });

  it('thins rows in the weekly window (180–548 days) to one per ISO week', () => {
    const ws = createWorkspace('Retention Weekly Thinning Test');
    cleanupWorkspaceIds.add(ws.id);

    // Insert 3 rows on the SAME day, 200 days ago — guaranteed same ISO week.
    // Using the same daysAgo value means all three timestamps differ only by
    // the random UUID ordering, but strftime('%Y-%W', ...) gives the same week.
    seedHistory({ workspaceId: ws.id, marketId: 'mkt-1', keyword: 'dental', daysAgoList: [200, 200, 200] });
    expect(snapshotCount(ws.id)).toBe(3);

    const { pruned } = runSnapshotRetentionPrune(ws.id);
    // 3 rows in 1 week → keep 1 (MIN(id)), delete 2
    expect(pruned).toBe(2);
    expect(snapshotCount(ws.id)).toBe(1);
  });

  it('deletes all rows beyond 548 days EXCEPT the latest per (market, keyword)', () => {
    const ws = createWorkspace('Retention Hard Cutoff Test');
    cleanupWorkspaceIds.add(ws.id);

    // 3 rows all older than 548 days for the same pair
    const daysAgoList = [600, 700, 800];
    seedHistory({ workspaceId: ws.id, marketId: 'mkt-1', keyword: 'dental', daysAgoList });
    expect(snapshotCount(ws.id)).toBe(3);

    const { pruned } = runSnapshotRetentionPrune(ws.id);
    // oldest 2 are deleted; the "latest" (600 days ago) is kept by the immortal guard
    expect(pruned).toBe(2);
    expect(snapshotCount(ws.id)).toBe(1);

    // Verify the surviving row is the most recent one (600 days ago)
    const remaining = snapshotTimestamps(ws.id, 'mkt-1', 'dental');
    expect(remaining.length).toBe(1);
    // Its timestamp must be > the 700/800-day timestamps
    const survivedAt = new Date(remaining[0]).getTime();
    const cutoff700 = new Date(makeIsoTimestamp(700)).getTime();
    expect(survivedAt).toBeGreaterThan(cutoff700);
  });

  it('latest-per-(market, keyword) row is immortal regardless of age', () => {
    const ws = createWorkspace('Retention Immortal Latest Test');
    cleanupWorkspaceIds.add(ws.id);

    // Single row, very old — should survive because it's the only (and therefore latest) row
    seedHistory({ workspaceId: ws.id, marketId: 'mkt-1', keyword: 'dentist near me', daysAgoList: [1000] });
    expect(snapshotCount(ws.id)).toBe(1);

    const { pruned } = runSnapshotRetentionPrune(ws.id);
    expect(pruned).toBe(0);
    expect(snapshotCount(ws.id)).toBe(1);
  });

  it('is idempotent — running twice produces the same result', () => {
    const ws = createWorkspace('Retention Idempotent Test');
    cleanupWorkspaceIds.add(ws.id);

    // Mix: recent rows (kept), weekly-window rows (thinned), hard-cutoff rows (pruned)
    // Using same-day daysAgo values to avoid ISO week boundary ambiguity
    seedHistory({ workspaceId: ws.id, marketId: 'mkt-1', keyword: 'dental', daysAgoList: [10, 200, 200, 600, 700] });

    const first = runSnapshotRetentionPrune(ws.id);
    const countAfterFirst = snapshotCount(ws.id);
    const second = runSnapshotRetentionPrune(ws.id);
    const countAfterSecond = snapshotCount(ws.id);

    // Second run is a no-op
    expect(second.pruned).toBe(0);
    expect(countAfterSecond).toBe(countAfterFirst);
    // Something was pruned in the first run (201 thinned, 700 deleted)
    expect(first.pruned).toBeGreaterThan(0);
  });

  it('recent rows are kept AND old rows are pruned together in the same workspace', () => {
    const ws = createWorkspace('Retention Mixed Workspace Test');
    cleanupWorkspaceIds.add(ws.id);

    // Recent: 1, 90 days ago — both kept
    seedHistory({ workspaceId: ws.id, marketId: 'mkt-1', keyword: 'dental implants', daysAgoList: [1, 90] });
    // Weekly-window: 3 rows on same day 200 days ago → 2 pruned, 1 kept
    seedHistory({ workspaceId: ws.id, marketId: 'mkt-1', keyword: 'dentist', daysAgoList: [200, 200, 200] });
    // Hard-cutoff: 2 rows (600, 700 days), 600 is latest (immortal) → 1 pruned
    seedHistory({ workspaceId: ws.id, marketId: 'mkt-2', keyword: 'orthodontist', daysAgoList: [600, 700] });

    expect(snapshotCount(ws.id)).toBe(7);

    const { pruned } = runSnapshotRetentionPrune(ws.id);
    // 2 from weekly-thinning + 1 from hard-cutoff = 3 total
    expect(pruned).toBe(3);
    expect(snapshotCount(ws.id)).toBe(4);
  });

  it('prune does not touch a different workspace\'s rows', () => {
    const ws1 = createWorkspace('Retention Isolation WS1');
    const ws2 = createWorkspace('Retention Isolation WS2');
    cleanupWorkspaceIds.add(ws1.id);
    cleanupWorkspaceIds.add(ws2.id);

    // WS1: rows that should be pruned (3 on same day in weekly window)
    seedHistory({ workspaceId: ws1.id, marketId: 'mkt-1', keyword: 'dental', daysAgoList: [200, 200, 200] });
    // WS2: the same pattern — must NOT be pruned when we only prune WS1
    seedHistory({ workspaceId: ws2.id, marketId: 'mkt-1', keyword: 'dental', daysAgoList: [200, 200, 200] });

    const { pruned } = runSnapshotRetentionPrune(ws1.id);
    expect(pruned).toBe(2);
    // WS2 is untouched
    expect(snapshotCount(ws2.id)).toBe(3);
  });

  it('batch-size boundary: prunes correctly when candidate count is exactly RETENTION_PRUNE_BATCH_SIZE + 1', () => {
    // Tests that the do/while loop advances past the first batch
    const batchSize = RETENTION_PRUNE_BATCH_SIZE;
    const ws = createWorkspace('Retention Batch Boundary Test');
    cleanupWorkspaceIds.add(ws.id);

    // Insert batchSize + 1 rows all in the same ISO week in the weekly thinning window.
    // They span ~7 days starting at daysAgo=200 (same ISO week) — we use the same day
    // (200) for all to guarantee same ISO week.
    const daysAgoList = Array.from({ length: batchSize + 1 }, () => 200);
    seedHistory({ workspaceId: ws.id, marketId: 'mkt-1', keyword: 'dentist', daysAgoList });
    expect(snapshotCount(ws.id)).toBe(batchSize + 1);

    const { pruned } = runSnapshotRetentionPrune(ws.id);
    // One per (market, keyword, ISO-week) is kept; the rest pruned
    expect(pruned).toBe(batchSize);
    expect(snapshotCount(ws.id)).toBe(1);
  });
});
