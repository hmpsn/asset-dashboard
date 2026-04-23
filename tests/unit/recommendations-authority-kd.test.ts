import { describe, it, expect } from 'vitest';
import {
  adjustKdImpactScore,
  classifyKdGap,
  kdClassificationNote,
} from '../../server/recommendations.js';

describe('classifyKdGap', () => {
  it('returns "aligned" when domain strength is unknown (0)', () => {
    expect(classifyKdGap(70, 0)).toBe('aligned');
  });
  it('returns "very-challenging" at and above kdGap = 30', () => {
    expect(classifyKdGap(60, 30)).toBe('very-challenging'); // exact boundary
    expect(classifyKdGap(80, 30)).toBe('very-challenging');
  });
  it('returns "challenging" at and above kdGap = 15 (but below 30)', () => {
    expect(classifyKdGap(45, 30)).toBe('challenging'); // exact lower boundary
    expect(classifyKdGap(50, 30)).toBe('challenging');
    expect(classifyKdGap(59, 30)).toBe('challenging');  // just under 30
  });
  it('returns "within-reach" at and below kdGap = -20', () => {
    expect(classifyKdGap(30, 50)).toBe('within-reach'); // exact boundary
    expect(classifyKdGap(10, 50)).toBe('within-reach');
  });
  it('returns "aligned" in the neutral band (-20 < kdGap < 15)', () => {
    expect(classifyKdGap(30, 30)).toBe('aligned'); // gap = 0
    expect(classifyKdGap(14, 0 + 0)).toBe('aligned'); // domainStrength 0 → aligned
    expect(classifyKdGap(44, 30)).toBe('aligned'); // gap = 14
    expect(classifyKdGap(31, 50)).toBe('aligned'); // gap = -19
  });
});

describe('adjustKdImpactScore', () => {
  it('penalizes by 40% when KD is 30+ points above domain strength', () => {
    expect(adjustKdImpactScore(65, 80, 30)).toBe(Math.round(65 * 0.6));
  });
  it('penalizes by 40% at the exact boundary (kdGap = 30)', () => {
    expect(adjustKdImpactScore(65, 60, 30)).toBe(Math.round(65 * 0.6));
  });
  it('penalizes by 20% when KD is 15-30 points above domain strength', () => {
    expect(adjustKdImpactScore(65, 50, 30)).toBe(Math.round(65 * 0.8));
  });
  it('penalizes by 20% at the exact lower boundary (kdGap = 15)', () => {
    expect(adjustKdImpactScore(65, 45, 30)).toBe(Math.round(65 * 0.8));
  });
  it('boosts by 20% (capped 100) when KD is 20+ points below domain strength', () => {
    expect(adjustKdImpactScore(65, 10, 50)).toBe(Math.min(100, Math.round(65 * 1.2)));
  });
  it('boosts by 20% at the exact boundary (kdGap = -20)', () => {
    expect(adjustKdImpactScore(65, 30, 50)).toBe(Math.min(100, Math.round(65 * 1.2)));
  });
  it('caps boosted score at 100', () => {
    expect(adjustKdImpactScore(90, 10, 50)).toBe(100); // 90 * 1.2 = 108 → 100
  });
  it('returns original score when domain strength is 0', () => {
    expect(adjustKdImpactScore(65, 70, 0)).toBe(65);
  });
});

describe('kdClassificationNote — single source of truth with adjustKdImpactScore', () => {
  it('returns an empty string when domain strength is unknown (0)', () => {
    expect(kdClassificationNote(70, 0)).toBe('');
  });
  it('returns a "challenging" note at the exact upper boundary (kdGap = 30)', () => {
    // Same input that triggers adjustKdImpactScore penalty must trigger note.
    expect(adjustKdImpactScore(65, 60, 30)).toBe(Math.round(65 * 0.6));
    expect(kdClassificationNote(60, 30)).toBe(' (KD 60 may be challenging — consider building authority first)');
  });
  it('returns a "challenging" note at the exact lower boundary (kdGap = 15)', () => {
    // This was the drift bug: old code used > 15 here, missing kdGap === 15.
    expect(adjustKdImpactScore(65, 45, 30)).toBe(Math.round(65 * 0.8));
    expect(kdClassificationNote(45, 30)).toBe(' (KD 45 may be challenging — consider building authority first)');
  });
  it('returns a "within-reach" note at the exact boundary (kdGap = -20)', () => {
    // This was the drift bug: old code used < -20 here, missing kdGap === -20.
    expect(adjustKdImpactScore(65, 30, 50)).toBe(Math.min(100, Math.round(65 * 1.2)));
    expect(kdClassificationNote(30, 50)).toBe(' (KD 30 is well within reach for your domain)');
  });
  it('returns an empty string in the neutral band', () => {
    expect(adjustKdImpactScore(65, 30, 30)).toBe(65); // no adjustment
    expect(kdClassificationNote(30, 30)).toBe('');
  });
  it('treats difficulty=0 as a valid (trivial) keyword, not as "unknown"', () => {
    // Regression: kdNote used to use a truthy check `difficulty ? note : ''` which
    // silently skipped the "within-reach" note when difficulty was 0.
    // Both consumers must agree: difficulty=0 with known domainStrength is
    // within-reach (kdGap = 0 - 50 = -50).
    expect(adjustKdImpactScore(65, 0, 50)).toBe(Math.min(100, Math.round(65 * 1.2)));
    expect(kdClassificationNote(0, 50)).toBe(' (KD 0 is well within reach for your domain)');
  });
});
