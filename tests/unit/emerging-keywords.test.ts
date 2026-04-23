import { describe, it, expect } from 'vitest';
import { isKeywordEmerging } from '../../server/analytics-intelligence.js';

describe('isKeywordEmerging', () => {
  it('returns true for consistently rising trend', () => {
    expect(isKeywordEmerging({ trend: [100, 120, 140, 180, 210, 230] })).toBe(true);
  });

  it('returns false for flat trend', () => {
    expect(isKeywordEmerging({ trend: [100, 105, 98, 102, 101, 100] })).toBe(false);
  });

  it('returns false for declining trend', () => {
    expect(isKeywordEmerging({ trend: [200, 180, 150, 120, 100, 80] })).toBe(false);
  });

  it('returns false when trend array is empty', () => {
    expect(isKeywordEmerging({ trend: [] })).toBe(false);
  });

  it('returns false when trend array is undefined', () => {
    expect(isKeywordEmerging({})).toBe(false);
  });

  it('handles noisy-but-rising trend (net positive across last 6 months)', () => {
    expect(isKeywordEmerging({ trend: [100, 115, 110, 130, 125, 160] })).toBe(true);
  });
});
