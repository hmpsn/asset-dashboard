# Competitors Prototype Parity Contract

Surface: `competitors` / Competitors  
Owner: strategy / competitive intelligence  
Status: `owner-approved`; Joshua approved the corrected competitive-intelligence composition and documented provider exception on 2026-07-10
Primary route: `/ws/:workspaceId/competitors`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/competitors.js`
- Phase 0 surface ledger: `docs/ui-rebuild/phase0/surfaces/competitors.md`
- Phase A build ticket: `docs/ui-rebuild/phase-a/tickets/competitors.md`
- Phase A surface packet: `docs/ui-rebuild/phase-a/surfaces/competitors.json`
- Existing rebuilt implementation: `src/components/competitors-rebuilt/CompetitorsSurface.tsx`
- Current component test: `tests/component/competitors-rebuilt/CompetitorsSurface.test.tsx`

## Required Interaction Model

The prototype is a single competitive-intelligence stack:

1. Show the saved competitor set with an Edit set route to Workspace Settings.
2. Show weekly competitor alerts first.
3. Show share of voice across the owned domain and competitors.
4. Show a head-to-head comparison table.
5. Show keyword gaps with Create brief actions.
6. Show backlink profile metrics and referring-domain evidence.

Prototype-critical structure:

- No top tabs or lenses. The route is a single section stack.
- Competitor-domain editing is not inline; it routes to Workspace Settings.
- Competitor color is orange. Owned-domain metrics are blue.
- Alerts, share of voice, head-to-head, keyword gaps, and backlinks stay visible as peer sections in research order.
- Empty setup state routes the operator to Workspace Settings.

Production carry-over that intentionally exceeds the prototype:

- Per-competitor detail opens in the shared Drawer with comparison bars, traffic value, and top keyword evidence.
- Per-gap View in Hub deep-links to Keyword Hub.
- Per-gap Send to client remains behind `strategy-command-center` and `strategy-competitor-send`.
- Provider-not-configured and add-domains setup states stay distinct.
- Degraded live data and last-run fallback states stay honest instead of collapsing into a generic error.

## Current Parity Grade

Visual status: `owner-approved`.

Source-led correction result, 2026-07-10:

- The surface now uses the prototype's 1120px outer / 1060px content stack, workspace eyebrow, client/freshness context, compact title/chip/edit hierarchy, and exact research order: Alerts, Share of Voice, Head-to-head, Keyword gaps, Backlinks.
- The live Rinse fixture truthfully renders the provider/setup state because local DataForSEO credentials are unavailable; the complete populated composition remains fixture-backed in the focused component suite.
- Workspace identity now comes from the real workspace read rather than a competitor-count substitute. The production detail Drawer, Hub deep link, Create brief, optional Send to client, degraded-data messaging, and setup distinctions remain reachable.
- Exact 1440x900, 1600x1000, and mobile setup evidence plus the fixture-backed populated state passed fresh Sol review with `PASS`; Joshua explicitly owner-approved the composition and truthful provider setup state on 2026-07-10.

Why:

- The rebuilt surface already matches the prototype's core IA: single route, no `?tab=`, no peer lenses, read-only competitor chips, section stack, alerts, share of voice, head-to-head, keyword gaps, and backlinks.
- The saved competitor set is now folded into a prototype-style `Competitive intelligence` summary near the header, with orange read-only competitor badges, weekly cadence, scan freshness, and the existing Edit set route.
- Existing production capability remains preserved exactly once: competitor detail Drawer, Keyword Hub deep link, Create brief, Send to client behind existing flags, backlink external links, alert states, provider setup state, and workspace-event invalidation.
- Competitor alerts now render as prototype-style feed rows rather than a generic sortable table, keeping the same alert data while making weekly movement easier to scan.
- The safe cleanup needed here is copy and responsive polish, not a structural rewrite. The prototype labels the gap section as `Keyword gaps`; visible `Raw Competitor Evidence`, `provider terms`, and `cached data` copy made the page feel more like implementation scaffolding than the prototype and has been cleaned from loaded states.

Owner decisions:

- None blocking this slice.
- Optional later decision: if exact prototype card composition is required, keep or replace the production detail Drawer after an owner review. The separate competitor-set Toolbar has been folded into the header summary while preserving refresh/edit affordances.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/competitors` opens the single section stack.
- The surface does not own `?tab=` or a secondary lens param.
- `Edit set` routes to `/ws/:workspaceId/workspace-settings`.
- `View in Hub` routes to `seo-keywords` with `buildHubDeepLinkQuery({ keyword })`.
- `Create brief` routes to `seo-briefs` with `fixContext` location state.
- The competitor detail Drawer is local open state only.

Compatibility requirements:

- Do not add a local `?tab=` value for this route.
- Do not add inline competitor-domain editing here; Workspace Settings remains the edit home.
- Do not add backend APIs, migrations, shared types, route ids, or feature flags in this parity slice.
- Do not fabricate Authority or Top-3 values. Render those columns only when the response contains them.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Competitor alerts with severity badges, position movement, volume, dates, quiet-empty state, and retry.
- Share of voice with the own-domain trust guard.
- Head-to-head DataTable with owned-domain `YOU` marker, leader marker, refresh/freshness state, degraded-data banner, and detail Drawer.
- Detail Drawer with comparison bars, traffic value, and top keyword evidence.
- Keyword gaps with volume, keyword difficulty banding, competitor rank, View in Hub, Create brief, and optional Send to client.
- Backlink profile metrics, referring-domain table, provider setup hint, and external links.

