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

function renderDiff(
  defaultExpanded = false,
  presentation: 'default' | 'engine-spine' = 'default',
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (expanded: boolean) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <StrategyDiff workspaceId="ws-1" defaultExpanded={expanded} presentation={presentation} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const result = render(view(defaultExpanded));
  return {
    ...result,
    rerenderDiff: (expanded: boolean) => result.rerender(view(expanded)),
  };
}

describe('StrategyDiff', () => {
  beforeEach(() => { vi.clearAllMocks(); strategyDiffMock.mockResolvedValue(diff); });

  it('navigates an actionable nextAction badge into Page Intelligence and leaves watch passive', async () => {
    renderDiff();
    await waitFor(() => expect(screen.getByText('What Changed')).toBeInTheDocument());

    // Expand to reveal the "Why these matter" explanations.
    expect(screen.getByRole('button', { name: /What Changed/i })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByText('What Changed'));
    expect(screen.getByRole('button', { name: /What Changed/i })).toHaveAttribute('aria-expanded', 'true');
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

  it('opens its body immediately for a changes deep-link receiver', async () => {
    renderDiff(true);

    expect(await screen.findByRole('button', { name: /What Changed/i })).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Optimize page')).toBeInTheDocument();
  });

  it('uses the prototype clock icon only in the Engine-spine presentation', async () => {
    const engine = renderDiff(false, 'engine-spine');
    await waitFor(() => expect(screen.getByText('What Changed')).toBeInTheDocument());
    expect(engine.container.querySelector('.fa-clock')).toBeInTheDocument();
    expect(engine.container.querySelector('.lucide-refresh-cw')).not.toBeInTheDocument();
    engine.unmount();

    const legacy = renderDiff();
    await waitFor(() => expect(screen.getByText('What Changed')).toBeInTheDocument());
    expect(legacy.container.querySelector('.lucide-refresh-cw')).toBeInTheDocument();
    expect(legacy.container.querySelector('.fa-clock')).not.toBeInTheDocument();
  });

  it('opens when an already-mounted receiver changes to the changes lens', async () => {
    const { rerenderDiff } = renderDiff(false);

    expect(await screen.findByRole('button', { name: /What Changed/i })).toHaveAttribute('aria-expanded', 'false');
    rerenderDiff(true);

    expect(screen.getByRole('button', { name: /What Changed/i })).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Optimize page')).toBeInTheDocument();
  });

  it('renders an honest empty receiver when a changes deep link has no comparison history', async () => {
    strategyDiffMock.mockResolvedValue(null);

    renderDiff(true);

    expect(await screen.findByTestId('strategy-diff-empty')).toBeInTheDocument();
    expect(screen.getByText('No previous strategy comparison')).toBeInTheDocument();
    expect(screen.getByText(/first comparison will appear after the next strategy refresh/i)).toBeInTheDocument();
  });

  it('renders a retryable error instead of misreporting a failed comparison as empty history', async () => {
    strategyDiffMock.mockRejectedValue(new Error('comparison unavailable'));

    renderDiff(true);

    expect(await screen.findByTestId('strategy-diff-error')).toBeInTheDocument();
    expect(screen.getByText('Strategy comparison did not load')).toBeInTheDocument();
    expect(screen.queryByText('No previous strategy comparison')).not.toBeInTheDocument();

    strategyDiffMock.mockResolvedValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Retry comparison' }));
    await waitFor(() => expect(strategyDiffMock).toHaveBeenCalledTimes(2));
  });
});
