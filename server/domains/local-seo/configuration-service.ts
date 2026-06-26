import { randomUUID } from 'crypto';
import { z } from 'zod';

import db from '../../db/index.js';
import { parseJsonSafeArray } from '../../db/json-validation.js';
import { createStmtCache } from '../../db/stmt-cache.js';
import { listPageKeywords } from '../../page-keywords.js';
import { getWorkspace } from '../../workspaces.js';
import { buildDataForSeoLocationName } from '../../../shared/local-seo-location.js';
import {
  LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
  LOCAL_SEO_MARKET_SOURCE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP,
  LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
  LOCAL_SEO_POSTURE,
  LOCAL_SEO_POSTURE_SOURCE,
  type LocalSeoMarket,
  type LocalSeoMarketStatus,
  type LocalSeoMarketUpdateRequest,
  type LocalSeoPosture,
  type LocalSeoWorkspaceSettings,
} from '../../../shared/types/local-seo.js';
import type { Workspace } from '../../../shared/types/workspace.js';
import { deriveLocalSeoPosture } from './workspace-classifiers.js';

export const LOCAL_SEO_MAX_MARKETS = 3;
export const LOCAL_SEO_DEFAULT_LANGUAGE_CODE = 'en';

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

const US_LOCATION_CODE = 2840;
const US_LOCATION_NAME = 'United States';

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
  getPrimaryMarket: db.prepare(
    "SELECT * FROM local_seo_markets WHERE workspace_id = @workspaceId AND is_primary = 1 AND status = 'active' AND provider_location_code IS NOT NULL LIMIT 1",
  ),
  getPrimaryMarketLanguage: db.prepare(
    `SELECT s.language_code AS language_code
       FROM local_visibility_snapshots s
       JOIN local_seo_markets m ON m.id = s.market_id
      WHERE m.workspace_id = @workspaceId AND m.is_primary = 1 AND m.status = 'active'
      ORDER BY s.captured_at DESC
      LIMIT 1`,
  ),
  countEligiblePrimary: db.prepare(
    "SELECT COUNT(*) AS count FROM local_seo_markets WHERE workspace_id = ? AND is_primary = 1 AND status = 'active' AND provider_location_code IS NOT NULL",
  ),
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
    isPrimary: row.is_primary === 1,
    source: Object.values(LOCAL_SEO_MARKET_SOURCE).includes(row.source as LocalSeoMarket['source'])
      ? row.source as LocalSeoMarket['source']
      : LOCAL_SEO_MARKET_SOURCE.UNKNOWN,
    status: isMarketStatus(row.status) ? row.status : LOCAL_SEO_MARKET_STATUS.NEEDS_REVIEW,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSettings(row: SettingsRow): LocalSeoWorkspaceSettings {
  return {
    workspaceId: row.workspace_id,
    posture: isLocalSeoPosture(row.posture) ? row.posture : LOCAL_SEO_POSTURE.UNKNOWN,
    postureSource: Object.values(LOCAL_SEO_POSTURE_SOURCE).includes(row.posture_source as LocalSeoWorkspaceSettings['postureSource'])
      ? row.posture_source as LocalSeoWorkspaceSettings['postureSource']
      : LOCAL_SEO_POSTURE_SOURCE.UNKNOWN,
    suggestedPosture: row.suggested_posture && isLocalSeoPosture(row.suggested_posture) ? row.suggested_posture : undefined,
    suggestionReasons: parseJsonSafeArray(row.suggestion_reasons, z.string(), {
      workspaceId: row.workspace_id,
      table: 'local_seo_workspace_settings',
      field: 'suggestion_reasons',
    }),
    updatedAt: row.updated_at,
    keywordsPerRefresh: row.keywords_per_refresh,
  };
}

