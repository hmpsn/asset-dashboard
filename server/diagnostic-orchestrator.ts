/**
 * Diagnostic Orchestrator — gathers data from existing infrastructure,
 * probes affected URLs, and synthesizes findings via AI into a diagnostic report.
 *
 * This is a thin orchestration layer, not a new data platform.
 * All data comes from existing modules: GSC, GA4, workspace-intelligence (backlinks),
 * redirect-scanner, plus the new diagnostic-probe.
 *
 * NOTE: Backlinks data is fetched via buildWorkspaceIntelligence (enrichWithBacklinks: true)
 * rather than calling getBacklinksOverview directly, to respect the caching + rate-limit
 * enforcement in workspace-intelligence.ts (pr-check rule).
 */

import { createLogger } from './logger.js';
import { getWorkspace } from './workspaces.js';
import { getPageTrend, getQueryPageData, getSearchPeriodComparison, getAllGscPages } from './search-console.js';
import { getGA4LandingPages } from './google-analytics.js';
import { scanRedirects } from './redirect-scanner.js';
import { resolveFullPageUrl } from './outcome-measurement.js';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { getInsights, stampDiagnosticReportId } from './analytics-insights-store.js';
import { callOpenAI } from './openai-helpers.js';
import { probeCanonical, countInternalLinks } from './diagnostic-probe.js';
import {
  completeDiagnosticReport,
  markDiagnosticFailed,
} from './diagnostic-store.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { addActivity } from './activity-log.js';
import { updateJob } from './jobs.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { rootCauseSchema, remediationActionSchema } from './schemas/diagnostics-schemas.js';
import type {
  DiagnosticContext,
  DiagnosticRequest,
  RootCause,
  RemediationAction,
  PositionHistoryPoint,
  QueryBreakdownEntry,
  RedirectProbeResult,
  InternalLinksResult,
  BacklinksResult,
  SiteBaselines,
  ActivityEntry,
  ConcurrentAnomaly,
  ExistingInsightSummary,
  PeriodComparisonResult,
} from '../shared/types/diagnostics.js';
import type { AnalyticsInsight, AnomalyDigestData } from '../shared/types/analytics.js';

const log = createLogger('diagnostic-orchestrator');

// ── Module Router ───────────────────────────────────────────────────

type DataModule =
  | 'positionHistory'
  | 'queryBreakdown'
  | 'periodComparison'
  | 'redirects'
  | 'canonical'
  | 'internalLinks'
  | 'backlinks';

const MODULE_ROUTER: Record<string, DataModule[]> = {
  traffic_drop: ['positionHistory', 'queryBreakdown', 'periodComparison', 'redirects', 'canonical', 'internalLinks', 'backlinks'],
  impressions_drop: ['positionHistory', 'periodComparison', 'redirects', 'canonical'],
  position_decline: ['positionHistory', 'internalLinks', 'backlinks'],
  ctr_drop: ['positionHistory', 'periodComparison'],
  bounce_spike: ['redirects', 'periodComparison'],
  audit_score_drop: ['redirects', 'canonical', 'internalLinks'],
  conversion_drop: ['periodComparison', 'redirects'],
};

// ── Credential Resolution ───────────────────────────────────────────

interface ResolvedCredentials {
  siteId: string | null;
  gscSiteUrl: string | null;
  ga4PropertyId: string | null;
  liveDomain: string | null;
}

function resolveCredentials(workspaceId: string): ResolvedCredentials {
  const ws = getWorkspace(workspaceId);
  return {
    siteId: ws?.webflowSiteId ?? null,
    gscSiteUrl: ws?.gscPropertyUrl ?? null,
    ga4PropertyId: ws?.ga4PropertyId ?? null,
    liveDomain: ws?.liveDomain ?? null,
  };
}

// ── Main Orchestrator ───────────────────────────────────────────────

