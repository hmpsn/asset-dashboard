import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_FLAGS, type FeatureFlagKey } from '../../../shared/types/feature-flags';
import { queryKeys } from '../../../src/lib/queryKeys';

const mocks = vi.hoisted(() => ({
  featureFlagsList: vi.fn(),
}));

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      list: () => mocks.featureFlagsList(),
    },
  };
});

vi.mock('../../../src/hooks/admin', () => ({
  useWorkspaces: () => ({
    data: [{ id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1' }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useKeywordStrategy: () => ({ data: { strategy: null }, isLoading: false, isError: false }),
  usePageJoin: () => ({
    pages: [],
    strategyPages: [],
    webflowPages: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeo: () => ({
    data: { featureEnabled: false, latestSnapshots: [] },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../../../src/components/local-seo/LocalSeoVisibilityPanel', () => ({
  LocalSeoVisibilityPanel: () => null,
  LocalSeoVisibilityBadge: () => null,
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceAnalysis', () => ({
  usePageIntelligenceAnalysis: () => ({
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
  }),
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceKeywordEditing', () => ({
  usePageIntelligenceKeywordEditing: () => ({
    editingPageId: null,
    editDraft: { primary: '', secondary: '' },
    saving: false,
    startEdit: vi.fn(),
    saveEdit: vi.fn(),
    setEditDraft: vi.fn(),
    cancelEdit: vi.fn(),
  }),
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceKeywordTracking', () => ({
  usePageIntelligenceKeywordTracking: () => ({
    trackedKeywords: new Set<string>(),
    trackKeyword: vi.fn(),
  }),
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceSeoCopy', () => ({
  usePageIntelligenceSeoCopy: () => ({
    generatingCopy: null,
    seoCopyResults: new Map(),
    copiedField: null,
    generateSeoCopy: vi.fn(),
    copyText: vi.fn(),
  }),
}));

import { PageIntelligence } from '../../../src/components/PageIntelligence';
import { useRebuildShellEnabled } from '../../../src/components/layout/RebuiltAppChrome';
import { REBUILT_SURFACES } from '../../../src/components/layout/rebuiltSurfaces';

function PageIntelligenceReceiver() {
  const rebuildEnabled = useRebuildShellEnabled();
  const RebuiltSurface = REBUILT_SURFACES['page-intelligence'];

  if (!rebuildEnabled || !RebuiltSurface) {
    return <PageIntelligence workspaceId="ws-1" siteId="site-1" />;
  }

  return (
    <Suspense fallback={<div role="status">Opening rebuilt Page Intelligence…</div>}>
      <RebuiltSurface workspaceId="ws-1" />
    </Suspense>
  );
}

function renderReceiver() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/ws/ws-1/page-intelligence']}>
        <PageIntelligenceReceiver />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe('Page Intelligence closure — real rebuilt-shell flag transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves from the actual legacy receiver to the registry-owned rebuilt receiver after loading resolves ON', async () => {
    let resolveFlags!: (flags: Record<FeatureFlagKey, boolean>) => void;
    mocks.featureFlagsList.mockReturnValue(new Promise<Record<FeatureFlagKey, boolean>>((resolve) => {
      resolveFlags = resolve;
    }));

    renderReceiver();

    expect(screen.getAllByRole('heading', { name: 'Page Intelligence' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Page Intelligence', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('No pages found.')).toBeInTheDocument();

    await act(async () => {
      resolveFlags({ ...FEATURE_FLAGS, 'ui-rebuild-shell': true });
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', { name: 'Page Intelligence', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Page Intelligence' })).toHaveLength(1);
    expect(screen.queryByText('No pages found.')).not.toBeInTheDocument();
    expect(screen.getByText('Select a page to research')).toBeInTheDocument();
  });

  it('keeps the actual legacy receiver after the real flag query settles OFF', async () => {
    mocks.featureFlagsList.mockResolvedValue({ ...FEATURE_FLAGS, 'ui-rebuild-shell': false });

    const { client } = renderReceiver();

    await waitFor(() => {
      expect(client.getQueryData(queryKeys.shared.featureFlags())).toEqual(
        expect.objectContaining({ 'ui-rebuild-shell': false }),
      );
    });

    expect(screen.getAllByRole('heading', { name: 'Page Intelligence' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Page Intelligence', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('No pages found.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page Intelligence', level: 1 })).not.toBeInTheDocument();
  });
});
