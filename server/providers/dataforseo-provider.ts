// ── DataForSEO Provider — implements SeoDataProvider via REST API ──
// Uses Basic Auth with DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD env vars.
// Per-workspace file cache + disk-based credit tracking (same pattern as semrush.ts).

import fs from 'fs';
import path from 'path';

import { getUploadRoot, getDataDir } from '../data-dir.js';
import { createLogger } from '../logger.js';
import { getCachedMetricsBatch, cacheMetricsBatch } from '../keyword-metrics-cache.js';
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
import { markCapabilityDisabled } from '../seo-data-provider.js';

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

function locationCode(database = 'us'): number {
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
  try { existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (err) { /* new file */ }
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
// so the resolver can fall back to SEMRush for backlink calls.
// The registry itself handles TTL expiry and auto-re-enables the capability.

const BACKLINK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function markBacklinksDisabled(): void {
  markCapabilityDisabled('dataforseo', 'backlinks', BACKLINK_COOLDOWN_MS);
}

function isSubscriptionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('40204') || msg.includes('subscription');
}

// ── Per-workspace file cache ──

const CACHE_TTL_KEYWORD = 720;         // 30 days
const CACHE_TTL_RELATED = 720;         // 30 days
const CACHE_TTL_DOMAIN_ORGANIC = 168;  // 7 days
const CACHE_TTL_DOMAIN_OVERVIEW = 168; // 7 days
const CACHE_TTL_BACKLINKS = 168;       // 7 days
const CACHE_TTL_COMPETITORS = 336;     // 14 days

function getCacheDir(workspaceId: string): string {
  const dir = path.join(UPLOAD_ROOT, workspaceId, '.dataforseo-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCachePath(workspaceId: string, key: string): string {
  return path.join(getCacheDir(workspaceId), `${key}.json`);
}

function readCache<T>(workspaceId: string, key: string, maxAgeHours = 168): T | null {
  try {
    const fp = getCachePath(workspaceId, key);
    if (!fs.existsSync(fp)) return null;
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const age = (Date.now() - new Date(raw.cachedAt).getTime()) / (1000 * 60 * 60);
    if (age > maxAgeHours) return null;
    return raw.data as T;
  } catch (err) { return null; }
}

function writeCache(workspaceId: string, key: string, data: unknown): void {
  fs.writeFileSync(getCachePath(workspaceId, key), JSON.stringify({ cachedAt: new Date().toISOString(), data }, null, 2));
}

// ── API helpers ──

function cleanDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
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

async function apiCall(endpoint: string, body: unknown[]): Promise<DataForSeoResponse> {
  const res = await fetch(`https://api.dataforseo.com/v3/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 402 || text.includes('balance')) markCreditsExhausted();
    throw new Error(`DataForSEO ${endpoint} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json() as DataForSeoResponse;

  // Check task-level errors
  const task = json.tasks?.[0];
  if (task && task.status_code !== 20000) {
    const msg = task.status_message || 'Unknown error';
    if (msg.toLowerCase().includes('balance') || msg.toLowerCase().includes('insufficient')) {
      markCreditsExhausted();
    }
    throw new Error(`DataForSEO ${endpoint} task error ${task.status_code}: ${msg}`);
  }

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

// ── Provider Implementation ──

export class DataForSeoProvider implements SeoDataProvider {
  readonly name = 'dataforseo';

  isConfigured(): boolean {
    return !!getCredentials();
  }

  async init(): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      await apiCall('backlinks/summary/live', [{ target: 'example.com', include_subdomains: false }]);
    } catch (err) {
      // Only 40204 is a reliable signal in the cold-start probe context
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('40204')) {
        markBacklinksDisabled();
        log.info('DataForSEO backlinks subscription not available — proactively falling back to SEMRush');
      }
      // Non-subscription errors (network, rate limit) are silently ignored — reactive detection handles them
    }
  }

  // ── getKeywordMetrics → search_volume ──
  async getKeywordMetrics(keywords: string[], workspaceId: string, database = 'us'): Promise<KeywordMetrics[]> {
    const results: KeywordMetrics[] = [];
    const uncached: string[] = [];

    // Check cache first
    for (const kw of keywords) {
      const cacheKey = `kw_${database}_${kw.toLowerCase().replace(/\s+/g, '_')}`;
      const cached = readCache<KeywordMetrics>(workspaceId, cacheKey, CACHE_TTL_KEYWORD);
      if (cached) {
        results.push(cached);
        logCreditUsage({ credits: 0, endpoint: 'search_volume', query: kw, rowsReturned: 1, workspaceId, cached: true });
      } else {
        uncached.push(kw);
      }
    }

    if (uncached.length === 0 || areCreditsExhausted()) return results;

    // L1: Check global SQLite cache for keywords that missed L2
    const globalHits = getCachedMetricsBatch(uncached, database, CACHE_TTL_KEYWORD);
    const stillUncached: string[] = [];
    for (const kw of uncached) {
      const hit = globalHits.get(kw.toLowerCase());
      if (hit) {
        results.push(hit as KeywordMetrics);
        logCreditUsage({ credits: 0, endpoint: 'search_volume', query: kw, rowsReturned: 1, workspaceId, cached: true });
      } else {
        stillUncached.push(kw);
      }
    }

    if (stillUncached.length === 0) return results;

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
            location_code: locationCode(database),
            language_code: 'en',
          }]),
          apiCall('dataforseo_labs/google/keyword_difficulty/live', [{
            keywords: batch,
            location_code: locationCode(database),
            language_code: 'en',
          }]).catch(() => null),   // graceful fallback if KD endpoint unavailable
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
          const cacheKey = `kw_${database}_${keyword.toLowerCase().replace(/\s+/g, '_')}`;
          writeCache(workspaceId, cacheKey, metrics);
        }

        cacheMetricsBatch(batchResults, database);
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
        location_code: locationCode(database),
        language_code: 'en',
        limit,
        depth: 1,
        include_seed_keyword: false,
      }]);

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
        location_code: locationCode(database),
        language_code: 'en',
        limit,
        filters: ['keyword', 'regex', '^(how|what|why|when|where|who|which|can|does|is|are|do|will|should) '],
      }]);

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

  // ── getDomainKeywords → ranked_keywords ──
  async getDomainKeywords(domain: string, workspaceId: string, limit = 100, database = 'us'): Promise<DomainKeyword[]> {
    const target = cleanDomain(domain);
    const cacheKey = `domain_ranked_${database}_${target.replace(/\./g, '_')}_${limit}`;
    const cached = readCache<DomainKeyword[]>(workspaceId, cacheKey, CACHE_TTL_DOMAIN_ORGANIC);
    if (cached) {
      logCreditUsage({ credits: 0, endpoint: 'ranked_keywords', query: target, rowsReturned: cached.length, workspaceId, cached: true });
      return cached;
    }

    if (areCreditsExhausted()) return [];

    try {
      const json = await apiCall('dataforseo_labs/google/ranked_keywords/live', [{
        target,
        location_code: locationCode(database),
        language_code: 'en',
        limit,
        item_types: ['organic', 'featured_snippet', 'local_pack', 'people_also_ask', 'videos'],
      }]);

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

  // ── getDomainOverview → ranked_keywords with limit=0 for aggregate metrics ──
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
      const json = await apiCall('dataforseo_labs/google/ranked_keywords/live', [{
        target,
        location_code: locationCode(database),
        language_code: 'en',
        limit: 1,
        item_types: ['organic'],
      }]);

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
        location_code: locationCode(database),
        language_code: 'en',
        limit,
        item_types: ['organic'],
      }]);

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

    for (const comp of competitorDomains.slice(0, 3)) {
      const cleanComp = cleanDomain(comp);
      const cacheKey = `gap_${database}_${cleanDomain(clientDomain).replace(/\./g, '_')}_vs_${cleanComp.replace(/\./g, '_')}_${limit}`;
      const cached = readCache<KeywordGapEntry[]>(workspaceId, cacheKey, CACHE_TTL_DOMAIN_ORGANIC);

      if (cached) {
        allGaps.push(...cached);
        continue;
      }

      try {
        const compKeywords = await this.getDomainKeywords(cleanComp, workspaceId, limit, database);
        const clientKeywords = await this.getDomainKeywords(clientDomain, workspaceId, 200, database);
        const clientKwSet = new Set(clientKeywords.map(k => k.keyword.toLowerCase()));

        const gaps: KeywordGapEntry[] = compKeywords
          .filter(ck => !clientKwSet.has(ck.keyword.toLowerCase()))
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
      }]);

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
      }]);

      const taskResults = getTaskResult(json);
      const cost = getTaskCost(json);
      const items = (taskResults[0]?.items as Array<Record<string, unknown>>) ?? [];

      const results: ReferringDomain[] = items.map(item => {
        const lastVisited = item.last_visited as string | undefined;
        const firstSeen = item.first_seen as string | undefined;
        return {
          domain: (item.domain as string) ?? '',
          backlinksCount: (item.backlinks as number) ?? 0,
          firstSeen: firstSeen ?? '',
          lastSeen: lastVisited ?? firstSeen ?? 'N/A',
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
      } catch (err) { /* skip corrupt file */ }
    }
    return entries;
  } catch (err) { return []; }
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
