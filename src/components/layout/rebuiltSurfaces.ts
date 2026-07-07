import type { ComponentType } from 'react';
import type { Page } from '../../routes';
import { lazyWithRetry } from '../../lib/lazyWithRetry';

/**
 * Registry of rebuilt (`@ds-rebuilt`) admin surfaces, keyed by `Page`.
 *
 * When `ui-rebuild-shell` is ON and the current tab has an entry here, `App.tsx`
 * mounts that surface inside `RebuiltAppChrome` (the DS-native shell) instead of the
 * legacy `<Sidebar>+<main>`; every other tab / flag-OFF falls through to the legacy
 * shell byte-identical.
 *
 * This is the fan-out seam: a Phase A surface becomes a ONE-LINE entry here — NOT a
 * new hardcoded branch in `App.tsx`. Keep the prop contract uniform (`workspaceId`)
 * so the mount stays generic.
 */
export type RebuiltSurfaceProps = { workspaceId: string };

export const REBUILT_SURFACES: Partial<Record<Page, ComponentType<RebuiltSurfaceProps>>> = {
  'seo-keywords': lazyWithRetry(() =>
    import('../keywords-rebuilt/KeywordsSurface').then(m => ({ default: m.KeywordsSurface })),
  ),
  'rewrite': lazyWithRetry(() =>
    import('../page-rewriter-rebuilt/PageRewriterSurface').then(m => ({ default: m.PageRewriterSurface })),
  ),
  'competitors': lazyWithRetry(() =>
    import('../competitors-rebuilt/CompetitorsSurface').then(m => ({ default: m.CompetitorsSurface })),
  ),
  'analytics-hub': lazyWithRetry(() =>
    import('../search-traffic-rebuilt/SearchTrafficSurface').then(m => ({ default: m.SearchTrafficSurface })),
  ),
};
