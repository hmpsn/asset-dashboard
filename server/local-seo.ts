import { randomUUID } from 'crypto';
import { z } from 'zod';

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { addActivity } from './activity-log.js';
import { fireBridge } from './bridge-infrastructure.js';
import { runLocalVisibilityShiftBridge } from './bridge-local-visibility-shift.js';
import { broadcastToWorkspace } from './broadcast.js';
import { listContentGaps } from './content-gaps.js';
import { createJob, updateJob, getJob, hasActiveJob, unregisterAbort } from './jobs.js';
import { getDeclinedKeywords, getRequestedKeywords } from './keyword-feedback.js';
import { isStrategyPoolEligibleKeyword, isNearDuplicateKeyword } from './keyword-intelligence/rules.js';
import { listPageKeywords } from './page-keywords.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { runRecommendationRegen } from './recommendation-regen-scheduler.js';
import { DEFAULT_SEO_DATA_PROVIDER, getProvider, isCapabilityDisabled, normalizeRuntimeSeoDataProvider, type SeoDataProvider } from './seo-data-provider.js';
import { getTaxonomyForIndustry } from './service-taxonomy.js';
import { getWorkspace } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { waitForHeapHeadroom } from './seo-refresh-runner-runtime.js';
import { sleep } from './helpers.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { buildDataForSeoLocationName } from '../shared/local-seo-location.js';
import {
  LOCAL_SEO_MAX_RESULTS,
  evaluateLocalBusinessMatch,
  getEffectiveLocations,
  scrubOwnedLocalResults,
} from './domains/local-seo/business-match.js';
import {
  applySourcePageCap,
  candidateSourceScore,
  classifyLocalKeywordIntent,
  cleanKeywordDisplay,
  hasMarketModifier,
  localVariantKeywordsByMarket,
  titleLooksLikeServiceKeyword,
  normalizeText,
} from './domains/local-seo/keyword-intent.js';
import type { LocalSeoKeywordCandidate } from './domains/local-seo/types.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_MARKET_SOURCE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP,
  LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
  LOCAL_SEO_POSTURE,
  LOCAL_SEO_POSTURE_SOURCE,
  LOCAL_SEO_VISIBILITY_POSTURE,
  LOCAL_VISIBILITY_SOURCE_ENDPOINT,
  LOCAL_VISIBILITY_STATUS,
  localSeoKeywordVisibilityFromSnapshot,
  localSeoKeywordVisibilitySummaryFromSnapshots,
  summarizeLocalSeoKeywordVisibility,
  type ClientLocation,
  type LocalBusinessMatchConfidence,
  type LocalSeoKeywordVisibility,
  type LocalSeoKeywordVisibilitySummary,
  type LocalSeoDevice,
  type LocalSeoKeywordIntent,
  type LocalSeoLocationLookupRequest,
  type LocalSeoLocationLookupResponse,
  type LocalSeoMarket,
  type LocalSeoMarketStatus,
  type LocalSeoMarketUpdateRequest,
  type LocalSeoPosture,
  type LocalSeoReportSummary,
  type LocalSeoReadResponse,
  type LocalSeoVisibilityTrendPoint,
  type LocalSeoVisibilityTrendSeries,
  type LocalSeoRepeatCompetitor,
  type LocalSeoServiceGap,
  type LocalSeoRefreshRequest,
  type LocalSeoRefreshResult,
  type LocalSeoWorkspaceSettings,
  type LocalVisibilitySourceEndpoint,
  type LocalVisibilityBusinessResult,
  type LocalVisibilityProviderResult,
  type LocalVisibilitySnapshot,
} from '../shared/types/local-seo.js';
import { TRACKED_KEYWORD_STATUS } from '../shared/types/rank-tracking.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import type { Workspace } from '../shared/types/workspace.js';

const log = createLogger('local-seo');

export const LOCAL_SEO_MAX_MARKETS = 3;

export {
  cleanDomain,
  confidencePriority,
  evaluateLocalBusinessMatch,
  getEffectiveLocations,
  isOwnedLocalResult,
  normalizePhone,
  normalizeProviderIdentity,
  scrubOwnedLocalResults,
} from './domains/local-seo/business-match.js';
export {
  applySourcePageCap,
  candidateSourceScore,
  classifyLocalKeywordIntent,
  cleanKeywordDisplay,
  hasMarketModifier,
  localVariantKeywords,
  localVariantKeywordsByMarket,
  normalizeText,
  titleLooksLikeServiceKeyword,
  type LocalVariantKeyword,
} from './domains/local-seo/keyword-intent.js';
export type { LocalSeoKeywordCandidate } from './domains/local-seo/types.js';

const TARGET_GEO_LOCATION_NAMES_BY_CODE: Record<number, string> = {
  2036: 'Australia',
  2056: 'Belgium',
  2076: 'Brazil',
  2124: 'Canada',
  2250: 'France',
  2276: 'Germany',
  2356: 'India',
  2372: 'Ireland',
  2380: 'Italy',
  2392: 'Japan',
  2484: 'Mexico',
  2528: 'Netherlands',
  2554: 'New Zealand',
  2616: 'Poland',
  2702: 'Singapore',
  2710: 'South Africa',
  2724: 'Spain',
  2752: 'Sweden',
  2826: 'United Kingdom',
  2840: 'United States',
};

function notifyLocalSeoUpdated(workspaceId: string, payload: Record<string, unknown>): void {
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_SEO_UPDATED, {
    workspaceId,
    ...payload,
  });
}
/**
 * Deprecated alias — kept temporarily for downstream readers that haven't
 * migrated to the new per-workspace budget. New code should read
 * `LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH` from `shared/types/local-seo.ts`
 * or call `getEffectiveKeywordsPerRefresh(workspaceId)` for the resolved value.
 */
export const LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH = LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH;

/**
 * Resolved keywords-per-refresh budget for a given workspace. Returns the
 * workspace's per-workspace override if set (clamped to
 * [LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH, LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP]),
 * otherwise the global default.
 *
 * Returns the default when the workspace is unknown — callers that need a
 * stricter not-found behavior should check workspace existence themselves.
 */
export function getEffectiveKeywordsPerRefresh(workspaceId: string): number {
  const row = stmts().getSettings.get(workspaceId) as SettingsRow | undefined;
  const override = row?.keywords_per_refresh;
  if (typeof override !== 'number') return LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH;
  return Math.max(
    LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
    Math.min(LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP, Math.trunc(override)),
  );
}
const LOCAL_CANDIDATE_HARD_CAP = 1000;
// Fully sequential SERP calls. Iteration history: 5 (initial) → 3 (PR #909) → 1 (PR #910).
// Each concurrent slot holds a full DataForSEO serp/google/organic/live/advanced JSON
// response in memory during parsing (~20–30 MB). On memory-constrained hosts (Render
// starter ~512 MB) even 3 concurrent responses stacked with an active KCC build (~110 MB
// heap) and other request handlers exceeded the process memory limit and triggered an
// OOM SIGKILL with no error log. Going fully sequential cuts peak SERP-response memory
// to a single response (~25 MB). Combined with LOCAL_SEO_REFRESH_ITEM_YIELD_MS below
// and waitForMemoryHeadroom() before each batch, this gives V8 time to reclaim the
// previous response and lets concurrent KCC reads complete without competing for memory.
// Wall-clock is ~3× longer than before; that trade is explicitly acceptable.
const LOCAL_SEO_REFRESH_CONCURRENCY = 1;
// Production defaults for the inter-item yield and heap-headroom backpressure
// applied inside the refresh loop. Test-only override via
// `__setRefreshTimingsForTesting()` keeps unit tests fast without changing
// production behavior. Tuned for Render starter (~512 MB total): KCC alone
// uses ~110 MB heap, so 220 MB leaves room for one SERP response (~25 MB) plus
// baseline (~80 MB) without approaching the OOM cliff.
const DEFAULT_REFRESH_ITEM_YIELD_MS = 150;
const DEFAULT_HEAP_HEADROOM_THRESHOLD_MB = 220;
const DEFAULT_HEAP_HEADROOM_WAIT_MS = 2000;
const DEFAULT_HEAP_HEADROOM_MAX_WAITS = 3;

const refreshTimings = {
  itemYieldMs: DEFAULT_REFRESH_ITEM_YIELD_MS,
  heapHeadroomThresholdMb: DEFAULT_HEAP_HEADROOM_THRESHOLD_MB,
  heapHeadroomWaitMs: DEFAULT_HEAP_HEADROOM_WAIT_MS,
  heapHeadroomMaxWaits: DEFAULT_HEAP_HEADROOM_MAX_WAITS,
};

/**
 * Test-only hook: override refresh timing constants so unit tests run fast
 * without the 150 ms × N inter-item sleep and the 2 s heap-headroom pause.
 * Production code never calls this — the defaults above are the live values.
 */
export function __setRefreshTimingsForTesting(overrides: Partial<typeof refreshTimings>): void {
  Object.assign(refreshTimings, overrides);
}

/**
 * Test-only hook: restore production refresh timings. Call from `afterEach`
 * so a test that opted in to fast timings doesn't leak the override into
 * adjacent tests.
 */
export function __resetRefreshTimingsForTesting(): void {
  refreshTimings.itemYieldMs = DEFAULT_REFRESH_ITEM_YIELD_MS;
  refreshTimings.heapHeadroomThresholdMb = DEFAULT_HEAP_HEADROOM_THRESHOLD_MB;
  refreshTimings.heapHeadroomWaitMs = DEFAULT_HEAP_HEADROOM_WAIT_MS;
  refreshTimings.heapHeadroomMaxWaits = DEFAULT_HEAP_HEADROOM_MAX_WAITS;
}

/**
 * Heap-aware backpressure: before allocating another SERP response, ensure heap
 * headroom exists on memory-constrained hosts. If heap is above the threshold,
 * sleep and retry up to `maxWaits` times. After that, proceed anyway — we'd
 * rather risk one more allocation than stall the refresh indefinitely waiting
 * for memory that may never drain (e.g. a long-running KCC build).
 */
async function waitForMemoryHeadroom(): Promise<void> {
  await waitForHeapHeadroom({
    thresholdMb: refreshTimings.heapHeadroomThresholdMb,
    waitMs: refreshTimings.heapHeadroomWaitMs,
    maxWaits: refreshTimings.heapHeadroomMaxWaits,
    logger: log,
    logMessage: 'local-seo refresh: heap above threshold — pausing for GC headroom',
  });
}
// Snapshot retention policy constants (Bug 3 / owner decision D4).
//   - Raw retention window: keep all rows captured within RETENTION_RAW_DAYS.
//   - Weekly thinning: for rows older than RETENTION_RAW_DAYS, keep one row per
//     (market_id, normalized_keyword, device, language_code) per week up to
//     RETENTION_WEEKLY_MAX_DAYS. Weeks are bucketed by start DATE (no year-boundary
//     artifact), and per-device/per-language history is thinned independently.
//   - Hard cutoff: delete all rows beyond RETENTION_WEEKLY_MAX_DAYS.
//   - Exception: ALWAYS keep the latest row per
//     (market_id, normalized_keyword, device, language_code) regardless of age so a
//     market-keyword-device-language series is never invisible (matches the
//     latestSnapshots read granularity).
// Batch size: 200 rows per DELETE to stay within SQLite's safe per-statement
// range on memory-constrained hosts.
export const RETENTION_RAW_DAYS = 180;
export const RETENTION_WEEKLY_MAX_DAYS = 548; // 18 months ≈ 18 × 30.44 days
export const RETENTION_PRUNE_BATCH_SIZE = 200;

/**
 * Fire a `LOCAL_SEO_UPDATED` broadcast every N completed snapshots during a
 * refresh so the UI invalidates its KCC + local-seo caches incrementally
 * instead of waiting for the whole job. Without this, a 200-call refresh
 * looks frozen until completion — the snapshots are landing in the DB but
 * the React Query cache stays stale.
 *
 * 20 is a balance: enough cadence that a 4–5 minute concurrent refresh
 * triggers ~10 mid-job invalidations (one every ~25s of wall-clock), few
 * enough to avoid hammering subscribed clients with redundant refetches.
 */
const LOCAL_SEO_REFRESH_PROGRESS_BROADCAST_INTERVAL = 20;
/**
 * Backfills update existing snapshots in local DB batches rather than calling
 * the provider. Broadcast at batch boundaries so Local SEO + KCC views refresh
 * during large historical recalculations without producing noisy refetches.
 */
const LOCAL_SEO_LOCATION_BACKFILL_PROGRESS_BROADCAST_INTERVAL = 100;
const DEFAULT_LANGUAGE_CODE = 'en';

const localResultSchema = z.object({
  title: z.string(),
  rank: z.number().optional(),
  domain: z.string().optional(),
  url: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  cid: z.string().optional(),
}).strip();

interface SettingsRow {
  workspace_id: string;
  posture: string;
  posture_source: string;
  suggested_posture: string | null;
  suggestion_reasons: string;
  updated_at: string;
  keywords_per_refresh: number | null;
}

interface MarketRow {
  id: string;
  workspace_id: string;
  label: string;
  city: string;
  state_or_region: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  provider_location_code: number | null;
  provider_location_name: string | null;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
  is_primary: number;
}

interface SnapshotRow {
  id: string;
  workspace_id: string;
  keyword: string;
  normalized_keyword: string;
  market_id: string;
  market_label: string;
  captured_at: string;
  local_pack_present: number;
  business_found: number;
  business_match_confidence: string;
  business_match_reason: string | null;
  local_rank: number | null;
  top_competitors: string;
  source_endpoint: string;
  provider: string;
  device: string;
  language_code: string;
  status: string;
  degraded_reason: string | null;
  matched_location_id: string | null;
  matched_location_name: string | null;
  raw_results: string | null;
}

interface SnapshotSummaryRow {
  keyword: string;
  normalized_keyword: string;
  market_id: string;
  market_label: string;
  captured_at: string;
  local_pack_present: number;
  business_found: number;
  business_match_confidence: string;
  business_match_reason: string | null;
  local_rank: number | null;
  source_endpoint: string;
  provider: string;
  status: string;
  degraded_reason: string | null;
}

