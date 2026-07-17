// src/lib/navRegistry.tsx
//
// SINGLE SOURCE OF TRUTH for admin-surface navigation metadata.
//
// Before this registry existed, nav metadata (label / group / needsSite /
// description) was triplicated across three files — Sidebar.tsx,
// CommandPalette.tsx, and Breadcrumbs.tsx — and had already drifted:
//   - `diagnostics` was missing from two of three (breadcrumb rendered a raw
//     slug; the palette couldn't find the surface).
//   - The palette carried stale `seo-briefs` / `content` entries after those
//     surfaces folded into `content-pipeline` (W3.3).
//   - `needsSite` gating disagreed across surfaces; `requests` was wrongly
//     gated behind a linked Webflow site, cutting off client communication
//     exactly during onboarding.
//   - The keyword-hub relabel/hide logic was duplicated three times.
//
// All three surfaces now consume this registry for identity, label, group,
// needsSite, and description. Rebuilt-shell surfaces also consume its zone
// ordering and labels. Visual presentation concerns (group colors, icon sizes,
// badges, focus-mode strip) stay LOCAL to each surface.
//
// Adding a `Page` union value? Add it here OR to NON_REGISTRY_PAGES. The
// contract test `tests/contract/nav-registry-completeness.test.ts` fails if a
// non-redirect Page value has no registry entry, or if a registry entry
// references a Page value that no longer exists.

import {
  Settings, Clipboard, BarChart3, Globe, Image, Gauge, Search,
  Pencil, Target, Code2, Link2, MessageSquare,
  LayoutDashboard, Activity, Sparkles, Layers, FileSearch, Map, ListChecks,
  DollarSign, Trophy, BriefcaseBusiness, ChartSpline, Stethoscope, WandSparkles,
  MapPinned, RadioTower, LibraryBig,
} from 'lucide-react';
import { GLOBAL_TABS, adminPath, type Page } from '../routes';
import type { FeatureFlagKey } from '../../shared/types/feature-flags';

type IconType = typeof Globe;

/** Registry identity for the rebuilt, workspace-less portfolio home at `/`. */
export const BOOK_ROOT_NAV_ID = 'book-root' as const;
export type BookRootNavId = typeof BOOK_ROOT_NAV_ID;
export type NavDestinationId = Page | BookRootNavId;
export type NavDestinationScope = 'workspace' | 'global' | 'book';

/** Non-Page destinations stay explicit so the Page/registry census cannot hide an orphan. */
export const NON_PAGE_NAV_DESTINATIONS = [BOOK_ROOT_NAV_ID] as const;

/**
 * Semantic group key for a nav entry. Surfaces map this to their own
 * presentation (sidebar uses UPPERCASE collapsible groups with per-group
 * colors; the palette uses Title Case headers). The `utility` group is for
 * footer/global entries (settings, revenue) that don't appear in the main
 * sidebar nav list but are valid navigation targets the palette and
 * breadcrumbs must still label.
 */
export type NavGroupKey =
  | 'home'
  | 'monitoring'
  | 'site-health'
  | 'seo-strategy'
  | 'optimization'
  | 'content'
  | 'admin'
  | 'utility';

/**
 * Flag-driven behavior for a nav entry: relabel, re-describe, or hide a surface
 * while a feature flag is ON. Home uses it to become Cockpit, and Content
 * Performance uses it to disappear once Pipeline Published becomes its rebuilt
 * receiving home. Keep future flag-gated nav changes here instead of duplicating
 * them across shell and palette consumers.
 */
export interface NavFlagBehavior {
  /** The feature flag this behavior keys off of. */
  flag: FeatureFlagKey;
  /** Label to use when the flag is ON (overrides `label`). */
  labelWhenOn?: string;
  /** Description to use when the flag is ON (overrides `description`). */
  descriptionWhenOn?: string;
  /** When true, the entry is hidden from nav surfaces while the flag is ON. */
  hideWhenOn?: boolean;
  /** When true, the entry is exposed only while the named flag is ON. */
  hideWhenOff?: boolean;
}

