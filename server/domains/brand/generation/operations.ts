import { createHash } from 'node:crypto';

import type {
  AICallOptions,
  AICallResult,
} from '../../../ai.js';
import { callAI, renderAIProviderInput } from '../../../ai.js';
import {
  callCreativeAIWithMetadata,
  renderCreativeProviderCallInput,
  type CreativeAICallOptions,
} from '../../../content-posts-ai.js';
import type { GenerationProvenance } from '../../../../shared/types/ai-execution.js';
import type {
  BrandGeneratedClaim,
  BrandGenerationAuditAttemptOutput,
  BrandGenerationBudgetUsage,
  BrandGenerationCandidateAttemptOutput,
  BrandGenerationDeliverableCandidateAttemptOutput,
  BrandGenerationFoundationCandidateAttemptOutput,
} from '../../../../shared/types/brand-generation.js';
import {
  BRAND_GENERATION_ATOMIC_TARGETS,
  BRAND_DELIVERABLE_TARGET_POLICY,
  BRAND_GENERATION_LIMITS,
} from '../../../../shared/types/brand-generation.js';
import type {
  GenerationAutomaticRevisionCount,
  GenerationAuditReport,
  GenerationEvidenceSourceRef,
  GenerationFactualEvidenceSourceRef,
} from '../../../../shared/types/generation-evidence.js';
import {
  STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES,
} from '../../../../shared/types/generation-evidence.js';
import {
  mergeBrandGenerationAudit,
  runBrandGenerationDeterministicAudit,
} from './audit.js';
import {
  parseBrandDeliverableAIOutput,
  parseBrandFoundationAIOutput,
  parseBrandModelAuditAIOutput,
  type BrandRawAIClaim,
} from './output-schemas.js';
import type {
  BrandGenerationEvidenceCatalogEntry,
  BrandGenerationFrozenTargetInput,
  BrandGenerationPreflightResult,
} from './preflight.js';
import {
  brandGenerationPromptInputTokenCeiling,
  brandGenerationCandidatePromptBytes,
  buildBrandGenerationAuditPrompt,
  buildBrandGenerationPrompt,
  buildBrandGenerationRefinementPrompt,
  BrandGenerationPromptContractError,
  type BrandGenerationEffectivePrompt,
  type BrandGenerationRenderedProviderInput,
  type BrandGenerationRelatedCandidate,
} from './prompt.js';
import { canonicalBrandGenerationFingerprint } from './fingerprint.js';

export interface BrandProviderReservationRequest {
  operation: 'brand-deliverable-generate' | 'brand-deliverable-refine' | 'brand-deliverable-audit';
  provider: 'anthropic' | 'openai';
  fallback: boolean;
  providerCalls: 1;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
  /** Exact rendered input for the provider dispatch this reservation precedes. */
  effectiveInputFingerprint: string;
}

export type ReserveBrandProviderDispatch = (
  request: BrandProviderReservationRequest,
) => void | Promise<void>;

export interface BrandGenerationAIDependencies {
  callCreativeAI: (options: CreativeAICallOptions) => Promise<AICallResult>;
  callStructuredAI: (options: AICallOptions) => Promise<AICallResult>;
}

export interface BrandGenerationAIOperationResult<TOutput> {
  output: TOutput;
  provenance: GenerationProvenance;
  budgetUsage: BrandGenerationBudgetUsage;
  /** Exact successful provider result; callers may persist it in the attempt ledger only. */
  tokens: AICallResult['tokens'];
  execution: AICallResult['execution'];
  effectiveInputFingerprint: string;
}

export interface GenerateBrandGenerationCandidateInput {
  frozenInput: BrandGenerationFrozenTargetInput;
  preflight: BrandGenerationPreflightResult;
  /** Worker-supplied exact prompt; direct callers may omit and let the operation assemble it. */
  effectivePrompt?: BrandGenerationEffectivePrompt;
  reserveProviderDispatch: ReserveBrandProviderDispatch;
  signal?: AbortSignal;
  dependencies?: Partial<BrandGenerationAIDependencies>;
}

export interface RefineBrandGenerationCandidateInput extends GenerateBrandGenerationCandidateInput {
  priorCandidate: BrandGenerationDeliverableCandidateAttemptOutput;
  direction: string;
  automaticRevisionCount: GenerationAutomaticRevisionCount;
}

