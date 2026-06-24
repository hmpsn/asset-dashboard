// ── DataForSEO Provider — implements SeoDataProvider via REST API ──
// Uses Basic Auth with DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD env vars.
// Per-workspace file cache + disk-based credit tracking (same pattern as semrush.ts).

import fs from 'fs';
import path from 'path';

import { getUploadRoot, getDataDir } from '../data-dir.js';
import { createLogger } from '../logger.js';
import { getCachedMetricsBatch, cacheMetricsBatch } from '../keyword-metrics-cache.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import { KEYWORD_GAP_COMPETITOR_KEYWORD_LIMIT, MAX_COMPETITORS } from '../constants.js';
import { recordExternalApiTelemetry, recordOperationTrace } from '../platform-observability.js';
import { KEYWORD_SOURCE_KIND, type KeywordSourceEvidence, type KeywordSourceKind } from '../../shared/types/keywords.js';
import {
  LOCAL_SEO_LOCATION_LOOKUP_STATUS,
  LOCAL_SEO_DEVICE,
  LOCAL_VISIBILITY_SOURCE_ENDPOINT,
  LOCAL_VISIBILITY_STATUS,
  type LocalSeoLocationLookupCandidate,
  type LocalSeoLocationLookupRequest,
  type LocalSeoLocationLookupResponse,
  type LocalVisibilityBusinessResult,
  type LocalVisibilityProviderRequest,
  type LocalVisibilityProviderResult,
} from '../../shared/types/local-seo.js';
import { buildDataForSeoLocationName, normalizeLocalSeoCountryName } from '../../shared/local-seo-location.js';
import type {
  SeoDataProvider,
  KeywordMetrics,
  RelatedKeyword,
  QuestionKeyword,
  DomainKeyword,
  DomainOverview,
  OrganicCompetitor,
  KeywordGapEntry,
  BacklinksOverview,
  ReferringDomain,
  NationalSerpProviderRequest,
  NationalSerpResult,
} from '../seo-data-provider.js';
import { normalizeProviderDate, markCapabilityDisabled } from '../seo-data-provider.js';
import { fetchProviderJson, isExternalFetchError } from '../external-fetch.js';
import { normalizeDomainValue } from '../domain-normalization.js';

const log = createLogger('dataforseo');
const UPLOAD_ROOT = getUploadRoot();

// ── Location code mapping ──
const LOCATION_CODES: Record<string, number> = {
  us: 2840,
  uk: 2826,
  ca: 2124,
  au: 2036,
  de: 2276,
  fr: 2250,
};

function locationCodeFromDatabase(database = 'us'): number {
  return LOCATION_CODES[database.toLowerCase()] ?? 2840;
}

const DEFAULT_LANGUAGE_CODE = 'en';

/** Normalize an optional language code to a non-empty lowercase value (default 'en'). */
function normalizeLanguageCode(languageCode?: string): string {
  const lc = languageCode?.trim().toLowerCase();
  return lc || DEFAULT_LANGUAGE_CODE;
}

/**
 * Versioned cache-region token for the global metrics cache key + per-workspace
 * file cache keys. Combines geo (location/database) + language so a non-US/non-en
 * workspace cannot read or write rows another geo/language workspace consumes.
 *
 * The `v2:` version prefix is a deliberate one-time invalidation of the legacy
 * language-blind cache rows (which were keyed on locationCode/database only and
 * could have been written by an 'en' caller). 'en' rows are versioned the same
 * way, so flag-OFF callers simply re-warm once after this ships — output is
 * unchanged; only the cache key changes.
 */
export function cacheRegionToken(geo: string, languageCode = DEFAULT_LANGUAGE_CODE): string {
  return `v2:${geo}:${normalizeLanguageCode(languageCode)}`;
}

/**
 * Geo token for the per-workspace discovery file-cache keys.
 *
 * When an explicit `locationCode` is threaded (flag-ON, geo-resolved), the cache
 * is keyed on the resolved location code so a non-US workspace cannot read or
 * write rows a US (or other-geo) workspace consumes. When no `locationCode` is
 * supplied (flag-OFF legacy callers + the pre-P1 default), the token stays the
 * `database` string so flag-OFF cache keys are byte-identical to before.
 */
function discoveryGeoToken(database: string, locationCode?: number): string {
  return locationCode != null ? String(locationCode) : database;
}

/**
 * Cache geo token for the DOMAIN-analysis methods (SEO Decision Engine P4). Unlike the
 * discovery methods — whose caches are short-lived and already accept a one-time v2 re-warm
 * — the domain caches have a 7-14 day TTL and are expensive to re-warm, so flag-OFF must stay
 * BYTE-IDENTICAL: when no `locationCode` is threaded (flag-OFF), the token is the legacy
 * `database` string, preserving the exact pre-P4 key. Flag-ON keys on the resolved location
 * AND language (`v2:<loc>:<lang>`) so two workspaces sharing a location but differing in
 * language (e.g. Canada en vs fr) cannot poison each other's cache.
 */
function domainGeoToken(database: string, locationCode: number | undefined, languageCode: string): string {
  return locationCode != null ? cacheRegionToken(String(locationCode), languageCode) : database;
}

