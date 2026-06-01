/**
 * send-to-client — the one service behind every "send to client" surface (Phase 0, dark).
 *
 * `sendToClient()` performs the five structural guarantees (design §4.3) that NO
 * caller can bypass, and `respondToDeliverable()` is the one shared response handler
 * (design §4.4). Both delegate per-type behavior to the registered adapter; the store
 * (`server/client-deliverables.ts`) is the only table writer.
 *
 *   sendToClient guarantees:
 *     0. adapter.validateSendable(input) — reject not-ready inputs before anything else
 *     1. state-machine-guarded insert (draft → awaiting_client), sets sent_at
 *     2. adapter.buildPayload(input) — typed payload (+ child items)
 *     3. client notification (email + broadcast DELIVERABLE_SENT)
 *     4. (response time) team notification on EVERY outcome + apply only if the adapter opted in
 *
 * Apply is OPT-IN (default no-op, D-apply): "client approved" and "write to
 * source-of-truth" stay two distinct transitions during cutover, and the Webflow apply
 * runs OUTSIDE the DB transaction (mark-pending → external call → mark-applied) per the
 * CLAUDE.md external-call-before-write guard.
 *
 * Leaf rule (audit lesson): this module imports the store + registry + broadcast + email,
 * but is NOT imported back by any of them — no circular value-import.
 */
import {
  getDeliverable,
  upsertDeliverable,
  type UpsertDeliverableInput,
} from '../../client-deliverables.js';
import {
  CLIENT_DELIVERABLE_TRANSITIONS,
  getDeliverableTransitions,
  validateTransition,
} from '../../state-machines.js';
import { getAdapter } from './deliverable-adapters/index.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';
import { createLogger } from '../../logger.js';
import {
  isEmailConfigured,
  notifyApprovalReady,
  notifyTeamActionApproved,
  notifyTeamChangesRequested,
} from '../../email.js';
import { getClientPortalUrl, getWorkspace } from '../../workspaces.js';
import { invalidateIntelligenceCache } from '../../workspace-intelligence.js';
import type { ClientDeliverable, DeliverableType } from '../../../shared/types/client-deliverable.js';

const log = createLogger('send-to-client');

export class SendToClientError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SendToClientError';
    this.status = status;
  }
}

export type DeliverableResponseDecision = 'approved' | 'changes_requested' | 'declined';

export interface SendToClientOptions {
  /** Operator send-note → drives the Decisions-vs-Conversations inbox routing. */
  note?: string | null;
  /** Optional explicit ISO sent-at (defaults to now). */
  sentAt?: string;
  source?: string | null;
  dueAt?: string | null;
}

/**
 * Send a deliverable of `type` to the client. Runs the five guarantees and returns the
 * persisted deliverable. Throws SendToClientError(422) if the adapter rejects the input.
 */
export async function sendToClient<TInput>(
  workspaceId: string,
  type: DeliverableType,
  input: TInput,
  opts: SendToClientOptions = {},
): Promise<ClientDeliverable> {
  const adapter = getAdapter(type);

  // Guarantee 0: reject not-ready inputs before anything else.
  const sendable = adapter.validateSendable(input);
  if (!sendable.ok) {
    throw new SendToClientError(`Cannot send ${type}: ${sendable.reason}`, 422);
  }

  // Guarantee 2: typed payload (+ child items).
  const built = adapter.buildPayload(input);

  // Guarantee 1: state-machine-guarded entry. The new row is born at draft then
  // transitions to awaiting_client — validateTransition asserts the move is legal for
  // this type (notification types are never sendable through this path).
  const transitions = getDeliverableTransitions(type);
  validateTransition('deliverable', transitions, 'draft', 'awaiting_client');

  const nowIso = opts.sentAt ?? new Date().toISOString();
  const upsertInput: UpsertDeliverableInput = {
    workspaceId,
    type,
    kind: built.kind,
    status: 'awaiting_client',
    title: built.title,
    summary: built.summary ?? null,
    payload: built.payload,
    note: opts.note ?? null,
    externalRef: built.externalRef ?? null,
    parentDeliverableId: built.parentDeliverableId ?? null,
    sentAt: nowIso,
    generatedAt: nowIso,
    source: opts.source ?? null,
    sourceRef: adapter.sourceRef(input),
    items: built.items,
  };
  const deliverable = upsertDeliverable(upsertInput);

  // Guarantee 3: client notification (email guarded + broadcast).
  notifyClientOfSend(workspaceId, deliverable);
  broadcastToWorkspace(workspaceId, WS_EVENTS.DELIVERABLE_SENT, {
    deliverableId: deliverable.id,
    type,
  });
  invalidateIntelligenceCache(workspaceId);

  log.debug({ workspaceId, type, deliverableId: deliverable.id }, 'deliverable sent to client');
  return deliverable;
}

export interface RespondToDeliverableInput {
  decision: DeliverableResponseDecision;
  note?: string | null;
}

/**
 * The one shared response handler. Validates the transition, persists the client
 * response + note, emails the team on EVERY outcome (guarantee 4), broadcasts
 * DELIVERABLE_UPDATED, and — only when the adapter opted in (appliesOnApprove) and the
 * decision is `approved` — runs applyDeliverable OUTSIDE the DB transaction.
 */
