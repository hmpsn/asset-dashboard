import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalSlice } from '../../shared/types/intelligence.js';

type PendingSummary = NonNullable<OperationalSlice['pendingDecisions']>;

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

function summary(requests: number, approvals: number): PendingSummary {
  return {
    availability: 'available',
    total: requests + approvals,
    counts: { requests, approvals, clientActions: 0 },
    items: [],
  };
}

describe('operator portfolio detail selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspaceIdentities.mockReturnValue([
      { id: 'ws-a', name: 'Alpha', liveDomain: null, tier: 'growth' },
      { id: 'ws-b', name: 'Beta', liveDomain: null, tier: 'growth' },
      { id: 'ws-c', name: 'Charlie', liveDomain: null, tier: 'growth' },
    ]);
  });

  it('selects details only for the deterministically ranked output page', () => {
    let selectedIds: readonly string[] = [];
    mocks.readAllOperatorPendingDecisions.mockImplementation((options: {
      selectDetailWorkspaceIds?: (
        countsByWorkspace: ReadonlyMap<string, PendingSummary>,
      ) => readonly string[];
    }) => {
      const counts = new Map<string, PendingSummary>([
        ['ws-a', summary(0, 99)],
        ['ws-b', summary(3, 0)],
        ['ws-c', summary(2, 0)],
      ]);
      selectedIds = options.selectDetailWorkspaceIds?.(counts) ?? [];
      for (const workspaceId of selectedIds) {
        const current = counts.get(workspaceId)!;
        counts.set(workspaceId, {
          ...current,
          items: [{
            sourceType: 'client_request',
            sourceId: `request-${workspaceId}`,
            parentId: null,
            label: `Request ${workspaceId}`,
            priority: 'medium',
            createdAt: '2026-07-19T00:00:00.000Z',
          }],
        });
      }
      return counts;
    });

    const result = buildOperatorPortfolioBrief(2);

    expect(mocks.readAllOperatorPendingDecisions).toHaveBeenCalledTimes(1);
    expect(selectedIds).toEqual(['ws-b', 'ws-c']);
    expect(result.total_workspaces).toBe(3);
    expect(result.workspaces.map((workspace) => workspace.workspace_id)).toEqual(['ws-b', 'ws-c']);
    expect(result.workspaces.map((workspace) => workspace.drill_down_ids)).toEqual([
      [{ source_type: 'client_request', source_id: 'request-ws-b' }],
      [{ source_type: 'client_request', source_id: 'request-ws-c' }],
    ]);
  });
});