const stmts = createStmtCache(() => ({
  getSettings: db.prepare('SELECT * FROM local_seo_workspace_settings WHERE workspace_id = ?'),
  upsertSettings: db.prepare(`
    INSERT INTO local_seo_workspace_settings (workspace_id, posture, posture_source, suggested_posture, suggestion_reasons, updated_at, keywords_per_refresh)
    VALUES (@workspace_id, @posture, @posture_source, @suggested_posture, @suggestion_reasons, @updated_at, @keywords_per_refresh)
    ON CONFLICT(workspace_id) DO UPDATE SET
      posture = excluded.posture,
      posture_source = excluded.posture_source,
      suggested_posture = excluded.suggested_posture,
      suggestion_reasons = excluded.suggestion_reasons,
      updated_at = excluded.updated_at,
      keywords_per_refresh = excluded.keywords_per_refresh
  `),
  listMarkets: db.prepare('SELECT * FROM local_seo_markets WHERE workspace_id = ? ORDER BY status ASC, label ASC'),
  getMarket: db.prepare('SELECT * FROM local_seo_markets WHERE id = ? AND workspace_id = ?'),
  countActiveMarkets: db.prepare("SELECT COUNT(*) AS count FROM local_seo_markets WHERE workspace_id = ? AND status = 'active'"),
  getPrimaryMarket: db.prepare(
    "SELECT * FROM local_seo_markets WHERE workspace_id = @workspaceId AND is_primary = 1 AND status = 'active' AND provider_location_code IS NOT NULL LIMIT 1",
  ),
  // Most-recent snapshot language for the workspace's primary market. The markets
  // table has no language column (language lives on snapshots), so the resolved
  // language is the last language that market was actually queried in.
  getPrimaryMarketLanguage: db.prepare(
    `SELECT s.language_code AS language_code
       FROM local_visibility_snapshots s
       JOIN local_seo_markets m ON m.id = s.market_id
      WHERE m.workspace_id = @workspaceId AND m.is_primary = 1 AND m.status = 'active'
      ORDER BY s.captured_at DESC
      LIMIT 1`,
  ),
  // Count of markets currently flagged primary AND still eligible (active + has a
  // provider location code). Used to detect the "orphaned primary" state after a
  // configuration update deactivates the primary market.
  countEligiblePrimary: db.prepare(
    "SELECT COUNT(*) AS count FROM local_seo_markets WHERE workspace_id = ? AND is_primary = 1 AND status = 'active' AND provider_location_code IS NOT NULL",
  ),
  // Deterministic first eligible active market for primary-successor promotion.
  // Ordered by (created_at, id) so the choice is stable across calls.
  firstEligibleActiveMarket: db.prepare(
    "SELECT * FROM local_seo_markets WHERE workspace_id = ? AND status = 'active' AND provider_location_code IS NOT NULL ORDER BY created_at ASC, id ASC LIMIT 1",
  ),
  clearPrimary: db.prepare(
    'UPDATE local_seo_markets SET is_primary = 0 WHERE workspace_id = @workspaceId',
  ),
  setMarketPrimary: db.prepare(
    "UPDATE local_seo_markets SET is_primary = 1 WHERE workspace_id = @workspaceId AND id = @marketId AND status = 'active' AND provider_location_code IS NOT NULL",
  ),
  upsertMarket: db.prepare(`
    INSERT INTO local_seo_markets (
      id, workspace_id, label, city, state_or_region, country, latitude, longitude,
      provider_location_code, provider_location_name, source, status, created_at, updated_at,
      is_primary
    ) VALUES (
      @id, @workspace_id, @label, @city, @state_or_region, @country, @latitude, @longitude,
      @provider_location_code, @provider_location_name, @source, @status, @created_at, @updated_at,
      @is_primary
    )
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      city = excluded.city,
      state_or_region = excluded.state_or_region,
      country = excluded.country,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      provider_location_code = excluded.provider_location_code,
      provider_location_name = excluded.provider_location_name,
      source = excluded.source,
      status = excluded.status,
      updated_at = excluded.updated_at,
      is_primary = CASE
        WHEN excluded.status = 'active' AND excluded.provider_location_code IS NOT NULL THEN local_seo_markets.is_primary
        ELSE 0
      END
  `),
  insertSnapshot: db.prepare(`
    INSERT INTO local_visibility_snapshots (
      id, workspace_id, keyword, normalized_keyword, market_id, market_label, captured_at,
      local_pack_present, business_found, business_match_confidence, business_match_reason,
      local_rank, top_competitors, source_endpoint, provider, device, language_code, status,
      degraded_reason, matched_location_id, matched_location_name, raw_results
    ) VALUES (
      @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label, @captured_at,
      @local_pack_present, @business_found, @business_match_confidence, @business_match_reason,
      @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status,
      @degraded_reason, @matched_location_id, @matched_location_name, @raw_results
    )
  `),
  updateSnapshotMatch: db.prepare(`
    UPDATE local_visibility_snapshots
    SET business_found = @business_found,
      business_match_confidence = @business_match_confidence,
      business_match_reason = @business_match_reason,
      local_rank = @local_rank,
      matched_location_id = @matched_location_id,
      matched_location_name = @matched_location_name,
      top_competitors = @top_competitors,
      raw_results = COALESCE(raw_results, @raw_results)
    WHERE id = @id AND workspace_id = @workspace_id
  `),
  listAllSnapshotsForWorkspace: db.prepare(`
    SELECT * FROM local_visibility_snapshots
    WHERE workspace_id = ?
    ORDER BY captured_at DESC
  `),
  countSnapshotsForWorkspace: db.prepare(`
    SELECT COUNT(*) AS count FROM local_visibility_snapshots
    WHERE workspace_id = ?
  `),
  maxUsableCapturedAtForWorkspace: db.prepare(`
    SELECT MAX(captured_at) AS max_captured_at FROM local_visibility_snapshots
    WHERE workspace_id = ? AND status != ?
  `),
  // Bug 1 fix: replaced LIMIT-500 + JS-dedupe with GROUP BY MAX(captured_at) to avoid
  // truncating large workspaces (300 keywords × 3 markets = 900 rows > 500).
  // Migration 097's composite index on (workspace_id, market_id, normalized_keyword,
  // device, language_code) already supports this query.
  // Tiebreaker fix: when two rows in the same (market, keyword, device, language)
  // group share the MAX(captured_at) timestamp, joining on captured_at alone returns
  // BOTH rows (duplicate "latest" entries). The id IN (SELECT MIN(id) ... GROUP BY ...)
  // guard collapses each group to a single deterministic row (MIN(id) among the rows
  // tied at the group's MAX(captured_at)).
  latestSnapshots: db.prepare(`
    SELECT s.*
    FROM local_visibility_snapshots s
    WHERE s.workspace_id = ?
      AND s.id IN (
        SELECT MIN(id)
        FROM local_visibility_snapshots
        WHERE workspace_id = ?
          AND (market_id, normalized_keyword, device, language_code, captured_at) IN (
            SELECT market_id, normalized_keyword, device, language_code, MAX(captured_at)
            FROM local_visibility_snapshots
            WHERE workspace_id = ?
            GROUP BY market_id, normalized_keyword, device, language_code
          )
        GROUP BY market_id, normalized_keyword, device, language_code
      )
  `),
  latestSnapshotsByKeyword: db.prepare(`
    SELECT s.*
    FROM local_visibility_snapshots s
    WHERE s.workspace_id = ? AND s.normalized_keyword = ?
      AND s.id IN (
        SELECT MIN(id)
        FROM local_visibility_snapshots
        WHERE workspace_id = ? AND normalized_keyword = ?
          AND (market_id, normalized_keyword, device, language_code, captured_at) IN (
            SELECT market_id, normalized_keyword, device, language_code, MAX(captured_at)
            FROM local_visibility_snapshots
            WHERE workspace_id = ? AND normalized_keyword = ?
            GROUP BY market_id, normalized_keyword, device, language_code
          )
        GROUP BY market_id, normalized_keyword, device, language_code
      )
  `),
  // Bug 2 fix: keyset-paginated read for the backfill job so it never materialises
  // all rows into memory at once. Cursor is (captured_at DESC, id ASC) for stable pagination.
  listSnapshotsPageForBackfill: db.prepare(`
    SELECT * FROM local_visibility_snapshots
    WHERE workspace_id = ?
      AND (captured_at < ? OR (captured_at = ? AND id > ?))
    ORDER BY captured_at DESC, id ASC
    LIMIT ?
  `),
  listSnapshotsFirstPageForBackfill: db.prepare(`
    SELECT * FROM local_visibility_snapshots
    WHERE workspace_id = ?
    ORDER BY captured_at DESC, id ASC
    LIMIT ?
  `),
  // Bug 3 fix: retention prune (owner decision D4).
  //
  // Grouping fix: every grouping here is on the FULL 4-column identity
  // (market_id, normalized_keyword, device, language_code) — the SAME granularity as
  // the latestSnapshots read query. Grouping on (market, keyword) alone would let the
  // immortal guard protect only ONE device/language variant and would thin per-device
  // history into a single shared row, destroying the other device's series.
  //
  // The "immortal" guard selects EXACTLY ONE row per 4-col identity using
  // (MAX(captured_at), MIN(id)) — same tie-breaking as the read query — so it never
  // protects ALL rows that share a captured_at timestamp.
  //
  // Week key fix: the weekly bucket is keyed on the week's START DATE
  // (date(captured_at, '-' || strftime('%w', captured_at) || ' days') → the Sunday of
  // that week) instead of strftime('%Y-%W'). The %Y-%W form concatenates the CALENDAR
  // year with the week number, which mis-buckets the days around a year boundary (e.g.
  // 2024-W52 vs 2025-W00 for the same Sun–Sat week). The start-date key has no such
  // artifact.
  //
  // Step 1 — IDs to thin from the weekly window (RETENTION_RAW_DAYS → RETENTION_WEEKLY_MAX_DAYS):
  //   rows that are NOT the canonical row per (market, keyword, device, language, week) —
  //   i.e. not the latest-per-bucket keeper (MAX(captured_at), tie-broken by MIN(id)) —
  //   AND are not the single immortal row per 4-col identity.
  //
  //   The keeper uses MAX(captured_at) per week bucket (not MIN(id) per group) so that the
  //   weekly survivor is always the most-recent snapshot in that bucket. This makes the
  //   keeper coincide with the immortal row whenever the bucket holds the pair's overall
  //   latest, eliminating a nondeterministic interaction: when the bucket's latest row is
  //   also the immortal (e.g. Dec 31 vs Jan 1 straddling a year boundary), a random-UUID
  //   MIN(id) coin flip could keep the older row while the immortal guard protects the
  //   newer one — leaving both alive and returning pruned=0 instead of 1.
  //
  //   Two-level keepers subquery:
  //     Inner: MAX(captured_at) per (market, keyword, device, language, week_start)
  //     Outer: JOIN on that max, MIN(id) to break ties among rows sharing the max timestamp
  //   Parameters (12 total):
  //     1-3: inner subquery WHERE (workspace_id, raw_days, weekly_max)
  //     4-6: outer keepers WHERE (workspace_id, raw_days, weekly_max)
  //     7-9: main outer WHERE (workspace_id, raw_days, weekly_max)
  //     10-11: immortal NOT IN guard (workspace_id inner, workspace_id outer)
  //     12: LIMIT
  pruneWeeklyThinIds: db.prepare(`
    SELECT s.id
    FROM local_visibility_snapshots s
    JOIN (
      SELECT outer_k.market_id, outer_k.normalized_keyword, outer_k.device,
             outer_k.language_code, top.week_start,
             MIN(outer_k.id) AS keep_id
      FROM local_visibility_snapshots outer_k
      JOIN (
        SELECT market_id, normalized_keyword, device, language_code,
               date(captured_at, '-' || strftime('%w', captured_at) || ' days') AS week_start,
               MAX(captured_at) AS max_captured_at
        FROM local_visibility_snapshots
        WHERE workspace_id = ?
          AND captured_at < datetime('now', '-' || ? || ' days')
          AND captured_at >= datetime('now', '-' || ? || ' days')
        GROUP BY market_id, normalized_keyword, device, language_code, week_start
      ) top ON outer_k.market_id = top.market_id
           AND outer_k.normalized_keyword = top.normalized_keyword
           AND outer_k.device = top.device
           AND outer_k.language_code = top.language_code
           AND date(outer_k.captured_at, '-' || strftime('%w', outer_k.captured_at) || ' days') = top.week_start
           AND outer_k.captured_at = top.max_captured_at
      WHERE outer_k.workspace_id = ?
        AND outer_k.captured_at < datetime('now', '-' || ? || ' days')
        AND outer_k.captured_at >= datetime('now', '-' || ? || ' days')
      GROUP BY outer_k.market_id, outer_k.normalized_keyword, outer_k.device,
               outer_k.language_code, top.week_start
    ) keepers ON keepers.market_id = s.market_id
             AND keepers.normalized_keyword = s.normalized_keyword
             AND keepers.device = s.device
             AND keepers.language_code = s.language_code
             AND date(s.captured_at, '-' || strftime('%w', s.captured_at) || ' days') = keepers.week_start
    WHERE s.workspace_id = ?
      AND s.captured_at < datetime('now', '-' || ? || ' days')
      AND s.captured_at >= datetime('now', '-' || ? || ' days')
      AND s.id != keepers.keep_id
      AND s.id NOT IN (
        SELECT MIN(id)
        FROM local_visibility_snapshots
        WHERE workspace_id = ?
          AND (captured_at, market_id, normalized_keyword, device, language_code) IN (
            SELECT MAX(captured_at), market_id, normalized_keyword, device, language_code
            FROM local_visibility_snapshots
            WHERE workspace_id = ?
            GROUP BY market_id, normalized_keyword, device, language_code
          )
        GROUP BY market_id, normalized_keyword, device, language_code
      )
    LIMIT ?
  `),
  // Step 2 — IDs beyond the hard cutoff (> RETENTION_WEEKLY_MAX_DAYS) that are not the
  // immortal row (latest per 4-col identity).
  pruneHardCutoffIds: db.prepare(`
    SELECT s.id
    FROM local_visibility_snapshots s
    WHERE s.workspace_id = ?
      AND s.captured_at < datetime('now', '-' || ? || ' days')
      AND s.id NOT IN (
        SELECT MIN(id)
        FROM local_visibility_snapshots
        WHERE workspace_id = ?
          AND (captured_at, market_id, normalized_keyword, device, language_code) IN (
            SELECT MAX(captured_at), market_id, normalized_keyword, device, language_code
            FROM local_visibility_snapshots
            WHERE workspace_id = ?
            GROUP BY market_id, normalized_keyword, device, language_code
          )
        GROUP BY market_id, normalized_keyword, device, language_code
      )
    LIMIT ?
  `),
  // Step 3 — single-row delete used inside the prune batch loop.
  deleteSnapshotById: db.prepare(`
    DELETE FROM local_visibility_snapshots WHERE id = ? AND workspace_id = ?
  `),
  competitorSnapshots: db.prepare(`
    SELECT workspace_id, business_found, local_pack_present, market_label, top_competitors
    FROM local_visibility_snapshots
    WHERE workspace_id = @workspaceId
      AND captured_at >= datetime('now', '-' || @days || ' days')
      AND status = 'success'
    ORDER BY captured_at DESC
  `),
  // W5.3: per-market visible-count trend. One row per (market, capture-day) with the
  // count of verified-match identities and the total checked identities that day.
  // Bucketed on date(captured_at) so multiple intra-day refreshes collapse to one point.
  // Bounded to RETENTION_RAW_DAYS (180d) so the series is uniformly daily — older rows
  // have been weekly-thinned and would introduce uneven spacing in the sparkline.
  // Excludes both provider_failed and degraded rows so neither inflates checked_count
  // (degraded snapshots carry businessFound=false regardless of actual visibility, matching
  // the postureFromSummaryRow convention that treats both status values as untrustworthy).
  visibilityTrend: db.prepare(`
    SELECT
      s.market_id AS market_id,
      s.market_label AS market_label,
      date(s.captured_at) AS day,
      COUNT(DISTINCT CASE
        WHEN s.business_found = 1 AND s.business_match_confidence = ?
        THEN s.normalized_keyword || '::' || s.device || '::' || s.language_code
      END) AS visible_count,
      COUNT(DISTINCT s.normalized_keyword || '::' || s.device || '::' || s.language_code) AS checked_count
    FROM local_visibility_snapshots s
    WHERE s.workspace_id = ?
      AND s.status NOT IN (?, ?)
      AND s.captured_at >= datetime('now', '-${RETENTION_RAW_DAYS} days')
    GROUP BY s.market_id, s.market_label, day
    ORDER BY s.market_id ASC, day ASC
  `),
  latestSnapshotSummary: db.prepare(`
    SELECT
      s.keyword,
      s.normalized_keyword,
      s.market_id,
      s.market_label,
      s.captured_at,
      s.local_pack_present,
      s.business_found,
      s.business_match_confidence,
      s.business_match_reason,
      s.local_rank,
      s.source_endpoint,
      s.provider,
      s.status,
      s.degraded_reason
    FROM local_visibility_snapshots s
    JOIN (
      SELECT market_id, normalized_keyword, device, language_code, MAX(captured_at) AS captured_at
      FROM local_visibility_snapshots
      WHERE workspace_id = ? AND status != ?
      GROUP BY market_id, normalized_keyword, device, language_code
    ) latest
      ON latest.market_id = s.market_id
      AND latest.normalized_keyword = s.normalized_keyword
      AND latest.device = s.device
      AND latest.language_code = s.language_code
      AND latest.captured_at = s.captured_at
    WHERE s.workspace_id = ? AND s.status != ?
  `),
}));

function isLocalSeoPosture(value: string): value is LocalSeoPosture {
  return Object.values(LOCAL_SEO_POSTURE).includes(value as LocalSeoPosture);
}

function isMarketStatus(value: string): value is LocalSeoMarketStatus {
  return Object.values(LOCAL_SEO_MARKET_STATUS).includes(value as LocalSeoMarketStatus);
}

