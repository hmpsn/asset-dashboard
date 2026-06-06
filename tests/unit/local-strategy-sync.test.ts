import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBroadcast } from '../../server/broadcast.js';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { updateLocalSeoConfiguration, latestLocalSnapshotAt } from '../../server/local-seo.js';
import { getLocalStrategySyncStatus } from '../../server/local-strategy-sync.js';
import {
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_POSTURE,
  LOCAL_VISIBILITY_SOURCE_ENDPOINT,
  LOCAL_VISIBILITY_STATUS,
} from '../../shared/types/local-seo.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';

let workspaceId = '';

beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_seo_workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      posture TEXT NOT NULL DEFAULT 'unknown',
      posture_source TEXT NOT NULL DEFAULT 'unknown',
      suggested_posture TEXT,
      suggestion_reasons TEXT NOT NULL DEFAULT '[]',
      keywords_per_refresh INTEGER,
      updated_at TEXT NOT NULL
    );
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
  for (const sql of [
    'ALTER TABLE local_seo_markets ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE local_seo_workspace_settings ADD COLUMN keywords_per_refresh INTEGER',
    'ALTER TABLE local_visibility_snapshots ADD COLUMN matched_location_id TEXT',
    'ALTER TABLE local_visibility_snapshots ADD COLUMN matched_location_name TEXT',
    'ALTER TABLE local_visibility_snapshots ADD COLUMN raw_results TEXT',
  ]) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists in migrated test databases.
    }
  }
  workspaceId = createWorkspace(`Local Strategy Sync ${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

// Helper: seed local posture + one active market
function seedLocalPosture(posture: 'local' | 'hybrid' | 'non_local') {
  updateLocalSeoConfiguration(workspaceId, {
    posture: posture === 'non_local' ? LOCAL_SEO_POSTURE.NON_LOCAL : posture === 'hybrid' ? LOCAL_SEO_POSTURE.HYBRID : LOCAL_SEO_POSTURE.LOCAL,
    markets: posture === 'non_local' ? [] : [{
      label: 'Austin, TX',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      providerLocationCode: 1026201,
      status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
    }],
  }, true);
}

// Helper: get the market inserted by seedLocalPosture
function getMarketId(): string {
  const market = db.prepare('SELECT id FROM local_seo_markets WHERE workspace_id = ? LIMIT 1').get(workspaceId) as { id: string } | undefined;
  if (!market) throw new Error('No market seeded');
  return market.id;
}

// Helper: insert a snapshot with a given captured_at
function insertSnapshot(id: string, capturedAt: string, marketId?: string) {
  const mid = marketId ?? getMarketId();
  db.prepare(`
    INSERT INTO local_visibility_snapshots (
      id, workspace_id, keyword, normalized_keyword, market_id, market_label, captured_at,
      local_pack_present, business_found, business_match_confidence, business_match_reason,
      local_rank, top_competitors, source_endpoint, provider, device, language_code, status, degraded_reason
    ) VALUES (
      @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label, @captured_at,
      @local_pack_present, @business_found, @business_match_confidence, @business_match_reason,
      @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status, @degraded_reason
    )
  `).run({
    id,
    workspace_id: workspaceId,
    keyword: 'Austin Dentist',
    normalized_keyword: 'austin dentist',
    market_id: mid,
    market_label: 'Austin, TX',
    captured_at: capturedAt,
    local_pack_present: 1,
    business_found: 1,
    business_match_confidence: 'verified',
    business_match_reason: null,
    local_rank: 2,
    top_competitors: '[]',
    source_endpoint: LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP,
    provider: 'fake-seo-provider',
    device: 'desktop',
    language_code: 'en',
    status: LOCAL_VISIBILITY_STATUS.SUCCESS,
    degraded_reason: null,
  });
}

// Helper: seed strategy blob with a given generatedAt
function seedStrategy(generatedAt: string) {
  const strategy: KeywordStrategy = {
    siteKeywords: [],
    opportunities: [],
    generatedAt,
  };
  updateWorkspace(workspaceId, { keywordStrategy: strategy });
}

// ─── Task 0.2 Tests: latestLocalSnapshotAt ───────────────────────────────────

describe('latestLocalSnapshotAt', () => {
  it('returns null when no snapshots exist', () => {
    expect(latestLocalSnapshotAt(workspaceId)).toBeNull();
  });

  it('returns the max captured_at across multiple snapshots', () => {
    seedLocalPosture('local');
    insertSnapshot('snap-early', '2026-04-01T10:00:00.000Z');
    insertSnapshot('snap-late', '2026-05-15T10:00:00.000Z');
    expect(latestLocalSnapshotAt(workspaceId)).toBe('2026-05-15T10:00:00.000Z');
  });
});

// ─── Task 0.3 Tests: getLocalStrategySyncStatus ───────────────────────────────

describe('getLocalStrategySyncStatus', () => {
  it('(1) applies=false and all flags false/null for non-local posture', () => {
    // Default workspace posture is 'unknown' which is not local/hybrid
    const status = getLocalStrategySyncStatus(workspaceId);
    expect(status.applies).toBe(false);
    expect(status.localNeedsRefresh).toBe(false);
    expect(status.localNeedsRefreshReason).toBeNull();
    expect(status.strategyStaleVsLocal).toBe(false);
  });

  it('(1b) surfaces the timestamps even when applies=false', () => {
    // A non-local workspace still gets lastLocalRefreshAt/lastStrategyGeneratedAt
    // surfaced (read regardless of applies) — only the flags/reason zero out.
    seedLocalPosture('non_local'); // seeds no market
    insertSnapshot('snap-nonlocal', '2026-05-20T10:00:00.000Z', 'market-nonlocal');
    seedStrategy('2026-05-19T10:00:00.000Z');
    const status = getLocalStrategySyncStatus(workspaceId);
    expect(status.applies).toBe(false);
    expect(status.localNeedsRefresh).toBe(false);
    expect(status.localNeedsRefreshReason).toBeNull();
    expect(status.strategyStaleVsLocal).toBe(false);
    expect(status.lastLocalRefreshAt).toBe('2026-05-20T10:00:00.000Z');
    expect(status.lastStrategyGeneratedAt).toBe('2026-05-19T10:00:00.000Z');
  });

  it('(2) reason=missing for local posture with no snapshots', () => {
    seedLocalPosture('local');
    const status = getLocalStrategySyncStatus(workspaceId);
    expect(status.applies).toBe(true);
    expect(status.localNeedsRefresh).toBe(true);
    expect(status.localNeedsRefreshReason).toBe('missing');
  });

  it('(3) reason=markets_changed when a market updatedAt is after the latest snapshot', () => {
    seedLocalPosture('local');
    // Insert a snapshot captured BEFORE the market was updated
    insertSnapshot('snap-old', '2026-01-01T00:00:00.000Z');
    // Manually set market updated_at to after the snapshot
    db.prepare('UPDATE local_seo_markets SET updated_at = ? WHERE workspace_id = ?')
      .run('2026-02-01T00:00:00.000Z', workspaceId);
    const status = getLocalStrategySyncStatus(workspaceId);
    expect(status.applies).toBe(true);
    expect(status.localNeedsRefresh).toBe(true);
    expect(status.localNeedsRefreshReason).toBe('markets_changed');
  });

  it('(4) reason=stale when latest snapshot is >30 days old and markets are older than it', () => {
    seedLocalPosture('local');
    // Snapshot is 60 days old; market updated_at is even older
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    insertSnapshot('snap-stale', sixtyDaysAgo);
    db.prepare('UPDATE local_seo_markets SET updated_at = ? WHERE workspace_id = ?')
      .run(ninetyDaysAgo, workspaceId);
    const status = getLocalStrategySyncStatus(workspaceId);
    expect(status.applies).toBe(true);
    expect(status.localNeedsRefresh).toBe(true);
    expect(status.localNeedsRefreshReason).toBe('stale');
  });

  it('(5) reason=null (fresh) when snapshot is recent and markets are not newer', () => {
    seedLocalPosture('local');
    const now = new Date().toISOString();
    insertSnapshot('snap-fresh', now);
    // Market updated_at stays at whatever updateLocalSeoConfiguration set (which is also ~now, but same or earlier)
    // Ensure market is older than snapshot by backdating it slightly
    db.prepare('UPDATE local_seo_markets SET updated_at = ? WHERE workspace_id = ?')
      .run('2026-01-01T00:00:00.000Z', workspaceId);
    const status = getLocalStrategySyncStatus(workspaceId);
    expect(status.applies).toBe(true);
    expect(status.localNeedsRefresh).toBe(false);
    expect(status.localNeedsRefreshReason).toBeNull();
  });

  it('(6) strategyStaleVsLocal=true when strategy generatedAt predates the latest snapshot', () => {
    seedLocalPosture('local');
    // Strategy was generated 5 days ago; snapshot is from 2 days ago (fresh, not stale)
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    seedStrategy(fiveDaysAgo);
    insertSnapshot('snap-newer', twoDaysAgo);
    // Market updated before the snapshot
    db.prepare('UPDATE local_seo_markets SET updated_at = ? WHERE workspace_id = ?')
      .run('2026-01-01T00:00:00.000Z', workspaceId);
    const status = getLocalStrategySyncStatus(workspaceId);
    expect(status.applies).toBe(true);
    expect(status.strategyStaleVsLocal).toBe(true);
    // Reason should be null: snapshot is recent (<30 days), markets not newer
    expect(status.localNeedsRefreshReason).toBeNull();
    expect(status.lastStrategyGeneratedAt).toBe(fiveDaysAgo);
    expect(status.lastLocalRefreshAt).toBe(twoDaysAgo);
  });

  it('(7) strategyStaleVsLocal=false when no strategy blob but a snapshot exists; localNeedsRefresh reflects freshness', () => {
    seedLocalPosture('local');
    // No strategy seeded — keywordStrategy is null/undefined
    const now = new Date().toISOString();
    insertSnapshot('snap-now', now);
    db.prepare('UPDATE local_seo_markets SET updated_at = ? WHERE workspace_id = ?')
      .run('2026-01-01T00:00:00.000Z', workspaceId);
    const status = getLocalStrategySyncStatus(workspaceId);
    expect(status.applies).toBe(true);
    // No strategy → strategyStaleVsLocal = false (null generatedAt)
    expect(status.strategyStaleVsLocal).toBe(false);
    expect(status.lastStrategyGeneratedAt).toBeNull();
    // localNeedsRefresh: fresh snapshot, so false
    expect(status.localNeedsRefresh).toBe(false);
  });
});
