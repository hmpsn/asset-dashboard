import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { UnifiedPage } from '../../../shared/types/page-join';
import { expectNoA11yViolations } from '../a11y';

const mocks = vi.hoisted(() => ({
  workspaces: {
    data: [{ id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1' }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  keywordStrategy: {
    data: { strategy: null },
    isLoading: false,
    isError: false,
  },
  pageJoin: {
    pages: [] as UnifiedPage[],
    strategyPages: [] as UnifiedPage[],
    webflowPages: [] as UnifiedPage[],
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  localSeo: {
    data: { featureEnabled: false, latestSnapshots: [] },
    isLoading: false,
    isError: false,
  },
  analysis: {
    analyses: {},
    contentScores: {},
    analyzing: new Set<string>(),
    bulkProgress: null,
    cancellableBulkJobId: null,
    analysisError: null,
    showNextSteps: false,
    analyzePage: vi.fn(),
    analyzeAllPages: vi.fn(),
    cancelBulkJob: vi.fn(),
    dismissAnalysisError: vi.fn(),
    dismissNextSteps: vi.fn(),
  },
}));

vi.mock('../../../src/hooks/admin', () => ({
  useWorkspaces: () => mocks.workspaces,
  useKeywordStrategy: () => mocks.keywordStrategy,
  usePageJoin: () => mocks.pageJoin,
}));

vi.mock('../../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeo: () => mocks.localSeo,
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceAnalysis', () => ({
  usePageIntelligenceAnalysis: () => mocks.analysis,
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceKeywordEditing', () => ({
  usePageIntelligenceKeywordEditing: () => ({}),
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceKeywordTracking', () => ({
  usePageIntelligenceKeywordTracking: () => ({}),
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceSeoCopy', () => ({
  usePageIntelligenceSeoCopy: () => ({}),
}));

vi.mock('../../../src/components/local-seo/LocalSeoVisibilityPanel', () => ({
  LocalSeoVisibilityPanel: () => <div data-testid="local-visibility-panel" />,
}));

vi.mock('../../../src/components/page-intelligence-rebuilt/PageIntelligenceDetailPane', () => ({
  PageIntelligenceDetailPane: ({ page }: { page?: { id: string } }) => (
    <div data-testid="page-intelligence-detail" data-page-id={page?.id ?? ''} />
  ),
}));

import { PageIntelligenceSurface } from '../../../src/components/page-intelligence-rebuilt/PageIntelligenceSurface';
import { REBUILT_SURFACES } from '../../../src/components/layout/rebuiltSurfaces';

const PAGE: UnifiedPage = {
  id: 'page-1',
  title: 'Services',
  path: '/services',
  slug: 'services',
  source: 'static',
  analyzed: false,
};

function ClearRouterState() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/ws/ws-1/page-intelligence', { replace: true, state: {} })}>Clear router state</button>;
}

function surfaceTree(withFixContext = false, initialEntry?: string) {
  return (
    <MemoryRouter
      initialEntries={[initialEntry ?? (withFixContext
        ? {
            pathname: '/ws/ws-1/page-intelligence',
            state: { fixContext: { targetRoute: 'page-intelligence', pageSlug: 'services' } },
          }
        : '/ws/ws-1/page-intelligence')]}
    >
      <Routes>
        <Route
          path="/ws/:workspaceId/page-intelligence"
          element={(
            <>
              <ClearRouterState />
              <PageIntelligenceSurface workspaceId="ws-1" />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('PageIntelligenceSurface module contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaces.data = [{ id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1' }];
    mocks.workspaces.isLoading = false;
    mocks.workspaces.isError = false;
    mocks.pageJoin.pages = [PAGE];
    mocks.pageJoin.strategyPages = [];
    mocks.pageJoin.webflowPages = [PAGE];
    mocks.pageJoin.isLoading = false;
    mocks.pageJoin.error = null;
  });

  it('exports the standalone workspace-owned surface', () => {
    expect(PageIntelligenceSurface).toBeTypeOf('function');
  });

  it('mounts from the rebuilt registry while the flag-off legacy receiver remains available', () => {
    expect(REBUILT_SURFACES['page-intelligence']).toBeDefined();
  });

  it('retains fix context until cold page data resolves after App clears router state', async () => {
    mocks.pageJoin.pages = [];
    mocks.pageJoin.webflowPages = [];
    mocks.pageJoin.isLoading = true;
    const view = render(surfaceTree(true));

    fireEvent.click(screen.getByRole('button', { name: 'Clear router state' }));
    mocks.pageJoin.pages = [PAGE];
    mocks.pageJoin.webflowPages = [PAGE];
    mocks.pageJoin.isLoading = false;
    view.rerender(surfaceTree(true));

    await waitFor(() => expect(screen.getByTestId('page-intelligence-detail')).toHaveAttribute('data-page-id', 'page-1'));
  });

  it('waits for the authoritative joined inventory before resolving an explicit page identity', async () => {
    mocks.pageJoin.pages = [{
      id: 'strategy-only',
      title: 'Strategy-only page',
      path: '/strategy-only',
      slug: 'strategy-only',
      source: 'static',
      analyzed: false,
    }];
    mocks.pageJoin.webflowPages = [];
    mocks.pageJoin.isLoading = true;
    const initialEntry = '/ws/ws-1/page-intelligence?page=page-1';
    const view = render(surfaceTree(false, initialEntry));

    mocks.pageJoin.pages = [PAGE];
    mocks.pageJoin.webflowPages = [PAGE];
    mocks.pageJoin.isLoading = false;
    view.rerender(surfaceTree(false, initialEntry));

    await waitFor(() => expect(screen.getByTestId('page-intelligence-detail')).toHaveAttribute('data-page-id', 'page-1'));
  });

  it('meets the rebuilt accessibility floor', async () => {
    const { container } = render(surfaceTree());

    await waitFor(() => expect(screen.getByTestId('page-intelligence-detail')).toHaveAttribute('data-page-id', ''));
    await expectNoA11yViolations(container);
  });
});
