import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { getBrief } from '../../content-brief.js';
import {
  createContentRequest,
  ExplicitContentRequestNotFoundError,
  getContentRequest,
  getOpenRequestForBrief,
  updateContentRequest,
} from '../../content-requests.js';
import db from '../../db/index.js';
import { notifyClientBriefReady } from '../../email.js';
import { GenerationRevisionConflictError } from '../../generation-provenance.js';
import { invalidateContentPipelineIntelligence } from '../../intelligence-freshness.js';
import { createLogger } from '../../logger.js';
import { getClientInboxReviewsUrl, getWorkspace } from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import type { ContentBrief, ContentTopicRequest } from '../../../shared/types/content.js';
import { CONTENT_REQUEST_TRANSITIONS } from '../../state-machines.js';

const log = createLogger('send-brief-to-client');

function runPostCommitEffect(
  effectName: string,
  context: { workspaceId: string; briefId: string; requestId: string },
  effect: () => void,
): void {
  try {
    effect();
  } catch (error) {
    try {
      log.warn({ ...context, effectName, err: error }, 'brief send post-commit effect failed');
    } catch { // catch-ok -- failure reporting must not undo a committed send.
    }
  }
}

export class BriefNotFoundError extends Error {
  readonly workspaceId: string;
  readonly briefId: string;

  constructor(workspaceId: string, briefId: string) {
    super(`Brief not found: ${briefId}`);
    this.name = 'BriefNotFoundError';
    this.workspaceId = workspaceId;
    this.briefId = briefId;
  }
}

export class BriefReviewRequestLifecycleConflictError extends Error {
  readonly code = 'brief_review_request_lifecycle_conflict' as const;
  readonly requestId: string;
  readonly status: ContentTopicRequest['status'];

  constructor(requestId: string, status: ContentTopicRequest['status']) {
    super(
      `Content request ${requestId} cannot enter brief review from status "${status}". `
      + 'Send without requestId to create or reuse a compatible review request.',
    );
    this.name = 'BriefReviewRequestLifecycleConflictError';
    this.requestId = requestId;
    this.status = status;
  }
}

function canEnterClientReview(status: ContentTopicRequest['status']): boolean {
  return status === 'client_review'
    || CONTENT_REQUEST_TRANSITIONS[status]?.includes('client_review') === true;
}

export interface SendBriefToClientOptions {
  note?: string;
  requestId?: string;
  expectedRevision?: number;
  activitySource?: string;
  activityMetadata?: Record<string, unknown>;
  /** Synchronous DB-only authorization commit; rolls back with a failed send. */
  commitAuthorization?: () => void;
}

export interface SendBriefToClientResult {
  request: ContentTopicRequest;
  brief: ContentBrief;
  created: boolean;
  changed: boolean;
}

/**
 * Atomically link/send a brief for client review. The request transition and
 * brief revision bump either both win or both roll back; stale callers create
 * no review row and produce no notification or success event.
 */
export function sendBriefToClientForReview(
  workspaceId: string,
  briefId: string,
  options: SendBriefToClientOptions = {},
): SendBriefToClientResult {
  const accepted = db.transaction(() => {
    const observedBrief = getBrief(workspaceId, briefId);
    if (!observedBrief) throw new BriefNotFoundError(workspaceId, briefId);
    const revision = options.expectedRevision ?? observedBrief.generationRevision;
    if (observedBrief.generationRevision !== revision) {
      throw new GenerationRevisionConflictError('content_brief', briefId, revision);
    }

    const explicit = options.requestId
      ? getContentRequest(workspaceId, options.requestId)
      : undefined;
    if (options.requestId && !explicit) {
      throw new ExplicitContentRequestNotFoundError(workspaceId, options.requestId);
    }
    if (explicit && !canEnterClientReview(explicit.status)) {
      throw new BriefReviewRequestLifecycleConflictError(explicit.id, explicit.status);
    }
    const implicit = getOpenRequestForBrief(workspaceId, briefId);
    const existing = explicit ?? (implicit && canEnterClientReview(implicit.status) ? implicit : undefined);

    const request = existing ?? createContentRequest(workspaceId, {
      topic: observedBrief.suggestedTitle,
      targetKeyword: observedBrief.targetKeyword,
      intent: observedBrief.intent || 'informational',
      priority: 'medium',
      rationale: observedBrief.executiveSummary || `Content brief for "${observedBrief.targetKeyword}"`,
      source: 'strategy',
      serviceType: 'brief_only',
      pageType: observedBrief.pageType || 'blog',
      initialStatus: 'brief_generated',
      clientNote: options.note,
      dedupe: false,
    });
    const tokenBefore = request.updatedAt;
    const updated = updateContentRequest(
      workspaceId,
      request.id,
      {
        briefId: observedBrief.id,
        status: 'client_review',
        clientNote: options.note,
      },
      {
        linkedArtifactAuthority: {
          artifactType: 'content_brief',
          artifactId: observedBrief.id,
          expectedRevision: revision,
        },
      },
    );
    if (!updated) throw new Error(`Content request disappeared during send: ${request.id}`);
    const acceptedBrief = getBrief(workspaceId, briefId);
    if (!acceptedBrief) throw new BriefNotFoundError(workspaceId, briefId);
    options.commitAuthorization?.();
    return {
      request: updated,
      brief: acceptedBrief,
      created: !existing,
      changed: !existing || updated.updatedAt !== tokenBefore,
    };
  }).immediate();

  if (!accepted.changed) return accepted;

  const effectContext = {
    workspaceId,
    briefId: accepted.brief.id,
    requestId: accepted.request.id,
  };
  runPostCommitEffect('client_email', effectContext, () => {
    const ws = getWorkspace(workspaceId);
    if (!ws?.clientEmail) return;
    notifyClientBriefReady({
      clientEmail: ws.clientEmail,
      workspaceName: ws.name,
      workspaceId,
      topic: accepted.brief.suggestedTitle,
      targetKeyword: accepted.brief.targetKeyword,
      dashboardUrl: getClientInboxReviewsUrl(ws),
    });
  });
  runPostCommitEffect('intelligence_invalidation', effectContext, () => {
    invalidateContentPipelineIntelligence(workspaceId);
  });
  runPostCommitEffect('request_broadcast', effectContext, () => {
    broadcastToWorkspace(
      workspaceId,
      accepted.created ? WS_EVENTS.CONTENT_REQUEST_CREATED : WS_EVENTS.CONTENT_REQUEST_UPDATE,
      { id: accepted.request.id, status: accepted.request.status },
    );
  });
  runPostCommitEffect('content_broadcast', effectContext, () => {
    broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, {
      action: 'brief_sent_to_client',
      briefId: accepted.brief.id,
      requestId: accepted.request.id,
    });
  });
  runPostCommitEffect('activity', effectContext, () => {
    addActivity(
      workspaceId,
      'brief_sent_for_review',
      `Sent brief "${accepted.brief.suggestedTitle}" to client`,
      `Keyword: ${accepted.brief.targetKeyword}`,
      {
        source: options.activitySource ?? 'admin',
        briefId: accepted.brief.id,
        requestId: accepted.request.id,
        note: options.note,
        action: 'brief_sent_to_client',
        ...options.activityMetadata,
      },
    );
  });
  runPostCommitEffect('success_log', effectContext, () => {
    log.info(
      { ...effectContext, created: accepted.created },
      'brief sent to client for review',
    );
  });
  return accepted;
}
