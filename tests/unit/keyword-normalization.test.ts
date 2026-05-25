import { describe, expect, it } from 'vitest';
import { findBestParent, isVariantOf } from '../../shared/keyword-normalization.js';

describe('isVariantOf', () => {
  it('returns true when gscQuery is a superset of strategyKeyword tokens', () => {
    expect(isVariantOf('teeth whitening austin', 'teeth whitening')).toBe(true);
  });

  it('returns true for order-independent token match', () => {
    expect(isVariantOf('austin teeth whitening', 'teeth whitening')).toBe(true);
  });

  it('returns true for exact match', () => {
    expect(isVariantOf('teeth whitening', 'teeth whitening')).toBe(true);
  });

  it('returns false when gscQuery is missing a strategy token', () => {
    expect(isVariantOf('teeth cleaning austin', 'teeth whitening')).toBe(false);
  });

  it('returns false when gscQuery is a proper subset of strategy keyword', () => {
    expect(isVariantOf('dentist', 'dentist near me')).toBe(false);
  });

  it('returns false for single-token strategy keywords', () => {
    expect(isVariantOf('dentist austin', 'dentist')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(isVariantOf('', 'teeth whitening')).toBe(false);
    expect(isVariantOf('teeth whitening austin', '')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isVariantOf('Teeth Whitening Austin', 'teeth whitening')).toBe(true);
    expect(isVariantOf('teeth whitening austin', 'Teeth Whitening')).toBe(true);
  });
});

describe('findBestParent', () => {
  const metricsMap = new Map([
    ['teeth whitening', 100],
    ['teeth cleaning', 50],
    ['dentist near me', 200],
  ]);

  it('returns the strategy key with the most matching tokens', () => {
    const result = findBestParent(
      'dentist near me austin',
      ['teeth whitening', 'dentist near me'],
      metricsMap,
    );
    expect(result).toBe('dentist near me');
  });

  it('tie-breaks by impressions when token counts are equal', () => {
    const result = findBestParent(
      'teeth cleaning whitening',
      ['teeth whitening', 'teeth cleaning'],
      metricsMap,
    );
    expect(result).toBe('teeth whitening');
  });

  it('returns null when no strategy keyword matches', () => {
    const result = findBestParent('unrelated query', ['teeth whitening', 'teeth cleaning'], metricsMap);
    expect(result).toBeNull();
  });

  it('returns null for empty strategy keys array', () => {
    expect(findBestParent('teeth whitening austin', [], metricsMap)).toBeNull();
  });
});
