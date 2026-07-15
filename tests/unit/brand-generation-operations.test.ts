import { describe, expect, it, vi } from 'vitest';

import type { AICallResult } from '../../server/ai.js';
import type {
  BrandGenerationPreflightResult,
  BrandGenerationFrozenTargetInput,
} from '../../server/domains/brand/generation/preflight.js';
import {
  generateBrandGenerationCandidate,
  validateBrandGenerationRequiredStageEnvelopeClosure,
} from '../../server/domains/brand/generation/operations.js';
import * as brandGenerationPrompt from '../../server/domains/brand/generation/prompt.js';

const now = '2026-07-13T12:00:00.000Z';

function aiResult(
  text: string,
  fallbackUsed?: boolean,
  provider: 'openai' | 'anthropic' = 'openai',
): AICallResult {
  return {
    text,
    tokens: { prompt: 321, completion: 123, total: 444 },
    execution: {
      runId: 'ai-run-1',
      operation: 'brand-deliverable-generate',
      provider,
      model: provider === 'openai' ? 'gpt-5.5' : 'claude-sonnet-4-6',
      attempts: 1,
      ...(fallbackUsed === undefined ? {} : { fallbackUsed }),
      cacheOutcome: 'bypass',
      startedAt: now,
      completedAt: '2026-07-13T12:00:01.000Z',
      durationMs: 1_000,
    },
  };
}

function frozenInput(target: 'tagline' | 'naming' | 'voice_foundation' = 'tagline') {
  const voice = target === 'voice_foundation' ? null : {
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
      selector: { kind: 'brand_intake_sample' as const, intakeRevisionId: 'intake-1', intakeRevision: 1, sampleId: 'sample-1' },
      content: 'We explain every next step.',
      context: 'body' as const,
      evidenceRef: {
        sourceType: 'brand_intake' as const,
        sourceId: 'intake-1',
        sourceRevision: 1,
        capturedAt: now,
        selectedBy: { actorType: 'operator' as const, actorId: 'operator-1' },
        selectedAt: now,
      },
    }] as const,
    calibrationSelections: [],
    finalizedBy: { actorType: 'operator' as const, actorId: 'operator-1' },
    finalizedAt: now,
    fingerprint: 'c'.repeat(64),
    anchorEvidenceRefs: [{
      sourceType: 'brand_intake' as const,
      sourceId: 'intake-1',
      sourceRevision: 1,
      capturedAt: now,
      selectedBy: { actorType: 'operator' as const, actorId: 'operator-1' },
      selectedAt: now,
    }] as const,
    executionActor: { actorType: 'operator' as const, actorId: 'operator-1' },
    createdAt: now,
  };
  return {
    workspaceId: 'ws-1',
    inputSnapshot: {
      schemaVersion: 1,
      target,
      intakeRevision: { intakeRevisionId: 'intake-1', revision: 1, fingerprint: 'a'.repeat(64) },
      voiceSnapshot: voice,
      approvedDeliverables: [],
      evidenceRequirementIds: [],
      artifactExpectation: target === 'voice_foundation'
        ? null
        : { kind: 'create' as const, deliverableId: null, expectedVersion: 0 as const },
      capturedAt: now,
      fingerprint: 'b'.repeat(64),
    },
    intakeRevision: {
      id: 'intake-1', workspaceId: 'ws-1', revision: 1, schemaVersion: 1,
      payload: {
        schemaVersion: 1,
        business: { businessName: 'Northstar', industry: 'Dental', description: 'Dental care.', services: 'Dentistry', locations: '', differentiators: '', website: '' },
        audience: { primaryAudience: 'Families', painPoints: '', goals: '', objections: '', buyingStage: '', secondaryAudience: '' },
        brand: { tone: 'Warm', personality: ['Clear'], avoidWords: '', contentFormats: [], existingExamples: '' },
        competitors: { competitors: '', whatTheyDoBetter: '', whatYouDoBetter: '', referenceUrls: '' },
        authenticSamples: [],
      },
      evidenceResolutions: [], fingerprint: 'a'.repeat(64), source: 'client_portal',
      submitter: { actorType: 'client', actorId: 'client-1' }, mutationKind: 'submission',
      supersedesRevisionId: null, supersededByRevisionId: null, createdAt: now,
    },
    fieldEvidence: [],
    finalizedVoice: voice,
    approvedDeliverables: [],
  } as unknown as BrandGenerationFrozenTargetInput;
}