export interface AuditBrandGenerationCandidateInput extends GenerateBrandGenerationCandidateInput {
  candidate: BrandGenerationCandidateAttemptOutput;
  revisionCount: GenerationAutomaticRevisionCount;
  /** Persisted deterministic checkpoint used verbatim by the model-audit prompt. */
  deterministicReport?: GenerationAuditReport;
  relatedCandidates?: readonly BrandGenerationRelatedCandidate[];
  now?: () => Date;
}

export class BrandGenerationOutputContractError extends Error {
  readonly code = 'brand_generation_output_contract';

  constructor(message: string) {
    super(message);
    this.name = 'BrandGenerationOutputContractError';
  }
}

export class BrandGenerationPaidWorkBlockedError extends Error {
  readonly code = 'brand_generation_paid_work_blocked';
  readonly requirementIds: string[];

  constructor(requirementIds: string[]) {
    super('Brand generation paid work is blocked by deterministic preflight.');
    this.name = 'BrandGenerationPaidWorkBlockedError';
    this.requirementIds = requirementIds;
  }
}

const DEFAULT_DEPENDENCIES: BrandGenerationAIDependencies = {
  callCreativeAI: callCreativeAIWithMetadata,
  callStructuredAI: callAI,
};

const PROVIDER_TOKEN_COST_MICROS = {
  anthropic: { input: 3, output: 15 },
  openai: { input: 5, output: 30 },
} as const;

const CREATIVE_OUTPUT_TOKEN_CEILING = 2_500;
const AUDIT_OUTPUT_TOKEN_CEILING = 1_500;

function dependencies(
  overrides?: Partial<BrandGenerationAIDependencies>,
): BrandGenerationAIDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function resolveEffectivePrompt(
  supplied: BrandGenerationEffectivePrompt | undefined,
  assembled: BrandGenerationEffectivePrompt,
): BrandGenerationEffectivePrompt {
  if (supplied && (supplied.effectiveInputFingerprint !== assembled.effectiveInputFingerprint
    || supplied.systemPrompt !== assembled.systemPrompt
    || supplied.userPrompt !== assembled.userPrompt)) {
    throw new BrandGenerationOutputContractError(
      'Worker-supplied brand prompt does not match the canonical effective input.',
    );
  }
  return supplied ?? assembled;
}

function providerReservation(
  operation: BrandProviderReservationRequest['operation'],
  provider: BrandProviderReservationRequest['provider'],
  fallback: boolean,
  renderedInput: BrandGenerationRenderedProviderInput,
  outputTokens: number,
): BrandProviderReservationRequest {
  const inputTokens = brandGenerationPromptInputTokenCeiling(renderedInput);
  const rates = PROVIDER_TOKEN_COST_MICROS[provider];
  return {
    operation,
    provider,
    fallback,
    providerCalls: 1,
    inputTokens,
    outputTokens,
    estimatedCostMicros: (inputTokens * rates.input) + (outputTokens * rates.output),
    effectiveInputFingerprint: canonicalBrandGenerationFingerprint(renderedInput),
  };
}

function renderedProviderInput(input: {
  provider: 'anthropic' | 'openai';
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  researchMode: boolean;
  responseFormat?: { type: 'json_object' };
}): BrandGenerationRenderedProviderInput {
  const rendered = renderAIProviderInput(input);
  return {
    provider: rendered.provider,
    system: rendered.system,
    messages: rendered.messages,
    ...(input.responseFormat ? { responseFormat: input.responseFormat } : {}),
  };
}

function renderedCreativeInput(
  prompt: BrandGenerationEffectivePrompt,
  provider: 'anthropic' | 'openai',
): BrandGenerationRenderedProviderInput {
  const callInput = renderCreativeProviderCallInput({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    json: true,
  }, provider);
  return renderedProviderInput({
    provider,
    system: callInput.system,
    messages: callInput.messages,
    researchMode: true,
    ...(provider === 'openai' ? { responseFormat: { type: 'json_object' } } : {}),
  });
}

/**
 * Deterministic acceptance-time check for every provider envelope the creative
 * dispatcher may choose on its first call or fallback.
 */
export function validateBrandGenerationCreativeProviderEnvelopes(
  prompt: BrandGenerationEffectivePrompt,
): void {
  brandGenerationPromptInputTokenCeiling(renderedCreativeInput(prompt, 'anthropic'));
  brandGenerationPromptInputTokenCeiling(renderedCreativeInput(prompt, 'openai'));
  brandGenerationPromptInputTokenCeiling(renderedStructuredInput(prompt, 'creative_repair'));
}

