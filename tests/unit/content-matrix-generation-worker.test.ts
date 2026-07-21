import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MatrixGenerationItem,
  MatrixGenerationRun,
  MatrixGenerationSetAuditReport,
} from '../../shared/types/matrix-generation.js';

const mocks = vi.hoisted(() => ({
  auditMatrixGenerationItem: vi.fn(),
  auditMatrixGenerationSet: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  generateMatrixRunItem: vi.fn(),
  getJob: vi.fn(),
  getMatrixGenerationRetryCommandByJob: vi.fn(),
  getPersistedMatrixGenerationRun: vi.fn(),
  getPersistedMatrixGenerationRunByJob: vi.fn(),
  getPost: vi.fn(),
  invalidateContentPipelineIntelligence: vi.fn(),
  listMatrixGenerationItems: vi.fn(),
  reserveMatrixGenerationBudget: vi.fn(),
  reviseMatrixGenerationItemForSetAudit: vi.fn(),
  runResourceScopedJobWorker: vi.fn(),
  saveMatrixGenerationSetAuditReport: vi.fn(),
  transitionMatrixGenerationItem: vi.fn(),
  transitionMatrixGenerationRun: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock('../../server/content-posts-db.js', () => ({ getPost: mocks.getPost }));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mocks.broadcastToWorkspace }));
vi.mock('../../server/intelligence-freshness.js', () => ({
  invalidateContentPipelineIntelligence: mocks.invalidateContentPipelineIntelligence,
}));
vi.mock('../../server/jobs.js', () => ({
  getJob: mocks.getJob,
  runResourceScopedJobWorker: mocks.runResourceScopedJobWorker,
  updateJob: mocks.updateJob,
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn() }),
}));
vi.mock('../../server/domains/content/matrix-generation/item-audit.js', () => ({
  auditMatrixGenerationItem: mocks.auditMatrixGenerationItem,
  reviseMatrixGenerationItemForSetAudit: mocks.reviseMatrixGenerationItemForSetAudit,
}));
vi.mock('../../server/domains/content/matrix-generation/repository.js', () => ({
  getPersistedMatrixGenerationRun: mocks.getPersistedMatrixGenerationRun,
  getPersistedMatrixGenerationRunByJob: mocks.getPersistedMatrixGenerationRunByJob,
  listMatrixGenerationItems: mocks.listMatrixGenerationItems,
  reserveMatrixGenerationBudget: mocks.reserveMatrixGenerationBudget,
  saveMatrixGenerationSetAuditReport: mocks.saveMatrixGenerationSetAuditReport,
  transitionMatrixGenerationItem: mocks.transitionMatrixGenerationItem,
  transitionMatrixGenerationRun: mocks.transitionMatrixGenerationRun,
}));
vi.mock('../../server/domains/content/matrix-generation/retry-repository.js', () => ({
  getMatrixGenerationRetryCommandByJob: mocks.getMatrixGenerationRetryCommandByJob,
}));
vi.mock('../../server/domains/content/matrix-generation/set-audit.js', async importOriginal => {
  const actual = await importOriginal<typeof import(
    '../../server/domains/content/matrix-generation/set-audit.js'
  )>();
  return { ...actual, auditMatrixGenerationSet: mocks.auditMatrixGenerationSet };
});
vi.mock('../../server/domains/content/matrix-generation/single-cell.js', () => ({
  generateMatrixRunItem: mocks.generateMatrixRunItem,
}));

import { runMatrixGenerationJob } from '../../server/domains/content/matrix-generation/worker.js';

const WORKSPACE_ID = 'workspace-worker';
const JOB_ID = 'job-worker';

