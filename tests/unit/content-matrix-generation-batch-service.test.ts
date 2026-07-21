import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MatrixGenerationPreviewTarget,
  PreviewMatrixGenerationResult,
  StartMatrixGenerationRequest,
} from '../../shared/types/matrix-generation.js';
import {
  MATRIX_GENERATION_SOURCE_LIMITS,
  matrixGenerationSerializedBytes,
} from '../../shared/types/matrix-generation.js';

const mocks = vi.hoisted(() => ({
  previewMatrixGeneration: vi.fn(),
  queueMatrixGenerationJob: vi.fn(),
}));

vi.mock('../../server/domains/content/matrix-generation/preview.js', () => ({
  previewMatrixGeneration: mocks.previewMatrixGeneration,
}));

vi.mock('../../server/domains/content/matrix-generation/worker.js', () => ({
  queueMatrixGenerationJob: mocks.queueMatrixGenerationJob,
}));

import {
  retryMatrixGeneration,
  getMatrixGeneration,
  startMatrixGeneration,
} from '../../server/domains/content/matrix-generation/batch-service.js';
import {
  computeBlockManifestFingerprint,
  computeStructuralTargetFingerprint,
} from '../../server/domains/content/matrix-generation/fingerprint.js';
import {
  getPersistedMatrixGenerationRun,
  createMatrixGenerationRun,
  listMatrixGenerationItems,
  MatrixGenerationBudgetExceededError,
  reserveMatrixGenerationBudget,
  saveMatrixGenerationSetAuditReport,
  transitionMatrixGenerationItem,
  transitionMatrixGenerationRun,
} from '../../server/domains/content/matrix-generation/repository.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import {
  ActiveJobResourceConflict,
  cancelJob,
  finalizeJobResourceClaims,
} from '../../server/jobs.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const cleanupWorkspaceIds = new Set<string>();
const cleanupJobIds = new Set<string>();

function previewTarget(workspaceId: string): MatrixGenerationPreviewTarget {
  const target: MatrixGenerationPreviewTarget = {
    workspaceId,
    matrixId: 'matrix-1',
    templateId: 'template-1',
    cellId: 'cell-1',
    sourceRevision: { matrixRevision: 2, templateRevision: 3, cellRevision: 4 },
    variableValues: { service: 'SEO consulting', city: 'Austin' },
    slugSubstitutions: { service: 'seo-consulting', city: 'austin' },
    proseSubstitutions: { service: 'SEO consulting', city: 'Austin' },
    targetKeyword: { value: 'SEO consulting Austin', source: 'target', evidenceRefs: [] },
    plannedUrl: '/austin/seo-consulting',
    title: 'SEO Consulting in Austin',
    metaDescription: 'Grounded SEO consulting for Austin organizations.',
    renderedHeadings: ['SEO Consulting in Austin'],
    pageType: 'service',
    schemaTypes: ['Service'],
    blockManifest: {
      generationContractVersion: 1,
      blocks: [
        {
          id: 'system:introduction', source: 'system', generationRole: 'introduction', order: 0,
          heading: { level: null, renderedText: null, locked: true }, guidance: '',
          wordCountTarget: 80, aeoContract: { modes: [], required: false },
          ctaContract: { role: 'none', required: false },
        },
        {
          id: 'template:body', source: 'template', sourceSectionId: 'body',
          generationRole: 'body', order: 1,
          heading: { level: 2, renderedText: 'SEO Consulting in Austin', locked: true },
          guidance: 'Use only verified service evidence.', wordCountTarget: 220,
          aeoContract: { modes: [], required: false },
          ctaContract: { role: 'none', required: false },
        },
        {
          id: 'system:conclusion', source: 'system', generationRole: 'conclusion', order: 2,
          heading: { level: 2, renderedText: 'Next Steps', locked: true }, guidance: '',
          wordCountTarget: 80, aeoContract: { modes: [], required: false },
          ctaContract: { role: 'primary', required: true },
        },
      ],
      totalWordCountTarget: 220,
      fingerprint: '',
    },
    generationContractVersion: 1,
    structuralRequirements: [],
    structuralBlockingRequirementIds: [],
    structuralFingerprint: '',
    outputQualityV2: true,
    voiceSnapshot: {
      voiceProfileId: 'voice-1',
      voiceVersion: 1,
      finalizedBy: { actorType: 'operator', actorId: 'operator-1' },
      finalizedAt: '2026-07-20T12:00:00.000Z',
      fingerprint: 'd'.repeat(64),
      anchorEvidenceRefs: [{
        sourceType: 'client_submission',
        sourceId: 'voice-anchor-1',
        capturedAt: '2026-07-20T11:00:00.000Z',
        selectedBy: { actorType: 'operator', actorId: 'operator-1' },
        selectedAt: '2026-07-20T12:00:00.000Z',
      }],
    },
    identitySnapshot: [],
    evidenceRequirements: [],
    evidenceCapturedAt: '2026-07-20T12:00:00.000Z',
    evidenceFreshThrough: '2026-07-20T12:00:00.000Z',
    expectedArtifactRevisions: {
      brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
      post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
    },
    effectiveInputFingerprint: 'b'.repeat(64),
    blockingRequirementIds: [],
    frozenEvidenceResolutionIds: [],
    estimatedPaidBudget: {
      providerCalls: 10,
      inputTokens: 1_000,
      outputTokens: 500,
      estimatedUsd: 0.02,
      maxConcurrency: 1,
    },
  };
  target.blockManifest.fingerprint = computeBlockManifestFingerprint(target.blockManifest);
  target.structuralFingerprint = computeStructuralTargetFingerprint(target);
  return target;
}