function renderedStructuredInput(
  prompt: BrandGenerationEffectivePrompt,
  mode: 'audit' | 'creative_repair',
): BrandGenerationRenderedProviderInput {
  return renderedProviderInput({
    provider: 'openai',
    ...(mode === 'audit' ? { system: prompt.systemPrompt } : {}),
    messages: [{
      role: 'user',
      content: mode === 'audit'
        ? prompt.userPrompt
        : `${prompt.systemPrompt}\n\n${prompt.userPrompt}`,
    }],
    researchMode: true,
    responseFormat: { type: 'json_object' },
  });
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function buildWorstEscapingCandidate(
  frozenInput: BrandGenerationFrozenTargetInput,
  preflight: BrandGenerationPreflightResult,
): BrandGenerationCandidateAttemptOutput {
  const target = frozenInput.inputSnapshot.target;
  const placeholderPrefix = preflight.attemptOutput.placeholders
    .map(placeholder => placeholder.token)
    .join(' ');
  const namingPrefix = target === 'naming'
    ? 'Creative naming proposal. Trademark, domain, legal, and cultural clearance have not been verified. '
    : '';
  const creativeClaim = BRAND_DELIVERABLE_TARGET_POLICY[target].claimPolicy === 'creative_proposal'
    ? [{
        text: 'x',
        classification: 'creative_proposal' as const,
        evidenceKeys: [],
        sourceRefs: [],
      }]
    : [];
  const candidate = (repeatCount: number): BrandGenerationCandidateAttemptOutput => {
    const worstText = [placeholderPrefix, namingPrefix, '"'.repeat(repeatCount)]
      .filter(Boolean)
      .join(' ');
    if (target === 'voice_foundation') {
      return {
        kind: 'foundation_candidate',
        content: null,
        foundationDraft: {
          schemaVersion: 1,
          summary: worstText,
          voiceDNA: {
            personalityTraits: ['x'],
            toneSpectrum: { formal_casual: 1, serious_playful: 1, technical_accessible: 1 },
            sentenceStyle: 'x',
            vocabularyLevel: 'x',
          },
          guardrails: {
            forbiddenWords: [],
            requiredTerminology: [],
            toneBoundaries: [],
            antiPatterns: [],
          },
          contextModifiers: [],
          evidenceRequirementIds: preflight.attemptOutput.requirements.map(requirement => requirement.id),
          fingerprint: '0'.repeat(64),
        },
        claims: [],
        requirements: preflight.attemptOutput.requirements,
        placeholders: preflight.attemptOutput.placeholders,
      };
    }
    return {
      kind: 'deliverable_candidate',
      content: worstText,
      foundationDraft: null,
      claims: creativeClaim,
      requirements: preflight.attemptOutput.requirements,
      placeholders: preflight.attemptOutput.placeholders,
    };
  };
  if (brandGenerationCandidatePromptBytes(candidate(0)) > BRAND_GENERATION_LIMITS.maxCandidateSnapshotBytes) {
    throw new BrandGenerationPromptContractError(
      'Frozen requirements leave no bounded candidate envelope for automatic review.',
    );
  }
  let low = 0;
  let high = BRAND_GENERATION_LIMITS.maxCandidateSnapshotBytes;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (brandGenerationCandidatePromptBytes(candidate(middle)) <= BRAND_GENERATION_LIMITS.maxCandidateSnapshotBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const bounded = candidate(low);
  if (utf8Bytes(JSON.stringify(bounded)) > BRAND_GENERATION_LIMITS.maxResolvedCandidateSnapshotBytes) {
    throw new BrandGenerationPromptContractError(
      'Frozen requirements leave no bounded durable candidate snapshot.',
    );
  }
  return bounded;
}

/**
 * Related-candidate compaction consumes only content/claims before replacing
 * the full candidate with a fixed-length fingerprint. Keep this sentinel
 * independent from the current target: required placeholder or naming copy at
 * the front of that target must not displace the quote-heavy prefix that
 * maximizes the nested provider envelope for the other targets.
 */
function buildWorstEscapingRelatedCandidate(): BrandGenerationDeliverableCandidateAttemptOutput {
  const candidate = (repeatCount: number): BrandGenerationDeliverableCandidateAttemptOutput => ({
    kind: 'deliverable_candidate',
    content: '"'.repeat(repeatCount),
    foundationDraft: null,
    claims: [],
    requirements: [],
    placeholders: [],
  });
  let low = 1;
  let high = BRAND_GENERATION_LIMITS.maxCandidateSnapshotBytes;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (brandGenerationCandidatePromptBytes(candidate(middle)) <= BRAND_GENERATION_LIMITS.maxCandidateSnapshotBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return candidate(low);
}

function worstEscapingDirection(): string {
  // Automatic audit findings are stripped of control characters before this
  // bound. Quotes/backslashes then maximize the remaining JSON expansion.
  return '"\\'.repeat(Math.floor(BRAND_GENERATION_LIMITS.maxAutomaticDirectionBytes / 2));
}

function validateBrandGenerationAuditProviderEnvelope(
  prompt: BrandGenerationEffectivePrompt,
  maxInstructionBytes = BRAND_GENERATION_LIMITS.maxPromptBytes,
): void {
  brandGenerationPromptInputTokenCeiling(
    renderedStructuredInput(prompt, 'audit'),
    maxInstructionBytes,
  );
}

function validateEnvelopeStage(stage: string, validate: () => void): void {
  try {
    validate();
  } catch (err) {
    if (err instanceof BrandGenerationPromptContractError) {
      throw new BrandGenerationPromptContractError(
        `Required ${stage} envelope cannot fit: ${err.message}`,
      );
    }
    throw err;
  }
}

/**
 * Acceptance-time closure proof for every mandatory paid stage. The synthetic
 * candidate fills the persisted candidate allowance with the JSON characters
 * that expand most when the prompt is embedded in a provider message. Related
 * context uses the complete target census, and refinement uses the maximum
 * allowed direction. Therefore an accepted frozen input leaves room for any
 * candidate the output contract can retain, its deterministic report, the
 * whole-set digest, one refinement, and the post-refinement audit.
 */
export function validateBrandGenerationRequiredStageEnvelopeClosure(
  frozenInput: BrandGenerationFrozenTargetInput,
  preflight: BrandGenerationPreflightResult,
): void {
  const closureLimit = BRAND_GENERATION_LIMITS.maxPromptBytes
    - BRAND_GENERATION_LIMITS.providerStageClosureSafetyBytes;
  validateEnvelopeStage('generation', () => {
    const generationPrompt = buildBrandGenerationPrompt(frozenInput, preflight);
    brandGenerationPromptInputTokenCeiling(
      renderedCreativeInput(generationPrompt, 'anthropic'),
      closureLimit,
    );
    brandGenerationPromptInputTokenCeiling(
      renderedCreativeInput(generationPrompt, 'openai'),
      closureLimit,
    );
    brandGenerationPromptInputTokenCeiling(
      renderedStructuredInput(generationPrompt, 'creative_repair'),
      closureLimit,
    );
  });

  const candidate = buildWorstEscapingCandidate(frozenInput, preflight);
  const relatedCandidate = buildWorstEscapingRelatedCandidate();
  const relatedCandidates = BRAND_GENERATION_ATOMIC_TARGETS
    .filter(targetId => targetId !== frozenInput.inputSnapshot.target)
    .map(targetId => ({ targetId, candidate: relatedCandidate }));
  const initialReport = runBrandGenerationDeterministicAudit({
    frozenInput,
    preflight,
    candidate,
    revisionCount: 0,
    now: () => new Date('2000-01-01T00:00:00.000Z'),
  });
  validateEnvelopeStage('initial audit', () => {
    validateBrandGenerationAuditProviderEnvelope(
      buildBrandGenerationAuditPrompt(
        frozenInput,
        preflight,
        candidate,
        initialReport,
        relatedCandidates,
      ),
      closureLimit,
    );
  });

  if (frozenInput.inputSnapshot.target === 'voice_foundation') return;
  validateEnvelopeStage('automatic refinement', () => {
    const refinementPrompt = buildBrandGenerationRefinementPrompt(
      frozenInput,
      preflight,
      candidate,
      worstEscapingDirection(),
    );
    brandGenerationPromptInputTokenCeiling(
      renderedCreativeInput(refinementPrompt, 'anthropic'),
      closureLimit,
    );
    brandGenerationPromptInputTokenCeiling(
      renderedCreativeInput(refinementPrompt, 'openai'),
      closureLimit,
    );
    brandGenerationPromptInputTokenCeiling(
      renderedStructuredInput(refinementPrompt, 'creative_repair'),
      closureLimit,
    );
  });
  const revisedReport = runBrandGenerationDeterministicAudit({
    frozenInput,
    preflight,
    candidate,
    revisionCount: 1,
    now: () => new Date('2000-01-01T00:00:00.000Z'),
  });
  validateEnvelopeStage('post-refinement audit', () => {
    validateBrandGenerationAuditProviderEnvelope(
      buildBrandGenerationAuditPrompt(
        frozenInput,
        preflight,
        candidate,
        revisedReport,
        relatedCandidates,
      ),
      closureLimit,
    );
  });
}

function assertCanDispatch(
  preflight: BrandGenerationPreflightResult,
  reserve: ReserveBrandProviderDispatch,
  signal?: AbortSignal,
): void {
  if (!preflight.attemptOutput.readyForPaidWork) {
    throw new BrandGenerationPaidWorkBlockedError(preflight.attemptOutput.blockingRequirementIds);
  }
  if (typeof reserve !== 'function') {
    throw new BrandGenerationOutputContractError('Every provider dispatch requires a reservation callback.');
  }
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Brand generation was cancelled.');
  }
}

function expectedUnresolvedRequirementIds(preflight: BrandGenerationPreflightResult): string[] {
  return preflight.attemptOutput.requirements
    .filter(requirement => (
      requirement.requirementStage === 'ready'
      && (requirement.status === 'missing' || requirement.status === 'conflicting')
    ))
    .map(requirement => requirement.id)
    .sort();
}

function assertUnresolvedRequirements(
  unresolvedRequirementIds: string[],
  preflight: BrandGenerationPreflightResult,
): void {
  const expected = expectedUnresolvedRequirementIds(preflight);
  const actual = [...unresolvedRequirementIds].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new BrandGenerationOutputContractError('Candidate changed the typed unresolved-requirement census.');
  }
}

function sourceIdentity(source: GenerationEvidenceSourceRef): string {
  return JSON.stringify({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceRevision: source.sourceRevision,
    fieldPath: source.fieldPath,
    capturedAt: source.capturedAt,
  });
}

function resolveClaims(
  rawClaims: BrandRawAIClaim[],
  catalog: readonly BrandGenerationEvidenceCatalogEntry[],
): BrandGeneratedClaim[] {
  const byKey = new Map(catalog.map(entry => [entry.key, entry]));
  const structural = new Set<string>(STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES);
  return rawClaims.map(claim => {
    const entries = claim.evidenceKeys.map(key => {
      const entry = byKey.get(key);
      if (!entry) throw new BrandGenerationOutputContractError('Candidate cited an unsupported evidence key.');
      return entry;
    });
    if (
      (claim.classification === 'factual' || claim.classification === 'inferred')
      && entries.some(entry => (
        !entry.supportsFactualClaims
        || entry.sourceRefs.length === 0
        || entry.sourceRefs.some(source => structural.has(source.sourceType))
      ))
    ) {
      throw new BrandGenerationOutputContractError(
        'A factual or inferred claim cited evidence that cannot support business assertions.',
      );
    }
    const uniqueSources = new Map<string, GenerationEvidenceSourceRef>();
    entries.flatMap(entry => entry.sourceRefs).forEach(source => {
      uniqueSources.set(sourceIdentity(source), source);
    });
    const sourceRefs = [...uniqueSources.values()];
    return claim.classification === 'factual' || claim.classification === 'inferred'
      ? {
          text: claim.text,
          classification: claim.classification,
          evidenceKeys: claim.evidenceKeys as [string, ...string[]],
          sourceRefs: sourceRefs as [
            GenerationFactualEvidenceSourceRef,
            ...GenerationFactualEvidenceSourceRef[],
          ],
        }
      : {
          text: claim.text,
          classification: claim.classification,
          evidenceKeys: claim.evidenceKeys,
          sourceRefs,
        };
  }) as BrandGeneratedClaim[];
}

function assertCreativeProposalBoundary(
  frozenInput: BrandGenerationFrozenTargetInput,
  claims: BrandGeneratedClaim[],
  text: string,
): void {
  const target = frozenInput.inputSnapshot.target;
  if (
    (target === 'naming' || target === 'tagline')
    && !claims.some(claim => claim.classification === 'creative_proposal')
  ) {
    throw new BrandGenerationOutputContractError('Naming and tagline outputs must be explicit creative proposals.');
  }
  if (target !== 'naming') return;
  const hasDisclaimer = /trademark/i.test(text)
    && /domain/i.test(text)
    && /legal/i.test(text)
    && /cultur/i.test(text)
    && /(?:not|never|hasn['’]t|have not)[^.!?]{0,60}(?:verified|checked|cleared|vetted)/i.test(text);
  const positiveClearance = /(?:trademark|domain|legal|cultural)[^.!?]{0,40}(?:available|cleared|verified|safe|vetted)/i.test(text)
    && !/(?:not|never|hasn['’]t|have not)[^.!?]{0,40}(?:verified|checked|cleared|vetted)/i.test(text);
  if (!hasDisclaimer || positiveClearance) {
    throw new BrandGenerationOutputContractError('Naming must remain an unverified creative proposal with no clearance claim.');
  }
}

function assertPlaceholders(
  text: string,
  preflight: BrandGenerationPreflightResult,
): void {
  const expected = preflight.attemptOutput.placeholders.map(placeholder => placeholder.token).sort();
  const actual = [...text.matchAll(/\[NEEDS CLIENT INPUT:[^\]]+\]/g)].map(match => match[0]).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new BrandGenerationOutputContractError('Candidate deleted, changed, duplicated, or invented a typed placeholder.');
  }
}

function foundationFingerprint(value: Omit<BrandGenerationFoundationCandidateAttemptOutput['foundationDraft'], 'fingerprint'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertCandidateSnapshotBounded<T extends BrandGenerationCandidateAttemptOutput>(
  candidate: T,
): T {
  const promptBytes = brandGenerationCandidatePromptBytes(candidate);
  const resolvedBytes = utf8Bytes(JSON.stringify(candidate));
  if (promptBytes > BRAND_GENERATION_LIMITS.maxCandidateSnapshotBytes) {
    throw new BrandGenerationOutputContractError(
      'Resolved candidate exceeds the bounded refine/audit projection limit.',
    );
  }
  if (resolvedBytes > BRAND_GENERATION_LIMITS.maxResolvedCandidateSnapshotBytes) {
    throw new BrandGenerationOutputContractError(
      'Resolved candidate exceeds the durable normalized snapshot limit.',
    );
  }
  return candidate;
}

function foundationCandidate(
  raw: ReturnType<typeof parseBrandFoundationAIOutput>,
  input: BrandGenerationFrozenTargetInput,
  preflight: BrandGenerationPreflightResult,
): BrandGenerationFoundationCandidateAttemptOutput {
  assertUnresolvedRequirements(raw.unresolvedRequirementIds, preflight);
  const claims = resolveClaims(raw.claims, preflight.evidenceCatalog);
  const draftWithoutFingerprint = {
    schemaVersion: 1 as const,
    summary: raw.summary,
    voiceDNA: raw.voiceDNA,
    guardrails: raw.guardrails,
    contextModifiers: raw.contextModifiers,
    evidenceRequirementIds: preflight.attemptOutput.requirements.map(requirement => requirement.id),
  };
  assertPlaceholders(JSON.stringify(draftWithoutFingerprint), preflight);
  assertCreativeProposalBoundary(input, claims, raw.summary);
  return assertCandidateSnapshotBounded({
    kind: 'foundation_candidate',
    content: null,
    foundationDraft: {
      ...draftWithoutFingerprint,
      fingerprint: foundationFingerprint(draftWithoutFingerprint),
    },
    claims,
    requirements: preflight.attemptOutput.requirements,
    placeholders: preflight.attemptOutput.placeholders,
  });
}

function deliverableCandidate(
  raw: ReturnType<typeof parseBrandDeliverableAIOutput>,
  input: BrandGenerationFrozenTargetInput,
  preflight: BrandGenerationPreflightResult,
): BrandGenerationDeliverableCandidateAttemptOutput {
  assertUnresolvedRequirements(raw.unresolvedRequirementIds, preflight);
  const claims = resolveClaims(raw.claims, preflight.evidenceCatalog);
  assertPlaceholders(raw.content, preflight);
  assertCreativeProposalBoundary(input, claims, raw.content);
  return assertCandidateSnapshotBounded({
    kind: 'deliverable_candidate',
    content: raw.content,
    foundationDraft: null,
    claims,
    requirements: preflight.attemptOutput.requirements,
    placeholders: preflight.attemptOutput.placeholders,
  });
}

function provenanceFrom(
  result: AICallResult,
  inputFingerprint: string,
  preflight: BrandGenerationPreflightResult,
): GenerationProvenance {
  const capturedAt = preflight.evidenceCatalog
    .flatMap(entry => entry.sourceRefs.map(source => source.capturedAt))
    .sort()
    .at(-1);
  return {
    runId: result.execution.runId,
    operation: result.execution.operation,
    provider: result.execution.provider,
    model: result.execution.model,
    inputFingerprint,
    ...(capturedAt ? { evidenceCapturedAt: capturedAt } : {}),
    startedAt: result.execution.startedAt,
    completedAt: result.execution.completedAt,
  };
}

function resultFrom<TOutput>(
  output: TOutput,
  aiResult: AICallResult,
  reservations: BrandProviderReservationRequest[],
  preflight: BrandGenerationPreflightResult,
): BrandGenerationAIOperationResult<TOutput> {
  const providerReservations = reservations.filter(
    reservation => reservation.provider === aiResult.execution.provider,
  );
  if (providerReservations.length === 0
    || aiResult.tokens.prompt > providerReservations.reduce((sum, value) => sum + value.inputTokens, 0)
    || aiResult.tokens.completion > providerReservations.reduce((sum, value) => sum + value.outputTokens, 0)) {
    throw new BrandGenerationOutputContractError(
      'Provider usage exceeded its pessimistic durable reservation.',
    );
  }
  const successfulReservation = providerReservations.at(-1);
  if (!successfulReservation) {
    throw new BrandGenerationOutputContractError(
      'Successful provider input has no exact durable fingerprint.',
    );
  }
  return {
    output,
    provenance: provenanceFrom(
      aiResult,
      successfulReservation.effectiveInputFingerprint,
      preflight,
    ),
    budgetUsage: {
      providerCalls: reservations.length,
      inputTokens: aiResult.tokens.prompt,
      outputTokens: aiResult.tokens.completion,
      estimatedCostMicros: reservations.reduce((sum, reservation) => (
        sum + reservation.estimatedCostMicros
      ), 0),
    },
    tokens: aiResult.tokens,
    execution: aiResult.execution,
    effectiveInputFingerprint: successfulReservation.effectiveInputFingerprint,
  };
}

async function creativeDispatch<TOutput>(
  operation: 'brand-deliverable-generate' | 'brand-deliverable-refine',
  prompt: BrandGenerationEffectivePrompt,
  input: GenerateBrandGenerationCandidateInput,
  parseOutput: (raw: string) => TOutput,
): Promise<BrandGenerationAIOperationResult<TOutput>> {
  assertCanDispatch(input.preflight, input.reserveProviderDispatch, input.signal);
  const reservations: BrandProviderReservationRequest[] = [];
  const deps = dependencies(input.dependencies);
  let aiResult = await deps.callCreativeAI({
    operation,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    maxTokens: 2_500,
    workspaceId: input.frozenInput.workspaceId,
    json: true,
    researchMode: true,
    maxRetries: 0,
    signal: input.signal,
    openAIModel: 'gpt-5.5',
    beforeProviderDispatch: async dispatch => {
      const reservation = providerReservation(
        operation,
        dispatch.provider,
        dispatch.fallback,
        renderedCreativeInput(prompt, dispatch.provider),
        CREATIVE_OUTPUT_TOKEN_CEILING,
      );
      await input.reserveProviderDispatch(reservation);
      reservations.push(reservation);
    },
  });
  if (!reservations.some(reservation => reservation.provider === aiResult.execution.provider)) {
    throw new BrandGenerationOutputContractError('Provider result was returned without a matching paid reservation.');
  }
  let output: TOutput;
  try {
    output = parseOutput(aiResult.text);
  } catch (initialOutputError) {
    // The creative wrapper already performs provider-error fallback. Only a
    // schema/contract-invalid Anthropic success gets one explicit OpenAI repair
    // dispatch; an invalid OpenAI result fails rather than looping.
    if (aiResult.execution.provider !== 'anthropic') throw initialOutputError;
    if (input.signal?.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error('Brand generation was cancelled.');
    }
    const fallbackReservation = providerReservation(
      operation,
      'openai',
      true,
      renderedStructuredInput(prompt, 'creative_repair'),
      CREATIVE_OUTPUT_TOKEN_CEILING,
    );
    await input.reserveProviderDispatch(fallbackReservation);
    reservations.push(fallbackReservation);
    // Cancellation after reservation never enters a provider. The durable
    // reservation ledger remains truthful and can reconcile the unused hold.
    if (input.signal?.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error('Brand generation was cancelled.');
    }
    aiResult = await deps.callStructuredAI({
      operation,
      provider: 'openai',
      model: 'gpt-5.5',
      messages: [{
        role: 'user',
        content: `${prompt.systemPrompt}\n\n${prompt.userPrompt}`,
      }],
      maxTokens: CREATIVE_OUTPUT_TOKEN_CEILING,
      workspaceId: input.frozenInput.workspaceId,
      responseFormat: { type: 'json_object' },
      researchMode: true,
      maxRetries: 0,
      signal: input.signal,
      executionChainId: aiResult.execution.executionChainId,
      fallbackUsed: true,
    });
    output = parseOutput(aiResult.text);
  }
  return resultFrom(output, aiResult, reservations, input.preflight);
}

export async function generateBrandGenerationCandidate(
  input: GenerateBrandGenerationCandidateInput,
): Promise<BrandGenerationAIOperationResult<BrandGenerationCandidateAttemptOutput>> {
  const prompt = resolveEffectivePrompt(
    input.effectivePrompt,
    buildBrandGenerationPrompt(input.frozenInput, input.preflight),
  );
  return creativeDispatch(
    'brand-deliverable-generate',
    prompt,
    input,
    raw => input.frozenInput.inputSnapshot.target === 'voice_foundation'
      ? foundationCandidate(parseBrandFoundationAIOutput(raw), input.frozenInput, input.preflight)
      : deliverableCandidate(parseBrandDeliverableAIOutput(raw), input.frozenInput, input.preflight),
  );
}

export async function refineBrandGenerationCandidate(
  input: RefineBrandGenerationCandidateInput,
): Promise<BrandGenerationAIOperationResult<BrandGenerationDeliverableCandidateAttemptOutput>> {
  if (input.automaticRevisionCount !== 0) {
    throw new BrandGenerationOutputContractError('The one automatic brand revision has already been used.');
  }
  const prompt = resolveEffectivePrompt(
    input.effectivePrompt,
    buildBrandGenerationRefinementPrompt(
      input.frozenInput,
      input.preflight,
      input.priorCandidate,
      input.direction,
    ),
  );
  return creativeDispatch(
    'brand-deliverable-refine',
    prompt,
    input,
    raw => deliverableCandidate(
      parseBrandDeliverableAIOutput(raw),
      input.frozenInput,
      input.preflight,
    ),
  );
}

export async function auditBrandGenerationCandidate(
  input: AuditBrandGenerationCandidateInput,
): Promise<BrandGenerationAIOperationResult<BrandGenerationAuditAttemptOutput>> {
  assertCanDispatch(input.preflight, input.reserveProviderDispatch, input.signal);
  const deterministicReport = input.deterministicReport
    ?? runBrandGenerationDeterministicAudit({
      frozenInput: input.frozenInput,
      preflight: input.preflight,
      candidate: input.candidate,
      revisionCount: input.revisionCount,
      now: input.now,
    });
  const prompt = resolveEffectivePrompt(
    input.effectivePrompt,
    buildBrandGenerationAuditPrompt(
      input.frozenInput,
      input.preflight,
      input.candidate,
      deterministicReport,
      input.relatedCandidates,
    ),
  );
  const reservation = providerReservation(
    'brand-deliverable-audit',
    'openai',
    false,
    renderedStructuredInput(prompt, 'audit'),
    AUDIT_OUTPUT_TOKEN_CEILING,
  );
  await input.reserveProviderDispatch(reservation);
  if (input.signal?.aborted) {
    throw input.signal.reason instanceof Error
      ? input.signal.reason
      : new Error('Brand generation was cancelled.');
  }
  const aiResult = await dependencies(input.dependencies).callStructuredAI({
    operation: 'brand-deliverable-audit',
    provider: 'openai',
    system: prompt.systemPrompt,
    messages: [{ role: 'user', content: prompt.userPrompt }],
    maxTokens: AUDIT_OUTPUT_TOKEN_CEILING,
    workspaceId: input.frozenInput.workspaceId,
    responseFormat: { type: 'json_object' },
    researchMode: true,
    maxRetries: 0,
    signal: input.signal,
  });
  const modelOutput = parseBrandModelAuditAIOutput(aiResult.text);
  const auditReport = mergeBrandGenerationAudit({
    frozenInput: input.frozenInput,
    deterministicReport,
    modelOutput,
    relatedCandidates: input.relatedCandidates,
  });
  return resultFrom(
    { kind: 'audit', auditReport },
    aiResult,
    [reservation],
    input.preflight,
  );
}
