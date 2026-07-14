import type {
  BrandReviewBundleKind,
  BrandReviewBundlePayload,
  BrandReviewClientDecisionRequest,
  BrandReviewDecisionReceipt,
  BrandReviewDeliverableInput,
  BrandReviewDeliverableReceipt,
  BrandReviewItemPayload,
  BrandReviewMirrorItemStatus,
  BrandSuiteReviewMirrorItemInput,
  BrandVoiceFoundationReviewMirrorItemInput,
  BrandGenerationItem,
} from '../../../shared/types/brand-generation.js';
import type { GenerationHumanReviewerAttribution } from '../../../shared/types/generation-evidence.js';
import type { BrandDeliverable } from '../../../shared/types/brand-engine.js';
import type { ClientDeliverable, ClientDeliverableItem } from '../../../shared/types/client-deliverable.js';
import db from '../../db/index.js';
import {
  BrandDeliverableStatusConflictError,
  BrandDeliverableVersionConflictError,
  getDeliverable as getBrandDeliverable,
  setDeliverableStatusCasInTransaction,
} from '../../brand-identity.js';
import {
  findBySourceRef,
  getDeliverable as getClientDeliverable,
  upsertDeliverable,
  type UpsertDeliverableInput,
} from '../../client-deliverables.js';
import { addActivityOnce } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { BRAND_IDENTITY_UPDATED_PAYLOAD, WS_EVENTS } from '../../ws-events.js';
import { createLogger } from '../../logger.js';
import {
  getDeliverableTransitions,
  InvalidTransitionError,
  validateTransition,
} from '../../state-machines.js';
import { generationResolverAttributionSchema } from '../../../shared/types/voice-finalization-schemas.js';
import {
  BrandGenerationRevisionConflictError,
} from './generation/errors.js';
import {
  getBrandGenerationItem,
  getPersistedBrandGenerationRun,
  listPersistedBrandGenerationItems,
  transitionBrandGenerationItem,
} from './generation/repository.js';
import {
  parseBrandReviewBundlePayload,
  parseBrandReviewClientDecisionRequest,
  parseBrandReviewItemPayload,
  brandReviewClientToken,
  projectClientBrandReviewDeliverable,
} from './review-contracts.js';
import {
  notifyTeamOfDeliverableResponse,
  sendToClient,
} from '../inbox/send-to-client.js';

const CANONICAL_PLACEHOLDER = /\[NEEDS CLIENT INPUT:\s*[^\]]+\]/;
const log = createLogger('brand-review-service');

function runBrandReviewPostCommitEffect(
  workspaceId: string,
  effect: string,
  run: () => void,
): void {
  try {
    run();
  } catch (err) {
    log.warn({ err, workspaceId, effect }, 'brand review post-commit effect failed');
  }
}

export type BrandReviewServiceErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'not_ready'
  | 'conflict'
  | 'corrupt_review';

export class BrandReviewServiceError extends Error {
  readonly code: BrandReviewServiceErrorCode;
  readonly status: number;

  constructor(code: BrandReviewServiceErrorCode, message: string, status: number) {
    super(message);
    this.name = 'BrandReviewServiceError';
    this.code = code;
    this.status = status;
  }
}

export interface CreateBrandReviewDeliverableOptions {
  note?: string | null;
  source?: string | null;
}

interface ParsedReview {
  deliverable: ClientDeliverable;
  payload: BrandReviewBundlePayload;
  items: Array<{ row: ClientDeliverableItem; payload: BrandReviewItemPayload }>;
}

function reviewSourceRef(reviewKind: BrandReviewBundleKind, runId: string): string {
  return `brand_generation:${reviewKind}:${runId}`;
}

function notReady(message: string): never {
  throw new BrandReviewServiceError('not_ready', message, 422);
}

function conflict(message: string): never {
  throw new BrandReviewServiceError('conflict', message, 409);
}

function unresolvedRequirementIds(item: BrandGenerationItem): string[] {
  return item.requirements
    .filter(requirement => (
      (requirement.requirementStage === 'preflight' || requirement.requirementStage === 'ready')
      && (requirement.status === 'missing' || requirement.status === 'conflicting')
    ))
    .map(requirement => requirement.id);
}

function foundationContent(item: Extract<BrandGenerationItem, { target: 'voice_foundation' }>): string {
  const draft = item.foundationDraft;
  if (!draft?.summary.trim()) notReady('Voice foundation has no reviewable draft');
  return draft.summary.trim();
}

