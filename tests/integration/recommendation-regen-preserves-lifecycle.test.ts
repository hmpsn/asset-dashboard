/**
 * Strategy v3 Phase 1 exit gate (00-contracts §6.3, spec §6.3 / audit prevention #3).
 * Carry-over: send a rec (clientStatus='sent'), run a regen merge, assert clientStatus
 * is STILL 'sent' afterward. Guards the merge carry-over at recommendations.ts ~2364-2382,
 * which pre-v3 copied only status/id/createdAt and would silently drop the lifecycle axis.
 *
 * Uses applyLifecycleCarryOver directly (the pure merge helper Lane 1B extracts) so the test
 * is fast + deterministic — no full generateRecommendations crawl.
 */
import { describe, it, expect } from 'vitest';
import { applyLifecycleCarryOver } from '../../server/recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'old1', workspaceId: 'ws1', priority: 'fix_now', type: 'metadata',
    title: 'Fix meta', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 50, source: 'audit:meta', affectedPages: ['home'], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

describe('regen preserves the client-facing lifecycle axis', () => {
  it('carries clientStatus=sent + sentAt onto the freshly-minted matching rec', () => {
    const sentAt = new Date(Date.now() - 3_600_000).toISOString();
    const oldRec = rec({ id: 'old1', clientStatus: 'sent', sentAt, status: 'pending' });
    // a freshly-minted rec from the new run with the SAME merge key (source+pages+title)
    const newRec = rec({ id: 'new1', status: 'pending' });

    applyLifecycleCarryOver([newRec], [oldRec]);

    expect(newRec.clientStatus).toBe('sent');
    expect(newRec.sentAt).toBe(sentAt);
    expect(newRec.id).toBe('old1'); // continuity: keep the old id
  });

  it('carries struck + throttled lifecycle and cascade metadata across a regen', () => {
    const struckAt = new Date(Date.now() - 7_200_000).toISOString();
    const oldStruck = rec({ id: 'old2', source: 'audit:keyword', title: 'kw', lifecycle: 'struck', struckAt, cascade: { removedKeywords: ['foo'], reversible: true } });
    const newStruck = rec({ id: 'new2', source: 'audit:keyword', title: 'kw' });

    applyLifecycleCarryOver([newStruck], [oldStruck]);

    expect(newStruck.lifecycle).toBe('struck');
    expect(newStruck.struckAt).toBe(struckAt);
    expect(newStruck.cascade?.removedKeywords).toEqual(['foo']);
  });

  it('leaves a brand-new rec with no matching old rec untouched (no lifecycle injected)', () => {
    const fresh = rec({ id: 'fresh', source: 'audit:new-check', title: 'new' });
    applyLifecycleCarryOver([fresh], []);
    expect(fresh.clientStatus).toBeUndefined();
    expect(fresh.lifecycle).toBeUndefined();
  });
});