export async function runDiagnostic(request: DiagnosticRequest, jobId: string): Promise<void> {
  const { workspaceId, insightId, reportId } = request;

  try {
    // 1. Resolve the anomaly insight to get anomaly data + affected pages
    const insights = getInsights(workspaceId);
    const anomalyInsight = insights.find((i) => i.id === insightId);
    if (!anomalyInsight) {
      markDiagnosticFailed(reportId, 'Anomaly insight not found');
      updateJob(jobId, { status: 'error', message: 'Anomaly insight not found' });
      return;
    }

    const anomalyData = anomalyInsight.data as unknown as AnomalyDigestData;
    const anomalyType = anomalyData.anomalyType;
    // NOTE: anomalyInsight.pageId is a synthetic dedup key (e.g. "anomaly:traffic_drop:clicks"),
    // not a real page path. Use anomalyData.affectedPage for the actual URL path.
    const affectedPagePath = anomalyData.affectedPage ?? null;

    // 2. Resolve credentials
    const creds = resolveCredentials(workspaceId);
    const modules = MODULE_ROUTER[anomalyType] ?? MODULE_ROUTER.traffic_drop;

    updateJob(jobId, { status: 'running', message: 'Gathering diagnostic data...' });

    // 3. Gather data in parallel
    const context = await gatherDiagnosticContext(
      workspaceId,
      anomalyInsight,
      anomalyData,
      affectedPagePath,
      creds,
      modules,
    );

    // 4. AI synthesis
    updateJob(jobId, { status: 'running', message: 'Analyzing findings...' });
    const synthesis = await synthesizeFindings(context, anomalyType);

    // 5. Save completed report
    completeDiagnosticReport(reportId, {
      diagnosticContext: context,
      rootCauses: synthesis.rootCauses,
      remediationActions: synthesis.remediationActions,
      adminReport: synthesis.adminReport,
      clientSummary: synthesis.clientSummary,
    });

    // 6. Stamp the anomaly insight with the reportId so client narrative enrichment picks it up
    try {
      stampDiagnosticReportId(workspaceId, insightId, reportId);
    } catch (stampErr) {
      log.warn({ err: stampErr }, 'Failed to stamp diagnosticReportId on insight — non-fatal');
    }

    // 7. Update job, broadcast, log activity
    updateJob(jobId, { status: 'done', message: 'Diagnostic complete', result: { reportId } });
    broadcastToWorkspace(workspaceId, WS_EVENTS.DIAGNOSTIC_COMPLETE, { reportId, insightId });
    try {
      addActivity(workspaceId, 'diagnostic_completed', `Deep diagnostic completed`,
        `Found ${synthesis.rootCauses.length} root cause(s), ${synthesis.remediationActions.length} remediation action(s)`);
    } catch (actErr) {
      log.warn({ err: actErr }, 'Failed to log diagnostic completion activity — non-fatal');
    }

    log.info({ workspaceId, reportId, rootCauses: synthesis.rootCauses.length }, 'Diagnostic completed');
  } catch (err) {
    log.error({ err, workspaceId, reportId }, 'Diagnostic orchestrator failed');
    markDiagnosticFailed(reportId, (err as Error).message);
    updateJob(jobId, { status: 'error', message: `Diagnostic failed: ${(err as Error).message}` });
    broadcastToWorkspace(workspaceId, WS_EVENTS.DIAGNOSTIC_FAILED, { reportId, insightId });
  }
}

// ── Data Gathering ──────────────────────────────────────────────────

