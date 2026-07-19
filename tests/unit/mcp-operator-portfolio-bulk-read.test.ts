import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listWorkspaceIdentities: vi.fn(),
  readAllOperatorPendingDecisions: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  computeEffectiveTier: () => 'growth',
  getWorkspace: vi.fn(),
  listWorkspaceIdentities: mocks.listWorkspaceIdentities,
}));
vi.mock('../../server/domains/analytics-intelligence/operator-pending-decisions.js', () => ({
  readAllOperatorPendingDecisions: mocks.readAllOperatorPendingDecisions,
}));
vi.mock('../../server/workspace-intelligence.js', () => ({ buildWorkspaceIntelligence: vi.fn() }));
vi.mock('../../server/client-insight-view-model.js', () => ({
  buildClientIntelligenceView: vi.fn(),
  clientIntelligenceSlicesForTier: vi.fn(),
}));

const { buildOperatorPortfolioBrief } = await import(
  '../../server/domains/analytics-intelligence/operator-read-models.js'
);

describe('operator portfolio bulk read path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspaceIdentities.mockReturnValue([
      { id: 'ws-a', name: 'A', liveDomain: null, tier: 'free' },
      { id: 'ws-b', name: 'B', liveDomain: null, tier: 'growth' },
    ]);
    mocks.readAllOperatorPendingDecisions.mockReturnValue(new Map());
  });

  it('uses one skinny workspace read and one bulk pending-decision read', () => {
    const result = buildOperatorPortfolioBrief(10);

    expect(mocks.listWorkspaceIdentities).toHaveBeenCalledTimes(1);
    expect(mocks.readAllOperatorPendingDecisions).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ returned: 2, total_workspaces: 2 });
  });
});
