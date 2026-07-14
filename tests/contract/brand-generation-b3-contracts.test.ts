import { describe, expect, it } from 'vitest';
import {
  BRAND_REVIEW_BUNDLE_KINDS,
  BRAND_REVIEW_ITEM_DECISIONS,
} from '../../shared/types/brand-generation.js';
import { DELIVERABLE_TYPES } from '../../shared/types/client-deliverable.js';
import { listAdapterTypes } from '../../server/domains/inbox/deliverable-adapters/index.js';
import {
  brandReviewClientDecisionRequestSchema,
  brandReviewItemPayloadSchema,
} from '../../server/domains/brand/review-contracts.js';
import { getDeliverableTransitions } from '../../server/state-machines.js';
import { queryKeys } from '../../src/lib/queryKeys.js';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation.js';
import { WS_EVENTS } from '../../src/lib/wsEvents.js';

describe('B3 brand review contract root', () => {
  it('registers brand generation on the unified deliverable spine', () => {
    expect(DELIVERABLE_TYPES).toContain('brand_generation');
    expect(listAdapterTypes()).toContain('brand_generation');
    expect([...listAdapterTypes()].sort()).toEqual([...DELIVERABLE_TYPES].sort());
  });

  it('keeps foundation and durable-suite review as distinct bundle kinds', () => {
    expect(BRAND_REVIEW_BUNDLE_KINDS).toEqual(['voice_foundation', 'brand_suite']);
    expect(BRAND_REVIEW_ITEM_DECISIONS).toEqual(['approve', 'changes_requested']);
  });

  it('supports honest repeated partial review without opening an apply edge', () => {
    const transitions = getDeliverableTransitions('brand_generation');

    expect(transitions.awaiting_client).toContain('partial');
    expect(transitions.awaiting_client).toContain('approved');
    expect(transitions.awaiting_client).not.toContain('declined');
    expect(transitions.changes_requested).not.toContain('declined');
    expect(transitions.partial).toContain('partial');
    expect(transitions.partial).toContain('approved');
    expect(transitions.partial).toContain('expired');
    expect(transitions.approved).toEqual([]);
  });

  it('locks the admin run and client summary cache identities', () => {
    expect(queryKeys.admin.brandGeneration('ws-1', 'run-1')).toEqual([
      'admin-brand-generation',
      'ws-1',
      'run-1',
    ]);
    expect(queryKeys.client.brandSummary('ws-1')).toEqual([
      'client-brand-summary',
      'ws-1',
    ]);
  });

  it('keeps review and authority mutations fresh on both admin and client surfaces', () => {
    const summaryKey = queryKeys.client.brandSummary('ws-1');
    const generationKey = queryKeys.admin.brandGenerationAll('ws-1');

    expect(getWorkspaceInvalidationKeys(
      WS_EVENTS.DELIVERABLE_UPDATED,
      'ws-1',
      undefined,
      'admin',
    )).toContainEqual(generationKey);
    expect(getWorkspaceInvalidationKeys(
      WS_EVENTS.DELIVERABLE_UPDATED,
      'ws-1',
      undefined,
      'client-dashboard',
    )).toContainEqual(summaryKey);
    expect(getWorkspaceInvalidationKeys(
      WS_EVENTS.BRAND_IDENTITY_UPDATED,
      'ws-1',
      undefined,
      'client-dashboard',
    )).toContainEqual(summaryKey);
    expect(getWorkspaceInvalidationKeys(
      WS_EVENTS.VOICE_PROFILE_UPDATED,
      'ws-1',
      undefined,
      'client-dashboard',
    )).toContainEqual(summaryKey);
  });

  it('rejects corrupted private review identity and blank changes requests', () => {
    const itemPayload = {
      schemaVersion: 1,
      family: 'brand_generation',
      reviewKind: 'brand_suite',
      runId: 'run-1',
      runRevision: 2,
      generationItemId: 'item-1',
      generationItemRevision: 4,
      target: 'tagline',
      sourceDeliverableId: 'deliverable-1',
      expectedDeliverableVersion: 3,
      decision: {
        runId: 'run-1',
        itemId: 'item-1',
        expectedGenerationItemRevision: 3,
        resultingGenerationItemRevision: 4,
        deliverableId: 'deliverable-1',
        deliverableType: 'tagline',
        expectedDeliverableVersion: 3,
        decidedAt: '2026-07-13T12:00:00.000Z',
        decidedBy: { actorType: 'client', actorId: 'client-1' },
        decision: 'approve',
      },
    } as const;

    expect(brandReviewItemPayloadSchema.safeParse(itemPayload).success).toBe(true);
    expect(brandReviewItemPayloadSchema.safeParse({
      ...itemPayload,
      decision: { ...itemPayload.decision, runId: 'different-run' },
    }).success).toBe(false);
    expect(brandReviewClientDecisionRequestSchema.safeParse({
      deliverableItemId: 'item-1',
      decision: 'changes_requested',
      note: '   ',
    }).success).toBe(false);
  });

  it('enforces exact generation-item revision lineage for each review kind', () => {
    const suite = {
      schemaVersion: 1,
      family: 'brand_generation',
      reviewKind: 'brand_suite',
      runId: 'run-1',
      runRevision: 2,
      generationItemId: 'item-1',
      generationItemRevision: 4,
      target: 'tagline',
      sourceDeliverableId: 'deliverable-1',
      expectedDeliverableVersion: 3,
      decision: {
        runId: 'run-1',
        itemId: 'item-1',
        expectedGenerationItemRevision: 3,
        resultingGenerationItemRevision: 4,
        deliverableId: 'deliverable-1',
        deliverableType: 'tagline',
        expectedDeliverableVersion: 3,
        decidedAt: '2026-07-13T12:00:00.000Z',
        decidedBy: { actorType: 'client', actorId: 'client-1' },
        decision: 'approve',
      },
    } as const;
    expect(brandReviewItemPayloadSchema.safeParse(suite).success).toBe(true);
    expect(brandReviewItemPayloadSchema.safeParse({
      ...suite,
      generationItemRevision: 5,
      decision: { ...suite.decision, resultingGenerationItemRevision: 5 },
    }).success).toBe(false);

    const foundation = {
      schemaVersion: 1,
      family: 'brand_generation',
      reviewKind: 'voice_foundation',
      runId: 'run-1',
      runRevision: 2,
      generationItemId: 'foundation-1',
      generationItemRevision: 2,
      target: 'voice_foundation',
      sourceDeliverableId: null,
      expectedDeliverableVersion: null,
      decision: {
        runId: 'run-1',
        itemId: 'foundation-1',
        expectedGenerationItemRevision: 2,
        resultingGenerationItemRevision: 2,
        decidedAt: '2026-07-13T12:00:00.000Z',
        decidedBy: { actorType: 'client', actorId: 'client-1' },
        decision: 'approve',
      },
    } as const;
    expect(brandReviewItemPayloadSchema.safeParse(foundation).success).toBe(true);
    expect(brandReviewItemPayloadSchema.safeParse({
      ...foundation,
      generationItemRevision: 3,
      decision: { ...foundation.decision, resultingGenerationItemRevision: 3 },
    }).success).toBe(false);
  });
});
