/**
 * Unit tests for pure/exported functions in server/workspace-context-generation-job.ts.
 *
 * The file has two exported pure functions:
 *   1. workspaceContextJobErrorResponse — maps errors to HTTP response shapes (fully pure)
 *   2. startWorkspaceContextGenerationJob — entry point (requires mocking infrastructure)
 *
 * We focus on:
 *   - workspaceContextJobErrorResponse: pure mapping logic for all error types
 *   - startWorkspaceContextGenerationJob: validation paths using vi.mock at module level
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── workspaceContextJobErrorResponse — pure error mapper ──

describe('workspaceContextJobErrorResponse', () => {
  let workspaceContextJobErrorResponse: typeof import('../../server/workspace-context-generation-job.js')['workspaceContextJobErrorResponse'];

  beforeEach(async () => {
    const mod = await import('../../server/workspace-context-generation-job.js');
    workspaceContextJobErrorResponse = mod.workspaceContextJobErrorResponse;
  });

  it('is exported and is a function', () => {
    expect(typeof workspaceContextJobErrorResponse).toBe('function');
  });

  it('returns status 500 and error message for generic Error', () => {
    const err = new Error('Something went wrong');
    const result = workspaceContextJobErrorResponse(err);
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('Something went wrong');
  });

  it('returns status 500 and string representation for non-Error throw', () => {
    const result = workspaceContextJobErrorResponse('raw string error');
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('raw string error');
  });

  it('returns status 500 for numeric throw', () => {
    const result = workspaceContextJobErrorResponse(42);
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('42');
  });

  it('returns status 500 for null throw', () => {
    const result = workspaceContextJobErrorResponse(null);
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('null');
  });

  it('body never includes jobId for generic errors', () => {
    const result = workspaceContextJobErrorResponse(new Error('oops'));
    expect(result.body).not.toHaveProperty('jobId');
  });

  it('response body always has error string property', () => {
    for (const input of [new Error('x'), 'str', 123, undefined, null]) {
      const result = workspaceContextJobErrorResponse(input);
      expect(typeof result.body.error).toBe('string');
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
  });
});

// ── startWorkspaceContextGenerationJob — unknown type validation ──
// We can test the unknown-type guard using a clearly invalid string value
// without mocking getWorkspace because the type check runs first.

describe('startWorkspaceContextGenerationJob — unknown type guard', () => {
  let start: typeof import('../../server/workspace-context-generation-job.js')['startWorkspaceContextGenerationJob'];
  let errResponse: typeof import('../../server/workspace-context-generation-job.js')['workspaceContextJobErrorResponse'];

  beforeEach(async () => {
    const mod = await import('../../server/workspace-context-generation-job.js');
    start = mod.startWorkspaceContextGenerationJob;
    errResponse = mod.workspaceContextJobErrorResponse;
  });

  it('throws with status 400 for completely unknown job type string', async () => {
    try {
      await start('totally_invalid_type' as never, 'ws-any');
      expect.fail('Should have thrown');
    } catch (err) {
      const response = errResponse(err);
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Unknown workspace context generation job type');
    }
  });
});

// ── Mocked-workspace tests ──
// Use vi.mock at top level to intercept workspaces.js before any dynamic import.

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));

vi.mock('../../server/jobs.js', () => ({
  createJob: vi.fn().mockReturnValue({ id: 'new-job-id' }),
  hasActiveJob: vi.fn().mockReturnValue(null),
  updateJob: vi.fn(),
}));

vi.mock('../../server/bridge-infrastructure.js', () => ({
  withWorkspaceLock: vi.fn((id: string, fn: () => unknown) => fn()),
}));

vi.mock('../../server/usage-tracking.js', () => ({
  incrementIfAllowed: vi.fn().mockReturnValue(true),
  decrementUsage: vi.fn(),
}));

vi.mock('../../server/workspace-site-scrape.js', () => ({
  scrapeWorkspaceSite: vi.fn().mockResolvedValue({ scraped: [], pagesSummary: '' }),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn().mockResolvedValue({ text: '[]' }),
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getActionBySource: vi.fn().mockReturnValue(null),
  recordAction: vi.fn().mockReturnValue({ id: 'act-1' }),
}));

describe('startWorkspaceContextGenerationJob — workspace not found', () => {
  let start: typeof import('../../server/workspace-context-generation-job.js')['startWorkspaceContextGenerationJob'];
  let errResponse: typeof import('../../server/workspace-context-generation-job.js')['workspaceContextJobErrorResponse'];

  beforeEach(async () => {
    const { getWorkspace } = await import('../../server/workspaces.js');
    vi.mocked(getWorkspace).mockReturnValue(null as never);
    const mod = await import('../../server/workspace-context-generation-job.js');
    start = mod.startWorkspaceContextGenerationJob;
    errResponse = mod.workspaceContextJobErrorResponse;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when workspace does not exist', async () => {
    try {
      await start('knowledge-base-generation', 'ws-missing');
      expect.fail('Should have thrown');
    } catch (err) {
      const response = errResponse(err);
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Workspace not found');
    }
  });
});

describe('startWorkspaceContextGenerationJob — no webflow site', () => {
  let start: typeof import('../../server/workspace-context-generation-job.js')['startWorkspaceContextGenerationJob'];
  let errResponse: typeof import('../../server/workspace-context-generation-job.js')['workspaceContextJobErrorResponse'];

  beforeEach(async () => {
    const { getWorkspace } = await import('../../server/workspaces.js');
    vi.mocked(getWorkspace).mockReturnValue({ id: 'ws-1', name: 'Test', tier: 'free', webflowSiteId: null } as never);
    const mod = await import('../../server/workspace-context-generation-job.js');
    start = mod.startWorkspaceContextGenerationJob;
    errResponse = mod.workspaceContextJobErrorResponse;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws 400 when workspace has no webflowSiteId', async () => {
    try {
      await start('knowledge-base-generation', 'ws-1');
      expect.fail('Should have thrown');
    } catch (err) {
      const response = errResponse(err);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No Webflow site linked');
    }
  });
});

describe('startWorkspaceContextGenerationJob — already running job (409)', () => {
  let start: typeof import('../../server/workspace-context-generation-job.js')['startWorkspaceContextGenerationJob'];
  let errResponse: typeof import('../../server/workspace-context-generation-job.js')['workspaceContextJobErrorResponse'];

  beforeEach(async () => {
    const { getWorkspace } = await import('../../server/workspaces.js');
    vi.mocked(getWorkspace).mockReturnValue({
      id: 'ws-2', name: 'Running', tier: 'growth', webflowSiteId: 'site-123',
    } as never);

    const { hasActiveJob } = await import('../../server/jobs.js');
    vi.mocked(hasActiveJob).mockReturnValue({ id: 'existing-job-id' } as never);

    const mod = await import('../../server/workspace-context-generation-job.js');
    start = mod.startWorkspaceContextGenerationJob;
    errResponse = mod.workspaceContextJobErrorResponse;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws 409 with existing jobId when same job type already running', async () => {
    try {
      await start('knowledge-base-generation', 'ws-2');
      expect.fail('Should have thrown');
    } catch (err) {
      const response = errResponse(err);
      expect(response.status).toBe(409);
      expect(response.body.jobId).toBe('existing-job-id');
      expect(response.body.error).toContain('already running');
    }
  });
});

describe('startWorkspaceContextGenerationJob — usage limit exceeded (429)', () => {
  let start: typeof import('../../server/workspace-context-generation-job.js')['startWorkspaceContextGenerationJob'];
  let errResponse: typeof import('../../server/workspace-context-generation-job.js')['workspaceContextJobErrorResponse'];

  beforeEach(async () => {
    const { getWorkspace } = await import('../../server/workspaces.js');
    vi.mocked(getWorkspace).mockReturnValue({
      id: 'ws-3', name: 'Limited', tier: 'free', webflowSiteId: 'site-456',
    } as never);

    const { hasActiveJob } = await import('../../server/jobs.js');
    vi.mocked(hasActiveJob).mockReturnValue(null as never);

    const { incrementIfAllowed } = await import('../../server/usage-tracking.js');
    vi.mocked(incrementIfAllowed).mockReturnValue(false); // Usage limit hit

    const mod = await import('../../server/workspace-context-generation-job.js');
    start = mod.startWorkspaceContextGenerationJob;
    errResponse = mod.workspaceContextJobErrorResponse;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws 429 when monthly AI generation limit is reached', async () => {
    try {
      await start('knowledge-base-generation', 'ws-3');
      expect.fail('Should have thrown');
    } catch (err) {
      const response = errResponse(err);
      expect(response.status).toBe(429);
      expect(response.body.error).toContain('Monthly AI generation limit reached');
    }
  });
});
