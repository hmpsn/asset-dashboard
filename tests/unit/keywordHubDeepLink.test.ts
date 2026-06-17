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
    it('accepts every one of the seven segments the Hub honors', () => {
      // The value-space MUST equal the receiver's HubSegment ids (VALID_SEGMENTS in useKeywordHubState).
      for (const seg of ['all', 'in_strategy', 'tracked', 'needs_review', 'retired', 'local', 'striking_distance']) {
        expect(isKeywordHubSegment(seg)).toBe(true);
      }
    });
    it('accepts striking_distance (Phase 4c: the Ranking Distribution → Hub deep-link target)', () => {
      // The receiver (useKeywordHubState VALID_SEGMENTS) honors striking_distance; the sender set had
      // omitted it, silently dropping the tab. Sender == receiver is restored.
      expect(isKeywordHubSegment('striking_distance')).toBe(true);
      const qs = buildHubDeepLinkQuery({ keyword: 'x', segment: 'striking_distance' });
      expect(qs).toContain('tab=striking_distance');
    });
    it('rejects an unknown value', () => {
      expect(isKeywordHubSegment('nope')).toBe(false);
    });
    it('rejects null / undefined', () => {
      expect(isKeywordHubSegment(null)).toBe(false);
      expect(isKeywordHubSegment(undefined)).toBe(false);
    });
    it('rejects valid KeywordCommandCenterFilter values that are NOT Hub segments (#4)', () => {
      // These are real filter ids (the KCC summary emits them) but the Hub does
      // not render them as segment pills — a deep link with one would silently
      // fall back to the default segment, so the sender must never emit it.
      expect(isKeywordHubSegment('content')).toBe(false);
      expect(isKeywordHubSegment('page_assigned')).toBe(false);
      expect(isKeywordHubSegment('lost_visibility')).toBe(false);
      expect(isKeywordHubSegment('raw_evidence')).toBe(false);
    });
  });

  describe('value-space contract (#4): sender accepts only what the receiver honors', () => {
    it('buildHubDeepLinkQuery omits tab for a valid-but-non-Hub filter', () => {
      // @ts-expect-error — 'content' is a real filter but outside the Hub set
      const qs = buildHubDeepLinkQuery({ keyword: 'x', segment: 'content' });
      expect(qs).not.toContain('tab=');
    });
    it('readHubDeepLink drops a valid-but-non-Hub tab', () => {
      const result = readHubDeepLink(new URLSearchParams('q=foo&tab=content'));
      expect(result).toEqual({ query: 'foo', segment: undefined });
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
