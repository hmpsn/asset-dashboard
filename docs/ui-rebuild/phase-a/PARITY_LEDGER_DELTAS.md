# Phase A — Parity Ledger Deltas (repo-tracked overlay)

**Status:** LOCKED overlay per **AD-007** (ratified 2026-07-05): "Add the rows before any build PR — nothing silently dropped."
**Ledger of record:** `Platform Parity Ledger.html` (gitignored design-kit artifact — cannot be edited). This doc is the authoritative repo-tracked delta set: rows the ledger is **missing** or has **wrong**. Build tickets must consume the ledger **plus** this overlay.
**Evidence sources:** `docs/ui-rebuild/phase0/surfaces/cockpit.md` §3, `docs/ui-rebuild/phase0/surfaces/global-ops.md`, `docs/ui-rebuild/phase-a/surfaces/global-ops.json`, `docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md` (AD-007, blocking-hole #1). All routes/files re-verified at HEAD (`src/routes.ts`, `src/lib/navRegistry.tsx`, `src/App.tsx`).

---

## 1. Added row — Workspace Home → Cockpit (+Today)

The ledger's 31 surface rows never mention `home` / `WorkspaceHome` / Meeting Brief, despite `home` being the first entry in the nav registry the ledger claims as its source of truth (`src/lib/navRegistry.tsx:115`; finding: `phase0/surfaces/cockpit.md` §3, "The Platform Parity Ledger has NO row for this surface").

| Surface | HEAD source | Target | Status | Ticket |
|---|---|---|---|---|
| Workspace Home → Cockpit (+ Today) — Page `home`, default admin landing `/ws/:id` (`src/routes.ts:42`) | `src/components/WorkspaceHome.tsx` (+ `src/components/workspace-home/*`, aggregate fetch `server/routes/workspace-home.ts`) | Cockpit rebuild (`mockup/cockpit.js` per-client; `mockup/home.js` all-clients Today), Wave 6 | `build` | `W6-cockpit` |

All of cockpit's previously-unledgered **at_risk** rows now hang off this row — ⌘1 shortcut, `?tab=meeting-brief` receiver, freshness/refresh (→ AD-001 convention), churn signals, Traffic Value/ROI card, Content Velocity, composite health number, WorkOrderPanel, Weekly Accomplishments, home TabBar, BriefingReviewQueue workflow, SeoChangeImpact, ActivityFeed (cockpit.md §1 rows 3, 4, 9, 10, 15–16, 25, 30, 32–34, 36, 39, 42–43) — none has a Gap/Partial ledger row to resolve because the row itself was missing; they resolve at the `W6-cockpit` ticket-cut.

## 2. Added rows — Global-Ops zone (absent from the 18-surface map)

The Handoff Brief's 18-surface map omits this entire zone even though the prototype has working views for eight of its pages (`phase0/surfaces/global-ops.md` "Headline finding"). Every page below is a real HEAD route (verified in the `Page` union `src/routes.ts:13-23`; `GLOBAL_TABS` `src/routes.ts:37`; nav registry lines cited). Disposition default is `build-or-cut: TBD@W6 ticket-cut` per AD-007, except the discovery-resolved business consolidation.

| Page / tool | Route / Page id | HEAD source | Disposition | Ticket |
|---|---|---|---|---|
| Settings (global) | `settings` (GLOBAL_TABS; `navRegistry.tsx:181`) | `src/components/SettingsPanel.tsx` (+ `FeatureFlagSettings.tsx`, `StripeSettings.tsx`, `McpApiKeysSettings.tsx`) | build-or-cut: TBD@W6 ticket-cut | `W6-global-ops` |
| Workspace Settings (7 sub-tabs: connections/features/flags/publishing/dashboard/export/llms-txt) | `workspace-settings` (NON_REGISTRY; `navRegistry.tsx:104`) | `src/components/WorkspaceSettings.tsx` (+ `src/components/settings/ConnectionsTab.tsx`, `FeaturesTab.tsx`, `WorkspaceFeatureFlagOverrides.tsx`, `PublishSettings.tsx`, `ClientDashboardTab.tsx`) | build-or-cut: TBD@W6 ticket-cut (largest omission cluster — ~14 unhomed capabilities, global-ops.md rows 14–33) | `W6-global-ops` |
| Roadmap | `roadmap` (GLOBAL_TABS; `navRegistry.tsx:171`) | `src/components/Roadmap.tsx` (+ `RoadmapFilterBar.tsx`, `RoadmapBacklogView.tsx`, `RoadmapSprintView.tsx`, `RoadmapVelocityChart.tsx`) | build-or-cut: TBD@W6 ticket-cut (near-1:1 port; carry P3/P4 filters + aria-sort) | `W6-global-ops` |
| Revenue | `revenue` (GLOBAL_TABS; `navRegistry.tsx:183`) | `src/components/RevenueDashboard.tsx` | consolidate→business (D8) — 4→1 Business page per discovery; D8 redirect map required | `W6-global-ops` |
| AI Usage | `ai-usage` (GLOBAL_TABS; `navRegistry.tsx:169`) | `src/components/AIUsageSection.tsx` (also embedded; standalone page is same component, `src/App.tsx:43,369` per global-ops.md row 60) | consolidate→business (D8) | `W6-global-ops` |
| Features (Feature Library) | `features` (GLOBAL_TABS; `navRegistry.tsx:173`) | `src/components/FeatureLibrary.tsx` (data: `data/features.json` via API) | consolidate→business (D8) | `W6-global-ops` |
| Prospect (Sales SEO report) | `prospect` (GLOBAL_TABS; `navRegistry.tsx:167`) | `src/components/SalesReport.tsx` | consolidate→business (D8) — carry full report detail view (row 66) + resolve dead `#new-workspace` handoff (row 67, owner q3) | `W6-global-ops` |
| Team Outcomes (book roll-up) | `outcomes-overview` (GLOBAL_TABS; `navRegistry.tsx:165`) | `src/components/admin/outcomes/OutcomesOverview.tsx` | build-or-cut: TBD@W6 ticket-cut (value reframing is additive per open q10; sn-global-ops-3) | `W6-global-ops` |
| Action Results (per-workspace outcomes) | `outcomes` (workspace tab; `navRegistry.tsx:121`, mount `src/App.tsx:458`) | `src/components/admin/outcomes/OutcomeDashboard.tsx` (+ Top Wins / Scorecard / Action Feed / Learnings / Playbooks / Coverage / `RecordPublishedWorkCard.tsx`) | build-or-cut: TBD@W6 ticket-cut (rehome undemonstrated — default keeps OutcomeDashboard mounted, open q5) | `W6-global-ops` |
| Diagnostics | `diagnostics` (registry, admin group; `navRegistry.tsx:177`) | `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx` | build-or-cut: TBD@W6 ticket-cut (merge the ledger's two contradictory Diagnostics rows — Gap vs Improved — into one Partial; keep list view + failed state, open q6) | `W6-global-ops` |
| Requests (4-subtool set: Deliverables / Signals / Requests / Actions) | `requests` (workspace tab; `navRegistry.tsx:159`, sub-tab shell `src/App.tsx:244-254,438-453`) | `src/components/RequestManager.tsx` + `src/components/admin/ClientDeliverablesPane.tsx`, `AdminInbox.tsx`, `ClientActionsTab.tsx` | build-or-cut: TBD@W6 ticket-cut (ledger's "Moved → Inbox, function intact" is overstated — global-ops.md §7; default hybrid per open q4) | `W6-global-ops` |
| Onboarding flows (admin checklist → cold-start; NOT a `Page` id — mounts inside `home`) | via `home`; client halves via client portal | `src/components/WorkspaceHome.tsx:98-110,320-372` (admin); `src/components/client/ClientOnboardingQuestionnaire.tsx` + `OnboardingWizard.tsx` (client — owned by D4 C-phase, not this zone) | build-or-cut: TBD@W6 ticket-cut (onboard.js is an upgrade; adopt per discovery) | `W6-global-ops` |

**Count note:** the discovery's "12+ pages" = the 11 rows above + Page `brief` (Meeting Brief), which is handled as a *corrected* row in §3, not an added row.

## 3. Corrected row — Meeting Brief (Page `brief`)

The ledger's "Brief workspace · comp: brief" row **misattributes** Page `brief` to content-brief authoring (`brief-workspace.js`). At HEAD, `brief` renders the **Meeting Brief** — AI call-prep (`src/components/admin/MeetingBrief/MeetingBriefPage.tsx`; NON_REGISTRY backward-compat alias, `navRegistry.tsx:99`; primary discovery via the WorkspaceHome tab). Content-brief authoring is a different feature (content pipeline / `seo-briefs`). Finding: `phase0/surfaces/global-ops.md` §8 + ledger-reconciliation table.

| Surface | HEAD source | Corrected entry | Status | Ticket |
|---|---|---|---|---|
| Meeting Brief — Page `brief` (`src/routes.ts:3`) | `src/components/admin/MeetingBrief/MeetingBriefPage.tsx` (+ `OvDivergencePanel.tsx`) | **Retired by owner 2026-07-05** ("we no longer need the meeting brief") — a deliberate, owner-signed retirement per PHASE_A_DECISIONS.md blocking-hole #1, not a silent drop. Cut executed in the **W0.3 PR** via the route-removal checklist (`docs/rules/route-removal-checklist.md`): remove Page `brief`, retarget/remove its deep-link senders (incl. the keyword-hub senders and the `?tab=meeting-brief` receiver in `WorkspaceHome.tsx:92-95`). | `retired` | `W0.3` |

**D8 redirect-map row:** `home?tab=meeting-brief → home` (and `/ws/:id/brief → /ws/:id`).

---

*Maintenance:* if a W6 ticket-cut resolves a `TBD` disposition, update the row here in the same PR — this overlay stays the record until the ledger artifact itself is regenerated.
