import { describe, it, expect } from 'vitest';
import { scoreCandidates, type Candidate } from '../../server/briefing-candidates.js';

function c(over: Partial<Candidate>): Candidate {
  return {
    id: 'c1',
    category: 'win',
    impact: 50,
    referenceId: 'r1',
    referenceType: 'analytics_insight',
    occurredAt: Date.now() - 86400_000,
    title: 't', description: 'd',
    drillIn: { page: 'performance' },
    metrics: [],
    ...over,
  };
}

describe('briefing-candidates scoring', () => {
  it('risks outrank wins of equal impact and recency', () => {
    const win = c({ category: 'win', id: 'w' });
    const risk = c({ category: 'risk', id: 'r' });
    const ranked = scoreCandidates([win, risk]);
    expect(ranked[0].id).toBe('r');
  });

  it('recency decays older candidates', () => {
    const fresh = c({ id: 'fresh', occurredAt: Date.now() });
    const old = c({ id: 'old', occurredAt: Date.now() - 30 * 86400_000 });
    const ranked = scoreCandidates([fresh, old]);
    expect(ranked[0].id).toBe('fresh');
  });

  it('higher impact wins among same-category candidates', () => {
    const a = c({ id: 'a', impact: 30 });
    const b = c({ id: 'b', impact: 80 });
    const ranked = scoreCandidates([a, b]);
    expect(ranked[0].id).toBe('b');
  });

  it('handles empty input', () => {
    expect(scoreCandidates([])).toEqual([]);
  });
});
