// server/insight-narrative.ts
import { createLogger } from './logger.js';
import { getInsights } from './analytics-insights-store.js';
import { parseJsonFallback } from './db/json-validation.js';
import { getReportForInsight } from './diagnostic-store.js';
import { getWorkspace } from './workspaces.js';
import type { AnalyticsInsight, InsightType } from '../shared/types/analytics.js';
import type { ClientInsight } from '../shared/types/narrative.js';

const log = createLogger('insight-narrative');

export function buildClientInsights(workspaceId: string): ClientInsight[] {
  const insights = getInsights(workspaceId);
  return insights
    .filter(i => isClientRelevant(i))
    .map(i => toClientInsight(i))
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 15);
}

function isClientRelevant(insight: AnalyticsInsight): boolean {
  if ((insight.impactScore ?? 0) < 20) return false;
  if (insight.insightType === 'strategy_alignment') return false;
  if (insight.insightType === 'keyword_cluster') return false;
  return true;
}

function toClientInsight(insight: AnalyticsInsight): ClientInsight {
  const title = insight.pageTitle ?? 'your website';
  const data = insight.data as Record<string, unknown>;

  // Exhaustive typed map — using Partial<Record<InsightType,...>> so TypeScript
  // enforces real InsightType keys (catches typos and missing cases at compile time)
  const narrativeMap: Partial<Record<InsightType, () => { headline: string; narrative: string; impact?: string }>> = {
    page_health: () => {
      const score = (data.score as number) ?? 0;
      // Use parseJsonFallback for auditIssues — never bare JSON.parse
      const issues = parseJsonFallback<string[]>(insight.auditIssues ?? null, []);
      return {
        headline: score < 50
          ? `We identified health concerns on ${title}`
          : `${title} is performing well`,
        narrative: score < 50
          ? `Our analysis found areas for improvement on this page. We're developing an optimization plan.`
          : `This page is in good shape. We'll continue monitoring for any changes.`,
        impact: issues.length > 0
          ? `${issues.length} item${issues.length === 1 ? '' : 's'} identified for improvement`
          : undefined,
      };
    },

    ranking_opportunity: () => ({
      headline: `Growth opportunity detected for ${title}`,
      narrative: `This page is close to appearing on the first page of search results. A targeted optimization could significantly increase visibility.`,
      impact: data.impressions ? `Currently receiving ${Number(data.impressions).toLocaleString()} monthly impressions` : undefined,
    }),

    content_decay: () => ({
      headline: `We noticed a traffic change on ${title}`,
      narrative: `This page has experienced a decline in organic traffic. We're evaluating whether a content refresh would help restore performance.`,
      impact: data.deltaPercent ? `${Math.abs(Number(data.deltaPercent))}% traffic change detected` : undefined,
    }),

    ranking_mover: () => {
      const prev = (data.previousPosition as number) ?? 0;
      const curr = (data.currentPosition as number) ?? 0;
      const improved = curr < prev && prev > 0;
      return {
        headline: improved
          ? `Ranking improvement on ${title}`
          : `We detected a ranking change on ${title}`,
        narrative: improved
          ? `This page has moved up in search results. We'll continue optimizing to maintain this momentum.`
          : `We've detected a position change and are working on a recovery plan.`,
        impact: (data.currentClicks != null && data.previousClicks != null)
          ? (() => {
              const delta = Number(data.currentClicks) - Number(data.previousClicks);
              return delta > 0
                ? `+${delta.toLocaleString()} additional monthly clicks`
                : delta < 0
                ? `${Math.abs(delta).toLocaleString()} fewer monthly clicks`
                : undefined;
            })()
          : undefined,
      };
    },

    ctr_opportunity: () => ({
      headline: `Click-through opportunity on ${title}`,
      narrative: `This page appears frequently in search results but could attract more clicks. We're looking at ways to improve its search listing.`,
      impact: data.estimatedClickGap ? `Potential gain: ${Number(data.estimatedClickGap).toLocaleString()} additional monthly clicks` : undefined,
    }),

    competitor_gap: () => ({
      headline: `Competitive opportunity identified for ${title}`,
      narrative: `A competitor is ranking for a keyword relevant to this page. Targeting this keyword could bring additional traffic.`,
      impact: data.volume ? `Keyword has ~${Number(data.volume).toLocaleString()} monthly searches` : undefined,
    }),

    serp_opportunity: () => ({
      headline: `Search visibility opportunity on ${title}`,
      narrative: `This page receives impressions but low clicks. Improving the page's search appearance could meaningfully increase visits.`,
      impact: data.impressions ? `${Number(data.impressions).toLocaleString()} monthly impressions` : undefined,
    }),

    conversion_attribution: () => ({
      headline: `Conversion performance update on ${title}`,
      narrative: `We've been tracking how this page contributes to your business goals. Here's what we found.`,
      impact: data.conversions ? `${Number(data.conversions).toLocaleString()} conversions tracked` : undefined,
    }),

    cannibalization: () => ({
      headline: `We detected a content overlap affecting ${title}`,
      narrative: `Multiple pages on your site are competing for the same search terms. We're reviewing which page to strengthen.`,
      impact: undefined,
    }),

    anomaly_digest: () => {
      // For Growth+ workspaces: enrich with diagnostic client summary if a completed report exists
      const workspace = getWorkspace(insight.workspaceId);
      // Guard: missing workspace should not receive premium enrichment
      const isGrowthPlus = workspace != null && workspace.tier !== 'free';
      if (isGrowthPlus) {
        const report = getReportForInsight(insight.workspaceId, insight.id);
        if (report?.status === 'completed' && report.clientSummary) {
          return {
            headline: `Traffic pattern change analyzed`,
            narrative: report.clientSummary,
            impact: data.durationDays ? `Ongoing for ${data.durationDays} days` : undefined,
          };
        }
      }
      return {
        headline: `Traffic pattern change detected`,
        narrative: `We noticed an unusual change in your site metrics and are monitoring the situation.`,
        impact: data.durationDays ? `Ongoing for ${data.durationDays} days` : undefined,
      };
    },

    competitor_alert: () => {
      const d = data as import('../shared/types/analytics.js').CompetitorAlertData;
      const domain = d.competitorDomain ?? 'a competitor';
      const kw = d.keyword ? `"${d.keyword}"` : 'a keyword';
      if (d.alertType === 'keyword_gained') {
        const posChange = (d.previousPosition != null && d.currentPosition != null)
          ? `moved from position ${d.previousPosition} to position ${d.currentPosition}`
          : 'improved their ranking';
        return {
          headline: `Competitor gaining ground on ${kw}`,
          narrative: `${domain} ${posChange} for ${kw}. We're reviewing whether to target this keyword more aggressively.`,
          impact: d.volume ? `${Number(d.volume).toLocaleString()} monthly searches at stake` : undefined,
        };
      }
      if (d.alertType === 'keyword_lost') {
        const posChange = (d.previousPosition != null && d.currentPosition != null)
          ? `dropped from position ${d.previousPosition} to position ${d.currentPosition}`
          : 'lost significant ground';
        return {
          headline: `Competitor losing ground on ${kw}`,
          narrative: `${domain} ${posChange} for ${kw}. This opens an opportunity to capture visibility on a keyword where competition is weakening.`,
          impact: d.volume ? `${Number(d.volume).toLocaleString()} monthly searches up for grabs` : undefined,
        };
      }
      if (d.alertType === 'new_keyword') {
        return {
          headline: `Competitor entered top results for ${kw}`,
          narrative: `${domain} now ranks in the top 10 for ${kw}, a keyword relevant to your site. We're evaluating a content response.`,
          impact: d.volume ? `${Number(d.volume).toLocaleString()} monthly searches` : undefined,
        };
      }
      return {
        headline: `Competitor activity detected`,
        narrative: `We noticed a change in ${domain}'s search rankings and are monitoring the situation.`,
        impact: undefined,
      };
    },

    emerging_keyword: () => {
      const d = data as import('../shared/types/analytics.js').EmergingKeywordData;
      return {
        headline: `Rising search trend: "${d.keyword}"`,
        narrative: `"${d.keyword}" is gaining search momentum${d.volume ? ` (${Number(d.volume).toLocaleString()} monthly searches)` : ''}. Getting ahead of this trend now could secure a strong ranking before competition increases.`,
        impact: d.currentPosition
          ? `You currently rank at position ${Math.round(d.currentPosition)} — there's room to improve`
          : `Your site doesn't yet rank for this keyword — a dedicated page could capture this traffic`,
      };
    },

    freshness_alert: () => {
      const d = data as import('../shared/types/analytics.js').FreshnessAlertData;
      const days = d.daysSinceLastAnalysis ?? 0;
      return {
        headline: `Content on ${d.pagePath} may need a refresh`,
        narrative: `This page hasn't been analyzed in ${days} days. Search engines tend to favor recently-updated content${d.impressions ? `, and this page still receives ${Number(d.impressions).toLocaleString()} monthly impressions that could be protected with a refresh` : ''}.`,
        impact: days > 180 ? `Over 6 months since last analysis — elevated risk of ranking decline` : `Over 3 months since last analysis`,
      };
    },
  };

  const generator = narrativeMap[insight.insightType];
  const content = generator
    ? generator()
    : {
        headline: `Update on ${title}`,
        narrative: `We identified something worth noting about this page and are evaluating next steps.`,
      };

  log.debug({ workspaceId: insight.workspaceId, insightId: insight.id, insightType: insight.insightType }, 'mapped insight to client narrative');

  return {
    id: insight.id,
    type: insight.insightType,
    severity: insight.severity,
    domain: insight.domain ?? 'cross',
    headline: content.headline,
    narrative: content.narrative,
    impact: content.impact,
    actionTaken: insight.resolutionNote ?? undefined,
    impactScore: insight.impactScore ?? 0,
  };
}
