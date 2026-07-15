import { describe, expect, it, vi } from 'vitest';

import type { AICallResult } from '../../server/ai.js';
import type { BrandGenerationFoundationCandidateAttemptOutput } from '../../shared/types/brand-generation.js';
import {
  getBrandGenerationAuditDisposition,
  mergeBrandGenerationAudit,
  runBrandGenerationDeterministicAudit,
} from '../../server/domains/brand/generation/audit.js';
import { auditBrandGenerationCandidate } from '../../server/domains/brand/generation/operations.js';
import type {
  BrandGenerationFrozenTargetInput,
  BrandGenerationPreflightResult,
} from '../../server/domains/brand/generation/preflight.js';

const now = '2026-07-13T12:00:00.000Z';

const frozenInput = {
  workspaceId: 'ws-1',
  inputSnapshot: {
    schemaVersion: 1,
    target: 'voice_foundation',
    intakeRevision: { intakeRevisionId: 'intake-1', revision: 1, fingerprint: 'a'.repeat(64) },
    voiceSnapshot: null,
    approvedDeliverables: [],
    evidenceRequirementIds: [],
    artifactExpectation: null,
    capturedAt: now,
    fingerprint: 'b'.repeat(64),
  },
  intakeRevision: { id: 'intake-1', workspaceId: 'ws-1' },
  fieldEvidence: [],
  finalizedVoice: null,
  approvedDeliverables: [],
} as unknown as BrandGenerationFrozenTargetInput;

const preflight: BrandGenerationPreflightResult = {
  attemptOutput: {
    kind: 'preflight', readyForPaidWork: true, blockingRequirementIds: [],
    requirements: [], placeholders: [],
    estimate: { providerCalls: 6, inputTokens: 50_000, outputTokens: 13_000, estimatedCostMicros: 4_500_000, maxConcurrency: 1 },
  },
  evidenceCatalog: [],
  materializedPayload: {} as BrandGenerationPreflightResult['materializedPayload'],
};

function candidate(summary = 'Warm and direct.'): BrandGenerationFoundationCandidateAttemptOutput {
  return {
    kind: 'foundation_candidate', content: null,
    foundationDraft: {
      schemaVersion: 1,
      summary,
      voiceDNA: {
        personalityTraits: ['Warm'],
        toneSpectrum: { formal_casual: 7, serious_playful: 3, technical_accessible: 8 },
        sentenceStyle: 'Short sentences.', vocabularyLevel: 'Plain language.',
      },
      guardrails: {
        forbiddenWords: ['guaranteed'], requiredTerminology: [],
        toneBoundaries: ['Never dismissive.'], antiPatterns: ['No invented facts.'],
      },
      contextModifiers: [], evidenceRequirementIds: [], fingerprint: 'c'.repeat(64),
    },
    claims: [], requirements: [], placeholders: [],
  };
}

