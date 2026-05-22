import { randomUUID } from 'crypto';
import { z } from 'zod';

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { listContentGaps } from './content-gaps.js';
import { updateJob, getJob } from './jobs.js';
import { getDeclinedKeywords, getRequestedKeywords } from './keyword-feedback.js';
import { isStrategyPoolEligibleKeyword, isNearDuplicateKeyword } from './keyword-intelligence/rules.js';
import { listPageKeywords } from './page-keywords.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { DEFAULT_SEO_DATA_PROVIDER, getProvider, isCapabilityDisabled, type ProviderName, type SeoDataProvider } from './seo-data-provider.js';
import { getWorkspace } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { buildDataForSeoLocationName } from '../shared/local-seo-location.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_MARKET_SOURCE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_POSTURE,
  LOCAL_SEO_POSTURE_SOURCE,
  LOCAL_SEO_VISIBILITY_POSTURE,
  LOCAL_VISIBILITY_SOURCE_ENDPOINT,
  LOCAL_VISIBILITY_STATUS,
  localSeoKeywordVisibilityFromSnapshot,
  localSeoKeywordVisibilitySummaryFromSnapshots,
  summarizeLocalSeoKeywordVisibility,
  type LocalBusinessMatchConfidence,
  type LocalSeoKeywordVisibility,
  type LocalSeoKeywordVisibilitySummary,
  type LocalSeoDevice,
  type LocalSeoLocationLookupRequest,
  type LocalSeoLocationLookupResponse,
  type LocalSeoMarket,
  type LocalSeoMarketStatus,
  type LocalSeoMarketUpdateRequest,
  type LocalSeoPosture,
  type LocalSeoReportSummary,
  type LocalSeoReadResponse,
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
export const LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH = 50;
const LOCAL_CANDIDATE_HARD_CAP = 1000;
const LOCAL_SEO_MAX_RESULTS = 10;
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
    INSERT INTO local_seo_workspace_settings (workspace_id, posture, posture_source, suggested_posture, suggestion_reasons, updated_at)
    VALUES (@workspace_id, @posture, @posture_source, @suggested_posture, @suggestion_reasons, @updated_at)
    ON CONFLICT(workspace_id) DO UPDATE SET
      posture = excluded.posture,
      posture_source = excluded.posture_source,
      suggested_posture = excluded.suggested_posture,
      suggestion_reasons = excluded.suggestion_reasons,
      updated_at = excluded.updated_at
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
      local_rank, top_competitors, source_endpoint, provider, device, language_code, status, degraded_reason
    ) VALUES (
      @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label, @captured_at,
      @local_pack_present, @business_found, @business_match_confidence, @business_match_reason,
      @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status, @degraded_reason
    )
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
  };
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
      caps: {
        maxMarkets: LOCAL_SEO_MAX_MARKETS,
        maxKeywordsPerRefresh: LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH,
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
    caps: {
      maxMarkets: LOCAL_SEO_MAX_MARKETS,
      maxKeywordsPerRefresh: LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH,
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

  const run = db.transaction(() => {
    writeSettings({
      ...current,
      posture,
      postureSource: request.posture ? LOCAL_SEO_POSTURE_SOURCE.ADMIN_OVERRIDE : current.postureSource,
      suggestedPosture: derived.suggestedPosture,
      suggestionReasons: request.posture ? [`Admin set local SEO posture to ${posture}`] : derived.suggestionReasons,
      updatedAt: now,
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

export function evaluateLocalBusinessMatch(workspace: Workspace, results: LocalVisibilityBusinessResult[]): {
  confidence: LocalBusinessMatchConfidence;
  found: boolean;
  rank?: number;
  reason?: string;
} {
  if (results.length === 0) return { confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND, found: false, reason: 'No local pack results returned' };
  const workspaceDomain = cleanDomain(workspace.liveDomain ?? workspace.gscPropertyUrl);
  const workspaceName = normalizeText(workspace.name);
  const workspacePhone = normalizePhone(workspace.businessProfile?.phone);
  const street = normalizeText(workspace.businessProfile?.address?.street);

  for (const result of results) {
    const resultDomain = cleanDomain(result.domain ?? result.url);
    const title = normalizeText(result.title);
    const address = normalizeText(result.address);
    const phone = normalizePhone(result.phone);
    const domainMatch = Boolean(workspaceDomain && resultDomain && resultDomain === workspaceDomain);
    const phoneMatch = Boolean(workspacePhone && phone && workspacePhone === phone);
    const nameMatch = Boolean(workspaceName && title && (title.includes(workspaceName) || workspaceName.includes(title)));
    const streetAddressMatch = Boolean(street && address.includes(street));
    if (domainMatch && (nameMatch || phoneMatch || streetAddressMatch)) {
      return { confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED, found: true, rank: result.rank, reason: 'Domain plus name, phone, address, or provider identity matched' };
    }
    if (domainMatch || (nameMatch && (phoneMatch || streetAddressMatch))) {
      return { confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH, found: true, rank: result.rank, reason: 'Strong business identity match in local result' };
    }
    if (nameMatch || phoneMatch || streetAddressMatch) {
      return { confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH, found: true, rank: result.rank, reason: 'Possible business match; review before treating as verified' };
    }
  }
  return { confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND, found: false, reason: 'No likely business match found in local results' };
}

function snapshotFromProviderResult(
  workspace: Workspace,
  market: LocalSeoMarket,
  providerResult: LocalVisibilityProviderResult,
  device: LocalSeoDevice,
  languageCode: string,
): LocalVisibilitySnapshot {
  const match = evaluateLocalBusinessMatch(workspace, providerResult.results);
  return {
    id: randomUUID(),
    workspaceId: workspace.id,
    keyword: providerResult.keyword,
    normalizedKeyword: keywordComparisonKey(providerResult.keyword),
    marketId: market.id,
    marketLabel: market.label,
    capturedAt: providerResult.capturedAt,
    localPackPresent: providerResult.localPackPresent,
    businessFound: match.found,
    businessMatchConfidence: providerResult.status === LOCAL_VISIBILITY_STATUS.SUCCESS ? match.confidence : LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN,
    businessMatchReason: providerResult.status === LOCAL_VISIBILITY_STATUS.SUCCESS ? match.reason : providerResult.degradedReason,
    localRank: match.rank,
    topCompetitors: providerResult.results.slice(0, LOCAL_SEO_MAX_RESULTS),
    sourceEndpoint: providerResult.sourceEndpoint,
    provider: providerResult.provider,
    device,
    languageCode,
    status: providerResult.status,
    degradedReason: providerResult.degradedReason,
  };
}

function storeSnapshot(snapshot: LocalVisibilitySnapshot): void {
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

export function buildLocalSeoKeywordCandidates(workspaceId: string, explicitKeywords: string[] = []): LocalSeoKeywordCandidate[] {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return [];
  const markets = activeMarkets(workspaceId);
  const { contentGaps, pageMap, declinedKeywords, evaluationContext } = buildCandidateContext(workspace);
  const declined = new Set(declinedKeywords.map(keywordComparisonKey));
  const trackedKeywords = getTrackedKeywords(workspaceId, { includeInactive: true });
  const inactiveTracked = new Set(
    trackedKeywords
      .filter(tracked => (tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(tracked => keywordComparisonKey(tracked.query)),
  );
  const candidates = new Map<string, LocalSeoKeywordCandidate>();
  let candidateHardCapReached = false;

  const add = (
    keyword: string | undefined,
    source: LocalSeoKeywordCandidate['source'],
    options: {
      force?: boolean;
      selected?: boolean;
      sourceLabel?: string;
      detail?: string;
      pagePath?: string;
      pageTitle?: string;
      volume?: number;
      difficulty?: number;
      scoreBoost?: number;
    } = {},
  ) => {
    const display = cleanKeywordDisplay(keyword);
    if (!display) return;
    const key = keywordComparisonKey(display);
    if (!key || declined.has(key) || inactiveTracked.has(key)) return;
    if (candidates.size >= LOCAL_CANDIDATE_HARD_CAP && !candidates.has(key)) {
      candidateHardCapReached = true;
      return;
    }
    if (!options.force && !hasLocalIntent(display, workspace) && !hasMarketModifier(display, markets)) return;
    const evaluationSource = source === 'local_variant' ? 'local_generated' : source === 'tracking' ? 'gsc' : 'client';
    const evaluation = isStrategyPoolEligibleKeyword({
      keyword: display,
      volume: options.volume ?? 0,
      difficulty: options.difficulty ?? 0,
      source: evaluationSource,
    }, evaluationContext);
    if (evaluation.suppressed) return;
    const localIntentScore = hasMarketModifier(display, markets) ? 12 : hasLocalIntent(display, workspace) ? 8 : 0;
    const score = candidateSourceScore(source) + localIntentScore + evaluation.scoreDelta + (options.scoreBoost ?? 0);
    const existing = candidates.get(key);
    const next: LocalSeoKeywordCandidate = {
      keyword: display,
      normalizedKeyword: key,
      source,
      sourceLabel: options.sourceLabel ?? source.replace(/_/g, ' '),
      detail: options.detail,
      pagePath: options.pagePath,
      pageTitle: options.pageTitle,
      volume: options.volume,
      difficulty: options.difficulty,
      selected: options.selected ?? (source === 'strategy' || source === 'tracking' || source === 'page_assignment'),
      score,
      reasons: evaluation.reasons.map(reason => reason.message).slice(0, 4),
    };
    if (!existing || next.score > existing.score || (next.selected && !existing.selected)) candidates.set(key, next);
  };

  for (const keyword of explicitKeywords) add(keyword, 'explicit', { force: true, selected: true, sourceLabel: 'Selected for refresh', scoreBoost: 30 });
  for (const keyword of workspace.keywordStrategy?.siteKeywords ?? []) {
    add(keyword, 'strategy', { selected: true, sourceLabel: 'Strategy keyword', scoreBoost: 12 });
  }
  for (const tracked of trackedKeywords) {
    if ((tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) continue;
    add(tracked.query, 'tracking', {
      selected: true,
      sourceLabel: 'Rank tracking',
      detail: tracked.source?.replace(/_/g, ' '),
      pagePath: tracked.pagePath,
      pageTitle: tracked.pageTitle,
      volume: tracked.volume,
      difficulty: tracked.difficulty,
      scoreBoost: tracked.pinned ? 20 : 8,
    });
  }
  for (const page of pageMap) {
    const pageLooksLocal = /\/location\/|near me|appointment|austin|houston|san antonio|dallas/i.test(`${page.pagePath} ${page.pageTitle}`)
      || page.serpFeatures?.includes('local_pack');
    add(page.primaryKeyword, 'page_assignment', {
      force: pageLooksLocal,
      selected: true,
      sourceLabel: 'Page assignment',
      detail: page.pageTitle ?? page.pagePath,
      pagePath: page.pagePath,
      pageTitle: page.pageTitle,
      volume: page.volume,
      difficulty: page.difficulty,
      scoreBoost: 10,
    });
    for (const secondary of page.secondaryKeywords ?? []) {
      add(secondary, 'page_assignment', {
        force: pageLooksLocal,
        selected: true,
        sourceLabel: 'Page assignment',
        detail: page.pageTitle ?? page.pagePath,
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
        scoreBoost: 4,
      });
    }
    if (titleLooksLikeServiceKeyword(page.pageTitle)) {
      add(page.pageTitle, 'page_assignment', {
        force: pageLooksLocal,
        selected: true,
        sourceLabel: 'Service page',
        detail: page.pagePath,
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
      });
    }
    for (const base of [page.primaryKeyword, page.pageTitle, ...(page.secondaryKeywords ?? [])]) {
      if (!base || !titleLooksLikeServiceKeyword(base) || isNearDuplicateKeyword(base, workspace.name)) continue;
      for (const variant of localVariantKeywords(base, markets)) {
        add(variant, 'local_variant', {
          sourceLabel: 'Local candidate',
          detail: page.pageTitle ?? page.pagePath,
          pagePath: page.pagePath,
          pageTitle: page.pageTitle,
        });
      }
    }
  }
  for (const gap of contentGaps) {
    const localGap = gap.suggestedPageType === 'location'
      || gap.serpFeatures?.includes('local_pack')
      || hasLocalIntent(`${gap.topic} ${gap.targetKeyword}`, workspace);
    add(gap.targetKeyword, 'content_gap', {
      force: localGap,
      selected: false,
      sourceLabel: 'Content opportunity',
      detail: gap.topic,
      volume: gap.volume,
      difficulty: gap.difficulty,
      scoreBoost: gap.priority === 'high' ? 8 : 0,
    });
    for (const variant of localVariantKeywords(gap.targetKeyword, markets)) {
      add(variant, 'local_variant', {
        sourceLabel: 'Local content candidate',
        detail: gap.topic,
        volume: gap.volume,
        difficulty: gap.difficulty,
      });
    }
  }

  if (candidateHardCapReached) {
    log.warn({ workspaceId, cap: LOCAL_CANDIDATE_HARD_CAP }, 'local SEO candidate hard cap reached; output truncated');
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
}

/**
 * Count-only local SEO candidate iteration — sub-100ms even on rich workspaces.
 *
 * Mirrors `buildLocalSeoKeywordCandidates` but skips:
 *   - `isStrategyPoolEligibleKeyword` (the per-candidate scan that caused the
 *     35-second regression on Swish in PR #876)
 *   - Per-candidate score computation
 *   - Per-candidate `LocalSeoKeywordCandidate` object construction
 *
 * Filters retained (cheap): declined check, inactive-tracked check, market modifier
 * regex, local intent regex. Applies the same `LOCAL_CANDIDATE_HARD_CAP` so the
 * count caps at 1000 like the real generator.
 *
 * **Slight overcount possible:** without the eligibility evaluator we don't
 * suppress noise patterns / authority mismatches / business-fit failures. In
 * practice on Swish the cheap count returned within a few percent of the real
 * generator output. Used for the Local Candidates badge — UX accuracy is "this
 * is roughly how many candidates exist", not "this is precisely the displayable
 * list". The actual displayable list still comes from the full generator when
 * the user clicks into Local Candidates filter.
 */
export function countLocalSeoKeywordCandidates(workspaceId: string): number {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return 0;
  const markets = activeMarkets(workspaceId);
  if (markets.length === 0) return 0;
  const { contentGaps, pageMap, declinedKeywords } = buildCandidateContext(workspace);
  const declined = new Set(declinedKeywords.map(keywordComparisonKey));
  const trackedKeywords = getTrackedKeywords(workspaceId, { includeInactive: true });
  const inactiveTracked = new Set(
    trackedKeywords
      .filter(tracked => (tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(tracked => keywordComparisonKey(tracked.query)),
  );
  const seen = new Set<string>();

  const consider = (keyword: string | undefined, force = false): void => {
    if (seen.size >= LOCAL_CANDIDATE_HARD_CAP) return;
    const display = cleanKeywordDisplay(keyword);
    if (!display) return;
    const key = keywordComparisonKey(display);
    if (!key || seen.has(key) || declined.has(key) || inactiveTracked.has(key)) return;
    if (!force && !hasLocalIntent(display, workspace) && !hasMarketModifier(display, markets)) return;
    seen.add(key);
  };

  // Strategy site keywords are always considered (force=true) by buildLocalSeoKeywordCandidates
  for (const keyword of workspace.keywordStrategy?.siteKeywords ?? []) consider(keyword, true);
  for (const tracked of trackedKeywords) {
    if ((tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE) {
      consider(tracked.query, true);
    }
  }
  for (const page of pageMap) {
    const pageLooksLocal = /\/location\/|near me|appointment|austin|houston|san antonio|dallas/i.test(`${page.pagePath} ${page.pageTitle}`)
      || page.serpFeatures?.includes('local_pack');
    consider(page.primaryKeyword, pageLooksLocal);
    for (const secondary of page.secondaryKeywords ?? []) consider(secondary, pageLooksLocal);
    if (titleLooksLikeServiceKeyword(page.pageTitle)) consider(page.pageTitle, pageLooksLocal);
    for (const base of [page.primaryKeyword, page.pageTitle, ...(page.secondaryKeywords ?? [])]) {
      if (!base || !titleLooksLikeServiceKeyword(base) || isNearDuplicateKeyword(base, workspace.name)) continue;
      for (const variant of localVariantKeywords(base, markets)) consider(variant);
    }
  }
  for (const gap of contentGaps) {
    const localGap = gap.suggestedPageType === 'location'
      || gap.serpFeatures?.includes('local_pack')
      || hasLocalIntent(`${gap.topic} ${gap.targetKeyword}`, workspace);
    consider(gap.targetKeyword, localGap);
    for (const variant of localVariantKeywords(gap.targetKeyword, markets)) consider(variant);
  }
  return seen.size;
}

function selectExplicitLocalSeoKeywords(workspaceId: string, explicitKeywords: string[] = []): string[] {
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
    if (selected.length >= LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH) break;
  }
  return selected;
}

export function selectLocalIntentKeywords(workspaceId: string, explicitKeywords: string[] = []): string[] {
  if (explicitKeywords.length > 0) return selectExplicitLocalSeoKeywords(workspaceId, explicitKeywords);
  return buildLocalSeoKeywordCandidates(workspaceId, explicitKeywords)
    .slice(0, LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH)
    .map(candidate => candidate.keyword);
}

export function createLocalSeoRefreshPlan(workspaceId: string, request: LocalSeoRefreshRequest = {}): { markets: LocalSeoMarket[]; keywords: string[]; device: LocalSeoDevice; languageCode: string } | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const markets = activeMarkets(workspaceId, request.marketIds).slice(0, LOCAL_SEO_MAX_MARKETS);
  const keywords = selectLocalIntentKeywords(workspaceId, request.keywords ?? []).slice(0, LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH);
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

  const total = plan.markets.length * plan.keywords.length;
  let processed = 0;
  let refreshed = 0;
  let failed = 0;
  updateJob(jobId, { status: 'running', total, progress: 0, message: 'Refreshing local visibility...' });

  for (const market of plan.markets) {
    for (const keyword of plan.keywords) {
      if (getJob(jobId)?.status === 'cancelled') return;
      try {
        const providerResult = await provider.getLocalVisibility({
          keyword,
          market,
          device: plan.device,
          languageCode: plan.languageCode,
          maxResults: LOCAL_SEO_MAX_RESULTS,
        }, workspaceId);
        if (getJob(jobId)?.status === 'cancelled') return;
        const snapshot = snapshotFromProviderResult(workspace, market, providerResult, plan.device, plan.languageCode);
        storeSnapshot(snapshot);
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
