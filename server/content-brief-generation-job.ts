import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { generateBrief, updateBrief } from './content-brief.js';
import { collectBriefEnrichment, deriveStylePageUrls } from './content-brief-scrape-enrichment.js';
import type { BriefScrapeEnrichment } from './content-brief-scrape-enrichment.js';
import { resolveBriefTemplateCrossref, toBriefPageType } from './content-brief-template-crossref.js';
import { getAllSitePages } from './content-site-pages.js';
import { getContentRequest, updateContentRequest } from './content-requests.js';
import { loadDecayAnalysis } from './content-decay.js';
import { isProgrammingError } from './errors.js';
import { getGA4LandingPages } from './google-analytics.js';
import { normalizePageUrl } from './utils/page-address.js';
import { sanitizeQueryForPrompt } from './utils/text.js';
import { invalidateContentPipelineIntelligence } from './intelligence-freshness.js';
import { createJob, updateJob } from './jobs.js';
import { createLogger } from './logger.js';
import { resolveWorkspaceLocationCode } from './local-seo.js';
import { recordAction } from './outcome-tracking.js';
import { getQueryPageData } from './search-console.js';
import { getConfiguredProvider, getProviderDisplayName } from './seo-data-provider.js';
import type { KeywordMetrics, RelatedKeyword } from './seo-data-provider.js';
import { getWorkspace } from './workspaces.js';
import { getSearchOverview } from './search-console.js';
import { WS_EVENTS } from './ws-events.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import type { BriefJourneyStage, BriefSourceEvidence, ContentBrief, ContentGenerationStyle, StrategyCardContext } from '../shared/types/content.js';

const log = createLogger('content-brief-generation-job');

export interface StandaloneContentBriefGenerationParams {
  source: 'standalone';
  workspaceId: string;
  targetKeyword: string;
  businessContext?: string;
  pageType?: string;
  referenceUrls?: string[];
  pageAnalysisContext?: {
    optimizationScore?: number;
    optimizationIssues?: string[];
    recommendations?: string[];
    contentGaps?: string[];
    searchIntent?: string;
    // Brief pre-seed fields from Content Gaps / strategy layer (Lane E)
    rationale?: string;
    competitorProof?: string;
    volume?: number;
    intent?: string;
    questionKeywords?: string[];
    serpFeatures?: string[];
  };
  generationStyle?: ContentGenerationStyle;
  /** W2.5 Bug 1 fix: Page Intelligence "Draft Brief" flow — the page being refreshed/updated */
  targetPageId?: string;
  /** W2.5 Bug 1 fix: Slug of the target page for decay-query context injection */
  targetPageSlug?: string;
}

export interface RequestContentBriefGenerationParams {
  source: 'request';
  workspaceId: string;
  requestId: string;
  generationStyle?: ContentGenerationStyle;
}

export type ContentBriefGenerationParams =
  | StandaloneContentBriefGenerationParams
  | RequestContentBriefGenerationParams;

export interface StartedContentBriefGenerationJob {
  jobId: string;
}

function notifyContentUpdated(workspaceId: string, payload: Record<string, unknown>) {
  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, { domain: 'content-briefs', ...payload });
}

/**
 * C4 (audit #16): map C1's enrichment output to the persisted source-evidence blob.
 * Consumes `BriefScrapeEnrichment` directly — the helper's exported interface is the
 * contract (see server/content-brief-scrape-enrichment.ts header); do not re-derive.
 * Returns null when the scrape fully degraded (C1's FM-2 posture) so the column
 * stays NULL instead of storing an empty pack.
 */
