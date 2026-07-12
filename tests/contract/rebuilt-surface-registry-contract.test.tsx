// CONTRACT: ui-rebuild-shell dispatches through REBUILT_SURFACES rather than
// App.tsx's legacy branch chain. Keep the direct-mount census and every
// intentional non-mount explicit, then exercise the actual flag-on URL-state
// receivers so legacy receiver coverage cannot provide a false green.
//
// readFile-ok — Page union parsing and the Page Intelligence receiver seam are
// intentional static contract checks, matching nav-registry-completeness.test.ts.

import { readFileSync } from 'fs';
import { join } from 'path';
import { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { REBUILT_SURFACES } from '../../src/components/layout/rebuiltSurfaces';
import { useAssetManagerSurfaceState } from '../../src/components/asset-manager-rebuilt/useAssetManagerSurfaceState';
import { useBrandAiSurfaceState } from '../../src/components/brand-ai-rebuilt/useBrandAiSurfaceState';
import { useCockpitSurfaceState } from '../../src/components/cockpit-rebuilt/useCockpitSurfaceState';
import { useContentPipelineSurfaceState } from '../../src/components/content-pipeline-rebuilt/useContentPipelineSurfaceState';
import { useEngineSurfaceState } from '../../src/components/engine-rebuilt/useEngineSurfaceState';
import {
  useBusinessTabState,
  useRequestsTabState,
  useWorkspaceSettingsTabState,
} from '../../src/components/global-ops-rebuilt/useGlobalOpsSurfaceState';
import { useKeywordsSurfaceState } from '../../src/components/keywords-rebuilt/useKeywordsSurfaceState';
import { useLinksSurfaceState } from '../../src/components/links-rebuilt/useLinksSurfaceState';
import { resolvePageIntelligenceTab } from '../../src/components/page-intelligence-rebuilt/pageIntelligenceRouting';
import { usePerformanceSurfaceState } from '../../src/components/performance-rebuilt/usePerformanceSurfaceState';
import { useSchemaSurfaceState } from '../../src/components/schema-rebuilt/useSchemaSurfaceState';
import { useSeoEditorSurfaceState } from '../../src/components/seo-editor-rebuilt/useSeoEditorSurfaceState';
import type { Page } from '../../src/routes';

const ROOT = join(__dirname, '../..');
const ROUTES_FILE = join(ROOT, 'src/routes.ts');
const PAGE_INTELLIGENCE_SURFACE_FILE = join(ROOT, 'src/components/page-intelligence-rebuilt/PageIntelligenceSurface.tsx');

const DIRECT_REBUILT_MOUNTS = [
  'home',
  'media',
  'seo-audit',
  'seo-editor',
  'links',
  'seo-strategy',
  'seo-keywords',
  'page-intelligence',
  'local-seo',
  'seo-schema',
  'competitors',
  'brand',
  'content-pipeline',
  'analytics-hub',
  'performance',
  'rewrite',
  'workspace-settings',
  'prospect',
  'roadmap',
  'ai-usage',
  'requests',
  'settings',
  'revenue',
  'features',
  'outcomes',
  'outcomes-overview',
  'diagnostics',
] as const satisfies readonly Page[];

const DOCUMENTED_NON_MOUNTS = [
  { page: 'seo-briefs', disposition: 'folded', target: 'content-pipeline?tab=briefs' },
  { page: 'content', disposition: 'folded', target: 'content-pipeline?tab=posts' },
  { page: 'calendar', disposition: 'folded', target: 'content-pipeline?tab=calendar' },
  { page: 'content-perf', disposition: 'folded', target: 'content-pipeline?tab=published' },
  { page: 'subscriptions', disposition: 'legacy', target: 'subscriptions' },
] as const satisfies ReadonlyArray<{
  page: Page;
  disposition: 'folded' | 'legacy';
  target: string;
}>;

const FLAG_ON_TAB_RECEIVER_PAGES = [
  'home',
  'media',
  'seo-editor',
  'links',
  'seo-strategy',
  'seo-keywords',
  'page-intelligence',
  'seo-schema',
  'brand',
  'content-pipeline',
  'performance',
  'workspace-settings',
  'requests',
  'revenue',
] as const satisfies readonly Page[];

function parsePageUnion(): string[] {
  const source = readFileSync(ROUTES_FILE, 'utf8');
  const match = source.match(/export type Page\s*=([\s\S]*?);/);
  if (!match) throw new Error('Could not locate the Page union in src/routes.ts');
  return [...new Set(match[1].match(/'([^']+)'/g)?.map(value => value.slice(1, -1)) ?? [])];
}

function routerWrapper(initialEntry: string) {
  return function RouterWrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

describe('rebuilt surface registry contract', () => {
  it('pins every intended direct mount exactly once', () => {
    expect(Object.keys(REBUILT_SURFACES).sort()).toEqual([...DIRECT_REBUILT_MOUNTS].sort());
    expect(new Set(DIRECT_REBUILT_MOUNTS).size).toBe(DIRECT_REBUILT_MOUNTS.length);
  });

  it('partitions the complete Page union into direct mounts and documented folded/legacy non-mounts', () => {
    const pageUnion = parsePageUnion().sort();
    const direct = new Set<string>(DIRECT_REBUILT_MOUNTS);
    const nonMounts = DOCUMENTED_NON_MOUNTS.map(entry => entry.page);

    expect(nonMounts.filter(page => direct.has(page))).toEqual([]);
    expect([...DIRECT_REBUILT_MOUNTS, ...nonMounts].sort()).toEqual(pageUnion);
  });

  it('keeps every declared flag-on tab receiver on a direct rebuilt mount', () => {
    const direct = new Set<Page>(DIRECT_REBUILT_MOUNTS);
    expect(FLAG_ON_TAB_RECEIVER_PAGES.filter(page => !direct.has(page))).toEqual([]);
  });

  it('initializes simple mounted surface state from ?tab=', () => {
    expect(renderHook(useAssetManagerSurfaceState, { wrapper: routerWrapper('/ws/ws-1/media?tab=audit') }).result.current.lens).toBe('audit');
    expect(renderHook(useBrandAiSurfaceState, { wrapper: routerWrapper('/ws/ws-1/brand?tab=identity') }).result.current.tab).toBe('identity');
    expect(renderHook(useCockpitSurfaceState, { wrapper: routerWrapper('/ws/ws-1?tab=meeting-brief') }).result.current.retiredTab).toBe('meeting-brief');
    expect(renderHook(useContentPipelineSurfaceState, { wrapper: routerWrapper('/ws/ws-1/content-pipeline?tab=planner') }).result.current.tab).toBe('planner');
    expect(renderHook(useLinksSurfaceState, { wrapper: routerWrapper('/ws/ws-1/links?tab=dead-links') }).result.current.tab).toBe('dead-links');
    expect(renderHook(usePerformanceSurfaceState, { wrapper: routerWrapper('/ws/ws-1/performance?tab=speed') }).result.current.lens).toBe('speed');
    expect(renderHook(useSchemaSurfaceState, { wrapper: routerWrapper('/ws/ws-1/seo-schema?tab=guide') }).result.current.tab).toBe('guide');
    expect(renderHook(useSeoEditorSurfaceState, { wrapper: routerWrapper('/ws/ws-1/seo-editor?tab=research') }).result.current.tab).toBe('research');
    expect(renderHook(useWorkspaceSettingsTabState, { wrapper: routerWrapper('/ws/ws-1/workspace-settings?tab=dashboard') }).result.current.tab).toBe('dashboard');
    expect(renderHook(useRequestsTabState, { wrapper: routerWrapper('/ws/ws-1/requests?tab=requests') }).result.current.tab).toBe('requests');
    expect(renderHook(useBusinessTabState, { wrapper: routerWrapper('/revenue?tab=ai-usage') }).result.current.tab).toBe('ai-usage');
  });

  it('initializes the Keyword Hub segment from its shared ?tab= contract', () => {
    const { result } = renderHook(useKeywordsSurfaceState, {
      wrapper: routerWrapper('/ws/ws-1/seo-keywords?tab=striking_distance'),
    });
    expect(result.current.filter).toBe('striking_distance');
  });

  it('consumes legacy Engine ?tab= links inside the mounted receiver', async () => {
    const { result } = renderHook(() => ({
      engine: useEngineSurfaceState('ws-1'),
      location: useLocation(),
    }), {
      wrapper: routerWrapper('/ws/ws-1/seo-strategy?tab=competitive'),
    });

    await waitFor(() => {
      expect(result.current.location.pathname).toBe('/ws/ws-1/competitors');
    });
  });

  it('keeps Page Intelligence wired to its ?tab= resolver', () => {
    expect(resolvePageIntelligenceTab('architecture')).toBe('architecture');
    const source = readFileSync(PAGE_INTELLIGENCE_SURFACE_FILE, 'utf8');
    expect(source).toContain("resolvePageIntelligenceTab(searchParams.get('tab'))");
  });
});
