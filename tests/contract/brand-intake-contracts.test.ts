import { describe, expect, it } from 'vitest';
import {
  BRAND_INTAKE_FIELD_PATHS,
  BRAND_INTAKE_FIELD_POLICY,
  BRAND_INTAKE_LIMITS,
  BRAND_INTAKE_RESOLUTION_SOURCE_TYPES,
  type BrandIntakeEvidenceResolution,
  type BrandIntakeRevision,
  type PublicOnboardingSaveResponse,
} from '../../shared/types/brand-intake.js';
import {
  brandIntakePayloadSchema,
  publicOnboardingQuestionnaireSchema,
} from '../../shared/types/brand-intake-schemas.js';
import {
  getBrandIntakeInputSchema,
  resolveBrandIntakeEvidenceInputSchema,
} from '../../shared/types/mcp-brand-intake-schemas.js';

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
        buyingStage: 'mixed', secondaryAudience: '',
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

    const resolution: BrandIntakeEvidenceResolution = {
      id: 'resolution-1',
      requirementId: 'business.website',
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

  it('defines bounded snake-case MCP inputs for exact revision reads and resolutions', () => {
    expect(getBrandIntakeInputSchema.safeParse({
      workspace_id: 'workspace-1',
      intake_revision_id: 'intake-1',
    }).success).toBe(true);
    expect(resolveBrandIntakeEvidenceInputSchema.safeParse({
      workspace_id: 'workspace-1',
      intake_revision_id: 'intake-1',
      expected_revision: 1,
      requirement_id: 'business.website',
      field_path: 'business.website',
      value: { kind: 'url', value: 'https://example.com' },
      source_ref: {
        source_type: 'operator_attestation',
        source_id: 'attestation-1',
        captured_at: '2026-07-13T12:00:00.000Z',
      },
      idempotency_key: 'resolve-website-1',
    }).success).toBe(true);
    expect(resolveBrandIntakeEvidenceInputSchema.safeParse({
      workspace_id: 'workspace-1',
      intake_revision_id: 'intake-1',
      expected_revision: 1,
      requirement_id: 'business.website',
      field_path: 'business.website',
      value: { kind: 'text_list', value: ['wrong kind'] },
      source_ref: {
        source_type: 'brand_deliverable',
        source_id: 'generated-1',
        captured_at: '2026-07-13T12:00:00.000Z',
      },
      idempotency_key: 'resolve-website-1',
    }).success).toBe(false);
  });
});
