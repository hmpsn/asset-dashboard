// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components/Toast';
import { LinksSurface } from '../../../src/components/links-rebuilt/LinksSurface';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { expectNoA11yViolations } from '../a11y';

const workspacesMock = vi.fn();
const featureFlagsListMock = vi.fn();
const redirectSnapshotMock = vi.fn();
const redirectScanMock = vi.fn();
const internalSnapshotMock = vi.fn();
const internalAnalyzeMock = vi.fn();
const linkDomainsMock = vi.fn();
const linkSnapshotMock = vi.fn();
const linkCheckMock = vi.fn();
const architectureMock = vi.fn();
const schemaCoverageMock = vi.fn();
const clientActionCreateMock = vi.fn();

const workspace = {
  id: 'ws-1',
  name: 'Acme Dental',
  webflowSiteId: 'site-1',
  webflowSiteName: 'acme.com',
};

const redirectResult = {
  chains: [
    {
      originalUrl: 'https://acme.com/old-service',
      hops: [
        { url: 'https://acme.com/old-service', status: 301 },
        { url: 'https://acme.com/intermediate', status: 302 },
      ],
      finalUrl: 'https://acme.com/services',
      totalHops: 2,
      isLoop: false,
      foundOn: ['/'],
      type: 'internal',
    },
  ],
  pageStatuses: [
    {
      url: 'https://acme.com/',
      path: '/',
      title: 'Home',
      status: 200,
      statusText: 'OK',
      source: 'static',
    },
    {
      url: 'https://acme.com/old-service',
      path: '/old-service',
      title: 'Old Service',
      status: 404,
      statusText: 'Not found',
      source: 'gsc',
      recommendedTarget: '/services',
      recommendedReason: 'Closest live service page.',
    },
    {
      url: 'https://acme.com/blog',
      path: '/blog',
      title: 'Blog',
      status: 301,
      statusText: 'Moved',
      source: 'cms',
      redirectsTo: 'https://acme.com/articles',
    },
  ],
  summary: {
    totalPages: 3,
    healthy: 1,
    redirecting: 1,
    notFound: 1,
    errors: 0,
    chainsDetected: 1,
    longestChain: 2,
  },
  scannedAt: '2026-07-07T15:00:00.000Z',
};

const internalResult = {
  suggestions: [
    {
      fromPage: '/services',
      fromTitle: 'Services',
      toPage: '/cosmetic-dentistry',
      toTitle: 'Cosmetic Dentistry',
      anchorText: 'cosmetic dentistry',
      reason: 'The services page introduces this offer but does not link to the detail page.',
      priority: 'high' as const,
    },
    {
      fromPage: '/about',
      fromTitle: 'About',
      toPage: '/team',
      toTitle: 'Team',
      anchorText: 'our team',
      reason: 'The about page mentions the team without linking to staff profiles.',
      priority: 'medium' as const,
    },
  ],
  pageCount: 4,
  attemptedPageCount: 5,
  existingLinkCount: 18,
  analyzedAt: '2026-07-07T14:00:00.000Z',
  pageHealth: [
    { path: '/services', title: 'Services', outboundLinks: 3, inboundLinks: 4, score: 82, isOrphan: false },
    { path: '/new-patient', title: 'New Patient', outboundLinks: 1, inboundLinks: 0, score: 42, isOrphan: true },
  ],
  orphanCount: 1,
};

const linkCheckResult = {
  totalLinks: 12,
  healthy: 9,
  deadLinks: [
    {
      url: 'https://example.com/dead',
      status: 404,
      statusText: 'Not found',
      foundOn: 'Services',
      foundOnSlug: 'services',
      anchorText: 'old partner',
      type: 'external' as const,
    },
  ],
  redirects: [
    {
      url: 'https://acme.com/old-blog',
      status: 301,
      statusText: 'Moved permanently',
      foundOn: 'Home',
      foundOnSlug: '',
      anchorText: 'blog',
      type: 'internal' as const,
    },
  ],
  checkedAt: '2026-07-07T13:00:00.000Z',
  crawledDomain: 'https://acme.com',
};