## Safe Work Completed

- Rename the visible gap section to `Keyword gaps` and replace implementation-oriented helper copy with prototype-style operator language.
- Replace `cached data` / `provider terms` phrasing in visible UI with last-run and scan-oriented language.
- Fold the saved competitor set out of a separate Toolbar and into a prototype-style header summary with orange domain badges, weekly cadence, scan freshness, and the existing Workspace Settings edit route.
- Replace the alerts DataTable with a prototype-style alert feed inside `SectionCard` while preserving error/loading/empty states, severity badges, movement/volume/date metadata, and the existing alert read path.
- Keep provider setup guidance where it is explicitly useful for admin configuration.
- Update component tests for the real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition, no top tabs/lenses, detail Drawer exact-once behavior, outbound deep links, absence of internal rebuild/migration/projection/cache phrasing, and rebuilt a11y.

## Browser Smoke Evidence

Clean fixture-backed target: `/ws/ws_1772610244629/competitors`.

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/competitors-smoke-desktop.png`.
- Detail Drawer open state: `/tmp/asset-dashboard-codex-parity-captures/competitors-smoke-drawer.png`.
- Plain-route deep link: `/ws/ws_1772610244629/competitors`.
- Mobile overview: `/tmp/asset-dashboard-codex-parity-captures/competitors-smoke-mobile.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/competitors-smoke-state.json`.

Result: clean. The populated state is fixture-backed because the local workspace has no configured SEO provider credentials; the live unconfigured-provider state remains covered by the component test and the route's real API response.

Current header-summary smoke target: `/ws/ws_2ceaeb6c-0820-4da5-941e-ad9eae643993/competitors`.

- Desktop overview/setup state: `/tmp/asset-dashboard-codex-parity-captures/competitors-header-summary-rinse-desktop.png`.
- Mobile overview/setup state: `/tmp/asset-dashboard-codex-parity-captures/competitors-header-summary-rinse-mobile.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/competitors-header-summary-rinse-smoke-state.json`.

Result: clean with local provider unavailable. The smoke verifies the new `Competitive intelligence` summary, saved competitor badges, no obsolete top Toolbar, no internal labels, no horizontal overflow, and no console errors. The populated section stack and detail Drawer remain covered by component tests because provider credentials are unavailable in the local browser state.

Alert-feed fixture-backed smoke target: `/ws/ws_1772610244629/competitors`.

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/competitors-alert-feed-desktop.png`.
- Detail Drawer open state: `/tmp/asset-dashboard-codex-parity-captures/competitors-alert-feed-drawer-desktop.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/competitors-alert-feed-smoke-state.json`.

Result: clean. The alert feed is visible, no alert grid is rendered inside the feed, row typography uses `.t-body` / `.t-ui` / `.t-caption-sm`, internal migration/rebuild labels are absent, horizontal overflow is absent, and the existing competitor detail Drawer still opens as a single dialog. Console noise was limited to Vite websocket disconnect warnings and one route-change-aborted intelligence request.

Source-led final evidence:

- Prototype: `/tmp/asset-dashboard-codex-visual-parity/batch7/prototype/competitors-1440.png` and `competitors-1600.png`.
- Corrected live setup state: `/tmp/asset-dashboard-codex-visual-parity/batch7/competitors/setup-1440-final.png` and `setup-1600-final.png`.
- Mobile floor: `/tmp/asset-dashboard-codex-visual-parity/batch7/competitors/setup-mobile-390.png`.

Fresh Sol verdict: `PASS`. The setup state uses the expected canvas, hierarchy, density, workspace identity, and no-overflow responsive behavior. Populated stack fidelity is protected by realistic component fixtures because the local provider is unavailable.

## Registry Closeout Evidence

The registry closeout preserves exact fixed-viewport prototype references and truthful rebuilt setup-state evidence in the measured review archive at `/tmp/asset-dashboard-codex-visual-parity/registry-final/` and the reviewed surface archive. Local DataForSEO is unavailable, so the populated composition remains fixture-protected rather than fabricated in the browser; the detail Drawer remains production-only.

## Automated Test Floor

Current branch coverage should prove:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Competitors.
- The route renders as a single section stack with no top tab/lens switcher.
- The prototype-style `Competitive intelligence` summary renders the saved competitor set and the old top Toolbar stays absent.
- Competitor alerts render as a feed list, not a grid, and alert rows use styleguide typography roles for domain, keyword, and movement metadata.
- Provider setup and add-domains setup states remain distinct.
- Competitor detail Drawer opens exactly once from a competitor row and closes cleanly.
- View in Hub and Create brief navigate to the existing carry-over homes.
- Internal rebuild/migration/projection/cache labels are absent from visible loaded states.
- Workspace event handlers invalidate competitor data.
- The rebuilt a11y floor passes.
