import { describe, expect, it, vi } from 'vitest';
import type {
  BrandGenerationAttempt,
  BrandGenerationCommand,
  BrandGenerationItem,
  BrandGenerationItemStatus,
  BrandGenerationRunStatus,
  PersistedBrandGenerationRun,
} from '../../shared/types/brand-generation';
import type { Job } from '../../server/jobs';
import {
  reconcileBrandGenerationRunsAfterRestart,
  type BrandGenerationRecoveryDependencies,
} from '../../server/domains/brand/generation/recovery';

const NOW = '2026-07-14T12:00:00.000Z';
const FINGERPRINT = 'a'.repeat(64);

function runFixture(
  status: Extract<BrandGenerationRunStatus, 'queued' | 'running'> = 'queued',
  target: BrandGenerationItem['target'] = 'mission',
): PersistedBrandGenerationRun {
  return {
    id: 'run-1',
    workspaceId: 'workspace-1',
    intakeRevision: {
      intakeRevisionId: 'intake-1',
      revision: 1,
      fingerprint: FINGERPRINT,
    },
    selection: { kind: 'atomic', target },
    selectedTargets: [target],
    status,
    stage: status === 'queued' ? 'preflight' : 'dependent_generation',
    revision: 1,
    idempotencyKey: 'start-key',
    selectionFingerprint: FINGERPRINT,
    effectiveInputFingerprint: FINGERPRINT,
    currentJobId: 'job-1',
    voiceReadiness: {
      state: 'missing',
      blockingReasons: ['Voice has not been finalized.'],
    },
    counts: {
      selected: 1,
      queued: status === 'queued' ? 1 : 0,
      running: status === 'running' ? 1 : 0,
      readyForHumanReview: 0,
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
        providerCalls: 6,
        inputTokens: 10_000,
        outputTokens: 2_000,
        estimatedCostMicros: 100_000,
        maxConcurrency: 1,
      },
      limits: {
        providerCalls: 6,
        inputTokens: 10_000,
        outputTokens: 2_000,
        maxEstimatedCostMicros: 100_000,
        maxConcurrency: 1,
      },
      reserved: {
        providerCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicros: 0,
      },
    },
    createdBy: { actorType: 'system', actorId: 'system' },
    mcpExecutionContext: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  } as PersistedBrandGenerationRun;
}

function itemFixture(
  status: BrandGenerationItemStatus = 'queued',
  options: {
    id?: string;
    target?: BrandGenerationItem['target'];
    attemptCount?: number;
    content?: string | null;
  } = {},
): BrandGenerationItem {
  const target = options.target ?? 'mission';
  const base = {
    id: options.id ?? 'item-1',
    runId: 'run-1',
    target,
    status,
    revision: 1,
    inputSnapshot: null,
    claims: [],
    requirements: [],
    placeholders: [],
    auditReport: null,
    attemptCount: options.attemptCount ?? 0,
    automaticRevisionCount: 0,
    effectiveInputFingerprint: FINGERPRINT,
    provenance: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: status === 'queued' ? null : NOW,
  };
  if (target === 'voice_foundation') {
    return {
      ...base,
      target,
      content: null,
      foundationDraft: null,
      artifactExpectation: null,
      committedDeliverableId: null,
      committedDeliverableVersion: null,
    } as BrandGenerationItem;
  }
  return {
    ...base,
    target,
    content: options.content ?? 'Reviewed brand copy',
    foundationDraft: null,
    artifactExpectation: {
      kind: 'update',
      deliverableId: `deliverable-${target}`,
      expectedVersion: 1,
    },
    committedDeliverableId: `deliverable-${target}`,
    committedDeliverableVersion: 1,
  } as BrandGenerationItem;
}

function commandFixture(kind: 'start' | 'revision' = 'start'): BrandGenerationCommand {
  const common = {
    id: 'command-1',
    runId: 'run-1',
    workspaceId: 'workspace-1',
    idempotencyKey: 'command-key',
    requestFingerprint: FINGERPRINT,
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
        estimatedCostMicros: 100_000,
        maxConcurrency: 1,
      },
      dashboardUrl: '/ws/workspace-1/brand',
    },
    actor: { actorType: 'system', actorId: 'system' },
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
        command: {},
      },
      itemId: 'item-1',
      expectedRunRevision: 0,
      expectedItemRevision: 1,
      expectedDeliverableVersion: 1,
      priorItemStatus: 'changes_requested',
    } as BrandGenerationCommand;
  }
  return {
    ...common,
    kind,
    requestSnapshot: {
      schemaVersion: 1,
      kind,
      command: {},
    },
    itemId: null,
    expectedRunRevision: null,
    expectedItemRevision: null,
    expectedDeliverableVersion: null,
    priorItemStatus: null,
  } as BrandGenerationCommand;
}

