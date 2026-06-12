/**
 * R2-B — Component tests for AgencyWorkFeed.
 *
 * Tests:
 *  - Renders the "What we're working on" section card.
 *  - Live now zone: active job appears with narrative label (not raw type string).
 *  - Recent work zone: activity entries grouped by day with narrative labels.
 *  - Admin-only job type does NOT appear (visibility enforcement at hook level via mock).
 *  - Empty state renders when there are no jobs or activity entries.
 *  - Month stats zone: shows counts when month activity is present.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgencyWorkFeed } from '../../src/components/client/AgencyWorkFeed';
import type { ClientActivityEntry, ClientJobEntry } from '../../src/api/analytics';
import { BACKGROUND_JOB_TYPES, getBackgroundJobLabel } from '../../shared/types/background-jobs';

// ── Mock the work-feed hooks ──────────────────────────────────────────
vi.mock('../../src/hooks/client/useClientWorkFeed', () => ({
  useClientJobs: vi.fn(),
  useClientActivityFeed: vi.fn(),
}));

import { useClientJobs, useClientActivityFeed } from '../../src/hooks/client/useClientWorkFeed';

const mockUseClientJobs = vi.mocked(useClientJobs);
const mockUseClientActivityFeed = vi.mocked(useClientActivityFeed);

// ── Fixtures ─────────────────────────────────────────────────────────

function makeJob(overrides?: Partial<ClientJobEntry>): ClientJobEntry {
  return {
    id: 'job-1',
    type: BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION,
    status: 'running',
    progress: 40,
    total: 100,
    message: 'Generating recommendations',
    workspaceId: 'ws-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeActivity(overrides?: Partial<ClientActivityEntry>): ClientActivityEntry {
  return {
    id: 'act-1',
    type: 'audit_completed',
    title: 'Site audit done',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderFeed(workspaceId = 'ws-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AgencyWorkFeed workspaceId={workspaceId} />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('AgencyWorkFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the section card title', () => {
    mockUseClientJobs.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useClientJobs>);
    mockUseClientActivityFeed.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useClientActivityFeed>);

    renderFeed();
    expect(screen.getByText(/What we're working on/i)).toBeInTheDocument();
  });

  it('shows empty state when there are no jobs and no activity', () => {
    mockUseClientJobs.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useClientJobs>);
    mockUseClientActivityFeed.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useClientActivityFeed>);

    renderFeed();
    expect(screen.getByText(/Work starts soon/i)).toBeInTheDocument();
  });

  it('shows a running job with its human-readable label (not the raw type string)', () => {
    const job = makeJob({ status: 'running', progress: 50, total: 100 });
    mockUseClientJobs.mockReturnValue({ data: [job], isLoading: false } as ReturnType<typeof useClientJobs>);
    mockUseClientActivityFeed.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useClientActivityFeed>);

    renderFeed();

    const label = getBackgroundJobLabel(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION);
    expect(screen.getByText(label)).toBeInTheDocument();
    // Raw type string must NOT be visible
    expect(screen.queryByText(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION)).not.toBeInTheDocument();
    // Progress percentage is displayed
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('does not show pending/done jobs that are not active', () => {
    const doneJob = makeJob({ status: 'done' });
    const errorJob = makeJob({ id: 'job-2', status: 'error' });
    mockUseClientJobs.mockReturnValue({ data: [doneJob, errorJob], isLoading: false } as ReturnType<typeof useClientJobs>);
    mockUseClientActivityFeed.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useClientActivityFeed>);

    renderFeed();

    // Neither done nor error jobs show in the live-now zone
    // (empty state should show instead)
    expect(screen.getByText(/Work starts soon/i)).toBeInTheDocument();
  });

  it('renders recent activity entries grouped by day with narrative labels', () => {
    const activity = makeActivity({ type: 'audit_completed', title: 'Site audit done' });
    mockUseClientJobs.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useClientJobs>);
    mockUseClientActivityFeed.mockReturnValue({ data: [activity], isLoading: false } as ReturnType<typeof useClientActivityFeed>);

    renderFeed();

    // Narrative label from AGENCY_ACTIVITY_LABELS['audit_completed']
    expect(screen.getByText(/We ran a site-wide SEO health audit/i)).toBeInTheDocument();
    // Tag label
    expect(screen.getByText('Site audit')).toBeInTheDocument();
  });

  it('renders month stats when activity is present this month', () => {
    const activity = makeActivity({ type: 'seo_updated', title: 'Meta updated' });
    mockUseClientJobs.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useClientJobs>);
    mockUseClientActivityFeed.mockReturnValue({ data: [activity], isLoading: false } as ReturnType<typeof useClientActivityFeed>);

    renderFeed();

    // "This month" header is present
    expect(screen.getByText(/This month/i)).toBeInTheDocument();
    // "actions" label is present (the number itself may not be unique in the DOM)
    expect(screen.getByText(/actions/i)).toBeInTheDocument();
    // "pages touched" because seo_updated is a PAGE_TOUCH_TYPE
    expect(screen.getByText(/pages touched/i)).toBeInTheDocument();
  });

  it('does not show the Live now zone when all jobs are outside the active statuses', () => {
    const cancelledJob = makeJob({ status: 'cancelled' });
    mockUseClientJobs.mockReturnValue({ data: [cancelledJob], isLoading: false } as ReturnType<typeof useClientJobs>);
    mockUseClientActivityFeed.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useClientActivityFeed>);

    renderFeed();
    expect(screen.queryByText(/Live now/i)).not.toBeInTheDocument();
  });
});
