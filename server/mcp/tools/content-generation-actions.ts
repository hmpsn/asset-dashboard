import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  startBriefGenerationInputSchema,
  startPostGenerationInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs.js';
import { getBrief } from '../../content-brief.js';
import { startContentBriefGenerationJob } from '../../content-brief-generation-job.js';
import { createContentPostGenerationJob, runContentPostGenerationJob } from '../../content-posts.js';
import { getContentRequest } from '../../content-requests.js';
import { hasActiveJob } from '../../jobs.js';
import { recordPaidCall } from '../paid-call-counter.js';
import { createLogger } from '../../logger.js';
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

const log = createLogger('mcp-tools-content-generation-actions');

export const contentGenerationActionTools: Tool[] = [
  {
    name: 'start_brief_generation',
    description:
      '[Paid API] Start a SERVER-SIDE grounded content-brief generation as a background job. The job runs the full research pass (GSC/GA4 enrichment, SERP + competitor scraping, keyword metrics) on the server, persists the brief, and broadcasts on completion. Returns a job_id — poll get_job_status. Provide target_keyword for a standalone brief, or request_id to generate for an existing content request.',
    inputSchema: toMcpJsonSchema(startBriefGenerationInputSchema),
  },
  {
    name: 'start_post_generation',
    description:
      '[Paid API] Start a SERVER-SIDE grounded full-post generation from a saved brief as a background job. The job generates the introduction, each outline section, conclusion, a unification pass, and SEO metadata on the server, persists the draft, and broadcasts on completion. Returns a job_id — poll get_job_status.',
    inputSchema: toMcpJsonSchema(startPostGenerationInputSchema),
  },
];

async function handleStartBriefGeneration(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = startBriefGenerationInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const {
    workspace_id: workspaceId,
    target_keyword: targetKeyword,
    request_id: requestId,
    business_context: businessContext,
    page_type: pageType,
    reference_urls: referenceUrls,
    generation_style: generationStyle,
  } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  // A standalone brief is keyed off target_keyword; a request brief is keyed off the
  // content request (which already carries its keyword/intent/page type). Exactly one
  // of the two must be supplied.
  if (!requestId && !targetKeyword) {
    return mcpError('Provide target_keyword (standalone brief) or request_id (request brief).');
  }

  const activeBriefJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, workspaceId);
  if (activeBriefJob) {
    return mcpError(`Content brief generation is already running for this workspace (${activeBriefJob.id})`);
  }

  let started: { jobId: string };
  try {
    if (requestId) {
      const request = getContentRequest(workspaceId, requestId);
      if (!request) return mcpError(`Content request not found: ${requestId}`);
      // The grounded generation + persistence + broadcast + activity all live inside the
      // shared service (server/content-brief-generation-job.ts). The job platform owns the
      // job lifecycle and broadcasts JOB_* events; do not broadcast or write the DB here.
      started = startContentBriefGenerationJob({
        source: 'request',
        workspaceId,
        requestId,
        generationStyle,
      });
    } else {
      started = startContentBriefGenerationJob({
        source: 'standalone',
        workspaceId,
        targetKeyword: targetKeyword!,
        businessContext,
        pageType,
        referenceUrls: referenceUrls && referenceUrls.length > 0 ? referenceUrls : undefined,
        generationStyle,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, workspaceId, targetKeyword, requestId }, 'start_brief_generation failed');
    return mcpError(`Failed to start brief generation: ${message}`);
  }

  // Paid provider work runs inside the job — count it so the paid-call signal covers all
  // paid MCP triggers (mirrors start_keyword_strategy_generation in job-actions.ts).
  const { warning } = recordPaidCall(1, workspaceId);
  return mcpSuccess({
    ok: true,
    job_id: started.jobId,
    job_type: BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION,
    dashboard_url: buildDashboardUrl(workspaceId, 'content'),
    ...(warning ? { warning } : {}),
  });
}

async function handleStartPostGeneration(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = startPostGenerationInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const {
    workspace_id: workspaceId,
    brief_id: briefId,
    generation_style: generationStyle,
  } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const brief = getBrief(workspaceId, briefId);
  if (!brief) return mcpError(`Brief not found: ${briefId}`);

  const activePostJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, workspaceId);
  if (activePostJob) {
    return mcpError(`Content post generation is already running for this workspace (${activePostJob.id})`);
  }

  // createContentPostGenerationJob persists the post skeleton, creates the job, and
  // broadcasts the start (POST_UPDATED + CONTENT_UPDATED) inside the shared service.
  // runContentPostGenerationJob runs the grounded section-by-section generation and owns
  // the done/error/cancelled job transitions + completion broadcasts. The MCP tool only
  // kicks it off and returns the job_id — it never writes the DB or broadcasts directly.
  let started;
  try {
    started = createContentPostGenerationJob(workspaceId, brief, generationStyle);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, workspaceId, briefId }, 'start_post_generation failed');
    return mcpError(`Failed to start post generation: ${message}`);
  }
  runContentPostGenerationJob({
    workspaceId,
    brief: started.brief,
    postId: started.postId,
    jobId: started.jobId,
  });

  // Paid provider/AI work runs inside the job — count it (see start_brief_generation).
  const { warning } = recordPaidCall(1, workspaceId);
  return mcpSuccess({
    ok: true,
    job_id: started.jobId,
    post_id: started.postId,
    job_type: BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION,
    dashboard_url: buildDashboardUrl(workspaceId, 'content'),
    ...(warning ? { warning } : {}),
  });
}

export async function handleContentGenerationActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  if (name === 'start_brief_generation') return handleStartBriefGeneration(args);
  if (name === 'start_post_generation') return handleStartPostGeneration(args);
  return mcpError(`Unknown content generation action tool: ${name}`);
}
