import { createHash } from 'node:crypto';

import { z } from '../../middleware/validate.js';
import {
  BRAND_DELIVERABLE_TYPES,
} from '../../../shared/types/brand-engine.js';
import {
  BRAND_GENERATION_LIMITS,
  BRAND_REVIEW_CONTRACT_VERSION,
  BRAND_REVIEW_MIRROR_ITEM_STATUSES,
  type BrandReviewBundlePayload,
  type BrandReviewClientDecisionRequest,
  type BrandReviewDecisionReceipt,
  type BrandReviewItemPayload,
  type ClientBrandReviewBundlePayload,
  type ClientBrandReviewDecisionReceipt,
  type ClientBrandReviewItemPayload,
} from '../../../shared/types/brand-generation.js';
import type { ClientDeliverable } from '../../../shared/types/client-deliverable.js';
import { generationResolverAttributionSchema } from '../../../shared/types/voice-finalization-schemas.js';

const idSchema = z.string().min(1).max(BRAND_GENERATION_LIMITS.maxIdLength);
const revisionSchema = z.number().int().positive();
const timestampSchema = z.string().datetime();
const reviewTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const optionalReviewNoteSchema = z.string().max(4_000).optional();
const requiredReviewNoteSchema = z.string().min(1).max(4_000).refine(
  note => note.trim().length > 0,
  'Changes-request note cannot be blank',
);
const humanReviewerSchema = generationResolverAttributionSchema.refine(
  attribution => attribution.actorType === 'operator' || attribution.actorType === 'client',
  'Brand review decisions require a human reviewer',
);

const generationDecisionBase = {
  runId: idSchema,
  itemId: idSchema,
  expectedGenerationItemRevision: revisionSchema,
  resultingGenerationItemRevision: revisionSchema,
  decidedAt: timestampSchema,
  decidedBy: humanReviewerSchema,
};

const foundationApproveDecisionSchema = z.object({
  ...generationDecisionBase,
  decision: z.literal('approve'),
  note: optionalReviewNoteSchema,
}).strict();

const foundationChangesDecisionSchema = z.object({
  ...generationDecisionBase,
  decision: z.literal('changes_requested'),
  note: requiredReviewNoteSchema,
}).strict();

const suiteDecisionBase = {
  ...generationDecisionBase,
  deliverableId: idSchema,
  deliverableType: z.enum(BRAND_DELIVERABLE_TYPES),
  expectedDeliverableVersion: revisionSchema,
};

const suiteApproveDecisionSchema = z.object({
  ...suiteDecisionBase,
  decision: z.literal('approve'),
  note: optionalReviewNoteSchema,
}).strict();

const suiteChangesDecisionSchema = z.object({
  ...suiteDecisionBase,
  decision: z.literal('changes_requested'),
  note: requiredReviewNoteSchema,
}).strict();

const foundationDecisionSchema = z.union([
  foundationApproveDecisionSchema,
  foundationChangesDecisionSchema,
]);
const suiteDecisionSchema = z.union([
  suiteApproveDecisionSchema,
  suiteChangesDecisionSchema,
]);

const bundleBase = {
  schemaVersion: z.literal(BRAND_REVIEW_CONTRACT_VERSION),
  family: z.literal('brand_generation'),
  runId: idSchema,
  runRevision: revisionSchema,
};

export const brandReviewBundlePayloadSchema = z.discriminatedUnion('reviewKind', [
  z.object({ ...bundleBase, reviewKind: z.literal('voice_foundation') }).strict(),
  z.object({ ...bundleBase, reviewKind: z.literal('brand_suite') }).strict(),
]);

const itemBase = {
  ...bundleBase,
  generationItemId: idSchema,
  generationItemRevision: revisionSchema,
};

