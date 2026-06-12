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
import { capitalizeWord } from '../../utils/strings';
import { INSIGHT_FILTER_KEYS, type AnalyticsInsight } from '../../../shared/types/analytics.js';
import type { FeedInsight, SummaryCount } from '../../../shared/types/insights.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
      .map(word => capitalizeWord(word))
      .join(' ')
      .trim() || 'Home';
  } catch {
    // Not a valid URL — treat as a path and take the last segment (mirrors server behavior)
    const segments = url.replace(/\/$/, '').split('/').filter(Boolean);
    if (segments.length === 0) return 'Home';
    const slug = segments[segments.length - 1];
    return slug
      .replace(/[-_]/g, ' ')
      .split(' ')
      .map(word => capitalizeWord(word))
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
      // The producer (analytics-intelligence.ts) writes schemaStatus, not schemaType —
      // reading schemaType meant this context line silently never rendered (guessed-field bug).
      const schemaStatus = data.schemaStatus as 'missing' | 'partial' | 'complete' | undefined;
      if (schemaStatus) contextParts.push(`Schema ${schemaStatus}`);
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

    case 'lost_visibility': {
      const lostCount = data.lostCount as number | undefined;
      if (lostCount !== undefined && lostCount > 0) {
        headline = `${lostCount} quer${lostCount === 1 ? 'y' : 'ies'} lost visibility`;
      } else {
        headline = 'queries lost visibility';
      }
      contextParts.push('GSC drop-off detected');
      break;
    }

    case 'keyword_cluster': {
      const label = data.label as string | undefined;
      const queries = data.queries as unknown[] | undefined;
      const queryCount = Array.isArray(queries) ? queries.length : undefined;
      if (label) {
        headline = queryCount !== undefined
          ? `${queryCount} quer${queryCount === 1 ? 'y' : 'ies'} clustered under "${label}"`
          : `keyword cluster: "${label}"`;
      } else {
        headline = 'keyword cluster identified';
      }
      const avgPosition = data.avgPosition as number | undefined;
      if (avgPosition !== undefined) contextParts.push(`Avg position ${avgPosition.toFixed(1)}`);
      break;
    }

    case 'competitor_gap': {
      const keyword = data.keyword as string | undefined;
      const competitorPos = data.competitorPosition as number | undefined;
      if (keyword && competitorPos !== undefined) {
        headline = `"${keyword}" — competitor at #${competitorPos}`;
      } else if (keyword) {
        headline = `competitor gap: "${keyword}"`;
      } else {
        headline = 'competitor keyword gap';
      }
      const ourPosition = data.ourPosition as number | null | undefined;
      contextParts.push(`Our position: ${ourPosition != null ? `#${ourPosition}` : 'not ranking'}`);
      break;
    }

    case 'strategy_alignment': {
      const alignedCount = data.alignedCount as number | undefined;
      const misalignedCount = data.misalignedCount as number | undefined;
      const untrackedCount = data.untrackedCount as number | undefined;
      if (alignedCount !== undefined && misalignedCount !== undefined) {
        headline = `${alignedCount} aligned, ${misalignedCount} misaligned pages`;
      } else {
        headline = 'strategy alignment review';
      }
      if (untrackedCount !== undefined && untrackedCount > 0) {
        contextParts.push(`${untrackedCount} untracked`);
      }
      break;
    }

    case 'anomaly_digest': {
      const anomalyType = data.anomalyType as string | undefined;
      const deviationPercent = data.deviationPercent as number | undefined;
      if (anomalyType && deviationPercent !== undefined) {
        headline = `${anomalyType.replace(/_/g, ' ')} — ${Math.abs(Math.round(deviationPercent))}% deviation`;
      } else if (anomalyType) {
        headline = `anomaly: ${anomalyType.replace(/_/g, ' ')}`;
      } else {
        headline = 'anomaly detected';
      }
      const durationDays = data.durationDays as number | undefined;
      if (durationDays !== undefined) {
        contextParts.push(`${durationDays} day${durationDays !== 1 ? 's' : ''} ongoing`);
      }
      break;
    }

    case 'site_health': {
      const siteScore = data.siteScore as number | undefined;
      if (siteScore !== undefined) {
        headline = `Site health: ${siteScore}/100`;
      } else {
        headline = 'site health summary';
      }
      const scoreDelta = data.scoreDelta as number | null | undefined;
      if (scoreDelta != null && scoreDelta !== 0) {
        const sign = scoreDelta > 0 ? '+' : '';
        contextParts.push(`${sign}${scoreDelta} from last audit`);
      }
      break;
    }

    case 'emerging_keyword': {
      const keyword = data.keyword as string | undefined;
      if (keyword) {
        headline = `"${keyword}" — rising trend`;
      } else {
        headline = 'emerging keyword opportunity';
      }
      const volume = data.volume as number | undefined;
      if (volume !== undefined) contextParts.push(`Vol. ${fmtNum(volume)}`);
      const difficulty = data.difficulty as number | undefined;
      if (difficulty !== undefined) contextParts.push(`Difficulty: ${difficulty}`);
      break;
    }

    case 'competitor_alert': {
      const competitorDomain = data.competitorDomain as string | undefined;
      const alertType = data.alertType as string | undefined;
      if (competitorDomain && alertType) {
        headline = `${competitorDomain} ${alertType.replace(/_/g, ' ')}`;
      } else if (competitorDomain) {
        headline = `competitor alert: ${competitorDomain}`;
      } else {
        headline = 'competitor movement detected';
      }
      const keyword = data.keyword as string | undefined;
      if (keyword) contextParts.push(`"${keyword}"`);
      const positionChange = data.positionChange as number | undefined;
      if (positionChange !== undefined && positionChange !== 0) {
        const sign = positionChange > 0 ? '+' : '';
        contextParts.push(`${sign}${positionChange} positions`);
      }
      break;
    }

    case 'freshness_alert': {
      const daysSince = data.daysSinceLastAnalysis as number | undefined;
      if (daysSince !== undefined) {
        headline = `Content last analyzed ${daysSince}d ago`;
      } else {
        headline = 'content freshness alert';
      }
      const impressions = data.impressions as number | undefined;
      if (impressions !== undefined) contextParts.push(`${fmtNum(impressions)} impressions at risk`);
      break;
    }

    case 'local_visibility_shift': {
      const direction = data.direction as string | undefined;
      const keyword = data.keyword as string | undefined;
      const marketLabel = data.marketLabel as string | undefined;
      const competitorName = data.competitorName as string | undefined;
      if (direction === 'win') {
        headline = keyword
          ? `Now visible in local pack for "${keyword}"`
          : 'Gained local pack visibility';
      } else if (direction === 'competitor') {
        headline = competitorName
          ? `New local competitor: ${competitorName}`
          : 'New repeat local competitor detected';
      } else {
        headline = keyword
          ? `Lost local pack visibility for "${keyword}"`
          : 'Lost local pack visibility';
      }
      if (marketLabel) contextParts.push(marketLabel);
      const appearances = data.competitorAppearances as number | undefined;
      if (direction === 'competitor' && appearances !== undefined) {
        contextParts.push(`${appearances} keyword${appearances === 1 ? '' : 's'}`);
      }
      break;
    }

    case 'milestone_attribution': {
      const daysSinceDelivery = data.daysSinceDelivery as number | undefined;
      const thresholdCrossed = data.thresholdCrossed as string | undefined;
      if (daysSinceDelivery !== undefined && typeof thresholdCrossed === 'string') {
        headline = `Brief delivered ${daysSinceDelivery}d ago crossed ${thresholdCrossed.replace(/_/g, ' ')}`;
      } else {
        headline = 'content milestone reached';
      }
      const currentClicks = data.currentClicks as number | undefined;
      if (currentClicks !== undefined) contextParts.push(`${fmtNum(currentClicks)} clicks tracked`);
      break;
    }

    default: {
      // Exhaustive switch — all InsightType cases are handled above.
      // This branch exists as a runtime safety net for unexpected values.
      headline = (insight.insightType as string).replace(/_/g, ' ');
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
  } else if (insight.insightType === 'lost_visibility') {
    const topQueries = data.topQueries as Array<{ query: string; lastPosition: number | null; lastSeen: string }> | undefined;
    if (Array.isArray(topQueries) && topQueries.length > 0) {
      details = topQueries.map(q => {
        const pos = q.lastPosition != null ? ` — last position ${q.lastPosition}` : '';
        return `"${q.query}"${pos}`;
      });
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
    // When the insight was computed — SearchDetail pins chart callouts to this date
    // (falls back to the last chart date when absent). Was never set → callouts always
    // landed on the final chart date, misrepresenting timing.
    detectedAt: insight.computedAt,
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
    counts.push({ label: 'wins', count: wins, color: 'emerald', filterKey: INSIGHT_FILTER_KEYS.WINS });
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
