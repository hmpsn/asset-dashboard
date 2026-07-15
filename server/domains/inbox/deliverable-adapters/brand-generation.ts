import {
  BRAND_GENERATION_LIMITS,
  BRAND_REVIEW_CONTRACT_VERSION,
  type BrandReviewDeliverableInput,
  type BrandReviewItemPayload,
  type BrandReviewMirrorItemInput,
  type BrandReviewPersistedDecision,
  type BrandReviewBundlePayload,
  type BrandSuiteReviewMirrorItemInput,
  type BrandVoiceFoundationReviewMirrorItemInput,
} from '../../../../shared/types/brand-generation.js';
import {
  registerAdapter,
  type BuiltDeliverablePayload,
  type DeliverableAdapter,
  type SendableResult,
} from './types.js';

function boundedId(value: string, label: string): SendableResult {
  const length = Buffer.byteLength(value.trim(), 'utf8');
  if (length === 0) return { ok: false, reason: `${label} is required` };
  if (length > BRAND_GENERATION_LIMITS.maxIdLength) {
    return { ok: false, reason: `${label} exceeds the maximum length` };
  }
  return { ok: true };
}

function isPositiveRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function decisionMatches(
  input: BrandReviewDeliverableInput,
  item: BrandReviewMirrorItemInput,
  decision: BrandReviewPersistedDecision,
): boolean {
  if (decision.runId !== input.runId || decision.itemId !== item.generationItemId) return false;
  if (
    !isPositiveRevision(decision.expectedGenerationItemRevision)
    || !isPositiveRevision(decision.resultingGenerationItemRevision)
    || decision.resultingGenerationItemRevision !== item.generationItemRevision
  ) return false;
  if (item.target === 'voice_foundation') {
    return !('deliverableId' in decision)
      && decision.resultingGenerationItemRevision === decision.expectedGenerationItemRevision;
  }
  return 'deliverableId' in decision
    && decision.resultingGenerationItemRevision === decision.expectedGenerationItemRevision + 1
    && decision.deliverableId === item.sourceDeliverableId
    && decision.deliverableType === item.target
    && decision.expectedDeliverableVersion === item.sourceDeliverableVersion;
}

function validateDecision(
  input: BrandReviewDeliverableInput,
  item: BrandReviewMirrorItemInput,
): SendableResult {
  const decision = item.decision;
  if (item.mirrorStatus === 'awaiting_client') {
    return decision == null
      ? { ok: true }
      : { ok: false, reason: `${item.target} has a decision while awaiting client review` };
  }
  if (decision == null || !decisionMatches(input, item, decision)) {
    return { ok: false, reason: `${item.target} review decision does not match its frozen source` };
  }
  const decidedMirrorStatus = decision.decision === 'approve' ? 'approved' : 'changes_requested';
  if (item.mirrorStatus !== decidedMirrorStatus) {
    return { ok: false, reason: `${item.target} mirror status does not match its decision` };
  }
  if (decision.decision === 'changes_requested' && !decision.note.trim()) {
    return { ok: false, reason: `${item.target} changes request must preserve a note` };
  }
  return { ok: true };
}

function validateFoundationItem(
  input: BrandReviewDeliverableInput,
  item: BrandVoiceFoundationReviewMirrorItemInput,
): SendableResult {
  if (
    item.sourceDeliverableId != null
    || item.sourceDeliverableVersion != null
    || item.sourceDeliverableStatus != null
  ) {
    return { ok: false, reason: 'voice foundation review cannot claim a BrandDeliverable source' };
  }
  if (item.generationStatus !== 'ready_for_human_review') {
    return { ok: false, reason: 'voice foundation is not ready for human review' };
  }
  return validateDecision(input, item);
}

