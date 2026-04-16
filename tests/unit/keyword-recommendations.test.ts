/**
 * Unit tests for the opportunityScore scoring function in keyword-recommendations.ts.
 * Verifies the 55/45 volume/difficulty weighting and CPC bonus behavior.
 */
import { describe, it, expect } from 'vitest';
import { opportunityScore } from '../../server/keyword-recommendations.js';

describe('opportunityScore', () => {
  it('returns 0 for zero-volume keywords', () => {
    expect(opportunityScore(0, 50)).toBe(0);
  });

  it('returns higher score for lower difficulty at equal volume', () => {
    const easyKw = opportunityScore(1000, 20);
    const hardKw = opportunityScore(1000, 80);
    expect(easyKw).toBeGreaterThan(hardKw);
  });

  it('returns higher score for higher volume at equal difficulty', () => {
    const lowVol = opportunityScore(100, 50);
    const highVol = opportunityScore(10000, 50);
    expect(highVol).toBeGreaterThan(lowVol);
  });

  it('high-volume keyword (1000 vol, 50 KD) beats low-volume (10 vol, 5 KD)', () => {
    // Old 40/60 weighting: 10-vol/5-KD scored ~65, beating 1000-vol/50-KD at ~54.
    // New 55/45 weighting: 1000-vol/50-KD scores ~56, 10-vol/5-KD scores ~54.
    const bigVol = opportunityScore(1000, 50);
    const smallVol = opportunityScore(10, 5);
    expect(bigVol).toBeGreaterThan(smallVol);
  });

  it('CPC bonus adds exactly 10 points for $5+ CPC (max bonus)', () => {
    const noCpc = opportunityScore(1000, 50, 0);
    const highCpc = opportunityScore(1000, 50, 5);
    expect(highCpc).toBe(noCpc + 10);
  });

  it('CPC bonus is proportional — $2.50 CPC adds 5 points', () => {
    const noCpc = opportunityScore(1000, 50, 0);
    const midCpc = opportunityScore(1000, 50, 2.5);
    expect(midCpc).toBe(noCpc + 5);
  });

  it('CPC bonus caps at 10 points even for very high CPC', () => {
    const capped = opportunityScore(1000, 50, 100);
    const maxBonus = opportunityScore(1000, 50, 5);
    expect(capped).toBe(maxBonus);
  });

  it('default CPC is 0 when argument is omitted', () => {
    expect(opportunityScore(1000, 50)).toBe(opportunityScore(1000, 50, 0));
  });

  it('maximum score (100k vol, 0 KD, $10 CPC) does not exceed 110', () => {
    // volScore=100, diffScore=100, cpcBonus=10 → 100*0.55 + 100*0.45 + 10 = 110
    const maxScore = opportunityScore(100000, 0, 10);
    expect(maxScore).toBeLessThanOrEqual(110);
    expect(maxScore).toBeGreaterThanOrEqual(0);
  });
});
