import { randomUUID } from 'node:crypto';

import type {
  BrandGenerationAcceptedCommandResult,
  BrandGenerationAtomicTarget,
  BrandGenerationBudgetEstimate,
  BrandGenerationBudgetRequest,
  BrandGenerationCommandResult,
  BrandGenerationItemPage,
  BrandGenerationTargetInputSnapshot,
  BrandVoiceReadiness,
  GetBrandGenerationRequest,
  GetBrandGenerationResult,
  ResumeBrandGenerationRequest,
  ResumeBrandGenerationResult,
  ReviseBrandGenerationItemRequest,
  ReviseBrandGenerationItemResult,
  StartBrandGenerationRequest,
  StartBrandGenerationResult,
} from '../../../../shared/types/brand-generation.js';
import {
  BRAND_GENERATION_ATOMIC_TARGETS,
  BRAND_GENERATION_LIMITS,
  BRAND_GENERATION_PRESET_POLICY,
} from '../../../../shared/types/brand-generation.js';
import type { FinalizedVoiceSnapshot } from '../../../../shared/types/voice-finalization.js';
import { getDeliverable } from '../../../brand-deliverable-read-model.js';
import { isFeatureEnabled } from '../../../feature-flags.js';
import { createJob, getJob } from '../../../jobs.js';
import {
  getBrandVoiceAuthoritySummary,
  getFinalizedVoiceSnapshotForGeneration,
  VoiceFinalizationPreconditionError,
  VoiceGenerationAuthorityConflictError,
} from '../voice-finalization.js';
import {
  validateBrandGenerationBudgetEstimate,
  validateBrandGenerationBudgetRequest,
} from './budget.js';
import {
  applyBrandGenerationCommandAcceptedEffects,
} from './effects.js';
import {
  BrandGenerationFeatureDisabledError,
  BrandGenerationNotFoundError,
  BrandGenerationPreconditionError,
} from './errors.js';
import { canonicalBrandGenerationFingerprint } from './fingerprint.js';
import {
  validateBrandGenerationCreativeProviderEnvelopes,
  validateBrandGenerationRequiredStageEnvelopeClosure,
} from './operations.js';
import { runBrandGenerationPreflight } from './preflight.js';
import {
  BrandGenerationPromptContractError,
  buildBrandGenerationRefinementPrompt,
} from './prompt.js';
import {
  acceptBrandGenerationResumeCommand,
  acceptBrandGenerationRevisionCommand,
  acceptBrandGenerationStartCommand,
  getBrandGenerationItem,
  getPersistedBrandGenerationRun,
  isBrandGenerationJobRepairEligible,
  listBrandGenerationItemsPage,
  listPersistedBrandGenerationItems,
  lookupBrandGenerationResumeReplay,
  lookupBrandGenerationRevisionReplay,
  lookupBrandGenerationStartReplay,
  removeRestartInterruptedBrandGenerationJobForRepair,
  type BrandGenerationAcceptedPersistenceResult,
  type BrandGenerationPreparedItem,
} from './repository.js';
import {
  hydrateBrandGenerationSnapshot,
  prepareBrandGenerationSnapshots,
  readCurrentBrandIntakeAuthority,
  type BrandGenerationSnapshotDependencies,
} from './snapshots.js';
import { queueBrandGenerationJob } from './worker.js';

const JOB_TYPE = 'brand-deliverable-generation' as const;
const ZERO_DATE = new Date(0).toISOString();

interface BrandGenerationServiceDependencies {
  isFeatureEnabled: typeof isFeatureEnabled;
  createJob: typeof createJob;
  getJob: typeof getJob;
  getDeliverable: typeof getDeliverable;
  removeRestartInterruptedJob: typeof removeRestartInterruptedBrandGenerationJobForRepair;
  queueBrandGenerationJob: typeof queueBrandGenerationJob;
  getBrandVoiceAuthoritySummary: typeof getBrandVoiceAuthoritySummary;
  getFinalizedVoiceSnapshotForGeneration: typeof getFinalizedVoiceSnapshotForGeneration;
  applyCommandEffects: typeof applyBrandGenerationCommandAcceptedEffects;
  now: () => Date;
  randomUUID: () => string;
  snapshots: Partial<BrandGenerationSnapshotDependencies>;
}

