/**
 * Insight Enrichment Module
 *
 * Resolves page titles, checks strategy alignment, links pipeline status,
 * and computes impact scores for AnalyticsInsight records.
 *
 * Called by analytics-intelligence.ts during the insight computation cycle.
 */

import { createLogger } from './logger.js';
import type {
  AnalyticsInsight,
  InsightType,
  InsightDomain,
  InsightSeverity,
} from '../shared/types/analytics.js';
import type { PageKeywordMap } from '../shared/types/workspace.js';
import type { ContentBrief, GeneratedPost } from '../shared/types/content.js';
import type { SeoIssue } from './audit-page.js';
import { getValidation } from './schema-validator.js';

const log = createLogger('insight-enrichment');

// ── Pure utility functions ────────────────────────────────────────────────────

/** Known acronyms that should be fully uppercased in title-cased text. */
const ACRONYMS = new Set(['ai', 'ui', 'ux', 'seo', 'ctr', 'gsc', 'ga4', 'api', 'url', 'roi', 'cms']);

/** Title-case a single word, uppercasing known acronyms. */
function titleCaseWord(word: string): string {
  return ACRONYMS.has(word.toLowerCase())
    ? word.toUpperCase()
    : word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Converts a URL path or full URL into a human-readable title.
 *
 * Examples:
 *   /blog/best-ai-coding-agents  → "Best AI Coding Agents"
 *   /docs/getting-started/installation → "Installation"
 *   https://example.com/blog/my-post → "My Post"
 *   /  → "Home"
 */
export function cleanSlugToTitle(urlOrPath: string): string {
  let pathname = urlOrPath;

  // Extract pathname if it looks like a full URL
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    try {
      pathname = new URL(urlOrPath).pathname;
    } catch {
      // fall through with original value
    }
  }

  // Strip trailing slash
  pathname = pathname.replace(/\/$/, '');

  if (!pathname || pathname === '/') return 'Home';

  // Take the last segment
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return 'Home';

  const slug = segments[segments.length - 1];

  // Convert hyphens/underscores to spaces and title-case each word.
  return slug
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(titleCaseWord)
    .join(' ');
}

/**
 * Maps an InsightType to its primary data domain.
 *
 * - 'search'  — driven purely by GSC data
 * - 'traffic' — driven primarily by GA4 data
 * - 'cross'   — spans both GSC + GA4 (or neither)
 */
export function classifyDomain(type: InsightType): InsightDomain {
  const searchTypes: InsightType[] = [
    'ranking_mover',
    'ctr_opportunity',
    'ranking_opportunity',
    'serp_opportunity',
    'cannibalization',
  ];

  const trafficTypes: InsightType[] = [
    'conversion_attribution',
  ];

  // anomaly_digest domain is set explicitly by the anomaly detection loop
  // based on anomaly type (traffic/search/cross), so this fallback to 'cross'
  // is only hit if anomaly_digest goes through the standard enrichment path.

  if (searchTypes.includes(type)) return 'search';
  if (trafficTypes.includes(type)) return 'traffic';
  return 'cross';
}

/**
 * Computes an impact score (0–150) for an insight.
 *
 * Severity base weights:
 *   critical=100, warning=60, opportunity=40, positive=20
 *
 * Traffic bonus: Math.min(Math.log10(Math.max(traffic, 1)) * 10, 50)
 * where traffic = clicks ?? impressions ?? users ?? pageviews ?? 0
 */
export function computeImpactScore(
  severity: InsightSeverity,
  data: Record<string, unknown>,
): number {
  const severityWeights: Record<InsightSeverity, number> = {
    critical: 100,
    warning: 60,
    opportunity: 40,
    positive: 20,
  };

  const base = severityWeights[severity] ?? 20;

  // Check all common traffic field names across insight types:
  // page_health/ranking_opportunity: clicks, impressions
  // ranking_mover: currentClicks, impressions
  // content_decay: currentClicks, baselineClicks
  // cannibalization/keyword_cluster: totalImpressions
  // conversion_attribution: sessions
  // anomaly_digest: expectedValue (the baseline metric magnitude)
  const traffic =
    (data.clicks as number | undefined) ??
    (data.currentClicks as number | undefined) ??
    (data.impressions as number | undefined) ??
    (data.totalImpressions as number | undefined) ??
    (data.users as number | undefined) ??
    (data.sessions as number | undefined) ??
    (data.pageviews as number | undefined) ??
    (data.baselineClicks as number | undefined) ??
    (data.expectedValue as number | undefined) ??
    0;

  const bonus = Math.min(Math.log10(Math.max(traffic, 1)) * 10, 50);

  return Math.round(base + bonus);
}

