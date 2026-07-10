// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components/Toast';
import { PerformanceSurface } from '../../../src/components/performance-rebuilt/PerformanceSurface';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { queryKeys } from '../../../src/lib/queryKeys';
import { expectNoA11yViolations } from '../a11y';

const pageWeightScanMock = vi.fn();
const pageWeightSnapshotMock = vi.fn();
const pagespeedBulkMock = vi.fn();
const pagespeedSingleMock = vi.fn();
const pagespeedSnapshotMock = vi.fn();
const webflowPagesMock = vi.fn();
const featureFlagsListMock = vi.fn();

const workspace = {
  id: 'ws-1',
  name: 'Acme Dental',
  webflowSiteId: 'site-1',
  webflowSiteName: 'acme.com',
  folder: 'acme',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const pageWeightResult = {
  totalPages: 3,
  totalAssetSize: 8_388_608,
  pages: [
    {
      page: 'page:/services',
      totalSize: 3_145_728,
      assetCount: 3,
      assets: [
        { id: 'asset-1', name: 'hero-services.jpg', size: 786_432, contentType: 'image/jpeg' },
        { id: 'asset-2', name: 'team.webp', size: 245_760, contentType: 'image/webp' },
      ],
    },
    {
      page: 'cms:blog/dental-implants',
      totalSize: 1_048_576,
      assetCount: 1,
      assets: [{ id: 'asset-3', name: 'implant-diagram.png', size: 1_048_576, contentType: 'image/png' }],
    },
    {
      page: 'css:global-background',
      totalSize: 262_144,
      assetCount: 1,
      assets: [{ id: 'asset-4', name: 'pattern.svg', size: 262_144, contentType: 'image/svg+xml' }],
    },
  ],
};

const pages = [
  { id: 'page-home', title: 'Home', slug: '', publishedPath: '/' },
  { id: 'page-services', title: 'Services', slug: 'services', publishedPath: '/services' },
  { id: 'page-contact', title: 'Contact', slug: 'contact', publishedPath: '/contact' },
];

const mobilePageSpeed = {
  url: 'https://acme.com/services',
  page: 'Services',
  strategy: 'mobile',
  score: 72,
  vitals: { LCP: 3100, FID: 80, CLS: 0.12, FCP: 1900, INP: 240, SI: 4300, TBT: 260, TTI: 4200 },
  opportunities: [
    { id: 'modern-images', title: 'Serve images in next-gen formats', description: 'Image payload can be reduced.', savings: '420 KiB', score: 0.4 },
  ],
  diagnostics: [
    { id: 'dom-size', title: 'Avoid excessive DOM size', description: 'The page has a large DOM tree.', displayValue: '1,420 elements' },
  ],
  fetchedAt: '2026-07-06T15:00:00.000Z',
  fieldDataAvailable: true,
};

const desktopPageSpeed = {
  ...mobilePageSpeed,
  url: 'https://acme.com/',
  page: 'Home',
  strategy: 'desktop',
  score: 91,
  vitals: { LCP: 1700, FID: 30, CLS: 0.03, FCP: 1100, INP: 120, SI: 2100, TBT: 80, TTI: 2800 },
  fieldDataAvailable: false,
};

const mobileSiteSpeed = {
  siteId: 'site-1',
  strategy: 'mobile',
  pages: [mobilePageSpeed],
  averageScore: 72,
  averageVitals: mobilePageSpeed.vitals,
  testedAt: '2026-07-06T15:00:00.000Z',
};

const desktopSiteSpeed = {
  siteId: 'site-1',
  strategy: 'desktop',
  pages: [desktopPageSpeed],
  averageScore: 91,
  averageVitals: desktopPageSpeed.vitals,
  testedAt: '2026-07-06T16:00:00.000Z',
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

vi.mock('../../../src/hooks/admin', () => ({
  useWorkspaces: () => ({
    data: [workspace],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../src/api/seo', () => ({
  pageWeight: {
    webflowPageWeight: (...args: unknown[]) => pageWeightScanMock(...args),
    webflowPageWeightSnapshot: (...args: unknown[]) => pageWeightSnapshotMock(...args),
    pagespeedBulk: (...args: unknown[]) => pagespeedBulkMock(...args),
    pagespeedSingle: (...args: unknown[]) => pagespeedSingleMock(...args),
    pagespeedSnapshot: (...args: unknown[]) => pagespeedSnapshotMock(...args),
  },
  webflow: {
    pages: (...args: unknown[]) => webflowPagesMock(...args),
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

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderSurface(path = '/ws/ws-1/performance?tab=weight', queryClient = createQueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <LocationProbe />
          <PerformanceSurface workspaceId="ws-1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <span data-testid="location-path" hidden>{location.pathname}</span>
      <span data-testid="location-search" hidden>{location.search}</span>
    </>
  );
}

function FlaggedPerformance() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <PerformanceSurface workspaceId="ws-1" /> : <div data-testid="legacy-performance">Legacy Performance</div>;
}

function renderFlagged(queryClient = createQueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ws/ws-1/performance?tab=weight']}>
        <ToastProvider>
          <FlaggedPerformance />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagsListMock.mockReturnValue(new Promise(() => {}));
  pageWeightScanMock.mockResolvedValue(pageWeightResult);
  pageWeightSnapshotMock.mockResolvedValue({
    siteId: 'site-1',
    createdAt: '2026-07-06T14:30:00.000Z',
    result: pageWeightResult,
  });
  pagespeedSnapshotMock.mockImplementation((_siteId: string, _workspaceId: string, strategy: 'mobile' | 'desktop') => Promise.resolve({
    siteId: 'site-1',
    createdAt: strategy === 'desktop' ? '2026-07-06T16:00:00.000Z' : '2026-07-06T15:00:00.000Z',
    result: strategy === 'desktop' ? desktopSiteSpeed : mobileSiteSpeed,
  }));
  pagespeedBulkMock.mockImplementation((_siteId: string, strategy: 'mobile' | 'desktop') => (
    Promise.resolve(strategy === 'desktop' ? desktopSiteSpeed : mobileSiteSpeed)
  ));
  pagespeedSingleMock.mockResolvedValue(mobilePageSpeed);
  webflowPagesMock.mockResolvedValue(pages);
});

describe('PerformanceSurface rebuilt admin surface', () => {
  it('mounts through a real feature-flag loading to loaded transition', async () => {
    const queryClient = createQueryClient();
    renderFlagged(queryClient);

    expect(screen.getByTestId('legacy-performance')).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(queryKeys.shared.featureFlags(), { 'ui-rebuild-shell': true });
    });

    expect(await screen.findByRole('heading', { name: 'Performance' })).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-performance')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Page Weight/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('pilots the rebuilt admin page-header hierarchy', async () => {
    renderSurface('/ws/ws-1/performance');

    expect(await screen.findByRole('heading', { name: 'Performance', level: 2 })).toHaveClass('t-h1');
    expect(screen.getByText('Page weight and Core Web Vitals. Heavy pages fix in Asset Manager.')).toHaveClass('t-body');
  });

  it('receives the Page Weight deep link and supports search, source filtering, and detail inspection', async () => {
    renderSurface('/ws/ws-1/performance?tab=weight');

    expect(await screen.findByRole('radio', { name: /Page Weight/i })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('Pages with Assets')).toBeInTheDocument();
    const averageWeightTile = screen.getByText('Avg Page Weight').parentElement?.parentElement;
    expect(averageWeightTile?.querySelector('.t-stat')).toHaveStyle({ color: 'var(--blue)' });
    expect(screen.getByText('page:/services')).toBeInTheDocument();
    expect(screen.getByText(/Last scanned Jul 6, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Open Asset Manager to repair oversized files at the source before re-scanning.')).toHaveClass('t-body');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'implant' } });
    await waitFor(() => expect(screen.queryByText('page:/services')).not.toBeInTheDocument());
    expect(screen.getByText('cms:blog/dental-implants')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^CSS/ }));
    expect(screen.getByText('No pages match this view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('page:/services')).toBeInTheDocument();

    fireEvent.click(screen.getByText('page:/services'));
    const dialog = await screen.findByRole('dialog', { name: /page:\/services/i });
    expect(within(dialog).getByText('hero-services.jpg')).toBeInTheDocument();
    expect(within(dialog).getByText('>500KB')).toBeInTheDocument();
    expect(within(dialog).getByText('Assets over 500KB are emphasized because they are strong compression candidates.')).toHaveClass('t-body');
  });

  it('sends Page Weight repairs to the canonical Asset Manager filter', async () => {
    renderSurface('/ws/ws-1/performance?tab=weight');

    fireEvent.click(await screen.findByRole('button', { name: 'Open assets' }));
    expect(screen.getByTestId('location-path')).toHaveTextContent('/ws/ws-1/media');
    expect(screen.getByTestId('location-search')).toHaveTextContent(/^\?filter=oversized$/);
  });

  it('receives the Page Speed deep link and runs single-page and bulk PageSpeed tests', async () => {
    renderSurface('/ws/ws-1/performance?tab=speed');

    expect(await screen.findByRole('radio', { name: /Page Speed/i })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByLabelText('PageSpeed page')).toBeInTheDocument();
    expect(screen.getByText('Mobile average')).toBeInTheDocument();
    expect(screen.getByText('Field data')).toBeInTheDocument();
    expect(screen.getAllByText('Lighthouse performance score plus the full Core Web Vitals set.')[0]).toHaveClass('t-body');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'services' } });
    fireEvent.change(screen.getByLabelText('PageSpeed page'), { target: { value: 'page-services' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test Mobile' }));

    await waitFor(() => expect(pagespeedSingleMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('Single Page').length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole('button', { name: /Opportunities \(1\)/ }));
    expect(screen.getByText('Serve images in next-gen formats')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Diagnostics \(1\)/ }));
    expect(screen.getByText('Avoid excessive DOM size')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Bulk Top Pages/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Desktop' }));
    await waitFor(() => expect(pagespeedBulkMock).toHaveBeenCalledWith('site-1', 'desktop', 3, 'ws-1'));
    expect(await screen.findByText('Desktop average')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('keeps the PageSpeed workflow connected to the Asset Manager repair home', async () => {
    renderSurface('/ws/ws-1/performance?tab=speed');

    expect(await screen.findByLabelText('PageSpeed page')).toBeInTheDocument();
    expect(screen.getByText('Speed fixes start in Asset Manager')).toBeInTheDocument();
    expect(screen.getByText(/Use PageSpeed to identify Core Web Vitals issues/i)).toHaveClass('t-body');
    expect(screen.getByText(/repair oversized source files in Asset Manager before retesting/i)).toBeInTheDocument();
  });

  it('sends PageSpeed repairs to the canonical Asset Manager filter', async () => {
    renderSurface('/ws/ws-1/performance?tab=speed');

    fireEvent.click(await screen.findByRole('button', { name: 'Open assets' }));
    expect(screen.getByTestId('location-path')).toHaveTextContent('/ws/ws-1/media');
    expect(screen.getByTestId('location-search')).toHaveTextContent(/^\?filter=oversized$/);
  });

  it('falls back from a bad tab to Page Weight and can switch lenses at runtime', async () => {
    renderSurface('/ws/ws-1/performance?tab=unknown');

    expect(await screen.findByRole('radio', { name: /Page Weight/i })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Page Speed/i }));
    expect(await screen.findByRole('radio', { name: /Page Speed/i })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByLabelText('PageSpeed page')).toBeInTheDocument();
  });

  it('writes prototype tab state and clears the default Page Weight URL', async () => {
    renderSurface('/ws/ws-1/performance');

    expect(await screen.findByRole('radio', { name: /Page Weight/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('radio', { name: /Page Speed/i }));
    await screen.findByLabelText('PageSpeed page');
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=speed');

    fireEvent.click(screen.getByRole('radio', { name: /Page Weight/i }));
    expect(await screen.findByText('Pages with Assets')).toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
  });

  it('keeps internal implementation language out of PageSpeed detail copy', async () => {
    renderSurface('/ws/ws-1/performance?tab=speed');

    const servicesRows = await screen.findAllByText('Services');
    fireEvent.click(servicesRows[0]);
    const dialog = await screen.findByRole('dialog', { name: /services/i });

    expect(within(dialog).queryByText(/deferred|shared destination contract/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Most speed opportunities resolve in Asset Manager/i)).toBeInTheDocument();
  });

  it('meets the a11y floor after skeletons clear', async () => {
    const { container } = renderSurface('/ws/ws-1/performance?tab=speed');

    expect(await screen.findByRole('heading', { name: 'Performance' })).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelectorAll('.animate-pulse').length).toBe(0);
    });
    await expectNoA11yViolations(container);
  }, 15_000);
});
