import { getSchemaPlan, updateSchemaPlanStatus } from '../../schema-store.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';
import { createLogger } from '../../logger.js';
import { invalidateIntelligenceCache } from '../../workspace-intelligence.js';
import { broadcastSchemaPlanUpdated } from '../../schema-plan-generation-job.js';
import { hasActiveJob } from '../../jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs.js';
import type { SchemaSitePlan } from '../../../shared/types/schema-plan.js';

const log = createLogger('schema-plan-feedback');

export type SchemaPlanFeedbackAction = 'approve' | 'request_changes';

export interface RespondToSchemaPlanResult {
  plan: SchemaSitePlan;
  status: 'client_approved' | 'client_changes_requested';
}

export class SchemaPlanFeedbackConflictError extends Error {
  readonly status = 409;
  readonly jobId: string;

  constructor(message: string, jobId: string) {
    super(message);
    this.name = 'SchemaPlanFeedbackConflictError';
    this.jobId = jobId;
  }
}

export function assertSchemaPlanFeedbackAllowed(workspaceId: string): void {
  const activeJob = hasActiveJob(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION, workspaceId);
  if (activeJob) {
    throw new SchemaPlanFeedbackConflictError(
      'Schema plan generation is in progress. Wait for it to finish before responding to this plan.',
      activeJob.id,
    );
  }
}

export function respondToSchemaPlanFeedback(
  workspaceId: string,
  siteId: string,
  action: SchemaPlanFeedbackAction,
  note?: string | null,
): RespondToSchemaPlanResult | null {
  assertSchemaPlanFeedbackAllowed(workspaceId);

  const existing = getSchemaPlan(siteId);
  if (!existing) {
    log.warn({ workspaceId, siteId }, 'respondToSchemaPlanFeedback: no plan found for site');
    return null;
  }

  // Defense-in-depth: feedback is only valid on plans that have been sent to the client.
  // Plans in 'draft', 'active', or already-terminal states cannot receive new feedback.
  const feedbackAllowedStatuses: SchemaSitePlan['status'][] = ['sent_to_client'];
  if (!feedbackAllowedStatuses.includes(existing.status)) {
    log.warn({ workspaceId, siteId, status: existing.status }, 'respondToSchemaPlanFeedback: plan is not in a state that accepts feedback — ignoring');
    return null;
  }

  const newStatus: RespondToSchemaPlanResult['status'] =
    action === 'approve' ? 'client_approved' : 'client_changes_requested';
  const plan = updateSchemaPlanStatus(siteId, newStatus);
  if (!plan) {
    log.warn({ workspaceId, siteId }, 'respondToSchemaPlanFeedback: updateSchemaPlanStatus returned null');
    return null;
  }

  const label = action === 'approve' ? 'approved' : 'requested changes on';
  addActivity(workspaceId, 'changes_requested', `Client ${label} schema plan`, note || undefined);
  invalidateIntelligenceCache(workspaceId);
  broadcastSchemaPlanUpdated(workspaceId, {
    siteId,
    action: 'client_feedback',
    status: newStatus,
  });
  broadcastToWorkspace(workspaceId, WS_EVENTS.SCHEMA_PLAN_SENT, {
    siteId,
    action: 'schema_plan_feedback',
    status: newStatus,
  });

  return { plan, status: newStatus };
}