function buildBriefSourceEvidence(enrichment: BriefScrapeEnrichment): BriefSourceEvidence | null {
  const { scrapedRefs, serpData, stylePages } = enrichment;
  if (scrapedRefs.length === 0 && !serpData && stylePages.length === 0) return null;
  return {
    scrapedReferences: scrapedRefs.length > 0 ? scrapedRefs : undefined,
    serpResults: serpData && serpData.organicResults.length > 0
      ? serpData.organicResults.map(r => ({ position: r.position, title: r.title, url: r.url, snippet: r.snippet }))
      : undefined,
    serpFetchedAt: serpData?.fetchedAt,
    styleExamples: stylePages.length > 0 ? stylePages : undefined,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Persist the scraped source text on the freshly generated brief row.
 * Runs before the brief_generated broadcast in both job paths so the existing
 * CONTENT_UPDATED event covers the write. Returns the updated brief when
 * evidence was attached, otherwise the original.
 */
function persistBriefSourceEvidence(
  workspaceId: string,
  brief: ContentBrief,
  enrichment: BriefScrapeEnrichment,
): ContentBrief {
  const sourceEvidence = buildBriefSourceEvidence(enrichment);
  if (!sourceEvidence) return brief;
  const updated = updateBrief(workspaceId, brief.id, { sourceEvidence });
  return updated ?? brief;
}

function deriveJourneyStage(intent?: string): BriefJourneyStage | undefined {
  if (!intent) return undefined;
  const lower = intent.toLowerCase();
  if (lower === 'informational') return 'awareness';
  if (lower === 'commercial') return 'consideration';
  if (lower === 'transactional') return 'decision';
  return undefined;
}

async function generateStandaloneBrief(params: StandaloneContentBriefGenerationParams): Promise<ContentBrief> {
  // Page resolution is slug-only by design. `params.targetPageId` (a Webflow page ID)
  // is threaded through from the route but NOT consumed here: the decay-context lookup
  // below matches against `decay.decayingPages[].page`, which is a normalized URL/slug,
  // and `getAllSitePages` returns bare URL strings (no id→slug map). Resolving the page
  // ID to a slug would require an extra Webflow API fetch — not worth it when the slug
  // the caller already supplies is the exact key the decay analysis is indexed by.
  const { workspaceId, targetKeyword, businessContext, pageType, referenceUrls, pageAnalysisContext, generationStyle, targetPageSlug } = params;
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');
  const templateCrossref = resolveBriefTemplateCrossref(workspaceId, targetKeyword);

  let relatedQueries: { query: string; position: number; clicks: number; impressions: number }[] = [];
  if (ws.gscPropertyUrl && ws.webflowSiteId) {
    try {
      const overview = await getSearchOverview(ws.webflowSiteId, ws.gscPropertyUrl, 28);
      relatedQueries = overview.topQueries
        .filter(q => {
          const ql = q.query.toLowerCase();
          return targetKeyword.toLowerCase().split(' ').some((w: string) => w.length > 2 && ql.includes(w));
        })
        .slice(0, 20);
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'Standalone brief GSC enrichment failed');
    }
  }

  const existingPages = await getAllSitePages(ws);

  let keywordMetrics: KeywordMetrics | undefined;
  let relatedKeywords: RelatedKeyword[] | undefined;
  const seoProvider = getConfiguredProvider(ws.seoDataProvider);
  const providerLabel = seoProvider ? getProviderDisplayName(seoProvider.name) : 'DataForSEO';
  if (seoProvider) {
    try {
      const locationCode = resolveWorkspaceLocationCode(workspaceId) ?? undefined;
      const [metrics, related] = await Promise.all([
        seoProvider.getKeywordMetrics([targetKeyword], workspaceId, undefined, locationCode),
        seoProvider.getRelatedKeywords(targetKeyword, workspaceId, 15),
      ]);
      if (metrics.length > 0) keywordMetrics = metrics[0];
      if (related.length > 0) relatedKeywords = related;
    } catch (err) {
      log.error({ err, workspaceId, targetKeyword }, 'SEO keyword enrichment error');
    }
  }

  const refUrlList = Array.isArray(referenceUrls)
    ? referenceUrls.filter((u): u is string => typeof u === 'string' && u.startsWith('http')).slice(0, 5)
    : [];

  const topPageUrls: string[] = [];
  let ga4Performance: { landingPage: string; sessions: number; users: number; bounceRate: number; avgEngagementTime: number; conversions: number }[] = [];
  if (ws.ga4PropertyId) {
    try {
      const pages = await getGA4LandingPages(ws.ga4PropertyId, 28, 25);
      ga4Performance = pages.slice(0, 10);
      topPageUrls.push(...deriveStylePageUrls(pages, ws.liveDomain));
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'Standalone brief GA4 enrichment failed');
    }
  }

  const { scrapedRefs, serpData, stylePages } = await collectBriefEnrichment({
    targetKeyword,
    referenceUrls: refUrlList,
    stylePageUrls: topPageUrls,
  });

  const resolvedPageType = toBriefPageType(pageType) ?? templateCrossref?.pageType ?? undefined;

  // W2.5 Bug 1 fix: inject decay-query context when a targetPageSlug is provided
  // (mirrors the same block in generateBriefForRequest at the request-path).
  let standaloneDecayQueryContext: string | undefined;
  if (targetPageSlug && ws.gscPropertyUrl && ws.webflowSiteId) {
    try {
      const decay = loadDecayAnalysis(workspaceId);
      const normalizeTarget = normalizePageUrl(targetPageSlug);
      const decayPage = decay?.decayingPages.find(dp => dp.page === normalizeTarget);
      if (decayPage) {
        const qpRows = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90, { maxRows: 500 });
        const pageQueries = qpRows
          .filter(r => normalizePageUrl(r.page) === decayPage.page)
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 15);
        if (pageQueries.length > 0) {
          standaloneDecayQueryContext =
            `DECAY CONTEXT: This page has lost ${Math.abs(decayPage.clickDeclinePct)}% of search clicks. Top queries:\n` +
            pageQueries.map(q => `- "${sanitizeQueryForPrompt(q.query)}": ${q.clicks} clicks, ${q.impressions} impressions, pos ${q.position.toFixed(1)}`).join('\n');
        }
      }
    } catch (err) {
      log.debug({ err }, 'Standalone decay query context enrichment failed — continuing without it');
    }
  }

  let brief = await generateBrief(workspaceId, targetKeyword, {
    relatedQueries,
    businessContext: businessContext || ws.keywordStrategy?.businessContext,
    existingPages,
    keywordMetrics,
    relatedKeywords,
    providerLabel,
    pageType: resolvedPageType,
    templateId: templateCrossref?.templateId,
    templateSections: templateCrossref?.sections.map(section => ({
      name: section.name,
      headingTemplate: section.headingTemplate,
      guidance: section.guidance,
      wordCountTarget: section.wordCountTarget,
    })),
    templateToneOverride: templateCrossref?.toneAndStyle,
    templateTitlePattern: templateCrossref?.titlePattern,
    templateMetaDescPattern: templateCrossref?.metaDescPattern,
    keywordLocked: templateCrossref ? true : undefined,
    keywordSource: templateCrossref ? 'template' : undefined,
    generationStyle,
    referenceUrls: refUrlList.length > 0 ? refUrlList : undefined,
    scrapedReferences: scrapedRefs.length > 0 ? scrapedRefs : undefined,
    serpData: serpData ? { peopleAlsoAsk: serpData.peopleAlsoAsk, organicResults: serpData.organicResults } : undefined,
    ga4PagePerformance: ga4Performance.length > 0 ? ga4Performance : undefined,
    styleExamples: stylePages.length > 0 ? stylePages : undefined,
    pageAnalysisContext,
    decayQueryContext: standaloneDecayQueryContext,
  });

  // C4: persist the scraped source text (bodyText, SERP snippets, fetch timestamps)
  // before the brief_generated broadcast below covers the write.
  brief = persistBriefSourceEvidence(workspaceId, brief, { scrapedRefs, serpData, stylePages });

  try {
    recordAction({ // recordAction-ok — workspaceId is validated before job creation
      workspaceId,
      actionType: 'brief_created',
      sourceType: 'brief',
      sourceId: brief.id,
      pageUrl: null,
      targetKeyword,
      baselineSnapshot: {
        captured_at: new Date().toISOString(),
      },
      attribution: 'platform_executed',
      // R6 (B11): the brief's suggested title is its identity — snapshot it so the win
      // title survives brief edits/regeneration. Guarded on a real title (FM-2).
      ...(brief.suggestedTitle?.trim()
        ? { source: { label: brief.suggestedTitle.trim(), snapshot: { title: brief.suggestedTitle.trim(), type: 'brief' } } }
        : {}),
    });
  } catch (err) {
    log.warn({ err, keyword: targetKeyword }, 'Failed to record outcome action for brief creation');
  }

  addActivity(
    workspaceId,
    'brief_generated',
    `Generated content brief for "${brief.targetKeyword}"`,
    brief.suggestedTitle,
    { briefId: brief.id, action: 'brief_generated' },
  );
  notifyContentUpdated(workspaceId, { briefId: brief.id, action: 'brief_generated' });
  return brief;
}