describe('brand generation audits', () => {
  it('keeps ready-stage evidence gaps visible without deadlocking provisional voice review', () => {
    const requirement = {
      id: 'brand-intake:authenticSamples',
      fieldPath: 'authenticSamples',
      claim: 'An authentic voice sample exists.',
      reason: 'A human anchor is required before finalization.',
      requirementStage: 'ready' as const,
      claimKind: 'structural' as const,
      status: 'missing' as const,
      sourceRefs: [] as [],
      clientSafePrompt: 'Provide an authentic voice sample.',
    };
    const withGap = {
      ...preflight,
      attemptOutput: {
        ...preflight.attemptOutput,
        requirements: [requirement],
        placeholders: [{
          requirementId: requirement.id,
          token: '[NEEDS CLIENT INPUT: Provide an authentic voice sample.]',
          prompt: requirement.clientSafePrompt,
        }],
      },
    };
    const draft = {
      ...candidate('[NEEDS CLIENT INPUT: Provide an authentic voice sample.]'),
      requirements: [requirement],
      placeholders: withGap.attemptOutput.placeholders,
    };
    const result = runBrandGenerationDeterministicAudit({
      frozenInput,
      preflight: withGap,
      candidate: draft,
      revisionCount: 0,
      now: () => new Date(now),
    });
    expect(result).toMatchObject({
      verdict: 'needs_attention',
      unresolvedRequirementIds: ['brand-intake:authenticSamples'],
    });
    expect(getBrandGenerationAuditDisposition(result, 0)).toBe('needs_attention');
  });

  it('keeps deterministic failure authoritative over a clean model response', () => {
    const bad = candidate('[NEEDS CLIENT INPUT: invented token]');
    const deterministic = runBrandGenerationDeterministicAudit({
      frozenInput, preflight, candidate: bad, revisionCount: 0, now: () => new Date(now),
    });
    expect(deterministic.verdict).toBe('needs_attention');
    const merged = mergeBrandGenerationAudit({
      frozenInput,
      deterministicReport: deterministic,
      modelOutput: { findings: [], revisionRecommended: false, rationale: 'Clean.' },
    });
    expect(merged.verdict).toBe('needs_attention');
    expect(getBrandGenerationAuditDisposition(merged, 0)).toBe('revise');
    expect(getBrandGenerationAuditDisposition({ ...merged, revisionCount: 1 }, 1)).toBe('needs_attention');
  });

  it('rejects model findings that address targets outside the frozen audit set', () => {
    const deterministic = runBrandGenerationDeterministicAudit({
      frozenInput, preflight, candidate: candidate(), revisionCount: 0, now: () => new Date(now),
    });
    expect(() => mergeBrandGenerationAudit({
      frozenInput,
      deterministicReport: deterministic,
      modelOutput: {
        findings: [{
          code: 'cross-target', severity: 'warning', message: 'Unknown target.',
          affectedTargetIds: ['mission'], requiresHumanReview: false,
        }],
        revisionRecommended: true,
        rationale: 'Revise.',
      },
    })).toThrow(/unknown affected target/i);
  });

  it('human-gates evidenced inferences and hallucination review for every generated candidate', () => {
    const withInference: BrandGenerationFoundationCandidateAttemptOutput = {
      ...candidate(),
      claims: [{
        text: 'The intake suggests a focus on clarity.',
        classification: 'inferred',
        evidenceKeys: ['brand-intake:brand.tone'],
        sourceRefs: [{
          sourceType: 'brand_intake',
          sourceId: 'intake-1',
          sourceRevision: 1,
          fieldPath: 'brand.tone',
          capturedAt: now,
        }],
      }],
    };
    const inferredReport = runBrandGenerationDeterministicAudit({
      frozenInput, preflight, candidate: withInference, revisionCount: 0, now: () => new Date(now),
    });
    expect(inferredReport.deterministicChecks).toContainEqual(expect.objectContaining({
      id: 'factual-claim-evidence', result: 'passed',
    }));
    expect(inferredReport.humanRequiredChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'factual-accuracy', result: 'needs_human_review' }),
      expect.objectContaining({ id: 'no-hallucinations', result: 'needs_human_review' }),
    ]));

    const creativeOnlyReport = runBrandGenerationDeterministicAudit({
      frozenInput, preflight, candidate: candidate(), revisionCount: 0, now: () => new Date(now),
    });
    expect(creativeOnlyReport.humanRequiredChecks).toContainEqual(expect.objectContaining({
      id: 'no-hallucinations', result: 'needs_human_review',
    }));
  });

  it('reserves and calls the named OpenAI audit with retries disabled', async () => {
    const reserve = vi.fn();
    const callStructuredAI = vi.fn(async options => {
      expect(options).toMatchObject({
        operation: 'brand-deliverable-audit', provider: 'openai', maxRetries: 0,
        maxTokens: 2_500,
        responseFormat: { type: 'json_object' },
      });
      return {
        text: JSON.stringify({ findings: [], revisionRecommended: false, rationale: 'Clean.' }),
        tokens: { prompt: 100, completion: 20, total: 120 },
        execution: {
          runId: 'audit-run-1', operation: 'brand-deliverable-audit', provider: 'openai',
          model: 'gpt-5.5', attempts: 1, cacheOutcome: 'bypass', startedAt: now,
          completedAt: '2026-07-13T12:00:01.000Z', durationMs: 1_000,
        },
      } satisfies AICallResult;
    });
    const result = await auditBrandGenerationCandidate({
      frozenInput, preflight, candidate: candidate(), revisionCount: 0,
      reserveProviderDispatch: reserve, dependencies: { callStructuredAI },
      now: () => new Date(now),
    });
    expect(reserve).toHaveBeenCalledOnce();
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'brand-deliverable-audit', provider: 'openai', providerCalls: 1,
      outputTokens: 2_500,
    }));
    expect(result.output.auditReport.verdict).toBe('ready_for_human_review');
    const reservation = reserve.mock.calls[0]?.[0];
    expect(result.provenance).toMatchObject({
      runId: 'audit-run-1',
      operation: 'brand-deliverable-audit',
      inputFingerprint: reservation?.effectiveInputFingerprint,
    });
  });

  it('checks malformed audit output against its reservation before parsing', async () => {
    const callStructuredAI = vi.fn(async () => ({
      text: '{"findings":42}',
      tokens: { prompt: 100, completion: 2_501, total: 2_601 },
      execution: {
        runId: 'audit-run-2', operation: 'brand-deliverable-audit', provider: 'openai',
        model: 'gpt-5.5', attempts: 1, cacheOutcome: 'bypass', startedAt: now,
        completedAt: '2026-07-13T12:00:01.000Z', durationMs: 1_000,
      },
    } satisfies AICallResult));

    await expect(auditBrandGenerationCandidate({
      frozenInput, preflight, candidate: candidate(), revisionCount: 0,
      reserveProviderDispatch: vi.fn(), dependencies: { callStructuredAI },
      now: () => new Date(now),
    })).rejects.toThrow(/exceeded.*reservation/i);
  });
});
