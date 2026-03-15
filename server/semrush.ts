import fs from 'fs';
import path from 'path';

import { getUploadRoot, getDataDir } from './data-dir.js';
import { createLogger } from './logger.js';

const log = createLogger('semrush');

const SEMRUSH_API_BASE = 'https://api.semrush.com/';
const UPLOAD_ROOT = getUploadRoot();

// ── SEMRush Credit Usage Tracking (persisted to disk) ──

interface SemrushCreditEntry {
  credits: number;
  endpoint: string;       // e.g. 'keyword_overview', 'domain_organic', 'related_keywords'
  query: string;          // keyword or domain queried
  rowsReturned: number;
  workspaceId: string;
  cached: boolean;
  timestamp: string;
}

const CREDIT_DIR = getDataDir('semrush-usage');
const MAX_CREDIT_LOG = 1000;
let creditLog: SemrushCreditEntry[] = [];

// Load recent credit files on startup
(function loadRecentCredits() {
  try {
    const files = fs.readdirSync(CREDIT_DIR).filter(f => f.endsWith('.json')).sort().slice(-30);
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(CREDIT_DIR, f), 'utf-8'));
      if (Array.isArray(data)) creditLog.push(...data);
    }
    if (creditLog.length > MAX_CREDIT_LOG) creditLog = creditLog.slice(-MAX_CREDIT_LOG);
  } catch { /* first run */ }
})();

