import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workspace } from '../../shared/types/workspace.js';

const state = vi.hoisted(() => ({
  workspace: null as Workspace | null,
  incrementIfAllowed: vi.fn(() => false),
}));

vi.mock('../../server/workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspaces.js')>();
  return {
    ...actual,
    getWorkspace: vi.fn(() => state.workspace),
  };
});

vi.mock('../../server/usage-tracking.js', () => ({
  incrementIfAllowed: state.incrementIfAllowed,
  decrementUsage: vi.fn(),
}));

vi.mock('../../server/jobs.js', () => ({
  createJob: vi.fn(() => ({ id: 'job_effective_tier' })),
  hasActiveJob: vi.fn(() => null),
  updateJob: vi.fn(),
}));

vi.mock('../../server/bridge-infrastructure.js', () => ({
  withWorkspaceLock: vi.fn((_workspaceId: string, fn: () => unknown) => fn()),
}));

const { generateKeywordStrategy, KeywordStrategyGenerationError } = await import(
  '../../server/keyword-strategy-generation.js'
);
const {
  startWorkspaceContextGenerationJob,
  workspaceContextJobErrorResponse,
} = await import('../../server/workspace-context-generation-job.js');

const tierCases = [
  {
    label: 'active Free trial',
    workspace: { tier: 'free', trialEndsAt: '2999-01-01T00:00:00.000Z' },
    expectedTier: 'growth',
  },
  {
    label: 'expired Free trial',
    workspace: { tier: 'free', trialEndsAt: '2000-01-01T00:00:00.000Z' },
    expectedTier: 'free',
  },
  {
    label: 'Premium workspace',
    workspace: { tier: 'premium', trialEndsAt: '2999-01-01T00:00:00.000Z' },
    expectedTier: 'premium',
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  state.incrementIfAllowed.mockReturnValue(false);
});

describe('canonical effective-tier usage reservations', () => {
  it.each(tierCases)('meters keyword strategy as $expectedTier for $label', async ({ workspace, expectedTier }) => {
    state.workspace = {
      id: `ws_keyword_${expectedTier}`,
      name: 'Keyword tier test',
      webflowSiteId: 'site_keyword',
      ...workspace,
    } as Workspace;

    await expect(generateKeywordStrategy({ workspaceId: state.workspace.id }))
      .rejects.toMatchObject<Partial<KeywordStrategyGenerationError>>({ statusCode: 429 });

    expect(state.incrementIfAllowed).toHaveBeenCalledOnce();
    expect(state.incrementIfAllowed).toHaveBeenCalledWith(
      state.workspace.id,
      expectedTier,
      'strategy_generations',
    );
  });

  it.each(tierCases)('meters workspace-context jobs as $expectedTier for $label', async ({ workspace, expectedTier }) => {
    state.workspace = {
      id: `ws_context_${expectedTier}`,
      name: 'Context tier test',
      webflowSiteId: 'site_context',
      ...workspace,
    } as Workspace;

    let caught: unknown;
    try {
      await startWorkspaceContextGenerationJob(
        'knowledge-base-generation',
        state.workspace.id,
      );
    } catch (err) {
      caught = err;
    }

    expect(workspaceContextJobErrorResponse(caught).status).toBe(429);
    expect(state.incrementIfAllowed).toHaveBeenCalledOnce();
    expect(state.incrementIfAllowed).toHaveBeenCalledWith(
      state.workspace.id,
      expectedTier,
      'workspace_context_generations',
    );
  });
});