const architectureResult = {
  tree: {
    path: '/',
    name: 'Home',
    source: 'existing' as const,
    children: [
      {
        path: '/services',
        name: 'Services',
        source: 'existing' as const,
        children: [
          {
            path: '/cosmetic-dentistry',
            name: 'Cosmetic Dentistry',
            source: 'strategy' as const,
            keyword: 'cosmetic dentist',
            children: [],
            depth: 2,
            hasContent: true,
          },
        ],
        depth: 1,
        hasContent: true,
      },
      {
        path: '/dental-implants',
        name: 'Dental Implants',
        source: 'gap' as const,
        children: [],
        depth: 1,
        hasContent: false,
      },
    ],
    depth: 0,
    hasContent: true,
  },
  totalPages: 3,
  existingPages: 2,
  plannedPages: 0,
  strategyPages: 1,
  gaps: [
    {
      parentPath: '/services',
      suggestedPath: '/dental-implants',
      reason: 'Implants are a service gap from keyword strategy.',
      priority: 'high' as const,
    },
  ],
  depthDistribution: { 0: 1, 1: 2, 2: 1 },
  orphanPaths: ['/new-patient'],
  analyzedAt: '2026-07-07T12:00:00.000Z',
};

const schemaCoverageResult = {
  totalExisting: 2,
  withSchema: 1,
  withoutSchema: 1,
  coveragePct: 50,
  snapshotDate: '2026-07-07T12:30:00.000Z',
  hasPlan: true,
  hasLinkData: true,
  pages: [
    {
      path: '/services',
      name: 'Services',
      hasSchema: true,
      schemaTypes: ['Service'],
      role: 'hub',
      depth: 1,
      pageType: 'service',
      inboundLinks: 4,
      outboundLinks: 3,
      isOrphan: false,
      linkScore: 82,
      priority: 'done' as const,
    },
    {
      path: '/cosmetic-dentistry',
      name: 'Cosmetic Dentistry',
      hasSchema: false,
      schemaTypes: [],
      role: 'service',
      depth: 2,
      pageType: 'service',
      inboundLinks: 1,
      outboundLinks: 2,
      isOrphan: false,
      linkScore: 64,
      priority: 'high' as const,
    },
  ],
  priorityQueue: [
    {
      path: '/cosmetic-dentistry',
      name: 'Cosmetic Dentistry',
      hasSchema: false,
      schemaTypes: [],
      priority: 'high' as const,
      inboundLinks: 1,
      isOrphan: false,
      linkScore: 64,
    },
  ],
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  URL.createObjectURL = vi.fn(() => 'blob:links');
  URL.revokeObjectURL = vi.fn();
});

vi.mock('../../../src/hooks/admin', () => ({
  useWorkspaces: () => workspacesMock(),
}));

vi.mock('../../../src/api/misc', () => ({
  featureFlags: {
    list: () => featureFlagsListMock(),
  },
  redirects: {
    snapshot: (...args: unknown[]) => redirectSnapshotMock(...args),
    scan: (...args: unknown[]) => redirectScanMock(...args),
  },
}));

vi.mock('../../../src/api/seo', () => ({
  webflow: {
    internalLinksSnapshot: (...args: unknown[]) => internalSnapshotMock(...args),
    internalLinksWithParams: (...args: unknown[]) => internalAnalyzeMock(...args),
    linkCheckDomains: (...args: unknown[]) => linkDomainsMock(...args),
    linkCheckSnapshot: (...args: unknown[]) => linkSnapshotMock(...args),
    linkCheck: (...args: unknown[]) => linkCheckMock(...args),
  },
}));

vi.mock('../../../src/api/content', () => ({
  siteArchitecture: {
    get: (...args: unknown[]) => architectureMock(...args),
    schemaCoverage: (...args: unknown[]) => schemaCoverageMock(...args),
  },
}));

vi.mock('../../../src/api/clientActions', () => ({
  clientActions: {
    create: (...args: unknown[]) => clientActionCreateMock(...args),
  },
}));

