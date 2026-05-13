import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addActivity: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  updateJob: vi.fn(),
  unregisterAbort: vi.fn(),
  isJobCancelled: vi.fn(() => false),
  updatePageSeo: vi.fn(),
  getWorkspace: vi.fn(() => ({ id: 'ws_1' })),
  updatePageState: vi.fn(),
  recordSeoChange: vi.fn(),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../server/activity-log.js', () => ({ addActivity: mocks.addActivity }));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mocks.broadcastToWorkspace }));
vi.mock('../../server/jobs.js', () => ({
  isJobCancelled: mocks.isJobCancelled,
  unregisterAbort: mocks.unregisterAbort,
  updateJob: mocks.updateJob,
}));
vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('../../server/seo-change-tracker.js', () => ({ recordSeoChange: mocks.recordSeoChange }));
vi.mock('../../server/webflow.js', () => ({ updatePageSeo: mocks.updatePageSeo }));
vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
  updatePageState: mocks.updatePageState,
}));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    BULK_OPERATION_COMPLETE: 'bulk:complete',
    BULK_OPERATION_FAILED: 'bulk:failed',
    BULK_OPERATION_PROGRESS: 'bulk:progress',
    PAGE_STATE_UPDATED: 'page-state:updated',
  },
}));

const { runSeoBulkAcceptFixesJob } = await import('../../server/webflow-seo-bulk-accept-fixes-job.js');

describe('webflow SEO bulk accept fixes job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isJobCancelled.mockReturnValue(false);
    mocks.getWorkspace.mockReturnValue({ id: 'ws_1' });
    mocks.updatePageSeo.mockResolvedValue({ success: true });
  });

  it('applies supported audit fixes and records terminal success', async () => {
    const ac = new AbortController();

    await runSeoBulkAcceptFixesJob({
      jobId: 'job_1',
      workspaceId: 'ws_1',
      token: 'token_1',
      signal: ac.signal,
      fixes: [{
        pageId: 'page_1',
        check: 'meta-description',
        suggestedFix: 'A better description',
        pageSlug: '/services',
        publishedPath: '/services/seo',
        pageName: 'Services',
      }],
    });

    expect(mocks.updatePageSeo).toHaveBeenCalledWith('page_1', { seo: { description: 'A better description' } }, 'token_1');
    expect(mocks.updatePageState).toHaveBeenCalledWith('ws_1', 'page_1', {
      status: 'live',
      source: 'audit',
      fields: ['description'],
      updatedBy: 'admin',
    });
    expect(mocks.recordSeoChange).toHaveBeenCalledWith('ws_1', 'page_1', '/services/seo', 'Services', ['description'], 'audit-fix');
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'page-state:updated', {
      pageId: 'page_1',
      fields: ['description'],
      source: 'audit-fix',
    });
    expect(mocks.updateJob).toHaveBeenCalledWith('job_1', expect.objectContaining({
      status: 'done',
      result: expect.objectContaining({ applied: 1, failed: 0, total: 1, appliedKeys: ['page_1-meta-description'] }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:complete', expect.objectContaining({
      jobId: 'job_1',
      operation: 'bulk-accept-fixes',
      applied: 1,
      failed: 0,
    }));
    expect(mocks.addActivity).toHaveBeenCalledWith(
      'ws_1',
      'seo_updated',
      'Bulk audit fix: 1 fix applied',
      'Background job applied 1/1 audit fixes to Webflow',
      { applied: 1, failed: 0, total: 1 },
    );
    expect(mocks.unregisterAbort).toHaveBeenCalledWith('job_1');
  });

  it('counts Webflow update failures without recording page state changes', async () => {
    const ac = new AbortController();
    mocks.updatePageSeo.mockResolvedValue({ success: false, error: 'Webflow rejected update' });

    await runSeoBulkAcceptFixesJob({
      jobId: 'job_fail',
      workspaceId: 'ws_1',
      token: 'token_1',
      signal: ac.signal,
      fixes: [{ pageId: 'page_1', check: 'title', suggestedFix: 'Better Title' }],
    });

    expect(mocks.updatePageState).not.toHaveBeenCalled();
    expect(mocks.recordSeoChange).not.toHaveBeenCalled();
    expect(mocks.addActivity).not.toHaveBeenCalled();
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalledWith('ws_1', 'page-state:updated', expect.anything());
    expect(mocks.updateJob).toHaveBeenCalledWith('job_fail', expect.objectContaining({
      status: 'done',
      message: 'Applied 0/1 fixes (1 failed)',
      result: expect.objectContaining({ applied: 0, failed: 1, total: 1 }),
    }));
  });

  it('reports cancellation with partial applied keys', async () => {
    const ac = new AbortController();
    mocks.updatePageSeo.mockImplementation(async () => {
      ac.abort();
      return { success: true };
    });

    await runSeoBulkAcceptFixesJob({
      jobId: 'job_cancel',
      workspaceId: 'ws_1',
      token: 'token_1',
      signal: ac.signal,
      fixes: [
        { pageId: 'page_1', check: 'title', suggestedFix: 'Better Title' },
        { pageId: 'page_2', check: 'title', suggestedFix: 'Second Title' },
      ],
    });

    expect(mocks.updatePageSeo).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'page-state:updated', {
      pageId: 'page_1',
      fields: ['title'],
      source: 'audit-fix',
    });
    expect(mocks.updateJob).toHaveBeenCalledWith('job_cancel', expect.objectContaining({
      status: 'cancelled',
      message: 'Cancelled after 1 fixes',
      result: expect.objectContaining({ applied: 1, failed: 0, total: 2, appliedKeys: ['page_1-title'] }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:failed', expect.objectContaining({
      jobId: 'job_cancel',
      operation: 'bulk-accept-fixes',
      error: 'Cancelled',
    }));
  });
});