const DEFAULT_DEPENDENCIES: BrandGenerationServiceDependencies = {
  isFeatureEnabled,
  createJob,
  getJob,
  getDeliverable,
  removeRestartInterruptedJob: removeRestartInterruptedBrandGenerationJobForRepair,
  queueBrandGenerationJob,
  getBrandVoiceAuthoritySummary,
  getFinalizedVoiceSnapshotForGeneration,
  applyCommandEffects: applyBrandGenerationCommandAcceptedEffects,
  now: () => new Date(),
  randomUUID,
  snapshots: {},
};

function dependencies(
  overrides?: Partial<BrandGenerationServiceDependencies>,
): BrandGenerationServiceDependencies {
  return {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
    snapshots: { ...DEFAULT_DEPENDENCIES.snapshots, ...overrides?.snapshots },
  };
}

function publicResult(
  accepted: BrandGenerationAcceptedPersistenceResult,
): BrandGenerationCommandResult {
  return { ...accepted.result, existing: accepted.existing };
}

function ensureFeatureEnabled(
  workspaceId: string,
  deps: BrandGenerationServiceDependencies,
): void {
  if (!deps.isFeatureEnabled('brand-deliverable-generation', workspaceId)) {
    throw new BrandGenerationFeatureDisabledError();
  }
}

function dashboardUrl(workspaceId: string): string {
  return `/ws/${encodeURIComponent(workspaceId)}/brand`;
}

function acceptedJobMessage(kind: 'start' | 'resume' | 'revision'): string {
  if (kind === 'resume') return 'Preparing dependent brand deliverables...';
  if (kind === 'revision') return 'Preparing the requested brand revision...';
  return 'Preparing grounded brand generation...';
}

function isRestartInterruptedJob(
  job: NonNullable<ReturnType<typeof getJob>>,
  workspaceId: string,
): boolean {
  return job.type === JOB_TYPE
    && job.workspaceId === workspaceId
    && job.status === 'error'
    && job.message === 'Interrupted by server restart'
    && job.error === 'Server restarted — job interrupted';
}

function ensureAcceptedJob(
  accepted: BrandGenerationAcceptedPersistenceResult,
  deps: BrandGenerationServiceDependencies,
): void {
  const jobId = accepted.result.jobId;
  const currentJob = deps.getJob(jobId);
  if (!accepted.existing && currentJob) return;
  if (accepted.existing
    && (!isBrandGenerationJobRepairEligible(accepted.run, accepted.command, accepted.items)
      || (currentJob !== undefined
        && !isRestartInterruptedJob(currentJob, accepted.run.workspaceId)))) {
    return;
  }
  if (currentJob
    && !deps.removeRestartInterruptedJob(accepted.run.workspaceId, jobId)) {
    return;
  }
  try {
    deps.createJob(JOB_TYPE, {
      id: jobId,
      workspaceId: accepted.run.workspaceId,
      total: accepted.result.selectionCount,
      message: acceptedJobMessage(accepted.command.kind),
    });
  } catch (err) {
    // A concurrent exact replay may have repaired the same accepted command.
    // The deleted SQLite tombstone can still exist in jobs.ts's memory cache,
    // so the exact restart marker is not evidence that createJob succeeded.
    const concurrent = deps.getJob(jobId);
    if (concurrent
      && concurrent.type === JOB_TYPE
      && concurrent.workspaceId === accepted.run.workspaceId
      && !isRestartInterruptedJob(concurrent, accepted.run.workspaceId)) {
      return;
    }
    throw err;
  }
  deps.queueBrandGenerationJob(jobId);
}

function afterAcceptedCommand(
  accepted: BrandGenerationAcceptedPersistenceResult,
  deps: BrandGenerationServiceDependencies,
): BrandGenerationCommandResult {
  // Exact replays also retry the durable outbox event; activity and MCP
  // metering are independently idempotent inside the dispatcher.
  deps.applyCommandEffects(accepted.command);
  ensureAcceptedJob(accepted, deps);
  return publicResult(accepted);
}

