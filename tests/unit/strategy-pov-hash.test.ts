import { describe, it, expect } from 'vitest';
import { buildStrategyPovHash } from '../../server/strategy-pov-generator.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

/**
 * Lane B cache-completeness contract (plan Step 3, audit §8, scaled-review fix #5):
 * buildStrategyPovHash MUST bust when ANY of these change. The hash operates over the POV rec set
 * passed in — which is now VARIANT-AWARE upstream (active for admin, curated for client, scaled-
 * review fix #1) — but the hash itself is variant-agnostic over its inputs, so these cases assert
 * busting on the passed recs regardless of how they were selected:
 *   - the POV rec id-set
 *   - each rec's clientStatus / lifecycle
 *   - each rec's CONTENT (title / insight / estimatedGain / opportunity value)
 *   - the rec ORDER (the POV leads with the #1 move)
 *   - the variant (admin vs client prose AND source set must not share a cache)
 *   - the regenerate nonce
 * It MUST NOT bust on the prose-edit version change (folding version in would let a plain generate
 * after an operator edit overwrite the edit). Identical inputs ⇒ identical hash (pure).
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

const base = [
  rec({ id: 'a', clientStatus: 'sent', lifecycle: 'active', title: 'A', insight: 'ia', estimatedGain: 'ga' }),
  rec({ id: 'b', clientStatus: 'approved', lifecycle: 'active', title: 'B', insight: 'ib', estimatedGain: 'gb' }),
];

describe('buildStrategyPovHash', () => {
  it('is pure — identical inputs produce identical hash', () => {
    expect(buildStrategyPovHash(base, 'admin', null)).toBe(buildStrategyPovHash(base, 'admin', null));
  });

  it('busts when the curated rec id-set changes', () => {
    const withExtra = [...base, rec({ id: 'c' })];
    expect(buildStrategyPovHash(withExtra, 'admin', null)).not.toBe(buildStrategyPovHash(base, 'admin', null));
  });

  it('busts when a curated rec clientStatus changes', () => {
    const flipped = [rec({ id: 'a', clientStatus: 'discussing', lifecycle: 'active', title: 'A', insight: 'ia', estimatedGain: 'ga' }), base[1]];
    expect(buildStrategyPovHash(flipped, 'admin', null)).not.toBe(buildStrategyPovHash(base, 'admin', null));
  });

  it('busts when a curated rec lifecycle changes', () => {
    const flipped = [rec({ id: 'a', clientStatus: 'sent', lifecycle: 'throttled', title: 'A', insight: 'ia', estimatedGain: 'ga' }), base[1]];
    expect(buildStrategyPovHash(flipped, 'admin', null)).not.toBe(buildStrategyPovHash(base, 'admin', null));
  });

  it('busts when a curated rec CONTENT changes (title / insight / estimatedGain / opportunity value)', () => {
    const newTitle = [rec({ id: 'a', clientStatus: 'sent', lifecycle: 'active', title: 'A-EDITED', insight: 'ia', estimatedGain: 'ga' }), base[1]];
    expect(buildStrategyPovHash(newTitle, 'admin', null)).not.toBe(buildStrategyPovHash(base, 'admin', null));

    const newInsight = [rec({ id: 'a', clientStatus: 'sent', lifecycle: 'active', title: 'A', insight: 'ia-EDITED', estimatedGain: 'ga' }), base[1]];
    expect(buildStrategyPovHash(newInsight, 'admin', null)).not.toBe(buildStrategyPovHash(base, 'admin', null));

    const newGain = [rec({ id: 'a', clientStatus: 'sent', lifecycle: 'active', title: 'A', insight: 'ia', estimatedGain: 'ga-EDITED' }), base[1]];
    expect(buildStrategyPovHash(newGain, 'admin', null)).not.toBe(buildStrategyPovHash(base, 'admin', null));

    const newValue = [rec({ id: 'a', clientStatus: 'sent', lifecycle: 'active', title: 'A', insight: 'ia', estimatedGain: 'ga', opportunity: { value: 999 } as Recommendation['opportunity'] }), base[1]];
    expect(buildStrategyPovHash(newValue, 'admin', null)).not.toBe(buildStrategyPovHash(base, 'admin', null));
  });

  it('busts when the rec ORDER changes (POV leads with the #1 curated move)', () => {
    const reordered = [base[1], base[0]];
    expect(buildStrategyPovHash(reordered, 'admin', null)).not.toBe(buildStrategyPovHash(base, 'admin', null));
  });

  it('busts when the variant changes (admin vs client must not share a cache)', () => {
    expect(buildStrategyPovHash(base, 'client', null)).not.toBe(buildStrategyPovHash(base, 'admin', null));
  });

  it('busts when the regenerate nonce changes', () => {
    expect(buildStrategyPovHash(base, 'admin', 'nonce-1')).not.toBe(buildStrategyPovHash(base, 'admin', null));
    expect(buildStrategyPovHash(base, 'admin', 'nonce-2')).not.toBe(buildStrategyPovHash(base, 'admin', 'nonce-1'));
  });

  it('does NOT bust on a prose-edit version change (the version is not part of the hash)', () => {
    // The version no longer participates in the hash — a plain generate after an operator edit must
    // return the cached (edited) POV, not overwrite it. The signature dropped `version` entirely, so
    // there is no version arg to vary: identical curated content + variant + nonce ⇒ identical hash.
    expect(buildStrategyPovHash(base, 'admin', null)).toBe(buildStrategyPovHash(base, 'admin', null));
  });
});
