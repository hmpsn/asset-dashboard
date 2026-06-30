/**
 * Persistent storage for performance tool results.
 * Saves per-site snapshots to SQLite.
 * Covers: PageWeight, PageSpeed, LinkChecker, InternalLinks, CompetitorCompare.
 */
import db from './db/index.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { matchPageIdentity } from './utils/page-address.js';

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
  listCompetitorProjection: db.prepare(`
    SELECT
      site_id,
      created_at,
      json_extract(result, '$.mySite.url') AS my_url,
      json_extract(result, '$.competitor.url') AS competitor_url
    FROM performance_snapshots
    WHERE sub = 'competitor'
      AND json_valid(result)
    ORDER BY created_at DESC
  `),
  getPageSpeedSummaryProjection: db.prepare<[sub: string, siteId: string]>(`
    SELECT
      site_id,
      created_at,
      json_extract(result, '$.averageScore') AS average_score,
      json_extract(result, '$.averageVitals.LCP') AS avg_lcp,
      json_extract(result, '$.averageVitals.FID') AS avg_fid,
      json_extract(result, '$.averageVitals.INP') AS avg_inp,
      json_extract(result, '$.averageVitals.CLS') AS avg_cls,
      json_extract(result, '$.averageVitals.FCP') AS avg_fcp,
      json_extract(result, '$.averageVitals.SI') AS avg_si,
      json_extract(result, '$.averageVitals.TBT') AS avg_tbt,
      json_extract(result, '$.averageVitals.TTI') AS avg_tti,
      json_type(result, '$.averageVitals') AS average_vitals_type
    FROM performance_snapshots
    WHERE sub = ?
      AND site_id = ?
      AND json_valid(result)
  `),
  listPageSpeedPageMetricProjection: db.prepare<[sub: string, siteId: string]>(`
    SELECT
      json_extract(page.value, '$.url') AS url,
      json_extract(page.value, '$.slug') AS slug,
      json_extract(page.value, '$.page') AS page,
      json_extract(page.value, '$.score') AS score,
      json_extract(page.value, '$.vitals.LCP') AS lcp,
      json_extract(page.value, '$.vitals.FID') AS fid,
      json_extract(page.value, '$.vitals.INP') AS inp,
      json_extract(page.value, '$.vitals.CLS') AS cls
    FROM performance_snapshots AS snapshot,
      json_each(snapshot.result, '$.pages') AS page
    WHERE snapshot.sub = ?
      AND snapshot.site_id = ?
      AND json_valid(snapshot.result)
      AND page.type = 'object'
  `),
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

export type PageSpeedStrategy = 'mobile' | 'desktop';

export interface CoreWebVitalsProjection {
  LCP: number | null;
  FID: number | null;
  INP: number | null;
  CLS: number | null;
  FCP?: number | null;
  SI?: number | null;
  TBT?: number | null;
  TTI?: number | null;
}

export interface PageSpeedPageMetricProjection {
  url?: string;
  slug?: string;
  page?: string;
  score: number | null;
  vitals: Pick<CoreWebVitalsProjection, 'LCP' | 'FID' | 'INP' | 'CLS'>;
}

