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
} from '../seo-data-provider.js';
import { markCapabilityDisabled, normalizeProviderDate } from '../seo-data-provider.js';
import { fetchProviderJson, isExternalFetchError } from '../external-fetch.js';

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

// ── Backlinks subscription detection ──
// DataForSEO backlinks is a separate paid subscription (error 40204).
// Once detected, we mark the capability disabled on the registry (with a 24h TTL)
// so optional backlink enrichment can degrade without spending provider credits.
// The registry itself handles TTL expiry and auto-re-enables the capability.

const BACKLINK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function markBacklinksDisabled(): void {
  markCapabilityDisabled('dataforseo', 'backlinks', BACKLINK_COOLDOWN_MS);
}

// ── Probe result persistence (avoids billable probe on every server restart) ──
// The in-memory registry's 24h capability TTL resets on restart. Frequently-restarting
// deploys (rolling updates, dev reloads) would otherwise consume a probe credit per restart.
// Cache the probe outcome to disk with the same 24h TTL; refresh only when stale or absent.

interface ProbeResult {
  /** 'backlinks-disabled' | 'backlinks-available' */
  outcome: 'backlinks-disabled' | 'backlinks-available';
  probedAt: string;
}

function getProbeCachePath(): string {
  return path.join(CREDIT_DIR, 'probe-result.json');
}

