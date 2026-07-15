import { describe, expect, it } from 'vitest';

import type {
  BrandIntakeFieldEvidence,
  BrandIntakePayload,
  BrandIntakeRevision,
} from '../../shared/types/brand-intake.js';
import { BRAND_INTAKE_FIELD_PATHS } from '../../shared/types/brand-intake.js';
import type { BrandGenerationTargetInputSnapshot } from '../../shared/types/brand-generation.js';
import {
  BRAND_GENERATION_ATOMIC_TARGETS,
  BRAND_GENERATION_LIMITS,
} from '../../shared/types/brand-generation.js';
import {
  runBrandGenerationPreflight,
  type BrandGenerationFrozenTargetInput,
} from '../../server/domains/brand/generation/preflight.js';

const capturedAt = '2026-07-13T12:00:00.000Z';

function makePayload(): BrandIntakePayload {
  return {
    schemaVersion: 1,
    business: {
      businessName: 'Northstar Dental',
      industry: 'Dentistry',
      description: 'Patient-first dental care.',
      services: 'Preventive and cosmetic dentistry',
      locations: 'Austin, Texas',
      differentiators: '',
      website: 'https://northstar.example',
    },
    audience: {
      primaryAudience: 'Busy families',
      painPoints: 'Confusing treatment plans',
      goals: 'Understand every option',
      objections: '',
      buyingStage: 'consideration',
      secondaryAudience: '',
    },
    brand: {
      tone: 'Warm and direct',
      personality: ['Patient', 'Clear'],
      avoidWords: 'guaranteed',
      contentFormats: ['Guides'],
      existingExamples: '',
    },
    competitors: {
      competitors: '',
      whatTheyDoBetter: '',
      whatYouDoBetter: '',
      referenceUrls: '',
    },
    authenticSamples: [],
  };
}

function valueAt(payload: BrandIntakePayload, fieldPath: string): unknown {
  const [section, field] = fieldPath.split('.') as [keyof BrandIntakePayload, string];
  return (payload[section] as unknown as Record<string, unknown>)[field];
}

function makeInput(
  target: BrandGenerationTargetInputSnapshot['target'] = 'voice_foundation',
): BrandGenerationFrozenTargetInput {
  const payload = makePayload();
  const revision: BrandIntakeRevision = {
    id: 'intake-1',
    workspaceId: 'ws-1',
    revision: 1,
    schemaVersion: 1,
    payload,
    evidenceResolutions: [],
    fingerprint: 'a'.repeat(64),
    source: 'client_portal',
    submitter: { actorType: 'client', actorId: 'client-1' },
    mutationKind: 'submission',
    supersedesRevisionId: null,
    supersededByRevisionId: null,
    createdAt: capturedAt,
  };
  const fieldEvidence: BrandIntakeFieldEvidence[] = BRAND_INTAKE_FIELD_PATHS.map(fieldPath => {
    const value = valueAt(payload, fieldPath);
    const present = Array.isArray(value) ? value.length > 0 : value !== '';
    return {
      requirementId: `brand-intake:${fieldPath}`,
      fieldPath,
      availability: present ? 'submitted' : 'missing',
      sourceRefs: present ? [{
        sourceType: 'brand_intake',
        sourceId: revision.id,
        sourceRevision: revision.revision,
        fieldPath,
        capturedAt,
      }] : [],
      resolution: null,
    };
  });
  return {
    workspaceId: revision.workspaceId,
    inputSnapshot: {
      schemaVersion: 1,
      target,
      intakeRevision: {
        intakeRevisionId: revision.id,
        revision: revision.revision,
        fingerprint: revision.fingerprint,
      },
      voiceSnapshot: null,
      approvedDeliverables: [],
      evidenceRequirementIds: [],
      artifactExpectation: target === 'voice_foundation'
        ? null
        : { kind: 'create', deliverableId: null, expectedVersion: 0 },
      capturedAt,
      fingerprint: 'b'.repeat(64),
    },
    intakeRevision: revision,
    fieldEvidence,
    finalizedVoice: null,
    approvedDeliverables: [],
  };
}

describe('brand generation deterministic preflight', () => {
  it('allows bootstrap without a profile and keeps missing authentic voice typed', () => {
    const result = runBrandGenerationPreflight(makeInput());
    expect(result.attemptOutput.readyForPaidWork).toBe(true);
    expect(result.attemptOutput.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'brand-intake:authenticSamples',
        status: 'missing',
        requirementStage: 'ready',
      }),
    ]));
    expect(result.attemptOutput.placeholders[0]?.token).toMatch(/^\[NEEDS CLIENT INPUT:/);
    expect(result.attemptOutput.estimate.inputTokens).toBe(
      6 * (
        BRAND_GENERATION_LIMITS.maxPromptBytes
        + BRAND_GENERATION_LIMITS.providerPromptFramingTokenCeiling
      ),
    );
    expect(
      result.attemptOutput.estimate.inputTokens * BRAND_GENERATION_ATOMIC_TARGETS.length,
    ).toBeLessThanOrEqual(BRAND_GENERATION_LIMITS.maxInputTokens);
  });

  it('blocks paid dependent generation when finalized voice is absent', () => {
    const result = runBrandGenerationPreflight(makeInput('tagline'));
    expect(result.attemptOutput.readyForPaidWork).toBe(false);
    expect(result.attemptOutput.blockingRequirementIds).toContain('brand-voice:finalized');
  });

  it('fails closed when caller-supplied field evidence is not from the exact intake', () => {
    const input = makeInput();
    const first = input.fieldEvidence[0];
    input.fieldEvidence = [{
      ...first,
      sourceRefs: [{
        sourceType: 'brand_intake',
        sourceId: 'other-intake',
        sourceRevision: 1,
        fieldPath: first.fieldPath,
        capturedAt,
      }],
    }, ...input.fieldEvidence.slice(1)];
    expect(() => runBrandGenerationPreflight(input)).toThrow(/exact intake/i);
  });
});
