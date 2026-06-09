/**
 * jobs routes — extracted from server/index.ts
 *
 * @reads jobs, workspaces, snapshots, schema_snapshots, recommendations, workspace_pages, page_keywords, google_analytics, search_console, webflow_api, content_briefs
 * @writes jobs, snapshots, schema_snapshots, recommendations, webflow_assets, page_keywords, page_edit_states, seo_changes, usage_tracking, activities, content_posts
 */
import { Router } from 'express';
import {
  createJob,
  updateJob,
  getJob,
  listJobs,
  cancelJob,
  clearCompletedJobs,
  getJobCancellationError,
  registerAbort,
  hasActiveJob,
  type Job,
} from '../jobs.js';
import { APP_PASSWORD, requireClientPortalAuth, signAdminToken } from '../middleware.js';
import { requestUserCanAccessWorkspace, sendWorkspaceAccessDenied, workspaceOwnsWebflowSite } from '../auth.js';
import { startLegacyJob } from '../legacy-jobs-runner-registry.js';
import { runRecommendationGenerationJob } from '../recommendation-generation-job.js';
import { getBrief } from '../content-brief.js';
import { startContentBriefGenerationJob } from '../content-brief-generation-job.js';
import type { StandaloneContentBriefGenerationParams } from '../content-brief-generation-job.js';
import { getContentRequest } from '../content-requests.js';
import { getBlueprint } from '../page-strategy.js';
import {
  createContentPostGenerationJob,
  runContentPostGenerationJob,
} from '../content-posts.js';
import {
  createCopyBatchGenerationJob,
  runCopyBatchGenerationJob,
} from '../copy-batch-jobs.js';
import {
  generateKeywordStrategy,
  hasActiveKeywordStrategyGeneration,
  KeywordStrategyGenerationError,
  KEYWORD_STRATEGY_MAX_PAGE_CAP,
} from '../keyword-strategy-generation.js';
import { runSchemaGenerationJob } from '../schema-generation-job.js';
import {
  schemaPlanGenerationErrorResponse,
  startSchemaPlanGenerationJob,
} from '../schema-plan-generation-job.js';
import {
  getWorkspace,
  getTokenForSite,
} from '../workspaces.js';
import { runPageAnalysisJob } from '../page-analysis-job.js';
import {
  startWorkspaceContextGenerationJob,
  workspaceContextJobErrorResponse,
} from '../workspace-context-generation-job.js';
import { createLogger } from '../logger.js';
import { getInsights } from '../analytics-insights-store.js';
import { createDiagnosticReport, markDiagnosticFailed } from '../diagnostic-store.js';
import { runDiagnostic } from '../diagnostic-orchestrator.js';
import type { AnalyticsInsight, AnomalyDigestData } from '../../shared/types/analytics.js';
import { BACKGROUND_JOB_TYPES, toPublicBackgroundJob } from '../../shared/types/background-jobs.js';
import { CONTENT_GENERATION_STYLES } from '../../shared/types/content.js';
import type { ContentGenerationStyle } from '../../shared/types/content.js';
import { isProgrammingError } from '../errors.js';

const log = createLogger('jobs');
const router = Router();
const CLIENT_VISIBLE_JOB_TYPES = new Set<string>([
  BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION,
]);

const PORT = parseInt(process.env.PORT || '3001', 10);

function internalAdminHeaders(): Record<string, string> {
  return APP_PASSWORD ? { 'x-auth-token': signAdminToken() } : {};
}

const keywordStrategyStepLabels: Record<string, string> = {
  discovery: 'Discovering pages',
  content: 'Fetching page content',
  search_data: 'Search Console data',
  'seo-data': 'Keyword intelligence',
  ai: 'AI analysis',
  enrichment: 'Enriching data',
  complete: 'Complete',
};

