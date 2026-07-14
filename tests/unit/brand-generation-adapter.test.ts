import { describe, expect, it } from 'vitest';
import type {
  BrandReviewDeliverableInput,
  BrandSuiteReviewMirrorItemInput,
  BrandVoiceFoundationReviewMirrorItemInput,
} from '../../shared/types/brand-generation.js';
import type { ClientDeliverable } from '../../shared/types/client-deliverable.js';
import { getAdapter } from '../../server/domains/inbox/deliverable-adapters/types.js';
import '../../server/domains/inbox/deliverable-adapters/index.js';
import {
  brandReviewBundlePayloadSchema,
  brandReviewItemPayloadSchema,
  projectClientBrandReviewDeliverable,
} from '../../server/domains/brand/review-contracts.js';

function suiteItem(
  overrides: Partial<BrandSuiteReviewMirrorItemInput> = {},
): BrandSuiteReviewMirrorItemInput {
  return {
    clientItemId: 'cdi_brand_tagline',
    createdAt: '2026-07-01T00:00:00.000Z',
    generationItemId: 'bgi_tagline',
    generationItemRevision: 3,
    target: 'tagline',
    content: 'Care that meets you where you are.',
    generationStatus: 'ready_for_human_review',
    sourceDeliverableId: 'bd_tagline',
    sourceDeliverableVersion: 2,
    sourceDeliverableStatus: 'draft',
    mirrorStatus: 'awaiting_client',
    decision: null,
    unresolvedRequirementIds: [],
    hasCanonicalPlaceholder: false,
    ...overrides,
  };
}

function suiteInput(
  runRevision = 4,
  item: BrandSuiteReviewMirrorItemInput = suiteItem(),
): BrandReviewDeliverableInput {
  return {
    reviewKind: 'brand_suite',
    runId: 'bgr_review',
    runRevision,
    items: [item],
  };
}

function foundationItem(
  overrides: Partial<BrandVoiceFoundationReviewMirrorItemInput> = {},
): BrandVoiceFoundationReviewMirrorItemInput {
  return {
    generationItemId: 'bgi_foundation',
    generationItemRevision: 2,
    target: 'voice_foundation',
    content: 'Warm, plainspoken, specific, and calm.',
    generationStatus: 'ready_for_human_review',
    sourceDeliverableId: null,
    sourceDeliverableVersion: null,
    sourceDeliverableStatus: null,
    mirrorStatus: 'awaiting_client',
    decision: null,
    unresolvedRequirementIds: [],
    hasCanonicalPlaceholder: false,
    ...overrides,
  };
}

