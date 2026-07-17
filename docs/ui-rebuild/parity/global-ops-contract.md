# Global Ops Prototype Parity Contract

Surface family: `settings`, `workspace-settings`, `roadmap`, `revenue`, `ai-usage`, `features`, `prospect`, `outcomes-overview`, `outcomes`, `diagnostics`, `requests`  
Owner: global operations / workspace administration  
Status: `owner-approved`; Joshua approved all 11 Global Ops route homes with `ODP-009 A` and `GO-001` through `GO-008` retained as documented exceptions on 2026-07-10
Primary mounts: global routes plus workspace-scoped operator routes behind `ui-rebuild-shell`

## Prototype References

- Prototype sources:
  - `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/settings.js`
  - `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/wsettings.js`
  - `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/roadmap.js`
  - `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/business.js`
  - `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/outcomes.js`
  - `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/diagnostics.js`
  - `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/requests.js`
  - `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/onboard.js`
- Phase 0 ledger: `docs/ui-rebuild/phase0/surfaces/global-ops.md`
- Wave 6 build ticket: `docs/ui-rebuild/phase-a/tickets/global-ops.md`
- Surface data ledger: `docs/ui-rebuild/phase-a/surfaces/global-ops.json`
- Rebuilt registry: `src/components/layout/rebuiltSurfaces.ts`
- Current implementation: `src/components/global-ops-rebuilt/**`
- Current component test: `tests/component/global-ops-rebuilt/GlobalOpsSurface.test.tsx`

## Required Interaction Model

Global Ops is a route family, not a single rebuilt surface. Parity requires preserving each existing administrative home while moving visible structure closer to the prototype:

- `Settings` is an account-level operations page: Google account, Search Console properties, Webflow workspace status, platform health, storage cleanup, booking link, feature flags, Stripe, and MCP keys.
- `Workspace Settings` is the workspace administration workbench: connections, setup state, strategy inputs, feature/tier controls, portal and dashboard controls, publishing, exports, per-workspace flags, LLMs.txt carry-over, cold-start actions, and archive/restore.
- `Roadmap` is a sprint/backlog workbench with status cycling, search, sort, velocity, and expandable item detail.
- `Business` consolidates revenue, AI usage, feature library, and prospects into one operator bucket while retaining the existing route ids as aliases.
- `Outcomes Book` is the workspace-by-workspace results table with a server-owned rolling 90-day portfolio rollup for measured value, click gains, and attribution-honest wins, plus GSC evidence, issue matrix, coverage, and additive admin outcome fields.
- `Outcome Dashboard` remains the per-workspace drill-in for Top Wins, Scorecard, Playbooks, Actions, Learnings, Coverage, and published-work recording.
- `Diagnostics` remains both a list/run-history page and a `?report=` detail receiver.
- `Requests` stays a hybrid: prototype-style operator feed direction, but the existing Deliverables, Signals, All Requests, and Client Actions homes must remain reachable.
- Meeting Brief remains cut per C-8; do not resurrect a `brief` route.
- Client onboarding questionnaire/wizard is deferred to client-portal work; Global Ops only preserves admin setup and reset controls.

## Current Parity Grade

Visual status: `owner-approved`; capability constraints remain explicit approved exceptions.

Why:

- The rebuilt shell correctly mounts every Global Ops route family entry behind `ui-rebuild-shell`.
- The shell preserves the important URL receivers: Business `?tab=`, Workspace Settings `?tab=`, Roadmap `?view=`, Diagnostics `?report=`, and Requests `?tab=`.
- The current implementation keeps dense legacy machinery mounted exactly once where that is safer than redesigning server-backed workflows in a visual parity sweep.
- The route family still includes known product decisions that should not be guessed inside this goal loop: Requests promotion to strategy signal, Diagnostics stage/export, Business alias route retirement, client onboarding rehome, and final LLMs.txt relocation. `GO-004` portfolio-level Outcomes rollups completed in W4.2c on 2026-07-17.
- The current pass removes visible implementation/process language from the rebuilt Global Ops shell without changing capability homes.
- Browser smoke found and this branch fixes a route-family mount bug: rebuilt global routes were registered but `/settings`, `/roadmap`, `/revenue`, and `/outcomes-overview` fell through to legacy because `App.tsx` only mounted rebuilt surfaces when a URL-selected workspace existed. Rebuilt global routes now retain the operator's persisted last-visited workspace as shell context. With no visit history, they mount with honest null workspace context instead of borrowing an arbitrary workspace.
- Fresh review returned `PASS` for Settings; Workspace Settings; Roadmap; the Revenue / AI Usage / Features / Prospects Business aliases; Outcomes Book and the per-workspace Outcome Dashboard; Diagnostics; and Requests. These verdicts are supporting evidence; Joshua explicitly owner-approved the route family with its documented exceptions on 2026-07-10.
- The final Workspace Settings correction restores the prototype's 34px client identity, 22px `Workspace settings` title, `workspace · domain` context, and compact header→tabs→content rhythm while keeping every production operation and tab reachable exactly once.
- The final Roadmap correction omits nonnumeric capacity prose from sprint headers and restores the prototype's six-column Backlog scan (`ID`, status control, `Item`, `Priority`, `Est`, textual `Status`) while retaining disclosure and locally contained mobile scrolling.

