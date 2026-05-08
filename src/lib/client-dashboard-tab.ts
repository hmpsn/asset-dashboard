/**
 * Pure helper for resolving the active client-portal tab from the URL.
 * Extracted from src/components/ClientDashboard.tsx so the tab fallback logic
 * (legacy aliases + feature flags + unknown-tab fallback) can be unit-tested
 * without rendering the full dashboard.
 */
import type { ClientTab } from '../routes';

/**
 * Legacy tab surfaces that the client dashboard still accepts even though
 * they are not part of the canonical `ClientTab` union (older saved URLs
 * shouldn't 404). Kept separate from ClientTab so the runtime resolution can
 * widen its return type beyond the strict union.
 */
export type LegacyClientTab = 'content-plan';

export type ResolvedClientTab = ClientTab | LegacyClientTab;

/**
 * Set of tab ids the client dashboard accepts as-is. Includes the canonical
 * `ClientTab` values plus the legacy surfaces above.
 *
 * Intentionally EXCLUDES `'brand'` — that surface is feature-flagged and is
 * resolved by an explicit branch in `resolveClientTab()` *before* this list
 * is consulted. Adding `'brand'` here would bypass the feature flag because
 * the pass-through check would match the tab id directly.
 */
export const KNOWN_CLIENT_TABS: readonly ResolvedClientTab[] = [
  'overview',
  'performance',
  'health',
  'strategy',
  'inbox',
  'approvals',
  'requests',
  'content',
  'plans',
  'roi',
  'content-plan',
];

/**
 * Resolve the URL `:tab` segment to a renderable tab.
 *
 * Rules (mirror ClientDashboard.tsx):
 *  - 'search' and 'analytics' are legacy aliases that redirect to 'performance'.
 *  - 'brand' resolves to 'brand' only when the brand-tab feature flag is on,
 *    otherwise falls back to 'overview'.
 *  - Anything in KNOWN_CLIENT_TABS passes through unchanged.
 *  - Unknown / undefined / empty values fall back to 'overview'.
 */
export function resolveClientTab(
  initialTabId: string | undefined | null,
  brandTabEnabled: boolean,
): ResolvedClientTab {
  const t = initialTabId;
  if (t === 'search' || t === 'analytics') return 'performance';
  if (t === 'brand') return brandTabEnabled ? 'brand' : 'overview';
  if (t === 'schema-review') return 'inbox'; // retired — schema plan now lives in Inbox > SEO Changes
  if (t && (KNOWN_CLIENT_TABS as readonly string[]).includes(t)) return t as ResolvedClientTab;
  return 'overview';
}
