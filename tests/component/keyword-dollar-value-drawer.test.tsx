/**
 * keyword-dollar-value-drawer.test.tsx — Task 3.3
 *
 * Asserts the per-keyword realized $/mo + upside ("Revenue potential") render in
 * both StrategyKeywordDrawer and KeywordDetailDrawer when present, are EMERALD
 * (success/$ law — not blue/teal), and are absent when no $ exists (no cpc).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { StrategyKeywordDrawer } from '../../src/components/client/strategy/StrategyKeywordDrawer';
import { KeywordDetailDrawer } from '../../src/components/keyword-command-center/KeywordDetailDrawer';
import type { StrategyKeywordTableRow } from '../../src/components/client/strategy/strategyKeywordDisplay';
import type { KeywordCommandCenterRow, KeywordCommandCenterStatus } from '../../shared/types/keyword-command-center';

const { featureFlagMock, navigateMock, getMock } = vi.hoisted(() => ({
  featureFlagMock: vi.fn().mockReturnValue(false),
  navigateMock: vi.fn(),
  getMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...args),
}));

vi.mock('../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client')>();
  return { ...actual, get: (...args: unknown[]) => getMock(...args) };
});

// ── StrategyKeywordDrawer helpers ─────────────────────────────────────────────

function makeStrategyRow(money?: { currentMonthly?: number; upsideMonthly?: number }): StrategyKeywordTableRow {
  return {
    label: 'Cosmetic Dentistry',
    normalized: 'cosmetic dentistry',
    role: 'page',
    roleLabel: 'Page Opportunity',
    roleDetail: '',
    opportunityLabel: 'Strong',
    opportunityDetail: '',
    opportunityTone: 'blue',
    opportunityScore: 72,
    nextMoveLabel: 'Optimize page',
    nextMoveDetail: 'This page needs content refreshed.',
    volume: 900,
    difficulty: 38,
    currentPosition: 6,
    impressions: 1500,
    clicks: 60,
    cpc: 9,
    searchIntent: 'commercial',
    contextSources: ['Generated strategy'],
    enrichmentStatus: 'enriched',
    isTracked: true,
    isStrategy: true,
    isRequested: false,
    status: 'strategy',
    currentMonthly: money?.currentMonthly,
    upsideMonthly: money?.upsideMonthly,
  };
}

function renderStrategyDrawer(row: StrategyKeywordTableRow, effectiveTier: 'free' | 'growth' | 'premium' = 'growth') {
  const drawerRef = { current: null };
  return render(
    <StrategyKeywordDrawer
      drawerRow={row}
      drawerClosing={false}
      drawerRef={drawerRef as React.RefObject<HTMLDivElement | null>}
      effectiveTier={effectiveTier}
      drawerEvidenceOpen={true}
      setDrawerEvidenceOpen={vi.fn()}
      removingKeyword={null}
      addingKeyword={false}
      closeDrawer={vi.fn()}
      removePriorityKeyword={vi.fn()}
      addStrategyKeyword={vi.fn()}
      submitFeedback={vi.fn()}
      isLoadingFeedback={vi.fn().mockReturnValue(false)}
    />,
  );
}

// ── KeywordDetailDrawer helpers ───────────────────────────────────────────────

function makeKccRow(money?: { currentMonthly?: number; upsideMonthly?: number }): KeywordCommandCenterRow {
  return {
    keyword: 'cosmetic dentistry',
    normalizedKeyword: 'cosmetic dentistry',
    lifecycleStatus: 'tracked' as KeywordCommandCenterStatus,
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: { volume: 900, currentPosition: 6.3, ctr: 0.04, clicks: 60, impressions: 1500, cpc: 9 },
    tracking: { status: 'active', source: 'manual' },
    nextActions: [],
    isProtected: false,
    currentMonthly: money?.currentMonthly,
    upsideMonthly: money?.upsideMonthly,
  };
}

function renderDetailDrawer(row: KeywordCommandCenterRow | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <KeywordDetailDrawer
          open
          row={row}
          workspaceId="ws-1"
          onAction={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagMock.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StrategyKeywordDrawer — per-keyword $ (Task 3.3)', () => {
  it('renders the current $/mo and the upside when present', () => {
    renderStrategyDrawer(makeStrategyRow({ currentMonthly: 540, upsideMonthly: 120 }));
    const section = screen.getByTestId('revenue-potential-section');
    expect(section).toBeInTheDocument();
    // current $540 + upside $120 both render
    expect(section.textContent).toMatch(/540/);
    expect(section.textContent).toMatch(/120/);
  });

  it('renders the $ in emerald (success/$ law) — not blue or teal', () => {
    renderStrategyDrawer(makeStrategyRow({ currentMonthly: 540, upsideMonthly: 120 }));
    const section = screen.getByTestId('revenue-potential-section');
    expect(section.className).toMatch(/emerald/);
    expect(section.querySelector('[class*="emerald"]')).not.toBeNull();
    // Must NOT be styled blue (data) or teal (action).
    expect(section.querySelector('[class*="text-blue"]')).toBeNull();
    expect(section.querySelector('[class*="text-teal"]')).toBeNull();
  });

  it('omits the Revenue potential section when there is no cpc / no $', () => {
    renderStrategyDrawer(makeStrategyRow(undefined));
    expect(screen.queryByTestId('revenue-potential-section')).toBeNull();
  });

  it('hides the Revenue potential block below Growth even when $ is present (explicit tier gate)', () => {
    // $ data can be on the wire to all tiers; the drawer must gate the block itself
    // (defense in depth), matching ROIDashboard's Growth+ gate.
    renderStrategyDrawer(makeStrategyRow({ currentMonthly: 540, upsideMonthly: 120 }), 'free');
    expect(screen.queryByTestId('revenue-potential-section')).toBeNull();
  });

  it('shows the Revenue potential block on premium (Growth+)', () => {
    renderStrategyDrawer(makeStrategyRow({ currentMonthly: 540, upsideMonthly: 120 }), 'premium');
    expect(screen.getByTestId('revenue-potential-section')).toBeInTheDocument();
  });
});

describe('KeywordDetailDrawer — per-keyword $ (Task 3.3)', () => {
  it('renders the current $/mo and the upside when present', () => {
    renderDetailDrawer(makeKccRow({ currentMonthly: 540, upsideMonthly: 120 }));
    const section = screen.getByTestId('revenue-potential-section');
    expect(section).toBeInTheDocument();
    expect(section.textContent).toMatch(/540/);
    expect(section.textContent).toMatch(/120/);
  });

  it('renders the $ in emerald (success/$ law) — not blue or teal', () => {
    renderDetailDrawer(makeKccRow({ currentMonthly: 540, upsideMonthly: 120 }));
    const section = screen.getByTestId('revenue-potential-section');
    expect(section.querySelector('[class*="emerald"]')).not.toBeNull();
    expect(section.querySelector('[class*="text-blue"]')).toBeNull();
    expect(section.querySelector('[class*="text-teal"]')).toBeNull();
  });

  it('omits the Revenue potential section when there is no $', () => {
    renderDetailDrawer(makeKccRow(undefined));
    expect(screen.queryByTestId('revenue-potential-section')).toBeNull();
  });
});