async function gatherDiagnosticContext(
  workspaceId: string,
  insight: AnalyticsInsight,
  anomalyData: AnomalyDigestData,
  affectedPagePath: string | null,
  creds: ResolvedCredentials,
  modules: DataModule[],
): Promise<DiagnosticContext> {
  const unavailableSources: { source: string; reason: string }[] = [];
  const hasGsc = !!(creds.siteId && creds.gscSiteUrl);
  const hasGa4 = !!creds.ga4PropertyId;
  const hasDomain = !!creds.liveDomain;

  // Run all data modules in parallel
  const [
    positionHistory,
    queryBreakdown,
    periodComparison,
    redirectProbe,
    canonicalResult,
    internalLinks,
    intelligence,
  ] = await Promise.all([
    // Position history — GSC requires a full URL, not a bare pathname
    modules.includes('positionHistory') && hasGsc && affectedPagePath
      ? getPageTrend(creds.siteId!, creds.gscSiteUrl!, resolveFullPageUrl(affectedPagePath, { liveDomain: creds.liveDomain ?? undefined, gscPropertyUrl: creds.gscSiteUrl ?? undefined }), 90).catch((e) => {
          log.warn({ err: e }, 'Position history fetch failed');
          unavailableSources.push({ source: 'positionHistory', reason: (e as Error).message });
          return [] as PositionHistoryPoint[];
        })
      : ((!hasGsc && modules.includes('positionHistory'))
          ? (unavailableSources.push({ source: 'positionHistory', reason: 'GSC not configured' }), Promise.resolve([]))
          : Promise.resolve([])),

    // Query breakdown
    modules.includes('queryBreakdown') && hasGsc
      ? getQueryPageData(creds.siteId!, creds.gscSiteUrl!, 90, { maxRows: 500 }).catch((e) => {
          log.warn({ err: e }, 'Query breakdown fetch failed');
          unavailableSources.push({ source: 'queryBreakdown', reason: (e as Error).message });
          return [];
        })
      : ((!hasGsc && modules.includes('queryBreakdown'))
          ? (unavailableSources.push({ source: 'queryBreakdown', reason: 'GSC not configured' }), Promise.resolve([]))
          : Promise.resolve([])),

    // Period comparison
    modules.includes('periodComparison') && hasGsc
      ? getSearchPeriodComparison(creds.siteId!, creds.gscSiteUrl!, 28).catch((e) => {
          log.warn({ err: e }, 'Period comparison fetch failed');
          unavailableSources.push({ source: 'periodComparison', reason: (e as Error).message });
          return null;
        })
      : ((!hasGsc && modules.includes('periodComparison'))
          ? (unavailableSources.push({ source: 'periodComparison', reason: 'GSC not configured' }), Promise.resolve(null))
          : Promise.resolve(null)),

    // Redirect scan
    modules.includes('redirects') && creds.siteId
      ? scanRedirects(creds.siteId, workspaceId, creds.liveDomain ?? undefined).catch((e) => {
          log.warn({ err: e }, 'Redirect scan failed');
          unavailableSources.push({ source: 'redirects', reason: (e as Error).message });
          return null;
        })
      : Promise.resolve(null),

    // Canonical probe
    modules.includes('canonical') && affectedPagePath && hasDomain
      ? probeCanonical(`${creds.liveDomain}${affectedPagePath}`).catch((e) => {
          log.warn({ err: e }, 'Canonical probe failed');
          unavailableSources.push({ source: 'canonical', reason: (e as Error).message });
          return null;
        })
      : Promise.resolve(null),

    // Internal link counting
    modules.includes('internalLinks') && affectedPagePath && hasDomain && (hasGa4 || (hasGsc && creds.gscSiteUrl))
      ? (async () => {
          try {
            let crawlUrls: string[] = [];

            if (hasGa4) {
              // Preferred: GA4 landing pages give engagement-weighted crawl targets
              const topPages = await getGA4LandingPages(creds.ga4PropertyId!, 28, 20).catch(() => []);
              crawlUrls = topPages.map((p) => `${creds.liveDomain}${p.landingPage}`);
            } else if (creds.gscSiteUrl) {
              // Fallback: GSC top pages by clicks when no GA4 is connected
              const gscPages = await getAllGscPages(creds.siteId!, creds.gscSiteUrl, 28).catch(() => []);
              crawlUrls = gscPages
                .sort((a, b) => b.clicks - a.clicks)
                .slice(0, 20)
                .map((p) => `${creds.liveDomain}${new URL(p.page).pathname}`);
            }

            if (crawlUrls.length === 0) return { count: 0, siteMedian: 0, topLinkingPages: [], deficit: 0 };
            return countInternalLinks(affectedPagePath, crawlUrls, creds.liveDomain!);
          } catch (e) {
            log.warn({ err: e }, 'Internal link counting failed');
            unavailableSources.push({ source: 'internalLinks', reason: (e as Error).message });
            return { count: 0, siteMedian: 0, topLinkingPages: [], deficit: 0 };
          }
        })()
      : (modules.includes('internalLinks')
          ? (unavailableSources.push({
              source: 'internalLinks',
              reason: !affectedPagePath ? 'No affected page identified' : !hasDomain ? 'Live domain not configured' : 'Neither GA4 nor GSC configured',
            }), Promise.resolve({ count: 0, siteMedian: 0, topLinkingPages: [], deficit: 0 }))
          : Promise.resolve({ count: 0, siteMedian: 0, topLinkingPages: [], deficit: 0 })),

    // Intelligence (existing insights, baselines, and backlink profile via enrichWithBacklinks)
    buildWorkspaceIntelligence(workspaceId, { // bwi-all-ok: diagnostics needs seoContext (baselines, backlinks) + operational
      pagePath: affectedPagePath ?? undefined,
      enrichWithBacklinks: modules.includes('backlinks'),
    }).catch((e) => {
      log.warn({ err: e }, 'Intelligence assembly failed');
      return null;
    }),
  ]);

  // Filter query breakdown to affected page
  const filteredQueries: QueryBreakdownEntry[] = affectedPagePath
    ? (queryBreakdown as Array<{ query: string; page: string; clicks: number; impressions: number; position: number }>)
        .filter((q) => q.page?.includes(affectedPagePath))
        .slice(0, 30)
        .map((q) => ({
          query: q.query,
          currentClicks: q.clicks,
          previousClicks: 0,
          currentPosition: q.position,
          previousPosition: 0,
          impressionChange: 0,
        }))
    : [];

  // Build redirect probe result from scan
  // RedirectHop has { url, status } only — no location field
  const redirectResult: RedirectProbeResult = (() => {
    if (!redirectProbe || !affectedPagePath) {
      return { chain: [], finalStatus: 200, canonical: canonicalResult?.canonical ?? null, isSoftFourOhFour: false };
    }
    const affectedChain = redirectProbe.chains?.find((c) => c.originalUrl?.includes(affectedPagePath));
    if (!affectedChain) {
      return { chain: [], finalStatus: 200, canonical: canonicalResult?.canonical ?? null, isSoftFourOhFour: false };
    }
    const lastHop = affectedChain.hops?.[affectedChain.hops.length - 1];
    const finalUrl = affectedChain.finalUrl ?? '';
    const isSoftFourOhFour =
      // Redirected to homepage (root or locale variants)
      finalUrl === '/' ||
      finalUrl.match(/^\/[a-z]{2}\/?$/) !== null ||         // /en, /fr/, /de
      finalUrl.endsWith('.com/') ||
      finalUrl.endsWith('.com') ||
      // Redirected to a dedicated error page
      finalUrl === '/404' ||
      finalUrl === '/not-found' ||
      finalUrl === '/error' ||
      finalUrl.startsWith('/404') ||
      finalUrl.startsWith('/not-found') ||
      finalUrl.includes('/404.');                          // /404.html
      // Title-based heuristic is not available here (HTML not re-fetched),
      // but these path patterns cover the overwhelming majority of soft 404s.
    return {
      chain: affectedChain.hops?.map((h) => ({ url: h.url, status: h.status, location: null })) ?? [],
      finalStatus: lastHop?.status ?? 200,
      canonical: canonicalResult?.canonical ?? null,
      isSoftFourOhFour,
    };
  })();

  // Backlinks from intelligence backlinkProfile
  const backlinkProfile = intelligence?.seoContext?.backlinkProfile;
  const backlinks: BacklinksResult = {
    totalBacklinks: backlinkProfile?.totalBacklinks ?? 0,
    referringDomains: backlinkProfile?.referringDomains ?? 0,
    topDomains: [], // not available in intelligence slice
    recentlyLost: 0,
  };
  if (modules.includes('backlinks') && !backlinkProfile) {
    unavailableSources.push({ source: 'backlinks', reason: 'Backlink profile not available in intelligence' });
  }

  // Site baselines from intelligence
  const siteBaselines: SiteBaselines = {
    avgInternalLinks: (internalLinks as InternalLinksResult).siteMedian,
    medianPosition: intelligence?.seoContext?.rankTracking?.avgPosition ?? 0,
    totalBacklinks: backlinkProfile?.totalBacklinks ?? 0,
  };

  // Recent activity from intelligence
  const recentActivity: ActivityEntry[] = (intelligence?.operational?.recentActivity ?? [])
    .slice(0, 20)
    .map((a: { date?: string; createdAt?: string; type?: string; action?: string; title?: string; description?: string; details?: string }) => ({
      date: a.date ?? a.createdAt ?? '',
      action: a.type ?? a.action ?? '',
      details: a.title ?? a.description ?? a.details ?? '',
    }));

  // Concurrent anomalies
  const allInsights = getInsights(workspaceId);
  const concurrentAnomalies: ConcurrentAnomaly[] = allInsights
    .filter((i) => i.insightType === 'anomaly_digest' && i.id !== insight.id)
    .slice(0, 10)
    .map((i) => ({
      type: (i.data as unknown as AnomalyDigestData).anomalyType ?? 'unknown',
      page: i.pageId ?? 'site-level',
      severity: i.severity,
    }));

  // Existing insights for affected page
  const existingInsights: ExistingInsightSummary[] = allInsights
    .filter((i) => i.pageId === affectedPagePath && i.insightType !== 'anomaly_digest')
    .slice(0, 10)
    .map((i) => ({
      type: i.insightType,
      severity: i.severity,
      summary: i.pageTitle ?? i.insightType,
    }));

  // Period comparison
  type PeriodComparisonLike = {
    current: { clicks: number; impressions: number; ctr: number; position: number };
    previous: { clicks: number; impressions: number; ctr: number; position: number };
    changePercent: { clicks: number; impressions: number; ctr: number; position: number };
  };
  const emptyPeriod = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const periodCompResult: PeriodComparisonResult = periodComparison
    ? {
        current: (periodComparison as PeriodComparisonLike).current,
        previous: (periodComparison as PeriodComparisonLike).previous,
        changePercent: (periodComparison as PeriodComparisonLike).changePercent,
      }
    : { current: emptyPeriod, previous: emptyPeriod, changePercent: emptyPeriod };

  return {
    anomaly: {
      type: anomalyData.anomalyType,
      severity: anomalyData.severity,
      metric: anomalyData.metric,
      currentValue: anomalyData.currentValue,
      expectedValue: anomalyData.expectedValue,
      deviationPercent: anomalyData.deviationPercent,
      firstDetected: anomalyData.firstDetected,
    },
    positionHistory: (positionHistory as PositionHistoryPoint[]).slice(-90),
    queryBreakdown: filteredQueries,
    redirectProbe: redirectResult,
    internalLinks: internalLinks as InternalLinksResult,
    backlinks,
    siteBaselines,
    recentActivity,
    concurrentAnomalies,
    existingInsights,
    periodComparison: periodCompResult,
    unavailableSources,
  };
}

