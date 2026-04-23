/**
 * Shared utility functions extracted from server/index.ts.
 * Pure functions with no side effects — safe to import anywhere.
 */
import fs from 'fs';
import path from 'path';
import type { SeoAuditResult } from './seo-audit.js';
import type { SchemaContext } from './schema-suggester.js';
import type { CustomDateRange } from './google-analytics.js';
import { listWorkspaces } from './workspaces.js';
import { getAllGscPages, getQueryPageData } from './search-console.js';
import { getGA4TopPages } from './google-analytics.js';
import { getRawKnowledge, buildPersonasContext } from './seo-context.js';
import { getInsights } from './analytics-insights-store.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
import { CRITICAL_CHECKS, MODERATE_CHECKS, computePageScore } from '../shared/scoring.js';


const log = createLogger('helpers');
// ── Page Path Utilities ──

/** Normalize a page path: ensure leading slash, strip trailing slash (keep '/' as-is) */
export function normalizePath(p: string): string {
  const s = p.startsWith('/') ? p : `/${p}`;
  return s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s;
}

/** Exact path match with trailing-slash normalization (case-insensitive) */
export function matchPagePath(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

/** Find a pageMap entry by path (exact match with normalization, case-insensitive) */
export function findPageMapEntry<T extends { pagePath: string }>(pageMap: T[], path: string): T | undefined {
  const norm = normalizePath(path).toLowerCase();
  return pageMap.find(p => normalizePath(p.pagePath).toLowerCase() === norm);
}

/**
 * Find a pageMap entry for a given Webflow page, with backward-compat fallback.
 *
 * Tries the resolved path first (`publishedPath` or `/${slug}`). If no match AND
 * the page has both a slug and a publishedPath, falls back to `/${slug}` to catch
 * legacy pageMap entries stored before the slug-path hardening migration — those
 * entries have `pagePath: '/seo'` for pages whose correct path is `/services/seo`.
 *
 * Self-heals: once the workspace is re-analyzed, pageMap entries get re-keyed to
 * the new full path and the fallback stops being reached.
 */
export function findPageMapEntryForPage<T extends { pagePath: string }>(
  pageMap: T[],
  page: { publishedPath?: string | null; slug?: string },
): T | undefined {
  const primary = findPageMapEntry(pageMap, resolvePagePath(page));
  if (primary) return primary;
  // Legacy fallback: pre-hardening entries stored under `/${slug}` for nested pages.
  if (page.slug && page.publishedPath && page.publishedPath !== `/${page.slug}`) {
    return findPageMapEntry(pageMap, `/${page.slug}`);
  }
  return undefined;
}

/** Resolve a Webflow page's canonical path from publishedPath or slug */
export function resolvePagePath(page: { publishedPath?: string | null; slug?: string }): string {
  return page.publishedPath || (page.slug ? `/${page.slug}` : '/');
}

/**
 * Returns the resolved page path, or `undefined` when the page has no slug/publishedPath info at all.
 *
 * Use this in any context that must distinguish "no meaningful path info" from a real path
 * (including the homepage). `resolvePagePath` always returns a truthy string (`'/'` for empty
 * input), so patterns like `resolvePagePath(page) || undefined` or
 * `if (baseUrl) fetch(\`${baseUrl}${resolvePagePath(page)}\`)` silently fall through to the
 * homepage for orphan pages. Prefer `tryResolvePagePath`.
 *
 * Important: Webflow homepages are marked with `slug: ''` (empty string, see
 * `server/webflow-pages.ts` `filterPublishedPages`), NOT undefined. The guard below checks
 * `=== undefined` / `=== null` rather than falsy, so `slug: ''` correctly resolves to `/`.
 * Only pages with neither field (truly orphaned, no identifying path info) return `undefined`.
 */
export function tryResolvePagePath(page: { publishedPath?: string | null; slug?: string }): string | undefined {
  const hasSlug = page.slug !== undefined && page.slug !== null;
  const hasPublishedPath = page.publishedPath !== undefined && page.publishedPath !== null;
  if (!hasSlug && !hasPublishedPath) return undefined;
  return resolvePagePath(page);
}

/**
 * Match a GSC-reported URL (full URL or path) against a resolved page path.
 * Extracts pathname, normalizes trailing slash, and handles homepage edge case.
 */
export function matchGscUrlToPath(gscUrl: string, resolvedPath: string): boolean {
  let rPath: string;
  try { rPath = new URL(gscUrl).pathname; } catch { rPath = gscUrl; }
  rPath = normalizePath(rPath.startsWith('/') ? rPath : `/${rPath}`);
  return resolvedPath === '/' ? rPath === '/' || rPath === '' : rPath === resolvedPath;
}

/**
 * Zero out AI-hallucinated keyword metrics when no SEMRush data was available.
 * Call after JSON.parse of any AI keyword analysis response.
 */
export function applyBulkKeywordGuards(
  analysis: Record<string, unknown>,
  semrushBlock: string,
): void {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return;
  if (!semrushBlock) {
    analysis.keywordDifficulty = 0;
    analysis.monthlyVolume = 0;
  }
}

/**
 * Normalize a URL or path for cross-referencing.
 * Accepts full URLs (https://...) or bare paths. Strips origin, query,
 * and hash; normalizes trailing slash via normalizePath.
 * Used for reliable ROI page_url ↔ insight page_id matching.
 */
export function normalizePageUrl(url: string): string {
  try {
    if (url.startsWith('http')) {
      return normalizePath(new URL(url).pathname);
    }
  } catch { // catch-ok: malformed URL string — fall through to path-only normalization
  }
  return normalizePath(url);
}

// ── Input Validation ──

/** Sanitize a string field: trim, limit length, strip control characters */
export function sanitizeString(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// Denylist: any err.message matching one of these returns the fallback.
// Unmatched messages are returned verbatim — prefer throwing user-safe Error
// subclasses (e.g. with fixed strings) at the boundary over relying on this
// list to catch every leak. Additions welcome but don't remove entries.
const INTERNAL_ERROR_PATTERNS = [
  /SQLITE_/i,
  /ENOENT/,
  /at\s+\S+:\d+/,                   // stack frame
  /\bdatabase\b/i,
  /prepared statement/i,
  /constraint failed/i,             // better-sqlite3: "UNIQUE constraint failed: users.email"
  /no such (table|column)/i,        // better-sqlite3 schema errors leak table/column names
];

/**
 * Return the error message if safe to expose to the client, otherwise the
 * generic fallback. Strips internal paths, DB errors, and oversize strings.
 */
export function sanitizeErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  if (err.message.length > 200) return fallback;
  // better-sqlite3 SqliteError surfaces the SQLITE_* identifier on `err.code`
  // even when the message itself doesn't contain it. Treat any SQLITE_*-coded
  // error as internal regardless of the message content.
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.startsWith('SQLITE_')) return fallback;
  if (INTERNAL_ERROR_PATTERNS.some((re) => re.test(err.message))) return fallback;
  return err.message;
}