// ── Auth ──
function getCredentials(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

function authHeader(): string {
  const creds = getCredentials();
  if (!creds) throw new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not configured');
  return 'Basic ' + Buffer.from(`${creds.login}:${creds.password}`).toString('base64');
}

// ── Credit Usage Tracking (disk-based, same pattern as semrush) ──

interface CreditEntry {
  credits: number;
  endpoint: string;
  query: string;
  rowsReturned: number;
  workspaceId: string;
  cached: boolean;
  timestamp: string;
}

const CREDIT_DIR = getDataDir('dataforseo-usage');

let pendingCreditWrites: CreditEntry[] = [];
let creditFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function flushCreditsToDisk(): void {
  if (pendingCreditWrites.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(CREDIT_DIR, `${today}.json`);
  let existing: CreditEntry[] = [];
  try { existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { /* new file — expected */ }
  existing.push(...pendingCreditWrites);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
  pendingCreditWrites = [];
}

function logCreditUsage(entry: Omit<CreditEntry, 'timestamp'>): void {
  const full: CreditEntry = { ...entry, timestamp: new Date().toISOString() };
  pendingCreditWrites.push(full);
  if (pendingCreditWrites.length >= 10) { flushCreditsToDisk(); return; }
  if (!creditFlushTimer) creditFlushTimer = setTimeout(() => { creditFlushTimer = null; flushCreditsToDisk(); }, 5000);
}

process.on('beforeExit', flushCreditsToDisk);

// ── Credit-exhausted circuit breaker ──
let creditExhaustedUntil = 0;
const CREDIT_COOLDOWN_MS = 5 * 60 * 1000;

function markCreditsExhausted(): void {
  creditExhaustedUntil = Date.now() + CREDIT_COOLDOWN_MS;
  log.warn(`DataForSEO credits exhausted — pausing API calls for ${CREDIT_COOLDOWN_MS / 1000}s`);
}

function areCreditsExhausted(): boolean {
  return Date.now() < creditExhaustedUntil;
}

function isSubscriptionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('40204') || msg.includes('subscription');
}

/**
 * TTL for the backlinks capability breaker (P5). A 40204 means the account has no
 * backlinks subscription — re-hitting the paid endpoint every call just burns the
 * request budget. Trip the in-memory breaker for 6h so `getBacklinksProvider()`
 * short-circuits to null (callers degrade the optional backlink fields); it
 * self-recovers after the TTL in case the subscription is added.
 */
const BACKLINKS_BREAKER_TTL_MS = 6 * 60 * 60 * 1000;

// ── Per-workspace file cache ──

const CACHE_TTL_KEYWORD = 720;         // 30 days
const CACHE_TTL_RELATED = 720;         // 30 days
const CACHE_TTL_DISCOVERY = 720;       // 30 days
const CACHE_TTL_DOMAIN_ORGANIC = 168;  // 7 days
const CACHE_TTL_DOMAIN_OVERVIEW = 168; // 7 days
const CACHE_TTL_BACKLINKS = 168;       // 7 days
const CACHE_TTL_COMPETITORS = 336;     // 14 days
const CACHE_TTL_LOCAL_VISIBILITY = 168; // 7 days
const CACHE_TTL_LOCAL_LOCATIONS = 720;  // 30 days
const CACHE_TTL_NATIONAL_SERP = 168;    // 7 days (P6 national-serp-tracking)

function getCacheDir(workspaceId: string): string {
  const dir = path.join(UPLOAD_ROOT, workspaceId, '.dataforseo-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCachePath(workspaceId: string, key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getCacheDir(workspaceId), `${safeKey}.json`);
}

function readCache<T>(workspaceId: string, key: string, maxAgeHours = 168): T | null {
  try {
    const fp = getCachePath(workspaceId, key);
    if (!fs.existsSync(fp)) return null;
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const age = (Date.now() - new Date(raw.cachedAt).getTime()) / (1000 * 60 * 60);
    if (age > maxAgeHours) return null;
    return raw.data as T;
  } catch { return null; }
}

function writeCache(workspaceId: string, key: string, data: unknown): void {
  // Compact JSON (no indentation) — pretty-printing large SERP responses held both
  // the compact and indented strings in memory simultaneously before the write,
  // doubling the transient allocation. Compact is fine for machine-read cache files.
  fs.writeFileSync(getCachePath(workspaceId, key), JSON.stringify({ cachedAt: new Date().toISOString(), data }));
}

// ── API helpers ──

function cleanDomain(domain: string): string {
  return normalizeDomainValue(domain, {
    stripWww: true,
    lowercase: true,
    stripPort: true,
    allowMalformedFallback: true,
  }) ?? '';
}

function cleanUrlTarget(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch { // catch-ok: malformed provider target degrades to domain-style target normalization.
    return cleanDomain(url);
  }
}

function cacheKeyPart(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
}

function normalizeSeedKeywords(keywords: string[], limit = 10): string[] {
  const seen = new Set<string>();
  const seeds: string[] = [];
  for (const kw of keywords) {
    const normalized = kw.toLowerCase().trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    seeds.push(normalized);
    if (seeds.length >= limit) break;
  }
  return seeds;
}

interface DataForSeoResponse {
  version?: string;
  status_code?: number;
  status_message?: string;
  tasks?: Array<{
    id?: string;
    status_code?: number;
    status_message?: string;
    cost?: number;
    result_count?: number;
    result?: Array<Record<string, unknown>>;
  }>;
}

interface DataForSeoLocationRow {
  location_code?: number;
  location_name?: string;
  country_iso_code?: string;
  location_type?: string;
}

async function apiCall(endpoint: string, body: unknown[], workspaceId?: string): Promise<DataForSeoResponse> {
  const startedAt = Date.now();
  const operation = `dataforseo:${endpoint}`;
  let json: DataForSeoResponse;
  try {
    json = await fetchProviderJson<DataForSeoResponse>({
      url: `https://api.dataforseo.com/v3/${endpoint}`,
      method: 'POST',
      headers: {
        'Authorization': authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      timeoutMs: 20_000,
      redirect: 'follow',
      logContext: { module: 'dataforseo', endpoint },
    });
  } catch (err) {
    if (isExternalFetchError(err)) {
      const durationMs = Date.now() - startedAt;
      recordExternalApiTelemetry({
        provider: 'dataforseo',
        endpoint,
        workspaceId,
        durationMs,
        status: 'error',
        errorKind: err.kind,
      });
      recordOperationTrace({
        source: 'integration',
        operation,
        status: 'error',
        workspaceId,
        durationMs,
        message: `DataForSEO fetch ${err.kind}${err.status ? ` ${err.status}` : ''}`,
      });
      if (err.kind === 'http' && err.status === 402) markCreditsExhausted();
      const snippet = err.responseBodySnippet || '';
      if (snippet.includes('balance')) markCreditsExhausted();
      throw new Error(`DataForSEO ${endpoint} ${err.kind}${err.status ? ` ${err.status}` : ''}: ${snippet || err.message}`);
    }
    throw err;
  }

  // Check task-level errors
  const task = json.tasks?.[0];
  if (task && task.status_code !== 20000) {
    const msg = task.status_message || 'Unknown error';
    const durationMs = Date.now() - startedAt;
    recordExternalApiTelemetry({
      provider: 'dataforseo',
      endpoint,
      workspaceId,
      durationMs,
      status: 'error',
      errorKind: 'task_error',
    });
    recordOperationTrace({
      source: 'integration',
      operation,
      status: 'error',
      workspaceId,
      durationMs,
      message: `task ${task.status_code}: ${msg}`,
    });
    if (msg.toLowerCase().includes('balance') || msg.toLowerCase().includes('insufficient')) {
      markCreditsExhausted();
    }
    throw new Error(`DataForSEO ${endpoint} task error ${task.status_code}: ${msg}`);
  }

  const durationMs = Date.now() - startedAt;
  recordExternalApiTelemetry({
    provider: 'dataforseo',
    endpoint,
    workspaceId,
    durationMs,
    status: 'success',
  });
  recordOperationTrace({
    source: 'integration',
    operation,
    status: 'success',
    workspaceId,
    durationMs,
    message: `DataForSEO ${endpoint} success`,
  });

  return json;
}

async function apiGet(endpoint: string, workspaceId?: string): Promise<DataForSeoResponse> {
  const startedAt = Date.now();
  const operation = `dataforseo:${endpoint}`;
  let json: DataForSeoResponse;
  try {
    json = await fetchProviderJson<DataForSeoResponse>({
      url: `https://api.dataforseo.com/v3/${endpoint}`,
      method: 'GET',
      headers: {
        'Authorization': authHeader(),
        'Content-Type': 'application/json',
      },
      timeoutMs: 20_000,
      redirect: 'follow',
      logContext: { module: 'dataforseo', endpoint },
    });
  } catch (err) {
    if (isExternalFetchError(err)) {
      const durationMs = Date.now() - startedAt;
      recordExternalApiTelemetry({
        provider: 'dataforseo',
        endpoint,
        workspaceId,
        durationMs,
        status: 'error',
        errorKind: err.kind,
      });
      recordOperationTrace({
        source: 'integration',
        operation,
        status: 'error',
        workspaceId,
        durationMs,
        message: `DataForSEO fetch ${err.kind}${err.status ? ` ${err.status}` : ''}`,
      });
      throw new Error(`DataForSEO ${endpoint} ${err.kind}${err.status ? ` ${err.status}` : ''}: ${err.responseBodySnippet || err.message}`);
    }
    throw err;
  }

  const task = json.tasks?.[0];
  if (task && task.status_code !== 20000) {
    const msg = task.status_message || 'Unknown error';
    const durationMs = Date.now() - startedAt;
    recordExternalApiTelemetry({
      provider: 'dataforseo',
      endpoint,
      workspaceId,
      durationMs,
      status: 'error',
      errorKind: 'task_error',
    });
    recordOperationTrace({
      source: 'integration',
      operation,
      status: 'error',
      workspaceId,
      durationMs,
      message: `task ${task.status_code}: ${msg}`,
    });
    throw new Error(`DataForSEO ${endpoint} task error ${task.status_code}: ${msg}`);
  }

  const durationMs = Date.now() - startedAt;
  recordExternalApiTelemetry({
    provider: 'dataforseo',
    endpoint,
    workspaceId,
    durationMs,
    status: 'success',
  });
  recordOperationTrace({
    source: 'integration',
    operation,
    status: 'success',
    workspaceId,
    durationMs,
    message: `DataForSEO ${endpoint} success`,
  });
  return json;
}

function getTaskResult(json: DataForSeoResponse): Record<string, unknown>[] {
  const result = json.tasks?.[0]?.result;
  if (!result || !Array.isArray(result)) return [];
  return result;
}

function getTaskCost(json: DataForSeoResponse): number {
  return json.tasks?.[0]?.cost ?? 0;
}

interface DataForSeoOperationMapped<T> {
  value: T;
  rowsReturned?: number;
  cacheable?: boolean;
  logCreditUsage?: boolean;
}

interface DataForSeoOperationOptions<T> {
  workspaceId: string;
  cacheKey: string;
  cacheTtlHours: number;
  endpointLabel: string;
  query: string;
  emptyValue: T;
  endpoint: string;
  body: unknown[];
  mapResult: (json: DataForSeoResponse) => DataForSeoOperationMapped<T>;
  handleError: (err: unknown) => T;
  afterNetworkSuccess?: (value: T) => void;
}

function rowsReturnedForValue(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return value == null ? 0 : 1;
}

// ── National SERP parser (P6 / national-serp-tracking) ──
// Pure, fixture-grounded parser for `serp/google/organic/live/advanced` items.
// Built against `tests/fixtures/dataforseo-serp-advanced.ts` — field names validated,
// not guessed. Defensive against malformed items: never throws, skips bad entries.

/** Strip a leading `www.` and lowercase, so 'www.Reddit.com' and 'reddit.com' compare equal. */
function normalizeSerpDomain(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/^www\./, '');
}

/** Domain equality after `www.`-strip + lowercase normalization. Empty strings never match. */
function domainMatches(a: unknown, b: unknown): boolean {
  const na = normalizeSerpDomain(a);
  const nb = normalizeSerpDomain(b);
  return na !== '' && na === nb;
}

/**
 * Parse a national advanced-SERP `items[]` array into a `NationalSerpResult` relative to
 * `ownerDomain`. Logic derived from the ground-truth fixture:
 *  - `features`: distinct top-level `item.type` values, first-seen order preserved.
 *  - AI Overview: top-level `type === 'ai_overview'` item. `aiOverviewCited` matches `ownerDomain`
 *    against the AGGREGATED top-level `references[].domain` (the canonical citation list). `null`
 *    when no AI Overview is present.
 *  - Client organic rank: lowest `rank_group` among `type === 'organic'` items whose `domain`
 *    matches `ownerDomain`. Only `organic` items count toward the client's own rank.
 */
export function parseNationalSerp(items: unknown[], ownerDomain: string, query: string): NationalSerpResult {
  const safeItems: Record<string, unknown>[] = Array.isArray(items)
    ? items.filter((it): it is Record<string, unknown> => typeof it === 'object' && it !== null)
    : [];

  // features: distinct top-level types, first-seen order.
  const features: string[] = [];
  const seenTypes = new Set<string>();
  for (const item of safeItems) {
    const type = typeof item.type === 'string' ? item.type : '';
    if (type && !seenTypes.has(type)) {
      seenTypes.add(type);
      features.push(type);
    }
  }

  // AI Overview presence + citation (aggregated top-level references[]).
  const aiOverviewItem = safeItems.find(item => item.type === 'ai_overview');
  const aiOverviewPresent = !!aiOverviewItem;
  let aiOverviewCited: boolean | null = null;
  if (aiOverviewItem) {
    const references = Array.isArray(aiOverviewItem.references) ? aiOverviewItem.references : [];
    aiOverviewCited = references.some(ref =>
      typeof ref === 'object' && ref !== null && domainMatches((ref as Record<string, unknown>).domain, ownerDomain),
    );
  }

  // Client best organic rank: lowest rank_group among matching organic items only.
  let position: number | null = null;
  let matchedUrl: string | null = null;
  for (const item of safeItems) {
    if (item.type !== 'organic') continue;
    if (!domainMatches(item.domain, ownerDomain)) continue;
    const rank = typeof item.rank_group === 'number' ? item.rank_group : null;
    if (rank === null) continue;
    if (position === null || rank < position) {
      position = rank;
      matchedUrl = typeof item.url === 'string' ? item.url : null;
    }
  }

  return { query, position, matchedUrl, features, aiOverviewPresent, aiOverviewCited };
}

async function runDataForSeoOperation<T>({
  workspaceId,
  cacheKey,
  cacheTtlHours,
  endpointLabel,
  query,
  emptyValue,
  endpoint,
  body,
  mapResult,
  handleError,
  afterNetworkSuccess,
}: DataForSeoOperationOptions<T>): Promise<T> {
  const cached = readCache<T>(workspaceId, cacheKey, cacheTtlHours);
  if (cached) {
    logCreditUsage({
      credits: 0,
      endpoint: endpointLabel,
      query,
      rowsReturned: rowsReturnedForValue(cached),
      workspaceId,
      cached: true,
    });
    return cached;
  }

  if (areCreditsExhausted()) return emptyValue;

  try {
    const json = await apiCall(endpoint, body, workspaceId);
    const cost = getTaskCost(json);
    const mapped = mapResult(json);

    if (mapped.logCreditUsage !== false) {
      logCreditUsage({
        credits: cost,
        endpoint: endpointLabel,
        query,
        rowsReturned: mapped.rowsReturned ?? rowsReturnedForValue(mapped.value),
        workspaceId,
        cached: false,
      });
    }

    if (mapped.cacheable !== false) {
      writeCache(workspaceId, cacheKey, mapped.value);
    }

    afterNetworkSuccess?.(mapped.value);
    return mapped.value;
  } catch (err) {
    return handleError(err);
  }
}

function normalizeMonthlyTrend(kwInfo: Record<string, unknown> | undefined): number[] | undefined {
  const monthlies = kwInfo?.monthly_searches as Array<{ search_volume?: number }> | undefined;
  return monthlies ? monthlies.map(m => m.search_volume ?? 0) : undefined;
}

function countryIsoForLocations(country: string): string | undefined {
  const normalized = normalizeLocalSeoCountryName(country).toLowerCase();
  if (normalized === 'united states') return 'us';
  if (/^[a-z]{2}$/i.test(country.trim())) return country.trim().toLowerCase();
  return undefined;
}

function localLocationKey(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreLocalLocation(row: DataForSeoLocationRow, request: LocalSeoLocationLookupRequest): number {
  const locationName = row.location_name ?? '';
  if (!locationName || typeof row.location_code !== 'number') return 0;
  const expectedName = buildDataForSeoLocationName(request);
  const expectedKey = localLocationKey(expectedName);
  const locationKey = localLocationKey(locationName);
  const cityKey = localLocationKey(request.city);
  const stateKey = localLocationKey(request.stateOrRegion);
  const countryKey = localLocationKey(normalizeLocalSeoCountryName(request.country));
  let score = 0;
  if (expectedKey && locationKey === expectedKey) score += 100;
  if (cityKey && locationKey.split(' ').includes(cityKey)) score += 35;
  if (stateKey && locationKey.includes(stateKey)) score += 25;
  if (countryKey && locationKey.includes(countryKey)) score += 20;
  if (/city/i.test(row.location_type ?? '')) score += 15;
  if (/state|region|country/i.test(row.location_type ?? '')) score -= 15;
  if (!stateKey && /united states/i.test(normalizeLocalSeoCountryName(request.country))) score -= 20;
  return score;
}

function normalizeLocationCandidate(row: DataForSeoLocationRow, request: LocalSeoLocationLookupRequest): LocalSeoLocationLookupCandidate | null {
  if (typeof row.location_code !== 'number' || !row.location_name) return null;
  const score = scoreLocalLocation(row, request);
  if (score <= 0) return null;
  return {
    providerLocationCode: row.location_code,
    providerLocationName: row.location_name,
    countryIsoCode: row.country_iso_code,
    locationType: row.location_type,
    score,
  };
}

function evidenceFromKeywordData(
  keywordData: Record<string, unknown> | undefined,
  options: {
    provider: string;
    sourceKind: KeywordSourceKind;
    seed?: string;
    sourceTarget?: string;
    confidence?: KeywordSourceEvidence['confidence'];
  },
): KeywordSourceEvidence | null {
  const keyword = (keywordData?.keyword as string | undefined)?.trim();
  if (!keyword) return null;
  const kwInfo = keywordData?.keyword_info as Record<string, unknown> | undefined;
  const serpInfo = keywordData?.serp_info as Record<string, unknown> | undefined;
  const searchIntentInfo = keywordData?.search_intent_info as Record<string, unknown> | undefined;
  const competition = kwInfo?.competition as number | undefined;
  const competitionIndex = kwInfo?.competition_index as number | undefined;
  const difficulty = kwInfo?.keyword_difficulty as number | undefined;
  const mainIntent = searchIntentInfo?.main_intent as string | undefined;
  const serpFeatures = Array.isArray(serpInfo?.serp_item_types)
    ? (serpInfo.serp_item_types as string[]).join(',')
    : undefined;

  return {
    keyword,
    volume: (kwInfo?.search_volume as number) ?? 0,
    difficulty: difficulty ?? competitionIndex ?? Math.round((competition ?? 0) * 100),
    cpc: (kwInfo?.cpc as number) ?? 0,
    competition: typeof competition === 'number' ? competition : undefined,
    trend: normalizeMonthlyTrend(kwInfo),
    provider: options.provider,
    sourceKind: options.sourceKind,
    seed: options.seed,
    sourceTarget: options.sourceTarget,
    confidence: options.confidence,
    intent: mainIntent,
    serpFeatures,
  };
}

function evidenceFromKeywordDataItems(
  items: Array<Record<string, unknown>>,
  options: {
    provider: string;
    sourceKind: KeywordSourceKind;
    seed?: string;
    sourceTarget?: string;
    confidence?: KeywordSourceEvidence['confidence'];
  },
): KeywordSourceEvidence[] {
  const seen = new Set<string>();
  const results: KeywordSourceEvidence[] = [];
  for (const item of items) {
    const keywordData = (item.keyword_data as Record<string, unknown> | undefined) ?? item;
    const evidence = evidenceFromKeywordData(keywordData, options);
    if (!evidence) continue;
    const normalized = evidence.keyword.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(evidence);
  }
  return results;
}

function evidenceFromGoogleAdsKeywordItem(
  item: Record<string, unknown>,
  options: {
    provider: string;
    sourceKind: KeywordSourceKind;
    seed?: string;
    confidence?: KeywordSourceEvidence['confidence'];
  },
): KeywordSourceEvidence | null {
  const keyword = (item.keyword as string | undefined)?.trim();
  if (!keyword) return null;
  const competition = item.competition as number | undefined;
  const competitionIndex = item.competition_index as number | undefined;
  const monthlies = item.monthly_searches as Array<{ search_volume?: number }> | undefined;
  return {
    keyword,
    volume: (item.search_volume as number) ?? 0,
    difficulty: competitionIndex ?? Math.round((competition ?? 0) * 100),
    cpc: (item.cpc as number) ?? 0,
    competition: typeof competition === 'number' ? competition : undefined,
    trend: monthlies ? monthlies.map(m => m.search_volume ?? 0) : undefined,
    provider: options.provider,
    sourceKind: options.sourceKind,
    seed: options.seed,
    confidence: options.confidence,
  };
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeLocalResultItem(item: Record<string, unknown>, fallbackRank?: number): LocalVisibilityBusinessResult | null {
  const title = stringFromUnknown(item.title) ?? stringFromUnknown(item.name);
  if (!title) return null;
  const url = stringFromUnknown(item.url) ?? stringFromUnknown(item.website);
  let domain = stringFromUnknown(item.domain);
  if (!domain && url) domain = cleanDomain(url);
  const address = stringFromUnknown(item.address) ?? stringFromUnknown(item.description);
  return {
    title,
    rank: numberFromUnknown(item.rank_group) ?? numberFromUnknown(item.rank_absolute) ?? fallbackRank,
    domain,
    url,
    phone: stringFromUnknown(item.phone),
    address,
    cid: stringFromUnknown(item.cid) ?? stringFromUnknown(item.place_id),
  };
}

function extractLocalPackItems(result: Record<string, unknown>): LocalVisibilityBusinessResult[] {
  const items = Array.isArray(result.items) ? result.items as Array<Record<string, unknown>> : [];
  const localPacks = items.filter(item => stringFromUnknown(item.type) === 'local_pack');
  const results: LocalVisibilityBusinessResult[] = [];

  for (const localPack of localPacks) {
    const nested = Array.isArray(localPack.items)
      ? localPack.items as Array<Record<string, unknown>>
      : Array.isArray(localPack.local_pack)
        ? localPack.local_pack as Array<Record<string, unknown>>
        : [];
    if (nested.length > 0) {
      for (const item of nested) {
        const normalized = normalizeLocalResultItem(item, results.length + 1);
        if (normalized) results.push(normalized);
      }
      continue;
    }

    const single = normalizeLocalResultItem(localPack, results.length + 1);
    if (single) results.push(single);
  }
  return results;
}

function localVisibilityLocationIdentity(market: LocalVisibilityProviderRequest['market']): string {
  if (market.providerLocationCode) return String(market.providerLocationCode);
  if (market.providerLocationName?.trim()) return market.providerLocationName.trim();
  if (typeof market.latitude === 'number' && typeof market.longitude === 'number') return `${market.latitude}_${market.longitude}`;
  return market.id;
}

// ── Provider Implementation ──

export class DataForSeoProvider implements SeoDataProvider {
  readonly name = 'dataforseo';

  isConfigured(): boolean {
    return !!getCredentials();
  }

  async init(): Promise<void> {
    return;
  }

  // ── getKeywordMetrics → search_volume ──
  async getKeywordMetrics(
    keywords: string[],
    workspaceId: string,
    database = 'us',
    locationCode?: number,
    languageCode?: string,
  ): Promise<KeywordMetrics[]> {
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    // Versioned + language-aware cache region (cross-workspace poisoning fix).
    const cacheRegion = cacheRegionToken(String(resolvedLocationCode), lang);
    // Pre-version, language-blind region a same-geo/'en' caller may have already
    // warmed — read it forward only for the default language so US/en stays warm.
    const useLegacyRegionFallback = lang === DEFAULT_LANGUAGE_CODE;
    const legacyRegion = String(resolvedLocationCode);
    const results: KeywordMetrics[] = [];
    const uncached: string[] = [];

    // Check cache first
    for (const kw of keywords) {
      const cacheKey = `kw_${cacheRegion}_${kw.toLowerCase().replace(/\s+/g, '_')}`;
      let cached = readCache<KeywordMetrics>(workspaceId, cacheKey, CACHE_TTL_KEYWORD);
      if (!cached && useLegacyRegionFallback) {
        const legacyCacheKey = `kw_${legacyRegion}_${kw.toLowerCase().replace(/\s+/g, '_')}`;
        cached = readCache<KeywordMetrics>(workspaceId, legacyCacheKey, CACHE_TTL_KEYWORD);
        if (cached) writeCache(workspaceId, cacheKey, cached);
      }
      if (cached) {
        results.push(cached);
        logCreditUsage({ credits: 0, endpoint: 'search_volume', query: kw, rowsReturned: 1, workspaceId, cached: true });
      } else {
        uncached.push(kw);
      }
    }

    if (uncached.length === 0) return results;

    // L1: Check global SQLite cache for keywords that missed L2
    let globalHits: Map<string, KeywordMetrics>;
    try {
      const rawHits = getCachedMetricsBatch(uncached, cacheRegion, CACHE_TTL_KEYWORD);
      globalHits = rawHits as Map<string, KeywordMetrics>;
    } catch (err) {
      log.warn({ err }, 'DataForSEO L1 cache lookup failed — falling through to API');
      globalHits = new Map();
    }
    const stillUncached: string[] = [];
    for (const kw of uncached) {
      const hit = globalHits.get(keywordComparisonKey(kw));
      if (hit) {
        results.push(hit);
        logCreditUsage({ credits: 0, endpoint: 'search_volume', query: kw, rowsReturned: 1, workspaceId, cached: true });
      } else {
        stillUncached.push(kw);
      }
    }

    if (stillUncached.length > 0 && useLegacyRegionFallback) {
      try {
        const rawLegacyHits = getCachedMetricsBatch([...stillUncached], legacyRegion, CACHE_TTL_KEYWORD);
        const legacyHits = rawLegacyHits as Map<string, KeywordMetrics>;
        const legacyBackfill: KeywordMetrics[] = [];
        for (let i = stillUncached.length - 1; i >= 0; i--) {
          const kw = stillUncached[i];
          const hit = legacyHits.get(keywordComparisonKey(kw));
          if (!hit) continue;
          results.push(hit);
          legacyBackfill.push(hit);
          stillUncached.splice(i, 1);
          logCreditUsage({ credits: 0, endpoint: 'search_volume', query: kw, rowsReturned: 1, workspaceId, cached: true });
        }
        cacheMetricsBatch(legacyBackfill, cacheRegion);
      } catch (err) {
        log.warn({ err }, 'DataForSEO legacy L1 cache lookup failed — falling through to API');
      }
    }

    if (stillUncached.length === 0 || areCreditsExhausted()) return results;

    // Batch up to 1000 per request
    const batches: string[][] = [];
    for (let i = 0; i < stillUncached.length; i += 1000) {
      batches.push(stillUncached.slice(i, i + 1000));
    }

    for (const batch of batches) {
      try {
        const [volumeJson, kdJson] = await Promise.all([
          apiCall('keywords_data/google_ads/search_volume/live', [{
            keywords: batch,
            location_code: resolvedLocationCode,
            language_code: lang,
          }], workspaceId),
          apiCall('dataforseo_labs/google/keyword_difficulty/live', [{
            keywords: batch,
            location_code: resolvedLocationCode,
            language_code: lang,
          }], workspaceId).catch(() => null),   // graceful fallback if KD endpoint unavailable
        ]);

        // Build KD lookup map
        const kdMap = new Map<string, number>();
        if (kdJson) {
          const kdResults = getTaskResult(kdJson);
          for (const item of kdResults) {
            const kw = item.keyword as string;
            const kd = item.keyword_difficulty as number;
            if (kw && typeof kd === 'number') kdMap.set(kw.toLowerCase(), kd);
          }
          const kdCost = getTaskCost(kdJson);
          if (kdCost > 0) {
            logCreditUsage({ credits: kdCost, endpoint: 'keyword_difficulty', query: batch.join(',').slice(0, 100), rowsReturned: kdResults.length, workspaceId, cached: false });
          }
        }

        const taskResults = getTaskResult(volumeJson);
        const cost = getTaskCost(volumeJson);
        const batchResults: KeywordMetrics[] = [];

        for (const item of taskResults) {
          const keyword = item.keyword as string;
          const searchVolume = (item.search_volume as number) ?? 0;
          const competitionIndex = (item.competition_index as number) ?? 0;
          const cpc = (item.cpc as number) ?? 0;
          const competition = (item.competition as number) ?? 0;
          const monthlies = item.monthly_searches as Array<{ search_volume: number }> | undefined;
          const trend = monthlies ? monthlies.map(m => m.search_volume ?? 0) : [];

          const metrics: KeywordMetrics = {
            keyword,
            volume: searchVolume,
            difficulty: kdMap.get(keyword.toLowerCase()) ?? competitionIndex,
            cpc,
            competition: typeof competition === 'number' ? competition : 0,
            results: 0, // DataForSEO doesn't provide this in this endpoint
            trend,
          };

          results.push(metrics);
          batchResults.push(metrics);
          const cacheKey = `kw_${cacheRegion}_${keyword.toLowerCase().replace(/\s+/g, '_')}`;
          writeCache(workspaceId, cacheKey, metrics);
        }

        cacheMetricsBatch(batchResults, cacheRegion);
        logCreditUsage({ credits: cost, endpoint: 'search_volume', query: batch.join(',').slice(0, 100), rowsReturned: taskResults.length, workspaceId, cached: false });
      } catch (err) {
        log.error({ err }, 'DataForSEO search_volume error');
      }
    }

    return results;
  }

  // ── getRelatedKeywords → related_keywords ──
  async getRelatedKeywords(keyword: string, workspaceId: string, limit = 20, database = 'us', locationCode?: number, languageCode?: string): Promise<RelatedKeyword[]> {
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    const cacheKey = `related_${cacheRegionToken(discoveryGeoToken(database, locationCode), lang)}_${keyword.toLowerCase().replace(/\s+/g, '_')}_${limit}`;
    return runDataForSeoOperation<RelatedKeyword[]>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_RELATED,
      endpointLabel: 'related_keywords',
      query: keyword,
      emptyValue: [],
      endpoint: 'dataforseo_labs/google/related_keywords/live',
      body: [{
        keyword,
        location_code: resolvedLocationCode,
        language_code: lang,
        limit,
        depth: 1,
        include_seed_keyword: false,
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
        const results: RelatedKeyword[] = items.map(item => {
          const kwData = item.keyword_data as Record<string, unknown> | undefined;
          const kwInfo = kwData?.keyword_info as Record<string, unknown> | undefined;
          return {
            keyword: (kwData?.keyword as string) ?? '',
            volume: (kwInfo?.search_volume as number) ?? 0,
            difficulty: (kwInfo?.keyword_difficulty as number) ?? Math.round(((kwInfo?.competition as number) ?? 0) * 100),
            cpc: (kwInfo?.cpc as number) ?? 0,
          };
        });
        return { value: results, rowsReturned: results.length };
      },
      handleError: (err) => {
        log.error({ err }, `DataForSEO related_keywords error for "${keyword}"`);
        return [];
      },
    });
  }

  // ── getQuestionKeywords → keyword_suggestions (filtered) ──
  async getQuestionKeywords(keyword: string, workspaceId: string, limit = 20, database = 'us', locationCode?: number, languageCode?: string): Promise<QuestionKeyword[]> {
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    const cacheKey = `questions_${cacheRegionToken(discoveryGeoToken(database, locationCode), lang)}_${keyword.toLowerCase().replace(/\s+/g, '_')}_${limit}`;
    return runDataForSeoOperation<QuestionKeyword[]>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_RELATED,
      endpointLabel: 'keyword_suggestions',
      query: keyword,
      emptyValue: [],
      endpoint: 'dataforseo_labs/google/keyword_suggestions/live',
      body: [{
        keyword,
        location_code: resolvedLocationCode,
        language_code: lang,
        limit,
        filters: ['keyword', 'regex', '^(how|what|why|when|where|who|which|can|does|is|are|do|will|should) '],
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
        const results: QuestionKeyword[] = items.map(item => {
          const kwData = item.keyword_data as Record<string, unknown> | undefined;
          const kwInfo = kwData?.keyword_info as Record<string, unknown> | undefined;
          return {
            keyword: (kwData?.keyword as string) ?? '',
            volume: (kwInfo?.search_volume as number) ?? 0,
            difficulty: (kwInfo?.keyword_difficulty as number) ?? Math.round(((kwInfo?.competition as number) ?? 0) * 100),
            cpc: (kwInfo?.cpc as number) ?? 0,
          };
        });
        return { value: results, rowsReturned: results.length };
      },
      handleError: (err) => {
        log.error({ err }, `DataForSEO keyword_suggestions error for "${keyword}"`);
        return [];
      },
    });
  }

  async getKeywordSuggestions(keyword: string, workspaceId: string, limit = 25, database = 'us', locationCode?: number, languageCode?: string): Promise<KeywordSourceEvidence[]> {
    const seed = keyword.toLowerCase().trim();
    if (!seed) return [];
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    const cappedLimit = Math.min(Math.max(limit, 1), 100);
    const cacheKey = `discovery_suggestions_${cacheRegionToken(discoveryGeoToken(database, locationCode), lang)}_${cacheKeyPart(seed)}_${cappedLimit}`;
    return runDataForSeoOperation<KeywordSourceEvidence[]>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_DISCOVERY,
      endpointLabel: 'keyword_suggestions_general',
      query: seed,
      emptyValue: [],
      endpoint: 'dataforseo_labs/google/keyword_suggestions/live',
      body: [{
        keyword: seed,
        location_code: resolvedLocationCode,
        language_code: lang,
        limit: cappedLimit,
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
        const results = evidenceFromKeywordDataItems(items, {
          provider: this.name,
          sourceKind: KEYWORD_SOURCE_KIND.KEYWORD_SUGGESTIONS,
          seed,
          confidence: 'medium',
        });
        return { value: results, rowsReturned: results.length };
      },
      handleError: (err) => {
        log.error({ err }, `DataForSEO keyword_suggestions discovery error for "${seed}"`);
        return [];
      },
    });
  }

  async getKeywordIdeas(keywords: string[], workspaceId: string, limit = 50, database = 'us', locationCode?: number, languageCode?: string): Promise<KeywordSourceEvidence[]> {
    const seeds = normalizeSeedKeywords(keywords, 10);
    if (seeds.length === 0) return [];
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const cacheKey = `discovery_ideas_${cacheRegionToken(discoveryGeoToken(database, locationCode), lang)}_${cacheKeyPart(seeds.join('_'))}_${cappedLimit}`;
    const query = seeds.join(',').slice(0, 100);
    return runDataForSeoOperation<KeywordSourceEvidence[]>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_DISCOVERY,
      endpointLabel: 'keyword_ideas',
      query,
      emptyValue: [],
      endpoint: 'dataforseo_labs/google/keyword_ideas/live',
      body: [{
        keywords: seeds,
        location_code: resolvedLocationCode,
        language_code: lang,
        limit: cappedLimit,
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
        const results = evidenceFromKeywordDataItems(items, {
          provider: this.name,
          sourceKind: KEYWORD_SOURCE_KIND.KEYWORD_IDEAS,
          seed: seeds.join(', '),
          confidence: 'medium',
        });
        return { value: results, rowsReturned: results.length };
      },
      handleError: (err) => {
        log.error({ err }, `DataForSEO keyword_ideas error for "${seeds.join(', ')}"`);
        return [];
      },
    });
  }

  async getKeywordsForSite(target: string, workspaceId: string, limit = 50, database = 'us', locationCode?: number, languageCode?: string): Promise<KeywordSourceEvidence[]> {
    const cleanTarget = cleanDomain(target);
    if (!cleanTarget) return [];
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const cacheKey = `discovery_site_${cacheRegionToken(discoveryGeoToken(database, locationCode), lang)}_${cacheKeyPart(cleanTarget)}_${cappedLimit}`;
    return runDataForSeoOperation<KeywordSourceEvidence[]>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_DISCOVERY,
      endpointLabel: 'keywords_for_site',
      query: cleanTarget,
      emptyValue: [],
      endpoint: 'dataforseo_labs/google/keywords_for_site/live',
      body: [{
        target: cleanTarget,
        location_code: resolvedLocationCode,
        language_code: lang,
        limit: cappedLimit,
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
        const results = evidenceFromKeywordDataItems(items, {
          provider: this.name,
          sourceKind: KEYWORD_SOURCE_KIND.KEYWORDS_FOR_SITE,
          sourceTarget: cleanTarget,
          confidence: 'high',
        });
        return { value: results, rowsReturned: results.length };
      },
      handleError: (err) => {
        log.error({ err }, `DataForSEO keywords_for_site error for "${cleanTarget}"`);
        return [];
      },
    });
  }

  async getKeywordsForKeywords(keywords: string[], workspaceId: string, limit = 50, database = 'us', locationCode?: number, languageCode?: string): Promise<KeywordSourceEvidence[]> {
    const seeds = normalizeSeedKeywords(keywords, 20);
    if (seeds.length === 0) return [];
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const cacheKey = `google_ads_keywords_${domainGeoToken(database, locationCode, lang)}_${cacheKeyPart(seeds.join('_'))}_${cappedLimit}`;
    const query = seeds.join(',').slice(0, 100);
    return runDataForSeoOperation<KeywordSourceEvidence[]>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_DISCOVERY,
      endpointLabel: 'keywords_for_keywords',
      query,
      emptyValue: [],
      endpoint: 'keywords_data/google_ads/keywords_for_keywords/live',
      body: [{
        keywords: seeds,
        location_code: resolvedLocationCode,
        language_code: lang,
        sort_by: 'relevance',
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const rawItems = taskResults[0]?.items as Array<Record<string, unknown>> | undefined;
        const items = rawItems ?? taskResults;
        const seen = new Set<string>();
        const results: KeywordSourceEvidence[] = [];
        for (const item of items.slice(0, cappedLimit)) {
          const evidence = evidenceFromGoogleAdsKeywordItem(item, {
            provider: this.name,
            sourceKind: KEYWORD_SOURCE_KIND.GOOGLE_ADS_KEYWORDS_FOR_KEYWORDS,
            seed: seeds.join(', '),
            confidence: 'medium',
          });
          if (!evidence) continue;
          const normalized = evidence.keyword.toLowerCase();
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          results.push(evidence);
        }
        return { value: results, rowsReturned: results.length };
      },
      handleError: (err) => {
        log.error({ err }, `DataForSEO keywords_for_keywords error for "${seeds.join(', ')}"`);
        return [];
      },
    });
  }

  async resolveLocalSeoLocation(request: LocalSeoLocationLookupRequest, workspaceId: string): Promise<LocalSeoLocationLookupResponse> {
    const countryIso = countryIsoForLocations(request.country);
    const cacheKey = ['local_locations', countryIso ?? 'all'].join('_');
    let rows = readCache<DataForSeoLocationRow[]>(workspaceId, cacheKey, CACHE_TTL_LOCAL_LOCATIONS);

    try {
      if (!rows) {
        const endpoint = countryIso ? `serp/google/locations/${countryIso}` : 'serp/google/locations';
        const json = await apiGet(endpoint, workspaceId);
        rows = getTaskResult(json) as DataForSeoLocationRow[];
        writeCache(workspaceId, cacheKey, rows);
        logCreditUsage({ credits: 0, endpoint: 'local_location_lookup', query: countryIso ?? 'all', rowsReturned: rows.length, workspaceId, cached: false });
      } else {
        logCreditUsage({ credits: 0, endpoint: 'local_location_lookup', query: countryIso ?? 'all', rowsReturned: rows.length, workspaceId, cached: true });
      }

      const candidates = rows
        .map(row => normalizeLocationCandidate(row, request))
        .filter((candidate): candidate is LocalSeoLocationLookupCandidate => candidate !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      const bestCandidate = candidates[0];
      if (!bestCandidate) {
        return {
          query: request,
          status: LOCAL_SEO_LOCATION_LOOKUP_STATUS.NOT_FOUND,
          candidates: [],
          degradedReason: 'No matching DataForSEO location found for this market.',
        };
      }

      const status = bestCandidate.score >= 95 || candidates.length === 1
        ? LOCAL_SEO_LOCATION_LOOKUP_STATUS.MATCHED
        : LOCAL_SEO_LOCATION_LOOKUP_STATUS.AMBIGUOUS;
      return {
        query: request,
        status,
        candidates,
        bestCandidate,
      };
    } catch (err) {
      log.error({ err, request }, 'DataForSEO local location lookup error');
      return {
        query: request,
        status: LOCAL_SEO_LOCATION_LOOKUP_STATUS.PROVIDER_FAILED,
        candidates: [],
        degradedReason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getLocalVisibility(request: LocalVisibilityProviderRequest, workspaceId: string): Promise<LocalVisibilityProviderResult> {
    const keyword = request.keyword.trim();
    const market = request.market;
    const device = request.device === LOCAL_SEO_DEVICE.MOBILE ? LOCAL_SEO_DEVICE.MOBILE : LOCAL_SEO_DEVICE.DESKTOP;
    const languageCode = request.languageCode || 'en';
    const sourceEndpoint = LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP;
    const capturedAt = new Date().toISOString();
    const cacheKey = [
      'local_visibility',
      cacheKeyPart(keyword),
      market.id,
      cacheKeyPart(localVisibilityLocationIdentity(market)),
      device,
      languageCode,
      sourceEndpoint,
    ].join('_');
    const cached = readCache<LocalVisibilityProviderResult>(workspaceId, cacheKey, CACHE_TTL_LOCAL_VISIBILITY);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'local_visibility_google_organic_serp', query: `${keyword} @ ${market.label}`, rowsReturned: cached.results.length, workspaceId, cached: true });
      return { ...cached, capturedAt };
    }

    if (areCreditsExhausted()) {
      return {
        keyword,
        marketId: market.id,
        provider: this.name,
        sourceEndpoint,
        capturedAt,
        localPackPresent: false,
        results: [],
        status: LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
        degradedReason: 'DataForSEO credits are temporarily exhausted',
      };
    }

    try {
      const locationSelector = market.providerLocationCode
        ? { location_code: market.providerLocationCode }
        : market.providerLocationName
          ? { location_name: market.providerLocationName }
          : typeof market.latitude === 'number' && typeof market.longitude === 'number'
            ? { location_coordinate: `${market.latitude},${market.longitude},200` }
            : null;
      if (!locationSelector) {
        throw new Error('Local visibility requires a DataForSEO location code, location name, or coordinates');
      }
      const json = await apiCall('serp/google/organic/live/advanced', [{
        keyword,
        ...locationSelector,
        language_code: languageCode,
        device,
        depth: Math.max(10, Math.min(request.maxResults, 20)),
      }], workspaceId);
      const result = getTaskResult(json)[0] ?? {};
      const localResults = extractLocalPackItems(result).slice(0, request.maxResults);
      const localPackPresent = localResults.length > 0
        || (Array.isArray(result.items) && (result.items as Array<Record<string, unknown>>).some(item => stringFromUnknown(item.type) === 'local_pack'));
      const payload: LocalVisibilityProviderResult = {
        keyword,
        marketId: market.id,
        provider: this.name,
        sourceEndpoint,
        capturedAt,
        localPackPresent,
        results: localResults,
        status: LOCAL_VISIBILITY_STATUS.SUCCESS,
      };
      const cost = getTaskCost(json);
      logCreditUsage({ credits: cost, endpoint: 'local_visibility_google_organic_serp', query: `${keyword} @ ${market.label}`, rowsReturned: localResults.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, payload);
      return payload;
    } catch (err) {
      log.error({ err, keyword, marketId: market.id }, 'DataForSEO local visibility error');
      return {
        keyword,
        marketId: market.id,
        provider: this.name,
        sourceEndpoint,
        capturedAt,
        localPackPresent: false,
        results: [],
        status: LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
        degradedReason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── getDomainKeywords → ranked_keywords ──
  async getDomainKeywords(domain: string, workspaceId: string, limit = 100, database = 'us', locationCode?: number, languageCode?: string): Promise<DomainKeyword[]> {
    const target = cleanDomain(domain);
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    const cacheKey = `domain_ranked_${domainGeoToken(database, locationCode, lang)}_${target.replace(/\./g, '_')}_${limit}_vol`;
    return runDataForSeoOperation<DomainKeyword[]>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_DOMAIN_ORGANIC,
      endpointLabel: 'ranked_keywords',
      query: target,
      emptyValue: [],
      endpoint: 'dataforseo_labs/google/ranked_keywords/live',
      body: [{
        target,
        location_code: resolvedLocationCode,
        language_code: lang,
        limit,
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
        const serpFeaturesMap = new Map<string, Set<string>>();
        for (const item of items) {
          const kwData = item.keyword_data as Record<string, unknown> | undefined;
          const keyword = (kwData?.keyword as string) ?? '';
          const serpElement = item.ranked_serp_element as Record<string, unknown> | undefined;
          const serpItem = serpElement?.serp_item as Record<string, unknown> | undefined;
          const itemType = (serpItem?.type as string) ?? 'organic';
          if (keyword && itemType !== 'organic') {
            if (!serpFeaturesMap.has(keyword)) serpFeaturesMap.set(keyword, new Set());
            const normalizedType = itemType === 'videos' ? 'video' : itemType;
            serpFeaturesMap.get(keyword)!.add(normalizedType);
          }
        }

        const seen = new Set<string>();
        const results: DomainKeyword[] = [];
        for (const item of items) {
          const kwData = item.keyword_data as Record<string, unknown> | undefined;
          const kwInfo = kwData?.keyword_info as Record<string, unknown> | undefined;
          const serpElement = item.ranked_serp_element as Record<string, unknown> | undefined;
          const serpItem = serpElement?.serp_item as Record<string, unknown> | undefined;
          const itemType = (serpItem?.type as string) ?? 'organic';
          const keyword = (kwData?.keyword as string) ?? '';
          if (itemType !== 'organic' || seen.has(keyword)) continue;
          seen.add(keyword);

          const monthlies = kwInfo?.monthly_searches as Array<{ search_volume: number }> | undefined;
          const features = serpFeaturesMap.get(keyword);
          results.push({
            keyword,
            position: (serpItem?.rank_group as number) ?? 0,
            volume: (kwInfo?.search_volume as number) ?? 0,
            difficulty: (kwInfo?.keyword_difficulty as number) ?? Math.round(((kwInfo?.competition as number) ?? 0) * 100),
            cpc: (kwInfo?.cpc as number) ?? 0,
            url: (serpItem?.url as string) ?? '',
            traffic: (serpItem?.etv as number) ?? 0,
            trafficPercent: 0,
            trend: monthlies ? monthlies.map(m => m.search_volume ?? 0) : undefined,
            serpFeatures: features ? [...features].join(',') : undefined,
          });
        }
        return { value: results, rowsReturned: results.length };
      },
      handleError: (err) => {
        log.error({ err }, `DataForSEO ranked_keywords error for "${target}"`);
        return [];
      },
    });
  }

  async getUrlKeywords(url: string, workspaceId: string, limit = 20, database = 'us', locationCode?: number, languageCode?: string): Promise<DomainKeyword[]> {
    const target = cleanUrlTarget(url);
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    const cacheKey = `url_ranked_${domainGeoToken(database, locationCode, lang)}_${target.replace(/[^a-zA-Z0-9_-]/g, '_')}_${limit}`;
    return runDataForSeoOperation<DomainKeyword[]>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_DOMAIN_ORGANIC,
      endpointLabel: 'ranked_keywords_url',
      query: target,
      emptyValue: [],
      endpoint: 'dataforseo_labs/google/ranked_keywords/live',
      body: [{
        target,
        location_code: resolvedLocationCode,
        language_code: lang,
        limit,
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
        const results: DomainKeyword[] = [];
        const seen = new Set<string>();
        for (const item of items) {
          const kwData = item.keyword_data as Record<string, unknown> | undefined;
          const kwInfo = kwData?.keyword_info as Record<string, unknown> | undefined;
          const serpElement = item.ranked_serp_element as Record<string, unknown> | undefined;
          const serpItem = serpElement?.serp_item as Record<string, unknown> | undefined;
          const itemType = (serpItem?.type as string) ?? 'organic';
          const keyword = (kwData?.keyword as string) ?? '';
          if (itemType !== 'organic' || !keyword || seen.has(keyword)) continue;
          seen.add(keyword);
          const monthlies = kwInfo?.monthly_searches as Array<{ search_volume: number }> | undefined;
          results.push({
            keyword,
            position: (serpItem?.rank_group as number) ?? 0,
            volume: (kwInfo?.search_volume as number) ?? 0,
            difficulty: (kwInfo?.keyword_difficulty as number) ?? Math.round(((kwInfo?.competition as number) ?? 0) * 100),
            cpc: (kwInfo?.cpc as number) ?? 0,
            url: (serpItem?.url as string) ?? target,
            traffic: (serpItem?.etv as number) ?? 0,
            trafficPercent: 0,
            trend: monthlies ? monthlies.map(m => m.search_volume ?? 0) : undefined,
          });
        }
        return { value: results, rowsReturned: results.length };
      },
      handleError: (err) => {
        log.error({ err }, `DataForSEO URL ranked_keywords error for "${target}"`);
        return [];
      },
    });
  }

  // ── getDomainOverview → ranked_keywords with limit=1 (only `metrics` aggregate is read) ──
  async getDomainOverview(domain: string, workspaceId: string, database = 'us', locationCode?: number, languageCode?: string): Promise<DomainOverview | null> {
    const target = cleanDomain(domain);
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    const cacheKey = `domain_overview_${domainGeoToken(database, locationCode, lang)}_${target.replace(/\./g, '_')}`;
    return runDataForSeoOperation<DomainOverview | null>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_DOMAIN_OVERVIEW,
      endpointLabel: 'ranked_keywords_overview',
      query: target,
      emptyValue: null,
      endpoint: 'dataforseo_labs/google/ranked_keywords/live',
      body: [{
        target,
        location_code: resolvedLocationCode,
        language_code: lang,
        limit: 1,
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const resultObj = taskResults[0] ?? {};
        const metrics = resultObj.metrics as Record<string, Record<string, number>> | undefined;
        const organic = metrics?.organic;
        if (!organic) {
          log.info(`No domain overview data for "${target}"`);
          return { value: null, cacheable: false, logCreditUsage: false };
        }
        const overview: DomainOverview = {
          domain: target,
          organicKeywords: organic.count ?? 0,
          organicTraffic: Math.round(organic.etv ?? 0),
          organicCost: organic.estimated_paid_traffic_cost ?? 0,
          paidKeywords: metrics?.paid?.count ?? 0,
          paidTraffic: Math.round(metrics?.paid?.etv ?? 0),
          paidCost: metrics?.paid?.estimated_paid_traffic_cost ?? 0,
        };
        return { value: overview, rowsReturned: 1 };
      },
      handleError: (err) => {
        log.error({ err }, `DataForSEO domain overview error for "${target}"`);
        return null;
      },
    });
  }

  // ── getCompetitors → competitors_domain ──
  async getCompetitors(domain: string, workspaceId: string, limit = 10, database = 'us', locationCode?: number, languageCode?: string): Promise<OrganicCompetitor[]> {
    const target = cleanDomain(domain);
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const lang = normalizeLanguageCode(languageCode);
    const cacheKey = `competitors_${domainGeoToken(database, locationCode, lang)}_${target.replace(/\./g, '_')}_${limit}`;
    return runDataForSeoOperation<OrganicCompetitor[]>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_COMPETITORS,
      endpointLabel: 'competitors_domain',
      query: target,
      emptyValue: [],
      endpoint: 'dataforseo_labs/google/competitors_domain/live',
      body: [{
        target,
        location_code: resolvedLocationCode,
        language_code: lang,
        limit,
        item_types: ['organic'],
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
        const results: OrganicCompetitor[] = items.map(item => {
          const fullMetrics = item.full_domain_metrics as Record<string, Record<string, number>> | undefined;
          const organic = fullMetrics?.organic;
          const avgPos = (item.avg_position as number) ?? 50;
          const relevance = Math.max(0, Math.min(100, Math.round(100 - avgPos)));
          return {
            domain: (item.domain as string) ?? '',
            competitorRelevance: relevance,
            commonKeywords: (item.intersections as number) ?? 0,
            organicKeywords: organic?.count ?? 0,
            organicTraffic: Math.round(organic?.etv ?? 0),
            organicCost: organic?.estimated_paid_traffic_cost ?? 0,
          };
        }).filter(r => r.domain);
        return { value: results, rowsReturned: results.length };
      },
      handleError: (err) => {
        log.error({ err }, `DataForSEO competitors_domain error for "${target}"`);
        return [];
      },
      afterNetworkSuccess: (results) => {
        if (results.length > 0) {
          log.info(`Found ${results.length} competitors for "${target}"`);
        }
      },
    });
  }

  // ── getKeywordGap — same approach as semrush: compare domain keywords ──
  async getKeywordGap(clientDomain: string, competitorDomains: string[], workspaceId: string, limit = 50, database = 'us', locationCode?: number, languageCode?: string): Promise<KeywordGapEntry[]> {
    // Geo is threaded entirely via the nested getDomainKeywords calls (gap has no own
    // request body); both the client and competitor domains are queried in the CLIENT's
    // market. `lang` only feeds the gap cache key (byte-identical on flag-OFF).
    const lang = normalizeLanguageCode(languageCode);
    const allGaps: KeywordGapEntry[] = [];
    let clientKwSet: Set<string> | null = null;

    const getClientKeywordSet = async (): Promise<Set<string>> => {
      if (!clientKwSet) {
        const clientKeywords = await this.getDomainKeywords(clientDomain, workspaceId, 200, database, locationCode, languageCode);
        clientKwSet = new Set(clientKeywords.map(k => k.keyword.toLowerCase()));
      }
      return clientKwSet;
    };

    for (const comp of competitorDomains.slice(0, MAX_COMPETITORS)) {
      const cleanComp = cleanDomain(comp);
      const cacheKey = `gap_${domainGeoToken(database, locationCode, lang)}_${cleanDomain(clientDomain).replace(/\./g, '_')}_vs_${cleanComp.replace(/\./g, '_')}_${limit}_comp${KEYWORD_GAP_COMPETITOR_KEYWORD_LIMIT}`;
      const cached = readCache<KeywordGapEntry[]>(workspaceId, cacheKey, CACHE_TTL_DOMAIN_ORGANIC);

      if (cached) {
        allGaps.push(...cached);
        continue;
      }

      try {
        const compKeywords = await this.getDomainKeywords(cleanComp, workspaceId, KEYWORD_GAP_COMPETITOR_KEYWORD_LIMIT, database, locationCode, languageCode);
        const clientKeywords = await getClientKeywordSet();

        const gaps: KeywordGapEntry[] = compKeywords
          .filter(ck => !clientKeywords.has(ck.keyword.toLowerCase()))
          .filter(ck => ck.volume > 0)
          .sort((a, b) => b.volume - a.volume)
          .slice(0, limit)
          .map(ck => ({
            keyword: ck.keyword,
            volume: ck.volume,
            difficulty: ck.difficulty,
            competitorPosition: ck.position,
            competitorDomain: cleanComp,
          }));

        writeCache(workspaceId, cacheKey, gaps);
        allGaps.push(...gaps);
      } catch (err) {
        log.error({ err }, `DataForSEO gap analysis error for ${cleanComp}`);
      }
    }

    // Deduplicate and sort by volume
    const seen = new Set<string>();
    return allGaps
      .filter(g => { if (seen.has(g.keyword.toLowerCase())) return false; seen.add(g.keyword.toLowerCase()); return true; })
      .sort((a, b) => b.volume - a.volume);
  }

  // ── getBacklinksOverview → backlinks/summary ──
  async getBacklinksOverview(domain: string, workspaceId: string, _database = 'us'): Promise<BacklinksOverview | null> {
    const target = cleanDomain(domain);
    const cacheKey = `backlinks_overview_${target.replace(/\./g, '_')}`;
    return runDataForSeoOperation<BacklinksOverview | null>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_BACKLINKS,
      endpointLabel: 'backlinks_summary',
      query: target,
      emptyValue: null,
      endpoint: 'backlinks/summary/live',
      body: [{
        target,
        include_subdomains: true,
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const data = taskResults[0] as Record<string, unknown> | undefined;
        if (!data) {
          log.info(`No backlink data for "${target}"`);
          return { value: null, cacheable: false, logCreditUsage: false };
        }
        const totalBacklinks = (data.backlinks as number) ?? 0;
        const refLinksTypes = data.referring_links_types as Record<string, number> | undefined;
        const nofollowLinks = (data.referring_pages_nofollow as number | undefined)
          ?? (data.referring_domains_nofollow as number | undefined)
          ?? 0;
        const overview: BacklinksOverview = {
          totalBacklinks,
          referringDomains: (data.referring_domains as number) ?? 0,
          followLinks: Math.max(0, totalBacklinks - nofollowLinks),
          nofollowLinks,
          textLinks: refLinksTypes?.anchor ?? 0,
          imageLinks: refLinksTypes?.image ?? 0,
          formLinks: refLinksTypes?.form ?? 0,
          frameLinks: refLinksTypes?.frame ?? 0,
        };
        return { value: overview, rowsReturned: 1 };
      },
      handleError: (err) => {
        if (isSubscriptionError(err)) {
          markCapabilityDisabled('dataforseo', 'backlinks', BACKLINKS_BREAKER_TTL_MS);
          log.warn({ err }, `DataForSEO backlinks summary unavailable for "${target}"`);
          return null;
        }
        log.error({ err }, `DataForSEO backlinks summary error for "${target}"`);
        return null;
      },
    });
  }

  // ── getReferringDomains → backlinks/referring_domains ──
  async getReferringDomains(domain: string, workspaceId: string, limit = 20, _database = 'us'): Promise<ReferringDomain[]> {
    const target = cleanDomain(domain);
    const cacheKey = `backlinks_refdomains_${target.replace(/\./g, '_')}_${limit}`;
    return runDataForSeoOperation<ReferringDomain[]>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_BACKLINKS,
      endpointLabel: 'backlinks_referring_domains',
      query: target,
      emptyValue: [],
      endpoint: 'backlinks/referring_domains/live',
      body: [{
        target,
        limit,
        include_subdomains: true,
        order_by: ['rank,desc'],
      }],
      mapResult: (json) => {
        const taskResults = getTaskResult(json);
        const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
        const results: ReferringDomain[] = items.map(item => {
          const lastVisited = item.last_visited as string | undefined;
          const firstSeen = item.first_seen as string | undefined;
          return {
            domain: (item.domain as string) ?? '',
            backlinksCount: (item.backlinks as number) ?? 0,
            firstSeen: normalizeProviderDate(firstSeen ?? ''),
            lastSeen: normalizeProviderDate(lastVisited ?? firstSeen ?? ''),
          };
        });
        return { value: results, rowsReturned: results.length };
      },
      handleError: (err) => {
        if (isSubscriptionError(err)) {
          markCapabilityDisabled('dataforseo', 'backlinks', BACKLINKS_BREAKER_TTL_MS);
          log.warn({ err }, `DataForSEO referring domains unavailable for "${target}"`);
          return [];
        }
        log.error({ err }, `DataForSEO referring domains error for "${target}"`);
        return [];
      },
    });
  }

  // ── getNationalSerp → serp/google/organic/live/advanced (P6 national-serp-tracking) ──
  async getNationalSerp(request: NationalSerpProviderRequest, workspaceId: string): Promise<NationalSerpResult> {
    const keyword = request.keyword.trim();
    const ownerDomain = request.ownerDomain;
    const locationCode = request.locationCode ?? locationCodeFromDatabase('us');
    const languageCode = request.languageCode ?? 'en';
    const device = request.device ?? 'desktop';
    const emptyResult: NationalSerpResult = {
      query: keyword,
      position: null,
      matchedUrl: null,
      features: [],
      aiOverviewPresent: false,
      aiOverviewCited: null,
    };
    const cacheKey = [
      'national_serp',
      cacheKeyPart(keyword),
      cacheKeyPart(cleanDomain(ownerDomain)),
      locationCode,
      languageCode,
      device,
    ].join('_');

    return runDataForSeoOperation<NationalSerpResult>({
      workspaceId,
      cacheKey,
      cacheTtlHours: CACHE_TTL_NATIONAL_SERP,
      endpointLabel: 'national_serp_google_organic_advanced',
      query: keyword,
      emptyValue: emptyResult,
      endpoint: 'serp/google/organic/live/advanced',
      body: [{
        keyword,
        location_code: locationCode,
        language_code: languageCode,
        device,
      }],
      mapResult: (json) => {
        const result = getTaskResult(json)[0];
        const items = Array.isArray(result?.items) ? (result.items as unknown[]) : [];
        const value = parseNationalSerp(items, ownerDomain, keyword);
        return { value, rowsReturned: value.position !== null ? 1 : 0 };
      },
      handleError: (err) => {
        log.error({ err, keyword, ownerDomain }, `DataForSEO national SERP error for "${keyword}"`);
        return emptyResult;
      },
    });
  }
}