function defaultWorkspaces() {
  return {
    data: [workspace],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function setupApiMocks() {
  workspacesMock.mockReturnValue(defaultWorkspaces());
  featureFlagsListMock.mockResolvedValue({ 'ui-rebuild-shell': true });
  redirectSnapshotMock.mockResolvedValue({ result: redirectResult, createdAt: redirectResult.scannedAt });
  redirectScanMock.mockResolvedValue(redirectResult);
  internalSnapshotMock.mockResolvedValue({ result: internalResult });
  internalAnalyzeMock.mockResolvedValue(internalResult);
  linkDomainsMock.mockResolvedValue({
    staging: 'https://acme.webflow.io',
    customDomains: ['https://acme.com'],
    defaultDomain: 'https://acme.com',
  });
  linkSnapshotMock.mockResolvedValue({ result: linkCheckResult, createdAt: linkCheckResult.checkedAt });
  linkCheckMock.mockResolvedValue(linkCheckResult);
  architectureMock.mockResolvedValue(architectureResult);
  schemaCoverageMock.mockResolvedValue(schemaCoverageResult);
  clientActionCreateMock.mockResolvedValue({ id: 'action-1' });
}

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderSurface(initialEntry = '/ws/ws-1/links', client = createClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <LinksSurface workspaceId="ws-1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function FlaggedLinksHarness() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <LinksSurface workspaceId="ws-1" /> : <div data-testid="legacy-links">Legacy Links</div>;
}

function renderFlagHarness(client = createClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/ws/ws-1/links']}>
        <ToastProvider>
          <FlaggedLinksHarness />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LinksSurface rebuilt admin surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMocks();
  });

  it('mounts after the real feature-flag hook transitions from loading fallback to ON', async () => {
    let resolveFlags: (value: { 'ui-rebuild-shell': boolean }) => void = () => {};
    featureFlagsListMock.mockReturnValue(new Promise((resolve) => {
      resolveFlags = resolve;
    }));

    renderFlagHarness();

    expect(screen.getByTestId('legacy-links')).toBeInTheDocument();

    await act(async () => {
      resolveFlags({ 'ui-rebuild-shell': true });
    });

    expect(await screen.findByRole('heading', { name: 'Links' })).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-links')).not.toBeInTheDocument();
  });

  it('receives ?tab=redirects and renders redirect recommendations, chains, and the all-pages table', async () => {
    renderSurface('/ws/ws-1/links?tab=redirects');

    expect(await screen.findByRole('radio', { name: /Redirects/i })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('Redirect recommendations')).toBeInTheDocument();
    expect(screen.getAllByText('/old-service').length).toBeGreaterThan(0);
    expect(screen.getByText('Redirect chains')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Match' })).toBeInTheDocument();
  });

  it('receives ?tab=internal and keeps list/grouped views plus the client-send batch action', async () => {
    renderSurface('/ws/ws-1/links?tab=internal');

    expect(await screen.findByRole('radio', { name: /Internal Links/i })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText(/cosmetic dentistry/)).toBeInTheDocument();
    expect(screen.getAllByText('Orphan pages').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('radio', { name: 'By source' }));
    expect(await screen.findByText('Services')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Send recommendations to client'));
    fireEvent.click(screen.getByRole('button', { name: /Send to client/i }));

    await waitFor(() => {
      expect(clientActionCreateMock).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ sourceType: 'internal_link' }),
      );
    });
  });

  it('receives ?tab=dead-links, shows the domain-aware link check, and supports session reviewed state', async () => {
    renderSurface('/ws/ws-1/links?tab=dead-links');

    expect(await screen.findByRole('radio', { name: /Dead Links/i })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByLabelText('Crawl domain')).toHaveValue('https://acme.com');
    expect(await screen.findByText('https://example.com/dead')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByRole('button', { name: 'Reviewed' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByText('https://example.com/dead'));
    const dialog = await screen.findByRole('dialog', { name: /example.com\/dead/i });
    expect(within(dialog).getByText('Redirect action')).toBeInTheDocument();
  });

  it('keeps the legacy ?tab=dead alias and bad-param fallback receiver behavior', async () => {
    const { unmount } = renderSurface('/ws/ws-1/links?tab=dead');
    expect(await screen.findByRole('radio', { name: /Dead Links/i })).toHaveAttribute('aria-checked', 'true');
    unmount();

    renderSurface('/ws/ws-1/links?tab=missing');
    expect(await screen.findByRole('radio', { name: /Redirects/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('receives ?tab=architecture and carries architecture filters plus schema coverage', async () => {
    renderSurface('/ws/ws-1/links?tab=architecture&source=gap&search=implants');

    expect(await screen.findByRole('radio', { name: /Architecture/i })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('Schema priority queue')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Gaps/i }).some((button) => button.getAttribute('aria-pressed') === 'true')).toBe(true);
    expect(screen.getByText('Dental Implants')).toBeInTheDocument();
  });

  it('meets the a11y floor after skeletons settle', async () => {
    const { container } = renderSurface('/ws/ws-1/links?tab=dead-links');

    await screen.findByText('https://example.com/dead');
    await waitFor(() => {
      expect(container.querySelectorAll('.animate-pulse').length).toBe(0);
    });

    await expectNoA11yViolations(container);
  }, 15_000);
});