function keywordStrategyJobResultSummary(
  strategy: {
    generatedAt?: unknown;
    pageMap?: unknown;
    siteKeywords?: unknown;
    contentGaps?: unknown;
    quickWins?: unknown;
  },
  options: { upToDate?: boolean; freshPageCount?: number } = {},
): Record<string, unknown> {
  const pageMap = strategy.pageMap;
  const siteKeywords = strategy.siteKeywords;
  const contentGaps = strategy.contentGaps;
  const quickWins = strategy.quickWins;

  return {
    persisted: true,
    upToDate: Boolean(options.upToDate),
    freshPageCount: options.freshPageCount,
    generatedAt: typeof strategy.generatedAt === 'string' ? strategy.generatedAt : undefined,
    pageCount: Array.isArray(pageMap) ? pageMap.length : 0,
    siteKeywordCount: Array.isArray(siteKeywords) ? siteKeywords.length : 0,
    contentGapCount: Array.isArray(contentGaps) ? contentGaps.length : 0,
    quickWinCount: Array.isArray(quickWins) ? quickWins.length : 0,
  };
}

function isClientVisibleJob(job: Job, workspaceId: string): boolean {
  return job.workspaceId === workspaceId && CLIENT_VISIBLE_JOB_TYPES.has(job.type);
}

function parseContentGenerationStyle(value: unknown): ContentGenerationStyle | undefined {
  return typeof value === 'string' && CONTENT_GENERATION_STYLES.includes(value as ContentGenerationStyle)
    ? value as ContentGenerationStyle
    : undefined;
}

// --- Background Job Endpoints ---
router.get('/api/jobs', (_req, res) => {
  const wsId = _req.query.workspaceId as string | undefined;
  if (wsId && !requestUserCanAccessWorkspace(_req, wsId)) return sendWorkspaceAccessDenied(res);
  if (!wsId && _req.user && _req.user.role !== 'owner') {
    const visible = (_req.user.workspaceIds || []).flatMap(id => listJobs(id));
    const deduped = [...new Map(visible.map(job => [job.id, job])).values()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json(deduped);
  }
  res.json(listJobs(wsId));
});

router.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.workspaceId && !requestUserCanAccessWorkspace(req, job.workspaceId)) return sendWorkspaceAccessDenied(res);
  res.json(job);
});

router.get('/api/public/jobs/:workspaceId', requireClientPortalAuth(), (req, res) => {
  const workspaceId = req.params.workspaceId;
  const jobs = listJobs(workspaceId)
    .filter(job => isClientVisibleJob(job, workspaceId))
    .map(toPublicBackgroundJob);
  res.json(jobs);
});

router.get('/api/public/jobs/:workspaceId/:id', requireClientPortalAuth(), (req, res) => {
  const workspaceId = req.params.workspaceId;
  const job = getJob(req.params.id);
  if (!job || !isClientVisibleJob(job, workspaceId)) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(toPublicBackgroundJob(job));
});

router.delete('/api/jobs/completed', (_req, res) => {
  const workspaceId = typeof _req.query.workspaceId === 'string' ? _req.query.workspaceId : undefined;
  const scope = typeof _req.query.scope === 'string' ? _req.query.scope : undefined;
  if (workspaceId) {
    if (!requestUserCanAccessWorkspace(_req, workspaceId)) return sendWorkspaceAccessDenied(res);
    const count = clearCompletedJobs({ workspaceId });
    return res.json({ cleared: count });
  }
  if (scope === 'global') {
    const count = clearCompletedJobs({ globalOnly: true });
    return res.json({ cleared: count });
  }
  if (_req.user && _req.user.role !== 'owner') return sendWorkspaceAccessDenied(res);
  const count = clearCompletedJobs();
  res.json({ cleared: count });
});

