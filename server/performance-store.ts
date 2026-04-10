/**
 * Persistent storage for performance tool results.
 * Saves per-site snapshots to SQLite.
 * Covers: PageWeight, PageSpeed, LinkChecker, InternalLinks, CompetitorCompare.
 */
import db from './db/index.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';

// ── Prepared statements (lazy) ──

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT OR REPLACE INTO performance_snapshots
      (sub, site_id, created_at, result)
    VALUES (@sub, @site_id, @created_at, @result)
  `),
  get: db.prepare<[sub: string, siteId: string]>(
    `SELECT * FROM performance_snapshots WHERE sub = ? AND site_id = ?`,
  ),
  listBySub: db.prepare<[sub: string]>(
    `SELECT * FROM performance_snapshots WHERE sub = ? ORDER BY created_at DESC`,
  ),
}));

interface PerfRow {
  sub: string;
  site_id: string;
  created_at: string;
  result: string;
}

export interface Snapshot<T> {
  siteId: string;
  createdAt: string;
  result: T;
}

function save<T>(sub: string, siteId: string, result: T): Snapshot<T> {
  const snapshot: Snapshot<T> = {
    siteId,
    createdAt: new Date().toISOString(),
    result,
  };
  stmts().upsert.run({
    sub,
    site_id: siteId,
    created_at: snapshot.createdAt,
    result: JSON.stringify(result),
  });
  return snapshot;
}

function load<T>(sub: string, siteId: string): Snapshot<T> | null {
  const row = stmts().get.get(sub, siteId) as PerfRow | undefined;
  if (!row) return null;
  const result = parseJsonFallback<T | null>(row.result, null);
  if (result === null) return null;
  return {
    siteId: row.site_id,
    createdAt: row.created_at,
    result,
  };
}

// ── Page Weight ──

export function savePageWeight(siteId: string, result: unknown) {
  return save('page-weight', siteId, result);
}

export function getPageWeight(siteId: string) {
  return load('page-weight', siteId);
}

// ── PageSpeed Insights ──

export function savePageSpeed(siteId: string, result: unknown) {
  return save('pagespeed', siteId, result);
}

export function getPageSpeed(siteId: string) {
  return load('pagespeed', siteId);
}

// ── Single-page PageSpeed ──

export function saveSinglePageSpeed(siteId: string, pageKey: string, result: unknown) {
  return save('pagespeed-single', `${siteId}_${pageKey}`, result);
}

export function getSinglePageSpeed(siteId: string, pageKey: string) {
  return load('pagespeed-single', `${siteId}_${pageKey}`);
}

// ── Dead Link Checker ──

export function saveLinkCheck(siteId: string, result: unknown) {
  return save('link-check', siteId, result);
}

export function getLinkCheck(siteId: string) {
  return load('link-check', siteId);
}

// ── Internal Links ──

export function saveInternalLinks(siteId: string, result: unknown) {
  return save('internal-links', siteId, result);
}

export function getInternalLinks(siteId: string) {
  return load('internal-links', siteId);
}

// ── Competitor Comparison ──

function competitorKey(myUrl: string, competitorUrl: string): string {
  const normalize = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/[^a-z0-9]/gi, '_');
  return `${normalize(myUrl)}_vs_${normalize(competitorUrl)}`;
}

export function saveCompetitorCompare(myUrl: string, competitorUrl: string, result: unknown) {
  return save('competitor', competitorKey(myUrl, competitorUrl), result);
}

export function getCompetitorCompare(myUrl: string, competitorUrl: string) {
  return load('competitor', competitorKey(myUrl, competitorUrl));
}

interface CompetitorCompareResult {
  mySite?: { url?: string };
  competitor?: { url?: string };
  [key: string]: unknown;
}

// Get latest comparison for a given myUrl (any competitor)
export function getLatestCompetitorCompareForSite(myUrl: string): { createdAt: string; result: unknown } | null {
  const rows = stmts().listBySub.all('competitor') as PerfRow[];
  if (rows.length === 0) return null;

  const normalize = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  const myNorm = normalize(myUrl);
  let latest: { createdAt: string; result: unknown } | null = null;

  for (const row of rows) {
    const data = parseJsonFallback<CompetitorCompareResult | null>(row.result, null);
    if (!data?.mySite?.url) continue; // skip corrupt/empty rows
    const snapMyUrl = normalize(data.mySite.url);
    if (snapMyUrl === myNorm || myNorm.includes(snapMyUrl) || snapMyUrl.includes(myNorm)) {
      if (!latest || row.created_at > latest.createdAt) {
        latest = { createdAt: row.created_at, result: data };
      }
    }
  }
  return latest;
}

// List all saved competitor comparisons
export function listCompetitorCompares(): Array<{ key: string; createdAt: string; myUrl?: string; competitorUrl?: string }> {
  const rows = stmts().listBySub.all('competitor') as PerfRow[];
  return rows.map(row => {
    const data = parseJsonFallback<CompetitorCompareResult | null>(row.result, null);
    if (!data) return null; // skip corrupt rows
    return {
      key: row.site_id,
      createdAt: row.created_at,
      myUrl: data.mySite?.url,
      competitorUrl: data.competitor?.url,
    };
  }).filter(Boolean) as Array<{ key: string; createdAt: string; myUrl?: string; competitorUrl?: string }>;
}
