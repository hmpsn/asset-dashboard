import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getLatestBusinessListings,
  getLatestOwnedListing,
  storeBusinessListingSnapshots,
} from '../../server/business-listings-store.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let workspaceId = '';

beforeEach(() => {
  workspaceId = createWorkspace(`Business Listings ${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

describe('business-listings-store', () => {
  it('round-trips an owned listing + a competitor: rating, reviewCount, attributes, tri-state', () => {
    storeBusinessListingSnapshots(workspaceId, '2026-06-24', [
      {
        placeId: 'place-owned',
        isOwned: true,
        title: 'My Cafe',
        rating: 3.9,
        reviewCount: 12,
        claimed: false,
        attributes: ['has_restroom'],
        ratingDistribution: { '1': 1, '2': 0, '3': 2, '4': 4, '5': 5 },
        totalPhotos: 7,
      },
      {
        placeId: 'place-competitor',
        isOwned: false,
        title: 'Rival Cafe',
        rating: 4.6,
        reviewCount: 80,
        claimed: true,
      },
    ]);

    const latest = getLatestBusinessListings(workspaceId);
    expect(latest).toHaveLength(2);

    const owned = latest.find(l => l.placeId === 'place-owned')!;
    const competitor = latest.find(l => l.placeId === 'place-competitor')!;

    // rating / reviewCount round-trip
    expect(owned.rating).toBe(3.9);
    expect(owned.reviewCount).toBe(12);
    expect(competitor.rating).toBe(4.6);
    expect(competitor.reviewCount).toBe(80);

    // tri-state: false (0) preserved, never collapsed to undefined
    expect(owned.isOwned).toBe(true);
    expect(owned.claimed).toBe(false);
    expect(competitor.isOwned).toBe(false);
    expect(competitor.claimed).toBe(true);

    // attributes (JSON string[]) round-trip
    expect(owned.attributes).toEqual(['has_restroom']);
    expect(competitor.attributes).toEqual([]);

    // rating_distribution round-trip
    expect(owned.ratingDistribution).toEqual({ '1': 1, '2': 0, '3': 2, '4': 4, '5': 5 });
    expect(competitor.ratingDistribution).toBeUndefined();

    expect(owned.totalPhotos).toBe(7);
    expect(owned.snapshotDate).toBe('2026-06-24');
    expect(owned.workspaceId).toBe(workspaceId);
    expect(owned.fetchedAt).toBeTruthy();
  });

  it('maps a zero-review listing rating/reviewCount to undefined (never 0)', () => {
    storeBusinessListingSnapshots(workspaceId, '2026-06-24', [
      {
        placeId: 'place-new',
        isOwned: true,
        title: 'Brand New',
        rating: undefined,
        reviewCount: undefined,
        attributes: [],
      },
    ]);

    const latest = getLatestBusinessListings(workspaceId);
    expect(latest).toHaveLength(1);
    expect(latest[0].rating).toBeUndefined();
    expect(latest[0].reviewCount).toBeUndefined();
    // explicitly assert it is NOT 0
    expect(latest[0].rating).not.toBe(0);
    expect(latest[0].reviewCount).not.toBe(0);
  });

  it('upserts on (workspace_id, place_id, snapshot_date) — second store UPDATES, not duplicates', () => {
    storeBusinessListingSnapshots(workspaceId, '2026-06-24', [
      { placeId: 'place-owned', isOwned: true, rating: 3.9, reviewCount: 12, claimed: false },
    ]);
    storeBusinessListingSnapshots(workspaceId, '2026-06-24', [
      { placeId: 'place-owned', isOwned: true, rating: 4.1, reviewCount: 20, claimed: true },
    ]);

    const latest = getLatestBusinessListings(workspaceId);
    expect(latest).toHaveLength(1);
    expect(latest[0].rating).toBe(4.1);
    expect(latest[0].reviewCount).toBe(20);
    expect(latest[0].claimed).toBe(true);
  });

  it('getLatestBusinessListings returns the most recent row per place_id (max date)', () => {
    storeBusinessListingSnapshots(workspaceId, '2026-06-20', [
      { placeId: 'place-owned', isOwned: true, rating: 3.5, reviewCount: 8 },
    ]);
    storeBusinessListingSnapshots(workspaceId, '2026-06-24', [
      { placeId: 'place-owned', isOwned: true, rating: 4.0, reviewCount: 15 },
    ]);

    const latest = getLatestBusinessListings(workspaceId);
    expect(latest).toHaveLength(1);
    expect(latest[0].snapshotDate).toBe('2026-06-24');
    expect(latest[0].rating).toBe(4.0);
  });

  it('drops rows with a blank placeId', () => {
    storeBusinessListingSnapshots(workspaceId, '2026-06-24', [
      { placeId: '', isOwned: false, rating: 4.6 },
      { placeId: '   ', isOwned: false, rating: 4.4 },
      { placeId: 'place-real', isOwned: true, rating: 3.9 },
    ]);

    const latest = getLatestBusinessListings(workspaceId);
    expect(latest).toHaveLength(1);
    expect(latest[0].placeId).toBe('place-real');
  });

  it('getLatestOwnedListing returns the owned listing (not the competitor)', () => {
    storeBusinessListingSnapshots(workspaceId, '2026-06-24', [
      { placeId: 'place-owned', isOwned: true, title: 'Mine', rating: 3.9, reviewCount: 12 },
      { placeId: 'place-competitor', isOwned: false, title: 'Rival', rating: 4.6, reviewCount: 80 },
    ]);

    const owned = getLatestOwnedListing(workspaceId);
    expect(owned).toBeDefined();
    expect(owned!.placeId).toBe('place-owned');
    expect(owned!.isOwned).toBe(true);
    expect(owned!.title).toBe('Mine');
  });

  it('getLatestOwnedListing returns the most recent owned row, optionally filtered by location', () => {
    storeBusinessListingSnapshots(workspaceId, '2026-06-20', [
      { placeId: 'place-a', isOwned: true, locationId: 'loc-1', rating: 3.0 },
    ]);
    storeBusinessListingSnapshots(workspaceId, '2026-06-24', [
      { placeId: 'place-b', isOwned: true, locationId: 'loc-2', rating: 4.2 },
    ]);

    // unfiltered → most recent owned across locations
    expect(getLatestOwnedListing(workspaceId)!.placeId).toBe('place-b');
    // filtered to loc-1 → that location's owned row
    const loc1 = getLatestOwnedListing(workspaceId, 'loc-1');
    expect(loc1).toBeDefined();
    expect(loc1!.placeId).toBe('place-a');
    expect(loc1!.locationId).toBe('loc-1');
    // unknown location → undefined
    expect(getLatestOwnedListing(workspaceId, 'loc-nope')).toBeUndefined();
  });

  it('returns undefined from getLatestOwnedListing when no owned listing exists', () => {
    storeBusinessListingSnapshots(workspaceId, '2026-06-24', [
      { placeId: 'place-competitor', isOwned: false, rating: 4.6 },
    ]);
    expect(getLatestOwnedListing(workspaceId)).toBeUndefined();
  });

  it('scopes reads by workspace_id', () => {
    const otherWorkspaceId = createWorkspace(`Business Other ${Date.now()}`).id;
    try {
      storeBusinessListingSnapshots(workspaceId, '2026-06-24', [
        { placeId: 'place-owned', isOwned: true, rating: 3.9 },
      ]);
      storeBusinessListingSnapshots(otherWorkspaceId, '2026-06-24', [
        { placeId: 'place-owned', isOwned: true, rating: 4.9 },
      ]);

      expect(getLatestBusinessListings(workspaceId)).toHaveLength(1);
      expect(getLatestBusinessListings(workspaceId)[0].rating).toBe(3.9);
      expect(getLatestOwnedListing(workspaceId)!.rating).toBe(3.9);
      expect(getLatestOwnedListing(otherWorkspaceId)!.rating).toBe(4.9);
    } finally {
      deleteWorkspace(otherWorkspaceId);
    }
  });
});