/**
 * Resolves a human-readable page title for an insight.
 *
 * Lookup order:
 *   1. titleMap (pre-built from page_keywords for the workspace)
 *   2. cleanSlugToTitle fallback
 *
 * Returns null when pageId is null/empty.
 */
export function resolvePageTitle(
  pageId: string | null,
  titleMap: Map<string, string>,
): string | null {
  if (!pageId) return null;

  // Handle composite pageIds (e.g., "page::query", "cannibalization::query", "cluster::label")
  // Split on :: and use the meaningful part for title resolution
  if (pageId.includes('::')) {
    const [left, right] = pageId.split('::', 2);
    // If left is a URL, resolve it as the page title
    if (left.startsWith('http://') || left.startsWith('https://') || left.startsWith('/')) {
      const title = resolvePageTitle(left, titleMap);
      return title;
    }
    // For non-URL prefixes (cannibalization::, cluster::), use the right part as a readable label
    if (right) {
      return right.split(/\s+/).map(titleCaseWord).join(' ');
    }
  }

  // Exact match first
  const exactTitle = titleMap.get(pageId);
  if (exactTitle) return exactTitle;

  // Try matching by pathname in case the stored key differs from the full URL
  let pathname = pageId;
  if (pageId.startsWith('http://') || pageId.startsWith('https://')) {
    try {
      pathname = new URL(pageId).pathname;
    } catch {
      // keep original
    }
  }

  const pathTitle = titleMap.get(pathname);
  if (pathTitle) return pathTitle;

  // Fall back to slug-derived title
  return cleanSlugToTitle(pageId);
}

// ── Strategy alignment ────────────────────────────────────────────────────────

export interface StrategyAlignmentResult {
  keyword: string | null;
  alignment: AnalyticsInsight['strategyAlignment'];
}

/**
 * Checks whether a page is targeted in the keyword strategy.
 *
 * strategyPageMap: Map<pagePath, PageKeywordMap> (normalised paths as keys)
 */
export function checkStrategyAlignment(
  pageId: string | null,
  strategyPageMap: Map<string, PageKeywordMap>,
): StrategyAlignmentResult {
  if (!pageId) return { keyword: null, alignment: null };

  // Normalise to pathname
  let pathname = pageId;
  if (pageId.startsWith('http://') || pageId.startsWith('https://')) {
    try {
      pathname = new URL(pageId).pathname;
    } catch {
      // keep original
    }
  }

  // Try exact and normalized path
  const entry = strategyPageMap.get(pathname) ?? strategyPageMap.get(pageId);

  if (!entry) {
    return { keyword: null, alignment: 'untracked' };
  }

  // Page is in strategy — consider it aligned if it has a primary keyword
  return {
    keyword: entry.primaryKeyword || null,
    alignment: entry.primaryKeyword ? 'aligned' : 'untracked',
  };
}

// ── Pipeline status ───────────────────────────────────────────────────────────

/**
 * Checks whether a page has associated content pipeline activity.
 *
 * Returns:
 *   'published'    — a post is published (publishedAt set)
 *   'in_progress'  — a post exists but is not published
 *   'brief_exists' — a brief exists but no post yet
 *   null           — no pipeline activity found
 */
