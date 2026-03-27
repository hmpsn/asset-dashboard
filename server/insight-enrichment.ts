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

const log = createLogger('insight-enrichment');

// ── Pure utility functions ────────────────────────────────────────────────────

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

  // Known acronyms that should be fully uppercased even though they appear lowercase in slugs.
  const ACRONYMS = new Set(['ai', 'ui', 'ux', 'seo', 'ctr', 'gsc', 'ga4', 'api', 'url', 'roi', 'cms']);

  // Convert hyphens/underscores to spaces and title-case each word.
  return slug
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
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
  const traffic =
    (data.clicks as number | undefined) ??
    (data.currentClicks as number | undefined) ??
    (data.impressions as number | undefined) ??
    (data.totalImpressions as number | undefined) ??
    (data.users as number | undefined) ??
    (data.sessions as number | undefined) ??
    (data.pageviews as number | undefined) ??
    (data.baselineClicks as number | undefined) ??
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

// ── Enrichment context ────────────────────────────────────────────────────────

export interface EnrichmentContext {
  titleMap: Map<string, string>;
  strategyPageMap: Map<string, PageKeywordMap>;
  briefs: ContentBrief[];
  posts: GeneratedPost[];
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

  return { titleMap, strategyPageMap, briefs, posts };
}

// ── Main enrichment function ──────────────────────────────────────────────────

/**
 * Enriches a single insight with:
 *   - pageTitle (resolved from titleMap or slug)
 *   - strategyKeyword + strategyAlignment
 *   - pipelineStatus
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

  return enriched;
}
