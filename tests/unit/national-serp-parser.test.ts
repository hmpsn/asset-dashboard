import { describe, expect, it, vi } from 'vitest';

// ── Harness: keep the provider module off real disk / env at import time ──
// `parseNationalSerp` is pure, but it lives in dataforseo-provider.ts, which calls
// getUploadRoot()/getDataDir() at module load. Stub those so the import is side-effect free.
vi.mock('../../server/data-dir.js', () => ({
  getUploadRoot: () => '/tmp/test-uploads',
  getDataDir: () => '/tmp/test-data',
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { parseNationalSerp } from '../../server/providers/dataforseo-provider.js';
import { SERP_WITH_AI_OVERVIEW, SERP_WITHOUT_AI_OVERVIEW } from '../fixtures/dataforseo-serp-advanced.js';

describe('parseNationalSerp', () => {
  describe('SERP_WITH_AI_OVERVIEW (query: "what is dropshipping and how does it work")', () => {
    const query = 'what is dropshipping and how does it work';

    it('matches owner reddit.com — AI Overview present + cited, organic rank 1', () => {
      const result = parseNationalSerp(SERP_WITH_AI_OVERVIEW.items, 'reddit.com', query);

      expect(result.query).toBe(query);
      expect(result.aiOverviewPresent).toBe(true);
      // reddit (www.reddit.com) IS in the aggregated references[] → cited.
      expect(result.aiOverviewCited).toBe(true);
      // www.reddit.com organic is rank_group 1 → matches owner reddit.com after www-strip.
      expect(result.position).toBe(1);
      expect(result.matchedUrl).toBe('https://www.reddit.com/r/explainlikeimfive/comments/1ft3q8b/');
      expect(result.features).toContain('ai_overview');
      expect(result.features).toContain('people_also_ask');
      expect(result.features).toContain('organic');
    });

    it('non-present owner notpresent.com — not cited, no rank', () => {
      const result = parseNationalSerp(SERP_WITH_AI_OVERVIEW.items, 'notpresent.com', query);

      expect(result.aiOverviewPresent).toBe(true);
      expect(result.aiOverviewCited).toBe(false);
      expect(result.position).toBeNull();
      expect(result.matchedUrl).toBeNull();
    });
  });

  describe('SERP_WITHOUT_AI_OVERVIEW (query: "how to make cold brew coffee")', () => {
    const query = 'how to make cold brew coffee';

    it('owner coffeegeek.com — no AI Overview, organic rank 1, featured_snippet feature present', () => {
      const result = parseNationalSerp(SERP_WITHOUT_AI_OVERVIEW.items, 'coffeegeek.com', query);

      expect(result.aiOverviewPresent).toBe(false);
      // No AI Overview present → citation is null, not false.
      expect(result.aiOverviewCited).toBeNull();
      // coffeegeek.com organic is rank_group 1 (the featured_snippet is NOT counted as organic rank).
      expect(result.position).toBe(1);
      expect(result.matchedUrl).toBe('https://coffeegeek.com/blog/techniques/a-preferred-way-to-make-cold-brewed-coffee/');
      expect(result.features).toContain('featured_snippet');
    });
  });

  describe('defensive parsing', () => {
    it('returns a safe empty result for an empty items array', () => {
      const result = parseNationalSerp([], 'example.com', 'anything');
      expect(result).toEqual({
        query: 'anything',
        position: null,
        matchedUrl: null,
        features: [],
        aiOverviewPresent: false,
        aiOverviewCited: null,
      });
    });

    it('never throws on malformed items (null, missing fields, wrong types)', () => {
      const malformed: unknown[] = [
        null,
        'not-an-object',
        { type: 'organic' }, // no domain / rank_group
        { type: 'organic', domain: 'example.com', rank_group: 'nope', url: 5 }, // wrong types
        { type: 'ai_overview', references: 'not-an-array' },
      ];
      const result = parseNationalSerp(malformed, 'example.com', 'q');
      expect(result.position).toBeNull();
      expect(result.matchedUrl).toBeNull();
      expect(result.aiOverviewPresent).toBe(true);
      expect(result.aiOverviewCited).toBe(false);
      expect(result.features).toEqual(['organic', 'ai_overview']);
    });
  });
});
