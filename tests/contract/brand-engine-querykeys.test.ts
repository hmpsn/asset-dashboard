import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

describe('brand engine factory entries', () => {
  it('voiceProfile key matches legacy literal', () => {
    expect(queryKeys.admin.voiceProfile('ws-1')).toEqual(['admin-voice-profile', 'ws-1']);
  });
  it('brandIdentity key matches legacy literal', () => {
    expect(queryKeys.admin.brandIdentity('ws-1')).toEqual(['admin-brand-identity', 'ws-1']);
  });
  it('discoveryExtractionsAll is a prefix of discoveryExtractions', () => {
    expect(queryKeys.admin.discoveryExtractions('ws-1', 'src-1').slice(0, 2))
      .toEqual(queryKeys.admin.discoveryExtractionsAll('ws-1'));
  });
  it('discoverySources matches legacy literal', () => {
    expect(queryKeys.admin.discoverySources('ws-1')).toEqual(['admin-discovery-sources', 'ws-1']);
  });
});
