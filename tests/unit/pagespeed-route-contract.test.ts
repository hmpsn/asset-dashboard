import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const routeSource = readFileSync(join(import.meta.dirname, '../../server/routes/webflow-pagespeed.ts'), 'utf-8'); // readFile-ok — route contract guard: single-page PageSpeed must resolve real workspace paths, not reconstruct URLs from raw slugs.
const panelSource = readFileSync(join(import.meta.dirname, '../../src/components/PageSpeedPanel.tsx'), 'utf-8'); // readFile-ok — caller contract guard: selected Webflow page id/path must reach the single-page PageSpeed route.

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_LOCAL_FAKE_PROVIDERS = process.env.LOCAL_FAKE_PROVIDERS;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  process.env.LOCAL_FAKE_PROVIDERS = ORIGINAL_LOCAL_FAKE_PROVIDERS;
  vi.unstubAllGlobals();
});

describe('single-page PageSpeed route contract', () => {
  it('resolves tested URLs from workspace page metadata', () => {
    expect(routeSource).toContain('getWorkspacePages');
    expect(routeSource).toContain('resolvePagePath');
    expect(routeSource).toContain('normalizePageUrl(pageSlug)');
    expect(routeSource).toContain('resolveBaseUrl');
    expect(routeSource).toContain('pageId');
    expect(routeSource).toContain('runSinglePageSpeed(url, resolvedStrategy');
  });

  it('does not reconstruct single-page URLs from invalid Webflow shortName fragments', () => {
    expect(routeSource).not.toMatch(/https:\/\/api\.webflow\.com\/v2\/sites\/\$\{siteId\}/);
    expect(routeSource).not.toContain('shortName');
    expect(routeSource).not.toContain('webflow.io/${pageSlug}');
  });

  it('passes page id and published path from the PageSpeed panel', () => {
    expect(panelSource).toContain('pageId: page.id');
    expect(panelSource).toContain('pageSlug: page.publishedPath ?? page.slug');
    expect(panelSource).toContain('pageWeight.pagespeedSingle');
  });

  it('serves deterministic PageSpeed reads only for the explicit provider-rich site and domain', async () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_FAKE_PROVIDERS = 'true';
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);

    const { LOCAL_PROVIDER_FIXTURE } = await import('../../server/providers/local-provider-fixtures.js');
    const { runSinglePageSpeed, runSiteSpeed } = await import('../../server/pagespeed.js');

    const single = await runSinglePageSpeed(
      `https://${LOCAL_PROVIDER_FIXTURE.domain}/services/seo`,
      'mobile',
      'SEO Services',
    );
    const site = await runSiteSpeed(
      LOCAL_PROVIDER_FIXTURE.siteId,
      'desktop',
      3,
      LOCAL_PROVIDER_FIXTURE.workspaceId,
    );

    expect(single).toMatchObject({
      strategy: 'mobile',
      page: 'SEO Services',
      fieldDataAvailable: true,
    });
    expect(single?.score).toBeGreaterThan(0);
    expect(single?.opportunities.length).toBeGreaterThan(0);
    expect(site.pages).toHaveLength(3);
    expect(site.averageScore).toBeGreaterThan(0);
    expect(site.pages.map((page) => page.url.includes(LOCAL_PROVIDER_FIXTURE.domain))).toEqual([true, true, true]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('returns an error and preserves the prior snapshot when every bulk PageSpeed page fails', async () => {
    vi.resetModules();
    const priorSnapshot = {
      siteId: 'site-pagespeed-failure',
      createdAt: '2026-07-15T12:00:00.000Z',
      result: { pages: [{ url: 'https://example.com/', score: 88 }] },
    };
    let savedSnapshot = priorSnapshot;
    const savePageSpeed = vi.fn((_siteId: string, _strategy: string, result: unknown) => {
      savedSnapshot = { ...priorSnapshot, result: result as typeof priorSnapshot.result };
    });

    vi.doMock('../../server/pagespeed.js', () => ({
      runSiteSpeed: vi.fn(async () => ({
        siteId: 'site-pagespeed-failure',
        strategy: 'mobile',
        pages: [],
        averageScore: 0,
        averageVitals: { LCP: null, FID: null, CLS: null, FCP: null, INP: null, SI: null, TBT: null, TTI: null },
        testedAt: '2026-07-16T12:00:00.000Z',
      })),
      runSinglePageSpeed: vi.fn(),
    }));
    vi.doMock('../../server/performance-store.js', () => ({
      savePageSpeed,
      getPageSpeed: vi.fn(() => savedSnapshot),
      saveSinglePageSpeed: vi.fn(),
    }));
    vi.doMock('../../server/auth.js', () => ({
      requireWorkspaceSiteAccessFromQuery: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
      requireWorkspaceSiteAccess: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
    }));
    vi.doMock('../../server/workspaces.js', () => ({
      getWorkspaceBySiteId: vi.fn(() => ({ id: 'ws-pagespeed-failure' })),
      getWorkspace: vi.fn(),
      getTokenForSite: vi.fn(),
    }));
    vi.doMock('../../server/intelligence/cache-invalidation.js', () => ({
      invalidateIntelligenceCache: vi.fn(),
    }));

    const { default: pageSpeedRouter } = await import('../../server/routes/webflow-pagespeed.js');
    type RouteHandler = (
      req: { params: Record<string, string>; query: Record<string, string> },
      res: { status: (code: number) => unknown; json: (body: unknown) => unknown },
    ) => Promise<unknown>;
    type RouterLayer = {
      route?: { path: string; stack: Array<{ handle: RouteHandler }> };
    };
    const layers = (pageSpeedRouter as unknown as { stack: RouterLayer[] }).stack;
    const bulkLayer = layers.find((layer) => layer.route?.path === '/api/webflow/pagespeed/:siteId');
    const handler = bulkLayer?.route?.stack.at(-1)?.handle;
    expect(handler).toBeDefined();
    let status = 200;
    let body: unknown;
    const response = {
      status: (code: number) => {
        status = code;
        return response;
      },
      json: (value: unknown) => {
        body = value;
        return response;
      },
    };

    try {
      await handler?.(
        { params: { siteId: 'site-pagespeed-failure' }, query: { workspaceId: 'ws-pagespeed-failure' } },
        response,
      );

      expect(status).toBeGreaterThanOrEqual(400);
      expect(body).toMatchObject({ error: expect.stringContaining('No pages could be tested') });
      expect(savePageSpeed).not.toHaveBeenCalled();
      expect(savedSnapshot).toBe(priorSnapshot);
    } finally {
      vi.doUnmock('../../server/pagespeed.js');
      vi.doUnmock('../../server/performance-store.js');
      vi.doUnmock('../../server/auth.js');
      vi.doUnmock('../../server/workspaces.js');
      vi.doUnmock('../../server/intelligence/cache-invalidation.js');
      vi.resetModules();
    }
  });
});
