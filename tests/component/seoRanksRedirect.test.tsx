/**
 * seoRanksRedirect.test.tsx — Phase P4-T4.
 *
 * The Rank Tracker fold-in is FLAG-GATED behind `keyword-hub` for flag-OFF
 * byte-identity:
 *   - flag OFF  → /ws/:id/seo-ranks renders the standalone <RankTracker> grid
 *                 (no redirect).
 *   - flag ON   → /ws/:id/seo-ranks redirects to /ws/:id/seo-keywords (the Hub),
 *                 NOT the RankTracker grid (bookmark preserved, no 404/blank).
 *
 * Renders the REAL App `Dashboard` (exported for this test) so the real
 * renderContent() routing is exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { featureFlagMock } = vi.hoisted(() => ({ featureFlagMock: vi.fn() }));

// The real App `Dashboard` fires a relative-URL fetch in a useEffect
// (`get('/api/workspace-badges/:id')`). In the jsdom component env `fetch` is
// Node's global undici, which rejects relative URLs ("Failed to parse URL").
// The app code `.catch`es it, but the doomed request adds console noise and a
// guaranteed-rejected promise that flakes the render/waitFor timing under load.
// Stub fetch so the badges call resolves cleanly — all data hooks are already
// mocked, so this is the only un-mocked network call in the rendered tree.
const fetchStub = vi.fn(async () =>
  new Response(JSON.stringify({ pendingRequests: 0, hasContent: false }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }),
);

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...args),
}));

// lazy components resolve immediately
vi.mock('../../src/lib/lazyWithRetry', () => ({
  lazyWithRetry: (loader: () => Promise<{ default: React.ComponentType }>) => {
    const { lazy } = require('react');
    return lazy(loader);
  },
}));

// ── page stubs (the seo-ranks / seo-keywords targets) ────────────────────────
vi.mock('../../src/components/RankTracker', () => ({ RankTracker: () => <div data-testid="rank-tracker" /> }));
vi.mock('../../src/components/KeywordHub', () => ({ KeywordHub: () => <div data-testid="keyword-hub" /> }));
vi.mock('../../src/components/KeywordCommandCenter', () => ({ KeywordCommandCenter: () => <div data-testid="keyword-command-center" /> }));

// ── always-rendered chrome stubs ─────────────────────────────────────────────
vi.mock('../../src/components/layout/Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('../../src/components/layout/Breadcrumbs', () => ({ Breadcrumbs: () => <div data-testid="breadcrumbs" /> }));
vi.mock('../../src/components/StatusBar', () => ({ StatusBar: () => <div data-testid="status-bar" /> }));
vi.mock('../../src/components/CommandPalette', () => ({ CommandPalette: () => <div data-testid="command-palette" /> }));
vi.mock('../../src/components/AdminChat', () => ({ AdminChat: () => null }));
vi.mock('../../src/components/ui/ScannerReveal', () => ({ ScannerReveal: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));

const mockWorkspaces = [
  {
    id: 'ws-1', name: 'Acme', folder: 'acme', webflowSiteId: 'site-1', webflowSiteName: 'acme.com',
    createdAt: '2025-01-01', gscPropertyUrl: null, ga4PropertyId: null, businessProfile: null, intelligenceProfile: null,
  },
];

vi.mock('../../src/hooks/admin', () => ({
  useWorkspaces: () => ({ data: mockWorkspaces }),
  useCreateWorkspace: () => ({ mutateAsync: vi.fn() }),
  useDeleteWorkspace: () => ({ mutateAsync: vi.fn() }),
  useLinkSite: () => ({ mutateAsync: vi.fn() }),
  useUnlinkSite: () => ({ mutateAsync: vi.fn() }),
  useHealthCheck: () => ({ data: { hasOpenAIKey: false, hasWebflowToken: true }, isSuccess: true }),
  useQueue: () => ({ data: [] }),
  useWorkspaceBadges: () => ({ data: { pendingRequests: 0, hasContent: false } }),
  WORKSPACES_KEY: ['admin-workspaces'],
  QUEUE_KEY: ['admin-queue'],
}));

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location" data-path={loc.pathname + loc.search} />;
}

async function renderAt(path: string) {
  const { Dashboard } = await import('../../src/App');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/*" element={<Dashboard onLogout={vi.fn()} theme="dark" toggleTheme={vi.fn()} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('seo-ranks fold-in redirect (flag-gated)', () => {
  beforeEach(() => {
    featureFlagMock.mockReset();
    fetchStub.mockClear();
    vi.stubGlobal('fetch', fetchStub);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('flag ON: /seo-ranks redirects to /seo-keywords (Hub), NOT the RankTracker grid', async () => {
    featureFlagMock.mockReturnValue(true); // keyword-hub ON
    await renderAt('/ws/ws-1/seo-ranks');
    await waitFor(() => {
      expect(screen.getByTestId('location').getAttribute('data-path')).toBe('/ws/ws-1/seo-keywords');
    });
    expect(screen.queryByTestId('rank-tracker')).toBeNull();
    expect(screen.getByTestId('keyword-hub')).toBeInTheDocument();
  });

  it('flag OFF: /seo-ranks renders the RankTracker grid, NO redirect (byte-identical)', async () => {
    featureFlagMock.mockReturnValue(false); // keyword-hub OFF
    await renderAt('/ws/ws-1/seo-ranks');
    await waitFor(() => expect(screen.getByTestId('rank-tracker')).toBeInTheDocument());
    expect(screen.getByTestId('location').getAttribute('data-path')).toBe('/ws/ws-1/seo-ranks');
  });

  it('flag ON: /seo-ranks?q=foo&tab=tracked redirects to /seo-keywords?q=foo&tab=tracked (query params preserved)', async () => {
    featureFlagMock.mockReturnValue(true); // keyword-hub ON
    await renderAt('/ws/ws-1/seo-ranks?q=foo&tab=tracked');
    await waitFor(() => {
      expect(screen.getByTestId('location').getAttribute('data-path')).toBe('/ws/ws-1/seo-keywords?q=foo&tab=tracked');
    });
    expect(screen.queryByTestId('rank-tracker')).toBeNull();
    expect(screen.getByTestId('keyword-hub')).toBeInTheDocument();
  });
});
