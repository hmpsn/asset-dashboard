/**
 * BulkAcceptPanel — sessionStorage job recovery on remount.
 *
 * The component lazy-reads sessionStorage in its useState initializer and then
 * fires a mount-only useEffect to query the job status from the server and
 * restore in-progress UI. This test verifies both halves of that contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkAcceptPanel } from '../../../src/components/audit/BulkAcceptPanel';
import { seoBulkJobs } from '../../../src/api/seo';
import type { SeoAuditResult } from '../../../src/components/audit/types';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: vi.fn(),
}));

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ cancelJob: vi.fn() }),
}));

const mockJobsGet = vi.fn();
vi.mock('../../../src/api/misc', () => ({
  jobs: { get: (...args: unknown[]) => mockJobsGet(...args) },
  redirects: { save: vi.fn() },
}));

vi.mock('../../../src/api/seo', () => ({
  seoBulkJobs: { bulkAcceptFixes: vi.fn() },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-bulk-test';
const SESSION_KEY = `seo-bulk-accept-job-${WORKSPACE_ID}`;

const minimalData: SeoAuditResult = {
  siteScore: 80,
  totalPages: 1,
  errors: 0,
  warnings: 0,
  infos: 0,
  pages: [],
  siteWideIssues: [],
};

const minimalDataWithFixes: SeoAuditResult = {
  siteScore: 60,
  totalPages: 1,
  errors: 1,
  warnings: 0,
  infos: 0,
  pages: [{
    pageId: 'fixable-page-1',
    page: 'Home',
    slug: '/',
    url: 'https://example.com/',
    score: 60,
    issues: [{
      check: 'meta-description',
      severity: 'warning',
      message: 'Missing meta description',
      recommendation: 'Add a meta description.',
      suggestedFix: 'Add a compelling meta description that summarizes the page.',
    }],
  }],
  siteWideIssues: [],
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

function renderPanel(overrides: Partial<Parameters<typeof BulkAcceptPanel>[0]> = {}) {
  const onBulkApplyingChange = vi.fn();
  const onBulkProgressChange = vi.fn();
  const onBulkError = vi.fn();
  const onRegisterHandlers = vi.fn();

  const props = {
    workspaceId: WORKSPACE_ID,
    siteId: 'site-1',
    data: minimalData,
    appliedFixes: new Set<string>(),
    setAppliedFixes: vi.fn(),
    editedSuggestions: {},
    onBulkApplyingChange,
    onBulkProgressChange,
    onBulkError,
    onRegisterHandlers,
    ...overrides,
  };

  const result = render(<BulkAcceptPanel {...props} />, { wrapper: makeWrapper() });
  return { ...result, onBulkApplyingChange, onBulkProgressChange, onBulkError, onRegisterHandlers };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BulkAcceptPanel — sessionStorage job recovery', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('renders nothing (no error banner) when no active job', () => {
    mockJobsGet.mockResolvedValue({ status: 'done', progress: 0, total: 0 });
    const { container } = renderPanel();
    // Component only renders when bulkError is set — should be empty
    expect(container.firstChild).toBeNull();
  });

  it('reads existing sessionStorage job ID on mount', async () => {
    const JOB_ID = 'job-recovery-abc';
    sessionStorage.setItem(SESSION_KEY, JOB_ID);

    // Server says job is still running
    mockJobsGet.mockResolvedValue({ status: 'running', progress: 3, total: 10 });

    const { onBulkApplyingChange, onBulkProgressChange } = renderPanel();

    // Wait for the mount-only useEffect to call jobsApi.get
    await waitFor(() => {
      expect(mockJobsGet).toHaveBeenCalledWith(JOB_ID);
    });

    // Should set bulkApplying=true and restore progress
    await waitFor(() => {
      const applyingCalls = onBulkApplyingChange.mock.calls.map(c => c[0]);
      expect(applyingCalls).toContain(true);
    });

    await waitFor(() => {
      const progressCalls = onBulkProgressChange.mock.calls.map(c => c[0]);
      const recovered = progressCalls.find(p => p?.done === 3 && p?.total === 10);
      expect(recovered).toBeDefined();
    });
  });

  it('clears sessionStorage when recovered job is in terminal state (done)', async () => {
    const JOB_ID = 'job-done-xyz';
    sessionStorage.setItem(SESSION_KEY, JOB_ID);

    mockJobsGet.mockResolvedValue({ status: 'done', progress: 10, total: 10 });

    renderPanel();

    await waitFor(() => {
      expect(mockJobsGet).toHaveBeenCalledWith(JOB_ID);
    });

    // After recovering a terminal job, sessionStorage should be cleared
    await waitFor(() => {
      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    });
  });

  it('clears sessionStorage when recovered job is in terminal state (error)', async () => {
    const JOB_ID = 'job-failed-xyz';
    sessionStorage.setItem(SESSION_KEY, JOB_ID);

    mockJobsGet.mockResolvedValue({ status: 'error', progress: 2, total: 10 });

    renderPanel();

    await waitFor(() => {
      expect(mockJobsGet).toHaveBeenCalledWith(JOB_ID);
    });

    await waitFor(() => {
      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    });
  });

  it('clears sessionStorage on job API fetch error', async () => {
    const JOB_ID = 'job-fetch-error';
    sessionStorage.setItem(SESSION_KEY, JOB_ID);

    mockJobsGet.mockRejectedValue(new Error('network error'));

    renderPanel();

    await waitFor(() => {
      expect(mockJobsGet).toHaveBeenCalledWith(JOB_ID);
    });

    await waitFor(() => {
      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    });
  });

  it('does not call jobsApi.get when no job in sessionStorage', async () => {
    // No sessionStorage entry
    mockJobsGet.mockResolvedValue({ status: 'done' });

    renderPanel();

    // Wait a tick then assert no call was made
    await new Promise(r => setTimeout(r, 20));
    expect(mockJobsGet).not.toHaveBeenCalled();
  });

  it('persists job ID to sessionStorage when acceptAll is triggered', async () => {
    vi.mocked(seoBulkJobs.bulkAcceptFixes).mockResolvedValue({ jobId: 'persisted-job-123' } as never);

    const { onRegisterHandlers } = renderPanel({ data: minimalDataWithFixes });

    // Wait for the component to register its handlers with the parent
    await waitFor(() => expect(onRegisterHandlers).toHaveBeenCalled());

    const handlers = onRegisterHandlers.mock.calls[0][0] as { acceptAll: () => Promise<void> };

    // Trigger the real acceptAllSuggestions — it calls bulkAcceptFixes and setBulkAcceptJobId
    await act(async () => { await handlers.acceptAll(); });

    // The persistence useEffect writes bulkAcceptJobId to sessionStorage
    await waitFor(() => {
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('persisted-job-123');
    });
  });

  it('registers acceptAll and cancel handlers with parent', async () => {
    mockJobsGet.mockResolvedValue({ status: 'done' });
    const { onRegisterHandlers } = renderPanel();

    await waitFor(() => {
      expect(onRegisterHandlers).toHaveBeenCalled();
    });

    const handlers = onRegisterHandlers.mock.calls[0][0];
    expect(typeof handlers.acceptAll).toBe('function');
    expect(typeof handlers.cancel).toBe('function');
  });
});
