/**
 * content-briefs routes — extracted from server/index.ts
 *
 * @reads content_briefs, content_requests, search_console, seo_provider, workspaces, analytics_insights, workspace_learnings, feature_flags, content_matrices, content_templates
 * @writes content_briefs, content_requests, outcome_actions, activities
 */
import { Router } from 'express';

import { renderBriefHTML } from '../brief-export-html.js';
import { requireWorkspaceAccess } from '../auth.js';
import {
  eeatGuidanceSchema,
  keywordValidationSchema,
  outlineItemSchema,
  realTopResultSchema,
  schemaRecommendationSchema,
  serpAnalysisSchema,
} from '../schemas/content-schemas.js';
import {
  listBriefs,
  getBrief,
  updateBrief,
  deleteBrief,
  generateBrief,
  regenerateBrief,
  regenerateOutline,
} from '../content-brief.js';
import { createContentRequest, updateContentRequest } from '../content-requests.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { addActivity } from '../activity-log.js';
import { notifyClientBriefReady } from '../email.js';
import { getSearchOverview } from '../search-console.js';
import { getConfiguredProvider, getProviderDisplayName } from '../seo-data-provider.js';
import type { KeywordMetrics, RelatedKeyword } from '../seo-data-provider.js';
import { getWorkspace } from '../workspaces.js';
import { getAllSitePages } from './content-requests.js';
import { createLogger } from '../logger.js';
import { buildPipelineSignals } from '../insight-feedback.js';
import { getInsights } from '../analytics-insights-store.js';
import { recordAction } from '../outcome-tracking.js';
import { getWorkspaceLearnings, formatLearningsForPrompt } from '../workspace-learnings.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { isProgrammingError } from '../errors.js';
import { validate, z } from '../middleware/validate.js';
import { listMatrices } from '../content-matrices.js';
import { getTemplate } from '../content-templates.js';
import { BRIEF_PAGE_TYPES } from '../../shared/types/content.js';
import type { BriefPageType, BriefTemplateCrossrefMatch } from '../../shared/types/content.js';

const router = Router();
const log = createLogger('content-briefs');
const BRIEF_PAGE_TYPE_SET = new Set<string>(BRIEF_PAGE_TYPES);

const contentBriefPatchSchema = z.object({
  targetKeyword: z.string().trim().min(1).max(200).optional(),
  secondaryKeywords: z.array(z.string().trim().min(1).max(200)).optional(),
  suggestedTitle: z.string().trim().min(1).max(300).optional(),
  suggestedMetaDesc: z.string().trim().min(1).max(500).optional(),
  outline: z.array(outlineItemSchema).optional(),
  wordCountTarget: z.number().int().min(100).max(10000).optional(),
  intent: z.string().trim().min(1).max(100).optional(),
  audience: z.string().trim().min(1).max(1000).optional(),
  competitorInsights: z.string().trim().max(10000).optional(),
  internalLinkSuggestions: z.array(z.string().trim().min(1).max(500)).optional(),
  executiveSummary: z.string().trim().max(5000).optional(),
  contentFormat: z.string().trim().max(100).optional(),
  toneAndStyle: z.string().trim().max(2000).optional(),
  peopleAlsoAsk: z.array(z.string().trim().min(1).max(300)).optional(),
  topicalEntities: z.array(z.string().trim().min(1).max(100)).optional(),
  serpAnalysis: serpAnalysisSchema.optional(),
  difficultyScore: z.number().min(0).max(100).optional(),
  trafficPotential: z.string().trim().max(1000).optional(),
  ctaRecommendations: z.array(z.string().trim().min(1).max(300)).optional(),
  eeatGuidance: eeatGuidanceSchema.optional(),
  contentChecklist: z.array(z.string().trim().min(1).max(300)).optional(),
  schemaRecommendations: z.array(schemaRecommendationSchema).optional(),
  pageType: z.enum(BRIEF_PAGE_TYPES).optional(),
  referenceUrls: z.array(z.string().url()).optional(),
  realPeopleAlsoAsk: z.array(z.string().trim().min(1).max(300)).optional(),
  realTopResults: z.array(realTopResultSchema).optional(),
  keywordLocked: z.boolean().optional(),
  keywordSource: z.enum(['manual', 'semrush', 'dataforseo', 'gsc', 'matrix', 'template']).optional(),
  keywordValidation: keywordValidationSchema.optional(),
  templateId: z.string().trim().max(100).optional(),
  titleVariants: z.array(z.string().trim().min(1).max(300)).optional(),
  metaDescVariants: z.array(z.string().trim().min(1).max(500)).optional(),
}).refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: 'At least one editable field required' },
);