function assertReviewReadyContent(item: BrandGenerationItem, content: string): string[] {
  const unresolved = unresolvedRequirementIds(item);
  if (unresolved.length > 0) {
    notReady(`${item.target} still has unresolved client-input requirements`);
  }
  if (item.placeholders.length > 0 || CANONICAL_PLACEHOLDER.test(content)) {
    notReady(`${item.target} still contains a client-input placeholder`);
  }
  if (!content.trim()) notReady(`${item.target} has no reviewable content`);
  return unresolved;
}

function aggregateStatus(items: Array<{ status: string }>):
  'awaiting_client' | 'partial' | 'approved' | 'changes_requested' {
  if (items.every(item => item.status === 'approved')) return 'approved';
  if (items.every(item => item.status === 'changes_requested')) return 'changes_requested';
  if (items.every(item => item.status === 'awaiting_client')) return 'awaiting_client';
  return 'partial';
}

function parsePersistedReview(deliverable: ClientDeliverable): ParsedReview {
  try {
    projectClientBrandReviewDeliverable(deliverable);
    const payload = parseBrandReviewBundlePayload(deliverable.payload);
    const items = (deliverable.items ?? []).map(row => ({
      row,
      payload: parseBrandReviewItemPayload(row.itemPayload),
    }));
    const expectedStatus = aggregateStatus(items.map(item => ({ status: item.row.status })));
    if (deliverable.status !== expectedStatus) {
      throw new Error('Brand review parent status does not match its children');
    }
    return { deliverable, payload, items };
  } catch (err) {
    throw new BrandReviewServiceError(
      'corrupt_review',
      err instanceof Error ? `Stored brand review is invalid: ${err.message}` : 'Stored brand review is invalid',
      500,
    );
  }
}

function existingItemByGenerationId(
  existing: ParsedReview | null,
): Map<string, { row: ClientDeliverableItem; payload: BrandReviewItemPayload }> {
  return new Map(existing?.items.map(item => [item.payload.generationItemId, item]) ?? []);
}

function existingMetadata(
  existing: ReturnType<typeof existingItemByGenerationId>,
  item: BrandGenerationItem,
): { clientItemId?: string; createdAt?: string } {
  const matched = existing.get(item.id);
  if (!matched || matched.payload.target !== item.target) return {};
  return { clientItemId: matched.row.id, createdAt: matched.row.createdAt };
}

function normalizedText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * A lost-response retry of the exact pending projection is a read, not a resend.
 * Revised content/revisions or an explicit note change still flow through the
 * canonical send path and intentionally notify the client again.
 */
function isExactPendingReviewReplay(
  existing: ParsedReview,
  input: BrandReviewDeliverableInput,
  requestedNote: string | null | undefined,
): boolean {
  if (
    existing.payload.reviewKind !== input.reviewKind
    || existing.payload.runId !== input.runId
    || existing.payload.runRevision !== input.runRevision
    || existing.items.length !== input.items.length
  ) return false;

  const desiredStatus = aggregateStatus(input.items.map(item => ({ status: item.mirrorStatus })));
  const effectiveNote = requestedNote
    ?? (desiredStatus === 'partial' ? existing.deliverable.note : null);
  if (
    existing.deliverable.status !== desiredStatus
    || normalizedText(existing.deliverable.note) !== normalizedText(effectiveNote)
  ) return false;

  const byGenerationId = existingItemByGenerationId(existing);
  return input.items.every((item, index) => {
    const prior = byGenerationId.get(item.generationItemId);
    if (!prior) return false;
    const expectedSourceId = item.target === 'voice_foundation'
      ? null
      : item.sourceDeliverableId;
    const expectedSourceVersion = item.target === 'voice_foundation'
      ? null
      : item.sourceDeliverableVersion;
    return prior.row.id === item.clientItemId
      && (item.createdAt == null || prior.row.createdAt === item.createdAt)
      && prior.row.status === item.mirrorStatus
      && prior.row.field === item.target
      && prior.row.proposedValue === item.content
      && normalizedText(prior.row.clientNote) === normalizedText(item.decision?.note)
      && prior.row.sortOrder === index
      && prior.payload.reviewKind === input.reviewKind
      && prior.payload.runId === input.runId
      && prior.payload.runRevision === input.runRevision
      && prior.payload.generationItemRevision === item.generationItemRevision
      && prior.payload.target === item.target
      && prior.payload.sourceDeliverableId === expectedSourceId
      && prior.payload.expectedDeliverableVersion === expectedSourceVersion
      && sameJsonValue(prior.payload.decision, item.decision);
  });
}

