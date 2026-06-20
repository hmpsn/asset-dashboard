import { describe, it, expect } from 'vitest';
import { fmtEstimateMoney, fmtEstimateRatio } from '../../src/utils/formatNumbers';

describe('fmtEstimateMoney (banded, estimate-labeled)', () => {
  it('bands dollars to two significant figures with a ~ prefix', () => {
    expect(fmtEstimateMoney(11_234)).toBe('~$11,000');
    expect(fmtEstimateMoney(1_499)).toBe('~$1,500');
    expect(fmtEstimateMoney(94_900)).toBe('~$95,000');
  });
  it('never emits cents on an estimate', () => {
    expect(fmtEstimateMoney(11_234)).not.toMatch(/\.\d/);
  });
  it('floors small values to a readable band, not $0', () => {
    expect(fmtEstimateMoney(42)).toBe('~$42');
    expect(fmtEstimateMoney(0)).toBe('~$0');
  });
});

describe('fmtEstimateRatio (one significant figure, estimate-labeled)', () => {
  it('rounds a multiple to one significant figure with ~ and ×', () => {
    expect(fmtEstimateRatio(7.34)).toBe('~7×');
    expect(fmtEstimateRatio(4.2)).toBe('~4×');
    expect(fmtEstimateRatio(11.9)).toBe('~10×');
  });
  it('uses one decimal only below 1×', () => {
    expect(fmtEstimateRatio(0.62)).toBe('~0.6×');
  });
  it('guards divide-by-zero / non-finite to an em-dash sentinel', () => {
    expect(fmtEstimateRatio(Infinity)).toBe('—');
    expect(fmtEstimateRatio(Number.NaN)).toBe('—');
  });
});
