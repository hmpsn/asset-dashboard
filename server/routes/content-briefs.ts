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
} from '../content-brief.js';
import { createContentRequest, getOpenRequestForBrief, updateContentRequest } from '../content-requests.js';
import db from '../db/index.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { addActivity } from '../activity-log.js';
import { notifyClientBriefReady } from '../email.js';
import { getConfiguredProvider } from '../seo-data-provider.js';
import { getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { buildPipelineSignals } from '../insight-feedback.js';
import { getInsights } from '../analytics-insights-store.js';
import { createSuggestedBrief } from '../suggested-briefs-store.js';
import { validate, z } from '../middleware/validate.js';
import { resolveWorkspaceLocationCode } from '../local-seo.js';
import { invalidateContentPipelineIntelligence } from '../intelligence-freshness.js';
import { BRIEF_PAGE_TYPES, CONTENT_GENERATION_STYLES } from '../../shared/types/content.js';
import { normalizeBriefKeyword, resolveBriefTemplateCrossref } from '../content-brief-template-crossref.js';
import { hasActiveJob } from '../jobs.js';
import { startContentBriefGenerationJob } from '../content-brief-generation-job.js';
import { startContentBriefRegenerateJob, hasActiveBriefRegenerateJob } from '../content-brief-regenerate-job.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const router = Router();
const log = createLogger('content-briefs');

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
  generationStyle: z.enum(CONTENT_GENERATION_STYLES).optional(),
}).refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: 'At least one editable field required' },
);

function notifyContentUpdated(workspaceId: string, payload: Record<string, unknown>) {
  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, { domain: 'content-briefs', ...payload });
}

// --- Content Briefs ---
// List all briefs for a workspace
router.get('/api/content-briefs/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const briefs = listBriefs(req.params.workspaceId);
  log.info(`LIST ${req.params.workspaceId}: ${briefs.length} briefs found`);
  res.json(briefs);
});

// AI Suggested Briefs — must be registered BEFORE /:briefId to avoid param shadowing
//
// This route seeds the store with any new ranking_opportunity signals before returning.
// SHA dedup in createSuggestedBrief ensures idempotency across repeated calls.
// The frontend reads exclusively from /api/suggested-briefs/:workspaceId (the store);
// this endpoint is retained as the seeding trigger called on panel open.
router.get('/api/content-briefs/:workspaceId/suggested', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { workspaceId } = req.params;
    const insights = getInsights(workspaceId);
    const signals = buildPipelineSignals(insights);
    // Seed ranking_opportunity signals into the store (SHA dedup prevents duplicates).
    // content_decay signals are already written by the decay analysis pipeline; skip them here.
    for (const signal of signals) {
      if (signal.type === 'suggested_brief' && signal.keyword) {
        createSuggestedBrief({
          workspaceId,
          keyword: signal.keyword,
          pageUrl: signal.pageUrl,
          source: 'ranking_opportunity',
          reason: signal.detail,
          priority: signal.impactScore >= 75 ? 'high' : signal.impactScore >= 50 ? 'medium' : 'low',
        });
      }
    }
    // Return the store list so the response is consistent with the primary store read path.
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
    {
      const { targetKeyword, businessContext, pageType, referenceUrls, pageAnalysisContext, generationStyle } = req.body;
      if (!targetKeyword) return res.status(400).json({ error: 'targetKeyword required' });
      if (
        generationStyle !== undefined
        && (typeof generationStyle !== 'string' || !CONTENT_GENERATION_STYLES.includes(generationStyle as typeof CONTENT_GENERATION_STYLES[number]))
      ) {
        return res.status(400).json({ error: 'generationStyle must be one of standard, concise, hybrid' });
      }
      const ws = getWorkspace(req.params.workspaceId);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      const activeBriefJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, req.params.workspaceId);
      if (activeBriefJob) return res.status(409).json({ error: 'Content brief generation is already running for this workspace', jobId: activeBriefJob.id });
      const refUrlList: string[] = Array.isArray(referenceUrls)
        ? referenceUrls.filter((u: unknown) => typeof u === 'string' && (u as string).startsWith('http')).slice(0, 5)
        : [];
      const started = startContentBriefGenerationJob({
        source: 'standalone',
        workspaceId: req.params.workspaceId,
        targetKeyword,
        businessContext,
        pageType,
        generationStyle,
        referenceUrls: refUrlList.length > 0 ? refUrlList : undefined,
        pageAnalysisContext: pageAnalysisContext || undefined,
      });
      return res.json(started);
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate brief' });
  }
});