/**
 * Wrap untrusted text before injecting into an LLM prompt. Strips NUL and
 * other exotic control characters (preserving TAB / LF / CR), neutralizes
 * obvious control-token sequences, and envelopes the content so the model
 * can be instructed to treat it as data, not instructions.
 *
 * Control-char set matches sanitizeString() above.
 */
export function sanitizeForPromptInjection(untrusted: string): string {
  const cleaned = untrusted
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/<\|[^|]*\|>/g, '[removed-control-token]');
  return `<untrusted_user_content>\n${cleaned}\n</untrusted_user_content>`;
}

/**
 * Sanitize a user-sourced query string (e.g. from Google Search Console) for safe
 * inline embedding as a list item in an LLM prompt. Strips newlines — the primary
 * injection vector that can break prompt formatting — control tokens, and other
 * non-printing chars. Truncates to maxLen to bound prompt size.
 */
export function sanitizeQueryForPrompt(q: string, maxLen = 150): string {
  return q
    .replace(/[\r\n]/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/<\|[^|]*\|>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/** Validate that a value is one of the allowed options */
export function validateEnum<T extends string>(val: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(val as T) ? (val as T) : fallback;
}

/** Parse optional startDate/endDate query params into a CustomDateRange (or undefined). */
export function parseDateRange(query: Record<string, unknown>): CustomDateRange | undefined {
  const s = query.startDate as string | undefined;
  const e = query.endDate as string | undefined;
  return (s && e) ? { startDate: s, endDate: e } : undefined;
}

// ── Glob Pattern Matching ──

/** Convert a simple glob pattern to a RegExp. Supports * (any chars) and ? (single char). */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`, 'i');
}

// ── Audit Suppression Helpers ──

// Re-export from shared/scoring.ts (single source of truth — copies to prevent external mutation)
export const CRITICAL_CHECKS_SET = new Set(CRITICAL_CHECKS);
export const MODERATE_CHECKS_SET = new Set(MODERATE_CHECKS);

export interface AuditSuppression { check: string; pageSlug: string; pagePattern?: string; reason?: string; createdAt: string }

export function applySuppressionsToAudit(
  audit: SeoAuditResult,
  suppressions: AuditSuppression[],
): SeoAuditResult {
  if (!suppressions || suppressions.length === 0) return audit;

  // Exact suppressions: "check::pageSlug" → true
  const exactSupps = suppressions.filter(s => !s.pagePattern);
  const suppSet = new Set(exactSupps.map(s => `${s.check}::${s.pageSlug}`));

  // Pattern suppressions: check + glob pattern (e.g. "blog/*", "resources/*")
  const patternSupps = suppressions.filter(s => s.pagePattern);
  const patternMatchers = patternSupps.map(s => ({
    check: s.check,
    regex: globToRegex(s.pagePattern!),
  }));

  let totalErrors = 0, totalWarnings = 0, totalInfos = 0;

  const filteredPages = audit.pages.map(page => {
    const filteredIssues = page.issues.filter(issue => {
      // Exact match
      if (suppSet.has(`${issue.check}::${page.slug}`)) return false;
      // Pattern match
      for (const pm of patternMatchers) {
        if (pm.check === issue.check && pm.regex.test(page.slug)) return false;
      }
      return true;
    });

    // Recalculate page score with remaining issues
    const score = computePageScore(filteredIssues);

    for (const i of filteredIssues) {
      if (i.severity === 'error') totalErrors++;
      else if (i.severity === 'warning') totalWarnings++;
      else totalInfos++;
    }

    return { ...page, issues: filteredIssues, score };
  });

  // Site-wide issues are not per-page, so they aren't suppressed
  for (const i of audit.siteWideIssues) {
    if (i.severity === 'error') totalErrors++;
    else if (i.severity === 'warning') totalWarnings++;
    else totalInfos++;
  }

  // Exclude noindex pages from site score — they don't affect search rankings
  const indexedPages = filteredPages.filter(p => !p.noindex);
  const siteScore = indexedPages.length > 0
    ? Math.round(indexedPages.reduce((s, r) => s + r.score, 0) / indexedPages.length)
    : 100;

  return {
    siteScore,
    totalPages: filteredPages.length,
    errors: totalErrors,
    warnings: totalWarnings,
    infos: audit.infos !== undefined ? totalInfos : totalInfos,
    pages: filteredPages,
    siteWideIssues: audit.siteWideIssues,
    cwvSummary: audit.cwvSummary,
  };
}

// ── Schema Context Builder ──

export type SchemaAnalyticsMaps = {
  gscMap?: Map<string, { clicks: number; impressions: number; position: number; ctr: number }>;
  ga4Map?: Map<string, { pageviews: number; users: number; avgEngagementTime: number }>;
  queryPageData?: Array<{ query: string; page: string; impressions: number; position: number }>;
  insightsMap?: Map<string, { healthScore?: number; healthTrend?: string; isQuickWin?: boolean }>;
};

// 5-minute TTL cache for analytics maps — prevents repeated API calls on
// the interactive single-page generation endpoint.
const analyticsCache: Record<string, { maps: SchemaAnalyticsMaps; ts: number }> = {};
const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;

export async function buildSchemaContext(
  siteId: string,
  options?: { includeAnalytics?: boolean },
): Promise<{
  ctx: SchemaContext;
  pageKeywordMap?: { pagePath: string; primaryKeyword: string; secondaryKeywords: string[]; searchIntent?: string; topicCluster?: string; contentGaps?: string[]; optimizationScore?: number }[];
} & SchemaAnalyticsMaps> {
  const allWs = listWorkspaces();
  const ws = allWs.find(w => w.webflowSiteId === siteId);
  const ctx: SchemaContext = {};
  if (ws) {
    ctx.companyName = ws.name;
    ctx.liveDomain = ws.liveDomain;
    ctx.brandVoice = ws.brandVoice;
    ctx.businessContext = ws.keywordStrategy?.businessContext;
    ctx.siteKeywords = ws.keywordStrategy?.siteKeywords;
    ctx.logoUrl = ws.brandLogoUrl;
    ctx.workspaceId = ws.id;
    ctx._siteId = siteId;

    // Knowledge base from unified seo-context builder (inline + knowledge-docs/ files)
    const rawKB = getRawKnowledge(ws.id);
    if (rawKB) ctx.knowledgeBase = rawKB.slice(0, 4000);

    // Audience personas for richer schema targeting
    const personasBlock = buildPersonasContext(ws.id);
    if (personasBlock) ctx._personasBlock = personasBlock;

    // Verified business profile for schema grounding (bypasses page content verification)
    if (ws.businessProfile) ctx._businessProfile = ws.businessProfile;
  }
  const pageKeywordMap = ws?.keywordStrategy?.pageMap?.map(p => ({
    pagePath: p.pagePath,
    primaryKeyword: p.primaryKeyword,
    secondaryKeywords: p.secondaryKeywords || [],
    searchIntent: p.searchIntent,
    topicCluster: p.topicCluster,
    contentGaps: p.contentGaps,
    optimizationScore: p.optimizationScore,
  }));

  // Fetch analytics maps when requested (for schema generation routes)
  let gscMap: SchemaAnalyticsMaps['gscMap'];
  let ga4Map: SchemaAnalyticsMaps['ga4Map'];
  let queryPageData: SchemaAnalyticsMaps['queryPageData'];
  let insightsMap: SchemaAnalyticsMaps['insightsMap'];

  if (options?.includeAnalytics && ws) {
    const cacheKey = ws.id;
    const cached = analyticsCache[cacheKey];
    if (cached && Date.now() - cached.ts < ANALYTICS_CACHE_TTL_MS) {
      gscMap = cached.maps.gscMap;
      ga4Map = cached.maps.ga4Map;
      queryPageData = cached.maps.queryPageData;
      insightsMap = cached.maps.insightsMap;
    } else {
      const [gscResults, ga4Results, qpResults] = await Promise.allSettled([
        ws.gscPropertyUrl ? getAllGscPages(ws.id, ws.gscPropertyUrl, 90) : Promise.resolve([]),
        ws.ga4PropertyId ? getGA4TopPages(ws.ga4PropertyId, 90, 500) : Promise.resolve([]),
        ws.gscPropertyUrl ? getQueryPageData(ws.id, ws.gscPropertyUrl, 90) : Promise.resolve([]),
      ]);

      if (gscResults.status === 'fulfilled' && gscResults.value.length > 0) {
        gscMap = new Map();
        for (const p of gscResults.value) {
          try {
            const urlPath = new URL(p.page).pathname.replace(/\/$/, '') || '/';
            const existing = gscMap.get(urlPath);
            if (existing) {
              // Accumulate metrics for duplicate pathnames (www vs non-www, http vs https)
              const prev = (existing as { _count?: number })._count ?? 1;
              existing.clicks += p.clicks;
              existing.impressions += p.impressions;
              existing.position = (existing.position * prev + p.position) / (prev + 1);
              existing.ctr = existing.impressions > 0 ? +((existing.clicks / existing.impressions) * 100).toFixed(1) : 0;
              (existing as { _count?: number })._count = prev + 1;
            } else {
              gscMap.set(urlPath, { clicks: p.clicks, impressions: p.impressions, position: p.position, ctr: p.ctr });
            }
          } catch { /* skip malformed URLs */ }
        }
      }

      if (ga4Results.status === 'fulfilled' && ga4Results.value.length > 0) {
        ga4Map = new Map();
        for (const p of ga4Results.value) {
          const urlPath = (p.path.startsWith('/') ? p.path : `/${p.path}`).replace(/\/$/, '') || '/';
          ga4Map.set(urlPath, { pageviews: p.pageviews, users: p.users, avgEngagementTime: p.avgEngagementTime });
        }
      }

      if (qpResults.status === 'fulfilled' && qpResults.value.length > 0) {
        queryPageData = qpResults.value.map(r => ({ query: r.query, page: r.page, impressions: r.impressions, position: r.position }));
      }

      // Build insights map from intelligence layer (SQLite — synchronous)
      try {
        const allInsights = getInsights(ws.id);
        insightsMap = new Map();
        // Quick win pageIds are composite keys like "https://example.com/blog::seo tips"
        // Extract the page URL prefix (before "::") for matching against page_health pageIds
        const quickWinPageUrls = new Set(
          allInsights
            .filter(i => i.insightType === 'ranking_opportunity' && i.pageId)
            .map(i => i.pageId!.split('::')[0]),
        );
        const healthInsights = allInsights.filter(
          (i): i is AnalyticsInsight<'page_health'> => i.insightType === 'page_health' && !!i.pageId,
        );
        for (const insight of healthInsights) {
          insightsMap.set(insight.pageId!, {
            healthScore: insight.data.score,
            healthTrend: insight.data.trend,
            isQuickWin: quickWinPageUrls.has(insight.pageId!),
          });
        }
      } catch (err) {
        if (isProgrammingError(err)) {
          log.warn({ err }, 'helpers/buildSchemaContext: unexpected error building insights map');
        } else {
          log.debug({ err }, 'helpers/buildSchemaContext: intelligence layer not ready — skipping insights');
        }
      }

      // Store in cache (even if empty — avoids hammering APIs on sites with no connections)
      analyticsCache[cacheKey] = { maps: { gscMap, ga4Map, queryPageData, insightsMap }, ts: Date.now() };
    }
  }

  return { ctx, pageKeywordMap, gscMap, ga4Map, queryPageData, insightsMap };
}

// ── Audit Traffic Cache ──

const auditTrafficCache: Record<string, { data: Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>; ts: number }> = {};

export async function getAuditTrafficForWorkspace(ws: { id: string; webflowSiteId?: string; gscPropertyUrl?: string; ga4PropertyId?: string }): Promise<Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>> {
  if (!ws.webflowSiteId) return {};
  const cacheKey = ws.id;
  const cached = auditTrafficCache[cacheKey];
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data;
  const trafficMap: Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }> = {};
  if (ws.gscPropertyUrl) {
    try {
      const gscPages = await getAllGscPages(ws.id, ws.gscPropertyUrl, 28);
      for (const p of gscPages) {
        try {
          const urlPath = new URL(p.page).pathname;
          if (!trafficMap[urlPath]) trafficMap[urlPath] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
          trafficMap[urlPath].clicks += p.clicks;
          trafficMap[urlPath].impressions += p.impressions;
        } catch { /* skip malformed URLs */ }
      }
    } catch { /* GSC unavailable */ }
  }
  if (ws.ga4PropertyId) {
    try {
      const ga4Pages = await getGA4TopPages(ws.ga4PropertyId, 28, 500);
      for (const p of ga4Pages) {
        const urlPath = p.path.startsWith('/') ? p.path : `/${p.path}`;
        if (!trafficMap[urlPath]) trafficMap[urlPath] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
        trafficMap[urlPath].pageviews += p.pageviews;
        trafficMap[urlPath].sessions += p.users;
      }
    } catch { /* GA4 unavailable */ } // url-fetch-ok
  }
  auditTrafficCache[cacheKey] = { data: trafficMap, ts: Date.now() };
  return trafficMap;
}

// ── .env File Helpers ──

const ENV_PATH = path.resolve(process.cwd(), '.env');

export function readEnvFile(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    }
  }
  return vars;
}

export function writeEnvFile(vars: Record<string, string>) {
  const content = Object.entries(vars).map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, '')}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content);
}

/**
 * Fetch the published HTML of a URL. Returns null on network failure or non-OK response.
 * Lives here (not seo-audit.ts) to avoid a circular import:
 * seo-audit.ts imports checkSiteLinks from link-checker.ts, so link-checker.ts
 * cannot import from seo-audit.ts without creating a cycle.
 */
export async function fetchPublishedHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

// ── HTML / AI-response string utilities ──────────────────────────────────────

/**
 * Extract readable text from an HTML document.
 * Strips script, style, nav, footer, and optionally header. Collapses whitespace.
 * NOTE: Not safe for untrusted external HTML. Use only on internal Webflow-fetched pages.
 */
export function stripHtmlToText(
  html: string,
  opts?: { maxLength?: number; stripHeader?: boolean },
): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  let cleaned = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');
  if (opts?.stripHeader) {
    cleaned = cleaned.replace(/<header[\s\S]*?<\/header>/gi, '');
  }
  cleaned = cleaned
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return opts?.maxLength ? cleaned.slice(0, opts.maxLength) : cleaned;
}

/**
 * Strip Markdown code fences from AI responses.
 * Handles leading ```json, ```html, ```xml, or plain ``` fences.
 * Only strips the trailing fence when a leading fence was present.
 */
export function stripCodeFences(text: string): string {
  if (!/^```(?:json|html|xml)?\s*/i.test(text)) return text;
  return text
    .replace(/^```(?:json|html|xml)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
}