export interface NavEntry<TId extends NavDestinationId = Page> {
  id: TId;
  /** Default label (flag-OFF). Use resolveNavLabel() to apply flag behavior. */
  label: string;
  icon: IconType;
  group: NavGroupKey;
  /** One-line description used for tooltips / palette sub-text. */
  description: string;
  /** When true, the surface is gated behind a linked Webflow site. */
  needsSite?: boolean;
  /** Explicit only when the destination is not an ordinary workspace-scoped Page. */
  scope?: NavDestinationScope;
  /** Optional flag-driven relabel/hide behavior. */
  flagBehavior?: NavFlagBehavior;
}

export type AnyNavEntry = NavEntry<NavDestinationId>;

export type RebuiltNavZoneKey =
  | 'book'
  | 'top'
  | 'strategy-content'
  | 'search-site-health'
  | 'optimization'
  | 'client-facing'
  | 'admin';

export interface RebuiltNavZone {
  key: RebuiltNavZoneKey;
  /** Title-case shared label; visual consumers may transform casing. */
  label: string;
  items: readonly NavDestinationId[];
}

/**
 * Page union values intentionally NOT in the registry, with the reason.
 *
 * These routes intentionally have no global nav metadata. They include
 * redirects, backward-compat aliases, folded capabilities, standalone
 * workspace receivers, and rebuilt-sidebar-only presentation entries. The
 * contract test asserts this list + the registry together cover the entire
 * Page union, so a new non-registry Page cannot silently slip through without
 * a documented decision.
 */
export const NON_REGISTRY_PAGES: Page[] = [
  'seo-briefs',     // folded into content-pipeline (Briefs sub-tab) — W3.3
  'content',        // folded into content-pipeline (Posts sub-tab) — W3.3
  'calendar',       // redirect → content-pipeline?tab=calendar
  'subscriptions',  // preserved standalone legacy receiver; ?tab=subscriptions folds into content-pipeline
  'workspace-settings', // reached via per-workspace settings, not the main nav
  'competitors',    // dedicated interior page; rebuilt sidebar presents it locally, global nav remains unchanged
];

/** Rebuilt-shell destination zones shared by the sidebar and Command Palette. */
export const REBUILT_NAV_ZONES: readonly RebuiltNavZone[] = [
  { key: 'book', label: 'All workspaces', items: [BOOK_ROOT_NAV_ID] },
  { key: 'top', label: '', items: ['home', 'seo-strategy'] },
  {
    key: 'strategy-content',
    label: 'Strategy & Content',
    items: ['seo-keywords', 'competitors', 'content-pipeline', 'local-seo'],
  },
  {
    key: 'search-site-health',
    label: 'Search & Site Health',
    items: ['analytics-hub', 'page-intelligence', 'seo-audit', 'performance', 'links', 'media', 'ai-visibility'],
  },
  { key: 'optimization', label: 'Optimization', items: ['seo-editor', 'seo-schema', 'rewrite', 'brand'] },
  { key: 'client-facing', label: 'Client-Facing', items: ['outcomes', 'requests'] },
  {
    key: 'admin',
    label: 'Admin',
    items: ['outcomes-overview', 'prospect', 'ai-usage', 'roadmap', 'features', 'diagnostics'],
  },
];

const REBUILT_NAV_ZONE_LABEL_BY_ID = new globalThis.Map<NavDestinationId, string>(
  REBUILT_NAV_ZONES.flatMap((zone) => zone.items.map((id) => [id, zone.label] as const)),
);

/** Resolve the rebuilt-shell zone label for a destination. */
export function resolveRebuiltNavZoneLabel(id: NavDestinationId): string | undefined {
  return REBUILT_NAV_ZONE_LABEL_BY_ID.get(id);
}

/**
 * The registry. Order within a group is presentation; surfaces that care about
 * order (the sidebar) impose their own group ordering. The palette and
 * breadcrumbs are order-insensitive.
 */
