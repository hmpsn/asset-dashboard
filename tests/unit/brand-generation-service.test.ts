import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BrandGenerationAtomicTarget,
  BrandGenerationCommand,
  BrandGenerationItem,
  PersistedBrandGenerationRun,
  ResumeBrandGenerationRequest,
  ReviseBrandGenerationItemRequest,
} from '../../shared/types/brand-generation.js';
import { BRAND_GENERATION_ATOMIC_TARGETS } from '../../shared/types/brand-generation.js';
import type { FinalizedVoiceSnapshot } from '../../shared/types/voice-finalization.js';

const repository = vi.hoisted(() => ({
  lookupBrandGenerationStartReplay: vi.fn(),
  lookupBrandGenerationResumeReplay: vi.fn(),
  lookupBrandGenerationRevisionReplay: vi.fn(),
  acceptBrandGenerationStartCommand: vi.fn(),
  acceptBrandGenerationResumeCommand: vi.fn(),
  acceptBrandGenerationRevisionCommand: vi.fn(),
  getPersistedBrandGenerationRun: vi.fn(),
  getBrandGenerationItem: vi.fn(),
  isBrandGenerationJobRepairEligible: vi.fn(),
  removeRestartInterruptedBrandGenerationJobForRepair: vi.fn(),
  listPersistedBrandGenerationItems: vi.fn(),
  listBrandGenerationItemsPage: vi.fn(),
}));

const snapshots = vi.hoisted(() => ({
  readCurrentBrandIntakeAuthority: vi.fn(),
  prepareBrandGenerationSnapshots: vi.fn(),
  hydrateBrandGenerationSnapshot: vi.fn(),
}));

const preflight = vi.hoisted(() => ({
  runBrandGenerationPreflight: vi.fn(),
}));

vi.mock('../../server/domains/brand/generation/repository.js', () => repository);
vi.mock('../../server/domains/brand/generation/snapshots.js', () => snapshots);
vi.mock('../../server/domains/brand/generation/preflight.js', () => preflight);
vi.mock('../../server/domains/brand/generation/effects.js', () => ({
  applyBrandGenerationCommandAcceptedEffects: vi.fn(),
}));

import {
  brandGenerationPromptPreconditionReason,
  getBrandGeneration,
  resumeBrandGeneration,
  reviseBrandGenerationItem,
  startBrandGeneration,
} from '../../server/domains/brand/generation/service.js';
import { BrandGenerationPreconditionError } from '../../server/domains/brand/generation/errors.js';

const NOW = '2026-07-14T12:00:00.000Z';
const INTAKE_FINGERPRINT = 'a'.repeat(64);
const VOICE_FINGERPRINT = 'b'.repeat(64);
const MAX_BUDGET = {
  maxProviderCalls: 114,
  maxInputTokens: 5_000_000,
  maxOutputTokens: 250_000,
  maxEstimatedCostMicros: 100_000_000,
  maxConcurrency: 3,
};

function finalizedVoice(finalizedAt = '2026-07-14T11:00:00.000Z'): FinalizedVoiceSnapshot {
  return {
    id: 'voice-version-2',
    workspaceId: 'ws-1',
    voiceProfileId: 'voice-profile-1',
    voiceVersion: 2,
    profileRevision: 4,
    finalizedAt,
    fingerprint: VOICE_FINGERPRINT,
    finalizedBy: { actorType: 'operator', actorId: 'operator-voice' },
    anchorEvidenceRefs: [{
      sourceType: 'brand_intake',
      sourceId: 'intake-1',
      sourceRevision: 1,
      capturedAt: '2026-07-14T09:00:00.000Z',
      selectedBy: { actorType: 'operator', actorId: 'operator-voice' },
      selectedAt: finalizedAt,
    }],
    voiceDNA: {
      personalityTraits: ['Warm'],
      toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 },
      sentenceStyle: 'Short, clear sentences.',
      vocabularyLevel: 'Plain language.',
    },
    guardrails: {
      forbiddenWords: [],
      requiredTerminology: [],
      toneBoundaries: [],
      antiPatterns: [],
    },
    contextModifiers: [],
    anchors: [{
      selector: {
        kind: 'brand_intake_sample',
        intakeRevisionId: 'intake-1',
        intakeRevision: 1,
        sampleId: 'sample-1',
      },
      content: 'An authentic brand sample.',
      context: 'body',
      evidenceRef: {
        sourceType: 'brand_intake',
        sourceId: 'intake-1',
        sourceRevision: 1,
        capturedAt: '2026-07-14T09:00:00.000Z',
        selectedBy: { actorType: 'operator', actorId: 'operator-voice' },
        selectedAt: finalizedAt,
      },
    }],
    calibrationSelections: [],
    executionActor: { actorType: 'operator', actorId: 'operator-voice' },
    createdAt: finalizedAt,
  };
}

