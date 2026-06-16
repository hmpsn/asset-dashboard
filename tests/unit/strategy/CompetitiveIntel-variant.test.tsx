import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { CompetitiveIntel } from '../../../src/components/strategy/CompetitiveIntel';

// CompetitiveIntel reads via get<IntelResponse>(...) from the api client.
const getMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../../../src/api/client')>()),
  get: getMock,
}));

const intel = {
  domains: [
    {
      domain: 'mysite.com', isOwn: true,
      overview: { domain: 'mysite.com', organicKeywords: 500, organicTraffic: 1000, organicCost: 2000, paidKeywords: 0, paidTraffic: 0, paidCost: 0 },
      backlinks: { totalBacklinks: 100, referringDomains: 50 },
      topKeywords: [],
    },
    {
      domain: 'rival.com', isOwn: false,
      overview: { domain: 'rival.com', organicKeywords: 800, organicTraffic: 3000, organicCost: 5000, paidKeywords: 0, paidTraffic: 0, paidCost: 0 },
      backlinks: { totalBacklinks: 300, referringDomains: 120 },
      topKeywords: [],
    },
  ],
  keywordGaps: [{ keyword: 'enterprise crm', volume: 1000, difficulty: 25, competitorPosition: 3, competitorDomain: 'rival.com' }],
  fetchedAt: '2026-06-16T12:00:00.000Z',
};

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('CompetitiveIntel variant gating (Phase 4 Authority & Backlinks merge)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue(intel);
  });

  it('variant="full" (legacy) renders the own-domain stat grid AND the Keyword Gaps section', async () => {
    renderWithClient(<CompetitiveIntel workspaceId="ws1" competitors={['rival.com']} seoDataAvailable />);
    expect(await screen.findByText('rival.com')).toBeInTheDocument();
    expect(screen.getByText('Your Organic Traffic')).toBeInTheDocument();
    expect(screen.getByText('Keyword Gaps')).toBeInTheDocument();
  });

  it('variant="merged" hides the own-domain stat grid AND the Keyword Gaps section, keeps the comparison', async () => {
    renderWithClient(<CompetitiveIntel workspaceId="ws1" competitors={['rival.com']} seoDataAvailable variant="merged" />);
    // competitive comparison still renders
    expect(await screen.findByText('rival.com')).toBeInTheDocument();
    // own-domain stat grid removed (duplicates backlink stats)
    expect(screen.queryByText('Your Organic Traffic')).not.toBeInTheDocument();
    // keyword gaps removed (deduped to CompetitorEvidence)
    expect(screen.queryByText('Keyword Gaps')).not.toBeInTheDocument();
  });

  it('variant="merged" labels freshness as "Updated …", never the misleading "Cached 48h"', async () => {
    renderWithClient(<CompetitiveIntel workspaceId="ws1" competitors={['rival.com']} seoDataAvailable variant="merged" />);
    await screen.findByText('rival.com');
    expect(screen.queryByText(/Cached 48h/)).not.toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });
});
