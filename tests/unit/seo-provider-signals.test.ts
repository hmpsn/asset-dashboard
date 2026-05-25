import { describe, expect, it } from 'vitest';
import {
  trendDirection,
  parseSerpFeatures,
  hasSerpOpportunity,
} from '../../server/seo-provider-signals.js';

describe('trendDirection', () => {
  it('returns stable for undefined input', () => {
    expect(trendDirection(undefined)).toBe('stable');
  });

  it('returns stable for empty array', () => {
    expect(trendDirection([])).toBe('stable');
  });

  it('returns stable for array with fewer than 4 elements', () => {
    expect(trendDirection([100, 200, 150])).toBe('stable');
  });

  it('returns rising when recent 3-month avg is >15% above early 3-month avg', () => {
    // early avg = (100+100+100)/3 = 100, recent avg = (150+160+170)/3 ≈ 160
    // change = (160 - 100) / 100 = 0.6 > 0.15
    const trend = [100, 100, 100, 80, 90, 95, 110, 120, 130, 150, 160, 170];
    expect(trendDirection(trend)).toBe('rising');
  });

  it('returns declining when recent 3-month avg is >15% below early 3-month avg', () => {
    // early avg = 200, recent avg = 100; change = -0.5 < -0.15
    const trend = [200, 200, 200, 190, 180, 160, 150, 140, 130, 100, 100, 100];
    expect(trendDirection(trend)).toBe('declining');
  });

  it('returns stable when change is within ±15%', () => {
    // early avg ≈ 100, recent avg ≈ 105; change = 0.05, within threshold
    const trend = [100, 100, 100, 100, 102, 103, 104, 105, 105, 104, 105, 106];
    expect(trendDirection(trend)).toBe('stable');
  });

  it('returns rising when early avg is 0 and recent avg is positive', () => {
    // early avg = 0, recent avg > 0 → rising
    const trend = [0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 20, 30];
    expect(trendDirection(trend)).toBe('rising');
  });

  it('returns stable when early avg is 0 and recent avg is also 0', () => {
    const trend = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(trendDirection(trend)).toBe('stable');
  });

  it('works correctly with exactly 4 elements', () => {
    // early = [200, 200, 200]/3 only uses first 3, recent = last 3 of a 4-item array
    // For 4 elements: early = slice(0,3) = [50, 50, 50], recent = slice(-3) = [50, 50, 200]
    const trend = [50, 50, 50, 200];
    // early avg = 50, recent avg = (50+50+200)/3 ≈ 100; change ≈ 1.0 > 0.15 → rising
    expect(trendDirection(trend)).toBe('rising');
  });
});

describe('parseSerpFeatures', () => {
  it('returns empty array for undefined input', () => {
    expect(parseSerpFeatures(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseSerpFeatures('')).toEqual([]);
  });

  it('maps known code 0 to featured_snippet', () => {
    expect(parseSerpFeatures('0')).toEqual(['featured_snippet']);
  });

  it('maps multiple codes to labels', () => {
    const result = parseSerpFeatures('0,3,11');
    expect(result).toContain('featured_snippet');
    expect(result).toContain('people_also_ask');
    expect(result).toContain('local_pack');
  });

  it('passes unknown codes through as-is', () => {
    const result = parseSerpFeatures('99,0');
    expect(result).toContain('99');
    expect(result).toContain('featured_snippet');
  });

  it('handles whitespace around codes', () => {
    const result = parseSerpFeatures(' 0 , 3 ');
    expect(result).toContain('featured_snippet');
    expect(result).toContain('people_also_ask');
  });

  it('maps code 5 to video', () => {
    expect(parseSerpFeatures('5')).toContain('video');
  });

  it('maps code 9 to shopping', () => {
    expect(parseSerpFeatures('9')).toContain('shopping');
  });
});

describe('hasSerpOpportunity', () => {
  it('returns all false for undefined input', () => {
    const result = hasSerpOpportunity(undefined);
    expect(result.featuredSnippet).toBe(false);
    expect(result.paa).toBe(false);
    expect(result.video).toBe(false);
    expect(result.localPack).toBe(false);
  });

  it('returns all false for empty string', () => {
    const result = hasSerpOpportunity('');
    expect(result.featuredSnippet).toBe(false);
    expect(result.paa).toBe(false);
    expect(result.video).toBe(false);
    expect(result.localPack).toBe(false);
  });

  it('detects featured snippet (code 0)', () => {
    const result = hasSerpOpportunity('0');
    expect(result.featuredSnippet).toBe(true);
    expect(result.paa).toBe(false);
  });

  it('detects people_also_ask (code 3)', () => {
    const result = hasSerpOpportunity('3');
    expect(result.paa).toBe(true);
  });

  it('detects video (code 5)', () => {
    const result = hasSerpOpportunity('5');
    expect(result.video).toBe(true);
  });

  it('detects video via video_carousel (code 14)', () => {
    const result = hasSerpOpportunity('14');
    expect(result.video).toBe(true);
  });

  it('detects local_pack (code 11)', () => {
    const result = hasSerpOpportunity('11');
    expect(result.localPack).toBe(true);
  });

  it('detects multiple opportunities from combined codes', () => {
    // 0=featured_snippet, 3=people_also_ask, 5=video, 11=local_pack
    const result = hasSerpOpportunity('0,3,5,11');
    expect(result.featuredSnippet).toBe(true);
    expect(result.paa).toBe(true);
    expect(result.video).toBe(true);
    expect(result.localPack).toBe(true);
  });

  it('returns false for unrelated codes like shopping (9) and news (8)', () => {
    const result = hasSerpOpportunity('8,9');
    expect(result.featuredSnippet).toBe(false);
    expect(result.paa).toBe(false);
    expect(result.video).toBe(false);
    expect(result.localPack).toBe(false);
  });
});
