// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { ToastProvider } from '../../../src/components/Toast';
import { SeoEditorSurface } from '../../../src/components/seo-editor-rebuilt/SeoEditorSurface';
import { SeoEditorPagePanel } from '../../../src/components/seo-editor-rebuilt/SeoEditorPagePanel';
import { useSeoEditorSurfaceState } from '../../../src/components/seo-editor-rebuilt/useSeoEditorSurfaceState';
import { SEO_EDITOR_TARGET_TYPES } from '../../../shared/types/seo-editor-write-target';
import type {
  CmsSeoWorkflowState,
  SeoEditorSurfaceRow,
  StaticSeoBulkWorkflowState,
  StaticSeoWorkflowState,
} from '../../../src/components/seo-editor-rebuilt/seoEditorSurfaceTypes';
import { expectNoA11yViolations } from '../a11y';

const refetchAllMock = vi.fn();
const saveStaticPageMock = vi.fn();
const saveStaticTitleMock = vi.fn();
const saveCmsItemMock = vi.fn();
const publishCmsCollectionMock = vi.fn();
const sendStaticPageMock = vi.fn();
const cmsSendForApprovalMock = vi.fn();
const featureFlagsListMock = vi.fn();

const workspace = {
  id: 'ws-1',
  name: 'Acme',
  webflowSiteId: 'site-1',
  webflowSiteName: 'acme.com',
  folder: 'acme',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staticRow: SeoEditorSurfaceRow = {
  id: 'page-1',
  target: {
    id: 'page-1',
    targetType: SEO_EDITOR_TARGET_TYPES.staticPage,
    pageId: 'page-1',
    title: 'Services',
    canonicalPath: '/services',
    rawSlug: 'services',
    sourceLabel: 'Static page',
    seo: { title: 'Services SEO', description: 'Book local services.' },
    capabilities: { canSave: true, canPublish: true, canSendToClient: true, canAnalyze: true, canBulkRewrite: true },
  },
  staticPage: {
    id: 'page-1',
    title: 'Services',
    slug: 'services',
    publishedPath: '/services',
    source: 'static',
    seo: { title: 'Services SEO', description: 'Book local services.' },
  },
  edit: { seoTitle: 'Services SEO', seoDescription: 'Book local services.', dirty: true },
  pageState: { status: 'fix-proposed' },
  recommendations: [{ id: 'rec-1', type: 'metadata', title: 'Short title', insight: 'Title needs more intent.', trafficAtRisk: 12, estimatedGain: '20 clicks', priority: 'fix_now' }],
  keywordAssignment: { primaryKeyword: 'local services', secondaryKeywords: ['service company'] },
  metrics: { optimizationScore: 82, rank: 4, traffic: 120, lastEditedAt: '2026-07-01T00:00:00.000Z' },
  dirty: true,
  missingTitle: false,
  missingDescription: false,
};

const cmsRow: SeoEditorSurfaceRow = {
  id: 'item-1',
  target: {
    id: 'item-1',
    targetType: SEO_EDITOR_TARGET_TYPES.cmsItem,
    itemId: 'item-1',
    collectionId: 'collection-1',
    collectionName: 'Blog',
    collectionSlug: 'blog',
    title: 'CMS Post',
    canonicalPath: '/blog/cms-post',
    rawSlug: 'cms-post',
    sourceLabel: 'Blog',
    seo: { title: 'CMS SEO', description: 'CMS description.' },
    titleFieldSlug: 'seo-title',
    descriptionFieldSlug: 'seo-description',
    capabilities: { canSave: true, canPublish: true, canSendToClient: true, canAnalyze: false, canBulkRewrite: true },
  },
  cmsCollection: {
    collectionId: 'collection-1',
    collectionName: 'Blog',
    collectionSlug: 'blog',
    seoFields: [
      { id: 'name', slug: 'name', displayName: 'Name', type: 'PlainText' },
      { id: 'slug', slug: 'slug', displayName: 'Slug', type: 'PlainText' },
      { id: 'seo-title', slug: 'seo-title', displayName: 'SEO Title', type: 'PlainText' },
      { id: 'seo-description', slug: 'seo-description', displayName: 'SEO Description', type: 'PlainText' },
    ],
    items: [{ id: 'item-1', fieldData: { name: 'CMS Post', slug: 'cms-post', 'seo-title': 'CMS SEO', 'seo-description': 'CMS description.' } }],
    total: 1,
  },
  cmsItem: { id: 'item-1', fieldData: { name: 'CMS Post', slug: 'cms-post', 'seo-title': 'CMS SEO', 'seo-description': 'CMS description.' } },
  cmsEdit: { name: 'CMS Post', slug: 'cms-post', 'seo-title': 'CMS SEO', 'seo-description': 'CMS description.' },
  pageState: { status: 'in-review' },
  recommendations: [],
  metrics: { lastEditedAt: '2026-07-02T00:00:00.000Z' },
  dirty: true,
  missingTitle: false,
  missingDescription: false,
};

const manualRow: SeoEditorSurfaceRow = {
  id: 'manual:cms-orphan',
  target: {
    id: 'manual:cms-orphan',
    targetType: SEO_EDITOR_TARGET_TYPES.manual,
    syntheticPageId: 'cms-orphan',
    title: 'Unmapped CMS URL',
    canonicalPath: '/blog/orphan',
    rawSlug: 'orphan',
    sourceLabel: 'Unmapped CMS page',
    seo: { title: '', description: '' },
    capabilities: { canSave: false, canPublish: false, canSendToClient: false, canAnalyze: false, canBulkRewrite: false },
    manualApplyReason: 'This sitemap CMS URL could not be matched to a Webflow collection item.',
  },
  pageState: { status: 'clean' },
  recommendations: [],
  metrics: {},
  dirty: false,
  missingTitle: true,
  missingDescription: true,
};

function staticWorkflow(overrides: Partial<StaticSeoWorkflowState> = {}): StaticSeoWorkflowState {
  return {
    edits: { 'page-1': { seoTitle: 'Services SEO', seoDescription: 'Book local services.', dirty: true } },
    saving: new Set(),
    saved: new Set(),
    draftSaving: new Set(),
    draftSaved: new Set(),
    aiLoading: {},
    errorStates: {},
    analyzing: new Set(),
    variations: {},
    analyzedPages: new Set(['page-1']),
    approvalSelected: new Set(),
    sendingApproval: false,
    approvalSent: false,
    sendingPage: new Set(),
    sentPage: new Set(),
    updateField: vi.fn(),
    saveDraft: vi.fn(),
    savePage: saveStaticPageMock,
    savePageTitle: saveStaticTitleMock,
    aiRewrite: vi.fn(),
    analyzePage: vi.fn(),
    toggleApprovalSelect: vi.fn(),
    selectAllForApproval: vi.fn(),
    sendPageToClient: sendStaticPageMock,
    sendForApproval: vi.fn(),
    clearPageTracking: vi.fn(),
    clearVariations: vi.fn(),
    ...overrides,
  };
}

function staticBulkWorkflow(overrides: Partial<StaticSeoBulkWorkflowState> = {}): StaticSeoBulkWorkflowState {
  return {
    bulkFixing: false,
    bulkResults: null,
    bulkAnalyzeProgress: null,
    bulkMode: 'idle',
    bulkField: 'title',
    patternAction: 'append',
    patternText: '',
    bulkPreview: [],
    bulkProgress: { done: 0, total: 0 },
    bulkSource: 'pattern',
    missingTitles: 1,
    missingDescs: 1,
    setBulkMode: vi.fn(),
    setBulkField: vi.fn(),
    setPatternAction: vi.fn(),
    setPatternText: vi.fn(),
    setBulkPreview: vi.fn(),
    handleBulkFix: vi.fn(),
    analyzeAllPages: vi.fn(),
    previewPattern: vi.fn(),
    applyPattern: vi.fn(),
    bulkAiRewrite: vi.fn(),
    applyBulkRewrite: vi.fn(),
    cancelAnalyze: vi.fn(),
    cancelRewrite: vi.fn(),
    ...overrides,
  };
}

function cmsWorkflow(overrides: Partial<CmsSeoWorkflowState> = {}): CmsSeoWorkflowState {
  return {
    edits: { 'item-1': { name: 'CMS Post', slug: 'cms-post', 'seo-title': 'CMS SEO', 'seo-description': 'CMS description.' } },
    dirty: new Set(['item-1']),
    saved: new Set(['item-1']),
    saving: new Set(),
    errors: {},
    variations: {},
    aiLoading: {},
    aiError: null,
    approvalSelected: new Set(['item-1']),
    sendingApproval: false,
    approvalSent: false,
    approvalError: null,
    publishing: new Set(),
    published: new Set(),
    bulkMode: 'idle',
    bulkProgress: { done: 0, total: 0 },
    bulkResults: null,
    updateField: vi.fn(),
    saveItem: saveCmsItemMock,
    publishCollection: publishCmsCollectionMock,
    aiRewrite: vi.fn(),
    aiRewriteBoth: vi.fn(),
    applySingleVariation: vi.fn(),
    applyPairedVariation: vi.fn(),
    toggleApprovalItem: vi.fn(),
    toggleSelectAllInCollection: vi.fn(),
    sendForApproval: cmsSendForApprovalMock,
    bulkAiRewrite: vi.fn(),
    ...overrides,
  };
}

const workflows = {
  hasUnsaved: true,
  approvalRefreshKey: 0,
  staticWorkflow: staticWorkflow(),
  bulkWorkflow: staticBulkWorkflow(),
  cmsWorkflow: cmsWorkflow(),
  suggestions: [],
  suggestionCounts: { pending: 0, selected: 0, total: 0 },
  suggestionsQuery: { refetch: vi.fn() },
  publishing: false,
  published: false,
  publishSite: vi.fn(),
};

vi.mock('../../../src/hooks/admin/useSeoEditorRebuilt', () => ({
  useSeoEditorSurfaceData: () => ({
    workspace,
    siteId: 'site-1',
    rows: [staticRow, cmsRow, manualRow],
    pagesQuery: { data: [staticRow.staticPage], isLoading: false, isError: false, error: null, refetch: vi.fn() },
    cmsQuery: { data: { collections: [cmsRow.cmsCollection], approvalBatches: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() },
    pageJoin: { isLoading: false, error: null, refetch: vi.fn() },
    pageStates: { refresh: vi.fn() },
    resolvedTargets: {
      targets: [staticRow.target, cmsRow.target, manualRow.target],
      staticTargets: [staticRow.target],
      cmsTargets: [cmsRow.target],
      manualTargets: [manualRow.target],
      collectionOptions: [{ collectionId: 'collection-1', collectionName: 'Blog', collectionSlug: 'blog', itemCount: 1 }],
    },
    refetchAll: refetchAllMock,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSeoEditorSurfaceWorkflows: () => workflows,
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: vi.fn(),
}));

vi.mock('../../../src/components/PendingApprovals', () => ({
  PendingApprovals: () => <div data-testid="pending-approvals">Pending approvals reused</div>,
}));

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      list: () => featureFlagsListMock(),
    },
  };
});

