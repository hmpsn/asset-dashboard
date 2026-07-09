// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../../src/api/misc';
import { ToastProvider } from '../../../src/components/Toast';
import { SchemaSurface } from '../../../src/components/schema-rebuilt/SchemaSurface';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { expectNoA11yViolations } from '../a11y';

const workspaceStateMock = vi.fn();
const impactMock = vi.fn();
const savePageTypeMock = vi.fn();
const invalidateMock = vi.fn();
const generationMock = vi.fn();
const publishingMock = vi.fn();
const cmsMock = vi.fn();
const validationsMock = vi.fn();
const graphValidationMock = vi.fn();
const adminRecommendationsMock = vi.fn();
let capturedWorkspaceHandlers: Record<string, () => void> = {};

const workspace = {
  id: 'ws-1',
  name: 'Acme Dental',
  webflowSiteId: 'site-1',
  webflowSiteName: 'acme.com',
  folder: 'acme',
  createdAt: '2026-01-01T00:00:00.000Z',
  businessProfile: null,
  intelligenceProfile: { industry: 'dental clinic', targetAudience: 'local patients' },
};

const schemaPage = {
  pageId: 'home',
  pageTitle: 'Home',
  slug: '',
  publishedPath: '/',
  url: 'https://acme.com/',
  existingSchemas: ['Organization'],
  existingSchemaJson: [{ '@type': 'Organization', name: 'Acme' }],
  suggestedSchemas: [
    {
      type: 'WebPage',
      reason: 'Homepage should connect Organization and WebSite nodes.',
      priority: 'high' as const,
      template: {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'Organization', '@id': 'https://acme.com/#organization', name: 'Acme Dental' },
          { '@type': 'WebSite', '@id': 'https://acme.com/#website', name: 'Acme Dental' },
        ],
      },
    },
  ],
  validationFindings: [
    { severity: 'warning' as const, field: 'phone', message: 'Phone is missing from the business profile.' },
  ],
  validationErrors: [],
  richResultsEligibility: [{ type: 'Organization', eligible: true, feature: 'Merchant listing' }],
  generationDiagnostics: {
    roleSource: 'auto-detect',
    effectiveRole: 'homepage',
    validationStatus: 'warnings' as const,
    skippedSchemaTypes: [],
  },
  cmsDeliveryStatus: undefined,
  lastPublishedAt: '2026-01-01T00:00:00.000Z',
};

const servicePage = {
  pageId: 'cms-service',
  pageTitle: 'Dental Implants',
  slug: 'dental-implants',
  publishedPath: '/dental-implants',
  url: 'https://acme.com/dental-implants',
  existingSchemas: [],
  suggestedSchemas: [
    {
      type: 'Service',
      reason: 'Service page should expose offer and service information.',
      priority: 'high' as const,
      template: {
        '@context': 'https://schema.org',
        '@graph': [{ '@type': 'Service', name: 'Dental Implants' }],
      },
    },
  ],
  validationFindings: [],
  validationErrors: [],
  richResultsEligibility: [],
  generationDiagnostics: {
    roleSource: 'saved-page-type',
    effectiveRole: 'service',
    validationStatus: 'valid' as const,
    skippedSchemaTypes: [],
  },
  cmsDeliveryStatus: { mode: 'cms-field', status: 'ready', message: 'Schema field ready.' },
  lastPublishedAt: null,
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

vi.mock('../../../src/hooks/admin/useAdminSchema', () => ({
  useAdminSchemaWorkspace: (...args: unknown[]) => workspaceStateMock(...args),
  useAdminSchemaImpact: (...args: unknown[]) => impactMock(...args),
  useSaveSchemaPageType: () => ({ mutateAsync: savePageTypeMock }),
  useInvalidateAdminSchemaQueries: () => invalidateMock,
}));

vi.mock('../../../src/components/schema/useSchemaSuggesterGeneration', () => ({
  useSchemaSuggesterGeneration: (...args: unknown[]) => generationMock(...args),
}));

vi.mock('../../../src/components/schema/useSchemaSuggesterPublishingWorkflow', () => ({
  useSchemaSuggesterPublishingWorkflow: (...args: unknown[]) => publishingMock(...args),
}));

vi.mock('../../../src/components/schema/useSchemaSuggesterCmsWorkflow', () => ({
  MAX_SCHEMA_MAPPING_COLLECTIONS: 4,
  useSchemaSuggesterCmsWorkflow: (...args: unknown[]) => cmsMock(...args),
}));

vi.mock('../../../src/hooks/admin/useSchemaValidation', () => ({
  useSchemaValidations: (...args: unknown[]) => validationsMock(...args),
  useSchemaGraphValidation: (...args: unknown[]) => graphValidationMock(...args),
}));

vi.mock('../../../src/hooks/admin/useAdminRecommendations', () => ({
  useAdminRecommendationSet: (...args: unknown[]) => adminRecommendationsMock(...args),
}));

vi.mock('../../../src/hooks/useRecommendations', async () => {
  const actual = await vi.importActual<typeof import('../../../src/hooks/useRecommendations')>('../../../src/hooks/useRecommendations');
  return {
    ...actual,
    useRecommendations: vi.fn(() => ({
      loaded: true,
      forPage: () => [],
    })),
  };
});

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_workspaceId: string, handlers: Record<string, () => void>) => {
    capturedWorkspaceHandlers = handlers;
    return { send: vi.fn() };
  },
}));

