# Wave 6 BUILD TICKET - Global Ops (Pages `settings`, `workspace-settings`, `roadmap`, `revenue`, `ai-usage`, `features`, `prospect`, `outcomes-overview`, `outcomes`, `diagnostics`, `requests`)

> **Surface:** admin Global Ops zone: global `Page` ids `settings`, `roadmap`, `revenue`, `ai-usage`, `features`, `prospect`, `outcomes-overview` plus workspace-scoped operator pages `workspace-settings`, `outcomes`, `diagnostics`, and `requests` (`src/routes.ts:12-22`, `src/routes.ts:36`). No `business`, `brief`, or `onboarding` `Page` id exists at HEAD.
> **HEAD component + mount:** `SettingsPanel` (`src/components/SettingsPanel.tsx:57`), `WorkspaceSettings` (`src/components/WorkspaceSettings.tsx:83`), `Roadmap` (`src/components/Roadmap.tsx:24`), `RevenueDashboard` (`src/components/RevenueDashboard.tsx:46`), `AIUsageSection` (`src/components/AIUsageSection.tsx:43` via `WorkspaceOverview` re-export), `FeatureLibrary` (`src/components/FeatureLibrary.tsx:55`), `SalesReport` (`src/components/SalesReport.tsx:58`), `OutcomesOverview` (`src/components/admin/outcomes/OutcomesOverview.tsx:202`), `OutcomeDashboard` (`src/components/admin/outcomes/OutcomeDashboard.tsx:21`), `DiagnosticReportPage` (`src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:194`), `RequestManager` / `AdminInbox` / `ClientActionsTab` / `ClientDeliverablesPane` (`src/App.tsx:435-451`) mounted from `src/App.tsx:381-455`.
> **Wave:** W6 · **Lane:** A-lane (`ui-rebuild-shell`) · **Effort:** **XL** (`docs/ui-rebuild/phase-a/surfaces/global-ops.json:421`).
> **Read order for the builder:** `PHASE_A_DECISIONS.md` -> `CROSS_SURFACE_CONTRACTS.md` -> `BUILD_CONVENTIONS.md` -> `surfaces/global-ops.json` -> `owner-decisions.json` -> `server-backlog.json` -> this ticket -> Keywords pilot (`src/components/keywords-rebuilt/`).
> **Mount contract:** rebuilt Global Ops lenses mount behind `ui-rebuild-shell` through `REBUILT_SURFACES[...]` for every owned `Page` id listed above. This is a controller-applied seam for this fan-out; the Global Ops build lane lists it but does **not** edit `src/components/layout/rebuiltSurfaces.ts` (`src/App.tsx:462-478`; `src/components/layout/rebuiltSurfaces.ts:17-56`).
> **Frozen/domain law:** AD-007 means every Global Ops page gets an explicit build/cut/defer verdict. C-7 keeps Diagnostics reachable as a nav/list page. C-8 retires Meeting Brief; do not resurrect Page `brief`. C-5 makes Workspace Settings the competitor-set editing home. AD-023 forbids an ad-hoc request->signal endpoint. Every value/wins seam in this ticket must apply C4 attribution honesty: exclude `not_acted_on`; render `externally_executed` as client-side / "we called it" framing; only `platform_executed` may claim "we shipped."

## 1. ⚠ OWNER DELTAS

All Global Ops `openQuestions` are resolved here before build. G-Q2's surface JSON default is stale: it is superseded by the later ratified C-8 owner cut, already executed by W0.3. That is still an explicit cut under AD-007, not a silent drop.

| Open question | Adopted default | Build implication |
|---|---|---|
| **G-Q1** Zone absent from the 18-surface map | Cut tickets from the 9-lens composition; nothing silently dropped. | This ticket owns explicit build/cut/defer verdicts for Settings, Workspace Settings, Roadmap, Business, Outcomes, Diagnostics, Requests, Meeting Brief, and Onboarding. |
| **G-Q2** Meeting Brief has no home | **Effective adopted default: retired/cut per C-8 and PHASE_A_DECISIONS.** The stale carry-over default in `global-ops.json` is overridden by the ratified owner cut. | Do not build Meeting Brief. Existing D8 rows `brief -> home` and `home?tab=meeting-brief -> home` stay authoritative (`docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md:7-8`). |
| **G-Q3** Onboard-as-Client dead code | Wire: prospect report -> New-workspace form with URL prefill. | Build the prefill contract in the rebuilt global workspace-creation flow; replace the dead `window.location.hash = '#new-workspace?...'` handoff (`src/components/SalesReport.tsx:265-266`) with real state/URL intake. |
| **G-Q4** Requests 4 sub-tools -> single feed | Hybrid: prototype feed for signals + promote flow; retain RequestManager as an "All requests" view. | Build a feed shell with sub-tabs/views for Deliverables, Signals, Requests, and Client Actions. Preserve `RequestManager` lifecycle machinery; defer only the promote write per AD-023. |
| **G-Q5** Per-workspace outcome tabs home | Keep `OutcomeDashboard` mounted behind the book table's workspace link until Insights Engine rehome is specced. | Build the Outcomes book and keep Page `outcomes` as the per-workspace drill-in; add `DEF-global-ops-009` for the later rehome. |
| **G-Q6** Diagnostics nav entry vs drill-in-only | Keep nav entry and add a list lens. | Build Diagnostics list + `?report=` detail; keep old reports reachable and keep sender surfaces alive. |
| **G-Q7** Workspace Settings depth | Full parity; all unhomed capabilities are UI-only ports. | Build the full multi-tab workspace settings surface; no legacy-route fallback. Add archive workspace (`SB-043`) and zero-server additions. |
| **G-Q8** Client onboarding questionnaire/wizard rehome | Owned by D4 C-phase; Global Ops only preserves admin enable/reset controls. | Build admin cold-start/onboarding controls and locked-workbench preview; defer client questionnaire/wizard re-skin to `DEF-global-ops-004`. |
| **G-Q9** Prototype-only features sign-off | Adopt individually: adopt the ui-only/S features, defer tz/locale and diagnostics stage/export, adopt request promote only as the AD-023 flagged follow-up. | See §2.10 and §3. No blanket adoption. |
| **G-Q10** Outcomes value framing | Additive: add value fields via `SB-013`, keep HEAD columns. | Outcomes book consumes SB-013 rollups; retained HEAD columns must not become a second value/wins derivation. |
| **G-Q11** Strategy inputs relocation | Relocate with a redirect note; confirm with Strategy owner before removing `StrategySettings`. | Workspace Settings becomes the edit home for competitor domains and strategy inputs; old Strategy controls remain until coordinated removal (`DEF-global-ops-005`). |