function request(workspaceId: string): StartMatrixGenerationRequest {
  return {
    workspaceId,
    matrixId: 'matrix-1',
    selections: [{
      cellId: 'cell-1',
      expectedSourceRevision: { matrixRevision: 2, templateRevision: 3, cellRevision: 4 },
      expectedPreviewFingerprint: 'b'.repeat(64),
    }],
    acceptedBudget: {
      maxProviderCalls: 15,
      maxInputTokens: 31_000,
      maxOutputTokens: 27_500,
      maxEstimatedUsd: 0.98,
      maxConcurrency: 1,
    },
    idempotencyKey: `batch-${randomUUID()}`,
    createdBy: { actorType: 'operator', actorId: 'operator-1' },
    mcpExecutionContext: null,
  };
}

beforeEach(() => {
  mocks.previewMatrixGeneration.mockReset();
  mocks.queueMatrixGenerationJob.mockReset();
});

afterEach(() => {
  for (const jobId of cleanupJobIds) cancelJob(jobId);
  for (const workspaceId of cleanupWorkspaceIds) {
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, null);
    setWorkspaceFlagOverride('content-matrix-output-quality-v2', workspaceId, null);
    deleteWorkspace(workspaceId);
  }
  cleanupJobIds.clear();
  cleanupWorkspaceIds.clear();
});

