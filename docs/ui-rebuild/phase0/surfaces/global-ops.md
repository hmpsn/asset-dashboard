# Phase 0 Additive-Parity Ledger — Global & Ops Pages (zone: UNMAPPED)

**Auditor scope:** Pages `settings`, `workspace-settings`, `roadmap`, `prospect`, `revenue`, `features`, `ai-usage`, `outcomes`, `outcomes-overview`, `diagnostics`, `requests`, `brief` + onboarding flows.
**Branch:** `ui-rebuild-phase-0` (post-Reconcile staging HEAD). All evidence verified in code, not from memory.
**Prototype views read:** `mockup/settings.js`, `wsettings.js`, `roadmap.js`, `outcomes.js`, `business.js`, `onboard.js`, `requests.js`, `diagnostics.js` (+ `llmstxt.js` cross-reference).

## Headline finding

The Handoff Brief's 18-surface map ("PART 2 — THE SURFACE MAP", `UI Rebuild Handoff Brief.html`) lists only: Cockpit, Insights Engine, Keywords, Competitors, Content Pipeline, Local Presence, Search & Traffic, Site Audit, Performance, Links, Asset Manager, AI Visibility, SEO Editor, Schema, Page Rewriter, Brand & AI, Recommendations, Client portal. **None of this zone's 12+ pages appear in the map**, even though the prototype has working views for eight of them and the Platform Parity Ledger assigns homes ("moved"/"same"/"improved"). If build tickets are cut strictly from the 18-surface map, this entire zone ships nowhere. Every row below therefore needs an explicit build ticket, or an explicit owner decision to cut.

Route facts at HEAD: `src/routes.ts:13-23` (Page union), `src/routes.ts:37` (`GLOBAL_TABS` = settings, roadmap, prospect, ai-usage, revenue, features, outcomes-overview — workspace-independent paths), `src/lib/navRegistry.tsx:99-106` (`brief`, `workspace-settings` are NON_REGISTRY; `diagnostics` IS in the registry, admin group, `navRegistry.tsx:177`).

Legend: **preserved** = has an obvious home, same or better · **improved** = prototype upgrades it · **new_proposed** = prototype-only, needs sign-off · **at_risk** = exists at HEAD, no visible home in prototype/ledger. Uncertain = at_risk.

---

## 1. Settings (global) — `SettingsPanel` → `settings.js` (Parity Ledger: "Same")

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 1 | Google OAuth connect / disconnect (account-wide) | `src/components/SettingsPanel.tsx:115-125` | preserved | settings.js Google section (:121-125) | |
| 2 | GSC properties listing after connect | `SettingsPanel.tsx:106-113,169-185` | preserved | settings.js:124 | |
| 3 | Webflow connections overview (linked/unlinked per workspace) | `SettingsPanel.tsx:127-128,188-224` | preserved | settings.js:127-132 | |
| 4 | API keys section (OpenAI-configured-via-env display) | `SettingsPanel.tsx:226-239` | preserved | folded into Platform Health list | |
| 5 | Platform health: OpenAI/Webflow/Google/Email/Stripe status + workspace stats | `SettingsPanel.tsx:241-289` | preserved | settings.js:134-144 | |
| 6 | Storage monitor: totals, per-dir breakdown bar, quick stats, refresh | `SettingsPanel.tsx:70-77,291-365` | preserved | settings.js:146-154 | |
| 7 | Prune actions ×4: backups, audit snapshots, chat, **activity logs** | `SettingsPanel.tsx:79-93,367-424` | **at_risk** (partial) | settings.js:156-158 has only 3 | "Prune activity logs" (>6 months) omitted from prototype |
| 8 | Booking link config (client-chat "Book a call") | `SettingsPanel.tsx:435-478` | preserved | settings.js:162-166 | |
| 9 | Global feature-flag toggles | `src/components/FeatureFlagSettings.tsx:20-41` | preserved | settings.js:168-172 | |
| 10 | Feature-flag "Reset override" (revert DB override → env/default) | `FeatureFlagSettings.tsx:165-168` | **at_risk** | none | prototype toggle has no override-vs-default concept |
| 11 | Stripe payments config: product enable/disable, price IDs, webhook endpoint info | `src/components/StripeSettings.tsx:151-390` | **at_risk** (partial) | settings.js:202-206 = "Connect Stripe" button only | product/price management UI has no home |
| 12 | MCP API keys: master-key badge, mint (workspace+label), one-time plaintext reveal + copy, list w/ last-used, revoke | `src/components/McpApiKeysSettings.tsx:62-214` | preserved | settings.js:174-199 | full-fidelity mirror |
| 13 | Keyboard shortcut ⌘, → /settings (plus ⌘1-5 tab shortcuts) | `src/App.tsx:254-261` | **at_risk** | shell (unassigned) | shell-level concern; not in prototype nav model |