function startTargets(request: StartBrandGenerationRequest): readonly BrandGenerationAtomicTarget[] {
  if (request.selection.kind === 'atomic') return [request.selection.target];
  return BRAND_GENERATION_PRESET_POLICY[request.selection.preset].initialTargets;
}

function isBootstrapStart(request: StartBrandGenerationRequest): boolean {
  return request.selection.kind === 'atomic'
    ? request.selection.target === 'voice_foundation'
    : request.selection.preset === 'full_brand_system';
}

function exactVoiceRef(snapshot: FinalizedVoiceSnapshot) {
  return {
    voiceProfileId: snapshot.voiceProfileId,
    voiceVersion: snapshot.voiceVersion,
    finalizedBy: snapshot.finalizedBy,
    finalizedAt: snapshot.finalizedAt,
    fingerprint: snapshot.fingerprint,
    anchorEvidenceRefs: snapshot.anchorEvidenceRefs,
  };
}

function finalizedReadiness(
  snapshot: FinalizedVoiceSnapshot,
): Extract<BrandVoiceReadiness, { state: 'finalized' }> {
  return {
    state: 'finalized',
    snapshot: exactVoiceRef(snapshot),
    blockingReasons: [],
  };
}

function strictCurrentVoice(
  workspaceId: string,
  expectedVoiceVersion: number,
  expectedVoiceFingerprint: string,
  deps: BrandGenerationServiceDependencies,
): FinalizedVoiceSnapshot {
  try {
    return deps.getFinalizedVoiceSnapshotForGeneration({
      workspaceId,
      expectedVoiceVersion,
      expectedFingerprint: expectedVoiceFingerprint,
      requireCurrentAuthority: true,
    });
  } catch (err) {
    if (err instanceof VoiceGenerationAuthorityConflictError) {
      throw new BrandGenerationPreconditionError(
        'voice_changed',
        'The finalized brand voice changed. Re-read the current authority before retrying.',
      );
    }
    if (err instanceof VoiceFinalizationPreconditionError) {
      throw new BrandGenerationPreconditionError(
        'voice_not_finalized',
        'A current, immutable finalized brand voice is required for this generation target.',
      );
    }
    throw err;
  }
}

function throwPromptPrecondition(err: unknown): never {
  if (err instanceof BrandGenerationPromptContractError) {
    throw new BrandGenerationPreconditionError(
      'input_too_large',
      'The frozen brand input is too large for bounded generation. Reduce the intake or approved-source content before retrying.',
      { cause: err },
    );
  }
  throw err;
}

function preflightEstimate(
  inputs: ReturnType<typeof prepareBrandGenerationSnapshots>,
  budget: BrandGenerationBudgetRequest,
  estimateTargetCount = inputs.length,
): {
  estimate: BrandGenerationBudgetEstimate;
  results: ReturnType<typeof runBrandGenerationPreflight>[];
} {
  const results = inputs.map(input => runBrandGenerationPreflight(input));
  const blockers = results.flatMap(result => result.attemptOutput.blockingRequirementIds);
  if (blockers.length > 0) {
    throw new BrandGenerationPreconditionError(
      'missing_evidence',
      `Brand generation preflight is blocked by ${blockers.length} unresolved required evidence item${blockers.length === 1 ? '' : 's'}.`,
    );
  }
  const unit = results[0]?.attemptOutput.estimate;
  if (!unit) {
    throw new BrandGenerationPreconditionError(
      'invalid_selection',
      'Brand generation requires at least one target.',
    );
  }
  try {
    inputs.forEach((input, index) => { // forEach-ok -- exact index binds each frozen input to its preflight result
      validateBrandGenerationRequiredStageEnvelopeClosure(input, results[index]!);
    });
  } catch (err) {
    throwPromptPrecondition(err);
  }
  const estimate = {
    providerCalls: unit.providerCalls * estimateTargetCount,
    inputTokens: unit.inputTokens * estimateTargetCount,
    outputTokens: unit.outputTokens * estimateTargetCount,
    estimatedCostMicros: unit.estimatedCostMicros * estimateTargetCount,
    maxConcurrency: Math.min(
      estimateTargetCount,
      budget.maxConcurrency,
      BRAND_GENERATION_LIMITS.maxConcurrency,
    ),
  };
  return {
    estimate: validateBrandGenerationBudgetEstimate(
      estimate,
      validateBrandGenerationBudgetRequest(budget),
    ),
    results,
  };
}