export const NAV_REGISTRY: NavEntry[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard, group: 'home',
    description: 'Workspace overview and quick actions',
    flagBehavior: { flag: 'ui-rebuild-shell', labelWhenOn: 'Cockpit', descriptionWhenOn: 'Operator cockpit — verdict, work streams, and evidence' } },

  // ── Monitoring ──
  { id: 'analytics-hub', label: 'Search & Traffic', icon: BarChart3, group: 'monitoring', needsSite: true,
    description: 'Unified analytics: search performance, traffic, insights, and annotations' },
  { id: 'ai-visibility', label: 'AI Visibility', icon: RadioTower, group: 'site-health', needsSite: true,
    description: 'AI answer share of voice, mention trend, and cited source domains',
    flagBehavior: { flag: 'ui-rebuild-shell', hideWhenOff: true } },
  { id: 'outcomes', label: 'Action Results', icon: Trophy, group: 'monitoring',
    description: "Track what's working across all your SEO actions" },

  // ── Site Health ──
  { id: 'seo-audit', label: 'Site Audit', icon: Globe, group: 'site-health', needsSite: true,
    description: 'Comprehensive SEO audit with AI recommendations' },
  { id: 'performance', label: 'Performance', icon: Gauge, group: 'site-health', needsSite: true,
    description: 'PageSpeed scores, Core Web Vitals, and load times' },
  { id: 'links', label: 'Links', icon: Link2, group: 'site-health', needsSite: true,
    description: 'Internal links, broken links, and redirect management' },
  { id: 'media', label: 'Assets', icon: Image, group: 'site-health',
    description: 'Images, alt text, and media optimization',
    flagBehavior: { flag: 'ui-rebuild-shell', labelWhenOn: 'Asset Manager' } },

  // ── Strategy ──
  { id: 'seo-strategy', label: 'Strategy', icon: Target, group: 'seo-strategy', needsSite: true,
    description: 'Keyword strategy with page-keyword mapping',
    flagBehavior: { flag: 'ui-rebuild-shell', labelWhenOn: 'Insights Engine' } },
  { id: 'seo-keywords', label: 'Keyword Hub', icon: ListChecks, group: 'seo-strategy', needsSite: true,
    description: 'Unified keyword surface: lifecycle, tracking, national + local rank, and handoffs',
    flagBehavior: { flag: 'ui-rebuild-shell', labelWhenOn: 'Keywords' } },
  { id: 'page-intelligence', label: 'Page Intelligence', icon: Search, group: 'seo-strategy', needsSite: true,
    description: 'Per-page keyword analysis, metrics, and optimization' },
  { id: 'local-seo', label: 'Local Presence', icon: MapPinned, group: 'seo-strategy', needsSite: true,
    description: 'Local markets, local-pack visibility, GBP review aggregates, and setup' },

  // ── Optimization ──
  { id: 'seo-editor', label: 'SEO Editor', icon: Pencil, group: 'optimization', needsSite: true,
    description: 'Edit titles, descriptions, and meta tags' },
  { id: 'seo-schema', label: 'Schema', icon: Code2, group: 'optimization', needsSite: true,
    description: 'Structured data and schema markup' },
  { id: 'brand', label: 'Brand & AI', icon: Sparkles, group: 'optimization', needsSite: true,
    description: 'Brand voice, knowledge base, and audience personas' },
  { id: 'rewrite', label: 'Page Rewriter', icon: WandSparkles, group: 'optimization', needsSite: true,
    description: 'AI-assisted page rewriting with playbook instructions' },

  // ── Content ──
  { id: 'content-pipeline', label: 'Pipeline', icon: Clipboard, group: 'content', needsSite: true,
    description: 'Briefs, posts, and subscriptions in one view',
    flagBehavior: { flag: 'ui-rebuild-shell', labelWhenOn: 'Content Pipeline' } },
  // Drift fix: `requests` does NOT need a site — client communication must work
  // during onboarding, before a Webflow site is linked.
  { id: 'requests', label: 'Requests', icon: MessageSquare, group: 'content',
    description: 'Client content requests and feedback' },
  { id: 'content-perf', label: 'Content Perf', icon: ChartSpline, group: 'content', needsSite: true,
    description: 'Post-publish content performance metrics',
    flagBehavior: { flag: 'ui-rebuild-shell', hideWhenOn: true } },

  // ── Admin (global) ──
  { id: 'outcomes-overview', label: 'Team Outcomes', icon: BriefcaseBusiness, group: 'admin',
    description: 'Cross-workspace outcomes overview' },
  { id: 'prospect', label: 'Prospect', icon: FileSearch, group: 'admin',
    description: 'Sales prospect research' },
  { id: 'ai-usage', label: 'AI Usage', icon: Activity, group: 'admin',
    description: 'AI token usage and costs' },
  { id: 'roadmap', label: 'Roadmap', icon: Map, group: 'admin',
    description: 'Product roadmap and sprint tracking' },
  { id: 'features', label: 'Features', icon: Layers, group: 'admin',
    description: 'Feature library and changelog' },
  // Drift fix: diagnostics was missing from two of three surfaces. It is a
  // workspace-scoped surface that needs no Webflow site.
  { id: 'diagnostics', label: 'Diagnostics', icon: Stethoscope, group: 'admin',
    description: 'Deep diagnostic investigation reports' },

  // ── Utility (footer / global; not in the main sidebar nav list) ──
  { id: 'settings', label: 'Settings', icon: Settings, group: 'utility',
    description: 'Global studio settings' },
  { id: 'revenue', label: 'Revenue', icon: DollarSign, group: 'utility',
    description: 'Revenue dashboard' },
];