function derivePosture(workspace: Workspace): Pick<LocalSeoWorkspaceSettings, 'suggestedPosture' | 'suggestionReasons'> {
  return deriveLocalSeoPosture(workspace, listLocalSeoMarkets(workspace.id), listPageKeywords(workspace.id));
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

export function getEffectiveKeywordsPerRefresh(workspaceId: string): number {
  const row = stmts().getSettings.get(workspaceId) as SettingsRow | undefined;
  const override = row?.keywords_per_refresh;
  if (typeof override !== 'number') return LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH;
  return Math.max(
    LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
    Math.min(LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP, Math.trunc(override)),
  );
}

export function getLocalSeoPosture(workspaceId: string): LocalSeoPosture {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return LOCAL_SEO_POSTURE.UNKNOWN;
  return readLocalSeoSettings(workspace).posture;
}

export function readLocalSeoSettings(workspace: Workspace): LocalSeoWorkspaceSettings {
  const row = stmts().getSettings.get(workspace.id) as SettingsRow | undefined;
  if (!row) return defaultSettings(workspace);
  const settings = rowToSettings(row);
  const derived = derivePosture(workspace);
  return {
    ...settings,
    suggestedPosture: derived.suggestedPosture,
    suggestionReasons: settings.postureSource === LOCAL_SEO_POSTURE_SOURCE.ADMIN_OVERRIDE
      ? settings.suggestionReasons
      : derived.suggestionReasons,
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

export function resolveWorkspaceLanguageCode(workspaceId: string): string {
  const row = stmts().getPrimaryMarketLanguage.get({ workspaceId }) as { language_code?: string } | undefined;
  const lang = row?.language_code?.trim().toLowerCase();
  return lang || LOCAL_SEO_DEFAULT_LANGUAGE_CODE;
}

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
  return {
    locationCode: US_LOCATION_CODE,
    languageCode: LOCAL_SEO_DEFAULT_LANGUAGE_CODE,
    locationName: US_LOCATION_NAME,
  };
}

export function setPrimaryLocalSeoMarket(workspaceId: string, marketId: string): void {
  db.transaction(() => {
    stmts().clearPrimary.run({ workspaceId });
    const result = stmts().setMarketPrimary.run({ workspaceId, marketId });
    if (result.changes === 0) {
      const existing = stmts().getMarket.get(marketId, workspaceId) as MarketRow | undefined;
      if (existing) throw new Error('Primary market requires an active market with a provider location code');
      throw new Error('Local SEO market not found');
    }
  })();
}

export function activeLocalSeoMarkets(workspaceId: string, marketIds?: string[]): LocalSeoMarket[] {
  const idSet = marketIds?.length ? new Set(marketIds) : null;
  return listLocalSeoMarkets(workspaceId)
    .filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE)
    .filter(market => !idSet || idSet.has(market.id))
    .filter(localSeoMarketHasProviderLocationIdentity)
    .slice(0, LOCAL_SEO_MAX_MARKETS);
}

export function buildSuggestedLocalSeoMarkets(workspace: Workspace): LocalSeoMarket[] {
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

export function disabledLocalSeoSettings(workspace: Workspace): LocalSeoWorkspaceSettings {
  return {
    workspaceId: workspace.id,
    posture: LOCAL_SEO_POSTURE.UNKNOWN,
    postureSource: LOCAL_SEO_POSTURE_SOURCE.UNKNOWN,
    suggestionReasons: [],
    updatedAt: new Date().toISOString(),
    keywordsPerRefresh: null,
  };
}

export function localSeoMarketHasProviderLocationIdentity(market: {
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

export function resolveLocalSeoProviderLocationName(market: {
  city?: string | null;
  stateOrRegion?: string | null;
  country?: string | null;
  providerLocationName?: string | null;
}): string | null {
  return market.providerLocationName?.trim() || buildDataForSeoLocationName(market) || null;
}

export function applyLocalSeoConfigurationUpdate(
  workspace: Workspace,
  request: LocalSeoMarketUpdateRequest,
  now = new Date().toISOString(),
): { updatedAt: string; promotedPrimaryLabel: string | null } {
  const current = readLocalSeoSettings(workspace);
  const posture = request.posture ?? current.posture;
  const derived = derivePosture(workspace);
  const nextKeywordsPerRefresh: number | null = request.keywordsPerRefresh === undefined
    ? current.keywordsPerRefresh
    : request.keywordsPerRefresh === null
      ? null
      : Math.max(
          LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
          Math.min(LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP, Math.trunc(request.keywordsPerRefresh)),
        );

  let promotedPrimaryLabel: string | null = null;

  db.transaction(() => {
    writeSettings({
      ...current,
      posture,
      postureSource: request.posture ? LOCAL_SEO_POSTURE_SOURCE.ADMIN_OVERRIDE : current.postureSource,
      suggestedPosture: derived.suggestedPosture,
      suggestionReasons: request.posture ? [`Admin set local SEO posture to ${posture}`] : derived.suggestionReasons,
      updatedAt: now,
      keywordsPerRefresh: nextKeywordsPerRefresh,
    });

    if (!request.markets) return;

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
            ? resolveLocalSeoProviderLocationName(market)
            : existingMarket.providerLocationName,
          latitude: market.latitude !== undefined ? market.latitude : existingMarket.latitude,
          longitude: market.longitude !== undefined ? market.longitude : existingMarket.longitude,
          city: market.city ?? existingMarket.city,
          stateOrRegion: market.stateOrRegion !== undefined ? market.stateOrRegion : existingMarket.stateOrRegion,
          country: market.country ?? existingMarket.country,
        };
        if (nextStatus === LOCAL_SEO_MARKET_STATUS.ACTIVE && !localSeoMarketHasProviderLocationIdentity(nextProviderIdentity)) {
          throw new Error('Active local SEO markets require a provider location code, provider location name, or coordinates');
        }
        nextStatuses.set(market.id, nextStatus);
      } else {
        const nextStatus = market.status ?? LOCAL_SEO_MARKET_STATUS.ACTIVE;
        if (nextStatus === LOCAL_SEO_MARKET_STATUS.ACTIVE && !localSeoMarketHasProviderLocationIdentity(market)) {
          throw new Error('Active local SEO markets require a provider location code, provider location name, or coordinates');
        }
        nextStatuses.set(`__new_${newMarketCounter++}`, nextStatus);
      }
    }

    const activeCount = [...nextStatuses.values()].filter(status => status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length;
    if (activeCount > LOCAL_SEO_MAX_MARKETS) {
      throw new Error(`At most ${LOCAL_SEO_MAX_MARKETS} active local SEO markets are allowed in v1`);
    }

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
          ? resolveLocalSeoProviderLocationName(market)
          : existingMarket?.providerLocationName ?? resolveLocalSeoProviderLocationName(market),
        source: LOCAL_SEO_MARKET_SOURCE.ADMIN_OVERRIDE,
        status: market.status ?? existingMarket?.status ?? LOCAL_SEO_MARKET_STATUS.ACTIVE,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        is_primary: 0,
      });
    }

    const eligiblePrimaryCount = (stmts().countEligiblePrimary.get(workspace.id) as { count: number }).count;
    if (eligiblePrimaryCount === 0) {
      const successor = stmts().firstEligibleActiveMarket.get(workspace.id) as MarketRow | undefined;
      if (successor) {
        stmts().clearPrimary.run({ workspaceId: workspace.id });
        stmts().setMarketPrimary.run({ workspaceId: workspace.id, marketId: successor.id });
        promotedPrimaryLabel = successor.label;
      }
    }
  })();

  return { updatedAt: now, promotedPrimaryLabel };
}
