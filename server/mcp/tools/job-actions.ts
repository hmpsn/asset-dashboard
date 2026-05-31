import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  cancelJobInputSchema,
  getJobStatusInputSchema,
  listJobsInputSchema,
  startKeywordStrategyGenerationInputSchema,
  startLocalSeoRefreshInputSchema,
  startSeoAuditInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs.js';
import type { LocalSeoRefreshRequest } from '../../../shared/types/local-seo.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { cancelJob, createJob, getJob, hasActiveJob, listJobs, updateJob } from '../../jobs.js';
import type { Job } from '../../jobs.js';
import { createLocalSeoRefreshPlan, runLocalSeoRefreshJob } from '../../local-seo.js';
import { createLogger } from '../../logger.js';
import {
  generateKeywordStrategy,
  hasActiveKeywordStrategyGeneration,
  KEYWORD_STRATEGY_MAX_PAGE_CAP,
  KeywordStrategyGenerationError,
} from '../../keyword-strategy-generation.js';
import { runSeoAudit } from '../../seo-audit.js';
import { getTokenForSite } from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import { toMcpJsonSchema } from '../json-schema.js';
import {
  buildDashboardUrl,
  mcpError,
  mcpSuccess,
  requireWorkspace,
  zodErrorToMcp,
  type McpToolErrorResponse,
  type McpToolSuccessResponse,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-job-actions');

export const jobActionTools: Tool[] = [
  {
    name: 'start_keyword_strategy_generation',
    description: 'Start the background keyword strategy generation job for a workspace.',
    inputSchema: toMcpJsonSchema(startKeywordStrategyGenerationInputSchema),
  },
  {
    name: 'start_seo_audit',
    description: 'Start the background SEO audit job for a workspace and site.',
    inputSchema: toMcpJsonSchema(startSeoAuditInputSchema),
  },
  {
    name: 'start_local_seo_refresh',
    description: 'Start the background local SEO refresh job for a workspace.',
    inputSchema: toMcpJsonSchema(startLocalSeoRefreshInputSchema),
  },
  {
    name: 'get_job_status',
    description: 'Get status and latest payload for a specific background job.',
    inputSchema: toMcpJsonSchema(getJobStatusInputSchema),
  },
  {
    name: 'list_jobs',
    description: 'List recent background jobs for a workspace.',
    inputSchema: toMcpJsonSchema(listJobsInputSchema),
  },
  {
    name: 'cancel_job',
    description: 'Cancel a running background job for a workspace.',
    inputSchema: toMcpJsonSchema(cancelJobInputSchema),
  },
];

function runKeywordStrategyJob(
  jobId: string,
  workspaceId: string,
  options: (typeof startKeywordStrategyGenerationInputSchema)['_output']['options'],
): void {
  const jobWasCancelled = () => getJob(jobId)?.status === 'cancelled';
  setTimeout(() => {
    void (async () => {
      try {
        if (jobWasCancelled()) return;
        updateJob(jobId, {
          status: 'running',
          message: 'Generating keyword strategy...',
          progress: 0,
          total: 100,
        });
        const result = await generateKeywordStrategy({
          workspaceId,
          mode: options?.mode === 'incremental' ? 'incremental' : 'full',
          seoDataProvider: options?.seoDataProvider,
          competitorDomains: options?.competitorDomains,
          competitorDomainsProvided: Array.isArray(options?.competitorDomains),
          maxPages: options?.maxPages,
          onProgress: (evt) => {
            updateJob(jobId, {
              progress: Math.max(0, Math.min(100, Math.round(evt.progress * 100))),
              total: 100,
              message: evt.detail ? `${evt.step}: ${evt.detail}` : evt.step,
            });
          },
        });
        if (jobWasCancelled()) return;
        const pageCount = Array.isArray(result.strategy?.pageMap) ? result.strategy.pageMap.length : 0;
        updateJob(jobId, {
          status: 'done',
          progress: 100,
          total: 100,
          message: result.upToDate ? 'Strategy already up to date' : `Strategy complete — ${pageCount} pages mapped`,
          result: {
            upToDate: Boolean(result.upToDate),
            freshPageCount: result.freshPageCount,
            pageCount,
          },
        });
        addActivity(
          workspaceId,
          'strategy_generated',
          'Keyword strategy generation completed',
          result.upToDate ? 'Strategy already up to date' : `${pageCount} pages mapped`,
          {
            source: 'mcp-chat',
            jobId,
            action: 'mcp_keyword_strategy_job_done',
            pageCount,
            upToDate: Boolean(result.upToDate),
          },
        );
      } catch (err) {
        if (jobWasCancelled()) return;
        const message = err instanceof KeywordStrategyGenerationError
          ? (err.payload.message || err.payload.error)
          : err instanceof Error
            ? err.message
            : String(err);
        updateJob(jobId, {
          status: 'error',
          message: 'Keyword strategy generation failed',
          error: message,
        });
      }
    })();
  }, 25);
}

async function handleStartKeywordStrategyGeneration(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = startKeywordStrategyGenerationInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const { workspace_id: workspaceId, options } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;
  if (!workspace.webflowSiteId) return mcpError('Workspace has no linked Webflow site');

  if (options?.maxPages && options.maxPages > KEYWORD_STRATEGY_MAX_PAGE_CAP) {
    return mcpError(`maxPages must be <= ${KEYWORD_STRATEGY_MAX_PAGE_CAP}`);
  }
  if (hasActiveKeywordStrategyGeneration(workspaceId)) {
    return mcpError('A keyword strategy is already being generated for this workspace');
  }
  const activeJob = hasActiveJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, workspaceId);
  if (activeJob) {
    return mcpError(`A keyword strategy job is already running (${activeJob.id})`);
  }

  const job = createJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, {
    workspaceId,
    message: 'Generating keyword strategy...',
    total: 100,
  });
  runKeywordStrategyJob(job.id, workspaceId, options);

  return mcpSuccess({
    ok: true,
    job_id: job.id,
    job_type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
    dashboard_url: buildDashboardUrl(workspaceId),
  });
}