function preservedTerminalDecision(
  existing: ReturnType<typeof existingItemByGenerationId>,
  item: BrandGenerationItem,
  source: BrandDeliverable,
): { status: Exclude<BrandReviewMirrorItemStatus, 'awaiting_client'>; decision: NonNullable<BrandReviewItemPayload['decision']> } {
  const matched = existing.get(item.id);
  if (item.status !== 'approved' && item.status !== 'changes_requested') {
    conflict(`${item.target} is not in a terminal review state`);
  }
  const expectedDecision = item.status === 'approved' ? 'approve' : 'changes_requested';
  if (
    !matched
    || matched.payload.reviewKind !== 'brand_suite'
    || matched.payload.target !== item.target
    || matched.payload.generationItemRevision !== item.revision
    || matched.payload.sourceDeliverableId !== source.id
    || matched.payload.expectedDeliverableVersion !== source.version
    || matched.payload.decision?.decision !== expectedDecision
    || matched.row.status !== item.status
  ) {
    conflict(`${item.target} generation/source state diverged from its review decision`);
  }
  return {
    status: item.status,
    decision: matched.payload.decision,
  };
}

function loadExistingReview(
  workspaceId: string,
  reviewKind: BrandReviewBundleKind,
  runId: string,
): ParsedReview | null {
  const existing = findBySourceRef(
    workspaceId,
    'brand_generation',
    reviewSourceRef(reviewKind, runId),
  );
  if (!existing) return null;
  const parsed = parsePersistedReview(existing);
  if (parsed.payload.reviewKind !== reviewKind || parsed.payload.runId !== runId) {
    throw new BrandReviewServiceError('corrupt_review', 'Stored brand review identity is invalid', 500);
  }
  return parsed;
}

function buildFoundationInput(
  runId: string,
  runRevision: number,
  items: BrandGenerationItem[],
  existing: ParsedReview | null,
): BrandReviewDeliverableInput {
  const foundations = items.filter(
    (item): item is Extract<BrandGenerationItem, { target: 'voice_foundation' }> => (
      item.target === 'voice_foundation'
    ),
  );
  if (foundations.length !== 1) notReady('Voice foundation review requires exactly one foundation item');
  const item = foundations[0];
  if (item.status !== 'ready_for_human_review') {
    notReady('Voice foundation is not ready for human review');
  }
  const content = foundationContent(item);
  const unresolved = assertReviewReadyContent(item, content);
  const existingById = existingItemByGenerationId(existing);
  const prior = existingById.get(item.id);
  const decision = prior?.payload.reviewKind === 'voice_foundation'
    && prior.payload.generationItemRevision === item.revision
    ? prior.payload.decision
    : null;
  const mirrorStatus = decision == null
    ? 'awaiting_client'
    : decision.decision === 'approve' ? 'approved' : 'changes_requested';
  const reviewItem: BrandVoiceFoundationReviewMirrorItemInput = {
    ...existingMetadata(existingById, item),
    generationItemId: item.id,
    generationItemRevision: item.revision,
    target: 'voice_foundation',
    content,
    mirrorStatus,
    unresolvedRequirementIds: unresolved,
    hasCanonicalPlaceholder: false,
    generationStatus: 'ready_for_human_review',
    sourceDeliverableId: null,
    sourceDeliverableVersion: null,
    sourceDeliverableStatus: null,
    decision,
  };
  return { reviewKind: 'voice_foundation', runId, runRevision, items: [reviewItem] };
}

function buildSuiteInput(
  workspaceId: string,
  runId: string,
  runRevision: number,
  items: BrandGenerationItem[],
  existing: ParsedReview | null,
): BrandReviewDeliverableInput {
  const durableItems = items.filter(
    (item): item is Exclude<BrandGenerationItem, { target: 'voice_foundation' }> => (
      item.target !== 'voice_foundation'
    ),
  );
  if (durableItems.length === 0) notReady('Brand suite review has no durable deliverables');
  const existingById = existingItemByGenerationId(existing);
  const projected: BrandSuiteReviewMirrorItemInput[] = durableItems.map(item => {
    if (
      item.status !== 'ready_for_human_review'
      && item.status !== 'approved'
      && item.status !== 'changes_requested'
    ) {
      notReady(`${item.target} is not ready for client review`);
    }
    if (!item.content?.trim()) notReady(`${item.target} has no committed reviewable content`);
    const unresolved = assertReviewReadyContent(item, item.content);
    if (item.committedDeliverableId == null || item.committedDeliverableVersion == null) {
      notReady(`${item.target} is missing its committed BrandDeliverable revision`);
    }
    const source = getBrandDeliverable(workspaceId, item.committedDeliverableId);
    if (!source || source.deliverableType !== item.target) {
      conflict(`${item.target} committed BrandDeliverable is missing or mismatched`);
    }
    if (source.version !== item.committedDeliverableVersion) {
      conflict(`${item.target} BrandDeliverable version changed; re-read the generation run`);
    }
    if (source.content !== item.content) {
      conflict(`${item.target} BrandDeliverable content diverged from the committed generation item`);
    }

    let mirrorStatus: BrandReviewMirrorItemStatus = 'awaiting_client';
    let decision: BrandSuiteReviewMirrorItemInput['decision'] = null;
    if (item.status === 'approved' || item.status === 'changes_requested') {
      const terminal = preservedTerminalDecision(existingById, item, source);
      mirrorStatus = terminal.status;
      decision = terminal.decision as BrandSuiteReviewMirrorItemInput['decision'];
    }
    const expectedSourceStatus = mirrorStatus === 'approved' ? 'approved' : 'draft';
    if (source.status !== expectedSourceStatus) {
      conflict(`${item.target} BrandDeliverable status diverged from generation review state`);
    }

    return {
      ...existingMetadata(existingById, item),
      generationItemId: item.id,
      generationItemRevision: item.revision,
      target: item.target,
      content: item.content,
      mirrorStatus,
      unresolvedRequirementIds: unresolved,
      hasCanonicalPlaceholder: false,
      generationStatus: item.status,
      sourceDeliverableId: source.id,
      sourceDeliverableVersion: source.version,
      sourceDeliverableStatus: source.status,
      decision,
    };
  });
  return {
    reviewKind: 'brand_suite',
    runId,
    runRevision,
    items: projected as [BrandSuiteReviewMirrorItemInput, ...BrandSuiteReviewMirrorItemInput[]],
  };
}