function notifyContentUpdated(workspaceId: string, payload: Record<string, unknown>) {
  broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, { domain: 'content-briefs', ...payload });
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function toBriefPageType(value: string): BriefPageType | null {
  return BRIEF_PAGE_TYPE_SET.has(value) ? value as BriefPageType : null;
}

function resolveBriefTemplateCrossref(workspaceId: string, keyword: string): BriefTemplateCrossrefMatch | null {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) return null;

  const matrices = listMatrices(workspaceId);
  for (const matrix of matrices) {
    for (const cell of matrix.cells) {
      const customKeyword = typeof cell.customKeyword === 'string' ? cell.customKeyword.trim() : '';
      const targetKeyword = cell.targetKeyword.trim();
      const customMatch = customKeyword.length > 0 && normalizeKeyword(customKeyword) === normalizedKeyword;
      const targetMatch = normalizeKeyword(targetKeyword) === normalizedKeyword;
      if (!customMatch && !targetMatch) continue;

      const template = getTemplate(workspaceId, matrix.templateId);
      if (!template) continue;

      const sections = [...template.sections]
        .sort((a, b) => a.order - b.order)
        .map(section => ({
          id: section.id,
          name: section.name,
          headingTemplate: section.headingTemplate,
          guidance: section.guidance,
          wordCountTarget: section.wordCountTarget,
          order: section.order,
        }));

      return {
        keyword: keyword.trim(),
        matrixId: matrix.id,
        matrixName: matrix.name,
        cellId: cell.id,
        matchedKeyword: customMatch ? customKeyword : targetKeyword,
        matchedSource: customMatch ? 'custom' : 'target',
        templateId: template.id,
        templateName: template.name,
        pageType: toBriefPageType(template.pageType),
        sections,
        toneAndStyle: template.toneAndStyle,
        titlePattern: template.titlePattern,
        metaDescPattern: template.metaDescPattern,
      };
    }
  }

  return null;
}

// --- Content Briefs ---
// List all briefs for a workspace
router.get('/api/content-briefs/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const briefs = listBriefs(req.params.workspaceId);
  log.info(`LIST ${req.params.workspaceId}: ${briefs.length} briefs found`);
  res.json(briefs);
});

// AI Suggested Briefs — must be registered BEFORE /:briefId to avoid param shadowing
router.get('/api/content-briefs/:workspaceId/suggested', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const insights = getInsights(req.params.workspaceId);
    const signals = buildPipelineSignals(insights);
    res.json({ signals });
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to build pipeline signals');
    res.json({ signals: [] });
  }
});

router.get('/api/content-briefs/:workspaceId/template-crossref', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const keyword = typeof req.query.keyword === 'string' ? req.query.keyword : '';
  if (!keyword.trim()) return res.status(400).json({ error: 'keyword query param required' });
  const match = resolveBriefTemplateCrossref(req.params.workspaceId, keyword);
  res.json(match);
});

// Get a specific brief
router.get('/api/content-briefs/:workspaceId/:briefId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  log.info(`GET ${req.params.workspaceId}/${req.params.briefId}`);
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) {
    log.info(`NOT FOUND: ${req.params.briefId} in workspace ${req.params.workspaceId}`);
    return res.status(404).json({ error: 'Brief not found' });
  }
  log.info(`FOUND: "${brief.targetKeyword}"`);
  res.json(brief);
});