Intentional divergence from prototype:

- Business remains addressable through the existing `revenue`, `ai-usage`, `features`, and `prospect` page ids instead of adding a new `business` route.
- Workspace Settings still carries full production tabs rather than only the slimmer prototype sections, because tiering, publishing, client users, exports, flags, and dashboard controls are live operator workflows.
- Requests retains the existing four sub-tools instead of collapsing into a single feed until owner direction confirms the lifecycle/bulk tooling home.
- Diagnostics keeps a nav/list page even though the prototype emphasizes report drill-in, because old reports and sender routes need a stable receiving home.
- Per-workspace Outcomes stays mounted as its existing dashboard until Cockpit/Insights Engine rehome is explicitly specced.

## URL And Deep Links

Current required behavior:

- `/settings` opens Global Settings. If future local lenses are added, use a validated `lens` param, not `tab`.
- `/ws/:workspaceId/workspace-settings?tab=connections|features|flags|publishing|dashboard|export|llms-txt` opens the matching Workspace Settings section; invalid values fall back to Connections.
- `/roadmap?view=sprint|backlog` opens the matching Roadmap view; invalid values fall back to Sprint. Keep `view`, not `tab`.
- `/revenue` defaults to the Revenue Business tab.
- `/revenue?tab=revenue|ai-usage|features|prospects` opens the matching Business tab.
- `/ai-usage`, `/features`, and `/prospect` default to their matching Business tabs.
- `/outcomes-overview` opens the cross-workspace Outcomes Book.
- `/ws/:workspaceId/outcomes` opens the per-workspace Outcome Dashboard.
- `/ws/:workspaceId/diagnostics` opens the Diagnostics list/run-history state.
- `/ws/:workspaceId/diagnostics?report=:reportId` opens the diagnostic report detail receiver.
- `/ws/:workspaceId/requests?tab=deliverables|signals|requests|actions` opens the matching Requests home; invalid values fall back to Deliverables.
- `/ws/:workspaceId/brief` and `home?tab=meeting-brief` stay retired to Home; do not add a rebuilt receiver.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Google OAuth status/connect/disconnect and GSC property list.
- Webflow workspace overview, linked/unlinked workspace state, global platform health, and storage stats.
- All four storage cleanup actions: backups, reports, chat history, and activity logs.
- Booking link save/clear, global feature flags with override/default semantics, Stripe settings, and MCP key creation/revocation.
- Workspace rename and connections: Webflow, live domain, Google/GSC/GA4, GBP card, and integration health.
- Workspace feature controls: tier, portal, onboarding enable/reset, reports, white-label branding, site capabilities, flags, publishing, client dashboard/users/events/conversions/outcome value, exports, and LLMs.txt until final rehome.
- Strategy inputs and competitor set editing in Workspace Settings while Strategy owner coordinates the single-source cut.
- Re-run audit and strategy job actions through existing background-job plumbing.
- Archive/restore workspace if the current backend support remains present; do not conflate it with delete.
- Roadmap sprint/backlog, status cycle, search, sort, stats, velocity, and item detail.
- Revenue analytics plus destructive payment delete/purge controls inside the carried Revenue panel.
- AI usage cost, calls, provider split, DataForSEO credits, and empty-zero behavior.
- Feature Library search/grouping and Prospect report run/history/detail/printable report.
- Outcomes Book portfolio totals and workspace rows from the server-owned rolling 90-day outcome read model, plus GSC/site-health and outcome coverage/attention fields. Do not recompute portfolio or workspace value/click/win totals in React.
- Per-workspace Outcome Dashboard tabs and `RecordPublishedWorkCard`.
- Diagnostics list, running/failed/completed detail states, report receiver, and run diagnostic action.
- Requests Deliverables, Signals, All Requests lifecycle management, and Client Actions.

