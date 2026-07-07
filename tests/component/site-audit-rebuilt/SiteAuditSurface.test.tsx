import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SiteAuditSurface } from '../../../src/components/site-audit-rebuilt/SiteAuditSurface';
import { ToastProvider } from '../../../src/components/Toast';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { expectNoA11yViolations } from '../a11y';
import type { AuditIssueGroup, SiteAuditResult } from '../../../src/hooks/admin/useSiteAuditRebuilt';

const mockRunAudit = vi.fn();
const mockSetSkipLinkCheck = vi.fn();
const mockRefreshAuditHistory = vi.fn();
const mockSaveSchedule = vi.fn();
const mockUseSiteAuditRebuilt = vi.fn();

vi.mock('../../../src/hooks/admin/useSiteAuditRebuilt', async () => {
  const actual = await vi.importActual<typeof import('../../../src/hooks/admin/useSiteAuditRebuilt')>(
    '../../../src/hooks/admin/useSiteAuditRebuilt',
  );
  return {
    ...actual,
    useSiteAuditRebuilt: () => mockUseSiteAuditRebuilt(),
  };
});

vi.mock('../../../src/components/audit/AuditHistory', () => ({
  AuditHistory: () => <div data-testid="site-audit-history-view">Audit History</div>,
}));
vi.mock('../../../src/components/audit/SeoAuditGuide', () => ({
  SeoAuditGuide: () => <div data-testid="site-audit-guide-view">SEO Audit Guide</div>,
}));
vi.mock('../../../src/components/AeoReview', () => ({
  default: () => <div data-testid="site-audit-aeo-view">AI Search Ready</div>,
}));
vi.mock('../../../src/components/ContentDecay', () => ({
  default: () => <div data-testid="site-audit-content-decay-view">Content Health diagnostic</div>,
}));
vi.mock('../../../src/components/audit/ActionItemsPanel', () => ({
  ActionItemsPanel: () => <div data-testid="site-audit-actions-panel" />,
}));
vi.mock('../../../src/components/audit/BulkAcceptPanel', () => ({
  BulkAcceptPanel: ({ onRegisterHandlers }: { onRegisterHandlers: (handlers: { acceptAll: () => Promise<void>; cancel: () => void }) => void }) => {
    onRegisterHandlers({ acceptAll: async () => undefined, cancel: () => undefined });
    return <div data-testid="site-audit-bulk-panel" />;
  },
}));
vi.mock('../../../src/components/audit/DeadLinkPanel', () => ({
  DeadLinkPanel: () => <div data-testid="site-audit-dead-links-panel">Broken Links</div>,
}));
vi.mock('../../../src/components/audit/AuditReportExport', () => ({
  ReportModal: () => <div data-testid="site-audit-report-modal" />,
  ReportViewer: () => <div data-testid="site-audit-report-viewer" />,
}));

vi.mock('../../../src/api/misc', () => ({
  featureFlags: {
    list: () => Promise.resolve({ 'ui-rebuild-shell': true }),
  },
}));

const sampleAudit: SiteAuditResult = {
  siteScore: 78,
  totalPages: 2,
  errors: 1,
  warnings: 1,
  infos: 0,
  pages: [
    {
      pageId: 'page-home',
      page: 'Home',
      slug: 'home',
      url: '/home',
      score: 72,
      issues: [
        {
          check: 'title',
          severity: 'error',
          category: 'content',
          displayCategory: 'onpage',
          message: 'Missing title',
          recommendation: 'Add a specific page title.',
          suggestedFix: 'Acme SEO Services',
        },
      ],
    },
    {
      pageId: 'page-services',
      page: 'Services',
      slug: 'services',
      url: '/services',
      score: 88,
      issues: [
        {
          check: 'structured-data',
          severity: 'warning',
          category: 'technical',
          displayCategory: 'schema',
          message: 'Schema missing',
          recommendation: 'Add structured data to the page.',
        },
      ],
    },
  ],
  siteWideIssues: [],
  deadLinkDetails: [
    {
      url: '/old',
      status: 404,
      statusText: 'Not found',
      foundOn: 'Home',
      foundOnSlug: 'home',
      anchorText: 'Old link',
      type: 'internal',
    },
  ],
  categoryScoreVersion: 1,
  categoryScores: [],
};

const issueGroups: AuditIssueGroup[] = [
  {
    id: 'title::error::onpage::Missing title::Add a specific page title.',
    check: 'title',
    message: 'Missing title',
    recommendation: 'Add a specific page title.',
    severity: 'error',
    displayCategory: 'onpage',
    categoryLabel: 'On-page',
    suggestedFix: 'Acme SEO Services',
    affectedPages: 1,
    traffic: { clicks: 24, impressions: 120, sessions: 10, pageviews: 18 },
    instances: [{ id: 'page-home-title-Missing title', page: sampleAudit.pages[0], issue: sampleAudit.pages[0].issues[0] }],
  },
  {
    id: 'structured-data::warning::schema::Schema missing::Add structured data to the page.',
    check: 'structured-data',
    message: 'Schema missing',
    recommendation: 'Add structured data to the page.',
    severity: 'warning',
    displayCategory: 'schema',
    categoryLabel: 'Schema',
    affectedPages: 1,
    traffic: { clicks: 8, impressions: 50, sessions: 5, pageviews: 7 },
    instances: [{ id: 'page-services-structured-data-Schema missing', page: sampleAudit.pages[1], issue: sampleAudit.pages[1].issues[0] }],
  },
];

