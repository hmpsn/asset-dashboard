import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AICallOptions, AICallResult } from '../../server/ai.js';
import type { PersistedGeneratedPost } from '../../shared/types/content.js';
import type { GenerationAuditReport } from '../../shared/types/generation-evidence.js';
import type { ContentGenerationContextV2Result } from '../../shared/types/intelligence.js';
import type {
  MatrixGenerationBudgetUsage,
  MatrixGenerationItem,
  MatrixGenerationPreviewTarget,
  ResolvedMatrixStructuralTarget,
} from '../../shared/types/matrix-generation.js';
import { MATRIX_GENERATION_BATCH_LIMITS } from '../../shared/types/matrix-generation.js';

const { callAIMock, isAnthropicConfiguredMock } = vi.hoisted(() => ({
  callAIMock: vi.fn(),
  isAnthropicConfiguredMock: vi.fn(() => true),
}));

vi.mock('../../server/ai.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../server/ai.js')>()),
  callAI: callAIMock,
}));

vi.mock('../../server/anthropic-helpers.js', () => ({
  isAnthropicConfigured: isAnthropicConfiguredMock,
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../../server/abort-helpers.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../server/abort-helpers.js')>()),
  abortableDelay: vi.fn(async () => undefined),
}));

import {
  MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES,
  MatrixGenerationProviderInputEnvelopeError,
  matrixGenerationInputReservationCeiling,
  matrixGenerationProviderReservation,
  matrixGenerationRenderedInputUtf8Bytes,
} from '../../server/domains/content/matrix-generation/budget.js';
import {
  auditMatrixGenerationCandidate,
  reviseMatrixGenerationCandidate,
  type MatrixGenerationAuditAuthority,
} from '../../server/domains/content/matrix-generation/operations.js';
import {
  estimateMatrixGenerationBatchBudget,
  estimateMatrixGenerationCellBudget,
  estimateMatrixGenerationSetAuditInputReservation,
} from '../../server/domains/content/matrix-generation/preview.js';
import {
  MATRIX_GENERATION_SET_AUDIT_MAX_ITEM_ID_UTF8_BYTES,
  MATRIX_GENERATION_SET_AUDIT_MAX_PAGE_TEXT_CHARS,
  projectMatrixGenerationSetAuditPage,
  renderMatrixGenerationSetAuditProviderInput,
} from '../../server/domains/content/matrix-generation/set-audit-input.js';
import {
  auditMatrixGenerationSet,
} from '../../server/domains/content/matrix-generation/set-audit.js';
import {
  generateMatrixBriefStage,
  generateMatrixPostStage,
} from '../../server/domains/content/matrix-generation/stages.js';
import type { BoundedProviderDispatch } from '../../server/content-posts-ai.js';
import { estimateModelCostUsd, MODEL_ROLES } from '../../server/model-manifest.js';

const NOW = '2026-07-14T12:00:00.000Z';
const WORKSPACE_ID = 'ws_matrix_budget';

