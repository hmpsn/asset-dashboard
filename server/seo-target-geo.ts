import { resolveWorkspaceTargetGeo } from './domains/local-seo/configuration-service.js';

/**
 * Provider geo params (`location_code` / `language_code`) for a workspace's
 * domain & keyword SERP queries (SEO Decision Engine P4).
 *
 * Returns the workspace's resolved `{ locationCode, languageCode, locationName }`
 * (see {@link resolveWorkspaceTargetGeo}: admin target-geo → local primary
 * market → US/'en'), so domain methods query the correct national/international
 * SERP instead of hardcoded US. Most callers use only the code/language; endpoints
 * such as LLM mentions use `locationName` because the provider accepts a named
 * location rather than a location code. Callers destructure `geo.locationCode` /
 * `geo.languageCode` and pass them as the trailing positional args of the
 * `SeoDataProvider` domain methods (the 4th positional arg is `database`, so
 * pass `undefined` for it, then the two geo fields — do NOT `...spread` this
 * object into the call: that would mis-slot `locationCode` into `database`).
 *
 * `workspaceId` MUST be the CLIENT workspace whose SERP geo we care about — never
 * a competitor's domain. Backlinks calls are geo-agnostic and do NOT use this.
 */
export function workspaceProviderGeo(
  workspaceId: string,
): { locationCode?: number; languageCode?: string; locationName?: string } {
  return resolveWorkspaceTargetGeo(workspaceId);
}