function runSeoAuditJob(
  jobId: string,
  workspaceId: string,
  siteId: string,
  skipLinkCheck: boolean,
): void {
  setTimeout(() => {
    void (async () => {
      try {
        updateJob(jobId, { status: 'running', message: 'Running SEO audit...' });
        const token = getTokenForSite(siteId) || undefined;
        if (!token) {
          updateJob(jobId, {
            status: 'error',
            message: 'SEO audit failed',
            error: 'No Webflow API token configured',
          });
          return;
        }
        const result = await runSeoAudit(siteId, token, workspaceId, skipLinkCheck);
        broadcastToWorkspace(workspaceId, WS_EVENTS.AUDIT_COMPLETE, {
          score: result.siteScore,
          previousScore: null,
        });
        updateJob(jobId, {
          status: 'done',
          message: `Audit complete — score ${result.siteScore}`,
          result: {
            siteScore: result.siteScore,
            totalPages: result.totalPages,
            errors: result.errors,
            warnings: result.warnings,
          },
        });
        addActivity(
          workspaceId,
          'audit_completed',
          `Site audit completed — score ${result.siteScore}`,
          `${result.totalPages} pages scanned, ${result.errors} errors, ${result.warnings} warnings`,
          {
            source: 'mcp-chat',
            jobId,
            action: 'mcp_seo_audit_job_done',
            score: result.siteScore,
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateJob(jobId, {
          status: 'error',
          message: 'SEO audit failed',
          error: message,
        });
      }
    })();
  }, 25);
}

async function handleStartSeoAudit(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = startSeoAuditInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const { workspace_id: workspaceId, site_id: siteId, options } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;
  if (workspace.webflowSiteId !== siteId) {
    return mcpError(`Workspace ${workspaceId} is not linked to site ${siteId}`);
  }

  const active = hasActiveJob(BACKGROUND_JOB_TYPES.SEO_AUDIT, workspaceId);
  if (active) return mcpError(`An SEO audit is already running (${active.id})`);

  const job = createJob(BACKGROUND_JOB_TYPES.SEO_AUDIT, {
    workspaceId,
    message: 'Running SEO audit...',
  });
  runSeoAuditJob(job.id, workspaceId, siteId, options?.skip_link_check === true);

  return mcpSuccess({
    ok: true,
    job_id: job.id,
    job_type: BACKGROUND_JOB_TYPES.SEO_AUDIT,
    dashboard_url: buildDashboardUrl(workspaceId),
  });
}

async function handleStartLocalSeoRefresh(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = startLocalSeoRefreshInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const { workspace_id: workspaceId, refresh_body: refreshBodyRaw } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const activeWorkspaceJob = hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, workspaceId);
  if (activeWorkspaceJob) return mcpError(`Local SEO refresh is already running (${activeWorkspaceJob.id})`);
  const globalActiveJob = hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH);
  if (globalActiveJob) {
    return mcpError(`Another workspace is currently running local SEO refresh (${globalActiveJob.id})`);
  }

  const refreshBody = refreshBodyRaw as LocalSeoRefreshRequest;
  const plan = createLocalSeoRefreshPlan(workspaceId, refreshBody);
  if (!plan) return mcpError(`Workspace not found: ${workspaceId}`);

  const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
    workspaceId,
    total: Math.max(1, plan.markets.length * plan.keywords.length),
    message: 'Preparing local SEO visibility refresh...',
  });
  runLocalSeoRefreshJob(job.id, workspaceId, refreshBody).catch((err) => {
    log.error({ err, jobId: job.id, workspaceId }, 'Local SEO refresh escaped job runner');
    updateJob(job.id, {
      status: 'error',
      message: 'Local SEO refresh failed unexpectedly',
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return mcpSuccess({
    ok: true,
    job_id: job.id,
    job_type: BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH,
    selected_market_count: plan.markets.length,
    selected_keyword_count: plan.keywords.length,
    dashboard_url: buildDashboardUrl(workspaceId, 'local-seo'),
  });
}

function requireJobWorkspaceMatch(
  workspaceId: string,
  jobId: string,
): Job | McpToolErrorResponse {
  const job = getJob(jobId);
  if (!job) return mcpError(`Job not found: ${jobId}`);
  if (job.workspaceId && job.workspaceId !== workspaceId) {
    return mcpError(`Job ${jobId} does not belong to workspace ${workspaceId}`);
  }
  if (!job.workspaceId) {
    return mcpError(`Job ${jobId} is not workspace-scoped and is not accessible from this tool`);
  }
  return job;
}

async function handleGetJobStatus(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = getJobStatusInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, job_id: jobId } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const job = requireJobWorkspaceMatch(workspaceId, jobId);
  if ('isError' in job) return job;

  return mcpSuccess({
    job,
    dashboard_url: buildDashboardUrl(workspaceId),
  });
}

async function handleListJobs(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = listJobsInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, status, limit } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const jobs = listJobs(workspaceId)
    .filter(job => (status ? job.status === status : true))
    .slice(0, limit ?? 50);

  return mcpSuccess({
    jobs,
    dashboard_url: buildDashboardUrl(workspaceId),
  });
}

async function handleCancelJob(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = cancelJobInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, job_id: jobId } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const existing = requireJobWorkspaceMatch(workspaceId, jobId);
  if ('isError' in existing) return existing;

  const job = cancelJob(jobId);
  if (!job) return mcpError(`Job not found: ${jobId}`);

  return mcpSuccess({
    ok: true,
    job,
    dashboard_url: buildDashboardUrl(workspaceId),
  });
}

export async function handleJobActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  if (name === 'start_keyword_strategy_generation') return handleStartKeywordStrategyGeneration(args);
  if (name === 'start_seo_audit') return handleStartSeoAudit(args);
  if (name === 'start_local_seo_refresh') return handleStartLocalSeoRefresh(args);
  if (name === 'get_job_status') return handleGetJobStatus(args);
  if (name === 'list_jobs') return handleListJobs(args);
  if (name === 'cancel_job') return handleCancelJob(args);
  return mcpError(`Unknown job action tool: ${name}`);
}
