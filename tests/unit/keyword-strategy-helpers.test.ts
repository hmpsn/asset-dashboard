import { describe, it, expect } from 'vitest';
import { computeOpportunityScore } from '../../server/routes/keyword-strategy.js';

describe('computeOpportunityScore', () => {
  it('returns undefined when volume is 0 and no other signals', () => {
    expect(computeOpportunityScore({ volume: 0 })).toBeUndefined();
  });

  it('returns a number when difficulty alone is present', () => {
    const score = computeOpportunityScore({ difficulty: 30 });
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
  });
});

describe('content gap sort order', () => {
  function sortGaps(gaps: Array<{ volume?: number | null; priority?: string }>) {
    const prioWeight = (p?: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;
    return [...gaps].sort(
      (a, b) => {
        // Three buckets in descending order of priority:
        // 1. Positive volume (>0) — enriched with demand
        // 2. Unenriched (null/undefined) — not yet checked for demand, potential
        // 3. Zero volume (=0) — enriched but no demand
        const getBundle = (gap: typeof gaps[0]) => {
          if (gap.volume == null) return { bucket: 1, vol: 0 };  // unenriched bucket 1 (null OR undefined)
          if (gap.volume > 0) return { bucket: 2, vol: gap.volume };   // positive bucket 2
          return { bucket: 0, vol: 0 };                                 // zero bucket 0
        };
        const aBundle = getBundle(a);
        const bBundle = getBundle(b);

        // Sort by bucket desc, then by volume desc within bucket, then by priority desc
        return bBundle.bucket - aBundle.bucket ||
               bBundle.vol - aBundle.vol ||
               prioWeight(b.priority) - prioWeight(a.priority);
      }
    );
  }

  it('keeps volume=0 keywords (does not drop them)', () => {
    const gaps = [
      { volume: 500, priority: 'high' },
      { volume: 0, priority: 'high' },
      { volume: undefined, priority: 'low' },
    ];
    const sorted = sortGaps(gaps);
    expect(sorted).toHaveLength(3);
  });

  it('sorts positive volume before unenriched before zero volume', () => {
    const gaps = [
      { volume: 0, priority: 'high' },
      { volume: undefined, priority: 'low' },
      { volume: 500, priority: 'high' },
    ];
    const sorted = sortGaps(gaps);
    expect(sorted[0].volume).toBe(500);
    expect(sorted[1].volume).toBeUndefined();
    expect(sorted[2].volume).toBe(0);
  });

  it('treats null volume the same as undefined (unenriched, not zero-volume)', () => {
    const gaps = [
      { volume: 500 },
      { volume: null as unknown as undefined },  // null from DB
      { volume: 0 },
    ];
    const sorted = sortGaps(gaps);
    expect(sorted[0].volume).toBe(500);
    expect(sorted[1].volume).toBeNull();  // null sorts as unenriched (middle)
    expect(sorted[2].volume).toBe(0);
  });
});
