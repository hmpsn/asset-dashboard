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
import type { AnalyticsInsight } from '../../../shared/types/analytics.js';
import type { FeedInsight, SummaryCount } from '../../../shared/types/insights.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a URL slug to a readable title.
 * e.g. "https://example.com/blog/seo-tips" → "Seo Tips"
 */
export function cleanSlugToTitle(url: string | null): string {
  if (!url) return 'Unknown Page';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const slug = parts[parts.length - 1] ?? parsed.hostname;
    return slug
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || 'Unknown Page';
  } catch {
    // Not a valid URL — try treating the string as a slug directly
    return url
      .replace(/[-_/]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || 'Unknown Page';
  }
}

// ── Transform ─────────────────────────────────────────────────────────────────

/**
 * Transforms a raw AnalyticsInsight into a FeedInsight for display.
 * Exported for unit testing.
 */
export function transformToFeedInsight(insight: AnalyticsInsight): FeedInsight {
  const title = insight.pageTitle ?? cleanSlugToTitle(insight.pageId);
  const data = insight.data as Record<string, unknown>;

  let headline = '';
  let contextParts: string[] = [];

  switch (insight.insightType) {
    case 'ranking_mover': {
      const prev = data.previousPosition as number | undefined;
      const curr = data.currentPosition as number | undefined;
      const clickDelta = data.estimatedClickDelta as number | undefined;
      if (curr !== undefined && prev !== undefined) {
        if (curr > 10) {
          headline = `dropped to page 2`;
        } else if (curr < prev) {
          headline = `climbed to position ${curr}`;
        } else {
          headline = `dropped to position ${curr}`;
        }
        contextParts.push(`Position ${prev} → ${curr}`);
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
      const actualCtr = data.ctr as number | undefined;
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
      if (rate !== undefined) contextParts.push(`${(rate * 100).toFixed(1)}% CVR`);
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
  const domain = insight.domain ?? 'search';

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
    counts.push({ label: 'drops', count: drops, color: 'red', filterKey: 'drops' });
  }
  if (opportunities > 0) {
    counts.push({ label: 'opportunities', count: opportunities, color: 'amber', filterKey: 'opportunities' });
  }
  if (wins > 0) {
    counts.push({ label: 'wins', count: wins, color: 'green', filterKey: 'wins' });
  }
  if (schemaGaps > 0) {
    counts.push({ label: 'schema gaps', count: schemaGaps, color: 'blue', filterKey: 'schema_gaps' });
  }
  if (decayingPages > 0) {
    counts.push({ label: 'decaying pages', count: decayingPages, color: 'purple', filterKey: 'decaying_pages' });
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
