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
  'media': lazyWithRetry(() =>
    import('../asset-manager-rebuilt/AssetManagerSurface').then(m => ({ default: m.AssetManagerSurface })),
  ),
  'local-seo': lazyWithRetry(() =>
    import('../local-presence-rebuilt/LocalPresenceSurface').then(m => ({ default: m.LocalPresenceSurface })),
  ),
  'performance': lazyWithRetry(() =>
    import('../performance-rebuilt/PerformanceSurface').then(m => ({ default: m.PerformanceSurface })),
  ),
  'links': lazyWithRetry(() =>
    import('../links-rebuilt/LinksSurface').then(m => ({ default: m.LinksSurface })),
  ),
  'seo-schema': lazyWithRetry(() =>
    import('../schema-rebuilt/SchemaSurface').then(m => ({ default: m.SchemaSurface })),
  ),
  'brand': lazyWithRetry(() =>
    import('../brand-ai-rebuilt/BrandAiSurface').then(m => ({ default: m.BrandAiSurface })),
  ),
  'content-pipeline': lazyWithRetry(() =>
    import('../content-pipeline-rebuilt/ContentPipelineSurface').then(m => ({ default: m.ContentPipelineSurface })),
  ),
  'seo-editor': lazyWithRetry(() =>
    import('../seo-editor-rebuilt/SeoEditorSurface').then(m => ({ default: m.SeoEditorSurface })),
  ),
  'seo-audit': lazyWithRetry(() =>
    import('../site-audit-rebuilt/SiteAuditSurface').then(m => ({ default: m.SiteAuditSurface })),
  ),
  'home': lazyWithRetry(() =>
    import('../cockpit-rebuilt/CockpitSurface').then(m => ({ default: m.CockpitSurface })),
  ),
  'seo-strategy': lazyWithRetry(() =>
    import('../engine-rebuilt/EngineSurface').then(m => ({ default: m.EngineSurface })),
  ),
  'settings': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.GlobalSettingsSurface })),
  ),
  'workspace-settings': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.WorkspaceSettingsSurface })),
  ),
  'roadmap': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.RoadmapSurface })),
  ),
  'revenue': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.RevenueBusinessSurface })),
  ),
  'ai-usage': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.AiUsageBusinessSurface })),
  ),
  'features': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.FeatureLibraryBusinessSurface })),
  ),
  'prospect': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.ProspectBusinessSurface })),
  ),
  'outcomes-overview': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.OutcomesOverviewSurface })),
  ),
  'outcomes': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.OutcomeWorkspaceSurface })),
  ),
  'diagnostics': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.DiagnosticsSurface })),
  ),
  'requests': lazyWithRetry(() =>
    import('../global-ops-rebuilt').then(m => ({ default: m.RequestsSurface })),
  ),
};