function readProbeCache(): ProbeResult | null {
  try {
    const raw = fs.readFileSync(getProbeCachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as ProbeResult;
    const age = Date.now() - new Date(parsed.probedAt).getTime();
    if (age > BACKLINK_COOLDOWN_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeProbeCache(outcome: ProbeResult['outcome']): void {
  try {
    fs.writeFileSync(
      getProbeCachePath(),
      JSON.stringify({ outcome, probedAt: new Date().toISOString() } satisfies ProbeResult, null, 2),
    );
  } catch (err) { log.warn({ err }, 'Failed to persist DataForSEO probe result'); }
}

function isSubscriptionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('40204') || msg.includes('subscription');
}

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
  fs.writeFileSync(getCachePath(workspaceId, key), JSON.stringify({ cachedAt: new Date().toISOString(), data }, null, 2));
}

// ── API helpers ──

function cleanDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
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
    if (!this.isConfigured()) return;

    // Reuse a recent probe result from disk so rolling restarts don't spend a credit per boot.
    const cached = readProbeCache();
    if (cached) {
      if (cached.outcome === 'backlinks-disabled') {
        markBacklinksDisabled();
        log.info({ probedAt: cached.probedAt }, 'DataForSEO backlinks disabled (cached probe)');
      }
      return;
    }

    try {
      await apiCall('backlinks/summary/live', [{ target: 'example.com', include_subdomains: false }]);
      writeProbeCache('backlinks-available');
    } catch (err) {
      // Only 40204 is a reliable signal in the cold-start probe context
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('40204')) {
        markBacklinksDisabled();
        writeProbeCache('backlinks-disabled');
        log.info('DataForSEO backlinks subscription not available — backlink enrichment disabled');
      }
      // Non-subscription errors (network, rate limit) are silently ignored — reactive detection
      // handles them, and we deliberately don't cache them so transient issues get retried next boot.
    }
  }

  // ── getKeywordMetrics → search_volume ──
  async getKeywordMetrics(
    keywords: string[],
    workspaceId: string,
    database = 'us',
    locationCode?: number,
  ): Promise<KeywordMetrics[]> {
    const resolvedLocationCode = locationCode ?? locationCodeFromDatabase(database);
    const cacheRegion = String(resolvedLocationCode);
    const useLegacyRegionFallback = locationCode === undefined && database !== cacheRegion;
    const results: KeywordMetrics[] = [];
    const uncached: string[] = [];

    // Check cache first
    for (const kw of keywords) {
      const cacheKey = `kw_${cacheRegion}_${kw.toLowerCase().replace(/\s+/g, '_')}`;
      let cached = readCache<KeywordMetrics>(workspaceId, cacheKey, CACHE_TTL_KEYWORD);
      if (!cached && useLegacyRegionFallback) {
        const legacyCacheKey = `kw_${database}_${kw.toLowerCase().replace(/\s+/g, '_')}`;
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
        const rawLegacyHits = getCachedMetricsBatch([...stillUncached], database, CACHE_TTL_KEYWORD);
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
            language_code: 'en',
          }], workspaceId),
          apiCall('dataforseo_labs/google/keyword_difficulty/live', [{
            keywords: batch,
            location_code: resolvedLocationCode,
            language_code: 'en',
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
  async getRelatedKeywords(keyword: string, workspaceId: string, limit = 20, database = 'us'): Promise<RelatedKeyword[]> {
    const cacheKey = `related_${database}_${keyword.toLowerCase().replace(/\s+/g, '_')}_${limit}`;
    const cached = readCache<RelatedKeyword[]>(workspaceId, cacheKey, CACHE_TTL_RELATED);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'related_keywords', query: keyword, rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      const json = await apiCall('dataforseo_labs/google/related_keywords/live', [{
        keyword,
        location_code: locationCodeFromDatabase(database),
        language_code: 'en',
        limit,
        depth: 1,
        include_seed_keyword: false,
      }], workspaceId);

      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
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

      logCreditUsage({ credits: cost, endpoint: 'related_keywords', query: keyword, rowsReturned: results.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, results);
      return results;
    } catch (err) {
      log.error({ err }, `DataForSEO related_keywords error for "${keyword}"`);
      return [];
    }
  }

  // ── getQuestionKeywords → keyword_suggestions (filtered) ──
  async getQuestionKeywords(keyword: string, workspaceId: string, limit = 20, database = 'us'): Promise<QuestionKeyword[]> {
    const cacheKey = `questions_${database}_${keyword.toLowerCase().replace(/\s+/g, '_')}_${limit}`;
    const cached = readCache<QuestionKeyword[]>(workspaceId, cacheKey, CACHE_TTL_RELATED);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'keyword_suggestions', query: keyword, rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      const json = await apiCall('dataforseo_labs/google/keyword_suggestions/live', [{
        keyword,
        location_code: locationCodeFromDatabase(database),
        language_code: 'en',
        limit,
        filters: ['keyword', 'regex', '^(how|what|why|when|where|who|which|can|does|is|are|do|will|should) '],
      }], workspaceId);

      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
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

      logCreditUsage({ credits: cost, endpoint: 'keyword_suggestions', query: keyword, rowsReturned: results.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, results);
      return results;
    } catch (err) {
      log.error({ err }, `DataForSEO keyword_suggestions error for "${keyword}"`);
      return [];
    }
  }

  async getKeywordSuggestions(keyword: string, workspaceId: string, limit = 25, database = 'us'): Promise<KeywordSourceEvidence[]> {
    const seed = keyword.toLowerCase().trim();
    if (!seed) return [];
    const cappedLimit = Math.min(Math.max(limit, 1), 100);
    const cacheKey = `discovery_suggestions_${database}_${cacheKeyPart(seed)}_${cappedLimit}`;
    const cached = readCache<KeywordSourceEvidence[]>(workspaceId, cacheKey, CACHE_TTL_DISCOVERY);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'keyword_suggestions_general', query: seed, rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      const json = await apiCall('dataforseo_labs/google/keyword_suggestions/live', [{
        keyword: seed,
        location_code: locationCodeFromDatabase(database),
        language_code: 'en',
        limit: cappedLimit,
      }], workspaceId);
      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
      const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
      const results = evidenceFromKeywordDataItems(items, {
        provider: this.name,
        sourceKind: KEYWORD_SOURCE_KIND.KEYWORD_SUGGESTIONS,
        seed,
        confidence: 'medium',
      });
      logCreditUsage({ credits: cost, endpoint: 'keyword_suggestions_general', query: seed, rowsReturned: results.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, results);
      return results;
    } catch (err) {
      log.error({ err }, `DataForSEO keyword_suggestions discovery error for "${seed}"`);
      return [];
    }
  }

  async getKeywordIdeas(keywords: string[], workspaceId: string, limit = 50, database = 'us'): Promise<KeywordSourceEvidence[]> {
    const seeds = normalizeSeedKeywords(keywords, 10);
    if (seeds.length === 0) return [];
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const cacheKey = `discovery_ideas_${database}_${cacheKeyPart(seeds.join('_'))}_${cappedLimit}`;
    const cached = readCache<KeywordSourceEvidence[]>(workspaceId, cacheKey, CACHE_TTL_DISCOVERY);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'keyword_ideas', query: seeds.join(',').slice(0, 100), rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      const json = await apiCall('dataforseo_labs/google/keyword_ideas/live', [{
        keywords: seeds,
        location_code: locationCodeFromDatabase(database),
        language_code: 'en',
        limit: cappedLimit,
      }], workspaceId);
      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
      const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
      const results = evidenceFromKeywordDataItems(items, {
        provider: this.name,
        sourceKind: KEYWORD_SOURCE_KIND.KEYWORD_IDEAS,
        seed: seeds.join(', '),
        confidence: 'medium',
      });
      logCreditUsage({ credits: cost, endpoint: 'keyword_ideas', query: seeds.join(',').slice(0, 100), rowsReturned: results.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, results);
      return results;
    } catch (err) {
      log.error({ err }, `DataForSEO keyword_ideas error for "${seeds.join(', ')}"`);
      return [];
    }
  }

  async getKeywordsForSite(target: string, workspaceId: string, limit = 50, database = 'us'): Promise<KeywordSourceEvidence[]> {
    const cleanTarget = cleanDomain(target);
    if (!cleanTarget) return [];
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const cacheKey = `discovery_site_${database}_${cacheKeyPart(cleanTarget)}_${cappedLimit}`;
    const cached = readCache<KeywordSourceEvidence[]>(workspaceId, cacheKey, CACHE_TTL_DISCOVERY);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'keywords_for_site', query: cleanTarget, rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      const json = await apiCall('dataforseo_labs/google/keywords_for_site/live', [{
        target: cleanTarget,
        location_code: locationCodeFromDatabase(database),
        language_code: 'en',
        limit: cappedLimit,
      }], workspaceId);
      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
      const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];
      const results = evidenceFromKeywordDataItems(items, {
        provider: this.name,
        sourceKind: KEYWORD_SOURCE_KIND.KEYWORDS_FOR_SITE,
        sourceTarget: cleanTarget,
        confidence: 'high',
      });
      logCreditUsage({ credits: cost, endpoint: 'keywords_for_site', query: cleanTarget, rowsReturned: results.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, results);
      return results;
    } catch (err) {
      log.error({ err }, `DataForSEO keywords_for_site error for "${cleanTarget}"`);
      return [];
    }
  }

  async getKeywordsForKeywords(keywords: string[], workspaceId: string, limit = 50, database = 'us'): Promise<KeywordSourceEvidence[]> {
    const seeds = normalizeSeedKeywords(keywords, 20);
    if (seeds.length === 0) return [];
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const cacheKey = `google_ads_keywords_${database}_${cacheKeyPart(seeds.join('_'))}_${cappedLimit}`;
    const cached = readCache<KeywordSourceEvidence[]>(workspaceId, cacheKey, CACHE_TTL_DISCOVERY);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'keywords_for_keywords', query: seeds.join(',').slice(0, 100), rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      const json = await apiCall('keywords_data/google_ads/keywords_for_keywords/live', [{
        keywords: seeds,
        location_code: locationCodeFromDatabase(database),
        language_code: 'en',
        sort_by: 'relevance',
      }], workspaceId);
      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
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
      logCreditUsage({ credits: cost, endpoint: 'keywords_for_keywords', query: seeds.join(',').slice(0, 100), rowsReturned: results.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, results);
      return results;
    } catch (err) {
      log.error({ err }, `DataForSEO keywords_for_keywords error for "${seeds.join(', ')}"`);
      return [];
    }
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
  async getDomainKeywords(domain: string, workspaceId: string, limit = 100, database = 'us'): Promise<DomainKeyword[]> {
    const target = cleanDomain(domain);
    const cacheKey = `domain_ranked_${database}_${target.replace(/\./g, '_')}_${limit}_vol`;
    const cached = readCache<DomainKeyword[]>(workspaceId, cacheKey, CACHE_TTL_DOMAIN_ORGANIC);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'ranked_keywords', query: target, rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      // NOTE: `dataforseo_labs/google/ranked_keywords/live` does NOT accept an `item_types`
      // parameter. Including it returns error 40501 "Invalid Field: 'item_types'". The endpoint
      // returns all ranked keyword types by default; the SERP feature type is read per-item from
      // `ranked_serp_element.serp_item.type` in the dedupe loop below.
      const json = await apiCall('dataforseo_labs/google/ranked_keywords/live', [{
        target,
        location_code: locationCodeFromDatabase(database),
        language_code: 'en',
        limit,
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
      }], workspaceId);

      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
      const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];

      // Collect SERP feature types per keyword (keywords may appear multiple times with different item types)
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

      // Deduplicate: keep only the organic entry per keyword (with SERP features attached)
      const seen = new Set<string>();
      const results: DomainKeyword[] = [];
      for (const item of items) {
        const kwData = item.keyword_data as Record<string, unknown> | undefined;
        const kwInfo = kwData?.keyword_info as Record<string, unknown> | undefined;
        const serpElement = item.ranked_serp_element as Record<string, unknown> | undefined;
        const serpItem = serpElement?.serp_item as Record<string, unknown> | undefined;
        const itemType = (serpItem?.type as string) ?? 'organic';
        const keyword = (kwData?.keyword as string) ?? '';

        // Only include organic results (skip duplicate featured_snippet/local_pack entries)
        if (itemType !== 'organic') continue;
        if (seen.has(keyword)) continue;
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

      logCreditUsage({ credits: cost, endpoint: 'ranked_keywords', query: target, rowsReturned: results.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, results);
      return results;
    } catch (err) {
      log.error({ err }, `DataForSEO ranked_keywords error for "${target}"`);
      return [];
    }
  }

  async getUrlKeywords(url: string, workspaceId: string, limit = 20, database = 'us'): Promise<DomainKeyword[]> {
    const target = cleanUrlTarget(url);
    const cacheKey = `url_ranked_${database}_${target.replace(/[^a-zA-Z0-9_-]/g, '_')}_${limit}`;
    const cached = readCache<DomainKeyword[]>(workspaceId, cacheKey, CACHE_TTL_DOMAIN_ORGANIC);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'ranked_keywords_url', query: target, rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      const json = await apiCall('dataforseo_labs/google/ranked_keywords/live', [{
        target,
        location_code: locationCodeFromDatabase(database),
        language_code: 'en',
        limit,
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
      }], workspaceId);

      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
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

      logCreditUsage({ credits: cost, endpoint: 'ranked_keywords_url', query: target, rowsReturned: results.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, results);
      return results;
    } catch (err) {
      log.error({ err }, `DataForSEO URL ranked_keywords error for "${target}"`);
      return [];
    }
  }

  // ── getDomainOverview → ranked_keywords with limit=1 (only `metrics` aggregate is read) ──
  async getDomainOverview(domain: string, workspaceId: string, database = 'us'): Promise<DomainOverview | null> {
    const target = cleanDomain(domain);
    const cacheKey = `domain_overview_${database}_${target.replace(/\./g, '_')}`;
    const cached = readCache<DomainOverview>(workspaceId, cacheKey, CACHE_TTL_DOMAIN_OVERVIEW);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'ranked_keywords_overview', query: target, rowsReturned: 1, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return null;

    try {
      // NOTE: See getDomainKeywords above — `ranked_keywords/live` rejects `item_types`
      // with error 40501. We only read `resultObj.metrics.organic`, which the endpoint
      // aggregates across all types regardless of what's returned in `items`.
      const json = await apiCall('dataforseo_labs/google/ranked_keywords/live', [{
        target,
        location_code: locationCodeFromDatabase(database),
        language_code: 'en',
        limit: 1,
      }], workspaceId);

      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
      const resultObj = taskResults[0] ?? {};
      const metrics = resultObj.metrics as Record<string, Record<string, number>> | undefined;
      const organic = metrics?.organic;

      if (!organic) {
        log.info(`No domain overview data for "${target}"`);
        return null;
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

      logCreditUsage({ credits: cost, endpoint: 'ranked_keywords_overview', query: target, rowsReturned: 1, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, overview);
      return overview;
    } catch (err) {
      log.error({ err }, `DataForSEO domain overview error for "${target}"`);
      return null;
    }
  }

  // ── getCompetitors → competitors_domain ──
  async getCompetitors(domain: string, workspaceId: string, limit = 10, database = 'us'): Promise<OrganicCompetitor[]> {
    const target = cleanDomain(domain);
    const cacheKey = `competitors_${database}_${target.replace(/\./g, '_')}_${limit}`;
    const cached = readCache<OrganicCompetitor[]>(workspaceId, cacheKey, CACHE_TTL_COMPETITORS);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'competitors_domain', query: target, rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      const json = await apiCall('dataforseo_labs/google/competitors_domain/live', [{
        target,
        location_code: locationCodeFromDatabase(database),
        language_code: 'en',
        limit,
        item_types: ['organic'],
      }], workspaceId);

      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
      const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];

      const results: OrganicCompetitor[] = items.map(item => {
        const fullMetrics = item.full_domain_metrics as Record<string, Record<string, number>> | undefined;
        const organic = fullMetrics?.organic;
        const avgPos = (item.avg_position as number) ?? 50;
        // Invert avg_position: lower avg = more relevant. Map to 0-100 scale.
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

      logCreditUsage({ credits: cost, endpoint: 'competitors_domain', query: target, rowsReturned: results.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, results);
      log.info(`Found ${results.length} competitors for "${target}"`);
      return results;
    } catch (err) {
      log.error({ err }, `DataForSEO competitors_domain error for "${target}"`);
      return [];
    }
  }

  // ── getKeywordGap — same approach as semrush: compare domain keywords ──
  async getKeywordGap(clientDomain: string, competitorDomains: string[], workspaceId: string, limit = 50, database = 'us'): Promise<KeywordGapEntry[]> {
    const allGaps: KeywordGapEntry[] = [];
    let clientKwSet: Set<string> | null = null;

    const getClientKeywordSet = async (): Promise<Set<string>> => {
      if (!clientKwSet) {
        const clientKeywords = await this.getDomainKeywords(clientDomain, workspaceId, 200, database);
        clientKwSet = new Set(clientKeywords.map(k => k.keyword.toLowerCase()));
      }
      return clientKwSet;
    };

    for (const comp of competitorDomains.slice(0, MAX_COMPETITORS)) {
      const cleanComp = cleanDomain(comp);
      const cacheKey = `gap_${database}_${cleanDomain(clientDomain).replace(/\./g, '_')}_vs_${cleanComp.replace(/\./g, '_')}_${limit}_comp${KEYWORD_GAP_COMPETITOR_KEYWORD_LIMIT}`;
      const cached = readCache<KeywordGapEntry[]>(workspaceId, cacheKey, CACHE_TTL_DOMAIN_ORGANIC);

      if (cached) {
        allGaps.push(...cached);
        continue;
      }

      try {
        const compKeywords = await this.getDomainKeywords(cleanComp, workspaceId, KEYWORD_GAP_COMPETITOR_KEYWORD_LIMIT, database);
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
    const cached = readCache<BacklinksOverview>(workspaceId, cacheKey, CACHE_TTL_BACKLINKS);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'backlinks_summary', query: target, rowsReturned: 1, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return null;

    try {
      const json = await apiCall('backlinks/summary/live', [{
        target,
        include_subdomains: true,
      }], workspaceId);

      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
      const data = taskResults[0] as Record<string, unknown> | undefined;

      if (!data) {
        log.info(`No backlink data for "${target}"`);
        return null;
      }

      const totalBacklinks = (data.backlinks as number) ?? 0;
      const refLinksAttrs = data.referring_links_attributes as Record<string, number> | undefined;
      const nofollowLinks = refLinksAttrs?.nofollow ?? 0;

      const overview: BacklinksOverview = {
        totalBacklinks,
        referringDomains: (data.referring_domains as number) ?? 0,
        followLinks: totalBacklinks - nofollowLinks,
        nofollowLinks,
        textLinks: 0, // Not directly provided by DataForSEO summary
        imageLinks: 0,
        formLinks: 0,
        frameLinks: 0,
      };

      logCreditUsage({ credits: cost, endpoint: 'backlinks_summary', query: target, rowsReturned: 1, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, overview);
      return overview;
    } catch (err) {
      if (isSubscriptionError(err)) {
        markBacklinksDisabled();
        return null;
      }
      log.error({ err }, `DataForSEO backlinks summary error for "${target}"`);
      return null;
    }
  }

  // ── getReferringDomains → backlinks/referring_domains ──
  async getReferringDomains(domain: string, workspaceId: string, limit = 20, _database = 'us'): Promise<ReferringDomain[]> {
    const target = cleanDomain(domain);
    const cacheKey = `backlinks_refdomains_${target.replace(/\./g, '_')}_${limit}`;
    const cached = readCache<ReferringDomain[]>(workspaceId, cacheKey, CACHE_TTL_BACKLINKS);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'backlinks_referring_domains', query: target, rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      const json = await apiCall('backlinks/referring_domains/live', [{
        target,
        limit,
        include_subdomains: true,
        order_by: ['rank,desc'],
      }], workspaceId);

      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
      const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];

      const results: ReferringDomain[] = items.map(item => {
        const lastVisited = item.last_visited as string | undefined;
        const firstSeen = item.first_seen as string | undefined;
        return {
          domain: (item.domain as string) ?? '',
          backlinksCount: (item.backlinks as number) ?? 0,
          firstSeen: normalizeProviderDate(firstSeen ?? ''),
          // Empty string (not 'N/A') so the frontend falsy-check renders '—' instead of 'Invalid Date'
          lastSeen: normalizeProviderDate(lastVisited ?? firstSeen ?? ''),
        };
      });

      logCreditUsage({ credits: cost, endpoint: 'backlinks_referring_domains', query: target, rowsReturned: results.length, workspaceId, cached: false });
      writeCache(workspaceId, cacheKey, results);
      return results;
    } catch (err) {
      if (isSubscriptionError(err)) {
        markBacklinksDisabled();
        return [];
      }
      log.error({ err }, `DataForSEO referring domains error for "${target}"`);
      return [];
    }
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
