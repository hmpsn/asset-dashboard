import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OpportunitiesList } from '../../../src/components/strategy/OpportunitiesList';
import type { PageKeywordMap } from '../../../src/components/strategy/types';

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

const lhf = (over: Partial<PageKeywordMap> = {}): PageKeywordMap => ({
  pagePath: '/blog/seo', pageTitle: 'SEO Guide', primaryKeyword: 'seo tips', secondaryKeywords: [], currentPosition: 8, impressions: 1200, ...over,
});

describe('OpportunitiesList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders null when there are no opportunities', () => {
    const { container } = render(
      <MemoryRouter><OpportunitiesList quickWins={[]} lowHangingFruit={[]} workspaceId="ws1" /></MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders quick wins + low-hanging fruit and routes the Fix CTA into Page Intelligence', () => {
    render(
      <MemoryRouter>
        <OpportunitiesList
          quickWins={[{ pagePath: '/pricing', action: 'Add FAQ schema', estimatedImpact: 'high', rationale: 'why', roiScore: 80 }]}
          lowHangingFruit={[lhf()]}
          workspaceId="ws1"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Opportunities')).toBeInTheDocument();
    expect(screen.getByText('Add FAQ schema')).toBeInTheDocument();
    expect(screen.getByText('SEO Guide')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /optimize page/i })[0]);
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('page-intelligence'),
      expect.objectContaining({
        state: { fixContext: expect.objectContaining({ targetRoute: 'page-intelligence', pageSlug: '/pricing' }) },
      }),
    );
  });
});