## 2. Capability Checklist

Every `capabilityClassification` row in `surfaces/global-ops.json:4-173` is an acceptance criterion. The rebuilt surface is a multi-page/lens shell, not a new route family: use the existing `Page` ids and URL shapes, and keep flag-OFF legacy components byte-identical.

### 2.1 Build-or-cut table

| Page / composition item | Existing Page id / path | Verdict | Required handling |
|---|---|---|---|
| Settings | `settings` (`/settings`) | **BUILD** | Rebuild global settings in place: Google OAuth, GSC properties, Webflow overview, API keys, platform health, storage monitor with all four prune actions, booking link, global feature flags, Stripe config, MCP keys. |
| Workspace Settings - Connections | `workspace-settings?tab=connections` | **BUILD** | Preserve Webflow token flow, live domain, Google OAuth, GSC/GA4 pickers, Integration Health Center, GBP connection card, and competitor-set edit entry. |
| Workspace Settings - Features | `workspace-settings?tab=features` | **BUILD** | Preserve tier management, portal toggles, onboarding enable/reset, reports generate-now, white-label branding, site capabilities, and auto-report cadence. |
| Workspace Settings - Feature Flags | `workspace-settings?tab=flags` | **BUILD** | Preserve per-workspace override/default concept from `WorkspaceFeatureFlagOverrides`. |
| Workspace Settings - Publishing | `workspace-settings?tab=publishing` | **BUILD** | Preserve CMS publish target controls through `PublishSettings`. |
| Workspace Settings - Client Dashboard | `workspace-settings?tab=dashboard` | **BUILD** | Preserve client access, client users CRUD, GA4 events, conversion tracking, outcome value, and measured-capture flag-safe controls. |
| Workspace Settings - Data Export | `workspace-settings?tab=export` | **BUILD** | Preserve CSV/JSON exports for briefs, requests, strategy, activity, and payments. |
| Workspace Settings - `llms-txt` | `workspace-settings?tab=llms-txt` | **BUILD TEMPORARY / DEFER FINAL MOVE** | Keep reachable until AI Visibility has a verified receiving home; final relocation is `DEF-global-ops-006`. |
| Workspace Settings - Archive workspace | `workspace-settings` action | **BUILD** | `SB-043` rides: archived_at + PATCH archive/unarchive + default list exclusion. |
| Workspace Settings - tz/locale prefs | no current field | **DEFER** | `SB-044` deferred via `DEF-global-ops-001`; cadence stays because it exists today. |
| Roadmap | `roadmap` (`/roadmap`) | **BUILD** | Preserve sprint/backlog views, status cycle, stats, velocity, filters, sorting, expand, and add free-text search/sort dropdown. |
| Business - Revenue | `revenue` | **BUILD** | Consolidate into Business lens sub-tab; preserve stats/chart/lists/transactions, delete payment, and purge all with `ConfirmDialog`. |
| Business - AI Usage | `ai-usage` | **BUILD** | Consolidate into Business lens sub-tab; preserve AI cost/calls/provider breakdown, DataForSEO credits, daily charts, and return-null-when-zero behavior. |
| Business - Features | `features` | **BUILD** | Consolidate into Business lens sub-tab; preserve search/grouping by pain point and platform area. |
| Business - Prospects | `prospect` | **BUILD** | Consolidate into Business lens sub-tab; preserve prospect job/history, printable report, report detail, and Onboard-as-Client handoff rewired to New Workspace prefill. |
| Business route deletion | old Page ids `revenue`, `ai-usage`, `features`, `prospect` | **DEFER** | Ship additive D8 alias/redirect map now; no destructive route deletion in W6 (`DEF-global-ops-007`). |
| Outcomes book | `outcomes-overview` | **BUILD** | Build cross-workspace book on SB-013 rollups: value-$/mo, GSC rollup, issue matrix, win-rate/scored/coverage/attention columns additive. |
| Outcomes per-workspace view | `outcomes` | **BUILD** | Preserve `OutcomeDashboard` tabs: Top Wins, Scorecard, Playbooks, Actions, Learnings, Coverage, and `RecordPublishedWorkCard`. Later Insights Engine rehome is deferred. |
| Diagnostics list | `diagnostics` | **BUILD** | Keep nav/list lens so old reports remain reachable. |
| Diagnostics report drill-in | `diagnostics?report=:reportId` | **BUILD** | Preserve running, failed, completed detail states and `?report=` receiver. |
| Diagnostics stage/export | no current endpoint | **DEFER** | `SB-042` deferred via `DEF-global-ops-002`. |
| Requests feed | `requests?tab=deliverables|signals|requests|actions` | **BUILD** | Build unified feed shell over existing Deliverables, Signals, All Requests, and Client Actions. |
| Requests promote to signal | no current endpoint | **DEFER** | Adopt as AD-023 flagged follow-up, not as an ad-hoc W6 endpoint (`DEF-global-ops-003`). |
| Meeting Brief | no Page id at HEAD; old `brief` retired | **CUT** | Owner-retired on 2026-07-05; do not rebuild or add a new mount. Existing server archive migration `176-archive-meeting-briefs.sql` is unrelated to the rebuilt UI. |
| Onboarding admin cold-start flow | no standalone Page id | **BUILD** | Build inside Global Ops rebuilt shell using existing connection/audit/strategy state and workspace creation entry point. |
| Client onboarding questionnaire/wizard | client C-lane | **DEFER** | Preserve admin enable/reset controls only; D4 C-phase owns the client re-skin (`DEF-global-ops-004`). |