function validateSuiteItem(
  input: BrandReviewDeliverableInput,
  item: BrandSuiteReviewMirrorItemInput,
): SendableResult {
  const rawSourceId: unknown = (item as { sourceDeliverableId?: unknown }).sourceDeliverableId;
  const rawSourceVersion: unknown = (item as { sourceDeliverableVersion?: unknown }).sourceDeliverableVersion;
  if (typeof rawSourceId !== 'string' || typeof rawSourceVersion !== 'number') {
    return { ok: false, reason: `${item.target} is missing its durable source revision` };
  }
  const sourceId = boundedId(rawSourceId, `${item.target} deliverable id`);
  if (!sourceId.ok) return sourceId;
  if (!isPositiveRevision(rawSourceVersion)) {
    return { ok: false, reason: `${item.target} deliverable version is invalid` };
  }

  const expected = item.mirrorStatus;
  if (expected === 'awaiting_client') {
    if (item.generationStatus !== 'ready_for_human_review' || item.sourceDeliverableStatus !== 'draft') {
      return { ok: false, reason: `${item.target} is not ready for client review` };
    }
  } else if (expected === 'approved') {
    if (item.generationStatus !== 'approved' || item.sourceDeliverableStatus !== 'approved') {
      return { ok: false, reason: `${item.target} approval is not committed to its source` };
    }
  } else if (
    item.generationStatus !== 'changes_requested'
    || item.sourceDeliverableStatus !== 'draft'
  ) {
    return { ok: false, reason: `${item.target} changes request is not committed to its source` };
  }
  return validateDecision(input, item);
}

function validateItem(
  input: BrandReviewDeliverableInput,
  item: BrandReviewMirrorItemInput,
): SendableResult {
  const generationId = boundedId(item.generationItemId, `${item.target} generation item id`);
  if (!generationId.ok) return generationId;
  if (!isPositiveRevision(item.generationItemRevision)) {
    return { ok: false, reason: `${item.target} generation item revision is invalid` };
  }
  if (item.clientItemId != null) {
    const clientId = boundedId(item.clientItemId, `${item.target} client item id`);
    if (!clientId.ok) return clientId;
  }
  const maxBytes = item.target === 'voice_foundation'
    ? BRAND_GENERATION_LIMITS.maxFoundationBytes
    : BRAND_GENERATION_LIMITS.maxContentBytes;
  const contentBytes = Buffer.byteLength(item.content.trim(), 'utf8');
  if (contentBytes === 0) return { ok: false, reason: `${item.target} content is empty` };
  if (contentBytes > maxBytes) return { ok: false, reason: `${item.target} content exceeds its bound` };
  if (item.unresolvedRequirementIds.length > 0 || item.hasCanonicalPlaceholder) {
    return { ok: false, reason: `${item.target} still has unresolved client-input requirements` };
  }
  if (input.reviewKind === 'voice_foundation') {
    return item.target === 'voice_foundation'
      ? validateFoundationItem(input, item)
      : { ok: false, reason: 'voice foundation review must contain only the foundation item' };
  }
  return item.target === 'voice_foundation'
    ? { ok: false, reason: 'brand suite review cannot contain a voice foundation item' }
    : validateSuiteItem(input, item);
}

function validateUniqueItems(items: BrandReviewMirrorItemInput[]): SendableResult {
  const generationIds = new Set<string>();
  const targets = new Set<string>();
  const clientIds = new Set<string>();
  for (const item of items) {
    if (generationIds.has(item.generationItemId) || targets.has(item.target)) {
      return { ok: false, reason: 'brand review contains a duplicate source item' };
    }
    generationIds.add(item.generationItemId);
    targets.add(item.target);
    if (item.clientItemId != null) {
      if (clientIds.has(item.clientItemId)) {
        return { ok: false, reason: 'brand review contains a duplicate client item id' };
      }
      clientIds.add(item.clientItemId);
    }
  }
  return { ok: true };
}

function reviewTitle(kind: BrandReviewDeliverableInput['reviewKind']): string {
  return kind === 'voice_foundation'
    ? 'Brand voice foundation review'
    : 'Brand system review';
}

function sourceRef(input: BrandReviewDeliverableInput): string {
  return `brand_generation:${input.reviewKind}:${input.runId}`;
}

function clientNote(decision: BrandReviewPersistedDecision | null): string | null {
  return decision?.note?.trim() || null;
}

