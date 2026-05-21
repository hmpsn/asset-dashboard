import { randomUUID } from 'crypto';
import { z } from 'zod';

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { updateJob, getJob } from './jobs.js';
import { getDeclinedKeywords } from './keyword-feedback.js';
import { listPageKeywords } from './page-keywords.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { DEFAULT_SEO_DATA_PROVIDER, getProvider, isCapabilityDisabled, type ProviderName, type SeoDataProvider } from './seo-data-provider.js';
import { getWorkspace } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_MARKET_SOURCE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_POSTURE,
  LOCAL_SEO_POSTURE_SOURCE,
  LOCAL_SEO_VISIBILITY_POSTURE,
  LOCAL_VISIBILITY_STATUS,
  localSeoKeywordVisibilityFromSnapshot,
  summarizeLocalSeoKeywordVisibility,
  type LocalBusinessMatchConfidence,
  type LocalSeoKeywordVisibility,
  type LocalSeoKeywordVisibilitySummary,
  type LocalSeoDevice,
  type LocalSeoMarket,
  type LocalSeoMarketStatus,
  type LocalSeoMarketUpdateRequest,
  type LocalSeoPosture,
  type LocalSeoReportSummary,
  type LocalSeoReadResponse,
  type LocalSeoRefreshRequest,
  type LocalSeoRefreshResult,
  type LocalSeoWorkspaceSettings,
  type LocalVisibilityBusinessResult,
  type LocalVisibilityProviderResult,
  type LocalVisibilitySnapshot,
} from '../shared/types/local-seo.js';
import { TRACKED_KEYWORD_STATUS } from '../shared/types/rank-tracking.js';
import type { Workspace } from '../shared/types/workspace.js';

const log = createLogger('local-seo');

export const LOCAL_SEO_MAX_MARKETS = 3;
export const LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH = 25;
const LOCAL_SEO_MAX_RESULTS = 10;
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
}));

function isLocalSeoPosture(value: string): value is LocalSeoPosture {
  return Object.values(LOCAL_SEO_POSTURE).includes(value as LocalSeoPosture);
}

function isMarketStatus(value: string): value is LocalSeoMarketStatus {
  return Object.values(LOCAL_SEO_MARKET_STATUS).includes(value as LocalSeoMarketStatus);
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
  const label = [address.city, state].filter(Boolean).join(', ') || address.city;
  return [{
    id: 'business-profile-primary-market',
    workspaceId: workspace.id,
    label,
    city: address.city,
    stateOrRegion: state,
    country: address.country,
    source: LOCAL_SEO_MARKET_SOURCE.BUSINESS_PROFILE,
    status: LOCAL_SEO_MARKET_STATUS.NEEDS_REVIEW,
    createdAt: now,
    updatedAt: now,
  }];
}

export function getLocalSeoReadModel(workspaceId: string, featureEnabled: boolean): LocalSeoReadResponse | null {
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
  return {
    featureEnabled,
    settings,
    markets,
    suggestedMarkets,
    latestSnapshots,
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

function hasProviderLocationIdentity(market: Pick<LocalSeoMarket, 'providerLocationCode' | 'providerLocationName' | 'latitude' | 'longitude'>): boolean {
  return Boolean(
    market.providerLocationCode
    || market.providerLocationName?.trim()
    || (typeof market.latitude === 'number' && typeof market.longitude === 'number')
  );
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
          if (nextStatus === LOCAL_SEO_MARKET_STATUS.ACTIVE && !hasProviderLocationIdentity({
            providerLocationCode: market.providerLocationCode ?? existingMarket.providerLocationCode,
            providerLocationName: market.providerLocationName ?? existingMarket.providerLocationName,
            latitude: market.latitude ?? existingMarket.latitude,
            longitude: market.longitude ?? existingMarket.longitude,
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
          latitude: market.latitude ?? existingMarket?.latitude ?? null,
          longitude: market.longitude ?? existingMarket?.longitude ?? null,
          provider_location_code: market.providerLocationCode ?? existingMarket?.providerLocationCode ?? null,
          provider_location_name: market.providerLocationName !== undefined ? market.providerLocationName.trim() || null : existingMarket?.providerLocationName ?? null,
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

export function selectLocalIntentKeywords(workspaceId: string, explicitKeywords: string[] = []): string[] {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return [];
  const declined = new Set(getDeclinedKeywords(workspaceId).map(keywordComparisonKey));
  const seen = new Set<string>();
  const selected: string[] = [];
  const add = (keyword: string | undefined, force = false) => {
    const display = keyword?.trim();
    if (!display) return;
    const key = keywordComparisonKey(display);
    if (!key || seen.has(key) || declined.has(key)) return;
    if (!force && !hasLocalIntent(display, workspace)) return;
    seen.add(key);
    selected.push(display);
  };

  for (const keyword of explicitKeywords) add(keyword, true);
  for (const tracked of getTrackedKeywords(workspaceId)) {
    if ((tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) continue;
    add(tracked.query);
  }
  for (const page of listPageKeywords(workspaceId)) {
    const pageLooksLocal = /\/location\/|near me|appointment|austin|houston|san antonio|dallas/i.test(`${page.pagePath} ${page.pageTitle}`)
      || page.serpFeatures?.includes('local_pack');
    add(page.primaryKeyword, pageLooksLocal);
    for (const secondary of page.secondaryKeywords ?? []) add(secondary, pageLooksLocal);
  }

  return selected.slice(0, LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH);
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