function makeAuditState() {
  return {
    workspace: { id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1', webflowSiteName: 'Acme Site' },
    workspaces: { data: [], isLoading: false, isError: false, refetch: vi.fn() },
    siteId: 'site-1',
    siteName: 'Acme Site',
    workflow: {
      data: sampleAudit,
      loading: false,
      hasRun: true,
      history: [{ id: 'snap-1', createdAt: '2026-07-01T12:00:00.000Z', siteScore: 78, totalPages: 2, errors: 1, warnings: 1, infos: 0 }],
      auditError: null,
      showNextSteps: false,
      setShowNextSteps: vi.fn(),
      skipLinkCheck: false,
      setSkipLinkCheck: mockSetSkipLinkCheck,
      runAudit: mockRunAudit,
      refreshAuditHistory: mockRefreshAuditHistory,
      runningAuditJob: null,
    },
    traffic: { data: { '/home': { clicks: 24, impressions: 120, sessions: 10, pageviews: 18 } } },
    suppressions: [],
    schedule: { data: { enabled: false, intervalDays: 7, scoreDropThreshold: 5 }, isLoading: false },
    pageStates: {
      summary: { clean: 0, issueDetected: 0, fixProposed: 0, inReview: 0, approved: 0, rejected: 0, live: 0, total: 0 },
    },
    data: sampleAudit,
    rawData: sampleAudit,
    categoryScores: [
      { category: 'index', label: 'Indexing', score: 100, denominatorPages: 2, affectedPages: 0, errors: 0, warnings: 0, infos: 0 },
      { category: 'onpage', label: 'On-page', score: 85, denominatorPages: 2, affectedPages: 1, errors: 1, warnings: 0, infos: 0 },
      { category: 'schema', label: 'Schema', score: 90, denominatorPages: 2, affectedPages: 1, errors: 0, warnings: 1, infos: 0 },
      { category: 'links', label: 'Links', score: 100, denominatorPages: 2, affectedPages: 0, errors: 0, warnings: 0, infos: 0 },
      { category: 'perf', label: 'Performance', score: 100, denominatorPages: 2, affectedPages: 0, errors: 0, warnings: 0, infos: 0 },
      { category: 'mobile', label: 'Mobile UX', score: 100, denominatorPages: 2, affectedPages: 0, errors: 0, warnings: 0, infos: 0 },
    ],
    issueGroups,
    filterIssueGroups: (groups: AuditIssueGroup[]) => groups,
    createdTasks: new Set<string>(),
    creatingTask: null,
    batchCreating: false,
    batchResult: null,
    applyingFix: null,
    appliedFixes: new Set<string>(),
    setAppliedFixes: vi.fn(),
    editedSuggestions: {},
    setEditedSuggestions: vi.fn(),
    flaggedIssues: new Set<string>(),
    flagSending: false,
    savingReport: false,
    shareUrl: null,
    setShareUrl: vi.fn(),
    scheduleSaving: false,
    suppressIssue: vi.fn(),
    unsuppressIssue: vi.fn(),
    suppressPattern: vi.fn(),
    unsuppressAll: vi.fn(),
    acceptSuggestion: vi.fn(),
    openQuickFix: vi.fn(),
    openDeadLinks: vi.fn(),
    createTaskFromIssue: vi.fn(),
    batchCreateTasks: vi.fn(async () => 1),
    flagForClient: vi.fn(),
    saveAndShare: vi.fn(async () => 'https://example.test/report/snap-1'),
    saveSchedule: mockSaveSchedule.mockResolvedValue({ enabled: true, intervalDays: 7, scoreDropThreshold: 5 }),
  };
}

function renderSurface(initialEntry = '/ws/ws-1/seo-audit') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <SiteAuditSurface workspaceId="ws-1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function FlaggedHarness() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <SiteAuditSurface workspaceId="ws-1" /> : <div data-testid="flag-off" />;
}

describe('SiteAuditSurface rebuilt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSiteAuditRebuilt.mockReturnValue(makeAuditState());
  });

  it.each([
    ['/ws/ws-1/seo-audit?sub=audit', 'site-audit-rebuilt-audit'],
    ['/ws/ws-1/seo-audit?sub=history', 'site-audit-history-view'],
    ['/ws/ws-1/seo-audit?sub=aeo-review', 'site-audit-aeo-view'],
    ['/ws/ws-1/seo-audit?sub=content-decay', 'site-audit-content-decay-view'],
    ['/ws/ws-1/seo-audit?sub=guide', 'site-audit-guide-view'],
  ])('renders receiver subview for %s', async (entry, testId) => {
    renderSurface(entry);
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
  });

  it('falls back to audit for an invalid sub param', async () => {
    renderSurface('/ws/ws-1/seo-audit?sub=unknown');
    expect(await screen.findByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();
  });

  it('mounts behind a real useFeatureFlag loading to loaded transition', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ws/ws-1/seo-audit']}>
          <ToastProvider>
            <FlaggedHarness />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('site-audit-rebuilt-surface')).toBeInTheDocument();
    });
  });

  it('meets the rebuilt a11y floor after animate-pulse settles', async () => {
    const { container } = renderSurface('/ws/ws-1/seo-audit?sub=audit');
    await screen.findByTestId('site-audit-rebuilt-audit');
    await waitFor(() => expect(container.querySelectorAll('.animate-pulse').length).toBe(0));
    await expectNoA11yViolations(container);
  });
});
