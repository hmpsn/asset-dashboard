import { applySuppressionsToAudit } from '../seo-audit-suppressions.js';
import { getAuditTrafficForWorkspace } from '../audit-traffic.js';
import { normalizePageUrl } from '../utils/page-address.js';
import { getLatestSnapshot } from '../reports.js';
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';
import { buildStrategySignals } from '../insight-feedback.js';
import { buildStrategyIntelligenceBlock } from '../keyword-strategy-helpers.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type { Workspace } from '../../shared/types/workspace.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import type { KeywordEvaluationContext } from '../keyword-intelligence/index.js';
import type { KeywordStrategySearchData } from '../keyword-strategy-search-data.js';
import type { SiteSynthesisContext } from './site-synthesis.js';
import type { PageMapping } from './types.js';

const log = createLogger('keyword-strategy:synthesis');

export interface StrategyPoolKeywordForEligibility {
  keyword: string;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  source?: string;
  sourceKind?: string;
}

export interface BuildSiteSynthesisContextOptions {
  ws: Workspace;
  searchData: KeywordStrategySearchData;
  pageMappings: PageMapping[];
  providerContext: string;
  strategyIntel: WorkspaceIntelligence;
  keywordEvaluationContext: KeywordEvaluationContext;
  isEligibleStrategyPoolKeyword: (keyword: StrategyPoolKeywordForEligibility) => boolean;
}

export function buildGscSummary(searchData: Pick<
  KeywordStrategySearchData,
  'gscData' | 'deviceBreakdown' | 'countryBreakdown' | 'periodComparison'
>): string {
  let gscSummary = '';
  if (searchData.gscData.length > 0) {
    const topGsc = [...searchData.gscData].sort((a, b) => b.impressions - a.impressions).slice(0, 30);
    gscSummary = `\n\nTop GSC queries (last 90 days):\n` +
      topGsc.map(r => {
        const pagePath = normalizePageUrl(r.page);
        return `- "${r.query}" → ${pagePath} (pos: ${r.position.toFixed(1)}, clicks: ${r.clicks}, imp: ${r.impressions})`;
      }).join('\n');
  }

  if (searchData.deviceBreakdown.length > 0) {
    gscSummary += `\n\nDEVICE BREAKDOWN (last 28 days):\n` +
      searchData.deviceBreakdown.map(d => `- ${d.device}: ${d.clicks} clicks, ${d.impressions} imp, CTR ${d.ctr}%, avg pos ${d.position}`).join('\n');
    const mobile = searchData.deviceBreakdown.find(d => d.device === 'MOBILE');
    const desktop = searchData.deviceBreakdown.find(d => d.device === 'DESKTOP');
    if (mobile && desktop && mobile.impressions > desktop.impressions && mobile.position > desktop.position + 2) {
      gscSummary += `\n⚠️ MOBILE GAP: Mobile has ${mobile.impressions} imp vs desktop ${desktop.impressions} but avg position is ${mobile.position.toFixed(1)} vs ${desktop.position.toFixed(1)} — mobile optimization is critical.`;
    }
  }

  if (searchData.periodComparison) {
    const { change, changePercent } = searchData.periodComparison;
    gscSummary += `\n\nPERIOD COMPARISON (last 28 days vs previous 28 days):\n` +
      `- Clicks: ${change.clicks >= 0 ? '+' : ''}${change.clicks} (${changePercent.clicks >= 0 ? '+' : ''}${changePercent.clicks}%)\n` +
      `- Impressions: ${change.impressions >= 0 ? '+' : ''}${change.impressions} (${changePercent.impressions >= 0 ? '+' : ''}${changePercent.impressions}%)\n` +
      `- Avg Position: ${change.position >= 0 ? '+' : ''}${change.position} (${change.position > 0 ? 'declining ⚠️' : change.position < 0 ? 'improving ✓' : 'stable'})`;
  }

  if (searchData.countryBreakdown.length > 0) {
    gscSummary += `\n\nTOP COUNTRIES by clicks:\n` +
      searchData.countryBreakdown.slice(0, 5).map(c => `- ${c.country}: ${c.clicks} clicks, ${c.impressions} imp, pos ${c.position}`).join('\n');
  }

  return gscSummary;
}

