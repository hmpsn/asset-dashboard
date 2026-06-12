import { describe, it, expect } from 'vitest';
import { projectCompetitorGap, projectCompetitorGaps } from '../competitor-gaps-projection.js';
import type { KeywordGapItem } from '../../shared/types/workspace.js';

function gap(overrides: Partial<KeywordGapItem> = {}): KeywordGapItem {
  return {
    keyword: 'kw',
    volume: 1000,
    difficulty: 30,
    competitorPosition: 2,
    competitorDomain: 'rival.com',
    ...overrides,
  };
}

describe('projectCompetitorGap', () => {
  it('strips raw volume + difficulty and emits banded/labeled value only', () => {
    const out = projectCompetitorGap(gap());
    expect(out).not.toHaveProperty('volume');
    expect(out).not.toHaveProperty('difficulty');
    expect(out.competitorDomain).toBe('rival.com');
    expect(out.keyword).toBe('kw');
  });

  it('bands high demand + reachable difficulty as high', () => {
    expect(projectCompetitorGap(gap({ volume: 1500, difficulty: 25 })).opportunityBand).toBe('high');
  });

  it('bands low demand + hard difficulty as low', () => {
    expect(projectCompetitorGap(gap({ volume: 50, difficulty: 85 })).opportunityBand).toBe('low');
  });

  it('bands moderate demand/difficulty as medium', () => {
    expect(projectCompetitorGap(gap({ volume: 200, difficulty: 60 })).opportunityBand).toBe('medium');
  });

  it('rounds competitor position to a whole number, floored at 1', () => {
    expect(projectCompetitorGap(gap({ competitorPosition: 2.6 })).competitorPosition).toBe(3);
    expect(projectCompetitorGap(gap({ competitorPosition: 0.3 })).competitorPosition).toBe(1);
  });

  it('produces a non-empty you-vs-them benchmark naming the competitor', () => {
    const out = projectCompetitorGap(gap({ competitorDomain: 'foo.com', competitorPosition: 2 }));
    expect(out.benchmark).toContain('foo.com');
    expect(out.benchmark.length).toBeGreaterThan(0);
  });
});

describe('projectCompetitorGaps', () => {
  it('sorts high-opportunity rows first', () => {
    const out = projectCompetitorGaps([
      gap({ keyword: 'low', volume: 40, difficulty: 90 }),
      gap({ keyword: 'high', volume: 2000, difficulty: 20 }),
      gap({ keyword: 'medium', volume: 200, difficulty: 55 }),
    ]);
    expect(out.map((g) => g.opportunityBand)).toEqual(['high', 'medium', 'low']);
    expect(out[0].keyword).toBe('high');
  });
});