function frozen(target: BrandGenerationAtomicTarget) {
  return {
    workspaceId: 'ws-1',
    inputSnapshot: {
      schemaVersion: 1,
      target,
      intakeRevision: {
        intakeRevisionId: 'intake-1',
        revision: 1,
        fingerprint: INTAKE_FINGERPRINT,
      },
      voiceSnapshot: target === 'voice_foundation' ? null : {
        voiceProfileId: 'voice-profile-1',
        voiceVersion: 2,
        finalizedBy: { actorType: 'operator', actorId: 'operator-voice' },
        finalizedAt: '2026-07-14T11:00:00.000Z',
        fingerprint: VOICE_FINGERPRINT,
        anchorEvidenceRefs: [{
          sourceType: 'brand_intake',
          sourceId: 'intake-1',
          sourceRevision: 1,
          capturedAt: '2026-07-14T09:00:00.000Z',
          selectedBy: { actorType: 'operator', actorId: 'operator-voice' },
          selectedAt: '2026-07-14T11:00:00.000Z',
        }],
      },
      approvedDeliverables: [],
      evidenceRequirementIds: ['brand-intake:business.businessName'],
      artifactExpectation: target === 'voice_foundation'
        ? null
        : { kind: 'create', deliverableId: null, expectedVersion: 0 },
      capturedAt: NOW,
      fingerprint: `${target.length.toString(16).padStart(2, '0')}${'c'.repeat(62)}`,
    },
    intakeRevision: { id: 'intake-1' },
    fieldEvidence: [],
    finalizedVoice: target === 'voice_foundation' ? null : finalizedVoice(),
    approvedDeliverables: [],
  } as never;
}

function runFixture(overrides: Partial<PersistedBrandGenerationRun> = {}): PersistedBrandGenerationRun {
  return {
    id: 'run-1',
    workspaceId: 'ws-1',
    intakeRevision: {
      intakeRevisionId: 'intake-1',
      revision: 1,
      fingerprint: INTAKE_FINGERPRINT,
    },
    selection: { kind: 'preset', preset: 'full_brand_system' },
    selectedTargets: ['voice_foundation'],
    status: 'awaiting_review',
    stage: 'awaiting_voice_finalization',
    revision: 5,
    idempotencyKey: 'secret-start-key',
    selectionFingerprint: 'd'.repeat(64),
    effectiveInputFingerprint: 'e'.repeat(64),
    currentJobId: null,
    voiceReadiness: {
      state: 'provisional',
      foundationItemId: 'item-foundation',
      blockingReasons: ['Finalize voice.'],
    },
    counts: {
      selected: 1,
      queued: 0,
      running: 0,
      readyForHumanReview: 1,
      needsAttention: 0,
      blocked: 0,
      conflicts: 0,
      failed: 0,
      cancelled: 0,
      approved: 0,
      changesRequested: 0,
    },
    budget: {
      estimate: {
        providerCalls: 114,
        inputTokens: 5_000_000,
        outputTokens: 250_000,
        estimatedCostMicros: 100_000_000,
        maxConcurrency: 3,
      },
      limits: {
        providerCalls: 114,
        inputTokens: 5_000_000,
        outputTokens: 250_000,
        maxEstimatedCostMicros: 100_000_000,
        maxConcurrency: 3,
      },
      reserved: {
        providerCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicros: 0,
      },
    },
    createdBy: {
      actorType: 'mcp',
      actorId: 'secret-key-id',
      actorLabel: 'Secret key label',
    },
    mcpExecutionContext: {
      requestId: 'secret-request-id',
      toolName: 'start_brand_deliverable_generation',
      targetWorkspaceId: 'ws-1',
      caller: {
        kind: 'workspace_key',
        scope: 'ws-1',
        workspaceId: 'ws-1',
        keyId: 'secret-key-id',
        keyLabel: 'Secret key label',
      },
    },
    createdAt: '2026-07-14T09:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    completedAt: null,
    ...overrides,
  } as PersistedBrandGenerationRun;
}

