import { describe, it, expect } from 'vitest';
import {
  HUB_DEEP_LINK_PARAMS,
  buildHubDeepLinkQuery,
  readHubDeepLink,
  isKeywordHubSegment,
} from '../../src/lib/keywordHubDeepLink';
import { keywordTrackingKey } from '../../src/lib/keywordTracking';

describe('keywordHubDeepLink', () => {
  describe('HUB_DEEP_LINK_PARAMS', () => {
    it('pins the param names', () => {
      expect(HUB_DEEP_LINK_PARAMS.query).toBe('q');
      expect(HUB_DEEP_LINK_PARAMS.segment).toBe('tab');
    });
  });

  describe('isKeywordHubSegment', () => {
    it('accepts a real filter id', () => {
      expect(isKeywordHubSegment('tracked')).toBe(true);
      expect(isKeywordHubSegment('in_strategy')).toBe(true);
      expect(isKeywordHubSegment('retired')).toBe(true);
    });
    it('rejects an unknown value', () => {
      expect(isKeywordHubSegment('nope')).toBe(false);
    });
    it('rejects null / undefined', () => {
      expect(isKeywordHubSegment(null)).toBe(false);
      expect(isKeywordHubSegment(undefined)).toBe(false);
    });
  });

  describe('buildHubDeepLinkQuery', () => {
    it('normalizes the keyword via keywordTrackingKey and includes the segment', () => {
      const qs = buildHubDeepLinkQuery({ keyword: 'Cosmetic  Dentistry', segment: 'tracked' });
      expect(qs.startsWith('?q=')).toBe(true);
      const params = new URLSearchParams(qs.slice(1));
      expect(params.get('q')).toBe(keywordTrackingKey('Cosmetic  Dentistry'));
      expect(qs).toContain('tab=tracked');
    });

    it('omits tab when no segment supplied', () => {
      const qs = buildHubDeepLinkQuery({ keyword: 'x' });
      const params = new URLSearchParams(qs.slice(1));
      expect(params.get('q')).toBe(keywordTrackingKey('x'));
      expect(qs).not.toContain('tab=');
    });

    it('omits tab when the segment is not a valid filter', () => {
      // @ts-expect-error — exercising the runtime guard against a bogus segment
      const qs = buildHubDeepLinkQuery({ keyword: 'x', segment: 'bogus' });
      expect(qs).not.toContain('tab=');
    });
  });

  describe('readHubDeepLink', () => {
    it('reads query + segment', () => {
      const result = readHubDeepLink(new URLSearchParams('q=foo&tab=retired'));
      expect(result).toEqual({ query: 'foo', segment: 'retired' });
    });

    it('ignores an unknown tab (returns undefined, does not throw)', () => {
      const result = readHubDeepLink(new URLSearchParams('q=foo&tab=bogus'));
      expect(result).toEqual({ query: 'foo', segment: undefined });
    });

    it('returns nulls when empty', () => {
      const result = readHubDeepLink(new URLSearchParams(''));
      expect(result).toEqual({ query: null, segment: undefined });
    });
  });

  describe('round-trip', () => {
    it('readHubDeepLink(buildHubDeepLinkQuery(...)) recovers the normalized query + segment', () => {
      const qs = buildHubDeepLinkQuery({ keyword: 'a b', segment: 'in_strategy' });
      const result = readHubDeepLink(new URLSearchParams(qs.slice(1)));
      expect(result).toEqual({ query: keywordTrackingKey('a b'), segment: 'in_strategy' });
    });
  });
});
