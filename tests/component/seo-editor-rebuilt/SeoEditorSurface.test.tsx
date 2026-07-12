// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    approvalSelected: new Set(),
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

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Write targets' })).toBeInTheDocument());
    expect(screen.getByText('/services')).toBeInTheDocument();
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

  it('preserves edit and research deep links without mounting the dead peer control', async () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?tab=research&page=page-1');

    expect(screen.queryByRole('radio', { name: 'Research' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Services' })).toBeInTheDocument();
    expect(screen.getByText('Page intelligence')).toBeInTheDocument();
    expect(screen.getByText('Title needs more intent.')).toBeInTheDocument();
    expectTextWithClass('Rename the page title here. H1 and slug stay read-only until a writable field is connected.', 't-body');
    expectTextWithClass('OpenGraph mirrors these fields when the page is saved.', 't-body');
  });

  it('uses operator-facing source and filter labels for URL state', () => {
    const { unmount } = renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?source=cms-item');

    expect(screen.getByRole('radio', { name: 'CMS 1' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(/cms-item|needs-meta|static-page/i)).not.toBeInTheDocument();

    unmount();
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?filter=needs-review');

    expect(screen.getByRole('button', { name: 'Needs review2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/cms-item|needs-review|static-page/i)).not.toBeInTheDocument();
  });

  it('uses styleguide typography roles for worksheet primary data', () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    expectTextWithClass(/3 targets/i, 't-caption-sm');
    expectTextWithClass('/services', 't-mono');
    expect(screen.getByRole('textbox', { name: 'SEO title for Services' })).toHaveClass('t-caption-sm');
    expect(screen.getByRole('textbox', { name: 'Meta description for Services' })).toHaveClass('t-caption-sm');
  });

  it('renders one shared worksheet header with ordered source bands and unchanged selection ownership', () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Select',
      'Page',
      'Target keyword',
      'Title tag · 50–60',
      'Meta description · 140–160',
      'Score',
    ]);
    expect(screen.getByTestId('seo-editor-source-band-static')).toBeInTheDocument();
    expect(screen.getByTestId('seo-editor-source-band-cms')).toBeInTheDocument();
    expect(screen.getByTestId('seo-editor-source-band-manual')).toBeInTheDocument();
    expect(screen.getByText('Direct page-SEO writes')).toBeInTheDocument();
    expect(screen.getByText('Publish-gated per collection')).toBeInTheDocument();
    expect(screen.getByText('Read-only · excluded from fixable counts')).toBeInTheDocument();
    for (const snapshotLabel of screen.getAllByText('Read-only snapshot')) {
      expect(snapshotLabel.parentElement).toHaveClass('border-l-[var(--amber)]');
      expect(snapshotLabel.parentElement).not.toHaveClass('border-l-[var(--red)]');
    }

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Services' }));
    expect(workflows.staticWorkflow.toggleApprovalSelect).toHaveBeenCalledWith('page-1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select CMS Post' }));
    expect(workflows.cmsWorkflow.toggleApprovalItem).toHaveBeenCalledWith('item-1');
    expect(screen.getByRole('checkbox', { name: 'Unmapped CMS URL is read-only' })).toBeDisabled();

    const staticGroup = screen.getByRole('checkbox', { name: 'Select all Static pages' });
    const cmsGroup = screen.getByRole('checkbox', { name: 'Select all CMS collection items' });
    expect(staticGroup).not.toBeChecked();
    expect(cmsGroup).not.toBeChecked();
    fireEvent.click(staticGroup);
    expect(workflows.staticWorkflow.selectAllForApproval).toHaveBeenCalledWith(['page-1']);
    fireEvent.click(cmsGroup);
    expect(workflows.cmsWorkflow.toggleSelectAllInCollection).toHaveBeenCalledWith(['item-1']);
    expect(screen.queryByRole('button', { name: 'Select group' })).not.toBeInTheDocument();
  });

  it('routes each writable inline title and meta field to its existing callback exactly once', () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    fireEvent.change(screen.getByRole('textbox', { name: 'SEO title for Services' }), {
      target: { value: 'Static title revised' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Meta description for Services' }), {
      target: { value: 'Static description revised.' },
    });
    expect(workflows.staticWorkflow.updateField).toHaveBeenCalledTimes(2);
    expect(workflows.staticWorkflow.updateField).toHaveBeenNthCalledWith(1, 'page-1', 'seoTitle', 'Static title revised');
    expect(workflows.staticWorkflow.updateField).toHaveBeenNthCalledWith(2, 'page-1', 'seoDescription', 'Static description revised.');

    fireEvent.change(screen.getByRole('textbox', { name: 'SEO title for CMS Post' }), {
      target: { value: 'CMS title revised' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Meta description for CMS Post' }), {
      target: { value: 'CMS description revised.' },
    });
    expect(workflows.cmsWorkflow.updateField).toHaveBeenCalledTimes(2);
    expect(workflows.cmsWorkflow.updateField).toHaveBeenNthCalledWith(1, 'item-1', 'seo-title', 'CMS title revised');
    expect(workflows.cmsWorkflow.updateField).toHaveBeenNthCalledWith(2, 'item-1', 'seo-description', 'CMS description revised.');

    expect(screen.queryByRole('textbox', { name: /Unmapped CMS URL/ })).not.toBeInTheDocument();
  });

  it('keeps inline field keyboard input inside the worktable instead of opening Research', () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    const title = screen.getByRole('textbox', { name: 'SEO title for Services' });
    fireEvent.keyDown(title, { key: 'Enter' });
    fireEvent.keyDown(title, { key: ' ' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('portals topbar actions through the isolated fallback exactly once and uses prototype copy', () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    const fallback = screen.getByTestId('seo-editor-topbar-actions-fallback');
    expect(within(fallback).getByRole('button', { name: 'Re-sync targets' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Re-sync targets' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Publish Site' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Publish Site' }).querySelector('.fa-arrow-up')).toBeInTheDocument();

    fireEvent.click(within(fallback).getByRole('button', { name: 'Re-sync targets' }));
    expect(refetchAllMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(fallback).getByRole('button', { name: 'Publish Site' }));
    expect(workflows.publishSite).toHaveBeenCalledTimes(1);
  });

  it('keeps the first viewport workbench-contained and moves production tools into one disclosure', () => {
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    const workbench = screen.getByTestId('seo-editor-workbench');
    expect(workbench).toHaveClass('min-h-[620px]', 'overflow-hidden');
    expect(workbench).toHaveStyle({
      height: 'calc(100vh - var(--shell-topbar) - var(--page-pad-y) - 24px)',
      width: 'calc(100% + (var(--page-pad-x) * 2))',
      marginInline: 'calc(var(--page-pad-x) * -1)',
    });
    expect(screen.getByTestId('seo-editor-workbench-top')).toHaveClass('px-[var(--page-pad-x)]');
    expect(within(workbench).getByRole('grid')).toHaveClass('h-full', 'overflow-auto');
    expect(screen.queryByText('All sources')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Keyword Hub' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All3' })).not.toBeInTheDocument();

    const tools = screen.getByRole('button', { name: /Production tools/i });
    expect(tools).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('pending-approvals')).not.toBeInTheDocument();
    fireEvent.click(tools);
    expect(screen.getAllByTestId('pending-approvals')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Static bulk actions/i })).toHaveLength(1);
  });

  it('shows the source missing-metadata banner only for editable rows and wires each fix action once', () => {
    workflows.staticWorkflow = staticWorkflow({
      edits: { 'page-1': { seoTitle: '', seoDescription: '', dirty: true } },
    });
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Production tools/i }));

    expect(screen.getByText(/1 missing title · 1 missing description/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Fix titles' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Fix descriptions' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fix titles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fix descriptions' }));
    expect(workflows.bulkWorkflow.handleBulkFix).toHaveBeenNthCalledWith(1, 'title');
    expect(workflows.bulkWorkflow.handleBulkFix).toHaveBeenNthCalledWith(2, 'description');

    // The manual fixture is missing both tags, so the count remaining at one
    // proves read-only rows do not inflate actionable work.
    expect(screen.queryByText(/2 missing titles|2 missing descriptions/i)).not.toBeInTheDocument();
  });

  it('shows only supported selected-row actions in one compact strip', async () => {
    workflows.staticWorkflow = staticWorkflow({
      approvalSelected: new Set(['page-1']),
      edits: { 'page-1': { seoTitle: '', seoDescription: '', dirty: true } },
    });
    workflows.cmsWorkflow = cmsWorkflow({ approvalSelected: new Set(['item-1']) });
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />);

    const selectedToolbar = screen.getByRole('toolbar', { name: 'Selected SEO actions' });
    expect(selectedToolbar).toHaveClass('min-h-10', 'overflow-x-auto');
    expect(selectedToolbar).toHaveTextContent('2 selected');
    expect(screen.queryByText('Missing metadata')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all Static pages' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select all CMS collection items' })).toBeChecked();
    expect(screen.getAllByRole('button', { name: 'Send static to client' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Send CMS to client' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite static' }));
    expect(workflows.bulkWorkflow.bulkAiRewrite).toHaveBeenCalledWith('both');

    fireEvent.click(screen.getByRole('button', { name: 'Rewrite CMS' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Titles' }));
    expect(workflows.cmsWorkflow.bulkAiRewrite).toHaveBeenCalledWith('title');
    expect(screen.queryByRole('button', { name: /Request changes|Approve/ })).not.toBeInTheDocument();
  });

  it('keeps the research alias on the workbench and shows truthful no-recommendation drawer copy', () => {
    const { unmount } = renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?tab=research');

    expect(screen.getByRole('heading', { name: 'Write targets' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Research' })).not.toBeInTheDocument();

    unmount();
    renderWithProviders(<SeoEditorSurface workspaceId="ws-1" />, '/ws/ws-1/seo-editor?tab=research&page=item-1');

    fireEvent.click(screen.getByRole('button', { name: /Page intelligence/i }));
    expectTextWithClass('No metadata recommendations are attached to this target.', 't-body');
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

    expect(screen.getByRole('button', { name: /Missing title0/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Missing meta0/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Manual/ }));
    expect(screen.getByText('/blog/orphan')).toBeInTheDocument();
    fireEvent.click(screen.getByText('/blog/orphan'));
    expect(screen.getByText('Manual target is read-only')).toBeInTheDocument();
    expect(screen.getByText('Make this target writable')).toBeInTheDocument();
    expect(screen.getByText('Edit metadata in the platform that owns this URL.')).toBeInTheDocument();
    expect(screen.getByText('Map it to its Webflow page or CMS collection item.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save disabled|Publish disabled|Send disabled|Rewrite disabled/ })).not.toBeInTheDocument();
  });

  it('orders writable Research detail as fields and preview before score and intelligence', () => {
    renderWithProviders(
      <SeoEditorPagePanel
        workspaceId="ws-1"
        row={staticRow}
        staticWorkflow={staticWorkflow()}
        cmsWorkflow={cmsWorkflow()}
        onClose={vi.fn()}
      />,
    );

    const fields = screen.getByText('SEO fields');
    const preview = screen.getByText('Preview');
    const score = screen.getByText('Optimization score');
    const intelligence = screen.getByRole('button', { name: /^Page intelligence/i });
    expect(fields.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preview.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(score.compareDocumentPosition(intelligence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the Research drawer at 600px and widens to 860px with the existing control', () => {
    renderWithProviders(
      <SeoEditorPagePanel
        workspaceId="ws-1"
        row={staticRow}
        staticWorkflow={staticWorkflow()}
        cmsWorkflow={cmsWorkflow()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Services' });
    expect(dialog).toHaveStyle({ width: '600px' });
    const wide = screen.getByRole('button', { name: 'Wide' });
    expect(wide).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(wide);
    expect(dialog).toHaveStyle({ width: '860px' });
    expect(screen.getByRole('button', { name: 'Narrow' })).toHaveAttribute('aria-pressed', 'true');
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

    await waitFor(() => expect(screen.getByText('/services')).toBeInTheDocument());
    await expectNoA11yViolations(container);
  }, 15_000);
});