function isBusinessMatchConfidence(value: string): value is LocalBusinessMatchConfidence {
  return Object.values(LOCAL_BUSINESS_MATCH_CONFIDENCE).includes(value as LocalBusinessMatchConfidence);
}

function isLocalVisibilitySourceEndpoint(value: string): value is LocalVisibilitySourceEndpoint {
  return Object.values(LOCAL_VISIBILITY_SOURCE_ENDPOINT).includes(value as LocalVisibilitySourceEndpoint);
}

function rowToMarket(row: MarketRow): LocalSeoMarket {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    label: row.label,
    city: row.city,
    stateOrRegion: row.state_or_region ?? undefined,
    country: row.country,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    providerLocationCode: row.provider_location_code ?? undefined,
    providerLocationName: row.provider_location_name ?? undefined,
    isPrimary: row.is_primary === 1,
    source: Object.values(LOCAL_SEO_MARKET_SOURCE).includes(row.source as LocalSeoMarket['source']) ? row.source as LocalSeoMarket['source'] : LOCAL_SEO_MARKET_SOURCE.UNKNOWN,
    status: isMarketStatus(row.status) ? row.status : LOCAL_SEO_MARKET_STATUS.NEEDS_REVIEW,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSettings(row: SettingsRow): LocalSeoWorkspaceSettings {
  return {
    workspaceId: row.workspace_id,
    posture: isLocalSeoPosture(row.posture) ? row.posture : LOCAL_SEO_POSTURE.UNKNOWN,
    postureSource: Object.values(LOCAL_SEO_POSTURE_SOURCE).includes(row.posture_source as LocalSeoWorkspaceSettings['postureSource']) ? row.posture_source as LocalSeoWorkspaceSettings['postureSource'] : LOCAL_SEO_POSTURE_SOURCE.UNKNOWN,
    suggestedPosture: row.suggested_posture && isLocalSeoPosture(row.suggested_posture) ? row.suggested_posture : undefined,
    suggestionReasons: parseJsonSafeArray(row.suggestion_reasons, z.string(), { workspaceId: row.workspace_id, table: 'local_seo_workspace_settings', field: 'suggestion_reasons' }),
    updatedAt: row.updated_at,
    keywordsPerRefresh: row.keywords_per_refresh,
  };
}

function rowToSnapshot(row: SnapshotRow): LocalVisibilitySnapshot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    keyword: row.keyword,
    normalizedKeyword: row.normalized_keyword,
    marketId: row.market_id,
    marketLabel: row.market_label,
    capturedAt: row.captured_at,
    localPackPresent: row.local_pack_present === 1,
    businessFound: row.business_found === 1,
    businessMatchConfidence: Object.values(LOCAL_BUSINESS_MATCH_CONFIDENCE).includes(row.business_match_confidence as LocalBusinessMatchConfidence)
      ? row.business_match_confidence as LocalBusinessMatchConfidence
      : LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN,
    businessMatchReason: row.business_match_reason ?? undefined,
    localRank: row.local_rank ?? undefined,
    topCompetitors: parseJsonSafeArray(row.top_competitors, localResultSchema, { workspaceId: row.workspace_id, table: 'local_visibility_snapshots', field: 'top_competitors' }),
    sourceEndpoint: row.source_endpoint as LocalVisibilitySnapshot['sourceEndpoint'],
    provider: row.provider,
    device: row.device === LOCAL_SEO_DEVICE.MOBILE ? LOCAL_SEO_DEVICE.MOBILE : LOCAL_SEO_DEVICE.DESKTOP,
    languageCode: row.language_code,
    status: Object.values(LOCAL_VISIBILITY_STATUS).includes(row.status as LocalVisibilitySnapshot['status']) ? row.status as LocalVisibilitySnapshot['status'] : LOCAL_VISIBILITY_STATUS.DEGRADED,
    degradedReason: row.degraded_reason ?? undefined,
    matchedLocationId: row.matched_location_id ?? undefined,
    matchedLocationName: row.matched_location_name ?? undefined,
  };
}

function rowToRawLocalResults(row: SnapshotRow): LocalVisibilityBusinessResult[] {
  return parseJsonSafeArray(row.raw_results ?? row.top_competitors, localResultSchema, {
    workspaceId: row.workspace_id,
    table: 'local_visibility_snapshots',
    field: row.raw_results ? 'raw_results' : 'top_competitors',
  });
}

function isUsableLocalVisibilitySnapshot(snapshot: Pick<LocalVisibilitySnapshot, 'status'>): boolean {
  return snapshot.status !== LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED;
}

// ── Per-workspace classifier builders ────────────────────────────────────────
//
// These replace the original workspace's hardcoded Texas city names and
// dental/legal vocabulary. Classifiers are derived from the workspace's own
// markets and business profile so every workspace gets relevant matching.
// Call once per hot loop (e.g. per candidate build invocation) and reuse.

/**
 * Builds a geo-term regex from the workspace's configured local SEO markets and
 * business profile city/state. Always includes `near me` and `/location/` as
 * universal local-intent signals.
 *
 * Returns null when no workspace-specific geo terms are available (the caller
 * should fall back to the universal patterns only).
 *
 * Performance: O(n markets) string ops, called once per build cycle.
 */
