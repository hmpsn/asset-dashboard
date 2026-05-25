import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addActivity: vi.fn(),
  isProgrammingError: vi.fn(() => false),
  updateJob: vi.fn(),
  unregisterAbort: vi.fn(),
  isJobCancelled: vi.fn(() => false),
  createLogger: vi.fn(),
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
  broadcastToWorkspace: vi.fn(),
  prepareBulkSchemaGenerationContext: vi.fn(),
  saveSchemaSnapshot: vi.fn(),
  generateSchemaSuggestions: vi.fn(),
}));

vi.mock('../../server/activity-log.js', () => ({ addActivity: mocks.addActivity }));
vi.mock('../../server/errors.js', () => ({ isProgrammingError: mocks.isProgrammingError }));
vi.mock('../../server/jobs.js', () => ({
  updateJob: mocks.updateJob,
  unregisterAbort: mocks.unregisterAbort,
  isJobCancelled: mocks.isJobCancelled,
}));
vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mocks.broadcastToWorkspace }));
vi.mock('../../server/schema-generation-context.js', () => ({
  prepareBulkSchemaGenerationContext: mocks.prepareBulkSchemaGenerationContext,
}));
vi.mock('../../server/schema-store.js', () => ({ saveSchemaSnapshot: mocks.saveSchemaSnapshot }));
vi.mock('../../server/schema-suggester.js', () => ({
  generateSchemaSuggestions: mocks.generateSchemaSuggestions,
}));

const { runSchemaGenerationJob } = await import('../../server/schema-generation-job.js');
const { WS_EVENTS } = await import('../../server/ws-events.js');

describe('runSchemaGenerationJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isProgrammingError.mockReturnValue(false);
    mocks.isJobCancelled.mockReturnValue(false);
    mocks.prepareBulkSchemaGenerationContext.mockResolvedValue({ ctx: { pages: [] } });
  });

  it('handles success with incremental and final snapshot saves, broadcast, and activity logging', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(10_000).mockReturnValueOnce(15_000);

    const partialResult = [{ pageId: 'page-1' }];
    const finalResult = [{ pageId: 'page-1' }, { pageId: 'page-2' }];

    mocks.generateSchemaSuggestions.mockImplementation(
      async (
        _siteId: string,
        _token: string,
        _ctx: unknown,
        onProgress: (partial: Array<{ pageId: string }>, done: boolean, message: string) => void,
      ) => {
        onProgress(partialResult, false, 'Generated 1 page');
        onProgress(finalResult, false, 'Generated 2 pages');
        return finalResult;
      },
    );

    await runSchemaGenerationJob({
      jobId: 'job-success',
      siteId: 'site-1',
      token: 'token-1',
      workspaceId: 'ws-1',
    });

    expect(mocks.updateJob).toHaveBeenNthCalledWith(1, 'job-success', {
      status: 'running',
      message: 'Scanning pages and generating unified schemas...',
    });
    expect(mocks.updateJob).toHaveBeenCalledWith('job-success', {
      status: 'done',
      result: finalResult,
      message: 'Done — 2 page schemas generated',
      progress: 2,
      total: 2,
    });
    expect(mocks.saveSchemaSnapshot).toHaveBeenNthCalledWith(1, 'site-1', 'ws-1', partialResult);
    expect(mocks.saveSchemaSnapshot).toHaveBeenNthCalledWith(2, 'site-1', 'ws-1', finalResult);
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws-1', WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED, {
      siteId: 'site-1',
      action: 'generated',
      pageCount: 2,
    });
    expect(mocks.addActivity).toHaveBeenCalledWith(
      'ws-1',
      'schema_generated',
      'Schema generated for 2 pages',
      'All pages processed',
    );
    expect(mocks.unregisterAbort).toHaveBeenCalledWith('job-success');

    dateNowSpy.mockRestore();
  });

  it('marks a cancelled job as cancelled and does not write an error status update', async () => {
    mocks.isJobCancelled.mockReturnValue(true);
    mocks.generateSchemaSuggestions.mockResolvedValue([{ pageId: 'page-1' }]);

    await runSchemaGenerationJob({
      jobId: 'job-cancelled',
      siteId: 'site-1',
      token: 'token-1',
      workspaceId: 'ws-1',
    });

    expect(mocks.updateJob).toHaveBeenCalledWith('job-cancelled', {
      status: 'cancelled',
      result: [{ pageId: 'page-1' }],
      message: 'Cancelled — 1 pages completed before stop',
    });
    expect(mocks.updateJob).not.toHaveBeenCalledWith(
      'job-cancelled',
      expect.objectContaining({ status: 'error' }),
    );
    expect(mocks.unregisterAbort).toHaveBeenCalledWith('job-cancelled');
  });

  it('records error status when generation fails and the job is not cancelled', async () => {
    mocks.isJobCancelled.mockReturnValue(false);
    mocks.generateSchemaSuggestions.mockRejectedValue(new Error('boom'));

    await runSchemaGenerationJob({
      jobId: 'job-error',
      siteId: 'site-1',
      token: 'token-1',
      workspaceId: 'ws-1',
    });

    expect(mocks.updateJob).toHaveBeenCalledWith('job-error', {
      status: 'error',
      error: 'boom',
      message: 'Schema generation failed',
    });
    expect(mocks.unregisterAbort).toHaveBeenCalledWith('job-error');
  });

  it('always unregisters abort handlers, including when context preparation fails', async () => {
    mocks.prepareBulkSchemaGenerationContext.mockRejectedValue(new Error('context failed'));

    await runSchemaGenerationJob({
      jobId: 'job-finally',
      siteId: 'site-1',
      token: 'token-1',
      workspaceId: 'ws-1',
    });

    expect(mocks.unregisterAbort).toHaveBeenCalledWith('job-finally');
  });

  it('does not persist/broadcast/activity-log when generation returns zero pages', async () => {
    mocks.generateSchemaSuggestions.mockImplementation(
      async (
        _siteId: string,
        _token: string,
        _ctx: unknown,
        onProgress: (partial: Array<{ pageId: string }>, done: boolean, message: string) => void,
      ) => {
        onProgress([], false, 'Scanning pages');
        return [];
      },
    );

    await runSchemaGenerationJob({
      jobId: 'job-empty',
      siteId: 'site-1',
      token: 'token-1',
      workspaceId: 'ws-1',
    });

    expect(mocks.saveSchemaSnapshot).not.toHaveBeenCalled();
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(mocks.addActivity).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith('job-empty', {
      status: 'done',
      result: [],
      message: 'Done — 0 page schemas generated',
      progress: 0,
      total: 0,
    });
  });

  it('logs programming errors via warn path and marks job as error', async () => {
    const programmingErr = new Error('programming failure');
    mocks.isProgrammingError.mockReturnValue(true);
    mocks.generateSchemaSuggestions.mockRejectedValue(programmingErr);

    await runSchemaGenerationJob({
      jobId: 'job-programming-error',
      siteId: 'site-1',
      token: 'token-1',
      workspaceId: 'ws-1',
    });

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      { err: programmingErr },
      'schema-generation-job: job failed with programming error',
    );
    expect(mocks.logger.debug).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith('job-programming-error', {
      status: 'error',
      error: 'programming failure',
      message: 'Schema generation failed',
    });
  });
});