export async function respondToDeliverable(
  workspaceId: string,
  deliverableId: string,
  input: RespondToDeliverableInput,
): Promise<ClientDeliverable> {
  const current = getDeliverable(deliverableId);
  if (!current || current.workspaceId !== workspaceId) {
    throw new SendToClientError('Deliverable not found', 404);
  }

  const adapter = getAdapter(current.type);
  const transitions = getDeliverableTransitions(current.type);
  // Guard the client decision against the per-type machine. Throws InvalidTransitionError
  // (which surfaces as a 4xx in the route) on an illegal move (e.g. approving a declined row).
  validateTransition('deliverable', transitions, current.status, input.decision);

  const nowIso = new Date().toISOString();
  const responded = upsertDeliverable(toUpsert(current, {
    status: input.decision,
    clientResponseNote: input.note ?? current.clientResponseNote ?? null,
    decidedAt: nowIso,
  }));

  // Guarantee 4: team notification on every outcome.
  notifyTeamOfResponse(workspaceId, responded, input.decision);
  broadcastToWorkspace(workspaceId, WS_EVENTS.DELIVERABLE_UPDATED, {
    deliverableId: responded.id,
    type: responded.type,
    status: responded.status,
  });
  invalidateIntelligenceCache(workspaceId);

  // Apply is OPT-IN, default no-op (D-apply). Only on approve, only if the adapter opted in.
  if (input.decision === 'approved' && adapter.appliesOnApprove && adapter.applyDeliverable) {
    return applyApprovedDeliverable(workspaceId, responded, adapter.applyDeliverable);
  }

  return responded;
}

/**
 * Run the adapter's apply OUTSIDE the DB transaction (external-call guard): the row is
 * already approved (persisted above); we call Webflow, then mark applied in a separate
 * write. A failed apply leaves the row approved (re-runnable) rather than half-written.
 */
async function applyApprovedDeliverable(
  workspaceId: string,
  approved: ClientDeliverable,
  apply: NonNullable<ReturnType<typeof getAdapter>['applyDeliverable']>,
): Promise<ClientDeliverable> {
  const result = await apply(approved);
  // mark-applied: a second transition (approved → applied), guarded.
  validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'approved', 'applied');
  const applied = upsertDeliverable(toUpsert(approved, {
    status: 'applied',
    appliedAt: new Date().toISOString(),
  }));
  broadcastToWorkspace(workspaceId, WS_EVENTS.DELIVERABLE_UPDATED, {
    deliverableId: applied.id,
    type: applied.type,
    status: applied.status,
    applied: result.applied,
  });
  invalidateIntelligenceCache(workspaceId);
  log.debug({ workspaceId, deliverableId: applied.id, applied: result.applied }, 'deliverable applied');
  return applied;
}

// ── helpers ──

/**
 * Rebuild a full UpsertDeliverableInput from an existing deliverable plus a patch.
 * Re-passes id + sourceRef so upsertDeliverable updates the SAME row in place, and
 * carries items only when they were loaded (avoids clobbering them with an empty set).
 */
function toUpsert(
  d: ClientDeliverable,
  patch: Partial<UpsertDeliverableInput>,
): UpsertDeliverableInput {
  return {
    id: d.id,
    workspaceId: d.workspaceId,
    type: d.type,
    kind: d.kind,
    status: d.status,
    title: d.title,
    summary: d.summary,
    payload: d.payload,
    note: d.note,
    clientResponseNote: d.clientResponseNote,
    parentDeliverableId: d.parentDeliverableId,
    externalRef: d.externalRef,
    sentAt: d.sentAt,
    decidedAt: d.decidedAt,
    dueAt: d.dueAt,
    appliedAt: d.appliedAt,
    generatedAt: d.generatedAt,
    source: d.source,
    sourceRef: d.sourceRef,
    ...patch,
  };
}

function notifyClientOfSend(workspaceId: string, deliverable: ClientDeliverable): void {
  if (!isEmailConfigured()) return;
  const ws = getWorkspace(workspaceId);
  if (!ws?.clientEmail) return;
  notifyApprovalReady({
    clientEmail: ws.clientEmail,
    workspaceName: ws.name,
    workspaceId,
    batchName: deliverable.title,
    itemCount: deliverable.items?.length ?? 1,
    dashboardUrl: getClientPortalUrl(ws),
  });
}

function notifyTeamOfResponse(
  workspaceId: string,
  deliverable: ClientDeliverable,
  decision: DeliverableResponseDecision,
): void {
  if (!isEmailConfigured()) return;
  const ws = getWorkspace(workspaceId);
  if (!ws) return;
  if (decision === 'approved') {
    notifyTeamActionApproved({
      workspaceName: ws.name,
      workspaceId,
      actionTitle: deliverable.title,
      sourceType: deliverable.type,
      actionSummary: deliverable.summary ?? '',
      clientNote: deliverable.clientResponseNote ?? undefined,
    });
  } else {
    // changes_requested / declined → a team-facing "client asked for changes" signal.
    notifyTeamChangesRequested({
      workspaceName: ws.name,
      workspaceId,
      topic: deliverable.title,
      targetKeyword: deliverable.type,
      feedback:
        (decision === 'declined' ? '[declined] ' : '') + (deliverable.clientResponseNote ?? ''),
    });
  }
}