## Accepted Deferrals And Decisions

Accepted 2026-07-09:

- `GO-001` Requests IA: keep the segmented hybrid until lifecycle, bulk, and status operations have an explicit single-feed model.
- `GO-002` Promote request to strategy signal: keep unavailable; do not add a Global Ops-only endpoint.
- `GO-003` Diagnostics stage/export: keep Diagnostics read/run/review only.
- `GO-004` Outcomes value read model — **complete 2026-07-17 (W4.2c):** the server owns one rolling 90-day value/click-gain/win window, independently excludes `not_acted_on`, and preserves separate agency-executed and client-side attribution. The existing server-owned issue matrix remains present-state evidence.
- `GO-005` Business route consolidation: keep old route ids as aliases until parity is verified in staging.
- `GO-006` Workspace Settings final IA: keep dense tabs until every moved capability has a named section or modal home.
- `GO-007` Client onboarding questionnaire/wizard: keep out of Global Ops and preserve admin enable/reset only until the client-portal phase.
- `GO-008` LLMs.txt final home: keep temporary Workspace Settings access until the AI Visibility receiver is verified.

Each item circles back only when the receiving workflow or missing server contract named above exists and can be smoke-tested.

Judgment calls made in this pass:

- Kept the current additive Global Ops shell rather than forcing a broad prototype collapse, because several exact prototype behaviors require product/backend decisions.
- Replaced visible process terms with operator-facing copy: `Additive aliases`, `Legacy parity carried over`, `Carry-over parity`, `Uses ?view=`, `Promote to signal deferred`, `Strategy handoff planned`, and `workspace-scoped route` are no longer visible in the rebuilt Global Ops shell.
- Let global rebuilt routes use the persisted last-visited workspace as chrome context when the URL has no workspace id. With no visit history (or when that workspace is no longer available), chrome remains unbound: the breadcrumb omits a workspace segment and Admin Chat does not bind to one. This is a shell context fix, not an IA change; workspace-scoped routes still require their URL-selected workspace.
- Completed the `GO-004` server-authority boundary in W4.2c: the Outcomes Book summary and row metrics consume `/api/outcomes/portfolio-rollup`, use one rolling 90-day window, and never fall back to client-created totals. The table continues to use the outcome overview's tracked/reconciled coverage and the workspace overview's present-state issue matrix as supporting evidence.
- Gave the Outcomes workspace column a real 180px minimum so fixed evidence columns create table-local horizontal scrolling instead of collapsing workspace names to zero width.

## Browser Smoke Evidence

Final fixed-viewport source-led evidence, 2026-07-10:

- Settings: `/tmp/asset-dashboard-codex-visual-parity/batch8/global/settings-1440-final.png`, `settings-1600-final.png`, cleanup dialog, and mobile floor.
- Workspace Settings: `/tmp/asset-dashboard-codex-visual-parity/batch8/global/workspace-settings/workspace-settings-1440-final2.png`, `workspace-settings-1600-final3.png`, and `workspace-settings-mobile-390-final3.png`; the strict 1600 capture reports zero open dialogs and page-level overflow.
- Roadmap: `/tmp/asset-dashboard-codex-visual-parity/batch8/global/roadmap/roadmap-sprint-1440-final2.png`, `roadmap-sprint-1600-final2.png`, `roadmap-backlog-1440-final2.png`, `roadmap-backlog-1600-final3.png`, and the locally scrolling mobile Backlog floor.
- Business: `/tmp/asset-dashboard-codex-visual-parity/batch8/global/business-*`; Revenue, AI Usage, Features, and Prospects are represented at both desktop widths, with populated-only capabilities retained in fixture tests where the local account has no truthful rows.
- Outcomes: `/tmp/asset-dashboard-codex-visual-parity/batch8/global/outcomes/`; Book, expanded evidence, per-workspace tabs, both desktop widths, and mobile floor.
- Diagnostics: `/tmp/asset-dashboard-codex-visual-parity/batch8/global/diagnostics/`; empty, report, expanded evidence, both desktop widths, and mobile floor.
- Requests: `/tmp/asset-dashboard-codex-visual-parity/batch8/global/requests/`; all four modes, populated/expanded states, both desktop widths, and mobile floor.

Fresh final verdict: `PASS` for every Global Ops sub-surface. This is reviewer evidence supporting Joshua's explicit 2026-07-10 owner approval of the family and its documented exceptions.

Smoke states captured:

