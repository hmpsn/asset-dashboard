// @ds-rebuilt
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticReport } from '../../../shared/types/diagnostics';
import { DiagnosticsSurface } from '../../../src/components/global-ops-rebuilt';
import { expectNoA11yViolations } from '../a11y';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  refetchList: vi.fn(),
  refetchDetail: vi.fn(),
}));

vi.mock('../../../src/hooks/admin/useDiagnostics', () => ({
  useDiagnosticsList: () => mocks.list(),
  useDiagnosticReport: () => mocks.detail(),
}));

const completedReport: DiagnosticReport = {
  id: 'diag-completed',
  workspaceId: 'ws-1',
  insightId: 'insight-1',
  anomalyType: 'ranking_loss',
  affectedPages: ['/shop/velvet-armchair'],
  status: 'completed',
  diagnosticContext: {
    anomaly: {
      type: 'ranking_loss', severity: 'critical', metric: 'clicks', currentValue: 3170,
      expectedValue: 4800, deviationPercent: -34, firstDetected: '2026-07-10T12:00:00.000Z',
    },
    positionHistory: [
      { date: '2026-07-08', position: 16, clicks: 180, impressions: 1800 },
      { date: '2026-07-09', position: 22, clicks: 120, impressions: 1400 },
    ],
    queryBreakdown: [{
      query: 'velvet armchair', currentClicks: 80, previousClicks: 130,
      currentPosition: 22, previousPosition: 16, impressionChange: -18,
    }],
    redirectProbe: {
      chain: [{ url: 'https://example.com/old-chair', status: 301, location: '/shop/velvet-armchair' }],
      finalStatus: 200, canonical: 'https://example.com/shop/velvet-armchair', isSoftFourOhFour: false,
    },
    internalLinks: {
      count: 8, siteMedian: 21, topLinkingPages: ['/shop/sofas', '/living-room'], deficit: 13,
    },
    backlinks: {
      totalBacklinks: 12, referringDomains: 7,
      topDomains: [{ domain: 'design.example', backlinksCount: 4 }], recentlyLost: 2,
    },
    siteBaselines: { avgInternalLinks: 18, medianPosition: 8, totalBacklinks: 240 },
    recentActivity: [{ date: '2026-07-08', action: 'Page updated', details: 'Sofas hub content refreshed.' }],
    concurrentAnomalies: [{ type: 'ctr_drop', page: '/shop/velvet-armchair', severity: 'warning' }],
    existingInsights: [{ type: 'content_decay', severity: 'warning', summary: 'Page freshness is declining.' }],
    periodComparison: {
      current: { clicks: 3170, impressions: 41000, ctr: 7.7, position: 22 },
      previous: { clicks: 4800, impressions: 52000, ctr: 9.2, position: 16 },
      changePercent: { clicks: -34, impressions: -21, ctr: -16, position: 38 },
    },
    unavailableSources: [{ source: 'GA4', reason: 'Property is not connected.' }],
  },
  rootCauses: [{
    rank: 1,
    title: 'Lost internal links after the Sofas hub refresh',
    confidence: 'high',
    explanation: 'The page fell out of the core internal-link graph after the hub refresh.',
    evidence: ['Internal links fell from 21 to 8.', 'The ranking slide began after the refresh.'],
  }],
  remediationActions: [{
    priority: 'P0', title: 'Restore internal links', description: 'Re-add links from the hub and related pages.',
    effort: 'low', impact: 'high', owner: 'seo', pageUrls: ['/shop/velvet-armchair'],
  }],
  adminReport: 'Admin report',
  clientSummary: 'Client summary',
  errorMessage: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  completedAt: '2026-07-10T12:00:30.000Z',
};