function legalGuidanceHeavyTarget(): MatrixGenerationPreviewTarget {
  const guidance = 'g'.repeat(12_000);
  const bodyBlocks = Array.from({ length: 4 }, (_, index) => ({
    id: `template:section-${index + 1}`,
    source: 'template',
    sourceSectionId: `section-${index + 1}`,
    order: index + 1,
    generationRole: 'body',
    heading: { level: 2, renderedText: `Section ${index + 1}`, locked: true },
    guidance,
    wordCountTarget: 100,
    aeoContract: { modes: [], required: false },
    ctaContract: { role: 'none', required: false },
  }));
  const structural = {
    workspaceId: WORKSPACE_ID,
    matrixId: 'matrix-budget',
    templateId: 'template-budget',
    cellId: 'cell-budget',
    sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
    variableValues: { service: 'SEO consulting', city: 'Austin' },
    slugSubstitutions: { service: 'seo-consulting', city: 'austin' },
    proseSubstitutions: { service: 'SEO consulting', city: 'Austin' },
    targetKeyword: { value: 'SEO consulting Austin', source: 'target', evidenceRefs: [] },
    plannedUrl: '/austin/seo-consulting',
    title: 'SEO Consulting in Austin',
    metaDescription: 'Practical SEO consulting for Austin organizations.',
    renderedHeadings: bodyBlocks.map(block => block.heading.renderedText),
    pageType: 'service',
    schemaTypes: ['Service'],
    blockManifest: {
      generationContractVersion: 1,
      blocks: [
        {
          id: 'system:introduction',
          source: 'system',
          order: 0,
          generationRole: 'introduction',
          heading: { level: null, renderedText: null, locked: true },
          guidance: '',
          wordCountTarget: 80,
          aeoContract: { modes: [], required: false },
          ctaContract: { role: 'none', required: false },
        },
        ...bodyBlocks,
        {
          id: 'system:conclusion',
          source: 'system',
          order: 5,
          generationRole: 'conclusion',
          heading: { level: 2, renderedText: 'Next Steps', locked: true },
          guidance: '',
          wordCountTarget: 80,
          aeoContract: { modes: [], required: false },
          ctaContract: { role: 'none', required: false },
        },
      ],
      totalWordCountTarget: 400,
      fingerprint: 'a'.repeat(64),
    },
    generationContractVersion: 1,
    structuralRequirements: [],
    structuralBlockingRequirementIds: [],
    structuralFingerprint: 'b'.repeat(64),
  } as ResolvedMatrixStructuralTarget;
  return {
    ...structural,
    voiceSnapshot: {
      voiceProfileId: 'voice-profile-budget',
      voiceVersion: 1,
      finalizedBy: { actorType: 'operator', actorId: 'operator-budget' },
      finalizedAt: NOW,
      fingerprint: 'c'.repeat(64),
      anchorEvidenceRefs: [{
        sourceType: 'operator_submission',
        sourceId: 'voice-anchor-budget',
        capturedAt: NOW,
        selectedBy: { actorType: 'operator', actorId: 'operator-budget' },
        selectedAt: NOW,
      }],
    },
    identitySnapshot: [],
    evidenceRequirements: [],
    evidenceCapturedAt: NOW,
    evidenceFreshThrough: NOW,
    expectedArtifactRevisions: {
      brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
      post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
    },
    frozenEvidenceResolutionIds: [],
    effectiveInputFingerprint: 'd'.repeat(64),
    blockingRequirementIds: [],
    estimatedPaidBudget: {
      providerCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedUsd: 0,
      maxConcurrency: 1,
    },
  };
}

function generationContext(): ContentGenerationContextV2Result {
  return {
    intelligence: {
      version: 1,
      workspaceId: WORKSPACE_ID,
      assembledAt: NOW,
    },
    slices: ['seoContext', 'brand'],
    authority: {
      systemVoiceBlock: 'Use a clear, calm, practical voice.',
      userVoiceBlock: 'Explain useful truths without pressure.',
      identityPromptBlock: 'Clarity before complexity.',
      customNotes: null,
      voice: {
        status: 'calibrated',
        readiness: 'finalized',
        profileRevision: 1,
        voiceVersion: 1,
      },
    },
    projections: {
      brief: 'Ground the brief in the approved service evidence.',
      draft: 'Ground the draft in the approved service evidence.',
      voiceReview: 'Review against the finalized clear and calm voice.',
    },
    tokenEstimates: { brief: 20, draft: 20, voiceReview: 20 },
    evidence: {
      capturedAt: NOW,
      freshThrough: NOW,
      observedAt: [NOW],
      missing: ['keyword_metrics', 'serp'],
    },
    learningsAvailability: 'ready',
    effectiveInputFingerprint: 'e'.repeat(64),
  };
}