/** Book-level registry entry kept outside the Page-only registry by design. */
export const BOOK_ROOT_NAV_ENTRY: NavEntry<BookRootNavId> = {
  id: BOOK_ROOT_NAV_ID,
  label: 'Command Center',
  icon: LibraryBig,
  group: 'home',
  scope: 'book',
  description: 'All workspaces in your client book, ranked by attention',
  flagBehavior: { flag: 'ui-rebuild-shell', hideWhenOff: true },
};

/** All destinations consumed by flag-aware palette/rebuilt-shell navigation. */
export const NAV_DESTINATION_REGISTRY: AnyNavEntry[] = [BOOK_ROOT_NAV_ENTRY, ...NAV_REGISTRY];

/** Lookup by Page or explicit non-Page destination id. */
export const NAV_REGISTRY_BY_ID: Record<NavDestinationId, AnyNavEntry> = NAV_DESTINATION_REGISTRY.reduce(
  (acc, entry) => { acc[entry.id] = entry; return acc; },
  {} as Record<NavDestinationId, AnyNavEntry>,
);

/** Resolve inferred legacy scope plus explicit book/global scope into one routing model. */
export function resolveNavScope(entry: AnyNavEntry): NavDestinationScope {
  if (entry.scope) return entry.scope;
  return GLOBAL_TABS.has(entry.id) ? 'global' : 'workspace';
}

/**
 * Resolve a registry entry to its concrete route. Workspace-scoped destinations
 * return null until a workspace is available; book/global destinations do not.
 */
export function resolveNavPath(entry: AnyNavEntry, workspaceId?: string | null): string | null {
  const scope = resolveNavScope(entry);
  if (scope === 'book') return '/';
  if (entry.id === BOOK_ROOT_NAV_ID) return null;
  if (scope === 'global') return adminPath('', entry.id);
  return workspaceId ? adminPath(workspaceId, entry.id) : null;
}

/**
 * Resolve the effective label for an entry given the current flag state.
 * `isFlagEnabled` is the surface's flag resolver (e.g. useFeatureFlag).
 */
export function resolveNavLabel(entry: AnyNavEntry, isFlagEnabled: (flag: FeatureFlagKey) => boolean): string {
  const fb = entry.flagBehavior;
  if (fb?.labelWhenOn && isFlagEnabled(fb.flag)) return fb.labelWhenOn;
  return entry.label;
}

/** Resolve the effective description for an entry given the current flag state. */
export function resolveNavDescription(entry: AnyNavEntry, isFlagEnabled: (flag: FeatureFlagKey) => boolean): string {
  const fb = entry.flagBehavior;
  if (fb?.descriptionWhenOn && isFlagEnabled(fb.flag)) return fb.descriptionWhenOn;
  return entry.description;
}

/** Whether an entry is hidden under the current flag state. */
export function isNavEntryHidden(entry: AnyNavEntry, isFlagEnabled: (flag: FeatureFlagKey) => boolean): boolean {
  const fb = entry.flagBehavior;
  if (!fb) return false;
  const enabled = isFlagEnabled(fb.flag);
  return !!((fb.hideWhenOn && enabled) || (fb.hideWhenOff && !enabled));
}

/** Resolve a Page id to its label, applying flag behavior. Falls back to the raw id. */
export function resolveNavLabelById(id: NavDestinationId, isFlagEnabled: (flag: FeatureFlagKey) => boolean): string {
  const entry = NAV_REGISTRY_BY_ID[id];
  return entry ? resolveNavLabel(entry, isFlagEnabled) : id;
}
