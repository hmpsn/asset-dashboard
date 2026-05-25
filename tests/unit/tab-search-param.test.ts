import { describe, expect, it } from 'vitest';
import {
  clearTabSearchParam,
  isValidTabSearchParam,
  resolveTabSearchParam,
} from '../../src/lib/tab-search-param';

describe('tab-search-param helpers', () => {
  it('accepts canonical values directly', () => {
    const resolved = resolveTabSearchParam<'a' | 'b'>('b', {
      validValues: ['a', 'b'],
      fallback: 'a',
    });
    expect(resolved).toBe('b');
  });

  it('maps legacy aliases to canonical values', () => {
    const resolved = resolveTabSearchParam<'decisions' | 'conversations'>('requests', {
      validValues: ['decisions', 'conversations'],
      fallback: 'decisions',
      legacyAliases: { requests: 'conversations' },
    });
    expect(resolved).toBe('conversations');
  });

  it('falls back when value is unknown', () => {
    const resolved = resolveTabSearchParam<'x' | 'y'>('z', {
      validValues: ['x', 'y'],
      fallback: 'x',
    });
    expect(resolved).toBe('x');
  });

  it('supports post-resolution normalization', () => {
    const resolved = resolveTabSearchParam<'reviews' | 'decisions'>('reviews', {
      validValues: ['reviews', 'decisions'],
      fallback: 'decisions',
      normalizeResolved: (value) => (value === 'reviews' ? 'decisions' : value),
    });
    expect(resolved).toBe('decisions');
  });

  it('validates tab values with type guard', () => {
    expect(isValidTabSearchParam('one', ['one', 'two'])).toBe(true);
    expect(isValidTabSearchParam('three', ['one', 'two'])).toBe(false);
  });

  it('removes tab query param while preserving other params', () => {
    const next = clearTabSearchParam(new URLSearchParams('tab=reviews&focus=cta'));
    expect(next?.get('tab')).toBeNull();
    expect(next?.get('focus')).toBe('cta');
  });

  it('returns null when tab is not present', () => {
    const next = clearTabSearchParam(new URLSearchParams('view=active'));
    expect(next).toBeNull();
  });
});
