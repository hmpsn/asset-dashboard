import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ROIDashboard } from '../../../src/components/client/ROIDashboard';
import { useClientROI } from '../../../src/hooks/client';
import type { ROIData } from '../../../shared/types/roi';

vi.mock('../../../src/hooks/client', () => ({
  useClientROI: vi.fn(),
}));

vi.mock('../../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

const mockedUseClientROI = vi.mocked(useClientROI);

function makeROIData(overrides: Partial<ROIData> = {}): ROIData {
  return {
    organicTrafficValue: 1234,
    adSpendEquivalent: 1481,
    growthPercent: 8.4,
    revenueAtStake: 2200,
    pageBreakdown: [
      {
        pagePath: '/services',
        pageTitle: 'Services',
        primaryKeyword: 'seo services',
        clicks: 120,
        impressions: 2400,
        cpc: 4.25,
        trafficValue: 510,
        position: 7.2,
      },
    ],
    totalClicks: 120,
    totalImpressions: 2400,
    avgCPC: 4.25,
    trackedPages: 1,
    contentROI: {
      totalContentSpend: 300,
      totalContentValue: 1200,
      roi: 300,
      postsPublished: 2,
    },
    contentItems: [],
    computedAt: '2026-06-11T12:00:00.000Z',
    ...overrides,
  };
}

function mockROI(data: ROIData | null = makeROIData()) {
  mockedUseClientROI.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  } as unknown as ReturnType<typeof useClientROI>);
}

function renderDashboard(
  tier: 'free' | 'growth' | 'premium' = 'growth',
  props: { compact?: boolean; evergreen?: boolean } = {},
) {
  return render(
    <MemoryRouter>
      <ROIDashboard workspaceId="ws-roi" tier={tier} {...props} />
    </MemoryRouter>,
  );
}

const outcomeVerdict: NonNullable<ROIData['outcomeVerdict']> = {
  outcomeCount: 14,
  outcomeUnitLabel: 'new patients',
  valuePerOutcome: 800,
  estimatedValue: 11_234,
  monthlyRetainer: 1_500,
  baseline: {
    engagementStart: '2026-01-01T00:00:00.000Z',
    baselineConversions: 6,
    baselineCapturedAt: '2026-01-01T00:00:00.000Z',
    state: 'ready',
  },
  baselineDeltaCount: 8,
  provenance: 'estimate_ga4',
};

describe('ROIDashboard methodology explainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockROI();
  });

  it('renders an expandable methodology explainer for paid tiers', () => {
    renderDashboard('growth');

    const disclosure = screen.getByTestId('roi-methodology');
    expect(disclosure).not.toHaveAttribute('open');

    fireEvent.click(screen.getByText('How we calculate this'));

    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByText('Organic traffic value')).toBeInTheDocument();
    expect(screen.getByText(/Search Console clicks multiplied by keyword cost-per-click estimates/i)).toBeInTheDocument();
    expect(screen.getByText(/not a promise of booked revenue/i)).toBeInTheDocument();
  });

  it('explains revenue at stake when the payload includes that metric', () => {
    renderDashboard('premium');
    fireEvent.click(screen.getByText('How we calculate this'));

    expect(screen.getByText('Revenue at stake')).toBeInTheDocument();
    expect(screen.getByText(/moving toward stronger positions/i)).toBeInTheDocument();
    expect(screen.getByText(/conservative click-through lift/i)).toBeInTheDocument();
  });

  it('falls back to content attribution copy when revenue at stake is absent', () => {
    mockROI(makeROIData({ revenueAtStake: undefined }));
    renderDashboard('growth');
    fireEvent.click(screen.getByText('How we calculate this'));

    expect(screen.getByText('Content attribution')).toBeInTheDocument();
    expect(screen.getByText(/Published content is credited only when traffic/i)).toBeInTheDocument();
    expect(screen.queryByText('Revenue at Stake')).not.toBeInTheDocument();
  });

  it('keeps the paid methodology explainer out of the free-tier gate', () => {
    renderDashboard('free');

    expect(screen.getAllByText('ROI Dashboard').length).toBeGreaterThan(0);
    expect(screen.queryByText('How we calculate this')).not.toBeInTheDocument();
  });
});

describe('ROIDashboard compact + lead-value frame (The Issue P0 spine)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('compact=false (default) still renders the Traffic Value by Page table (byte-identical)', () => {
    mockROI();
    renderDashboard('growth');
    expect(screen.getByText('Traffic Value by Page')).toBeInTheDocument();
  });

  it('compact=true hides the Traffic Value by Page table (it relocates to Under the hood)', () => {
    mockROI();
    renderDashboard('growth', { compact: true });
    expect(screen.queryByText('Traffic Value by Page')).not.toBeInTheDocument();
  });

  it('renders the banded estimated dollar value + unit label when outcomeVerdict is present', () => {
    mockROI(makeROIData({ outcomeVerdict }));
    renderDashboard('growth', { evergreen: true });
    expect(screen.getByText('~$11,000')).toBeInTheDocument();
    expect(screen.getAllByText(/new patients/i).length).toBeGreaterThan(0);
  });

  it('demotes the traffic-value model to a labeled reference metric when a verdict leads', () => {
    mockROI(makeROIData({ outcomeVerdict }));
    renderDashboard('growth');
    expect(screen.getByText('Traffic value (reference)')).toBeInTheDocument();
    expect(screen.queryByText('Organic Traffic Value')).not.toBeInTheDocument();
  });

  it('methodology prose states the lead-value multiplier (no "do not multiply by lead value")', () => {
    mockROI(makeROIData({ outcomeVerdict }));
    renderDashboard('growth');
    fireEvent.click(screen.getByText('How we calculate this'));
    expect(screen.getByText(/multiply your tracked conversions by the per-lead value/i)).toBeInTheDocument();
    expect(screen.queryByText(/We do not multiply by lead value/i)).not.toBeInTheDocument();
  });
});