## 2. Workspace Settings — `WorkspaceSettings` → `wsettings.js` (Parity Ledger: "Improved")

HEAD has 7 sub-tabs: connections, features, flags, publishing, dashboard, export, llms-txt (`src/components/WorkspaceSettings.tsx:71-81`). The prototype's wsettings covers connections + portal + prefs + contacts + danger zone, and **adds** strategy/schedule sections. Most of the depth of 3 HEAD tabs (features, flags, publishing) and 2 whole tabs (export, dashboard-detail) is unhomed.

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 14 | Inline workspace rename (pencil/enter/escape) | `WorkspaceSettings.tsx:163-229` | at_risk | none visible | header shows name only |
| 15 | `?tab=` deep-link receiver contract | `WorkspaceSettings.tsx:88-107` | at_risk (contract) | n/a | must be re-implemented on whatever tab structure ships (CLAUDE.md two-halves contract) |
| 16 | Webflow token link flow (paste token → fetch sites → pick site) | `src/components/settings/ConnectionsTab.tsx:106-160` | preserved | wsettings.js conn cards (:153-165) | prototype simplifies to Connect/Change |
| 17 | Live domain override | `ConnectionsTab.tsx:45,192` | at_risk (minor) | none | |
| 18 | GSC / GA4 property pickers with search | `ConnectionsTab.tsx:326-344` | preserved | wsettings "Change" per connection | |
| 19 | Integration Health Center (per-integration health readout) | `ConnectionsTab.tsx:260-267`; `shared/types/integration-health.ts` | **at_risk** | none | only a "N/4 linked" pill in prototype |
| 20 | Tier management (free/growth/premium) + trial expiry display | `src/components/settings/FeaturesTab.tsx:75-116` | **at_risk** | none | monetization-critical |
| 21 | Client portal enable + SEO view + analytics view toggles | `FeaturesTab.tsx:129-227` | preserved | wsettings portal toggle + section toggles (:216-224) | prototype's 4 portal sections ≠ HEAD's 3 toggles; map explicitly |
| 22 | Client onboarding questionnaire enable / reset | `FeaturesTab.tsx:255-272` | **at_risk** | none | resets client-side questionnaire |
| 23 | Automated reports: weekly/monthly + "generate now" (`POST /api/monthly-report/:id`) | `FeaturesTab.tsx:306-360` | **at_risk** (partial) | wsettings "Update cadence" is display-only (:230-236) | generate-now + frequency editing unhomed |
| 24 | White-label branding: logo URL + accent color | `FeaturesTab.tsx:386-436` | **at_risk** | none | prototype roadmap lists "White-label client portal" as *backlog*, but this already exists at HEAD |
| 25 | Site capabilities: "site has working search endpoint" toggle | `FeaturesTab.tsx:439-459` | at_risk | none | |
| 26 | Per-workspace feature-flag overrides (force on/off, clear) | `src/components/settings/WorkspaceFeatureFlagOverrides.tsx:33-66,173` | **at_risk** | none | only global flags exist in prototype settings |
| 27 | Webflow CMS publish target: collection pick, field mapping, AI-suggested mapping | `src/components/PublishSettings.tsx:81-146` | **at_risk** | none | required by content publish pipeline |
| 28 | Client access: dashboard link copy, shared password set/remove, client email | `src/components/settings/ClientDashboardTab.tsx:182-211,484-511` | **at_risk** (partial) | wsettings shows portal domain only (:221) | |
| 29 | Client users CRUD: add w/ role, edit, remove, password reset | `ClientDashboardTab.tsx:213-255` | **at_risk** (partial) | wsettings Contacts list + Invite toast (:240-244) | prototype shows list only; no edit/remove/password |
| 30 | GA4 event config: pin/group events, event groups w/ page filters | `ClientDashboardTab.tsx:263-340` | **at_risk** | none | |
| 31 | Conversion tracking: Webflow tracked-forms picker | `ClientDashboardTab.tsx:353-384`; `src/api/conversionTracking.ts` | **at_risk** | none | |
| 32 | Outcome value per conversion + AI estimate + segment save | `ClientDashboardTab.tsx:159-183` | **at_risk** | none | feeds ROI/outcome math |
| 33 | Data export: CSV/JSON for briefs, requests, strategy, activity, payments | `WorkspaceSettings.tsx:314-343` (`/api/export/:ws/:key`) | **at_risk** | none | whole tab unhomed |
| 34 | LLMs.txt generator (per-workspace, stats + preview) | `WorkspaceSettings.tsx:306-312`; `src/components/LlmsTxtGenerator.tsx:110-214` | improved | AI Visibility surface (`llmstxt.js:1-8`) | moved; adds llms-full.txt + freshness coding |
| 35 | Strategy inputs: SEO data mode, page limit, competitors + auto-discover, business context | HEAD lives on Strategy surface: `src/components/strategy/StrategySettings.tsx:13-140` | improved (moved) | wsettings.js:100-112,178-200 | prototype relocates these from Strategy → workspace settings; verify single-source-of-truth with Strategy surface owner |
| 36 | Scheduled audits (cadence) | `src/components/audit/ScheduledAuditSettings.tsx:15` | improved (moved) | wsettings.js "Automation & schedules" (:204-213) | prototype generalizes to strategy/crawl/ranks schedules |
| 37 | Delete workspace | `src/components/WorkspaceSelector.tsx:183,301`; `src/api/workspaces.ts:15` | improved (moved) | wsettings.js danger zone (:247-252) | |
| 38 | NEW: Archive workspace (keep data, hide from book) | — | new_proposed | wsettings.js:250 | no archive concept at HEAD |
| 39 | NEW: GBP (Google Business Profile) connection card | — | new_proposed | wsettings.js:159 | HEAD has local-seo GBP data but no per-workspace GBP connect here |
| 40 | NEW: Re-run initial audit / initial strategy buttons | — | new_proposed | wsettings.js:162-163 | |
| 41 | NEW: Reporting cadence + timezone/locale prefs | — | new_proposed | wsettings.js:227-236 | no locale/tz prefs at HEAD |

