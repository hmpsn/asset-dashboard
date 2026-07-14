import { describe, expect, it } from 'vitest';

import {
  BRAND_GENERATION_ATOMIC_TARGETS,
  BRAND_GENERATION_LIMITS,
  type BrandGenerationCandidateAttemptOutput,
} from '../../shared/types/brand-generation.js';
import type { GenerationAuditReport } from '../../shared/types/generation-evidence.js';
import {
  validateBrandGenerationCreativeProviderEnvelopes,
  validateBrandGenerationRequiredStageEnvelopeClosure,
} from '../../server/domains/brand/generation/operations.js';
import {
  buildBrandGenerationAuditPrompt,
  buildBrandGenerationPrompt,
  utf8Prefix,
} from '../../server/domains/brand/generation/prompt.js';
import type {
  BrandGenerationFrozenTargetInput,
  BrandGenerationPreflightResult,
} from '../../server/domains/brand/generation/preflight.js';

const NOW = '2026-07-14T12:00:00.000Z';

function frozenInput(): BrandGenerationFrozenTargetInput {
  return {
    workspaceId: 'ws-1',
    inputSnapshot: {
      schemaVersion: 1,
      target: 'tagline',
      intakeRevision: {
        intakeRevisionId: 'intake-1',
        revision: 1,
        fingerprint: 'a'.repeat(64),
      },
      voiceSnapshot: {
        voiceProfileId: 'voice-1',
        voiceVersion: 1,
        finalizedBy: { actorType: 'operator', actorId: 'operator-1' },
        finalizedAt: NOW,
        fingerprint: 'b'.repeat(64),
        anchorEvidenceRefs: [{
          sourceType: 'brand_intake',
          sourceId: 'intake-1',
          sourceRevision: 1,
          capturedAt: NOW,
          selectedBy: { actorType: 'operator', actorId: 'operator-1' },
          selectedAt: NOW,
        }],
      },
      approvedDeliverables: [],
      evidenceRequirementIds: [],
      artifactExpectation: { kind: 'create', deliverableId: null, expectedVersion: 0 },
      capturedAt: NOW,
      fingerprint: 'c'.repeat(64),
    },
    intakeRevision: { id: 'intake-1' },
    fieldEvidence: [],
    finalizedVoice: {
      voiceProfileId: 'voice-1',
      voiceVersion: 1,
      profileRevision: 1,
      finalizedAt: NOW,
      fingerprint: 'b'.repeat(64),
      voiceDNA: { personalityTraits: ['Warm'] },
      guardrails: { forbiddenWords: [], requiredTerminology: [] },
      contextModifiers: [],
      anchorEvidenceRefs: [],
    },
    approvedDeliverables: [],
  } as unknown as BrandGenerationFrozenTargetInput;
}

function preflight(value = 'Northstar'): BrandGenerationPreflightResult {
  return {
    attemptOutput: {
      kind: 'preflight',
      readyForPaidWork: true,
      blockingRequirementIds: [],
      requirements: [],
      placeholders: [],
      estimate: {
        providerCalls: 6,
        inputTokens: 205_824,
        outputTokens: 13_000,
        estimatedCostMicros: 1_419_120,
        maxConcurrency: 1,
      },
    },
    evidenceCatalog: [{
      key: 'brand-intake:business.businessName',
      kind: 'intake_field',
      fieldPath: 'business.businessName',
      value,
      sourceRefs: [],
      supportsFactualClaims: true,
    }],
    materializedPayload: {} as BrandGenerationPreflightResult['materializedPayload'],
  };
}

function candidate(content: string): BrandGenerationCandidateAttemptOutput {
  return {
    kind: 'deliverable_candidate',
    content,
    foundationDraft: null,
    claims: [{ text: content, classification: 'creative_proposal', evidenceKeys: [], sourceRefs: [] }],
    requirements: [],
    placeholders: [],
  };
}

const cleanAudit: GenerationAuditReport = {
  verdict: 'ready_for_human_review',
  deterministicChecks: [],
  modelFindings: [],
  humanRequiredChecks: [],
  revisionCount: 0,
  unresolvedRequirementIds: [],
  auditedAt: NOW,
};

describe('brand generation prompt bounds', () => {
  it('truncates UTF-8 text in one code-point-safe bounded pass', () => {
    const value = `${'x'.repeat(100_000)}😀tail`;
    const prefix = utf8Prefix(value, 2_052);

    expect(prefix).toBe('x'.repeat(2_052));
    expect(new TextEncoder().encode(prefix).byteLength).toBe(2_052);
    expect(utf8Prefix('A😀tail', 5)).toBe('A😀');
  });

  it('keeps a complete 19-target related-candidate review context bounded', () => {
    const related = BRAND_GENERATION_ATOMIC_TARGETS
      .filter(target => target !== 'tagline')
      .map(target => ({
        targetId: target,
        candidate: candidate(`${target}: ${'distinct context '.repeat(100)}`),
      }));
    const prompt = buildBrandGenerationAuditPrompt(
      frozenInput(),
      preflight(),
      candidate('A clear promise grounded in care.'),
      cleanAudit,
      related,
    );
    const bytes = new TextEncoder().encode(`${prompt.systemPrompt}\n${prompt.userPrompt}`).byteLength;
    expect(bytes).toBeLessThanOrEqual(BRAND_GENERATION_LIMITS.maxPromptBytes);
    expect(prompt.userPrompt).toContain('candidateFingerprint');
    expect(prompt.userPrompt).not.toContain('distinct context '.repeat(20));
    for (const item of related) expect(prompt.userPrompt).toContain(item.targetId);
  });

  it('rejects an oversized frozen base prompt before a bounded generation pass', () => {
    expect(() => buildBrandGenerationPrompt(
      frozenInput(),
      preflight('x'.repeat(BRAND_GENERATION_LIMITS.maxBasePromptBytes)),
    )).toThrow(/too large.*bounded generation/i);
  });

  it('rejects before paid work when a valid maximum candidate would overflow a required later stage', () => {
    const frozen = frozenInput();
    const checked = preflight('"\\'.repeat(4_000));

    expect(() => validateBrandGenerationCreativeProviderEnvelopes(
      buildBrandGenerationPrompt(frozen, checked),
    )).not.toThrow();
    expect(() => validateBrandGenerationRequiredStageEnvelopeClosure(frozen, checked))
      .toThrow(/(?:provider input exceeds|prompt exceeds)/i);
    expect(() => validateBrandGenerationRequiredStageEnvelopeClosure(frozen, preflight()))
      .not.toThrow();
  });
});