// ── AI Synthesis ────────────────────────────────────────────────────

interface SynthesisResult {
  rootCauses: RootCause[];
  remediationActions: RemediationAction[];
  adminReport: string;
  clientSummary: string;
}

async function synthesizeFindings(context: DiagnosticContext, anomalyType: string): Promise<SynthesisResult> {
  const systemPrompt = `You are an expert SEO diagnostician. You are given structured data from a deep investigation into why a website page experienced a significant anomaly (${anomalyType}). Your job is to:

1. Identify the most likely root causes, ranked by confidence
2. Propose specific remediation actions with priorities (P0 = ship this week, P1 = this sprint, P2 = backlog, P3 = nice to have)
3. Write a technical admin report in markdown
4. Write a semi-technical client summary (2-3 sentences, no dev jargon)

Respond with ONLY valid JSON matching this exact schema:
{
  "rootCauses": [{ "rank": 1, "title": "string", "confidence": "high|medium|low", "explanation": "string", "evidence": ["string"] }],
  "remediationActions": [{ "priority": "P0|P1|P2|P3", "title": "string", "description": "string", "effort": "low|medium|high", "impact": "high|medium|low", "owner": "dev|content|seo", "pageUrls": ["string"] }],
  "adminReport": "markdown string with sections: ## Executive Summary, ## Root Causes, ## Evidence, ## Remediation Plan",
  "clientSummary": "2-3 sentence semi-technical summary. Explain what happened, why, and what is being done. No redirect codes, no dev jargon. Frame as: your team identified the issue and is fixing it."
}

Rules for root causes:
- Use the evidence from ALL data sources — position history, query breakdown, redirect chains, internal links, backlinks, recent activity
- Compare page data against site baselines to spot anomalies
- Look for temporal correlation between recent activity and the anomaly's first detected date
- If concurrent anomalies exist, check for patterns (same URL path prefix, same anomaly type)
- High confidence = multiple evidence sources converge on the same cause
- If data is unavailable for a source, note it but don't let it prevent a diagnosis

Rules for remediation:
- Each action must have exactly one owner: dev, content, or seo
- P0 actions should be things that can be done in < 1 day
- Include specific page URLs when relevant
- Order by priority then impact`;

  const result = await callOpenAI({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(context) },
    ],
    maxTokens: 3000,
    temperature: 0.3,
    responseFormat: { type: 'json_object' },
    feature: 'deep-diagnostics',
  });

  try {
    const parsed = JSON.parse(result.text) as { rootCauses?: unknown; remediationActions?: unknown; adminReport?: unknown; clientSummary?: unknown };
    const rootCauses = parseJsonSafeArray(JSON.stringify(parsed.rootCauses ?? []), rootCauseSchema, { field: 'rootCauses', table: 'diagnostic:synthesis' });
    const remediationActions = parseJsonSafeArray(JSON.stringify(parsed.remediationActions ?? []), remediationActionSchema, { field: 'remediationActions', table: 'diagnostic:synthesis' });
    const adminReport = typeof parsed.adminReport === 'string' ? parsed.adminReport : '';
    const clientSummary = typeof parsed.clientSummary === 'string' ? parsed.clientSummary : '';
    if (rootCauses.length === 0 && remediationActions.length === 0 && !adminReport) {
      throw new Error('AI synthesis returned empty result');
    }
    return { rootCauses, remediationActions, adminReport, clientSummary };
  } catch (err) {
    log.error({ err, preview: result.text.slice(0, 200) }, 'Failed to parse AI synthesis');
    return {
      rootCauses: [{ rank: 1, title: 'Analysis inconclusive', confidence: 'low', explanation: 'The AI synthesis failed to produce structured output. Manual investigation recommended.', evidence: [] }],
      remediationActions: [],
      adminReport: '## Analysis Inconclusive\n\nThe AI synthesis step failed. Please review the raw diagnostic context for manual analysis.',
      clientSummary: 'We detected a significant change in your site performance and are investigating. Your team will follow up with specific findings.',
    };
  }
}
