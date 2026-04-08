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

describe('kdFraming — tier boundary values', () => {
  it('KD 30 → Low competition (boundary — last of Low tier)', () => {
    expect(kdFraming(30)).toBe('Low competition — strong odds');
  });
  it('KD 31 → Moderate competition (boundary — first of Moderate tier)', () => {
    expect(kdFraming(31)).toBe('Moderate competition — achievable with a strong post');
  });
  it('KD 60 → Moderate competition (boundary — last of Moderate tier)', () => {
    expect(kdFraming(60)).toBe('Moderate competition — achievable with a strong post');
  });
  it('KD 61 → Competitive (boundary — first of Competitive tier)', () => {
    expect(kdFraming(61)).toBe('Competitive — requires authority and depth');
  });
  it('KD 80 → Competitive (boundary — last of Competitive tier)', () => {
    expect(kdFraming(80)).toBe('Competitive — requires authority and depth');
  });
  it('KD 81 → Highly competitive (boundary — first of Highly competitive tier)', () => {
    expect(kdFraming(81)).toBe('Highly competitive — long-term play');
  });
  it('KD 100 → Highly competitive (max)', () => {
    expect(kdFraming(100)).toBe('Highly competitive — long-term play');
  });
});
