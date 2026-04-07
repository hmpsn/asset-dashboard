/**
 * useInsightFeed — React Query hook for the Connected Intelligence priority feed.
 *
 * Fetches raw AnalyticsInsight[] from the public insights endpoint, transforms
 * each to a FeedInsight with human-readable headlines and context lines, sorts
 * by impactScore descending, and computes SummaryCount[] pill badge data.
 */

import { useQuery } from '@tanstack/react-query';
import { getSafe } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';
import { fmtNum } from '../../utils/formatNumbers';
import { INSIGHT_FILTER_KEYS, type AnalyticsInsight } from '../../../shared/types/analytics.js';
import type { FeedInsight, SummaryCount } from '../../../shared/types/insights.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Known acronyms that should be fully uppercased — same set as server/insight-enrichment.ts. */
const ACRONYMS = new Set(['ai', 'ui', 'ux', 'seo', 'ctr', 'gsc', 'ga4', 'api', 'url', 'roi', 'cms']);

function titleCaseWord(word: string): string {
  return ACRONYMS.has(word.toLowerCase())
    ? word.toUpperCase()
    : word.charAt(0).toUpperCase() + word.slice(1);
}

/** GA4/GSC placeholder values that should be treated as missing (no real title). */
const GA_PLACEHOLDER_RE = /^\((not set|not provided|other)\)$/i;

/**
 * Converts a URL slug to a readable title.
 * e.g. "https://example.com/blog/seo-tips" → "SEO Tips"
 */
export function cleanSlugToTitle(url: string | null): string {
  if (!url) return 'Unknown Page';

  // Root path = homepage
  if (url === '/') return 'Home';

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length === 0) return 'Home';
    const slug = parts[parts.length - 1];
    return slug
      .replace(/[-_]/g, ' ')
      .split(' ')
      .map(titleCaseWord)
      .join(' ')
      .trim() || 'Home';
  } catch {
    // Not a valid URL — try treating the string as a slug directly
    const cleaned = url.replace(/^\/+|\/+$/g, '');
    if (!cleaned) return 'Home';
    return cleaned
      .replace(/[-_/]/g, ' ')
      .split(' ')
      .map(titleCaseWord)
      .join(' ')
      .trim() || 'Home';
  }
}

// ── Transform ─────────────────────────────────────────────────────────────────

/**
 * Transforms a raw AnalyticsInsight into a FeedInsight for display.
 * Exported for unit testing.
 */
