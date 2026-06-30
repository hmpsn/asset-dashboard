import { describe, expect, it } from 'vitest';

import {
  compareBriefingContentGapDisplayOrder,
  compareContentGapDemandDisplayOrder,
  compareContentGapDisplayOrder,
  compareKeywordOpportunityScoreDesc,
  compareOrganicContentGapDisplayOrder,
  projectKeywordOpportunity,
} from '../../shared/keyword-opportunity-projection.js';

describe('keyword opportunity projection', () => {
  it('normalizes keyword identity while keeping score authority explicit', () => {
    const projected = projectKeywordOpportunity({
      targetKeyword: '  Emergency Dentist Near Me  ',
      valueScore: 81,
      opportunityScore: 44,
      valueReasons: ['urgent local intent', 'strong CPC'],
      currentMonthly: 120.5,
      upsideMonthly: 80,
      rationale: 'A client-safe explanation',
      priority: 'high',
    });

    expect(projected).toMatchObject({
      keyword: 'Emergency Dentist Near Me',
      normalizedKeyword: 'emergency dentist near me',
      displayScore: 44,
      sortScore: 44,
      reasons: ['urgent local intent', 'strong CPC'],
      currentMonthly: 120.5,
      upsideMonthly: 80,
      clientSafeExplanation: 'A client-safe explanation',
      priorityWeight: 3,
      backfilled: false,
    });
  });

  it('uses caller-provided display and sort scores when a surface intentionally chooses value scoring', () => {
    const projected = projectKeywordOpportunity({
      keyword: 'cosmetic dentist',
      valueScore: 91,
      opportunityScore: 35,
      displayScore: 91,
      sortScore: 91,
    });

    expect(projected.displayScore).toBe(91);
    expect(projected.sortScore).toBe(91);
  });

  it('keeps score-desc sorting behavior for simple keyword opportunities', () => {
    const rows = [
      { keyword: 'low', opportunityScore: 12 },
      { keyword: 'high', opportunityScore: 72 },
      { keyword: 'missing' },
    ];

    expect([...rows].sort(compareKeywordOpportunityScoreDesc).map(row => row.keyword))
      .toEqual(['high', 'low', 'missing']);
  });

  it('orders briefing content gaps by caller-provided value score before demand buckets', () => {
    const gaps = [
      { targetKeyword: 'zero demand high value', volume: 0, sortScore: 99, opportunityScore: 20 },
      { targetKeyword: 'unenriched', sortScore: 50, opportunityScore: 50 },
      { targetKeyword: 'volume demand low value', volume: 10, sortScore: 1, opportunityScore: 90 },
      { targetKeyword: 'gsc demand', volume: 0, impressions: 100, sortScore: 2, opportunityScore: 80 },
    ];

    expect([...gaps].sort(compareBriefingContentGapDisplayOrder).map(gap => gap.targetKeyword))
      .toEqual(['zero demand high value', 'unenriched', 'gsc demand', 'volume demand low value']);
  });

  it('uses briefing demand buckets as a tie-breaker when value scores match', () => {
    const gaps = [
      { targetKeyword: 'zero demand', volume: 0, sortScore: 50 },
      { targetKeyword: 'unknown demand', sortScore: 50 },
      { targetKeyword: 'volume demand', volume: 10, sortScore: 50 },
      { targetKeyword: 'gsc demand', volume: 0, impressions: 100, sortScore: 50 },
    ];

    expect([...gaps].sort(compareBriefingContentGapDisplayOrder).map(gap => gap.targetKeyword))
      .toEqual(['gsc demand', 'volume demand', 'unknown demand', 'zero demand']);
  });

  it('keeps demand-bucket content gaps ordered by demand, then priority', () => {
    const gaps = [
      { targetKeyword: 'zero demand high priority', volume: 0, opportunityScore: 99, priority: 'high' },
      { targetKeyword: 'unenriched', opportunityScore: 80, priority: 'high' },
      { targetKeyword: 'volume demand low priority', volume: 10, opportunityScore: 1, priority: 'low' },
      { targetKeyword: 'gsc demand medium priority', volume: 0, impressions: 100, opportunityScore: 2, priority: 'medium' },
    ];

    expect([...gaps].sort(compareContentGapDemandDisplayOrder).map(gap => gap.targetKeyword))
      .toEqual(['gsc demand medium priority', 'volume demand low priority', 'unenriched', 'zero demand high priority']);
  });

  it('keeps organic content gaps ahead of deterministic backfill rows', () => {
    const gaps = [
      { targetKeyword: 'backfilled strong', opportunityScore: 99, backfilled: true },
      { targetKeyword: 'organic weaker', opportunityScore: 20 },
      { targetKeyword: 'organic stronger', opportunityScore: 50 },
    ];

    expect([...gaps].sort(compareOrganicContentGapDisplayOrder).map(gap => gap.targetKeyword))
      .toEqual(['organic stronger', 'organic weaker', 'backfilled strong']);
  });

  it('keeps admin content-gap fallback ordering by score, volume, then priority', () => {
    const gaps = [
      { targetKeyword: 'medium priority', opportunityScore: 40, volume: 50, priority: 'medium' },
      { targetKeyword: 'higher volume', opportunityScore: 40, volume: 100, priority: 'low' },
      { targetKeyword: 'higher score', opportunityScore: 80, volume: 1, priority: 'low' },
      { targetKeyword: 'high priority', opportunityScore: 40, volume: 50, priority: 'high' },
    ];

    expect([...gaps].sort(compareContentGapDisplayOrder).map(gap => gap.targetKeyword))
      .toEqual(['higher score', 'higher volume', 'high priority', 'medium priority']);
  });
});
