import { describe, it, expect } from 'vitest';
import { buildStrategyPovHash } from '../../server/strategy-pov-generator.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

/**
 * Lane B cache-completeness contract (plan Step 3, audit §8):
 * buildStrategyPovHash MUST bust when ANY of these change:
 *   - the curated rec id-set
 *   - each curated rec's clientStatus
 *   - each curated rec's lifecycle
 *   - the prose-edit version
 *   - the regenerate nonce
 * Identical inputs ⇒ identical hash (pure).
 */

function rec(over: Partial<Recommendation>): Recommendation {
  return {
    id: 'r1',
    workspaceId: 'ws',
    priority: 'fix_now',
    type: 'content',
    title: 't',
    description: 'd',
    insight: 'i',
    impact: 'high',
    effort: 'low',
    impactScore: 50,
    source: 's',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'g',
    actionType: 'manual',
    status: 'pending',
    clientStatus: 'sent',
    lifecycle: 'active',
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z',
    ...over,
  } as Recommendation;
}

const base = [rec({ id: 'a', clientStatus: 'sent', lifecycle: 'active' }), rec({ id: 'b', clientStatus: 'approved', lifecycle: 'active' })];

describe('buildStrategyPovHash', () => {
  it('is pure — identical inputs produce identical hash', () => {
    expect(buildStrategyPovHash(base, 0, null)).toBe(buildStrategyPovHash(base, 0, null));
  });

  it('busts when the curated rec id-set changes', () => {
    const withExtra = [...base, rec({ id: 'c' })];
    expect(buildStrategyPovHash(withExtra, 0, null)).not.toBe(buildStrategyPovHash(base, 0, null));
  });

  it('busts when a curated rec clientStatus changes', () => {
    const flipped = [rec({ id: 'a', clientStatus: 'discussing', lifecycle: 'active' }), base[1]];
    expect(buildStrategyPovHash(flipped, 0, null)).not.toBe(buildStrategyPovHash(base, 0, null));
  });

  it('busts when a curated rec lifecycle changes', () => {
    const flipped = [rec({ id: 'a', clientStatus: 'sent', lifecycle: 'throttled' }), base[1]];
    expect(buildStrategyPovHash(flipped, 0, null)).not.toBe(buildStrategyPovHash(base, 0, null));
  });

  it('busts when the prose-edit version changes', () => {
    expect(buildStrategyPovHash(base, 1, null)).not.toBe(buildStrategyPovHash(base, 0, null));
  });

  it('busts when the regenerate nonce changes', () => {
    expect(buildStrategyPovHash(base, 0, 'nonce-1')).not.toBe(buildStrategyPovHash(base, 0, null));
    expect(buildStrategyPovHash(base, 0, 'nonce-2')).not.toBe(buildStrategyPovHash(base, 0, 'nonce-1'));
  });

  it('is order-independent over the curated set (rec order must not matter)', () => {
    const reordered = [base[1], base[0]];
    expect(buildStrategyPovHash(reordered, 0, null)).toBe(buildStrategyPovHash(base, 0, null));
  });
});