function buildWorkspaceGeoRegex(workspace: Workspace, markets: LocalSeoMarket[]): RegExp | null {
  const terms: string[] = [];

  // Markets: city and state/region from each configured market
  for (const market of markets) {
    const city = normalizeText(market.city);
    const state = normalizeText(market.stateOrRegion);
    if (city) terms.push(city);
    if (state) terms.push(state);
  }

  // Business profile: primary address city and state as fallback geo evidence
  const bpCity = normalizeText(workspace.businessProfile?.address?.city);
  const bpState = normalizeText(workspace.businessProfile?.address?.state);
  if (bpCity) terms.push(bpCity);
  if (bpState) terms.push(bpState);

  // Universal patterns always apply
  const uniqueTerms = [...new Set(terms.filter(Boolean))];
  const geoTermPart = uniqueTerms.map(t => `\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).join('|');
  const combined = geoTermPart
    ? `\\bnear me\\b|\\/location\\/${geoTermPart ? `|${geoTermPart}` : ''}`
    : null;

  return combined ? new RegExp(combined, 'i') : null;
}

/**
 * Builds a service-term regex from the workspace's own data:
 *  1. Industry taxonomy match terms (from service-taxonomy.ts via industry field)
 *  2. Site keywords from the keyword strategy
 *  3. Knowledge base / business context keyword extraction (simple word tokens)
 *  4. Generic cross-industry fallback ONLY when no workspace-specific terms are found
 *
 * Performance: called once per candidate build cycle; result reused per keyword.
 */
function buildWorkspaceServiceTermRegex(workspace: Workspace): RegExp {
  const terms: string[] = [];

  // Layer 1a: industry taxonomy via explicit intelligenceProfile.industry field.
  const taxonomy = getTaxonomyForIndustry(workspace.intelligenceProfile?.industry);
  if (taxonomy) {
    for (const service of taxonomy) {
      for (const term of service.matchTerms) {
        terms.push(term.toLowerCase());
      }
    }
  }

  // Layer 1b: industry taxonomy via implicit detection from workspace name and
  // business context text. This handles workspaces where the admin hasn't
  // explicitly set intelligenceProfile.industry but the context clearly signals
  // an industry (e.g. "Dental office." business context → dental taxonomy).
  if (!taxonomy) {
    const implicitIndustryHints = [
      workspace.name,
      workspace.keywordStrategy?.businessContext,
      workspace.knowledgeBase,
    ].filter(Boolean).join(' ');
    const implicitTaxonomy = getTaxonomyForIndustry(implicitIndustryHints);
    if (implicitTaxonomy) {
      for (const service of implicitTaxonomy) {
        for (const term of service.matchTerms) {
          terms.push(term.toLowerCase());
        }
      }
    }
  }

  // Layer 2: strategy site keywords — the keywords the admin has already identified
  // as the core services. Extract individual word tokens (4+ chars) so that
  // multi-word phrases like "cosmetic dentist" contribute both "cosmetic" and "dentist".
  // Generic stopwords that appear in almost every keyword phrase are excluded: they
  // carry no discriminating signal and produce false-positive service-keyword matches
  // against unrelated page titles. Keep the list small and limited to words that are
  // truly universal noise across all industries.
  const KEYWORD_TOKEN_STOPWORDS = new Set([
    'best', 'near', 'your', 'with', 'guide', 'this', 'that', 'from', 'into',
    'over', 'than', 'then', 'when', 'more', 'also', 'have', 'will', 'what',
    'where', 'which', 'they', 'them', 'their', 'been', 'were', 'very',
  ]);
  for (const kw of workspace.keywordStrategy?.siteKeywords ?? []) {
    const tokens = kw.toLowerCase().trim().split(/\s+/);
    for (const token of tokens) {
      if (token.length >= 4 && !KEYWORD_TOKEN_STOPWORDS.has(token)) terms.push(token);
    }
  }

  // Note: raw business context text is intentionally NOT added to the service term
  // regex here. Context prose (e.g. "HVAC contractor serving Chicago") produces too
  // many general nouns (management, software, contractor, serving…) that would
  // cause false positives against unrelated page titles. Business context is instead
  // used for implicit industry detection above (Layer 1b), which extracts the
  // industry taxonomy's authoritative match terms instead of raw prose words.

  if (terms.length === 0) {
    // Generic fallback: broad cross-industry service signals used ONLY when the workspace
    // has no profile data at all. This is explicitly documented as a last resort.
    // Note: no dental/legal-specific terms here — those belong in taxonomy (Layer 1).
    return /\bservice\b|\bclinic\b|\bcontractor\b|\brestaurant\b|\bsalon\b|\bspa\b|\boffice\b/i;
  }

  const escaped = [...new Set(terms.filter(Boolean))]
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'i');
}

function derivePosture(workspace: Workspace): Pick<LocalSeoWorkspaceSettings, 'suggestedPosture' | 'suggestionReasons'> {
  const reasons: string[] = [];
  const profile = workspace.businessProfile;
  if (profile?.address?.city && profile.address.state) reasons.push('Business profile has city/state contact evidence');
  const industry = workspace.intelligenceProfile?.industry?.toLowerCase() ?? '';
  if (/dent|clinic|medical|legal|law|restaurant|contractor|home service|salon|spa/.test(industry)) reasons.push('Industry commonly depends on local intent');
  const pageTerms = listPageKeywords(workspace.id)
    .slice(0, 75)
    .map(page => `${page.pagePath} ${page.pageTitle} ${page.primaryKeyword}`.toLowerCase())
    .join(' ');
  // Build geo regex from this workspace's configured markets and business profile —
  // never from hardcoded city names that only apply to the original Texas dental workspace.
  const workspaceGeoRegex = buildWorkspaceGeoRegex(workspace, listLocalSeoMarkets(workspace.id));
  const geoPattern = workspaceGeoRegex ?? /\bnear me\b|\/location\//;
  if (geoPattern.test(pageTerms)) reasons.push('Page map contains local/service-area terms');
  if (reasons.length >= 2) return { suggestedPosture: LOCAL_SEO_POSTURE.LOCAL, suggestionReasons: reasons };
  if (reasons.length === 1) return { suggestedPosture: LOCAL_SEO_POSTURE.HYBRID, suggestionReasons: reasons };
  return { suggestedPosture: LOCAL_SEO_POSTURE.UNKNOWN, suggestionReasons: ['No explicit local market evidence found yet'] };
}

function defaultSettings(workspace: Workspace): LocalSeoWorkspaceSettings {
  const derived = derivePosture(workspace);
  return {
    workspaceId: workspace.id,
    posture: LOCAL_SEO_POSTURE.UNKNOWN,
    postureSource: LOCAL_SEO_POSTURE_SOURCE.UNKNOWN,
    suggestedPosture: derived.suggestedPosture,
    suggestionReasons: derived.suggestionReasons,
    updatedAt: new Date().toISOString(),
    keywordsPerRefresh: null,
  };
}

/**
 * SEO Gen-Quality P7.1 — the blessed read of a workspace's local SEO posture.
 *
 * Resolves the authoritative posture (admin-override-aware, via readSettings) for a
 * workspace, or `unknown` when the workspace doesn't exist. This is the single getter the
 * recommendation engine calls ONCE per rec-gen cycle to decide whether to mint local recs
 * (`useLocalGenQual`). Compare against the exported LOCAL_SEO_POSTURE const (local/hybrid/
 * non_local/unknown). Does NOT touch the feature flag — that is gated separately at the
 * call site so the three-gate is explicit.
 */
export function getLocalSeoPosture(workspaceId: string): LocalSeoPosture {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return LOCAL_SEO_POSTURE.UNKNOWN;
  return readSettings(workspace).posture;
}

function readSettings(workspace: Workspace): LocalSeoWorkspaceSettings {
  const row = stmts().getSettings.get(workspace.id) as SettingsRow | undefined;
  if (!row) return defaultSettings(workspace);
  const settings = rowToSettings(row);
  const derived = derivePosture(workspace);
  return {
    ...settings,
    suggestedPosture: derived.suggestedPosture,
    suggestionReasons: settings.postureSource === LOCAL_SEO_POSTURE_SOURCE.ADMIN_OVERRIDE ? settings.suggestionReasons : derived.suggestionReasons,
  };
}

function writeSettings(settings: LocalSeoWorkspaceSettings): void {
  stmts().upsertSettings.run({
    workspace_id: settings.workspaceId,
    posture: settings.posture,
    posture_source: settings.postureSource,
    suggested_posture: settings.suggestedPosture ?? null,
    suggestion_reasons: JSON.stringify(settings.suggestionReasons),
    updated_at: settings.updatedAt,
    keywords_per_refresh: settings.keywordsPerRefresh,
  });
}

export function listLocalSeoMarkets(workspaceId: string): LocalSeoMarket[] {
  return (stmts().listMarkets.all(workspaceId) as MarketRow[]).map(rowToMarket);
}

export function getPrimaryMarketLocationCode(
  workspaceId: string,
): { locationCode: number; label: string } | null {
  const market = stmts().getPrimaryMarket.get({ workspaceId }) as MarketRow | undefined;
  if (!market || market.provider_location_code === null || market.provider_location_code === undefined) {
    return null;
  }
  const label = market.state_or_region
    ? `${market.city}, ${market.state_or_region}`
    : `${market.city}, ${market.country}`;
  return { locationCode: market.provider_location_code, label };
}

export function resolveWorkspaceLocationCode(workspaceId: string): number | null {
  return getPrimaryMarketLocationCode(workspaceId)?.locationCode ?? null;
}

/**
 * Resolve the provider query language for a workspace's primary market.
 *
 * The `local_seo_markets` table has no language column — language lives on
 * `local_visibility_snapshots` — so this returns the language the primary market
 * was most recently queried in, falling back to `DEFAULT_LANGUAGE_CODE` ('en')
 * when the workspace has no primary-market snapshot yet. Pool-path provider calls
 * thread this so non-English markets are not queried in English (P1 / G13).
 */
export function resolveWorkspaceLanguageCode(workspaceId: string): string {
  const row = stmts().getPrimaryMarketLanguage.get({ workspaceId }) as { language_code?: string } | undefined;
  const lang = row?.language_code?.trim().toLowerCase();
  return lang || DEFAULT_LANGUAGE_CODE;
}

/** DataForSEO location_code for the United States — the last-resort geo fallback. */
const US_LOCATION_CODE = 2840;

const US_LOCATION_NAME = 'United States';

export interface ResolvedWorkspaceTargetGeo {
  locationCode: number;
  languageCode: string;
  /** DataForSEO `location_name` where an endpoint requires a name instead of a code. */
  locationName: string;
}

function normalizeTargetGeoLabel(label: string | undefined): string | undefined {
  const clean = label?.split('·')[0]?.trim();
  if (!clean || /^Location\s+\d+$/i.test(clean)) return undefined;
  return clean;
}

function resolveLocationName(locationCode: number, label: string | undefined): string {
  return normalizeTargetGeoLabel(label) ?? TARGET_GEO_LOCATION_NAMES_BY_CODE[locationCode] ?? US_LOCATION_NAME;
}

/**
 * Resolve the SERP target geo {locationCode, languageCode, locationName} for a workspace's provider
 * domain/keyword queries (SEO Decision Engine P4). Priority:
 *   1. workspace.targetGeo — admin-set national/international target, decoupled from the
 *      local primary-market table (carries its OWN co-resolved languageCode).
 *   2. local primary-market location_code + its most-recent snapshot language.
 *   3. US / 'en' (2840) last-resort fallback.
 * locationCode ALWAYS resolves to a number. Callers thread this ONLY when the
 * geo-targeting flag is ON; when OFF they pass nothing → the provider's
 * locationCodeFromDatabase(database)/'en' defaults apply (byte-identical to pre-P4).
 */
export function resolveWorkspaceTargetGeo(workspaceId: string): ResolvedWorkspaceTargetGeo {
  const ws = getWorkspace(workspaceId);
  if (ws?.targetGeo) {
    return {
      locationCode: ws.targetGeo.locationCode,
      languageCode: ws.targetGeo.languageCode,
      locationName: resolveLocationName(ws.targetGeo.locationCode, ws.targetGeo.label),
    };
  }
  const localLocation = getPrimaryMarketLocationCode(workspaceId);
  if (localLocation) {
    return {
      locationCode: localLocation.locationCode,
      languageCode: resolveWorkspaceLanguageCode(workspaceId),
      locationName: resolveLocationName(localLocation.locationCode, localLocation.label),
    };
  }
  return { locationCode: US_LOCATION_CODE, languageCode: DEFAULT_LANGUAGE_CODE, locationName: US_LOCATION_NAME };
}

export function setPrimaryMarket(workspaceId: string, marketId: string): void {
  db.transaction(() => {
    stmts().clearPrimary.run({ workspaceId });
    const result = stmts().setMarketPrimary.run({ workspaceId, marketId });
    if (result.changes === 0) {
      const existing = stmts().getMarket.get(marketId, workspaceId) as MarketRow | undefined;
      if (existing) throw new Error('Primary market requires an active market with a provider location code');
      throw new Error('Local SEO market not found');
    }
  })();

  addActivity(
    workspaceId,
    'local_seo_updated',
    'Primary market updated',
    'Set primary market for keyword volume geo-targeting',
    { source: 'local_seo' },
  );
  notifyLocalSeoUpdated(workspaceId, {
    action: 'primary_market_updated',
    updatedAt: new Date().toISOString(),
  });
}

function activeMarkets(workspaceId: string, marketIds?: string[]): LocalSeoMarket[] {
  const idSet = marketIds?.length ? new Set(marketIds) : null;
  return listLocalSeoMarkets(workspaceId)
    .filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE)
    .filter(market => !idSet || idSet.has(market.id))
    .filter(hasProviderLocationIdentity)
    .slice(0, LOCAL_SEO_MAX_MARKETS);
}

function buildSuggestedMarkets(workspace: Workspace): LocalSeoMarket[] {
  const address = workspace.businessProfile?.address;
  if (!address?.city || !address.country) return [];
  const now = new Date().toISOString();
  const state = address.state?.trim();
  const providerLocationName = buildDataForSeoLocationName({
    city: address.city,
    stateOrRegion: state,
    country: address.country,
  });
  const label = [address.city, state].filter(Boolean).join(', ') || address.city;
  return [{
    id: 'business-profile-primary-market',
    workspaceId: workspace.id,
    label,
    city: address.city,
    stateOrRegion: state,
    country: address.country,
    providerLocationName,
    source: LOCAL_SEO_MARKET_SOURCE.BUSINESS_PROFILE,
    status: LOCAL_SEO_MARKET_STATUS.NEEDS_REVIEW,
    createdAt: now,
    updatedAt: now,
  }];
}

export function getLocalSeoReadModel(
  workspaceId: string,
  featureEnabled: boolean,
  options: { includeSnapshots?: boolean } = {},
): LocalSeoReadResponse | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  if (!featureEnabled) {
    const settings = disabledSettings(workspace);
    return {
      featureEnabled: false,
      settings,
      markets: [],
      suggestedMarkets: [],
      latestSnapshots: [],
      report: buildLocalSeoReportSummary({
        featureEnabled: false,
        settings,
        markets: [],
        suggestedMarkets: [],
        latestSnapshots: [],
      }),
      competitorBrands: [],
      serviceGaps: [],
      visibilityTrend: [],
      caps: {
        maxMarkets: LOCAL_SEO_MAX_MARKETS,
        maxKeywordsPerRefresh: LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
        keywordsPerRefreshMin: LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
        keywordsPerRefreshMax: LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP,
        keywordsPerRefreshDefault: LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
      },
    };
  }
  const settings = readSettings(workspace);
  const markets = listLocalSeoMarkets(workspace.id);
  const suggestedMarkets = buildSuggestedMarkets(workspace);
  const latestSnapshots = listLatestLocalVisibilitySnapshots(workspace.id);
  const latestUsableSnapshots = latestSnapshots.filter(isUsableLocalVisibilitySnapshot);
  const responseSnapshots = options.includeSnapshots === false ? [] : latestSnapshots;
  return {
    featureEnabled,
    settings,
    markets,
    suggestedMarkets,
    latestSnapshots: responseSnapshots,
    report: buildLocalSeoReportSummary({
      featureEnabled,
      settings,
      markets,
      suggestedMarkets,
      latestSnapshots: latestUsableSnapshots,
    }),
    competitorBrands: getLocalSeoCompetitorBrands(workspaceId),
    serviceGaps: featureEnabled ? getLocalSeoServiceGaps(workspaceId) : [],
    visibilityTrend: getLocalSeoVisibilityTrend(workspace.id),
    caps: {
      maxMarkets: LOCAL_SEO_MAX_MARKETS,
      maxKeywordsPerRefresh: settings.keywordsPerRefresh ?? LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
      keywordsPerRefreshMin: LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
      keywordsPerRefreshMax: LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP,
      keywordsPerRefreshDefault: LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
    },
  };
}

function disabledSettings(workspace: Workspace): LocalSeoWorkspaceSettings {
  return {
    workspaceId: workspace.id,
    posture: LOCAL_SEO_POSTURE.UNKNOWN,
    postureSource: LOCAL_SEO_POSTURE_SOURCE.UNKNOWN,
    suggestionReasons: [],
    updatedAt: new Date().toISOString(),
    keywordsPerRefresh: null,
  };
}

function hasProviderLocationIdentity(market: {
  city?: string | null;
  stateOrRegion?: string | null;
  country?: string | null;
  providerLocationCode?: number | null;
  providerLocationName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): boolean {
  return Boolean(
    market.providerLocationCode
    || market.providerLocationName?.trim()
    || buildDataForSeoLocationName(market)
    || (typeof market.latitude === 'number' && typeof market.longitude === 'number')
  );
}

function resolveProviderLocationName(market: {
  city?: string | null;
  stateOrRegion?: string | null;
  country?: string | null;
  providerLocationName?: string | null;
}): string | null {
  return market.providerLocationName?.trim() || buildDataForSeoLocationName(market) || null;
}

export function updateLocalSeoConfiguration(workspaceId: string, request: LocalSeoMarketUpdateRequest, featureEnabled: boolean): LocalSeoReadResponse | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const now = new Date().toISOString();
  const current = readSettings(workspace);
  const posture = request.posture ?? current.posture;
  const derived = derivePosture(workspace);

  // Resolve next keywordsPerRefresh:
  //   - undefined → unchanged
  //   - null     → clear override (revert to global default)
  //   - number   → clamp into [min, max] then store
  const nextKeywordsPerRefresh: number | null = request.keywordsPerRefresh === undefined
    ? current.keywordsPerRefresh
    : request.keywordsPerRefresh === null
      ? null
      : Math.max(
          LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
          Math.min(LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP, Math.trunc(request.keywordsPerRefresh)),
        );

  // Set inside the transaction when an orphaned primary is auto-promoted to a
  // successor; surfaced in the activity detail after the transaction commits.
  let promotedPrimaryLabel: string | null = null;

  const run = db.transaction(() => {
    writeSettings({
      ...current,
      posture,
      postureSource: request.posture ? LOCAL_SEO_POSTURE_SOURCE.ADMIN_OVERRIDE : current.postureSource,
      suggestedPosture: derived.suggestedPosture,
      suggestionReasons: request.posture ? [`Admin set local SEO posture to ${posture}`] : derived.suggestionReasons,
      updatedAt: now,
      keywordsPerRefresh: nextKeywordsPerRefresh,
    });

    if (request.markets) {
      const existingMarkets = listLocalSeoMarkets(workspace.id);
      const nextStatuses = new Map(existingMarkets.map(market => [market.id, market.status]));
      let newMarketCounter = 0;
      for (const market of request.markets) {
        if (market.id) {
          const existing = stmts().getMarket.get(market.id, workspace.id) as MarketRow | undefined;
          if (!existing) throw new Error('Local SEO market not found');
          const existingMarket = rowToMarket(existing);
          const nextStatus = market.status ?? existingMarket.status;
          const nextProviderIdentity = {
            providerLocationCode: market.providerLocationCode !== undefined ? market.providerLocationCode : existingMarket.providerLocationCode,
            providerLocationName: market.providerLocationName !== undefined
              ? resolveProviderLocationName(market)
              : existingMarket.providerLocationName,
            latitude: market.latitude !== undefined ? market.latitude : existingMarket.latitude,
            longitude: market.longitude !== undefined ? market.longitude : existingMarket.longitude,
            city: market.city ?? existingMarket.city,
            stateOrRegion: market.stateOrRegion !== undefined ? market.stateOrRegion : existingMarket.stateOrRegion,
            country: market.country ?? existingMarket.country,
          };
          if (nextStatus === LOCAL_SEO_MARKET_STATUS.ACTIVE && !hasProviderLocationIdentity({
            city: nextProviderIdentity.city,
            stateOrRegion: nextProviderIdentity.stateOrRegion,
            country: nextProviderIdentity.country,
            providerLocationCode: nextProviderIdentity.providerLocationCode,
            providerLocationName: nextProviderIdentity.providerLocationName,
            latitude: nextProviderIdentity.latitude,
            longitude: nextProviderIdentity.longitude,
          })) {
            throw new Error('Active local SEO markets require a provider location code, provider location name, or coordinates');
          }
          nextStatuses.set(market.id, nextStatus);
        } else {
          const nextStatus = market.status ?? LOCAL_SEO_MARKET_STATUS.ACTIVE;
          if (nextStatus === LOCAL_SEO_MARKET_STATUS.ACTIVE && !hasProviderLocationIdentity(market)) {
            throw new Error('Active local SEO markets require a provider location code, provider location name, or coordinates');
          }
          nextStatuses.set(`__new_${newMarketCounter++}`, nextStatus);
        }
      }
      const activeCount = [...nextStatuses.values()].filter(status => status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length;
      if (activeCount > LOCAL_SEO_MAX_MARKETS) throw new Error(`At most ${LOCAL_SEO_MAX_MARKETS} active local SEO markets are allowed in v1`);
      for (const market of request.markets) {
        const id = market.id ?? randomUUID();
        const existing = stmts().getMarket.get(id, workspace.id) as MarketRow | undefined;
        const existingMarket = existing ? rowToMarket(existing) : undefined;
        stmts().upsertMarket.run({
          id,
          workspace_id: workspace.id,
          label: market.label.trim(),
          city: market.city.trim(),
          state_or_region: market.stateOrRegion !== undefined ? market.stateOrRegion.trim() || null : existingMarket?.stateOrRegion ?? null,
          country: market.country.trim(),
          latitude: market.latitude !== undefined ? market.latitude : existingMarket?.latitude ?? null,
          longitude: market.longitude !== undefined ? market.longitude : existingMarket?.longitude ?? null,
          provider_location_code: market.providerLocationCode !== undefined ? market.providerLocationCode : existingMarket?.providerLocationCode ?? null,
          provider_location_name: market.providerLocationName !== undefined
            ? resolveProviderLocationName(market)
            : existingMarket?.providerLocationName ?? resolveProviderLocationName(market),
          source: LOCAL_SEO_MARKET_SOURCE.ADMIN_OVERRIDE,
          status: market.status ?? existingMarket?.status ?? LOCAL_SEO_MARKET_STATUS.ACTIVE,
          created_at: existing?.created_at ?? now,
          updated_at: now,
          is_primary: 0,
        });
      }

      // Orphaned-primary recovery: deactivating the primary market (or any update
      // that leaves no eligible primary) would otherwise silently degrade every
      // downstream `is_primary = 1` read (keyword geo-targeting, language resolution).
      // If no eligible primary remains but at least one active+code-bearing market
      // exists, promote the first one (deterministic created_at/id order).
      const eligiblePrimaryCount = (stmts().countEligiblePrimary.get(workspace.id) as { count: number }).count;
      if (eligiblePrimaryCount === 0) {
        const successor = stmts().firstEligibleActiveMarket.get(workspace.id) as MarketRow | undefined;
        if (successor) {
          stmts().clearPrimary.run({ workspaceId: workspace.id });
          stmts().setMarketPrimary.run({ workspaceId: workspace.id, marketId: successor.id });
          promotedPrimaryLabel = successor.label;
        }
      }
    }
  });
  run();

  const activityDetail = promotedPrimaryLabel
    ? `Updated local SEO posture or market setup — auto-promoted "${promotedPrimaryLabel}" to primary market`
    : 'Updated local SEO posture or market setup';
  addActivity(workspace.id, 'local_seo_updated', 'Local SEO configuration updated', activityDetail, { source: 'local_seo', ...(promotedPrimaryLabel ? { promotedPrimaryLabel } : {}) });
  notifyLocalSeoUpdated(workspace.id, { action: 'configuration_updated', updatedAt: now });
  return getLocalSeoReadModel(workspace.id, featureEnabled);
}

interface VisibilityTrendRow {
  market_id: string;
  market_label: string;
  day: string;
  visible_count: number;
  checked_count: number;
}

/**
 * W5.3 — per-market visible-count trend over the retained snapshot window.
 *
 * Cheap aggregate read (single GROUP BY over local_visibility_snapshots) — does NOT
 * invoke any provider or full-model builder. Returns one series per market that has any
 * usable snapshot, each a chronological list of (date, visibleCount, checkedCount) points
 * over the D4-thinned window. Markets are ordered by most-recent activity (last point
 * date DESC) so the busiest market renders first.
 */
export function getLocalSeoVisibilityTrend(workspaceId: string): LocalSeoVisibilityTrendSeries[] {
  const rows = stmts().visibilityTrend.all(
    LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED,
    workspaceId,
    LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
    LOCAL_VISIBILITY_STATUS.DEGRADED,
  ) as VisibilityTrendRow[];

  const byMarket = new Map<string, LocalSeoVisibilityTrendSeries>();
  for (const row of rows) {
    let series = byMarket.get(row.market_id);
    if (!series) {
      series = { marketId: row.market_id, marketLabel: row.market_label, points: [] };
      byMarket.set(row.market_id, series);
    }
    const point: LocalSeoVisibilityTrendPoint = {
      date: row.day,
      visibleCount: row.visible_count,
      checkedCount: row.checked_count,
    };
    series.points.push(point);
  }

  return [...byMarket.values()].sort((a, b) => {
    const aLast = a.points[a.points.length - 1]?.date ?? '';
    const bLast = b.points[b.points.length - 1]?.date ?? '';
    return bLast.localeCompare(aLast);
  });
}

export function listLatestLocalVisibilitySnapshots(workspaceId: string): LocalVisibilitySnapshot[] {
  // Bug 1 + tiebreaker fix: query takes (workspaceId × 3) — outer WHERE, the
  // MIN(id) subquery WHERE, and the innermost MAX(captured_at) subquery WHERE.
  const rows = stmts().latestSnapshots.all(workspaceId, workspaceId, workspaceId) as SnapshotRow[];
  return rows.map(rowToSnapshot);
}

function listLatestLocalVisibilitySnapshotsForKeyword(workspaceId: string, normalizedKeyword: string): LocalVisibilitySnapshot[] {
  // Bug 1 + tiebreaker fix: query takes (workspaceId, normalizedKeyword) × 3 — outer
  // WHERE, the MIN(id) subquery WHERE, and the innermost MAX(captured_at) subquery WHERE.
  const rows = stmts().latestSnapshotsByKeyword.all(
    workspaceId, normalizedKeyword,
    workspaceId, normalizedKeyword,
    workspaceId, normalizedKeyword,
  ) as SnapshotRow[];
  return rows.map(rowToSnapshot);
}

function listLatestLocalVisibilitySnapshotSummaryRows(workspaceId: string): SnapshotSummaryRow[] {
  return stmts().latestSnapshotSummary.all(
    workspaceId,
    LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
    workspaceId,
    LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
  ) as SnapshotSummaryRow[];
}

interface CompetitorSnapshotRow {
  workspace_id: string;
  business_found: number;
  local_pack_present: number;
  market_label: string;
  top_competitors: string;
}

export function getLocalSeoCompetitorBrands(workspaceId: string, lookbackDays = 30): LocalSeoRepeatCompetitor[] {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return [];
  const rows = stmts().competitorSnapshots.all({ workspaceId, days: lookbackDays }) as CompetitorSnapshotRow[];

  const TOP_LIMIT = 10;
  const MIN_APPEARANCES = 2;

  interface Accumulator {
    domain: string | undefined;
    totalAppearances: number;
    winsAgainstClient: number;
    markets: Set<string>;
  }
  const map = new Map<string, Accumulator>();
  // Collect the original (un-lowercased) title for display — use first seen title
  const titleMap = new Map<string, string>();

  for (const row of rows) {
    const clientLost = row.business_found === 0 && row.local_pack_present === 1;
    const competitors = parseJsonSafeArray(row.top_competitors, localResultSchema, { workspaceId, table: 'local_visibility_snapshots', field: 'top_competitors' });
    for (const competitor of competitors) {
      const key = competitor.title.toLowerCase().trim();
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.totalAppearances += 1;
        if (clientLost) existing.winsAgainstClient += 1;
        existing.markets.add(row.market_label);
        if (!existing.domain && competitor.domain) existing.domain = competitor.domain;
      } else {
        map.set(key, {
          domain: competitor.domain,
          totalAppearances: 1,
          winsAgainstClient: clientLost ? 1 : 0,
          markets: new Set([row.market_label]),
        });
        titleMap.set(key, competitor.title);
      }
    }
  }

  const activeMarketCity = listLocalSeoMarkets(workspaceId)
    .find(m => m.status === LOCAL_SEO_MARKET_STATUS.ACTIVE)?.city;

  const results: LocalSeoRepeatCompetitor[] = [];
  for (const [key, acc] of map.entries()) {
    if (acc.totalAppearances < MIN_APPEARANCES) continue;
    const title = titleMap.get(key) ?? key;
    const suggestedTrackingKeywords: string[] = [
      `${title} reviews`,
    ];
    if (workspace.name.trim()) {
      suggestedTrackingKeywords.push(`${title} vs ${workspace.name.trim()}`);
    }
    if (activeMarketCity) suggestedTrackingKeywords.push(`${title} ${activeMarketCity}`);
    results.push({
      title,
      domain: acc.domain,
      totalAppearances: acc.totalAppearances,
      winsAgainstClient: acc.winsAgainstClient,
      markets: Array.from(acc.markets),
      suggestedTrackingKeywords,
    });
  }

  results.sort((a, b) =>
    b.winsAgainstClient - a.winsAgainstClient
    || b.totalAppearances - a.totalAppearances,
  );

  return results.slice(0, TOP_LIMIT);
}

/**
 * Returns services from the workspace's industry taxonomy that have no active
 * tracking keyword mentioning them. Used to nudge admins in the setup drawer.
 */
export function getLocalSeoServiceGaps(workspaceId: string): LocalSeoServiceGap[] {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return [];
  const taxonomy = getTaxonomyForIndustry(workspace.intelligenceProfile?.industry);
  if (!taxonomy) return [];
  const tracked = getTrackedKeywords(workspaceId); // active only (default)
  const activeQueries = tracked.map(k => k.query.toLowerCase());
  return taxonomy
    .filter(service =>
      !service.matchTerms.some(term => activeQueries.some(q => q.includes(term)))
    )
    .map(service => ({
      serviceId: service.id,
      serviceLabel: service.label,
      starterKeywords: service.starterKeywords,
    }));
}

function postureFromSummaryRow(row: SnapshotSummaryRow) {
  if (row.status === LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED || row.status === LOCAL_VISIBILITY_STATUS.DEGRADED) {
    return LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED;
  }
  if (row.business_found === 1 && row.business_match_confidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED) {
    return LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE;
  }
  if (
    row.business_found === 1
    && (
      row.business_match_confidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH
      || row.business_match_confidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH
    )
  ) {
    return LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH;
  }
  if (row.local_pack_present === 1) return LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT;
  return LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE;
}

function visibilityFromSummaryRow(row: SnapshotSummaryRow): LocalSeoKeywordVisibility {
  const posture = postureFromSummaryRow(row);
  const businessMatchConfidence = isBusinessMatchConfidence(row.business_match_confidence)
    ? row.business_match_confidence
    : LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN;
  const sourceEndpoint = isLocalVisibilitySourceEndpoint(row.source_endpoint)
    ? row.source_endpoint
    : LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP;
  const base = {
    keyword: row.keyword,
    normalizedKeyword: row.normalized_keyword,
    marketId: row.market_id,
    marketLabel: row.market_label,
    capturedAt: row.captured_at,
    localPackPresent: row.local_pack_present === 1,
    businessFound: row.business_found === 1,
    businessMatchConfidence,
    localRank: row.local_rank ?? undefined,
    sourceEndpoint,
    provider: row.provider,
    degradedReason: row.degraded_reason ?? undefined,
  };

  if (posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE) {
    return {
      ...base,
      posture,
      label: row.local_rank ? `Visible #${row.local_rank}` : 'Visible locally',
      detail: row.business_match_reason ?? 'Business appears in local results with verified match evidence.',
    };
  }
  if (posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH) {
    return {
      ...base,
      posture,
      label: row.local_rank ? `Possible match #${row.local_rank}` : 'Possible match',
      detail: row.business_match_reason ?? 'Possible business match; review before treating this as verified local visibility.',
    };
  }
  if (posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED) {
    return {
      ...base,
      posture,
      label: 'Provider degraded',
      detail: row.degraded_reason ?? 'Local visibility data could not be refreshed cleanly.',
    };
  }
  if (posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT) {
    return {
      ...base,
      posture,
      label: 'Local pack present',
      detail: row.business_match_reason ?? 'A local pack appeared, but this business was not confidently matched.',
    };
  }
  return {
    ...base,
    posture,
    label: 'Not found locally',
    detail: row.business_match_reason ?? 'No likely business match found in local results for this market.',
  };
}

