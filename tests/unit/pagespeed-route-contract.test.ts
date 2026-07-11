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
});