function foundationItem(): BrandGenerationItem {
  return {
    id: 'item-foundation',
    runId: 'run-1',
    target: 'voice_foundation',
    status: 'ready_for_human_review',
    revision: 4,
    inputSnapshot: frozen('voice_foundation').inputSnapshot,
    content: null,
    foundationDraft: null,
    artifactExpectation: null,
    committedDeliverableId: null,
    committedDeliverableVersion: null,
    claims: [],
    requirements: [],
    placeholders: [],
    auditReport: null,
    attemptCount: 3,
    automaticRevisionCount: 0,
    effectiveInputFingerprint: 'c'.repeat(64),
    provenance: null,
    error: null,
    createdAt: '2026-07-14T09:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    completedAt: '2026-07-14T10:00:00.000Z',
  } as BrandGenerationItem;
}

function deliverableItem(): BrandGenerationItem {
  return {
    ...foundationItem(),
    id: 'item-mission',
    target: 'mission',
    status: 'changes_requested',
    inputSnapshot: frozen('mission').inputSnapshot,
    content: 'Existing generated mission',
    foundationDraft: null,
    artifactExpectation: {
      kind: 'update',
      deliverableId: 'deliverable-mission',
      expectedVersion: 2,
    },
    committedDeliverableId: 'deliverable-mission',
    committedDeliverableVersion: 2,
  } as BrandGenerationItem;
}