export function transformToFeedInsight(insight: AnalyticsInsight): FeedInsight {
  const rawTitle = insight.pageTitle;
  const title = (rawTitle && !GA_PLACEHOLDER_RE.test(rawTitle))
    ? rawTitle
    : cleanSlugToTitle(insight.pageId);
  const data = insight.data as Record<string, unknown>;

  let headline = '';
  let contextParts: string[] = [];

  switch (insight.insightType) {
    case 'ranking_mover': {
      const prev = data.previousPosition as number | undefined;
      const curr = data.currentPosition as number | undefined;
      const currentClicks = data.currentClicks as number | undefined;
      const previousClicks = data.previousClicks as number | undefined;
      if (curr !== undefined && prev !== undefined) {
        const improved = curr < prev; // lower position = better
        if (improved) {
          headline = curr <= 10 ? `climbed to position ${curr}` : `improved to position ${curr}`;
        } else {
          headline = curr > 10 ? `dropped off page 1` : `fell to position ${curr}`;
        }
        contextParts.push(`Position ${prev} → ${curr}`);
        const clickDelta = (currentClicks !== undefined && previousClicks !== undefined) ? currentClicks - previousClicks : undefined;
        if (clickDelta !== undefined && clickDelta !== 0) {
          const sign = clickDelta > 0 ? '+' : '';
          contextParts.push(`${sign}${fmtNum(clickDelta)} clicks/mo`);
        }
      } else {
        headline = 'position changed';
      }
      break;
    }

    case 'ctr_opportunity': {
      const actualCtr = data.actualCtr as number | undefined;
      const expectedCtr = data.expectedCtr as number | undefined;
      if (actualCtr !== undefined && expectedCtr !== undefined) {
        headline = `CTR ${actualCtr.toFixed(1)}% vs ${expectedCtr.toFixed(1)}% expected`;
        const impressions = data.impressions as number | undefined;
        if (impressions !== undefined) {
          contextParts.push(`${fmtNum(impressions)} impressions`);
        }
      } else {
        headline = 'low CTR vs expected';
      }
      break;
    }

    case 'ranking_opportunity': {
      const currentPosition = data.currentPosition as number | undefined;
      const positionsFromP1 = currentPosition !== undefined ? Math.ceil(currentPosition) - 10 : undefined;
      if (positionsFromP1 !== undefined && positionsFromP1 > 0) {
        headline = `${positionsFromP1} positions from page 1`;
      } else if (currentPosition !== undefined) {
        headline = `currently position ${Math.round(currentPosition)}`;
      } else {
        headline = 'ranking opportunity';
      }
      const estimatedGain = data.estimatedTrafficGain as number | undefined;
      if (estimatedGain !== undefined) {
        contextParts.push(`~${fmtNum(estimatedGain)} clicks/mo potential`);
      }
      break;
    }

    case 'content_decay': {
      const delta = data.deltaPercent as number | undefined;
      if (delta !== undefined) {
        headline = `lost ${Math.abs(Math.round(delta))}% traffic`;
        const baseline = data.baselineClicks as number | undefined;
        const current = data.currentClicks as number | undefined;
        if (baseline !== undefined && current !== undefined) {
          contextParts.push(`${fmtNum(current)} vs ${fmtNum(baseline)} clicks`);
        }
      } else {
        headline = 'traffic declining';
      }
      break;
    }

    case 'page_health': {
      const score = data.score as number | undefined;
      if (score !== undefined) {
        headline = `health score ${Math.round(score)}`;
        const trend = data.trend as string | undefined;
        if (trend) contextParts.push(trend);
      } else {
        headline = 'page health issue';
      }
      break;
    }

    case 'audit_finding': {
      const scope = data.scope as string | undefined;
      const issueCount = data.issueCount as number | undefined;
      if (scope === 'site') {
        const siteScore = data.siteScore as number | undefined;
        headline = siteScore !== undefined ? `site audit score ${siteScore}` : 'site audit issues';
        if (issueCount) contextParts.push(`${issueCount} issue${issueCount !== 1 ? 's' : ''}`);
      } else {
        headline = issueCount ? `${issueCount} audit issue${issueCount !== 1 ? 's' : ''}` : 'audit finding';
      }
      break;
    }

    case 'serp_opportunity': {
      headline = 'eligible for rich results';
      const schemaType = data.schemaType as string | undefined;
      if (schemaType) contextParts.push(schemaType);
      break;
    }

    case 'cannibalization': {
      const pages = data.pages as string[] | undefined;
      const count = Array.isArray(pages) ? pages.length : (data.pageCount as number | undefined);
      if (count !== undefined) {
        headline = `${count} pages competing for same query`;
      } else {
        headline = 'keyword cannibalization';
      }
      const query = data.query as string | undefined;
      if (query) contextParts.push(`"${query}"`);
      break;
    }

    case 'conversion_attribution': {
      const conversions = data.conversions as number | undefined;
      if (conversions !== undefined) {
        headline = `drove ${fmtNum(conversions)} conversions`;
      } else {
        headline = 'conversion driver';
      }
      const rate = data.conversionRate as number | undefined;
      // rate is already a percentage (e.g., 4.0 for 4%) from the backend
      if (rate !== undefined) contextParts.push(`${rate.toFixed(1)}% CVR`);
      break;
    }

    default: {
      headline = insight.insightType.replace(/_/g, ' ');
      break;
    }
  }

  // Append strategy keyword
  if (insight.strategyKeyword) {
    contextParts.push(`Strategy keyword match`);
  }

  // Append pipeline status
  if (insight.pipelineStatus) {
    const statusLabel: Record<string, string> = {
      brief_exists: 'Brief exists',
      in_progress: 'Content in progress',
      published: 'Published',
    };
    const label = statusLabel[insight.pipelineStatus];
    if (label) contextParts.push(label);
  }

  const context = contextParts.join(' · ');
  const domain = insight.domain ?? 'cross';

  // Build expandable details for insight types with drill-down data
  let details: string[] | undefined;
  if (insight.insightType === 'cannibalization') {
    const pages = data.pages as string[] | undefined;
    if (Array.isArray(pages) && pages.length > 0) {
      const positions = data.positions as number[] | undefined;
      details = pages.map((p, i) => {
        const pos = positions?.[i];
        try { p = new URL(p).pathname; } catch { /* use as-is */ }
        return pos !== undefined ? `${p} — position ${pos}` : p;
      });
    }
  } else if (insight.insightType === 'keyword_cluster') {
    const queries = data.queries as string[] | undefined;
    if (Array.isArray(queries) && queries.length > 0) {
      details = queries.slice(0, 10);
      if (queries.length > 10) details.push(`+ ${queries.length - 10} more queries`);
    }
  }

  return {
    id: insight.id,
    type: insight.insightType,
    severity: insight.severity,
    title,
    headline,
    context,
    pageUrl: insight.pageId ?? undefined,
    domain,
    impactScore: insight.impactScore ?? 0,
    details,
  };
}