function expandedServiceTarget(sectionCount: number, index: number): MatrixGenerationPreviewTarget {
  const base = legalGuidanceHeavyTarget();
  const introduction = base.blockManifest.blocks[0]!;
  const source = base.blockManifest.blocks.find(block => block.source === 'template')!;
  const conclusion = base.blockManifest.blocks.at(-1)!;
  const body = Array.from({ length: sectionCount }, (_, bodyIndex) => ({
    ...source,
    id: `template:section-${bodyIndex + 1}`,
    sourceSectionId: `section-${bodyIndex + 1}`,
    order: bodyIndex + 1,
    heading: {
      ...source.heading,
      renderedText: `Service section ${bodyIndex + 1}`,
    },
  }));
  return {
    ...base,
    cellId: `cell-budget-${index + 1}`,
    plannedUrl: `/service-${index + 1}`,
    targetKeyword: {
      ...base.targetKeyword,
      value: `service ${index + 1}`,
    },
    blockManifest: {
      ...base.blockManifest,
      blocks: [
        introduction,
        ...body,
        { ...conclusion, order: sectionCount + 1 },
      ],
      totalWordCountTarget: sectionCount * 250,
      fingerprint: `${index + 1}`.repeat(64).slice(0, 64),
    },
  };
}

function auditAuthority(): MatrixGenerationAuditAuthority {
  return {
    voiceSnapshot: {
      voiceVersion: 1,
      profileRevision: 1,
      voiceDNA: {
        personalityTraits: ['Clear', 'Calm'],
        toneSpectrum: { formal_casual: 5, serious_playful: 3, technical_accessible: 8 },
        sentenceStyle: 'Short, direct sentences.',
        vocabularyLevel: 'Plain language.',
      },
      guardrails: {
        forbiddenWords: ['guaranteed'],
        requiredTerminology: [],
        toneBoundaries: ['Never pressure the reader.'],
        antiPatterns: ['Unsupported superlatives'],
      },
      contextModifiers: [],
      anchors: [{ context: 'body', content: 'Explain the useful truth clearly.' }],
    },
    approvedIdentity: [],
    evidenceResolutions: [],
  } as MatrixGenerationAuditAuthority;
}

function aiResult(options: AICallOptions, text: string): AICallResult {
  const provider = options.provider ?? 'openai';
  return {
    text,
    tokens: { prompt: 100, completion: 20, total: 120 },
    execution: {
      runId: `run-${callAIMock.mock.calls.length}`,
      executionChainId: options.executionChainId,
      operation: options.operation,
      provider,
      model: provider === 'anthropic' ? 'claude-opus-4-8' : 'gpt-5.6-terra',
      attempts: 1,
      cacheOutcome: 'bypass',
      startedAt: NOW,
      completedAt: NOW,
      durationMs: 1,
    },
  };
}

function addUsage(
  current: MatrixGenerationBudgetUsage,
  next: MatrixGenerationBudgetUsage,
): MatrixGenerationBudgetUsage {
  return {
    providerCalls: current.providerCalls + next.providerCalls,
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    estimatedUsd: current.estimatedUsd + next.estimatedUsd,
  };
}

beforeEach(() => {
  callAIMock.mockReset();
  isAnthropicConfiguredMock.mockReset();
  isAnthropicConfiguredMock.mockReturnValue(true);
  process.env.OPENAI_API_KEY = 'matrix-budget-test-key';
});

