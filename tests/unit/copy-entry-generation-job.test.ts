import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  sequence: [] as string[],
  artifact: null as unknown,
  status: 'pending',
  failEffect: null as string | null,
  failDoneBeforeCommit: false,
  failErrorBeforeCommit: false,
  throwDoneAfterCommit: false,
  generated: {
    sections: [{ id: 'section-1' }, { id: 'section-2' }],
    metadata: { id: 'metadata-1' },
  },
  addActivity: vi.fn(),
  isProgrammingError: vi.fn(() => false),
  updateJob: vi.fn(),
  getJob: vi.fn(),
  unregisterAbort: vi.fn(),
  finalizeJobResourceClaims: vi.fn(),
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
  broadcastToWorkspace: vi.fn(),
  generateCopyForEntry: vi.fn(),
  getEntry: vi.fn(),
  invalidateContentPipelineIntelligence: vi.fn(),
}));

vi.mock('../../server/activity-log.js', () => ({ addActivity: harness.addActivity }));
vi.mock('../../server/errors.js', () => ({ isProgrammingError: harness.isProgrammingError }));
vi.mock('../../server/jobs.js', () => ({
  updateJob: harness.updateJob,
  getJob: harness.getJob,
  unregisterAbort: harness.unregisterAbort,
  finalizeJobResourceClaims: harness.finalizeJobResourceClaims,
}));
vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => harness.logger) }));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: harness.broadcastToWorkspace,
}));
vi.mock('../../server/copy-generation.js', () => ({
  generateCopyForEntry: harness.generateCopyForEntry,
}));
vi.mock('../../server/page-strategy.js', () => ({ getEntry: harness.getEntry }));
vi.mock('../../server/intelligence-freshness.js', () => ({
  invalidateContentPipelineIntelligence: harness.invalidateContentPipelineIntelligence,
}));

const { runCopyEntryGenerationJob } = await import('../../server/copy-entry-generation-job.js');
const { WS_EVENTS } = await import('../../server/ws-events.js');

const options = {
  jobId: 'job-copy-entry-1',
  workspaceId: 'ws-copy-entry-1',
  blueprintId: 'blueprint-1',
  entryId: 'entry-1',
};