function queryResult<T>(data: T) {
  return {
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function renderSurface(ui: ReactElement, initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{location.pathname}{location.search}</output>;
}

beforeEach(() => {
  mocks.list.mockReset();
  mocks.detail.mockReset();
  mocks.refetchList.mockReset();
  mocks.refetchDetail.mockReset();
  mocks.list.mockReturnValue(queryResult({ reports: [] }));
  mocks.detail.mockReturnValue(queryResult({ report: completedReport }));
});

describe('DiagnosticsLens parity composition', () => {
  it('renders a compact report-history receiver with every production status', () => {
    mocks.list.mockReturnValue(queryResult({
      reports: [
        completedReport,
        { ...completedReport, id: 'diag-running', status: 'running', completedAt: null },
        { ...completedReport, id: 'diag-failed', status: 'failed', completedAt: null, errorMessage: 'Provider timeout' },
      ],
    }));

    renderSurface(<DiagnosticsSurface workspaceId="ws-1" />, '/ws/ws-1/diagnostics');

    expect(screen.getByTestId('diagnostics-rebuilt')).toHaveAttribute('data-report-id', '');
    expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument();
    expect(screen.getByText('3 total')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Velvet Armchair/i })[0]).toHaveAttribute('href', '/ws/ws-1/diagnostics?report=diag-completed');
    fireEvent.click(screen.getByRole('button', { name: 'Open Search & Traffic' }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/ws/ws-1/analytics-hub');
  });

  it('renders completed report hierarchy, dense findings, remediation, and evidence', () => {
    renderSurface(<DiagnosticsSurface workspaceId="ws-1" />, '/ws/ws-1/diagnostics?report=diag-completed');

    expect(screen.getByTestId('diagnostics-rebuilt')).toHaveAttribute('data-report-id', 'diag-completed');
    expect(screen.getByRole('heading', { name: 'Deep Diagnostic: Velvet Armchair' })).toBeInTheDocument();
    expect(screen.getByText('-34%')).toBeInTheDocument();
    expect(screen.getByText('Lost internal links after the Sofas hub refresh')).toBeInTheDocument();
    expect(screen.getByText('Restore internal links')).toBeInTheDocument();
    expect(screen.getByText('4,800 → 3,170 (-34%)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Period comparison' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByText('2 evidence points'));
    expect(screen.getByText('Internal links fell from 21 to 8.')).toBeInTheDocument();
  });

  it('keeps the running theater honest without inventing phase completion', () => {
    mocks.detail.mockReturnValue(queryResult({ report: { ...completedReport, status: 'running', completedAt: null } }));
    renderSurface(<DiagnosticsSurface workspaceId="ws-1" />, '/ws/ws-1/diagnostics?report=diag-running');

    expect(screen.getByRole('heading', { name: 'Running deep diagnostic…' })).toBeInTheDocument();
    expect(screen.getByText('The report refreshes automatically when analysis completes.')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('keeps failed-report recovery at the source insight instead of duplicating the run action', () => {
    mocks.detail.mockReturnValue(queryResult({ report: { ...completedReport, status: 'failed', completedAt: null, errorMessage: 'Search provider timed out.' } }));
    renderSurface(<DiagnosticsSurface workspaceId="ws-1" />, '/ws/ws-1/diagnostics?report=diag-failed');

    expect(screen.getByText('Search provider timed out.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Search & Traffic' })).toHaveAttribute('href', '/ws/ws-1/analytics-hub');
    expect(screen.queryByRole('button', { name: /retry diagnostic/i })).not.toBeInTheDocument();
  });

  it('keeps the empty state action at the real anomaly source', () => {
    renderSurface(<DiagnosticsSurface workspaceId="ws-1" />, '/ws/ws-1/diagnostics');
    expect(screen.getByText('No diagnostics yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Search & Traffic' }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/ws/ws-1/analytics-hub');
  });

  it('asks for workspace context before querying diagnostic data', () => {
    renderSurface(<DiagnosticsSurface />, '/diagnostics');
    expect(screen.getByText('Choose a workspace')).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('passes the shared accessibility floor in completed-report state', async () => {
    const { container } = renderSurface(<DiagnosticsSurface workspaceId="ws-1" />, '/ws/ws-1/diagnostics?report=diag-completed');
    await expectNoA11yViolations(container);
  });
});