### 2.2 Settings (global)

- [ ] **Google Account.** Preserve status/auth/disconnect and GSC property list (`src/components/SettingsPanel.tsx:106-125`). Move raw calls into `src/hooks/admin/useGlobalOpsSettings.ts`; components must not call raw `get()`/`post()`.
- [ ] **Webflow Connections overview.** Preserve linked/unlinked workspace overview and no-workspace empty state (`src/components/SettingsPanel.tsx:127-202`). Use `DataList` or `DataTable` depending on density; do not invent link/unlink behavior here.
- [ ] **API keys + platform health.** Preserve OpenAI/Webflow/Google/Email/Stripe health status (`src/components/SettingsPanel.tsx:205-287`) with data-blue, success-emerald, warning-amber, error-red tones only.
- [ ] **Storage monitor.** Preserve `/api/admin/storage-stats`, storage breakdown, refresh action, and all four prune actions: backups, reports, chat, and activity logs (`src/components/SettingsPanel.tsx:70-93,291-444`). Cleanup actions are destructive enough for `ConfirmDialog`.
- [ ] **Booking link.** Preserve `/api/studio-config` read and `PATCH /api/studio-config` write (`src/components/SettingsPanel.tsx:447-480`). Clearing the URL must stay valid.
- [ ] **Global feature flags.** Carry `FeatureFlagSettings` with the override-vs-default concept and reset behavior (`src/components/SettingsPanel.tsx:482`; `FeatureFlagSettings.tsx` default/override rows). Do not add a second feature-flag mechanism.
- [ ] **Stripe payments.** Carry `StripeSettings` as T1 carry-over; payments must remain configurable from the UI (`src/components/SettingsPanel.tsx:485`).
- [ ] **MCP API keys.** Carry `McpApiKeysSettings` as T1 carry-over (`src/components/SettingsPanel.tsx:488`).

### 2.3 Workspace Settings

- [ ] **URL receiver.** Preserve the `?tab=` two-halves contract for `connections|features|flags|publishing|dashboard|export|llms-txt` (`src/components/WorkspaceSettings.tsx:71-107`). New rebuilt state must read and validate `tab` on first render and subsequent URL changes.
- [ ] **Rename workspace.** Preserve inline name edit and `PATCH /api/workspaces/:workspaceId` write (`src/components/WorkspaceSettings.tsx:113-170`). `SB-043` archive is separate and must not reuse delete semantics.
- [ ] **Connections tab.** Preserve Webflow token flow, selected live domain, Google connection, GSC/GA4 picker, Integration Health Center, and GBP card (`src/components/settings/ConnectionsTab.tsx:40-330`; `src/components/google-business-profile/GbpConnectionCard.tsx:1-109`; `src/hooks/admin/useIntegrationHealth.ts:6-14`; `src/hooks/admin/useGoogleBusinessProfile.ts:11-91`).
- [ ] **Competitor-set editing home.** Adopt C-5/AD-014: Workspace Settings is the single edit home. Reuse `GET /api/seo/discover-competitors/:workspaceId` and `POST /api/seo/competitors/:workspaceId` (`src/api/seo.ts:101-105`; `server/routes/seo-provider.ts:186-228`). Competitors surface becomes read-only chips + "Edit set" route.
- [ ] **Strategy inputs relocation.** Relocate `StrategySettings` controls (business context, SEO data mode, max pages, competitor domains, auto-discover) into Workspace Settings, but do not remove `StrategySettings` from Strategy until the Strategy owner confirms the single-source cut (`src/components/strategy/StrategySettings.tsx:10-140`; `src/components/strategy/hooks/useStrategySettings.ts:31-158`; `DEF-global-ops-005`).
- [ ] **Features tab full parity.** Preserve tier, client portal, external billing, SEO/analytics/site-intelligence visibility, onboarding enable/reset, auto-reports + send-now, white-label branding, and site capabilities (`src/components/settings/FeaturesTab.tsx:38-520`).
- [ ] **Per-workspace flags.** Preserve inherited/global/workspace source display and clear override behavior (`src/components/settings/WorkspaceFeatureFlagOverrides.tsx:41-134`; API wrapper `src/api/platform.ts:43-51`).
- [ ] **Publishing.** Preserve `PublishSettings` field mapping and save contract (`src/components/PublishSettings.tsx:66`).
- [ ] **Client Dashboard tab.** Preserve client access, client users, conversion tracking, GA4 events, outcome value, and measured-capture controls (`src/components/settings/ClientDashboardTab.tsx:69-1042`).
- [ ] **Data export.** Preserve `/api/export/:workspaceId/:key?format=csv|json` links for all existing keys (`src/components/WorkspaceSettings.tsx:317-350`).
- [ ] **GBP connection card.** Adopt in rebuild; zero server work. It uses existing `useGbpConnectionStatus`, `useGbpAuthUrl`, `useGbpSync`, and `useGbpDisconnect` hooks (`src/components/google-business-profile/GbpConnectionCard.tsx:1-109`).
- [ ] **Archive workspace.** Adopt in rebuild with `SB-043` riding. UX must be distinct from delete, use `ConfirmDialog`, log activity, broadcast/invalidate workspace lists, and default workspace lists must exclude archived workspaces.
- [ ] **Re-run initial audit / strategy.** Adopt in rebuild as zero-server-work additions: audit job start uses existing SEO audit job/route patterns (`src/hooks/admin/useSeoAuditWorkflow.ts:87-113`; `server/routes/webflow-seo-audit.ts:18-37`), and strategy generation uses existing keyword strategy/background job entry points (`server/routes/keyword-strategy.ts:139-215`).
- [ ] **Reporting cadence + timezone/locale.** Keep existing cadence (`autoReports`, `autoReportFrequency`, `Send Report Now`) and defer timezone/locale fields to `SB-044`.

### 2.4 Roadmap