export function buildGa4Context(
  searchData: Pick<KeywordStrategySearchData, 'organicLandingPages' | 'organicOverview' | 'ga4Conversions' | 'ga4EventsByPage'>,
  pageMappings: PageMapping[],
): string {
  let ga4Context = '';
  if (searchData.organicLandingPages.length > 0) {
    const mappedPaths = new Set(pageMappings.map(pm => pm.pagePath));
    const unmappedLanding = searchData.organicLandingPages.filter(lp => !mappedPaths.has(lp.landingPage));
    if (unmappedLanding.length > 0) {
      ga4Context += `\n\nGA4 ORGANIC LANDING PAGES not in keyword map (getting traffic but no keyword strategy):\n` +
        unmappedLanding.slice(0, 10).map(lp => `- ${lp.landingPage}: ${lp.sessions} organic sessions, ${lp.users} users, bounce ${lp.bounceRate}%`).join('\n');
    }
    const highBounce = searchData.organicLandingPages.filter(lp => lp.bounceRate > 70 && lp.sessions > 5);
    if (highBounce.length > 0) {
      ga4Context += `\n\nHIGH-BOUNCE ORGANIC PAGES (>70% bounce, may need content improvement):\n` +
        highBounce.slice(0, 5).map(lp => `- ${lp.landingPage}: bounce ${lp.bounceRate}%, ${lp.sessions} sessions`).join('\n');
    }
  }

  if (searchData.organicOverview) {
    ga4Context += `\n\nORGANIC SEARCH OVERVIEW (GA4, last 28 days):\n` +
      `- ${searchData.organicOverview.organicUsers} organic users (${searchData.organicOverview.shareOfTotalUsers}% of all traffic)\n` +
      `- Engagement rate: ${searchData.organicOverview.engagementRate}%\n` +
      `- Avg engagement time: ${searchData.organicOverview.avgEngagementTime.toFixed(0)}s`;
  }

  if (searchData.ga4Conversions.length > 0) {
    ga4Context += `\n\nCONVERSION EVENTS (GA4, last 28 days — these are the site's money actions):\n` +
      searchData.ga4Conversions.slice(0, 10).map(c => `- "${c.eventName}": ${c.conversions} events, ${c.users} users (${c.rate}% conversion rate)`).join('\n');
  }

  if (searchData.ga4EventsByPage.length > 0) {
    const pageEvents = new Map<string, { events: number; topEvent: string }>();
    for (const ep of searchData.ga4EventsByPage) {
      const existing = pageEvents.get(ep.pagePath);
      if (!existing || ep.eventCount > existing.events) {
        pageEvents.set(ep.pagePath, { events: ep.eventCount, topEvent: ep.eventName });
      }
    }
    const topConvertingPages = [...pageEvents.entries()]
      .sort((a, b) => b[1].events - a[1].events)
      .slice(0, 8);
    if (topConvertingPages.length > 0) {
      ga4Context += `\n\nTOP CONVERTING PAGES (pages that drive the most events — protect these keywords):\n` +
        topConvertingPages.map(([p, d]) => `- ${p}: ${d.events} events (top: "${d.topEvent}")`).join('\n');
    }
  }

  return ga4Context;
}

export async function buildAuditContext(ws: Workspace): Promise<string> {
  let auditContext = '';
  if (!ws.webflowSiteId) {
    return auditContext;
  }

  try {
    const trafficMap = await getAuditTrafficForWorkspace(ws);
    const latestAudit = getLatestSnapshot(ws.webflowSiteId);
    if (latestAudit && Object.keys(trafficMap).length > 0) {
      const filteredAudit = applySuppressionsToAudit(latestAudit.audit, ws.auditSuppressions || []);
      const pagesWithIssues = filteredAudit.pages
        .filter(p => p.issues.length > 0)
        .map(p => {
          const slug = normalizePageUrl(p.slug);
          const traffic = trafficMap[slug] || trafficMap[p.slug];
          return { slug, issues: p.issues.length, score: p.score, traffic };
        })
        .filter(p => p.traffic && (p.traffic.clicks > 0 || p.traffic.pageviews > 0))
        .sort((a, b) => ((b.traffic?.clicks || 0) + (b.traffic?.pageviews || 0)) - ((a.traffic?.clicks || 0) + (a.traffic?.pageviews || 0)))
        .slice(0, 8);
      if (pagesWithIssues.length > 0) {
        auditContext = `\n\nSEO AUDIT: HIGH-TRAFFIC PAGES WITH ERRORS (fix these for immediate impact):\n` +
          pagesWithIssues.map(p => `- ${p.slug}: ${p.issues} issues, score ${p.score}/100 | ${p.traffic!.clicks} clicks, ${p.traffic!.pageviews} pageviews`).join('\n');
        if (filteredAudit.siteScore != null) {
          auditContext += `\nOverall site health score: ${filteredAudit.siteScore}/100`;
        }
      }
    }
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error');
  }

  return auditContext;
}

