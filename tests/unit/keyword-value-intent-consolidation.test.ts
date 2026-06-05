import { describe, it, expect } from 'vitest';
import { deriveValueIntent, valueIntentWeight } from '../../server/scoring/keyword-value-score.js';
import { INTENT_WEIGHT, DEFAULT_INTENT_WEIGHT } from '../../server/scoring/opportunity-value.js';

describe('deriveValueIntent — the single keyword intent classifier', () => {
  it('maps comparison → commercial (0.7) from a provided intent', () => {
    expect(deriveValueIntent('dentist vs orthodontist', 'comparison')).toBe('commercial');
    expect(valueIntentWeight(deriveValueIntent('x', 'comparison'))).toBe(INTENT_WEIGHT.commercial); // 0.7
  });
  it('passes the 4 buckets through', () => {
    for (const v of ['transactional', 'commercial', 'informational', 'navigational'] as const) {
      expect(deriveValueIntent('kw', v)).toBe(v);
    }
  });
  it('falls back to the regex classifier when intent is absent (full-derive)', () => {
    expect(deriveValueIntent('what causes bad breath')).toBe('informational');
    expect(deriveValueIntent('teeth cleaning sarasota')).toBe('transactional');
    expect(deriveValueIntent('best dentist near me')).toBe('commercial');
  });
  it('never throws on an empty keyword (primaryKeyword can be "")', () => {
    expect(() => deriveValueIntent('', undefined)).not.toThrow();
    expect(deriveValueIntent('', undefined)).toBe('transactional'); // classifier default
  });
  it('is non-null for any input (no DEFAULT_INTENT_WEIGHT path via this fn)', () => {
    expect(deriveValueIntent('anything', 'garbage-not-a-bucket')).not.toBeNull();
    expect(DEFAULT_INTENT_WEIGHT).toBe(0.5); // sanity: the value the OLD toOpportunityIntent leaked to
  });
});