function receiptFromDeliverable(
  deliverable: ClientDeliverable,
  input: BrandReviewDeliverableInput,
  existing: boolean,
): BrandReviewDeliverableReceipt {
  if (!['awaiting_client', 'partial', 'approved', 'changes_requested'].includes(deliverable.status)) {
    throw new BrandReviewServiceError('corrupt_review', 'Brand review has an invalid parent status', 500);
  }
  return {
    deliverableId: deliverable.id,
    reviewKind: input.reviewKind,
    runId: input.runId,
    runRevision: input.runRevision,
    status: deliverable.status as BrandReviewDeliverableReceipt['status'],
    itemCount: input.items.length,
    existing,
  };
}

function receiptFromPersistedReview(existing: ParsedReview): BrandReviewDeliverableReceipt {
  const { deliverable, payload, items } = existing;
  if (!['awaiting_client', 'partial', 'approved', 'changes_requested'].includes(deliverable.status)) {
    throw new BrandReviewServiceError('corrupt_review', 'Brand review has an invalid parent status', 500);
  }
  return {
    deliverableId: deliverable.id,
    reviewKind: payload.reviewKind,
    runId: payload.runId,
    runRevision: payload.runRevision,
    status: deliverable.status as BrandReviewDeliverableReceipt['status'],
    itemCount: items.length,
    existing: true,
  };
}

function recordBrandReviewSentActivity(
  deliverable: ClientDeliverable,
  reviewKind: BrandReviewBundleKind,
  runId: string,
  runRevision: number,
  itemCount: number,
  note: string | null | undefined,
): void {
  runBrandReviewPostCommitEffect(deliverable.workspaceId, 'send-activity', () => {
    addActivityOnce({
      effectKey: `brand-review-send:${deliverable.id}:${deliverable.sentAt ?? deliverable.updatedAt}`,
      workspaceId: deliverable.workspaceId,
      type: 'deliverable_sent',
      title: `Sent ${reviewKind === 'voice_foundation' ? 'brand voice foundation' : 'brand system'} to client for review`,
      description: note?.trim() || undefined,
      metadata: {
        deliverableId: deliverable.id,
        reviewKind,
        itemCount,
        brandGenerationReview: {
          runId,
          runRevision,
        },
      },
      createdAt: deliverable.sentAt ?? deliverable.updatedAt,
    });
  });
}

/**
 * Build and send one exact B2 run projection through the canonical Inbox spine.
 * The stale-run check and all review-readiness checks happen before sendToClient,
 * so a rejected request cannot emit a client notification.
 */