async function generateBriefForRequest(params: RequestContentBriefGenerationParams): Promise<ContentBrief> {
  const { workspaceId, requestId, generationStyle } = params;
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');
  const request = getContentRequest(workspaceId, requestId);
  if (!request) throw new Error('Request not found');

  let relatedQueries: { query: string; position: number; clicks: number; impressions: number }[] = [];
  let cachedGscRows: Awaited<ReturnType<typeof getQueryPageData>> | null = null;
  if (ws.gscPropertyUrl && ws.webflowSiteId) {
    try {
      cachedGscRows = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90);
      relatedQueries = cachedGscRows
        .filter(r => {
          const q = r.query.toLowerCase();
          return request.targetKeyword.toLowerCase().split(' ').some(w => w.length > 2 && q.includes(w));
        })
        .slice(0, 20)
        .map(r => ({ query: sanitizeQueryForPrompt(r.query), position: r.position, clicks: r.clicks, impressions: r.impressions }));
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'Request brief GSC enrichment failed');
    }
  }

  let keywordMetrics: KeywordMetrics | undefined;
  let relatedKeywords: RelatedKeyword[] | undefined;
  const seoProvider = getConfiguredProvider(ws.seoDataProvider);
  const providerLabel = seoProvider ? getProviderDisplayName(seoProvider.name) : 'DataForSEO';
  if (seoProvider) {
    try {
      const locationCode = resolveWorkspaceLocationCode(workspaceId) ?? undefined;
      const [metrics, related] = await Promise.all([
        seoProvider.getKeywordMetrics([request.targetKeyword], workspaceId, undefined, locationCode),
        seoProvider.getRelatedKeywords(request.targetKeyword, workspaceId, 15),
      ]);
      if (metrics.length > 0) keywordMetrics = metrics[0];
      if (related.length > 0) relatedKeywords = related;
    } catch (err) {
      log.error({ err, workspaceId, requestId }, 'SEO keyword enrichment error');
    }
  }

  let ga4PagePerformance: { landingPage: string; sessions: number; users: number; bounceRate: number; avgEngagementTime: number; conversions: number }[] | undefined;
  const topPageUrls: string[] = [];
  if (ws.ga4PropertyId) {
    try {
      const pages = await getGA4LandingPages(ws.ga4PropertyId, 28, 25);
      if (pages.length > 0) ga4PagePerformance = pages;
      topPageUrls.push(...deriveStylePageUrls(pages, ws.liveDomain));
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'Request brief GA4 enrichment failed');
    }
  }

  const { scrapedRefs, serpData, stylePages } = await collectBriefEnrichment({
    targetKeyword: request.targetKeyword,
    // No client-supplied reference URLs on the request path (content_requests
    // schema has no reference_urls column). SERP + GA4 style-pages provide the
    // evidence context. C4 may add reference URL persistence later.
    stylePageUrls: topPageUrls,
  });

  const existingPages = await getAllSitePages(ws);
  const requestEnrichment: BriefScrapeEnrichment = { scrapedRefs, serpData, stylePages };
  const strategyCardContext: StrategyCardContext = {
    rationale: request.rationale,
    intent: request.intent,
    priority: request.priority,
    journeyStage: deriveJourneyStage(request.intent),
  };

  let decayQueryContext: string | undefined;
  if (request.targetPageSlug) {
    try {
      const decay = loadDecayAnalysis(workspaceId);
      const normalizeTarget = normalizePageUrl(request.targetPageSlug);
      const decayPage = decay?.decayingPages.find(dp => dp.page === normalizeTarget);
      if (decayPage && ws.gscPropertyUrl && ws.webflowSiteId) {
        const qpRows = cachedGscRows ?? await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90, { maxRows: 500 });
        const pageQueries = qpRows
          .filter(r => normalizePageUrl(r.page) === decayPage.page)
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 15);
        if (pageQueries.length > 0) {
          decayQueryContext = `DECAY CONTEXT: This page has lost ${Math.abs(decayPage.clickDeclinePct)}% of search clicks. Top queries:\n` +
            pageQueries.map(q => `- "${sanitizeQueryForPrompt(q.query)}": ${q.clicks} clicks, ${q.impressions} impressions, pos ${q.position.toFixed(1)}`).join('\n');
        }
      }
    } catch (err) {
      log.debug({ err }, 'Decay query context enrichment failed — continuing without it');
    }
  }

  let brief = await generateBrief(workspaceId, request.targetKeyword, {
    relatedQueries,
    businessContext: ws.keywordStrategy?.businessContext || '',
    existingPages,
    keywordMetrics,
    relatedKeywords,
    providerLabel,
    pageType: request.pageType || 'blog',
    ga4PagePerformance,
    strategyCardContext,
    decayQueryContext,
    generationStyle,
    scrapedReferences: scrapedRefs.length > 0 ? scrapedRefs : undefined,
    serpData: serpData ? { peopleAlsoAsk: serpData.peopleAlsoAsk, organicResults: serpData.organicResults } : undefined,
    styleExamples: stylePages.length > 0 ? stylePages : undefined,
  });

  // C4: persist scraped source text before the broadcasts below cover the write.
  brief = persistBriefSourceEvidence(workspaceId, brief, requestEnrichment);

  updateContentRequest(workspaceId, requestId, {
    status: 'brief_generated',
    briefId: brief.id,
  });

  try {
    recordAction({ // recordAction-ok — workspaceId is validated before job creation
      workspaceId,
      actionType: 'brief_created',
      sourceType: 'content_request',
      sourceId: brief.id,
      pageUrl: null,
      targetKeyword: request.targetKeyword,
      baselineSnapshot: {
        captured_at: new Date().toISOString(),
      },
      attribution: 'platform_executed',
      // R6 (B11): the brief generated for this request carries the display identity —
      // snapshot its suggested title. Guarded on a real title (FM-2).
      ...(brief.suggestedTitle?.trim()
        ? { source: { label: brief.suggestedTitle.trim(), snapshot: { title: brief.suggestedTitle.trim(), type: 'content_request' } } }
        : {}),
    });
  } catch (err) {
    log.warn({ err, keyword: request.targetKeyword }, 'Failed to record outcome action for request brief creation');
  }

  broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: request.id, status: 'brief_generated' });
  addActivity(workspaceId, 'brief_generated', `Content brief generated for "${request.targetKeyword}"`, `Title: ${brief.suggestedTitle}`, { requestId: request.id, briefId: brief.id });
  notifyContentUpdated(workspaceId, { briefId: brief.id, requestId: request.id, action: 'request_brief_generated' });
  return brief;
}