export function buildLocalSeoKeywordVisibilitySummaryByKey(workspaceId: string): Map<string, LocalSeoKeywordVisibilitySummary> {
  const grouped = new Map<string, LocalSeoKeywordVisibility[]>();
  for (const row of listLatestLocalVisibilitySnapshotSummaryRows(workspaceId)) {
    if (!row.normalized_keyword) continue;
    const current = grouped.get(row.normalized_keyword) ?? [];
    current.push(visibilityFromSummaryRow(row));
    grouped.set(row.normalized_keyword, current);
  }
  const summaries = new Map<string, LocalSeoKeywordVisibilitySummary>();
  for (const [key, visibility] of grouped) {
    const summary = summarizeLocalSeoKeywordVisibility(visibility);
    if (summary) summaries.set(key, summary);
  }
  return summaries;
}

export function buildLocalSeoKeywordVisibilityByKey(workspaceId: string): Map<string, LocalSeoKeywordVisibilitySummary> {
  const grouped = new Map<string, LocalSeoKeywordVisibility[]>();
  for (const snapshot of listLatestLocalVisibilitySnapshots(workspaceId)) {
    if (!isUsableLocalVisibilitySnapshot(snapshot)) continue;
    if (!snapshot.normalizedKeyword) continue;
    const current = grouped.get(snapshot.normalizedKeyword) ?? [];
    current.push(localSeoKeywordVisibilityFromSnapshot(snapshot));
    grouped.set(snapshot.normalizedKeyword, current);
  }
  const summaries = new Map<string, LocalSeoKeywordVisibilitySummary>();
  for (const [key, visibility] of grouped) {
    const summary = summarizeLocalSeoKeywordVisibility(visibility);
    if (summary) summaries.set(key, summary);
  }
  return summaries;
}

export function buildLocalSeoKeywordVisibilityForKeyword(
  workspaceId: string,
  normalizedKeyword: string,
): LocalSeoKeywordVisibilitySummary | undefined {
  return localSeoKeywordVisibilitySummaryFromSnapshots(
    listLatestLocalVisibilitySnapshotsForKeyword(workspaceId, normalizedKeyword),
  );
}

function buildLocalSeoReportSummary(input: {
  featureEnabled: boolean;
  settings: LocalSeoWorkspaceSettings;
  markets: LocalSeoMarket[];
  suggestedMarkets: LocalSeoMarket[];
  latestSnapshots: LocalVisibilitySnapshot[];
}): LocalSeoReportSummary {
  const activeMarketCount = input.markets.filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length;
  const latestByMarketKeyword = buildMarketKeywordVisibilityFromSnapshots(input.latestSnapshots);
  const visibility = [...latestByMarketKeyword.values()];
  const visibleCount = visibility.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE).length;
  const possibleMatchCount = visibility.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH).length;
  const notVisibleCount = visibility.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE || item.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT).length;
  const degradedCount = visibility.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED).length;
  const lastCapturedAt = input.latestSnapshots
    .map(snapshot => snapshot.capturedAt)
    .sort()
    .at(-1);

  let setupState: LocalSeoReportSummary['setupState'] = 'has_data';
  let setupLabel = 'Local visibility reporting is active';
  let setupDetail = 'Market-specific local-pack visibility is available for reviewed local-intent keywords.';
  if (!input.featureEnabled) {
    setupState = 'feature_disabled';
    setupLabel = 'Local SEO visibility is not enabled';
    setupDetail = 'The reporting layer is dark-launched behind the local SEO visibility feature flag.';
  } else if (input.settings.posture === LOCAL_SEO_POSTURE.NON_LOCAL) {
    setupState = 'non_local';
    setupLabel = 'Workspace marked non-local';
    setupDetail = 'Local-pack visibility is hidden because this workspace is not currently managed as a local SEO account.';
  } else if (activeMarketCount === 0) {
    setupState = 'needs_market';
    setupLabel = 'Market setup needed';
    setupDetail = 'Configure at least one reviewed local market before refreshing local visibility.';
  } else if (input.latestSnapshots.length === 0) {
    setupState = 'ready_no_data';
    setupLabel = 'Ready for first refresh';
    setupDetail = 'Markets are configured. Run a local visibility refresh to collect local-pack evidence.';
  }

  return {
    workspacePosture: input.settings.posture,
    suggestedPosture: input.settings.suggestedPosture,
    activeMarketCount,
    configuredMarketCount: input.markets.length,
    suggestedMarketCount: input.suggestedMarkets.length,
    latestSnapshotCount: input.latestSnapshots.length,
    checkedKeywordCount: latestByMarketKeyword.size,
    visibleCount,
    possibleMatchCount,
    notVisibleCount,
    localPackPresentCount: visibility.filter(item => item.localPackPresent).length,
    degradedCount,
    lastCapturedAt,
    setupState,
    setupLabel,
    setupDetail,
  };
}

function buildMarketKeywordVisibilityFromSnapshots(snapshots: LocalVisibilitySnapshot[]): Map<string, LocalSeoKeywordVisibility> {
  return buildLocalSeoVisibilityMap(
    snapshots,
    snapshot => `${snapshot.marketId}:${snapshot.normalizedKeyword}`,
  );
}

function buildLocalSeoVisibilityMap(
  snapshots: LocalVisibilitySnapshot[],
  keyForSnapshot: (snapshot: LocalVisibilitySnapshot) => string,
): Map<string, LocalSeoKeywordVisibility> {
  const map = new Map<string, LocalSeoKeywordVisibility>();
  for (const snapshot of snapshots) {
    const key = keyForSnapshot(snapshot);
    if (!snapshot.normalizedKeyword || map.has(key)) continue;
    map.set(key, localSeoKeywordVisibilityFromSnapshot(snapshot));
  }
  return map;
}

function snapshotFromProviderResult(
  workspaceId: string,
  locations: ClientLocation[],
  market: LocalSeoMarket,
  providerResult: LocalVisibilityProviderResult,
  device: LocalSeoDevice,
  languageCode: string,
): LocalVisibilitySnapshot {
  const match = evaluateLocalBusinessMatch(locations, providerResult.results);
  const isSuccess = providerResult.status === LOCAL_VISIBILITY_STATUS.SUCCESS;
  return {
    id: randomUUID(),
    workspaceId,
    keyword: providerResult.keyword,
    normalizedKeyword: keywordComparisonKey(providerResult.keyword),
    marketId: market.id,
    marketLabel: market.label,
    capturedAt: providerResult.capturedAt,
    localPackPresent: providerResult.localPackPresent,
    businessFound: isSuccess && match.found,
    businessMatchConfidence: isSuccess ? match.confidence : LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN,
    businessMatchReason: isSuccess ? match.reason : providerResult.degradedReason,
    localRank: isSuccess ? match.rank : undefined,
    topCompetitors: scrubOwnedLocalResults(providerResult.results, locations),
    sourceEndpoint: providerResult.sourceEndpoint,
    provider: providerResult.provider,
    device,
    languageCode,
    status: providerResult.status,
    degradedReason: providerResult.degradedReason,
    matchedLocationId: isSuccess ? match.matchedLocationId : undefined,
    matchedLocationName: isSuccess ? match.matchedLocationName : undefined,
  };
}

function storeSnapshot(snapshot: LocalVisibilitySnapshot, rawResults: LocalVisibilityBusinessResult[] = snapshot.topCompetitors): void {
  stmts().insertSnapshot.run({
    id: snapshot.id,
    workspace_id: snapshot.workspaceId,
    keyword: snapshot.keyword,
    normalized_keyword: snapshot.normalizedKeyword,
    market_id: snapshot.marketId,
    market_label: snapshot.marketLabel,
    captured_at: snapshot.capturedAt,
    local_pack_present: snapshot.localPackPresent ? 1 : 0,
    business_found: snapshot.businessFound ? 1 : 0,
    business_match_confidence: snapshot.businessMatchConfidence,
    business_match_reason: snapshot.businessMatchReason ?? null,
    local_rank: snapshot.localRank ?? null,
    top_competitors: JSON.stringify(snapshot.topCompetitors),
    source_endpoint: snapshot.sourceEndpoint,
    provider: snapshot.provider,
    device: snapshot.device,
    language_code: snapshot.languageCode,
    status: snapshot.status,
    degraded_reason: snapshot.degradedReason ?? null,
    matched_location_id: snapshot.matchedLocationId ?? null,
    matched_location_name: snapshot.matchedLocationName ?? null,
    raw_results: JSON.stringify(rawResults.slice(0, LOCAL_SEO_MAX_RESULTS)),
  });
}

/**
 * Returns true if the keyword has local intent for this workspace.
 *
 * `precomputedServiceTermRegex` should be provided when called from the hot
 * candidate loop (where it is precomputed once per build cycle via
 * `loadCandidateIterationContext`). When omitted, it is derived on demand —
 * acceptable for cold paths but costs a DB read (markets lookup).
 */