export const brandReviewItemPayloadSchema = z.discriminatedUnion('reviewKind', [
  z.object({
    ...itemBase,
    reviewKind: z.literal('voice_foundation'),
    target: z.literal('voice_foundation'),
    sourceDeliverableId: z.null(),
    expectedDeliverableVersion: z.null(),
    decision: foundationDecisionSchema.nullable(),
  }).strict(),
  z.object({
    ...itemBase,
    reviewKind: z.literal('brand_suite'),
    target: z.enum(BRAND_DELIVERABLE_TYPES),
    sourceDeliverableId: idSchema,
    expectedDeliverableVersion: revisionSchema,
    decision: suiteDecisionSchema.nullable(),
  }).strict(),
]).superRefine((payload, ctx) => {
  const decision = payload.decision;
  if (decision == null) return;
  if (decision.runId !== payload.runId || decision.itemId !== payload.generationItemId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['decision'],
      message: 'Decision identity does not match the review item envelope',
    });
  }
  if (
    decision.resultingGenerationItemRevision !== payload.generationItemRevision
    || (payload.reviewKind === 'voice_foundation'
      ? decision.resultingGenerationItemRevision !== decision.expectedGenerationItemRevision
      : decision.resultingGenerationItemRevision !== decision.expectedGenerationItemRevision + 1)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['decision', 'resultingGenerationItemRevision'],
      message: 'Decision revision lineage does not match the review item envelope',
    });
  }
  if (payload.reviewKind === 'brand_suite') {
    if (!('deliverableId' in decision)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decision'],
        message: 'Durable-suite review requires a BrandDeliverable decision',
      });
      return;
    }
    if (
      decision.deliverableId !== payload.sourceDeliverableId
      || decision.deliverableType !== payload.target
      || decision.expectedDeliverableVersion !== payload.expectedDeliverableVersion
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decision'],
        message: 'Decision source does not match the frozen BrandDeliverable revision',
      });
    }
  }
});

export const brandReviewClientDecisionRequestSchema = z.discriminatedUnion('decision', [
  z.object({
    deliverableItemId: idSchema,
    reviewToken: reviewTokenSchema,
    decision: z.literal('approve'),
    note: optionalReviewNoteSchema,
  }).strict(),
  z.object({
    deliverableItemId: idSchema,
    reviewToken: reviewTokenSchema,
    decision: z.literal('changes_requested'),
    note: requiredReviewNoteSchema,
  }).strict(),
]);

export function parseBrandReviewBundlePayload(raw: unknown): BrandReviewBundlePayload {
  return brandReviewBundlePayloadSchema.parse(raw) as BrandReviewBundlePayload;
}

export function parseBrandReviewItemPayload(raw: unknown): BrandReviewItemPayload {
  return brandReviewItemPayloadSchema.parse(raw) as BrandReviewItemPayload;
}

export function parseBrandReviewClientDecisionRequest(
  raw: unknown,
): BrandReviewClientDecisionRequest {
  return brandReviewClientDecisionRequestSchema.parse(raw) as BrandReviewClientDecisionRequest;
}

export class BrandReviewProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrandReviewProjectionError';
  }
}

function aggregateProjectedReviewStatus(
  items: Array<{ status: string }>,
): 'awaiting_client' | 'partial' | 'approved' | 'changes_requested' {
  if (items.every(item => item.status === 'approved')) return 'approved';
  if (items.every(item => item.status === 'changes_requested')) return 'changes_requested';
  if (items.every(item => item.status === 'awaiting_client')) return 'awaiting_client';
  return 'partial';
}

export const clientBrandReviewDecisionReceiptSchema = z.object({
  reviewDeliverableId: idSchema,
  deliverableItemId: idSchema,
  itemStatus: z.enum(['approved', 'changes_requested']),
  bundleStatus: z.enum(['partial', 'approved', 'changes_requested']),
}).strict();

/**
 * Opaque client CAS token for exactly one sent review projection. It deliberately
 * excludes terminal decision fields so a lost-response retry remains idempotent,
 * while sentAt/note/content/frozen source lineage rotate on every real resend.
 */
export function brandReviewClientToken(
  deliverable: ClientDeliverable,
  item: NonNullable<ClientDeliverable['items']>[number],
  payload: BrandReviewItemPayload,
): string {
  return createHash('sha256').update(JSON.stringify({
    contract: BRAND_REVIEW_CONTRACT_VERSION,
    reviewDeliverableId: deliverable.id,
    reviewKind: payload.reviewKind,
    sentAt: deliverable.sentAt,
    note: deliverable.note?.trim() || null,
    clientItemId: item.id,
    clientItemCreatedAt: item.createdAt,
    target: payload.target,
    content: item.proposedValue,
    runId: payload.runId,
    runRevision: payload.runRevision,
    generationItemId: payload.generationItemId,
    reviewGenerationRevision:
      payload.decision?.expectedGenerationItemRevision ?? payload.generationItemRevision,
    sourceDeliverableId: payload.sourceDeliverableId,
    expectedDeliverableVersion: payload.expectedDeliverableVersion,
  })).digest('hex');
}

