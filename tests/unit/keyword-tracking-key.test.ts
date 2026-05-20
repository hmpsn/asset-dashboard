import { describe, expect, it } from 'vitest';
import { keywordTrackingKey } from '../../src/lib/keywordTracking';

describe('keywordTrackingKey', () => {
  it('matches the server tracked keyword canonical form for UI lookups', () => {
    expect(keywordTrackingKey(' Dental Implants ')).toBe('dental implants');
    expect(keywordTrackingKey(null)).toBe('');
  });
});
