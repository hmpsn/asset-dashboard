import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
  getTokenForSite: vi.fn(),
}));
vi.mock('../../server/jobs.js', () => ({
  cancelJob: vi.fn(),
  createJob: vi.fn(),
  getJob: vi.fn(),
  getJobCancellationError: vi.fn(() => null),
  hasActiveJob: vi.fn(),
  listJobs: vi.fn(),
  updateJob: vi.fn(),
}));
vi.mock('../../server/keyword-strategy-generation.js', () => ({
  generateKeywordStrategy: vi.fn(),
  hasActiveKeywordStrategyGeneration: vi.fn(),
  KEYWORD_STRATEGY_MAX_PAGE_CAP: 2000,
  KeywordStrategyGenerationError: class KeywordStrategyGenerationError extends Error {
    statusCode: number;
    payload: { error: string; message?: string };
    constructor(statusCode: number, payload: { error: string; message?: string }) {
      super(payload.error);
      this.statusCode = statusCode;
      this.payload = payload;
    }
  },
}));
vi.mock('../../server/seo-audit.js', () => ({
  runSeoAudit: vi.fn(),
}));
vi.mock('../../server/local-seo.js', () => ({
  createLocalSeoRefreshPlan: vi.fn(),
  runLocalSeoRefreshJob: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../../server/activity-log.js', () => ({
  addActivity: vi.fn(),
}));

import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { getWorkspace, getTokenForSite } from '../../server/workspaces.js';
import { cancelJob, createJob, getJob, hasActiveJob, listJobs } from '../../server/jobs.js';
import { hasActiveKeywordStrategyGeneration } from '../../server/keyword-strategy-generation.js';
import { createLocalSeoRefreshPlan, runLocalSeoRefreshJob } from '../../server/local-seo.js';
import { handleJobActionTool, jobActionTools } from '../../server/mcp/tools/job-actions.js';

describe('mcp job action tools', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'ws-1',
      name: 'Workspace',
      webflowSiteId: 'site-1',
    });
    (getTokenForSite as ReturnType<typeof vi.fn>).mockReturnValue('token-1');
    (hasActiveJob as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (hasActiveKeywordStrategyGeneration as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (createJob as ReturnType<typeof vi.fn>).mockImplementation((type: string) => ({
      id: `${type}-job-1`,
      type,
    }));
    (createLocalSeoRefreshPlan as ReturnType<typeof vi.fn>).mockReturnValue({
      markets: [{ id: 'm1' }],
      keywords: ['kw-1', 'kw-2'],
    });
    (runLocalSeoRefreshJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('registers the three job action tools', () => {
    expect(jobActionTools.map(t => t.name)).toEqual([
      'start_keyword_strategy_generation',
      'start_seo_audit',
      'start_local_seo_refresh',
      'get_job_status',
      'list_jobs',
      'cancel_job',
    ]);
  });

  it('start_keyword_strategy_generation creates a keyword-strategy job', async () => {
    const result = await handleJobActionTool('start_keyword_strategy_generation', {
      workspace_id: 'ws-1',
      options: { mode: 'full', maxPages: 100 },
    });
    expect(result.isError).toBeUndefined();
    expect(createJob).toHaveBeenCalledWith(
      BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
    const payload = JSON.parse(result.content[0].text) as { job_type: string };
    expect(payload.job_type).toBe(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY);
  });

  it('start_seo_audit creates an seo-audit job', async () => {
    const result = await handleJobActionTool('start_seo_audit', {
      workspace_id: 'ws-1',
      site_id: 'site-1',
      options: { skip_link_check: true },
    });
    expect(result.isError).toBeUndefined();
    expect(createJob).toHaveBeenCalledWith(
      BACKGROUND_JOB_TYPES.SEO_AUDIT,
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
  });

  it('start_seo_audit rejects site ids that do not belong to workspace', async () => {
    const result = await handleJobActionTool('start_seo_audit', {
      workspace_id: 'ws-1',
      site_id: 'site-2',
    });

    expect(result.isError).toBe(true);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('start_local_seo_refresh creates a local-seo-refresh job and runs worker', async () => {
    const result = await handleJobActionTool('start_local_seo_refresh', {
      workspace_id: 'ws-1',
      refresh_body: {},
    });
    expect(result.isError).toBeUndefined();
    expect(createJob).toHaveBeenCalledWith(
      BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH,
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
    expect(runLocalSeoRefreshJob).toHaveBeenCalledWith(
      expect.any(String),
      'ws-1',
      {},
    );
  });

  it('supports get/list/cancel job tools', async () => {
    (getJob as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'job-1',
      workspaceId: 'ws-1',
      status: 'running',
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
    });
    (listJobs as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'job-1', workspaceId: 'ws-1', status: 'running', type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY },
    ]);
    (cancelJob as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'job-1',
      workspaceId: 'ws-1',
      status: 'cancelled',
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
    });

    const status = await handleJobActionTool('get_job_status', {
      workspace_id: 'ws-1',
      job_id: 'job-1',
    });
    expect(status.isError).toBeUndefined();

    const list = await handleJobActionTool('list_jobs', {
      workspace_id: 'ws-1',
    });
    expect(list.isError).toBeUndefined();

    const cancelled = await handleJobActionTool('cancel_job', {
      workspace_id: 'ws-1',
      job_id: 'job-1',
    });
    expect(cancelled.isError).toBeUndefined();
  });
});