// Regenerate a brief with user feedback (async — returns 202 { jobId })
//
// W6.2: heavyweight AI regeneration (gpt-5.4, 7000 tokens, research mode) moved onto
// the background job platform. The job persists the new brief to the content_briefs
// store and broadcasts BRIEF_UPDATED on completion (declared cross-lane contract:
// ContentBriefs.tsx is re-wired by a sibling lane). Failures surface via the job
// error state, not the HTTP response.
router.post('/api/content-briefs/:workspaceId/:briefId/regenerate', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { feedback } = req.body;
  if (!feedback) return res.status(400).json({ error: 'feedback required' });
  const existing = getBrief(req.params.workspaceId, req.params.briefId);
  if (!existing) return res.status(404).json({ error: 'Brief not found' });
  const activeJob = hasActiveBriefRegenerateJob(req.params.workspaceId);
  if (activeJob) return res.status(409).json({ error: 'A brief regeneration is already running for this workspace', jobId: activeJob.id });
  const started = startContentBriefRegenerateJob({
    mode: 'regenerate',
    workspaceId: req.params.workspaceId,
    briefId: req.params.briefId,
    feedback,
  });
  res.status(202).json(started);
});

// Regenerate outline only (preserves all other brief fields) — async, returns 202 { jobId }
router.post('/api/content-briefs/:workspaceId/:briefId/regenerate-outline', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { feedback } = req.body || {};
  const existing = getBrief(req.params.workspaceId, req.params.briefId);
  if (!existing) return res.status(404).json({ error: 'Brief not found' });
  const activeJob = hasActiveBriefRegenerateJob(req.params.workspaceId);
  if (activeJob) return res.status(409).json({ error: 'A brief regeneration is already running for this workspace', jobId: activeJob.id });
  const started = startContentBriefRegenerateJob({
    mode: 'outline',
    workspaceId: req.params.workspaceId,
    briefId: req.params.briefId,
    feedback: typeof feedback === 'string' ? feedback : undefined,
  });
  res.status(202).json(started);
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

  // Bug 2 fix: wrap dedupe-check + create + link in a single transaction so the
  // check-then-create sequence is atomic. Re-checking INSIDE the transaction (not
  // before it) closes the TOCTOU window where two concurrent send-to-client calls
  // both pass an outside-the-txn check and each create a request. The serialized
  // transaction guarantees the second caller sees the first caller's row and
  // early-returns its id instead of inserting a duplicate.
  let request: ReturnType<typeof createContentRequest> | null = null;
  let dedupedRequestId: string | null = null;
  db.transaction(() => {
    const existing = getOpenRequestForBrief(req.params.workspaceId, brief.id);
    if (existing) {
      dedupedRequestId = existing.id;
      return;
    }
    request = createContentRequest(req.params.workspaceId, {
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
    updateContentRequest(req.params.workspaceId, request!.id, {
      briefId: brief.id,
      status: 'client_review',
    });
  })();

  // Dedupe hit — an open request already covers this brief; return it without
  // re-broadcasting, re-notifying, or re-logging (no new work was done).
  if (dedupedRequestId) {
    return res.json({ ok: true, requestId: dedupedRequestId });
  }

  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_CREATED, { id: request!.id });
  notifyContentUpdated(req.params.workspaceId, { briefId: brief.id, requestId: request!.id, action: 'brief_sent_to_client' });
  addActivity(
    req.params.workspaceId,
    'brief_generated',
    `Sent brief "${brief.suggestedTitle}" to client`,
    `Keyword: ${brief.targetKeyword}`,
    { briefId: brief.id, requestId: request!.id, action: 'brief_sent_to_client' },
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

  log.info(`Brief ${brief.id} sent to client via request ${request!.id}`);
  res.json({ ok: true, requestId: request!.id });
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
    const locationCode = resolveWorkspaceLocationCode(req.params.workspaceId) ?? undefined;
    const metrics = await kwProvider.getKeywordMetrics([keyword], req.params.workspaceId, undefined, locationCode);
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
    const locationCode = resolveWorkspaceLocationCode(req.params.workspaceId) ?? undefined;
    const metrics = await bulkProvider.getKeywordMetrics(keywords.slice(0, 50), req.params.workspaceId, undefined, locationCode);
    const metricsMap = new Map(metrics.map(m => [normalizeBriefKeyword(m.keyword), m])); // map-dup-ok

    const results = keywords.slice(0, 50).map((kw: string) => {
      const m = metricsMap.get(normalizeBriefKeyword(kw));
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
