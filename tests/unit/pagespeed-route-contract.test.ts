import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const routeSource = readFileSync(join(import.meta.dirname, '../../server/routes/webflow-pagespeed.ts'), 'utf-8'); // readFile-ok — route contract guard: single-page PageSpeed must resolve real workspace paths, not reconstruct URLs from raw slugs.
const panelSource = readFileSync(join(import.meta.dirname, '../../src/components/PageSpeedPanel.tsx'), 'utf-8'); // readFile-ok — caller contract guard: selected Webflow page id/path must reach the single-page PageSpeed route.

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
});
