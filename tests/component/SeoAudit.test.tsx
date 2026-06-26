/**
 * Tests for SeoAudit component + pure lib helpers.
 *
 * Wave 13 coverage: audit-batch.ts, audit-suppression-client.ts, SeoAudit.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── Pure lib imports (no mocks needed) ────────────────────────────────────────
import {
  issueToTaskKey,
  issueToTaskItem,
  selectIssuesForBatch,
  type BatchTaskItem,
} from '../../src/lib/audit-batch';
import { applyClientSuppressions } from '../../src/lib/audit-suppression-client';
import { queryKeys } from '../../src/lib/queryKeys';
import type { SeoIssue, PageSeoResult, SeoAuditResult } from '../../src/components/audit/types';

// ── Module mocks (must be hoisted before component import) ────────────────────

const backgroundTasksMock = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown>>,
  activeJobs: [] as Array<Record<string, unknown>>,
  startJob: vi.fn().mockResolvedValue('job-1'),
  trackJob: vi.fn(),
  getJobResult: vi.fn().mockReturnValue(undefined),
  findActiveJob: vi.fn().mockReturnValue(undefined),
  findLatestTerminalJob: vi.fn().mockReturnValue(undefined),
  jobsForWorkspace: vi.fn().mockReturnValue([]),
  cancelJob: vi.fn().mockResolvedValue(undefined),
  dismissJob: vi.fn(),
  clearDone: vi.fn(),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({
    jobs: backgroundTasksMock.jobs,
    activeJobs: backgroundTasksMock.activeJobs,
    startJob: backgroundTasksMock.startJob,
    trackJob: vi.fn(),
    getJobResult: vi.fn().mockReturnValue(undefined),
    findActiveJob: vi.fn().mockReturnValue(undefined),
    findLatestTerminalJob: vi.fn().mockReturnValue(undefined),
    jobsForWorkspace: vi.fn().mockReturnValue([]),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    dismissJob: vi.fn(),
    clearDone: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/usePageEditStates', () => ({
  usePageEditStates: () => ({
    getState: () => undefined,
    summary: {
      clean: 0,
      issueDetected: 0,
      fixProposed: 0,
      inReview: 0,
      approved: 0,
      rejected: 0,
      live: 0,
      total: 0,
    },
  }),
}));

vi.mock('../../src/hooks/admin', async () => {
  const workflowModule = await vi.importActual('../../src/hooks/admin/useSeoAuditWorkflow');
  return {
    useSeoAuditWorkflow: (workflowModule as { useSeoAuditWorkflow: unknown }).useSeoAuditWorkflow,
    useAuditTrafficMap: () => ({ data: {} }),
    useAuditSuppressions: () => ({ data: [] }),
    useAuditSchedule: () => ({ data: null }),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

const getSafeMock = vi.fn().mockResolvedValue([]);
const getOptionalMock = vi.fn().mockResolvedValue(null);
const postMock = vi.fn().mockResolvedValue({});
const putMock = vi.fn().mockResolvedValue({});
const delMock = vi.fn().mockResolvedValue({});

vi.mock('../../src/api/client', () => ({
  get: vi.fn(),
  getSafe: (...args: unknown[]) => getSafeMock(...args),
  getOptional: (...args: unknown[]) => getOptionalMock(...args),
  post: (...args: unknown[]) => postMock(...args),
  put: (...args: unknown[]) => putMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}));

// Stub out heavy sub-components to keep renders fast
vi.mock('../../src/components/audit/AuditHistory', () => ({
  AuditHistory: () => <div data-testid="audit-history" />,
}));
vi.mock('../../src/components/audit/SeoAuditGuide', () => ({
  SeoAuditGuide: () => <div data-testid="seo-audit-guide" />,
}));
vi.mock('../../src/components/audit/AuditReportExport', () => ({
  ReportModal: () => <div data-testid="report-modal" />,
  ReportViewer: () => <div data-testid="report-viewer" />,
}));
vi.mock('../../src/components/audit/AuditIssueRow', () => ({
  AuditIssueRow: ({ issue }: { issue: SeoIssue }) => (
    <div data-testid="audit-issue-row">{issue.message}</div>
  ),
}));
vi.mock('../../src/components/audit/AuditBatchActions', () => ({
  AuditBatchActions: () => <div data-testid="audit-batch-actions" />,
}));
vi.mock('../../src/components/audit/AuditFilters', () => ({
  AuditToolbar: () => <div data-testid="audit-toolbar" />,
  AuditCategoryFilter: () => <div data-testid="audit-category-filter" />,
}));
vi.mock('../../src/components/audit/CwvSummaryCard', () => ({
  CwvSummaryCard: () => <div data-testid="cwv-summary-card" />,
}));
vi.mock('../../src/components/audit/ScheduledAuditSettings', () => ({
  ScheduledAuditSettings: () => <div data-testid="scheduled-audit-settings" />,
}));
vi.mock('../../src/components/audit/BulkAcceptPanel', () => ({
  BulkAcceptPanel: ({ onRegisterHandlers }: { onRegisterHandlers: (h: unknown) => void }) => {
    onRegisterHandlers({ acceptAll: vi.fn(), cancel: vi.fn() });
    return <div data-testid="bulk-accept-panel" />;
  },
}));
vi.mock('../../src/components/audit/DeadLinkPanel', () => ({
  DeadLinkPanel: () => <div data-testid="dead-link-panel" />,
}));

// Stub lazy-loaded sub-tools to avoid dynamic import issues in jsdom
vi.mock('../../src/lib/lazyWithRetry', () => ({
  lazyWithRetry: (fn: () => Promise<{ default: React.ComponentType<unknown> }>) => {
    const { lazy } = require('react');
    return lazy(fn);
  },
}));
vi.mock('../../src/components/AeoReview', () => ({
  default: () => <div data-testid="aeo-review" />,
}));
vi.mock('../../src/components/ContentDecay', () => ({
  default: () => <div data-testid="content-decay" />,
}));

// Now import the component under test
import { SeoAudit } from '../../src/components/SeoAudit';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<SeoIssue> = {}): SeoIssue {
  return {
    check: 'title',
    severity: 'error',
    category: 'content',
    message: 'Missing page title',
    recommendation: 'Add a descriptive page title',
    ...overrides,
  };
}

function makePage(overrides: Partial<PageSeoResult> = {}): PageSeoResult {
  return {
    pageId: 'page-1',
    page: 'Home',
    slug: 'home',
    url: 'https://example.com/home',
    score: 75,
    issues: [makeIssue()],
    ...overrides,
  };
}

function makeAuditResult(overrides: Partial<SeoAuditResult> = {}): SeoAuditResult {
  return {
    siteScore: 80,
    totalPages: 1,
    errors: 1,
    warnings: 0,
    infos: 0,
    pages: [makePage()],
    siteWideIssues: [],
    ...overrides,
  };
}

// ── Wrapper ───────────────────────────────────────────────────────────────────

function makeWrapper(queryClient?: QueryClient) {
  const qc = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Pure lib: issueToTaskKey
// ══════════════════════════════════════════════════════════════════════════════

describe('issueToTaskKey', () => {
  it('produces a stable key from pageId + check + message prefix', () => {
    const page = { pageId: 'p-1' };
    const issue = { check: 'title', message: 'Missing page title' };
    expect(issueToTaskKey(page, issue)).toBe('p-1-title-Missing page title');
  });

  it('truncates message to 30 characters', () => {
    const page = { pageId: 'p-2' };
    const longMessage = 'A'.repeat(50);
    const issue = { check: 'title', message: longMessage };
    const key = issueToTaskKey(page, issue);
    // key format: `${pageId}-${check}-${message.slice(0,30)}`
    // Expected: 'p-2-title-' + 30 A's
    const expected = `p-2-title-${'A'.repeat(30)}`;
    expect(key).toBe(expected);
  });

  it('produces different keys for different checks on the same page', () => {
    const page = { pageId: 'p-1' };
    const i1 = { check: 'title', message: 'Missing title' };
    const i2 = { check: 'meta-description', message: 'Missing meta' };
    expect(issueToTaskKey(page, i1)).not.toBe(issueToTaskKey(page, i2));
  });

  it('produces different keys for same check on different pages', () => {
    const p1 = { pageId: 'p-1' };
    const p2 = { pageId: 'p-2' };
    const issue = { check: 'title', message: 'Missing title' };
    expect(issueToTaskKey(p1, issue)).not.toBe(issueToTaskKey(p2, issue));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Pure lib: issueToTaskItem
// ══════════════════════════════════════════════════════════════════════════════

describe('issueToTaskItem', () => {
  const page: PageSeoResult = {
    pageId: 'p-1',
    page: 'Home',
    slug: 'home',
    url: 'https://example.com/home',
    score: 75,
    issues: [],
  };

  const issue: SeoIssue = {
    check: 'title',
    severity: 'error',
    message: 'Missing page title',
    recommendation: 'Add a descriptive title',
    suggestedFix: 'Home | Acme Corp',
    category: 'content',
  };

  it('builds a task item with correct shape', () => {
    const item: BatchTaskItem = issueToTaskItem(page, issue);
    expect(item.category).toBe('seo');
    expect(item.priority).toBe('high'); // error → high
    expect(item.title).toContain('[Audit]');
    expect(item.title).toContain('title');
    expect(item.description).toContain('Home');
    expect(item.description).toContain('Add a descriptive title');
  });

  it('includes AI suggestion in description when present', () => {
    const item = issueToTaskItem(page, issue);
    expect(item.description).toContain('AI Suggestion: Home | Acme Corp');
  });

  it('uses edited suggestion when provided', () => {
    const editedSuggestions = { 'p-1-title': 'Custom Title Override' };
    const item = issueToTaskItem(page, issue, editedSuggestions);
    expect(item.description).toContain('Custom Title Override');
  });

  it('sets priority to medium for warning severity', () => {
    const warningIssue: SeoIssue = { ...issue, severity: 'warning', suggestedFix: undefined };
    const item = issueToTaskItem(page, warningIssue);
    expect(item.priority).toBe('medium');
  });

  it('sets priority to medium for info severity', () => {
    const infoIssue: SeoIssue = { ...issue, severity: 'info', suggestedFix: undefined };
    const item = issueToTaskItem(page, infoIssue);
    expect(item.priority).toBe('medium');
  });

  it('normalizes pageUrl from slug when url is absent', () => {
    const slugOnlyPage = { ...page, url: '', publishedPath: undefined };
    const item = issueToTaskItem(slugOnlyPage, issue);
    expect(item.pageUrl).toContain('home');
  });

  it('prefers publishedPath over url for pageUrl', () => {
    const enrichedPage = { ...page, publishedPath: 'services/seo' };
    const item = issueToTaskItem(enrichedPage, issue);
    expect(item.pageUrl).toContain('services/seo');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Pure lib: selectIssuesForBatch
// ══════════════════════════════════════════════════════════════════════════════

describe('selectIssuesForBatch', () => {
  const errorIssue: SeoIssue = makeIssue({ check: 'title', severity: 'error', message: 'Missing title' });
  const warnIssue: SeoIssue = makeIssue({ check: 'meta-description', severity: 'warning', message: 'Missing meta' });
  const infoIssue: SeoIssue = makeIssue({ check: 'og-tags', severity: 'info', message: 'Missing OG tags', category: 'social' });

  const pages: PageSeoResult[] = [
    makePage({ pageId: 'p-1', issues: [errorIssue, warnIssue] }),
    makePage({ pageId: 'p-2', page: 'About', slug: 'about', issues: [infoIssue] }),
  ];

  it('mode=all returns all issues from all pages', () => {
    const { items, keys } = selectIssuesForBatch({
      mode: 'all',
      pages,
      filteredPages: pages,
      severityFilter: 'all',
      categoryFilter: 'all',
      createdTasks: new Set(),
    });
    expect(items.length).toBe(3);
    expect(keys.length).toBe(3);
  });

  it('mode=errors returns only error-severity issues', () => {
    const { items } = selectIssuesForBatch({
      mode: 'errors',
      pages,
      filteredPages: pages,
      severityFilter: 'all',
      categoryFilter: 'all',
      createdTasks: new Set(),
    });
    expect(items.length).toBe(1);
    expect(items[0].priority).toBe('high');
  });

  it('mode=filtered respects the filteredPages input (not full pages)', () => {
    const filteredPages = [pages[1]]; // only the About page (info issue)
    const { items } = selectIssuesForBatch({
      mode: 'filtered',
      pages,
      filteredPages,
      severityFilter: 'all',
      categoryFilter: 'all',
      createdTasks: new Set(),
    });
    expect(items.length).toBe(1);
    expect(items[0].title).toContain('og-tags');
  });

  it('mode=filtered applies severityFilter within filteredPages', () => {
    const filteredPages = pages; // all pages in filtered view
    const { items } = selectIssuesForBatch({
      mode: 'filtered',
      pages,
      filteredPages,
      severityFilter: 'warning',
      categoryFilter: 'all',
      createdTasks: new Set(),
    });
    expect(items.length).toBe(1);
    expect(items[0].priority).toBe('medium');
  });

  it('mode=filtered applies categoryFilter within filteredPages', () => {
    const filteredPages = pages;
    const { items } = selectIssuesForBatch({
      mode: 'filtered',
      pages,
      filteredPages,
      severityFilter: 'all',
      categoryFilter: 'social',
      createdTasks: new Set(),
    });
    expect(items.length).toBe(1);
    expect(items[0].title).toContain('og-tags');
  });

  it('skips issues whose keys are already in createdTasks', () => {
    const alreadyCreated = new Set([issueToTaskKey(pages[0], errorIssue)]);
    const { items } = selectIssuesForBatch({
      mode: 'all',
      pages,
      filteredPages: pages,
      severityFilter: 'all',
      categoryFilter: 'all',
      createdTasks: alreadyCreated,
    });
    expect(items.length).toBe(2); // 3 total minus 1 already created
  });

  it('returns empty arrays when all issues are already created', () => {
    const allKeys = new Set(pages.flatMap(p => p.issues.map(i => issueToTaskKey(p, i))));
    const { items, keys } = selectIssuesForBatch({
      mode: 'all',
      pages,
      filteredPages: pages,
      severityFilter: 'all',
      categoryFilter: 'all',
      createdTasks: allKeys,
    });
    expect(items).toHaveLength(0);
    expect(keys).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Pure lib: applyClientSuppressions
// ══════════════════════════════════════════════════════════════════════════════

describe('applyClientSuppressions', () => {
  const data: SeoAuditResult = makeAuditResult({
    pages: [
      makePage({
        pageId: 'p-1',
        slug: 'home',
        issues: [
          makeIssue({ check: 'title', severity: 'error' }),
          makeIssue({ check: 'meta-description', severity: 'warning' }),
        ],
        score: 70,
      }),
      makePage({
        pageId: 'p-2',
        page: 'About',
        slug: 'about',
        issues: [makeIssue({ check: 'title', severity: 'error' })],
        score: 60,
      }),
    ],
    errors: 3,
    warnings: 1,
    infos: 0,
  });

  it('returns original data when suppressions array is empty', () => {
    const result = applyClientSuppressions(data, []);
    expect(result).toBe(data); // same reference — no copy
  });

  it('filters out an exact suppression match by check + pageSlug', () => {
    const result = applyClientSuppressions(data, [{ check: 'title', pageSlug: 'home' }]);
    const homePage = result.pages.find(p => p.slug === 'home')!;
    expect(homePage.issues.find(i => i.check === 'title')).toBeUndefined();
    // meta-description issue should still be present
    expect(homePage.issues.find(i => i.check === 'meta-description')).toBeDefined();
  });

  it('recalculates severity totals after suppression', () => {
    // Suppressing 1 error from home (title) — should reduce error count
    const result = applyClientSuppressions(data, [{ check: 'title', pageSlug: 'home' }]);
    expect(result.errors).toBeLessThan(data.errors);
  });

  it('does not affect pages that do not match the suppression', () => {
    const result = applyClientSuppressions(data, [{ check: 'title', pageSlug: 'home' }]);
    const aboutPage = result.pages.find(p => p.slug === 'about')!;
    expect(aboutPage.issues).toHaveLength(1);
  });

  it('applies glob pattern suppressions matching slug prefix', () => {
    // Suppress title check on all pages matching 'h*' — matches 'home'
    const result = applyClientSuppressions(data, [{ check: 'title', pageSlug: '', pagePattern: 'h*' }]);
    const homePage = result.pages.find(p => p.slug === 'home')!;
    expect(homePage.issues.find(i => i.check === 'title')).toBeUndefined();
    // about slug doesn't match 'h*'
    const aboutPage = result.pages.find(p => p.slug === 'about')!;
    expect(aboutPage.issues.find(i => i.check === 'title')).toBeDefined();
  });

  it('handles pattern that matches no pages gracefully', () => {
    // When a pattern matches nothing, all issues are preserved. However
    // applyClientSuppressions still does a full map pass (because suppSet.size===0
    // but patternMatchers is non-empty), so it returns a new object with
    // unchanged issue counts but recalculated siteScore.
    const result = applyClientSuppressions(data, [{ check: 'title', pageSlug: '', pagePattern: 'zzz*' }]);
    const totalErrors = result.pages.reduce((s, p) => s + p.issues.filter(i => i.severity === 'error').length, 0);
    const totalWarnings = result.pages.reduce((s, p) => s + p.issues.filter(i => i.severity === 'warning').length, 0);
    expect(totalErrors).toBe(2); // both pages still have their title error
    expect(totalWarnings).toBe(1); // home page still has meta-description warning
  });

  it('excludes noindex pages from siteScore calculation', () => {
    const noindexData: SeoAuditResult = {
      ...data,
      pages: [
        ...data.pages,
        makePage({ pageId: 'p-noindex', slug: 'noindex-page', noindex: true, score: 10, issues: [makeIssue()] }),
      ],
    };
    const result = applyClientSuppressions(noindexData, [{ check: 'title', pageSlug: 'home' }]);
    // siteScore should only reflect non-noindex pages
    const indexedPages = result.pages.filter(p => !p.noindex);
    const expectedScore = Math.round(indexedPages.reduce((s, p) => s + p.score, 0) / indexedPages.length);
    expect(result.siteScore).toBe(expectedScore);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SeoAudit component
// ══════════════════════════════════════════════════════════════════════════════

describe('SeoAudit component', () => {
  beforeEach(() => {
    backgroundTasksMock.jobs = [];
    backgroundTasksMock.activeJobs = [];
    backgroundTasksMock.startJob.mockReset();
    backgroundTasksMock.startJob.mockResolvedValue('job-1');
    getSafeMock.mockReset();
    getOptionalMock.mockReset();
    postMock.mockReset();
    putMock.mockReset();
    delMock.mockReset();
    getSafeMock.mockResolvedValue([]);
    getOptionalMock.mockResolvedValue(null);
    postMock.mockResolvedValue({});
    putMock.mockResolvedValue({});
    delMock.mockResolvedValue({});
  });

  it('renders the pre-run prompt with Run SEO Audit button', () => {
    render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    expect(screen.getByRole('button', { name: /Run SEO Audit/i })).toBeInTheDocument();
    // Multiple elements contain this text (subtitle + body copy); just verify at least one exists
    expect(screen.getAllByText(/Comprehensive SEO audit for your Webflow site/i).length).toBeGreaterThan(0);
  });

  it('renders the include dead link scan checkbox in pre-run state', () => {
    render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    expect(screen.getByText('Include dead link scan')).toBeInTheDocument();
  });

  it('loads latest snapshot and history through the SeoAudit workflow queries', async () => {
    render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(getOptionalMock).toHaveBeenCalledWith('/api/reports/site-1/latest?workspaceId=ws-1');
      expect(getSafeMock).toHaveBeenCalledWith('/api/reports/site-1/history?workspaceId=ws-1', []);
    });
  });

  it('starts seo-audit jobs with the current site, workspace, and dead-link setting', async () => {
    render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByText('Include dead link scan'));
    fireEvent.click(screen.getByRole('button', { name: /Run SEO Audit/i }));

    await waitFor(() => {
      expect(backgroundTasksMock.startJob).toHaveBeenCalledWith('seo-audit', {
        siteId: 'site-1',
        workspaceId: 'ws-1',
        skipLinkCheck: true,
      });
    });
  });

  it('uses recovered completed job data ahead of a divergent latest snapshot', async () => {
    backgroundTasksMock.jobs = [{
      id: 'job-done',
      type: 'seo-audit',
      status: 'done',
      workspaceId: 'ws-1',
      result: makeAuditResult({
        pages: [makePage({ page: 'Recovered Job Page', slug: 'job-page' })],
      }),
    }];
    getOptionalMock.mockResolvedValueOnce({
      id: 'snap-old',
      audit: makeAuditResult({
        pages: [makePage({ page: 'Old Snapshot Page', slug: 'old-page' })],
      }),
    });

    const { findByText, queryByText } = render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    expect(await findByText('Recovered Job Page')).toBeInTheDocument();
    expect(queryByText('Old Snapshot Page')).not.toBeInTheDocument();
  });

  it('recovers an in-flight seo-audit job in the loading state', async () => {
    backgroundTasksMock.jobs = [{
      id: 'job-running',
      type: 'seo-audit',
      status: 'running',
      workspaceId: 'ws-1',
      progress: 1,
      total: 4,
      message: 'Scanning pages...',
    }];

    render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    expect(await screen.findByText('Scanning pages...')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('renders tracked job completion, shows next steps, and invalidates audit reads', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    backgroundTasksMock.jobs = [{
      id: 'job-running',
      type: 'seo-audit',
      status: 'running',
      workspaceId: 'ws-1',
      progress: 1,
      total: 4,
      message: 'Scanning pages...',
    }];

    const { rerender } = render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper(queryClient) });
    expect(await screen.findByText('Scanning pages...')).toBeInTheDocument();

    backgroundTasksMock.jobs = [{
      id: 'job-running',
      type: 'seo-audit',
      status: 'done',
      workspaceId: 'ws-1',
      result: makeAuditResult({
        pages: [makePage({ page: 'Fresh Job Page', slug: 'fresh-job-page' })],
      }),
    }];
    rerender(<SeoAudit siteId="site-1" workspaceId="ws-1" />);

    expect(await screen.findByText('Fresh Job Page')).toBeInTheDocument();
    expect(screen.getByText(/Audit complete:/)).toBeInTheDocument();
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.admin.auditAll() });
    });
  });

  it('renders tracked job errors after loading clears', async () => {
    backgroundTasksMock.jobs = [{
      id: 'job-running',
      type: 'seo-audit',
      status: 'running',
      workspaceId: 'ws-1',
      message: 'Scanning pages...',
    }];

    const { rerender } = render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });
    expect(await screen.findByText('Scanning pages...')).toBeInTheDocument();

    backgroundTasksMock.jobs = [{
      id: 'job-running',
      type: 'seo-audit',
      status: 'error',
      workspaceId: 'ws-1',
      error: 'Audit service unavailable',
    }];
    rerender(<SeoAudit siteId="site-1" workspaceId="ws-1" />);

    expect(await screen.findByText('SEO Audit Failed')).toBeInTheDocument();
    expect(screen.getByText('Audit service unavailable')).toBeInTheDocument();
  });

  it('renders the sub-tab navigation bar', () => {
    render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    expect(screen.getByRole('button', { name: /Site Audit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /History/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Content Health/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI Search Ready/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guide/i })).toBeInTheDocument();
  });

  it('switches to history sub-tab when History button is clicked', () => {
    render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole('button', { name: /History/i }));
    expect(screen.getByTestId('audit-history')).toBeInTheDocument();
  });

  it('switches to guide sub-tab when Guide button is clicked', () => {
    render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole('button', { name: /Guide/i }));
    expect(screen.getByTestId('seo-audit-guide')).toBeInTheDocument();
  });

  it('renders audit summary cards when audit data is loaded via getOptional snapshot', async () => {
    const auditResult = makeAuditResult({
      siteScore: 85,
      totalPages: 3,
      errors: 1,
      warnings: 2,
      infos: 0,
    });
    getOptionalMock.mockResolvedValueOnce({ id: 'snap-2', audit: auditResult });

    const { findByText } = render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    // Site Score stat card should be visible
    expect(await findByText('Site Score')).toBeInTheDocument();
    expect(screen.getByText('Pages Scanned')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('Warnings')).toBeInTheDocument();
  });

  it('shows page rows when audit data is loaded via getOptional snapshot', async () => {
    const auditResult = makeAuditResult({
      siteScore: 90,
      totalPages: 1,
      errors: 1,
      warnings: 0,
      pages: [makePage({ page: 'Home Page', slug: 'home-page' })],
    });
    getOptionalMock.mockResolvedValueOnce({ id: 'snap-1', audit: auditResult });

    const { findByText } = render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    // The page name should appear in the page list
    expect(await findByText('Home Page')).toBeInTheDocument();
  });

  it('renders the audit toolbar and batch actions when data is present via snapshot', async () => {
    const auditResult = makeAuditResult();
    getOptionalMock.mockResolvedValueOnce({ id: 'snap-1', audit: auditResult });

    const { findByTestId } = render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    expect(await findByTestId('audit-toolbar')).toBeInTheDocument();
    expect(await findByTestId('audit-batch-actions')).toBeInTheDocument();
  });

  it('renders ScheduledAuditSettings when workspaceId is provided and data loaded', async () => {
    getOptionalMock.mockResolvedValueOnce({ id: 'snap-1', audit: makeAuditResult() });

    const { findByTestId } = render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    expect(await findByTestId('scheduled-audit-settings')).toBeInTheDocument();
  });

  it('does not render ScheduledAuditSettings when workspaceId is absent', async () => {
    getOptionalMock.mockResolvedValueOnce({ id: 'snap-1', audit: makeAuditResult() });

    const { queryByTestId, findByText } = render(<SeoAudit siteId="site-1" />, { wrapper: makeWrapper() });

    // Wait for data to load
    await findByText('Site Score');
    expect(queryByTestId('scheduled-audit-settings')).not.toBeInTheDocument();
  });

  it('expands a page row to show issues when clicked', async () => {
    const auditResult = makeAuditResult({
      pages: [makePage({ page: 'Home', slug: 'home', issues: [makeIssue({ message: 'Missing page title' })] })],
    });
    getOptionalMock.mockResolvedValueOnce({ id: 'snap-1', audit: auditResult });

    const { findByText, getByText } = render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    // Wait for page row to appear then click it
    const homeRow = await findByText('Home');
    fireEvent.click(homeRow.closest('[class*="ClickableRow"], button, [role="button"]') || homeRow.parentElement!);

    // Issue row should now appear
    expect(getByText('Missing page title')).toBeInTheDocument();
  });

  it('renders site-wide issues section when siteWideIssues is non-empty', async () => {
    const auditResult = makeAuditResult({
      siteWideIssues: [makeIssue({ message: 'Site-wide canonical issue', severity: 'warning' })],
    });
    getOptionalMock.mockResolvedValueOnce({ id: 'snap-1', audit: auditResult });

    const { findByText } = render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    expect(await findByText('Site-Wide Issues')).toBeInTheDocument();
    expect(await findByText('Site-wide canonical issue')).toBeInTheDocument();
  });

  it('renders the dead link panel when deadLinkDetails present', async () => {
    const auditResult = makeAuditResult({
      deadLinkDetails: [
        {
          url: 'https://dead.example.com',
          status: 404,
          statusText: 'Not Found',
          foundOn: 'https://example.com/home',
          foundOnSlug: 'home',
          anchorText: 'Click here',
          type: 'external',
        },
      ],
    });
    getOptionalMock.mockResolvedValueOnce({ id: 'snap-1', audit: auditResult });

    const { findByTestId } = render(<SeoAudit siteId="site-1" workspaceId="ws-1" />, { wrapper: makeWrapper() });

    expect(await findByTestId('dead-link-panel')).toBeInTheDocument();
  });

  it('renders without crashing when no workspaceId is provided', () => {
    expect(() =>
      render(<SeoAudit siteId="site-1" />, { wrapper: makeWrapper() }),
    ).not.toThrow();
  });

  it('renders without crashing when all props are provided', () => {
    expect(() =>
      render(<SeoAudit siteId="site-1" workspaceId="ws-1" siteName="Acme Corp" />, { wrapper: makeWrapper() }),
    ).not.toThrow();
  });
});
