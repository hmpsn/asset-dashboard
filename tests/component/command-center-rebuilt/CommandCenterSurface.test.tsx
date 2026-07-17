// @ds-rebuilt
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CockpitPortfolioRollup } from '../../../shared/types/cockpit-portfolio';
import { FEATURE_FLAGS, type FeatureFlagKey } from '../../../shared/types/feature-flags';
import type { PresenceMap } from '../../../src/api/presence';

const mocks = vi.hoisted(() => ({
  featureFlagsList: vi.fn(),
  portfolio: null as CockpitPortfolioRollup | null,
  presence: {} as PresenceMap,
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      list: () => mocks.featureFlagsList(),
    },
  };
});

vi.mock('../../../src/hooks/admin/useCockpitPortfolio', () => ({
  useCockpitPortfolio: () => ({
    data: mocks.portfolio,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePortfolioPresence: () => ({
    data: mocks.presence,
    isLoading: false,
    isError: false,
  }),
}));

import { CommandCenterSurface } from '../../../src/components/command-center-rebuilt/CommandCenterSurface';
import { useRebuildShellEnabled } from '../../../src/components/layout/RebuiltAppChrome';
import { BOOK_REBUILT_SURFACE } from '../../../src/components/layout/rebuiltSurfaces';

function makePortfolio(): CockpitPortfolioRollup {
  const reason = 'Workspace money frames use different measurement windows.';
  return {
    generatedAt: '2026-07-17T12:00:00.000Z',
    workspaces: [
      {
        workspaceId: 'ws-zeta',
        workspaceName: 'Zeta Dental',
        attention: {
          rank: 1,
          needsAttention: true,
          negativeItemCount: 2,
          unclassifiedItemCount: 0,
          totalItemCount: 3,
        },
        workQueue: {
          streams: { opt: 2, send: 1, money: 0, unclassified: 0 },
          items: [
            { stream: 'opt', id: 'audit-1', title: 'Repair crawl errors', meta: '2 errors', sourceType: 'audit_error', direction: 'negative' },
            { stream: 'opt', id: 'rank-1', title: 'Review ranking loss', meta: 'Lost 4 positions', sourceType: 'rank_drop', direction: 'negative' },
            { stream: 'send', id: 'send-1', title: 'Review client draft', meta: 'Ready to send', sourceType: 'content_pipeline', direction: 'neutral' },
          ],
        },
        verdict: {
          status: 'at_risk',
          headline: 'Technical risk needs intervention.',
          narrative: 'Two negative signals are holding back the account.',
          generatedAt: '2026-07-17T12:00:00.000Z',
          evidence: [{ label: 'Errors', value: 2, tone: 'danger' }],
        },
      },
      {
        workspaceId: 'ws-alpha',
        workspaceName: 'Alpha Legal',
        attention: {
          rank: 2,
          needsAttention: false,
          negativeItemCount: 0,
          unclassifiedItemCount: 0,
          totalItemCount: 0,
        },
        workQueue: {
          streams: { opt: 0, send: 0, money: 0, unclassified: 0 },
          items: [],
        },
        verdict: {
          status: 'on_track',
          headline: 'The account is on track.',
          narrative: 'No immediate intervention is needed.',
          generatedAt: '2026-07-17T12:00:00.000Z',
          evidence: [],
        },
      },
    ],
    totals: {
      workspaces: { status: 'reconciled', value: 2 },
      attentionNeeded: { status: 'reconciled', value: 1 },
      workQueue: {
        status: 'reconciled',
        value: { itemCount: 3, streams: { opt: 2, send: 1, money: 0, unclassified: 0 } },
      },
      verdicts: { status: 'reconciled', value: { at_risk: 1, watch: 0, establishing: 0, on_track: 1 } },
      valueAtStake: { status: 'not_yet_reconcilable', value: null, reason },
      recoveredSoFar: { status: 'not_yet_reconcilable', value: null, reason },
    },
  };
}

function renderSurface() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <CommandCenterSurface />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function RootReceiver() {
  const enabled = useRebuildShellEnabled();
  if (!enabled) return <div data-testid="legacy-root">Legacy workspace overview</div>;
  return (
    <Suspense fallback={<div role="status">Opening Command Center…</div>}>
      <BOOK_REBUILT_SURFACE />
    </Suspense>
  );
}

describe('book-level Command Center rebuilt surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.portfolio = makePortfolio();
    mocks.presence = {
      'ws-zeta': [{
        userId: 'user-1',
        email: 'alex@example.com',
        name: 'Alex',
        role: 'client',
        connectedAt: '2026-07-17T11:55:00.000Z',
        lastSeen: '2026-07-17T12:00:00.000Z',
      }],
    };
  });

  it('preserves the server attention order and opens the matching workspace Cockpit', () => {
    renderSurface();

    const cards = screen.getAllByTestId('portfolio-workspace-card');
    expect(within(cards[0]).getByText('Zeta Dental')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Alpha Legal')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Alex active now')).toBeInTheDocument();

    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Open Zeta Dental Cockpit' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/ws/ws-zeta');
  });

  it('renders every reconciled count total and keeps both money totals explicitly unreconciled', () => {
    renderSurface();

    expect(screen.getByTestId('portfolio-workspace-count')).toHaveTextContent('2');
    expect(screen.getByTestId('portfolio-attention-count')).toHaveTextContent('1');
    expect(screen.getByTestId('portfolio-queue-count')).toHaveTextContent('3');
    expect(screen.getByTestId('portfolio-stream-totals')).toHaveTextContent('Optimizations2');
    expect(screen.getByTestId('portfolio-stream-totals')).toHaveTextContent('To send1');
    expect(screen.getByTestId('portfolio-verdict-totals')).toHaveTextContent('At risk1');
    expect(screen.getByTestId('portfolio-verdict-totals')).toHaveTextContent('On track1');

    const money = screen.getByTestId('portfolio-money-honesty');
    expect(within(money).getAllByText('Not yet reconcilable')).toHaveLength(2);
    expect(money).toHaveTextContent('Workspace money frames use different measurement windows.');
    expect(money).not.toHaveTextContent('$');
  });

  it('moves from the legacy root to the book surface when the real flag query resolves ON', async () => {
    let resolveFlags!: (flags: Record<FeatureFlagKey, boolean>) => void;
    mocks.featureFlagsList.mockReturnValue(new Promise<Record<FeatureFlagKey, boolean>>((resolve) => {
      resolveFlags = resolve;
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <RootReceiver />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('legacy-root')).toBeInTheDocument();

    await act(async () => {
      resolveFlags({ ...FEATURE_FLAGS, 'ui-rebuild-shell': true });
      await Promise.resolve();
    });

    expect(await screen.findByTestId('command-center-rebuilt-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-root')).not.toBeInTheDocument();
  });
});