function hasLocalIntent(
  keyword: string,
  workspace: Workspace,
  precomputedServiceTermRegex?: RegExp,
): boolean {
  const normalized = normalizeText(keyword);
  const address = workspace.businessProfile?.address;
  const city = normalizeText(address?.city);
  const state = normalizeText(address?.state);
  if (/\bnear me\b|\blocal\b|\bdowntown\b|\bmidtown\b|\bheights\b|\bservice area\b/.test(normalized)) return true;
  if (city && normalized.includes(city)) return true;
  if (state && normalized.includes(state)) return true;
  // Service-term check: use per-workspace derived terms rather than hardcoded
  // dental/legal vocabulary that only applies to the original workspace.
  const serviceTermRegex = precomputedServiceTermRegex ?? buildWorkspaceServiceTermRegex(workspace);
  if (serviceTermRegex.test(normalized)) {
    return readSettings(workspace).posture !== LOCAL_SEO_POSTURE.NON_LOCAL;
  }
  return false;
}

const LOCAL_INTENT_PREFIXES = [
  'emergency', 'open now', 'best',
  'same day', 'affordable', 'cheap',
  'top rated', 'accepting new patients', '24 hour',
] as const;

const LOCAL_INTENT_PREFIX_CAP_PER_BASE = 3;

function buildCandidateContext(workspace: Workspace) {
  const contentGaps = listContentGaps(workspace.id);
  const pageMap = listPageKeywords(workspace.id);
  const declinedKeywords = getDeclinedKeywords(workspace.id);
  const requestedKeywords = getRequestedKeywords(workspace.id);
  const strategy = workspace.keywordStrategy;
  const businessTerms = [
    workspace.name,
    strategy?.businessContext,
    workspace.intelligenceProfile?.industry,
    ...(workspace.businessPriorities ?? []),
    ...(strategy?.siteKeywords ?? []),
    ...pageMap.flatMap(page => [page.pageTitle, page.primaryKeyword, ...(page.secondaryKeywords ?? [])]),
    ...contentGaps.flatMap(gap => [gap.topic, gap.targetKeyword]),
  ].filter((value): value is string => Boolean(value?.trim()));

  return {
    contentGaps,
    pageMap,
    declinedKeywords,
    requestedKeywords,
    evaluationContext: {
      workspaceId: workspace.id,
      pageMap,
      declinedKeywords,
      requestedKeywords,
      businessTerms,
      businessPhrases: [strategy?.businessContext ?? '', workspace.name].filter(Boolean),
      businessPriorities: workspace.businessPriorities ?? [],
      contentGapTopics: contentGaps.map(gap => `${gap.topic} ${gap.targetKeyword}`),
      strictBusinessFit: true,
    },
  };
}

/**
 * Shared iteration context for local SEO candidate enumeration.
 *
 * Holds the cheap data-loading surface that both the evaluated builder
 * (`buildLocalSeoKeywordCandidates`) and the cheap counter
 * (`countLocalSeoKeywordCandidates`) require. Built once per request via
 * `loadCandidateIterationContext` and consumed by `iterateLocalCandidateSignals`.
 */
export interface CandidateIterationContext {
  workspace: Workspace;
  markets: LocalSeoMarket[];
  declined: Set<string>;
  inactiveTracked: Set<string>;
  trackedKeywords: ReturnType<typeof getTrackedKeywords>;
  contentGaps: ReturnType<typeof listContentGaps>;
  pageMap: ReturnType<typeof listPageKeywords>;
  explicitKeywords: string[];
  /**
   * Populated only when `loadCandidateIterationContext` is called with
   * `{ withEvaluationContext: true }`. The cheap path leaves this undefined to
   * avoid the extra `buildKeywordEligibilityContext` work; the Evaluated path
   * requests it so `buildCandidateContext` runs once, not twice.
   */
  evaluationContext?: ReturnType<typeof buildCandidateContext>['evaluationContext'];
  /**
   * Per-workspace classifiers precomputed once by `loadCandidateIterationContext`.
   * Used by `iterateLocalCandidateSignals` to avoid re-deriving them per keyword
   * in the hot candidate loop.
   *
   * `geoTermRegex` — matches the workspace's own city/state names (from markets
   *   and business profile). Used for `pageLooksLocal` detection.
   * `serviceTermRegex` — matches the workspace's own service vocabulary (from
   *   industry taxonomy, strategy keywords, and business context text).
   *   Passed to `titleLooksLikeServiceKeyword` so it is workspace-aware.
   */
  classifiers: {
    geoTermRegex: RegExp;
    serviceTermRegex: RegExp;
  };
}

/**
 * A single source signal yielded by `iterateLocalCandidateSignals`.
 *
 * Pure enumeration — no eligibility evaluation, no scoring, no deduplication.
 * Downstream consumers (the evaluated builder, the cheap counter) apply their
 * own filters/scoring atop this stream.
 */
export interface CandidateSourceSignal {
  keyword: string | undefined;
  source: LocalSeoKeywordCandidate['source'];
  force?: boolean;
  selected?: boolean;
  sourceLabel?: string;
  detail?: string;
  pagePath?: string;
  pageTitle?: string;
  /**
   * Set only by market-scoped signal emitters (local variants and intent-modifier
   * variants). Carries the originating market's id so downstream consumers can
   * attribute the candidate to a specific market. Market-agnostic signals leave
   * this undefined — do not fabricate a market.
   */
  marketId?: string | null;
  volume?: number;
  difficulty?: number;
  scoreBoost?: number;
  intent?: LocalSeoKeywordIntent;
}

/**
 * Load the cheap data-fetch surface shared by both candidate builders.
 *
 * Returns null if the workspace cannot be found. Does not load markets-gated
 * behavior — callers decide whether an empty markets list short-circuits.
 */