describe('content matrix batch start', () => {
  it.each([
    {
      status: 'upgrade_required' as const,
      result: {
        status: 'upgrade_required' as const,
        matrixId: 'matrix-1',
        templateId: 'template-1',
        cellId: 'cell-1',
        sourceRevision: { matrixRevision: 2, templateRevision: 3, cellRevision: 4 },
        proposal: {
          templateId: 'template-1',
          expectedTemplateRevision: 3,
          proposalFingerprint: 'c'.repeat(64),
          generationContractVersion: 1,
          blocks: [],
          blockers: [],
        },
      },
      reason: 'template_upgrade_required',
    },
    {
      status: 'blocked' as const,
      result: {
        status: 'blocked' as const,
        matrixId: 'matrix-1',
        templateId: 'template-1',
        cellId: 'cell-1',
        sourceRevision: { matrixRevision: 2, templateRevision: 3, cellRevision: 4 },
        omittedOptionalSections: [],
        evidenceRequirements: [],
        blockingRequirementIds: ['requirement-1'],
        expectedArtifactRevisions: {
          brief: { artifactType: 'content_brief' as const, artifactId: null, generationRevision: 0 },
          post: { artifactType: 'generated_post' as const, artifactId: null, generationRevision: 0 },
        },
      },
      reason: 'generation_preconditions_unresolved',
    },
  ])('reports $status start preconditions truthfully without retrying', async ({ result, reason }) => {
    const workspaceId = createWorkspace(`Matrix blocked start ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, true);
    mocks.previewMatrixGeneration.mockResolvedValue({
      results: [result],
      estimatedBatchBudget: null,
    } as PreviewMatrixGenerationResult);

    await expect(startMatrixGeneration(request(workspaceId))).rejects.toMatchObject({
      details: { reason, retryable: false, fieldPath: 'selections.0' },
    });
    expect(mocks.queueMatrixGenerationJob).not.toHaveBeenCalled();
  });

  it('accepts the exact preview budget atomically and replays without another job', async () => {
    const workspaceId = createWorkspace(`Matrix batch ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, true);
    const target = previewTarget(workspaceId);
    mocks.previewMatrixGeneration.mockResolvedValue({
      results: [{
        status: 'ready',
        matrixId: target.matrixId,
        templateId: target.templateId,
        cellId: target.cellId,
        sourceRevision: target.sourceRevision,
        target,
      }],
      estimatedBatchBudget: {
        providerCalls: 15,
        inputTokens: 31_000,
        outputTokens: 27_500,
        estimatedUsd: 0.98,
        maxConcurrency: 1,
      },
    } satisfies PreviewMatrixGenerationResult);
    const startRequest = request(workspaceId);

    const started = await startMatrixGeneration(startRequest);
    cleanupJobIds.add(started.jobId);
    expect(started).toMatchObject({
      existing: false,
      estimatedBudget: { estimatedUsd: 0.98, maxConcurrency: 1 },
      run: { acceptedBudget: { limits: startRequest.acceptedBudget } },
    });
    expect(mocks.queueMatrixGenerationJob).toHaveBeenCalledOnce();

    const replay = await startMatrixGeneration(startRequest);
    expect(replay).toMatchObject({ existing: true, jobId: started.jobId });
    expect(mocks.previewMatrixGeneration).toHaveBeenCalledOnce();
    expect(mocks.queueMatrixGenerationJob).toHaveBeenCalledOnce();
  });

  it('collapses concurrent exact starts to one durable job', async () => {
    const workspaceId = createWorkspace(`Matrix concurrent replay ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, true);
    const target = previewTarget(workspaceId);
    mocks.previewMatrixGeneration.mockResolvedValue({
      results: [{
        status: 'ready',
        matrixId: target.matrixId,
        templateId: target.templateId,
        cellId: target.cellId,
        sourceRevision: target.sourceRevision,
        target,
      }],
      estimatedBatchBudget: {
        providerCalls: 15,
        inputTokens: 31_000,
        outputTokens: 27_500,
        estimatedUsd: 0.98,
        maxConcurrency: 1,
      },
    } satisfies PreviewMatrixGenerationResult);
    const startRequest = request(workspaceId);

    const [first, second] = await Promise.all([
      startMatrixGeneration(startRequest),
      startMatrixGeneration(startRequest),
    ]);
    cleanupJobIds.add(first.jobId);

    expect(first.jobId).toBe(second.jobId);
    expect([first.existing, second.existing].sort()).toEqual([false, true]);
    expect(mocks.previewMatrixGeneration).toHaveBeenCalledTimes(2);
    expect(mocks.queueMatrixGenerationJob).toHaveBeenCalledOnce();
  });

  it('returns a resource conflict for concurrent different commands targeting the same cell', async () => {
    const workspaceId = createWorkspace(`Matrix concurrent conflict ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, true);
    const target = previewTarget(workspaceId);
    mocks.previewMatrixGeneration.mockResolvedValue({
      results: [{
        status: 'ready',
        matrixId: target.matrixId,
        templateId: target.templateId,
        cellId: target.cellId,
        sourceRevision: target.sourceRevision,
        target,
      }],
      estimatedBatchBudget: {
        providerCalls: 15,
        inputTokens: 31_000,
        outputTokens: 27_500,
        estimatedUsd: 0.98,
        maxConcurrency: 1,
      },
    } satisfies PreviewMatrixGenerationResult);
    const firstRequest = request(workspaceId);
    const secondRequest = { ...firstRequest, idempotencyKey: `batch-${randomUUID()}` };

    const outcomes = await Promise.allSettled([
      startMatrixGeneration(firstRequest),
      startMatrixGeneration(secondRequest),
    ]);
    const accepted = outcomes.find(outcome => outcome.status === 'fulfilled');
    const rejected = outcomes.find(outcome => outcome.status === 'rejected');
    expect(accepted?.status).toBe('fulfilled');
    expect(rejected?.status === 'rejected' ? rejected.reason : null)
      .toBeInstanceOf(ActiveJobResourceConflict);
    if (accepted?.status === 'fulfilled') cleanupJobIds.add(accepted.value.jobId);
    expect(mocks.queueMatrixGenerationJob).toHaveBeenCalledOnce();
  });

  it('keeps reserved provider capacity consumed across an explicit failed-item retry', async () => {
    const workspaceId = createWorkspace(`Matrix durable budget ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, true);
    const target = previewTarget(workspaceId);
    mocks.previewMatrixGeneration.mockResolvedValue({
      results: [{
        status: 'ready',
        matrixId: target.matrixId,
        templateId: target.templateId,
        cellId: target.cellId,
        sourceRevision: target.sourceRevision,
        target,
      }],
      estimatedBatchBudget: {
        providerCalls: 15,
        inputTokens: 31_000,
        outputTokens: 27_500,
        estimatedUsd: 0.98,
        maxConcurrency: 1,
      },
    } satisfies PreviewMatrixGenerationResult);
    const started = await startMatrixGeneration(request(workspaceId));
    cleanupJobIds.add(started.jobId);
    expect(listMatrixGenerationItems(workspaceId, started.run.id)[0].previewTarget)
      .toMatchObject({ outputQualityV2: true });

    reserveMatrixGenerationBudget({
      workspaceId,
      runId: started.run.id,
      reservation: {
        providerCalls: 14,
        inputTokens: 1_000,
        outputTokens: 1_000,
        estimatedUsd: 0.1,
      },
    });
    let run = getPersistedMatrixGenerationRun(workspaceId, started.run.id)!;
    run = saveMatrixGenerationSetAuditReport({
      workspaceId,
      runId: run.id,
      expectedRunRevision: run.revision,
      report: {
        verdict: 'passed',
        findings: [],
        passCount: 1,
        modelProvenance: null,
        auditedAt: new Date().toISOString(),
      },
    });
    cancelJob(started.jobId);
    finalizeJobResourceClaims(started.jobId);
    let item = listMatrixGenerationItems(workspaceId, started.run.id)[0];
    item = transitionMatrixGenerationItem({
      workspaceId,
      itemId: item.id,
      expectedRevision: item.revision,
      nextStatus: 'failed',
    });
    run = getPersistedMatrixGenerationRun(workspaceId, started.run.id)!;
    run = transitionMatrixGenerationRun({
      workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      nextStatus: 'failed',
    });
    const retried = retryMatrixGeneration({
      workspaceId,
      runId: run.id,
      expectedRunRevision: run.revision,
      items: [{
        itemId: item.id,
        expectedItemRevision: item.revision,
        sourceRevision: item.sourceRevision,
        expectedArtifactRevisions: {
          brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
          post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
        },
        reusableCheckpointFingerprint: null,
      }],
      idempotencyKey: `retry-${randomUUID()}`,
      mode: 'resume',
      requestedBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    });
    cleanupJobIds.add(retried.jobId);
    expect(retried.run.setAuditReport).toBeNull();
    expect(listMatrixGenerationItems(workspaceId, retried.run.id)[0].previewTarget)
      .toMatchObject({ outputQualityV2: true });

    expect(() => reserveMatrixGenerationBudget({
      workspaceId,
      runId: run.id,
      reservation: {
        providerCalls: 2,
        inputTokens: 1,
        outputTokens: 1,
        estimatedUsd: 0.01,
      },
    })).toThrow(MatrixGenerationBudgetExceededError);
    expect(getPersistedMatrixGenerationRun(workspaceId, run.id)?.acceptedBudget?.reserved)
      .toMatchObject({ providerCalls: 14, inputTokens: 1_000, outputTokens: 1_000 });
  });

  it('derives live counts and byte-pages durable item outcomes', () => {
    const workspaceId = createWorkspace(`Matrix bounded read ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    const run = createMatrixGenerationRun({
      workspaceId,
      matrixId: 'matrix-bounded-read',
      templateId: 'template-bounded-read',
      idempotencyKey: `read-${randomUUID()}`,
      selectionFingerprint: '1'.repeat(64),
      selections: [
        {
          matrixId: 'matrix-bounded-read',
          cellId: 'cell-read-1',
          sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
          structuralFingerprint: '2'.repeat(64),
          previewFingerprint: '3'.repeat(64),
        },
        {
          matrixId: 'matrix-bounded-read',
          cellId: 'cell-read-2',
          sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
          structuralFingerprint: '4'.repeat(64),
          previewFingerprint: '5'.repeat(64),
        },
      ],
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }).run;
    const [first, second] = listMatrixGenerationItems(workspaceId, run.id);
    transitionMatrixGenerationItem({
      workspaceId,
      itemId: first.id,
      expectedRevision: first.revision,
      nextStatus: 'failed',
      error: {
        code: 'large_failure',
        message: 'x'.repeat(400 * 1_024),
        retryable: true,
      },
    });

    expect(getMatrixGeneration({ workspaceId, runId: run.id, limit: 2 }).run.counts)
      .toMatchObject({ queued: 1, failed: 1 });

    transitionMatrixGenerationItem({
      workspaceId,
      itemId: second.id,
      expectedRevision: second.revision,
      nextStatus: 'failed',
      error: {
        code: 'large_failure',
        message: 'y'.repeat(400 * 1_024),
        retryable: true,
      },
    });
    const firstPage = getMatrixGeneration({ workspaceId, runId: run.id, limit: 2 });
    expect(firstPage.items.items).toHaveLength(1);
    expect(firstPage.items.nextCursor).toBeTruthy();
    expect(matrixGenerationSerializedBytes(firstPage))
      .toBeLessThanOrEqual(MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes);
    const secondPage = getMatrixGeneration({
      workspaceId,
      runId: run.id,
      limit: 2,
      cursor: firstPage.items.nextCursor!,
    });
    expect(secondPage.items.items).toHaveLength(1);
    expect(secondPage.items.nextCursor).toBeNull();
    expect(matrixGenerationSerializedBytes(secondPage))
      .toBeLessThanOrEqual(MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes);
  });

  it('rejects an underfunded accepted budget before creating or queuing work', async () => {
    const workspaceId = createWorkspace(`Matrix budget ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, true);
    const target = previewTarget(workspaceId);
    mocks.previewMatrixGeneration.mockResolvedValue({
      results: [{
        status: 'ready',
        matrixId: target.matrixId,
        templateId: target.templateId,
        cellId: target.cellId,
        sourceRevision: target.sourceRevision,
        target,
      }],
      estimatedBatchBudget: {
        providerCalls: 15,
        inputTokens: 31_000,
        outputTokens: 27_500,
        estimatedUsd: 0.98,
        maxConcurrency: 1,
      },
    } satisfies PreviewMatrixGenerationResult);
    const startRequest = request(workspaceId);
    startRequest.acceptedBudget.maxEstimatedUsd = 0.97;

    await expect(startMatrixGeneration(startRequest)).rejects.toMatchObject({
      details: {
        reason: 'invalid_budget',
        retryable: false,
        fieldPath: 'accepted_budget',
      },
    });
    expect(mocks.queueMatrixGenerationJob).not.toHaveBeenCalled();
  });

  it('requires an immediate re-preview when accepted fingerprint authority is stale', async () => {
    const workspaceId = createWorkspace(`Matrix stale preview ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, true);
    const target = {
      ...previewTarget(workspaceId),
      effectiveInputFingerprint: 'c'.repeat(64),
    };
    mocks.previewMatrixGeneration.mockResolvedValue({
      results: [{
        status: 'ready',
        matrixId: target.matrixId,
        templateId: target.templateId,
        cellId: target.cellId,
        sourceRevision: target.sourceRevision,
        target,
      }],
      estimatedBatchBudget: {
        providerCalls: 15,
        inputTokens: 31_000,
        outputTokens: 27_500,
        estimatedUsd: 0.98,
        maxConcurrency: 1,
      },
    } as PreviewMatrixGenerationResult);

    await expect(startMatrixGeneration(request(workspaceId))).rejects.toMatchObject({
      message: expect.stringContaining('Re-preview immediately'),
      details: {
        reason: 'preview_fingerprint_stale',
        retryable: true,
        fieldPath: 'selections.0.expected_preview_fingerprint',
        constraint: 're-preview immediately and accept the current fingerprint before starting',
      },
    });
    expect(mocks.queueMatrixGenerationJob).not.toHaveBeenCalled();
  });
});
