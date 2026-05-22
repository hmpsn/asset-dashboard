import { randomUUID } from 'crypto';
import { z } from 'zod';

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { getClientLocations } from './client-locations.js';
import { listContentGaps } from './content-gaps.js';
import { updateJob, getJob } from './jobs.js';
import { getDeclinedKeywords, getRequestedKeywords } from './keyword-feedback.js';
import { isStrategyPoolEligibleKeyword, isNearDuplicateKeyword } from './keyword-intelligence/rules.js';
import { listPageKeywords } from './page-keywords.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { DEFAULT_SEO_DATA_PROVIDER, getProvider, isCapabilityDisabled, type ProviderName, type SeoDataProvider } from './seo-data-provider.js';
import { getTaxonomyForIndustry } from './service-taxonomy.js';
import { getWorkspace } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { buildDataForSeoLocationName } from '../shared/local-seo-location.js';
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
import type { Workspace } from '../shared/types/workspace.js';

const log = createLogger('local-seo');

export const LOCAL_SEO_MAX_MARKETS = 3;
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
const LOCAL_SEO_MAX_RESULTS = 10;
const LOCAL_SEO_REFRESH_CONCURRENCY = 5;
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

export interface LocalSeoKeywordCandidate {
  keyword: string;
  normalizedKeyword: string;
  source: 'explicit' | 'strategy' | 'tracking' | 'page_assignment' | 'content_gap' | 'local_variant';
  sourceLabel: string;
  detail?: string;
  pagePath?: string;
  pageTitle?: string;
  volume?: number;
  difficulty?: number;
  selected: boolean;
  score: number;
  reasons: string[];
  intent: LocalSeoKeywordIntent;
}

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
  upsertMarket: db.prepare(`
    INSERT INTO local_seo_markets (
      id, workspace_id, label, city, state_or_region, country, latitude, longitude,
      provider_location_code, provider_location_name, source, status, created_at, updated_at
    ) VALUES (
      @id, @workspace_id, @label, @city, @state_or_region, @country, @latitude, @longitude,
      @provider_location_code, @provider_location_name, @source, @status, @created_at, @updated_at
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
      updated_at = excluded.updated_at
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
  latestSnapshots: db.prepare(`
    SELECT * FROM local_visibility_snapshots
    WHERE workspace_id = ?
    ORDER BY captured_at DESC
    LIMIT 500
  `),
  latestSnapshotsByKeyword: db.prepare(`
    SELECT * FROM local_visibility_snapshots
    WHERE workspace_id = ? AND normalized_keyword = ?
    ORDER BY captured_at DESC
    LIMIT 50
  `),
  competitorSnapshots: db.prepare(`
    SELECT workspace_id, business_found, local_pack_present, market_label, top_competitors
    FROM local_visibility_snapshots
    WHERE workspace_id = @workspaceId
      AND captured_at >= datetime('now', '-' || @days || ' days')
      AND status = 'success'
    ORDER BY captured_at DESC
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
      WHERE workspace_id = ?
      GROUP BY market_id, normalized_keyword, device, language_code
    ) latest
      ON latest.market_id = s.market_id
      AND latest.normalized_keyword = s.normalized_keyword
      AND latest.device = s.device
      AND latest.language_code = s.language_code
      AND latest.captured_at = s.captured_at
    WHERE s.workspace_id = ?
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
  if (/near me|\baustin\b|\bhouston\b|\bsan antonio\b|\bdallas\b|\btexas\b|\/location\//.test(pageTerms)) reasons.push('Page map contains local/service-area terms');
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
      latestSnapshots,
    }),
    competitorBrands: getLocalSeoCompetitorBrands(workspaceId),
    serviceGaps: featureEnabled ? getLocalSeoServiceGaps(workspaceId) : [],
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
        });
      }
    }
  });
  run();

  addActivity(workspace.id, 'local_seo_updated', 'Local SEO configuration updated', 'Updated local SEO posture or market setup', { source: 'local_seo' });
  broadcastToWorkspace(workspace.id, WS_EVENTS.LOCAL_SEO_UPDATED, { workspaceId: workspace.id, action: 'configuration_updated', updatedAt: now });
  return getLocalSeoReadModel(workspace.id, featureEnabled);
}