// ── Usage summary (mirrors semrush pattern) ──

function loadCreditsFromDisk(since?: string, days?: number): CreditEntry[] {
  flushCreditsToDisk();
  const cutoffDate = since
    ? since.slice(0, 10)
    : days
      ? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); })()
      : '0000';
  try {
    const files = fs.readdirSync(CREDIT_DIR)
      .filter(f => f.endsWith('.json') && f.replace('.json', '') >= cutoffDate)
      .sort();
    const entries: CreditEntry[] = [];
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CREDIT_DIR, f), 'utf-8'));
        if (Array.isArray(data)) entries.push(...data);
      } catch { /* skip corrupt file */ }
    }
    return entries;
  } catch { return []; }
}

export function getDataForSeoUsage(workspaceId?: string, since?: string): {
  totalCredits: number;
  totalCalls: number;
  cachedCalls: number;
  entries: CreditEntry[];
} {
  let entries = loadCreditsFromDisk(since);
  if (workspaceId) entries = entries.filter(e => e.workspaceId === workspaceId);
  if (since) entries = entries.filter(e => e.timestamp >= since);
  return {
    totalCredits: entries.reduce((s, e) => s + e.credits, 0),
    totalCalls: entries.length,
    cachedCalls: entries.filter(e => e.cached).length,
    entries,
  };
}

export function getDataForSeoByDay(workspaceId?: string, days = 30): Array<{
  date: string; credits: number; calls: number; cachedCalls: number;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const since = cutoff.toISOString();

  let entries = loadCreditsFromDisk(since, days);
  if (workspaceId) entries = entries.filter(e => e.workspaceId === workspaceId);

  const byDay = new Map<string, { credits: number; calls: number; cachedCalls: number }>();
  for (const e of entries) {
    const day = e.timestamp.slice(0, 10);
    const existing = byDay.get(day) || { credits: 0, calls: 0, cachedCalls: 0 };
    existing.credits += e.credits;
    existing.calls += 1;
    if (e.cached) existing.cachedCalls += 1;
    byDay.set(day, existing);
  }

  const result: Array<{ date: string; credits: number; calls: number; cachedCalls: number }> = [];
  const d = new Date(cutoff);
  const today = new Date();
  while (d <= today) {
    const dayStr = d.toISOString().slice(0, 10);
    result.push({ date: dayStr, ...(byDay.get(dayStr) || { credits: 0, calls: 0, cachedCalls: 0 }) });
    d.setDate(d.getDate() + 1);
  }
  return result;
}