export async function createBrandReviewDeliverable(
  workspaceId: string,
  runId: string,
  expectedRunRevision: number,
  reviewKind: BrandReviewBundleKind,
  options: CreateBrandReviewDeliverableOptions = {},
): Promise<BrandReviewDeliverableReceipt> {
  const run = getPersistedBrandGenerationRun(workspaceId, runId);
  if (!run) throw new BrandReviewServiceError('not_found', 'Brand generation run not found', 404);
  if (run.revision !== expectedRunRevision) {
    conflict(`Brand generation run revision conflict: expected ${expectedRunRevision}, actual ${run.revision}`);
  }
  const items = listPersistedBrandGenerationItems(workspaceId, runId);
  const existing = loadExistingReview(workspaceId, reviewKind, runId);
  const input = reviewKind === 'voice_foundation'
    ? buildFoundationInput(runId, run.revision, items, existing)
    : buildSuiteInput(workspaceId, runId, run.revision, items, existing);

  // A terminal exact replay has no pending child to resend and must not emit a
  // second notification. The private projection was already revalidated above.
  if (!input.items.some(item => item.mirrorStatus === 'awaiting_client')) {
    if (!existing) notReady('Brand review has no item awaiting client review');
    recordBrandReviewSentActivity(
      existing.deliverable,
      existing.payload.reviewKind,
      existing.payload.runId,
      existing.payload.runRevision,
      existing.items.length,
      existing.deliverable.note,
    );
    return receiptFromPersistedReview(existing);
  }
  if (existing && isExactPendingReviewReplay(existing, input, options.note)) {
    recordBrandReviewSentActivity(
      existing.deliverable,
      existing.payload.reviewKind,
      existing.payload.runId,
      existing.payload.runRevision,
      existing.items.length,
      existing.deliverable.note,
    );
    return receiptFromPersistedReview(existing);
  }

  const delivered = await sendToClient(workspaceId, 'brand_generation', input, {
    note: options.note,
    source: options.source,
  });
  recordBrandReviewSentActivity(
    delivered,
    input.reviewKind,
    input.runId,
    input.runRevision,
    input.items.length,
    delivered.note,
  );
  return receiptFromDeliverable(delivered, input, existing != null);
}

function parseDecisionRequest(raw: unknown): BrandReviewClientDecisionRequest {
  try {
    const request = parseBrandReviewClientDecisionRequest(raw);
    const note = request.note?.trim();
    return request.decision === 'approve'
      ? {
          deliverableItemId: request.deliverableItemId,
          reviewToken: request.reviewToken,
          decision: 'approve',
          ...(note ? { note } : {}),
        }
      : {
          deliverableItemId: request.deliverableItemId,
          reviewToken: request.reviewToken,
          decision: 'changes_requested',
          note: note!,
        };
  } catch (err) {
    throw new BrandReviewServiceError(
      'invalid_request',
      err instanceof Error ? err.message : 'Invalid brand review decision',
      400,
    );
  }
}

function parseReviewer(raw: GenerationHumanReviewerAttribution): GenerationHumanReviewerAttribution {
  const parsed = generationResolverAttributionSchema.safeParse(raw);
  if (!parsed.success || (parsed.data.actorType !== 'operator' && parsed.data.actorType !== 'client')) {
    throw new BrandReviewServiceError(
      'invalid_request',
      'Brand review decisions require a valid human reviewer',
      400,
    );
  }
  return parsed.data as GenerationHumanReviewerAttribution;
}

function toUpsert(
  current: ClientDeliverable,
  status: 'partial' | 'approved' | 'changes_requested',
  items: ClientDeliverableItem[],
  decidedAt: string,
): UpsertDeliverableInput {
  return {
    id: current.id,
    workspaceId: current.workspaceId,
    externalRef: current.externalRef,
    type: current.type,
    kind: current.kind,
    status,
    title: current.title,
    summary: current.summary,
    payload: current.payload,
    note: current.note,
    clientResponseNote: current.clientResponseNote,
    parentDeliverableId: current.parentDeliverableId,
    sentAt: current.sentAt,
    decidedAt,
    dueAt: current.dueAt,
    appliedAt: current.appliedAt,
    generatedAt: current.generatedAt,
    source: current.source,
    sourceRef: current.sourceRef,
    items: items.map(item => ({
      id: item.id,
      createdAt: item.createdAt,
      status: item.status,
      targetRef: item.targetRef,
      collectionId: item.collectionId,
      field: item.field,
      currentValue: item.currentValue,
      proposedValue: item.proposedValue,
      clientValue: item.clientValue,
      clientNote: item.clientNote,
      applyable: item.applyable,
      itemPayload: item.itemPayload,
      sortOrder: item.sortOrder,
    })),
  };
}

function sameDecision(
  payload: BrandReviewItemPayload,
  request: BrandReviewClientDecisionRequest,
): boolean {
  const note = payload.decision?.note?.trim() || undefined;
  const requestedNote = request.note?.trim() || undefined;
  return payload.decision?.decision === request.decision && note === requestedNote;
}