function preparedItems(
  inputs: ReturnType<typeof prepareBrandGenerationSnapshots>,
): [BrandGenerationPreparedItem, ...BrandGenerationPreparedItem[]] {
  if (inputs.length === 0) {
    throw new BrandGenerationPreconditionError('invalid_selection', 'No brand generation targets were selected.');
  }
  return inputs.map(input => ({
    target: input.inputSnapshot.target,
    inputSnapshot: input.inputSnapshot,
  })) as [BrandGenerationPreparedItem, ...BrandGenerationPreparedItem[]];
}

function jobId(deps: BrandGenerationServiceDependencies): string {
  return `job_brand_${deps.randomUUID()}`;
}

export function startBrandGeneration(
  request: StartBrandGenerationRequest,
  overrides?: Partial<BrandGenerationServiceDependencies>,
): StartBrandGenerationResult {
  const replay = lookupBrandGenerationStartReplay(request);
  const deps = dependencies(overrides);
  if (replay) return afterAcceptedCommand(replay, deps);
  ensureFeatureEnabled(request.workspaceId, deps);

  const bootstrap = isBootstrapStart(request);
  let finalizedVoice: FinalizedVoiceSnapshot | null = null;
  let voiceReadiness: BrandVoiceReadiness = {
    state: 'missing',
    blockingReasons: ['A provisional voice foundation has not yet been generated.'],
  };
  if (bootstrap) {
    const authority = deps.getBrandVoiceAuthoritySummary(request.workspaceId);
    if (authority.readiness.state === 'finalized') {
      throw new BrandGenerationPreconditionError(
        'invalid_selection',
        'Voice bootstrap is only available before the workspace has a current finalized voice.',
      );
    }
  } else {
    if (
      !('expectedVoiceVersion' in request)
      || request.expectedVoiceVersion === undefined
      || request.expectedVoiceFingerprint === undefined
    ) {
      throw new BrandGenerationPreconditionError(
        'voice_not_finalized',
        'Durable brand generation requires an exact finalized voice version and fingerprint.',
      );
    }
    finalizedVoice = strictCurrentVoice(
      request.workspaceId,
      request.expectedVoiceVersion,
      request.expectedVoiceFingerprint,
      deps,
    );
    voiceReadiness = finalizedReadiness(finalizedVoice);
  }

  const intake = readCurrentBrandIntakeAuthority(request.workspaceId, {
    intakeRevisionId: request.intakeRevisionId,
    expectedIntakeRevision: request.expectedIntakeRevision,
    expectedIntakeFingerprint: request.expectedIntakeFingerprint,
  }, deps.snapshots);
  const targets = startTargets(request);
  const frozenInputs = prepareBrandGenerationSnapshots({
    workspaceId: request.workspaceId,
    intake,
    targets,
    finalizedVoice,
    capturedAt: deps.now().toISOString(),
  }, deps.snapshots);
  const cumulativeTargetCount = request.selection.kind === 'preset'
    && request.selection.preset === 'full_brand_system'
    ? BRAND_GENERATION_ATOMIC_TARGETS.length
    : targets.length;
  const { estimate } = preflightEstimate(frozenInputs, request.budget, cumulativeTargetCount);
  const accepted = acceptBrandGenerationStartCommand({
    request,
    items: preparedItems(frozenInputs),
    voiceReadiness,
    selectionFingerprint: canonicalBrandGenerationFingerprint({
      selection: request.selection,
      initialTargets: targets,
    }),
    effectiveInputFingerprint: canonicalBrandGenerationFingerprint(
      frozenInputs.map(input => input.inputSnapshot.fingerprint),
    ),
    jobId: jobId(deps),
    estimate,
    dashboardUrl: dashboardUrl(request.workspaceId),
  });
  return afterAcceptedCommand(accepted, deps);
}