- Desktop Settings: `/tmp/asset-dashboard-codex-parity-captures/global-ops-settings-desktop.png` from `/settings`.
- Desktop storage cleanup dialog: `/tmp/asset-dashboard-codex-parity-captures/global-ops-settings-cleanup-dialog.png`.
- Desktop Workspace Settings deep link: `/tmp/asset-dashboard-codex-parity-captures/global-ops-workspace-settings-dashboard-desktop.png` from `/ws/ws_demo_premium/workspace-settings?tab=dashboard`.
- Desktop Roadmap deep link: `/tmp/asset-dashboard-codex-parity-captures/global-ops-roadmap-backlog-desktop.png` from `/roadmap?view=backlog`.
- Desktop Business deep link: `/tmp/asset-dashboard-codex-parity-captures/global-ops-business-ai-usage-desktop.png` from `/revenue?tab=ai-usage`.
- Desktop Outcomes Book: `/tmp/asset-dashboard-codex-parity-captures/global-ops-outcomes-book-desktop.png` from `/outcomes-overview`.
- Desktop Diagnostics: `/tmp/asset-dashboard-codex-parity-captures/global-ops-diagnostics-desktop.png` from `/ws/ws_demo_premium/diagnostics`.
- Desktop Requests deep link: `/tmp/asset-dashboard-codex-parity-captures/global-ops-requests-actions-desktop.png` from `/ws/ws_demo_premium/requests?tab=actions`.
- Outcomes Book after server-authority correction: `/tmp/asset-dashboard-codex-parity-captures/global-ops-outcomes-server-owned-final.png`.
- Requests after deferred-process copy removal: `/tmp/asset-dashboard-codex-parity-captures/global-ops-requests-final.png`.
- Mobile Settings: `/tmp/asset-dashboard-codex-parity-captures/global-ops-settings-mobile.png`.
- Mobile Workspace Settings deep link: `/tmp/asset-dashboard-codex-parity-captures/global-ops-workspace-settings-dashboard-mobile.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/global-ops-smoke-state.json`.

Result:

- All tested routes mounted their rebuilt surface test id.
- `?tab=`, `?view=`, and workspace/global route receivers loaded the intended state.
- The storage cleanup dialog opened as the required open state.
- No horizontal overflow on desktop or 390px mobile.
- No visible internal process labels from the guarded list.
- Final browser inspection found no portfolio summary tiles, showed server-owned coverage values such as `0 / 6`, kept the first workspace cell at 180px, removed `Strategy handoff planned`, and found no page-level horizontal overflow in either corrected state.
- No console errors in the in-app browser smoke.

## Registry Closeout Evidence

The measured registry archive adds exact-size prototype Business views, Roadmap Backlog, Outcomes Book, completed Diagnostics, and Requests reference states, plus rebuilt 1600x1000 evidence for all four Requests modes under `/tmp/asset-dashboard-codex-visual-parity/registry-final/`. Existing exact fixed-viewport evidence remains authoritative for the other Global Ops route homes. Revenue's populated-prototype/empty-local-account comparison, the per-workspace Outcome Dashboard's lack of a direct prototype, Diagnostics list/history routing, and the Requests segmented hybrid remain explicit `GO-*` exceptions.

## Automated Test Floor

Current branch coverage proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts the rebuilt settings surface.
- Business `?tab=` opens valid tabs, old `prospect` alias defaults to Prospects, and invalid tabs fall back to the page default.
- Workspace Settings validates `?tab=` and falls back to Connections.
- Roadmap validates `?view=`, renders searched rows, and falls back to Sprint.
- Diagnostics preserves `?report=` detail/list state.
- Requests validates `?tab=`, preserves All Requests, and falls back to Deliverables.
- A rebuilt Business tab passes the shared a11y floor.
- Visible Global Ops shell copy does not expose internal process labels: additive aliases, legacy parity, carry-over parity, deferred, raw `?view=`, or workspace-scoped route wording.
- Outcomes Book coverage comes from the server-owned outcome overview and no client-created portfolio total is rendered.
- The Outcomes workspace column retains a 180px minimum before the table scrolls horizontally.
- App-level coverage proves rebuilt global routes retain a visited workspace as chrome context, mount with null context when there is no visit history, omit the workspace breadcrumb segment on global tabs, and never fall through to legacy panels.
- Focused source-led suites now also cover Wave A Settings / Workspace Settings / Roadmap composition, Business aliases and loading states, Outcomes Book/workspace modes, Diagnostics states, and Requests modes under `tests/component/global-ops-rebuilt/`.