function decisionReceipt(
  reviewDeliverableId: string,
  parent: BrandReviewBundlePayload,
  previousRevision: number,
  bundleStatus: 'partial' | 'approved' | 'changes_requested',
  decision: NonNullable<BrandReviewItemPayload['decision']>,
): BrandReviewDecisionReceipt {
  return decision && 'deliverableId' in decision
    ? {
        reviewDeliverableId,
        reviewKind: 'brand_suite',
        runId: parent.runId,
        runRevision: parent.runRevision,
        previousGenerationItemRevision: previousRevision,
        generationItemRevision: decision.resultingGenerationItemRevision,
        sourceDeliverableVersion: decision.expectedDeliverableVersion,
        bundleStatus,
        decision,
      }
    : {
        reviewDeliverableId,
        reviewKind: 'voice_foundation',
        runId: parent.runId,
        runRevision: parent.runRevision,
        previousGenerationItemRevision: previousRevision,
        generationItemRevision: decision.resultingGenerationItemRevision,
        sourceDeliverableVersion: null,
        bundleStatus,
        decision,
      };
}

interface DecisionTransactionResult {
  receipt: BrandReviewDecisionReceipt;
  replayed: boolean;
  decidedAt: string;
  sourceDeliverable: BrandDeliverable | null;
  autoSampleFrom: BrandDeliverable['deliverableType'] | null;
  reviewTarget: BrandGenerationItem['target'];
}