## 3. Roadmap — `Roadmap` → `roadmap.js` (Parity Ledger: "Same")

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 42 | Sprint View / Backlog View tabs | `src/components/Roadmap.tsx:19-22,165-179` | preserved | roadmap.js:260-263 | |
| 43 | Status cycle pending→in_progress→done w/ optimistic update + rollback | `Roadmap.tsx:56-95` | preserved | roadmap.js cycle (:277-282) | prototype also stamps shippedAt |
| 44 | Stat cards + overall progress bar + current sprint | `Roadmap.tsx:132-157` | preserved | roadmap.js:242-258 | |
| 45 | Shipping velocity chart (done items by month) | `src/components/RoadmapVelocityChart.tsx:13-48` | preserved | roadmap.js:249-252 (per-sprint) | prototype buckets per sprint, HEAD per month — confirm intent |
| 46 | Filters: priority/status/sprint/feature/tag via URL params + clear | `src/components/RoadmapFilterBar.tsx:7-101`; `Roadmap.tsx:28,97-103` (`?view=`) | improved | roadmap.js:150-168 | prototype **adds** free-text search + sort dropdown; HEAD priorities go to P4, prototype filter stops at P2 — carry P3/P4 |
| 47 | Backlog table column sorting (priority/status/est/added, aria-sort) | `src/components/RoadmapBacklogView.tsx:26-92` | preserved | roadmap.js sort select | mechanism differs (select vs clickable headers); a11y aria-sort must not regress |
| 48 | Item expand: notes, feature chip (features.json map), tags, est | `src/components/RoadmapSprintView.tsx:88-115`; `Roadmap.tsx:43-49` | preserved | roadmap.js:174-189 | |