- [ ] **Sprint / Backlog views.** Preserve `?view=sprint|backlog` receiver; it deliberately uses `view`, not shared `tab` (`src/components/Roadmap.tsx:24-30,97-104,160-161`).
- [ ] **Status cycle.** Preserve optimistic `pending -> in_progress -> done` status cycle with snapshot/revert/invalidate (`src/components/Roadmap.tsx:56-96`; API wrapper `src/api/platform.ts:25-34`).
- [ ] **Stats and velocity.** Preserve totals, completion, current sprint, and velocity chart (`src/components/Roadmap.tsx:117-158`). Completion rate denominator must be the same item count displayed next to it.
- [ ] **Filters, sorting, expand.** Preserve existing filter bar and sprint/backlog item behavior; add prototype free-text search + sort dropdown as adopted `kitNewFeatures`.
- [ ] **A11y.** Rebuilt sortable/filterable rows must use `DataTable` with `aria-sort` and runtime tests for keyboard row activation.

### 2.5 Business lens (Revenue | AI Usage | Features | Prospects)

- [ ] **One Business lens, additive route aliases.** Business is a lens, not a new `Page`. Since `src/routes.ts` has no `business` id, use Page `revenue` as the canonical rebuilt receiver with `?tab=revenue|ai-usage|features|prospects`, and mount/redirect old `ai-usage`, `features`, and `prospect` routes into the same receiver. The old Page ids stay in the union for this PR.
- [ ] **Revenue sub-tab.** Preserve `/api/revenue/summary`, monthly chart, by-workspace/by-product lists, recent transactions, delete one payment, and purge all (`src/components/RevenueDashboard.tsx:46-255`). Destructive actions require `ConfirmDialog`.
- [ ] **AI Usage sub-tab.** Preserve `/api/ai/usage?days=7|14|30`, AI cost/calls, provider breakdown, by-feature cost, and DataForSEO credits/daily chart (`src/components/AIUsageSection.tsx:43-260`). Keep return-null-when-zero semantics so empty workspaces do not render noisy zero charts.
- [ ] **Features sub-tab.** Preserve Feature Library search and grouping by pain point/platform area (`src/components/FeatureLibrary.tsx:55-185`; API wrapper `src/api/platform.ts:36-40`).
- [ ] **Prospects sub-tab.** Preserve sales report job start, background progress, history, report detail, printable HTML, and client report action (`src/components/SalesReport.tsx:58-280`; API wrapper `src/api/misc.ts:236-244`).
- [ ] **Onboard-as-Client.** Adopt G-Q3: replace dead hash-only handoff (`src/components/SalesReport.tsx:265-266`; repo-wide `rg '#new-workspace'` finds no consumer) with a real New Workspace prefill in the rebuilt global shell. This is UI-only; `POST /api/workspaces` already exists through `useCreateWorkspace` (`src/App.tsx:12,272-279`).
- [ ] **D8 contract.** Add the four Business rows in §7. They are alias/redirect rows only; route deletion is a separate follow-up and covered by `DEF-global-ops-007`.

### 2.6 Outcomes

- [ ] **Book roll-up source.** Outcomes book and any cross-client value column must consume `SB-013` workspace-overview rollups. Do not re-derive value-$/mo, GSC rollups, or issue-matrix data in React from per-workspace detail calls.
- [ ] **Attribution honesty at every value/wins seam.** Any book value, recovered value, top-win, "wins", or cross-client value total must exclude `not_acted_on`. `externally_executed` rows must render as "client-side / we called it" framing; only `platform_executed` may say "we shipped." Add integration tests proving the exclusions at the read path, not just UI filters.
- [ ] **Additive columns.** Preserve current `WorkspaceOutcomeOverview` columns (win rate, trend, active actions, scored last 30d, top win, attention, coverage) while adding SB-013 value fields (`src/components/admin/outcomes/OutcomesOverview.tsx:45-181`; `shared/types/outcome-tracking.ts:519-537`).
- [ ] **Current route caveat.** Existing `GET /api/outcomes/overview` has no value fields and intentionally keeps `not_acted_on` in some admin scorecard semantics (`server/routes/outcomes.ts:171-230`). New value/wins columns must not use that as a value source unless the server projection is extended with explicit attribution-honest fields.
- [ ] **Top wins.** Existing top-win readers filter `not_acted_on` (`server/outcome-tracking.ts:83-103,844-876`). Preserve/carry `attribution` through any rendered win and use honest labels.
- [ ] **Per-workspace dashboard.** Preserve `OutcomeDashboard` tabs and `RecordPublishedWorkCard` (`src/components/admin/outcomes/OutcomeDashboard.tsx:21-50`; `src/components/admin/outcomes/RecordPublishedWorkCard.tsx:22-26`). If the rebuilt view adds `?tab=`, receiver tests must prove every tab deep-links.
- [ ] **Coverage funnel.** Keep admin-only coverage diagnostics admin-only (`src/components/admin/outcomes/OutcomeCoverageFunnel.tsx:110-136`); do not surface raw admin value/provenance client-side.

### 2.7 Diagnostics

- [ ] **List lens.** Build Diagnostics list as a first-class nav entry, preserving `useDiagnosticsList` and empty state routing (`src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:144-192`; `src/hooks/admin/useDiagnostics.ts:4-13`).
- [ ] **`?report=` receiver.** Preserve report detail receiver exactly: `?report=:reportId` loads detail; missing param shows list (`src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:194-202`).
- [ ] **Running and failed states.** Preserve running/pending guard and failed-state copy; never dereference `diagnosticContext` on running reports (`src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:93-121`).
- [ ] **Completed report detail.** Preserve at-a-glance stats, root causes, remediation plan, and evidence accordion (`src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:36-83`).
- [ ] **Run diagnostic.** Preserve `useRunDiagnostic` job creation (`src/hooks/admin/useDiagnostics.ts:36-45`; API wrapper `src/api/diagnostics.ts:15-16`). The Run-Deep-Diagnostic CTA senders stay pointed at this page/list+detail.
- [ ] **Read-only issue matrix.** Global Ops may consume the SB-013 read-only site-health issue matrix in Diagnostics or Outcomes. The cross-client batch-fix job remains `SB-060` deferred; no batch write action in W6.
- [ ] **Stage/export.** Defer `SB-042` on-demand stage-single-action-as-backing-move and export projection. The existing automated diagnostics->recommendations producer is not a UI action and must not be relabeled as one.

