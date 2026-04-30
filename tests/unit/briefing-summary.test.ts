// Unit tests for server/briefing-summary.ts — Phase 2.5b deterministic
// issue-summary generator. Verifies lead phrase selection per category,
// risk/competitive aggregation in the watch list, recommendation count
// pluralization, and edge cases (empty stories, no recommendations).

import { describe, it, expect } from 'vitest';
import { generateIssueSummary } from '../../server/briefing-summary.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

function story(over: Partial<BriefingStory> = {}): BriefingStory {
  return {
    id: 'story-test',
    category: 'win',
    isHeadline: false,
    headline: 'Test headline',
    narrative: 'Test narrative.',
    metrics: [],
    drillIn: { page: 'performance' },
    sourceRefs: [],
    ...over,
  };
}

describe('generateIssueSummary', () => {
  describe('lead phrase selection', () => {
    it('uses "A win at the top" when hero category is win', () => {
      const stories = [story({ category: 'win', isHeadline: true })];
      expect(generateIssueSummary(stories, 0)).toBe('A win at the top.');
    });

    it('uses "A risk to address first" when hero category is risk', () => {
      const stories = [story({ category: 'risk', isHeadline: true })];
      expect(generateIssueSummary(stories, 0)).toBe('A risk to address first.');
    });

    it('uses "An opportunity to lead with" when hero category is opportunity', () => {
      const stories = [story({ category: 'opportunity', isHeadline: true })];
      expect(generateIssueSummary(stories, 0)).toBe('An opportunity to lead with.');
    });

    it('uses competitive lead when hero category is competitive', () => {
      const stories = [story({ category: 'competitive', isHeadline: true })];
      expect(generateIssueSummary(stories, 0)).toBe('A competitor move at the top.');
    });

    it('uses period_change lead when hero category is period_change', () => {
      const stories = [story({ category: 'period_change', isHeadline: true })];
      expect(generateIssueSummary(stories, 0)).toBe('A shift in the numbers.');
    });

    it('falls back to neutral lead when no headline story exists', () => {
      const stories = [story({ isHeadline: false }), story({ isHeadline: false })];
      // No headline → neutral lead. Both stories are 'win' (not in risk bucket)
      // so no clauses get appended.
      expect(generateIssueSummary(stories, 0)).toBe('A look at this week.');
    });
  });

  describe('risk count clause', () => {
    it('counts non-headline risk stories', () => {
      const stories = [
        story({ id: 'a', category: 'win', isHeadline: true }),
        story({ id: 'b', category: 'risk' }),
        story({ id: 'c', category: 'risk' }),
      ];
      expect(generateIssueSummary(stories, 0)).toBe(
        'A win at the top, 2 risks to watch.',
      );
    });

    it('counts non-headline competitive stories as risks', () => {
      const stories = [
        story({ id: 'a', category: 'win', isHeadline: true }),
        story({ id: 'b', category: 'competitive' }),
      ];
      expect(generateIssueSummary(stories, 0)).toBe(
        'A win at the top, 1 risk to watch.',
      );
    });

    it('singularizes risk when count is 1', () => {
      const stories = [
        story({ id: 'a', category: 'win', isHeadline: true }),
        story({ id: 'b', category: 'risk' }),
      ];
      expect(generateIssueSummary(stories, 0)).toBe(
        'A win at the top, 1 risk to watch.',
      );
    });

    it('does NOT count the headline story even if its category is risk', () => {
      const stories = [
        story({ id: 'a', category: 'risk', isHeadline: true }),
        story({ id: 'b', category: 'risk' }),
        story({ id: 'c', category: 'risk' }),
      ];
      // Hero is the risk lead; remaining 2 are watch-list risks.
      expect(generateIssueSummary(stories, 0)).toBe(
        'A risk to address first, 2 risks to watch.',
      );
    });

    it('does NOT count opportunity / win / period_change as risks', () => {
      const stories = [
        story({ id: 'a', category: 'risk', isHeadline: true }),
        story({ id: 'b', category: 'opportunity' }),
        story({ id: 'c', category: 'win' }),
        story({ id: 'd', category: 'period_change' }),
      ];
      expect(generateIssueSummary(stories, 0)).toBe('A risk to address first.');
    });
  });

  describe('recommendation count clause', () => {
    it('appends opportunity count when > 0', () => {
      const stories = [story({ category: 'win', isHeadline: true })];
      expect(generateIssueSummary(stories, 7)).toBe(
        'A win at the top, 7 opportunities to consider.',
      );
    });

    it('singularizes opportunity when count is 1', () => {
      const stories = [story({ category: 'win', isHeadline: true })];
      expect(generateIssueSummary(stories, 1)).toBe(
        'A win at the top, 1 opportunity to consider.',
      );
    });

    it('omits the clause when count is 0', () => {
      const stories = [story({ category: 'win', isHeadline: true })];
      expect(generateIssueSummary(stories, 0)).toBe('A win at the top.');
    });

    it('combines risk + opportunity clauses', () => {
      const stories = [
        story({ id: 'a', category: 'win', isHeadline: true }),
        story({ id: 'b', category: 'risk' }),
        story({ id: 'c', category: 'risk' }),
      ];
      expect(generateIssueSummary(stories, 7)).toBe(
        'A win at the top, 2 risks to watch, 7 opportunities to consider.',
      );
    });
  });

  describe('edge cases', () => {
    it('returns just the lead when stories array is empty', () => {
      expect(generateIssueSummary([], 0)).toBe('A look at this week.');
    });

    it('still appends recommendation clause when stories array is empty', () => {
      expect(generateIssueSummary([], 3)).toBe(
        'A look at this week, 3 opportunities to consider.',
      );
    });

    it('always ends with a period', () => {
      const stories = [story({ category: 'win', isHeadline: true })];
      expect(generateIssueSummary(stories, 0).endsWith('.')).toBe(true);
      expect(generateIssueSummary(stories, 5).endsWith('.')).toBe(true);
    });

    it('never returns the empty string', () => {
      expect(generateIssueSummary([], 0).length).toBeGreaterThan(0);
    });
  });
});
