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
import { getAllGscPages } from './search-console.js';
import { getGA4TopPages } from './google-analytics.js';
import { getDeclinedKeywords } from './keyword-feedback.js';
import { listSites } from './webflow-pages.js';
import { PAGE_ADDRESS_SOURCES } from '../shared/types/page-address.js';
import type { PageAddress, PageAddressInput, ResolvePageAddressOptions } from '../shared/types/page-address.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
import { CRITICAL_CHECKS, MODERATE_CHECKS, computePageScore } from '../shared/scoring.js';
import { buildWorkspaceIntelligence, formatPersonasForPrompt } from './workspace-intelligence.js';


const log = createLogger('helpers');

// ── HTML Utilities ──

/**
 * Decode common HTML entities to their plain-text equivalents.
 * Webflow HTML encodes apostrophes (&#x27;), ampersands (&amp;), etc.
 * Use this on any string extracted from raw HTML before storing or displaying.
 *
 * Handles:
 *  - Named entities: &amp; &lt; &gt; &quot; &apos; &nbsp;
 *  - Hex numeric entities: &#x27; &#x2F; and the generic &#xNNNN; pattern
 *  - Decimal numeric entities: &#39; and the generic &#NNNN; pattern
 *    (covers curly quotes &#8216;/&#8217;, dashes &#8211;/&#8212;, etc.)
 */
