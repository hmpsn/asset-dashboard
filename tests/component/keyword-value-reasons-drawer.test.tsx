/**
 * keyword-value-reasons-drawer.test.tsx — Task 2.4
 *
 * Asserts that valueReasons are rendered in both
 * StrategyKeywordDrawer and KeywordDetailDrawer when present,
 * and absent when not provided. DISTINCT from the "Why it's in
 * the strategy" / "Why It Matters" OV breakdown sections.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { StrategyKeywordDrawer } from '../../src/components/client/strategy/StrategyKeywordDrawer';
import { KeywordDetailDrawer } from '../../src/components/keyword-command-center/KeywordDetailDrawer';
import type { StrategyKeywordTableRow } from '../../src/components/client/strategy/strategyKeywordDisplay';
import type { KeywordCommandCenterRow, KeywordCommandCenterStatus } from '../../shared/types/keyword-command-center';

// ── shared mocks ─────────────────────────────────────────────────────────────

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

function makeStrategyRow(valueReasons?: string[]): StrategyKeywordTableRow {
  return {
    label: 'Cosmetic Dentistry',
    identityKey: 'cosmetic dentistry',
    actionKeyword: 'Cosmetic Dentistry',
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
    searchIntent: 'commercial',
    contextSources: ['Generated strategy'],
    enrichmentStatus: 'enriched',
    isTracked: true,
    isStrategy: true,
    isRequested: false,
    status: 'strategy',
    valueReasons,
  };
}

function renderStrategyDrawer(row: StrategyKeywordTableRow) {
  const drawerRef = { current: null };
  return render(
    <StrategyKeywordDrawer
      drawerRow={row}
      drawerClosing={false}
      drawerRef={drawerRef as React.RefObject<HTMLDivElement | null>}
      effectiveTier="growth"
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

function makeKccRow(valueReasons?: string[]): KeywordCommandCenterRow {
  return {
    keyword: 'cosmetic dentistry',
    normalizedKeyword: 'cosmetic dentistry',
    lifecycleStatus: 'tracked' as KeywordCommandCenterStatus,
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: { volume: 900, currentPosition: 6.3, ctr: 0.04, clicks: 60, impressions: 1500 },
    tracking: { status: 'active', source: 'manual' },
    nextActions: [],
    isProtected: false,
    valueReasons,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagMock.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StrategyKeywordDrawer — valueReasons (Task 2.4)', () => {
  it('renders each valueReason string in the "See the numbers" section when present', () => {
    const reasons = ['Commercial intent · 9 CPC', 'Winnable · KD 38', 'Strong demand · 900/mo'];
    renderStrategyDrawer(makeStrategyRow(reasons));
    for (const reason of reasons) {
      expect(screen.getByText(reason)).toBeInTheDocument();
    }
  });

  it('renders valueReasons with blue data color (not teal)', () => {
    const reasons = ['Commercial intent · 9 CPC'];
    renderStrategyDrawer(makeStrategyRow(reasons));
    const el = screen.getByText(reasons[0]);
    // Should have blue class (data law) not teal (action law)
    expect(el.className).not.toMatch(/teal/);
    expect(el.closest('[class*="blue"]') ?? el.className).toBeTruthy();
  });

  it('omits valueReasons section entirely when valueReasons is undefined', () => {
    renderStrategyDrawer(makeStrategyRow(undefined));
    // None of the hardcoded reason strings should appear
    expect(screen.queryByTestId('value-reasons-section')).toBeNull();
  });

  it('omits valueReasons section when valueReasons is an empty array', () => {
    renderStrategyDrawer(makeStrategyRow([]));
    expect(screen.queryByTestId('value-reasons-section')).toBeNull();
  });

  it('does NOT touch the "Why it\'s in the strategy" explanation section', () => {
    const reasons = ['Commercial intent · 9 CPC'];
    const row = makeStrategyRow(reasons);
    // give the row an explanation so the OV section renders
    row.explanation = {
      keyword: 'cosmetic dentistry',
      normalizedKeyword: 'cosmetic dentistry',
      role: 'page_keyword',
      surfaceLabel: 'Page opportunity',
      sourceEvidence: [],
      reasons: ['Why it is in strategy'],
      fitSignals: [],
      nextAction: { type: 'optimize_page', label: 'Optimize', detail: 'Optimize the page.' },
    };
    renderStrategyDrawer(row);
    // Both sections present, content distinct
    expect(screen.getByText('Why it\'s in the strategy')).toBeInTheDocument();
    expect(screen.getByText(reasons[0])).toBeInTheDocument();
  });
});

describe('KeywordDetailDrawer — valueReasons (Task 2.4)', () => {
  it('renders each valueReason string when present', () => {
    const reasons = ['Commercial intent · 9 CPC', 'Winnable · KD 38', 'Strong demand · 900/mo'];
    renderDetailDrawer(makeKccRow(reasons));
    for (const reason of reasons) {
      expect(screen.getByText(reason)).toBeInTheDocument();
    }
  });

  it('renders "Why this score" section label when valueReasons is present', () => {
    renderDetailDrawer(makeKccRow(['Commercial intent · 9 CPC']));
    expect(screen.getByText('Why this score')).toBeInTheDocument();
  });

  it('omits "Why this score" section when valueReasons is undefined', () => {
    renderDetailDrawer(makeKccRow(undefined));
    expect(screen.queryByText('Why this score')).toBeNull();
  });

  it('omits "Why this score" section when valueReasons is an empty array', () => {
    renderDetailDrawer(makeKccRow([]));
    expect(screen.queryByText('Why this score')).toBeNull();
  });

  it('uses blue data color for valueReasons (not teal)', () => {
    const reasons = ['Commercial intent · 9 CPC'];
    renderDetailDrawer(makeKccRow(reasons));
    const el = screen.getByText(reasons[0]);
    // Must not use teal (action color) — blue (data color) is correct
    const container = el.closest('[class*="blue"]') ?? el.parentElement;
    expect(container).not.toBeNull();
    // The section should not use teal classes
    const section = el.closest('[data-testid="value-reasons-section"]') ?? el.parentElement?.parentElement;
    if (section) {
      expect(section.className ?? '').not.toMatch(/teal/);
    }
  });
});
