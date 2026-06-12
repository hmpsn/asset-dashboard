/**
 * KeywordDetailDrawerLinks.test.tsx — Phase P4-T3.
 *
 * Wires the drawer's P2 "View in Strategy" back-link to navigate to
 * /seo-strategy, and retires the old "Rank Tracker" jump to /seo-ranks
 * (rank now lives in the in-drawer national-rank section).
 */
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { KeywordDetailDrawer } from '../../src/components/keyword-command-center/KeywordDetailDrawer';
import type {
  KeywordCommandCenterRow,
  KeywordCommandCenterStatus,
} from '../../shared/types/keyword-command-center';

const { navigateMock, featureFlagMock, getMock, togglePinMutate } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  featureFlagMock: vi.fn(),
  getMock: vi.fn().mockResolvedValue([]),
  togglePinMutate: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...args),
}));

let togglePinPending = false;
vi.mock('../../src/hooks/admin/useKeywordCommandCenter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/admin/useKeywordCommandCenter')>();
  return {
    ...actual,
    useRankTrackingTogglePin: () => ({ mutate: togglePinMutate, isPending: togglePinPending }),
  };
});

vi.mock('../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client')>();
  return { ...actual, get: (...args: unknown[]) => getMock(...args) };
});

function makeRow(overrides: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
  return {
    keyword: 'cosmetic dentistry',
    normalizedKeyword: 'cosmetic dentistry',
    lifecycleStatus: 'tracked' as KeywordCommandCenterStatus,
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: { volume: 1200, currentPosition: 6.3, ctr: 0.04, clicks: 88, impressions: 2200 },
    tracking: { status: 'active', source: 'manual' },
    nextActions: [],
    isProtected: false,
    ...overrides,
  };
}

function renderDrawer(
  row: KeywordCommandCenterRow | null,
  flagOn = true,
  extraProps: Partial<ComponentProps<typeof KeywordDetailDrawer>> = {},
) {
  featureFlagMock.mockReturnValue(flagOn);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <KeywordDetailDrawer open row={row} workspaceId="ws-1" onAction={vi.fn()} onClose={vi.fn()} {...extraProps} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KeywordDetailDrawer — P4 link wiring', () => {
  beforeEach(() => { vi.clearAllMocks(); navigateMock.mockReset(); featureFlagMock.mockReset(); togglePinMutate.mockReset(); togglePinPending = false; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('View in Strategy navigates to a /seo-strategy path', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'content_gap', sourceGapKey: 'gap:dental-implants' } }));
    const link = screen.getByTestId('view-in-strategy-link');
    fireEvent.click(link);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const target = navigateMock.mock.calls[0][0] as string;
    expect(target.endsWith('/seo-strategy')).toBe(true);
  });

  it('no longer renders a control that navigates to /seo-ranks', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual' } }));
    // The old "Rank Tracker" jump button is gone (rank lives in the in-drawer
    // national-rank section now).
    expect(screen.queryByRole('button', { name: /rank tracker/i })).toBeNull();
    // Clicking any present control must never navigate to seo-ranks.
    for (const btn of screen.queryAllByRole('button')) {
      fireEvent.click(btn);
    }
    for (const call of navigateMock.mock.calls) {
      const arg = call[0];
      if (typeof arg === 'string') expect(arg).not.toContain('seo-ranks');
    }
  });
});

describe('KeywordDetailDrawer — pin toggle (O2)', () => {
  beforeEach(() => { vi.clearAllMocks(); navigateMock.mockReset(); featureFlagMock.mockReset(); togglePinMutate.mockReset(); togglePinPending = false; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('fires the pin mutation with the keyword when toggling a tracked, unpinned keyword', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual', pinned: false } }));
    const toggle = screen.getByTestId('keyword-pin-toggle');
    expect(toggle).toHaveTextContent(/pin/i);
    fireEvent.click(toggle);
    expect(togglePinMutate).toHaveBeenCalledWith('cosmetic dentistry');
  });

  it('reflects the pinned state and fires unpin when already pinned', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual', pinned: true } }));
    const toggle = screen.getByTestId('keyword-pin-toggle');
    expect(toggle).toHaveTextContent(/pinned/i);
    fireEvent.click(toggle);
    expect(togglePinMutate).toHaveBeenCalledWith('cosmetic dentistry');
  });

  it('shows pending state on the pin toggle', () => {
    togglePinPending = true;
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual', pinned: false } }));
    expect(screen.getByTestId('keyword-pin-toggle')).toBeDisabled();
  });

  it('does not render the toggle for untracked keywords', () => {
    renderDrawer(makeRow({ tracking: { status: 'not_tracked', source: 'manual' } }));
    expect(screen.queryByTestId('keyword-pin-toggle')).toBeNull();
  });
});

describe('KeywordDetailDrawer — replaced-by wiring', () => {
  beforeEach(() => { vi.clearAllMocks(); navigateMock.mockReset(); featureFlagMock.mockReset(); togglePinMutate.mockReset(); togglePinPending = false; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('selects the replacement keyword in-place via onSelectKeyword when provided', () => {
    const onSelectKeyword = vi.fn();
    renderDrawer(
      makeRow({
        lifecycleStatus: 'retired' as KeywordCommandCenterStatus,
        tracking: { status: 'deprecated', source: 'manual', replacedBy: 'teeth whitening', deprecatedAt: '2026-05-01T00:00:00.000Z' },
      }),
      true,
      { onSelectKeyword },
    );
    const link = screen.getByTestId('view-replaced-by-link');
    fireEvent.click(link);
    expect(onSelectKeyword).toHaveBeenCalledWith('teeth whitening');
    // In-place selection must NOT navigate.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('navigates to the Hub deep-link when no onSelectKeyword callback is given', () => {
    renderDrawer(
      makeRow({
        lifecycleStatus: 'retired' as KeywordCommandCenterStatus,
        tracking: { status: 'deprecated', source: 'manual', replacedBy: 'teeth whitening', deprecatedAt: '2026-05-01T00:00:00.000Z' },
      }),
    );
    const link = screen.getByTestId('view-replaced-by-link');
    fireEvent.click(link);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const target = navigateMock.mock.calls[0][0] as string;
    expect(target).toContain('q=teeth');
  });
});

describe('KeywordDetailDrawer — national-rank history chart', () => {
  beforeEach(() => { vi.clearAllMocks(); navigateMock.mockReset(); featureFlagMock.mockReset(); togglePinMutate.mockReset(); togglePinPending = false; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders the multi-snapshot RankHistoryChart from the fetched rankHistory', async () => {
    getMock.mockResolvedValueOnce([
      { date: '2026-04-01', positions: { 'cosmetic dentistry': 12 } },
      { date: '2026-05-01', positions: { 'cosmetic dentistry': 8 } },
      { date: '2026-06-01', positions: { 'cosmetic dentistry': 5 } },
    ]);
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual', pinned: false } }));
    await waitFor(() => {
      expect(screen.getByTestId('rank-history-chart')).toBeInTheDocument();
    });
    // Position-axis labels from the RankHistoryChart primitive.
    expect(screen.getByText(/Position 1 \(top\)/i)).toBeInTheDocument();
  });
});