vi.mock('../../../src/components/schema/SchemaPlanPanel', () => ({
  SchemaPlanPanel: () => <div data-testid="schema-plan-panel">Schema Site Plan bridge</div>,
}));

vi.mock('../../../src/components/PendingApprovals', () => ({
  PendingApprovals: () => <div data-testid="pending-approvals">Pending schema approvals</div>,
}));

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      list: vi.fn(() => Promise.resolve({ 'ui-rebuild-shell': true })),
    },
  };
});

function setupMocks() {
  capturedWorkspaceHandlers = {};
  workspaceStateMock.mockReturnValue({
    workspace,
    siteId: 'site-1',
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  impactMock.mockReturnValue({
    data: {
      totalDeployments: 1,
      pagesWithData: 1,
      tooRecent: 0,
      avgClicksDelta: 12,
      avgImpressionsDelta: 90,
      avgCtrDelta: 0.8,
      avgPositionDelta: -1.2,
      deployments: [
        {
          change: { id: 'change-1', pageSlug: '/', pageTitle: 'Home', fields: ['schema'], source: 'schema', changedAt: '2026-02-01T00:00:00.000Z' },
          before: { clicks: 10, impressions: 100, ctr: 10, position: 8 },
          after: { clicks: 22, impressions: 190, ctr: 11.6, position: 6.8 },
          daysSinceChange: 20,
          tooRecent: false,
        },
      ],
    },
    isLoading: false,
  });
  savePageTypeMock.mockResolvedValue({});
  generationMock.mockReturnValue({
    data: [schemaPage, servicePage],
    setData: vi.fn(),
    loading: false,
    started: true,
    regenerating: new Set(),
    scanError: null,
    singlePageError: null,
    setSinglePageError: vi.fn(),
    fetchPagesError: null,
    progressMsg: null,
    showNextSteps: false,
    setShowNextSteps: vi.fn(),
    showPagePicker: false,
    setShowPagePicker: vi.fn(),
    availablePages: [{ id: 'about', title: 'About', slug: 'about' }],
    pageSearch: '',
    setPageSearch: vi.fn(),
    loadingPages: false,
    generatingSingle: null,
    pageTypes: { home: 'homepage', 'cms-service': 'service' },
    setPageTypes: vi.fn(),
    setSinglePageTypeOverrides: vi.fn(),
    snapshotDate: '2026-02-01T00:00:00.000Z',
    snapshotLoading: false,
    filteredInitialPages: [{ id: 'about', title: 'About', slug: 'about' }],
    runScan: vi.fn(),
    stopScan: vi.fn(),
    fetchPages: vi.fn(),
    generateSinglePage: vi.fn(),
    regeneratePage: vi.fn(),
  });
  publishingMock.mockReturnValue({
    copiedId: null,
    publishing: new Set(),
    published: new Set(['home']),
    publishError: {},
    manualDelivery: {},
    confirmPublish: null,
    setConfirmPublish: vi.fn(),
    sendingToClient: false,
    sentToClient: false,
    sendToClientError: null,
    setSendToClientError: vi.fn(),
    approvalRefreshKey: 0,
    setApprovalRefreshKey: vi.fn(),
    sendingPage: new Set(),
    sentPages: new Set(),
    sendPageErrors: {},
    retractingPages: new Set(),
    retractedPages: new Set(),
    bulkPublishing: false,
    bulkProgress: null,
    showDiff: new Set(),
    editingSchema: new Set(),
    editedSchemaJson: {},
    schemaParseError: {},
    savingTemplate: false,
    templateSaved: false,
    templateSaveError: null,
    getState: () => ({ status: 'live' }),
    summary: { total: 0 },
    unpublishedCount: 1,
    getEffectiveSchema: (_pageId: string, original: Record<string, unknown>) => original,
    sendSchemasToClient: vi.fn(),
    publishToWebflow: vi.fn(),
    toggleSchemaEdit: vi.fn(),
    handleSchemaJsonChange: vi.fn(),
    copyTemplate: vi.fn(),
    copyJsonLd: vi.fn(),
    sendSingleSchemaToClient: vi.fn(),
    saveAsTemplate: vi.fn(),
    publishAllToWebflow: vi.fn(),
    toggleDiff: vi.fn(),
    retractSchema: vi.fn(),
    restoreSchema: vi.fn(),
    clearManualDeliveryForPage: vi.fn(),
    clearManualEditForPage: vi.fn(),
    clearAllManualEdits: vi.fn(),
  });
  cmsMock.mockReturnValue({
    cmsMappingError: null,
    savingCmsMapping: null,
    fieldMappingTargets: [],
    schemaMappingCollections: [],
    saveCmsFieldMapping: vi.fn(),
  });
  validationsMock.mockReturnValue({
    data: [{ pageId: 'home', status: 'warnings' }, { pageId: 'cms-service', status: 'valid' }],
  });
  graphValidationMock.mockReturnValue({
    data: { status: 'valid', nodeCount: 3, referenceCount: 2, findings: [] },
    isFetching: false,
  });
  adminRecommendationsMock.mockReturnValue({
    data: { recommendations: [] },
    isSuccess: true,
  });
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-search">{location.search}</span>;
}

function renderSchema(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <SchemaSurface workspaceId="ws-1" />
          <LocationProbe />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function FlaggedSchemaHarness() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <SchemaSurface workspaceId="ws-1" /> : <div data-testid="legacy-schema">Legacy Schema</div>;
}

describe('SchemaSurface rebuilt admin surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('receives ?tab=guide and invalid tab values at runtime', () => {
    renderSchema('/ws/ws-1/seo-schema?tab=guide');
    expect(screen.getByRole('heading', { name: 'Schema' })).toBeInTheDocument();
    expect(screen.getByText('Client review handoff')).toBeInTheDocument();

    renderSchema('/ws/ws-1/seo-schema?tab=unknown');
    expect(screen.getByText('Schema Site Plan bridge')).toBeInTheDocument();
    expect(screen.getByText('Dental Implants')).toBeInTheDocument();
  });

  it('renders the prototype five-phase workflow in the guide', () => {
    renderSchema('/ws/ws-1/seo-schema?tab=guide');

    const workflow = screen.getByLabelText('Schema guide workflow');
    for (const phase of ['Scan', 'Review', 'Edit', 'Publish', 'Validate']) {
      expect(within(workflow).getByText(phase)).toBeInTheDocument();
    }
    expect(within(workflow).getByText('Crawl the site, read the active schema plan, and detect which pages need structured data.')).toHaveClass('t-body');
    expect(within(workflow).getByText('Generate the site plan first')).toHaveClass('t-ui');
    expect(screen.getByText('The page shows these safeguards when generation, validation, publishing, and client review run.')).toHaveClass('t-body');
    expect(screen.getByText('Architecture-aware BreadcrumbList output')).toHaveClass('t-ui');

    expect(within(workflow).queryByText('Plan')).not.toBeInTheDocument();
    expect(within(workflow).queryByText('Coverage')).not.toBeInTheDocument();
    expect(within(workflow).queryByText('Prioritize')).not.toBeInTheDocument();
    expect(within(workflow).queryByText('Step 6')).not.toBeInTheDocument();
  });

  it('writes the validated tab state when switching lenses', () => {
    renderSchema('/ws/ws-1/seo-schema');
    expect(screen.getByTestId('location-search')).toHaveTextContent('');

    fireEvent.click(screen.getByRole('radio', { name: /Workflow Guide/ }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=guide');
    expect(screen.getByText('Client review handoff')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Generator/ }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('');
    expect(screen.getByText('Dental Implants')).toBeInTheDocument();
  });

  it('opens a detail drawer with review, edit, publish, send, and history affordances', () => {
    renderSchema('/ws/ws-1/seo-schema?tab=generator');

    fireEvent.click(screen.getByText('Dental Implants'));

    const drawer = screen.getByRole('dialog', { name: 'Dental Implants' });
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByText('JSON-LD workspace')).toBeInTheDocument();
    expect(within(drawer).getByText('Review generated markup, compare existing JSON-LD, or edit the effective schema.')).toHaveClass('t-body');
    expect(within(drawer).getByRole('button', { name: /Copy script/ })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /Publish to CMS field/ })).toBeInTheDocument();
    expect(within(drawer).getByText('Validate graph safety, publish to Webflow or CMS, or send the effective schema to the client.')).toHaveClass('t-body');
    expect(within(drawer).getByRole('button', { name: /Send to client/ })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /Version history and rollback/ })).toBeInTheDocument();
  });

  it('uses operator-facing schema copy without internal rebuild terms', () => {
    const internalTerms = /T1 carry-over|server-owned|server-side|shared domain services|Admin rebuild only|deliverable shapes|schema_item|schema_plan|No schema-review page|Awaiting server projection|Server-owned coverage|proven machinery|publish through existing services/i;

    const generator = renderSchema('/ws/ws-1/seo-schema?tab=generator');
    expect(screen.getByText('Dental Implants')).toBeInTheDocument();
    expect(generator.container).not.toHaveTextContent(internalTerms);
    generator.unmount();

    const guide = renderSchema('/ws/ws-1/seo-schema?tab=guide');
    expect(screen.getByText('Client review handoff')).toBeInTheDocument();
    expect(guide.container).not.toHaveTextContent(internalTerms);
  });

  it('uses the admin recommendations read path for page schema recommendation context', () => {
    renderSchema('/ws/ws-1/seo-schema?tab=generator');

    expect(adminRecommendationsMock).toHaveBeenCalledWith('ws-1', { enabled: true });
  });

  it('uses the real useFeatureFlag hook through loading to loaded before mounting schema', async () => {
    vi.mocked(featureFlags.list).mockResolvedValueOnce({ 'ui-rebuild-shell': true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ws/ws-1/seo-schema']}>
          <ToastProvider>
            <FlaggedSchemaHarness />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('legacy-schema')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Schema' })).toBeInTheDocument());
    expect(screen.queryByTestId('legacy-schema')).not.toBeInTheDocument();
  });

  it('meets the rebuilt a11y floor after loading indicators settle', async () => {
    const { container } = renderSchema('/ws/ws-1/seo-schema');

    await waitFor(() => expect(container.querySelectorAll('.animate-pulse').length).toBe(0));
    await expectNoA11yViolations(container);
  }, 15_000);

  it('registers schema workspace-event invalidation handlers', () => {
    renderSchema('/ws/ws-1/seo-schema');

    capturedWorkspaceHandlers['schema:snapshot_updated']();
    capturedWorkspaceHandlers['schema:cms_mapping_updated']();

    expect(invalidateMock).toHaveBeenCalledTimes(2);
  });
});