/** Public response projection for the item-level review mutation. */
export function projectClientBrandReviewDecisionReceipt(
  receipt: BrandReviewDecisionReceipt,
  deliverableItemId: string,
): ClientBrandReviewDecisionReceipt {
  return clientBrandReviewDecisionReceiptSchema.parse({
    reviewDeliverableId: receipt.reviewDeliverableId,
    deliverableItemId,
    itemStatus: receipt.decision.decision === 'approve' ? 'approved' : 'changes_requested',
    bundleStatus: receipt.bundleStatus,
  }) as ClientBrandReviewDecisionReceipt;
}

/**
 * Fail-closed authenticated client projection. New private fields cannot leak by
 * default because every parent/child property is rebuilt from an explicit allowlist.
 */
export function projectClientBrandReviewDeliverable(
  deliverable: ClientDeliverable,
): ClientDeliverable {
  if (deliverable.type !== 'brand_generation' || deliverable.kind !== 'review') {
    throw new BrandReviewProjectionError('Not a brand generation review');
  }
  const parent = parseBrandReviewBundlePayload(deliverable.payload);
  const sourceItems = deliverable.items ?? [];
  if (
    sourceItems.length === 0
    || (parent.reviewKind === 'voice_foundation' && sourceItems.length !== 1)
  ) {
    throw new BrandReviewProjectionError('Brand review item count is invalid');
  }

  const seenIds = new Set<string>();
  const seenTargets = new Set<string>();
  const items = sourceItems.map(item => {
    const payload = parseBrandReviewItemPayload(item.itemPayload);
    if (
      payload.runId !== parent.runId
      || payload.runRevision !== parent.runRevision
      || payload.reviewKind !== parent.reviewKind
      || item.field !== payload.target
      || seenIds.has(item.id)
      || seenTargets.has(payload.target)
    ) {
      throw new BrandReviewProjectionError('Brand review child does not match its parent');
    }
    seenIds.add(item.id);
    seenTargets.add(payload.target);
    if (!(BRAND_REVIEW_MIRROR_ITEM_STATUSES as readonly string[]).includes(item.status)) {
      throw new BrandReviewProjectionError('Brand review child status is invalid');
    }
    if (
      (item.status === 'awaiting_client' && payload.decision != null)
      || (item.status === 'approved' && payload.decision?.decision !== 'approve')
      || (item.status === 'changes_requested' && payload.decision?.decision !== 'changes_requested')
      || typeof item.proposedValue !== 'string'
      || item.proposedValue.trim().length === 0
    ) {
      throw new BrandReviewProjectionError('Brand review child decision is inconsistent');
    }

    const safePayload = payload.reviewKind === 'voice_foundation'
      ? ({
          schemaVersion: BRAND_REVIEW_CONTRACT_VERSION,
          family: 'brand_generation',
          reviewKind: 'voice_foundation',
          target: 'voice_foundation',
          reviewToken: brandReviewClientToken(deliverable, item, payload),
        } satisfies ClientBrandReviewItemPayload)
      : ({
          schemaVersion: BRAND_REVIEW_CONTRACT_VERSION,
          family: 'brand_generation',
          reviewKind: 'brand_suite',
          target: payload.target,
          reviewToken: brandReviewClientToken(deliverable, item, payload),
        } satisfies ClientBrandReviewItemPayload);
    return {
      id: item.id,
      deliverableId: deliverable.id,
      status: item.status,
      targetRef: null,
      collectionId: null,
      field: payload.target,
      currentValue: null,
      proposedValue: item.proposedValue,
      clientValue: null,
      clientNote: payload.decision?.note ?? null,
      applyable: false,
      itemPayload: safePayload,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt,
    };
  });

  const safePayload = {
    schemaVersion: BRAND_REVIEW_CONTRACT_VERSION,
    family: 'brand_generation',
    reviewKind: parent.reviewKind,
  } satisfies ClientBrandReviewBundlePayload;
  const expectedStatus = aggregateProjectedReviewStatus(items);
  if (deliverable.status !== expectedStatus) {
    throw new BrandReviewProjectionError('Brand review parent status does not match its children');
  }
  return {
    id: deliverable.id,
    workspaceId: deliverable.workspaceId,
    externalRef: null,
    type: 'brand_generation',
    kind: 'review',
    status: deliverable.status,
    title: deliverable.title,
    summary: deliverable.summary,
    payload: safePayload,
    note: deliverable.note,
    clientResponseNote: null,
    parentDeliverableId: null,
    sentAt: deliverable.sentAt,
    decidedAt: deliverable.decidedAt,
    dueAt: deliverable.dueAt,
    appliedAt: null,
    generatedAt: null,
    source: null,
    sourceRef: null,
    createdAt: deliverable.createdAt,
    updatedAt: deliverable.updatedAt,
    items,
  };
}