function runFixture(candidateCount: number): {
  getRun: () => MatrixGenerationRun;
  items: MatrixGenerationItem[];
} {
  const selections = Array.from({ length: candidateCount }, (_, index) => ({
    matrixId: 'matrix-worker',
    cellId: `cell-${index + 1}`,
    sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
    structuralFingerprint: `${index + 1}`.repeat(64),
    previewFingerprint: `${index + 2}`.repeat(64),
  }));
  let run = {
    id: 'run-worker',
    workspaceId: WORKSPACE_ID,
    status: 'running',
    revision: 1,
    selections,
    acceptedBudget: { limits: { maxConcurrency: 1 } },
    counts: {
      queued: 0,
      running: 0,
      readyForHumanReview: candidateCount,
      needsAttention: 0,
      blocked: 0,
      conflict: 0,
      cancelled: 0,
      failed: 0,
    },
    setAuditReport: null,
  } as unknown as MatrixGenerationRun;
  const items = selections.map((selection, index) => ({
    id: `item-${index + 1}`,
    runId: run.id,
    workspaceId: WORKSPACE_ID,
    status: 'ready_for_human_review',
    revision: 1,
    postId: `post-${index + 1}`,
    previewTarget: { cellId: selection.cellId, blockManifest: { blocks: [] } },
  } as unknown as MatrixGenerationItem));

  mocks.getPersistedMatrixGenerationRun.mockImplementation(() => run);
  mocks.getPersistedMatrixGenerationRunByJob.mockImplementation(() => run);
  mocks.listMatrixGenerationItems.mockImplementation(() => items);
  mocks.transitionMatrixGenerationRun.mockImplementation(input => {
    run = {
      ...run,
      status: input.nextStatus,
      revision: run.revision + 1,
    } as MatrixGenerationRun;
    return run;
  });
  mocks.saveMatrixGenerationSetAuditReport.mockImplementation(input => {
    run = {
      ...run,
      revision: run.revision + 1,
      setAuditReport: input.report,
    } as MatrixGenerationRun;
    return run;
  });
  return { getRun: () => run, items };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJob.mockReturnValue({
    id: JOB_ID,
    type: 'content-matrix-generation',
    workspaceId: WORKSPACE_ID,
  });
  mocks.getMatrixGenerationRetryCommandByJob.mockReturnValue(null);
  mocks.getPost.mockImplementation((_workspaceId: string, postId: string) => ({ id: postId }));
  mocks.runResourceScopedJobWorker.mockImplementation(
    async (_jobId: string, worker: (signal: AbortSignal) => Promise<void>) => {
      await worker(new AbortController().signal);
    },
  );
  mocks.auditMatrixGenerationSet.mockResolvedValue({
    report: {
      verdict: 'passed',
      findings: [],
      passCount: 1,
      modelProvenance: null,
      auditedAt: '2026-07-20T00:00:00.000Z',
    } satisfies MatrixGenerationSetAuditReport,
    proseRevisionItemIds: [],
  });
});

describe('content matrix generation worker set-audit policy', () => {
  it('completes one ready candidate without dispatching or requiring a set audit', async () => {
    const fixture = runFixture(1);

    await runMatrixGenerationJob(JOB_ID);

    expect(mocks.auditMatrixGenerationSet).not.toHaveBeenCalled();
    expect(mocks.saveMatrixGenerationSetAuditReport).not.toHaveBeenCalled();
    expect(mocks.transitionMatrixGenerationItem).not.toHaveBeenCalled();
    expect(fixture.getRun().status).toBe('completed');
    expect(mocks.updateJob).toHaveBeenLastCalledWith(JOB_ID, expect.objectContaining({
      status: 'done',
      message: 'Matrix pages are ready for human review',
    }));
  });

  it('retains the required set audit for two ready candidates', async () => {
    const fixture = runFixture(2);

    await runMatrixGenerationJob(JOB_ID);

    expect(mocks.auditMatrixGenerationSet).toHaveBeenCalledOnce();
    expect(mocks.auditMatrixGenerationSet).toHaveBeenCalledWith(expect.objectContaining({
      expectedCandidateCount: 2,
      passCount: 1,
    }));
    expect(mocks.saveMatrixGenerationSetAuditReport).toHaveBeenCalledOnce();
    expect(mocks.transitionMatrixGenerationItem).not.toHaveBeenCalled();
    expect(fixture.getRun().status).toBe('completed');
  });
});
