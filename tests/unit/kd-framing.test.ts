import { describe, it, expect } from 'vitest';
import { kdFraming, kdTooltip } from '../../src/lib/kdFraming.js';

describe('kdFraming', () => {
  it('returns low-competition label for KD 0', () => {
    expect(kdFraming(0)).toBe('Low competition — strong odds');
  });

  it('returns low-competition label for KD 30 (inclusive boundary)', () => {
    expect(kdFraming(30)).toBe('Low competition — strong odds');
  });

  it('returns moderate label for KD 31 (boundary)', () => {
    expect(kdFraming(31)).toBe('Moderate competition — achievable with a strong post');
  });

  it('returns moderate label for KD 60 (inclusive boundary)', () => {
    expect(kdFraming(60)).toBe('Moderate competition — achievable with a strong post');
  });

  it('returns competitive label for KD 61 (boundary)', () => {
    expect(kdFraming(61)).toBe('Competitive — requires authority and depth');
  });

  it('returns competitive label for KD 80 (inclusive boundary)', () => {
    expect(kdFraming(80)).toBe('Competitive — requires authority and depth');
  });

  it('returns highly-competitive label for KD 81 (boundary)', () => {
    expect(kdFraming(81)).toBe('Highly competitive — long-term play');
  });

  it('returns highly-competitive label for KD 100', () => {
    expect(kdFraming(100)).toBe('Highly competitive — long-term play');
  });

  it('returns undefined gracefully for undefined input', () => {
    expect(kdFraming(undefined)).toBeUndefined();
  });

  it('returns undefined gracefully for null-like input', () => {
    expect(kdFraming(0 as unknown as undefined)).toBe('Low competition — strong odds');
  });

  it('kdTooltip includes raw KD and framing label', () => {
    const tip = kdTooltip(45);
    expect(tip).toContain('45');
    expect(tip).toContain('Moderate competition');
  });

  it('kdTooltip returns empty string for undefined', () => {
    expect(kdTooltip(undefined)).toBe('');
  });
});