### 2.8 Requests

- [ ] **Existing `?tab=` receiver.** Preserve the Requests receiver for `deliverables|signals|requests|actions` (`src/App.tsx:243-254,435-451`). Rebuilt Global Ops must read and validate `tab`; default remains `deliverables` unless owner signs a new default.
- [ ] **Unified feed + All requests.** Build the prototype feed shell for signals and high-priority items, but retain RequestManager as "All requests" with status machine, priority/category editing, filters, notes/attachments, quick status, and bulk operations (`src/components/RequestManager.tsx:86-570`).
- [ ] **Deliverables pane.** Preserve grouped deliverables by status axis, stale badge, reminder, and workspace broadcast invalidation (`src/components/admin/ClientDeliverablesPane.tsx:115-210`).
- [ ] **Signals pane.** Preserve `AdminInbox` all/new tabs and signal status transitions (`src/components/admin/AdminInbox.tsx:138-210`).
- [ ] **Client actions pane.** Preserve `ClientActionsTab` approved/awaiting list, complete action, and content-decay routing behavior (`src/components/admin/ClientActionsTab.tsx:53-210`).
- [ ] **Promote request -> strategy signal.** Adopt the product direction, but do **not** build an ad-hoc endpoint in this surface. AD-023 requires one flagged, contract-backed flow across Global Ops, Cockpit, Engine, Insights, and Recommendations; defer to `DEF-global-ops-003`.

### 2.9 Meeting Brief and Onboarding

- [ ] **Meeting Brief cut.** Do not mount or rebuild Meeting Brief. C-8 is ratified and already executed; Page `brief` is absent from `src/routes.ts`, and the D8 rows are already in `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md:7-8`. Any lingering briefing/OV divergence code belongs to the client briefing/recommendations systems, not Meeting Brief resurrection.
- [ ] **Admin onboarding cold-start flow.** Build the admin cold-start flow from existing connection/audit/strategy state. If the implementation discovers a missing derived setup-state endpoint, stop and report rather than fabricating status from incomplete fields.
- [ ] **Locked-workbench preview.** Adopt as pure presentation over setup state. It must not block existing admin workspaces or create a new Page id.
- [ ] **Workspace creation entry.** Preserve `POST /api/workspaces` creation path through existing workspace mutation plumbing; the Business Prospects handoff must prefill this flow.
- [ ] **Client questionnaire/wizard.** Do not rehome or restyle client questionnaire/wizard in this W6 A-lane ticket. Preserve admin enable/reset only; D4 C-phase owns the client-facing work (`DEF-global-ops-004`).

### 2.10 Prototype-only kit features

The surface JSON lists nine `kitNewFeatures`; all nine are recorded to avoid silent scope loss.

| Kit feature | Recommendation adopted | Build handling |
|---|---|---|
| Promote request -> strategy signal | Adopt as flagged follow-up | Defer write to AD-023/SB-002; feed reserves a disabled/planned affordance only if product copy is honest. |
| Archive workspace | Adopt in rebuild | `SB-043` rides. |
| GBP connection card | Adopt in rebuild | Build in Workspace Settings Connections; zero server work. |
| Re-run initial audit / initial strategy buttons | Adopt in rebuild | Build with existing audit/strategy endpoints/jobs. |
| Reporting cadence + timezone/locale prefs | Defer tz/locale | Cadence builds; timezone/locale defers to `DEF-global-ops-001`. |
| Diagnostics stage-as-backing-move + export | Defer | `DEF-global-ops-002`; no write/export UI in W6. |
| Locked-workbench preview | Adopt in rebuild | Build as Onboarding presentation over setup state. |
| Gated cold-start onboarding flow | Adopt in rebuild | Build admin cold-start flow. |
| Roadmap free-text search + sort dropdown | Adopt in rebuild | Build client-side on Roadmap with URL-safe state and `aria-sort`. |

## 3. Server Tickets

Consume verifier-adjusted backlog IDs, not gatherer-only `sn-*` labels.

| SB / sn | Title | Effort | Disposition | Build instruction |
|---|---|---:|---|---|
| **SB-013** (`sn-global-ops-3` + read-only site-audit/search-traffic rollups) | Cross-workspace rollup endpoint(s): outcome value, GSC book, site-health issue-matrix | L | **RIDE / CONSUME W6** | Extend or consume `/api/workspace-overview` rollups for value-$/mo, GSC clicks/traffic/position, and issue-type x client matrix. Value/wins fields must exclude `not_acted_on`; carry attribution for externally executed rows. Do not compute values in React. |
| **SB-043** (`sn-global-ops-1`) | Archive workspace (`archived_at` + PATCH + list exclusion) | M | **RIDE W6** | Add migration, shared type field, `WorkspaceRow`/mapper serialization, PATCH archive/unarchive route, activity log, broadcast/invalidation, and default `listWorkspaces` exclusion. Do not conflate with `action_outcomes_archive`. |
| **SB-044** (`sn-global-ops-2`) | Per-workspace timezone/locale preference fields | S | **DEFER -> `DEF-global-ops-001`** | Reporting cadence already exists; timezone/locale touches report rendering/client timestamps and is not required for parity. |
| **SB-002** (`sn-global-ops-4`) | Promote client request -> strategy signal / backing move | M | **DEFER -> `DEF-global-ops-003`** | AD-023 adopts this only as a single flagged, contract-backed cross-surface flow. No Global Ops-only endpoint, activity, broadcast, insight write, or recommendation mint ships in W6. |
| **SB-042** (`sn-global-ops-5`) | Diagnostics on-demand stage-single-action-as-backing-move + report export | M | **DEFER -> `DEF-global-ops-002`** | Existing batch producer can map diagnostics to recommendations, but there is no on-demand stage endpoint or export projection. Do not build action UI until the endpoint/export contract exists. |
| **SB-060** | Cross-workspace site-health batch-fix background job | L | **DEFER -> `DEF-global-ops-008`** | Global Ops may consume the SB-013 read-only issue matrix; it must not build a cross-client batch-fix job in W6. |

