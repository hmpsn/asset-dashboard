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
  findBySourceRef,
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

  // Guarantee 1: state-machine-guarded entry. Two cases, both guarded against the
  // per-type machine (notification types are never sendable through this path):
  //   (a) FRESH send: the new row is born at draft → awaiting_client.
  //   (b) RESEND (sourceRef collides with an existing row): upsertDeliverable's
  //       ON CONFLICT DO UPDATE will overwrite the existing row's status back to
  //       awaiting_client. We MUST therefore guard from the row's ACTUAL current
  //       status — a resend onto a still-pending awaiting_client/changes_requested row
  //       is the intended "supersede", but a resend onto a terminal
  //       approved/applied/declined/completed row must throw InvalidTransitionError
  //       rather than silently revert (and null decided_at/applied_at/note).
  const transitions = getDeliverableTransitions(type);
  const sourceRef = adapter.sourceRef(input);
  const existing = sourceRef != null ? findBySourceRef(workspaceId, type, sourceRef) : null;
  validateTransition('deliverable', transitions, existing ? existing.status : 'draft', 'awaiting_client');

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
    sourceRef,
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

  // R2 — respond propagation (the LINCHPIN): after writing the deliverable mirror status, push
  // the SAME decision into the real SOURCE artifact (legacy approval batch / client_action /
  // schema plan) via the adapter, reusing the existing per-type source-writing logic. Without
  // this, a client "Approve" in the unified inbox is a silent no-op on the work the operator/
  // apply logic actually reads. Physical types implement respondToSource; notification/
  // decision-less (work_order/briefing) and projected (copy/content_request) types do not.
  //
  // AVOID DOUBLE-NOTIFY: the source-respond logic already emails/signals the team (APPROVAL_
  // UPDATE + team email, CLIENT_ACTION team-approved email, SCHEMA_PLAN_SENT). When the adapter
  // reports `handled`, we SUPPRESS the deliverable-level team email below — the source path owns
  // it. We always keep the DELIVERABLE_UPDATED broadcast (the unified inbox UI listens on it).
  let sourceHandledTeamNotify = false;
  if (adapter.respondToSource) {
    const result = await adapter.respondToSource(workspaceId, responded, input.decision, {
      note: input.note ?? null,
    });
    sourceHandledTeamNotify = result.handled;
  }

  // Guarantee 4: team notification on every outcome — UNLESS the source path already owns it
  // (no double-notify). Types without a respondToSource still notify here as before.
  if (!sourceHandledTeamNotify) {
    notifyTeamOfResponse(workspaceId, responded, input.decision);
  }
  // INTENTIONAL two-phase broadcast (do NOT "optimize" into a single emit): on an opt-in
  // apply this emits DELIVERABLE_UPDATED status:approved here, then a SECOND
  // status:applied from applyApprovedDeliverable after the (slow) external apply call.
  // The double emit (+ double invalidateIntelligenceCache) lets the UI reflect "approved"
  // immediately while the Webflow write is in flight, then flips to "applied" when it lands.
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

/**
 * Re-nudge the client about a still-pending deliverable (admin "remind"). Generalizes
 * the approval-reminder prior art across every type (design §6, E4). No-op-safe when
 * email is unconfigured. Returns the deliverable so the route can echo it back.
 */
export function remindDeliverable(workspaceId: string, deliverableId: string): ClientDeliverable {
  const current = getDeliverable(deliverableId);
  if (!current || current.workspaceId !== workspaceId) {
    throw new SendToClientError('Deliverable not found', 404);
  }
  notifyClientOfSend(workspaceId, current);
  broadcastToWorkspace(workspaceId, WS_EVENTS.DELIVERABLE_UPDATED, {
    deliverableId: current.id,
    type: current.type,
    status: current.status,
    reminded: true,
  });
  log.debug({ workspaceId, deliverableId }, 'deliverable reminder sent');
  return current;
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
