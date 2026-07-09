// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client';
import { AssetManagerSurface } from '../../../src/components/asset-manager-rebuilt/AssetManagerSurface';
import { ToastProvider } from '../../../src/components/Toast';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { queryKeys } from '../../../src/lib/queryKeys';
import type { CmsImageScanResult } from '../../../shared/types/cms-images';
import { expectNoA11yViolations } from '../a11y';

const postMock = vi.fn();
const patchMock = vi.fn();
const deleteMock = vi.fn();
const getMock = vi.fn();
const workspaceGetByIdMock = vi.fn();
const useWebflowAssetsMock = vi.fn();
const useAssetAuditMock = vi.fn();
const useCmsImagesMock = vi.fn();
const useQueueMock = vi.fn();
const startJobMock = vi.fn();
const featureFlagsListMock = vi.fn();

vi.mock('../../../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/client')>('../../../src/api/client');
  return {
    ...actual,
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
    del: (...args: unknown[]) => deleteMock(...args),
  };
});

vi.mock('../../../src/api/workspaces', () => ({
  workspaces: {
    getById: (...args: unknown[]) => workspaceGetByIdMock(...args),
  },
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

vi.mock('../../../src/api/seo', () => ({
  bulkGenerateAltText: vi.fn(),
}));

vi.mock('../../../src/hooks/admin/useAdminAssets', () => ({
  useWebflowAssets: (...args: unknown[]) => useWebflowAssetsMock(...args),
  useAssetAudit: (...args: unknown[]) => useAssetAuditMock(...args),
  useCmsImages: (...args: unknown[]) => useCmsImagesMock(...args),
}));

vi.mock('../../../src/hooks/admin/useQueue', () => ({
  useQueue: (...args: unknown[]) => useQueueMock(...args),
}));

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({
    jobs: [],
    startJob: startJobMock,
  }),
}));

const workspace = {
  id: 'ws-1',
  name: 'Acme',
  folder: 'acme',
  webflowSiteId: 'site-1',
  webflowSiteName: 'Acme Site',
};

const assets = [
  {
    id: 'asset-hero',
    displayName: 'hero.jpg',
    originalFileName: 'hero.jpg',
    size: 900_000,
    contentType: 'image/jpeg',
    hostedUrl: 'https://cdn.example.com/hero.jpg',
    altText: '',
    createdOn: '2026-07-01T00:00:00.000Z',
    width: 1600,
    height: 900,
  },
  {
    id: 'asset-logo',
    displayName: 'logo.svg',
    originalFileName: 'logo.svg',
    size: 12_000,
    contentType: 'image/svg+xml',
    hostedUrl: 'https://cdn.example.com/logo.svg',
    altText: 'Acme logo',
    createdOn: '2026-07-02T00:00:00.000Z',
  },
];

const cmsData: CmsImageScanResult = {
  assets: [
    {
      assetId: 'cms-hero',
      displayName: 'CMS hero',
      hostedUrl: 'https://cdn.example.com/cms-hero.jpg',
      altText: '',
      size: 240_000,
      contentType: 'image/jpeg',
      usages: [
        {
          collectionId: 'coll-1',
          collectionName: 'Posts',
          itemId: 'item-1',
          itemName: 'Summer guide',
          fieldSlug: 'body-image',
          fieldDisplayName: 'Body image',
          fieldType: 'Image',
        },
      ],
      isRichTextOnly: false,
    },
  ],
  collections: [
    {
      collectionId: 'coll-1',
      collectionName: 'Posts',
      imageFields: [
        { slug: 'body-image', displayName: 'Body image', type: 'Image' },
        { slug: 'og-image', displayName: 'OG image', type: 'Image' },
      ],
    },
  ],
  stats: {
    totalCmsImages: 1,
    missingAlt: 1,
    oversized: 0,
  },
};

function renderSurface(initialEntry = '/ws/ws-1/media') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LocationProbe />
          <AssetManagerSurface workspaceId="ws-1" />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-search" hidden>{location.search}</span>;
}

function FlaggedAssetManager() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <AssetManagerSurface workspaceId="ws-1" /> : <div data-testid="legacy-media">Legacy Media</div>;
}

function renderFlagged(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/ws/ws-1/media']}>
            <FlaggedAssetManager />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagsListMock.mockReturnValue(new Promise(() => {}));
  workspaceGetByIdMock.mockResolvedValue(workspace);
  useWebflowAssetsMock.mockReturnValue({
    data: assets,
    isLoading: false,
    isError: false,
    isFetching: false,
    dataUpdatedAt: new Date('2026-07-07T12:00:00.000Z').getTime(),
  });
  useAssetAuditMock.mockReturnValue({
    data: new Set(['asset-unused']),
    isLoading: false,
  });
  useCmsImagesMock.mockReturnValue({
    data: cmsData,
    isLoading: false,
  });
  useQueueMock.mockReturnValue({
    data: [],
    isLoading: false,
  });
  postMock.mockResolvedValue({ altText: 'Generated alt text' });
  patchMock.mockResolvedValue({ success: true });
  deleteMock.mockResolvedValue({ success: true });
  startJobMock.mockResolvedValue('job-1');
  vi.stubGlobal('open', vi.fn());
});

