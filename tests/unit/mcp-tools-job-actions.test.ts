import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  class KeywordStrategyGenerationError extends Error {
    payload: { error: string; message: string };
    constructor(payload: { error: string; message: string }) {
      super(payload.message);
      this.payload = payload;
    }
  }

  return {
    getWorkspace: vi.fn(),
    addActivity: vi.fn(),
    broadcastToWorkspace: vi.fn(),
    createJob: vi.fn(),
    cancelJob: vi.fn(),
    getJob: vi.fn(),
    getJobAuthoritative: vi.fn(),
    getJobCancellationError: vi.fn(() => null),
    hasActiveJob: vi.fn(),
    listJobs: vi.fn(),
    updateJob: vi.fn(),
    createLocalSeoRefreshPlan: vi.fn(),
    runLocalSeoRefreshJob: vi.fn(),
    generateKeywordStrategy: vi.fn(),
    hasActiveKeywordStrategyGeneration: vi.fn(),
    runSeoAudit: vi.fn(),
    getTokenForSite: vi.fn(),
    recordPaidCall: vi.fn(() => ({ count: 1 })),
    KeywordStrategyGenerationError,
  };
});

vi.mock('../../server/mcp/paid-call-counter.js', () => ({
  recordPaidCall: h.recordPaidCall,
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: h.getWorkspace,
  getTokenForSite: h.getTokenForSite,
}));

vi.mock('../../server/activity-log.js', () => ({
  addActivity: h.addActivity,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: h.broadcastToWorkspace,
}));

vi.mock('../../server/jobs.js', () => ({
  cancelJob: h.cancelJob,
  createJob: h.createJob,
  getJob: h.getJob,
  getJobAuthoritative: h.getJobAuthoritative,
  getJobCancellationError: h.getJobCancellationError,
  hasActiveJob: h.hasActiveJob,
  listJobs: h.listJobs,
  updateJob: h.updateJob,
}));

vi.mock('../../server/local-seo.js', () => ({
  createLocalSeoRefreshPlan: h.createLocalSeoRefreshPlan,
  runLocalSeoRefreshJob: h.runLocalSeoRefreshJob,
}));

vi.mock('../../server/keyword-strategy-generation.js', () => ({
  generateKeywordStrategy: h.generateKeywordStrategy,
  hasActiveKeywordStrategyGeneration: h.hasActiveKeywordStrategyGeneration,
  KEYWORD_STRATEGY_MAX_PAGE_CAP: 500,
  KeywordStrategyGenerationError: h.KeywordStrategyGenerationError,
}));

vi.mock('../../server/seo-audit.js', () => ({
  runSeoAudit: h.runSeoAudit,
}));

import { handleJobActionTool } from '../../server/mcp/tools/job-actions.js';

function errorEnvelope(result: Awaited<ReturnType<typeof handleJobActionTool>>) {
  return JSON.parse(result.content[0]?.text ?? '{}') as {
    code: string;
    details?: Record<string, unknown>;
  };
}