export function listLatestLocalVisibilitySnapshots(workspaceId: string): LocalVisibilitySnapshot[] {
  const rows = stmts().latestSnapshots.all(workspaceId) as SnapshotRow[];
  return latestSnapshotsFromRows(rows);
}

function latestSnapshotsFromRows(rows: SnapshotRow[]): LocalVisibilitySnapshot[] {
  const seen = new Set<string>();
  const snapshots: LocalVisibilitySnapshot[] = [];
  for (const row of rows) {
    const key = `${row.market_id}:${row.normalized_keyword}:${row.device}:${row.language_code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(rowToSnapshot(row));
  }
  return snapshots;
}

function listLatestLocalVisibilitySnapshotsForKeyword(workspaceId: string, normalizedKeyword: string): LocalVisibilitySnapshot[] {
  const rows = stmts().latestSnapshotsByKeyword.all(workspaceId, normalizedKeyword) as SnapshotRow[];
  return latestSnapshotsFromRows(rows);
}

function listLatestLocalVisibilitySnapshotSummaryRows(workspaceId: string): SnapshotSummaryRow[] {
  return stmts().latestSnapshotSummary.all(workspaceId, workspaceId) as SnapshotSummaryRow[];
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

function cleanDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch (err) {
    log.debug({ err, value }, 'local-seo cleanDomain: malformed domain value');
    return value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase();
  }
}

function normalizePhone(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits.length >= 7 ? digits.slice(-10) : undefined;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeProviderIdentity(value: string | undefined): string | undefined {
  const normalized = value?.toLowerCase().replace(/[^a-z0-9]+/g, '') ?? '';
  return normalized || undefined;
}

type LocalBusinessMatchResult = {
  confidence: LocalBusinessMatchConfidence;
  found: boolean;
  rank?: number;
  reason?: string;
  matchedLocationId?: string;
  matchedLocationName?: string;
};

function confidencePriority(confidence: LocalBusinessMatchConfidence): number {
  switch (confidence) {
    case LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED:
      return 3;
    case LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH:
      return 2;
    case LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH:
      return 1;
    default:
      return 0;
  }
}

export function getEffectiveLocations(workspace: Workspace): ClientLocation[] {
  const configured = getClientLocations(workspace.id).filter(location => location.status === 'confirmed');
  if (configured.length > 0) return configured;
  const address = workspace.businessProfile?.address;
  // Use a fixed sentinel timestamp so two calls at different wall-clock times return
  // structurally identical objects — avoids false cache misses from unstable timestamps.
  const syntheticTimestamp = '1970-01-01T00:00:00.000Z';
  return [{
    id: `synthetic-${workspace.id}`,
    workspaceId: workspace.id,
    name: workspace.name,
    domain: workspace.liveDomain ?? workspace.gscPropertyUrl ?? undefined,
    phone: workspace.businessProfile?.phone,
    streetAddress: address?.street,
    city: address?.city,
    stateOrRegion: address?.state,
    country: address?.country,
    isPrimary: true,
    status: 'confirmed',
    createdAt: syntheticTimestamp,
    updatedAt: syntheticTimestamp,
  }];
}

export function isOwnedLocalResult(result: LocalVisibilityBusinessResult, locations: ClientLocation[]): boolean {
  const resultDomain = cleanDomain(result.domain ?? result.url);
  const resultPhone = normalizePhone(result.phone);
  const resultAddress = normalizeText(result.address);
  const resultProviderIdentity = normalizeProviderIdentity(result.cid);

  return locations.some(location => {
    const locationDomain = cleanDomain(location.domain);
    if (locationDomain && resultDomain && locationDomain === resultDomain) return true;
    const locationProviderIdentity = normalizeProviderIdentity(location.gbpPlaceId);
    if (locationProviderIdentity && resultProviderIdentity && locationProviderIdentity === resultProviderIdentity) return true;
    const locationPhone = normalizePhone(location.phone);
    if (locationPhone && resultPhone && locationPhone === resultPhone) return true;
    const locationStreet = normalizeText(location.streetAddress);
    if (locationStreet && resultAddress.includes(locationStreet)) return true;
    // Name alone is NOT enough to claim ownership — domain, GBP identity, phone, or
    // street address must corroborate. All four signals were already checked above
    // via early-return; if we reach here, all four were false, so name-only can't
    // produce a match. Returning false explicitly prevents a future reader from
    // "simplifying" the early-returns and inadvertently enabling name-only scrubbing.
    return false;
  });
}

function scrubOwnedLocalResults(
  results: LocalVisibilityBusinessResult[],
  locations: ClientLocation[],
): LocalVisibilityBusinessResult[] {
  return results
    .filter(result => !isOwnedLocalResult(result, locations))
    .slice(0, LOCAL_SEO_MAX_RESULTS);
}

function isBetterLocalBusinessMatch(
  candidate: LocalBusinessMatchResult,
  current: LocalBusinessMatchResult | null,
): boolean {
  if (!current) return true;
  const candidatePriority = confidencePriority(candidate.confidence);
  const currentPriority = confidencePriority(current.confidence);
  if (candidatePriority !== currentPriority) return candidatePriority > currentPriority;
  const candidateRank = candidate.rank ?? Number.POSITIVE_INFINITY;
  const currentRank = current.rank ?? Number.POSITIVE_INFINITY;
  return candidateRank < currentRank;
}

export function evaluateLocalBusinessMatch(
  locations: ClientLocation[],
  results: LocalVisibilityBusinessResult[],
): LocalBusinessMatchResult {
  if (results.length === 0 || locations.length === 0) {
    return {
      confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND,
      found: false,
      reason: 'No local pack results returned',
    };
  }

  let best: LocalBusinessMatchResult | null = null;

  for (const location of locations) {
    const locationDomain = cleanDomain(location.domain);
    const locationName = normalizeText(location.name);
    const locationPhone = normalizePhone(location.phone);
    const locationStreet = normalizeText(location.streetAddress);

    for (const result of results) {
      const resultDomain = cleanDomain(result.domain ?? result.url);
      const title = normalizeText(result.title);
      const address = normalizeText(result.address);
      const phone = normalizePhone(result.phone);
      const providerIdentity = normalizeProviderIdentity(result.cid);
      const domainMatch = Boolean(locationDomain && resultDomain && resultDomain === locationDomain);
      const phoneMatch = Boolean(locationPhone && phone && locationPhone === phone);
      const nameMatch = Boolean(locationName && title && (title.includes(locationName) || locationName.includes(title)));
      const streetAddressMatch = Boolean(locationStreet && address.includes(locationStreet));
      const locationProviderIdentity = normalizeProviderIdentity(location.gbpPlaceId);
      const providerIdentityMatch = Boolean(
        locationProviderIdentity && providerIdentity && locationProviderIdentity === providerIdentity,
      );

      let candidate: LocalBusinessMatchResult | null = null;
      if (providerIdentityMatch || (domainMatch && (nameMatch || phoneMatch || streetAddressMatch))) {
        candidate = {
          confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED,
          found: true,
          rank: result.rank,
          reason: 'Domain plus name, phone, address, or provider identity matched',
          matchedLocationId: location.id,
          matchedLocationName: location.name,
        };
      } else if (domainMatch || (nameMatch && (phoneMatch || streetAddressMatch))) {
        candidate = {
          confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH,
          found: true,
          rank: result.rank,
          reason: 'Strong business identity match in local result',
          matchedLocationId: location.id,
          matchedLocationName: location.name,
        };
      } else if (nameMatch || phoneMatch || streetAddressMatch) {
        candidate = {
          confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH,
          found: true,
          rank: result.rank,
          reason: 'Possible business match; review before treating as verified',
          matchedLocationId: location.id,
          matchedLocationName: location.name,
        };
      }

      if (candidate && isBetterLocalBusinessMatch(candidate, best)) {
        best = candidate;
      }
    }
  }

  return best ?? {
    confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND,
    found: false,
    reason: 'No likely business match found in local results',
  };
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

function hasLocalIntent(keyword: string, workspace: Workspace): boolean {
  const normalized = normalizeText(keyword);
  const address = workspace.businessProfile?.address;
  const city = normalizeText(address?.city);
  const state = normalizeText(address?.state);
  if (/\bnear me\b|\blocal\b|\bdowntown\b|\bmidtown\b|\bheights\b|\bservice area\b/.test(normalized)) return true;
  if (city && normalized.includes(city)) return true;
  if (state && normalized.includes(state)) return true;
  if (/dentist|dental|orthodont|implant|invisalign|veneer|emergency|clinic|lawyer|attorney|restaurant|contractor|plumber|roofing|med spa/.test(normalized)) {
    return readSettings(workspace).posture !== LOCAL_SEO_POSTURE.NON_LOCAL;
  }
  return false;
}

function cleanKeywordDisplay(keyword: string | undefined): string | undefined {
  const cleaned = keyword?.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 90) return undefined;
  return cleaned;
}

function titleLooksLikeServiceKeyword(title: string | undefined): boolean {
  const cleaned = cleanKeywordDisplay(title);
  if (!cleaned) return false;
  const tokens = cleaned.split(/\s+/);
  if (tokens.length > 6) return false;
  return /dent|dental|implant|invisalign|veneer|whiten|emergency|orthodont|clinic|law|attorney|restaurant|contractor|plumb|roof|med spa|service/i.test(cleaned);
}

function hasMarketModifier(keyword: string, markets: LocalSeoMarket[]): boolean {
  const normalized = normalizeText(keyword);
  if (/\bnear me\b|\blocal\b/.test(normalized)) return true;
  return markets.some(market => {
    const city = normalizeText(market.city);
    const state = normalizeText(market.stateOrRegion);
    return Boolean((city && normalized.includes(city)) || (state && normalized.includes(state)));
  });
}

/**
 * Classify the search intent of a local SEO keyword using regex patterns.
 * Runs in the hot path — no API calls.
 *
 * Priority order: comparison → informational → commercial → transactional (default)
 *
 * Note: 'navigational' is part of the LocalSeoKeywordIntent union but is never
 * returned by this classifier (it requires workspace brand context not available here).
 * It may be pre-assigned by signal iterators that have that context.
 */
export function classifyLocalKeywordIntent(keyword: string): LocalSeoKeywordIntent {
  const kw = keyword.toLowerCase();
  // Comparison: X vs Y, versus, alternatives, compare
  if (/\bvs\b|\bversus\b|\balternative[s]?\b|\bcompare\b|\bcomparison\b/.test(kw)) {
    return 'comparison';
  }
  // Informational: question words, educational patterns, cost/price research
  if (/^(how |what |why |when |where |which |who |can |does |do |is |are )|\bguide\b|\btutorial\b|\btips\b|\bexplained\b|\boverview\b|\bhistory\b|\bfacts\b|\bstatistics\b|\btypes of\b|\bdifference between\b|\bcost of\b|\bprice of\b|\bpros and cons\b|\bbenefits of\b|\bcauses of\b|\bwhat is\b|\bimpact of\b/.test(kw)) {
    return 'informational';
  }
  // Commercial: pre-buying research with quality signals (still useful for local)
  if (/\b(best|top|top-rated|top rated|affordable|cheap|cheapest|discount|deal|coupon|budget|premium|quality)\b/.test(kw)) {
    return 'commercial';
  }
  // Navigational: brand/domain search (hard to detect without workspace context, skip)
  // Default: transactional (local service + city/near-me patterns)
  return 'transactional';
}

const LOCAL_INTENT_PREFIXES = [
  'emergency', 'open now', 'best',
  'same day', 'affordable', 'cheap',
  'top rated', 'accepting new patients', '24 hour',
] as const;

const LOCAL_INTENT_PREFIX_CAP_PER_BASE = 3;

const LOCAL_SOURCE_PAGE_BUDGET_FRACTION = 0.20;

function localVariantKeywords(baseKeyword: string, markets: LocalSeoMarket[]): string[] {
  const base = cleanKeywordDisplay(baseKeyword);
  if (!base) return [];
  const variants = new Set<string>();
  for (const market of markets) {
    const city = cleanKeywordDisplay(market.city);
    const state = cleanKeywordDisplay(market.stateOrRegion);
    if (city && !normalizeText(base).includes(normalizeText(city))) {
      variants.add(`${base} ${city}`);
      if (state && state.length <= 3) variants.add(`${base} ${city} ${state}`);
    }
  }
  if (!/\bnear me\b/i.test(base)) variants.add(`${base} near me`);
  return [...variants];
}

function candidateSourceScore(source: LocalSeoKeywordCandidate['source']): number {
  switch (source) {
    case 'explicit': return 120;
    case 'strategy': return 95;
    case 'tracking': return 90;
    case 'page_assignment': return 85;
    case 'content_gap': return 72;
    case 'local_variant': return 62;
  }
}

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
  const { workspace, markets, trackedKeywords, contentGaps, pageMap, explicitKeywords } = ctx;

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
    const pageLooksLocal = /\/location\/|near me|appointment|austin|houston|san antonio|dallas/i.test(`${page.pagePath} ${page.pageTitle}`)
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
    if (titleLooksLikeServiceKeyword(page.pageTitle)) {
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
      if (!base || !titleLooksLikeServiceKeyword(base) || isNearDuplicateKeyword(base, workspace.name)) continue;
      for (const variant of localVariantKeywords(base, markets)) {
        yield {
          keyword: variant,
          source: 'local_variant',
          sourceLabel: 'Local candidate',
          detail: page.pageTitle ?? page.pagePath,
          pagePath: page.pagePath,
          pageTitle: page.pageTitle,
          intent: classifyLocalKeywordIntent(variant),
        };
      }
    }
    // Intent modifier variants for service-keyword bases (primary keyword only, primary market only)
    if (titleLooksLikeServiceKeyword(page.pageTitle) && markets.length > 0) {
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
      || hasLocalIntent(`${gap.topic} ${gap.targetKeyword}`, workspace);
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
    for (const variant of localVariantKeywords(gap.targetKeyword, markets)) {
      yield {
        keyword: variant,
        source: 'local_variant',
        sourceLabel: 'Local content candidate',
        detail: gap.topic,
        volume: gap.volume,
        difficulty: gap.difficulty,
        intent: classifyLocalKeywordIntent(variant),
      };
    }
    // Intent modifier variants for content gap bases
    if (titleLooksLikeServiceKeyword(gap.targetKeyword) && markets.length > 0) {
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
    volume: signal.volume,
    difficulty: signal.difficulty,
    selected: signal.selected
      ?? (signal.source === 'strategy' || signal.source === 'tracking' || signal.source === 'page_assignment'),
    score,
    reasons,
    intent: signal.intent ?? classifyLocalKeywordIntent(display),
  };
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
    if (!signal.force && !hasLocalIntent(display, ctx.workspace) && !hasMarketModifier(display, ctx.markets)) continue;

    const localIntentScore = hasMarketModifier(display, ctx.markets) ? 12 : hasLocalIntent(display, ctx.workspace) ? 8 : 0;
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
    if (!signal.force && !hasLocalIntent(display, ctx.workspace) && !hasMarketModifier(display, ctx.markets)) continue;

    const evaluationSource = signal.source === 'local_variant' ? 'local_generated' : signal.source === 'tracking' ? 'gsc' : 'client';
    const evaluation = isStrategyPoolEligibleKeyword({
      keyword: display,
      volume: signal.volume ?? 0,
      difficulty: signal.difficulty ?? 0,
      source: evaluationSource,
    }, evaluationContext);
    if (evaluation.suppressed) continue;

    const localIntentScore = hasMarketModifier(display, ctx.markets) ? 12 : hasLocalIntent(display, ctx.workspace) ? 8 : 0;
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
    if (!signal.force && !hasLocalIntent(display, ctx.workspace) && !hasMarketModifier(display, ctx.markets)) continue;
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

/**
 * Apply a per-source-page budget cap to prevent a single page from dominating
 * the refresh budget. Explicit keywords are never capped — they are admin-chosen.
 * Non-explicit keywords without a pagePath share a bucket per source type.
 */
function applySourcePageCap(candidates: LocalSeoKeywordCandidate[], budget: number): LocalSeoKeywordCandidate[] {
  const pageCap = Math.max(1, Math.ceil(budget * LOCAL_SOURCE_PAGE_BUDGET_FRACTION));
  const pageCounts = new Map<string, number>();
  return candidates.filter(c => {
    if (c.source === 'explicit') return true;
    const key = c.pagePath ?? `__no_page__${c.source}`;
    const count = pageCounts.get(key) ?? 0;
    if (count >= pageCap) return false;
    pageCounts.set(key, count + 1);
    return true;
  });
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
  const providerName = (workspace.seoDataProvider as ProviderName | undefined) ?? DEFAULT_SEO_DATA_PROVIDER;
  if (isCapabilityDisabled(providerName, 'local_visibility')) return null;
  const provider = getProvider(providerName);
  if (!provider?.isConfigured()) return null;
  return provider.getLocalVisibility ? provider : null;
}

function resolveLocalLocationProvider(workspace: Workspace): SeoDataProvider | null {
  const providerName = (workspace.seoDataProvider as ProviderName | undefined) ?? DEFAULT_SEO_DATA_PROVIDER;
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
      broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_SEO_UPDATED, {
        workspaceId,
        action: 'refresh_progress',
        processed,
        total,
        updatedAt: new Date().toISOString(),
      });
    }
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
  broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_SEO_UPDATED, { workspaceId, action: 'refresh_completed', refreshed, failed, updatedAt: new Date().toISOString() });
  addActivity(workspaceId, 'local_seo_updated', 'Local SEO visibility refreshed', `${refreshed} local visibility checks refreshed`, { source: 'local_seo', refreshed, failed });
  updateJob(jobId, { status: 'done', progress: total, total, message: `Local visibility refreshed — ${refreshed}/${total} checks`, result });
}

export function countLocalVisibilitySnapshots(workspaceId: string): number {
  const row = stmts().countSnapshotsForWorkspace.get(workspaceId) as { count: number };
  return row.count;
}

export async function runLocationBackfillJob(jobId: string, workspaceId: string): Promise<void> {
  if (getJob(jobId)?.status === 'cancelled') return;

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    updateJob(jobId, { status: 'error', message: 'Workspace not found', error: 'Workspace not found' });
    return;
  }

  const locations = getEffectiveLocations(workspace);
  const rows = stmts().listAllSnapshotsForWorkspace.all(workspaceId) as SnapshotRow[];
  const total = rows.length;

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

  const batchSize = 100;
  let processed = 0;
  let lastProgressBroadcastAt = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    if (getJob(jobId)?.status === 'cancelled') return;
    const batch = rows.slice(i, i + batchSize);

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
      broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_SEO_UPDATED, {
        workspaceId,
        action: 'backfill_progress',
        processed,
        total,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (getJob(jobId)?.status === 'cancelled') return;
  broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_SEO_UPDATED, {
    workspaceId,
    action: 'backfill_completed',
    updated: total,
    updatedAt: new Date().toISOString(),
  });
  addActivity(
    workspaceId,
    'local_seo_updated',
    'Local match history recalculated',
    `${total} snapshots updated with multi-location match data`,
    { source: 'local_seo', updated: total },
  );

  updateJob(jobId, {
    status: 'done',
    progress: total,
    total,
    message: `Match history updated for ${total} snapshots`,
    result: { workspaceId, updated: total },
  });
}