export interface PageSpeedSummaryProjection {
  siteId: string;
  createdAt: string;
  strategy: PageSpeedStrategy;
  averageScore: number | null;
  hasAverageVitals: boolean;
  averageVitals: CoreWebVitalsProjection;
  pageCount: number;
  cwvPassingPages: number;
  cwvPassRate: number | null;
  worstPages: Array<{ url?: string; page?: string; score: number }>;
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

function pageSpeedSub(strategy: PageSpeedStrategy): string {
  return `pagespeed:${strategy}`;
}

export function savePageSpeed(siteId: string, strategy: PageSpeedStrategy, result: unknown) {
  return save(pageSpeedSub(strategy), siteId, result);
}

export function getPageSpeed(siteId: string, strategy: PageSpeedStrategy = 'mobile') {
  const snapshot = load(pageSpeedSub(strategy), siteId);
  if (snapshot || strategy !== 'mobile') return snapshot;
  return load('pagespeed', siteId);
}

interface PageSpeedSummaryProjectionRow {
  site_id: string;
  created_at: string;
  average_score: unknown;
  avg_lcp: unknown;
  avg_fid: unknown;
  avg_inp: unknown;
  avg_cls: unknown;
  avg_fcp: unknown;
  avg_si: unknown;
  avg_tbt: unknown;
  avg_tti: unknown;
  average_vitals_type: unknown;
}

interface PageSpeedPageMetricProjectionRow {
  url: unknown;
  slug: unknown;
  page: unknown;
  score: unknown;
  lcp: unknown;
  fid: unknown;
  inp: unknown;
  cls: unknown;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function pagePassesCoreWebVitals(page: PageSpeedPageMetricProjection): boolean {
  const interaction = page.vitals.INP ?? page.vitals.FID;
  return (
    typeof page.vitals.LCP === 'number' &&
    page.vitals.LCP <= 2500 &&
    typeof interaction === 'number' &&
    interaction <= (page.vitals.INP == null ? 100 : 200) &&
    typeof page.vitals.CLS === 'number' &&
    page.vitals.CLS <= 0.1
  );
}

function pageSpeedSummaryRowForSub(sub: string, siteId: string): PageSpeedSummaryProjectionRow | null {
  return (stmts().getPageSpeedSummaryProjection.get(sub, siteId) as PageSpeedSummaryProjectionRow | undefined) ?? null;
}

function pageSpeedPageMetricsForSub(sub: string, siteId: string): PageSpeedPageMetricProjection[] {
  const rows = stmts().listPageSpeedPageMetricProjection.all(sub, siteId) as PageSpeedPageMetricProjectionRow[];
  return rows.map(row => ({
    url: optionalString(row.url),
    slug: optionalString(row.slug),
    page: optionalString(row.page),
    score: finiteNumber(row.score),
    vitals: {
      LCP: finiteNumber(row.lcp),
      FID: finiteNumber(row.fid),
      INP: finiteNumber(row.inp),
      CLS: finiteNumber(row.cls),
    },
  }));
}

function pageSpeedProjectionSub(siteId: string, strategy: PageSpeedStrategy): string | null {
  const strategySub = pageSpeedSub(strategy);
  if (pageSpeedSummaryRowForSub(strategySub, siteId)) return strategySub;
  if (strategy === 'mobile' && pageSpeedSummaryRowForSub('pagespeed', siteId)) return 'pagespeed';
  return null;
}

export function getPageSpeedPageMetrics(
  siteId: string,
  strategy: PageSpeedStrategy = 'mobile',
): PageSpeedPageMetricProjection[] {
  const sub = pageSpeedProjectionSub(siteId, strategy);
  return sub ? pageSpeedPageMetricsForSub(sub, siteId) : [];
}

export function getPageSpeedSummary(
  siteId: string,
  strategy: PageSpeedStrategy = 'mobile',
): PageSpeedSummaryProjection | null {
  const sub = pageSpeedProjectionSub(siteId, strategy);
  if (!sub) return null;
  const row = pageSpeedSummaryRowForSub(sub, siteId);
  if (!row) return null;
  const pages = pageSpeedPageMetricsForSub(sub, siteId);
  const cwvPassingPages = pages.filter(pagePassesCoreWebVitals).length;
  const scoredPages = pages.filter((page): page is PageSpeedPageMetricProjection & { score: number; url: string } =>
    page.score != null && typeof page.url === 'string');

  return {
    siteId: row.site_id,
    createdAt: row.created_at,
    strategy,
    averageScore: finiteNumber(row.average_score),
    hasAverageVitals: row.average_vitals_type === 'object',
    averageVitals: {
      LCP: finiteNumber(row.avg_lcp),
      FID: finiteNumber(row.avg_fid),
      INP: finiteNumber(row.avg_inp),
      CLS: finiteNumber(row.avg_cls),
      FCP: finiteNumber(row.avg_fcp),
      SI: finiteNumber(row.avg_si),
      TBT: finiteNumber(row.avg_tbt),
      TTI: finiteNumber(row.avg_tti),
    },
    pageCount: pages.length,
    cwvPassingPages,
    cwvPassRate: pages.length > 0 ? cwvPassingPages / pages.length : null,
    worstPages: scoredPages
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map(page => ({
        url: page.url,
        page: page.page,
        score: page.score,
      })),
  };
}

export function getPageSpeedPageScore(
  siteId: string,
  strategy: PageSpeedStrategy,
  pagePath: string,
): number | null {
  const page = getPageSpeedPageMetrics(siteId, strategy).find(metric =>
    metric.url ? matchPageIdentity(metric.url, pagePath) : !!metric.slug && matchPageIdentity(metric.slug, pagePath)
  );
  return page?.score ?? null;
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

interface CompetitorCompareProjectionRow {
  site_id: string;
  created_at: string;
  my_url: string | null;
  competitor_url: string | null;
}

function normalizeCompareUrl(u: string): string {
  return u.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
}

// Get latest comparison for a given myUrl (any competitor)
export function getLatestCompetitorCompareForSite(myUrl: string): { createdAt: string; result: unknown } | null {
  const rows = stmts().listCompetitorProjection.all() as CompetitorCompareProjectionRow[];
  if (rows.length === 0) return null;

  const myNorm = normalizeCompareUrl(myUrl);
  let latestKey: string | null = null;
  let latestCreatedAt: string | null = null;

  for (const row of rows) {
    if (!row.my_url) continue;
    const snapMyUrl = normalizeCompareUrl(row.my_url);
    if (snapMyUrl === myNorm || myNorm.includes(snapMyUrl) || snapMyUrl.includes(myNorm)) {
      if (!latestCreatedAt || row.created_at > latestCreatedAt) {
        latestKey = row.site_id;
        latestCreatedAt = row.created_at;
      }
    }
  }
  if (!latestKey || !latestCreatedAt) return null;

  const snapshot = load<CompetitorCompareResult>('competitor', latestKey);
  return snapshot ? { createdAt: latestCreatedAt, result: snapshot.result } : null;
}

// List all saved competitor comparisons
export function listCompetitorCompares(): Array<{ key: string; createdAt: string; myUrl?: string; competitorUrl?: string }> {
  const rows = stmts().listCompetitorProjection.all() as CompetitorCompareProjectionRow[];
  return rows
    .map(row => ({
      key: row.site_id,
      createdAt: row.created_at,
      myUrl: row.my_url ?? undefined,
      competitorUrl: row.competitor_url ?? undefined,
    }));
}