function buildPayload(input: BrandReviewDeliverableInput): BuiltDeliverablePayload {
  const payload = {
    schemaVersion: BRAND_REVIEW_CONTRACT_VERSION,
    family: 'brand_generation',
    reviewKind: input.reviewKind,
    runId: input.runId,
    runRevision: input.runRevision,
  } satisfies BrandReviewBundlePayload;

  const toBuiltItem = (
    item: BrandReviewMirrorItemInput,
    itemPayload: Record<string, unknown>,
    index: number,
  ) => ({
    id: item.clientItemId,
    createdAt: item.createdAt,
    status: item.mirrorStatus,
    field: item.target,
    proposedValue: item.content,
    clientNote: clientNote(item.decision),
    applyable: false,
    itemPayload,
    sortOrder: index,
  });

  const items = input.reviewKind === 'voice_foundation'
    ? input.items.map((item, index) => {
        const itemPayload = {
          schemaVersion: BRAND_REVIEW_CONTRACT_VERSION,
          family: 'brand_generation',
          reviewKind: 'voice_foundation',
          runId: input.runId,
          runRevision: input.runRevision,
          generationItemId: item.generationItemId,
          generationItemRevision: item.generationItemRevision,
          target: 'voice_foundation',
          sourceDeliverableId: null,
          expectedDeliverableVersion: null,
          decision: item.decision,
        } satisfies BrandReviewItemPayload;
        return toBuiltItem(item, itemPayload, index);
      })
    : input.items.map((item, index) => {
        const itemPayload = {
          schemaVersion: BRAND_REVIEW_CONTRACT_VERSION,
          family: 'brand_generation',
          reviewKind: 'brand_suite',
          runId: input.runId,
          runRevision: input.runRevision,
          generationItemId: item.generationItemId,
          generationItemRevision: item.generationItemRevision,
          target: item.target,
          sourceDeliverableId: item.sourceDeliverableId,
          expectedDeliverableVersion: item.sourceDeliverableVersion,
          decision: item.decision,
        } satisfies BrandReviewItemPayload;
        return toBuiltItem(item, itemPayload, index);
      });

  return {
    title: reviewTitle(input.reviewKind),
    summary: input.reviewKind === 'voice_foundation'
      ? 'Review the voice foundation before the durable brand system is generated.'
      : `Review ${input.items.length} grounded brand ${input.items.length === 1 ? 'piece' : 'pieces'}.`,
    kind: 'review',
    payload,
    items,
  };
}

export const brandGenerationAdapter: DeliverableAdapter<BrandReviewDeliverableInput> = {
  type: 'brand_generation',
  validateSendable(input): SendableResult {
    const runId = boundedId(input.runId, 'brand generation run id');
    if (!runId.ok) return runId;
    if (!isPositiveRevision(input.runRevision)) {
      return { ok: false, reason: 'brand generation run revision is invalid' };
    }
    if (
      input.items.length === 0
      || input.items.length > BRAND_GENERATION_LIMITS.maxTargets
      || (input.reviewKind === 'voice_foundation' && input.items.length !== 1)
    ) {
      return { ok: false, reason: 'brand review item count is invalid' };
    }
    if (!input.items.some(item => item.mirrorStatus === 'awaiting_client')) {
      return { ok: false, reason: 'brand review has no item awaiting client review' };
    }
    const unique = validateUniqueItems(input.items);
    if (!unique.ok) return unique;
    for (const item of input.items) {
      const itemResult = validateItem(input, item);
      if (!itemResult.ok) return itemResult;
    }
    return { ok: true };
  },
  buildPayload,
  sourceRef,
  resolveSendStatus(input) {
    // validateSendable guarantees at least one awaiting child. Any retained
    // terminal sibling — approved OR changes-requested — makes the grouped
    // review honestly partial on resend.
    return input.items.some(item => item.mirrorStatus !== 'awaiting_client')
      ? 'partial'
      : 'awaiting_client';
  },
  appliesOnApprove: false,
};

registerAdapter(brandGenerationAdapter);