describe('AssetManagerSurface', () => {
  it('mounts through a real feature-flag loading to loaded transition', async () => {
    const { queryClient } = renderFlagged();

    expect(screen.getByTestId('legacy-media')).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(queryKeys.shared.featureFlags(), { 'ui-rebuild-shell': true });
    });

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-media')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Browse/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('writes prototype tab state and clears the default Browse URL', async () => {
    renderSurface('/ws/ws-1/media?tab=browse');

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Browse/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=browse');

    fireEvent.click(screen.getByRole('radio', { name: /Audit/i }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=audit&sort=issues');

    fireEvent.click(screen.getByRole('radio', { name: /Browse/i }));
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
  });

  it('receives ?filter=oversized on the browse lens', async () => {
    renderSurface('/ws/ws-1/media?filter=oversized');

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByText('hero.jpg')).toBeInTheDocument();
    expect(screen.queryByText('logo.svg')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Oversized\s*1/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('frames Browse as the prototype source-fix workshop with readable proof copy', async () => {
    renderSurface('/ws/ws-1/media');

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByText('Fixes the source, not the symptom.')).toBeInTheDocument();
    expect(screen.getByText(/Compressing writes optimized assets back to Webflow/i)).toHaveClass('t-body');
    expect(screen.getByText('From media fix to proof')).toBeInTheDocument();
    expect(screen.getByText(/compression pass that improves Core Web Vitals/i)).toHaveClass('t-body');
  });

  it('receives ?tab=audit&filter=oversized for the audit drill-in', async () => {
    getMock.mockResolvedValue({
      totalAssets: 2,
      issueCount: 1,
      missingAlt: 0,
      oversized: 1,
      unused: 0,
      duplicates: 0,
      lowQualityAlt: 0,
      duplicateAlt: 0,
      healthScore: 72,
      issues: [
        {
          assetId: 'asset-hero',
          fileName: 'hero.jpg',
          url: 'https://cdn.example.com/hero.jpg',
          fileSize: 900_000,
          issues: ['oversized'],
          usedIn: ['Home'],
        },
      ],
    });

    renderSurface('/ws/ws-1/media?tab=audit&filter=oversized');
    expect(await screen.findByText('Oversized image repair')).toBeInTheDocument();
    expect(screen.getByText(/source-fix step for PageSpeed or Site Audit findings/i)).toBeInTheDocument();
    expect(screen.getByText(/Use Compress all or row-level Compress/i)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /Run Asset Audit/i }));

    expect(await screen.findByText('hero.jpg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Oversized\s*1/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps internal implementation language out of the audit score fallback', async () => {
    getMock.mockResolvedValue({
      totalAssets: 2,
      issueCount: 1,
      missingAlt: 0,
      oversized: 1,
      unused: 0,
      duplicates: 0,
      lowQualityAlt: 0,
      duplicateAlt: 0,
      issues: [
        {
          assetId: 'asset-hero',
          fileName: 'hero.jpg',
          url: 'https://cdn.example.com/hero.jpg',
          fileSize: 900_000,
          issues: ['oversized'],
          usedIn: ['Home'],
        },
      ],
    });

    renderSurface('/ws/ws-1/media?tab=audit&filter=oversized');
    fireEvent.click(await screen.findByRole('button', { name: /Run Asset Audit/i }));

    expect(await screen.findByText('hero.jpg')).toBeInTheDocument();
    expect(screen.queryByText(/This rebuild|in the browser/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Audit health score appears when the audit returns an authoritative score/i)).toBeInTheDocument();
  });

  it('opens a deep-linked asset detail drawer exactly once', async () => {
    renderSurface('/ws/ws-1/media?asset=asset-hero');

    const dialog = await screen.findByRole('dialog', { name: /hero\.jpg/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByText('Asset ID')).toBeInTheDocument();
  });

  it('shows the CMS field selector for CMS filters', async () => {
    renderSurface('/ws/ws-1/media?filter=cms-images');

    expect(await screen.findByText('CMS Field Selection')).toBeInTheDocument();
    expect(screen.getByText('CMS hero')).toBeInTheDocument();
    expect(screen.getAllByText('Body image').length).toBeGreaterThan(0);
  });

  it('locks AI actions and shows the first 429 banner', async () => {
    postMock.mockRejectedValueOnce(new ApiError(429, 'Monthly AI generation limit reached'));
    renderSurface('/ws/ws-1/media');

    const firstGenerate = (await screen.findAllByLabelText('Generate alt text'))[0];
    fireEvent.click(firstGenerate);

    expect(await screen.findByText('AI quota reached')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByLabelText('Generate alt text')[0]).toBeDisabled();
    });
  });

  it('renders the no-site locked state', async () => {
    workspaceGetByIdMock.mockResolvedValue({ ...workspace, webflowSiteId: '' });
    renderSurface('/ws/ws-1/media');

    expect(await screen.findByText('Link a Webflow site')).toBeInTheDocument();
  });

  it('passes the rebuilt a11y floor for the loaded browse view', async () => {
    const { container } = renderSurface('/ws/ws-1/media');

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
