import { createHash } from 'node:crypto';

import type {
  AICallOptions,
  AICallResult,
} from '../../../ai.js';
import { callAI } from '../../../ai.js';
import {
  callCreativeAIWithMetadata,
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
import type {
  GenerationAutomaticRevisionCount,
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
  buildBrandGenerationAuditPrompt,
  buildBrandGenerationPrompt,
  buildBrandGenerationRefinementPrompt,
  type BrandGenerationEffectivePrompt,
  type BrandGenerationRelatedCandidate,
} from './prompt.js';

export interface BrandProviderReservationRequest {
  operation: 'brand-deliverable-generate' | 'brand-deliverable-refine' | 'brand-deliverable-audit';
  provider: 'anthropic' | 'openai';
  fallback: boolean;
  providerCalls: 1;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
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

const CREATIVE_RESERVATION = {
  anthropic: { inputTokens: 10_000, outputTokens: 2_500, estimatedCostMicros: 1_000_000 },
  openai: { inputTokens: 10_000, outputTokens: 2_500, estimatedCostMicros: 750_000 },
} as const;

const AUDIT_RESERVATION = {
  inputTokens: 5_000,
  outputTokens: 1_500,
  estimatedCostMicros: 500_000,
} as const;

function dependencies(
  overrides?: Partial<BrandGenerationAIDependencies>,
): BrandGenerationAIDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
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
      claim.classification === 'factual'
      && entries.some(entry => (
        !entry.supportsFactualClaims
        || entry.sourceRefs.length === 0
        || entry.sourceRefs.some(source => structural.has(source.sourceType))
      ))
    ) {
      throw new BrandGenerationOutputContractError('A factual claim cited evidence that cannot prove business facts.');
    }
    const uniqueSources = new Map<string, GenerationEvidenceSourceRef>();
    entries.flatMap(entry => entry.sourceRefs).forEach(source => {
      uniqueSources.set(sourceIdentity(source), source);
    });
    const sourceRefs = [...uniqueSources.values()];
    return claim.classification === 'factual'
      ? {
          text: claim.text,
          classification: claim.classification,
          sourceRefs: sourceRefs as [
            GenerationFactualEvidenceSourceRef,
            ...GenerationFactualEvidenceSourceRef[],
          ],
        }
      : {
          text: claim.text,
          classification: claim.classification,
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
  return {
    kind: 'foundation_candidate',
    content: null,
    foundationDraft: {
      ...draftWithoutFingerprint,
      fingerprint: foundationFingerprint(draftWithoutFingerprint),
    },
    claims,
    requirements: preflight.attemptOutput.requirements,
    placeholders: preflight.attemptOutput.placeholders,
  };
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
  return {
    kind: 'deliverable_candidate',
    content: raw.content,
    foundationDraft: null,
    claims,
    requirements: preflight.attemptOutput.requirements,
    placeholders: preflight.attemptOutput.placeholders,
  };
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
  prompt: BrandGenerationEffectivePrompt,
  reservations: BrandProviderReservationRequest[],
  preflight: BrandGenerationPreflightResult,
): BrandGenerationAIOperationResult<TOutput> {
  return {
    output,
    provenance: provenanceFrom(aiResult, prompt.effectiveInputFingerprint, preflight),
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
    effectiveInputFingerprint: prompt.effectiveInputFingerprint,
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
      const envelope = CREATIVE_RESERVATION[dispatch.provider];
      const reservation: BrandProviderReservationRequest = {
        operation,
        provider: dispatch.provider,
        fallback: dispatch.fallback,
        providerCalls: 1,
        ...envelope,
      };
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
    const fallbackReservation: BrandProviderReservationRequest = {
      operation,
      provider: 'openai',
      fallback: true,
      providerCalls: 1,
      ...CREATIVE_RESERVATION.openai,
    };
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
      maxTokens: CREATIVE_RESERVATION.openai.outputTokens,
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
  return resultFrom(output, aiResult, prompt, reservations, input.preflight);
}

export async function generateBrandGenerationCandidate(
  input: GenerateBrandGenerationCandidateInput,
): Promise<BrandGenerationAIOperationResult<BrandGenerationCandidateAttemptOutput>> {
  const prompt = buildBrandGenerationPrompt(input.frozenInput, input.preflight);
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
  const prompt = buildBrandGenerationRefinementPrompt(
    input.frozenInput,
    input.preflight,
    input.priorCandidate,
    input.direction,
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
  const deterministicReport = runBrandGenerationDeterministicAudit({
    frozenInput: input.frozenInput,
    preflight: input.preflight,
    candidate: input.candidate,
    revisionCount: input.revisionCount,
    now: input.now,
  });
  const prompt = buildBrandGenerationAuditPrompt(
    input.frozenInput,
    input.preflight,
    input.candidate,
    deterministicReport,
    input.relatedCandidates,
  );
  const reservation: BrandProviderReservationRequest = {
    operation: 'brand-deliverable-audit',
    provider: 'openai',
    fallback: false,
    providerCalls: 1,
    ...AUDIT_RESERVATION,
  };
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
    maxTokens: AUDIT_RESERVATION.outputTokens,
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
    prompt,
    [reservation],
    input.preflight,
  );
}
