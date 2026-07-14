import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BRAND_INTAKE_FIELD_PATHS,
  BRAND_INTAKE_FIELD_POLICY,
  BRAND_INTAKE_LIMITS,
  BRAND_INTAKE_RESOLUTION_SOURCE_TYPES,
  BRAND_INTAKE_SOURCE_ACTOR_POLICY,
  BRAND_INTAKE_WORKSPACE_EVENT_ACTION,
  BRAND_INTAKE_WORKSPACE_EVENT_DOMAIN,
  brandIntakeEvidenceRequirementId,
  type BrandIntakeEvidenceValue,
  type BrandIntakeEvidenceResolution,
  type BrandIntakeFieldPath,
  type BrandIntakeRevision,
  type PublicOnboardingSaveResponse,
  type ResolveBrandIntakeEvidenceRequest,
} from '../../shared/types/brand-intake.js';
import {
  brandIntakeCompatibilityProjectionStateSchema,
  brandIntakeEvidenceResolutionsSchema,
  brandIntakePayloadSchema,
  publicOnboardingQuestionnaireSchema,
  resolveBrandIntakeEvidenceBodySchema,
  type ResolveBrandIntakeEvidenceBody,
} from '../../shared/types/brand-intake-schemas.js';
import {
  getBrandIntakeInputSchema,
  resolveBrandIntakeEvidenceInputSchema,
  type ResolveBrandIntakeEvidenceInput,
} from '../../shared/types/mcp-brand-intake-schemas.js';
import { queryKeys } from '../../src/lib/queryKeys.js';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation.js';
import { WS_EVENTS } from '../../src/lib/wsEvents.js';

const EXPECTED_FIELD_PATHS = [
  'business.businessName',
  'business.industry',
  'business.description',
  'business.services',
  'business.locations',
  'business.differentiators',
  'business.website',
  'audience.primaryAudience',
  'audience.painPoints',
  'audience.goals',
  'audience.objections',
  'audience.buyingStage',
  'audience.secondaryAudience',
  'brand.tone',
  'brand.personality',
  'brand.avoidWords',
  'brand.contentFormats',
  'brand.existingExamples',
  'competitors.competitors',
  'competitors.whatTheyDoBetter',
  'competitors.whatYouDoBetter',
  'competitors.referenceUrls',
] as const;

function maxEvidenceValue(fieldPath: BrandIntakeFieldPath): BrandIntakeEvidenceValue {
  switch (BRAND_INTAKE_FIELD_POLICY[fieldPath].valueKind) {
    case 'text': return { kind: 'text', value: '界'.repeat(BRAND_INTAKE_LIMITS.maxTextLength) };
    case 'text_list': return {
      kind: 'text_list',
      value: Array.from(
        { length: BRAND_INTAKE_LIMITS.maxListItems },
        (_, index) => `${'界'.repeat(BRAND_INTAKE_LIMITS.maxListItemLength - 2)}${String(index).padStart(2, '0')}`,
      ),
    };
    case 'url': return { kind: 'url', value: 'https://example.com/evidence' };
    case 'url_list': return {
      kind: 'url_list',
      value: Array.from(
        { length: BRAND_INTAKE_LIMITS.maxListItems },
        (_, index) => `https://example.com/evidence/${index}`,
      ),
    };
    case 'buying_stage': return { kind: 'buying_stage', value: 'mixed' };
  }
}