## 4. Business bucket — `revenue` / `ai-usage` / `features` / `prospect` → `business.js` (Ledger: all "Moved")

The prototype consolidates four standalone global pages into one "Business" page with sub-tabs. Consolidation itself is fine (2→1 merges are sanctioned); the gaps are within tabs.

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 49 | Revenue summary stats (total, this month + trend, active clients, avg tx) | `src/components/RevenueDashboard.tsx:134-163` | preserved | business.js revenueBody (:137-142) | |
| 50 | Monthly revenue chart (12 mo, hover tooltip) | `RevenueDashboard.tsx:26-44,166-171` | preserved | business.js:143 | |
| 51 | Revenue by client / by product lists | `RevenueDashboard.tsx:173-209` | preserved | business.js:144-147 | |
| 52 | Recent transactions table | `RevenueDashboard.tsx:212-251` | preserved | business.js:148-150 | |
| 53 | Delete single payment record | `RevenueDashboard.tsx:61-68,234-243` | **at_risk** | none | |
| 54 | Purge ALL payment records (confirm flow) | `RevenueDashboard.tsx:70-76,109-131` | **at_risk** | none | destructive admin op |
| 55 | Empty state (no revenue) + loading skeleton | `RevenueDashboard.tsx:78-96` | preserved | states owed by convention | |
| 56 | AI usage stats: cost, calls, OpenAI vs Anthropic split; 7/14/30d selector | `src/components/AIUsageSection.tsx:61-143,100-119` | preserved | business.js usageBody (:175-189) | |
| 57 | Daily cost stacked chart w/ rich tooltip | `AIUsageSection.tsx:145-179` | preserved | business.js:173 | |
| 58 | Cost by feature bars (provider-colored) | `AIUsageSection.tsx:183-206` | preserved | business.js:174,190 | |
| 59 | DataForSEO credits, provider calls, cache hit rate + daily credits chart | `AIUsageSection.tsx:208-251` | preserved (partial) | business.js:191-196 | prototype has the 3 stat cards but **omits the SEO daily chart** — minor |
| 60 | AI-usage hidden when zero usage (component returns null) | `AIUsageSection.tsx:61-63` | preserved | n/a | behavior note: standalone `ai-usage` nav page = same component (`App.tsx:43,369`) |
| 61 | Feature Library: search + By Pain Point / By Platform Area grouping | `src/components/FeatureLibrary.tsx:56-106,124-158` | preserved | business.js featuresBody (:213-231) | |
| 62 | Feature cards: tier badge, impact dot, client-facing marker | `FeatureLibrary.tsx:31-53` | preserved | business.js:223-226 | data source is `data/features.json` via `/api` (`FeatureLibrary.tsx:59-63`) — wire real data |
| 63 | Prospect: run Sales SEO report via background job w/ progress messages | `src/components/SalesReport.tsx:81-121` (`useBackgroundTasks`) | preserved | business.js prospectsBody (:250-254) | keep job-platform wiring (`docs/rules/background-generation.md`) |
| 64 | Report history list + reopen stored report | `SalesReport.tsx:70-79,123-131,196-231` | preserved | business.js:235-248 | |
| 65 | Printable HTML client report (`/api/sales-report/:id/html`) | `SalesReport.tsx:133-135,252-262` | preserved | business.js file icon (:248) | |
| 66 | Full report detail view: score ring, top risks + opportunity cost, quick wins, site-wide issues, page-by-page expandable breakdown | `SalesReport.tsx:236-433` | **at_risk** | none — prototype toasts "Opens the full flow in the platform" (:284) | the actual report UI has no prototype spec |
| 67 | "Onboard as Client" handoff from a prospect report | `SalesReport.tsx:263-274` | **at_risk + broken at HEAD** | none | sets `#new-workspace?url=…` but **no consumer exists** (`grep -rn "new-workspace" src/` → only SalesReport). Parity Ledger lists it as a carried function. Decide: wire properly in rebuild or cut |

