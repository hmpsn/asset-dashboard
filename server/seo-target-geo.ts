import { isFeatureEnabled } from './feature-flags.js';
import { resolveWorkspaceTargetGeo } from './domains/local-seo/configuration-service.js';

/**
 * Provider geo params (`location_code` / `language_code`) for a workspace's
 * domain & keyword SERP queries, gated by the `geo-targeting` flag
 * (SEO Decision Engine P4).
 *
 * - **Flag OFF** → returns `{}`. Callers destructure `geo.locationCode` /
 *   `geo.languageCode` and pass them as the trailing positional args of the
 *   `SeoDataProvider` domain methods (the 4th positional arg is `database`, so
 *   pass `undefined` for it, then the two geo fields — do NOT `...spread` this
 *   object into the call: that would mis-slot `locationCode` into `database`).
 *   When both are `undefined` nothing changes: the provider falls back to its
 *   `locationCodeFromDatabase(database)` / `'en'` defaults, byte-identical to
 *   pre-P4 behavior (and cache keys stay on the legacy un-versioned token, so no
 *   expensive domain-cache re-warm).
 * - **Flag ON** → returns the workspace's resolved `{ locationCode, languageCode, locationName }`
 *   (see {@link resolveWorkspaceTargetGeo}: admin target-geo → local primary
 *   market → US/'en'), so domain methods query the correct national/international
 *   SERP instead of hardcoded US. Most callers use only the code/language; endpoints
 *   such as LLM mentions use `locationName` because the provider accepts a named
 *   location rather than a location code.
 *
 * `workspaceId` MUST be the CLIENT workspace whose SERP geo we care about — never
 * a competitor's domain. Backlinks calls are geo-agnostic and do NOT use this.
 */
export function workspaceProviderGeo(
  workspaceId: string,
): { locationCode?: number; languageCode?: string; locationName?: string } {
  if (!isFeatureEnabled('geo-targeting', workspaceId)) return {};
  return resolveWorkspaceTargetGeo(workspaceId);
}
