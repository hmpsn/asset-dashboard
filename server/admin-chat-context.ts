/**
 * Admin Chat Context Assembly — builds rich, question-aware context
 * for the admin AI chat from all platform data sources.
 *
 * Instead of the frontend pre-fetching everything, this module
 * assembles context server-side, pulling only the data sources
 * relevant to the user's question.
 */

import type { Workspace } from './workspaces.js';
import { getWorkspace, getBrandName } from './workspaces.js';
import { formatLearningsForPrompt } from './workspace-learnings.js';
import { getLatestSnapshot } from './reports.js';
import { listBriefs } from './content-brief.js';
import { listContentRequests } from './content-requests.js';
import { listBatches } from './approvals.js';
import { getLatestRanks, getTrackedKeywords } from './rank-tracking.js';
import { loadDecayAnalysis } from './content-decay.js';
import { listWorkOrders } from './work-orders.js';
import { listTemplates } from './content-templates.js';
import { listMatrices } from './content-matrices.js';
import { getSeoChanges } from './seo-change-tracker.js';
import { loadRecommendations } from './recommendations.js';
import { listAnomalies } from './anomaly-detection.js';
import { parseJsonFallback } from './db/json-validation.js';
import { getSearchOverview, getSearchDeviceBreakdown, getSearchCountryBreakdown, getSearchPeriodComparison } from './search-console.js';
import { getGA4Overview, getGA4TopPages, getGA4TopSources, getGA4OrganicOverview, getGA4NewVsReturning, getGA4Conversions, getGA4LandingPages, getGA4PeriodComparison } from './google-analytics.js';
import { isGlobalConnected } from './google-auth.js';
import { applySuppressionsToAudit, getAuditTrafficForWorkspace } from './helpers.js';
import { RICH_BLOCKS_PROMPT } from './seo-context.js';
import { buildWorkspaceIntelligence, formatPageMapForPrompt, formatKeywordsForPrompt, formatPersonasForPrompt, formatBrandVoiceForPrompt, formatKnowledgeBaseForPrompt } from './workspace-intelligence.js';
import { scrapeUrl } from './web-scraper.js';
import { createLogger } from './logger.js';
import { getInsights } from './analytics-insights-store.js';
import type { AnalyticsInsight, PageHealthData, QuickWinData, ContentDecayData, CannibalizationData, KeywordClusterData, CompetitorGapData, ConversionAttributionData } from '../shared/types/analytics.js';
import type { IntelligenceSlice } from '../shared/types/intelligence.js';
import { STUDIO_NAME } from './constants.js';

const log = createLogger('admin-chat-context');

// ── Question Classification ──

type ContextCategory =
  | 'general'        // status report, overview, what's happening
  | 'search'         // GSC, keywords, rankings, queries, impressions, clicks
  | 'analytics'      // GA4, traffic, users, bounce, conversions, sources
  | 'audit'          // site health, SEO issues, errors, warnings
  | 'content'        // briefs, requests, content pipeline, writing
  | 'strategy'       // keyword strategy, opportunities, content gaps
  | 'performance'    // pagespeed, core web vitals, page weight
  | 'approvals'      // pending approvals, client review
  | 'activity'       // recent changes, what happened, timeline
  | 'ranks'          // rank tracking, position changes
  | 'competitors'    // competitive analysis
  | 'client'         // client communication, churn, engagement
  | 'page_analysis'  // analyze a specific page URL
  | 'content_review' // review pasted content/document
  | 'insights';      // analytics intelligence — quick wins, priorities, decay, cannibalization

