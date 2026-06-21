/**
 * the-issue-export-bar.test.tsx — The Issue (Client) P1b Lane C component tests.
 *
 * Covers the three Lane C surfaces:
 *   1. IssueExportBar — opens Lane A's one-pager URL via window.open (teal CTA); previewMode
 *      suppresses the open; segment-aware forwarding sub-line; no purple.
 *   2. IssueYourLeadsSection — renders the client's own captured leads (name/email/form), empty
 *      and loading states; real loading→loaded transition (mocked-hook Rules-of-Hooks guard);
 *      no purple.
 *   3. TheIssueClientPage spine-ON mount — return-hook OFF → neither P1b surface mounts
 *      (byte-identical, verdict spine intact); return-hook ON → both mount.
 *
 * Mocks the export API wrapper + the useClientMyLeads hook (no raw fetch). Mirrors the
 * conversion-tracking-readout per-flag useFeatureFlag dispatcher pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { NamedLeadView } from '../../shared/types/the-issue';
import type { ResolvedSegmentProfile } from '../../shared/types/workspace';

// ── Mock Lane A's export URL helper (no real navigation) ──────────────────────────
vi.mock('../../src/api/conversionTracking', () => ({
  getOnePagerExportUrl: (wsId: string) => `/api/public/export/${wsId}/one-pager`,
  getMyLeads: vi.fn(async () => ({ leads: [] })),
}));

// ── Mock the client my-leads hook so the leads section is deterministic ────────────
// Preserve the rest of the barrel (TheIssueClientPage also imports useClientROI /
// useClientContentRequests from here) via importActual.
const myLeadsMock = vi.fn<() => { leads: NamedLeadView[]; isLoading: boolean; isError: boolean }>(
  () => ({ leads: [], isLoading: false, isError: false }),
);
vi.mock('../../src/hooks/client', async (importActual) => ({
  ...(await importActual<typeof import('../../src/hooks/client')>()),
  useClientMyLeads: (_wsId: string, _enabled?: boolean) => myLeadsMock(),
}));

import { IssueExportBar } from '../../src/components/client/the-issue/IssueExportBar';
import { IssueYourLeadsSection } from '../../src/components/client/the-issue/IssueYourLeadsSection';

function makeLead(over: Partial<NamedLeadView> = {}): NamedLeadView {
  return {
    id: 'lead-1',
    formName: 'Contact form',
    leadName: 'Jane Doe',
    leadEmail: 'jane@example.com',
    outcomeType: 'form_fill',
    submittedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ...over,
  };
}

describe('IssueExportBar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a primary CTA (teal gradient via the Button primitive) and opens the exact one-pager URL', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<IssueExportBar workspaceId="ws-1" />);
    const cta = screen.getByTestId('issue-export-cta');
    // The Button primitive owns the canonical teal gradient.
    expect(cta.className).toMatch(/teal|from-teal/);
    fireEvent.click(cta);
    expect(openSpy).toHaveBeenCalledWith('/api/public/export/ws-1/one-pager', '_blank', 'noopener');
  });

  it('previewMode suppresses window.open (operator can preview safely)', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<IssueExportBar workspaceId="ws-1" previewMode />);
    fireEvent.click(screen.getByTestId('issue-export-cta'));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('segment-aware framing: partner_summary names the partner destination', () => {
    const segmentProfile = { exportProfile: 'partner_summary' } as ResolvedSegmentProfile;
    render(<IssueExportBar workspaceId="ws-1" segmentProfile={segmentProfile} />);
    expect(screen.getByText(/forward to your partners/i)).toBeInTheDocument();
  });

  it('defaults to the board framing when no segment profile is supplied', () => {
    render(<IssueExportBar workspaceId="ws-1" />);
    expect(screen.getByText(/forward to your board/i)).toBeInTheDocument();
  });

  it('uses no purple/violet/indigo (client-facing Four Laws)', () => {
    const { container } = render(<IssueExportBar workspaceId="ws-1" />);
    expect(container.innerHTML).not.toMatch(/purple-|violet|indigo/);
  });

  it('tags the root with data-p1b (flag-OFF DOM-probe hook)', () => {
    const { container } = render(<IssueExportBar workspaceId="ws-1" />);
    expect(container.querySelector('[data-p1b]')).not.toBeNull();
  });
});

describe('IssueYourLeadsSection', () => {
  beforeEach(() => {
    myLeadsMock.mockReturnValue({ leads: [], isLoading: false, isError: false });
  });

  it('renders the client own leads (name + email + form) when present', () => {
    myLeadsMock.mockReturnValue({
      leads: [makeLead(), makeLead({ id: 'lead-2', leadName: 'Bob Smith', leadEmail: 'bob@example.com' })],
      isLoading: false,
      isError: false,
    });
    render(<IssueYourLeadsSection workspaceId="ws-1" />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.getAllByText('Contact form').length).toBeGreaterThan(0);
  });

  it('empty state when there are no leads (action-oriented copy, no fake rows)', () => {
    myLeadsMock.mockReturnValue({ leads: [], isLoading: false, isError: false });
    render(<IssueYourLeadsSection workspaceId="ws-1" />);
    expect(screen.getByText(/no captured leads yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('issue-your-leads-list')).toBeNull();
  });

  it('real loading→loaded transition (mocked-hook Rules-of-Hooks guard)', () => {
    myLeadsMock.mockReturnValue({ leads: [], isLoading: true, isError: false });
    const { rerender } = render(<IssueYourLeadsSection workspaceId="ws-1" />);
    expect(screen.getByTestId('issue-your-leads-loading')).toBeInTheDocument();

    myLeadsMock.mockReturnValue({ leads: [makeLead()], isLoading: false, isError: false });
    rerender(<IssueYourLeadsSection workspaceId="ws-1" />);
    expect(screen.queryByTestId('issue-your-leads-loading')).toBeNull();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('uses no purple/violet/indigo', () => {
    myLeadsMock.mockReturnValue({ leads: [makeLead()], isLoading: false, isError: false });
    const { container } = render(<IssueYourLeadsSection workspaceId="ws-1" />);
    expect(container.innerHTML).not.toMatch(/purple-|violet|indigo/);
  });

  it('handles a null leadName/leadEmail without crashing', () => {
    myLeadsMock.mockReturnValue({
      leads: [makeLead({ leadName: null, leadEmail: null })],
      isLoading: false,
      isError: false,
    });
    render(<IssueYourLeadsSection workspaceId="ws-1" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/no email provided/i)).toBeInTheDocument();
  });
});

// ── TheIssueClientPage spine-ON mount: flag-gated, OFF byte-identical ───────────────
// Re-mock the feature flag hook + the heavy child surfaces so the page renders in jsdom.
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn(() => false),
}));

// The curated-feed query drives the page's loading early-return; resolve it deterministically so
// the spine branch renders (the slots — not the loading skeleton — are what these tests assert).
vi.mock('../../src/components/client/the-issue/useClientTheIssue', () => ({
  useClientTheIssue: () => ({
    data: {
      workspaceId: 'ws-1',
      generatedAt: new Date(0).toISOString(),
      recommendations: [],
      summary: {
        fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0,
        totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: null,
      },
    },
    isLoading: false,
    isError: false,
  }),
}));

describe('TheIssueClientPage — P1b export surfaces (flag-gated)', () => {
  // Lazy import after mocks are registered.
  let TheIssueClientPage: typeof import('../../src/components/client/the-issue/TheIssueClientPage').TheIssueClientPage;

  beforeEach(async () => {
    myLeadsMock.mockReturnValue({ leads: [], isLoading: false, isError: false });
    ({ TheIssueClientPage } = await import('../../src/components/client/the-issue/TheIssueClientPage'));
  });

  const baseProps = {
    workspaceId: 'ws-1',
    effectiveTier: 'growth' as const,
    betaMode: false,
    actionCounts: { approvals: 0, briefs: 0, posts: 0, replies: 0, contentPlan: 0 },
    overview: null,
    ga4Overview: null,
    ga4Conversions: [],
    audit: null,
    strategyData: null,
    onAskAi: vi.fn(),
    onOpenChat: vi.fn(),
  };

  function renderPage(extra: Record<string, unknown>) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
    return render(<TheIssueClientPage {...baseProps} {...extra} />, { wrapper });
  }

  it('spine ON + return-hook OFF → no export bar, no leads section (byte-identical), verdict intact', () => {
    renderPage({ theIssueClientSpine: true, theIssueReturnHook: false });
    expect(screen.getByTestId('slot-verdict')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-export-bar')).toBeNull();
    expect(screen.queryByTestId('issue-your-leads')).toBeNull();
    expect(screen.queryByTestId('the-issue-client-page')?.querySelector('[data-p1b]')).toBeNull();
  });

  it('spine ON + return-hook ON → export bar mounts (leads section lives in the disclosure)', () => {
    renderPage({ theIssueClientSpine: true, theIssueReturnHook: true });
    expect(screen.getByTestId('issue-export-bar')).toBeInTheDocument();
    // The leads section is mounted (inside the collapsed "Under the hood" details body).
    expect(screen.getByTestId('issue-your-leads')).toBeInTheDocument();
  });

  it('previewMode + return-hook ON → export bar present, leads section suppressed (client PII)', () => {
    renderPage({ theIssueClientSpine: true, theIssueReturnHook: true, previewMode: true });
    expect(screen.getByTestId('issue-export-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-your-leads')).toBeNull();
  });
});