// Update a content brief (inline editing)
router.patch('/api/content-briefs/:workspaceId/:briefId', requireWorkspaceAccess('workspaceId'), validate(contentBriefPatchSchema), (req, res) => {
  const updated = updateBrief(req.params.workspaceId, req.params.briefId, req.body);
  if (!updated) return res.status(404).json({ error: 'Brief not found' });
  addActivity(
    req.params.workspaceId,
    'content_updated',
    `Updated content brief "${updated.suggestedTitle || updated.targetKeyword}"`,
    undefined,
    { briefId: updated.id, action: 'brief_updated' },
  );
  notifyContentUpdated(req.params.workspaceId, { briefId: updated.id, action: 'brief_updated' });
  res.json(updated);
});

// Generate a new content brief
router.post('/api/content-briefs/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const { targetKeyword, businessContext, pageType, referenceUrls, pageAnalysisContext } = req.body;
    if (!targetKeyword) return res.status(400).json({ error: 'targetKeyword required' });

    const ws = getWorkspace(req.params.workspaceId);
    const templateCrossref = resolveBriefTemplateCrossref(req.params.workspaceId, targetKeyword);

    // No usage limit — briefs are paid add-ons purchased via Stripe
    let relatedQueries: { query: string; position: number; clicks: number; impressions: number }[] = [];

    // Fetch GSC data if available
    if (ws?.gscPropertyUrl && ws.webflowSiteId) {
      try {
        const overview = await getSearchOverview(ws.webflowSiteId, ws.gscPropertyUrl, 28);
        relatedQueries = overview.topQueries
          .filter(q => { const ql = q.query.toLowerCase(); return targetKeyword.toLowerCase().split(' ').some((w: string) => w.length > 2 && ql.includes(w)); })
          .slice(0, 20);
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'content-briefs: POST /api/content-briefs/:workspaceId/generate: programming error'); /* GSC not available */ }
    }

    // Fetch all published pages (Webflow API + sitemap CMS pages) for internal link suggestions
    const existingPages = ws ? await getAllSitePages(ws) : [];

    // Gather SEO keyword data if a provider is configured
    let keywordMetrics: KeywordMetrics | undefined;
    let relatedKeywords: RelatedKeyword[] | undefined;
    const seoProvider = getConfiguredProvider(ws?.seoDataProvider);
    const providerLabel = seoProvider ? getProviderDisplayName(seoProvider.name) : 'SEMRush';
    if (seoProvider) {
      try {
        const [metrics, related] = await Promise.all([
          seoProvider.getKeywordMetrics([targetKeyword], req.params.workspaceId),
          seoProvider.getRelatedKeywords(targetKeyword, req.params.workspaceId, 15),
        ]);
        if (metrics.length > 0) keywordMetrics = metrics[0];
        if (related.length > 0) relatedKeywords = related;
      } catch (e) { log.error({ err: e }, 'SEO keyword enrichment error'); }
    }

    // --- Parallel enrichment: reference URLs, SERP data, GA4 style examples ---
    const { scrapeUrls, scrapeSerpData } = await import('../web-scraper.js'); // dynamic-import-ok — lazy-loaded per-request; TypeScript resolves types via module inference, no as-any cast

    // 1. Scrape reference URLs (user-provided competitor/inspiration pages)
    const refUrlList: string[] = Array.isArray(referenceUrls)
      ? referenceUrls.filter((u: unknown) => typeof u === 'string' && (u as string).startsWith('http')).slice(0, 5)
      : [];

    // 2. Scrape Google SERP for target keyword (best-effort, may be blocked)
    // 3. If site has GA4 + liveDomain, scrape top-performing pages for style context
    const topPageUrls: string[] = [];
    let ga4Performance: { landingPage: string; sessions: number; users: number; bounceRate: number; avgEngagementTime: number; conversions: number }[] = [];
    if (ws?.ga4PropertyId) {
      try {
        const { getGA4LandingPages } = await import('../google-analytics.js'); // dynamic-import-ok — lazy-loaded; TypeScript resolves types, no as-any cast
        const pages = await getGA4LandingPages(ws.ga4PropertyId, 28, 25);
        ga4Performance = pages.slice(0, 10);
        // Pick top 2 pages with lowest bounce rate + highest engagement for style examples
        if (ws.liveDomain) {
          const sortedByQuality = [...pages]
            .filter(p => p.sessions > 10 && p.avgEngagementTime > 30)
            .sort((a, b) => (b.avgEngagementTime * b.sessions) - (a.avgEngagementTime * a.sessions));
          for (const p of sortedByQuality.slice(0, 2)) {
            const domain = ws.liveDomain.replace(/\/+$/, '');
            topPageUrls.push(`https://${domain}${p.landingPage}`);
          }
        }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'content-briefs: programming error'); /* GA4 not available */ }
    }

    // Run all scraping in parallel
    const [scrapedRefs, serpData, stylePages] = await Promise.all([
      refUrlList.length > 0 ? scrapeUrls(refUrlList, 3) : Promise.resolve([]),
      scrapeSerpData(targetKeyword).catch(() => null),
      topPageUrls.length > 0 ? scrapeUrls(topPageUrls, 2) : Promise.resolve([]),
    ]);

    const bodyPageType = toBriefPageType(pageType);
    const matchedTemplatePageType = templateCrossref?.pageType;
    const resolvedPageType = bodyPageType ?? matchedTemplatePageType ?? undefined;

    // Adaptive pipeline: inject workspace learnings into the brief prompt
    let adaptedBusinessContext = businessContext || ws?.keywordStrategy?.businessContext;
    if (isFeatureEnabled('outcome-ai-injection')) {
      try {
        const learnings = getWorkspaceLearnings(req.params.workspaceId);
        if (learnings) {
          const block = formatLearningsForPrompt(learnings, 'content');
          if (block) {
            adaptedBusinessContext = adaptedBusinessContext
              ? `${adaptedBusinessContext}\n\n${block}`
              : block;
          }
        }
      } catch (err) {
        log.warn({ err }, 'Failed to inject workspace learnings into brief prompt');
      }
    }

    const brief = await generateBrief(req.params.workspaceId, targetKeyword, {
      relatedQueries,
      businessContext: adaptedBusinessContext,
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
      referenceUrls: refUrlList.length > 0 ? refUrlList : undefined,
      scrapedReferences: scrapedRefs.length > 0 ? scrapedRefs : undefined,
      serpData: serpData ? { peopleAlsoAsk: serpData.peopleAlsoAsk, organicResults: serpData.organicResults } : undefined,
      ga4PagePerformance: ga4Performance.length > 0 ? ga4Performance : undefined,
      styleExamples: stylePages.length > 0 ? stylePages : undefined,
      pageAnalysisContext: pageAnalysisContext || undefined,
    });

    // Record for outcome tracking
    try {
      recordAction({ // recordAction-ok — workspaceId is req.params.workspaceId, validated by requireWorkspaceAccess middleware
        workspaceId: req.params.workspaceId,
        actionType: 'brief_created',
        sourceType: 'brief',
        sourceId: brief.id,
        pageUrl: null,
        targetKeyword: targetKeyword,
        baselineSnapshot: {
          captured_at: new Date().toISOString(),
        },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err, keyword: targetKeyword }, 'Failed to record outcome action for brief creation');
    }

    addActivity(
      req.params.workspaceId,
      'brief_generated',
      `Generated content brief for "${brief.targetKeyword}"`,
      brief.suggestedTitle,
      { briefId: brief.id, action: 'brief_generated' },
    );
    notifyContentUpdated(req.params.workspaceId, { briefId: brief.id, action: 'brief_generated' });
    res.json(brief);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate brief' });
  }
});