function attemptFixture(): BrandGenerationAttempt {
  return {
    id: 'attempt-1',
    runId: 'run-1',
    itemId: 'item-1',
    commandId: 'command-1',
    jobId: 'job-1',
    attemptNumber: 1,
    stage: 'dependent_generation',
    status: 'running',
    expectedRunRevision: 1,
    expectedItemRevision: 1,
    expectedDeliverableVersion: 1,
    effectiveInputFingerprint: FINGERPRINT,
    budgetUsage: {
      providerCalls: 1,
      inputTokens: 1_000,
      outputTokens: 500,
      estimatedCostMicros: 10_000,
    },
    output: null,
    provenance: null,
    error: null,
    startedAt: NOW,
    completedAt: null,
  } as BrandGenerationAttempt;
}

function jobFixture(status: Job['status']): Job {
  return {
    id: 'job-1',
    type: 'brand-deliverable-generation',
    status,
    progress: 0,
    workspaceId: 'workspace-1',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function recoveryHarness(options: {
  run?: PersistedBrandGenerationRun;
  items?: BrandGenerationItem[];
  command?: BrandGenerationCommand | null;
  job?: Job;
  attempts?: BrandGenerationAttempt[];
} = {}) {
  let run = options.run ?? runFixture();
  let items = options.items ?? [itemFixture()];
  const command = options.command === undefined ? commandFixture() : options.command;
  const jobs = new Map<string, Job>();
  if (options.job) jobs.set(options.job.id, options.job);
  let attempts = options.attempts ?? [];

  const listActiveRuns = vi.fn(() => (
    run.status === 'queued' || run.status === 'running' ? [run] : []
  ));
  const listItems = vi.fn(() => items);
  const listCommandsByJob = vi.fn(() => command ? [command] : []);
  const listRunningAttempts = vi.fn(() => attempts.filter(attempt => attempt.status === 'running'));
  const failAttempt = vi.fn(input => {
    const current = attempts.find(attempt => attempt.id === input.attemptId);
    if (!current) throw new Error('attempt missing');
    const failed = {
      ...current,
      status: 'failed',
      error: input.error!,
      output: null,
      provenance: null,
      completedAt: NOW,
    } as BrandGenerationAttempt;
    attempts = attempts.map(attempt => attempt.id === failed.id ? failed : attempt);
    return failed;
  });
  const transitionItem = vi.fn(input => {
    const current = items.find(item => item.id === input.itemId);
    if (!current) throw new Error('item missing');
    const next = {
      ...current,
      ...input.patch,
      status: input.nextStatus,
      revision: current.revision + 1,
      updatedAt: NOW,
    } as BrandGenerationItem;
    items = items.map(item => item.id === next.id ? next : item);
    return next;
  });
  const transitionRun = vi.fn(input => {
    run = {
      ...run,
      status: input.nextStatus,
      stage: input.nextStage,
      currentJobId: input.currentJobId === undefined ? run.currentJobId : input.currentJobId,
      voiceReadiness: input.voiceReadiness ?? run.voiceReadiness,
      completedAt: input.completedAt === undefined ? run.completedAt : input.completedAt,
      revision: run.revision + 1,
      updatedAt: NOW,
    } as PersistedBrandGenerationRun;
    return run;
  });
  const getJob = vi.fn((id: string) => jobs.get(id));
  const createJob = vi.fn((type: string, createOptions?: Parameters<BrandGenerationRecoveryDependencies['createJob']>[1]) => {
    if (!createOptions?.id) throw new Error('expected recovery job id');
    const job: Job = {
      id: createOptions.id,
      type,
      status: 'pending',
      progress: 0,
      total: createOptions.total,
      message: createOptions.message,
      workspaceId: createOptions.workspaceId,
      createdAt: NOW,
      updatedAt: NOW,
    };
    jobs.set(job.id, job);
    return job;
  });
  const queueJob = vi.fn();

  const dependencies = {
    listActiveRuns,
    listItems,
    listCommandsByJob,
    listRunningAttempts,
    failAttempt,
    transitionItem,
    transitionRun,
    getJob,
    createJob,
    queueJob,
    now: () => new Date(NOW),
  } satisfies BrandGenerationRecoveryDependencies;

  return {
    dependencies,
    state: {
      run: () => run,
      items: () => items,
      attempts: () => attempts,
      jobs,
    },
  };
}

describe('brand generation restart recovery', () => {
  it('recreates and queues the exact accepted job only when no attempt or reservation exists', () => {
    const harness = recoveryHarness();

    const first = reconcileBrandGenerationRunsAfterRestart(harness.dependencies);

    expect(first).toMatchObject({
      scannedRuns: 1,
      repairedJobs: 1,
      terminalizedRuns: 0,
      errors: 0,
    });
    expect(harness.dependencies.createJob).toHaveBeenCalledWith(
      'brand-deliverable-generation',
      expect.objectContaining({
        id: 'job-1',
        workspaceId: 'workspace-1',
        total: 1,
      }),
    );
    expect(harness.dependencies.queueJob).toHaveBeenCalledOnce();

    const second = reconcileBrandGenerationRunsAfterRestart(harness.dependencies);

    expect(second).toMatchObject({
      scannedRuns: 1,
      repairedJobs: 0,
      terminalizedRuns: 0,
      alreadyRecoveredRuns: 1,
      errors: 0,
    });
    expect(harness.dependencies.createJob).toHaveBeenCalledOnce();
    expect(harness.dependencies.queueJob).toHaveBeenCalledOnce();
  });

  it('fails interrupted attempts and active items while preserving completed candidates', () => {
    const active = itemFixture('generating', { attemptCount: 1 });
    const reviewed = itemFixture('ready_for_human_review', { id: 'item-2' });
    const run = runFixture('running');
    run.counts.selected = 2;
    const harness = recoveryHarness({
      run,
      items: [active, reviewed],
      job: jobFixture('error'),
      attempts: [attemptFixture()],
    });

    const summary = reconcileBrandGenerationRunsAfterRestart(harness.dependencies);

    expect(summary).toMatchObject({
      terminalizedRuns: 1,
      failedAttempts: 1,
      failedItems: 1,
      preservedItems: 1,
      errors: 0,
    });
    expect(harness.state.attempts()[0]).toMatchObject({
      status: 'failed',
      error: {
        code: 'brand_generation_restart_interrupted',
        retryable: false,
        stage: 'restart_recovery',
      },
    });
    expect(harness.state.items().map(item => item.status)).toEqual([
      'failed',
      'ready_for_human_review',
    ]);
    expect(harness.state.run()).toMatchObject({
      status: 'completed_with_errors',
      stage: 'awaiting_operator_review',
      currentJobId: null,
      completedAt: NOW,
    });
  });

  it('does not repair a queued run once any attempt has been recorded', () => {
    const harness = recoveryHarness({
      items: [itemFixture('queued', { attemptCount: 1 })],
      job: undefined,
    });

    const summary = reconcileBrandGenerationRunsAfterRestart(harness.dependencies);

    expect(summary).toMatchObject({ repairedJobs: 0, terminalizedRuns: 1, failedItems: 1 });
    expect(harness.dependencies.createJob).not.toHaveBeenCalled();
    expect(harness.state.run()).toMatchObject({ status: 'failed', currentJobId: null });
    expect(harness.state.items()[0].status).toBe('failed');
  });

  it('does not repair a queued run once provider budget has been reserved', () => {
    const run = runFixture('queued');
    run.budget.reserved.providerCalls = 1;
    const harness = recoveryHarness({ run });

    const summary = reconcileBrandGenerationRunsAfterRestart(harness.dependencies);

    expect(summary).toMatchObject({ repairedJobs: 0, terminalizedRuns: 1 });
    expect(harness.dependencies.createJob).not.toHaveBeenCalled();
    expect(harness.state.run()).toMatchObject({ status: 'failed', currentJobId: null });
  });

  it('restores a review-directed revision to its prior review state without replacing its artifact', () => {
    const reviewedContent = 'Operator-reviewed positioning copy';
    const harness = recoveryHarness({
      run: runFixture('running'),
      items: [itemFixture('auditing_model', {
        attemptCount: 2,
        content: reviewedContent,
      })],
      command: commandFixture('revision'),
      job: jobFixture('error'),
      attempts: [attemptFixture()],
    });

    const summary = reconcileBrandGenerationRunsAfterRestart(harness.dependencies);

    expect(summary).toMatchObject({
      terminalizedRuns: 1,
      failedAttempts: 1,
      failedItems: 0,
      restoredReviewItems: 1,
      errors: 0,
    });
    expect(harness.dependencies.transitionItem.mock.calls.map(call => call[0].nextStatus))
      .toEqual(['revising', 'changes_requested']);
    expect(harness.state.items()[0]).toMatchObject({
      status: 'changes_requested',
      content: reviewedContent,
      error: null,
    });
    expect(harness.state.run()).toMatchObject({
      status: 'completed_with_errors',
      currentJobId: null,
    });
  });

  it('preserves a completed voice foundation and pauses honestly for finalization', () => {
    const harness = recoveryHarness({
      run: runFixture('running', 'voice_foundation'),
      items: [itemFixture('ready_for_human_review', { target: 'voice_foundation' })],
      job: jobFixture('error'),
    });

    const summary = reconcileBrandGenerationRunsAfterRestart(harness.dependencies);

    expect(summary).toMatchObject({
      terminalizedRuns: 1,
      preservedItems: 1,
      failedItems: 0,
      errors: 0,
    });
    expect(harness.state.run()).toMatchObject({
      status: 'awaiting_review',
      stage: 'awaiting_voice_finalization',
      currentJobId: null,
      completedAt: null,
      voiceReadiness: {
        state: 'provisional',
        foundationItemId: 'item-1',
      },
    });
  });

  it.each([
    ['blocked_missing_evidence', 'blocked'],
    ['conflict', 'conflict'],
  ] as const)('derives %s items as an honest %s run', (itemStatus, runStatus) => {
    const harness = recoveryHarness({
      run: runFixture('running'),
      items: [itemFixture(itemStatus)],
      job: jobFixture('error'),
    });

    reconcileBrandGenerationRunsAfterRestart(harness.dependencies);

    expect(harness.state.run()).toMatchObject({
      status: runStatus,
      stage: 'awaiting_operator_review',
      currentJobId: null,
    });
  });
});
