import { describe, expect, it } from 'vitest';
import { buildCockpitPortfolioRollup } from '../../server/domains/cockpit-portfolio.js';
import type { CockpitVerdict, CockpitVerdictStatus } from '../../shared/types/cockpit.js';
import type { WorkQueueClassification } from '../../shared/types/work-queue.js';

const generatedAt = new Date('2026-07-17T15:30:00.000Z');

function queue(
  streams: WorkQueueClassification['streams'],
  negativeItemCount = 0,
): WorkQueueClassification {
  const streamList = (Object.entries(streams) as Array<[keyof typeof streams, number]>)
    .flatMap(([stream, count]) => Array.from({ length: count }, (_, index) => ({
      stream,
      id: `${stream}-${index}`,
      title: `${stream} item ${index}`,
      meta: 'Unit fixture',
      sourceType: 'request' as const,
      direction: 'neutral' as const,
    })))
    .map((item, index) => ({
      ...item,
      direction: index < negativeItemCount ? 'negative' as const : 'neutral' as const,
    }));
  return { streams, items: streamList };
}

function verdict(status: CockpitVerdictStatus, valueAtStake: number): CockpitVerdict {
  return {
    status,
    headline: `${status} headline`,
    narrative: `${status} narrative`,
    generatedAt: generatedAt.toISOString(),
    evidence: [{ label: 'Value at stake', value: valueAtStake, tone: 'positive' }],
  };
}

describe('buildCockpitPortfolioRollup', () => {
  it('ranks workspaces by verdict attention, then negative, unsorted, and total queue counts', () => {
    const rollup = buildCockpitPortfolioRollup([
      {
        workspaceId: 'ws-watch-busy',
        workspaceName: 'Watch Busy',
        workQueue: queue({ opt: 8, send: 0, money: 0, unclassified: 1 }, 3),
        verdict: verdict('watch', 999_999),
      },
      {
        workspaceId: 'ws-risk-low',
        workspaceName: 'Risk Low',
        workQueue: queue({ opt: 1, send: 0, money: 0, unclassified: 0 }, 1),
        verdict: verdict('at_risk', 1),
      },
      {
        workspaceId: 'ws-watch-unsorted',
        workspaceName: 'Watch Unsorted',
        workQueue: queue({ opt: 1, send: 0, money: 0, unclassified: 2 }, 3),
        verdict: verdict('watch', 2),
      },
      {
        workspaceId: 'ws-establishing',
        workspaceName: 'Establishing',
        workQueue: queue({ opt: 0, send: 0, money: 0, unclassified: 0 }),
        verdict: verdict('establishing', 3),
      },
      {
        workspaceId: 'ws-on-track',
        workspaceName: 'On Track',
        workQueue: queue({ opt: 0, send: 0, money: 0, unclassified: 0 }),
        verdict: verdict('on_track', 4),
      },
    ], { generatedAt });

    expect(rollup.workspaces.map(row => row.workspaceId)).toEqual([
      'ws-risk-low',
      'ws-watch-unsorted',
      'ws-watch-busy',
      'ws-establishing',
      'ws-on-track',
    ]);
    expect(rollup.workspaces.map(row => row.attention.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rollup.workspaces.map(row => row.attention.needsAttention)).toEqual([true, true, true, true, false]);
  });

  it('sums only reconcilable classification/verdict counts and explicitly withholds money totals', () => {
    const rollup = buildCockpitPortfolioRollup([
      {
        workspaceId: 'ws-a',
        workspaceName: 'A',
        workQueue: queue({ opt: 2, send: 1, money: 1, unclassified: 0 }, 1),
        verdict: verdict('at_risk', 100_000),
      },
      {
        workspaceId: 'ws-b',
        workspaceName: 'B',
        workQueue: queue({ opt: 1, send: 2, money: 0, unclassified: 1 }),
        verdict: verdict('watch', 200_000),
      },
    ], { generatedAt });

    expect(rollup.generatedAt).toBe(generatedAt.toISOString());
    expect(rollup.totals.workspaces).toEqual({ status: 'reconciled', value: 2 });
    expect(rollup.totals.attentionNeeded).toEqual({ status: 'reconciled', value: 2 });
    expect(rollup.totals.workQueue).toEqual({
      status: 'reconciled',
      value: {
        itemCount: 8,
        streams: { opt: 3, send: 3, money: 1, unclassified: 1 },
      },
    });
    expect(rollup.totals.verdicts).toEqual({
      status: 'reconciled',
      value: { at_risk: 1, watch: 1, establishing: 0, on_track: 0 },
    });
    expect(rollup.totals.valueAtStake).toEqual({
      status: 'not_yet_reconcilable',
      value: null,
      reason: expect.any(String),
    });
    expect(rollup.totals.recoveredSoFar).toEqual({
      status: 'not_yet_reconcilable',
      value: null,
      reason: expect.any(String),
    });
  });
});