let pendingCreditWrites: SemrushCreditEntry[] = [];
let creditFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function flushCreditsToDisk(): void {
  if (pendingCreditWrites.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(CREDIT_DIR, `${today}.json`);
  let existing: SemrushCreditEntry[] = [];
  try { existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { /* new file */ }
  existing.push(...pendingCreditWrites);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
  pendingCreditWrites = [];
}

function logCreditUsage(entry: Omit<SemrushCreditEntry, 'timestamp'>): void {
  const full = { ...entry, timestamp: new Date().toISOString() };
  creditLog.push(full);
  if (creditLog.length > MAX_CREDIT_LOG) creditLog.splice(0, creditLog.length - MAX_CREDIT_LOG);
  pendingCreditWrites.push(full);
  if (pendingCreditWrites.length >= 10) { flushCreditsToDisk(); return; }
  if (!creditFlushTimer) creditFlushTimer = setTimeout(() => { creditFlushTimer = null; flushCreditsToDisk(); }, 5000);
}

// Flush on normal process exit (graceful shutdown handles SIGTERM/SIGINT)
process.on('beforeExit', flushCreditsToDisk);

/** Get SEMRush credit usage summary */
export function getSemrushUsage(workspaceId?: string, since?: string): {
  totalCredits: number;
  totalCalls: number;
  cachedCalls: number;
  entries: SemrushCreditEntry[];
} {
  let entries = creditLog;
  if (workspaceId) entries = entries.filter(e => e.workspaceId === workspaceId);
  if (since) entries = entries.filter(e => e.timestamp >= since);
  return {
    totalCredits: entries.reduce((s, e) => s + e.credits, 0),
    totalCalls: entries.length,
    cachedCalls: entries.filter(e => e.cached).length,
    entries,
  };
}

/** Aggregate SEMRush usage by day for charting */
export function getSemrushByDay(workspaceId?: string, days = 30): Array<{
  date: string; credits: number; calls: number; cachedCalls: number;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const since = cutoff.toISOString();

  let entries = creditLog.filter(e => e.timestamp >= since);
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

function getCacheDir(workspaceId: string): string {
  const dir = path.join(UPLOAD_ROOT, workspaceId, '.semrush-cache');
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
  } catch { return null; }
}

function writeCache(workspaceId: string, key: string, data: unknown) {
  fs.writeFileSync(getCachePath(workspaceId, key), JSON.stringify({ cachedAt: new Date().toISOString(), data }, null, 2));
}

function getApiKey(): string | null {
  return process.env.SEMRUSH_API_KEY || null;
}

export function isSemrushConfigured(): boolean {
  return !!getApiKey();
}

// Parse SEMRush CSV response into array of objects
function parseSemrushCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(';');
  return lines.slice(1).map(line => {
    const values = line.split(';');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').trim(); });
    return obj;
  });
}

// ── Keyword Overview (volume, difficulty, CPC) ──
export interface KeywordMetrics {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  competition: number;
  results: number;
  trend: number[];
}

export async function getKeywordOverview(
  keywords: string[],
  workspaceId: string,
  database = 'us'
): Promise<KeywordMetrics[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('SEMRUSH_API_KEY not configured');

  const results: KeywordMetrics[] = [];
  const uncached: string[] = [];

  // Check cache first
  for (const kw of keywords) {
    const cacheKey = `kw_${database}_${kw.toLowerCase().replace(/\s+/g, '_')}`;
    const cached = readCache<KeywordMetrics>(workspaceId, cacheKey);
    if (cached) {
      results.push(cached);
      logCreditUsage({ credits: 0, endpoint: 'keyword_overview', query: kw, rowsReturned: 1, workspaceId, cached: true });
    } else {
      uncached.push(kw);
    }
  }

  // Batch fetch uncached keywords (one at a time to avoid rate limits)
  for (const kw of uncached) {
    try {
      const params = new URLSearchParams({
        type: 'phrase_all',
        key: apiKey,
        phrase: kw,
        database,
        export_columns: 'Ph,Nq,Kd,Cp,Co,Nr,Td',
      });

      const res = await fetch(`${SEMRUSH_API_BASE}?${params}`);
      if (!res.ok) {
        const errText = await res.text();
        log.error({ detail: errText }, `SEMRush keyword overview error for "${kw}":`);
        continue;
      }

      const csv = await res.text();
      if (csv.startsWith('ERROR')) {
        log.error({ detail: csv }, `SEMRush error for "${kw}":`);
        continue;
      }

      const rows = parseSemrushCSV(csv);
      if (rows.length > 0) {
        const row = rows[0];
        const trendStr = row['Td'] || '';
        const trend = trendStr ? trendStr.split(',').map(Number) : [];

        const metrics: KeywordMetrics = {
          keyword: kw,
          volume: parseInt(row['Nq'] || '0', 10),
          difficulty: parseFloat(row['Kd'] || '0'),
          cpc: parseFloat(row['Cp'] || '0'),
          competition: parseFloat(row['Co'] || '0'),
          results: parseInt(row['Nr'] || '0', 10),
          trend,
        };

        results.push(metrics);
        const cacheKey = `kw_${database}_${kw.toLowerCase().replace(/\s+/g, '_')}`;
        writeCache(workspaceId, cacheKey, metrics);
        logCreditUsage({ credits: 10, endpoint: 'keyword_overview', query: kw, rowsReturned: rows.length, workspaceId, cached: false });
      }
    } catch (err) {
      log.error({ err: err }, `SEMRush fetch error for "${kw}":`);
    }
  }

  return results;
}

// ── Domain Organic Search (what keywords a domain ranks for) ──
export interface DomainKeyword {
  keyword: string;
  position: number;
  volume: number;
  difficulty: number;
  cpc: number;
  url: string;
  traffic: number;
  trafficPercent: number;
}

export async function getDomainOrganicKeywords(
  domain: string,
  workspaceId: string,
  limit = 100,
  database = 'us'
): Promise<DomainKeyword[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('SEMRUSH_API_KEY not configured');

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const cacheKey = `domain_organic_${database}_${cleanDomain.replace(/\./g, '_')}_${limit}`;
  const cached = readCache<DomainKeyword[]>(workspaceId, cacheKey);
  if (cached) {
    logCreditUsage({ credits: 0, endpoint: 'domain_organic', query: cleanDomain, rowsReturned: cached.length, workspaceId, cached: true });
    return cached;
  }

  const params = new URLSearchParams({
    type: 'domain_organic',
    key: apiKey,
    domain: cleanDomain,
    database,
    display_limit: String(limit),
    export_columns: 'Ph,Po,Nq,Kd,Cp,Ur,Tr,Tc',
  });

  const res = await fetch(`${SEMRUSH_API_BASE}?${params}`);
  if (!res.ok) {
    const errText = await res.text();
    log.warn(`Domain organic error for "${cleanDomain}": ${errText.slice(0, 200)}`);
    return [];
  }

  const csv = await res.text();
  if (csv.startsWith('ERROR')) {
    if (csv.includes('NOTHING FOUND')) {
      log.info(`No organic data found for "${cleanDomain}"`);
    } else {
      log.warn(`Domain organic error for "${cleanDomain}": ${csv}`);
    }
    return [];
  }

  const rows = parseSemrushCSV(csv);
  const results: DomainKeyword[] = rows.map(row => ({
    keyword: row['Ph'] || '',
    position: parseInt(row['Po'] || '0', 10),
    volume: parseInt(row['Nq'] || '0', 10),
    difficulty: parseFloat(row['Kd'] || '0'),
    cpc: parseFloat(row['Cp'] || '0'),
    url: row['Ur'] || '',
    traffic: parseFloat(row['Tr'] || '0'),
    trafficPercent: parseFloat(row['Tc'] || '0'),
  }));

  logCreditUsage({ credits: results.length * 10, endpoint: 'domain_organic', query: cleanDomain, rowsReturned: results.length, workspaceId, cached: false });
  writeCache(workspaceId, cacheKey, results);
  return results;
}

// ── Keyword Gap (keywords competitors rank for but you don't) ──
export interface KeywordGap {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

export async function getKeywordGap(
  clientDomain: string,
  competitorDomains: string[],
  workspaceId: string,
  limit = 50,
  database = 'us'
): Promise<KeywordGap[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('SEMRUSH_API_KEY not configured');

  const allGaps: KeywordGap[] = [];

  // For each competitor, get their organic keywords and find ones client doesn't rank for
  // We use domain_organic for each competitor and cross-reference
  for (const comp of competitorDomains.slice(0, 3)) {
    const cleanComp = comp.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const cacheKey = `gap_${database}_${clientDomain.replace(/\./g, '_')}_vs_${cleanComp.replace(/\./g, '_')}_${limit}`;
    const cached = readCache<KeywordGap[]>(workspaceId, cacheKey);

    if (cached) {
      allGaps.push(...cached);
      continue;
    }

    try {
      // Get competitor's top keywords
      const compKeywords = await getDomainOrganicKeywords(cleanComp, workspaceId, limit, database);

      // Get client's keywords to find gaps
      const clientKeywords = await getDomainOrganicKeywords(clientDomain, workspaceId, 200, database);
      const clientKwSet = new Set(clientKeywords.map(k => k.keyword.toLowerCase()));

      // Keywords competitor ranks for but client doesn't
      const gaps: KeywordGap[] = compKeywords
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
      log.error({ err: err }, `SEMRush gap analysis error for ${cleanComp}:`);
    }
  }

  // Deduplicate and sort by volume
  const seen = new Set<string>();
  return allGaps
    .filter(g => { if (seen.has(g.keyword.toLowerCase())) return false; seen.add(g.keyword.toLowerCase()); return true; })
    .sort((a, b) => b.volume - a.volume);
}

// ── Related Keywords ──
export interface RelatedKeyword {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
}

export async function getRelatedKeywords(
  keyword: string,
  workspaceId: string,
  limit = 20,
  database = 'us'
): Promise<RelatedKeyword[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('SEMRUSH_API_KEY not configured');

  const cacheKey = `related_${database}_${keyword.toLowerCase().replace(/\s+/g, '_')}_${limit}`;
  const cached = readCache<RelatedKeyword[]>(workspaceId, cacheKey);
  if (cached) {
    logCreditUsage({ credits: 0, endpoint: 'related_keywords', query: keyword, rowsReturned: cached.length, workspaceId, cached: true });
    return cached;
  }

  const params = new URLSearchParams({
    type: 'phrase_related',
    key: apiKey,
    phrase: keyword,
    database,
    display_limit: String(limit),
    export_columns: 'Ph,Nq,Kd,Cp',
  });

  const res = await fetch(`${SEMRUSH_API_BASE}?${params}`);
  if (!res.ok) {
    const errText = await res.text();
    log.warn(`Related keywords error for "${keyword}": ${errText.slice(0, 200)}`);
    return [];
  }

  const csv = await res.text();
  if (csv.startsWith('ERROR')) {
    // NOTHING FOUND is normal for obscure/made-up keywords — not a real error
    if (csv.includes('NOTHING FOUND')) {
      log.info(`No related keywords found for "${keyword}"`);
    } else {
      log.warn(`Related keywords error for "${keyword}": ${csv}`);
    }
    return [];
  }

  const rows = parseSemrushCSV(csv);
  const results: RelatedKeyword[] = rows.map(row => ({
    keyword: row['Ph'] || '',
    volume: parseInt(row['Nq'] || '0', 10),
    difficulty: parseFloat(row['Kd'] || '0'),
    cpc: parseFloat(row['Cp'] || '0'),
  }));

  logCreditUsage({ credits: results.length * 10, endpoint: 'related_keywords', query: keyword, rowsReturned: results.length, workspaceId, cached: false });
  writeCache(workspaceId, cacheKey, results);
  return results;
}

// ── Domain Overview (domain-level organic traffic & keyword metrics) ──
export interface DomainOverview {
  domain: string;
  organicKeywords: number;
  organicTraffic: number;
  organicCost: number;  // estimated cost if paying via PPC
  paidKeywords: number;
  paidTraffic: number;
  paidCost: number;
}

export async function getDomainOverview(
  domain: string,
  workspaceId: string,
  database = 'us'
): Promise<DomainOverview | null> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('SEMRUSH_API_KEY not configured');

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const cacheKey = `domain_overview_${database}_${cleanDomain.replace(/\./g, '_')}`;
  const cached = readCache<DomainOverview>(workspaceId, cacheKey, 48);
  if (cached) {
    logCreditUsage({ credits: 0, endpoint: 'domain_ranks', query: cleanDomain, rowsReturned: 1, workspaceId, cached: true });
    return cached;
  }

  const params = new URLSearchParams({
    type: 'domain_ranks',
    key: apiKey,
    domain: cleanDomain,
    database,
    export_columns: 'Dn,Or,Ot,Oc,Ad,At,Ac',
  });

  const res = await fetch(`${SEMRUSH_API_BASE}?${params}`);
  if (!res.ok) {
    const errText = await res.text();
    log.warn(`Domain overview error for "${cleanDomain}": ${errText.slice(0, 200)}`);
    return null;
  }

  const csv = await res.text();
  if (csv.startsWith('ERROR')) {
    if (csv.includes('NOTHING FOUND')) {
      log.info(`No domain overview data for "${cleanDomain}"`);
    } else {
      log.warn(`Domain overview error for "${cleanDomain}": ${csv}`);
    }
    return null;
  }

  const rows = parseSemrushCSV(csv);
  if (rows.length === 0) return null;

  const row = rows[0];
  const overview: DomainOverview = {
    domain: cleanDomain,
    organicKeywords: parseInt(row['Or'] || '0', 10),
    organicTraffic: parseInt(row['Ot'] || '0', 10),
    organicCost: parseFloat(row['Oc'] || '0'),
    paidKeywords: parseInt(row['Ad'] || '0', 10),
    paidTraffic: parseInt(row['At'] || '0', 10),
    paidCost: parseFloat(row['Ac'] || '0'),
  };

  logCreditUsage({ credits: 10, endpoint: 'domain_ranks', query: cleanDomain, rowsReturned: 1, workspaceId, cached: false });
  writeCache(workspaceId, cacheKey, overview);
  return overview;
}

// ── Backlinks Overview (domain-level backlink summary) ──
export interface BacklinksOverview {
  totalBacklinks: number;
  referringDomains: number;
  followLinks: number;
  nofollowLinks: number;
  textLinks: number;
  imageLinks: number;
  formLinks: number;
  frameLinks: number;
}

export async function getBacklinksOverview(
  domain: string,
  workspaceId: string,
  database = 'us'
): Promise<BacklinksOverview | null> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('SEMRUSH_API_KEY not configured');

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const cacheKey = `backlinks_overview_${database}_${cleanDomain.replace(/\./g, '_')}`;
  const cached = readCache<BacklinksOverview>(workspaceId, cacheKey, 48);
  if (cached) {
    logCreditUsage({ credits: 0, endpoint: 'backlinks_overview', query: cleanDomain, rowsReturned: 1, workspaceId, cached: true });
    return cached;
  }

  const params = new URLSearchParams({
    type: 'backlinks_overview',
    key: apiKey,
    target: cleanDomain,
    target_type: 'root_domain',
    export_columns: 'total,domains_num,urls_num,ips_num,follows_num,nofollows_num,texts_num,images_num,forms_num,frames_num',
  });

  const res = await fetch(`${SEMRUSH_API_BASE}?${params}`);
  if (!res.ok) {
    const errText = await res.text();
    log.warn(`Backlinks overview error for "${cleanDomain}": ${errText.slice(0, 200)}`);
    return null;
  }

  const csv = await res.text();
  if (csv.startsWith('ERROR')) {
    if (csv.includes('NOTHING FOUND')) {
      log.info(`No backlink data found for "${cleanDomain}"`);
    } else {
      log.warn(`Backlinks overview error for "${cleanDomain}": ${csv}`);
    }
    return null;
  }

  const rows = parseSemrushCSV(csv);
  if (rows.length === 0) return null;

  const row = rows[0];
  const overview: BacklinksOverview = {
    totalBacklinks: parseInt(row['total'] || '0', 10),
    referringDomains: parseInt(row['domains_num'] || '0', 10),
    followLinks: parseInt(row['follows_num'] || '0', 10),
    nofollowLinks: parseInt(row['nofollows_num'] || '0', 10),
    textLinks: parseInt(row['texts_num'] || '0', 10),
    imageLinks: parseInt(row['images_num'] || '0', 10),
    formLinks: parseInt(row['forms_num'] || '0', 10),
    frameLinks: parseInt(row['frames_num'] || '0', 10),
  };

  logCreditUsage({ credits: 40, endpoint: 'backlinks_overview', query: cleanDomain, rowsReturned: 1, workspaceId, cached: false });
  writeCache(workspaceId, cacheKey, overview);
  return overview;
}

