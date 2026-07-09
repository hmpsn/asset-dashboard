# Analytics Hub Prototype Parity Contract

Surface: `analytics-hub` / Search & Traffic  
Owner: monitoring / analytics reporting  
Status: `ODP-005 A + C` accepted 2026-07-09; Search-default correction approved  
Primary route: `/ws/:workspaceId/analytics-hub`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/traffic.js`
- Phase 0 surface ledger: `docs/ui-rebuild/phase0/surfaces/search-traffic.md`
- Phase A build ticket: `docs/ui-rebuild/phase-a/tickets/search-traffic.md`
- Phase A surface packet: `docs/ui-rebuild/phase-a/surfaces/search-traffic.json`
- Existing rebuilt implementation: `src/components/search-traffic-rebuilt/SearchTrafficSurface.tsx`
- Current component test: `tests/component/search-traffic-rebuilt/SearchTrafficSurface.test.tsx`

## Required Interaction Model

The prototype is a per-client reporting surface:

1. Show a compact report eyebrow with the current client and date range.
2. Use reporting modes as the navigation surface: Search performance, Site traffic, and Annotations.
3. Search performance leads with a narrative search verdict, KPI tiles, trend chart with annotation markers, rank movement, and query/page detail.
4. Site traffic leads with a GA4 narrative, KPI tiles, users/sessions chart, acquisition, engagement, and conversion evidence.
5. Annotations show the context timeline and explain the markers on the reporting charts.
6. Book roll-up is a separate scope mode, not part of the per-client default report.

Prototype-critical structure:

- The visible default report is Search performance, not a cross-source Overview.
- Search and GA4 evidence stays separated enough that the operator can tell which source produced each number.
- Annotations are not a detached settings table; they explain traffic movement and stay tied to the chart timeline.
- Users, sessions, clicks, impressions, and source shares are read-only data colors. Teal remains reserved for actions and active controls.

Production carry-over that intentionally exceeds the prototype:

- The rebuilt Overview lens preserves the current unified cross-source trend, Demand mix, and Priority insights. Its final home needs owner confirmation.
- Breakdowns open in the shared Drawer instead of inline cards so GSC devices/countries/types and GA4 top pages/sources/countries stay reachable without crowding the main report.
- Search and Traffic lenses reuse the existing actionable `AnomalyAlerts` home per `docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md` C-3.
- Full annotation CRUD remains available; the prototype only stubs Add annotation.
- The date-range selector keeps production presets including 7 days and 16 months.

## Current Parity Grade

Grade: `behavior mismatch`.

Why:

- The rebuilt surface preserves most production reporting capabilities and critical route state, but the default IA still exposes `Overview` as a peer lens. The prototype's per-client default is `Search performance`, and the Phase 0 ledger explicitly treats Overview fate as an open question.
- Collapsing or demoting Overview changes an existing operator workflow, so Priority insights and Demand mix need explicit receiving homes during implementation.
- Safe pre-work in this slice removes internal/implementation wording from loaded row states, opens conversion evidence by default, retints users/sessions away from teal action color, improves the header copy, maps report context/explanatory copy to styleguide typography roles, and locks the Breakdowns Drawer and feature-flag transition in tests.

Accepted direction:

- Default the route to Search performance, preserve `?lens=overview` as a compatibility receiver, and keep Demand mix/Priority insights in a lower report band or an Insights Engine handoff.
- Circle back after both cross-source content homes are visible and tested.
- Risk if wrong: hiding Overview too aggressively can orphan cross-source diagnostics and Priority insights; keeping it as default keeps the rebuilt route visibly out of prototype order.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/analytics-hub` opens the current default `Overview` lens.
- `?lens=overview`, `?lens=search`, `?lens=traffic`, and `?lens=annotations` initialize the corresponding lens.
- Invalid `lens` values fall back to Overview.
- `?days=` accepts validated date ranges.
- Search table mode uses `?view=queries|pages`.
- Search `Open Keyword Hub` routes to `seo-keywords`.
- The Breakdowns Drawer is local open state only.

Compatibility requirements:

