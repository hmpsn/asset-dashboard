import { parseJsonFallback } from './db/json-validation.js';
import { getReportForInsight } from './diagnostic-store.js';
import { getWorkspace } from './workspaces.js';

import type {
  AnalyticsInsight,
  AuditFindingData,
  CannibalizationData,
  CompetitorAlertData,
  ContentDecayData,
  CtrOpportunityData,
  EmergingKeywordData,
  FreshnessAlertData,
  InsightType,
  MilestoneAttributionData,
  QuickWinData,
  SiteHealthInsightData,
} from '../shared/types/analytics.js';
import type { BriefingStory } from '../shared/types/briefing.js';
import type { ClientInsight } from '../shared/types/narrative.js';
import type { Recommendation } from '../shared/types/recommendations.js';
import type { ContentGap } from './workspaces.js';
import type { DecayingPage } from './content-decay.js';

import { buildStoryFromInsight as anomalyDigest } from './briefing-templates/anomaly-digest.js';
import { buildStoryFromInsight as auditFinding } from './briefing-templates/audit-finding.js';
import { buildStoryFromInsight as cannibalization } from './briefing-templates/cannibalization.js';
import { buildStoryFromContentGap as contentGapBuilder } from './briefing-templates/content-gap.js';
import { buildStoryFromInsight as competitorAlert } from './briefing-templates/competitor-alert.js';
import { buildStoryFromInsight as contentDecay } from './briefing-templates/content-decay.js';
import { buildStoryFromInsight as ctrOpportunity } from './briefing-templates/ctr-opportunity.js';
import { buildStoryFromInsight as freshnessAlert } from './briefing-templates/freshness-alert.js';
import { buildStoryFromInsight as milestoneAttribution } from './briefing-templates/milestone-attribution.js';
import { buildStoryFromInsight as pageHealth } from './briefing-templates/page-health.js';
import { buildStoryFromInsight as rankingMover } from './briefing-templates/ranking-mover.js';
import { buildStoryFromInsight as rankingOpportunity } from './briefing-templates/ranking-opportunity.js';

type ClientStoryContent = Pick<ClientInsight, 'headline' | 'narrative' | 'impact'>;
type ClientInsightProjector = (insight: AnalyticsInsight) => ClientStoryContent;
type BriefingTemplateContext = {
  workspaceId: string;
  tier: 'free' | 'growth' | 'premium';
  avgCPC?: number;
  pulseMetrics?: {
    totalClicks?: number;
    totalImpressions?: number;
    avgPosition?: number;
    auditScore?: number;
    organicTrafficValue?: number;
  };
};
type BriefingInsightProjector = (
  insight: AnalyticsInsight,
  context: BriefingTemplateContext,
) => BriefingStory | null;

export const CLIENT_INSIGHT_EXCLUDED_TYPES = [
  'strategy_alignment',
  'keyword_cluster',
] as const satisfies readonly InsightType[];

const CLIENT_INSIGHT_EXCLUDED = new Set<InsightType>(CLIENT_INSIGHT_EXCLUDED_TYPES);

function absPercent(value: number | null | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return `${Math.abs(value)}%`;
}

function formatValueCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