describe('brand intake shared contracts', () => {
  it('locks one exhaustive policy over the 22 durable questionnaire fields', () => {
    expect(BRAND_INTAKE_FIELD_PATHS).toEqual(EXPECTED_FIELD_PATHS);
    expect(new Set(BRAND_INTAKE_FIELD_PATHS).size).toBe(22);
    expect(Object.keys(BRAND_INTAKE_FIELD_POLICY).sort()).toEqual(
      [...EXPECTED_FIELD_PATHS].sort(),
    );
    expect(BRAND_INTAKE_FIELD_POLICY['business.website'].valueKind).toBe('url');
    expect(BRAND_INTAKE_FIELD_POLICY['competitors.referenceUrls'].valueKind).toBe('url_list');
    expect(BRAND_INTAKE_FIELD_POLICY['brand.personality'].valueKind).toBe('text_list');
    expect(BRAND_INTAKE_FIELD_POLICY['audience.buyingStage'].valueKind).toBe('buying_stage');
  });

  it('normalizes the permissive legacy public body into the strict durable shape', () => {
    expect(publicOnboardingQuestionnaireSchema.parse({})).toEqual({
      business: {
        businessName: '', industry: '', description: '', services: '', locations: '',
        differentiators: '', website: '',
      },
      audience: {
        primaryAudience: '', painPoints: '', goals: '', objections: '',
        buyingStage: '', secondaryAudience: '',
      },
      brand: {
        tone: '', personality: [], avoidWords: '', contentFormats: [], existingExamples: '',
      },
      competitors: {
        competitors: '', whatTheyDoBetter: '', whatYouDoBetter: '', referenceUrls: '',
      },
    });

    const parsed = publicOnboardingQuestionnaireSchema.parse({
      business: { businessName: '  Example Co  ', website: '' },
      brand: { personality: [' Direct ', 'Direct', ''] },
    });
    expect(parsed.business.businessName).toBe('Example Co');
    expect(parsed.brand.personality).toEqual(['Direct']);
    expect(publicOnboardingQuestionnaireSchema.parse({
      audience: { buyingStage: 'mixed' },
    }).audience.buyingStage).toBe('mixed');
  });

  it('fails closed on unknown keys, unsafe URLs, and bounded-field overflow', () => {
    expect(publicOnboardingQuestionnaireSchema.safeParse({ unexpected: true }).success).toBe(false);
    expect(publicOnboardingQuestionnaireSchema.safeParse({
      business: { businessName: 'Example', unexpected: true },
    }).success).toBe(false);
    expect(publicOnboardingQuestionnaireSchema.safeParse({
      business: { website: 'ftp://example.com' },
    }).success).toBe(false);
    expect(publicOnboardingQuestionnaireSchema.safeParse({
      competitors: { referenceUrls: 'https://example.com\nnot-a-url' },
    }).success).toBe(false);
    expect(publicOnboardingQuestionnaireSchema.safeParse({
      business: { businessName: 'x'.repeat(BRAND_INTAKE_LIMITS.maxShortTextLength + 1) },
    }).success).toBe(false);
    expect(publicOnboardingQuestionnaireSchema.safeParse({
      brand: {
        personality: Array.from(
          { length: BRAND_INTAKE_LIMITS.maxListItems + 1 },
          (_, index) => `trait-${index}`,
        ),
      },
    }).success).toBe(false);
  });

  it('validates schema-versioned payloads and authentic source provenance', () => {
    const parsed = brandIntakePayloadSchema.parse({
      schemaVersion: 1,
      business: { businessName: 'Example Co' },
      audience: {},
      brand: {},
      competitors: {},
      authenticSamples: [{
        id: 'sample-1',
        kind: 'client_written',
        content: 'An authentic client-written example.',
        context: 'body',
        sourceRef: {
          sourceType: 'client_submission',
          sourceId: 'intake-1',
          fieldPath: 'brand.existingExamples',
          capturedAt: '2026-07-13T12:00:00.000Z',
        },
      }],
    });
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.authenticSamples).toHaveLength(1);

    expect(brandIntakePayloadSchema.safeParse({
      ...parsed,
      authenticSamples: [{
        ...parsed.authenticSamples[0],
        sourceRef: {
          sourceType: 'brand_deliverable',
          sourceId: 'generated-1',
          capturedAt: '2026-07-13T12:00:00.000Z',
        },
      }],
    }).success).toBe(false);
  });

  it('keeps evidence resolutions typed, immutable, and separate from public response compatibility', () => {
    expect(BRAND_INTAKE_RESOLUTION_SOURCE_TYPES).toEqual([
      'client_submission',
      'operator_submission',
      'external_research',
      'operator_attestation',
    ]);
    expect(BRAND_INTAKE_SOURCE_ACTOR_POLICY).toEqual({
      client_portal: 'client',
      admin: 'operator',
      mcp: 'mcp',
      migration: 'system',
    });

    const resolution: BrandIntakeEvidenceResolution = {
      id: 'resolution-1',
      requirementId: 'brand-intake:business.website',
      fieldPath: 'business.website',
      value: { kind: 'url', value: 'https://example.com' },
      sourceRef: {
        sourceType: 'operator_attestation',
        sourceId: 'attestation-1',
        capturedAt: '2026-07-13T12:00:00.000Z',
      },
      resolvedBy: { actorType: 'operator', actorId: 'operator-1' },
      expectedSourceRevision: 1,
      expectedArtifactRevisions: [],
      resolvedAt: '2026-07-13T12:00:00.000Z',
    };
    const revision: BrandIntakeRevision = {
      id: 'intake-1',
      workspaceId: 'workspace-1',
      revision: 2,
      schemaVersion: 1,
      payload: brandIntakePayloadSchema.parse({
        schemaVersion: 1,
        business: {}, audience: {}, brand: {}, competitors: {}, authenticSamples: [],
      }),
      evidenceResolutions: [resolution],
      fingerprint: 'a'.repeat(64),
      source: 'admin',
      submitter: { actorType: 'operator', actorId: 'operator-1' },
      mutationKind: 'evidence_resolution',
      supersedesRevisionId: 'intake-0',
      supersededByRevisionId: null,
      createdAt: '2026-07-13T12:00:00.000Z',
    };
    const publicResponse: PublicOnboardingSaveResponse = {
      ok: true,
      message: 'Onboarding responses saved successfully',
    };
    expect(revision.evidenceResolutions).toEqual([resolution]);
    expect(publicResponse).toEqual({
      ok: true,
      message: 'Onboarding responses saved successfully',
    });
  });

  it('accepts a full legal multibyte evidence census above the former storage ceiling', () => {
    const resolutions = BRAND_INTAKE_FIELD_PATHS.map((fieldPath, index) => ({
      id: `resolution-${index}`,
      requirementId: brandIntakeEvidenceRequirementId(fieldPath),
      fieldPath,
      value: maxEvidenceValue(fieldPath),
      sourceRef: {
        sourceType: 'operator_attestation' as const,
        sourceId: `attestation-${index}`,
        label: '界'.repeat(BRAND_INTAKE_LIMITS.maxActorLabelLength),
        capturedAt: '2026-07-13T12:00:00.000Z',
      },
      resolvedBy: { actorType: 'operator' as const, actorId: 'operator-1' },
      expectedSourceRevision: 1,
      expectedArtifactRevisions: [] as [],
      resolvedAt: '2026-07-13T12:00:00.000Z',
    }));
    const encodedSize = new TextEncoder().encode(JSON.stringify(resolutions)).byteLength;

    expect(encodedSize).toBeGreaterThan(128 * 1024);
    expect(encodedSize).toBeLessThanOrEqual(BRAND_INTAKE_LIMITS.maxEvidenceSnapshotBytes);
    expect(brandIntakeEvidenceResolutionsSchema.parse(resolutions)).toHaveLength(22);
  });

  it('pins explicit compatibility ownership instead of guessing competitor provenance', () => {
    expect(brandIntakeCompatibilityProjectionStateSchema.parse({
      preservedCompetitorDomains: ['manual.example', 'overlap.example'],
      intakeOwnedCompetitorDomains: ['intake-only.example'],
    })).toEqual({
      preservedCompetitorDomains: ['manual.example', 'overlap.example'],
      intakeOwnedCompetitorDomains: ['intake-only.example'],
    });
    expect(brandIntakeCompatibilityProjectionStateSchema.safeParse({
      preservedCompetitorDomains: ['manual.example', 'manual.example'],
      intakeOwnedCompetitorDomains: [],
    }).success).toBe(false);
    expect(brandIntakeCompatibilityProjectionStateSchema.safeParse({
      preservedCompetitorDomains: ['overlap.example'],
      intakeOwnedCompetitorDomains: ['overlap.example'],
    }).success).toBe(false);
  });

  it('defines bounded snake-case MCP inputs for exact revision reads and resolutions', () => {
    expect(getBrandIntakeInputSchema.safeParse({
      workspace_id: 'workspace-1',
      intake_revision_id: 'intake-1',
    }).success).toBe(true);
    expect(resolveBrandIntakeEvidenceInputSchema.safeParse({
      workspace_id: 'workspace-1',
      intake_revision_id: 'intake-1',
      expected_revision: 1,
      requirement_id: 'brand-intake:business.website',
      field_path: 'business.website',
      value: { kind: 'url', value: 'https://example.com' },
      source_ref: {
        source_type: 'operator_attestation',
        source_id: 'attestation-1',
        captured_at: '2026-07-13T12:00:00.000Z',
      },
      idempotency_key: 'resolve-website-1',
    }).success).toBe(true);
    const validWebsiteResolution = {
      workspace_id: 'workspace-1',
      intake_revision_id: 'intake-1',
      expected_revision: 1,
      requirement_id: 'brand-intake:business.website',
      field_path: 'business.website',
      value: { kind: 'url', value: 'https://example.com' },
      source_ref: {
        source_type: 'operator_attestation',
        source_id: 'attestation-1',
        captured_at: '2026-07-13T12:00:00.000Z',
      },
      idempotency_key: 'resolve-website-1',
    };
    expect(resolveBrandIntakeEvidenceInputSchema.safeParse({
      ...validWebsiteResolution,
      value: { kind: 'text_list', value: ['wrong kind'] },
    }).success).toBe(false);
    expect(resolveBrandIntakeEvidenceInputSchema.safeParse({
      ...validWebsiteResolution,
      source_ref: {
        source_type: 'brand_deliverable',
        source_id: 'generated-1',
        captured_at: '2026-07-13T12:00:00.000Z',
      },
    }).success).toBe(false);

    const validPersonalityResolution = {
      ...validWebsiteResolution,
      requirement_id: 'brand-intake:brand.personality',
      field_path: 'brand.personality',
      value: { kind: 'text_list', value: ['Direct'] },
      idempotency_key: 'resolve-personality-1',
    };
    expect(resolveBrandIntakeEvidenceInputSchema.safeParse(validPersonalityResolution).success)
      .toBe(true);
    expect(resolveBrandIntakeEvidenceInputSchema.safeParse({
      ...validPersonalityResolution,
      requirement_id: 'brand-intake:business.website',
    }).success).toBe(false);
    expect(resolveBrandIntakeEvidenceInputSchema.safeParse({
      ...validPersonalityResolution,
      value: { kind: 'text_list', value: [] },
    }).success).toBe(false);
    expect(resolveBrandIntakeEvidenceInputSchema.safeParse({
      ...validPersonalityResolution,
      value: { kind: 'text_list' },
      idempotency_key: 'resolve-personality-2',
    }).success).toBe(false);
    expect(resolveBrandIntakeEvidenceInputSchema.safeParse({
      ...validPersonalityResolution,
      value: { kind: 'text_list', value: ['   '] },
      idempotency_key: 'resolve-personality-3',
    }).success).toBe(false);
  });

  it('shares one strict camel-case admin resolution body contract', () => {
    expectTypeOf<ResolveBrandIntakeEvidenceBody['requirementId']>()
      .toEqualTypeOf<ResolveBrandIntakeEvidenceRequest['requirementId']>();
    expectTypeOf<ResolveBrandIntakeEvidenceInput['requirement_id']>()
      .toEqualTypeOf<ResolveBrandIntakeEvidenceRequest['requirementId']>();
    expect(resolveBrandIntakeEvidenceBodySchema.safeParse({
      expectedRevision: 1,
      requirementId: 'brand-intake:business.website',
      fieldPath: 'business.website',
      value: { kind: 'url', value: 'https://example.com' },
      sourceRef: {
        sourceType: 'operator_attestation',
        sourceId: 'attestation-1',
        capturedAt: '2026-07-13T12:00:00.000Z',
      },
      idempotencyKey: 'resolve-website-1',
    }).success).toBe(true);
    expect(resolveBrandIntakeEvidenceBodySchema.safeParse({
      expectedRevision: 1,
      requirementId: 'brand-intake:brand.personality',
      fieldPath: 'brand.personality',
      value: { kind: 'text_list', value: [] },
      sourceRef: {
        sourceType: 'operator_attestation',
        sourceId: 'attestation-1',
        capturedAt: '2026-07-13T12:00:00.000Z',
      },
      idempotencyKey: 'resolve-personality-1',
    }).success).toBe(false);
  });

  it('invalidates durable intake and intelligence reads after a workspace update', () => {
    const workspaceId = 'workspace-1';
    const metadata = {
      domain: BRAND_INTAKE_WORKSPACE_EVENT_DOMAIN,
      action: BRAND_INTAKE_WORKSPACE_EVENT_ACTION,
      cause: 'submission',
      intakeRevisionId: 'intake-1',
      revision: 1,
    };
    const adminKeys = getWorkspaceInvalidationKeys(
      WS_EVENTS.WORKSPACE_UPDATED,
      workspaceId,
      metadata,
      'admin',
    );
    const clientKeys = getWorkspaceInvalidationKeys(
      WS_EVENTS.WORKSPACE_UPDATED,
      workspaceId,
      metadata,
      'client-dashboard',
    );

    expect(adminKeys).toContainEqual(queryKeys.admin.brandIntake(workspaceId));
    expect(adminKeys).toContainEqual(queryKeys.admin.intelligenceAll(workspaceId));
    expect(clientKeys).toContainEqual(queryKeys.client.intelligence(workspaceId));
  });
});
