import { describe, expect, it } from 'vitest';
import {
  projectOperatorPortfolioBrief,
  projectOperatorWorkspaceDecisionBrief,
  type OperatorPortfolioWorkspaceRow,
} from '../../server/domains/analytics-intelligence/operator-read-models.js';

function row(
  workspaceId: string,
  name: string,
  pending: { approvals?: number; requests?: number; clientActions?: number },
): OperatorPortfolioWorkspaceRow {
  const approvals = pending.approvals ?? 0;
  const requests = pending.requests ?? 0;
  const clientActions = pending.clientActions ?? 0;
  const decision = (
    sourceType: 'approval_item' | 'client_request' | 'client_action',
    sourceId: string,
    index: number,
  ) => ({
    sourceType,
    sourceId,
    parentId: sourceType === 'approval_item' ? `batch-${workspaceId}-${index}` : null,
    label: `${sourceType} ${index}`,
    priority: 'medium' as const,
    createdAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  });
  const items = [
    ...Array.from({ length: approvals }, (_, index) => decision(
      'approval_item',
      `approval-${workspaceId}-${index}`,
      index,
    )),
    ...Array.from({ length: requests }, (_, index) => decision(
      'client_request',
      `request-${workspaceId}-${index}`,
      index,
    )),
    ...Array.from({ length: clientActions }, (_, index) => decision(
      'client_action',
      `action-${workspaceId}-${index}`,
      index,
    )),
  ];
  return {
    workspaceId,
    name,
    effectiveTier: 'growth',
    liveDomain: `${workspaceId}.example.com`,
    pendingDecisions: {
      total: approvals + requests + clientActions,
      counts: { approvals, requests, clientActions },
      items,
    },
  };
}

describe('P2 operator portfolio projection', () => {
  it('has a deterministic total order independent of source row order', () => {
    const rows = [
      row('ws-z', 'Zulu', { approvals: 2 }),
      row('ws-a', 'Alpha', { requests: 2 }),
      row('ws-b', 'Beta', { requests: 2 }),
      row('ws-c', 'Alpha', { requests: 2 }),
      row('ws-actions', 'Actions', { clientActions: 9 }),
      row('ws-clear', 'Clear', {}),
    ];
    const shuffled = [rows[5]!, rows[2]!, rows[0]!, rows[4]!, rows[3]!, rows[1]!];

    const first = projectOperatorPortfolioBrief(rows, 25);
    const second = projectOperatorPortfolioBrief(shuffled, 25);

    expect(second).toEqual(first);
    expect(first.workspaces.map(item => item.workspace_id)).toEqual([
      'ws-a',
      'ws-c',
      'ws-b',
      'ws-z',
      'ws-actions',
      'ws-clear',
    ]);
    expect(first.workspaces.map(item => item.attention_rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('caps output and emits exact reason codes, pending totals, and durable drill-down IDs', () => {
    const projected = projectOperatorPortfolioBrief([
      row('ws-mixed', 'Mixed', { requests: 3, approvals: 2, clientActions: 4 }),
      row('ws-clear', 'Clear', {}),
    ], 1);

    expect(projected).toMatchObject({ limit: 1, returned: 1, total_workspaces: 2, has_more: true });
    expect(projected.workspaces[0]).toMatchObject({
      workspace_id: 'ws-mixed',
      pending: { requests: 3, approvals: 2, client_actions: 4, total: 9 },
      reason_codes: ['pending_request', 'pending_approval', 'pending_client_action'],
    });
    expect(projected.workspaces[0]!.drill_down_ids).toHaveLength(9);
    expect(projected.workspaces[0]!.drill_down_ids).toContainEqual({
      source_type: 'client_request',
      source_id: 'request-ws-mixed-0',
    });
    expect(JSON.stringify(projected)).not.toMatch(/payload|evidence|prompt|notes|description/i);
  });
});

describe('P2 workspace decision projection', () => {
  it('caps private queues, preserves durable normalized IDs, and never includes source payloads', () => {
    const pendingDecisions = Array.from({ length: 30 }, (_, index) => ({
      sourceType: index % 2 === 0 ? 'approval_item' as const : 'client_action' as const,
      sourceId: `decision-${index}`,
      parentId: index % 2 === 0 ? `batch-${index}` : null,
      label: `Decision ${index}`,
      priority: index === 0 ? 'urgent' as const : 'medium' as const,
      createdAt: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const brief = projectOperatorWorkspaceDecisionBrief(
      { workspaceId: 'ws-1', name: 'Workspace One', effectiveTier: 'premium' },
      {
        version: 1,
        workspaceId: 'ws-1',
        assembledAt: '2026-07-19T00:00:00.000Z',
        insights: { all: [], byType: {}, countsByType: {}, countsByTypeBySeverity: {}, bySeverity: {}, topByImpact: [] },
        operational: {
          recentActivity: [],
          annotations: [],
          pendingJobs: 0,
          pendingDecisions: {
            total: 30,
            counts: { approvals: 15, requests: 0, clientActions: 15 },
            items: pendingDecisions,
          },
        },
      },
      25,
    );

    expect(brief.pending_decisions).toMatchObject({ total: 30, returned: 25, has_more: true });
    expect(brief.pending_decisions.items).toHaveLength(25);
    expect(brief.pending_decisions.items[0]!.source).toEqual({
      source_type: 'approval_item',
      source_id: 'decision-0',
      parent_id: 'batch-0',
    });
    expect(JSON.stringify(brief)).not.toMatch(/payload|evidence|prompt|notes|recentActivity/i);
  });

  it('reports unavailable slices as a blocker and never claims no action is required', () => {
    const brief = projectOperatorWorkspaceDecisionBrief(
      { workspaceId: 'ws-1', name: 'Workspace One', effectiveTier: 'free' },
      {
        version: 1,
        workspaceId: 'ws-1',
        assembledAt: '2026-07-19T00:00:00.000Z',
      },
      10,
    );

    expect(brief.slice_availability.unavailable).toEqual([
      'insights',
      'contentPipeline',
      'siteHealth',
      'clientSignals',
      'operational',
    ]);
    expect(brief.blockers).toContainEqual(expect.objectContaining({ reason_code: 'data_unavailable' }));
    expect(brief.next_safe_actions.map(item => item.action_code))
      .not.toContain('no_action_required');
    expect(brief.next_safe_actions[0]).toMatchObject({ action_code: 'inspect_data_availability' });
  });
});