function accepted(kind: BrandGenerationCommand['kind'], existing: boolean) {
  const run = runFixture({ currentJobId: 'job-1' });
  const common = {
    id: 'command-1',
    runId: run.id,
    workspaceId: run.workspaceId,
    kind,
    idempotencyKey: 'command-key',
    requestFingerprint: 'f'.repeat(64),
    jobId: 'job-1',
    result: {
      runId: run.id,
      runRevision: run.revision,
      jobId: 'job-1',
      selectionCount: 1,
      estimate: {
        providerCalls: 6,
        inputTokens: 10_000,
        outputTokens: 1_000,
        estimatedCostMicros: 500_000,
        maxConcurrency: 1,
      },
      dashboardUrl: '/ws/ws-1/brand',
    },
    actor: { actorType: 'operator', actorId: 'operator-1' },
    mcpExecutionContext: null,
    createdAt: NOW,
  };
  const command = kind === 'revision'
    ? {
        ...common,
        kind,
        requestSnapshot: { schemaVersion: 1, kind, command: {} },
        itemId: 'item-1',
        expectedRunRevision: 1,
        expectedItemRevision: 1,
        expectedDeliverableVersion: 1,
        priorItemStatus: 'changes_requested',
      }
    : {
        ...common,
        kind,
        requestSnapshot: { schemaVersion: 1, kind, command: {} },
        itemId: null,
        expectedRunRevision: kind === 'resume' ? 5 : null,
        expectedItemRevision: null,
        expectedDeliverableVersion: null,
        priorItemStatus: null,
      };
  return {
    existing,
    run,
    command: command as BrandGenerationCommand,
    items: [foundationItem()],
    result: common.result,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repository.lookupBrandGenerationStartReplay.mockReturnValue(null);
  repository.lookupBrandGenerationResumeReplay.mockReturnValue(null);
  repository.lookupBrandGenerationRevisionReplay.mockReturnValue(null);
  repository.getPersistedBrandGenerationRun.mockReturnValue(runFixture());
  repository.isBrandGenerationJobRepairEligible.mockImplementation((
    run: PersistedBrandGenerationRun,
    command: BrandGenerationCommand,
    items: BrandGenerationItem[],
  ) => {
    const targets = new Set(run.selectedTargets);
    const commandItems = command.kind === 'revision'
      ? items.filter((item: BrandGenerationItem) => item.id === command.itemId)
      : items.filter((item: BrandGenerationItem) => targets.has(item.target));
    return (run.status === 'queued' || run.status === 'running')
      && run.currentJobId === command.jobId
      && commandItems.length === command.result.selectionCount
      && commandItems.length > 0
      && commandItems.every((item: BrandGenerationItem) => ( // every-ok -- non-empty exact count above
        command.kind === 'revision' ? item.status === 'revising' : item.status === 'queued'
      ));
  });
  repository.removeRestartInterruptedBrandGenerationJobForRepair.mockReturnValue(true);
  repository.listPersistedBrandGenerationItems.mockReturnValue([foundationItem()]);
  repository.listBrandGenerationItemsPage.mockReturnValue({
    items: [foundationItem()],
    nextCursor: null,
    hasMore: false,
  });
  snapshots.readCurrentBrandIntakeAuthority.mockReturnValue({
    revision: { id: 'intake-1', revision: 1, fingerprint: INTAKE_FINGERPRINT },
    fieldEvidence: [],
  });
  snapshots.prepareBrandGenerationSnapshots.mockImplementation(input => (
    input.targets.map((target: BrandGenerationAtomicTarget) => frozen(target))
  ));
  preflight.runBrandGenerationPreflight.mockReturnValue({
    attemptOutput: {
      kind: 'preflight',
      readyForPaidWork: true,
      blockingRequirementIds: [],
      requirements: [],
      placeholders: [],
      estimate: {
        providerCalls: 6,
        inputTokens: 10_000,
        outputTokens: 1_000,
        estimatedCostMicros: 500_000,
        maxConcurrency: 1,
      },
    },
    evidenceCatalog: [],
    materializedPayload: {},
  });
});

