import { describe, expect, it, vi } from 'vitest';

import type { AICallResult } from '../../server/ai.js';
import type {
  BrandGenerationPreflightResult,
  BrandGenerationFrozenTargetInput,
} from '../../server/domains/brand/generation/preflight.js';
import {
  generateBrandGenerationCandidate,
} from '../../server/domains/brand/generation/operations.js';
import { FINALIZED_VOICE_PROMPT_BEGIN } from '../../server/domains/brand/generation/prompt.js';

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
  it('reserves Claude and fallback separately and preserves real execution provenance', async () => {
    const reserve = vi.fn();
    const callCreativeAI = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'anthropic', fallback: false });
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: true });
      expect(`${options.systemPrompt}\n${options.userPrompt}`.split(FINALIZED_VOICE_PROMPT_BEGIN)).toHaveLength(2);
      return aiResult(creativeOutput('Care that makes the next step clear.'), true);
    });
    const result = await generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(), reserveProviderDispatch: reserve,
      dependencies: { callCreativeAI },
    });
    expect(reserve.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ provider: 'anthropic', fallback: false, providerCalls: 1 }),
      expect.objectContaining({ provider: 'openai', fallback: true, providerCalls: 1 }),
    ]);
    expect(result.tokens).toEqual({ prompt: 321, completion: 123, total: 444 });
    expect(result.provenance).toMatchObject({ runId: 'ai-run-1', provider: 'openai', model: 'gpt-5.5' });
    expect(result.budgetUsage.providerCalls).toBe(2);
  });

  it('rejects unsupported evidence keys and deleted placeholders', async () => {
    const unsupported = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(creativeOutput('A factual claim.', ['unknown-key']));
    });
    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(), reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI: unsupported },
    })).rejects.toThrow(/unsupported evidence key/i);

    const deleted = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(JSON.stringify({
        content: 'The placeholder disappeared.',
        claims: [{ text: 'A proposal.', classification: 'creative_proposal', evidenceKeys: [] }],
        unresolvedRequirementIds: ['brand-intake:business.differentiators'],
      }));
    });
    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput(), preflight: preflight(true), reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI: deleted },
    })).rejects.toThrow(/placeholder/i);
  });

  it('uses one reserved OpenAI repair when Anthropic succeeds with invalid structured output', async () => {
    const reserve = vi.fn();
    const callCreativeAI = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'anthropic', fallback: false });
      return aiResult('{"content":42}', undefined, 'anthropic');
    });
    const callStructuredAI = vi.fn(async options => {
      expect(options).toMatchObject({
        operation: 'brand-deliverable-generate',
        provider: 'openai',
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
      expect.objectContaining({ provider: 'anthropic', fallback: false }),
      expect.objectContaining({ provider: 'openai', fallback: true }),
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
    const badNaming = vi.fn(async options => {
      await options.beforeProviderDispatch?.({ provider: 'openai', fallback: false });
      return aiResult(creativeOutput('Northstar is trademark cleared and its domain is available.'));
    });
    await expect(generateBrandGenerationCandidate({
      frozenInput: frozenInput('naming'), preflight: preflight(), reserveProviderDispatch: vi.fn(),
      dependencies: { callCreativeAI: badNaming },
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