describe('content matrix preview budget', () => {
  it('converts serialized English input bytes with the shared 4:1 token estimate', () => {
    expect(matrixGenerationInputReservationCeiling(4_000)).toBe(1_512);
    expect(matrixGenerationInputReservationCeiling(1)).toBe(513);
  });

  it('enforces the shared envelope on exact rendered UTF-8 input at the dispatch boundary', () => {
    const dispatchFor = (content: string): BoundedProviderDispatch => ({
      provider: 'openai',
      model: MODEL_ROLES.creativeRecovery,
      fallback: false,
      renderedInput: {
        provider: 'openai',
        system: undefined,
        messages: [{ role: 'user', content }],
      },
      maxOutputTokens: 500,
    });
    const empty = dispatchFor('');
    const wrapperBytes = matrixGenerationRenderedInputUtf8Bytes(empty);
    const exactAscii = dispatchFor('a'.repeat(
      MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES - wrapperBytes,
    ));
    const overAscii = dispatchFor(`${exactAscii.renderedInput.messages[0]!.content}a`);

    expect(matrixGenerationRenderedInputUtf8Bytes(exactAscii))
      .toBe(MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES);
    expect(() => matrixGenerationProviderReservation(exactAscii)).not.toThrow();
    expect(() => matrixGenerationProviderReservation(overAscii))
      .toThrow(MatrixGenerationProviderInputEnvelopeError);

    const emoji = '🧭';
    const emojiBytes = Buffer.byteLength(emoji, 'utf8');
    const availableBytes = MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES - wrapperBytes;
    const emojiCount = Math.floor(availableBytes / emojiBytes);
    const remainingAscii = availableBytes - (emojiCount * emojiBytes);
    const exactUnicode = dispatchFor(`${emoji.repeat(emojiCount)}${'x'.repeat(remainingAscii)}`);
    expect(matrixGenerationRenderedInputUtf8Bytes(exactUnicode))
      .toBe(MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES);
    expect(() => matrixGenerationProviderReservation(exactUnicode)).not.toThrow();
    expect(() => matrixGenerationProviderReservation(dispatchFor(
      `${exactUnicode.renderedInput.messages[0]!.content}${emoji}`,
    ))).toThrow(MatrixGenerationProviderInputEnvelopeError);
  });

  it('prices provider reservations through the canonical exact-model policy', () => {
    const dispatch = (
      provider: 'openai' | 'anthropic',
      model = provider === 'openai' ? MODEL_ROLES.creativeRecovery : MODEL_ROLES.creativeWriter,
    ): BoundedProviderDispatch => ({
      provider,
      model,
      fallback: false,
      renderedInput: provider === 'openai'
        ? { provider, system: undefined, messages: [{ role: 'user', content: 'Grounded copy.' }] }
        : { provider, system: 'System.', messages: [{ role: 'user', content: 'Grounded copy.' }] },
      maxOutputTokens: 500,
    });
    for (const provider of ['openai', 'anthropic'] as const) {
      const usage = matrixGenerationProviderReservation(dispatch(provider));
      const canonical = estimateModelCostUsd({
        model: provider === 'openai' ? MODEL_ROLES.creativeRecovery : MODEL_ROLES.creativeWriter,
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
      });
      expect(usage.estimatedUsd).toBeGreaterThanOrEqual(canonical);
      expect(usage.estimatedUsd - canonical).toBeLessThan(0.0000011);
      expect(usage.outputTokens).toBe(provider === 'anthropic' ? 4_596 : 500);
    }

    expect(matrixGenerationProviderReservation(
      dispatch('anthropic', 'claude-sonnet-5'),
    ).outputTokens).toBe(4_596);
    expect(matrixGenerationProviderReservation(
      dispatch('anthropic', 'claude-haiku-4-5'),
    ).outputTokens).toBe(500);
    expect(matrixGenerationProviderReservation(
      dispatch('openai', MODEL_ROLES.structuredSynthesis),
    ).outputTokens).toBe(500);
  });

  it('adds manifest-derived Anthropic headroom to every reachable creative call and revision', () => {
    const target = legalGuidanceHeavyTarget();
    const estimate = estimateMatrixGenerationCellBudget(target, generationContext(), []);
    const bodyBlockCount = target.blockManifest.blocks.filter(block => block.source === 'template').length;
    const proseWithoutThinking = 600 + (bodyBlockCount * 800) + 800 + 8_000;
    const baseOutput = 7_000 + (proseWithoutThinking * 2) + 200 + (2_500 * 2) + 12_000;
    expect(estimate.outputTokens - baseOutput).toBe(4_096 * (bodyBlockCount + 4));
  });

  it('keeps a six-page, fifteen-section service batch inside the accepted hard ceilings', () => {
    const context = generationContext();
    context.authority.systemVoiceBlock = 'Finalized voice authority. '.repeat(1_200);
    context.authority.identityPromptBlock = 'Approved positioning. '.repeat(600);
    context.projections.draft = 'Grounded generation context. '.repeat(400);

    const targets = Array.from({ length: 6 }, (_, index) => {
      const target = expandedServiceTarget(15, index);
      target.estimatedPaidBudget = estimateMatrixGenerationCellBudget(target, context, []);
      return target;
    });
    const estimate = estimateMatrixGenerationBatchBudget(targets);

    expect(estimate.inputTokens).toBeLessThanOrEqual(
      MATRIX_GENERATION_BATCH_LIMITS.maxInputTokens,
    );
    expect(estimate.outputTokens).toBeLessThanOrEqual(
      MATRIX_GENERATION_BATCH_LIMITS.maxOutputTokens,
    );
    expect(estimate.estimatedUsd).toBeLessThanOrEqual(
      MATRIX_GENERATION_BATCH_LIMITS.maxEstimatedUsd,
    );
    expect(estimate.providerCalls).toBeLessThanOrEqual(
      MATRIX_GENERATION_BATCH_LIMITS.maxProviderCalls,
    );
  });

  it('rejects an aggregate selection whose estimate cannot be accepted by start hard limits', () => {
    const context = generationContext();
    const target = expandedServiceTarget(15, 0);
    target.estimatedPaidBudget = estimateMatrixGenerationCellBudget(target, context, []);

    expect(() => estimateMatrixGenerationBatchBudget(
      Array.from({ length: MATRIX_GENERATION_BATCH_LIMITS.maxItems }, () => target),
    )).toThrow(/batch estimate exceeds its accepted hard limit/i);
  });

  it('reserves at least the exact 25-cell Unicode set-audit input with long durable IDs', () => {
    const maxItemId = (index: number) => {
      const suffix = index.toString().padStart(4, '0');
      return `${'🧭'.repeat(49)}${suffix}`;
    };
    expect(Buffer.byteLength(maxItemId(0), 'utf8'))
      .toBe(MATRIX_GENERATION_SET_AUDIT_MAX_ITEM_ID_UTF8_BYTES);

    const targets = Array.from({ length: 25 }, (_, targetIndex) => {
      const target = expandedServiceTarget(40, targetIndex);
      target.blockManifest.blocks = target.blockManifest.blocks.map((block, blockIndex) => ({
        ...block,
        id: `${targetIndex}-${blockIndex}-${'界'.repeat(60)}`,
      }));
      return target;
    });
    const maximumUnicodeText = '🧭'.repeat(MATRIX_GENERATION_SET_AUDIT_MAX_PAGE_TEXT_CHARS);
    const runtimePages = targets.map((target, index) => projectMatrixGenerationSetAuditPage({
      itemId: maxItemId(index),
      target,
      text: maximumUnicodeText,
    }));
    const { renderedInput } = renderMatrixGenerationSetAuditProviderInput(runtimePages);
    const exactRuntimeBytes = matrixGenerationRenderedInputUtf8Bytes({
      provider: 'openai',
      model: MODEL_ROLES.structuredSynthesis,
      fallback: false,
      renderedInput,
      maxOutputTokens: 5_000,
    });
    const exactRuntimeReservation = matrixGenerationInputReservationCeiling(exactRuntimeBytes);
    const previewReservation = estimateMatrixGenerationSetAuditInputReservation(targets);

    expect(exactRuntimeBytes).toBeGreaterThan(
      MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES * 0.75,
    );
    expect(exactRuntimeBytes)
      .toBeLessThanOrEqual(MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES);
    expect(previewReservation).toBeGreaterThanOrEqual(exactRuntimeReservation);
  });

  it('sanitizes C0-heavy runtime page text before reserving set-audit input', async () => {
    const controls = String.fromCharCode(
      ...Array.from({ length: 9 }, (_, index) => index),
      11,
      12,
      ...Array.from({ length: 18 }, (_, index) => index + 14),
      127,
    );
    const targets = [expandedServiceTarget(4, 0), expandedServiceTarget(4, 1)];
    const candidates = targets.map((target, index) => ({
      item: {
        id: `item-control-${index + 1}`,
        previewTarget: target,
      } as MatrixGenerationItem,
      post: {
        introduction: `<p>Safe copy ${controls.repeat(500)}</p>`,
        sections: [],
        conclusion: '<p>Safe conclusion.</p>',
      } as PersistedGeneratedPost,
    }));
    const dispatches: BoundedProviderDispatch[] = [];
    let serializedPages = '';
    const callAI = vi.fn(async (options: AICallOptions) => {
      serializedPages = options.messages?.[0]?.content ?? '';
      return aiResult(options, JSON.stringify({ findings: [] }));
    });

    await auditMatrixGenerationSet({
      workspaceId: WORKSPACE_ID,
      candidates,
      expectedCandidateCount: candidates.length,
      passCount: 1,
      beforeBoundedProviderDispatch: dispatch => dispatches.push(dispatch),
      dependencies: { callAI },
    });

    const payload = JSON.parse(serializedPages) as { pages: Array<{ text: string }> };
    expect(payload.pages).toHaveLength(2);
    for (const page of payload.pages) {
      expect(page.text).toContain('Safe copy');
      expect(page.text).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
      expect(page.text.length).toBeLessThanOrEqual(
        MATRIX_GENERATION_SET_AUDIT_MAX_PAGE_TEXT_CHARS,
      );
    }

    const exactRuntimeBytes = matrixGenerationRenderedInputUtf8Bytes(dispatches[0]!);
    const exactRuntimeReservation = matrixGenerationInputReservationCeiling(exactRuntimeBytes);
    const previewReservation = estimateMatrixGenerationSetAuditInputReservation(targets);
    expect(previewReservation).toBeGreaterThanOrEqual(exactRuntimeReservation);
  });

  it('does not reject its exact preview ceiling across every mocked provider stage', async () => {
    const target = legalGuidanceHeavyTarget();
    const context = generationContext();
    const cellEstimate = estimateMatrixGenerationCellBudget(target, context, []);
    target.estimatedPaidBudget = cellEstimate;
    const accepted = estimateMatrixGenerationBatchBudget([target]);
    const twoCellEstimate = estimateMatrixGenerationBatchBudget([target, target]);
    const tenCellEstimate = estimateMatrixGenerationBatchBudget(
      Array.from({ length: 10 }, () => target),
    );

    expect(accepted).toEqual(cellEstimate);
    expect(twoCellEstimate.providerCalls).toBe((cellEstimate.providerCalls * 2) + 2);
    expect(twoCellEstimate.inputTokens).toBe(
      (cellEstimate.inputTokens * 2)
        + (estimateMatrixGenerationSetAuditInputReservation([target, target]) * 2),
    );
    expect(twoCellEstimate.outputTokens).toBe((cellEstimate.outputTokens * 2) + 10_000);
    expect(tenCellEstimate.providerCalls).toBe((cellEstimate.providerCalls * 10) + 2);
    expect(accepted.inputTokens).toBeLessThanOrEqual(MATRIX_GENERATION_BATCH_LIMITS.maxInputTokens);
    expect(accepted.outputTokens).toBeLessThanOrEqual(MATRIX_GENERATION_BATCH_LIMITS.maxOutputTokens);
    expect(accepted.estimatedUsd).toBeLessThanOrEqual(MATRIX_GENERATION_BATCH_LIMITS.maxEstimatedUsd);
    expect(tenCellEstimate.inputTokens).toBeLessThanOrEqual(
      MATRIX_GENERATION_BATCH_LIMITS.maxInputTokens,
    );
    expect(tenCellEstimate.outputTokens).toBeLessThanOrEqual(
      MATRIX_GENERATION_BATCH_LIMITS.maxOutputTokens,
    );
    expect(tenCellEstimate.estimatedUsd).toBeLessThanOrEqual(
      MATRIX_GENERATION_BATCH_LIMITS.maxEstimatedUsd,
    );

    const groundedWords = Array.from(
      { length: 72 },
      (_, index) => `grounded-${index + 1}`,
    ).join(' ');
    const blockHtml = target.blockManifest.blocks.map(block => ({
      targetId: block.id,
      html: block.source === 'template'
        ? `<h2>${block.heading.renderedText}</h2><p>${groundedWords}</p>`
        : `<p>${groundedWords}</p>`,
    }));
    const briefResponse = {
      secondaryKeywords: [],
      suggestedTitle: target.title,
      suggestedMetaDesc: target.metaDescription,
      outline: target.blockManifest.blocks
        .filter(block => block.source === 'template')
        .map(block => ({
          heading: block.heading.renderedText,
          notes: 'Use the locked guidance.',
          wordCount: block.wordCountTarget,
          keywords: [],
        })),
      wordCountTarget: target.blockManifest.totalWordCountTarget,
      intent: 'commercial',
      audience: 'Austin organizations',
      competitorInsights: '',
      internalLinkSuggestions: [],
    };
    callAIMock.mockImplementation(async (options: AICallOptions) => {
      if (options.provider === 'anthropic') throw new Error('forced fallback');
      const responses: Record<string, string> = {
        'content-brief-generate': JSON.stringify(briefResponse),
        'content-post-introduction': `<p>${groundedWords}</p>`,
        'content-post-section': `<h2>Service detail</h2><p>${groundedWords}</p>`,
        'content-post-conclusion': `<h2>Next Steps</h2><p>${groundedWords}</p>`,
        'content-post-unify': JSON.stringify({
          introduction: blockHtml[0]?.html,
          sections: blockHtml.slice(1, -1).map(block => block.html),
          conclusion: blockHtml.at(-1)?.html,
        }),
        'content-post-seo-meta': JSON.stringify({
          seoTitle: target.title,
          seoMetaDescription: target.metaDescription,
        }),
        'content-matrix-item-audit': JSON.stringify({
          revisionRecommended: false,
          findings: [],
        }),
        'content-matrix-item-revise': JSON.stringify({ blocks: blockHtml }),
        'content-matrix-set-audit': JSON.stringify({ findings: [] }),
      };
      const response = responses[options.operation];
      if (!response) throw new Error(`Unexpected operation: ${options.operation}`);
      return aiResult(options, response);
    });

    let usage: MatrixGenerationBudgetUsage = {
      providerCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedUsd: 0,
    };
    const reserve = (dispatch: BoundedProviderDispatch) => {
      usage = addUsage(usage, matrixGenerationProviderReservation(dispatch));
      expect(usage.providerCalls).toBeLessThanOrEqual(accepted.providerCalls);
      expect(usage.inputTokens).toBeLessThanOrEqual(accepted.inputTokens);
      expect(usage.outputTokens).toBeLessThanOrEqual(accepted.outputTokens);
      expect(usage.estimatedUsd).toBeLessThanOrEqual(accepted.estimatedUsd);
    };
    const stageOptions = {
      workspaceId: WORKSPACE_ID,
      target,
      context,
      executionChainId: 'matrix-budget-chain',
      assertAuthority: () => undefined,
      beforeBoundedProviderDispatch: reserve,
    };
    const brief = await generateMatrixBriefStage(stageOptions);
    const post = await generateMatrixPostStage(brief, stageOptions) as PersistedGeneratedPost;
    const report: GenerationAuditReport = {
      verdict: 'needs_attention',
      deterministicChecks: [],
      modelFindings: [],
      humanRequiredChecks: [],
      unresolvedRequirementIds: [],
      revisionCount: 0,
      auditedAt: NOW,
    };
    const operationBase = {
      workspaceId: WORKSPACE_ID,
      target,
      post,
      authority: auditAuthority(),
      executionChainId: 'matrix-budget-chain',
      beforeBoundedProviderDispatch: reserve,
    };
    await auditMatrixGenerationCandidate({ ...operationBase, deterministicReport: report });
    await reviseMatrixGenerationCandidate({ ...operationBase, auditReport: report });
    await auditMatrixGenerationCandidate({ ...operationBase, deterministicReport: report });

    expect(callAIMock).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: 'content-matrix-set-audit',
    }));
    expect(usage.providerCalls).toBe(accepted.providerCalls);
  });
});