export function decodeEntities(text: string): string {
  return text
    // Generic hex numeric entities first (&#xNN; or &#xNNNN;) — covers &#x27;, &#x2F;, etc.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    // Generic decimal numeric entities (&#NN; or &#NNNN;) — covers &#39;, &#8217;, &#8211;, etc.
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    // Named entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ── Page Path Utilities ──

/** Normalize a page path: ensure leading slash, strip trailing slash (keep '/' as-is) */
export function normalizePath(p: string): string {
  const s = p.startsWith('/') ? p : `/${p}`;
  return s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s;
}

function normalizePageAddressPath(value: string): string {
  try {
    if (value.startsWith('http')) return normalizePath(new URL(value).pathname);
  } catch { // catch-ok: malformed URL string — fall through to path normalization
  }
  return normalizePath(value);
}

function buildCanonicalUrl(baseUrl: string | null | undefined, canonicalPath: string): string | undefined {
  if (!baseUrl) return undefined;
  const normalizedBase = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
  const trimmedBase = normalizedBase.replace(/\/+$/, '');
  return `${trimmedBase}${canonicalPath === '/' ? '' : canonicalPath}`;
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
  const address = resolvePageAddress(page);
  const primary = findPageMapEntry(pageMap, address.canonicalPath);
  if (primary) return primary;
  // Legacy fallback: pre-hardening entries stored under `/${slug}` for nested pages.
  if (address.legacyFallbackPath) {
    return findPageMapEntry(pageMap, address.legacyFallbackPath);
  }
  return undefined;
}

/** Resolve the full canonical page-address contract for Webflow/site page records. */
export function resolvePageAddress(
  page: PageAddressInput,
  options: ResolvePageAddressOptions = {},
): PageAddress {
  const includeLegacyFallback = options.includeLegacyFallback !== false;
  let canonicalPath = '/';
  let source: PageAddress['source'] = PAGE_ADDRESS_SOURCES.fallback;

  if (page.publishedPath !== undefined && page.publishedPath !== null) {
    canonicalPath = normalizePageAddressPath(page.publishedPath);
    source = PAGE_ADDRESS_SOURCES.publishedPath;
  } else if (page.path !== undefined && page.path !== null) {
    canonicalPath = normalizePageAddressPath(page.path);
    source = PAGE_ADDRESS_SOURCES.path;
  } else if (page.url !== undefined && page.url !== null) {
    canonicalPath = normalizePageAddressPath(page.url);
    source = PAGE_ADDRESS_SOURCES.url;
  } else if (page.slug !== undefined && page.slug !== null) {
    canonicalPath = normalizePageAddressPath(page.slug);
    source = PAGE_ADDRESS_SOURCES.slug;
  }

  const address: PageAddress = {
    canonicalPath,
    canonicalUrl: buildCanonicalUrl(options.baseUrl, canonicalPath),
    rawSlug: page.slug ?? null,
    source,
  };

  if (includeLegacyFallback && page.slug !== undefined && page.slug !== null) {
    const legacyFallbackPath = normalizePageAddressPath(page.slug);
    if (legacyFallbackPath.toLowerCase() !== canonicalPath.toLowerCase()) {
      address.legacyFallbackPath = legacyFallbackPath;
    }
  }

  return address;
}

/** Resolve a Webflow page's canonical path from publishedPath or slug */
export function resolvePagePath(page: PageAddressInput): string {
  return resolvePageAddress(page).canonicalPath;
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
export function tryResolvePagePath(page: PageAddressInput): string | undefined {
  const hasSlug = page.slug !== undefined && page.slug !== null;
  const hasPublishedPath = page.publishedPath !== undefined && page.publishedPath !== null;
  const hasPath = page.path !== undefined && page.path !== null;
  const hasUrl = page.url !== undefined && page.url !== null;
  if (!hasSlug && !hasPublishedPath && !hasPath && !hasUrl) return undefined;
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
  return normalizePageAddressPath(url);
}

/** Exact match for page identity values that may be full URLs, paths, or bare slugs. */
export function matchPageIdentity(a: string, b: string): boolean {
  return normalizePageUrl(a).toLowerCase() === normalizePageUrl(b).toLowerCase();
}

/** Find a pageMap entry from a full URL/path/bare slug using exact normalized page identity. */
export function findPageMapEntryByIdentity<T extends { pagePath: string }>(
  pageMap: T[],
  pageIdentity: string,
): T | undefined {
  return findPageMapEntry(pageMap, normalizePageUrl(pageIdentity));
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
    .replace(/<\|[^|]*\|>/g, '[removed-control-token]')
    .replace(/<\/?untrusted_user_content>/gi, (tag) =>
      tag.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    );
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
  if (!s || !e) return undefined;
  if (!isCanonicalDateOnly(s) || !isCanonicalDateOnly(e)) return undefined;
  if (s > e) return undefined;
  return { startDate: s, endDate: e };
}

function isCanonicalDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

// 5-minute TTL cache for schema intelligence signals used during generation.
const analyticsCache: Record<string, {
  serpFeatures?: { featuredSnippets: number; peopleAlsoAsk: number; localPack: boolean; videoCarousel: number };
  backlinkReferringDomains?: number;
  ts: number;
}> = {};
const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;

// 5-minute TTL cache for listSites() — prevents an extra Webflow API round-trip on every
// single-page schema generation request. Keyed by workspace token (or '' for global).
const sitesCache: Record<string, {
  sites: Array<{ id: string; displayName: string; shortName: string; defaultLocale: string }>;
  ts: number;
}> = {};

async function listSitesCached(
  tokenOverride?: string,
): Promise<Array<{ id: string; displayName: string; shortName: string; defaultLocale: string }>> {
  const key = tokenOverride ?? '';
  const cached = sitesCache[key];
  if (cached && Date.now() - cached.ts < ANALYTICS_CACHE_TTL_MS) return cached.sites;
  const sites = await listSites(tokenOverride);
  sitesCache[key] = { sites, ts: Date.now() };
  return sites;
}

export async function buildSchemaContext(
  siteId: string,
  options?: { includeAnalytics?: boolean },
): Promise<{
  ctx: SchemaContext;
}> {
  const allWs = listWorkspaces();
  const ws = allWs.find(w => w.webflowSiteId === siteId);
  const ctx: SchemaContext = {};
  if (ws) {
    ctx.companyName = ws.name;
    ctx.liveDomain = ws.liveDomain;

    // Schema context now consumes SEO/business data from workspace intelligence.
    // Remaining direct reads in this function are identity/analytics paths only.
    let schemaIntel: Awaited<ReturnType<typeof buildWorkspaceIntelligence>> | null = null;
    try {
      schemaIntel = await buildWorkspaceIntelligence(ws.id, { slices: ['seoContext'] });
    } catch (err) {
      log.warn({ err, workspaceId: ws.id, siteId }, 'buildSchemaContext: intelligence seoContext unavailable');
    } // catch-ok

    // Audit Correction 2: SeoContextSlice field is strategy.siteKeywords (not keywordStrategy.siteKeywords).
    const rawSiteKeywords = schemaIntel?.seoContext?.strategy?.siteKeywords;
    if (rawSiteKeywords?.length) {
      // Audit Correction 3: slice does NOT apply the declined filter — schema layer must.
      const declined = getDeclinedKeywords(ws.id);
      if (declined.length > 0) {
        const declinedSet = new Set(declined.map(k => k.toLowerCase()));
        ctx.siteKeywords = rawSiteKeywords.filter(k => !declinedSet.has(k.toLowerCase()));
      } else {
        ctx.siteKeywords = rawSiteKeywords;
      }
    }
    ctx.businessContext = schemaIntel?.seoContext?.businessContext;
    ctx.logoUrl = ws.brandLogoUrl;
    ctx.workspaceId = ws.id;
    ctx._siteId = siteId;

    // Resolve site-wide default locale from Webflow (paid-grade `inLanguage`).
    // Pass the workspace's per-site token so this works for workspaces that don't
    // rely on the global WEBFLOW_API_TOKEN env var.
    try {
      const sites = await listSitesCached(ws.webflowToken || undefined);
      const matched = sites.find(s => s.id === siteId);
      if (matched?.defaultLocale) ctx._defaultLocale = matched.defaultLocale;
    } catch { /* listSites failure: leave _defaultLocale undefined; downstream falls back to 'en' */ } // catch-ok

    // Knowledge base from workspace intelligence (inline + knowledge-docs/ files)
    const rawKB = schemaIntel?.seoContext?.knowledgeBase ?? '';
    if (rawKB) ctx.knowledgeBase = rawKB.slice(0, 4000);

    // Audience personas for richer schema targeting
    const personasBlock = formatPersonasForPrompt(schemaIntel?.seoContext?.personas);
    if (personasBlock) ctx._personasBlock = personasBlock;

    // Verified business profile for schema grounding (bypasses page content verification)
    const profile = schemaIntel?.seoContext?.businessProfile;
    if (profile) {
      ctx._businessProfile = {
        phone: profile.phone,
        email: profile.email,
        address: profile.addressParts,
        socialProfiles: profile.socialProfiles,
        openingHours: profile.openingHours,
        foundedDate: profile.foundedDate,
        numberOfEmployees: profile.numberOfEmployees,
      };
    }

    ctx._siteHasSearch = ws.siteHasSearch === true;

  }
  // Fetch schema intelligence signals when requested (for schema generation routes)
  if (options?.includeAnalytics && ws) {
    const cacheKey = ws.id;
    const cached = analyticsCache[cacheKey];
    if (cached && Date.now() - cached.ts < ANALYTICS_CACHE_TTL_MS) {
      if (cached.serpFeatures) ctx._serpFeatures = cached.serpFeatures;
      if (cached.backlinkReferringDomains != null) ctx._backlinkReferringDomains = cached.backlinkReferringDomains;
    } else {
      // Wire in SEO intelligence signals — cached to avoid per-request latency.
      let cachedSerpFeatures: typeof ctx._serpFeatures | undefined;
      let cachedBacklinkDomains: number | undefined;
      try {
        const intel = await buildWorkspaceIntelligence(ws.id, { slices: ['seoContext'] });
        if (intel.seoContext?.serpFeatures) {
          cachedSerpFeatures = intel.seoContext.serpFeatures;
          ctx._serpFeatures = cachedSerpFeatures;
        }
        if (intel.seoContext?.backlinkProfile?.referringDomains != null) {
          cachedBacklinkDomains = intel.seoContext.backlinkProfile.referringDomains;
          ctx._backlinkReferringDomains = cachedBacklinkDomains;
        }
      } catch (err) {
        if (isProgrammingError(err)) {
          log.warn({ err }, 'helpers/buildSchemaContext: intelligence layer error');
        } else {
          log.debug({ err }, 'helpers/buildSchemaContext: intelligence layer not ready — skipping SEO signals');
        }
      }

      // Store in cache (even if empty — avoids repeated read work on sites with no connections)
      analyticsCache[cacheKey] = {
        serpFeatures: cachedSerpFeatures,
        backlinkReferringDomains: cachedBacklinkDomains,
        ts: Date.now(),
      };
    }
  }

  return { ctx };
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
          const urlPath = normalizePageUrl(p.page);
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
        const urlPath = normalizePageUrl(p.path);
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
 *
 * Trims leading/trailing whitespace from the input first — without this, an
 * AI response like `"\n```json\n{...}\n```"` would skip the fence-strip path
 * because the `^` anchor in the regex doesn't match the backtick. (Devin
 * follow-up to PR #371.)
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!/^```(?:json|html|xml)?\s*/i.test(trimmed)) return trimmed;
  return trimmed
    .replace(/^```(?:json|html|xml)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
}

/**
 * Normalise a URL to a relative path for `analytics_insights.page_id` storage.
 * GSC/GA4 producers emit full URLs; insight `page_id` is stored as the URL pathname
 * so consumers can compare against site-relative paths. Already-relative inputs
 * (or non-URL strings) pass through unchanged.
 */
export function toInsightPageId(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

/**
 * Convert a Webflow audit page object to the canonical relative path used for
 * `analytics_insights.page_id`. Prefers the URL pathname because nested Webflow
 * pages can share leaf slugs, falls back to slug (→ /slug), and finally falls
 * back to the raw pageId (Webflow UUID) as a last resort.
 * Defensively strips leading slashes from slug to avoid `//foo` from a leading-slash slug.
 */
export function toAuditFindingPageId(page: { slug: string; url: string; pageId: string }): string {
  try { if (page.url) return new URL(page.url).pathname; } catch { /* fall through */ }
  if (page.slug) return `/${page.slug.replace(/^\/+/, '')}`;
  return page.pageId;
}