const CATEGORY_PATTERNS: Record<ContextCategory, RegExp[]> = {
  general: [/status report/i, /overview/i, /what.*happening/i, /what.*going on/i, /summary/i, /this week/i, /this month/i, /full.*report/i, /everything/i, /what.*next/i, /roi/i, /highest.*priority/i, /work.*on/i],
  search: [/search/i, /gsc/i, /quer(y|ies)/i, /impression/i, /click/i, /ctr/i, /position/i, /serp/i, /google.*search/i],
  analytics: [/analytics/i, /ga4/i, /traffic/i, /user(s)?/i, /session/i, /bounce/i, /conversion/i, /source/i, /device/i, /organic/i, /visitor/i, /pageview/i],
  audit: [/audit/i, /health/i, /seo.*issue/i, /error/i, /warning/i, /fix/i, /broken/i, /issue/i, /score/i],
  content: [/content/i, /brief/i, /blog/i, /article/i, /pipeline/i, /deliverable/i, /writing/i, /draft/i, /post/i, /template/i, /matrix/i, /planner/i, /content.*plan/i],
  strategy: [/strategy/i, /keyword/i, /opportunit/i, /content.*gap/i, /quick.*win/i, /target/i],
  performance: [/pagespeed/i, /speed/i, /core.*web.*vital/i, /performance/i, /load.*time/i, /weight/i, /lighthouse/i],
  approvals: [/approval/i, /pending/i, /review/i, /approve/i, /reject/i, /batch/i, /sign.*off/i],
  activity: [/activit/i, /recent/i, /timeline/i, /what.*changed/i, /what.*happened/i, /log/i, /history/i],
  ranks: [/rank/i, /position/i, /tracking/i, /moving/i, /climbing/i, /dropping/i],
  competitors: [/competitor/i, /compet/i, /vs\b/i, /versus/i, /compare/i, /benchmark/i],
  client: [/client/i, /churn/i, /engagement/i, /tell.*client/i, /update.*client/i, /report.*client/i, /communi/i],
  page_analysis: [/https?:\/\//i, /analyze.*page/i, /review.*page/i, /look at.*\//i, /check.*\//i, /what.*wrong.*\//i, /www[.]/i],
  content_review: [], // detected by content length, not patterns
  insights: [/what.*should.*work/i, /priorit/i, /quick.*win/i, /opportunit/i, /declin/i, /cannibali/i, /page.*health/i, /health.*score/i, /what.*focus/i, /biggest.*impact/i],
};

/** Token budget for intelligence context in general/multi-category admin chat queries.
 *  The intelligence layer's §20 priority chain truncates gracefully at this limit.
 *  TASK 8: pass this as tokenBudget when expanding slices for 'general' queries. */
const GENERAL_INTEL_TOKEN_BUDGET = 6000;

/**
 * Classify which data categories a question needs.
 * Returns a Set of relevant categories.
 */
export function classifyQuestion(question: string): Set<ContextCategory> {
  const cats = new Set<ContextCategory>();

  // Check for page analysis (URL in question)
  const urlMatch = question.match(/https?:\/\/[^\s"'<>]+/i) || question.match(/(?:^|\s)(\/[a-z0-9][a-z0-9-/]*)/i);
  if (urlMatch) cats.add('page_analysis');

  // Check for content review (long pasted text — >150 words after removing the question part)
  const wordCount = question.split(/\s+/).length;
  if (wordCount > 150) cats.add('content_review');

  // Pattern matching
  for (const [cat, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    for (const p of patterns) {
      if (p.test(question)) {
        cats.add(cat as ContextCategory);
        break;
      }
    }
  }

  // If general or nothing matched, load the core sources
  if (cats.size === 0 || cats.has('general')) {
    cats.add('general');
    // General queries get the high-value sources
    cats.add('search');
    cats.add('analytics');
    cats.add('audit');
    cats.add('content');
    cats.add('ranks');
    cats.add('activity');
    cats.add('client');
  }

  return cats;
}

/**
 * Extract a URL from the question text, if present.
 */
export function extractUrl(question: string): string | null {
  // Full URL
  const fullUrl = question.match(/https?:\/\/[^\s"'<>]+/i);
  if (fullUrl) return fullUrl[0];

  // Relative path like /services or /blog/post-title
  const pathMatch = question.match(/(?:^|\s)(\/[a-z0-9][a-z0-9-/]*)/i);
  if (pathMatch) return pathMatch[1];

  return null;
}

// ── Analytics Intelligence Context ──

/**
 * Build a formatted context block from analytics intelligence insights.
 * Used by the chat advisor to surface quick wins, decay, cannibalization, and health scores.
 */
export function buildInsightsContext(insights: AnalyticsInsight[]): string {
  if (insights.length === 0) return '';

  const sections: string[] = [];

  // Page Health summary — top 10 by score, worst first (enriched with titles + audit issues)
  const healthInsights = insights
    .filter(i => i.insightType === 'page_health')
    .map(i => ({ pageId: i.pageId, pageTitle: i.pageTitle, strategyAlignment: i.strategyAlignment, auditIssues: i.auditIssues, pipelineStatus: i.pipelineStatus, ...(i.data as unknown as PageHealthData), severity: i.severity }))
    .sort((a, b) => a.score - b.score);
  if (healthInsights.length > 0) {
    const lines = healthInsights.slice(0, 10).map(h => {
      const title = h.pageTitle || (() => { try { return new URL(h.pageId || '').pathname; } catch { return h.pageId || '(unknown)'; } })();
      let line = `  ${title}: ${h.score}/100 (${h.trend}) — ${h.clicks} clicks, pos ${h.position?.toFixed?.(1) ?? h.position}`;
      if (h.strategyAlignment && h.strategyAlignment !== 'untracked') line += ` — strategy: ${h.strategyAlignment}`;
      if (h.pipelineStatus) line += ` — pipeline: ${h.pipelineStatus}`;
      if (h.auditIssues) {
        const issues = parseJsonFallback<string[]>(h.auditIssues, []);
        if (issues.length > 0) line += ` — ${issues.length} audit issue(s)`;
      }
      return line;
    });
    sections.push(`PAGE HEALTH SCORES (worst first):\n${lines.join('\n')}`);
  }

  // Ranking opportunities
  const quickWins = insights
    .filter(i => i.insightType === 'ranking_opportunity')
    .map(i => ({ ...i.data as unknown as QuickWinData, pageTitle: i.pageTitle, strategyAlignment: i.strategyAlignment, pipelineStatus: i.pipelineStatus }))
    .sort((a, b) => b.estimatedTrafficGain - a.estimatedTrafficGain);
  if (quickWins.length > 0) {
    const lines = quickWins.slice(0, 10).map(q => {
      let line = `  "${q.query}" — pos ${Math.round(q.currentPosition)}, est. +${q.estimatedTrafficGain} clicks/mo if improved`;
      if (q.pageTitle) line += ` (${q.pageTitle})`;
      if (q.strategyAlignment && q.strategyAlignment !== 'untracked') line += ` [strategy: ${q.strategyAlignment}]`;
      if (q.pipelineStatus) line += ` [pipeline: ${q.pipelineStatus}]`;
      return line;
    });
    sections.push(`QUICK WINS (pages close to page 1):\n${lines.join('\n')}`);
  }

  // Content decay
  const decayInsights = insights
    .filter(i => i.insightType === 'content_decay')
    .map(i => ({ pageId: i.pageId, ...(i.data as unknown as ContentDecayData) }))
    .sort((a, b) => a.deltaPercent - b.deltaPercent);
  if (decayInsights.length > 0) {
    const lines = decayInsights.slice(0, 8).map(d => {
      let path: string;
      try { path = new URL(d.pageId || '').pathname; } catch { path = d.pageId || '(unknown)'; }
      return `  ${path}: ${d.deltaPercent}% (${d.baselineClicks} → ${d.currentClicks} clicks)`;
    });
    sections.push(`CONTENT DECAY (pages losing traffic):\n${lines.join('\n')}`);
  }

  // Cannibalization
  const cannibalization = insights
    .filter(i => i.insightType === 'cannibalization')
    .map(i => i.data as unknown as CannibalizationData);
  if (cannibalization.length > 0) {
    const lines = cannibalization.slice(0, 8).map(c => {
      const pages = c.pages.map((p, i) => {
        try { return `${new URL(p).pathname} (pos ${Math.round(c.positions[i])})`; } catch { return p; }
      }).join(', ');
      return `  "${c.query}": ${pages}`;
    });
    sections.push(`CANNIBALIZATION (multiple pages competing):\n${lines.join('\n')}`);
  }

  // Keyword clusters
  const clusters = insights
    .filter(i => i.insightType === 'keyword_cluster')
    .map(i => i.data as unknown as KeywordClusterData)
    .sort((a, b) => b.totalImpressions - a.totalImpressions);
  if (clusters.length > 0) {
    const lines = clusters.slice(0, 8).map(c => {
      const pillar = c.pillarPage ? ` → pillar: ${(() => { try { return new URL(c.pillarPage).pathname; } catch { return c.pillarPage; } })()}` : '';
      return `  "${c.label}" (${c.queries.length} queries, ${c.totalImpressions} imp, avg pos ${Math.round(c.avgPosition)})${pillar}`;
    });
    sections.push(`KEYWORD CLUSTERS (topic groups from GSC queries):\n${lines.join('\n')}`);
  }

  // Competitor gaps
  const gaps = insights
    .filter(i => i.insightType === 'competitor_gap')
    .map(i => i.data as unknown as CompetitorGapData)
    .sort((a, b) => b.volume - a.volume);
  if (gaps.length > 0) {
    const lines = gaps.slice(0, 10).map(g => {
      const ours = g.ourPosition ? `our pos ${Math.round(g.ourPosition)}` : 'we don\'t rank';
      return `  "${g.keyword}" — ${g.competitorDomain} pos ${g.competitorPosition}, vol ${g.volume}, diff ${g.difficulty} (${ours})`;
    });
    sections.push(`COMPETITOR GAPS (keywords competitors rank for):\n${lines.join('\n')}`);
  }

  // Conversion attribution
  const conversions = insights
    .filter(i => i.insightType === 'conversion_attribution')
    .map(i => ({ pageId: i.pageId, ...(i.data as unknown as ConversionAttributionData) }))
    .sort((a, b) => b.conversionRate - a.conversionRate);
  if (conversions.length > 0) {
    const lines = conversions.slice(0, 8).map(c => {
      let path: string;
      try { path = new URL(c.pageId || '').pathname; } catch { path = c.pageId || '(unknown)'; }
      return `  ${path}: ${c.conversionRate.toFixed(1)}% CVR (${c.conversions} conversions, ${c.sessions} sessions)`;
    });
    sections.push(`CONVERSION ATTRIBUTION (pages driving conversions):\n${lines.join('\n')}`);
  }

  // Anomaly digest insights
  const anomalyInsights = insights.filter(i => i.insightType === 'anomaly_digest');
  if (anomalyInsights.length > 0) {
    const lines = anomalyInsights.slice(0, 8).map(a => {
      const data = a.data as Record<string, unknown>;
      return `  ${data.anomalyType}: ${data.metric} deviated ${data.deviationPercent}% (ongoing for ${data.durationDays} day(s))`;
    });
    sections.push(`ANOMALY DIGEST (active anomalies tracked in insight feed):\n${lines.join('\n')}`);
  }

  // Proactive critical insight summary
  const criticalInsights = insights.filter(i => i.severity === 'critical');
  if (criticalInsights.length > 0) {
    sections.push(`⚠️ ${criticalInsights.length} CRITICAL INSIGHTS requiring attention — proactively mention these when relevant.`);
  }

  if (sections.length === 0) return '';

  return `ANALYTICS INTELLIGENCE (computed insights from intelligence layer):\n\n${sections.join('\n\n')}`;
}

// ── Context Assembly ──

export interface AssembledContext {
  /** Structured data blocks as strings for the system prompt */
  sections: string[];
  /** Data sources that were included (for the AVAILABLE DATA list) */
  dataSources: string[];
  /** The mode the chat should operate in */
  mode: 'analyst' | 'page_reviewer' | 'content_reviewer';
  /** Page-specific context if analyzing a page */
  pageContext?: {
    url: string;
    scraped?: { title: string; metaDescription: string; headings: { level: number; text: string }[]; bodyText: string; wordCount: number };
    auditIssues?: unknown[];
    gscData?: unknown;
    keywordContext?: string;
  };
}

/**
 * Assemble all relevant context for an admin chat question.
 * This is the main entry point — it classifies the question
 * and fetches only the data sources that matter.
 */
export async function assembleAdminContext(
  workspaceId: string,
  question: string,
  days = 28,
): Promise<AssembledContext> {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { sections: [], dataSources: [], mode: 'analyst' };

  const categories = classifyQuestion(question);
  const sections: string[] = [];
  const dataSources: string[] = [];
  let mode: AssembledContext['mode'] = 'analyst';
  let pageContext: AssembledContext['pageContext'] | undefined;

  // ── Always include: strategy, brand voice, knowledge base, personas ──
  // Build slice list based on question categories (Task 8)
  const intelSlices: string[] = ['seoContext', 'learnings'];
  if (categories.has('activity') || categories.has('general')) intelSlices.push('operational');
  if (categories.has('performance') || categories.has('general')) intelSlices.push('siteHealth');
  if (categories.has('client') || categories.has('general')) intelSlices.push('clientSignals');
  if (categories.has('approvals') && !intelSlices.includes('operational')) intelSlices.push('operational');

  const intel = await buildWorkspaceIntelligence(workspaceId, {
    slices: intelSlices as IntelligenceSlice[],
    learningsDomain: 'all',
    ...(categories.has('general') ? { tokenBudget: GENERAL_INTEL_TOKEN_BUDGET } : {}),
  });
  const seoCtx = intel.seoContext;

  const keywordBlock = formatKeywordsForPrompt(seoCtx);
  const strategy = seoCtx?.strategy;
  const brandVoiceBlock = formatBrandVoiceForPrompt(seoCtx?.brandVoice);
  const bizCtx = seoCtx?.businessContext ?? '';
  const kwMapContext = seoCtx ? formatPageMapForPrompt(seoCtx) : '';
  const personasContext = formatPersonasForPrompt(seoCtx?.personas);
  const knowledgeBase = formatKnowledgeBaseForPrompt(seoCtx?.knowledgeBase);

  if (keywordBlock || kwMapContext || bizCtx) {
    const stratParts = [keywordBlock, kwMapContext, bizCtx ? `\nBusiness: ${bizCtx}` : '', brandVoiceBlock].filter(Boolean);
    sections.push(`KEYWORD STRATEGY CONTEXT:\n${stratParts.join('\n')}`);
    dataSources.push('Keyword Strategy & Brand Voice');
  }
  if (personasContext) {
    sections.push(personasContext);
    dataSources.push('Audience Personas');
  }
  if (knowledgeBase) {
    sections.push(knowledgeBase);
    dataSources.push('Business Knowledge Base');
  }

  // ── Parallel fetch based on categories ──
  const fetches: Array<{ key: string; promise: Promise<unknown> }> = [];

  // Google connections check
  const googleConnected = isGlobalConnected();

  // GSC data
  if (categories.has('search') || categories.has('general') || categories.has('ranks')) {
    if (ws.gscPropertyUrl && ws.webflowSiteId && googleConnected) {
      fetches.push({ key: 'gscOverview', promise: getSearchOverview(ws.webflowSiteId, ws.gscPropertyUrl, days).catch(() => null) });
      fetches.push({ key: 'gscComparison', promise: getSearchPeriodComparison(ws.webflowSiteId, ws.gscPropertyUrl, days).catch(() => null) });
      if (categories.has('search') || categories.has('general')) {
        fetches.push({ key: 'gscDevices', promise: getSearchDeviceBreakdown(ws.webflowSiteId, ws.gscPropertyUrl, days).catch(() => null) });
        fetches.push({ key: 'gscCountries', promise: getSearchCountryBreakdown(ws.webflowSiteId, ws.gscPropertyUrl, days).catch(() => null) });
      }
    }
  }

  // GA4 data
  if (categories.has('analytics') || categories.has('general')) {
    if (ws.ga4PropertyId && googleConnected) {
      fetches.push({ key: 'ga4Overview', promise: getGA4Overview(ws.ga4PropertyId, days).catch(() => null) });
      fetches.push({ key: 'ga4Comparison', promise: getGA4PeriodComparison(ws.ga4PropertyId, days).catch(() => null) });
      fetches.push({ key: 'ga4TopPages', promise: getGA4TopPages(ws.ga4PropertyId, days).catch(() => null) });
      fetches.push({ key: 'ga4Sources', promise: getGA4TopSources(ws.ga4PropertyId, days).catch(() => null) });
      fetches.push({ key: 'ga4Organic', promise: getGA4OrganicOverview(ws.ga4PropertyId, days).catch(() => null) });
      fetches.push({ key: 'ga4NewVsReturning', promise: getGA4NewVsReturning(ws.ga4PropertyId, days).catch(() => null) });
      fetches.push({ key: 'ga4Conversions', promise: getGA4Conversions(ws.ga4PropertyId, days).catch(() => null) });
      fetches.push({ key: 'ga4LandingPages', promise: getGA4LandingPages(ws.ga4PropertyId, days).catch(() => null) });
    }
  }

  // Page-specific analysis
  if (categories.has('page_analysis')) {
    const targetUrl = extractUrl(question);
    if (targetUrl) {
      mode = 'page_reviewer';
      const fullUrl = targetUrl.startsWith('http') ? targetUrl : (ws.liveDomain ? `https://${ws.liveDomain}${targetUrl}` : targetUrl);
      if (fullUrl.startsWith('http')) {
        fetches.push({ key: 'pageScrape', promise: scrapeUrl(fullUrl).catch(() => null) });
      }
      pageContext = { url: targetUrl };

      // Get page-specific keyword context from strategy pageMap
      const normalizedPath = targetUrl.startsWith('/') ? targetUrl : targetUrl.replace(/^https?:\/\/[^/]+/, '');
      const pageKw = strategy?.pageMap?.find(p => p.pagePath.toLowerCase() === normalizedPath.toLowerCase())
        ?? (normalizedPath ? strategy?.pageMap?.find(p => normalizedPath.toLowerCase().endsWith(p.pagePath.toLowerCase()) || p.pagePath.toLowerCase().endsWith(normalizedPath.toLowerCase())) : undefined);
      if (pageKw) {
        let pageKeywordBlock = `\n\nTHIS PAGE'S TARGET (overrides general context):`;
        pageKeywordBlock += `\nPrimary keyword: "${pageKw.primaryKeyword}"`;
        if (pageKw.secondaryKeywords?.length) {
          pageKeywordBlock += `\nSecondary keywords: ${pageKw.secondaryKeywords.join(', ')}`;
        }
        if (pageKw.searchIntent) {
          pageKeywordBlock += `\nSearch intent: ${pageKw.searchIntent}`;
        }
        pageKeywordBlock += `\nIMPORTANT: If this page's keywords reference a specific location (city, state, region), ALWAYS use THAT location. Do NOT substitute the business headquarters or a different location from the general business context. The page-level keyword is the authoritative signal for what this page targets.`;
        pageContext.keywordContext = pageKeywordBlock;
      }
    }
  }

  // Content review mode
  if (categories.has('content_review')) {
    mode = 'content_reviewer';
  }

  // Await all parallel fetches
  const results = new Map<string, unknown>();
  const settled = await Promise.allSettled(fetches.map(async f => ({ key: f.key, data: await f.promise })));
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.data) {
      results.set(result.value.key, result.value.data);
    }
  }

  // ── Process GSC results ──
  const gscOverview = results.get('gscOverview') as Record<string, unknown> | null;
  if (gscOverview) {
    const summary = {
      dateRange: gscOverview.dateRange,
      totalClicks: gscOverview.totalClicks,
      totalImpressions: gscOverview.totalImpressions,
      avgCtr: gscOverview.avgCtr,
      avgPosition: gscOverview.avgPosition,
      topQueries: Array.isArray(gscOverview.topQueries) ? (gscOverview.topQueries as unknown[]).slice(0, 20) : [],
      topPages: Array.isArray(gscOverview.topPages) ? (gscOverview.topPages as unknown[]).slice(0, 10) : [],
    };
    sections.push(`GOOGLE SEARCH CONSOLE (last ${days} days):\n${JSON.stringify(summary, null, 1)}`);
    dataSources.push('Google Search Console (queries, clicks, impressions, CTR, positions)');
  }

  const gscComparison = results.get('gscComparison');
  if (gscComparison) {
    sections.push(`GSC PERIOD COMPARISON (current ${days}d vs previous ${days}d):\n${JSON.stringify(gscComparison, null, 1)}`);
    dataSources.push('GSC Period Comparison (trend direction for clicks, impressions, CTR, position)');
  }

  const gscDevices = results.get('gscDevices');
  if (gscDevices) {
    sections.push(`GSC DEVICE BREAKDOWN:\n${JSON.stringify(gscDevices, null, 1)}`);
    dataSources.push('GSC Device Breakdown (desktop vs mobile vs tablet)');
  }

  const gscCountries = results.get('gscCountries');
  if (gscCountries) {
    sections.push(`GSC COUNTRY BREAKDOWN:\n${JSON.stringify(gscCountries, null, 1)}`);
    dataSources.push('GSC Country Breakdown (top countries by clicks)');
  }

  // ── Process GA4 results ──
  const ga4Overview = results.get('ga4Overview');
  if (ga4Overview) {
    sections.push(`GOOGLE ANALYTICS 4 OVERVIEW (last ${days} days):\n${JSON.stringify(ga4Overview, null, 1)}`);
    dataSources.push('GA4 Overview (users, sessions, bounce rate, engagement)');
  }

  const ga4Comparison = results.get('ga4Comparison');
  if (ga4Comparison) {
    sections.push(`GA4 PERIOD COMPARISON:\n${JSON.stringify(ga4Comparison, null, 1)}`);
    dataSources.push('GA4 Period Comparison (current vs previous period deltas)');
  }

  const ga4TopPages = results.get('ga4TopPages') as unknown[] | null;
  if (ga4TopPages) {
    sections.push(`GA4 TOP PAGES:\n${JSON.stringify(ga4TopPages.slice(0, 10), null, 1)}`);
    dataSources.push('GA4 Top Pages');
  }

  const ga4Sources = results.get('ga4Sources') as unknown[] | null;
  if (ga4Sources) {
    sections.push(`GA4 TRAFFIC SOURCES:\n${JSON.stringify(ga4Sources.slice(0, 8), null, 1)}`);
    dataSources.push('GA4 Traffic Sources');
  }

  const ga4Organic = results.get('ga4Organic');
  if (ga4Organic) {
    sections.push(`GA4 ORGANIC OVERVIEW:\n${JSON.stringify(ga4Organic, null, 1)}`);
    dataSources.push('GA4 Organic Overview');
  }

  const ga4NewVsReturning = results.get('ga4NewVsReturning');
  if (ga4NewVsReturning) {
    sections.push(`GA4 NEW vs RETURNING USERS:\n${JSON.stringify(ga4NewVsReturning, null, 1)}`);
    dataSources.push('New vs Returning Users');
  }

  const ga4Conversions = results.get('ga4Conversions') as unknown[] | null;
  if (ga4Conversions) {
    sections.push(`GA4 KEY EVENTS/CONVERSIONS:\n${JSON.stringify(ga4Conversions.slice(0, 10), null, 1)}`);
    dataSources.push('Key Events & Conversions');
  }

  const ga4LandingPages = results.get('ga4LandingPages') as unknown[] | null;
  if (ga4LandingPages) {
    sections.push(`GA4 LANDING PAGES:\n${JSON.stringify(ga4LandingPages.slice(0, 10), null, 1)}`);
    dataSources.push('GA4 Landing Pages (sessions, bounce, conversions)');
  }

  // ── Synchronous data sources (fast, from SQLite) ──

  // Site Health Audit
  if (categories.has('audit') || categories.has('general') || categories.has('page_analysis')) {
    if (ws.webflowSiteId) {
      try {
        const snapshot = getLatestSnapshot(ws.webflowSiteId);
        if (snapshot) {
          const filteredAudit = applySuppressionsToAudit(snapshot.audit, ws.auditSuppressions || []);
          const pages = filteredAudit.pages;
          const auditSummary = {
            siteScore: filteredAudit.siteScore,
            totalPages: pages?.length || 0,
            errors: pages?.reduce((sum, p) => sum + (p.issues?.filter(i => i.severity === 'error').length || 0), 0) || 0,
            warnings: pages?.reduce((sum, p) => sum + (p.issues?.filter(i => i.severity === 'warning').length || 0), 0) || 0,
            siteWideIssues: filteredAudit.siteWideIssues?.slice(0, 5),
            worstPages: pages
              ?.filter(p => p.issues?.length > 0)
              .sort((a, b) => a.score - b.score)
              .slice(0, 8)
              .map(p => ({
                page: p.page, slug: p.slug, score: p.score,
                topIssues: p.issues?.slice(0, 3).map(i => `[${i.severity}] ${i.check || i.type}: ${i.message}`) || [],
              })),
          };
          sections.push(`SITE HEALTH AUDIT:\n${JSON.stringify(auditSummary, null, 1)}`);
          dataSources.push('Site Health Audit (score, errors, warnings, per-page issues)');

          // Audit traffic intelligence
          try {
            const trafficMap = await getAuditTrafficForWorkspace(ws);
            if (Object.keys(trafficMap).length > 0) {
              const pagesWithTraffic = pages
                ?.filter(p => p.issues?.length > 0)
                .map(p => {
                  const slug = p.slug?.startsWith('/') ? p.slug : `/${p.slug}`;
                  const traffic = trafficMap[slug] || trafficMap[p.slug];
                  return { page: p.page, slug, issues: p.issues.length, score: p.score, traffic };
                })
                .filter(p => p.traffic && (p.traffic.clicks > 0 || p.traffic.pageviews > 0))
                .sort((a, b) =>
                  ((b.traffic?.clicks || 0) + (b.traffic?.pageviews || 0)) - ((a.traffic?.clicks || 0) + (a.traffic?.pageviews || 0)))
                .slice(0, 8);
              if (pagesWithTraffic?.length) {
                sections.push(`HIGH-TRAFFIC PAGES WITH SEO ISSUES (prioritize these — they get real visitors):\n${pagesWithTraffic.map(p => `• ${p.slug} — ${p.issues} issues, score ${p.score} | ${p.traffic.clicks} clicks, ${p.traffic.pageviews} pageviews`).join('\n')}`);
                dataSources.push('Audit Traffic Intelligence (high-traffic pages with SEO errors)');
              }
            }
          } catch { /* non-critical */ }

          // If analyzing a specific page, pull its audit data
          if (pageContext) {
            const targetSlug = pageContext.url.replace(/^https?:\/\/[^/]+/, '');
            const pageAudit = pages?.find((p) => {
              const pSlug = p.slug?.startsWith('/') ? p.slug : `/${p.slug}`;
              return pSlug === targetSlug || pSlug === `${targetSlug}/` || targetSlug.endsWith(pSlug);
            });
            if (pageAudit) {
              pageContext.auditIssues = pageAudit.issues;
            }
          }
        }
      } catch (e) { log.warn({ err: e }, 'Failed to load audit snapshot'); }
    }
  }

  // Anomalies
  if (categories.has('general') || categories.has('analytics') || categories.has('search')) {
    try {
      const anomalies = listAnomalies(workspaceId);
      if (anomalies.length > 0) {
        sections.push(`DETECTED ANOMALIES (AI-flagged significant changes):\n${JSON.stringify(anomalies.slice(0, 8), null, 1)}`);
        dataSources.push('Detected Anomalies');
      }
    } catch { /* non-critical */ }
  }

  // Analytics Intelligence (quick wins, decay, cannibalization, health scores)
  if (categories.has('insights') || categories.has('general') || categories.has('strategy')) {
    try {
      const allInsights = getInsights(workspaceId);
      if (allInsights.length > 0) {
        const insightsBlock = buildInsightsContext(allInsights);
        if (insightsBlock) {
          sections.push(insightsBlock);
          dataSources.push('Analytics Intelligence (page health, quick wins, content decay, cannibalization)');
        }
      }
    } catch { /* intelligence layer not ready — non-critical */ }
  }

  // Content Pipeline (briefs + requests)
  if (categories.has('content') || categories.has('general') || categories.has('approvals')) {
    try {
      const briefs = listBriefs(workspaceId);
      if (briefs.length > 0) {
        const briefSummary = briefs.slice(0, 15).map(b => ({
          keyword: b.targetKeyword,
          title: b.suggestedTitle?.slice(0, 60), createdAt: b.createdAt?.slice(0, 10),
        }));
        sections.push(`CONTENT BRIEFS (${briefs.length} total):\n${JSON.stringify(briefSummary, null, 1)}`);
        dataSources.push(`Content Briefs (${briefs.length} total — keywords, statuses, dates)`);
      }
    } catch { /* non-critical */ }

    try {
      const requests = listContentRequests(workspaceId);
      if (requests.length > 0) {
        const reqSummary = requests.slice(0, 15).map(r => ({
          topic: r.topic, keyword: r.targetKeyword, status: r.status,
          serviceType: r.serviceType, priority: r.priority, source: r.source,
          requestedAt: r.requestedAt?.slice(0, 10),
        }));
        sections.push(`CONTENT REQUESTS (${requests.length} total):\n${JSON.stringify(reqSummary, null, 1)}`);
        dataSources.push(`Content Requests (${requests.length} total — topics, statuses, pipeline)`);
      }
    } catch { /* non-critical */ }
  }

  // Rank Tracking
  if (categories.has('ranks') || categories.has('general') || categories.has('search')) {
    try {
      const latestRanks = getLatestRanks(workspaceId);
      const tracked = getTrackedKeywords(workspaceId);
      if (latestRanks.length > 0) {
        const rankSummary = latestRanks.slice(0, 20).map(r => ({
          keyword: r.query, position: r.position, change: r.change,
          clicks: r.clicks, impressions: r.impressions, ctr: r.ctr,
          pinned: tracked.some(t => t.query === r.query && t.pinned),
        }));
        sections.push(`RANK TRACKING (latest positions):\n${JSON.stringify(rankSummary, null, 1)}`);
        dataSources.push('Rank Tracking (keyword positions, changes, pinned keywords)');
      }
    } catch { /* non-critical */ }
  }

  // Activity Log
  if (categories.has('activity') || categories.has('general')) {
    try {
      const recentActivity = intel.operational?.recentActivity ?? [];
      if (recentActivity.length > 0) {
        const actSummary = recentActivity.slice(0, 15).map(a => ({
          type: a.type, description: a.description, date: a.timestamp?.slice(0, 10),
        }));
        sections.push(`RECENT ACTIVITY LOG:\n${JSON.stringify(actSummary, null, 1)}`);
        dataSources.push('Activity Log (recent workspace events)');
      }
    } catch { /* non-critical */ }
  }

  // Approvals
  if (categories.has('approvals') || categories.has('general') || categories.has('client')) {
    try {
      // TASK 8 GUARD: Do NOT replace this with operational.approvalQueue — that slice only has
      // { pending: number; oldestAge: number | null }, which loses batch names, per-batch item
      // breakdown, and pending/approved/rejected counts. Keep this direct call and only
      // supplement it with the slice's queue summary as an additional signal.
      const batches = listBatches(workspaceId);
      if (batches.length > 0) {
        const pendingBatches = batches.filter(b => b.items?.some(i => i.status === 'pending'));
        const approvalSummary = {
          totalBatches: batches.length,
          pendingBatches: pendingBatches.length,
          pendingItems: pendingBatches.reduce((sum, b) => sum + (b.items?.filter(i => i.status === 'pending').length || 0), 0),
          recentBatches: batches.slice(0, 5).map(b => ({
            name: b.name, status: b.status, createdAt: b.createdAt?.slice(0, 10),
            itemCount: b.items?.length || 0,
            pending: b.items?.filter(i => i.status === 'pending').length || 0,
            approved: b.items?.filter(i => i.status === 'approved').length || 0,
            rejected: b.items?.filter(i => i.status === 'rejected').length || 0,
          })),
        };
        sections.push(`APPROVAL BATCHES:\n${JSON.stringify(approvalSummary, null, 1)}`);
        dataSources.push(`Approvals (${approvalSummary.pendingItems} items pending client review)`);
        // Supplement: operational slice provides a concise queue summary for cross-referencing
        const queue = intel.operational?.approvalQueue;
        if (queue && queue.pending > 0) {
          const age = queue.oldestAge != null ? ` (oldest: ${queue.oldestAge}h ago)` : '';
          sections.push(`APPROVAL QUEUE SUMMARY: ${queue.pending} items pending${age}`);
        }
      }
    } catch { /* non-critical */ }
  }

  // Content Decay
  if (categories.has('content') || categories.has('general') || categories.has('search')) {
    try {
      const decay = loadDecayAnalysis(workspaceId);
      if (decay && decay.decayingPages?.length) {
        const decaySummary = {
          totalDecaying: decay.decayingPages.length,
          topDecaying: decay.decayingPages.slice(0, 5).map(p => ({
            page: p.page, clickDecline: p.clickDeclinePct, severity: p.severity,
            currentClicks: p.currentClicks, previousClicks: p.previousClicks,
          })),
          analyzedAt: decay.analyzedAt?.slice(0, 10),
        };
        sections.push(`CONTENT DECAY (pages losing traffic):\n${JSON.stringify(decaySummary, null, 1)}`);
        dataSources.push(`Content Decay (${decay.decayingPages.length} pages declining)`);
      }
    } catch { /* non-critical */ }
  }

  // Work Orders
  if (categories.has('content') || categories.has('general')) {
    try {
      const orders = listWorkOrders(workspaceId);
      if (orders.length > 0) {
        const orderSummary = orders.slice(0, 10).map(o => ({
          productType: o.productType, status: o.status, createdAt: o.createdAt?.slice(0, 10),
        }));
        sections.push(`WORK ORDERS (${orders.length} total):\n${JSON.stringify(orderSummary, null, 1)}`);
        dataSources.push('Work Orders');
      }
    } catch { /* non-critical */ }

    // Content Plan (templates + matrices)
    try {
      const templates = listTemplates(workspaceId);
      const matrices = listMatrices(workspaceId);
      if (templates.length > 0 || matrices.length > 0) {
        const planParts: string[] = [];
        if (templates.length > 0) {
          const tplSummary = templates.slice(0, 10).map(t => ({
            name: t.name, pageType: t.pageType, variables: t.variables.length, sections: t.sections.length,
          }));
          planParts.push(`Templates (${templates.length}): ${JSON.stringify(tplSummary, null, 1)}`);
        }
        if (matrices.length > 0) {
          const mtxSummary = matrices.slice(0, 10).map(m => ({
            name: m.name, cells: m.stats.total,
            planned: m.stats.planned, briefGenerated: m.stats.briefGenerated,
            drafted: m.stats.drafted, reviewed: m.stats.reviewed, published: m.stats.published,
          }));
          const totalCells = matrices.reduce((s, m) => s + m.stats.total, 0);
          const totalPublished = matrices.reduce((s, m) => s + m.stats.published, 0);
          planParts.push(`Matrices (${matrices.length}, ${totalCells} cells, ${totalPublished} published): ${JSON.stringify(mtxSummary, null, 1)}`);
        }
        sections.push(`CONTENT PLAN:\n${planParts.join('\n')}`);
        dataSources.push(`Content Plan (${templates.length} templates, ${matrices.length} matrices)`);
      }
    } catch { /* non-critical */ }
  }

  // SEO Change Tracker
  if (categories.has('activity') || categories.has('audit') || categories.has('general')) {
    try {
      const changes = getSeoChanges(workspaceId, 20);
      if (changes.length > 0) {
        const changeSummary = changes.slice(0, 10).map(c => ({
          page: c.pageSlug, fields: c.fields, date: c.changedAt?.slice(0, 10),
          source: c.source,
        }));
        sections.push(`RECENT SEO CHANGES:\n${JSON.stringify(changeSummary, null, 1)}`);
        dataSources.push('SEO Change Tracker (recent title/meta/content edits)');
      }
    } catch { /* non-critical */ }
  }

  // Recommendations
  if (categories.has('general') || categories.has('strategy') || categories.has('audit')) {
    try {
      const recSet = loadRecommendations(workspaceId);
      if (recSet?.recommendations?.length) {
        const active = recSet.recommendations.filter(r => r.status === 'pending' || r.status === 'in_progress');
        if (active.length > 0) {
          const recSummary = active.slice(0, 8).map(r => ({
            title: r.title, type: r.type, priority: r.priority, impact: r.impact, effort: r.effort,
          }));
          sections.push(`AI RECOMMENDATIONS (active/new):\n${JSON.stringify(recSummary, null, 1)}`);
          dataSources.push(`AI Recommendations (${active.length} active)`);
        }
      }
    } catch { /* non-critical */ }
  }

  // Client Health (churn signals via intelligence slice)
  if (categories.has('client') || categories.has('general')) {
    try {
      const cs = intel.clientSignals;
      if (cs) {
        const clientParts: string[] = [];
        if (cs.compositeHealthScore != null)
          clientParts.push(`Health score: ${cs.compositeHealthScore}/100`);
        if (cs.churnRisk)
          clientParts.push(`Churn risk: ${cs.churnRisk}`);
        if (cs.roi?.organicValue)
          clientParts.push(`Organic traffic value: $${cs.roi.organicValue.toFixed(0)}/mo`);
        if (cs.engagement?.loginFrequency)
          clientParts.push(`Portal activity: ${cs.engagement.loginFrequency}`);
        if (cs.churnSignals && cs.churnSignals.length > 0) {
          const signalLines = cs.churnSignals.slice(0, 5)
            .map(s => `  - [${s.severity}] ${s.type}: detected ${s.detectedAt?.slice(0, 10)}`);
          clientParts.push(`Churn signals:\n${signalLines.join('\n')}`);
        }
        if (clientParts.length > 0) {
          sections.push(`CLIENT HEALTH:\n${clientParts.join('\n')}`);
          dataSources.push('Client Health (composite score, churn risk, engagement, signals)');
        }
      }
    } catch { /* non-critical */ }
  }

  // Performance (via intelligence siteHealth slice)
  if (categories.has('performance') || categories.has('general')) {
    try {
      const health = intel.siteHealth;
      if (health) {
        const perfParts: string[] = [];
        if (health.performanceSummary?.score != null)
          perfParts.push(`Performance score: ${health.performanceSummary.score}/100`);
        if (health.performanceSummary?.avgLcp != null)
          perfParts.push(`LCP: ${health.performanceSummary.avgLcp.toFixed(1)}s`);
        if (health.performanceSummary?.avgCls != null)
          perfParts.push(`CLS: ${health.performanceSummary.avgCls.toFixed(2)}`);
        if (health.cwvPassRate.mobile != null)
          perfParts.push(`CWV pass rate: ${health.cwvPassRate.mobile}% mobile`);
        if (health.deadLinks > 0) perfParts.push(`Dead links: ${health.deadLinks}`);
        if (health.redirectChains > 0) perfParts.push(`Redirect chains: ${health.redirectChains}`);
        if (perfParts.length > 0) {
          sections.push(`SITE PERFORMANCE:\n${perfParts.join('\n')}`);
          dataSources.push('Site Performance (Core Web Vitals, PageSpeed, link health)');
        }
      }
    } catch { /* non-critical */ }
  }

  // ── Page-specific analysis results ──
  if (pageContext) {
    const scraped = results.get('pageScrape') as { title: string; metaDescription: string; headings: { level: number; text: string }[]; bodyText: string; wordCount: number } | null;
    if (scraped) {
      pageContext.scraped = scraped;
      sections.push(`PAGE CONTENT (scraped from ${pageContext.url}):\nTitle: ${scraped.title}\nMeta: ${scraped.metaDescription}\nWord count: ${scraped.wordCount}\nHeadings:\n${scraped.headings.map(h => `${'  '.repeat(h.level - 1)}H${h.level}: ${h.text}`).join('\n')}\nContent excerpt:\n${scraped.bodyText.slice(0, 2000)}`);
      dataSources.push('Live Page Content (scraped — title, meta, headings, body text)');
    }

    if (pageContext.auditIssues && (pageContext.auditIssues as unknown[]).length > 0) {
      sections.push(`PAGE AUDIT ISSUES for ${pageContext.url}:\n${JSON.stringify(pageContext.auditIssues, null, 1)}`);
      dataSources.push('Page-Specific Audit Issues');
    }

    if (pageContext.keywordContext) {
      sections.push(`PAGE KEYWORD TARGET:\n${pageContext.keywordContext}`);
      dataSources.push('Page-Specific Keyword Assignments');
    }
  }

  // ── Inject workspace learnings from intelligence layer ──
  if (intel.learnings?.summary) {
    const learningsBlock = formatLearningsForPrompt(intel.learnings.summary, 'all');
    if (learningsBlock) {
      sections.push(learningsBlock);
      dataSources.push('Workspace Outcome Learnings');
    }
  }

  return { sections, dataSources, mode, pageContext };
}

// ── System Prompt Builders ──

/**
 * Build the full system prompt for admin chat.
 */
export function buildSystemPrompt(
  ws: Workspace,
  assembled: AssembledContext,
  days: number,
  priorContext: string,
): string {
  if (assembled.mode === 'content_reviewer') {
    return buildContentReviewPrompt(ws, assembled, priorContext);
  }

  if (assembled.mode === 'page_reviewer') {
    return buildPageAnalysisPrompt(ws, assembled, days, priorContext);
  }

  return buildAnalystPrompt(ws, assembled, days, priorContext);
}

function buildAnalystPrompt(
  ws: Workspace,
  assembled: AssembledContext,
  days: number,
  priorContext: string,
): string {
  return `You are an expert internal analytics analyst for **${getBrandName(ws)}**. You're embedded in the admin dashboard of ${STUDIO_NAME}'s platform. The user is a team member managing this client's website — give them unfiltered, technical, data-driven analysis.

AVAILABLE DATA:
${assembled.dataSources.map(d => `• ${d}`).join('\n')}

${assembled.sections.join('\n\n')}
${priorContext}

YOUR ROLE:
1. **Deep technical analysis** — Cross-reference data sources to surface non-obvious insights. A page ranking #8 with high impressions + high bounce + no conversion tracking tells a multi-layered story.
2. **Actionable recommendations** — Be specific: "Rewrite the meta description for /services to include 'free consultation' — it has 2.4K impressions at 1.2% CTR" not "improve your CTR."
3. **Prioritize by ROI** — Time is limited. Lead with changes that have the biggest impact relative to effort.
4. **Flag risks** — Dropping rankings, rising bounce rates, audit score declining, stale content, content decay, churn signals — surface these proactively.
5. **Client communication suggestions** — When you spot something the client should know about, suggest how to frame it.
6. **Content pipeline awareness** — Reference active briefs, pending requests, and work orders when relevant.
7. **Remember context** — Use conversation history for coherent multi-turn analysis.

TONE:
- Direct, technical, no fluff — you're talking to a peer, not a client
- Use markdown: tables for comparisons, bold for emphasis, code blocks for URLs/paths
- Numbers first, narrative second
- 200-400 words unless the question demands more
${RICH_BLOCKS_PROMPT}
Site: ${getBrandName(ws)}
Date range: last ${days} days`;
}

function buildPageAnalysisPrompt(
  ws: Workspace,
  assembled: AssembledContext,
  days: number,
  priorContext: string,
): string {
  const pageUrl = assembled.pageContext?.url || 'unknown page';
  return `You are an expert SEO analyst reviewing a specific page on **${getBrandName(ws)}**: \`${pageUrl}\`

You have full context from the live page content, SEO audit results, search performance data, keyword strategy, and brand guidelines. Provide a thorough page-level analysis.

AVAILABLE DATA:
${assembled.dataSources.map(d => `• ${d}`).join('\n')}

${assembled.sections.join('\n\n')}
${priorContext}

YOUR ANALYSIS SHOULD COVER:
1. **Content Quality** — Is the content comprehensive, well-structured, and aligned with the target keyword? Check heading hierarchy, word count, and topic coverage.
2. **SEO Technical Issues** — What audit issues exist on this page? Prioritize by impact.
3. **Keyword Optimization** — Is the page properly targeting its assigned keyword? Are there cannibalization risks?
4. **Search Performance** — If GSC data is available, how is the page performing? What's the CTR opportunity?
5. **E-E-A-T Signals** — Does the page demonstrate Experience, Expertise, Authoritativeness, and Trust?
6. **Specific Rewrites** — Suggest concrete title tags, meta descriptions, H1s, or content additions with exact text.
7. **Quick Wins** — What can be fixed in under 30 minutes for immediate impact?

TONE:
- Direct, specific, actionable — give exact text suggestions, not vague advice
- Use markdown formatting for clarity
- Organize by priority (critical → important → nice-to-have)
${RICH_BLOCKS_PROMPT}
Site: ${getBrandName(ws)}
Date range: last ${days} days`;
}

function buildContentReviewPrompt(
  ws: Workspace,
  assembled: AssembledContext,
  priorContext: string,
): string {
  return `You are an expert content editor and SEO specialist reviewing a piece of content for **${getBrandName(ws)}**.

The user has pasted content (a draft, document, or text) for your review. Evaluate it against the brand's voice, keyword strategy, SEO best practices, and audience personas.

AVAILABLE CONTEXT:
${assembled.dataSources.map(d => `• ${d}`).join('\n')}

${assembled.sections.join('\n\n')}
${priorContext}

YOUR REVIEW SHOULD COVER:

1. **Brand Voice Alignment** — Does the content match the brand's tone, style, and voice guidelines? Be specific about what matches and what doesn't.
2. **SEO Optimization** — Evaluate keyword usage, heading structure, meta-worthiness, internal linking opportunities. If a target keyword is identifiable, assess optimization depth.
3. **Content Quality** — Readability, clarity, structure, flow. Flag jargon, weak openings, passive voice, or thin sections.
4. **E-E-A-T Signals** — Does the content demonstrate real experience and expertise? Suggest additions: data, examples, case studies, author credentials.
5. **Audience Fit** — Does this address the target personas' pain points, goals, and objections?
6. **Specific Improvements** — Don't just say "improve the intro." Rewrite it. Give exact replacement text for weak sections.
7. **Strengths** — Acknowledge what's working well. This helps the writer know what to keep.

OUTPUT FORMAT:
- Start with a brief overall assessment (1-2 sentences)
- Then organize feedback into clear sections
- Use ✅ for strengths and ⚠️ for improvements
- Include specific rewrite suggestions in blockquotes
- End with a prioritized action list

TONE:
- Constructive and specific — like a senior editor reviewing a draft
- Balance criticism with encouragement
- Every critique must come with a concrete fix
${RICH_BLOCKS_PROMPT}`;
}
