import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
const mockAcceptAll = vi.fn(async () => undefined);

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
  AuditHistory: () => <div data-testid="legacy-site-audit-history-view">Legacy Audit History</div>,
}));
vi.mock('../../../src/components/audit/SeoAuditGuide', () => ({
  SeoAuditGuide: () => <div data-testid="site-audit-guide-view">SEO Audit Guide</div>,
}));
vi.mock('../../../src/components/AeoReview', () => ({
  default: () => <div data-testid="site-audit-aeo-view">AI Search Ready</div>,
}));
vi.mock('../../../src/components/ContentDecay', () => ({
  default: () => <div data-testid="site-audit-content-decay-view">Decaying pages diagnostic</div>,
}));
vi.mock('../../../src/components/audit/ActionItemsPanel', () => ({
  ActionItemsPanel: () => <div data-testid="site-audit-actions-panel" />,
}));
vi.mock('../../../src/components/audit/BulkAcceptPanel', () => ({
  BulkAcceptPanel: ({ onRegisterHandlers }: { onRegisterHandlers: (handlers: { acceptAll: () => Promise<void>; cancel: () => void }) => void }) => {
    onRegisterHandlers({ acceptAll: mockAcceptAll, cancel: () => undefined });
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
  cwvSummary: {
    mobile: {
      assessment: 'needs-improvement',
      fieldDataAvailable: true,
      lighthouseScore: 76,
      metrics: {
        LCP: { value: 2800, rating: 'needs-improvement' },
        INP: { value: 190, rating: 'good' },
        CLS: { value: 0.08, rating: 'good' },
      },
    },
    desktop: {
      assessment: 'good',
      fieldDataAvailable: false,
      lighthouseScore: 91,
      metrics: {
        LCP: { value: 1800, rating: 'good' },
        INP: { value: 130, rating: 'good' },
        CLS: { value: 0.04, rating: 'good' },
      },
    },
  },
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
          <LocationProbe />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <span data-testid="location-pathname">{location.pathname}</span>
      <span data-testid="location-search">{location.search}</span>
    </>
  );
}

function expectTextWithClass(text: string | RegExp, className: string) {
  const matches = screen.getAllByText(text);
  expect(matches.some((element) => element.classList.contains(className))).toBe(true);
}

function auditModeSwitcher() {
  return within(screen.getByRole('toolbar', { name: 'Site Audit lenses' }));
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
    ['/ws/ws-1/seo-audit?sub=history', 'site-audit-history-compact'],
  ])('renders peer mode for %s', async (entry, testId) => {
    renderSurface(entry);
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
  });

  it.each([
    ['/ws/ws-1/seo-audit?sub=aeo-review', 'AI Search Ready', 'site-audit-aeo-view'],
    ['/ws/ws-1/seo-audit?sub=content-decay', 'Decaying pages', 'site-audit-content-decay-view'],
    ['/ws/ws-1/seo-audit?sub=guide', 'Audit Guide', 'site-audit-guide-view'],
  ])('opens the in-flow %s receiver for compatibility deep link %s', async (entry, summary, testId) => {
    renderSurface(entry);

    expect(await screen.findByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();
    const receiver = await screen.findByTestId(testId);
    expect(receiver).toBeInTheDocument();
    expect(auditModeSwitcher().getAllByRole('radio')).toHaveLength(2);
    expect(auditModeSwitcher().getByRole('radio', { name: /Site Audit/ })).toHaveAttribute('aria-checked', 'true');
    expect(receiver.closest('details')).toHaveTextContent(summary);
    expect(receiver.closest('details')).toHaveAttribute('open');
  });

  it('keeps compatibility evidence available while an audit is running', async () => {
    const audit = makeAuditState();
    mockUseSiteAuditRebuilt.mockReturnValue({
      ...audit,
      workflow: {
        ...audit.workflow,
        loading: true,
        runningAuditJob: {
          message: 'Crawling site pages...',
          progress: 4,
          total: 10,
        },
      },
    });

    renderSurface('/ws/ws-1/seo-audit?sub=aeo-review');

    expect(await screen.findByText('Crawling site pages...')).toBeInTheDocument();
    expect(screen.getByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();
    const receiver = screen.getByTestId('site-audit-aeo-view');
    expect(receiver.closest('details')).toHaveAttribute('open');
    expect(screen.getAllByTestId('site-audit-aeo-view')).toHaveLength(1);
    expect(screen.getAllByTestId('site-audit-content-decay-view')).toHaveLength(1);
    expect(screen.getAllByTestId('site-audit-guide-view')).toHaveLength(1);
  });

  it('falls back to audit for an invalid sub param', async () => {
    renderSurface('/ws/ws-1/seo-audit?sub=unknown');
    expect(await screen.findByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();
  });

  it('keeps each supporting diagnostic reachable once inside Site Audit', async () => {
    renderSurface('/ws/ws-1/seo-audit');

    expect(await screen.findByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();
    expect(screen.getAllByTestId('site-audit-aeo-view')).toHaveLength(1);
    expect(screen.getAllByTestId('site-audit-content-decay-view')).toHaveLength(1);
    expect(screen.getAllByTestId('site-audit-guide-view')).toHaveLength(1);
  });

  it('writes prototype sub state and clears the default audit URL', async () => {
    renderSurface('/ws/ws-1/seo-audit');
    expect(await screen.findByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toHaveTextContent('');
    expect(auditModeSwitcher().getAllByRole('radio')).toHaveLength(2);
    expect(auditModeSwitcher().getByRole('radio', { name: /Site Audit/ })).toHaveAttribute('aria-checked', 'true');
    expect(auditModeSwitcher().queryByRole('radio', { name: /AI Search Ready|Decaying pages|Guide/ })).not.toBeInTheDocument();

    fireEvent.click(auditModeSwitcher().getByRole('radio', { name: /History/ }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('?sub=history');
    expect(await screen.findByTestId('site-audit-history-compact')).toBeInTheDocument();

    fireEvent.click(auditModeSwitcher().getByRole('radio', { name: /Site Audit/ }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('');
    expect(await screen.findByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();
  });

  it('follows the prototype decision order inside a centered audit canvas', async () => {
    renderSurface('/ws/ws-1/seo-audit?sub=audit');

    await screen.findByTestId('site-audit-rebuilt-audit');
    const surface = screen.getByTestId('site-audit-rebuilt-surface');
    expect(surface).toHaveClass('max-w-[1120px]');

    const orderedSections = [
      'site-audit-context',
      'site-audit-lenses',
      'site-audit-hero',
      'site-audit-categories',
      'site-audit-cwv',
      'site-audit-bulk-actions',
      'site-audit-broken-links',
      'site-audit-issues',
      'site-audit-support',
    ].map((testId) => screen.getByTestId(testId));

    orderedSections.slice(1).forEach((section, index) => {
      expect(orderedSections[index].compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    expect(within(screen.getByTestId('site-audit-categories')).getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringContaining('Indexability'),
      expect.stringContaining('On-page'),
      expect.stringContaining('Performance'),
      expect.stringContaining('Structured data'),
      expect.stringContaining('Links'),
      expect.stringContaining('Mobile'),
    ]);
  });

  it('bounds the loaded audit to one workbench collection with decision controls pinned', async () => {
    renderSurface('/ws/ws-1/seo-audit?sub=audit');

    await screen.findByTestId('site-audit-rebuilt-audit');
    const frame = screen.getByTestId('workbench-frame');
    expect(frame).toHaveStyle({
      display: 'flex',
      flex: '0 0 auto',
      height: 'calc(100vh - var(--shell-topbar) - var(--page-pad-y) - var(--page-pad-bottom))',
      maxHeight: 'calc(100vh - var(--shell-topbar) - var(--page-pad-y) - var(--page-pad-bottom))',
    });

    const pinned = screen.getByTestId('workbench-pinned');
    expect(within(pinned).getByTestId('site-audit-hero')).toBeInTheDocument();
    expect(within(pinned).getByTestId('site-audit-categories')).toBeInTheDocument();
    expect(within(pinned).getByTestId('site-audit-bulk-actions')).toBeInTheDocument();

    const collections = frame.querySelectorAll('[data-workbench-collection]');
    expect(collections).toHaveLength(1);
    expect(collections[0]).toHaveClass('min-h-0', 'flex-1', 'overflow-auto');
    expect(collections[0]).toHaveStyle({ flex: '1 1 0%', minHeight: 0, overflow: 'auto' });
    expect(within(collections[0] as HTMLElement).getByTestId('site-audit-issues')).toBeInTheDocument();
  });

  it('uses the compact local history composition instead of the legacy shared view', async () => {
    renderSurface('/ws/ws-1/seo-audit?sub=history');

    const history = await screen.findByTestId('site-audit-history-compact');
    expect(history).toHaveTextContent('Audit History');
    expect(history).toHaveTextContent('1 snapshot');
    expect(screen.queryByTestId('legacy-site-audit-history-view')).not.toBeInTheDocument();
  });

  it('opens schedule and issue detail drawers exactly once', async () => {
    renderSurface('/ws/ws-1/seo-audit');
    expect(await screen.findByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Schedule/ }));
    expect(screen.getByRole('dialog', { name: /Scheduled Audits/ })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expectTextWithClass('Enabled schedules run in the background and reuse the same snapshot history.', 't-body');
    expectTextWithClass('Run every', 't-label');
    expectTextWithClass('Alert on score drop', 't-label');
    expectTextWithClass('Schedules are additive to manual runs. Operators can still run an on-demand audit at any time.', 't-body');

    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Missing title'));
    expect(screen.getByRole('dialog', { name: 'title' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByText('Affected pages')).toBeInTheDocument();
    expectTextWithClass('Recommendation', 't-ui');
    expectTextWithClass('Add a specific page title.', 't-body');
    expectTextWithClass('Send to client', 't-ui');
    expectTextWithClass('Affected pages', 't-ui');
    expectTextWithClass('Home', 't-ui');
  });

  it('states the first-page action scope and the filter-selective batch semantics in the issue drawer', async () => {
    const audit = makeAuditState();
    const titleGroup = issueGroups[0];
    const additionalPages = [
      { ...sampleAudit.pages[0], pageId: 'page-about', page: 'About', slug: 'about', url: '/about' },
      { ...sampleAudit.pages[0], pageId: 'page-contact', page: 'Contact', slug: 'contact', url: '/contact' },
    ];
    const threePageGroup: AuditIssueGroup = {
      ...titleGroup,
      affectedPages: 3,
      instances: [
        titleGroup.instances[0],
        ...additionalPages.map((page) => ({
          id: `${page.pageId}-title-Missing title`,
          page,
          issue: page.issues[0],
        })),
      ],
    };
    mockUseSiteAuditRebuilt.mockReturnValue({
      ...audit,
      issueGroups: [threePageGroup, issueGroups[1]],
    });

    renderSurface('/ws/ws-1/seo-audit');
    fireEvent.click(await screen.findByText('Missing title'));

    const drawer = screen.getByRole('dialog', { name: 'title' });
    const actions = within(drawer).getByTestId('site-audit-issue-actions');
    expect(within(actions).getByText('Applies to /home only')).toBeVisible();
    expect(within(actions).getByRole('button', { name: 'Accept suggestion' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Send to client' })).toBeInTheDocument();
    expect(within(drawer).getByText(
      'Add visible tasks uses the current table filters. Add error tasks, Add all tasks, and Accept all use the full audit.',
    )).toBeVisible();
  });

  it('confirms the real live-site consequences before accepting all fixes', async () => {
    renderSurface('/ws/ws-1/seo-audit');

    fireEvent.click(await screen.findByRole('button', { name: 'Accept all 1' }));

    const dialog = screen.getByRole('dialog', { name: 'Apply AI fixes to the live Webflow site?' });
    expect(within(dialog).getByText(/up to 1 AI-suggested fix/i)).toBeVisible();
    expect(within(dialog).getByText(/titles, meta descriptions, and page fields/i)).toBeVisible();
    expect(within(dialog).getByText(/marks those pages live/i)).toBeVisible();
    expect(within(dialog).getByText(/fewer than 1 may change/i)).toBeVisible();
    expect(within(dialog).getByText(/cannot be bulk-undone/i)).toBeVisible();
    expect(mockAcceptAll).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to live site' }));

    await waitFor(() => expect(mockAcceptAll).toHaveBeenCalledTimes(1));
    expect(mockAcceptAll).toHaveBeenCalledWith();
  });

  it('cancels Accept all without applying any fixes', async () => {
    renderSurface('/ws/ws-1/seo-audit');

    fireEvent.click(await screen.findByRole('button', { name: 'Accept all 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Apply AI fixes to the live Webflow site?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Apply AI fixes to the live Webflow site?' })).not.toBeInTheDocument();
    expect(mockAcceptAll).not.toHaveBeenCalled();
  });

  it('uses styleguide roles for the audit decision console', async () => {
    renderSurface('/ws/ws-1/seo-audit');

    expect(await screen.findByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();
    expectTextWithClass(/1 critical issue needs attention first\./i, 't-ui');
    expectTextWithClass('Missing title', 't-ui');
    expectTextWithClass('Add a specific page title.', 't-caption');
    expectTextWithClass('Showing 2 of 2 groups', 't-caption-sm');
    expectTextWithClass('From fix to proof', 't-ui');
    expectTextWithClass(/Technical fixes stay in Site Audit and Cockpit until traffic, crawlability, or Core Web Vitals recovery is measurable./i, 't-body');
  });

  it('reports warnings and notices separately from their shared source counts', async () => {
    const audit = makeAuditState();
    const auditWithNotices = { ...sampleAudit, warnings: 4, infos: 3 };
    mockUseSiteAuditRebuilt.mockReturnValue({
      ...audit,
      data: auditWithNotices,
      rawData: auditWithNotices,
      workflow: { ...audit.workflow, data: auditWithNotices },
    });

    renderSurface('/ws/ws-1/seo-audit');

    const hero = await screen.findByTestId('site-audit-hero');
    expect(hero).toHaveTextContent('4 warnings');
    expect(hero).toHaveTextContent('3 notices');
    expect(hero).not.toHaveTextContent(/7 (?:more )?warnings/i);
  });

  it('hands source image repair to Asset Manager with canonical filter URLs', async () => {
    renderSurface('/ws/ws-1/seo-audit');

    expect(await screen.findByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();
    expect(screen.getByText('Site Audit detects site issues. Asset Manager repairs source images.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review oversized images' }));
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/ws/ws-1/media');
    expect(screen.getByTestId('location-search')).toHaveTextContent('?filter=oversized');

    fireEvent.click(screen.getByRole('button', { name: 'Review missing alt text' }));
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/ws/ws-1/media');
    expect(screen.getByTestId('location-search')).toHaveTextContent('?filter=missing-alt');
  });

  it('hands decaying pages to the canonical Content Health tab', async () => {
    renderSurface('/ws/ws-1/seo-audit?sub=content-decay');

    expect(await screen.findByText('Decaying pages')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View in Content Pipeline' }));

    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/ws/ws-1/content-pipeline');
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=content-health');
  });

  it('opens Workspace Settings Connections from the no-site setup state', async () => {
    const audit = makeAuditState();
    mockUseSiteAuditRebuilt.mockReturnValue({ ...audit, siteId: '' });
    renderSurface();

    expect(await screen.findByText('Connect a Webflow site first')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Workspace Settings' }));

    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/ws/ws-1/workspace-settings');
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=connections');
  });

  it('keeps internal rebuild and migration language out of the visible audit shell', async () => {
    const { container } = renderSurface('/ws/ws-1/seo-audit?sub=audit');
    expect(await screen.findByTestId('site-audit-rebuilt-audit')).toBeInTheDocument();

    expect(container).not.toHaveTextContent(/receiver|subview|\bT1\b|carry-over|mounted below|legacy alias|rebuild|migration|URL state|route tab/i);
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
