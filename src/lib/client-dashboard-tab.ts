/**
 * Pure helper for resolving the active client-portal tab from the URL.
 * Extracted from src/components/ClientDashboard.tsx so the tab fallback logic
 * (legacy aliases + unknown-tab fallback) can be unit-tested without rendering
 * the full dashboard.
 */
import type { ClientTab } from '../routes';

/**
 * Legacy tab surfaces that the client dashboard still accepts even though
 * they are not part of the canonical `ClientTab` union (older saved URLs
 * shouldn't 404). Kept separate from ClientTab so the runtime resolution can
 * widen its return type beyond the strict union.
 *
 * Currently `never` — `'content-plan'` was the last member, promoted to
 * canonical `ClientTab` in feat/client-inbox-redesign. This type is retained
 * as the pattern for future legacy surfaces.
 */
export type LegacyClientTab = never;

export type ResolvedClientTab = ClientTab;

/**
 * Set of tab ids the client dashboard accepts as-is. A strict subset of the
 * canonical `ClientTab` values — intentionally EXCLUDES `'search'` /
 * `'analytics'` (redirected to `'performance'` by alias guards).
 */
export const KNOWN_CLIENT_TABS: readonly ResolvedClientTab[] = [
  'overview',
  'performance',
  'health',
  'strategy',
  'inbox',
  'plans',
  'roi',
  'content-plan',
  'brand',
  'deep-dive',
  'results',
  'settings',
];

/**
 * Resolve the URL `:tab` segment to a renderable tab.
 *
 * Rules (mirror ClientDashboard.tsx):
 *  - 'search' and 'analytics' are legacy aliases that redirect to 'performance'.
 *  - Anything in KNOWN_CLIENT_TABS passes through unchanged.
 *  - Unknown / undefined / empty values fall back to 'overview'.
 *
 * NOTE: 'roi' deliberately resolves to ITSELF (it stays in KNOWN_CLIENT_TABS with its
 * own panel). It is NOT aliased to 'results' — a pure helper can't read the
 * client-ia-v2 flag, so an unconditional roi→results alias would silently change the
 * flag-OFF ROI tab (the legacy nav still surfaces 'roi'; routing it to the evergreen
 * Results panel drops the month-over-month stat AND breaks the nav highlight). Under
 * IA v2 the nav surfaces 'results' (evergreen) instead; old `?tab=roi` bookmarks still
 * render the working non-evergreen roi panel.
 */
export function resolveClientTab(initialTabId: string | undefined | null): ResolvedClientTab {
  const t = initialTabId;
  if (t === 'search' || t === 'analytics') return 'performance';
  if (t && (KNOWN_CLIENT_TABS as readonly string[]).includes(t)) return t as ResolvedClientTab;
  return 'overview';
}