export function buildStrategyInsightContext(
  strategyIntel: WorkspaceIntelligence,
  keywordEvaluationContext: KeywordEvaluationContext,
  isEligibleStrategyPoolKeyword: (keyword: StrategyPoolKeywordForEligibility) => boolean,
): string {
  try {
    const insights = strategyIntel.insights?.all ?? [];
    if (insights.length === 0) {
      return '';
    }

    const strategyEligibleInsights = insights.filter(insight => {
      if (insight.insightType !== 'competitor_gap') return true;
      const gapInsight = insight as AnalyticsInsight<'competitor_gap'>;
      return isEligibleStrategyPoolKeyword({
        keyword: gapInsight.data.keyword,
        volume: gapInsight.data.volume,
        difficulty: gapInsight.data.difficulty,
        source: `insight_gap:${gapInsight.data.competitorDomain}`,
      });
    });
    const keywordClusters = insights
      .filter((i): i is AnalyticsInsight<'keyword_cluster'> => i.insightType === 'keyword_cluster')
      .map(i => i.data)
      .sort((a, b) => b.totalImpressions - a.totalImpressions);
    const competitorGaps = strategyEligibleInsights
      .filter((i): i is AnalyticsInsight<'competitor_gap'> => i.insightType === 'competitor_gap')
      .map(i => i.data)
      .sort((a, b) => b.volume - a.volume);
    const conversionPages = insights
      .filter((i): i is AnalyticsInsight<'conversion_attribution'> => i.insightType === 'conversion_attribution')
      .map(i => ({ pageUrl: i.pageId || '', ...i.data }))
      .sort((a, b) => b.conversionRate - a.conversionRate);
    const contentDecaySignals = insights
      .filter((i): i is AnalyticsInsight<'content_decay'> => i.insightType === 'content_decay' && i.pageId != null)
      .map(i => ({
        pageId: i.pageId!,
        clicksDelta: i.data.currentClicks - i.data.baselineClicks,
        deltaPercent: i.data.deltaPercent,
      }));
    const rankingMovers = insights
      .filter((i): i is AnalyticsInsight<'ranking_mover'> => i.insightType === 'ranking_mover')
      .map(i => ({
        query: i.data.query,
        positionDelta: -i.data.positionChange,
        clicksDelta: i.data.currentClicks - i.data.previousClicks,
        currentPosition: i.data.currentPosition,
      }))
      .sort((a, b) => Math.abs(b.positionDelta) - Math.abs(a.positionDelta));
    const cannibalization = insights
      .filter((i): i is AnalyticsInsight<'cannibalization'> => i.insightType === 'cannibalization')
      .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));
    const ctrOpportunities = insights
      .filter((i): i is AnalyticsInsight<'ctr_opportunity'> => i.insightType === 'ctr_opportunity')
      .sort((a, b) => b.data.estimatedClickGap - a.data.estimatedClickGap);
    const rankingOpportunities = insights
      .filter((i): i is AnalyticsInsight<'ranking_opportunity'> => i.insightType === 'ranking_opportunity')
      .sort((a, b) => b.data.estimatedTrafficGain - a.data.estimatedTrafficGain);

    let intelligenceBlock = buildStrategyIntelligenceBlock({
      keywordClusters: keywordClusters.length > 0 ? keywordClusters : undefined,
      competitorGaps: competitorGaps.length > 0 ? competitorGaps : undefined,
      conversionPages: conversionPages.length > 0 ? conversionPages : undefined,
      performanceDeltas: rankingMovers.length > 0 ? rankingMovers : undefined,
      contentDecay: contentDecaySignals.length > 0 ? contentDecaySignals : undefined,
      cannibalization: cannibalization.length > 0 ? cannibalization : undefined,
      ctrOpportunities: ctrOpportunities.length > 0 ? ctrOpportunities : undefined,
      rankingOpportunities: rankingOpportunities.length > 0 ? rankingOpportunities : undefined,
    });

    const stratSignals = buildStrategySignals(strategyEligibleInsights, { keywordEvaluationContext });
    if (stratSignals.length > 0) {
      intelligenceBlock += `\n\nSTRATEGY SIGNALS (analytics feedback loop — use to prioritize recommendations):\n${stratSignals.slice(0, 10).map(s => `- [${s.type}] ${s.detail}`).join('\n')}`;
    }
    return intelligenceBlock;
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error');
    return '';
  }
}

export async function buildSiteSynthesisContext({
  ws,
  searchData,
  pageMappings,
  providerContext,
  strategyIntel,
  keywordEvaluationContext,
  isEligibleStrategyPoolKeyword,
}: BuildSiteSynthesisContextOptions): Promise<SiteSynthesisContext> {
  return {
    gscSummary: buildGscSummary(searchData),
    ga4Context: buildGa4Context(searchData, pageMappings),
    auditContext: await buildAuditContext(ws),
    providerContext,
    intelligenceBlock: buildStrategyInsightContext(
      strategyIntel,
      keywordEvaluationContext,
      isEligibleStrategyPoolKeyword,
    ),
  };
}
