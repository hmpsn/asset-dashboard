import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the job platform + grounded generation service entry points + workspace/brief reads.
// The MCP tool must delegate ALL generation + persistence + job lifecycle to these shared
// services — it never writes the DB or marks the job done/failed itself.
vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));
vi.mock('../../server/content-brief.js', () => ({
  getBrief: vi.fn(),
}));
vi.mock('../../server/content-requests.js', () => ({
  getContentRequest: vi.fn(),
}));
vi.mock('../../server/content-brief-generation-job.js', () => {
  class ContentRequestGenerationConflictError extends Error {
    readonly code = 'content_request_generation_conflict';
    readonly requestId: string;
    readonly expectedRequestUpdatedAt: string;
    constructor(
      requestId: string,
      expectedRequestUpdatedAt: string,
    ) {
      super('The content request changed while brief generation was running');
      this.name = 'ContentRequestGenerationConflictError';
      this.requestId = requestId;
      this.expectedRequestUpdatedAt = expectedRequestUpdatedAt;
    }
  }
  return {
    ContentRequestGenerationConflictError,
    startContentBriefGenerationJob: vi.fn(),
  };
});
vi.mock('../../server/content-posts.js', () => ({
  createContentPostGenerationJob: vi.fn(),
  runContentPostGenerationJob: vi.fn(),
}));
vi.mock('../../server/jobs.js', () => {
  class ActiveJobResourceConflict extends Error {
    readonly code = 'active_job_resource_conflict';
    readonly jobId: string;
    constructor(owners: Array<{ jobId: string }>) {
      super('A job is already active for this resource');
      this.name = 'ActiveJobResourceConflict';
      this.jobId = owners[0].jobId;
    }
  }
  return {
    ActiveJobResourceConflict,
    updateJob: vi.fn(),
  };
});