describe('runCopyEntryGenerationJob durable completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.sequence.length = 0;
    harness.artifact = null;
    harness.status = 'pending';
    harness.failEffect = null;
    harness.failDoneBeforeCommit = false;
    harness.failErrorBeforeCommit = false;
    harness.throwDoneAfterCommit = false;

    harness.getEntry.mockReturnValue({ name: 'Service Page' });
    harness.isProgrammingError.mockReturnValue(false);
    harness.getJob.mockImplementation(() => ({ status: harness.status }));
    harness.updateJob.mockImplementation((_jobId: string, update: { status?: string }) => {
      if (update.status === 'done' && harness.failDoneBeforeCommit) {
        throw new Error('done persistence failed');
      }
      if (update.status === 'error' && harness.failErrorBeforeCommit) {
        throw new Error('error persistence failed');
      }
      if (update.status) {
        harness.sequence.push(`job:${update.status}`);
        harness.status = update.status;
      }
      if (update.status === 'done' && harness.throwDoneAfterCommit) {
        throw new Error('job event failed after commit');
      }
    });
    harness.generateCopyForEntry.mockImplementation(async () => {
      harness.sequence.push('artifact-commit');
      harness.artifact = harness.generated;
      return harness.generated;
    });
    harness.invalidateContentPipelineIntelligence.mockImplementation(() => {
      harness.sequence.push('intelligence-cache');
      if (harness.failEffect === 'intelligence-cache') throw new Error('cache failed');
    });
    harness.broadcastToWorkspace.mockImplementation((_workspaceId: string, event: string) => {
      const effect = event === WS_EVENTS.COPY_SECTION_UPDATED
        ? 'copy-section-broadcast'
        : 'copy-metadata-broadcast';
      harness.sequence.push(effect);
      if (harness.failEffect === effect) throw new Error(`${effect} failed`);
    });
    harness.addActivity.mockImplementation(() => {
      harness.sequence.push('activity');
      if (harness.failEffect === 'activity') throw new Error('activity failed');
    });
  });

  it('records done immediately after the durable artifact and before optional effects', async () => {
    await runCopyEntryGenerationJob(options);

    expect(harness.artifact).toBe(harness.generated);
    expect(harness.status).toBe('done');
    expect(harness.sequence).toEqual([
      'job:running',
      'artifact-commit',
      'job:done',
      'intelligence-cache',
      'copy-section-broadcast',
      'copy-metadata-broadcast',
      'activity',
    ]);
    expect(harness.updateJob).not.toHaveBeenCalledWith(
      options.jobId,
      expect.objectContaining({ status: 'error' }),
    );
    expect(harness.unregisterAbort).toHaveBeenCalledWith(options.jobId);
    expect(harness.finalizeJobResourceClaims).toHaveBeenCalledWith(options.jobId);
  });

  it.each([
    ['intelligence-cache'],
    ['copy-section-broadcast'],
    ['copy-metadata-broadcast'],
    ['activity'],
  ])('keeps the artifact and done state when the %s effect fails, then attempts every later effect', async (effect) => {
    harness.failEffect = effect;

    await runCopyEntryGenerationJob(options);

    expect(harness.artifact).toBe(harness.generated);
    expect(harness.status).toBe('done');
    expect(harness.updateJob).not.toHaveBeenCalledWith(
      options.jobId,
      expect.objectContaining({ status: 'error' }),
    );
    expect(harness.invalidateContentPipelineIntelligence).toHaveBeenCalledTimes(1);
    expect(harness.broadcastToWorkspace).toHaveBeenCalledTimes(2);
    expect(harness.addActivity).toHaveBeenCalledTimes(1);
    expect(harness.sequence.slice(-4)).toEqual([
      'intelligence-cache',
      'copy-section-broadcast',
      'copy-metadata-broadcast',
      'activity',
    ]);
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: options.workspaceId,
        entryId: options.entryId,
        effect,
      }),
      'copy entry generation post-commit effect failed',
    );
  });

  it('preserves done and runs optional effects when completion notification throws after commit', async () => {
    harness.throwDoneAfterCommit = true;

    await runCopyEntryGenerationJob(options);

    expect(harness.artifact).toBe(harness.generated);
    expect(harness.status).toBe('done');
    expect(harness.updateJob).not.toHaveBeenCalledWith(
      options.jobId,
      expect.objectContaining({ status: 'error' }),
    );
    expect(harness.invalidateContentPipelineIntelligence).toHaveBeenCalledTimes(1);
    expect(harness.broadcastToWorkspace).toHaveBeenCalledTimes(2);
    expect(harness.addActivity).toHaveBeenCalledTimes(1);
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: options.jobId,
        workspaceId: options.workspaceId,
        entryId: options.entryId,
      }),
      'copy entry generation success committed but its job event failed',
    );
  });

  it('drains without rejection when both terminal writes fail after the artifact commits', async () => {
    harness.failDoneBeforeCommit = true;
    harness.failErrorBeforeCommit = true;

    await expect(runCopyEntryGenerationJob(options)).resolves.toBeUndefined();

    expect(harness.artifact).toBe(harness.generated);
    expect(harness.status).toBe('running');
    expect(harness.invalidateContentPipelineIntelligence).not.toHaveBeenCalled();
    expect(harness.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(harness.addActivity).not.toHaveBeenCalled();
    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: options.jobId,
        entryId: options.entryId,
        artifactCommitted: true,
      }),
      'copy-entry-generation-job: committed artifact terminal writes failed',
    );
    expect(harness.unregisterAbort).toHaveBeenCalledWith(options.jobId);
    expect(harness.finalizeJobResourceClaims).toHaveBeenCalledWith(options.jobId);
  });

  it('marks a required generation failure as error without running post-commit effects', async () => {
    harness.generateCopyForEntry.mockRejectedValueOnce(new Error('generation failed'));

    await runCopyEntryGenerationJob(options);

    expect(harness.artifact).toBeNull();
    expect(harness.status).toBe('error');
    expect(harness.invalidateContentPipelineIntelligence).not.toHaveBeenCalled();
    expect(harness.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(harness.addActivity).not.toHaveBeenCalled();
    expect(harness.unregisterAbort).toHaveBeenCalledWith(options.jobId);
    expect(harness.finalizeJobResourceClaims).toHaveBeenCalledWith(options.jobId);
  });
});
