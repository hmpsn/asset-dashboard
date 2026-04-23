import { describe, it, expect } from 'vitest';
import { getRecoveryRate } from '../../server/recommendations.js';

describe('getRecoveryRate', () => {
  it('returns rate for a known issue type', () => {
    const r = getRecoveryRate('title');
    expect(r.perRec).toBe('10-25%');
    expect(r.summary).toBeCloseTo(0.18);
  });
  it('returns rate for a low-impact issue type', () => {
    const r = getRecoveryRate('og-image');
    expect(r.perRec).toBe('1-3%');
    expect(r.summary).toBeCloseTo(0.02);
  });
  it('returns default rate for unknown issue type', () => {
    const r = getRecoveryRate('made-up-issue');
    expect(r.perRec).toBe('5-15%');
    expect(r.summary).toBeCloseTo(0.12);
  });
});
