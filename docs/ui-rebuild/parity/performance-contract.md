# Performance Prototype Parity Contract

Surface: `performance` / Performance  
Owner: site-health / speed-diagnostics workflow  
Status: aligned enough after safe cleanup; exact inline expansion and side-by-side speed cards are owner choices  
Primary route: `/ws/:workspaceId/performance`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/performance.js`
- Prototype screenshots: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/screenshots/01-perf-weight.png`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/screenshots/02-perf-weight.png`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/screenshots/perf-fixed.png`
- Existing rebuilt implementation: `src/components/performance-rebuilt/PerformanceSurface.tsx`
- Route-state hook: `src/components/performance-rebuilt/usePerformanceSurfaceState.ts`
- Page Weight workflow: `src/components/performance-rebuilt/PageWeightLens.tsx`
- Page Speed workflow: `src/components/performance-rebuilt/PageSpeedLens.tsx`
- Current component test: `tests/component/performance-rebuilt/PerformanceSurface.test.tsx`

## Required Interaction Model

The prototype is the detect side of the media-performance loop. Performance identifies heavy pages and speed issues; Asset Manager is where most image-heavy fixes happen.

Prototype-critical modes:

1. `Page Weight` — per-page asset weight, source filter, search, re-scan, page expansion/detail, oversized asset emphasis, and Asset Manager handoff.
2. `Page Speed` — tested page selector, mobile/desktop Lighthouse and Core Web Vitals, opportunities ordered by speed savings, re-test, and Asset Manager handoff for image-heavy wins.

The rebuilt surface preserves the same two-mode model and keeps production capabilities reachable through DS-native controls. It uses drawers for page/detail inspection rather than prototype inline expansion.

## Current Parity Grade

Grade: `aligned enough`.

Why:

- The rebuilt surface has the same two operator modes: Page Weight and Page Speed.
- `?tab=weight` and `?tab=speed` initialize the intended lens, while invalid tabs fall back to Page Weight.
- Page Weight preserves scan, saved snapshot, search, source filters, metric summary, oversized/heavy page emphasis, row detail, and Asset Manager handoff.
- Page Speed preserves single-page tests, bulk top-page tests, mobile/desktop strategy scans, saved strategy snapshots, Core Web Vitals, opportunity detail, diagnostic detail, and exact-once detail drawers.
- Safe cleanup removed internal implementation language from PageSpeed opportunity copy and keeps the default route clean.

Owner choices:

- The prototype expands Page Weight rows inline. The rebuilt surface uses a shared `Drawer` for asset breakdown. Recommended default: keep the drawer unless exact row expansion becomes a design requirement, because the drawer is consistent with other rebuilt detail reviews.
- The prototype shows mobile and desktop speed cards side by side for the selected page. The rebuilt surface uses a strategy selector plus separate mobile/desktop snapshot cards. Recommended default: keep current production workflow unless Joshua wants the exact side-by-side card composition; changing it affects how operators choose single-page vs bulk tests.
- The prototype has row-level `Fix` actions for PageSpeed opportunities that route toward Asset Manager. The rebuilt surface now gives the correct Asset Manager repair framing but does not simulate a direct fix action for every opportunity. Recommended default: add direct actions only after Media/Asset Manager parity confirms the write target and filters.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/performance` opens Page Weight with no query string.
- `?tab=weight` remains accepted and opens Page Weight.
- Switching back to Page Weight clears the default `tab` query param.
- `?tab=speed` opens Page Speed.
- Invalid `?tab=` values fall back to Page Weight.

Compatibility requirements:

- Preserve existing `weight` and `speed` tab values.
- Do not add backend APIs, migrations, shared types, route ids, or feature flags for visual alignment.
- Keep the Asset Manager handoff home intact: heavy pages and most image-heavy speed wins should guide operators to Media/Asset Manager, not claim an automatic fix.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Page-weight snapshot read, fresh scan, page/source filter, search, metrics, page detail drawer, asset table, and oversized asset flag.
- PageSpeed saved mobile and desktop snapshots, single-page scan, bulk scan, page selector, Core Web Vitals, opportunity detail, diagnostic detail, and page-result detail drawer.
- Media/Asset Manager handoff for heavy pages and image-heavy speed opportunities.

## Safe Work Completed

- Default `Page Weight` now matches the prototype route shape by clearing `?tab=weight`; the deep link remains accepted.
- PageSpeed opportunity detail now uses user-facing Asset Manager repair framing instead of exposing deferred implementation language.
- The loaded PageHeader now wraps on mobile and uses the prototype's Asset Manager speed-loop framing.
- PageSpeed now exposes the Asset Manager repair handoff in the main workflow body, not only in the detail Drawer, and routes operators to the existing Asset Manager audit lens with oversized filtering.
- Page Weight repair guidance, Page Weight drawer compression context, PageSpeed score context, bulk-test guidance, and PageSpeed Asset Manager handoff copy now use `.t-body` so speed-routing guidance reads as workflow copy rather than caption metadata.
- Component tests assert default URL behavior, deep-link behavior, detail drawer behavior, real feature-flag loading transition, absence of internal implementation language in PageSpeed detail, and rebuilt a11y.

## Browser Smoke Evidence

Clean fixture target: `ws_1772610244629` / Swish Dental.

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/performance-swish-desktop-current.png`
- Page Speed deep link: `/tmp/asset-dashboard-codex-parity-captures/performance-swish-speed-current.png`
- Page Weight detail drawer: `/tmp/asset-dashboard-codex-parity-captures/performance-swish-weight-drawer-current.png`
- Page Speed detail drawer: `/tmp/asset-dashboard-codex-parity-captures/performance-swish-speed-drawer-current.png`
- Mobile overview: `/tmp/asset-dashboard-codex-parity-captures/performance-swish-mobile-current.png`
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/performance-swish-smoke-state.json`
- PageSpeed Asset Manager handoff desktop: `/tmp/asset-dashboard-codex-parity-captures/performance-pagespeed-asset-handoff-desktop.png`
- PageSpeed Asset Manager handoff mobile: `/tmp/asset-dashboard-codex-parity-captures/performance-pagespeed-asset-handoff-mobile-viewport.png`
- PageSpeed Asset Manager handoff state: `/tmp/asset-dashboard-codex-parity-captures/performance-pagespeed-asset-handoff-smoke-state.json`
- Typography role desktop overview: `/tmp/asset-dashboard-codex-parity-captures/performance-typography-weight-desktop.png`
- Typography role Page Weight drawer: `/tmp/asset-dashboard-codex-parity-captures/performance-typography-weight-drawer-desktop.png`
- Typography role Page Speed deep link: `/tmp/asset-dashboard-codex-parity-captures/performance-typography-speed-desktop.png`
- Typography role state: `/tmp/asset-dashboard-codex-parity-captures/performance-typography-role-smoke-state.json`

Result: passed with local browser smoke. Desktop overview, Page Speed deep link, Page Weight drawer, Page Speed drawer, and mobile overview had visible lens labels, no page-level horizontal overflow, no internal implementation labels, no duplicate dialogs, no console errors, and no failed responses. The PageSpeed Asset Manager handoff smoke also passed: desktop and the light mobile regression viewport both showed the handoff copy, the `Open assets` action routed to `/media?tab=audit&filter=oversized`, no internal implementation terms appeared, and console warnings/errors were empty.

Typography result: passed for the live Performance detect/repair samples that render in the Swish fixture. Page Weight repair guidance, the Page Weight drawer compression note, and the PageSpeed Asset Manager handoff all rendered as `.t-body` at 15.5px with no horizontal overflow; the Page Weight drawer opened exactly once. The PageSpeed score-context sentence is covered by component test because the clean live fixture has no saved PageSpeed score result in that state. Local preview console noise was limited to the existing notification fetch failure when the full backend notification stack was not attached; the Performance route itself had no failed responses.

Fixture note: the workspace already had real Page Weight data but no saved PageSpeed rows. The smoke temporarily inserted `pagespeed:mobile` and `pagespeed:desktop` snapshots for the Swish site, captured the PageSpeed states, then deleted both rows. Follow-up API checks returned `null` for both PageSpeed snapshots after cleanup.

## Automated Test Floor

Existing/current branch coverage proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Performance.
- Page Weight and Page Speed deep links initialize the intended state.
- Invalid `?tab=` values fall back to Page Weight.
- Lens switching writes non-default URL state and clears the default Page Weight URL.
- Page Weight search, source filtering, and page detail inspection remain reachable.
- Page Speed single-page and bulk scans remain reachable.
- PageSpeed's main workflow exposes the Asset Manager repair handoff and routes to `?tab=audit&filter=oversized`.
- Page Weight and PageSpeed detect/repair guidance use `.t-body` for substantive workflow copy.
- PageSpeed detail opens in a drawer exactly once and avoids internal implementation language.
- The rebuilt a11y floor passes.