**Net:** `SB-013` and `SB-043` ride W6. `SB-044`, `SB-002`, `SB-042`, and `SB-060` defer with DEF coverage.

## 4. Deep-Link Receiver Matrix

The rebuilt surface must keep the two-halves deep-link contract. Do not overload `tab` for unrelated local state where the legacy page already uses another param (`Roadmap` uses `view`, Diagnostics uses `report`).

| URL / sender | Receiver requirement | Evidence |
|---|---|---|
| `/settings` | Open Global Settings. No local `tab` exists today; if rebuilt Settings adds lenses, use a validated `lens` param instead of stealing Business/Requests `tab` semantics. | Current mount at `src/App.tsx:381`; component at `src/components/SettingsPanel.tsx:57`. |
| `/ws/:workspaceId/workspace-settings?tab=connections` | Open Connections; preserve invalid fallback to `connections`. | Current receiver at `src/components/WorkspaceSettings.tsx:88-107`. |
| `/ws/:workspaceId/workspace-settings?tab=features` | Open Features. | Current render at `src/components/WorkspaceSettings.tsx:274-281`. |
| `/ws/:workspaceId/workspace-settings?tab=flags` | Open per-workspace feature flags. | Current render at `src/components/WorkspaceSettings.tsx:283-285`. |
| `/ws/:workspaceId/workspace-settings?tab=publishing` | Open Publishing. | Current render at `src/components/WorkspaceSettings.tsx:287-294`. |
| `/ws/:workspaceId/workspace-settings?tab=dashboard` | Open Client Dashboard settings. | Current render at `src/components/WorkspaceSettings.tsx:297-304`. |
| `/ws/:workspaceId/workspace-settings?tab=export` | Open Data Export. | Current render at `src/components/WorkspaceSettings.tsx:317-350`. |
| `/ws/:workspaceId/workspace-settings?tab=llms-txt` | Open temporary LLMs.txt carry-over until AI Visibility receiving home ships. | Current render at `src/components/WorkspaceSettings.tsx:306-314`; final relocation tracked by `DEF-global-ops-006`. |
| `/roadmap?view=sprint` / `/roadmap?view=backlog` | Open Roadmap Sprint or Backlog view. Keep `view`, not `tab`. | Current receiver at `src/components/Roadmap.tsx:24-30,97-104`. |
| `/revenue` | Business lens, Revenue sub-tab. Missing `?tab=` defaults to `revenue`. | Current Page id at `src/routes.ts:18`; current mount at `src/App.tsx:388`. |
| `/revenue?tab=ai-usage` | Business lens, AI Usage sub-tab. | New D8 receiver; no Page `business` exists. |
| `/revenue?tab=features` | Business lens, Features sub-tab. | New D8 receiver; no Page `business` exists. |
| `/revenue?tab=prospects` | Business lens, Prospects sub-tab. | New D8 receiver; old Page is singular `prospect`, sub-tab label may be plural. |
| `/ai-usage` | Additive redirect/alias to Business lens `?tab=ai-usage`; Page id remains for this PR. | Current Page id at `src/routes.ts:15`; current mount at `src/App.tsx:387`. |
| `/features` | Additive redirect/alias to Business lens `?tab=features`; Page id remains for this PR. | Current Page id at `src/routes.ts:19`; current mount at `src/App.tsx:389`. |
| `/prospect` | Additive redirect/alias to Business lens `?tab=prospects`; Page id remains for this PR. | Current Page id at `src/routes.ts:13`; current mount at `src/App.tsx:386`. |
| `/outcomes-overview` | Open cross-workspace Outcomes book. | Current Page id at `src/routes.ts:21`; current mount at `src/App.tsx:390`. |
| `/ws/:workspaceId/outcomes` | Open per-workspace Outcomes dashboard, default Top Wins. | Current mount at `src/App.tsx:455`; current tabs at `src/components/admin/outcomes/OutcomeDashboard.tsx:21-50`. |
| `/ws/:workspaceId/outcomes?tab=wins|scorecard|playbooks|actions|learnings|coverage` | If rebuilt Outcomes adds URL tabs, read and validate them. Invalid values fall back to `wins`. | Current component has local state only; runtime receiver tests required if URL tabs are added. |
| `/ws/:workspaceId/diagnostics` | Open Diagnostics report list. | Current receiver at `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:194-202`. |
| `/ws/:workspaceId/diagnostics?report=:reportId` | Open report detail, including running/failed/completed states. | Current detail at `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:85-121`. |
| `/ws/:workspaceId/requests?tab=deliverables` | Open Client Deliverables. | Current receiver in `src/App.tsx:243-254,448`. |
| `/ws/:workspaceId/requests?tab=signals` | Open Admin Inbox / Signals. | Current receiver in `src/App.tsx:243-254,449`. |
| `/ws/:workspaceId/requests?tab=requests` | Open All Requests / RequestManager. | Current receiver in `src/App.tsx:243-254,450`. |
| `/ws/:workspaceId/requests?tab=actions` | Open Client Actions. | Current receiver in `src/App.tsx:243-254,451`. |
| `/ws/:workspaceId/brief` and `home?tab=meeting-brief` | Already retired to `home`; do not add a rebuilt receiver. | D8 rows at `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md:7-8`; Page `brief` absent from `src/routes.ts`. |

## 5. Flag Disposition

