/**
 * Smoke-render tests for 4 extracted audit components.
 *
 * Guards against prop-interface drift — if a required prop is added or
 * renamed without updating callers, these tests fail at compile time
 * (TypeScript) or at runtime (missing prop assertion).
 *
 * Each test passes minimal valid props and asserts the component mounts
 * without throwing.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CwvSummaryCard } from '../../../src/components/audit/CwvSummaryCard';
import { ScheduledAuditSettings } from '../../../src/components/audit/ScheduledAuditSettings';
import { DeadLinkPanel } from '../../../src/components/audit/DeadLinkPanel';
import { BulkAcceptPanel } from '../../../src/components/audit/BulkAcceptPanel';
import type { CwvSummary, SeoAuditResult } from '../../../src/components/audit/types';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: vi.fn(),
}));

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ cancelJob: vi.fn() }),
}));

vi.mock('../../../src/api/misc', () => ({
  jobs: { get: vi.fn().mockResolvedValue({ status: 'done' }) },
  redirects: { save: vi.fn() },
}));

vi.mock('../../../src/api/seo', () => ({
  seoBulkJobs: { bulkAcceptFixes: vi.fn() },
}));

vi.mock('../../../src/hooks/admin', () => ({
  useAuditSchedule: () => ({ data: null }),
}));

// ── Wrapper — new QueryClient per test to avoid cross-test cache pollution ────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// ── CwvSummaryCard ────────────────────────────────────────────────────────────

describe('CwvSummaryCard — smoke render', () => {
  const mobileCwv: CwvSummary['mobile'] = {
    assessment: 'good',
    fieldDataAvailable: true,
    lighthouseScore: 92,
    metrics: {
      LCP: { value: 1800, rating: 'good' },
      INP: { value: 140, rating: 'good' },
      CLS: { value: 0.05, rating: 'good' },
    },
  };

  it('renders without throwing when mobile CWV data provided', () => {
    expect(() =>
      render(<CwvSummaryCard cwvSummary={{ mobile: mobileCwv }} />, { wrapper: makeWrapper() }),
    ).not.toThrow();
  });

  it('renders both mobile and desktop strategies', () => {
    const { getByText } = render(
      <CwvSummaryCard cwvSummary={{ mobile: mobileCwv, desktop: { ...mobileCwv, lighthouseScore: 95 } }} />,
      { wrapper: makeWrapper() },
    );
    expect(getByText('Mobile')).toBeInTheDocument();
    expect(getByText('Desktop')).toBeInTheDocument();
  });

  it('renders nothing when both mobile and desktop are absent', () => {
    const { container } = render(<CwvSummaryCard cwvSummary={{}} />, { wrapper: makeWrapper() });
    expect(container.firstChild).toBeNull();
  });

  it('renders needs-improvement assessment badge', () => {
    const { getByText } = render(
      <CwvSummaryCard cwvSummary={{ mobile: { ...mobileCwv, assessment: 'needs-improvement' } }} />,
      { wrapper: makeWrapper() },
    );
    expect(getByText('Needs Work')).toBeInTheDocument();
  });

  it('renders poor assessment as "Failed" badge', () => {
    const { getByText } = render(
      <CwvSummaryCard cwvSummary={{ mobile: { ...mobileCwv, assessment: 'poor' } }} />,
      { wrapper: makeWrapper() },
    );
    expect(getByText('Failed')).toBeInTheDocument();
  });
});

// ── ScheduledAuditSettings ────────────────────────────────────────────────────

describe('ScheduledAuditSettings — smoke render', () => {
  it('renders without throwing with a workspaceId', () => {
    expect(() =>
      render(<ScheduledAuditSettings workspaceId="ws-sched-test" />, { wrapper: makeWrapper() }),
    ).not.toThrow();
  });

  it('renders the "Configure" toggle button', () => {
    const { getByText } = render(
      <ScheduledAuditSettings workspaceId="ws-sched-test" />,
      { wrapper: makeWrapper() },
    );
    expect(getByText('Configure')).toBeInTheDocument();
  });

  it('renders the "Scheduled Audits" label', () => {
    const { getByText } = render(
      <ScheduledAuditSettings workspaceId="ws-sched-test" />,
      { wrapper: makeWrapper() },
    );
    expect(getByText('Scheduled Audits')).toBeInTheDocument();
  });
});

// ── DeadLinkPanel ─────────────────────────────────────────────────────────────

describe('DeadLinkPanel — smoke render', () => {
  it('renders without throwing with an empty dead link list', () => {
    expect(() =>
      render(<DeadLinkPanel deadLinkDetails={[]} siteId="site-1" />, { wrapper: makeWrapper() }),
    ).not.toThrow();
  });

  it('renders the "Export CSV" button', () => {
    const { getByText } = render(
      <DeadLinkPanel deadLinkDetails={[]} siteId="site-1" />,
      { wrapper: makeWrapper() },
    );
    expect(getByText('Export CSV')).toBeInTheDocument();
  });

  it('renders a dead link entry with status and URL', () => {
    const deadLinks = [{
      url: 'https://example.com/old-page',
      status: 404,
      statusText: 'Not Found',
      foundOn: 'Home',
      foundOnSlug: '/',
      anchorText: 'old link',
      type: 'internal' as const,
    }];

    const { getByText } = render(
      <DeadLinkPanel deadLinkDetails={deadLinks} siteId="site-1" workspaceId="ws-dead" />,
      { wrapper: makeWrapper() },
    );

    expect(getByText('404')).toBeInTheDocument();
    expect(getByText('https://example.com/old-page')).toBeInTheDocument();
  });

  it('shows total dead link count badge when multiple links provided', () => {
    const links = Array.from({ length: 3 }, (_, i) => ({
      url: `https://example.com/dead-${i}`,
      status: 404,
      statusText: 'Not Found',
      foundOn: `Page ${i}`,
      foundOnSlug: `/page-${i}`,
      anchorText: '',
      type: 'external' as const,
    }));

    const { getByText } = render(
      <DeadLinkPanel deadLinkDetails={links} siteId="site-1" />,
      { wrapper: makeWrapper() },
    );

    expect(getByText('3')).toBeInTheDocument();
  });
});

// ── BulkAcceptPanel ───────────────────────────────────────────────────────────

describe('BulkAcceptPanel — smoke render', () => {
  const minimalData: SeoAuditResult = {
    siteScore: 75,
    totalPages: 2,
    errors: 1,
    warnings: 0,
    infos: 0,
    pages: [],
    siteWideIssues: [],
  };

  it('renders without throwing (returns null with no error state)', () => {
    expect(() =>
      render(
        <BulkAcceptPanel
          workspaceId="ws-bulk-smoke"
          siteId="site-bulk"
          data={minimalData}
          appliedFixes={new Set()}
          setAppliedFixes={vi.fn()}
          editedSuggestions={{}}
          onBulkApplyingChange={vi.fn()}
          onBulkProgressChange={vi.fn()}
          onBulkError={vi.fn()}
          onRegisterHandlers={vi.fn()}
        />,
        { wrapper: makeWrapper() },
      ),
    ).not.toThrow();
  });

  it('renders null (no DOM output) when there is no error', () => {
    const { container } = render(
      <BulkAcceptPanel
        workspaceId="ws-bulk-smoke-2"
        siteId="site-bulk-2"
        data={minimalData}
        appliedFixes={new Set()}
        setAppliedFixes={vi.fn()}
        editedSuggestions={{}}
        onBulkApplyingChange={vi.fn()}
        onBulkProgressChange={vi.fn()}
        onBulkError={vi.fn()}
        onRegisterHandlers={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    );
    expect(container.firstChild).toBeNull();
  });
});
