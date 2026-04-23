import { describe, it, expect } from 'vitest';
import { getTrafficScore } from '../../server/recommendations.js';

const traffic = {
  '/plumbing': { clicks: 100, impressions: 2000, pageviews: 150, sessions: 0 },
  '/hvac':     { clicks: 50,  impressions: 1000, pageviews: 80,  sessions: 0 },
};

describe('getTrafficScore — conversion multiplier', () => {
  it('applies up to 1.5x boost for pages with CVR > 2%', () => {
    const base    = getTrafficScore(traffic, 'plumbing');
    const boosted = getTrafficScore(traffic, 'plumbing', 4.0);
    expect(boosted).toBeGreaterThan(base);
    expect(boosted).toBeLessThanOrEqual(base * 1.5);
  });

  it('applies no boost for pages with CVR <= 2%', () => {
    const base = getTrafficScore(traffic, 'hvac');
    expect(getTrafficScore(traffic, 'hvac', 1.5)).toBe(base);
    expect(getTrafficScore(traffic, 'hvac', undefined)).toBe(base);
  });

  it('caps multiplier at 1.5x even for very high CVR', () => {
    const base = getTrafficScore(traffic, 'plumbing');
    expect(getTrafficScore(traffic, 'plumbing', 100)).toBe(base * 1.5);
  });
});