| Flag / mount | Required behavior |
|---|---|
| `ui-rebuild-shell` | This is the only feature flag for rebuilt Global Ops. It exists as the global shell flag (`shared/types/feature-flags.ts:112-123,460-470`) and must gate rebuilt mounts through `REBUILT_SURFACES`, not a new surface-specific flag. |
| Rebuilt mounts | Controller adds `REBUILT_SURFACES[...]` entries for `settings`, `workspace-settings`, `roadmap`, `revenue`, `ai-usage`, `features`, `prospect`, `outcomes-overview`, `outcomes`, `diagnostics`, and `requests`. The build lane must not edit `src/components/layout/rebuiltSurfaces.ts`. |
| Flag-OFF behavior | Legacy `SettingsPanel`, `WorkspaceSettings`, `Roadmap`, `RevenueDashboard`, `AIUsageSection`, `FeatureLibrary`, `SalesReport`, `OutcomesOverview`, `OutcomeDashboard`, `DiagnosticReportPage`, and Requests tab composition remain byte-identical through `src/App.tsx:381-455`. Do not edit these legacy components for flag-ON work. |
| Per-workspace flags | Workspace Settings may display/edit per-workspace overrides, but `ui-rebuild-shell` is a global UI-shell flag. Do not assume per-workspace overrides mount rebuilt client UI. |
| No flag retirement | Do not retire `ui-rebuild-shell` in W6. Do not add a second dark-launch flag for Global Ops. |
| Real-render smoke | Required before merge: flag ON in browser with at least one workspace that has settings data, outcomes, diagnostics, requests, sales report history, revenue/AI usage, and roadmap data. Click every Business sub-tab, every Workspace Settings tab, Diagnostics list/detail, Requests views, and archive-workspace confirm/cancel. |

## 6. File Ownership

### Owned by the Global Ops build PR

- `src/components/global-ops-rebuilt/**` - rebuilt `@ds-rebuilt` surface. Suggested split: `GlobalOpsSurface.tsx`, `GlobalSettingsLens.tsx`, `WorkspaceSettingsLens.tsx`, `RoadmapLens.tsx`, `BusinessLens.tsx`, `OutcomesBookLens.tsx`, `OutcomeWorkspaceLens.tsx`, `DiagnosticsLens.tsx`, `RequestsLens.tsx`, `OnboardingLens.tsx`, `useGlobalOpsSurfaceState.ts`, `globalOpsMutationFeedback.ts`, and formatters. Every file first line `// @ds-rebuilt`.
- `src/hooks/admin/useGlobalOps*.ts` - React Query wrappers/adapters over settings, workspaces, roadmap, revenue, AI usage, feature library, sales reports, outcomes, diagnostics, requests, deliverables, GBP, integration health, and archive workspace. No raw `fetch()` or raw API client calls in components.
- `tests/component/global-ops-rebuilt/**` - flag-ON mount, seeded real `useFeatureFlag`, a11y floor, loading/empty/error states, Business sub-tab receiver tests, Workspace Settings `?tab=` receiver tests, Diagnostics `?report=` receiver tests, Requests `?tab=` receiver tests, DataTable overflow checks, and attribution-honesty display assertions.
- `tests/contract/tab-deep-link-wiring.test.ts` or adjacent contract coverage - add/adjust receiver expectations for Business consolidation, Workspace Settings, Requests, Diagnostics, and per-workspace Outcomes if URL tabs are added.
- `tests/integration/**` focused files for `SB-013` and `SB-043`: cross-workspace rollup value/wins attribution exclusions; issue matrix read shape; GSC rollup shape; archive/unarchive mutation, list exclusion, activity log, and broadcast/invalidation.
- `server/routes/workspaces.ts`, `server/workspaces.ts`, `shared/types/workspace.ts`, and a new migration only for `SB-043` archive workspace.
- `server/routes/workspaces.ts` `/api/workspace-overview`, a dedicated rollup module if needed, shared/admin types, and tests only for `SB-013` rollups. Apply attribution-honesty at this read path.
- Shared/client type files needed for additive rollup fields, archive fields, and typed hook contracts. Prefer `shared/types/` contracts over `Record<string, unknown>`.
- `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md` - add the §7 Business rows in the implementation PR.
- `data/ui-rebuild-deferred-ledger.json` - add the §7 DEF rows in the same PR as the surface implementation.
- `data/roadmap.json` / `FEATURE_AUDIT.md` - add/update W6 Global Ops implementation status per project completion rules.

### Reused, not rewritten

- Legacy components listed in the header are behavior references only. Wrap/adapt their contracts; do not edit them for flag-ON UI.
- `src/components/settings/**`, `src/components/google-business-profile/GbpConnectionCard.tsx`, `src/components/strategy/StrategySettings.tsx`, `src/components/admin/outcomes/**`, `src/components/admin/DiagnosticReport/**`, and Requests subcomponents can be T1 carry-over behind rebuilt chrome where dense machinery is not being redesigned.
- Existing API wrappers: `src/api/platform.ts`, `src/api/outcomes.ts`, `src/api/diagnostics.ts`, `src/api/misc.ts`, `src/api/seo.ts`, and `src/api/googleBusinessProfile.ts`.
- Existing hooks: `useDiagnosticsList/useDiagnosticReport/useRunDiagnostic`, `useOutcome*`, `useWorkspaceDeliverables/useRemindDeliverable`, `useWorkspaceFeatureFlags`, `useIntegrationHealth`, `useGbp*`, `useBackgroundTasks`.

### Must not touch / other-owner constraints

- `src/components/layout/rebuiltSurfaces.ts` - mount is controller-applied for this fan-out, listed here only as a contract.
- `src/AppShell.tsx`, `src/components/layout/RebuiltAppChrome.tsx`, shell primitives, and other lanes' rebuilt directories.
- Legacy route components: `src/components/SettingsPanel.tsx`, `src/components/WorkspaceSettings.tsx`, `src/components/Roadmap.tsx`, `src/components/RevenueDashboard.tsx`, `src/components/AIUsageSection.tsx`, `src/components/FeatureLibrary.tsx`, `src/components/SalesReport.tsx`, `src/components/admin/outcomes/**`, `src/components/admin/DiagnosticReport/**`, `src/components/RequestManager.tsx`, `src/components/admin/AdminInbox.tsx`, `src/components/admin/ClientActionsTab.tsx`, `src/components/admin/ClientDeliverablesPane.tsx`.
- `src/App.tsx` route cases and `src/routes.ts` Page union for route deletion. Business consolidation is additive in W6; destructive route removal is a later route-removal-checklist task (`DEF-global-ops-007`).
- Client questionnaire/wizard components in `src/components/client/**`; D4 C-phase owns those.
- Meeting Brief retired route/table cleanup. Do not recreate Page `brief`, import retired Meeting Brief components, or reverse migration `176-archive-meeting-briefs.sql`.
- `SB-002`, `SB-042`, `SB-044`, and `SB-060` implementation files. They are deferred; W6 may only add honest disabled/planned UI where explicitly useful.