router.delete('/api/jobs/:id', (req, res) => {
  const existing = getJob(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Job not found' });
  if (existing.workspaceId && !requestUserCanAccessWorkspace(req, existing.workspaceId)) return sendWorkspaceAccessDenied(res);
  const cancellationError = getJobCancellationError(existing);
  if (cancellationError) return res.status(409).json({ error: cancellationError, jobId: existing.id });
  const job = cancelJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/api/jobs', async (req, res) => {
  const { type, params = {} } = req.body as { type: string; params?: Record<string, unknown> };
  if (!type) return res.status(400).json({ error: 'type required' });
  const requestedWorkspaceId = params?.workspaceId;
  if (typeof requestedWorkspaceId === 'string' && !requestUserCanAccessWorkspace(req, requestedWorkspaceId)) {
    return sendWorkspaceAccessDenied(res);
  }
  const requestedSiteId = params?.siteId;
  if (typeof requestedSiteId === 'string') {
    if (typeof requestedWorkspaceId === 'string') {
      if (!workspaceOwnsWebflowSite(requestedWorkspaceId, requestedSiteId)) return sendWorkspaceAccessDenied(res);
    } else if (req.user && req.user.role !== 'owner') {
      return sendWorkspaceAccessDenied(res);
    }
  }

  try {
    const legacyStart = startLegacyJob(type, params, {
      port: PORT,
      internalHeaders: internalAdminHeaders(),
    });
    if (legacyStart) {
      return res.status(legacyStart.status).json(legacyStart.body);
    }

    switch (type) {
      case BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION: {
        const wsId = typeof params.workspaceId === 'string' ? params.workspaceId : '';
        const briefId = typeof params.briefId === 'string' ? params.briefId.trim() : '';
        if (!wsId) return res.status(400).json({ error: 'workspaceId required' });
        if (!briefId) return res.status(400).json({ error: 'briefId required' });
        const activePostJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, wsId);
        if (activePostJob) return res.status(409).json({ error: 'Content post generation is already running for this workspace', jobId: activePostJob.id });
        const ws = getWorkspace(wsId);
        if (!ws) return res.status(404).json({ error: 'Workspace not found' });
        const brief = getBrief(wsId, briefId);
        if (!brief) return res.status(404).json({ error: 'Brief not found' });

        const started = createContentPostGenerationJob(wsId, brief);
        res.json({ jobId: started.jobId, postId: started.postId, post: started.post });
        runContentPostGenerationJob({
          workspaceId: wsId,
          brief,
          postId: started.postId,
          jobId: started.jobId,
        });
        break;
      }

      case BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION: {
        const wsId = typeof params.workspaceId === 'string' ? params.workspaceId : '';
        const requestId = typeof params.requestId === 'string' ? params.requestId.trim() : '';
        const targetKeyword = typeof params.targetKeyword === 'string' ? params.targetKeyword.trim() : '';
        const generationStyle = parseContentGenerationStyle(params.generationStyle);
        if (params.generationStyle !== undefined && !generationStyle) {
          return res.status(400).json({ error: 'generationStyle must be one of standard, concise, hybrid' });
        }
        if (!wsId) return res.status(400).json({ error: 'workspaceId required' });
        const activeBriefJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, wsId);
        if (activeBriefJob) return res.status(409).json({ error: 'Content brief generation is already running for this workspace', jobId: activeBriefJob.id });
        const ws = getWorkspace(wsId);
        if (!ws) return res.status(404).json({ error: 'Workspace not found' });

        if (requestId) {
          const request = getContentRequest(wsId, requestId);
          if (!request) return res.status(404).json({ error: 'Request not found' });
          const started = startContentBriefGenerationJob({
            source: 'request',
            workspaceId: wsId,
            requestId,
            generationStyle,
          });
          res.json(started);
          break;
        }

        if (!targetKeyword) return res.status(400).json({ error: 'targetKeyword required' });
        const referenceUrls = Array.isArray(params.referenceUrls)
          ? params.referenceUrls.filter((url): url is string => typeof url === 'string')
          : undefined;
        const started = startContentBriefGenerationJob({
          source: 'standalone',
          workspaceId: wsId,
          targetKeyword,
          businessContext: typeof params.businessContext === 'string' ? params.businessContext : undefined,
          pageType: typeof params.pageType === 'string' ? params.pageType : undefined,
          referenceUrls,
          pageAnalysisContext: params.pageAnalysisContext && typeof params.pageAnalysisContext === 'object'
            ? params.pageAnalysisContext as StandaloneContentBriefGenerationParams['pageAnalysisContext']
            : undefined,
          generationStyle,
        });
        res.json(started);
        break;
      }

      case BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION: {
        const wsId = typeof params.workspaceId === 'string' ? params.workspaceId : '';
        const blueprintId = typeof params.blueprintId === 'string' ? params.blueprintId : '';
        const entryIds = Array.isArray(params.entryIds) ? params.entryIds.filter((id): id is string => typeof id === 'string') : [];
        const mode = typeof params.mode === 'string' ? params.mode : undefined;
        const batchSize = typeof params.batchSize === 'number' ? params.batchSize : undefined;
        if (!wsId) return res.status(400).json({ error: 'workspaceId required' });
        if (!blueprintId) return res.status(400).json({ error: 'blueprintId required' });
        if (entryIds.length === 0) return res.status(400).json({ error: 'entryIds required' });
        const blueprint = getBlueprint(wsId, blueprintId);
        if (!blueprint) return res.status(404).json({ error: 'Blueprint not found' });
        const activeCopyBatchJob = hasActiveJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, wsId);
        if (activeCopyBatchJob) return res.status(409).json({ error: 'Copy batch generation is already running for this workspace', jobId: activeCopyBatchJob.id });
        try {
          const started = createCopyBatchGenerationJob({ workspaceId: wsId, blueprintId, entryIds, mode, batchSize });
          res.json(started);
          setTimeout(() => {
            void runCopyBatchGenerationJob({ workspaceId: wsId, blueprintId, entryIds, mode, batchSize, ...started });
          }, 100);
        } catch (err) {
          if (err instanceof Error && err.message === 'Blueprint not found') {
            return res.status(404).json({ error: 'Blueprint not found' });
          }
          log.error({ err, workspaceId: wsId, blueprintId }, 'Failed to start copy batch job');
          return res.status(500).json({ error: 'Failed to start copy batch job' });
        }
        break;
      }

      case BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION:
      case BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION:
      case BACKGROUND_JOB_TYPES.PERSONA_GENERATION: {
        const wsId = typeof params.workspaceId === 'string' ? params.workspaceId : '';
        try {
          const started = await startWorkspaceContextGenerationJob(type, wsId);
          res.json(started);
        } catch (err) {
          const response = workspaceContextJobErrorResponse(err);
          res.status(response.status).json(response.body);
        }
        break;
      }

      case BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION: {
        const wsId = typeof params.workspaceId === 'string' ? params.workspaceId : '';
        if (!wsId) return res.status(400).json({ error: 'workspaceId required' });
        const activeRecJob = hasActiveJob(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION, wsId);
        if (activeRecJob) return res.json({ jobId: activeRecJob.id, existing: true });
        const recWs = getWorkspace(wsId);
        if (!recWs) return res.status(404).json({ error: 'Workspace not found' });
        const job = createJob(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION, {
          workspaceId: wsId,
          message: 'Generating recommendations...',
        });
        res.json({ jobId: job.id });
        setTimeout(() => {
          void runRecommendationGenerationJob(job.id, wsId, 'explicit');
        }, 100);
        break;
      }

      case BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY: {
        const wsId = params.workspaceId as string;
        if (!wsId) return res.status(400).json({ error: 'workspaceId required' });
        const maxPages = params.maxPages == null ? undefined : Number(params.maxPages);
        if (maxPages != null && (!Number.isInteger(maxPages) || maxPages < 0)) {
          return res.status(400).json({ error: 'maxPages must be a non-negative integer' });
        }
        if (maxPages != null && maxPages > KEYWORD_STRATEGY_MAX_PAGE_CAP) {
          return res.status(400).json({ error: `maxPages must be between 0 and ${KEYWORD_STRATEGY_MAX_PAGE_CAP}` });
        }
        const activeStrat = hasActiveJob('keyword-strategy', wsId);
        if (activeStrat) return res.status(409).json({ error: 'A keyword strategy is already being generated for this workspace', jobId: activeStrat.id });
        if (hasActiveKeywordStrategyGeneration(wsId)) return res.status(409).json({ error: 'A keyword strategy is already being generated for this workspace' });
        const stratWs = getWorkspace(wsId);
        if (!stratWs) return res.status(404).json({ error: 'Workspace not found' });
        if (!stratWs.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });
        if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
        const job = createJob('keyword-strategy', { message: 'Generating keyword strategy...', workspaceId: wsId });
        const jobWasCancelled = () => getJob(job.id)?.status === 'cancelled';
        // Keep the accepted job pending briefly so immediate duplicate requests
        // see the active job before worker validation failures can mark it terminal.
        setTimeout(() => {
          void (async () => {
            try {
              if (jobWasCancelled()) return;
              updateJob(job.id, { status: 'running', message: 'Fetching pages and analyzing keywords...' });
              const businessContext = (params.businessContext as string) || stratWs.keywordStrategy?.businessContext || '';
              const seoDataMode = (params.seoDataMode as string) || 'none';
              const seoDataProvider = typeof params.seoDataProvider === 'string' ? params.seoDataProvider : undefined;
              const competitorDomainsProvided = Array.isArray(params.competitorDomains);
              const competitorDomains = competitorDomainsProvided ? params.competitorDomains as string[] : stratWs.competitorDomains || [];
              const mode = params.mode === 'incremental' ? 'incremental' : 'full';
              const generationResult = await generateKeywordStrategy({
                workspaceId: wsId,
                businessContext,
                seoDataMode,
                seoDataProvider,
                competitorDomains,
                competitorDomainsProvided,
                maxPages,
                mode,
                onProgress: (evt) => {
                  const pct = Math.round(evt.progress * 100);
                  const label = keywordStrategyStepLabels[evt.step] || evt.step;
                  updateJob(job.id, {
                    message: evt.detail ? `${label}: ${evt.detail}` : label,
                    progress: pct,
                    total: 100,
                  });
                },
              });
              if (jobWasCancelled()) return;
              if (generationResult.upToDate) {
                updateJob(job.id, {
                  status: 'done',
                  result: { upToDate: true, freshPageCount: generationResult.freshPageCount ?? 0 },
                  progress: 100,
                  total: 100,
                  message: 'Strategy already up to date',
                });
                return;
              }
              const stratResult = generationResult.strategy;
              if (!stratResult) throw new Error('Strategy generation completed without a strategy result');
              const pageMap = (stratResult as { pageMap?: unknown[] }).pageMap;
              const pageCount = Array.isArray(pageMap) ? pageMap.length : 0;
              updateJob(job.id, {
                status: 'done',
                result: keywordStrategyJobResultSummary(stratResult, {
                  freshPageCount: generationResult.freshPageCount,
                }),
                progress: 100,
                total: 100,
                message: `Strategy complete — ${pageCount} pages mapped`,
              });
            } catch (err) {
              if (jobWasCancelled()) return;
              if (isProgrammingError(err)) log.warn({ err }, 'jobs: keyword-strategy job failed with programming error');
              else log.debug({ err }, 'jobs: keyword-strategy job failed — degrading gracefully');
              const message = err instanceof KeywordStrategyGenerationError ? err.payload.message || err.payload.error : err instanceof Error ? err.message : String(err);
              updateJob(job.id, { status: 'error', error: message, message: 'Strategy generation failed' });
            }
          })();
        }, 100);
        res.json({ jobId: job.id });
        break;
      }
      case BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION: {
        const siteId = typeof params.siteId === 'string' ? params.siteId : '';
        const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : undefined;
        try {
          const started = startSchemaPlanGenerationJob(siteId, workspaceId);
          res.json(started);
        } catch (err) {
          const response = schemaPlanGenerationErrorResponse(err);
          res.status(response.status).json(response.body);
        }
        break;
      }
      case 'schema-generator': {
        const schemaSiteId = params.siteId as string;
        if (!schemaSiteId) return res.status(400).json({ error: 'siteId required' });
        const activeSchema = hasActiveJob('schema-generator', params.workspaceId as string);
        if (activeSchema) return res.status(409).json({ error: 'Schema generation is already running for this workspace', jobId: activeSchema.id });
        const schemaToken = getTokenForSite(schemaSiteId) || undefined;
        if (!schemaToken) return res.status(400).json({ error: 'No Webflow API token configured' });
        const job = createJob('schema-generator', { message: 'Generating schemas...', workspaceId: params.workspaceId as string });
        registerAbort(job.id);
        res.json({ jobId: job.id });
        void runSchemaGenerationJob({
          jobId: job.id,
          siteId: schemaSiteId,
          token: schemaToken,
          workspaceId: (params.workspaceId as string) || '',
        });
        break;
      }

      case 'page-analysis': {
        const paSiteId = params.siteId as string;
        const paWsId = params.workspaceId as string;
        if (!paSiteId || !paWsId) return res.status(400).json({ error: 'siteId and workspaceId required' });
        const paWs = getWorkspace(paWsId);
        if (!paWs) return res.status(404).json({ error: 'Workspace not found' });
        if (!paWs.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });
        if (paWs.webflowSiteId !== paSiteId) {
          return res.status(403).json({ error: 'You do not have access to this workspace' });
        }
        const activePA = hasActiveJob('page-analysis', paWsId);
        if (activePA) return res.status(409).json({ error: 'Page analysis is already running', jobId: activePA.id });
        const paToken = getTokenForSite(paSiteId) || undefined;
        const paJob = createJob('page-analysis', { message: 'Discovering pages...', workspaceId: paWsId });
        registerAbort(paJob.id);
        res.json({ jobId: paJob.id });
        void runPageAnalysisJob({
          jobId: paJob.id,
          siteId: paSiteId,
          workspaceId: paWsId,
          token: paToken,
          forceRefresh: !!params.forceRefresh,
        });
        break;
      }

      case 'deep-diagnostic': {
        const workspaceId = params.workspaceId as string;
        const insightId = params.insightId as string;
        if (!workspaceId || !insightId) return res.status(400).json({ error: 'workspaceId and insightId required' });

        const ws = getWorkspace(workspaceId);
        if (!ws) return res.status(404).json({ error: 'Workspace not found' });

        const activeJob = hasActiveJob('deep-diagnostic', workspaceId);
        if (activeJob) return res.status(409).json({ error: 'A diagnostic is already running for this workspace', jobId: activeJob.id });

        const anomalyInsight = getInsights(workspaceId).find((i: AnalyticsInsight) => i.id === insightId);
        if (!anomalyInsight) return res.status(404).json({ error: 'Anomaly insight not found' });
        if (anomalyInsight.insightType !== 'anomaly_digest') return res.status(400).json({ error: 'Insight must be of type anomaly_digest' });

        const anomalyData = anomalyInsight.data as unknown as AnomalyDigestData;
        // Use anomalyData.affectedPage — anomalyInsight.pageId is the synthetic dedup key, not a real path
        const affectedPages = anomalyData.affectedPage ? [anomalyData.affectedPage] : [];

        const report = createDiagnosticReport(workspaceId, insightId, anomalyData.anomalyType, affectedPages);
        const job = createJob('deep-diagnostic', { message: 'Starting deep diagnostic...', workspaceId });
        res.json({ jobId: job.id, reportId: report.id });

        (async () => {
          try {
            await runDiagnostic({ workspaceId, insightId, reportId: report.id }, job.id);
          } catch (err) {
            log.error({ err }, 'Deep diagnostic failed');
            markDiagnosticFailed(report.id, (err as Error).message);
            updateJob(job.id, { status: 'error', message: 'Deep diagnostic failed' });
          }
        })();
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown job type: ${type}` });
    }
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'jobs: POST /api/jobs: programming error'); // url-fetch-ok
    else log.debug({ err }, 'jobs: POST /api/jobs: degrading gracefully');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
