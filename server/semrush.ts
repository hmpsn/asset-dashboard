import fs from 'fs';
import path from 'path';

const SEMRUSH_API_BASE = 'https://api.semrush.com/';
const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const UPLOAD_ROOT = DATA_BASE
  ? path.join(DATA_BASE, 'uploads')
  : path.join(process.env.HOME || '', 'toUpload');

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
        console.error(`SEMRush keyword overview error for "${kw}":`, errText);
        continue;
      }

      const csv = await res.text();
      if (csv.startsWith('ERROR')) {
        console.error(`SEMRush error for "${kw}":`, csv);
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
      }
    } catch (err) {
      console.error(`SEMRush fetch error for "${kw}":`, err);
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
  if (cached) return cached;

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
    throw new Error(`SEMRush domain organic error: ${errText.slice(0, 200)}`);
  }

  const csv = await res.text();
  if (csv.startsWith('ERROR')) throw new Error(`SEMRush error: ${csv}`);

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
      console.error(`SEMRush gap analysis error for ${cleanComp}:`, err);
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
  if (cached) return cached;

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
    throw new Error(`SEMRush related keywords error: ${errText.slice(0, 200)}`);
  }

  const csv = await res.text();
  if (csv.startsWith('ERROR')) throw new Error(`SEMRush error: ${csv}`);

  const rows = parseSemrushCSV(csv);
  const results: RelatedKeyword[] = rows.map(row => ({
    keyword: row['Ph'] || '',
    volume: parseInt(row['Nq'] || '0', 10),
    difficulty: parseFloat(row['Kd'] || '0'),
    cpc: parseFloat(row['Cp'] || '0'),
  }));

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