export function checkPipelineStatus(
  pageId: string | null,
  briefs: ContentBrief[],
  posts: GeneratedPost[],
): AnalyticsInsight['pipelineStatus'] {
  if (!pageId) return null;

  // Normalise pageId to pathname for comparison
  let pathname = pageId;
  if (pageId.startsWith('http://') || pageId.startsWith('https://')) {
    try {
      pathname = new URL(pageId).pathname;
    } catch {
      // keep original
    }
  }

  const normalise = (s: string): string => {
    try {
      return new URL(s).pathname;
    } catch {
      return s;
    }
  };

  // Check posts first (most complete)
  const matchingPost = posts.find((p) => {
    const kw = p.targetKeyword?.toLowerCase() ?? '';
    const pn = normalise(pathname);
    return pn.includes(kw.replace(/\s+/g, '-')) || kw === pn.replace(/^\//, '').replace(/-/g, ' ');
  });

  if (matchingPost) {
    return matchingPost.publishedAt ? 'published' : 'in_progress';
  }

  // Check briefs
  const matchingBrief = briefs.find((b) => {
    const kw = b.targetKeyword?.toLowerCase() ?? '';
    const pn = normalise(pathname);
    return pn.includes(kw.replace(/\s+/g, '-')) || kw === pn.replace(/^\//, '').replace(/-/g, ' ');
  });

  if (matchingBrief) return 'brief_exists';

  return null;
}

// ── Schema gap detection ──────────────────────────────────────────────────────

/**
 * Returns schema gap descriptions for a page based on stored schema validations.
 *
 * Looks up the schema_validations table for the given page and extracts:
 *   - Validation errors (missing required fields)
 *   - Validation warnings (missing recommended fields)
 *   - Rich result eligibility gaps
 *
 * Returns an empty array if no validation data exists (never blocks enrichment).
 */
export function getSchemaGapsForPage(workspaceId: string, pageUrl: string): string[] {
  try {
    // Try exact match first, then pathname-only match
    let validation = getValidation(workspaceId, pageUrl);

    if (!validation && (pageUrl.startsWith('http://') || pageUrl.startsWith('https://'))) {
      try {
        const pathname = new URL(pageUrl).pathname;
        validation = getValidation(workspaceId, pathname);
      } catch {
        // invalid URL, skip pathname fallback
      }
    }

    if (!validation) return [];

    const gaps: string[] = [];

    // Extract error-level gaps (missing required fields)
    if (Array.isArray(validation.errors)) {
      for (const err of validation.errors) {
        if (err && typeof err === 'object' && 'message' in err) {
          gaps.push((err as { message: string }).message);
        }
      }
    }

    // Extract warning-level gaps (missing recommended fields)
    if (Array.isArray(validation.warnings)) {
      for (const warn of validation.warnings) {
        if (warn && typeof warn === 'object' && 'message' in warn) {
          gaps.push((warn as { message: string }).message);
        }
      }
    }

    // Flag if page has no rich result eligibility
    if (!Array.isArray(validation.richResults) || validation.richResults.length === 0) {
      gaps.push('No rich result types detected — consider adding structured data');
    }

    return gaps;
  } catch (err) {
    log.warn({ workspaceId, pageUrl, err }, 'Schema gap lookup failed — skipping');
    return [];
  }
}

// ── Enrichment context ────────────────────────────────────────────────────────

export interface EnrichmentContext {
  workspaceId: string;
  titleMap: Map<string, string>;
  strategyPageMap: Map<string, PageKeywordMap>;
  briefs: ContentBrief[];
  posts: GeneratedPost[];
  /** Map of normalised page slug → top audit issues (error/warning only, max 5) */
  auditPageIssuesMap: Map<string, string[]>;
}

// ── Audit issue lookup ────────────────────────────────────────────────────────

/** Max audit issues to attach per page */
const MAX_AUDIT_ISSUES_PER_PAGE = 5;

/**
 * Builds a map of page slug → top error/warning issue messages from the latest
 * audit snapshot. Keyed by normalised slug (lowercase, no leading slash) so
 * lookups from pageId URLs work reliably.
 *
 * Returns an empty map when no audit data exists — never throws.
 */
async function buildAuditIssuesMap(workspaceId: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();

  try {
    // Dynamic imports to avoid circular deps
    const { getWorkspace } = await import('./workspaces.js');
    const { getLatestSnapshot } = await import('./reports.js');

    const workspace = getWorkspace(workspaceId);
    if (!workspace?.webflowSiteId) return map;

    const snapshot = getLatestSnapshot(workspace.webflowSiteId);
    if (!snapshot?.audit?.pages) return map;

    for (const page of snapshot.audit.pages) {
      // Filter to actionable issues only (errors and warnings)
      const actionable = page.issues.filter(
        (i: SeoIssue) => i.severity === 'error' || i.severity === 'warning',
      );
      if (actionable.length === 0) continue;

      // Take top N issue messages
      const messages = actionable
        .slice(0, MAX_AUDIT_ISSUES_PER_PAGE)
        .map((i: SeoIssue) => i.message);

      // Store under normalised slug (lowercase, no leading or trailing slash)
      const normSlug = (page.slug || '').toLowerCase().replace(/^\//, '').replace(/\/$/, '');
      if (normSlug) {
        map.set(normSlug, messages);
      }
    }
  } catch (err) {
    log.warn({ workspaceId, err }, 'audit snapshot unavailable for enrichment context');
  }

  return map;
}

/**
 * Looks up audit issues for a specific page URL/path from the pre-built map.
 * Returns an empty array when no issues found.
 */
export function getAuditIssuesForPage(
  pageId: string | null,
  auditMap: Map<string, string[]>,
): string[] {
  if (!pageId || auditMap.size === 0) return [];

  // Normalise pageId to a slug for matching
  let pathname = pageId;
  if (pageId.startsWith('http://') || pageId.startsWith('https://')) {
    try {
      pathname = new URL(pageId).pathname;
    } catch {
      // keep original
    }
  }

  const normSlug = pathname.toLowerCase().replace(/^\//, '').replace(/\/$/, '');
  return auditMap.get(normSlug) ?? [];
}

/**
 * Loads all data required to enrich insights for a workspace.
 * Expensive: call once per computation cycle, then pass the context to enrichInsight().
 *
 * Uses graceful fallbacks — if any module fails to load it returns empty collections.
 */
export async function buildEnrichmentContext(workspaceId: string): Promise<EnrichmentContext> {
  const titleMap = new Map<string, string>();
  const strategyPageMap = new Map<string, PageKeywordMap>();
  let briefs: ContentBrief[] = [];
  let posts: GeneratedPost[] = [];

  // Load page keywords (title map + strategy page map)
  try {
    const { listPageKeywords } = await import('./page-keywords.js');
    const entries = listPageKeywords(workspaceId);
    for (const entry of entries) {
      if (entry.pageTitle) {
        titleMap.set(entry.pagePath, entry.pageTitle);
      }
      strategyPageMap.set(entry.pagePath, entry);
    }
  } catch (err) {
    log.warn({ workspaceId, err }, 'page-keywords unavailable for enrichment context');
  }

  // Load briefs using dynamic import to avoid circular deps
  try {
    const briefMod = await import('./content-brief.js');
    briefs = briefMod.listBriefs(workspaceId);
  } catch (err) {
    log.warn({ workspaceId, err }, 'content-brief unavailable for enrichment context');
  }

  // Load posts using dynamic import to avoid circular deps
  try {
    const postsMod = await import('./content-posts-db.js');
    posts = postsMod.listPosts(workspaceId);
  } catch (err) {
    log.warn({ workspaceId, err }, 'content-posts-db unavailable for enrichment context');
  }

  // Load audit issues map (page slug → top error/warning messages)
  const auditPageIssuesMap = await buildAuditIssuesMap(workspaceId);

  return { workspaceId, titleMap, strategyPageMap, briefs, posts, auditPageIssuesMap };
}

// ── Main enrichment function ──────────────────────────────────────────────────

/**
 * Enriches a single insight with:
 *   - pageTitle (resolved from titleMap or slug)
 *   - strategyKeyword + strategyAlignment
 *   - pipelineStatus
 *   - auditIssues (page_health: linked SEO audit issues; serp_opportunity: schema gaps)
 *   - impactScore
 *   - domain
 *
 * Returns a Partial<AnalyticsInsight> with only the enrichment fields populated.
 * Merge into the insight record in the caller.
 */
export function enrichInsight(
  insight: Pick<AnalyticsInsight, 'pageId' | 'insightType' | 'severity' | 'data'>,
  ctx: EnrichmentContext,
): Partial<AnalyticsInsight> {
  const enriched: Partial<AnalyticsInsight> = {};

  // Page title
  enriched.pageTitle = resolvePageTitle(insight.pageId, ctx.titleMap);

  // Strategy alignment
  const alignment = checkStrategyAlignment(insight.pageId, ctx.strategyPageMap);
  enriched.strategyKeyword = alignment.keyword;
  enriched.strategyAlignment = alignment.alignment;

  // Pipeline status
  enriched.pipelineStatus = checkPipelineStatus(insight.pageId, ctx.briefs, ctx.posts);

  // Impact score
  enriched.impactScore = computeImpactScore(insight.severity, insight.data);

  // Domain classification
  enriched.domain = classifyDomain(insight.insightType);

  // Audit issues — attach linked audit issues for page_health insights
  if (insight.insightType === 'page_health' && insight.pageId) {
    try {
      const auditIssues = getAuditIssuesForPage(insight.pageId, ctx.auditPageIssuesMap);
      if (auditIssues.length > 0) {
        enriched.auditIssues = JSON.stringify(auditIssues);
      }
    } catch (err) {
      // Enrichment failure must never block insight storage
      log.warn({ insightType: insight.insightType, pageId: insight.pageId, err }, 'audit issue enrichment failed');
    }
  }

  // Schema gap enrichment for SERP opportunity insights
  if (insight.insightType === 'serp_opportunity' && insight.pageId) {
    try {
      const schemaGaps = getSchemaGapsForPage(ctx.workspaceId, insight.pageId);
      if (schemaGaps.length > 0) {
        enriched.auditIssues = JSON.stringify(schemaGaps);
      }
    } catch (err) {
      log.warn({ insightType: insight.insightType, pageId: insight.pageId, err }, 'Schema gap enrichment failed');
    }
  }

  return enriched;
}
