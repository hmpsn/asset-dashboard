import { describe, expect, it, vi } from 'vitest';

import type {
  BrandDeliverable,
  DeliverableVersion,
} from '../../shared/types/brand-engine.js';
import type {
  BrandIntakeFieldEvidence,
  BrandIntakePayload,
  BrandIntakeRevision,
} from '../../shared/types/brand-intake.js';
import { BRAND_INTAKE_FIELD_PATHS } from '../../shared/types/brand-intake.js';
import type { FinalizedVoiceSnapshot } from '../../shared/types/voice-finalization.js';
import {
  hydrateBrandGenerationSnapshot,
  prepareBrandGenerationSnapshots,
} from '../../server/domains/brand/generation/snapshots.js';

const CAPTURED_AT = '2026-07-14T12:00:00.000Z';
const INTAKE_FINGERPRINT = 'a'.repeat(64);
const VOICE_FINGERPRINT = 'b'.repeat(64);

function payload(): BrandIntakePayload {
  return {
    schemaVersion: 1,
    business: {
      businessName: 'Northstar Dental',
      industry: 'Dentistry',
      description: 'Patient-first dental care.',
      services: 'Preventive and cosmetic dentistry',
      locations: 'Austin, Texas',
      differentiators: 'Clear treatment explanations',
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

function intake(): { revision: BrandIntakeRevision; fieldEvidence: BrandIntakeFieldEvidence[] } {
  const revision: BrandIntakeRevision = {
    id: 'intake-1',
    workspaceId: 'ws-1',
    revision: 3,
    schemaVersion: 1,
    payload: payload(),
    evidenceResolutions: [],
    fingerprint: INTAKE_FINGERPRINT,
    source: 'client_portal',
    submitter: { actorType: 'client', actorId: 'client-1' },
    mutationKind: 'submission',
    supersedesRevisionId: null,
    supersededByRevisionId: null,
    createdAt: '2026-07-14T10:00:00.000Z',
  };
  const fieldEvidence = BRAND_INTAKE_FIELD_PATHS.map(fieldPath => {
    const [section, field] = fieldPath.split('.') as [keyof BrandIntakePayload, string];
    const value = (revision.payload[section] as unknown as Record<string, unknown>)[field];
    const present = Array.isArray(value) ? value.length > 0 : value !== '';
    return {
      requirementId: `brand-intake:${fieldPath}`,
      fieldPath,
      availability: present ? 'submitted' as const : 'missing' as const,
      sourceRefs: present ? [{
        sourceType: 'brand_intake' as const,
        sourceId: revision.id,
        sourceRevision: revision.revision,
        fieldPath,
        capturedAt: revision.createdAt,
      }] : [],
      resolution: null,
    };
  });
  return { revision, fieldEvidence };
}

function voice(): FinalizedVoiceSnapshot {
  return {
    id: 'voice-finalization-1',
    workspaceId: 'ws-1',
    voiceProfileId: 'voice-profile-1',
    voiceVersion: 2,
    profileRevision: 4,
    voiceDNA: {
      personalityTraits: ['Warm'],
      toneSpectrum: { formal_casual: 7, serious_playful: 3, technical_accessible: 8 },
      sentenceStyle: 'Short, direct sentences.',
      vocabularyLevel: 'Plain language.',
    },
    guardrails: {
      forbiddenWords: ['guaranteed'],
      requiredTerminology: [],
      toneBoundaries: ['Reassuring, never dismissive.'],
      antiPatterns: ['No invented outcomes.'],
    },
    contextModifiers: [],
    anchors: [{
      selector: {
        kind: 'brand_intake_sample',
        intakeRevisionId: 'intake-1',
        intakeRevision: 3,
        sampleId: 'sample-1',
      },
      content: 'We explain every next step.',
      context: 'body',
      evidenceRef: {
        sourceType: 'brand_intake',
        sourceId: 'intake-1',
        sourceRevision: 3,
        capturedAt: '2026-07-14T10:00:00.000Z',
        selectedBy: { actorType: 'operator', actorId: 'operator-1' },
        selectedAt: '2026-07-14T11:00:00.000Z',
      },
    }],
    calibrationSelections: [],
    finalizedBy: { actorType: 'operator', actorId: 'operator-1' },
    finalizedAt: '2026-07-14T11:00:00.000Z',
    fingerprint: VOICE_FINGERPRINT,
    anchorEvidenceRefs: [{
      sourceType: 'brand_intake',
      sourceId: 'intake-1',
      sourceRevision: 3,
      capturedAt: '2026-07-14T10:00:00.000Z',
      selectedBy: { actorType: 'operator', actorId: 'operator-1' },
      selectedAt: '2026-07-14T11:00:00.000Z',
    }],
    executionActor: { actorType: 'operator', actorId: 'operator-1' },
    createdAt: '2026-07-14T11:00:00.000Z',
  };
}

function deliverable(
  deliverableType: BrandDeliverable['deliverableType'],
  options: Partial<BrandDeliverable> = {},
): BrandDeliverable {
  return {
    id: `deliverable-${deliverableType}`,
    workspaceId: 'ws-1',
    deliverableType,
    content: `${deliverableType} content`,
    status: 'draft',
    version: 1,
    tier: 'essentials',
    createdAt: '2026-07-14T09:00:00.000Z',
    updatedAt: '2026-07-14T09:30:00.000Z',
    ...options,
  };
}

describe('brand generation snapshot authority', () => {
  it('freezes approved context and the exact artifact CAS expectation', () => {
    const authority = intake();
    const existingMission = deliverable('mission', { id: 'mission-7', version: 7 });
    const approvedVision = deliverable('vision', {
      id: 'vision-approved',
      status: 'approved',
      version: 2,
      content: 'A verified approved vision.',
      updatedAt: '2026-07-14T11:30:00.000Z',
    });

    const [frozen] = prepareBrandGenerationSnapshots({
      workspaceId: 'ws-1',
      intake: authority,
      targets: ['mission'],
      finalizedVoice: voice(),
      capturedAt: CAPTURED_AT,
      deliverables: [existingMission, approvedVision],
    });

    expect(frozen.inputSnapshot).toMatchObject({
      target: 'mission',
      intakeRevision: {
        intakeRevisionId: authority.revision.id,
        revision: authority.revision.revision,
        fingerprint: authority.revision.fingerprint,
      },
      voiceSnapshot: {
        voiceVersion: 2,
        fingerprint: VOICE_FINGERPRINT,
      },
      artifactExpectation: {
        kind: 'update',
        deliverableId: 'mission-7',
        expectedVersion: 7,
      },
      approvedDeliverables: [expect.objectContaining({
        deliverableId: 'vision-approved',
        deliverableType: 'vision',
        version: 2,
      })],
    });
    expect(frozen.approvedDeliverables).toEqual([{
      ref: frozen.inputSnapshot.approvedDeliverables[0],
      content: 'A verified approved vision.',
    }]);
    expect(frozen.inputSnapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(frozen.inputSnapshot.evidenceRequirementIds.length).toBeGreaterThan(0);
  });

  it('rehydrates the historical approved content and exact non-current voice authority', () => {
    const authority = intake();
    const finalizedVoice = voice();
    const approvedVision = deliverable('vision', {
      id: 'vision-approved',
      status: 'approved',
      version: 1,
      content: 'The accepted original vision.',
      updatedAt: '2026-07-14T11:30:00.000Z',
    });
    const [prepared] = prepareBrandGenerationSnapshots({
      workspaceId: 'ws-1',
      intake: authority,
      targets: ['mission'],
      finalizedVoice,
      capturedAt: CAPTURED_AT,
      deliverables: [approvedVision],
    });
    const currentVision = deliverable('vision', {
      id: approvedVision.id,
      status: 'draft',
      version: 2,
      content: 'A later operator edit.',
    });
    const historicalVersion: DeliverableVersion = {
      id: 'version-vision-1',
      deliverableId: approvedVision.id,
      content: approvedVision.content,
      version: 1,
      createdAt: approvedVision.updatedAt,
    };
    const getFinalizedVoiceSnapshotForGeneration = vi.fn(() => finalizedVoice);
    const getDeliverable = vi.fn(() => ({
      ...currentVision,
      versions: [historicalVersion],
    }));

    const hydrated = hydrateBrandGenerationSnapshot(
      'ws-1',
      prepared.inputSnapshot,
      {
        getBrandIntakeRevision: vi.fn(() => authority),
        getFinalizedVoiceSnapshotForGeneration,
        getDeliverable,
      },
    );

    expect(getFinalizedVoiceSnapshotForGeneration).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      expectedVoiceVersion: 2,
      expectedFingerprint: VOICE_FINGERPRINT,
      requireCurrentAuthority: false,
    });
    expect(getDeliverable).toHaveBeenCalledWith('ws-1', 'vision-approved');
    expect(hydrated.approvedDeliverables).toEqual([{
      ref: prepared.inputSnapshot.approvedDeliverables[0],
      content: 'The accepted original vision.',
    }]);
    expect(hydrated.finalizedVoice).toBe(finalizedVoice);
  });

  it('fails closed when a frozen approved version no longer matches its fingerprint', () => {
    const authority = intake();
    const approvedVision = deliverable('vision', {
      id: 'vision-approved',
      status: 'approved',
      version: 1,
      content: 'The accepted original vision.',
    });
    const [prepared] = prepareBrandGenerationSnapshots({
      workspaceId: 'ws-1',
      intake: authority,
      targets: ['mission'],
      finalizedVoice: voice(),
      capturedAt: CAPTURED_AT,
      deliverables: [approvedVision],
    });

    expect(() => hydrateBrandGenerationSnapshot('ws-1', prepared.inputSnapshot, {
      getBrandIntakeRevision: vi.fn(() => authority),
      getFinalizedVoiceSnapshotForGeneration: vi.fn(() => voice()),
      getDeliverable: vi.fn(() => ({
        ...approvedVision,
        version: 2,
        content: 'Current content',
        versions: [{
          id: 'version-1',
          deliverableId: approvedVision.id,
          content: 'Tampered historical content',
          version: 1,
          createdAt: approvedVision.updatedAt,
        }],
      })),
    })).toThrow(/no longer matches/i);
  });
});
