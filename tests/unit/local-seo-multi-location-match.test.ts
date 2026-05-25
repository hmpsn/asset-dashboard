import { describe, expect, it } from 'vitest';

import { evaluateLocalBusinessMatch, isOwnedLocalResult } from '../../server/local-seo.js';
import type { ClientLocation, LocalVisibilityBusinessResult } from '../../shared/types/local-seo.js';

function makeLocation(overrides: Partial<ClientLocation> = {}): ClientLocation {
  return {
    id: 'loc-1',
    workspaceId: 'ws-1',
    name: 'Acme Dental',
    domain: 'acmedental.com',
    phone: '5125550100',
    streetAddress: '123 Main St',
    isPrimary: true,
    status: 'confirmed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeResult(overrides: Partial<LocalVisibilityBusinessResult> = {}): LocalVisibilityBusinessResult {
  return {
    rank: 1,
    title: 'Unknown Competitor',
    domain: 'competitor.com',
    url: 'https://competitor.com',
    address: '456 Other St',
    phone: '5125559999',
    ...overrides,
  };
}

describe('evaluateLocalBusinessMatch - multi-location', () => {
  it('returns NOT_FOUND for empty results', () => {
    const result = evaluateLocalBusinessMatch([makeLocation()], []);
    expect(result.found).toBe(false);
    expect(result.confidence).toBe('not_found');
  });

  it('returns NOT_FOUND when no location matches', () => {
    const result = evaluateLocalBusinessMatch(
      [makeLocation()],
      [makeResult({ domain: 'competitor.com', title: 'Competitor Dental' })],
    );
    expect(result.found).toBe(false);
  });

  it('VERIFIED: domain + name match sets matchedLocationId', () => {
    const loc = makeLocation({ id: 'loc-downtown', name: 'Acme Dental' });
    const result = evaluateLocalBusinessMatch(
      [loc],
      [makeResult({ domain: 'acmedental.com', title: 'Acme Dental', rank: 2 })],
    );
    expect(result.found).toBe(true);
    expect(result.confidence).toBe('verified');
    expect(result.rank).toBe(2);
    expect(result.matchedLocationId).toBe('loc-downtown');
    expect(result.matchedLocationName).toBe('Acme Dental');
  });

  it('matches second location when first does not match', () => {
    const loc1 = makeLocation({ id: 'loc-1', name: 'Acme Downtown', domain: 'downtown.acme.com' });
    const loc2 = makeLocation({ id: 'loc-2', name: 'Acme Midtown', domain: 'midtown.acme.com' });
    const result = evaluateLocalBusinessMatch(
      [loc1, loc2],
      [makeResult({ domain: 'midtown.acme.com', title: 'Acme Midtown', rank: 1 })],
    );
    expect(result.found).toBe(true);
    expect(result.matchedLocationId).toBe('loc-2');
    expect(result.matchedLocationName).toBe('Acme Midtown');
  });

  it('returns the best-ranked location when multiple locations have the same confidence', () => {
    const loc1 = makeLocation({ id: 'loc-1', name: 'Acme Downtown', domain: 'downtown.acme.com' });
    const loc2 = makeLocation({ id: 'loc-2', name: 'Acme Midtown', domain: 'midtown.acme.com' });
    const result = evaluateLocalBusinessMatch(
      [loc1, loc2],
      [
        makeResult({ domain: 'downtown.acme.com', title: 'Acme Downtown', rank: 6 }),
        makeResult({ domain: 'midtown.acme.com', title: 'Acme Midtown', rank: 1 }),
      ],
    );
    expect(result.confidence).toBe('verified');
    expect(result.rank).toBe(1);
    expect(result.matchedLocationId).toBe('loc-2');
  });

  it('returns highest confidence match across locations', () => {
    const loc1 = makeLocation({ id: 'loc-1', name: 'Acme', domain: undefined });
    const loc2 = makeLocation({ id: 'loc-2', name: 'Acme Downtown', domain: 'acmedental.com' });
    const result = evaluateLocalBusinessMatch(
      [loc1, loc2],
      [makeResult({ domain: 'acmedental.com', title: 'Acme Downtown', rank: 1 })],
    );
    expect(result.confidence).toBe('verified');
    expect(result.matchedLocationId).toBe('loc-2');
  });

  it('matches provider identity from gbpPlaceId to result cid', () => {
    const loc = makeLocation({ id: 'loc-gbp', gbpPlaceId: 'cid-12345', domain: undefined });
    const result = evaluateLocalBusinessMatch(
      [loc],
      [makeResult({ title: 'Directory Title', domain: 'directory.com', cid: 'cid 12345', rank: 4 })],
    );
    expect(result.confidence).toBe('verified');
    expect(result.matchedLocationId).toBe('loc-gbp');
  });

  it('fallback: empty locations array returns NOT_FOUND', () => {
    const result = evaluateLocalBusinessMatch(
      [],
      [makeResult({ domain: 'acmedental.com', title: 'Acme Dental' })],
    );
    expect(result.found).toBe(false);
  });

  describe('confidence tier ordering', () => {
    it('prefers strong_match at rank 1 over verified at rank 3', () => {
      // strong_match > possible_match in priority, verified > strong_match.
      // Two locs: loc-A gets strong_match rank 1; loc-B gets verified rank 3.
      // Verified should win (higher tier), NOT the better rank.
      const locA = makeLocation({ id: 'loc-a', domain: undefined, phone: '5125550111' });
      const locB = makeLocation({ id: 'loc-b', domain: 'acmedental.com' });
      const result = evaluateLocalBusinessMatch(
        [locA, locB],
        [
          // Rank-1 result: phone matches locA → strong_match
          makeResult({ rank: 1, domain: 'competitor.com', phone: '5125550111', title: 'Other Dental' }),
          // Rank-3 result: domain + name matches locB → verified
          makeResult({ rank: 3, domain: 'acmedental.com', title: 'Acme Dental' }),
        ],
      );
      expect(result.confidence).toBe('verified');
      expect(result.matchedLocationId).toBe('loc-b');
      expect(result.rank).toBe(3);
    });

    it('within same confidence tier, lower rank wins', () => {
      // Both locs match via domain-only → strong_match. The lower rank (2) should win.
      const locA = makeLocation({ id: 'loc-a', name: 'Acme Downtown', domain: 'acme-downtown.com' });
      const locB = makeLocation({ id: 'loc-b', name: 'Acme Midtown', domain: 'acme-midtown.com' });
      const result = evaluateLocalBusinessMatch(
        [locA, locB],
        [
          // Rank 5: domain matches locA but title doesn't (triggers strong_match, not verified).
          makeResult({ rank: 5, domain: 'acme-downtown.com', title: 'Totally Different Title' }),
          // Rank 2: domain matches locB but title doesn't → also strong_match.
          makeResult({ rank: 2, domain: 'acme-midtown.com', title: 'Totally Different Title' }),
        ],
      );
      expect(result.confidence).toBe('strong_match');
      expect(result.matchedLocationId).toBe('loc-b');
      expect(result.rank).toBe(2);
    });
  });
});

describe('isOwnedLocalResult - competitor scrubbing', () => {
  const baseLocation = makeLocation({
    id: 'loc-owner',
    domain: 'acmedental.com',
    phone: '5125550100',
    streetAddress: '123 Main St',
    gbpPlaceId: 'cid-999',
  });

  it('scrubs by domain match', () => {
    const result = makeResult({ domain: 'acmedental.com', title: 'Other Name' });
    expect(isOwnedLocalResult(result, [baseLocation])).toBe(true);
  });

  it('scrubs by GBP CID match', () => {
    const result = makeResult({ domain: 'unrelated.com', cid: 'cid 999', title: 'Other Name' });
    expect(isOwnedLocalResult(result, [baseLocation])).toBe(true);
  });

  it('scrubs by phone match', () => {
    const result = makeResult({ domain: 'different.com', phone: '512-555-0100', title: 'Other Name' });
    expect(isOwnedLocalResult(result, [baseLocation])).toBe(true);
  });

  it('scrubs by street address match', () => {
    const result = makeResult({ domain: 'different.com', address: '123 Main St, Austin TX', title: 'Other Name' });
    expect(isOwnedLocalResult(result, [baseLocation])).toBe(true);
  });

  it('does NOT scrub by name alone (critical: name-only is insufficient)', () => {
    // All four corroborating signals absent — only the name matches.
    const result = makeResult({ domain: 'competitor.com', phone: '5125559999', address: '789 Other Ave', title: 'Acme Dental' });
    const nameOnlyLocation = makeLocation({
      id: 'loc-name-only',
      domain: undefined,
      phone: undefined,
      streetAddress: undefined,
      gbpPlaceId: undefined,
      name: 'Acme Dental',
    });
    expect(isOwnedLocalResult(result, [nameOnlyLocation])).toBe(false);
  });

  it('does NOT scrub an unrelated competitor', () => {
    const result = makeResult({ domain: 'competitor.com', phone: '5125559999', title: 'Competitor Dental' });
    expect(isOwnedLocalResult(result, [baseLocation])).toBe(false);
  });

  it('scrubs when any location in the array matches', () => {
    const otherLocation = makeLocation({ id: 'loc-2', domain: 'branch2.com', phone: undefined });
    const result = makeResult({ domain: 'branch2.com', title: 'Our Branch 2' });
    expect(isOwnedLocalResult(result, [baseLocation, otherLocation])).toBe(true);
  });
});
