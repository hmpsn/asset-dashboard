import { describe, expect, it } from 'vitest';
import { toCockpitRow, partitionByLifecycle, bucketOf, FIX_NOW_CAP } from '../../src/components/strategy/cockpitRowModel';
import type { Recommendation } from '../../shared/types/recommendations';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'r1', workspaceId: 'ws1', type: 'metadata', priority: 'fix_now',
    title: 'Fix titles', description: 'why it matters',
    insight: 'why it matters insight',
    impact: 'high', effort: 'low',
    impactScore: 70, source: 'audit', affectedPages: [], trafficAtRisk: 0, impressionsAtRisk: 0,
    estimatedGain: '', actionType: 'manual', status: 'pending',
    lifecycle: 'active', clientStatus: 'system',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  } as Recommendation;
}

describe('cockpitRowModel', () => {
  it('emits three tag slots in fixed [severity, value, lifecycle] order', () => {
    const row = toCockpitRow(rec({ priority: 'fix_now', lifecycle: 'active' }));
    expect(row.tags.map((t) => t.slot)).toEqual(['severity', 'value', 'lifecycle']);
    expect(row.tags[2].label.toLowerCase()).toContain('active');
  });

  it('maps the accent rail by lifecycle/clientStatus (teal=active, emerald=sent, muted=struck)', () => {
    expect(toCockpitRow(rec({ lifecycle: 'active' })).railTone).toBe('teal');
    expect(toCockpitRow(rec({ clientStatus: 'sent' })).railTone).toBe('emerald');
    expect(toCockpitRow(rec({ lifecycle: 'struck' })).railTone).toBe('muted');
  });

  it('clamps the why/how/result string to a single line (no newlines)', () => {
    const row = toCockpitRow(rec({ description: 'line one\nline two' }));
    expect(row.whyLine).not.toContain('\n');
  });

  it('partitions active/sent/approved/throttled and caps the Fix-now pin', () => {
    const recs = [
      rec({ id: 'a', priority: 'fix_now', lifecycle: 'active', clientStatus: 'system' }),
      rec({ id: 'b', clientStatus: 'sent', lifecycle: 'active' }),
      rec({ id: 'c', clientStatus: 'approved', lifecycle: 'active' }),
      rec({ id: 'd', lifecycle: 'throttled', throttledUntil: new Date(Date.now() + 1e9).toISOString() }),
    ];
    const p = partitionByLifecycle(recs);
    expect(p.active).toBe(1);
    expect(p.sent).toBe(1);
    expect(p.approved).toBe(1);
    expect(p.throttled).toBe(1);
    expect(FIX_NOW_CAP).toBe(5);
  });

  it('resurfaces an expired-throttle rec to Active on read (throttledUntil in the past)', () => {
    const expired = rec({ id: 'e', lifecycle: 'throttled', throttledUntil: new Date(Date.now() - 1000).toISOString() });
    const open = rec({ id: 'o', lifecycle: 'throttled', throttledUntil: new Date(Date.now() + 1e9).toISOString() });
    expect(bucketOf(expired)).toBe('active'); // snooze window passed → resurfaced
    expect(bucketOf(open)).toBe('throttled');
    const p = partitionByLifecycle([expired, open]);
    expect(p.throttled).toBe(1);
    expect(p.active).toBe(1);
  });

  it('sets isFixNow=true for fix_now priority active unsent recs', () => {
    expect(toCockpitRow(rec({ priority: 'fix_now', lifecycle: 'active', clientStatus: 'system' })).isFixNow).toBe(true);
    expect(toCockpitRow(rec({ priority: 'fix_now', clientStatus: 'sent' })).isFixNow).toBe(false);
    expect(toCockpitRow(rec({ priority: 'fix_soon', lifecycle: 'active', clientStatus: 'system' })).isFixNow).toBe(false);
    expect(toCockpitRow(rec({ priority: 'fix_now', lifecycle: 'struck' })).isFixNow).toBe(false);
  });
});