describe('mcp job action tools', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    h.getWorkspace.mockReturnValue({ id: 'ws-1', webflowSiteId: 'site-1' });
    h.getTokenForSite.mockReturnValue('wf-token');
    h.hasActiveKeywordStrategyGeneration.mockReturnValue(false);
    h.hasActiveJob.mockReturnValue(undefined);
    h.createJob.mockReturnValue({ id: 'job-1' });
    h.getJob.mockReturnValue({ id: 'job-1', status: 'running' });
    h.getJobAuthoritative.mockReturnValue({ id: 'job-1', status: 'running' });
    h.getJobCancellationError.mockReturnValue(null);
    h.generateKeywordStrategy.mockResolvedValue({
      strategy: { pageMap: [{ id: 'p1' }, { id: 'p2' }] },
      upToDate: false,
      freshPageCount: 2,
    });
    h.runSeoAudit.mockResolvedValue({ siteScore: 88, totalPages: 42, errors: 1, warnings: 3 });
    h.createLocalSeoRefreshPlan.mockReturnValue({ markets: ['US'], keywords: ['hvac', 'ac'] });
    h.runLocalSeoRefreshJob.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a paid call for the two paid jobs, but not for the unpaid seo audit', async () => {
    await handleJobActionTool('start_keyword_strategy_generation', { workspace_id: 'ws-1' });
    expect(h.recordPaidCall).toHaveBeenCalledTimes(1);
    // Per-workspace attribution: the workspaceId must be threaded as the 2nd arg.
    expect(h.recordPaidCall).toHaveBeenCalledWith(1, 'ws-1');

    h.recordPaidCall.mockClear();
    await handleJobActionTool('start_local_seo_refresh', { workspace_id: 'ws-1', refresh_body: {} });
    expect(h.recordPaidCall).toHaveBeenCalledTimes(1);
    expect(h.recordPaidCall).toHaveBeenCalledWith(1, 'ws-1');

    // start_seo_audit is NOT in the audit's paid-tool list → must not count.
    h.recordPaidCall.mockClear();
    await handleJobActionTool('start_seo_audit', { workspace_id: 'ws-1', site_id: 'site-1' });
    expect(h.recordPaidCall).not.toHaveBeenCalled();
  });

  it('starts keyword strategy job and transitions to done with progress updates', async () => {
    h.generateKeywordStrategy.mockImplementation(async ({ onProgress }: { onProgress: (evt: { progress: number; step: string; detail?: string }) => void }) => {
      onProgress({ progress: 0.34, step: 'crawl', detail: 'discovery' });
      return { strategy: { pageMap: [{}, {}] }, upToDate: false, freshPageCount: 2 };
    });

    const res = await handleJobActionTool('start_keyword_strategy_generation', {
      workspace_id: 'ws-1',
      options: { mode: 'incremental', maxPages: 25 },
    });

    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0].text) as { job_id: string; job_type: string };
    expect(payload.job_id).toBe('job-1');
    expect(payload.job_type).toBe('keyword-strategy');

    await vi.runAllTimersAsync();

    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'running' }));
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ progress: 34, message: 'crawl: discovery' }));
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'done', progress: 100 }));
    expect(h.addActivity).toHaveBeenCalledWith('ws-1', 'strategy_generated', expect.any(String), expect.any(String), expect.objectContaining({ action: 'mcp_keyword_strategy_job_done' }));
  });

  it('rejects keyword generation when maxPages exceeds cap', async () => {
    const res = await handleJobActionTool('start_keyword_strategy_generation', {
      workspace_id: 'ws-1',
      options: { maxPages: 999 },
    });

    expect(res.isError).toBe(true);
    expect(errorEnvelope(res)).toMatchObject({
      code: 'validation_failed',
      details: { field_path: 'options.maxPages' },
    });
  });

  it('rejects keyword generation when workspace already generating or has active job', async () => {
    h.hasActiveKeywordStrategyGeneration.mockReturnValue(true);
    const a = await handleJobActionTool('start_keyword_strategy_generation', { workspace_id: 'ws-1' });
    expect(a.isError).toBe(true);

    h.hasActiveKeywordStrategyGeneration.mockReturnValue(false);
    h.hasActiveJob.mockReturnValue({ id: 'job-active' });
    const b = await handleJobActionTool('start_keyword_strategy_generation', { workspace_id: 'ws-1' });
    expect(b.isError).toBe(true);
    expect(b.content[0].text).toContain('already running');
  });

  it('handles keyword generation errors using typed payload message', async () => {
    h.generateKeywordStrategy.mockRejectedValue(new h.KeywordStrategyGenerationError({
      error: 'provider_error',
      message: 'Provider rate limit',
    }));

    await handleJobActionTool('start_keyword_strategy_generation', { workspace_id: 'ws-1' });
    await vi.runAllTimersAsync();

    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'error',
      error: 'Keyword strategy generation failed its provider or evidence preconditions.',
    }));
  });

  it('starts seo audit and records completion activity', async () => {
    const res = await handleJobActionTool('start_seo_audit', {
      workspace_id: 'ws-1',
      site_id: 'site-1',
      options: { skip_link_check: true },
    });
    expect(res.isError).toBeUndefined();

    await vi.runAllTimersAsync();

    expect(h.runSeoAudit).toHaveBeenCalledWith('site-1', 'wf-token', 'ws-1', true);
    expect(h.broadcastToWorkspace).toHaveBeenCalledWith('ws-1', 'audit:complete', expect.objectContaining({ score: 88 }));
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'done' }));
    expect(h.addActivity).toHaveBeenCalledWith('ws-1', 'audit_completed', expect.any(String), expect.any(String), expect.objectContaining({ action: 'mcp_seo_audit_job_done' }));
  });

  it('handles seo audit token missing, site mismatch, and runner failures', async () => {
    h.getWorkspace.mockReturnValue({ id: 'ws-1', webflowSiteId: 'site-1' });
    const mismatch = await handleJobActionTool('start_seo_audit', {
      workspace_id: 'ws-1',
      site_id: 'other-site',
    });
    expect(mismatch.isError).toBe(true);

    h.hasActiveJob.mockReturnValue({ id: 'job-existing' });
    const active = await handleJobActionTool('start_seo_audit', {
      workspace_id: 'ws-1',
      site_id: 'site-1',
    });
    expect(active.isError).toBe(true);

    h.hasActiveJob.mockReturnValue(undefined);
    h.getTokenForSite.mockReturnValue(undefined);
    await handleJobActionTool('start_seo_audit', {
      workspace_id: 'ws-1',
      site_id: 'site-1',
    });
    await vi.runAllTimersAsync();
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'error', error: 'No Webflow API token configured' }));

    h.getTokenForSite.mockReturnValue('wf-token');
    h.runSeoAudit.mockRejectedValue(new Error('audit crash'));
    await handleJobActionTool('start_seo_audit', {
      workspace_id: 'ws-1',
      site_id: 'site-1',
    });
    await vi.runAllTimersAsync();
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'error',
      error: 'SEO audit failed unexpectedly. Review the connection and server logs before retrying.',
    }));
  });

  it('starts local seo refresh and handles active jobs, missing plan, and rejected runner', async () => {
    const ok = await handleJobActionTool('start_local_seo_refresh', {
      workspace_id: 'ws-1',
      refresh_body: {},
    });
    expect(ok.isError).toBeUndefined();
    const payload = JSON.parse(ok.content[0].text) as { selected_market_count: number; selected_keyword_count: number };
    expect(payload.selected_market_count).toBe(1);
    expect(payload.selected_keyword_count).toBe(2);

    h.hasActiveJob.mockImplementation((type: string, workspaceId?: string) => {
      if (type === 'local-seo-refresh' && workspaceId === 'ws-1') return { id: 'ws-active' };
      return undefined;
    });
    const wsActive = await handleJobActionTool('start_local_seo_refresh', { workspace_id: 'ws-1', refresh_body: {} });
    expect(wsActive.isError).toBe(true);

    h.hasActiveJob.mockImplementation((type: string, workspaceId?: string) => {
      if (type === 'local-seo-refresh' && workspaceId === undefined) return { id: 'global-active' };
      return undefined;
    });
    const globalActive = await handleJobActionTool('start_local_seo_refresh', { workspace_id: 'ws-1', refresh_body: {} });
    expect(globalActive.isError).toBe(true);

    h.hasActiveJob.mockReturnValue(undefined);
    h.createLocalSeoRefreshPlan.mockReturnValue(null);
    const noPlan = await handleJobActionTool('start_local_seo_refresh', { workspace_id: 'ws-1', refresh_body: {} });
    expect(noPlan.isError).toBe(true);

    h.createLocalSeoRefreshPlan.mockReturnValue({ markets: ['US'], keywords: ['hvac'] });
    h.runLocalSeoRefreshJob.mockRejectedValue(new Error('refresh failed'));
    await handleJobActionTool('start_local_seo_refresh', { workspace_id: 'ws-1', refresh_body: {} });
    await Promise.resolve();
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'error',
      error: 'Local SEO refresh failed unexpectedly. Review server logs before retrying.',
    }));
  });

  it('rejects cancel_job when the job metadata marks it non-cancellable', async () => {
    h.getJob.mockReturnValue({ id: 'job-1', status: 'running', workspaceId: 'ws-1', type: 'recommendations-generation' });
    h.getJobCancellationError.mockReturnValue('Recommendations Generation cannot be cancelled once it has started');

    const res = await handleJobActionTool('cancel_job', { workspace_id: 'ws-1', job_id: 'job-1' });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('cannot be cancelled');
    expect(h.cancelJob).not.toHaveBeenCalled();
  });

  it('supports get_job_status, list_jobs, and cancel_job', async () => {
    h.getJob.mockReturnValue({ id: 'job-1', workspaceId: 'ws-1', status: 'running', type: 'keyword-strategy' });
    h.getJobAuthoritative.mockReturnValue({ id: 'job-1', workspaceId: 'ws-1', status: 'running', type: 'keyword-strategy' });
    h.listJobs.mockReturnValue([{ id: 'job-1', workspaceId: 'ws-1', status: 'running', type: 'keyword-strategy' }]);
    h.cancelJob.mockReturnValue({ id: 'job-1', workspaceId: 'ws-1', status: 'cancelled', type: 'keyword-strategy' });

    const status = await handleJobActionTool('get_job_status', { workspace_id: 'ws-1', job_id: 'job-1' });
    expect(status.isError).toBeUndefined();
    expect(h.getJobAuthoritative).toHaveBeenCalledWith('job-1');

    const list = await handleJobActionTool('list_jobs', { workspace_id: 'ws-1' });
    expect(list.isError).toBeUndefined();

    const cancelled = await handleJobActionTool('cancel_job', { workspace_id: 'ws-1', job_id: 'job-1' });
    expect(cancelled.isError).toBeUndefined();
  });

  it('returns unknown-tool error for unsupported job action', async () => {
    const res = await handleJobActionTool('start_nonexistent_job', { workspace_id: 'ws-1' });
    expect(res.isError).toBe(true);
    expect(errorEnvelope(res)).toMatchObject({
      code: 'not_found',
      details: { resource_type: 'tool' },
    });
  });

  it('covers validation, workspace, and webflow-site guards', async () => {
    const invalid = await handleJobActionTool('start_keyword_strategy_generation', {});
    expect(invalid.isError).toBe(true);
    expect(errorEnvelope(invalid)).toMatchObject({ code: 'validation_failed' });

    h.getWorkspace.mockReturnValueOnce(undefined);
    const missingWorkspace = await handleJobActionTool('start_keyword_strategy_generation', { workspace_id: 'ws-missing' });
    expect(missingWorkspace.isError).toBe(true);
    expect(missingWorkspace.content[0].text).toContain('Workspace not found');

    h.getWorkspace.mockReturnValueOnce({ id: 'ws-1', webflowSiteId: null });
    const noSite = await handleJobActionTool('start_keyword_strategy_generation', { workspace_id: 'ws-1' });
    expect(noSite.isError).toBe(true);
    expect(noSite.content[0].text).toContain('no linked Webflow site');
  });

  it('covers keyword job cancelled and non-array page-map branches', async () => {
    h.getJob.mockReturnValue({ id: 'job-1', status: 'cancelled' });
    await handleJobActionTool('start_keyword_strategy_generation', {
      workspace_id: 'ws-1',
      options: { mode: 'full' },
    });
    await vi.runAllTimersAsync();
    expect(h.generateKeywordStrategy).not.toHaveBeenCalled();

    h.getJob.mockReturnValue({ id: 'job-1', status: 'running' });
    h.generateKeywordStrategy.mockImplementation(async ({ onProgress }: { onProgress: (evt: { progress: number; step: string; detail?: string }) => void }) => {
      onProgress({ progress: 0.4, step: 'collect' });
      return { strategy: {}, upToDate: true, freshPageCount: 0 };
    });
    await handleJobActionTool('start_keyword_strategy_generation', {
      workspace_id: 'ws-1',
      options: { mode: 'full' },
    });
    await vi.runAllTimersAsync();
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ message: 'collect' }));
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'done',
      message: 'Strategy already up to date',
    }));
  });

  it('covers keyword and local-seo non-Error catch branches', async () => {
    h.generateKeywordStrategy.mockRejectedValueOnce(new h.KeywordStrategyGenerationError({
      error: 'raw-payload-error',
      message: '',
    }));
    await handleJobActionTool('start_keyword_strategy_generation', { workspace_id: 'ws-1' });
    await vi.runAllTimersAsync();
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'error',
      error: 'Keyword strategy generation failed its provider or evidence preconditions.',
    }));

    h.runLocalSeoRefreshJob.mockRejectedValueOnce('refresh exploded');
    await handleJobActionTool('start_local_seo_refresh', {
      workspace_id: 'ws-1',
      refresh_body: {},
    });
    await Promise.resolve();
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'error',
      error: 'Local SEO refresh failed unexpectedly. Review server logs before retrying.',
    }));
  });

  it('covers cancelled-after-run and cancelled-in-catch guards', async () => {
    let getJobCall = 0;
    h.getJob.mockImplementation(() => {
      getJobCall += 1;
      return getJobCall === 1
        ? { id: 'job-1', status: 'running' }
        : { id: 'job-1', status: 'cancelled' };
    });
    h.generateKeywordStrategy.mockResolvedValueOnce({
      strategy: { pageMap: [{ id: 'p1' }] },
      upToDate: false,
      freshPageCount: 1,
    });
    await handleJobActionTool('start_keyword_strategy_generation', { workspace_id: 'ws-1' });
    await vi.runAllTimersAsync();
    expect(h.updateJob).not.toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'done' }));

    getJobCall = 0;
    h.generateKeywordStrategy.mockRejectedValueOnce(new Error('boom'));
    await handleJobActionTool('start_keyword_strategy_generation', { workspace_id: 'ws-1' });
    await vi.runAllTimersAsync();
    expect(h.updateJob).not.toHaveBeenCalledWith('job-1', expect.objectContaining({ error: 'boom' }));
  });

  it('covers remaining seo/local-seo validation and non-Error branches', async () => {
    const invalidSeo = await handleJobActionTool('start_seo_audit', {});
    expect(invalidSeo.isError).toBe(true);
    expect(errorEnvelope(invalidSeo)).toMatchObject({ code: 'validation_failed' });

    h.getWorkspace.mockReturnValueOnce(undefined);
    const missingSeoWorkspace = await handleJobActionTool('start_seo_audit', {
      workspace_id: 'ws-missing',
      site_id: 'site-1',
    });
    expect(missingSeoWorkspace.isError).toBe(true);

    h.runSeoAudit.mockRejectedValueOnce('seo exploded');
    await handleJobActionTool('start_seo_audit', {
      workspace_id: 'ws-1',
      site_id: 'site-1',
    });
    await vi.runAllTimersAsync();
    expect(h.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'error',
      error: 'SEO audit failed unexpectedly. Review the connection and server logs before retrying.',
    }));

    const invalidLocal = await handleJobActionTool('start_local_seo_refresh', {});
    expect(invalidLocal.isError).toBe(true);

    h.getWorkspace.mockReturnValueOnce(undefined);
    const missingLocalWorkspace = await handleJobActionTool('start_local_seo_refresh', {
      workspace_id: 'ws-missing',
      refresh_body: {},
    });
    expect(missingLocalWorkspace.isError).toBe(true);

    const invalidBody = await handleJobActionTool('start_local_seo_refresh', {
      workspace_id: 'ws-1',
      refresh_body: null,
    });
    expect(invalidBody.isError).toBe(true);
  });
});