// ── Summary counts ─────────────────────────────────────────────────────────────

/**
 * Produces pill badge data from a transformed feed.
 * Exported for unit testing.
 */
export function computeSummaryCounts(feed: FeedInsight[]): SummaryCount[] {
  const drops = feed.filter(f => f.severity === 'critical' || f.severity === 'warning').length;
  const opportunities = feed.filter(f => f.severity === 'opportunity').length;
  const wins = feed.filter(f => f.severity === 'positive').length;
  const schemaGaps = feed.filter(f => f.type === 'serp_opportunity').length;
  const decayingPages = feed.filter(f => f.type === 'content_decay').length;

  const counts: SummaryCount[] = [];

  if (drops > 0) {
    counts.push({ label: 'drops', count: drops, color: 'red', filterKey: INSIGHT_FILTER_KEYS.DROPS });
  }
  if (opportunities > 0) {
    counts.push({ label: 'opportunities', count: opportunities, color: 'amber', filterKey: INSIGHT_FILTER_KEYS.OPPORTUNITIES });
  }
  if (wins > 0) {
    counts.push({ label: 'wins', count: wins, color: 'green', filterKey: INSIGHT_FILTER_KEYS.WINS });
  }
  if (schemaGaps > 0) {
    counts.push({ label: 'schema gaps', count: schemaGaps, color: 'blue', filterKey: INSIGHT_FILTER_KEYS.SCHEMA });
  }
  if (decayingPages > 0) {
    counts.push({ label: 'decaying pages', count: decayingPages, color: 'purple', filterKey: INSIGHT_FILTER_KEYS.DECAY });
  }

  return counts;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface InsightFeedResult {
  feed: FeedInsight[];
  summary: SummaryCount[];
  isLoading: boolean;
  error: Error | null;
}

export function useInsightFeed(workspaceId: string, enabled = true): InsightFeedResult {
  const query = useQuery({
    queryKey: queryKeys.admin.insightFeed(workspaceId),
    queryFn: () => getSafe<AnalyticsInsight[]>('/api/public/insights/' + workspaceId, []),
    staleTime: STALE_TIMES.STABLE, // 5 minutes
    enabled: !!workspaceId && enabled,
    select: (raw: AnalyticsInsight[]) => {
      const feed = raw
        .map(transformToFeedInsight)
        .sort((a, b) => b.impactScore - a.impactScore);
      const summary = computeSummaryCounts(feed);
      return { feed, summary };
    },
  });

  return {
    feed: query.data?.feed ?? [],
    summary: query.data?.summary ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
