import { describe, it, expect } from 'vitest';
import { buildAttentionItems, countSentThisCycle } from '../../../src/components/strategy/cockpitAttention';
import type { Recommendation } from '../../../shared/types/recommendations';

const NOW = Date.parse('2026-06-18T00:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'r1', workspaceId: 'ws1', type: 'content', priority: 'fix_now',
    title: 'Write the pricing post', description: 'why it matters',
    insight: 'insight text',
    impact: 'high', effort: 'low', impactScore: 80,
    source: 'audit', affectedPages: ['/pricing'],
    trafficAtRisk: 0, impressionsAtRisk: 0,
    estimatedGain: '', actionType: 'content_creation',
    status: 'pending', lifecycle: 'active', clientStatus: 'system',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Recommendation;
}

describe('buildAttentionItems', () => {
  it('flags a sent rec past the 14d threshold as stale_sent', () => {
    const recs = [makeRec({ id: 'a', clientStatus: 'sent', sentAt: daysAgo(20) })];
    const items = buildAttentionItems(recs, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ recId: 'a', kind: 'stale_sent', detail: 'No client response in 20 days' });
  });

  it('does NOT flag a sent rec that is only 13d old (not yet stale)', () => {
    const recs = [makeRec({ id: 'a', clientStatus: 'sent', sentAt: daysAgo(13) })];
    expect(buildAttentionItems(recs, NOW)).toHaveLength(0);
  });

  it('takes superseded precedence when a newer system/curated rec overlaps a page', () => {
    const recs = [
      makeRec({ id: 'old', clientStatus: 'sent', sentAt: daysAgo(20), affectedPages: ['/pricing'] }),
      makeRec({
        id: 'new', clientStatus: 'system', lifecycle: 'active',
        affectedPages: ['/pricing'], createdAt: daysAgo(2),
      }),
    ];
    const items = buildAttentionItems(recs, NOW);
    const oldItem = items.find((i) => i.recId === 'old');
    expect(oldItem?.kind).toBe('superseded');
    expect(oldItem?.detail).toBe('A newer recommendation now covers /pricing');
  });

  it('does NOT supersede when the overlapping rec is OLDER than the sent rec', () => {
    const recs = [
      makeRec({ id: 'old', clientStatus: 'sent', sentAt: daysAgo(20), affectedPages: ['/pricing'] }),
      makeRec({
        id: 'older', clientStatus: 'system', lifecycle: 'active',
        affectedPages: ['/pricing'], createdAt: daysAgo(30),
      }),
    ];
    const items = buildAttentionItems(recs, NOW);
    expect(items.find((i) => i.recId === 'old')?.kind).toBe('stale_sent');
  });

  it('does NOT supersede when the newer rec is struck or throttled', () => {
    const recs = [
      makeRec({ id: 'old', clientStatus: 'sent', sentAt: daysAgo(20), affectedPages: ['/pricing'] }),
      makeRec({
        id: 'struck', clientStatus: 'system', lifecycle: 'struck',
        affectedPages: ['/pricing'], createdAt: daysAgo(2),
      }),
    ];
    const items = buildAttentionItems(recs, NOW);
    expect(items.find((i) => i.recId === 'old')?.kind).toBe('stale_sent');
  });

  it('emits new_reply for every discussing rec', () => {
    const recs = [makeRec({ id: 'a', clientStatus: 'discussing' })];
    const items = buildAttentionItems(recs, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      recId: 'a', kind: 'new_reply', title: 'Write the pricing post',
      detail: 'Client discussion is active on this move',
    });
  });

  it('returns no items for a fresh active set', () => {
    const recs = [makeRec({ id: 'a', clientStatus: 'system', lifecycle: 'active' })];
    expect(buildAttentionItems(recs, NOW)).toHaveLength(0);
  });
});

describe('countSentThisCycle', () => {
  it('counts only clientStatus === sent recs', () => {
    const recs = [
      makeRec({ id: 'a', clientStatus: 'sent' }),
      makeRec({ id: 'b', clientStatus: 'sent' }),
      makeRec({ id: 'c', clientStatus: 'system' }),
      makeRec({ id: 'd', clientStatus: 'approved' }),
    ];
    expect(countSentThisCycle(recs)).toBe(2);
  });

  it('excludes throttled-open sent recs so it agrees with the Sent lifecycle bucket', () => {
    const recs = [
      makeRec({ id: 'a', clientStatus: 'sent' }),
      makeRec({ id: 'b', clientStatus: 'sent', lifecycle: 'throttled', throttledUntil: daysAgo(-30) }), // open throttle (future) → excluded
      makeRec({ id: 'c', clientStatus: 'sent', lifecycle: 'throttled', throttledUntil: daysAgo(30) }),  // expired throttle (past) → still counts
    ];
    expect(countSentThisCycle(recs, NOW)).toBe(2);
  });
});