- Do not use `?tab=` for this route; the Phase A ticket explicitly chose `?lens=`.
- Preserve `?lens=overview` even if Overview is later demoted from the visible default.
- Preserve `?view=queries|pages` for Search detail.
- Do not add backend APIs, migrations, shared types, route ids, or feature flags in this parity slice.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Search KPI tiles, prior trend, annotations on chart, query/page toggle, insight row badges, strategy keyword marker, Keyword Hub handoff, and GSC Breakdowns Drawer.
- Site traffic KPI tiles, users/sessions/pageviews chart, acquisition, engagement, organic vs all traffic, landing pages, conversion events, and GA4 Breakdowns Drawer.
- Annotation create/edit/delete/filter timeline.
- Actionable anomaly alerts on Search and Traffic.
- Workspace-event invalidation for annotation bridge, insight bridge, insight resolution, anomalies, and strategy keyword set updates.

## Safe Work Completed

- Replaced the implementation-facing `mover link in Keyword Hub` query-row badge with a read-only `Top 20` data badge.
- Opened Events & conversions by default on the Site Traffic lens so conversion evidence is visible like the prototype.
- Retinted users/sessions series away from teal action color.
- Reframed the page subtitle around reporting jobs instead of listing provider names.
- Wrapped the loaded PageHeader copy/actions for mobile.
- Promoted report-window context, table counts, Keyword Hub handoff, Traffic source labels, Demand mix explanation, and collapsed conversion context onto `.t-ui` / `.t-body` roles so important report copy no longer reads as metadata.
- Extended component tests for real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition, lens deep links, Breakdowns Drawer exact-once behavior, default conversion evidence, absence of internal labels, workspace-event wiring, and rebuilt a11y.

## Browser Smoke Evidence

Clean fixture-backed target: `/ws/ws_1772610244629/analytics-hub`.

- Desktop overview/current default: `/tmp/asset-dashboard-codex-parity-captures/analytics-hub-smoke-desktop.png`.
- Search deep link: `/tmp/asset-dashboard-codex-parity-captures/analytics-hub-smoke-search-deeplink.png`.
- Breakdowns Drawer open state: `/tmp/asset-dashboard-codex-parity-captures/analytics-hub-smoke-drawer.png`.
- Mobile Site Traffic: `/tmp/asset-dashboard-codex-parity-captures/analytics-hub-smoke-mobile-traffic.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/analytics-hub-smoke-state.json`.
- Typography role overview: `/tmp/asset-dashboard-codex-parity-captures/search-traffic-typography-role-overview-desktop.png`.
- Typography role Search deep link: `/tmp/asset-dashboard-codex-parity-captures/search-traffic-typography-role-search-deeplink-desktop.png`.
- Typography role Traffic drawer: `/tmp/asset-dashboard-codex-parity-captures/search-traffic-typography-role-traffic-drawer-desktop.png`.
- Typography role smoke state: `/tmp/asset-dashboard-codex-parity-captures/search-traffic-typography-role-smoke-state.json`.

Result: clean. The populated state is fixture-backed so this smoke does not depend on local GSC/GA4 credentials or recent provider data; the route, rebuilt shell, URL state, drawer, mobile layout, and console/network behavior are still exercised in browser.

Typography role result: passed. Fixture-backed smoke confirmed no horizontal overflow, no internal migration/rebuild terms, overview and Search deep link states with no dialog, the Traffic breakdown Drawer with exactly one dialog, and sampled role sizes: `.t-ui` at 13.5px and `.t-body` at 15.5px. The only console warnings were local preview WebSocket disconnects; the only failed requests were route-change-aborted intelligence refreshes outside the Search & Traffic surface.

## Automated Test Floor

Current branch coverage proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Search & Traffic.
- `?lens=search&view=pages&days=90` initializes the expected lens and table mode.
- Reporting modes remain visible.
- Internal rebuild/migration/projection/carry-over/cache labels are absent from visible loaded states.
- The Search Breakdowns Drawer opens exactly once and closes cleanly.
- Site Traffic shows conversion evidence by default.
- Important report context and explanation copy uses styleguide roles (`t-ui` for report controls/actions, `t-body` for explanatory copy).
- Workspace-event handlers invalidate analytics data.
- The rebuilt a11y floor passes.
