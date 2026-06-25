import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GbpReviewsPanel } from '../../src/components/local-seo/GbpReviewsPanel';
import type { GbpReviewsReadResponse } from '../../src/api/localSeo';

// Flag-CI gotcha: GbpReviewsPanel renders <FeatureFlag flag="local-gbp"> for the refresh button
// AND reads useFeatureFlag directly to decide whether to show the bootstrap (empty) card — mock it
// so no QueryClientProvider / network is needed. `flagEnabled` is mutable so a test can flip the
// flag off; the factory reads it at call time. Defaults ON (reset in beforeEach).
let flagEnabled = true;
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => flagEnabled,
}));

const refreshMutate = vi.fn();
let gbpData: GbpReviewsReadResponse | undefined;

vi.mock('../../src/hooks/admin', () => ({
  useGbpReviews: () => ({ data: gbpData }),
  useLocalGbpRefresh: () => ({ mutate: refreshMutate, isPending: false, error: null }),
}));

function makeListing(over: Partial<GbpReviewsReadResponse['owned'] & object> = {}) {
  return {
    placeId: 'place-own',
    title: 'My Coffee Shop',
    isOwned: true,
    rating: 3.9,
    reviewCount: 12,
    category: 'Coffee shop',
    attributes: ['wheelchair_accessible'],
    totalPhotos: 4,
    claimed: true,
    ...over,
  };
}

beforeEach(() => {
  gbpData = undefined;
  flagEnabled = true;
  refreshMutate.mockClear();
});

afterEach(() => cleanup());

describe('GbpReviewsPanel', () => {
  it('renders own + top-competitor review counts and the completeness state', () => {
    gbpData = {
      owned: makeListing({ rating: 3.9, reviewCount: 12, claimed: false, totalPhotos: 0, attributes: [], category: undefined }),
      competitors: [
        { placeId: 'c-1', title: 'Rival Roasters', isOwned: false, rating: 4.6, reviewCount: 80, attributes: [] },
      ],
      // claimed=false, no photos, no attributes, no category → 0/100.
      completenessScore: 0,
    };

    render(<GbpReviewsPanel workspaceId="ws-1" />);

    // Own counts/rating (blue data tone).
    expect(screen.getByText(/My Coffee Shop/)).toBeTruthy();
    expect(screen.getByText(/3\.9★ · 12 reviews/)).toBeTruthy();
    // Competitor counts/rating.
    expect(screen.getByText(/Rival Roasters/)).toBeTruthy();
    expect(screen.getByText(/4\.6★ · 80 reviews/)).toBeTruthy();
    // Review gap copy (80 - 12 = 68 behind).
    expect(screen.getByText(/68 behind the leader/)).toBeTruthy();
    // Completeness state (score + concrete missing signals; no claim-status badge — unreliable).
    expect(screen.getByText('0/100')).toBeTruthy();
    expect(screen.getByText(/Missing:/)).toBeTruthy();
    // Flag-gated refresh trigger present + wired.
    const refreshBtn = screen.getByRole('button', { name: /Refresh GBP & reviews/ });
    fireEvent.click(refreshBtn);
    expect(refreshMutate).toHaveBeenCalledTimes(1);
  });

  it('renders the bootstrap refresh button (not nothing) when the flag is ON but no listings yet', () => {
    // Chicken-and-egg guard: with the flag on and zero data, the panel must still surface the
    // "Refresh GBP & reviews" trigger so the very first refresh can be kicked off from the UI.
    gbpData = { owned: null, competitors: [], completenessScore: null };
    render(<GbpReviewsPanel workspaceId="ws-1" />);
    expect(screen.getByText(/No GBP data yet/)).toBeTruthy();
    const refreshBtn = screen.getByRole('button', { name: /Refresh GBP & reviews/ });
    fireEvent.click(refreshBtn);
    expect(refreshMutate).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the flag is OFF and there are no listings', () => {
    flagEnabled = false;
    gbpData = { owned: null, competitors: [], completenessScore: null };
    const { container } = render(<GbpReviewsPanel workspaceId="ws-1" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Reviews vs competitors/)).toBeNull();
    expect(screen.queryByText(/No GBP data yet/)).toBeNull();
  });

  it('shows a high completeness score in the success state', () => {
    gbpData = {
      owned: makeListing(), // claimed + photo + attribute + category → 100.
      competitors: [],
      completenessScore: 100,
    };
    render(<GbpReviewsPanel workspaceId="ws-1" />);
    expect(screen.getByText('100/100')).toBeTruthy();
  });
});
