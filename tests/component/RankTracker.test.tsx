/**
 * Component tests for RankTracker.tsx
 * Wave 14 coverage (expanded).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { TrackedKeyword, LatestRank } from '../../shared/types/rank-tracking';

// ── Mock API client before importing the component ───────────────────────────
vi.mock('../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue([]),
  getSafe: vi.fn().mockResolvedValue([]),
  post: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: vi.fn(),
}));

import { RankTracker } from '../../src/components/RankTracker';

function renderRankTracker(node: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {node}
    </QueryClientProvider>,
  );
}

// ── Fixture helpers ───────────────────────────────────────────────────────────
function makeKeyword(overrides: Partial<TrackedKeyword> = {}): TrackedKeyword {
  return { query: 'seo tips', pinned: false, addedAt: '2024-01-01T00:00:00Z', source: 'manual', ...overrides };
}
function makeRank(overrides: Partial<LatestRank> = {}): LatestRank {
  return { query: 'seo tips', position: 5.0, clicks: 120, impressions: 2000, ctr: 0.06, change: -2, pinned: false, ...overrides };
}

// Reset mocks and set up sensible defaults for each test
async function setupMocks(keywords: TrackedKeyword[] = [], ranks: LatestRank[] = []) {
  const { get, getSafe, post, patch, del } = await import('../../src/api/client');
  vi.mocked(get).mockImplementation((url: string) => {
    if (url.includes('/keywords')) return Promise.resolve(keywords) as ReturnType<typeof get>;
    if (url.includes('/latest')) return Promise.resolve(ranks) as ReturnType<typeof get>;
    if (url.includes('/history')) return Promise.resolve([]) as ReturnType<typeof get>;
    return Promise.resolve([]) as ReturnType<typeof get>;
  });
  vi.mocked(getSafe).mockImplementation((url: string, fallback: unknown) => {
    if (url.includes('/latest')) return Promise.resolve(ranks) as ReturnType<typeof getSafe>;
    return Promise.resolve((fallback ?? []) as unknown) as ReturnType<typeof getSafe>;
  });
  vi.mocked(post).mockResolvedValue({} as Awaited<ReturnType<typeof post>>);
  vi.mocked(patch).mockResolvedValue({} as Awaited<ReturnType<typeof patch>>);
  vi.mocked(del).mockResolvedValue({} as Awaited<ReturnType<typeof del>>);
}

// ══════════════════════════════════════════════════════════════════════════════
// GSC Capture Snapshot button
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — GSC Capture Snapshot button', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupMocks();
  });

  it('shows Capture Snapshot button disabled with title when GSC is not connected', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={false} />);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /capture snapshot/i });
      expect(btn).toBeInTheDocument();
      expect(btn).toBeDisabled();
    });

    const btn = screen.getByRole('button', { name: /capture snapshot/i });
    expect(btn.getAttribute('title')).toMatch(/connect.*google search console/i);
  });

  it('shows Capture Snapshot button enabled when GSC is connected and keywords exist', async () => {
    await setupMocks([makeKeyword()], [makeRank()]);

    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /capture snapshot/i });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });
  });

  it('shows Capture Snapshot button disabled when GSC connected but no keywords', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /capture snapshot/i });
      expect(btn).toBeInTheDocument();
      expect(btn).toBeDisabled();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Loading state
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — loading state', () => {
  it('shows a loading spinner while data is being fetched', async () => {
    vi.clearAllMocks();
    const { get } = await import('../../src/api/client');
    // Never resolves → component stays in loading state
    vi.mocked(get).mockReturnValue(new Promise(() => {}) as ReturnType<typeof get>);

    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Empty states
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — empty states', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupMocks([], []);
  });

  it('shows "No keywords tracked yet" empty state when no keywords exist', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('No keywords tracked yet')).toBeInTheDocument();
    });
  });

  it('shows add keyword guidance text in empty state', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText(/add keywords above/i)).toBeInTheDocument();
    });
  });

  it('shows "Keywords added but no rank data yet" when keywords exist but no ranks', async () => {
    await setupMocks([makeKeyword({ query: 'local seo' })], []);
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('Keywords added but no rank data yet')).toBeInTheDocument();
    });
  });

  it('shows a "Take First Snapshot" button when keywords exist but no rank data', async () => {
    await setupMocks([makeKeyword({ query: 'local seo' })], []);
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /take first snapshot/i })).toBeInTheDocument();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Rankings table
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — keyword rankings table', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupMocks([makeKeyword()], [makeRank()]);
  });

  it('renders the rankings table with column headers', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('Keyword')).toBeInTheDocument();
      expect(screen.getByText('Position')).toBeInTheDocument();
      expect(screen.getByText('Change')).toBeInTheDocument();
      expect(screen.getByText('Clicks')).toBeInTheDocument();
      expect(screen.getByText('Impressions')).toBeInTheDocument();
    });
  });

  it('renders keyword query in the table row', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('seo tips')).toBeInTheDocument();
    });
  });

  it('renders position value in the table row', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('renders clicks and impressions in the table row', async () => {
    await setupMocks([makeKeyword()], [makeRank({ clicks: 150, impressions: 3000 })]);
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument();
      expect(screen.getByText('3,000')).toBeInTheDocument();
    });
  });

  it('renders positive change magnitude (rank fell) in the table', async () => {
    await setupMocks([makeKeyword()], [makeRank({ change: 4 })]);
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });

  it('renders improvement change magnitude (rank rose) in the table', async () => {
    await setupMocks([makeKeyword()], [makeRank({ change: -3 })]);
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('renders "—" when change is zero', async () => {
    await setupMocks([makeKeyword()], [makeRank({ change: 0 })]);
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
  });

  it('renders "Strategy" badge for strategy-sourced keywords', async () => {
    await setupMocks(
      [makeKeyword({ query: 'content marketing', source: 'strategy_primary' })],
      [makeRank({ query: 'content marketing', source: 'strategy_primary' })],
    );
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('Strategy')).toBeInTheDocument();
    });
  });

  it('renders "Client" badge for client-requested keywords', async () => {
    await setupMocks(
      [makeKeyword({ query: 'local seo', source: 'client_requested' })],
      [makeRank({ query: 'local seo', source: 'client_requested' })],
    );
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('Client')).toBeInTheDocument();
    });
  });

  it('renders page title below keyword query when pagePath is present', async () => {
    await setupMocks(
      [makeKeyword({ query: 'test kw' })],
      [makeRank({ query: 'test kw', pagePath: '/services', pageTitle: 'Services Page' })],
    );
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('Services Page')).toBeInTheDocument();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Add keyword
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — add keyword', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupMocks([], []);
  });

  it('renders the add keyword input field', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/add keyword to track/i)).toBeInTheDocument();
    });
  });

  it('renders the Add button', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^add$/i })).toBeInTheDocument();
    });
  });

  it('Add button is disabled when the input is empty', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled();
    });
  });

  it('calls POST endpoint when Add button is clicked with a keyword', async () => {
    const { post } = await import('../../src/api/client');
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    const input = await screen.findByPlaceholderText(/add keyword to track/i);
    fireEvent.change(input, { target: { value: 'new keyword' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => {
      expect(vi.mocked(post)).toHaveBeenCalledWith(
        expect.stringContaining('/keywords'),
        { query: 'new keyword' },
      );
    });
  });

  it('calls POST endpoint when Enter is pressed in the input', async () => {
    const { post } = await import('../../src/api/client');
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    const input = await screen.findByPlaceholderText(/add keyword to track/i);
    fireEvent.change(input, { target: { value: 'enter keyword' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(vi.mocked(post)).toHaveBeenCalledWith(
        expect.stringContaining('/keywords'),
        { query: 'enter keyword' },
      );
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Remove keyword
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — remove keyword', () => {
  it('calls DELETE endpoint when remove keyword button is clicked', async () => {
    vi.clearAllMocks();
    await setupMocks([makeKeyword({ query: 'to remove' })], [makeRank({ query: 'to remove' })]);
    const { del } = await import('../../src/api/client');

    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);

    await waitFor(() => screen.getByText('to remove'));

    const removeBtn = screen.getByRole('button', { name: /remove keyword/i });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(vi.mocked(del)).toHaveBeenCalledWith(expect.stringContaining('to%20remove'));
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GSC warning banner
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — GSC warning banner', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupMocks([], []);
  });

  it('shows GSC connect warning when hasGsc is false', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={false} />);
    await waitFor(() => {
      expect(screen.getByText(/connect google search console in workspace settings/i)).toBeInTheDocument();
    });
  });

  it('does not show the GSC warning banner when hasGsc is true', async () => {
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => screen.getByText('No keywords tracked yet'));
    expect(screen.queryByText(/connect google search console in workspace settings to enable rank tracking/i)).not.toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Error state
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — error state', () => {
  it('shows error message when initial load fails', async () => {
    vi.clearAllMocks();
    const { get, getSafe } = await import('../../src/api/client');
    vi.mocked(get).mockRejectedValue(new Error('Network error'));
    vi.mocked(getSafe).mockRejectedValue(new Error('Network error'));

    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows error message when adding a keyword fails', async () => {
    vi.clearAllMocks();
    await setupMocks([], []);
    const { post } = await import('../../src/api/client');
    vi.mocked(post).mockRejectedValue(new Error('Add failed'));

    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    const input = await screen.findByPlaceholderText(/add keyword to track/i);
    fireEvent.change(input, { target: { value: 'bad keyword' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to add keyword')).toBeInTheDocument();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// "Tracked but no rank data" section
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — "tracked but no rank data" section', () => {
  it('shows "Tracked but no rank data" section when some keywords have ranks and others do not', async () => {
    vi.clearAllMocks();
    await setupMocks(
      [makeKeyword({ query: 'ranked kw' }), makeKeyword({ query: 'unranked kw' })],
      [makeRank({ query: 'ranked kw' })],
    );

    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);

    await waitFor(() => {
      expect(screen.getByText('Tracked but no rank data:')).toBeInTheDocument();
      expect(screen.getByText('unranked kw')).toBeInTheDocument();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Position color — Four-Laws fix: teal→emerald (Wave 2b B1)
// The ≤10 band was previously teal-400; it is now routed through positionColor()
// which returns text-accent-success (emerald). Teal is reserved for actions.
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — position color uses positionColor() authority', () => {
  it('applies text-accent-success (emerald) for position ≤10, NOT teal-400', async () => {
    vi.clearAllMocks();
    await setupMocks([makeKeyword()], [makeRank({ position: 7 })]);

    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);

    await waitFor(() => screen.getByText('7'));

    const positionSpan = screen.getByText('7').closest('span') ?? screen.getByText('7');
    expect(positionSpan.className).toContain('text-accent-success');
    expect(positionSpan.className).not.toContain('text-teal-400');
  });

  it('applies text-accent-warning (amber) for position 11–20', async () => {
    vi.clearAllMocks();
    await setupMocks([makeKeyword()], [makeRank({ position: 15 })]);

    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);

    await waitFor(() => screen.getByText('15'));

    const positionSpan = screen.getByText('15').closest('span') ?? screen.getByText('15');
    expect(positionSpan.className).toContain('text-accent-warning');
  });

  it('applies text-accent-danger (red) for position >20', async () => {
    vi.clearAllMocks();
    await setupMocks([makeKeyword()], [makeRank({ position: 35 })]);

    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);

    await waitFor(() => screen.getByText('35'));

    const positionSpan = screen.getByText('35').closest('span') ?? screen.getByText('35');
    expect(positionSpan.className).toContain('text-accent-danger');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PageHeader renders
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTracker — PageHeader', () => {
  it('renders the "Rank Tracker" title', async () => {
    vi.clearAllMocks();
    await setupMocks([], []);
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText('Rank Tracker')).toBeInTheDocument();
    });
  });

  it('renders keyword count subtitle', async () => {
    vi.clearAllMocks();
    await setupMocks([makeKeyword(), makeKeyword({ query: 'other kw' })], []);
    renderRankTracker(<RankTracker workspaceId="ws-1" hasGsc={true} />);
    await waitFor(() => {
      expect(screen.getByText(/2 keywords tracked/i)).toBeInTheDocument();
    });
  });
});