function exactRunIntake(
  request: { workspaceId: string },
  run: NonNullable<ReturnType<typeof getPersistedBrandGenerationRun>>,
  deps: BrandGenerationServiceDependencies,
) {
  return readCurrentBrandIntakeAuthority(request.workspaceId, {
    intakeRevisionId: run.intakeRevision.intakeRevisionId,
    expectedIntakeRevision: run.intakeRevision.revision,
    expectedIntakeFingerprint: run.intakeRevision.fingerprint,
  }, deps.snapshots);
}

export function resumeBrandGeneration(
  request: ResumeBrandGenerationRequest,
  overrides?: Partial<BrandGenerationServiceDependencies>,
): ResumeBrandGenerationResult {
  const replay = lookupBrandGenerationResumeReplay(request);
  const deps = dependencies(overrides);
  if (replay) return afterAcceptedCommand(replay, deps);
  ensureFeatureEnabled(request.workspaceId, deps);
  const run = getPersistedBrandGenerationRun(request.workspaceId, request.runId);
  if (!run) throw new BrandGenerationNotFoundError('run');
  const foundation = listPersistedBrandGenerationItems(request.workspaceId, request.runId)
    .find(item => item.target === 'voice_foundation');
  if (
    run.selection.kind !== 'preset'
    || run.selection.preset !== 'full_brand_system'
    || run.status !== 'awaiting_review'
    || run.stage !== 'awaiting_voice_finalization'
    || !foundation?.completedAt
    || (foundation.status !== 'ready_for_human_review'
      && foundation.status !== 'needs_attention')
  ) {
    throw new BrandGenerationPreconditionError(
      'invalid_lifecycle',
      'Only a completed full-brand-system voice foundation awaiting human finalization may resume.',
    );
  }
  const finalizedVoice = strictCurrentVoice(
    request.workspaceId,
    request.expectedVoiceVersion,
    request.expectedVoiceFingerprint,
    deps,
  );
  if (finalizedVoice.finalizedAt <= (foundation.completedAt ?? ZERO_DATE)) {
    throw new BrandGenerationPreconditionError(
      'voice_not_finalized',
      'Resume requires a human voice finalization created after the provisional foundation completed.',
    );
  }
  const intake = exactRunIntake(request, run, deps);
  const targets = BRAND_GENERATION_PRESET_POLICY.full_brand_system.resumeTargets;
  const frozenInputs = prepareBrandGenerationSnapshots({
    workspaceId: request.workspaceId,
    intake,
    targets,
    finalizedVoice,
    capturedAt: deps.now().toISOString(),
  }, deps.snapshots);
  const { estimate } = preflightEstimate(frozenInputs, {
    maxProviderCalls: run.budget.limits.providerCalls,
    maxInputTokens: run.budget.limits.inputTokens,
    maxOutputTokens: run.budget.limits.outputTokens,
    maxEstimatedCostMicros: run.budget.limits.maxEstimatedCostMicros,
    maxConcurrency: run.budget.limits.maxConcurrency,
  });
  const accepted = acceptBrandGenerationResumeCommand({
    request,
    items: preparedItems(frozenInputs),
    voiceReadiness: finalizedReadiness(finalizedVoice),
    jobId: jobId(deps),
    estimate,
    dashboardUrl: dashboardUrl(request.workspaceId),
  });
  return afterAcceptedCommand(accepted, deps);
}

function revisionSnapshot(
  original: BrandGenerationTargetInputSnapshot,
  request: ReviseBrandGenerationItemRequest,
  capturedAt: string,
): BrandGenerationTargetInputSnapshot {
  const value: Omit<BrandGenerationTargetInputSnapshot, 'fingerprint'> = {
    ...original,
    artifactExpectation: {
      kind: 'update',
      deliverableId: request.deliverableId,
      expectedVersion: request.expectedDeliverableVersion,
    },
    capturedAt,
  };
  return { ...value, fingerprint: canonicalBrandGenerationFingerprint(value) };
}

