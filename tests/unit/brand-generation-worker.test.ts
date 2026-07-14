import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BrandGenerationAttempt,
  BrandGenerationAtomicTarget,
  BrandGenerationCandidateAttemptOutput,
  BrandGenerationCommand,
  BrandGenerationItem,
  BrandGenerationItemStatus,
  PersistedBrandGenerationRun,
} from '../../shared/types/brand-generation.js';
import type { GenerationAuditReport } from '../../shared/types/generation-evidence.js';

const mocks = vi.hoisted(() => ({
  jobs: {
    getJob: vi.fn(),
    isJobCancelled: vi.fn(),
    registerAbort: vi.fn(),
    unregisterAbort: vi.fn(),
    updateJob: vi.fn(),
  },
  repository: {
    beginBrandGenerationAttempt: vi.fn(),
    cancelBrandGenerationAttempt: vi.fn(),
    commitBrandGenerationDeliverableCandidate: vi.fn(),
    commitBrandVoiceFoundationCandidate: vi.fn(),
    completeBrandGenerationAttempt: vi.fn(),
    failBrandGenerationAttempt: vi.fn(),
    getBrandGenerationItem: vi.fn(),
    getPersistedBrandGenerationRun: vi.fn(),
    listBrandGenerationCommandsByJob: vi.fn(),
    listPersistedBrandGenerationItems: vi.fn(),
    reserveBrandGenerationAttemptBudget: vi.fn(),
    transitionBrandGenerationItem: vi.fn(),
    transitionBrandGenerationRun: vi.fn(),
  },
  snapshots: {
    hydrateBrandGenerationSnapshot: vi.fn(),
  },
  preflight: {
    runBrandGenerationPreflight: vi.fn(),
  },
  effects: {
    applyBrandGenerationArtifactCommittedEffects: vi.fn(),
    applyBrandGenerationCompletedEffects: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../server/jobs.js', () => mocks.jobs);
vi.mock('../../server/domains/brand/generation/repository.js', () => mocks.repository);
vi.mock('../../server/domains/brand/generation/snapshots.js', () => mocks.snapshots);
vi.mock('../../server/domains/brand/generation/preflight.js', () => mocks.preflight);
vi.mock('../../server/domains/brand/generation/effects.js', () => mocks.effects);
vi.mock('../../server/logger.js', () => ({ createLogger: () => mocks.logger }));

import {
  runBrandGenerationJob,
  type BrandGenerationWorkerDependencies,
} from '../../server/domains/brand/generation/worker.js';
import {
  BrandGenerationRevisionConflictError,
} from '../../server/domains/brand/generation/errors.js';

const NOW = '2026-07-14T12:00:00.000Z';
const FINGERPRINT = 'a'.repeat(64);

function counts(items: readonly BrandGenerationItem[]) {
  const count = (statuses: BrandGenerationItemStatus[]) => (
    items.filter(item => statuses.includes(item.status)).length
  );
  return {
    selected: items.length,
    queued: count(['queued']),
    running: count(['preflighting', 'generating', 'auditing_deterministic', 'auditing_model', 'revising']),
    readyForHumanReview: count(['ready_for_human_review']),
    needsAttention: count(['needs_attention']),
    blocked: count(['blocked_missing_evidence']),
    conflicts: count(['conflict']),
    failed: count(['failed']),
    cancelled: count(['cancelled']),
    approved: count(['approved']),
    changesRequested: count(['changes_requested']),
  };
}

function itemFixture(
  target: Exclude<BrandGenerationAtomicTarget, 'voice_foundation'>,
  status: BrandGenerationItemStatus = 'queued',
  options: Partial<BrandGenerationItem> = {},
): BrandGenerationItem {
  return {
    id: `item-${target}`,
    runId: 'run-1',
    target,
    status,
    revision: 0,
    inputSnapshot: {
      schemaVersion: 1,
      target,
      intakeRevision: {
        intakeRevisionId: 'intake-1',
        revision: 1,
        fingerprint: FINGERPRINT,
      },
      voiceSnapshot: {
        voiceProfileId: 'voice-1',
        voiceVersion: 1,
        finalizedBy: { actorType: 'operator', actorId: 'operator-1' },
        finalizedAt: '2026-07-14T10:00:00.000Z',
        fingerprint: 'b'.repeat(64),
        anchorEvidenceRefs: [{
          sourceType: 'brand_intake',
          sourceId: 'intake-1',
          sourceRevision: 1,
          capturedAt: '2026-07-14T09:00:00.000Z',
          selectedBy: { actorType: 'operator', actorId: 'operator-1' },
          selectedAt: '2026-07-14T10:00:00.000Z',
        }],
      },
      approvedDeliverables: [],
      evidenceRequirementIds: [],
      artifactExpectation: {
        kind: 'create',
        deliverableId: null,
        expectedVersion: 0,
      },
      capturedAt: NOW,
      fingerprint: FINGERPRINT,
    },
    content: status === 'revising' ? `Prior ${target} candidate` : null,
    foundationDraft: null,
    artifactExpectation: {
      kind: 'create',
      deliverableId: null,
      expectedVersion: 0,
    },
    committedDeliverableId: status === 'revising' ? `deliverable-${target}` : null,
    committedDeliverableVersion: status === 'revising' ? 1 : null,
    claims: [],
    requirements: [],
    placeholders: [],
    auditReport: null,
    attemptCount: 0,
    automaticRevisionCount: 0,
    effectiveInputFingerprint: FINGERPRINT,
    provenance: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...options,
  } as BrandGenerationItem;
}

function runFixture(
  items: readonly BrandGenerationItem[],
  status: PersistedBrandGenerationRun['status'] = 'queued',
): PersistedBrandGenerationRun {
  return {
    id: 'run-1',
    workspaceId: 'ws-1',
    intakeRevision: {
      intakeRevisionId: 'intake-1',
      revision: 1,
      fingerprint: FINGERPRINT,
    },
    selection: { kind: 'preset', preset: 'identity_messaging' },
    selectedTargets: items.map(item => item.target),
    status,
    stage: status === 'queued' ? 'preflight' : 'revision',
    revision: status === 'queued' ? 0 : 1,
    idempotencyKey: 'start-key',
    selectionFingerprint: 'c'.repeat(64),
    effectiveInputFingerprint: FINGERPRINT,
    currentJobId: 'job-1',
    voiceReadiness: {
      state: 'finalized',
      snapshot: items[0]!.inputSnapshot!.voiceSnapshot!,
      blockingReasons: [],
    },
    counts: counts(items),
    budget: {
      estimate: {
        providerCalls: 114,
        inputTokens: 4_000_000,
        outputTokens: 250_000,
        estimatedCostMicros: 100_000_000,
        maxConcurrency: 3,
      },
      limits: {
        providerCalls: 114,
        inputTokens: 4_000_000,
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
    createdBy: { actorType: 'operator', actorId: 'operator-1' },
    mcpExecutionContext: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  } as PersistedBrandGenerationRun;
}

function commandFixture(
  kind: 'start' | 'revision' = 'start',
  priorItemStatus: 'ready_for_human_review' | 'changes_requested' = 'changes_requested',
): BrandGenerationCommand {
  const common = {
    id: 'command-1',
    runId: 'run-1',
    workspaceId: 'ws-1',
    idempotencyKey: 'command-key',
    requestFingerprint: 'd'.repeat(64),
    jobId: 'job-1',
    result: {
      runId: 'run-1',
      runRevision: 1,
      jobId: 'job-1',
      selectionCount: 1,
      estimate: {
        providerCalls: 6,
        inputTokens: 10_000,
        outputTokens: 2_000,
        estimatedCostMicros: 500_000,
        maxConcurrency: 1,
      },
      dashboardUrl: '/ws/ws-1/brand',
    },
    actor: { actorType: 'operator', actorId: 'operator-1' },
    mcpExecutionContext: null,
    createdAt: NOW,
  };
  if (kind === 'revision') {
    return {
      ...common,
      kind,
      requestSnapshot: {
        schemaVersion: 1,
        kind,
        command: { direction: 'Make it warmer.' },
      },
      itemId: 'item-mission',
      expectedRunRevision: 0,
      expectedItemRevision: 0,
      expectedDeliverableVersion: 1,
      priorItemStatus,
    } as BrandGenerationCommand;
  }
  return {
    ...common,
    kind,
    requestSnapshot: { schemaVersion: 1, kind, command: {} },
    itemId: null,
    expectedRunRevision: null,
    expectedItemRevision: null,
    expectedDeliverableVersion: null,
    priorItemStatus: null,
  } as BrandGenerationCommand;
}

function candidate(content: string): BrandGenerationCandidateAttemptOutput {
  return {
    kind: 'deliverable_candidate',
    content,
    foundationDraft: null,
    claims: [{ text: content, classification: 'creative_proposal', sourceRefs: [] }],
    requirements: [],
    placeholders: [],
  };
}

function auditReport(
  verdict: GenerationAuditReport['verdict'],
  revisionCount: 0 | 1,
): GenerationAuditReport {
  return {
    verdict,
    deterministicChecks: [],
    unresolvedRequirementIds: [],
    modelFindings: verdict === 'needs_attention'
      ? [{
          id: 'voice-flat',
          category: 'voice',
          severity: 'warning',
          message: 'Voice needs more specificity.',
          evidenceRequirementIds: [],
        }]
      : [],
    humanRequiredChecks: [],
    revisionCount,
    auditedAt: NOW,
  };
}

const provenance = {
  runId: 'ai-run-1',
  operation: 'brand-deliverable-generate',
  provider: 'anthropic' as const,
  model: 'claude-opus-4-6',
  inputFingerprint: FINGERPRINT,
  startedAt: NOW,
  completedAt: NOW,
};

interface HarnessOptions {
  items: BrandGenerationItem[];
  command?: BrandGenerationCommand;
  runStatus?: PersistedBrandGenerationRun['status'];
}

function installHarness(options: HarnessOptions) {
  let items = options.items;
  let run = runFixture(items, options.runStatus);
  const command = options.command ?? commandFixture();
  let job = {
    id: 'job-1',
    type: 'brand-deliverable-generation',
    status: 'pending' as const,
    progress: 0,
    total: items.length,
    workspaceId: 'ws-1',
    createdAt: NOW,
    updatedAt: NOW,
  };
  let cancelled = false;
  let attemptSequence = 0;
  let attempts: BrandGenerationAttempt[] = [];
  const controller = new AbortController();

  const updateCounts = () => {
    run = { ...run, counts: counts(items) } as PersistedBrandGenerationRun;
  };
  const replaceItem = (next: BrandGenerationItem) => {
    items = items.map(item => item.id === next.id ? next : item);
    updateCounts();
    return next;
  };

  mocks.jobs.getJob.mockImplementation(() => job);
  mocks.jobs.isJobCancelled.mockImplementation(() => cancelled);
  mocks.jobs.registerAbort.mockImplementation(() => controller);
  mocks.jobs.updateJob.mockImplementation((_id, patch) => {
    job = { ...job, ...patch, updatedAt: NOW };
    return job;
  });
  mocks.repository.listBrandGenerationCommandsByJob.mockReturnValue([command]);
  mocks.repository.getPersistedBrandGenerationRun.mockImplementation(() => run);
  mocks.repository.listPersistedBrandGenerationItems.mockImplementation(() => items);
  mocks.repository.getBrandGenerationItem.mockImplementation((_workspaceId, _runId, itemId) => (
    items.find(item => item.id === itemId) ?? null
  ));
  mocks.repository.transitionBrandGenerationRun.mockImplementation(input => {
    run = {
      ...run,
      status: input.nextStatus,
      stage: input.nextStage,
      revision: run.revision + 1,
      currentJobId: input.currentJobId === undefined ? run.currentJobId : input.currentJobId,
      voiceReadiness: input.voiceReadiness ?? run.voiceReadiness,
      completedAt: input.completedAt === undefined ? run.completedAt : input.completedAt,
      updatedAt: NOW,
    } as PersistedBrandGenerationRun;
    return run;
  });
  mocks.repository.transitionBrandGenerationItem.mockImplementation(input => {
    const current = items.find(item => item.id === input.itemId);
    if (!current) throw new Error('missing item');
    return replaceItem({
      ...current,
      ...input.patch,
      status: input.nextStatus,
      revision: current.revision + 1,
      updatedAt: NOW,
    } as BrandGenerationItem);
  });
  mocks.repository.beginBrandGenerationAttempt.mockImplementation(input => {
    const attempt = {
      id: `attempt-${++attemptSequence}`,
      runId: input.runId,
      itemId: input.itemId,
      commandId: input.commandId,
      jobId: input.jobId,
      attemptNumber: attemptSequence,
      stage: input.stage,
      status: 'running',
      expectedRunRevision: input.expectedRunRevision,
      expectedItemRevision: input.expectedItemRevision,
      expectedDeliverableVersion: input.expectedDeliverableVersion,
      effectiveInputFingerprint: input.effectiveInputFingerprint,
      budgetUsage: input.reservation,
      output: null,
      provenance: null,
      error: null,
      startedAt: NOW,
      completedAt: null,
    } as BrandGenerationAttempt;
    attempts.push(attempt);
    return attempt;
  });
  mocks.repository.completeBrandGenerationAttempt.mockImplementation(input => {
    const current = attempts.find(attempt => attempt.id === input.attemptId)!;
    const completed = {
      ...current,
      status: 'completed',
      output: input.output,
      provenance: input.provenance,
      error: null,
      completedAt: NOW,
    } as BrandGenerationAttempt;
    attempts = attempts.map(attempt => attempt.id === completed.id ? completed : attempt);
    return completed;
  });
  mocks.repository.failBrandGenerationAttempt.mockImplementation(input => {
    const current = attempts.find(attempt => attempt.id === input.attemptId)!;
    const failed = {
      ...current,
      status: 'failed',
      output: null,
      provenance: null,
      error: input.error,
      completedAt: NOW,
    } as BrandGenerationAttempt;
    attempts = attempts.map(attempt => attempt.id === failed.id ? failed : attempt);
    return failed;
  });
  mocks.repository.cancelBrandGenerationAttempt.mockImplementation(input => {
    const current = attempts.find(attempt => attempt.id === input.attemptId)!;
    const ended = {
      ...current,
      status: 'cancelled',
      output: null,
      provenance: null,
      error: input.error,
      completedAt: NOW,
    } as BrandGenerationAttempt;
    attempts = attempts.map(attempt => attempt.id === ended.id ? ended : attempt);
    return ended;
  });
  mocks.repository.commitBrandGenerationDeliverableCandidate.mockImplementation(input => {
    const current = items.find(item => item.id === input.itemId)!;
    const candidateAttempt = attempts.find(attempt => attempt.id === input.candidateAttemptId)!;
    const auditAttempt = attempts.find(attempt => attempt.id === input.finalAuditAttemptId)!;
    if (!candidateAttempt.output || candidateAttempt.output.kind !== 'deliverable_candidate') {
      throw new Error('missing final candidate');
    }
    if (!auditAttempt.output || auditAttempt.output.kind !== 'audit') {
      throw new Error('missing final audit');
    }
    const next = replaceItem({
      ...current,
      status: input.nextStatus,
      revision: current.revision + 1,
      content: candidateAttempt.output.content,
      claims: candidateAttempt.output.claims,
      requirements: candidateAttempt.output.requirements,
      placeholders: candidateAttempt.output.placeholders,
      auditReport: auditAttempt.output.auditReport,
      automaticRevisionCount: auditAttempt.output.auditReport.revisionCount,
      committedDeliverableId: `deliverable-${current.target}`,
      committedDeliverableVersion: 1,
      completedAt: NOW,
    } as BrandGenerationItem);
    return {
      kind: 'committed',
      item: next,
      deliverable: {
        id: `deliverable-${current.target}`,
        workspaceId: 'ws-1',
        deliverableType: current.target,
        content: candidateAttempt.output.content,
        status: 'draft',
        version: 1,
        tier: 'essentials',
        createdAt: NOW,
        updatedAt: NOW,
      },
    };
  });
  mocks.snapshots.hydrateBrandGenerationSnapshot.mockImplementation((_workspaceId, snapshot) => ({
    workspaceId: 'ws-1',
    inputSnapshot: snapshot,
    intakeRevision: { id: 'intake-1' },
    fieldEvidence: [],
    finalizedVoice: {
      guardrails: {
        forbiddenWords: [],
        requiredTerminology: [],
      },
    },
    approvedDeliverables: [],
  }));
  mocks.preflight.runBrandGenerationPreflight.mockReturnValue({
    attemptOutput: {
      kind: 'preflight',
      readyForPaidWork: true,
      blockingRequirementIds: [],
      requirements: [],
      placeholders: [],
      estimate: {
        providerCalls: 6,
        inputTokens: 10_000,
        outputTokens: 2_000,
        estimatedCostMicros: 500_000,
        maxConcurrency: 1,
      },
    },
    evidenceCatalog: [],
    materializedPayload: {},
  });

  return {
    setCancelled: () => { cancelled = true; },
    state: {
      items: () => items,
      run: () => run,
      job: () => job,
      attempts: () => attempts,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('brand generation worker orchestration', () => {
  it('holds the candidate barrier, audits the whole set, revises once, and commits only final checkpoints', async () => {
    const harness = installHarness({
      items: [itemFixture('mission'), itemFixture('vision')],
    });
    const events: string[] = [];
    const generateCandidate = vi.fn<BrandGenerationWorkerDependencies['generateCandidate']>(async input => {
      const target = input.frozenInput.inputSnapshot.target;
      events.push(`generate-start:${target}`);
      await input.reserveProviderDispatch({
        operation: 'brand-deliverable-generate',
        provider: 'anthropic',
        fallback: false,
        providerCalls: 1,
        inputTokens: 100,
        outputTokens: 20,
        estimatedCostMicros: 10,
      });
      await Promise.resolve();
      events.push(`generate-end:${target}`);
      return {
        output: candidate(`Initial ${target}`),
        provenance,
      } as never;
    });
    const auditCandidate = vi.fn<BrandGenerationWorkerDependencies['auditCandidate']>(async input => {
      const target = input.frozenInput.inputSnapshot.target;
      events.push(`audit:${target}:${input.revisionCount}`);
      await input.reserveProviderDispatch({
        operation: 'brand-deliverable-audit',
        provider: 'openai',
        fallback: false,
        providerCalls: 1,
        inputTokens: 50,
        outputTokens: 10,
        estimatedCostMicros: 5,
      });
      const verdict = target === 'mission' && input.revisionCount === 0
        ? 'needs_attention'
        : 'ready_for_human_review';
      return {
        output: { kind: 'audit', auditReport: auditReport(verdict, input.revisionCount) },
        provenance,
      } as never;
    });
    const refineCandidate = vi.fn<BrandGenerationWorkerDependencies['refineCandidate']>(async input => {
      events.push(`refine:${input.frozenInput.inputSnapshot.target}`);
      await input.reserveProviderDispatch({
        operation: 'brand-deliverable-refine',
        provider: 'anthropic',
        fallback: false,
        providerCalls: 1,
        inputTokens: 100,
        outputTokens: 20,
        estimatedCostMicros: 10,
      });
      return { output: candidate('Revised mission'), provenance } as never;
    });

    await runBrandGenerationJob('job-1', {
      generateCandidate,
      auditCandidate,
      refineCandidate,
    });

    const lastGenerate = Math.max(
      events.indexOf('generate-end:mission'),
      events.indexOf('generate-end:vision'),
    );
    const firstAudit = Math.min(
      events.indexOf('audit:mission:0'),
      events.indexOf('audit:vision:0'),
    );
    expect(lastGenerate).toBeLessThan(firstAudit);
    expect(auditCandidate).toHaveBeenCalledTimes(3);
    const initialAudits = auditCandidate.mock.calls
      .map(call => call[0])
      .filter(input => input.revisionCount === 0);
    expect(initialAudits).toHaveLength(2);
    expect(initialAudits.every(input => input.relatedCandidates?.length === 1)).toBe(true);
    expect(refineCandidate).toHaveBeenCalledOnce();
    expect(refineCandidate).toHaveBeenCalledWith(expect.objectContaining({
      automaticRevisionCount: 0,
      direction: expect.stringContaining('Voice needs more specificity.'),
    }));

    expect(mocks.repository.commitBrandGenerationDeliverableCandidate).toHaveBeenCalledTimes(2);
    expect(harness.state.attempts().filter(attempt => attempt.stage === 'deterministic_audit'))
      .toHaveLength(3);
    const missionCommit = mocks.repository.commitBrandGenerationDeliverableCandidate.mock.calls
      .map(call => call[0])
      .find(input => input.itemId === 'item-mission');
    const finalCandidateAttempt = harness.state.attempts()
      .find(attempt => attempt.id === missionCommit?.candidateAttemptId);
    const finalAuditAttempt = harness.state.attempts()
      .find(attempt => attempt.id === missionCommit?.finalAuditAttemptId);
    expect(finalCandidateAttempt?.output).toMatchObject({
      kind: 'deliverable_candidate',
      content: 'Revised mission',
    });
    expect(finalAuditAttempt?.output).toMatchObject({
      kind: 'audit',
      auditReport: { revisionCount: 1, verdict: 'ready_for_human_review' },
    });
    expect(harness.state.items()).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'mission', status: 'ready_for_human_review', content: 'Revised mission' }),
      expect.objectContaining({ target: 'vision', status: 'ready_for_human_review', content: 'Initial vision' }),
    ]));
    expect(harness.state.run()).toMatchObject({ status: 'completed', stage: 'complete' });
    expect(harness.state.job()).toMatchObject({
      status: 'done',
      result: {
        runId: 'run-1',
        terminalStatus: 'completed',
      },
    });
    const serializedJob = JSON.stringify(harness.state.job());
    expect(serializedJob).not.toContain('Revised mission');
    expect(serializedJob).not.toContain('Initial vision');
    expect(mocks.effects.applyBrandGenerationArtifactCommittedEffects).toHaveBeenCalledTimes(2);
    expect(mocks.effects.applyBrandGenerationCompletedEffects).toHaveBeenCalledOnce();
  });

  it('fails a required audit stage without committing a phantom artifact', async () => {
    const harness = installHarness({ items: [itemFixture('mission')] });
    const generateCandidate = vi.fn<BrandGenerationWorkerDependencies['generateCandidate']>(async () => ({
      output: candidate('Candidate that must not commit'),
      provenance,
    } as never));
    const auditCandidate = vi.fn<BrandGenerationWorkerDependencies['auditCandidate']>(async () => {
      throw new Error('model audit unavailable');
    });

    await runBrandGenerationJob('job-1', {
      generateCandidate,
      auditCandidate,
      refineCandidate: vi.fn(),
    });

    expect(mocks.repository.commitBrandGenerationDeliverableCandidate).not.toHaveBeenCalled();
    expect(mocks.effects.applyBrandGenerationArtifactCommittedEffects).not.toHaveBeenCalled();
    expect(harness.state.items()[0]).toMatchObject({
      status: 'failed',
      content: null,
      committedDeliverableId: null,
      committedDeliverableVersion: null,
      error: {
        code: 'brand_generation_stage_failed',
        stage: 'model_audit',
      },
    });
    expect(harness.state.run()).toMatchObject({ status: 'failed', stage: 'complete' });
    expect(harness.state.job()).toMatchObject({
      status: 'error',
      result: {
        runId: 'run-1',
        terminalStatus: 'failed',
      },
    });
    expect(JSON.stringify(harness.state.job())).not.toContain('Candidate that must not commit');
  });

  it('preserves a late human edit as a conflict instead of overwriting the artifact', async () => {
    const harness = installHarness({ items: [itemFixture('mission')] });
    mocks.repository.commitBrandGenerationDeliverableCandidate.mockImplementationOnce(() => {
      throw new BrandGenerationRevisionConflictError('deliverable', 0, 1);
    });

    await runBrandGenerationJob('job-1', {
      generateCandidate: vi.fn(async () => ({
        output: candidate('Stale generated mission'),
        provenance,
      } as never)),
      auditCandidate: vi.fn(async () => ({
        output: {
          kind: 'audit',
          auditReport: auditReport('ready_for_human_review', 0),
        },
        provenance,
      } as never)),
      refineCandidate: vi.fn(),
    });

    expect(harness.state.items()[0]).toMatchObject({
      status: 'conflict',
      content: null,
      committedDeliverableId: null,
      committedDeliverableVersion: null,
      error: {
        code: 'brand_generation_artifact_conflict',
        stage: 'artifact_commit',
      },
    });
    expect(harness.state.run()).toMatchObject({
      status: 'conflict',
      stage: 'awaiting_operator_review',
    });
    expect(harness.state.job()).toMatchObject({
      status: 'error',
      result: {
        runId: 'run-1',
        terminalStatus: 'conflict',
      },
    });
    expect(mocks.effects.applyBrandGenerationArtifactCommittedEffects).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.state.job())).not.toContain('Stale generated mission');
  });

  it('restores the prior human review state when a requested revision is cancelled', async () => {
    const revisionItem = itemFixture('mission', 'revising', {
      revision: 1,
      inputSnapshot: {
        ...itemFixture('mission').inputSnapshot!,
        artifactExpectation: {
          kind: 'update',
          deliverableId: 'deliverable-mission',
          expectedVersion: 1,
        },
      },
      artifactExpectation: {
        kind: 'update',
        deliverableId: 'deliverable-mission',
        expectedVersion: 1,
      },
      content: 'Human-reviewed mission',
      committedDeliverableId: 'deliverable-mission',
      committedDeliverableVersion: 1,
    });
    const harness = installHarness({
      items: [revisionItem],
      command: commandFixture('revision', 'changes_requested'),
      runStatus: 'running',
    });
    const refineCandidate = vi.fn<BrandGenerationWorkerDependencies['refineCandidate']>(async () => {
      harness.setCancelled();
      throw new Error('cancelled by operator');
    });

    await runBrandGenerationJob('job-1', {
      generateCandidate: vi.fn(),
      auditCandidate: vi.fn(),
      refineCandidate,
    });

    expect(refineCandidate).toHaveBeenCalledOnce();
    expect(harness.state.items()[0]).toMatchObject({
      status: 'changes_requested',
      content: 'Human-reviewed mission',
      committedDeliverableId: 'deliverable-mission',
      committedDeliverableVersion: 1,
      error: null,
    });
    expect(harness.state.attempts()).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'revision', status: 'cancelled' }),
    ]));
    expect(mocks.repository.commitBrandGenerationDeliverableCandidate).not.toHaveBeenCalled();
    expect(mocks.effects.applyBrandGenerationArtifactCommittedEffects).not.toHaveBeenCalled();
  });
});