function reviewTargetLabel(target: BrandGenerationItem['target']): string {
  return target
    .split('_')
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

/**
 * Reconcile the durable activity side effect for both the first decision and an
 * idempotent terminal replay. Email and domain broadcasts remain first-write
 * effects, while a retry can safely repair an activity insert that failed after
 * the decision transaction committed.
 */
function recordBrandReviewDecisionActivity(
  workspaceId: string,
  reviewDeliverableId: string,
  result: DecisionTransactionResult,
): void {
  const { receipt } = result;
  const reviewer = receipt.decision.decidedBy;
  runBrandReviewPostCommitEffect(workspaceId, 'activity', () => {
    addActivityOnce({
      effectKey: `brand-review-decision:${reviewDeliverableId}:${receipt.decision.itemId}:${receipt.decision.decidedAt}`,
      workspaceId,
      type: 'deliverable_responded',
      title: `${reviewer.actorType === 'client' ? 'Client' : 'Operator'} ${receipt.decision.decision === 'approve' ? 'approved' : 'requested changes to'} a brand review item`,
      description: receipt.decision.note,
      metadata: {
        deliverableId: reviewDeliverableId,
        reviewKind: receipt.reviewKind,
        decision: receipt.decision.decision,
        brandGenerationReview: {
          runId: receipt.runId,
          itemId: receipt.decision.itemId,
        },
      },
      createdAt: result.decidedAt,
    });
  });
}

/**
 * Apply one human decision with source, B2 ledger, run counts, and Inbox mirror
 * in the same IMMEDIATE transaction. Foundation feedback is deliberately only
 * persisted on the mirror: it never mutates the provisional B2 item or voice.
 */
export function applyBrandReviewDecision(
  workspaceId: string,
  reviewDeliverableId: string,
  rawRequest: unknown,
  rawReviewer: GenerationHumanReviewerAttribution,
): BrandReviewDecisionReceipt {
  const request = parseDecisionRequest(rawRequest);
  const reviewer = parseReviewer(rawReviewer);

  const transact = db.transaction((): DecisionTransactionResult => {
    const current = getClientDeliverable(reviewDeliverableId);
    if (!current || current.workspaceId !== workspaceId) {
      throw new BrandReviewServiceError('not_found', 'Brand review deliverable not found', 404);
    }
    if (current.type !== 'brand_generation' || current.kind !== 'review') {
      throw new BrandReviewServiceError('invalid_request', 'Deliverable is not a brand review', 400);
    }
    const parsed = parsePersistedReview(current);
    const selected = parsed.items.find(item => item.row.id === request.deliverableItemId);
    if (!selected) {
      throw new BrandReviewServiceError('not_found', 'Brand review item not found', 404);
    }
    if (brandReviewClientToken(current, selected.row, selected.payload) !== request.reviewToken) {
      conflict('Brand review item changed after it was opened; ask your team to resend it');
    }

    if (selected.payload.decision != null || selected.row.status !== 'awaiting_client') {
      if (selected.payload.decision != null && sameDecision(selected.payload, request)) {
        if (!['partial', 'approved', 'changes_requested'].includes(current.status)) {
          throw new BrandReviewServiceError('corrupt_review', 'Stored brand review decision has an invalid parent status', 500);
        }
        return {
          receipt: decisionReceipt(
            current.id,
            parsed.payload,
            selected.payload.decision.expectedGenerationItemRevision,
            current.status as 'partial' | 'approved' | 'changes_requested',
            selected.payload.decision,
          ),
          replayed: true,
          decidedAt: selected.payload.decision.decidedAt,
          sourceDeliverable: null,
          autoSampleFrom: null,
          reviewTarget: selected.payload.target,
        };
      }
      conflict('Brand review item already has a different terminal decision');
    }

    const generationItem = getBrandGenerationItem(
      workspaceId,
      parsed.payload.runId,
      selected.payload.generationItemId,
    );
    if (!generationItem) conflict('Brand generation item no longer exists');
    if (
      generationItem.target !== selected.payload.target
      || generationItem.revision !== selected.payload.generationItemRevision
      || generationItem.status !== 'ready_for_human_review'
    ) {
      conflict('Brand generation item changed after this review was sent');
    }
    if (selected.payload.reviewKind === 'voice_foundation') {
      if (
        generationItem.target !== 'voice_foundation'
        || selected.row.proposedValue !== foundationContent(generationItem)
      ) {
        conflict('Brand voice review content diverged from its frozen generation item');
      }
    } else if (
      generationItem.target === 'voice_foundation'
      || selected.row.proposedValue !== generationItem.content
    ) {
      conflict('Brand review content diverged from its frozen generation item');
    }

    const decidedAt = new Date().toISOString();
    const note = request.note?.trim();
    const previousRevision = generationItem.revision;
    let resultingRevision = generationItem.revision;
    let sourceDeliverable: BrandDeliverable | null = null;
    let autoSampleFrom: BrandDeliverable['deliverableType'] | null = null;
    let decision: NonNullable<BrandReviewItemPayload['decision']>;

    if (selected.payload.reviewKind === 'voice_foundation') {
      if (generationItem.target !== 'voice_foundation') {
        throw new BrandReviewServiceError('corrupt_review', 'Foundation review points to a durable item', 500);
      }
      decision = request.decision === 'approve'
        ? {
            decision: 'approve',
            ...(note ? { note } : {}),
            runId: parsed.payload.runId,
            itemId: generationItem.id,
            expectedGenerationItemRevision: previousRevision,
            resultingGenerationItemRevision: previousRevision,
            decidedAt,
            decidedBy: reviewer,
          }
        : {
            decision: 'changes_requested',
            note: note!,
            runId: parsed.payload.runId,
            itemId: generationItem.id,
            expectedGenerationItemRevision: previousRevision,
            resultingGenerationItemRevision: previousRevision,
            decidedAt,
            decidedBy: reviewer,
          };
    } else {
      if (
        generationItem.target === 'voice_foundation'
        || generationItem.committedDeliverableId !== selected.payload.sourceDeliverableId
        || generationItem.committedDeliverableVersion !== selected.payload.expectedDeliverableVersion
      ) {
        conflict('Brand review source lineage changed after this review was sent');
      }
      const source = getBrandDeliverable(workspaceId, selected.payload.sourceDeliverableId);
      if (
        !source
        || source.deliverableType !== selected.payload.target
        || source.version !== selected.payload.expectedDeliverableVersion
        || source.status !== 'draft'
      ) {
        conflict('BrandDeliverable changed after this review was sent');
      }
      if (
        source.content !== generationItem.content
        || source.content !== selected.row.proposedValue
      ) {
        conflict('BrandDeliverable content diverged from the reviewed artifact');
      }
      const sourceStatus = request.decision === 'approve' ? 'approved' : 'draft';
      const sourceResult = setDeliverableStatusCasInTransaction(
        workspaceId,
        source.id,
        selected.payload.expectedDeliverableVersion,
        'draft',
        sourceStatus,
      );
      if (!sourceResult) conflict('BrandDeliverable no longer exists');
      sourceDeliverable = sourceResult.deliverable;
      autoSampleFrom = sourceResult.autoSampleFrom;

      const transitioned = transitionBrandGenerationItem({
        workspaceId,
        runId: parsed.payload.runId,
        itemId: generationItem.id,
        expectedRevision: previousRevision,
        nextStatus: request.decision === 'approve' ? 'approved' : 'changes_requested',
      });
      resultingRevision = transitioned.revision;
      decision = request.decision === 'approve'
        ? {
            decision: 'approve',
            ...(note ? { note } : {}),
            runId: parsed.payload.runId,
            itemId: generationItem.id,
            expectedGenerationItemRevision: previousRevision,
            resultingGenerationItemRevision: resultingRevision,
            deliverableId: source.id,
            deliverableType: source.deliverableType,
            expectedDeliverableVersion: source.version,
            decidedAt,
            decidedBy: reviewer,
          }
        : {
            decision: 'changes_requested',
            note: note!,
            runId: parsed.payload.runId,
            itemId: generationItem.id,
            expectedGenerationItemRevision: previousRevision,
            resultingGenerationItemRevision: resultingRevision,
            deliverableId: source.id,
            deliverableType: source.deliverableType,
            expectedDeliverableVersion: source.version,
            decidedAt,
            decidedBy: reviewer,
          };
    }

    const childStatus = request.decision === 'approve' ? 'approved' : 'changes_requested';
    const updatedItems = parsed.items.map(({ row, payload }) => {
      if (row.id !== selected.row.id) return row;
      let updatedPayload: BrandReviewItemPayload;
      if (payload.reviewKind === 'voice_foundation') {
        if ('deliverableId' in decision) {
          throw new BrandReviewServiceError('corrupt_review', 'Foundation review received a durable decision', 500);
        }
        updatedPayload = { ...payload, generationItemRevision: resultingRevision, decision };
      } else {
        if (!('deliverableId' in decision)) {
          throw new BrandReviewServiceError('corrupt_review', 'Durable review received a foundation decision', 500);
        }
        updatedPayload = { ...payload, generationItemRevision: resultingRevision, decision };
      }
      return {
        ...row,
        status: childStatus,
        clientNote: note ?? null,
        itemPayload: { ...updatedPayload },
      };
    });
    const bundleStatus = aggregateStatus(updatedItems);
    if (bundleStatus === 'awaiting_client') {
      throw new BrandReviewServiceError('corrupt_review', 'Brand review decision did not advance its parent', 500);
    }
    validateTransition(
      'deliverable',
      getDeliverableTransitions('brand_generation'),
      current.status,
      bundleStatus,
    );
    const persisted = upsertDeliverable(toUpsert(current, bundleStatus, updatedItems, decidedAt));
    const verified = parsePersistedReview(persisted);
    if (verified.deliverable.status !== bundleStatus) {
      throw new BrandReviewServiceError('corrupt_review', 'Brand review parent write did not persist', 500);
    }

    return {
      receipt: decisionReceipt(
        current.id,
        parsed.payload,
        previousRevision,
        bundleStatus,
        decision,
      ),
      replayed: false,
      decidedAt,
      sourceDeliverable,
      autoSampleFrom,
      reviewTarget: selected.payload.target,
    };
  });

  let result: DecisionTransactionResult;
  try {
    result = transact.immediate();
  } catch (err) {
    if (err instanceof BrandReviewServiceError) throw err;
    if (
      err instanceof BrandDeliverableVersionConflictError
      || err instanceof BrandDeliverableStatusConflictError
      || err instanceof BrandGenerationRevisionConflictError
      || err instanceof InvalidTransitionError
    ) {
      throw new BrandReviewServiceError('conflict', err.message, 409);
    }
    throw err;
  }

  // This is intentionally outside the first-write branch: a same-decision
  // replay repairs a post-commit activity failure without duplicating the row.
  recordBrandReviewDecisionActivity(workspaceId, reviewDeliverableId, result);

  if (!result.replayed) {
    const { receipt } = result;
    runBrandReviewPostCommitEffect(workspaceId, 'team-notification', () => {
      const reviewerRole = receipt.decision.decidedBy.actorType === 'client'
        ? 'Client'
        : 'Operator';
      notifyTeamOfDeliverableResponse(workspaceId, {
        decision: receipt.decision.decision === 'approve' ? 'approved' : 'changes_requested',
        title: `Brand review: ${reviewTargetLabel(result.reviewTarget)}`,
        sourceType: 'brand_generation',
        summary: receipt.reviewKind === 'voice_foundation'
          ? `${reviewerRole} reviewed the advisory voice foundation.`
          : `${reviewerRole} reviewed one brand system piece.`,
        clientNote: receipt.decision.note,
      });
    });
    runBrandReviewPostCommitEffect(workspaceId, 'deliverable-broadcast', () => {
      broadcastToWorkspace(workspaceId, WS_EVENTS.DELIVERABLE_UPDATED, {
        deliverableId: reviewDeliverableId,
        type: 'brand_generation',
        status: receipt.bundleStatus,
      });
    });
    if (result.sourceDeliverable) {
      runBrandReviewPostCommitEffect(workspaceId, 'brand-identity-broadcast', () => {
        broadcastToWorkspace(
          workspaceId,
          WS_EVENTS.BRAND_IDENTITY_UPDATED,
          BRAND_IDENTITY_UPDATED_PAYLOAD,
        );
      });
    }
    if (result.autoSampleFrom) {
      runBrandReviewPostCommitEffect(workspaceId, 'voice-profile-broadcast', () => {
        broadcastToWorkspace(workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, {
          autoSampleFrom: result.autoSampleFrom,
        });
      });
    }
    runBrandReviewPostCommitEffect(workspaceId, 'intelligence-cache', () => {
      invalidateIntelligenceCache(workspaceId);
    });
  }

  return result.receipt;
}
