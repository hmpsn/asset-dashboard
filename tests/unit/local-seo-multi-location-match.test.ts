import { describe, expect, it } from 'vitest';

import { evaluateLocalBusinessMatch } from '../../server/local-seo.js';
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
});
