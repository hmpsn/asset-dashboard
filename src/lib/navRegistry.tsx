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
// needsSite, and description. Presentation concerns (group ordering, group
// colors, icon sizes, badges, focus-mode strip) stay LOCAL to each surface.
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
} from 'lucide-react';
import type { Page } from '../routes';
import type { FeatureFlagKey } from '../../shared/types/feature-flags';

type IconType = typeof Globe;

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
 * while a feature flag is ON. No entry currently uses this (the keyword-hub
 * relabel/hide retired when the Hub became the only keyword surface), but the
 * mechanism is retained so future flag-gated nav changes live in ONE place
 * instead of being re-implemented per surface.
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
}

export interface NavEntry {
  id: Page;
  /** Default label (flag-OFF). Use resolveNavLabel() to apply flag behavior. */
  label: string;
  icon: IconType;
  group: NavGroupKey;
  /** One-line description used for tooltips / palette sub-text. */
  description: string;
  /** When true, the surface is gated behind a linked Webflow site. */
  needsSite?: boolean;
  /** Optional flag-driven relabel/hide behavior. */
  flagBehavior?: NavFlagBehavior;
}

/**
 * Page union values intentionally NOT in the registry, with the reason.
 *
 * These are redirect-only targets, backward-compat aliases, or surfaces that
 * have been folded into a parent surface (their content now lives as a sub-tab
 * elsewhere). They are not standalone navigation destinations, so they carry
 * no nav metadata. The contract test asserts this list + the registry together
 * cover the entire Page union, so a new redirect-only Page can't silently slip
 * through without a documented decision.
 */
export const NON_REGISTRY_PAGES: Page[] = [
  'brief',          // backward-compat alias; WorkspaceHome is the primary discovery path
  'seo-briefs',     // folded into content-pipeline (Briefs sub-tab) — W3.3
  'content',        // folded into content-pipeline (Posts sub-tab) — W3.3
  'calendar',       // redirect → content-pipeline?tab=calendar
  'subscriptions',  // folded into content-pipeline (Subscriptions sub-tab)
  'workspace-settings', // reached via per-workspace settings, not the main nav
  'competitors',    // The Issue Phase 6 — dedicated competitor interior page; reached via a deep-link
                    // from The Issue cockpit (flag-ON), not the global nav, so flag-OFF nav is byte-identical
];

/**
 * The registry. Order within a group is presentation; surfaces that care about
 * order (the sidebar) impose their own group ordering. The palette and
 * breadcrumbs are order-insensitive.
 */
export const NAV_REGISTRY: NavEntry[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard, group: 'home',
    description: 'Workspace overview and quick actions' },

  // ── Monitoring ──
  { id: 'analytics-hub', label: 'Search & Traffic', icon: BarChart3, group: 'monitoring', needsSite: true,
    description: 'Unified analytics: search performance, traffic, insights, and annotations' },
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
    description: 'Images, alt text, and media optimization' },

  // ── SEO Strategy ──
  { id: 'seo-strategy', label: 'Strategy', icon: Target, group: 'seo-strategy', needsSite: true,
    description: 'Keyword strategy with page-keyword mapping' },
  { id: 'seo-keywords', label: 'Keyword Hub', icon: ListChecks, group: 'seo-strategy', needsSite: true,
    description: 'Unified keyword surface: lifecycle, tracking, national + local rank, and handoffs' },
  { id: 'page-intelligence', label: 'Page Intelligence', icon: Search, group: 'seo-strategy', needsSite: true,
    description: 'Per-page keyword analysis, metrics, and optimization' },

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
    description: 'Briefs, posts, and subscriptions in one view' },
  // Drift fix: `requests` does NOT need a site — client communication must work
  // during onboarding, before a Webflow site is linked.
  { id: 'requests', label: 'Requests', icon: MessageSquare, group: 'content',
    description: 'Client content requests and feedback' },
  { id: 'content-perf', label: 'Content Perf', icon: ChartSpline, group: 'content', needsSite: true,
    description: 'Post-publish content performance metrics' },

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

/** Lookup by Page id. */
export const NAV_REGISTRY_BY_ID: Record<Page, NavEntry> = NAV_REGISTRY.reduce(
  (acc, entry) => { acc[entry.id] = entry; return acc; },
  {} as Record<Page, NavEntry>,
);

/**
 * Resolve the effective label for an entry given the current flag state.
 * `isFlagEnabled` is the surface's flag resolver (e.g. useFeatureFlag).
 */
export function resolveNavLabel(entry: NavEntry, isFlagEnabled: (flag: FeatureFlagKey) => boolean): string {
  const fb = entry.flagBehavior;
  if (fb?.labelWhenOn && isFlagEnabled(fb.flag)) return fb.labelWhenOn;
  return entry.label;
}

/** Resolve the effective description for an entry given the current flag state. */
export function resolveNavDescription(entry: NavEntry, isFlagEnabled: (flag: FeatureFlagKey) => boolean): string {
  const fb = entry.flagBehavior;
  if (fb?.descriptionWhenOn && isFlagEnabled(fb.flag)) return fb.descriptionWhenOn;
  return entry.description;
}

/** Whether an entry is hidden under the current flag state. */
export function isNavEntryHidden(entry: NavEntry, isFlagEnabled: (flag: FeatureFlagKey) => boolean): boolean {
  const fb = entry.flagBehavior;
  return !!(fb?.hideWhenOn && isFlagEnabled(fb.flag));
}

/** Resolve a Page id to its label, applying flag behavior. Falls back to the raw id. */
export function resolveNavLabelById(id: Page, isFlagEnabled: (flag: FeatureFlagKey) => boolean): string {
  const entry = NAV_REGISTRY_BY_ID[id];
  return entry ? resolveNavLabel(entry, isFlagEnabled) : id;
}
