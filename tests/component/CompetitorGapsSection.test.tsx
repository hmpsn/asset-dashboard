// Component tests for CompetitorGapsSection (Client Revenue R2-A).
//
// Verifies the tier-gating contract and the empty state:
//   - Growth sees the soft-gate upsell (TierGate), NOT live competitor data,
//     and the endpoint is never called for non-Premium tiers.
//   - Premium with data sees the real gap rows.
//   - Premium with no gaps yet sees the action-oriented EmptyState.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { ClientCompetitorGapsResponse } from '../../shared/types/competitor-gaps';

vi.mock('../../src/api/competitorGaps', () => ({
  competitorGapsApi: { getGaps: vi.fn() },
}));

import { competitorGapsApi } from '../../src/api/competitorGaps';
import { CompetitorGapsSection } from '../../src/components/client/CompetitorGapsSection';

const mockGetGaps = vi.mocked(competitorGapsApi.getGaps);

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const PREMIUM_RESPONSE: ClientCompetitorGapsResponse = {
  total: 1,
  gaps: [
    {
      keyword: 'emergency plumber riverside',
      competitorDomain: 'rivalplumbing.com',
      competitorPosition: 2,
      opportunityBand: 'high',
      demandLabel: 'High search demand',
      benchmark: 'rivalplumbing.com ranks in the top 3 for this — you\'re not on page one yet.',
    },
  ],
};

describe('CompetitorGapsSection', () => {
  beforeEach(() => {
    mockGetGaps.mockReset();
  });

  it('shows the Premium soft-gate for Growth and never fetches competitor data', async () => {
    render(
      createElement(CompetitorGapsSection, { workspaceId: 'ws1', tier: 'growth' }),
      { wrapper: wrapper() },
    );

    // The TierGate upsell copy is shown.
    expect(await screen.findByText(/Available on Premium/i)).toBeTruthy();
    // Non-Premium tiers must NOT hit the (402-guarded) endpoint.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetGaps).not.toHaveBeenCalled();
  });

  it('shows real competitor gap rows for Premium', async () => {
    mockGetGaps.mockResolvedValueOnce(PREMIUM_RESPONSE);

    render(
      createElement(CompetitorGapsSection, { workspaceId: 'ws1', tier: 'premium' }),
      { wrapper: wrapper() },
    );

    expect(await screen.findByText('emergency plumber riverside')).toBeTruthy();
    expect(screen.getByText(/High opportunity/i)).toBeTruthy();
    expect(mockGetGaps).toHaveBeenCalledWith('ws1');
  });

  it('shows an action-oriented empty state for Premium with no gaps', async () => {
    mockGetGaps.mockResolvedValueOnce({ total: 0, gaps: [] });

    render(
      createElement(CompetitorGapsSection, { workspaceId: 'ws1', tier: 'premium' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText(/No competitor gaps found yet/i)).toBeTruthy();
    });
  });
});