function preflight(withPlaceholder = false): BrandGenerationPreflightResult {
  const requirement = {
    id: 'brand-intake:business.differentiators',
    fieldPath: 'business.differentiators',
    claim: 'Verified differentiator',
    reason: 'Cannot invent proof.',
    requirementStage: 'ready' as const,
    claimKind: 'factual' as const,
    status: 'missing' as const,
    sourceRefs: [] as [],
    clientSafePrompt: 'Provide a verified differentiator.',
  };
  return {
    attemptOutput: {
      kind: 'preflight', readyForPaidWork: true, blockingRequirementIds: [],
      requirements: withPlaceholder ? [requirement] : [],
      placeholders: withPlaceholder ? [{
        requirementId: requirement.id,
        token: '[NEEDS CLIENT INPUT: Provide a verified differentiator.]',
        prompt: 'Provide a verified differentiator.',
      }] : [],
      estimate: { providerCalls: 6, inputTokens: 50_000, outputTokens: 13_000, estimatedCostMicros: 4_500_000, maxConcurrency: 1 },
    },
    evidenceCatalog: [{
      key: 'brand-intake:business.businessName', kind: 'intake_field',
      fieldPath: 'business.businessName', value: 'Northstar', supportsFactualClaims: true,
      sourceRefs: [{ sourceType: 'brand_intake', sourceId: 'intake-1', sourceRevision: 1, fieldPath: 'business.businessName', capturedAt: now }],
    }],
    materializedPayload: frozenInput().intakeRevision.payload,
  };
}

function creativeOutput(content: string, evidenceKeys: string[] = []) {
  return JSON.stringify({
    content,
    claims: [{ text: content, classification: 'creative_proposal', evidenceKeys }],
    unresolvedRequirementIds: [],
  });
}

