/**
 * Component tests for AeoReview.tsx
 * Wave 14 coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── Module mocks (hoisted before component import) ────────────────────────────

const aeoGetMock = vi.fn();
const aeoSiteReviewMock = vi.fn();
const aeoPageReviewMock = vi.fn();

vi.mock('../../src/api/seo', () => ({
  aeoReview: {
    get: (...args: unknown[]) => aeoGetMock(...args),
    siteReview: (...args: unknown[]) => aeoSiteReviewMock(...args),
    pageReview: (...args: unknown[]) => aeoPageReviewMock(...args),
  },
}));

const clientActionsCreateMock = vi.fn();

vi.mock('../../src/api/clientActions', () => ({
  clientActions: {
    create: (...args: unknown[]) => clientActionsCreateMock(...args),
  },
}));

// Site review now runs through the background job platform (C2). The component
// consumes the shared useJobProgress contract, so these tests mock that hook
// rather than the retired synchronous aeoReview.siteReview API call.
const startSiteReviewJobMock = vi.fn();
const jobProgressState = { isRunning: false, error: null as string | null };

vi.mock('../../src/hooks/useJobProgress', () => ({
  useJobProgress: () => ({
    startJob: (...args: unknown[]) => startSiteReviewJobMock(...args),
    isRunning: jobProgressState.isRunning,
    jobId: null,
    error: jobProgressState.error,
  }),
}));

// ── Import component under test ───────────────────────────────────────────────
import { AeoReview } from '../../src/components/AeoReview';
import type { AeoSiteReview, AeoPageReview, AeoPageChange } from '../../shared/types/aeo';

// ── Helpers / Fixtures ────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function makeChange(overrides: Partial<AeoPageChange> = {}): AeoPageChange {
  return {
    id: 'change-1',
    changeType: 'rewrite_intro',
    location: 'Introduction',
    suggestedChange: 'Updated introduction copy here.',
    rationale: 'The current intro is not AEO-optimised.',
    effort: 'quick',
    priority: 'high',
    aeoImpact: 'High chance of AI citation.',
    ...overrides,
  };
}

function makePage(overrides: Partial<AeoPageReview> = {}): AeoPageReview {
  return {
    pageUrl: 'https://example.com/page',
    pageTitle: 'Example Page',
    reviewedAt: '2024-01-01T00:00:00Z',
    overallScore: 72,
    summary: 'This page needs a few quick updates.',
    changes: [makeChange()],
    quickWinCount: 1,
    estimatedTimeMinutes: 15,
    ...overrides,
  };
}

function makeSiteReview(overrides: Partial<AeoSiteReview> = {}): AeoSiteReview {
  return {
    workspaceId: 'ws-1',
    generatedAt: '2024-01-01T00:00:00Z',
    pages: [makePage()],
    sitewideSummary: 'Site reviewed. 1 page, 1 change.',
    totalChanges: 1,
    quickWins: 1,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('AeoReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no saved review
    aeoGetMock.mockResolvedValue(null);
    aeoSiteReviewMock.mockResolvedValue(makeSiteReview());
    aeoPageReviewMock.mockResolvedValue(makePage());
    clientActionsCreateMock.mockResolvedValue({});
    startSiteReviewJobMock.mockResolvedValue('job-1');
    jobProgressState.isRunning = false;
    jobProgressState.error = null;
  });

  // ── Empty state (no review yet) ─────────────────────────────────────────────

  it('renders empty state with Run AEO Review button when no review exists', async () => {
    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run aeo review/i })).toBeInTheDocument();
    });
  });

  it('renders the AEO Page Review heading in empty state', async () => {
    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('AEO Page Review')).toBeInTheDocument();
    });
  });

  it('shows loading spinner when the site review job is running', async () => {
    jobProgressState.isRunning = true;

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Running AEO review/i)).toBeInTheDocument();
    });
  });

  // ── Review loaded ────────────────────────────────────────────────────────────

  it('renders stat cards once a review is loaded', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Avg AEO Score')).toBeInTheDocument();
      expect(screen.getByText('Pages Reviewed')).toBeInTheDocument();
      expect(screen.getByText('Total Changes')).toBeInTheDocument();
      expect(screen.getByText('Quick Wins')).toBeInTheDocument();
    });
  });

  it('renders site-wide summary text once a review is loaded', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Site reviewed. 1 page, 1 change.')).toBeInTheDocument();
    });
  });

  it('renders page title and URL in the page list', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Example Page')).toBeInTheDocument();
      expect(screen.getByText('https://example.com/page')).toBeInTheDocument();
    });
  });

  it('shows "1 quick" badge and change count in collapsed page row', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('1 quick')).toBeInTheDocument();
      // "1 changes" may appear multiple times (stat card + page row)
      expect(screen.getAllByText('1 changes').length).toBeGreaterThan(0);
    });
  });

  it('shows "high priority" badge when page has high-priority changes', async () => {
    const review = makeSiteReview({
      pages: [
        makePage({
          changes: [makeChange({ priority: 'high' })],
        }),
      ],
    });
    aeoGetMock.mockResolvedValue(review);

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('1 high priority')).toBeInTheDocument();
    });
  });

  // ── Expand/collapse page rows ────────────────────────────────────────────────

  it('expands a page row to show summary and changes when clicked', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    const pageTitle = await screen.findByText('Example Page');
    // Click on the row
    fireEvent.click(pageTitle.closest('div[class*="ClickableRow"]') ?? pageTitle.parentElement!);

    await waitFor(() => {
      expect(screen.getByText('This page needs a few quick updates.')).toBeInTheDocument();
    });
  });

  it('shows change type label and location when page is expanded', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    const pageTitle = await screen.findByText('Example Page');
    fireEvent.click(pageTitle.closest('div[class*="ClickableRow"]') ?? pageTitle.parentElement!);

    await waitFor(() => {
      expect(screen.getByText('Rewrite Intro')).toBeInTheDocument();
      expect(screen.getByText(/Introduction/)).toBeInTheDocument();
    });
  });

  it('expands a change row to show suggested change when clicked', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    // Expand the page
    const pageTitle = await screen.findByText('Example Page');
    fireEvent.click(pageTitle.closest('div[class*="ClickableRow"]') ?? pageTitle.parentElement!);

    // Then expand the change row
    const changeLabel = await screen.findByText('Rewrite Intro');
    fireEvent.click(changeLabel.closest('div[class*="ClickableRow"]') ?? changeLabel.parentElement!);

    await waitFor(() => {
      expect(screen.getByText('Recommended Change')).toBeInTheDocument();
      expect(screen.getByText('Updated introduction copy here.')).toBeInTheDocument();
    });
  });

  it('shows rationale in expanded change row', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    const pageTitle = await screen.findByText('Example Page');
    fireEvent.click(pageTitle.closest('div[class*="ClickableRow"]') ?? pageTitle.parentElement!);

    const changeLabel = await screen.findByText('Rewrite Intro');
    fireEvent.click(changeLabel.closest('div[class*="ClickableRow"]') ?? changeLabel.parentElement!);

    await waitFor(() => {
      // Rationale appears in both the collapsed preview line and the expanded "Why:" section
      expect(screen.getAllByText(/The current intro is not AEO-optimised/).length).toBeGreaterThan(0);
    });
  });

  it('shows "research needed" badge for changes requiring source research', async () => {
    const review = makeSiteReview({
      pages: [
        makePage({
          changes: [makeChange({ requiresSourceResearch: true })],
        }),
      ],
    });
    aeoGetMock.mockResolvedValue(review);

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    const pageTitle = await screen.findByText('Example Page');
    fireEvent.click(pageTitle.closest('div[class*="ClickableRow"]') ?? pageTitle.parentElement!);

    await waitFor(() => {
      expect(screen.getByText('research needed')).toBeInTheDocument();
    });
  });

  // ── Filters ──────────────────────────────────────────────────────────────────

  it('renders effort filter buttons (All, Quick, Moderate, 1h+)', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Effort:')).toBeInTheDocument();
    });

    const allButtons = screen.getAllByRole('button');
    const labels = allButtons.map(b => b.textContent?.trim());
    expect(labels).toContain('All');
    expect(labels).toContain('Quick');
    expect(labels).toContain('Moderate');
    expect(labels).toContain('1h+');
  });

  it('renders priority filter buttons (All, High, Medium, Low)', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Priority:')).toBeInTheDocument();
    });

    const allButtons = screen.getAllByRole('button');
    const labels = allButtons.map(b => b.textContent?.trim());
    expect(labels).toContain('High');
    expect(labels).toContain('Medium');
    expect(labels).toContain('Low');
  });

  it('shows "No changes match your current filters" when filters exclude all changes', async () => {
    // Page has only a 'quick' change — filtering by 'significant' should show empty message
    const review = makeSiteReview({
      pages: [makePage({ changes: [makeChange({ effort: 'quick' })] })],
    });
    aeoGetMock.mockResolvedValue(review);

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => screen.getByText('1h+'));

    fireEvent.click(screen.getByText('1h+'));

    await waitFor(() => {
      expect(screen.getByText(/No changes match your current filters/i)).toBeInTheDocument();
    });
  });

  // ── Send to client ────────────────────────────────────────────────────────────

  it('calls clientActions.create when "Send to client" is clicked on expanded page', async () => {
    const review = makeSiteReview({
      pages: [
        makePage({
          changes: [makeChange({ requiresSourceResearch: false })],
        }),
      ],
    });
    aeoGetMock.mockResolvedValue(review);

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    // Expand page
    const pageTitle = await screen.findByText('Example Page');
    fireEvent.click(pageTitle.closest('div[class*="ClickableRow"]') ?? pageTitle.parentElement!);

    // Click "Send to client"
    const sendBtn = await screen.findByRole('button', { name: /send to client/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(clientActionsCreateMock).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ sourceType: 'aeo_change' }),
      );
    });
  });

  it('shows "Sent" text after successfully sending to client', async () => {
    const review = makeSiteReview({
      pages: [
        makePage({
          changes: [makeChange({ requiresSourceResearch: false })],
        }),
      ],
    });
    aeoGetMock.mockResolvedValue(review);

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    const pageTitle = await screen.findByText('Example Page');
    fireEvent.click(pageTitle.closest('div[class*="ClickableRow"]') ?? pageTitle.parentElement!);

    const sendBtn = await screen.findByRole('button', { name: /send to client/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText('Sent')).toBeInTheDocument();
    });
  });

  it('shows error message when all changes require source research and send is attempted', async () => {
    const review = makeSiteReview({
      pages: [
        makePage({
          changes: [makeChange({ requiresSourceResearch: true })],
        }),
      ],
    });
    aeoGetMock.mockResolvedValue(review);

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    const pageTitle = await screen.findByText('Example Page');
    fireEvent.click(pageTitle.closest('div[class*="ClickableRow"]') ?? pageTitle.parentElement!);

    const sendBtn = await screen.findByRole('button', { name: /send to client/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText(/all aeo recommendations for this page need source research/i)).toBeInTheDocument();
    });

    // clientActions.create should NOT have been called
    expect(clientActionsCreateMock).not.toHaveBeenCalled();
  });

  // ── Re-run ────────────────────────────────────────────────────────────────────

  it('renders Re-run Review button once a review is loaded', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /re-run review/i })).toBeInTheDocument();
    });
  });

  it('starts a site review job when Re-run Review is clicked', async () => {
    aeoGetMock.mockResolvedValue(makeSiteReview());

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    const rerunBtn = await screen.findByRole('button', { name: /re-run review/i });
    fireEvent.click(rerunBtn);

    await waitFor(() => {
      expect(startSiteReviewJobMock).toHaveBeenCalledWith(expect.objectContaining({ maxPages: 15 }));
    });
  });

  // ── Error state ───────────────────────────────────────────────────────────────

  it('shows error message when the site review job fails', async () => {
    aeoGetMock.mockResolvedValue(null);
    jobProgressState.error = 'Network error';

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  // ── Multiple pages ────────────────────────────────────────────────────────────

  it('renders multiple page rows when review has multiple pages', async () => {
    const review = makeSiteReview({
      pages: [
        makePage({ pageUrl: 'https://example.com/about', pageTitle: 'About Page' }),
        makePage({ pageUrl: 'https://example.com/services', pageTitle: 'Services Page' }),
      ],
      totalChanges: 2,
    });
    aeoGetMock.mockResolvedValue(review);

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText('About Page')).toBeInTheDocument();
      expect(screen.getByText('Services Page')).toBeInTheDocument();
    });
  });

  // ── currentContent display ────────────────────────────────────────────────────

  it('shows "Current" section in expanded change when currentContent is provided', async () => {
    const review = makeSiteReview({
      pages: [
        makePage({
          changes: [makeChange({ currentContent: 'Old intro text here.' })],
        }),
      ],
    });
    aeoGetMock.mockResolvedValue(review);

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    const pageTitle = await screen.findByText('Example Page');
    fireEvent.click(pageTitle.closest('div[class*="ClickableRow"]') ?? pageTitle.parentElement!);

    const changeLabel = await screen.findByText('Rewrite Intro');
    fireEvent.click(changeLabel.closest('div[class*="ClickableRow"]') ?? changeLabel.parentElement!);

    await waitFor(() => {
      expect(screen.getByText('Current')).toBeInTheDocument();
      expect(screen.getByText(/"Old intro text here\."/)).toBeInTheDocument();
    });
  });

  // ── verifiedSourceEvidence ────────────────────────────────────────────────────

  it('shows source evidence in expanded change when verifiedSourceEvidence is provided', async () => {
    const review = makeSiteReview({
      pages: [
        makePage({
          changes: [makeChange({ verifiedSourceEvidence: 'Source: study.example.com/2024' })],
        }),
      ],
    });
    aeoGetMock.mockResolvedValue(review);

    render(<AeoReview workspaceId="ws-1" />, { wrapper: makeWrapper() });

    const pageTitle = await screen.findByText('Example Page');
    fireEvent.click(pageTitle.closest('div[class*="ClickableRow"]') ?? pageTitle.parentElement!);

    const changeLabel = await screen.findByText('Rewrite Intro');
    fireEvent.click(changeLabel.closest('div[class*="ClickableRow"]') ?? changeLabel.parentElement!);

    await waitFor(() => {
      expect(screen.getByText('Source evidence:')).toBeInTheDocument();
      expect(screen.getByText(/Source: study\.example\.com\/2024/)).toBeInTheDocument();
    });
  });
});
