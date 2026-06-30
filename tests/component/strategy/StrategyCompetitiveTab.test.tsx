// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The composed children (ShareBar / CompetitiveIntel / BacklinkProfile) read React Query — stub it so
// they degrade to null/empty without real fetches. KeywordGaps is prop-driven and renders for real.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: undefined, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { StrategyCompetitiveTab } from '../../../src/components/strategy/StrategyCompetitiveTab';

const gaps = [
  { keyword: 'best crm software', volume: 1200, difficulty: 45, competitorPosition: 3, competitorDomain: 'rival.com' },
];

function renderTab(over: Partial<React.ComponentProps<typeof StrategyCompetitiveTab>> = {}) {
  const navigate = vi.fn();
  render(
    <MemoryRouter>
      <StrategyCompetitiveTab
        workspaceId="ws1"
        competitors={['rival.com']}
        seoDataAvailable
        keywordGaps={gaps}
        navigate={navigate as never}
        {...over}
      />
    </MemoryRouter>,
  );
  return navigate;
}

describe('StrategyCompetitiveTab', () => {
  it('shows a DataForSEO empty state when no provider is configured', () => {
    renderTab({ seoDataAvailable: false });
    expect(screen.getByText('Competitive analysis requires DataForSEO')).toBeInTheDocument();
  });

  it('shows an add-competitors empty state when the competitor set is empty', () => {
    renderTab({ competitors: [] });
    expect(screen.getByText('Add competitor domains')).toBeInTheDocument();
  });

  it('wires the KeywordGaps Create-brief CTA to navigate into seo-briefs with a fixContext', () => {
    const navigate = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Create brief' }));
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining('seo-briefs'),
      { state: { fixContext: { targetRoute: 'seo-briefs', pageName: 'best crm software' } } },
    );
  });
});