describe('brand generation AI operations', () => {
  it('keeps the primary foundation call inside the shared two-dispatch envelope', async () => {
    const reserve = vi.fn();
    const callCreativeAI = vi.fn(async options => {
      expect(options).toMatchObject({ maxTokens: 1_500, allowProviderFallback: false });
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(JSON.stringify({
        summary: 'Warm and clear.',
        voiceDNA: {
          personalityTraits: ['Warm'],
          toneSpectrum: { formal_casual: 7, serious_playful: 3, technical_accessible: 8 },
          sentenceStyle: 'Short sentences.',
          vocabularyLevel: 'Plain language.',
        },
        guardrails: {
          forbiddenWords: [],
          requiredTerminology: [],
          toneBoundaries: ['Stay warm and clear.'],
          antiPatterns: [],
        },
        contextModifiers: [],
        claims: [],
        unresolvedRequirementIds: [],
      }));
    });

    await generateBrandGenerationCandidate({
      frozenInput: frozenInput('voice_foundation'),
      preflight: preflight(),
      reserveProviderDispatch: reserve,
      dependencies: { callCreativeAI },
    });

    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ outputTokens: 1_500 }));
  });

  it('reserves the primary creative call and preserves real execution provenance', async () => {
    const reserve = vi.fn();
    const callCreativeAI = vi.fn(async options => {
      expect(options).toMatchObject({ maxTokens: 1_500, allowProviderFallback: false });
      await options.beforeProviderDispatch?.({ provider: 'anthropic', fallback: false });
      expect(`${options.systemPrompt}\n${options.userPrompt}`.split(brandGenerationPrompt.FINALIZED_VOICE_PROMPT_BEGIN)).toHaveLength(2);
      return aiResult(creativeOutput('Care that makes the next step clear.'), undefined, 'anthropic');
    });
    const result = await generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(), reserveProviderDispatch: reserve,
      dependencies: { callCreativeAI },
    });
    const prompt = brandGenerationPrompt.buildBrandGenerationPrompt(frozenInput(), preflight());
    const reservations = reserve.mock.calls.map(call => call[0]);
    expect(reservations).toEqual([
      expect.objectContaining({
        provider: 'anthropic', fallback: false, providerCalls: 1,
        inputTokens: expect.any(Number), outputTokens: 1_500,
        effectiveInputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(result.tokens).toEqual({ prompt: 321, completion: 123, total: 444 });
    expect(result.provenance).toMatchObject({
      runId: 'ai-run-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputFingerprint: reservations[0].effectiveInputFingerprint,
    });
    expect(result.effectiveInputFingerprint).toBe(reservations[0].effectiveInputFingerprint);
    expect(result.effectiveInputFingerprint).not.toBe(prompt.effectiveInputFingerprint);
    expect(result.effectiveInputFingerprint).not.toBe(frozenInput().inputSnapshot.fingerprint);
    expect(result.budgetUsage.providerCalls).toBe(1);
  });

  it('fails closed when reported provider usage exceeds the pessimistic reservation', async () => {
    const callCreativeAI = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return {
        ...aiResult(creativeOutput('A bounded creative proposal.')),
        tokens: { prompt: 1_000_000, completion: 123, total: 1_000_123 },
      };
    });

    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(),
      preflight: preflight(),
      reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI },
    })).rejects.toThrow(/exceeded.*reservation/i);
  });

  it('checks malformed primary output against its reservation before recovery', async () => {
    const callCreativeAI = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return {
        ...aiResult('{"content":42}'),
        tokens: { prompt: 321, completion: 1_501, total: 1_822 },
      };
    });
    const callStructuredAI = vi.fn();

    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(),
      preflight: preflight(),
      reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI, callStructuredAI },
    })).rejects.toThrow(/exceeded.*reservation/i);
    expect(callStructuredAI).not.toHaveBeenCalled();
  });

  it('rejects a candidate too large to complete the bounded audit pass', async () => {
    const oversized = 'x'.repeat(9_000);
    const callCreativeAI = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(creativeOutput(oversized));
    });
    const callStructuredAI = vi.fn(async () => aiResult(creativeOutput(oversized), true, 'openai'));
    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(),
      preflight: preflight(),
      reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI, callStructuredAI },
    })).rejects.toThrow(/failed to parse AI structured output/i);
    expect(callStructuredAI).toHaveBeenCalledOnce();
  });

  it('sizes related context with a universal quote-first minimal candidate', () => {
    const buildAuditPrompt = vi.spyOn(brandGenerationPrompt, 'buildBrandGenerationAuditPrompt');
    try {
      validateBrandGenerationRequiredStageEnvelopeClosure(
        frozenInput('naming'),
        preflight(true),
      );

      expect(buildAuditPrompt).toHaveBeenCalledTimes(2);
      for (const call of buildAuditPrompt.mock.calls) {
        const currentCandidate = call[2];
        const relatedCandidates = call[4] ?? [];
        expect(relatedCandidates).toHaveLength(18);
        expect(relatedCandidates.length).toBeGreaterThan(0);
        expect(relatedCandidates.every(related => ( // every-ok -- exact non-empty length asserted above
          related.candidate !== currentCandidate
          && related.candidate.kind === 'deliverable_candidate'
          && related.candidate.content.startsWith('"')
          && related.candidate.claims.length === 0
          && related.candidate.requirements.length === 0
          && related.candidate.placeholders.length === 0
        ))).toBe(true);
      }
    } finally {
      buildAuditPrompt.mockRestore();
    }
  });

  it('uses the bounded recovery when the primary candidate violates grounding contracts', async () => {
    const reserve = vi.fn();
    const callCreativeAI = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(creativeOutput('A factual claim.', ['unknown-key']));
    });
    const callStructuredAI = vi.fn(async () => (
      aiResult(creativeOutput('A grounded creative proposal.'), true, 'openai')
    ));

    const result = await generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(), reserveProviderDispatch: reserve,
      dependencies: { callCreativeAI, callStructuredAI },
    });

    expect(result.output).toMatchObject({ content: 'A grounded creative proposal.' });
    expect(reserve.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ outputTokens: 1_500 }),
      expect.objectContaining({ outputTokens: 2_500, fallback: true }),
    ]);
  });

  it('rejects unsupported evidence keys and deleted placeholders', async () => {
    const unsupportedOutput = creativeOutput('A factual claim.', ['unknown-key']);
    const unsupported = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(unsupportedOutput);
    });
    const unsupportedRepair = vi.fn(async () => aiResult(unsupportedOutput, true, 'openai'));
    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(), reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI: unsupported, callStructuredAI: unsupportedRepair },
    })).rejects.toThrow(/unsupported evidence key/i);

    const deletedOutput = JSON.stringify({
      content: 'The placeholder disappeared.',
      claims: [{ text: 'A proposal.', classification: 'creative_proposal', evidenceKeys: [] }],
      unresolvedRequirementIds: ['brand-intake:business.differentiators'],
    });
    const deleted = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(deletedOutput);
    });
    const deletedRepair = vi.fn(async () => aiResult(deletedOutput, true, 'openai'));
    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(true), reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI: deleted, callStructuredAI: deletedRepair },
    })).rejects.toThrow(/placeholder/i);
  });

  it('requires inferred assertions to resolve to fact-capable non-structural evidence', async () => {
    const supportedInference = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(JSON.stringify({
        content: 'Care that makes the next step clear.',
        claims: [
          {
            text: 'Care that makes the next step clear.',
            classification: 'creative_proposal',
            evidenceKeys: [],
          },
          {
            text: 'The intake suggests a focus on clear care.',
            classification: 'inferred',
            evidenceKeys: ['brand-intake:business.businessName'],
          },
        ],
        unresolvedRequirementIds: [],
      }));
    });
    const supported = await generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(), reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI: supportedInference },
    });
    expect(supported.output.claims).toContainEqual(expect.objectContaining({
      classification: 'inferred',
      evidenceKeys: ['brand-intake:business.businessName'],
      sourceRefs: [expect.objectContaining({ sourceType: 'brand_intake', sourceId: 'intake-1' })],
    }));

    const structuralPreflight = preflight();
    structuralPreflight.evidenceCatalog = [{
      key: 'content-matrix:cell-1',
      kind: 'intake_field',
      fieldPath: 'business.businessName',
      value: 'Dentist in Austin',
      supportsFactualClaims: true,
      sourceRefs: [{
        sourceType: 'content_matrix', sourceId: 'matrix-1', fieldPath: 'cell-1', capturedAt: now,
      }],
    }];
    const structuralInferenceOutput = JSON.stringify({
      content: 'Care that makes the next step clear.',
      claims: [
        {
          text: 'Care that makes the next step clear.',
          classification: 'creative_proposal',
          evidenceKeys: [],
        },
        {
          text: 'The business serves dentists in Austin.',
          classification: 'inferred',
          evidenceKeys: ['content-matrix:cell-1'],
        },
      ],
      unresolvedRequirementIds: [],
    });
    const structuralInference = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(structuralInferenceOutput);
    });
    const structuralInferenceRepair = vi.fn(async () => (
      aiResult(structuralInferenceOutput, true, 'openai')
    ));
    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: structuralPreflight, reserveProviderDispatch: vi.fn(),
      dependencies: {
        callCreativeAI: structuralInference,
        callStructuredAI: structuralInferenceRepair,
      },
    })).rejects.toThrow(/cannot support business assertions/i);
  });

  it('uses one reserved OpenAI repair when Anthropic succeeds with invalid structured output', async () => {
    const reserve = vi.fn();
    const callCreativeAI = vi.fn(async options => {
      expect(options).toMatchObject({ maxTokens: 1_500, allowProviderFallback: false });
      await options.beforeProviderDispatch?.({ provider: 'anthropic', fallback: false });
      return aiResult('{"content":42}', undefined, 'anthropic');
    });
    const callStructuredAI = vi.fn(async options => {
      expect(options).toMatchObject({
        operation: 'brand-deliverable-generate',
        provider: 'openai',
        maxTokens: 2_500,
        maxRetries: 0,
        fallbackUsed: true,
      });
      return aiResult(creativeOutput('A clearer creative proposal.'), true, 'openai');
    });
    const result = await generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(), reserveProviderDispatch: reserve,
      dependencies: { callCreativeAI, callStructuredAI },
    });
    expect(result.output).toMatchObject({ kind: 'deliverable_candidate', content: 'A clearer creative proposal.' });
    expect(reserve.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ provider: 'anthropic', fallback: false, outputTokens: 1_500 }),
      expect.objectContaining({ provider: 'openai', fallback: true, outputTokens: 2_500 }),
    ]);
    expect(callStructuredAI).toHaveBeenCalledOnce();
  });

  it('checks same-provider recovery usage against only its exact reservation', async () => {
    const callCreativeAI = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult('{"content":42}');
    });
    const callStructuredAI = vi.fn(async () => ({
      ...aiResult(creativeOutput('A recovered creative proposal.'), true, 'openai'),
      tokens: { prompt: 321, completion: 2_501, total: 2_822 },
    }));

    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(),
      preflight: preflight(),
      reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI, callStructuredAI },
    })).rejects.toThrow(/exceeded.*reservation/i);
  });

  it('uses the same single OpenAI recovery dispatch after a reserved provider failure', async () => {
    const reserve = vi.fn();
    const callCreativeAI = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'anthropic', fallback: false });
      throw new Error('Anthropic unavailable');
    });
    const callStructuredAI = vi.fn(async () => (
      aiResult(creativeOutput('A bounded recovered proposal.'), true, 'openai')
    ));

    const result = await generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(), reserveProviderDispatch: reserve,
      dependencies: { callCreativeAI, callStructuredAI },
    });

    expect(result.output).toMatchObject({ content: 'A bounded recovered proposal.' });
    expect(reserve.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ provider: 'anthropic', outputTokens: 1_500 }),
      expect.objectContaining({ provider: 'openai', outputTokens: 2_500 }),
    ]);
    expect(callStructuredAI).toHaveBeenCalledOnce();
  });

  it('does not dispatch the repair provider when cancellation lands after reservation', async () => {
    const controller = new AbortController();
    const callCreativeAI = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'anthropic', fallback: false });
      return aiResult('{"content":42}', undefined, 'anthropic');
    });
    const callStructuredAI = vi.fn();
    const reserve = vi.fn(request => {
      if (request.provider === 'openai') controller.abort(new Error('cancelled after reservation'));
    });
    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(), reserveProviderDispatch: reserve,
      signal: controller.signal, dependencies: { callCreativeAI, callStructuredAI },
    })).rejects.toThrow('cancelled after reservation');
    expect(callStructuredAI).not.toHaveBeenCalled();
  });

  it('fails naming output that implies clearance and never dispatches after cancellation', async () => {
    const badNamingOutput = creativeOutput('Northstar is trademark cleared and its domain is available.');
    const badNaming = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(badNamingOutput);
    });
    const badNamingRepair = vi.fn(async () => aiResult(badNamingOutput, true, 'openai'));
    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput('naming'), preflight: preflight(), reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI: badNaming, callStructuredAI: badNamingRepair },
    })).rejects.toThrow(/clearance/i);

    const controller = new AbortController();
    controller.abort(new Error('cancelled before dispatch'));
    const callCreativeAI = vi.fn();
    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(), reserveProviderDispatch: vi.fn(),
      signal: controller.signal, dependencies: { callCreativeAI },
    })).rejects.toThrow('cancelled before dispatch');
    expect(callCreativeAI).not.toHaveBeenCalled();
  });
});