const clientInsightStories: Partial<Record<InsightType, ClientInsightProjector>> = {
  page_health: (insight) => {
    const title = insight.pageTitle ?? 'your website';
    const score = (insight.data as { score?: number }).score ?? 0;
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
  ranking_opportunity: (insight) => {
    const title = insight.pageTitle ?? 'this page';
    const data = insight.data as QuickWinData;
    const position = typeof data.currentPosition === 'number' ? Math.round(data.currentPosition) : null;
    return {
      headline: `Growth opportunity detected for ${title}`,
      narrative: position != null
        ? `${title} is ranking at position ${position}, just outside the strongest click band. We're lining up the next optimization push to move it higher.`
        : `This page is close to appearing on the first page of search results. A targeted optimization can increase visibility.`,
      impact: data.impressions ? `Currently receiving ${Number(data.impressions).toLocaleString()} monthly impressions` : undefined,
    };
  },
  content_decay: (insight) => {
    const title = insight.pageTitle ?? 'this page';
    const data = insight.data as ContentDecayData;
    return {
      headline: `We noticed a traffic change on ${title}`,
      narrative: `This page has experienced a decline in organic traffic. We're evaluating whether a content refresh would help restore performance.`,
      impact: absPercent(data.deltaPercent) ? `${absPercent(data.deltaPercent)} traffic change detected` : undefined,
    };
  },
  ranking_mover: (insight) => {
    const title = insight.pageTitle ?? 'this page';
    const data = insight.data as { previousPosition?: number; currentPosition?: number; currentClicks?: number; previousClicks?: number };
    const prev = data.previousPosition ?? 0;
    const curr = data.currentPosition ?? 0;
    const improved = curr < prev && prev > 0;
    const clickDelta = data.currentClicks != null && data.previousClicks != null
      ? Number(data.currentClicks) - Number(data.previousClicks)
      : null;
    return {
      headline: improved
        ? `Ranking improvement on ${title}`
        : `We detected a ranking change on ${title}`,
      narrative: improved
        ? `This page has moved up in search results. We'll continue optimizing to maintain this momentum.`
        : `We've detected a position change and are working on a recovery plan.`,
      impact: clickDelta == null
        ? undefined
        : clickDelta > 0
        ? `+${clickDelta.toLocaleString()} additional monthly clicks`
        : clickDelta < 0
        ? `${Math.abs(clickDelta).toLocaleString()} fewer monthly clicks`
        : undefined,
    };
  },
  ctr_opportunity: (insight) => {
    const title = insight.pageTitle ?? 'this page';
    const data = insight.data as CtrOpportunityData;
    return {
      headline: `Click-through opportunity on ${title}`,
      narrative: `This page appears frequently in search results but could attract more clicks. We're looking at ways to improve its search listing.`,
      impact: data.estimatedClickGap ? `Potential gain: ${Number(data.estimatedClickGap).toLocaleString()} additional monthly clicks` : undefined,
    };
  },
  competitor_gap: (insight) => {
    const title = insight.pageTitle ?? 'this page';
    const data = insight.data as { volume?: number };
    return {
      headline: `Competitive opportunity identified for ${title}`,
      narrative: `A competitor is ranking for a keyword relevant to this page. Targeting this keyword can bring additional traffic.`,
      impact: data.volume ? `Keyword has ~${Number(data.volume).toLocaleString()} monthly searches` : undefined,
    };
  },
  serp_opportunity: (insight) => {
    const title = insight.pageTitle ?? 'this page';
    const data = insight.data as { impressions?: number };
    return {
      headline: `Search visibility opportunity on ${title}`,
      narrative: `This page receives impressions but low clicks. Improving the page's search appearance can meaningfully increase visits.`,
      impact: data.impressions ? `${Number(data.impressions).toLocaleString()} monthly impressions` : undefined,
    };
  },
  conversion_attribution: (insight) => {
    const title = insight.pageTitle ?? 'this page';
    const data = insight.data as { conversions?: number };
    return {
      headline: `Conversion performance update on ${title}`,
      narrative: `We've been tracking how this page contributes to your business goals. Here's what we found.`,
      impact: data.conversions ? `${Number(data.conversions).toLocaleString()} conversions tracked` : undefined,
    };
  },
  cannibalization: (insight) => {
    const title = insight.pageTitle ?? 'this page';
    const data = insight.data as CannibalizationData;
    return {
      headline: `We detected a content overlap affecting ${title}`,
      narrative: `Multiple pages on your site are competing for the same search terms. We're reviewing which page to strengthen.`,
      impact: Array.isArray(data.pages) ? `${data.pages.length} pages competing for the same keyword cluster` : undefined,
    };
  },
  anomaly_digest: (insight) => {
    const data = insight.data as { durationDays?: number };
    const workspace = getWorkspace(insight.workspaceId);
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
  audit_finding: (insight) => {
    const data = insight.data as AuditFindingData;
    const title = insight.pageTitle ?? 'your site';
    return {
      headline: data.scope === 'site'
        ? `We found site-wide SEO issues to address`
        : `We found SEO issues on ${title}`,
      narrative: data.scope === 'site'
        ? `Our latest audit flagged ${data.issueCount} site-wide issues. We're prioritizing the fixes that protect search visibility first.`
        : `Our latest audit flagged ${data.issueCount} issue${data.issueCount === 1 ? '' : 's'} on this page. We're working through the fixes in priority order.`,
      impact: data.scope === 'site'
        ? (typeof data.siteScore === 'number' ? `Current site health score: ${data.siteScore}` : `${data.issueCount} site-wide issues identified`)
        : `${data.issueCount} issue${data.issueCount === 1 ? '' : 's'} identified`,
    };
  },
  site_health: (insight) => {
    const data = insight.data as SiteHealthInsightData;
    const delta = data.scoreDelta;
    const direction = typeof delta === 'number' && delta > 0 ? 'improved' : typeof delta === 'number' && delta < 0 ? 'slipped' : 'held steady';
    return {
      headline: data.siteScore >= 85
        ? `Your site health score is ${data.siteScore}`
        : `We identified site-wide health work to prioritize`,
      narrative: `Your latest audit score is ${data.siteScore} across ${data.totalPages} pages. The score ${direction} with ${data.errors} errors and ${data.warnings} warnings still affecting crawl and search quality.`,
      impact: `${data.siteWideIssueCount} site-wide issue${data.siteWideIssueCount === 1 ? '' : 's'} affecting overall site health`,
    };
  },
  emerging_keyword: (insight) => {
    const data = insight.data as EmergingKeywordData;
    return {
      headline: `Rising search trend: "${data.keyword}"`,
      narrative: `"${data.keyword}" is gaining search momentum${data.volume ? ` (${Number(data.volume).toLocaleString()} monthly searches)` : ''}. Getting ahead of this trend now can secure a stronger ranking before competition increases.`,
      impact: data.currentPosition
        ? `You currently rank at position ${Math.round(data.currentPosition)}`
        : `Your site does not yet rank for this keyword`,
    };
  },
  competitor_alert: (insight) => {
    const data = insight.data as CompetitorAlertData;
    const domain = data.competitorDomain ?? 'a competitor';
    const keyword = data.keyword ? `"${data.keyword}"` : 'a relevant keyword';
    if (data.alertType === 'keyword_gained') {
      const change = data.previousPosition != null && data.currentPosition != null
        ? `moved from position ${data.previousPosition} to ${data.currentPosition}`
        : 'improved their ranking';
      return {
        headline: `Competitor gaining ground on ${keyword}`,
        narrative: `${domain} ${change} for ${keyword}. We're reviewing whether to target this keyword more aggressively.`,
        impact: data.volume ? `${Number(data.volume).toLocaleString()} monthly searches at stake` : undefined,
      };
    }
    if (data.alertType === 'keyword_lost') {
      const change = data.previousPosition != null && data.currentPosition != null
        ? `dropped from position ${data.previousPosition} to ${data.currentPosition}`
        : 'lost significant ground';
      return {
        headline: `Competitor losing ground on ${keyword}`,
        narrative: `${domain} ${change} for ${keyword}. This opens an opportunity to capture visibility where competition is weakening.`,
        impact: data.volume ? `${Number(data.volume).toLocaleString()} monthly searches up for grabs` : undefined,
      };
    }
    if (data.alertType === 'new_keyword') {
      return {
        headline: `Competitor entered top results for ${keyword}`,
        narrative: `${domain} now ranks in the top 10 for ${keyword}, a keyword relevant to your site. We're evaluating a content response.`,
        impact: data.volume ? `${Number(data.volume).toLocaleString()} monthly searches` : undefined,
      };
    }
    return {
      headline: `Competitor activity detected`,
      narrative: `We noticed a change in ${domain}'s search rankings and are monitoring the situation.`,
      impact: undefined,
    };
  },
  freshness_alert: (insight) => {
    const data = insight.data as FreshnessAlertData;
    const days = data.daysSinceLastAnalysis ?? 0;
    return {
      headline: `Content on ${data.pagePath} may need a refresh`,
      narrative: `This page hasn't been analyzed in ${days} days. Search engines tend to favor recently-updated content${data.impressions ? `, and this page still receives ${Number(data.impressions).toLocaleString()} monthly impressions that can be protected with a refresh` : ''}.`,
      impact: days > 180 ? `Over 6 months since last analysis` : `Over 3 months since last analysis`,
    };
  },
  milestone_attribution: (insight) => {
    const data = insight.data as MilestoneAttributionData;
    return {
      headline: `A delivered brief is now driving measurable search traffic`,
      narrative: `"${data.briefTitle}" is now driving ${data.currentClicks.toLocaleString()} monthly clicks to ${data.pageUrl}. We're using that win as a signal for what to repeat next.`,
      impact: `${formatValueCurrency(data.trafficValue)} in monthly organic value after ${data.daysSinceDelivery} days`,
    };
  },
};

export const CLIENT_INSIGHT_STORY_TYPES = Object.keys(clientInsightStories) as InsightType[];

export function isClientInsightExcluded(type: InsightType): boolean {
  return CLIENT_INSIGHT_EXCLUDED.has(type);
}

export function buildClientInsightStory(insight: AnalyticsInsight): ClientStoryContent | null {
  const projector = clientInsightStories[insight.insightType];
  return projector ? projector(insight) : null;
}

type RecommendationStoryKey =
  | 'content_gap'
  | 'ranking_opportunity'
  | 'content_decay'
  | 'ctr_opportunity'
  | 'freshness_alert';

type RecommendationStoryCopy = Pick<Recommendation, 'title' | 'description' | 'insight' | 'estimatedGain'>;
type RecommendationStoryInputMap = {
  content_gap: {
    topic: string;
    targetKeyword: string;
    rationale: string;
    suggestedPageType?: string | null;
    intent: string;
    kdNote?: string;
  };
  ranking_opportunity: {
    keyword: string;
    pagePath: string;
    currentPosition: number;
    impressions: number;
  };
  content_decay: {
    pagePath: string;
    title?: string | null;
    clickDeclinePct: number;
    refreshRecommendation?: string | null;
    severity: DecayingPage['severity'];
    previousClicks: number;
    currentClicks: number;
    previousPosition: number;
    currentPosition: number;
  };
  ctr_opportunity: {
    pageSlug: string;
    actualCtr: number;
    expectedCtr: number;
    impressions: number;
    position: number;
    gap: number;
  };
  freshness_alert: {
    pagePath: string;
    daysSinceLastAnalysis: number;
    trafficAtRisk: number;
  };
};

const recommendationStories: {
  [K in RecommendationStoryKey]: (input: RecommendationStoryInputMap[K]) => RecommendationStoryCopy;
} = {
  content_gap: (input) => ({
    title: `Content Gap: ${input.topic}`,
    description: input.rationale,
    insight: `Content opportunity: "${input.topic}" targeting "${input.targetKeyword}". ${input.rationale}`,
    estimatedGain: `New ${input.suggestedPageType || 'page'} targeting "${input.targetKeyword}" (${input.intent} intent)${input.kdNote ?? ''}`,
  }),
  ranking_opportunity: (input) => ({
    title: `Ranking Opportunity: "${input.keyword}" (pos ${Math.round(input.currentPosition)})`,
    description: `${input.pagePath} ranks #${Math.round(input.currentPosition)} for "${input.keyword}" with ${input.impressions.toLocaleString()} impressions. Optimizing this page can push it onto page 1 or into the top 3.`,
    insight: input.currentPosition <= 10
      ? `This page is on page 1 but not in the top 3. Moving from position ${Math.round(input.currentPosition)} to top 3 can 2-3x click-through rate.`
      : `This page ranks on page 2 — just outside where most clicks happen. A focused optimization push can move it onto page 1.`,
    estimatedGain: `Moving to top 3 can increase clicks by ${Math.round(input.impressions * 0.15)} - ${Math.round(input.impressions * 0.3)}/mo`,
  }),
  content_decay: (input) => {
    const pageLabel = input.title || input.pagePath;
    const clickDrop = input.previousClicks - input.currentClicks;
    return {
      title: `Content Decay: ${pageLabel} (${Math.abs(input.clickDeclinePct)}% decline)`,
      description: input.refreshRecommendation
        || `This page has lost ${Math.abs(input.clickDeclinePct)}% of its search clicks. Refresh the content to recover traffic.`,
      insight: input.severity === 'critical'
        ? `This page lost ${Math.abs(input.clickDeclinePct)}% of its search clicks (${clickDrop} clicks/mo). Position moved from ${input.previousPosition.toFixed(1)} to ${input.currentPosition.toFixed(1)}. Refreshing the content — updating facts, improving structure, and targeting current search intent — can recover most of this traffic.`
        : `Search clicks declined ${Math.abs(input.clickDeclinePct)}% (${clickDrop} fewer clicks/mo). The page is losing ground against fresher results. A targeted refresh is the next move.`,
      estimatedGain: input.previousClicks >= 100
        ? `Refreshing can recover ${Math.round(clickDrop * 0.5)} – ${clickDrop} clicks/mo`
        : `Content refresh to reverse ${Math.abs(input.clickDeclinePct)}% traffic decline`,
    };
  },
  ctr_opportunity: (input) => ({
    title: `CTR Underperformance: /${input.pageSlug} (${input.actualCtr}% vs ${input.expectedCtr}% expected)`,
    description: `This page gets ${input.impressions.toLocaleString()} impressions/mo at position #${input.position.toFixed(1)} but only ${input.actualCtr}% CTR (expected ~${input.expectedCtr}%). Improving the title and meta description can add ~${input.gap} clicks/mo.`,
    insight: `CTR below expected for this position means the title and description are not earning enough clicks. Target CTR for position ${input.position.toFixed(1)} is ~${input.expectedCtr}%.`,
    estimatedGain: `Optimizing title/meta can recover ~${input.gap} clicks/mo`,
  }),
  freshness_alert: (input) => ({
    title: `Stale Content: ${input.pagePath} (${input.daysSinceLastAnalysis} days since last update)`,
    description: `This page hasn't been analyzed in ${input.daysSinceLastAnalysis} days${input.trafficAtRisk > 0 ? ` and still receives ~${input.trafficAtRisk.toLocaleString()} monthly impressions` : ''}. A content refresh can protect rankings before they decline.`,
    insight: `Search engines favor recently-updated content. Pages stale for ${input.daysSinceLastAnalysis > 180 ? 'over 6 months' : 'over 3 months'} face elevated ranking risk.`,
    estimatedGain: `Refreshing this page can protect ${input.trafficAtRisk.toLocaleString()} monthly impressions from ranking decline`,
  }),
};

export function buildRecommendationStory<K extends RecommendationStoryKey>(
  key: K,
  input: RecommendationStoryInputMap[K],
): RecommendationStoryCopy {
  return recommendationStories[key](input);
}

const briefingInsightStories: Partial<Record<InsightType, BriefingInsightProjector>> = {
  ranking_mover: rankingMover as BriefingInsightProjector,
  ranking_opportunity: rankingOpportunity as BriefingInsightProjector,
  anomaly_digest: anomalyDigest as BriefingInsightProjector,
  ctr_opportunity: ctrOpportunity as BriefingInsightProjector,
  freshness_alert: freshnessAlert as BriefingInsightProjector,
  cannibalization: cannibalization as BriefingInsightProjector,
  content_decay: contentDecay as BriefingInsightProjector,
  audit_finding: auditFinding as BriefingInsightProjector,
  competitor_alert: competitorAlert as BriefingInsightProjector,
  page_health: pageHealth as BriefingInsightProjector,
  milestone_attribution: milestoneAttribution as BriefingInsightProjector,
};

export const SUPPORTED_BRIEFING_INSIGHT_TYPES = Object.keys(briefingInsightStories) as InsightType[];

export function buildBriefingInsightStory(
  insight: AnalyticsInsight,
  context: BriefingTemplateContext,
): BriefingStory | null {
  const projector = briefingInsightStories[insight.insightType];
  return projector ? projector(insight, context) : null;
}

export function buildBriefingContentGapStory(
  gap: ContentGap,
  context: BriefingTemplateContext,
): BriefingStory | null {
  return contentGapBuilder(gap, context);
}