export function loadCandidateIterationContext(
  workspaceId: string,
  explicitKeywords: string[] = [],
  options: { withEvaluationContext?: boolean } = {},
): CandidateIterationContext | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const markets = activeMarkets(workspaceId);
  const built = buildCandidateContext(workspace);
  const declined = new Set(built.declinedKeywords.map(keywordComparisonKey));
  const trackedKeywords = getTrackedKeywords(workspaceId, { includeInactive: true });
  const inactiveTracked = new Set(
    trackedKeywords
      .filter(tracked => (tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(tracked => keywordComparisonKey(tracked.query)),
  );
  // Precompute per-workspace classifiers once — reused per keyword in the hot loop.
  const serviceTermRegex = buildWorkspaceServiceTermRegex(workspace);
  const geoTermRegex = buildWorkspaceGeoRegex(workspace, markets)
    ?? /\bnear me\b|\/location\//i;

  return {
    workspace,
    markets,
    declined,
    inactiveTracked,
    trackedKeywords,
    contentGaps: built.contentGaps,
    pageMap: built.pageMap,
    explicitKeywords,
    evaluationContext: options.withEvaluationContext ? built.evaluationContext : undefined,
    classifiers: { geoTermRegex, serviceTermRegex },
  };
}

/**
 * Yield every source signal the workspace can produce, in the exact order
 * the existing `buildLocalSeoKeywordCandidates` walks them. Pure enumeration:
 *
 *   1. Explicit keywords (force, selected, scoreBoost=30)
 *   2. Strategy site keywords (selected, scoreBoost=12)
 *   3. Active tracked keywords (selected, scoreBoost: pinned?20:8)
 *   4. Page map: primaryKeyword, secondaryKeywords, service-keyword pageTitle,
 *      then local variants of each service-keyword base
 *   5. Content gaps: targetKeyword + local variants of targetKeyword
 *
 * No eligibility evaluation, no scoring, no deduplication — those belong to
 * the consumer.
 */
export function* iterateLocalCandidateSignals(
  ctx: CandidateIterationContext,
): Generator<CandidateSourceSignal> {
  const { workspace, markets, trackedKeywords, contentGaps, pageMap, explicitKeywords, classifiers } = ctx;
  const { geoTermRegex, serviceTermRegex } = classifiers;

  for (const keyword of explicitKeywords) {
    yield {
      keyword,
      source: 'explicit',
      force: true,
      selected: true,
      sourceLabel: 'Selected for refresh',
      scoreBoost: 30,
    };
  }

  for (const keyword of workspace.keywordStrategy?.siteKeywords ?? []) {
    yield {
      keyword,
      source: 'strategy',
      selected: true,
      sourceLabel: 'Strategy keyword',
      scoreBoost: 12,
    };
  }

  for (const tracked of trackedKeywords) {
    if ((tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) continue;
    yield {
      keyword: tracked.query,
      source: 'tracking',
      selected: true,
      sourceLabel: 'Rank tracking',
      detail: tracked.source?.replace(/_/g, ' '),
      pagePath: tracked.pagePath,
      pageTitle: tracked.pageTitle,
      volume: tracked.volume,
      difficulty: tracked.difficulty,
      scoreBoost: tracked.pinned ? 20 : 8,
    };
  }

  for (const page of pageMap) {
    // Use the workspace's own market city/state geo regex — not hardcoded Texas city names.
    const pageLooksLocal = geoTermRegex.test(`${page.pagePath} ${page.pageTitle}`)
      || /appointment/i.test(`${page.pagePath} ${page.pageTitle}`)
      || page.serpFeatures?.includes('local_pack');
    yield {
      keyword: page.primaryKeyword,
      source: 'page_assignment',
      force: pageLooksLocal,
      selected: true,
      sourceLabel: 'Page assignment',
      detail: page.pageTitle ?? page.pagePath,
      pagePath: page.pagePath,
      pageTitle: page.pageTitle,
      volume: page.volume,
      difficulty: page.difficulty,
      scoreBoost: 10,
    };
    for (const secondary of page.secondaryKeywords ?? []) {
      yield {
        keyword: secondary,
        source: 'page_assignment',
        force: pageLooksLocal,
        selected: true,
        sourceLabel: 'Page assignment',
        detail: page.pageTitle ?? page.pagePath,
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
        scoreBoost: 4,
      };
    }
    if (titleLooksLikeServiceKeyword(page.pageTitle, serviceTermRegex)) {
      yield {
        keyword: page.pageTitle,
        source: 'page_assignment',
        force: pageLooksLocal,
        selected: true,
        sourceLabel: 'Service page',
        detail: page.pagePath,
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
      };
    }
    for (const base of [page.primaryKeyword, page.pageTitle, ...(page.secondaryKeywords ?? [])]) {
      if (!base || !titleLooksLikeServiceKeyword(base, serviceTermRegex) || isNearDuplicateKeyword(base, workspace.name)) continue;
      for (const variant of localVariantKeywordsByMarket(base, markets)) {
        yield {
          keyword: variant.keyword,
          source: 'local_variant',
          sourceLabel: 'Local candidate',
          detail: page.pageTitle ?? page.pagePath,
          pagePath: page.pagePath,
          pageTitle: page.pageTitle,
          marketId: variant.marketId,
          intent: classifyLocalKeywordIntent(variant.keyword),
        };
      }
    }
    // Intent modifier variants for service-keyword bases (primary keyword only, primary market only)
    if (titleLooksLikeServiceKeyword(page.pageTitle, serviceTermRegex) && markets.length > 0) {
      const primaryBase = cleanKeywordDisplay(page.pageTitle);
      const primaryMarket = markets[0];
      if (primaryBase && primaryMarket) {
        let intentCount = 0;
        for (const prefix of LOCAL_INTENT_PREFIXES) {
          if (intentCount >= LOCAL_INTENT_PREFIX_CAP_PER_BASE) break;
          const variant = `${prefix} ${primaryBase} ${primaryMarket.city}`.toLowerCase().trim();
          const variantIntent: LocalSeoKeywordIntent =
            prefix === 'emergency' || prefix === 'same day' || prefix === 'open now' || prefix === '24 hour' || prefix === 'accepting new patients'
              ? 'transactional'
              : 'commercial';
          yield {
            keyword: variant,
            source: 'local_variant',
            sourceLabel: 'Intent candidate',
            detail: page.pageTitle ?? page.pagePath,
            pagePath: page.pagePath,
            pageTitle: page.pageTitle,
            marketId: primaryMarket.id,
            intent: variantIntent,
          };
          intentCount++;
        }
      }
    }
  }

  for (const gap of contentGaps) {
    const localGap = gap.suggestedPageType === 'location'
      || gap.serpFeatures?.includes('local_pack')
      || hasLocalIntent(`${gap.topic} ${gap.targetKeyword}`, workspace, serviceTermRegex);
    yield {
      keyword: gap.targetKeyword,
      source: 'content_gap',
      force: localGap,
      selected: false,
      sourceLabel: 'Content opportunity',
      detail: gap.topic,
      volume: gap.volume,
      difficulty: gap.difficulty,
      scoreBoost: gap.priority === 'high' ? 8 : 0,
    };
    for (const variant of localVariantKeywordsByMarket(gap.targetKeyword, markets)) {
      yield {
        keyword: variant.keyword,
        source: 'local_variant',
        sourceLabel: 'Local content candidate',
        detail: gap.topic,
        marketId: variant.marketId,
        volume: gap.volume,
        difficulty: gap.difficulty,
        intent: classifyLocalKeywordIntent(variant.keyword),
      };
    }
    // Intent modifier variants for content gap bases
    if (titleLooksLikeServiceKeyword(gap.targetKeyword, serviceTermRegex) && markets.length > 0) {
      const primaryBase = cleanKeywordDisplay(gap.targetKeyword);
      const primaryMarket = markets[0];
      if (primaryBase && primaryMarket) {
        let intentCount = 0;
        for (const prefix of LOCAL_INTENT_PREFIXES) {
          if (intentCount >= LOCAL_INTENT_PREFIX_CAP_PER_BASE) break;
          const variant = `${prefix} ${primaryBase} ${primaryMarket.city}`.toLowerCase().trim();
          const variantIntent: LocalSeoKeywordIntent =
            prefix === 'emergency' || prefix === 'same day' || prefix === 'open now' || prefix === '24 hour' || prefix === 'accepting new patients'
              ? 'transactional'
              : 'commercial';
          yield {
            keyword: variant,
            source: 'local_variant',
            sourceLabel: 'Intent candidate',
            detail: gap.topic,
            marketId: primaryMarket.id,
            volume: gap.volume,
            difficulty: gap.difficulty,
            intent: variantIntent,
          };
          intentCount++;
        }
      }
    }
  }
}

/**
 * Build a `LocalSeoKeywordCandidate` from a source signal + computed score + reasons
 * and dedup-insert into `candidates`. Shared by both the cheap and evaluated builders.
 *
 * Insert rule: only set when there's no existing entry, or the new score is higher,
 * or the new entry is selected and the existing one isn't.
 */
function upsertCandidate(
  candidates: Map<string, LocalSeoKeywordCandidate>,
  key: string,
  display: string,
  signal: CandidateSourceSignal,
  score: number,
  reasons: string[],
): void {
  const existing = candidates.get(key);
  const next: LocalSeoKeywordCandidate = {
    keyword: display,
    normalizedKeyword: key,
    source: signal.source,
    sourceLabel: signal.sourceLabel ?? signal.source.replace(/_/g, ' '),
    detail: signal.detail,
    pagePath: signal.pagePath,
    pageTitle: signal.pageTitle,
    marketId: signal.marketId,
    volume: signal.volume,
    difficulty: signal.difficulty,
    selected: signal.selected
      ?? (signal.source === 'strategy' || signal.source === 'tracking' || signal.source === 'page_assignment'),
    score,
    reasons,
    intent: signal.intent ?? classifyLocalKeywordIntent(display),
  };
  // marketId follows whichever signal wins this upsert (higher score, or selected
  // over not-selected) — it is not merged. This resolves safely only because the
  // market-agnostic sources (tracking=90 / page_assignment=85, both `selected`)
  // outscore `local_variant` (~62): a keyword reachable both ways lands on the
  // agnostic winner and ends up market-LESS, so it stays eligible to all markets
  // (the safe outcome). A future score retune that lifts `local_variant` above the
  // agnostic sources could flip this and attribute a shared keyword to one market.
  if (!existing || next.score > existing.score || (next.selected && !existing.selected)) {
    candidates.set(key, next);
  }
}

/**
 * Cheap default local SEO candidate builder.
 *
 * Skips the per-candidate `isStrategyPoolEligibleKeyword` evaluator entirely —
 * that's the work that caused the 35-second wall-clock regression on rich
 * workspaces (Swish, PR #876). Output shape is identical to the Evaluated
 * variant except:
 *   - `reasons` is always `[]` (no eligibility-evaluator messages)
 *   - `score` excludes `evaluation.scoreDelta` (no noise-pattern suppression bias)
 *   - No noise-pattern / authority-mismatch / business-fit suppression — so this
 *     can return strictly MORE candidates than the Evaluated variant. The
 *     Evaluated result is always a subset of the cheap result (modulo `reasons`
 *     + `score`).
 *
 * Always recomputes — no module-level cache. The generator is cheap enough on
 * its own, and a wall-clock TTL cache invited stale-data bugs after workspace
 * mutations and unbounded memory growth. Callers that need request-scoped
 * memoization should add it at their own layer.
 *
 * Use this for any code path that just needs candidate enumeration without
 * per-candidate noise filtering; use `buildLocalSeoKeywordCandidatesEvaluated`
 * when you specifically need the eligibility evaluator's suppression and
 * `reasons` messages.
 */
export function buildLocalSeoKeywordCandidates(
  workspaceId: string,
  explicitKeywords: string[] = [],
): LocalSeoKeywordCandidate[] {
  const ctx = loadCandidateIterationContext(workspaceId, explicitKeywords);
  if (!ctx) return [];
  const candidates = new Map<string, LocalSeoKeywordCandidate>();
  let candidateHardCapReached = false;

  for (const signal of iterateLocalCandidateSignals(ctx)) {
    const display = cleanKeywordDisplay(signal.keyword);
    if (!display) continue;
    const key = keywordComparisonKey(display);
    if (!key || ctx.declined.has(key) || ctx.inactiveTracked.has(key)) continue;
    if (candidates.size >= LOCAL_CANDIDATE_HARD_CAP && !candidates.has(key)) {
      candidateHardCapReached = true;
      continue;
    }
    if (!signal.force && !hasLocalIntent(display, ctx.workspace, ctx.classifiers.serviceTermRegex) && !hasMarketModifier(display, ctx.markets)) continue;

    const localIntentScore = hasMarketModifier(display, ctx.markets) ? 12 : hasLocalIntent(display, ctx.workspace, ctx.classifiers.serviceTermRegex) ? 8 : 0;
    const score = candidateSourceScore(signal.source) + localIntentScore + (signal.scoreBoost ?? 0);
    upsertCandidate(candidates, key, display, signal, score, []);
  }

  if (candidateHardCapReached) {
    log.warn({ workspaceId, cap: LOCAL_CANDIDATE_HARD_CAP }, 'local SEO candidate hard cap reached; output truncated');
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
}

/**
 * Slow opt-in local SEO candidate builder — preserves the original behavior of
 * `buildLocalSeoKeywordCandidates` from before the cheap/evaluated split.
 *
 * Runs `isStrategyPoolEligibleKeyword` per candidate (noise-pattern suppression,
 * authority-mismatch filter, business-fit check) and populates `reasons` with
 * the evaluator's messages. Score includes `evaluation.scoreDelta`.
 *
 * Use this only when a caller specifically needs the suppression behavior or
 * the per-candidate `reasons` messages — most paths should use the cheap
 * default. Always recomputes — no module-level cache (same rationale as cheap).
 */
export function buildLocalSeoKeywordCandidatesEvaluated(
  workspaceId: string,
  explicitKeywords: string[] = [],
): LocalSeoKeywordCandidate[] {
  const ctx = loadCandidateIterationContext(workspaceId, explicitKeywords, { withEvaluationContext: true });
  if (!ctx || !ctx.evaluationContext) return [];
  const evaluationContext = ctx.evaluationContext;
  const candidates = new Map<string, LocalSeoKeywordCandidate>();
  let candidateHardCapReached = false;

  for (const signal of iterateLocalCandidateSignals(ctx)) {
    const display = cleanKeywordDisplay(signal.keyword);
    if (!display) continue;
    const key = keywordComparisonKey(display);
    if (!key || ctx.declined.has(key) || ctx.inactiveTracked.has(key)) continue;
    if (candidates.size >= LOCAL_CANDIDATE_HARD_CAP && !candidates.has(key)) {
      candidateHardCapReached = true;
      continue;
    }
    if (!signal.force && !hasLocalIntent(display, ctx.workspace, ctx.classifiers.serviceTermRegex) && !hasMarketModifier(display, ctx.markets)) continue;

    const evaluationSource = signal.source === 'local_variant' ? 'local_generated' : signal.source === 'tracking' ? 'gsc' : 'client';
    const evaluation = isStrategyPoolEligibleKeyword({
      keyword: display,
      volume: signal.volume ?? 0,
      difficulty: signal.difficulty ?? 0,
      source: evaluationSource,
    }, evaluationContext);
    if (evaluation.suppressed) continue;

    const localIntentScore = hasMarketModifier(display, ctx.markets) ? 12 : hasLocalIntent(display, ctx.workspace, ctx.classifiers.serviceTermRegex) ? 8 : 0;
    const score = candidateSourceScore(signal.source) + localIntentScore + evaluation.scoreDelta + (signal.scoreBoost ?? 0);
    upsertCandidate(candidates, key, display, signal, score, evaluation.reasons.map(r => r.message).slice(0, 4));
  }

  if (candidateHardCapReached) {
    log.warn({ workspaceId, cap: LOCAL_CANDIDATE_HARD_CAP }, 'local SEO candidate hard cap reached; output truncated');
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
}

/**
 * Count-only local SEO candidate iteration — sub-100ms even on rich workspaces.
 *
 * Shares the iteration generator with the cheap builder. Same filters (declined,
 * inactive-tracked, market modifier, local intent) and same `LOCAL_CANDIDATE_HARD_CAP`.
 *
 * **Slight overcount possible:** without the eligibility evaluator we don't
 * suppress noise patterns / authority mismatches / business-fit failures. In
 * practice on Swish the cheap count returned within a few percent of the real
 * generator output. Used for the Local Candidates badge — UX accuracy is "this
 * is roughly how many candidates exist", not "this is precisely the displayable
 * list".
 */
export function countLocalSeoKeywordCandidates(workspaceId: string): number {
  const ctx = loadCandidateIterationContext(workspaceId, []);
  if (!ctx || ctx.markets.length === 0) return 0;
  const seen = new Set<string>();
  for (const signal of iterateLocalCandidateSignals(ctx)) {
    if (seen.size >= LOCAL_CANDIDATE_HARD_CAP) break;
    const display = cleanKeywordDisplay(signal.keyword);
    if (!display) continue;
    const key = keywordComparisonKey(display);
    if (!key || ctx.declined.has(key) || ctx.inactiveTracked.has(key)) continue;
    if (!signal.force && !hasLocalIntent(display, ctx.workspace, ctx.classifiers.serviceTermRegex) && !hasMarketModifier(display, ctx.markets)) continue;
    seen.add(key);
  }
  return seen.size;
}

function selectExplicitLocalSeoKeywords(workspaceId: string, explicitKeywords: string[] = []): string[] {
  const budget = getEffectiveKeywordsPerRefresh(workspaceId);
  const declined = new Set(getDeclinedKeywords(workspaceId).map(keywordComparisonKey));
  const inactiveTracked = new Set(
    getTrackedKeywords(workspaceId, { includeInactive: true })
      .filter(tracked => (tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(tracked => keywordComparisonKey(tracked.query)),
  );
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const keyword of explicitKeywords) {
    const display = cleanKeywordDisplay(keyword);
    const key = display ? keywordComparisonKey(display) : '';
    if (!display || !key || seen.has(key) || declined.has(key) || inactiveTracked.has(key)) continue;
    seen.add(key);
    selected.push(display);
    if (selected.length >= budget) break;
  }
  return selected;
}

export function selectLocalIntentKeywords(workspaceId: string, explicitKeywords: string[] = []): string[] {
  if (explicitKeywords.length > 0) {
    const selected = selectExplicitLocalSeoKeywords(workspaceId, explicitKeywords);
    // Apply intent filter even for explicit keywords — informational/comparison
    // queries cannot produce local pack results regardless of how they were chosen.
    return selected.filter(kw => {
      const intent = classifyLocalKeywordIntent(kw);
      return intent !== 'informational' && intent !== 'comparison';
    });
  }
  // Use the Evaluated variant here. Unlike the KCC/intelligence-slice/MCP read
  // paths (where the evaluator's `reasons` field is unused and the cheap
  // default is the right contract), `selectLocalIntentKeywords` feeds a real
  // DataForSEO call — every chosen keyword costs provider credits and adds a
  // row to local visibility snapshot history. The evaluator's noise-pattern /
  // authority-mismatch / business-fit suppression and `scoreDelta` are exactly
  // the signal-to-noise judgement we want spending that budget. The OOM
  // concern that drove the cheap default elsewhere does not apply: this
  // function runs once per scheduled refresh inside `runLocalSeoRefreshJob`
  // (a background job), not per request, and it caps the candidate set with
  // LOCAL_CANDIDATE_HARD_CAP before the evaluator even runs.
  const budget = getEffectiveKeywordsPerRefresh(workspaceId);
  const candidates = buildLocalSeoKeywordCandidatesEvaluated(workspaceId, explicitKeywords);
  // Filter out intents that can never produce local pack results (no credits spent on them)
  const filteredCandidates = candidates.filter(c => c.intent !== 'informational' && c.intent !== 'comparison');
  // Apply per-page cap to prevent any single source page from monopolizing the budget
  const capped = applySourcePageCap(filteredCandidates, budget);
  return capped.slice(0, budget).map(c => c.keyword);
}

export function createLocalSeoRefreshPlan(workspaceId: string, request: LocalSeoRefreshRequest = {}): { markets: LocalSeoMarket[]; keywords: string[]; device: LocalSeoDevice; languageCode: string } | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const markets = activeMarkets(workspaceId, request.marketIds).slice(0, LOCAL_SEO_MAX_MARKETS);
  const keywords = selectLocalIntentKeywords(workspaceId, request.keywords ?? []).slice(0, getEffectiveKeywordsPerRefresh(workspaceId));
  return {
    markets,
    keywords,
    device: request.device === LOCAL_SEO_DEVICE.MOBILE ? LOCAL_SEO_DEVICE.MOBILE : LOCAL_SEO_DEVICE.DESKTOP,
    languageCode: request.languageCode || DEFAULT_LANGUAGE_CODE,
  };
}

function resolveLocalVisibilityProvider(workspace: Workspace): SeoDataProvider | null {
  const providerName = normalizeRuntimeSeoDataProvider(workspace.seoDataProvider ?? DEFAULT_SEO_DATA_PROVIDER);
  if (isCapabilityDisabled(providerName, 'local_visibility')) return null;
  const provider = getProvider(providerName);
  if (!provider?.isConfigured()) return null;
  return provider.getLocalVisibility ? provider : null;
}

function resolveLocalLocationProvider(workspace: Workspace): SeoDataProvider | null {
  const providerName = normalizeRuntimeSeoDataProvider(workspace.seoDataProvider ?? DEFAULT_SEO_DATA_PROVIDER);
  if (isCapabilityDisabled(providerName, 'local_visibility')) return null;
  const provider = getProvider(providerName);
  if (!provider?.isConfigured()) return null;
  return provider.resolveLocalSeoLocation ? provider : null;
}

export async function resolveLocalSeoProviderLocation(
  workspaceId: string,
  request: LocalSeoLocationLookupRequest,
): Promise<LocalSeoLocationLookupResponse | null> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const provider = resolveLocalLocationProvider(workspace);
  if (!provider?.resolveLocalSeoLocation) {
    return {
      query: request,
      status: 'provider_unavailable',
      candidates: [],
      degradedReason: 'No configured local location provider is available.',
    };
  }
  return provider.resolveLocalSeoLocation(request, workspaceId);
}

export async function runLocalSeoRefreshJob(jobId: string, workspaceId: string, request: LocalSeoRefreshRequest = {}): Promise<void> {
  try {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) {
      updateJob(jobId, { status: 'error', message: 'Workspace not found', error: 'Workspace not found' });
      return;
    }
    const locations = getEffectiveLocations(workspace);
    const plan = createLocalSeoRefreshPlan(workspaceId, request);
    if (!plan || plan.markets.length === 0 || plan.keywords.length === 0) {
      updateJob(jobId, {
        status: 'done',
        progress: 100,
        total: 100,
        message: 'No local markets or local-intent keywords ready for refresh',
        result: { workspaceId, refreshed: 0, skipped: 0, failed: 0, markets: [], keywords: [] } satisfies LocalSeoRefreshResult,
      });
      return;
    }

    const provider = resolveLocalVisibilityProvider(workspace);
    if (!provider?.getLocalVisibility) {
      updateJob(jobId, { status: 'error', message: 'No configured local visibility provider', error: 'No configured local visibility provider' });
      return;
    }
    // Capture the narrowed method reference so TypeScript can see it's non-undefined
    // inside async closures where control-flow narrowing doesn't persist.
    const getLocalVisibility = provider.getLocalVisibility.bind(provider);

    // W5.3: snapshot the PREVIOUS latest-per-(market, keyword, device, language) state
    // BEFORE the crawl writes new rows, so the shift bridge can diff transitions after
    // the refresh. Captured here (not after) because storeSnapshot mutates the series.
    const previousLatestSnapshots = listLatestLocalVisibilitySnapshots(workspaceId);

    const total = plan.markets.length * plan.keywords.length;
    let processed = 0;
    let refreshed = 0;
    let failed = 0;
    let lastProgressBroadcastAt = 0;
    updateJob(jobId, { status: 'running', total, progress: 0, message: 'Refreshing local visibility...' });

  // Flatten (market × keyword) into a single work-item array, then process
  // with bounded concurrency to cut wall-clock time 3–5× vs. fully sequential.
    const workItems = plan.markets.flatMap(market =>
      plan.keywords.map(keyword => ({ market, keyword }))
    );

    for (let i = 0; i < workItems.length; i += LOCAL_SEO_REFRESH_CONCURRENCY) {
    if (getJob(jobId)?.status === 'cancelled') return;
    // Layer 4: heap-aware backpressure. If heap is above the soft threshold,
    // pause briefly so GC + concurrent KCC reads can drain before we allocate
    // another big SERP response. See LOCAL_SEO_HEAP_HEADROOM_THRESHOLD_MB.
    await waitForMemoryHeadroom();
    const chunk = workItems.slice(i, i + LOCAL_SEO_REFRESH_CONCURRENCY);
    await Promise.allSettled(chunk.map(async ({ market, keyword }) => {
      // Bail before spending provider credits if the job was cancelled.
      if (getJob(jobId)?.status === 'cancelled') return;
      try {
        const providerResult = await getLocalVisibility({
          keyword,
          market,
          device: plan.device,
          languageCode: plan.languageCode,
          maxResults: LOCAL_SEO_MAX_RESULTS,
        }, workspaceId);
        if (getJob(jobId)?.status === 'cancelled') return;
        const snapshot = snapshotFromProviderResult(workspaceId, locations, market, providerResult, plan.device, plan.languageCode);
        storeSnapshot(snapshot, providerResult.results);
        if (providerResult.status === LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED) failed++;
        else refreshed++;
      } catch (err) {
        failed++;
        log.warn({ err, workspaceId, keyword, marketId: market.id }, 'local visibility refresh item failed');
      } finally {
        if (getJob(jobId)?.status === 'cancelled') return;
        processed++;
        updateJob(jobId, {
          progress: processed,
          total,
          message: `Refreshed ${processed}/${total} local visibility checks`,
        });
      }
    }));

    // Mid-job invalidation broadcast — fires every
    // LOCAL_SEO_REFRESH_PROGRESS_BROADCAST_INTERVAL snapshots so the KCC and
    // local-seo React Query caches refresh incrementally instead of looking
    // frozen until completion. Skip when we're about to fire the final
    // `refresh_completed` broadcast (processed === total) to avoid a redundant
    // double-invalidation back-to-back.
    if (
      getJob(jobId)?.status !== 'cancelled'
      && processed < total
      && processed - lastProgressBroadcastAt >= LOCAL_SEO_REFRESH_PROGRESS_BROADCAST_INTERVAL
    ) {
      lastProgressBroadcastAt = processed;
      notifyLocalSeoUpdated(workspaceId, {
        action: 'refresh_progress',
        processed,
        total,
        updatedAt: new Date().toISOString(),
      });
    }

    // Layer 2: inter-item yield. Sleep briefly so V8 has time to GC the SERP
    // response from this chunk before the next iteration allocates a fresh one.
    // Skip when this was the last chunk — no more allocations coming.
    if (processed < total && refreshTimings.itemYieldMs > 0) await sleep(refreshTimings.itemYieldMs);
  }

    const result: LocalSeoRefreshResult = {
      workspaceId,
      refreshed,
      skipped: total - refreshed - failed,
      failed,
      markets: plan.markets.map(market => market.id),
      keywords: plan.keywords,
    };
    if (getJob(jobId)?.status === 'cancelled') return;

    if (refreshed === 0 && failed > 0) {
      const message = `Local visibility refresh failed — 0/${total} checks refreshed`;
      notifyLocalSeoUpdated(workspaceId, {
        action: 'refresh_failed',
        refreshed,
        failed,
        updatedAt: new Date().toISOString(),
      });
      updateJob(jobId, {
        status: 'error',
        progress: processed,
        total,
        message,
        error: 'All local visibility checks failed',
        result,
      });
      addActivity(
        workspaceId,
        'local_seo_updated',
        'Local SEO visibility refresh failed',
        `${failed} local visibility checks failed; no usable local evidence was refreshed`,
        { source: 'local_seo', refreshed, failed },
      );
      return;
    }

    notifyLocalSeoUpdated(workspaceId, { action: 'refresh_completed', refreshed, failed, updatedAt: new Date().toISOString() });
    addActivity(workspaceId, 'local_seo_updated', 'Local SEO visibility refreshed', `${refreshed} local visibility checks refreshed`, { source: 'local_seo', refreshed, failed });

    // W5.3: mint local_visibility_shift insights from snapshot transitions. Read the NEW
    // latest state (after the crawl wrote rows, before the retention prune — the prune
    // never removes the immortal latest row, so ordering vs. prune is immaterial) and diff
    // it against the pre-crawl state. fireBridge is fire-and-forget with its own timeout +
    // error isolation and auto-broadcasts INSIGHT_BRIDGE_UPDATED when modified > 0 — no
    // manual broadcast here (Bridge rule #3). A bridge failure never fails the refresh.
    const newLatestSnapshots = listLatestLocalVisibilitySnapshots(workspaceId);
    fireBridge('bridge-local-visibility-shift', workspaceId, () =>
      runLocalVisibilityShiftBridge(workspaceId, previousLatestSnapshots, newLatestSnapshots),
    );

    // Bug 3 / D4: retention prune after successful refresh. Wrapped in try/catch
    // so a prune failure never fails the already-successful refresh job.
    try {
      runSnapshotRetentionPrune(workspaceId);
    } catch (err) {
      log.warn({ err, workspaceId }, 'Snapshot retention prune after local SEO refresh failed (non-fatal)');
    }

  // Fresh local visibility snapshots are the spine of the local recs (B1/B2/B3). After a refresh
  // completes, regenerate recommendations so the new evidence surfaces immediately — mirroring the
  // post-scheduled-audit regen in scheduled-audits.ts. This remains posture-gated so non-local
  // workspaces avoid unnecessary local-aware recommendation churn. `generateRecommendations`
  // broadcasts + invalidates internally (Bridge rule #3 — NO manual broadcast here). Wrapped in
  // its own try/catch so a regen failure never fails the refresh job. Dynamic import avoids a
  // static recommendations.ts ↔ local-seo.ts import cycle (recommendations.ts imports the local
  // readers statically).
    const useLocalGenQual = readSettings(workspace).posture === LOCAL_SEO_POSTURE.LOCAL
      || readSettings(workspace).posture === LOCAL_SEO_POSTURE.HYBRID;
    if (useLocalGenQual) {
      try {
        await runRecommendationRegen(workspaceId, 'local_seo_refresh');
        log.info({ workspaceId }, 'Auto-regenerated recommendations after local SEO refresh');
      } catch (err) {
        log.warn({ err, workspaceId }, 'Recommendation regen after local SEO refresh failed (non-fatal)');
      }
    }

    // Optional chained keyword-strategy regen. When the admin requested
    // `thenRegenerateStrategy` AND the crawl actually produced data
    // (result.refreshed > 0 — the only success signal on the result shape), kick
    // off a strategy regen server-side so it survives a closed tab. A hard-fail
    // crawl (refreshed === 0) is NOT a usable refresh, so we abort rather than
    // regenerate a strategy on stale/empty evidence.
    //
    // The regen is its own tracked KEYWORD_STRATEGY job and runs DETACHED (not
    // awaited) — mirroring the POST /api/jobs dispatcher (server/routes/jobs.ts)
    // — so the slow, AI-heavy strategy phase never blocks this local-refresh job
    // from reaching 'done'. A strategy failure (e.g. KeywordStrategyGenerationError,
    // or a missing tier/OPENAI_API_KEY/webflowSiteId precondition) marks only the
    // strategy job 'error'; the local refresh job is already successful and stays
    // 'done'. `generateKeywordStrategy` owns its own STRATEGY_UPDATED broadcast
    // (Data-flow rule #4 — NO manual broadcast here). Dynamic import breaks the
    // keyword-strategy-generation.ts ↔ local-seo.ts cycle, exactly like the
    // recommendations regen above.
    const proceed = result.refreshed > 0;
    if (request.thenRegenerateStrategy === true && proceed) {
      try {
        const activeStrategyJob = hasActiveJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, workspaceId);
        if (activeStrategyJob) {
          log.info({ workspaceId, activeJobId: activeStrategyJob.id }, 'Skipped chained keyword strategy regeneration because a strategy job is already active');
        } else {
          const strategyJob = createJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, {
            workspaceId,
            message: 'Regenerating keyword strategy after local refresh...',
          });
          // Detached: do NOT await — the local-refresh job must not block on the
          // slow strategy generation. Failures are isolated to the strategy job.
          void (async () => {
            try {
              updateJob(strategyJob.id, { status: 'running', message: 'Generating keyword strategy...' });
              const { generateKeywordStrategy } = await import('./keyword-strategy-generation.js'); // dynamic-import-ok - breaks the keyword-strategy-generation.ts ↔ local-seo.ts cycle
              // mode 'full' (not incremental): fresh local snapshots can shift the whole
              // keyword universe, not just the pages that changed.
              const strategyGeneration = request.strategyGeneration;
              const competitorDomainsProvided = Array.isArray(strategyGeneration?.competitorDomains);
              const generationResult = await generateKeywordStrategy({
                ...strategyGeneration,
                workspaceId,
                mode: 'full',
                competitorDomainsProvided,
              });
              updateJob(strategyJob.id, {
                status: 'done',
                progress: 100,
                total: 100,
                message: generationResult.upToDate ? 'Strategy already up to date' : 'Keyword strategy regenerated after local refresh',
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              log.warn({ err, workspaceId, strategyJobId: strategyJob.id }, 'Keyword-strategy regen after local SEO refresh failed (non-fatal to refresh job)');
              updateJob(strategyJob.id, { status: 'error', error: message, message: 'Keyword strategy regeneration failed' });
            }
          })();
        }
      } catch (err) {
        // Guards the synchronous createJob/dynamic-import setup — a failure here
        // must never fail the already-successful local-refresh job.
        log.warn({ err, workspaceId }, 'Failed to kick off keyword-strategy regen after local SEO refresh (non-fatal)');
      }
    }

    updateJob(jobId, { status: 'done', progress: total, total, message: `Local visibility refreshed — ${refreshed}/${total} checks`, result });
  } finally {
    unregisterAbort(jobId);
  }
}

export function countLocalVisibilitySnapshots(workspaceId: string): number {
  const row = stmts().countSnapshotsForWorkspace.get(workspaceId) as { count: number };
  return row.count;
}

/**
 * Returns the ISO timestamp of the most recent usable local_visibility_snapshots
 * row for the given workspace, or null when none exist. Provider-failed rows are
 * stored for diagnostics but must not satisfy freshness checks.
 * Cheap aggregate read — does NOT invoke any full-model or Evaluated builders.
 */
export function latestLocalSnapshotAt(workspaceId: string): string | null {
  const row = stmts().maxUsableCapturedAtForWorkspace.get(workspaceId, LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED) as { max_captured_at: string | null };
  return row.max_captured_at ?? null;
}

/**
 * Bug 3 / owner decision D4 — Idempotent snapshot retention pruner.
 *
 * Policy:
 *   - Rows within RETENTION_RAW_DAYS (180 d): always kept.
 *   - Rows between RETENTION_RAW_DAYS and RETENTION_WEEKLY_MAX_DAYS (18 months):
 *     weekly thinning — keep exactly one row per
 *     (market_id, normalized_keyword, device, language_code, week-start-date).
 *   - Rows beyond RETENTION_WEEKLY_MAX_DAYS: hard delete.
 *   - ALWAYS keep the latest row per
 *     (market_id, normalized_keyword, device, language_code) regardless of age.
 *
 * Runs inside a db.transaction() per batch (RETENTION_PRUNE_BATCH_SIZE rows). Returns
 * the total pruned count for logging. Safe to call multiple times — no-op when the
 * table is already within policy.
 *
 * @internal Exported only for testing. Call from job hooks, not route handlers.
 */
export function runSnapshotRetentionPrune(workspaceId: string): { pruned: number } {
  let totalPruned = 0;

  // Collect and delete weekly-thinning candidates in batches.
  let batch: Array<{ id: string }>;
  do {
    batch = stmts().pruneWeeklyThinIds.all(
      // inner subquery (max captured_at per week bucket): workspace_id, raw_days, weekly_max
      workspaceId,
      RETENTION_RAW_DAYS,
      RETENTION_WEEKLY_MAX_DAYS,
      // outer keepers WHERE (rows at max captured_at): workspace_id, raw_days, weekly_max
      workspaceId,
      RETENTION_RAW_DAYS,
      RETENTION_WEEKLY_MAX_DAYS,
      // main outer WHERE: workspace_id, raw_days, weekly_max
      workspaceId,
      RETENTION_RAW_DAYS,
      RETENTION_WEEKLY_MAX_DAYS,
      // NOT IN immortal guard: workspace_id (inner), workspace_id (outer)
      workspaceId,
      workspaceId,
      RETENTION_PRUNE_BATCH_SIZE,
    ) as Array<{ id: string }>;
    if (batch.length > 0) {
      db.transaction(() => {
        for (const row of batch) {
          stmts().deleteSnapshotById.run(row.id, workspaceId);
        }
      })();
      totalPruned += batch.length;
    }
  } while (batch.length === RETENTION_PRUNE_BATCH_SIZE);

  // Collect and delete hard-cutoff candidates in batches.
  do {
    batch = stmts().pruneHardCutoffIds.all(
      // outer WHERE: workspace_id, weekly_max
      workspaceId,
      RETENTION_WEEKLY_MAX_DAYS,
      // NOT IN immortal guard: workspace_id (inner), workspace_id (outer)
      workspaceId,
      workspaceId,
      RETENTION_PRUNE_BATCH_SIZE,
    ) as Array<{ id: string }>;
    if (batch.length > 0) {
      db.transaction(() => {
        for (const row of batch) {
          stmts().deleteSnapshotById.run(row.id, workspaceId);
        }
      })();
      totalPruned += batch.length;
    }
  } while (batch.length === RETENTION_PRUNE_BATCH_SIZE);

  if (totalPruned > 0) {
    log.info({ workspaceId, pruned: totalPruned }, 'local visibility snapshot retention prune complete');
  }
  return { pruned: totalPruned };
}

export async function runLocationBackfillJob(jobId: string, workspaceId: string): Promise<void> {
  if (getJob(jobId)?.status === 'cancelled') return;

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    updateJob(jobId, { status: 'error', message: 'Workspace not found', error: 'Workspace not found' });
    return;
  }

  const locations = getEffectiveLocations(workspace);
  const total = countLocalVisibilitySnapshots(workspaceId);

  if (total === 0) {
    updateJob(jobId, {
      status: 'done',
      progress: 100,
      total: 0,
      message: 'No snapshots to recalculate',
      result: { workspaceId, updated: 0 },
    });
    return;
  }

  updateJob(jobId, {
    status: 'running',
    progress: 0,
    total,
    message: `Recalculating match data for ${total} snapshots...`,
  });

  // Bug 2 fix: keyset-paginated read so we never materialise all rows into memory.
  // Cursor tracks (captured_at, id) for stable, deterministic pagination over
  // ORDER BY captured_at DESC, id ASC.
  const pageSize = 100;
  let processed = 0;
  let lastProgressBroadcastAt = 0;
  let cursorCapturedAt: string | null = null;
  let cursorId: string | null = null;

  while (true) {
    if (getJob(jobId)?.status === 'cancelled') return;

    const batch: SnapshotRow[] = cursorCapturedAt === null
      ? stmts().listSnapshotsFirstPageForBackfill.all(workspaceId, pageSize) as SnapshotRow[]
      : stmts().listSnapshotsPageForBackfill.all(
          workspaceId,
          cursorCapturedAt,
          cursorCapturedAt,
          cursorId!,
          pageSize,
        ) as SnapshotRow[];

    if (batch.length === 0) break;

    // Advance cursor to the last row in this page
    const lastRow = batch[batch.length - 1];
    cursorCapturedAt = lastRow.captured_at;
    cursorId = lastRow.id;

    db.transaction(() => {
      for (const row of batch) {
        const snapshot = rowToSnapshot(row);
        const rawResults = rowToRawLocalResults(row);
        const match = evaluateLocalBusinessMatch(locations, rawResults);
        const isSuccess = snapshot.status === LOCAL_VISIBILITY_STATUS.SUCCESS;

        stmts().updateSnapshotMatch.run({
          id: snapshot.id,
          workspace_id: workspaceId,
          business_found: isSuccess && match.found ? 1 : 0,
          business_match_confidence: isSuccess ? match.confidence : LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN,
          business_match_reason: isSuccess ? (match.reason ?? null) : (snapshot.degradedReason ?? null),
          local_rank: isSuccess ? (match.rank ?? null) : null,
          matched_location_id: isSuccess ? (match.matchedLocationId ?? null) : null,
          matched_location_name: isSuccess ? (match.matchedLocationName ?? null) : null,
          top_competitors: JSON.stringify(scrubOwnedLocalResults(rawResults, locations)),
          raw_results: JSON.stringify(rawResults.slice(0, LOCAL_SEO_MAX_RESULTS)),
        });
      }
    })();

    processed += batch.length;
    updateJob(jobId, {
      status: 'running',
      progress: processed,
      total,
      message: `Recalculating match data... (${processed}/${total})`,
    });

    if (
      getJob(jobId)?.status !== 'cancelled'
      && processed < total
      && processed - lastProgressBroadcastAt >= LOCAL_SEO_LOCATION_BACKFILL_PROGRESS_BROADCAST_INTERVAL
    ) {
      lastProgressBroadcastAt = processed;
      notifyLocalSeoUpdated(workspaceId, {
        action: 'backfill_progress',
        processed,
        total,
        updatedAt: new Date().toISOString(),
      });
    }

    if (batch.length < pageSize) break; // last page
  }

  if (getJob(jobId)?.status === 'cancelled') return;

  // Bug 3 / D4: retention prune at backfill completion — backfill is the other
  // natural hook point (alongside refresh). Wrapped in try/catch so a prune
  // failure never fails the already-completed backfill job.
  try {
    runSnapshotRetentionPrune(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'Snapshot retention prune after backfill failed (non-fatal)');
  }

  notifyLocalSeoUpdated(workspaceId, {
    action: 'backfill_completed',
    updated: processed,
    updatedAt: new Date().toISOString(),
  });
  addActivity(
    workspaceId,
    'local_seo_updated',
    'Local match history recalculated',
    `${processed} snapshots updated with multi-location match data`,
    { source: 'local_seo', updated: processed },
  );

  updateJob(jobId, {
    status: 'done',
    progress: processed,
    total,
    message: `Match history updated for ${processed} snapshots`,
    result: { workspaceId, updated: processed },
  });
}