export async function runContentBriefGenerationJob(jobId: string, params: ContentBriefGenerationParams): Promise<void> {
  try {
    updateJob(jobId, { status: 'running', progress: 0, total: 1, message: 'Generating content brief...' });
    const brief = params.source === 'request'
      ? await generateBriefForRequest(params)
      : await generateStandaloneBrief(params);
    updateJob(jobId, {
      status: 'done',
      progress: 1,
      total: 1,
      result: {
        brief,
        briefId: brief.id,
        requestId: params.source === 'request' ? params.requestId : undefined,
      },
      message: `Brief generated — ${brief.suggestedTitle || brief.targetKeyword}`,
    });
  } catch (err) {
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'Content brief generation failed',
    });
  }
}

export function startContentBriefGenerationJob(params: ContentBriefGenerationParams): StartedContentBriefGenerationJob {
  const label = params.source === 'request'
    ? getContentRequest(params.workspaceId, params.requestId)?.targetKeyword ?? 'client request'
    : params.targetKeyword;
  const job = createJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, {
    workspaceId: params.workspaceId,
    total: 1,
    message: `Generating brief for ${label}...`,
  });
  setTimeout(() => {
    void runContentBriefGenerationJob(job.id, params);
  }, 100);
  return { jobId: job.id };
}
