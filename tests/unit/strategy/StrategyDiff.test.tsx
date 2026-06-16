import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { StrategyDiff } from '../../../src/components/strategy/StrategyDiff';

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

const strategyDiffMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api/seo', () => ({
  keywords: { strategyDiff: strategyDiffMock },
}));

const diff = {
  previousGeneratedAt: '2026-05-01T00:00:00Z',
  currentGeneratedAt: '2026-06-01T00:00:00Z',
  newKeywords: ['x'], lostKeywords: [], newGaps: [], resolvedGaps: [], keywordChanges: [],
  prevSiteKeywordCount: 0, currSiteKeywordCount: 1,
  explanations: [
    { keyword: 'seo tips', normalizedKeyword: 'seo tips', role: 'primary', surfaceLabel: '', sourceEvidence: [], reasons: ['because'], fitSignals: [], pagePath: '/blog/seo', nextAction: { type: 'optimize_page', label: 'Optimize page', detail: '' } },
    { keyword: 'watch me', normalizedKeyword: 'watch me', role: 'secondary', surfaceLabel: '', sourceEvidence: [], reasons: ['monitor'], fitSignals: [], nextAction: { type: 'watch', label: 'Keep watching', detail: '' } },
  ],
};

function renderDiff() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter><QueryClientProvider client={queryClient}><StrategyDiff workspaceId="ws-1" /></QueryClientProvider></MemoryRouter>,
  );
}

describe('StrategyDiff', () => {
  beforeEach(() => { vi.clearAllMocks(); strategyDiffMock.mockResolvedValue(diff); });

  it('navigates an actionable nextAction badge into Page Intelligence and leaves watch passive', async () => {
    renderDiff();
    await waitFor(() => expect(screen.getByText('What Changed')).toBeInTheDocument());

    // Expand to reveal the "Why these matter" explanations.
    fireEvent.click(screen.getByText('What Changed'));
    expect(await screen.findByText('Optimize page')).toBeInTheDocument();

    // optimize_page badge is wrapped in a clickable button → navigates with fixContext.
    fireEvent.click(screen.getByText('Optimize page'));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('page-intelligence'),
      expect.objectContaining({
        state: { fixContext: expect.objectContaining({ targetRoute: 'page-intelligence', pageSlug: '/blog/seo' }) },
      }),
    );

    // watch badge is informational — not a button, no navigation.
    expect(screen.getByText('Keep watching').closest('button')).toBeNull();
  });
});
