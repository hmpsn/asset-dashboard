import { describe, it, expect } from 'vitest';
import { buildStrategySummaryLine } from '../../../src/components/strategy/strategySummaryLine';

describe('buildStrategySummaryLine', () => {
  it('returns empty string when all counts are zero', () => {
    expect(buildStrategySummaryLine({ contentGaps: 0, requested: 0, quickWins: 0 })).toBe('');
  });

  describe('singular forms', () => {
    it('uses singular "gap to brief" for contentGaps === 1', () => {
      expect(buildStrategySummaryLine({ contentGaps: 1, requested: 0, quickWins: 0 })).toBe('1 gap to brief');
    });

    it('uses singular "requested keyword" for requested === 1', () => {
      expect(buildStrategySummaryLine({ contentGaps: 0, requested: 1, quickWins: 0 })).toBe('1 requested keyword');
    });

    it('uses singular "quick win" for quickWins === 1', () => {
      expect(buildStrategySummaryLine({ contentGaps: 0, requested: 0, quickWins: 1 })).toBe('1 quick win');
    });
  });

  describe('plural forms', () => {
    it('uses plural "gaps to brief" for contentGaps > 1', () => {
      expect(buildStrategySummaryLine({ contentGaps: 3, requested: 0, quickWins: 0 })).toBe('3 gaps to brief');
    });

    it('uses plural "requested keywords" for requested > 1', () => {
      expect(buildStrategySummaryLine({ contentGaps: 0, requested: 2, quickWins: 0 })).toBe('2 requested keywords');
    });

    it('uses plural "quick wins" for quickWins > 1', () => {
      expect(buildStrategySummaryLine({ contentGaps: 0, requested: 0, quickWins: 5 })).toBe('5 quick wins');
    });
  });

  describe('mixed cases', () => {
    it('joins all three non-zero clauses with " · "', () => {
      expect(buildStrategySummaryLine({ contentGaps: 3, requested: 2, quickWins: 5 }))
        .toBe('3 gaps to brief · 2 requested keywords · 5 quick wins');
    });

    it('omits the zero clause when one count is zero', () => {
      expect(buildStrategySummaryLine({ contentGaps: 3, requested: 0, quickWins: 5 }))
        .toBe('3 gaps to brief · 5 quick wins');
    });

    it('omits contentGaps clause when it is zero, keeps others', () => {
      expect(buildStrategySummaryLine({ contentGaps: 0, requested: 2, quickWins: 5 }))
        .toBe('2 requested keywords · 5 quick wins');
    });

    it('handles singular + plural mix across two clauses', () => {
      expect(buildStrategySummaryLine({ contentGaps: 1, requested: 0, quickWins: 3 }))
        .toBe('1 gap to brief · 3 quick wins');
    });
  });
});