describe('brand generation deliverable adapter', () => {
  it('registers as a review-only adapter', () => {
    const adapter = getAdapter('brand_generation');
    expect(adapter.type).toBe('brand_generation');
    expect(adapter.appliesOnApprove).toBe(false);
  });

  it('keeps same-run revisions stable while separating foundation and suite bundles', () => {
    const adapter = getAdapter('brand_generation');
    expect(adapter.sourceRef(suiteInput(1))).toBe(adapter.sourceRef(suiteInput(9)));
    expect(adapter.sourceRef(suiteInput())).toBe('brand_generation:brand_suite:bgr_review');

    const foundation: BrandReviewDeliverableInput = {
      reviewKind: 'voice_foundation',
      runId: 'bgr_review',
      runRevision: 1,
      items: [foundationItem()],
    };
    expect(adapter.sourceRef(foundation)).toBe('brand_generation:voice_foundation:bgr_review');
  });

  it('builds a private revision-frozen child while preserving mirror identity', () => {
    const adapter = getAdapter('brand_generation');
    const input = suiteInput();
    expect(adapter.validateSendable(input)).toEqual({ ok: true });

    const built = adapter.buildPayload(input);
    expect(built.kind).toBe('review');
    expect(built.items).toHaveLength(1);
    expect(built.items![0]).toMatchObject({
      id: 'cdi_brand_tagline',
      createdAt: '2026-07-01T00:00:00.000Z',
      status: 'awaiting_client',
      field: 'tagline',
      proposedValue: 'Care that meets you where you are.',
      applyable: false,
      itemPayload: {
        family: 'brand_generation',
        reviewKind: 'brand_suite',
        runId: 'bgr_review',
        runRevision: 4,
        generationItemId: 'bgi_tagline',
        generationItemRevision: 3,
        sourceDeliverableId: 'bd_tagline',
        expectedDeliverableVersion: 2,
      },
    });
    expect(() => brandReviewBundlePayloadSchema.parse(built.payload)).not.toThrow();
    expect(() => brandReviewItemPayloadSchema.parse(built.items![0].itemPayload)).not.toThrow();
  });

  it('projects only explicit client-safe fields from the private review envelope', () => {
    const built = getAdapter('brand_generation').buildPayload(suiteInput());
    const raw: ClientDeliverable = {
      id: 'cd_brand_review',
      workspaceId: 'ws_brand',
      externalRef: 'private-external-ref',
      type: 'brand_generation',
      kind: 'review',
      status: 'awaiting_client',
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      note: 'Please review these pieces.',
      clientResponseNote: null,
      parentDeliverableId: null,
      sentAt: '2026-07-13T12:00:00.000Z',
      decidedAt: null,
      dueAt: null,
      appliedAt: null,
      generatedAt: '2026-07-13T11:00:00.000Z',
      source: 'private-source',
      sourceRef: 'brand_generation:brand_suite:bgr_review',
      createdAt: '2026-07-13T11:00:00.000Z',
      updatedAt: '2026-07-13T12:00:00.000Z',
      items: built.items!.map((item, index) => ({
        id: item.id ?? `item-${index}`,
        deliverableId: 'cd_brand_review',
        status: item.status,
        targetRef: item.targetRef ?? null,
        collectionId: item.collectionId ?? null,
        field: item.field ?? null,
        currentValue: item.currentValue ?? null,
        proposedValue: item.proposedValue ?? null,
        clientValue: item.clientValue ?? null,
        clientNote: item.clientNote ?? null,
        applyable: item.applyable ?? false,
        itemPayload: item.itemPayload ?? null,
        sortOrder: item.sortOrder ?? index,
        createdAt: item.createdAt ?? '2026-07-13T11:00:00.000Z',
      })),
    };

    const projected = projectClientBrandReviewDeliverable(raw);
    expect(projected.payload).toEqual({
      schemaVersion: 1,
      family: 'brand_generation',
      reviewKind: 'brand_suite',
    });
    expect(projected.items![0].itemPayload).toEqual({
      schemaVersion: 1,
      family: 'brand_generation',
      reviewKind: 'brand_suite',
      target: 'tagline',
    });
    expect(projected).toMatchObject({
      externalRef: null,
      source: null,
      sourceRef: null,
      generatedAt: null,
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('bgr_review');
    expect(serialized).not.toContain('bd_tagline');
    expect(serialized).not.toContain('generationItemRevision');
  });

  it('keeps a resend partial when an approved child is retained and rejects bad CAS lineage', () => {
    const adapter = getAdapter('brand_generation');
    const approved = suiteItem({
      generationItemRevision: 3,
      generationStatus: 'approved',
      sourceDeliverableStatus: 'approved',
      mirrorStatus: 'approved',
      decision: {
        runId: 'bgr_review',
        itemId: 'bgi_tagline',
        expectedGenerationItemRevision: 2,
        resultingGenerationItemRevision: 3,
        deliverableId: 'bd_tagline',
        deliverableType: 'tagline',
        expectedDeliverableVersion: 2,
        decidedAt: '2026-07-13T12:00:00.000Z',
        decidedBy: { actorType: 'client', actorId: 'client-1' },
        decision: 'approve',
      },
    });
    const awaiting = suiteItem({
      clientItemId: 'cdi_brand_values',
      generationItemId: 'bgi_values',
      target: 'values',
      sourceDeliverableId: 'bd_values',
    });
    const input: BrandReviewDeliverableInput = {
      reviewKind: 'brand_suite',
      runId: 'bgr_review',
      runRevision: 5,
      items: [approved, awaiting],
    };

    expect(adapter.validateSendable(input)).toEqual({ ok: true });
    expect(adapter.resolveSendStatus?.(input, null)).toBe('partial');
    expect(adapter.validateSendable({
      ...input,
      items: [{
        ...approved,
        generationItemRevision: 4,
        decision: approved.decision == null
          ? null
          : { ...approved.decision, resultingGenerationItemRevision: 4 },
      }, awaiting],
    }).ok).toBe(false);
  });

  it('rejects unresolved facts and impossible source states before a send', () => {
    const adapter = getAdapter('brand_generation');
    expect(adapter.validateSendable(suiteInput(1, suiteItem({
      unresolvedRequirementIds: ['req_missing'],
    }))).ok).toBe(false);
    expect(adapter.validateSendable(suiteInput(1, suiteItem({
      sourceDeliverableStatus: 'approved',
    }))).ok).toBe(false);
  });
});
