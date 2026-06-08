/**
 * schema_plan respond service (R2) — the reusable "client gave feedback on the schema
 * strategy" core, extracted from the route-inline logic in
 * `server/routes/webflow-schema.ts` (the public `/schema-plan/:workspaceId/feedback`
 * handler) so BOTH that route AND the unified-inbox `respondToSource` propagation drive the
 * SAME source write (no divergence).
 *
 * approve → plan status `client_approved`; request_changes → `client_changes_requested`.
 * Writes the plan status via `updateSchemaPlanStatus`, logs the activity, and broadcasts
 * `SCHEMA_PLAN_SENT` (same event the route fires) — this is the schema_plan family's single
 * source-write owner. Apply (operator publish of the per-page markup) stays a SEPARATE
 * transition (D-apply); R2 propagates only the decision/status.
 *
 * NOTE on team email: the legacy schema-plan feedback route does NOT send a team email
 * (unlike the approval/client_action families). To keep behavior identical to the existing
 * route — no new email where there wasn't one — this service does NOT send a team email
 * either. The unified `respondToDeliverable` still SUPPRESSES its own deliverable-level team
 * email for schema_plan (the source path owns the team-facing signal, which for schema_plan
 * is the activity log + broadcast, not an email), keeping the no-double-notify contract: the
 * source path is the single owner of the team-facing notification, whatever form it takes.
 *
 * Leaf rule: imports the schema store + activity + broadcast; not imported back by any of them.
 */
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

const log = createLogger('schema-plan-respond');

/** The client feedback action on a schema plan (matches the route's feedback schema). */
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

/**
 * Apply client schema-plan feedback to the legacy `schema_site_plans` row (R2 source write).
 *
 * Returns null when no plan exists for the site (best-effort miss for the unified path; the
 * route surfaces 404). Does NOT enforce the route's `status === 'sent_to_client'` precondition
 * — the unified inbox respond is already guarded by the deliverable state machine upstream, and
 * the schema_plan deliverable mirrors `sent_to_client` as `awaiting_client`, so a unified
 * respond only reaches here from the same pending state the route requires. Logged when the
 * plan is in an unexpected state but still written (the deliverable decision is authoritative).
 */
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