// ── Top Referring Domains ──
export interface ReferringDomain {
  domain: string;
  backlinksCount: number;
  firstSeen: string;
  lastSeen: string;
}

export async function getTopReferringDomains(
  domain: string,
  workspaceId: string,
  limit = 20,
  database = 'us'
): Promise<ReferringDomain[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('SEMRUSH_API_KEY not configured');

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const cacheKey = `backlinks_refdomains_${database}_${cleanDomain.replace(/\./g, '_')}_${limit}`;
  const cached = readCache<ReferringDomain[]>(workspaceId, cacheKey, 48);
  if (cached) {
    logCreditUsage({ credits: 0, endpoint: 'backlinks_refdomains', query: cleanDomain, rowsReturned: cached.length, workspaceId, cached: true });
    return cached;
  }

  const params = new URLSearchParams({
    type: 'backlinks_refdomains',
    key: apiKey,
    target: cleanDomain,
    target_type: 'root_domain',
    display_limit: String(limit),
    display_sort: 'domain_ascore_desc',
    export_columns: 'domain_ascore,domain,backlinks_num,first_seen,last_seen',
  });

  const res = await fetch(`${SEMRUSH_API_BASE}?${params}`);
  if (!res.ok) {
    const errText = await res.text();
    log.warn(`Referring domains error for "${cleanDomain}": ${errText.slice(0, 200)}`);
    return [];
  }

  const csv = await res.text();
  if (csv.startsWith('ERROR')) {
    if (csv.includes('NOTHING FOUND')) {
      log.info(`No referring domains found for "${cleanDomain}"`);
    } else {
      log.warn(`Referring domains error for "${cleanDomain}": ${csv}`);
    }
    return [];
  }

  const rows = parseSemrushCSV(csv);
  const results: ReferringDomain[] = rows.map(row => ({
    domain: row['domain'] || '',
    backlinksCount: parseInt(row['backlinks_num'] || '0', 10),
    firstSeen: row['first_seen'] || '',
    lastSeen: row['last_seen'] || '',
  }));

  logCreditUsage({ credits: results.length * 10, endpoint: 'backlinks_refdomains', query: cleanDomain, rowsReturned: results.length, workspaceId, cached: false });
  writeCache(workspaceId, cacheKey, results);
  return results;
}

// ── Estimate credit cost for an operation ──
export function estimateCreditCost(opts: {
  mode: 'quick' | 'full';
  competitorCount?: number;
  keywordCount?: number;
}): number {
  if (opts.mode === 'quick') {
    // Keyword overview only: ~10 credits per keyword
    return (opts.keywordCount || 50) * 10;
  }
  // Full mode: domain organic + competitors + keyword overview + related
  const domainCost = 100 * 10; // client domain, 100 rows
  const compCost = (opts.competitorCount || 2) * 100 * 10; // per competitor
  const kwCost = (opts.keywordCount || 50) * 10;
  const relatedCost = 10 * 20 * 10; // 10 seed keywords, 20 related each
  return domainCost + compCost + kwCost + relatedCost;
}

// ── Clear cache for a workspace ──
export function clearSemrushCache(workspaceId: string): void {
  const dir = getCacheDir(workspaceId);
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) fs.unlinkSync(path.join(dir, f));
  } catch { /* ignore */ }
}
