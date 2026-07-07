// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client';
import { AssetManagerSurface } from '../../../src/components/asset-manager-rebuilt/AssetManagerSurface';
import { ToastProvider } from '../../../src/components/Toast';
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
          <AssetManagerSurface workspaceId="ws-1" />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
  it('receives ?filter=oversized on the browse lens', async () => {
    renderSurface('/ws/ws-1/media?filter=oversized');

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByText('hero.jpg')).toBeInTheDocument();
    expect(screen.queryByText('logo.svg')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Oversized\s*1/i })).toHaveAttribute('aria-pressed', 'true');
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
    fireEvent.click(await screen.findByRole('button', { name: /Run Asset Audit/i }));

    expect(await screen.findByText('hero.jpg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Oversized\s*1/i })).toHaveAttribute('aria-pressed', 'true');
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
