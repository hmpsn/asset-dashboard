/**
 * SEO Decision Engine P7 — U5: GBP + reviews → local_visibility recommendation block.
 *
 * Proves the B4 generation block in server/recommendations.ts:
 *   • With the `local-gbp` flag ON and an owned listing trailing a competitor on review
 *     count AND being unclaimed, BOTH a `local_visibility:review_gap:*` and a
 *     `local_visibility:gbp_completeness:*` rec are minted (type `local_visibility`,
 *     REUSING the existing RecType — no new insight type / RecType).
 *   • With the flag OFF, NEITHER fires (byte-identical PAID surface — spec §F flag boundary).
 *
 * The block is posture-gated (LOCAL/HYBRID) like the sibling B2/B3 local blocks, so the
 * workspace is configured to LOCAL posture via updateLocalSeoConfiguration before generation.
 */

// ── Module-level mocks (hoisted by Vitest) ───────────────────────────────────
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  broadcast: vi.fn(),
  setBroadcast: vi.fn(),
}));

// ── Imports (after mock declarations) ────────────────────────────────────────
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { generateRecommendations } from '../../server/recommendations.js';
import { storeBusinessListingSnapshots } from '../../server/business-listings-store.js';
import { updateLocalSeoConfiguration } from '../../server/local-seo.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { updateWorkspace } from '../../server/workspaces.js';
import {
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_POSTURE,
} from '../../shared/types/local-seo.js';

const SNAPSHOT_DATE = '2026-06-24';

function seedListings(workspaceId: string): void {
  storeBusinessListingSnapshots(workspaceId, SNAPSHOT_DATE, [
    {
      placeId: 'place_owned_1',
      isOwned: true,
      marketId: 'mkt_austin',
      title: 'Acme Dental',
      domain: 'acme-dental.example.com',
      rating: 3.9,
      reviewCount: 12,
      attributes: [],
      totalPhotos: 0,
      claimed: false,
    },
    {
      placeId: 'place_comp_1',
      isOwned: false,
      marketId: 'mkt_austin',
      title: 'Bright Smiles Dentistry',
      domain: 'brightsmiles.example.com',
      rating: 4.6,
      reviewCount: 80,
      attributes: ['recommends_appointment'],
      totalPhotos: 20,
      claimed: true,
    },
  ]);
}

function makeLocalWorkspace(): { workspaceId: string; cleanup: () => void } {
  const s = seedWorkspace({});
  // Give the workspace a live domain + provider so local posture resolution is well-formed.
  updateWorkspace(s.workspaceId, {
    seoDataProvider: 'dataforseo',
    businessProfile: {
      phone: '(512) 555-0100',
      address: { street: '1 Test St', city: 'Austin', state: 'TX', country: 'US' },
    },
  });
  updateLocalSeoConfiguration(
    s.workspaceId,
    {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [
        {
          label: 'Austin, TX',
          city: 'Austin',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationCode: 1026201,
          status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
        },
      ],
    },
    true,
  );
  return { workspaceId: s.workspaceId, cleanup: s.cleanup };
}

describe('generateRecommendations — GBP + reviews (P7 U5)', () => {
  let onWsId: string;
  let onCleanup: () => void;
  let offWsId: string;
  let offCleanup: () => void;

  beforeAll(() => {
    const on = makeLocalWorkspace();
    onWsId = on.workspaceId;
    onCleanup = on.cleanup;
    seedListings(onWsId);
    setWorkspaceFlagOverride('local-gbp', onWsId, true);

    const off = makeLocalWorkspace();
    offWsId = off.workspaceId;
    offCleanup = off.cleanup;
    seedListings(offWsId);
    setWorkspaceFlagOverride('local-gbp', offWsId, false);
  });

  afterAll(() => {
    setWorkspaceFlagOverride('local-gbp', onWsId, null);
    setWorkspaceFlagOverride('local-gbp', offWsId, null);
    onCleanup();
    offCleanup();
  });

  it('mints a review-gap AND a GBP-completeness local_visibility rec when the flag is ON', async () => {
    const set = await generateRecommendations(onWsId);

    const gbpRecs = set.recommendations.filter(
      r => r.type === 'local_visibility'
        && (r.source.startsWith('local_visibility:review_gap:')
          || r.source.startsWith('local_visibility:gbp_completeness:')),
    );

    const reviewGap = gbpRecs.find(r => r.source.startsWith('local_visibility:review_gap:'));
    const completeness = gbpRecs.find(r => r.source.startsWith('local_visibility:gbp_completeness:'));

    expect(reviewGap, 'review-gap rec should be minted').toBeTruthy();
    expect(completeness, 'gbp-completeness rec should be minted').toBeTruthy();

    // Both reuse the existing local_visibility RecType (no new insight type / RecType).
    expect(reviewGap!.type).toBe('local_visibility');
    expect(completeness!.type).toBe('local_visibility');

    // OV is attached and is the canonical impactScore.
    expect(reviewGap!.opportunity?.modelVersion).toBe('ov-1');
    expect(reviewGap!.impactScore).toBe(reviewGap!.opportunity!.value);

    // The unclaimed owned listing drives the unclaimed completeness copy.
    expect(completeness!.title).toContain('unclaimed');
  });

  it('mints neither GBP rec when the flag is OFF', async () => {
    const set = await generateRecommendations(offWsId);

    const gbpRecs = set.recommendations.filter(
      r => r.source.startsWith('local_visibility:review_gap:')
        || r.source.startsWith('local_visibility:gbp_completeness:'),
    );

    expect(gbpRecs).toHaveLength(0);
  });
});
