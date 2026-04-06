import { describe, it, expect } from 'vitest';
import { kdFraming, kdTooltip } from '../../src/lib/kdFraming.js';

describe('kdFraming — StrategyTab integration values', () => {
  it('KD 10 → Low competition label', () => {
    expect(kdFraming(10)).toBe('Low competition — strong odds');
  });
  it('KD 45 → Moderate competition label', () => {
    expect(kdFraming(45)).toBe('Moderate competition — achievable with a strong post');
  });
  it('KD 70 → Competitive label', () => {
    expect(kdFraming(70)).toBe('Competitive — requires authority and depth');
  });
  it('KD 90 → Highly competitive label', () => {
    expect(kdFraming(90)).toBe('Highly competitive — long-term play');
  });
  it('kdTooltip for KD 45 contains number and label', () => {
    const tip = kdTooltip(45);
    expect(tip).toContain('45');
    expect(tip).toContain('Moderate competition');
  });
  it('kdFraming undefined → undefined', () => {
    expect(kdFraming(undefined)).toBeUndefined();
  });
});