function renderWithProviders(ui: ReactElement, path = '/ws/ws-1/seo-editor') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          {ui}
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function FlaggedSeoEditor() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <SeoEditorSurface workspaceId="ws-1" /> : <div data-testid="legacy-seo-editor">Legacy SEO editor</div>;
}

function StateProbe() {
  const state = useSeoEditorSurfaceState();
  return (
    <div>
      <span data-testid="tab">{state.tab}</span>
      <span data-testid="source">{state.source}</span>
      <span data-testid="filter">{state.filter}</span>
      <span data-testid="page">{state.selectedPage}</span>
      <span data-testid="search">{state.searchInput}</span>
    </div>
  );
}

function expectTextWithClass(text: string | RegExp, className: string) {
  const matches = screen.getAllByText(text);
  expect(matches.some((element) => element.classList.contains(className))).toBe(true);
}

describe('SeoEditorSurface rebuilt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflows.staticWorkflow = staticWorkflow();
    workflows.bulkWorkflow = staticBulkWorkflow();
    workflows.cmsWorkflow = cmsWorkflow();
    featureFlagsListMock.mockResolvedValue({ 'ui-rebuild-shell': true });
  });

  it('mounts after the real useFeatureFlag hook transitions from default to loaded true', async () => {
    let resolveFlags: (value: { 'ui-rebuild-shell': boolean }) => void = () => {};
    featureFlagsListMock.mockReturnValue(new Promise((resolve) => {
      resolveFlags = resolve;
    }));

    renderWithProviders(<FlaggedSeoEditor />);

    expect(screen.getByTestId('legacy-seo-editor')).toBeInTheDocument();
    resolveFlags({ 'ui-rebuild-shell': true });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'SEO Editor' })).toBeInTheDocument());
    expect(screen.getByText('Services')).toBeInTheDocument();
  });

  it('reads and validates tab, source, filter, page, and search URL state', () => {
    renderWithProviders(<StateProbe />, '/ws/ws-1/seo-editor?tab=research&source=cms-item&filter=needs-meta&page=item-1&search=post');

    expect(screen.getByTestId('tab')).toHaveTextContent('research');
    expect(screen.getByTestId('source')).toHaveTextContent('cms-item');
    expect(screen.getByTestId('filter')).toHaveTextContent('needs-meta');
    expect(screen.getByTestId('page')).toHaveTextContent('item-1');
    expect(screen.getByTestId('search')).toHaveTextContent('post');
  });

  it('falls back invalid URL state to safe defaults', () => {
    renderWithProviders(<StateProbe />, '/ws/ws-1/seo-editor?tab=bogus&source=nope&filter=nope&page=page-1');

    expect(screen.getByTestId('tab')).toHaveTextContent('edit');
    expect(screen.getByTestId('source')).toHaveTextContent('all');
    expect(screen.getByTestId('filter')).toHaveTextContent('all');
    expect(screen.getByTestId('page')).toHaveTextContent('page-1');
  });

  it('receives deep-linked tab and page params', async () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?tab=research&page=page-1');

    expect(screen.getByRole('radio', { name: 'Research' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('dialog', { name: 'Services' })).toBeInTheDocument();
    expect(screen.getByText('Metadata recommendations')).toBeInTheDocument();
    expectTextWithClass('Rename the page title here. H1 and slug stay read-only until a writable field is connected.', 't-body');
    expectTextWithClass('OpenGraph mirrors these fields when the page is saved.', 't-body');
  });

  it('uses operator-facing source and filter labels for URL state', () => {
    const { unmount } = renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?source=cms-item');

    expect(screen.getByText(/1 row · CMS/i)).toBeInTheDocument();
    expectTextWithClass(/1 row · CMS/i, 't-ui');
    expect(screen.queryByText(/cms-item|needs-meta|static-page/i)).not.toBeInTheDocument();

    unmount();
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?filter=needs-meta');

    expect(screen.getByText(/1 row · Missing meta/i)).toBeInTheDocument();
    expectTextWithClass(/1 row · Missing meta/i, 't-ui');
    expect(screen.queryByText(/cms-item|needs-meta|static-page/i)).not.toBeInTheDocument();
  });

  it('uses styleguide typography roles for worksheet primary data', () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    expectTextWithClass(/3 rows/i, 't-ui');
    expectTextWithClass('Services', 't-ui');
    expectTextWithClass('Services SEO', 't-ui');
    expectTextWithClass('Book local services.', 't-caption');
  });

  it('groups the default edit worksheet by source without changing selection ownership', () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    expect(screen.getByRole('heading', { name: 'Static pages' })).toBeInTheDocument();
    expect(screen.getByText('Direct page-SEO writes')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CMS collection items' })).toBeInTheDocument();
    expect(screen.getByText('Publish-gated per collection')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Manual URLs' })).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Services' }));
    expect(workflows.staticWorkflow.toggleApprovalSelect).toHaveBeenCalledWith('page-1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select CMS Post' }));
    expect(workflows.cmsWorkflow.toggleApprovalItem).toHaveBeenCalledWith('item-1');
    expect(screen.getByRole('checkbox', { name: 'Unmapped CMS URL is visible only' })).toBeDisabled();
  });

  it('uses readable body copy in research empty and no-recommendation states', () => {
    const { unmount } = renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?tab=research');

    expectTextWithClass('Open a row to review its page-specific research context.', 't-body');

    unmount();
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?tab=research&page=item-1');

    expectTextWithClass('No metadata recommendations are attached to this row.', 't-body');
  });

  it('does not expose implementation language in the loaded worksheet or detail drawer', () => {
    const { unmount } = renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?tab=research&page=page-1');

    expect(screen.getByRole('dialog', { name: 'Services' })).toBeInTheDocument();
    expect(screen.queryByText(/existing|server-backed|endpoint|v1|PATCH route|projection/i)).not.toBeInTheDocument();

    unmount();
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?page=item-1');

    expect(screen.getByRole('dialog', { name: 'CMS Post' })).toBeInTheDocument();
    expect(screen.queryByText(/existing|server-backed|endpoint|v1|PATCH route|projection/i)).not.toBeInTheDocument();
  });

  it('filters sources and preserves manual rows as visible-only', () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    fireEvent.click(screen.getByRole('radio', { name: /Manual/ }));
    expect(screen.getByText('Unmapped CMS URL')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Unmapped CMS URL'));
    expect(screen.getByText('Manual row is visible only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save disabled/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Publish disabled/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send disabled/ })).toBeDisabled();
  });

  it('routes static and CMS saves through their existing workflow props', async () => {
    const staticRender = renderWithProviders(
      <SeoEditorPagePanel
        workspaceId="ws-1"
        row={staticRow}
        staticWorkflow={staticWorkflow()}
        cmsWorkflow={cmsWorkflow()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Save SEO/ }));
    expect(saveStaticPageMock).toHaveBeenCalledWith('page-1');
    staticRender.unmount();

    renderWithProviders(
      <SeoEditorPagePanel
        workspaceId="ws-1"
        row={cmsRow}
        staticWorkflow={staticWorkflow()}
        cmsWorkflow={cmsWorkflow()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Draft saved/ }));
    expect(saveCmsItemMock).toHaveBeenCalledWith('collection-1', 'item-1');
    fireEvent.click(screen.getByRole('button', { name: /Publish collection/ }));
    expect(publishCmsCollectionMock).toHaveBeenCalledWith('collection-1');
  });

  it('meets the rebuilt a11y floor after stable render', async () => {
    const { container } = renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    await waitFor(() => expect(screen.getByText('Services')).toBeInTheDocument());
    await expectNoA11yViolations(container);
  }, 15_000);
});