## 7. D8 / DEF Entries

### D8 redirect-map rows to add

Add these rows to `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md` in the Global Ops implementation PR. They are additive aliases/redirects into a Business lens; they do not remove Page ids in W6.

| Old Page id | New lens/sub-tab | Owner PR | Added |
|---|---|---|---|
| `revenue` | Business lens / `?tab=revenue` | W6 global-ops | 2026-07-07 |
| `ai-usage` | Business lens / `?tab=ai-usage` | W6 global-ops | 2026-07-07 |
| `features` | Business lens / `?tab=features` | W6 global-ops | 2026-07-07 |
| `prospect` | Business lens / `?tab=prospects` | W6 global-ops | 2026-07-07 |

Existing Meeting Brief D8 rows (`home?tab=meeting-brief -> home`, `brief -> home`) are already shipped and must not be changed by this ticket.

### Deferred-ledger rows to add in the surface PR

Each row uses the valid deferred-ledger class enum from `BUILD_CONVENTIONS.md`: `token`, `primitive`, `behavior`, `data`, `a11y`, `perf`, or `copy`.

```json
[
  {
    "id": "DEF-global-ops-001",
    "surface": "global-ops",
    "item": "Per-workspace timezone and locale preferences",
    "decision": "Defer timezone/locale fields; rebuild preserves existing report cadence and send-now controls only.",
    "class": "data",
    "upgradeTrigger": "SB-044 lands workspace timezone/locale fields with report-rendering and client timestamp tests.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-global-ops-002",
    "surface": "global-ops",
    "item": "Diagnostics stage-as-backing-move and report export",
    "decision": "Defer on-demand diagnostic remediation staging and export projection; W6 keeps read-only diagnostics list/detail.",
    "class": "behavior",
    "upgradeTrigger": "SB-042 ships an on-demand stage endpoint, export projection, activity logging, and recommendation write contract.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-global-ops-003",
    "surface": "global-ops",
    "item": "Promote client request to strategy signal/backing move",
    "decision": "Adopt as product direction but defer the write path to the AD-023 cross-surface flagged contract; no ad-hoc Global Ops endpoint ships in W6.",
    "class": "behavior",
    "upgradeTrigger": "SB-002/AD-023 lands a shared flagged flow with typed source provenance, request status transition, activity log, broadcast, and Insights/Recommendations receiver contract.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-global-ops-004",
    "surface": "global-ops",
    "item": "Client onboarding questionnaire and welcome wizard re-skin",
    "decision": "Global Ops preserves admin enable/reset and setup-state controls; client questionnaire/wizard rehome stays in the D4 C-phase.",
    "class": "behavior",
    "upgradeTrigger": "D4 C2 client-portal re-skin owns the questionnaire/wizard with Brand Engine data-flow tests.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-global-ops-005",
    "surface": "global-ops",
    "item": "Remove old Strategy Settings home after relocation",
    "decision": "Relocate strategy inputs into Workspace Settings now, but do not remove StrategySettings from the Strategy surface until that owner confirms the single-source cut.",
    "class": "behavior",
    "upgradeTrigger": "Strategy surface owner signs the removal, D8/receiver notes are added, and duplicate edit UI tests prove only Workspace Settings writes competitor/strategy inputs.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-global-ops-006",
    "surface": "global-ops",
    "item": "Final LLMs.txt relocation from Workspace Settings to AI Visibility",
    "decision": "Keep the existing Workspace Settings llms-txt tab reachable until AI Visibility has a real Page/receiver; do not drop the generator in W6.",
    "class": "behavior",
    "upgradeTrigger": "AI Visibility ships a verified receiver and D8 row for llms-txt with runtime deep-link coverage.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-global-ops-007",
    "surface": "global-ops",
    "item": "Destructive route deletion for Business-family Page ids",
    "decision": "W6 ships additive Business redirects/aliases only; Page ids revenue, ai-usage, features, and prospect remain in the Page union until a separate route-removal-checklist PR.",
    "class": "behavior",
    "upgradeTrigger": "Business consolidation soaks on staging, all senders target the Business receiver, and a dedicated route-removal PR follows docs/rules/route-removal-checklist.md.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-global-ops-008",
    "surface": "global-ops",
    "item": "Cross-client site-health batch-fix background job",
    "decision": "Consume the SB-013 read-only issue matrix only; defer cross-client batch-fix writes to a later background-job contract.",
    "class": "behavior",
    "upgradeTrigger": "SB-060 lands a write-safety review, background job worker, activity logging, per-workspace broadcast behavior, and rollback/partial-failure tests.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-global-ops-009",
    "surface": "global-ops",
    "item": "Rehome per-workspace Outcomes dashboard into Insights Engine",
    "decision": "Keep Page outcomes and OutcomeDashboard as the per-workspace drill-in from the Outcomes book until an Insights Engine rehome is specified.",
    "class": "behavior",
    "upgradeTrigger": "Insights Engine owner defines the per-workspace outcomes home, D8/deep-link map, and receiver tests; then Page outcomes can be retired or redirected.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  }
]
```

### Gates before merge

`npm run typecheck && npx vite build && npx vitest run` (full suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` + `npm run verify:deferred-ledger`. Add seeded real-flag component tests, runtime deep-link receiver tests for Workspace Settings / Business / Diagnostics / Requests / Outcomes, integration tests for SB-013 and SB-043, attribution-honesty fixtures covering `not_acted_on` and `externally_executed`, and a flag-ON browser smoke across all Global Ops pages.