// Regenerate a brief with user feedback
router.post('/api/content-briefs/:workspaceId/:briefId/regenerate', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const { feedback } = req.body;
    if (!feedback) return res.status(400).json({ error: 'feedback required' });
    const existing = getBrief(req.params.workspaceId, req.params.briefId);
    if (!existing) return res.status(404).json({ error: 'Brief not found' });
    const newBrief = await regenerateBrief(req.params.workspaceId, existing, feedback);
    addActivity(
      req.params.workspaceId,
      'brief_generated',
      `Regenerated content brief for "${existing.targetKeyword}"`,
      `New brief: ${newBrief.suggestedTitle}`,
      { briefId: newBrief.id, previousBriefId: existing.id, action: 'brief_regenerated' },
    );
    notifyContentUpdated(req.params.workspaceId, {
      briefId: newBrief.id,
      previousBriefId: existing.id,
      action: 'brief_regenerated',
    });
    log.info(`REGENERATED brief ${req.params.briefId} -> ${newBrief.id} for "${existing.targetKeyword}"`);
    res.json(newBrief);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to regenerate brief' });
  }
});

// Regenerate outline only (preserves all other brief fields)
router.post('/api/content-briefs/:workspaceId/:briefId/regenerate-outline', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const { feedback } = req.body || {};
    const result = await regenerateOutline(req.params.workspaceId, req.params.briefId, feedback);
    if (!result) return res.status(404).json({ error: 'Brief not found' });
    addActivity(
      req.params.workspaceId,
      'content_updated',
      `Regenerated outline for "${result.suggestedTitle || result.targetKeyword}"`,
      undefined,
      { briefId: result.id, action: 'brief_outline_regenerated' },
    );
    notifyContentUpdated(req.params.workspaceId, { briefId: result.id, action: 'brief_outline_regenerated' });
    log.info(`REGENERATED OUTLINE for brief ${req.params.briefId} in workspace ${req.params.workspaceId}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to regenerate outline' });
  }
});

// Export a brief as branded HTML
router.get('/api/content-briefs/:workspaceId/:briefId/export', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  const html = renderBriefHTML(brief);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Send a standalone brief to client for review
// Creates a content request linked to this brief and sets status to client_review
router.post('/api/content-briefs/:workspaceId/:briefId/send-to-client', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  const ws = getWorkspace(req.params.workspaceId);

  // Create a content request linked to this brief
  const request = createContentRequest(req.params.workspaceId, {
    topic: brief.suggestedTitle,
    targetKeyword: brief.targetKeyword,
    intent: brief.intent || 'informational',
    priority: 'medium',
    rationale: brief.executiveSummary || `Content brief for "${brief.targetKeyword}"`,
    source: 'strategy',
    serviceType: 'brief_only',
    pageType: (brief.pageType as 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource') || 'blog',
    initialStatus: 'brief_generated',
    dedupe: false,
  });

  // Link the brief and set to client_review
  updateContentRequest(req.params.workspaceId, request.id, {
    briefId: brief.id,
    status: 'client_review',
  });

  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_CREATED, { id: request.id });
  notifyContentUpdated(req.params.workspaceId, { briefId: brief.id, requestId: request.id, action: 'brief_sent_to_client' });
  addActivity(
    req.params.workspaceId,
    'brief_generated',
    `Sent brief "${brief.suggestedTitle}" to client`,
    `Keyword: ${brief.targetKeyword}`,
    { briefId: brief.id, requestId: request.id, action: 'brief_sent_to_client' },
  );

  // Send email notification
  if (ws?.clientEmail) {
    const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
    const dashUrl = origin ? `${origin}/client/${req.params.workspaceId}/content` : undefined;
    notifyClientBriefReady({
      clientEmail: ws.clientEmail,
      workspaceName: ws.name,
      workspaceId: req.params.workspaceId,
      topic: brief.suggestedTitle,
      targetKeyword: brief.targetKeyword,
      dashboardUrl: dashUrl,
    });
  }

  log.info(`Brief ${brief.id} sent to client via request ${request.id}`);
  res.json({ ok: true, requestId: request.id });
});

// Delete a brief
router.delete('/api/content-briefs/:workspaceId/:briefId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const existing = getBrief(req.params.workspaceId, req.params.briefId);
  if (!existing) return res.status(404).json({ error: 'Brief not found' });
  deleteBrief(req.params.workspaceId, req.params.briefId);
  addActivity(
    req.params.workspaceId,
    'content_updated',
    `Deleted content brief "${existing.suggestedTitle || existing.targetKeyword}"`,
    undefined,
    { briefId: existing.id, action: 'brief_deleted' },
  );
  notifyContentUpdated(req.params.workspaceId, { briefId: existing.id, action: 'brief_deleted', deleted: true });
  res.json({ ok: true });
});

// Validate a keyword via SEO provider before locking it for brief generation
router.post('/api/content-briefs/:workspaceId/validate-keyword', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const kwWs = getWorkspace(req.params.workspaceId);
  const kwProvider = getConfiguredProvider(kwWs?.seoDataProvider);
  if (!kwProvider) {
    // No SEO provider — return a stub validation so the flow isn't blocked
    return res.json({
      keyword,
      valid: true,
      source: 'manual' as const,
      metrics: null,
      message: 'No SEO data provider configured — keyword accepted without validation',
    });
  }

  try {
    const metrics = await kwProvider.getKeywordMetrics([keyword], req.params.workspaceId);
    const kw = metrics[0];

    if (!kw) {
      return res.json({
        keyword,
        valid: true,
        source: kwProvider.name,
        metrics: null,
        message: 'No keyword data found — keyword accepted without metrics',
      });
    }

    // Flag low-volume or very high difficulty keywords as warnings (not blocking)
    const warnings: string[] = [];
    if (kw.volume < 10) warnings.push(`Very low search volume (${kw.volume}/mo)`);
    if (kw.difficulty > 85) warnings.push(`Very high keyword difficulty (${kw.difficulty}/100)`);

    res.json({
      keyword,
      valid: true,
      source: kwProvider.name,
      metrics: {
        volume: kw.volume,
        difficulty: kw.difficulty,
        cpc: kw.cpc,
        validatedAt: new Date().toISOString(),
      },
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (err) {
    log.error({ err, keyword, workspaceId: req.params.workspaceId }, 'Keyword validation failed');
    // Don't block workflow on SEO provider lookup failure
    res.json({
      keyword,
      valid: true,
      source: 'manual' as const,
      metrics: null,
      message: 'Keyword data lookup failed — keyword accepted without validation',
    });
  }
});

// Bulk validate keywords (for matrix pre-assignment)
router.post('/api/content-briefs/:workspaceId/validate-keywords', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { keywords } = req.body;
  if (!Array.isArray(keywords) || !keywords.length) {
    return res.status(400).json({ error: 'keywords array is required' });
  }

  const bulkWs = getWorkspace(req.params.workspaceId);
  const bulkProvider = getConfiguredProvider(bulkWs?.seoDataProvider);
  if (!bulkProvider) {
    return res.json({
      results: keywords.map((kw: string) => ({
        keyword: kw,
        valid: true,
        source: 'manual' as const,
        metrics: null,
      })),
      message: 'No SEO data provider configured — all keywords accepted without validation',
    });
  }

  try {
    const metrics = await bulkProvider.getKeywordMetrics(keywords.slice(0, 50), req.params.workspaceId);
    const metricsMap = new Map(metrics.map(m => [m.keyword.toLowerCase(), m])); // map-dup-ok

    const results = keywords.slice(0, 50).map((kw: string) => {
      const m = metricsMap.get(kw.toLowerCase());
      if (!m) {
        return { keyword: kw, valid: true, source: bulkProvider.name, metrics: null };
      }
      const warnings: string[] = [];
      if (m.volume < 10) warnings.push(`Very low volume (${m.volume}/mo)`);
      if (m.difficulty > 85) warnings.push(`Very high KD (${m.difficulty}/100)`);
      return {
        keyword: kw,
        valid: true,
        source: bulkProvider.name,
        metrics: {
          volume: m.volume,
          difficulty: m.difficulty,
          cpc: m.cpc,
          validatedAt: new Date().toISOString(),
        },
        warnings: warnings.length ? warnings : undefined,
      };
    });

    res.json({ results });
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Bulk keyword validation failed');
    res.json({
      results: keywords.map((kw: string) => ({
        keyword: kw,
        valid: true,
        source: 'manual' as const,
        metrics: null,
      })),
      message: 'Keyword data lookup failed — all keywords accepted without validation',
    });
  }
});

export default router;