import { getWorkspace } from '../../server/workspaces.js';
import { getBrief } from '../../server/content-brief.js';
import { getContentRequest } from '../../server/content-requests.js';
import { startContentBriefGenerationJob } from '../../server/content-brief-generation-job.js';
import { createContentPostGenerationJob, runContentPostGenerationJob } from '../../server/content-posts.js';
import { ActiveJobResourceConflict, updateJob } from '../../server/jobs.js';
import { ContentRequestGenerationConflictError } from '../../server/content-brief-generation-job.js';
import { GenerationRevisionConflictError } from '../../server/generation-provenance.js';
import { __resetPaidCallCounterForTests, getPaidCallCount } from '../../server/mcp/paid-call-counter.js';
import {
  contentGenerationActionTools,
  handleContentGenerationActionTool,
} from '../../server/mcp/tools/content-generation-actions.js';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const SAMPLE_BRIEF = {
  id: 'brief_1',
  workspaceId: 'ws-1',
  targetKeyword: 'hvac maintenance',
  suggestedTitle: 'HVAC Maintenance Guide',
  outline: [{ heading: 'H2', notes: 'n', keywords: [], wordCount: 250 }],
  wordCountTarget: 1200,
  generationRevision: 7,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const REQUEST_UPDATED_AT = '2026-07-14T12:00:00.000Z';

describe('mcp content generation action tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPaidCallCounterForTests();
    mock(getWorkspace).mockReturnValue({ id: 'ws-1', name: 'Workspace' });
    mock(getBrief).mockReturnValue(SAMPLE_BRIEF);
    mock(getContentRequest).mockReturnValue({
      id: 'cr_1',
      targetKeyword: 'hvac maintenance',
      updatedAt: REQUEST_UPDATED_AT,
    });
    mock(startContentBriefGenerationJob).mockReturnValue({ jobId: 'job_brief_1' });
    mock(createContentPostGenerationJob).mockReturnValue({
      jobId: 'job_post_1',
      postId: 'post_1',
      post: { id: 'post_1', status: 'generating' },
      brief: SAMPLE_BRIEF,
      expectedRevision: 3,
    });
    mock(runContentPostGenerationJob).mockReturnValue(undefined);
  });

  it('registers exactly the two generation tool names', () => {
    expect(contentGenerationActionTools.map(t => t.name)).toEqual([
      'start_brief_generation',
      'start_post_generation',
    ]);
  });

  // --- start_brief_generation ----------------------------------------------

  it('start_brief_generation (standalone) creates a job via the service and returns job_id', async () => {
    const result = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-1',
      target_keyword: 'hvac maintenance',
      business_context: 'HVAC repair company',
      page_type: 'blog',
      reference_urls: ['https://example.com/a'],
      generation_style: 'standard',
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as { job_id: string; job_type: string };
    expect(payload.job_id).toBe('job_brief_1');
    expect(payload.job_type).toBe('content-brief-generation');
    expect(startContentBriefGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'standalone',
        workspaceId: 'ws-1',
        targetKeyword: 'hvac maintenance',
        businessContext: 'HVAC repair company',
        pageType: 'blog',
        referenceUrls: ['https://example.com/a'],
        generationStyle: 'standard',
      }),
    );
    // Paid AI work runs inside the job — the tool counts it.
    expect(getPaidCallCount()).toBe(1);
    // ...and attributes it to the workspace (workspaceId threaded as the 2nd arg).
    expect(getPaidCallCount('ws-1')).toBe(1);
  });

  it('start_brief_generation (request) routes through the request source and validates the request exists', async () => {
    const result = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-1',
      request_id: 'cr_1',
      expected_request_updated_at: REQUEST_UPDATED_AT,
      generation_style: 'concise',
    });

    expect(result.isError).toBeUndefined();
    expect(getContentRequest).toHaveBeenCalledWith('ws-1', 'cr_1');
    expect(startContentBriefGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'request',
        workspaceId: 'ws-1',
        requestId: 'cr_1',
        expectedRequestUpdatedAt: REQUEST_UPDATED_AT,
        generationStyle: 'concise',
      }),
    );
  });

  it('start_brief_generation errors when neither target_keyword nor request_id is given', async () => {
    const result = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-1',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('target_keyword');
    expect(startContentBriefGenerationJob).not.toHaveBeenCalled();
  });

  it('start_brief_generation errors when the request id is not found', async () => {
    mock(getContentRequest).mockReturnValue(undefined);
    const result = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-1',
      request_id: 'cr_missing',
      expected_request_updated_at: REQUEST_UPDATED_AT,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Content request not found');
    expect(startContentBriefGenerationJob).not.toHaveBeenCalled();
  });

  it('start_brief_generation maps a same-resource active job conflict without counting paid work', async () => {
    mock(startContentBriefGenerationJob).mockImplementation(() => {
      throw new ActiveJobResourceConflict([{ jobId: 'job_existing' } as never]);
    });
    const result = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-1',
      target_keyword: 'hvac maintenance',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('[active_job_resource_conflict]');
    expect(result.content[0].text).toContain('active_job_id=job_existing');
    expect(getPaidCallCount()).toBe(0);
  });

  it('start_brief_generation requires the observed request token', async () => {
    const result = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-1',
      request_id: 'cr_1',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('expected_request_updated_at');
    expect(startContentBriefGenerationJob).not.toHaveBeenCalled();
    expect(getPaidCallCount()).toBe(0);
  });

  it('start_brief_generation maps a stale request token deterministically', async () => {
    mock(startContentBriefGenerationJob).mockImplementation(() => {
      throw new ContentRequestGenerationConflictError('cr_1', REQUEST_UPDATED_AT);
    });
    const result = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-1',
      request_id: 'cr_1',
      expected_request_updated_at: REQUEST_UPDATED_AT,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('[content_request_generation_conflict]');
    expect(result.content[0].text).toContain('cr_1');
    expect(getPaidCallCount()).toBe(0);
  });

  it('allows disjoint generation resources to start in the same workspace', async () => {
    mock(startContentBriefGenerationJob)
      .mockReturnValueOnce({ jobId: 'job_disjoint_1' })
      .mockReturnValueOnce({ jobId: 'job_disjoint_2' });
    const first = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-1',
      target_keyword: 'hvac maintenance',
    });
    const second = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-1',
      target_keyword: 'furnace repair',
    });
    expect(first.isError).toBeUndefined();
    expect(second.isError).toBeUndefined();
    expect(startContentBriefGenerationJob).toHaveBeenCalledTimes(2);
    expect(getPaidCallCount('ws-1')).toBe(2);
  });

  it('start_brief_generation rejects an unknown workspace', async () => {
    mock(getWorkspace).mockReturnValueOnce(undefined);
    const result = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-missing',
      target_keyword: 'hvac maintenance',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Workspace not found');
  });

  it('start_brief_generation validates required inputs via zod (workspace_id)', async () => {
    const result = await handleContentGenerationActionTool('start_brief_generation', {
      target_keyword: 'hvac maintenance',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
    expect(startContentBriefGenerationJob).not.toHaveBeenCalled();
  });

  // FM-2: a generation start failure must surface as an MCP error, not a false success.
  it('start_brief_generation surfaces a service start failure as an error (FM-2)', async () => {
    mock(startContentBriefGenerationJob).mockImplementation(() => {
      throw new Error('provider unavailable');
    });
    const result = await handleContentGenerationActionTool('start_brief_generation', {
      workspace_id: 'ws-1',
      target_keyword: 'hvac maintenance',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to start brief generation: provider unavailable');
    // No false "ok" payload — paid call is only recorded on a successful start.
    expect(getPaidCallCount()).toBe(0);
  });

  // --- start_post_generation -----------------------------------------------

  it('start_post_generation creates a job from a brief and kicks off the runner', async () => {
    const result = await handleContentGenerationActionTool('start_post_generation', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
      expected_brief_revision: 7,
      generation_style: 'hybrid',
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as { job_id: string; post_id: string; job_type: string };
    expect(payload.job_id).toBe('job_post_1');
    expect(payload.post_id).toBe('post_1');
    expect(payload.job_type).toBe('content-post-generation');
    expect(getBrief).toHaveBeenCalledWith('ws-1', 'brief_1');
    expect(createContentPostGenerationJob).toHaveBeenCalledWith('ws-1', SAMPLE_BRIEF, 'hybrid', 7);
    expect(runContentPostGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        postId: 'post_1',
        jobId: 'job_post_1',
        expectedRevision: 3,
      }),
    );
    expect(getPaidCallCount()).toBe(1);
  });

  it('start_post_generation errors when the brief is not found', async () => {
    mock(getBrief).mockReturnValue(undefined);
    const result = await handleContentGenerationActionTool('start_post_generation', {
      workspace_id: 'ws-1',
      brief_id: 'brief_missing',
      expected_brief_revision: 0,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Brief not found');
    expect(createContentPostGenerationJob).not.toHaveBeenCalled();
    expect(runContentPostGenerationJob).not.toHaveBeenCalled();
  });

  it('start_post_generation maps a same-resource active job conflict', async () => {
    mock(createContentPostGenerationJob).mockImplementation(() => {
      throw new ActiveJobResourceConflict([{ jobId: 'job_existing_post' } as never]);
    });
    const result = await handleContentGenerationActionTool('start_post_generation', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
      expected_brief_revision: 7,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('[active_job_resource_conflict]');
    expect(result.content[0].text).toContain('active_job_id=job_existing_post');
    expect(runContentPostGenerationJob).not.toHaveBeenCalled();
    expect(getPaidCallCount()).toBe(0);
  });

  it('start_post_generation maps a stale brief revision without starting provider work', async () => {
    mock(createContentPostGenerationJob).mockImplementation(() => {
      throw new GenerationRevisionConflictError('content_brief', 'brief_1', 6);
    });
    const result = await handleContentGenerationActionTool('start_post_generation', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
      expected_brief_revision: 6,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('[generation_revision_conflict]');
    expect(result.content[0].text).toContain('expected revision 6');
    expect(runContentPostGenerationJob).not.toHaveBeenCalled();
    expect(getPaidCallCount()).toBe(0);
  });

  it('start_post_generation validates required inputs via zod (brief_id)', async () => {
    const result = await handleContentGenerationActionTool('start_post_generation', {
      workspace_id: 'ws-1',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
    expect(createContentPostGenerationJob).not.toHaveBeenCalled();
  });

  it('start_post_generation requires the observed brief revision', async () => {
    const result = await handleContentGenerationActionTool('start_post_generation', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('expected_brief_revision');
    expect(createContentPostGenerationJob).not.toHaveBeenCalled();
    expect(runContentPostGenerationJob).not.toHaveBeenCalled();
    expect(getPaidCallCount()).toBe(0);
  });

  // FM-2: a job-creation failure must surface as an MCP error, not a false success.
  it('start_post_generation surfaces a job-creation failure as an error (FM-2)', async () => {
    mock(createContentPostGenerationJob).mockImplementation(() => {
      throw new Error('Content post generation already running for this workspace: job_x');
    });
    const result = await handleContentGenerationActionTool('start_post_generation', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
      expected_brief_revision: 7,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to start post generation');
    expect(runContentPostGenerationJob).not.toHaveBeenCalled();
    expect(getPaidCallCount()).toBe(0);
  });

  // FM-2: when the grounded generator throws inside the runner, the shared runner marks the
  // job FAILED (via updateJob status:'error'). The tool delegates that lifecycle to the runner
  // — assert the runner is invoked and owns the failure transition rather than reporting success.
  it('start_post_generation delegates generator failures to the runner (job marked failed)', async () => {
    mock(runContentPostGenerationJob).mockImplementation(({ jobId }: { jobId: string }) => {
      // Simulate the real runner's catch branch on a generator throw.
      updateJob(jobId, { status: 'error', error: 'generation boom', message: 'Post generation failed' });
    });
    const result = await handleContentGenerationActionTool('start_post_generation', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
      expected_brief_revision: 7,
    });
    // The start tool still returns a job_id (async failure surfaces via get_job_status).
    expect(result.isError).toBeUndefined();
    expect(runContentPostGenerationJob).toHaveBeenCalledOnce();
    expect(updateJob).toHaveBeenCalledWith(
      'job_post_1',
      expect.objectContaining({ status: 'error', error: 'generation boom' }),
    );
  });

  it('returns an unknown-tool error for an unrecognized name', async () => {
    const result = await handleContentGenerationActionTool('unknown_generation_tool', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown content generation action tool');
  });
});