## 5. Outcomes — `outcomes` (per-ws) + `outcomes-overview` → `outcomes.js` (Ledger: "Moved"/"Improved", contradictory)

The prototype's Action Results is book-level only and **reframes metrics** (value $/mo, clicks, wins, trend) vs HEAD's (win rate, active actions, scored 30d, coverage, attention). The ledger itself flags "Team Outcomes cross-workspace view still needs a verify pass." Per-workspace outcome tooling is claimed to live "in each cockpit / Insights Engine" but is not demonstrated anywhere.

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 68 | Cross-ws table: win rate, trend, active actions, scored(30d), top win, on-track/review status | `src/components/admin/outcomes/OutcomesOverview.tsx:84-186,245-287` | **at_risk** (reframed) | outcomes.js table (:129-143) | prototype swaps win-rate framing for value framing; ratified persona work led to value framing, but win-rate/scored-30d fields must not silently vanish — owner call |
| 69 | Aggregate stats bar (avg win rate, actions tracked, scored, need attention) | `OutcomesOverview.tsx:45-79` | improved (reframed) | outcomes.js hero (:119-127) | |
| 70 | Attention-needed flag + reason + attention-first sort | `OutcomesOverview.tsx:112-120,206-212` | **at_risk** | none | prototype has trend but no attention flags |
| 71 | Coverage column (measured/tracked badge, R9/B15) | `OutcomesOverview.tsx:146-156` | **at_risk** | none | |
| 72 | Row click → per-workspace outcomes deep link | `OutcomesOverview.tsx:279` | preserved | outcomes.js "Cockpit →" (:138) | |
| 73 | Per-ws Top Wins tab | `admin/outcomes/OutcomeTopWins.tsx:40` | at_risk (uncertain) | outcomes.js book-wide wins feed (:145-153) shows the pattern, per-client version unproven | |
| 74 | Per-ws Scorecard (win rate by action type, trend) | `admin/outcomes/OutcomeScorecard.tsx:32-34,144` | **at_risk** | "cockpit / Insights Engine" (undemonstrated) | |
| 75 | Per-ws Action Feed w/ ActionType + score filters (typed from `outcome-tracking.ts`) | `admin/outcomes/OutcomeActionFeed.tsx:20-35,195-211` | **at_risk** | undemonstrated | |
| 76 | Per-ws AI Learnings panel (Content/Strategy/Technical, availability states) | `admin/outcomes/OutcomeLearningsPanel.tsx:281-374` | **at_risk** | undemonstrated | availability contract: `docs/rules/outcome-learning-default-path.md` |
| 77 | Per-ws Action Playbooks | `admin/outcomes/OutcomePlaybooks.tsx:61-83` | **at_risk** | undemonstrated | |
| 78 | Per-ws Coverage funnel (tracked→measured→reconciled, admin-only) | `admin/outcomes/OutcomeCoverageFunnel.tsx:83-106` | **at_risk** | undemonstrated | |
| 79 | Record Published Work card (manual/external outcome ingestion, work types + attribution) | `admin/outcomes/RecordPublishedWorkCard.tsx:14-78`; `OutcomeDashboard.tsx:40` | **at_risk** | none | shipped 2026-07-03 (PR #1470); newer than the prototype |

## 6. Diagnostics — `DiagnosticReportPage` → `diagnostics.js` (Ledger: **contradictory** — Admin group row = "Gap/unassigned", Non-nav row = "Improved")

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 80 | Report detail: at-a-glance strip, ranked root causes w/ confidence, remediation plan, evidence accordion | `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:36-83` | preserved | diagnostics.js:141-218 | faithful |
| 81 | Running/pending guard state | `DiagnosticReportPage.tsx:97-107` | improved | diagnostics.js run theater (:121-139) | prototype adds step-by-step progress theater |
| 82 | Failed state w/ error message | `DiagnosticReportPage.tsx:109-119` | **at_risk** | none | prototype has no failure state |
| 83 | Reports LIST view (history of diagnostics per workspace) | `DiagnosticReportPage.tsx:144-192` | **at_risk** | none | prototype is drill-in only (single report) |
| 84 | `?report=` deep link | `DiagnosticReportPage.tsx:194-203` | preserved (equivalent) | drill-in from regression card | |
| 85 | Nav access: `diagnostics` is a registry entry (admin group; a Reconcile drift-fix added it) | `src/lib/navRegistry.tsx:175-178` | **at_risk** (access path) | prototype = NON_REGISTRY, entry only via regression card (`diagnostics.js:1-5`) | list view + nav entry removal is a capability regression unless list lives elsewhere — owner call |
| 86 | NEW: "Stage as backing move" + "Export report" actions | — | new_proposed | diagnostics.js:182-183 | no HEAD equivalent |

## 7. Requests — `requests` tab (4 sub-tabs) → `requests.js` (Ledger: "Moved → Inbox (bottom bar), function intact" — **overstated**)

HEAD's `requests` page is four sub-tools (`src/App.tsx:419-437`) with a `?tab=` deep-link receiver (`App.tsx:227-236`). The prototype's Inbox is a single thread-feed with a kind taxonomy (request/instruction/approval) + promote flow. "Function intact" is not accurate row-by-row.

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 87 | Sub-tab shell: Deliverables / Signals / Requests / Actions + `?tab=` receiver | `App.tsx:225-236,419-437` | **at_risk** (reframed) | requests.js kind tabs (:116-121) | mapping of 4 sub-tools → 1 feed is undefined |
| 88 | Client Deliverables pane: grouped by status axis (awaiting/changes/approved), stale ≥Nd detection, "remind" nudge, live WS events | `src/components/admin/ClientDeliverablesPane.tsx:46-157` (`useWorkspaceEvents` :130) | **at_risk** | none | operator follow-up tooling absent from prototype |
| 89 | Client Signals inbox: new/all tabs, status transitions incl. undo | `src/components/admin/AdminInbox.tsx:44-52,110-125,140-144` | at_risk (partial) | requests.js item kinds approximate | status-transition model differs |
| 90 | Request status workflow (new/in_review/in_progress/on_hold/completed/closed) + priority (low→urgent) | `src/components/RequestManager.tsx:65-78` | **at_risk** | prototype has new/handled only | state machine `server/state-machines.ts` backs this |
| 91 | Cross-workspace filter + status/category filters + search | `RequestManager.tsx:94-104,197-207,260-292` | **at_risk** | requests.js has kind filter only | |
| 92 | Bulk select / bulk status / bulk delete | `RequestManager.tsx:152-181,310-334` | **at_risk** | none | |
| 93 | Stats + completion progress bar | `RequestManager.tsx:204-257` | at_risk | none | |
| 94 | Team reply on request thread | `RequestManager.tsx:508` | preserved | requests.js "Reply & close" (:77) | |
| 95 | Client Actions tab: approved actions awaiting implementation, mark-complete, content-decay auto-brief indicator | `src/components/admin/ClientActionsTab.tsx:57-126,146-150` | **at_risk** | none | |
| 96 | NEW: Promote request → strategy signal (Insights Engine backing move) | — | new_proposed | requests.js:133-141 | flagship new flow; needs sign-off + data contract |

## 8. Meeting Brief — Page `brief` (`MeetingBriefPage`) — **NO prototype view; ledger misattributes the route**

The Parity Ledger's "Brief workspace · comp: brief" row maps the `brief` route to *content brief authoring* (`brief-workspace.js`). At HEAD, `brief` renders the **Meeting Brief** — AI call-prep (`src/App.tsx:394`), primary discovery via a WorkspaceHome tab (`src/components/WorkspaceHome.tsx:423`; `navRegistry.tsx:99`). Content-brief authoring is a different feature (content-pipeline). Result: the entire Meeting Brief has no home anywhere in the kit. No mockup view mentions it (`grep -i meeting mockup/*.js` → 0 hits).

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 97 | Generate / regenerate AI meeting brief (~10s), generating + error states | `src/components/admin/MeetingBrief/MeetingBriefPage.tsx:41,94-147` | **at_risk** | none | |
| 98 | Situation summary + at-a-glance metric strip w/ tab deep links | `MeetingBriefPage.tsx:151-155` | **at_risk** | none | |
| 99 | Wins Since Last Review / What Needs Attention w/ text→route resolution | `MeetingBriefPage.tsx:52-62,156-165` | **at_risk** | none | |
| 100 | Recommendations list w/ per-item routing | `MeetingBriefPage.tsx:166-170` | **at_risk** | none | |
| 101 | Blueprint progress → blueprint deep link | `MeetingBriefPage.tsx:171` | **at_risk** | none | |
| 102 | OV divergence panel (admin-only shadow diagnostic for the OV scorer) | `MeetingBriefPage.tsx:174-181`; `src/components/admin/OvDivergencePanel.tsx` | **at_risk** | none | internal ops tool |

## 9. Onboarding flows → `onboard.js`

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 103 | Admin per-workspace OnboardingChecklist (setup steps, dismissal, celebration) on WorkspaceHome | `src/components/WorkspaceHome.tsx:98-100,320,357-368` | improved | onboard.js cold-start flow (:85-172) | prototype upgrade: gated GA4→GSC→Webflow→audit→strategy w/ unlock preview |
| 104 | Client onboarding questionnaire (multi-step business/audience/voice/competitors; `POST /api/public/onboarding/:id`) | `src/components/client/ClientOnboardingQuestionnaire.tsx:60-117`; `src/components/ClientDashboard.tsx:936-963` | **at_risk** | none in this zone (client-dashboard decision pending) | feeds personas + knowledge base → Brand Engine; cannot drop |
| 105 | Client welcome wizard (feature tour, tier-aware, suggested actions) | `src/components/client/OnboardingWizard.tsx:40-67`; `ClientDashboard.tsx:966-968` | **at_risk** | none (client-dashboard decision pending) | |
| 106 | Workspace creation ("New workspace") | `src/components/WorkspaceSelector.tsx:293` | at_risk | onboard.js assumes workspace already exists | creation entry point undemonstrated |
| 107 | NEW: locked-workbench preview ("what unlocks") during setup | — | new_proposed | onboard.js:159-171 | |

---

## Parity Ledger reconciliation (Gap/Partial + inaccurate rows for this zone)

| Ledger row | Ledger status | Reconciliation |
|---|---|---|
| Diagnostics (Admin group) | **Gap** — "no home… decide Settings/Admin or cut" | Partially superseded by the duplicate Non-nav "Diagnostics" row (status Improved, home `diagnostics.js`). **The Gap row's real remainder:** the reports *list* view + registry nav entry (`navRegistry.tsx:175-178`) and the failed state still have no home. Ledger should merge the two rows and re-status as Partial. |
| Team Outcomes (`outcomes-overview`) | Improved — "Built… was a dead nav link" | The book-level roll-up exists in `outcomes.js`, but it drops win-rate/scored-30d/coverage/attention fields (rows 68-71). Also note: at HEAD outcomes-overview is NOT a dead link (`App.tsx:372`). Re-status: Partial. |
| Action Results (`outcomes`) | Moved — "Team Outcomes still needs a verify pass" | Verify pass done here: per-workspace tabs (scorecard/actions/learnings/playbooks/coverage) + RecordPublishedWorkCard are all unhomed (rows 73-79). Re-status: Partial. |
| Requests | Moved — "Function intact" | Not intact: deliverables pane, 6-state workflow, priorities, bulk ops, cross-ws filters, client-actions tracking all unhomed (rows 87-95). Re-status: Partial. |
| Prospect | Moved — funcs incl. "Onboard as Client hand-off" | Handoff is dead code at HEAD (row 67) and the full report detail view is not in the mockup (row 66). Re-status: Partial. |
| Brief workspace (comp `brief`) | Improved | **Misattributed**: `brief` at HEAD = Meeting Brief, not content-brief authoring (§8). Ledger needs a new row for Meeting Brief (status Gap). |
| Settings | Same (all subtools "present") | Accurate except: prune-activity, flag override-reset, and Stripe product/price config are missing (rows 7, 10, 11). Re-status: Partial (minor). |
| Workspace Settings | Improved | The prototype improves connections/prefs but omits ~14 HEAD capabilities (rows 14-33). Re-status: Partial (largest omission cluster in this zone). |
| Revenue | Moved | Delete/purge payment records missing (rows 53-54). Re-status: Partial (minor). |
| AI Usage / Roadmap / Features | Moved / Same / Moved | Confirmed accurate (minor: SEO daily chart, P3/P4 filter options). |

## Quick-win vs full-implementation trade-offs

1. **Business bucket (Revenue/Usage/Features/Prospects)** — Quick win: ship the 4-sub-tab Business page as mocked (read-only analytics, ~pure display components). Full: add payment delete/purge + full prospect report detail + working Onboard-as-Client. Risk of quick win: destructive-op parity loss is invisible until an operator needs to remove a test transaction; prospect tool becomes demo-only (can't read a report you just ran).
2. **Settings (global)** — Quick win: mocked layout is ~95% faithful; port as-is with real wiring, add the 4th prune button and flag-override reset inline (trivial additive). Full: rebuild Stripe product/price config section. Risk: shipping quick-win Stripe = payments cannot be configured from UI; acceptable only if .env/config path is documented.
3. **Workspace settings** — Quick win: ship wsettings.js scope (connections, portal, prefs, contacts, danger zone) and keep the OLD WorkspaceSettings route alive for the unported tabs (features/flags/publishing/export/dashboard-detail). Full: 7-tab parity in the new shell. Risk of quick win without the fallback route: tier changes, publish mapping, client-user management, and data export all become impossible — hard operator breakage; the fallback-route hybrid is strongly recommended.
4. **Roadmap** — Quick win: 1:1 port (prototype ≈ parity + adds search/sort). Nearly zero risk; carry P3/P4 filter options and monthly velocity semantics.
5. **Outcomes** — Quick win: book-level Action Results page as mocked, wired to `useOutcomeOverview` with value framing, keep old per-ws OutcomeDashboard reachable from the "Cockpit →" link. Full: redesign per-ws outcome tabs into the cockpit/Insights Engine. Risk: quick win orphans coverage funnel + learnings + RecordPublishedWorkCard unless the old dashboard stays mounted.
6. **Requests/Inbox** — Quick win: prototype feed for signals + promote flow, retain RequestManager as an "All requests" management view behind the Inbox. Full: unify 4 sub-tools into one inbox with status workflow + bulk ops + deliverables tracking. Risk: quick win without RequestManager retention loses the entire request lifecycle (status machine, priorities, bulk) — hard stop.
7. **Diagnostics** — Quick win: drill-in-only as mocked (covers the dominant flow), keep `?report=` deep links working. Full: add list/history + failed state + decide nav entry. Risk: without the list, old reports become unreachable once the source insight is resolved.
8. **Meeting Brief** — No quick win exists in the kit (no mockup). Cheapest safe path: port the existing React page unchanged into the new shell as a WorkspaceHome/cockpit tab; design pass later.
9. **Onboarding** — Quick win: onboard.js flow for new workspaces (it's an upgrade). Full: also rehome questionnaire/wizard on the client side after the client-dashboard decision. Risk: none admin-side; client-side must wait for that sign-off.

## Open questions (stopAndAsk — mirrored in structured output)

See structured summary: 9 questions covering the 18-surface-map omission, Meeting Brief homelessness, Onboard-as-Client dead code, requests reframe, per-ws outcomes home, diagnostics nav/list, workspace-settings depth, client onboarding dependency, and sign-off for the prototype's new features (promote-to-signal, archive workspace, GBP connect, schedules, stage-backing-move/export, locked-workbench preview).