describe('brand generation service orchestration', () => {
  it('classifies precise prompt preconditions instead of collapsing them into input_too_large', () => {
    expect(brandGenerationPromptPreconditionReason('Effective brand-generation prompt exceeds the byte limit.'))
      .toBe('input_too_large');
    expect(brandGenerationPromptPreconditionReason('Frozen requirements leave no bounded candidate envelope for automatic review.'))
      .toBe('output_envelope_too_small');
    expect(brandGenerationPromptPreconditionReason('Required generation envelope cannot fit: Exact provider input exceeds the per-dispatch byte limit.'))
      .toBe('stage_closure_failed');
    expect(brandGenerationPromptPreconditionReason('Dependent prompts require exact finalized voice authority.'))
      .toBe('voice_authority_invalid');
  });
  it('replays before the flag check and repairs the missing accepted job exactly once', () => {
    const replay = accepted('start', true);
    replay.run = runFixture({
      status: 'queued',
      stage: 'preflight',
      currentJobId: 'job-1',
    });
    replay.items = [{
      ...foundationItem(),
      status: 'queued',
      revision: 0,
      attemptCount: 0,
      completedAt: null,
    }];
    repository.lookupBrandGenerationStartReplay.mockReturnValue(replay);
    const isFeatureEnabled = vi.fn(() => false);
    const getJob = vi.fn(() => undefined);
    const createJob = vi.fn(() => ({ id: 'job-1' }));
    const queueBrandGenerationJob = vi.fn();
    const applyCommandEffects = vi.fn();

    const result = startBrandGeneration({
      workspaceId: 'ws-1',
      intakeRevisionId: 'intake-stale-on-replay',
      expectedIntakeRevision: 999,
      expectedIntakeFingerprint: '0'.repeat(64),
      selection: { kind: 'preset', preset: 'full_brand_system' },
      budget: MAX_BUDGET,
      idempotencyKey: 'accepted-key',
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }, {
      isFeatureEnabled,
      getJob: getJob as never,
      createJob: createJob as never,
      queueBrandGenerationJob,
      applyCommandEffects,
    });

    expect(result).toMatchObject({ existing: true, jobId: 'job-1' });
    expect(isFeatureEnabled).not.toHaveBeenCalled();
    expect(snapshots.readCurrentBrandIntakeAuthority).not.toHaveBeenCalled();
    expect(createJob).toHaveBeenCalledWith('brand-deliverable-generation', {
      id: 'job-1',
      workspaceId: 'ws-1',
      total: 1,
      message: 'Preparing grounded brand generation...',
    });
    expect(queueBrandGenerationJob).toHaveBeenCalledWith('job-1');
    expect(applyCommandEffects).toHaveBeenCalledOnce();
    expect(applyCommandEffects).toHaveBeenCalledWith(replay.command);
  });

  it('replaces an initJobs restart-error tombstone before requeueing the accepted command', () => {
    const replay = accepted('start', true);
    replay.run = runFixture({
      status: 'queued',
      stage: 'preflight',
      currentJobId: 'job-1',
    });
    replay.items = [{
      ...foundationItem(),
      status: 'queued',
      revision: 0,
      attemptCount: 0,
      completedAt: null,
    }];
    repository.lookupBrandGenerationStartReplay.mockReturnValue(replay);
    const createJob = vi.fn(() => ({ id: 'job-1' }));
    const queueBrandGenerationJob = vi.fn();

    const result = startBrandGeneration({
      workspaceId: 'ws-1',
      intakeRevisionId: 'intake-stale-on-replay',
      expectedIntakeRevision: 999,
      expectedIntakeFingerprint: '0'.repeat(64),
      selection: { kind: 'preset', preset: 'full_brand_system' },
      budget: MAX_BUDGET,
      idempotencyKey: 'accepted-key',
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }, {
      isFeatureEnabled: vi.fn(() => false),
      getJob: vi.fn(() => ({
        id: 'job-1',
        type: 'brand-deliverable-generation',
        status: 'error',
        workspaceId: 'ws-1',
        message: 'Interrupted by server restart',
        error: 'Server restarted — job interrupted',
        createdAt: NOW,
        updatedAt: NOW,
      })) as never,
      createJob: createJob as never,
      queueBrandGenerationJob,
      applyCommandEffects: vi.fn(),
    });

    expect(result).toMatchObject({ existing: true, jobId: 'job-1' });
    expect(repository.removeRestartInterruptedBrandGenerationJobForRepair)
      .toHaveBeenCalledWith('ws-1', 'job-1');
    expect(createJob).toHaveBeenCalledOnce();
    expect(queueBrandGenerationJob).toHaveBeenCalledWith('job-1');
  });

  it('does not mistake a stale in-memory restart tombstone for a concurrent repair', () => {
    const replay = accepted('start', true);
    replay.run = runFixture({
      status: 'queued',
      stage: 'preflight',
      currentJobId: 'job-1',
    });
    replay.items = [{
      ...foundationItem(),
      status: 'queued',
      revision: 0,
      attemptCount: 0,
      completedAt: null,
    }];
    repository.lookupBrandGenerationStartReplay.mockReturnValue(replay);
    const restartTombstone = {
      id: 'job-1',
      type: 'brand-deliverable-generation',
      status: 'error',
      workspaceId: 'ws-1',
      message: 'Interrupted by server restart',
      error: 'Server restarted — job interrupted',
      createdAt: NOW,
      updatedAt: NOW,
    } as const;
    const createFailure = new Error('job insert failed');
    const queueBrandGenerationJob = vi.fn();

    expect(() => startBrandGeneration({
      workspaceId: 'ws-1',
      intakeRevisionId: 'intake-stale-on-replay',
      expectedIntakeRevision: 999,
      expectedIntakeFingerprint: '0'.repeat(64),
      selection: { kind: 'preset', preset: 'full_brand_system' },
      budget: MAX_BUDGET,
      idempotencyKey: 'accepted-key',
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }, {
      isFeatureEnabled: vi.fn(() => false),
      getJob: vi.fn(() => restartTombstone) as never,
      createJob: vi.fn(() => { throw createFailure; }) as never,
      queueBrandGenerationJob,
      applyCommandEffects: vi.fn(),
    })).toThrow(createFailure);

    expect(queueBrandGenerationJob).not.toHaveBeenCalled();
  });

  it('never recreates a missing generic job after durable work has started', () => {
    const replay = accepted('start', true);
    repository.lookupBrandGenerationStartReplay.mockReturnValue(replay);
    const createJob = vi.fn();
    const queueBrandGenerationJob = vi.fn();

    const result = startBrandGeneration({
      workspaceId: 'ws-1',
      intakeRevisionId: 'intake-stale-on-replay',
      expectedIntakeRevision: 999,
      expectedIntakeFingerprint: '0'.repeat(64),
      selection: { kind: 'preset', preset: 'full_brand_system' },
      budget: MAX_BUDGET,
      idempotencyKey: 'accepted-key',
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }, {
      isFeatureEnabled: vi.fn(() => false),
      getJob: vi.fn(() => undefined) as never,
      createJob,
      queueBrandGenerationJob,
    });

    expect(result).toMatchObject({ existing: true, jobId: 'job-1' });
    expect(createJob).not.toHaveBeenCalled();
    expect(queueBrandGenerationJob).not.toHaveBeenCalled();
  });

  it('bootstraps only the foundation while reserving the cumulative 19-target suite', () => {
    repository.acceptBrandGenerationStartCommand.mockImplementation(input => ({
      ...accepted('start', false),
      result: {
        ...accepted('start', false).result,
        estimate: input.estimate,
        selectionCount: input.items.length,
      },
    }));
    const getBrandVoiceAuthoritySummary = vi.fn(() => ({
      readiness: { state: 'missing', blockingReasons: ['No finalized voice.'] },
    }));
    const getFinalizedVoiceSnapshotForGeneration = vi.fn();

    const result = startBrandGeneration({
      workspaceId: 'ws-1',
      intakeRevisionId: 'intake-1',
      expectedIntakeRevision: 1,
      expectedIntakeFingerprint: INTAKE_FINGERPRINT,
      selection: { kind: 'preset', preset: 'full_brand_system' },
      budget: MAX_BUDGET,
      idempotencyKey: 'full-suite-start',
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }, {
      isFeatureEnabled: vi.fn(() => true),
      getJob: vi.fn(() => ({ id: 'job-1' })) as never,
      getBrandVoiceAuthoritySummary: getBrandVoiceAuthoritySummary as never,
      getFinalizedVoiceSnapshotForGeneration: getFinalizedVoiceSnapshotForGeneration as never,
      applyCommandEffects: vi.fn(),
      randomUUID: () => 'fixed',
      now: () => new Date(NOW),
    });

    expect(getBrandVoiceAuthoritySummary).toHaveBeenCalledWith('ws-1');
    expect(getFinalizedVoiceSnapshotForGeneration).not.toHaveBeenCalled();
    expect(snapshots.prepareBrandGenerationSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: ['voice_foundation'],
        finalizedVoice: null,
      }),
      expect.any(Object),
    );
    expect(repository.acceptBrandGenerationStartCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ target: 'voice_foundation' })],
        estimate: {
          providerCalls: 114,
          inputTokens: 190_000,
          outputTokens: 19_000,
          estimatedCostMicros: 9_500_000,
          maxConcurrency: 3,
        },
      }),
    );
    expect(result).toMatchObject({ selectionCount: 1, existing: false });
    expect(BRAND_GENERATION_ATOMIC_TARGETS).toHaveLength(19);
  });

  it('requires newer finalized voice and permits a needs-attention foundation to resume', () => {
    const request: ResumeBrandGenerationRequest = {
      workspaceId: 'ws-1',
      runId: 'run-1',
      expectedRunRevision: 5,
      expectedVoiceVersion: 2,
      expectedVoiceFingerprint: VOICE_FINGERPRINT,
      idempotencyKey: 'resume-key',
      resumedBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    };
    const feature = vi.fn(() => true);
    const tooEarly = finalizedVoice('2026-07-14T10:00:00.000Z');

    expect(() => resumeBrandGeneration(request, {
      isFeatureEnabled: feature,
      getFinalizedVoiceSnapshotForGeneration: vi.fn(() => tooEarly) as never,
    })).toThrow(/created after/i);
    expect(repository.acceptBrandGenerationResumeCommand).not.toHaveBeenCalled();

    repository.acceptBrandGenerationResumeCommand.mockImplementation(input => ({
      ...accepted('resume', false),
      result: {
        ...accepted('resume', false).result,
        estimate: input.estimate,
        selectionCount: input.items.length,
      },
    }));
    repository.listPersistedBrandGenerationItems.mockReturnValue([{
      ...foundationItem(),
      status: 'needs_attention',
    }]);
    const later = finalizedVoice('2026-07-14T10:00:00.001Z');
    const result = resumeBrandGeneration(request, {
      isFeatureEnabled: feature,
      getFinalizedVoiceSnapshotForGeneration: vi.fn(() => later) as never,
      getJob: vi.fn(() => ({ id: 'job-1' })) as never,
      applyCommandEffects: vi.fn(),
      now: () => new Date(NOW),
    });

    expect(snapshots.prepareBrandGenerationSnapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({
        targets: expect.not.arrayContaining(['voice_foundation']),
        finalizedVoice: later,
      }),
      expect.any(Object),
    );
    const preparedTargets = snapshots.prepareBrandGenerationSnapshots.mock.calls.at(-1)?.[0].targets;
    expect(preparedTargets).toHaveLength(18);
    expect(repository.acceptBrandGenerationResumeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ target: 'mission' })]),
        estimate: expect.objectContaining({ providerCalls: 108, maxConcurrency: 3 }),
      }),
    );
    expect(result).toMatchObject({ selectionCount: 18, existing: false });
  });

  it('rejects an oversized frozen base prompt before accepting a command or job', () => {
    preflight.runBrandGenerationPreflight.mockReturnValue({
      attemptOutput: {
        kind: 'preflight',
        readyForPaidWork: true,
        blockingRequirementIds: [],
        requirements: [],
        placeholders: [],
        estimate: {
          providerCalls: 6,
          inputTokens: 10_000,
          outputTokens: 1_000,
          estimatedCostMicros: 500_000,
          maxConcurrency: 1,
        },
      },
      evidenceCatalog: [{
        key: 'brand-intake:business.description',
        kind: 'intake_field',
        fieldPath: 'business.description',
        value: 'x'.repeat(28_000),
        supportsFactualClaims: true,
        sourceRefs: [],
      }],
      materializedPayload: {},
    });

    let thrown: unknown;
    try {
      startBrandGeneration({
        workspaceId: 'ws-1',
        intakeRevisionId: 'intake-1',
        expectedIntakeRevision: 1,
        expectedIntakeFingerprint: INTAKE_FINGERPRINT,
        selection: { kind: 'preset', preset: 'full_brand_system' },
        budget: MAX_BUDGET,
        idempotencyKey: 'oversized-start',
        createdBy: { actorType: 'operator', actorId: 'operator-1' },
        mcpExecutionContext: null,
      }, {
        isFeatureEnabled: vi.fn(() => true),
        getBrandVoiceAuthoritySummary: vi.fn(() => ({
          readiness: { state: 'missing', blockingReasons: ['No finalized voice.'] },
        })) as never,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BrandGenerationPreconditionError);
    expect(thrown).toMatchObject({ reason: 'stage_closure_failed' });
    expect(repository.acceptBrandGenerationStartCommand).not.toHaveBeenCalled();
  });

  it('rejects provider-envelope expansion before accepting otherwise bounded raw input', () => {
    preflight.runBrandGenerationPreflight.mockReturnValue({
      attemptOutput: {
        kind: 'preflight',
        readyForPaidWork: true,
        blockingRequirementIds: [],
        requirements: [],
        placeholders: [],
        estimate: {
          providerCalls: 6,
          inputTokens: 10_000,
          outputTokens: 1_000,
          estimatedCostMicros: 500_000,
          maxConcurrency: 1,
        },
      },
      evidenceCatalog: [{
        key: 'brand-intake:business.description',
        kind: 'intake_field',
        fieldPath: 'business.description',
        value: '"\\'.repeat(5_000),
        supportsFactualClaims: true,
        sourceRefs: [],
      }],
      materializedPayload: {},
    });

    let thrown: unknown;
    try {
      startBrandGeneration({
        workspaceId: 'ws-1',
        intakeRevisionId: 'intake-1',
        expectedIntakeRevision: 1,
        expectedIntakeFingerprint: INTAKE_FINGERPRINT,
        selection: { kind: 'preset', preset: 'full_brand_system' },
        budget: MAX_BUDGET,
        idempotencyKey: 'provider-envelope-expansion',
        createdBy: { actorType: 'operator', actorId: 'operator-1' },
        mcpExecutionContext: null,
      }, {
        isFeatureEnabled: vi.fn(() => true),
        getBrandVoiceAuthoritySummary: vi.fn(() => ({
          readiness: { state: 'missing', blockingReasons: ['No finalized voice.'] },
        })) as never,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BrandGenerationPreconditionError);
    expect(thrown).toMatchObject({ reason: 'stage_closure_failed' });
    expect(repository.acceptBrandGenerationStartCommand).not.toHaveBeenCalled();
  });

  it('prebuilds a revision from current human content and rejects oversized input before acceptance', () => {
    const item = deliverableItem();
    repository.getBrandGenerationItem.mockReturnValue(item);
    snapshots.hydrateBrandGenerationSnapshot.mockReturnValue(frozen('mission'));
    const request: ReviseBrandGenerationItemRequest = {
      workspaceId: 'ws-1',
      runId: 'run-1',
      itemId: item.id,
      expectedRunRevision: 5,
      expectedItemRevision: item.revision,
      deliverableId: 'deliverable-mission',
      expectedDeliverableVersion: 2,
      direction: 'Make this warmer without changing any facts.',
      idempotencyKey: 'oversized-revision',
      requestedBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    };

    let thrown: unknown;
    try {
      reviseBrandGenerationItem(request, {
        isFeatureEnabled: vi.fn(() => true),
        getFinalizedVoiceSnapshotForGeneration: vi.fn(() => finalizedVoice()) as never,
        getDeliverable: vi.fn(() => ({
          id: request.deliverableId,
          workspaceId: request.workspaceId,
          deliverableType: 'mission',
          content: 'x'.repeat(40_000),
          status: 'draft',
          version: request.expectedDeliverableVersion,
          tier: 'essentials',
          createdAt: NOW,
          updatedAt: NOW,
          versions: [],
        })),
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BrandGenerationPreconditionError);
    expect(thrown).toMatchObject({ reason: 'input_too_large' });
    expect(repository.acceptBrandGenerationRevisionCommand).not.toHaveBeenCalled();
  });

  it('redacts idempotency and MCP key identity from the public run projection', () => {
    repository.getPersistedBrandGenerationRun.mockReturnValue(runFixture());

    const result = getBrandGeneration({ workspaceId: 'ws-1', runId: 'run-1' });
    const serialized = JSON.stringify(result);

    expect(result.run.createdBy).toEqual({ actorType: 'mcp' });
    expect(serialized).not.toContain('secret-start-key');
    expect(serialized).not.toContain('secret-key-id');
    expect(serialized).not.toContain('secret-key-label');
    expect(serialized).not.toContain('secret-request-id');
    expect(result.itemPage.items).toHaveLength(1);
  });
});
