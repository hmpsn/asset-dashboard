import { describe, it, expect } from 'vitest';
import { deriveStance } from '../../src/lib/recStance';
import type { Recommendation } from '../../shared/types/recommendations';

// Throttle windows for the expiry-aware parked/active classification.
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();  // +1 day → still parked
const PAST = new Date(Date.now() - 86_400_000).toISOString();    // -1 day → expired, resurfaces

function makeRec(overrides: Partial<Recommendation>): Recommendation {
  return {
    id: 'r1',
    workspaceId: 'ws1',
    priority: 'fix_now',
    type: 'content',
    title: 'Test rec',
    description: 'desc',
    insight: 'insight',
    impact: 'high',
    effort: 'medium',
    impactScore: 80,
    source: 'test',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'some',
    actionType: 'manual',
    status: 'pending',
    lifecycle: 'active',
    clientStatus: 'system',
    ...overrides,
  } as Recommendation;
}

describe('deriveStance', () => {
  it('counts archetypes + cut/parked from the active+lifecycle set (plan spec example)', () => {
    const recs = [
      makeRec({ type: 'content', lifecycle: 'active', clientStatus: 'system' }),
      makeRec({ type: 'content_refresh', lifecycle: 'active', clientStatus: 'system' }),
      makeRec({ type: 'cannibalization', lifecycle: 'throttled', throttledUntil: FUTURE, clientStatus: 'system' }),
      makeRec({ type: 'schema', lifecycle: 'struck', clientStatus: 'system' }),
    ];
    const s = deriveStance(recs);
    expect(s.byArchetype.authority_bet).toBe(1);
    expect(s.byArchetype.refresh_reclaim).toBe(1);
    expect(s.parked).toBe(1);  // throttled with a future window
    expect(s.cut).toBe(1);    // struck
  });

  it('counts zero for archetypes with no active recs', () => {
    const recs = [
      makeRec({ type: 'technical', lifecycle: 'active', clientStatus: 'system' }),
    ];
    const s = deriveStance(recs);
    expect(s.byArchetype.technical).toBe(1);
    expect(s.byArchetype.authority_bet).toBe(0);
    expect(s.byArchetype.local).toBe(0);
  });

  it('does not count struck recs in byArchetype', () => {
    const recs = [
      makeRec({ type: 'content', lifecycle: 'struck', clientStatus: 'system' }),
      makeRec({ type: 'content', lifecycle: 'active', clientStatus: 'system' }),
    ];
    const s = deriveStance(recs);
    expect(s.byArchetype.authority_bet).toBe(1);
    expect(s.cut).toBe(1);
  });

  it('does not count throttled (future-window) recs in byArchetype active counts', () => {
    const recs = [
      makeRec({ type: 'content_refresh', lifecycle: 'throttled', throttledUntil: FUTURE, clientStatus: 'system' }),
    ];
    const s = deriveStance(recs);
    expect(s.byArchetype.refresh_reclaim).toBe(0);
    expect(s.parked).toBe(1);
  });

  it('counts an EXPIRED-throttle rec as active in its archetype (auto-resurfaces, not parked)', () => {
    const recs = [
      makeRec({ type: 'content_refresh', lifecycle: 'throttled', throttledUntil: PAST, clientStatus: 'system' }),
    ];
    const s = deriveStance(recs);
    // The throttle window has passed — the rec resurfaces and counts as active, not parked.
    expect(s.parked).toBe(0);
    expect(s.byArchetype.refresh_reclaim).toBe(1);
    expect(s.createRefreshDefend.refresh).toBe(1);
  });

  it('counts a throttled rec with NO throttledUntil as active (no open window = resurfaced)', () => {
    const recs = [
      makeRec({ type: 'content_refresh', lifecycle: 'throttled', clientStatus: 'system' }),
    ];
    const s = deriveStance(recs);
    expect(s.parked).toBe(0);
    expect(s.byArchetype.refresh_reclaim).toBe(1);
  });

  it('counts create/refresh/defend from ARCHETYPE_HEADLINE_VERB', () => {
    const recs = [
      // create: authority_bet, quick_win
      makeRec({ type: 'content', lifecycle: 'active', clientStatus: 'system' }),
      makeRec({ type: 'strategy', lifecycle: 'active', clientStatus: 'system' }),
      // refresh
      makeRec({ type: 'content_refresh', lifecycle: 'active', clientStatus: 'system' }),
      // defend
      makeRec({ type: 'cannibalization', lifecycle: 'active', clientStatus: 'system' }),
    ];
    const s = deriveStance(recs);
    expect(s.createRefreshDefend.create).toBe(2);
    expect(s.createRefreshDefend.refresh).toBe(1);
    expect(s.createRefreshDefend.defend).toBe(1);
  });

  it('handles empty rec list gracefully', () => {
    const s = deriveStance([]);
    expect(s.cut).toBe(0);
    expect(s.parked).toBe(0);
    expect(s.createRefreshDefend.create).toBe(0);
    expect(s.createRefreshDefend.refresh).toBe(0);
    expect(s.createRefreshDefend.defend).toBe(0);
  });

  it('all archetype keys are present with zero counts even if no recs for that archetype', () => {
    const s = deriveStance([]);
    // All 6 archetypes must be present
    const archetypes: string[] = ['authority_bet', 'refresh_reclaim', 'defend', 'quick_win', 'technical', 'local'];
    for (const a of archetypes) {
      expect(s.byArchetype).toHaveProperty(a);
      expect(s.byArchetype[a as keyof typeof s.byArchetype]).toBe(0);
    }
  });
});
