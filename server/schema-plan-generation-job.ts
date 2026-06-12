import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { isProgrammingError } from './errors.js';
import { buildSchemaContext } from './helpers.js';
import { buildSchemaIntelligence } from './schema-intelligence.js';
import { getSchemaSnapshot } from './schema-store.js';
import { generateSchemaPlan } from './schema-plan.js';
import { getCachedArchitecture } from './site-architecture.js';
import { createJob, getJob, hasActiveJob, updateJob } from './jobs.js';
import { createLogger } from './logger.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { getWorkspace, getWorkspaceBySiteId } from './workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import { WS_EVENTS } from './ws-events.js';
import type { SchemaPlanGenerationResponse, SchemaSitePlan } from '../shared/types/schema-plan.js';

const log = createLogger('schema-plan-generation-job');

type SchemaPlanUpdateAction =
  | 'generated'
  | 'updated'
  | 'sent_to_client'
  | 'activated'
  | 'deleted'
  | 'client_feedback';

class SchemaPlanStartError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getSchemaPlanWorkspace(siteId: string, workspaceId?: string) {
  if (workspaceId) {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) {
      throw new SchemaPlanStartError(404, 'Workspace not found');
    }
    if (workspace.webflowSiteId !== siteId) {
      throw new SchemaPlanStartError(403, 'You do not have access to this workspace');
    }
    return workspace;
  }

  const workspace = getWorkspaceBySiteId(siteId);
  if (!workspace) {
    throw new SchemaPlanStartError(404, 'No workspace found for this site');
  }
  return workspace;
}

function schemaPlanJobResultSummary(plan: SchemaSitePlan): Record<string, unknown> {
  return {
    persisted: true,
    siteId: plan.siteId,
    status: plan.status,
    pageCount: plan.pageRoles.length,
    canonicalEntityCount: plan.canonicalEntities.length,
    generatedAt: plan.generatedAt,
    updatedAt: plan.updatedAt,
  };
}

export function broadcastSchemaPlanUpdated(
  workspaceId: string,
  payload: {
    siteId: string;
    action: SchemaPlanUpdateAction;
    status?: SchemaSitePlan['status'];
    jobId?: string;
  },
): void {
  broadcastToWorkspace(workspaceId, WS_EVENTS.SCHEMA_PLAN_UPDATED, payload);
}

export function getActiveSchemaPlanGenerationJobId(workspaceId: string): string | null {
  return hasActiveJob(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION, workspaceId)?.id ?? null;
}

export function startSchemaPlanGenerationJob(
  siteId: string,
  workspaceId?: string,
): SchemaPlanGenerationResponse {
  if (!siteId) {
    throw new SchemaPlanStartError(400, 'siteId required');
  }

  const workspace = getSchemaPlanWorkspace(siteId, workspaceId);
  const activeJob = hasActiveJob(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION, workspace.id);
  if (activeJob) {
    return { jobId: activeJob.id, existing: true };
  }

  const job = createJob(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION, {
    workspaceId: workspace.id,
    message: 'Generating schema plan...',
  });

  setTimeout(() => {
    void runSchemaPlanGenerationJob(job.id, siteId, workspace.id);
  }, 100);

  return { jobId: job.id };
}

export function schemaPlanGenerationErrorResponse(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof SchemaPlanStartError) {
    return {
      status: err.status,
      body: { error: err.message },
    };
  }
  throw err;
}

export async function runSchemaPlanGenerationJob(
  jobId: string,
  siteId: string,
  workspaceId: string,
): Promise<void> {
  const jobWasCancelled = () => getJob(jobId)?.status === 'cancelled';
  if (jobWasCancelled()) return;

  try {
    updateJob(jobId, {
      status: 'running',
      progress: 5,
      total: 100,
      message: 'Loading schema context...',
    });

    const { ctx } = await buildSchemaContext(siteId);
    if (jobWasCancelled()) return;

    updateJob(jobId, {
      status: 'running',
      progress: 25,
      total: 100,
      message: 'Gathering intelligence...',
    });

    const workspace = getWorkspace(workspaceId) ?? getWorkspaceBySiteId(siteId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    const schemaIntel = await buildSchemaIntelligence({ siteId });
    if (jobWasCancelled()) return;

    updateJob(jobId, {
      status: 'running',
      progress: 45,
      total: 100,
      message: 'Checking site architecture...',
    });

    let architectureResult: Awaited<ReturnType<typeof getCachedArchitecture>> | undefined;
    try {
      architectureResult = await getCachedArchitecture(workspace.id);
    } catch (err) {
      if (isProgrammingError(err)) {
        log.warn({ err, workspaceId, siteId }, 'Schema plan job could not load cached architecture');
      }
    }

    const existingSnapshot = getSchemaSnapshot(siteId);
    const ourSchemaTypes = existingSnapshot
      ? [...new Set(existingSnapshot.results.flatMap(page =>
          page.suggestedSchemas?.flatMap(schema => schema.type?.split(' + ') || []) || []
        ))]
      : [];

    updateJob(jobId, {
      status: 'running',
      progress: 70,
      total: 100,
      message: 'Generating site-wide schema plan...',
    });

    const plan = await generateSchemaPlan({
      siteId,
      workspaceId: workspace.id,
      siteUrl: schemaIntel?.baseUrl ?? (ctx.liveDomain ? `https://${ctx.liveDomain}` : ''),
      companyName: ctx.companyName,
      businessContext: ctx.businessContext,
      strategy: schemaIntel?.seoContext?.strategy,
      architectureResult,
      competitorDomains: workspace.competitorDomains,
      ourSchemaTypes,
    });

    if (jobWasCancelled()) return;

    invalidateIntelligenceCache(workspace.id);
    addActivity(
      workspace.id,
      'schema_plan_generated',
      'Schema site plan generated',
      `${plan.pageRoles.length} pages, ${plan.canonicalEntities.length} entities`,
    );
    broadcastSchemaPlanUpdated(workspace.id, {
      siteId,
      action: 'generated',
      status: plan.status,
      jobId,
    });

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      total: 100,
      message: `Schema plan ready — ${plan.pageRoles.length} pages mapped`,
      result: schemaPlanJobResultSummary(plan),
    });
  } catch (err) {
    if (jobWasCancelled()) return;
    if (isProgrammingError(err)) {
      log.warn({ err, workspaceId, siteId, jobId }, 'Schema plan generation job failed with programming error');
    } else {
      log.debug({ err, workspaceId, siteId, jobId }, 'Schema plan generation job failed');
    }
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'Schema plan generation failed',
    });
  }
}