export function reviseBrandGenerationItem(
  request: ReviseBrandGenerationItemRequest,
  overrides?: Partial<BrandGenerationServiceDependencies>,
): ReviseBrandGenerationItemResult {
  const replay = lookupBrandGenerationRevisionReplay(request);
  const deps = dependencies(overrides);
  if (replay) return afterAcceptedCommand(replay, deps);
  ensureFeatureEnabled(request.workspaceId, deps);
  const run = getPersistedBrandGenerationRun(request.workspaceId, request.runId);
  if (!run) throw new BrandGenerationNotFoundError('run');
  const item = getBrandGenerationItem(request.workspaceId, request.runId, request.itemId);
  if (!item) throw new BrandGenerationNotFoundError('item');
  if (item.target === 'voice_foundation' || !item.inputSnapshot) {
    throw new BrandGenerationPreconditionError(
      'invalid_selection',
      'Voice foundations cannot be revised through the durable deliverable revision action.',
    );
  }
  exactRunIntake(request, run, deps);
  const voice = item.inputSnapshot.voiceSnapshot;
  if (!voice) {
    throw new BrandGenerationPreconditionError(
      'voice_not_finalized',
      'A durable brand revision requires its exact finalized voice authority.',
    );
  }
  strictCurrentVoice(request.workspaceId, voice.voiceVersion, voice.fingerprint, deps);
  const inputSnapshot = revisionSnapshot(item.inputSnapshot, request, deps.now().toISOString());
  const frozenInput = hydrateBrandGenerationSnapshot(
    request.workspaceId,
    inputSnapshot,
    deps.snapshots,
  );
  const { estimate, results } = preflightEstimate([frozenInput], {
    maxProviderCalls: run.budget.limits.providerCalls,
    maxInputTokens: run.budget.limits.inputTokens,
    maxOutputTokens: run.budget.limits.outputTokens,
    maxEstimatedCostMicros: run.budget.limits.maxEstimatedCostMicros,
    maxConcurrency: run.budget.limits.maxConcurrency,
  });
  const deliverable = deps.getDeliverable(request.workspaceId, request.deliverableId);
  if (!deliverable
    || deliverable.deliverableType !== item.target
    || deliverable.version !== request.expectedDeliverableVersion) {
    throw new BrandGenerationPreconditionError(
      'invalid_lifecycle',
      'The current brand deliverable no longer matches this revision request. Re-read it before retrying.',
    );
  }
  try {
    const prompt = buildBrandGenerationRefinementPrompt(
      frozenInput,
      results[0]!,
      {
        kind: 'deliverable_candidate',
        content: deliverable.content,
        foundationDraft: null,
        claims: [],
        requirements: item.requirements,
        placeholders: [],
      },
      request.direction,
    );
    validateBrandGenerationCreativeProviderEnvelopes(prompt);
  } catch (err) {
    throwPromptPrecondition(err);
  }
  const accepted = acceptBrandGenerationRevisionCommand({
    request,
    inputSnapshot,
    jobId: jobId(deps),
    estimate,
    dashboardUrl: dashboardUrl(request.workspaceId),
  });
  return afterAcceptedCommand(accepted, deps);
}

export function getBrandGeneration(
  request: GetBrandGenerationRequest,
): GetBrandGenerationResult {
  const run = getPersistedBrandGenerationRun(request.workspaceId, request.runId);
  if (!run) throw new BrandGenerationNotFoundError('run');
  const itemPage: BrandGenerationItemPage = listBrandGenerationItemsPage(
    request.workspaceId,
    request.runId,
    { cursor: request.cursor, limit: request.limit },
  );
  const {
    idempotencyKey: _idempotencyKey,
    mcpExecutionContext: _mcpExecutionContext,
    createdBy,
    ...publicRun
  } = run;
  void _idempotencyKey;
  void _mcpExecutionContext;
  return {
    run: {
      ...publicRun,
      createdBy: createdBy.actorType === 'operator' || createdBy.actorType === 'client'
        ? {
            actorType: createdBy.actorType,
            actorId: createdBy.actorId,
            ...(createdBy.actorLabel ? { actorLabel: createdBy.actorLabel } : {}),
          }
        : { actorType: createdBy.actorType },
    },
    itemPage,
  };
}

/** Exposed for worker/recovery tests; command results remain immutable. */
export function brandGenerationAcceptedResult(
  result: BrandGenerationAcceptedCommandResult,
  existing: boolean,
): BrandGenerationCommandResult {
  return { ...result, existing };
}

export type {
  BrandGenerationServiceDependencies,
};
