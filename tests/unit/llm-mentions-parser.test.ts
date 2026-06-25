import { describe, expect, it, vi } from 'vitest';

// ── Harness: keep the provider module off real disk / env at import time ──
// `parseLlmMentions` is pure, but it lives in dataforseo-provider.ts, which calls
// getUploadRoot()/getDataDir() at module load. Stub those so the import is side-effect free.
vi.mock('../../server/data-dir.js', () => ({
  getUploadRoot: () => '/tmp/test-uploads',
  getDataDir: () => '/tmp/test-data',
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { parseLlmMentions } from '../../server/providers/dataforseo-provider.js';
import { LLM_MENTIONS_AGG, LLM_MENTIONS_AGG_EMPTY } from '../fixtures/dataforseo-llm-mentions.js';

describe('parseLlmMentions', () => {
  describe('LLM_MENTIONS_AGG (domain: squareup.com, platform: chat_gpt, brand: Square)', () => {
    // ownerBrandNames identifies the client's OWN brand ('Square') among the co-mentioned brands,
    // so it is split out of competitors and share-of-voice is computed like-to-like.
    const result = parseLlmMentions(LLM_MENTIONS_AGG.items, 'squareup.com', 'chat_gpt', ['Square']);

    it('returns domain + platform on the result', () => {
      expect(result.domain).toBe('squareup.com');
      expect(result.platform).toBe('chat_gpt');
    });

    it('reads headline mentions + ai_search_volume from the matching platform group', () => {
      expect(result.mentions).toBe(2704);
      expect(result.aiSearchVolume).toBe(58439);
    });

    it('excludes the client own brand from competitors (brand_entities_title minus Square)', () => {
      expect(result.competitors).toContainEqual({ name: 'Apple Pay', mentions: 34, aiSearchVolume: 251 });
      expect(result.competitors.some(c => c.name === 'Square')).toBe(false);
      expect(result.competitors).toHaveLength(4); // Apple Pay, Stripe, PayPal, Google Pay
    });

    it('maps sources_domain → sourceDomains (domain/mentions)', () => {
      expect(result.sourceDomains).toContainEqual({ domain: 'squareup.com', mentions: 1031 });
      expect(result.sourceDomains).toHaveLength(5);
    });

    it('computes shareOfVoice like-to-like: own brand ÷ ALL co-mentioned brands', () => {
      // Square (90) ÷ (90 + 34 + 14 + 13 + 13) = 90 / 164 ≈ 0.549 — NOT the domain-citation count.
      const expected = 90 / (90 + 34 + 14 + 13 + 13);
      expect(result.shareOfVoice).toBeCloseTo(expected, 6);
      expect(result.shareOfVoice).toBeGreaterThan(0.5);
      expect(result.shareOfVoice).toBeLessThan(0.6);
    });

    it('shareOfVoice is UNDEFINED ("not measured") when the client brand is not identifiable', () => {
      // No brand name → cannot identify the client among co-mentioned brands → not a real 0%.
      const noBrand = parseLlmMentions(LLM_MENTIONS_AGG.items, 'squareup.com', 'chat_gpt', []);
      expect(noBrand.shareOfVoice).toBeUndefined();
      expect(noBrand.competitors).toHaveLength(5); // no brand split → all 5 are "competitors"
    });

    it('does NOT over-match a short/generic owner name (e.g. "Pay" vs "Apple Pay"/"Google Pay")', () => {
      // 'pay' is 3 chars → the substring arm is disabled; only exact 'pay'=='pay' would match, and
      // it is not in the set → owner not identified → shareOfVoice undefined, all 5 stay competitors.
      const pay = parseLlmMentions(LLM_MENTIONS_AGG.items, 'pay.example', 'chat_gpt', ['Pay']);
      expect(pay.shareOfVoice).toBeUndefined();
      expect(pay.competitors.some(c => c.name === 'Apple Pay')).toBe(true);
      expect(pay.competitors.some(c => c.name === 'Google Pay')).toBe(true);
      expect(pay.competitors).toHaveLength(5);
    });
  });

  describe('LLM_MENTIONS_AGG_EMPTY (zero LLM presence)', () => {
    const result = parseLlmMentions(LLM_MENTIONS_AGG_EMPTY.items, 'nobody.example', 'chat_gpt');

    it('returns zero mentions, never invented', () => {
      expect(result.mentions).toBe(0);
      expect(result.aiSearchVolume).toBe(0);
    });

    it('returns shareOfVoice undefined ("not measured") when there is no brand data', () => {
      expect(result.shareOfVoice).toBeUndefined();
    });

    it('returns empty competitor + source lists', () => {
      expect(result.competitors).toEqual([]);
      expect(result.sourceDomains).toEqual([]);
    });

    it('preserves the requested domain + platform', () => {
      expect(result.domain).toBe('nobody.example');
      expect(result.platform).toBe('chat_gpt');
    });
  });

  describe('defensive parsing', () => {
    it('returns an empty result for a non-array / missing items', () => {
      const result = parseLlmMentions([], 'squareup.com', 'chat_gpt');
      expect(result.mentions).toBe(0);
      expect(result.shareOfVoice).toBeUndefined();
      expect(result.competitors).toEqual([]);
      expect(result.sourceDomains).toEqual([]);
    });

    it('skips non-object group rows without throwing', () => {
      const malformed = [{ total: { platform: [null, 'bad', { key: 'chat_gpt', mentions: 5 }], brand_entities_title: 'nope', sources_domain: undefined } }];
      const result = parseLlmMentions(malformed, 'x.com', 'chat_gpt');
      expect(result.mentions).toBe(5);
      expect(result.competitors).toEqual([]);
      expect(result.sourceDomains).toEqual([]);
    });
  });
});
