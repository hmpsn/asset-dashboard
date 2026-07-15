# Wave 6 BUILD TICKET - Cockpit (Page `home`)

> **Surface:** admin `Page 'home'` (`src/routes.ts:1-3`) at `/ws/:workspaceId` via `adminPath(workspaceId, 'home')` (`src/routes.ts:38-42`).
> **HEAD component + mount:** `WorkspaceHome` (`src/components/WorkspaceHome.tsx:61-639`) mounted from `src/App.tsx:410`; current nav registry entry is `Home` at `src/lib/navRegistry.tsx:113-115`.
> **Wave:** W6 · **Lane:** A-lane (`ui-rebuild-shell`) · **Effort:** **XL** (`docs/ui-rebuild/phase-a/surfaces/cockpit.json:495-496`).
> **Read order for the builder:** `PHASE_A_DECISIONS.md` -> `CROSS_SURFACE_CONTRACTS.md` -> `BUILD_CONVENTIONS.md` -> `surfaces/cockpit.json` -> `owner-decisions.json` -> `server-backlog.json` -> this ticket -> `src/components/WorkspaceHome.tsx` -> Keywords pilot (`src/components/keywords-rebuilt/`).
> **Mount contract:** rebuilt surface mounts behind `ui-rebuild-shell` through `REBUILT_SURFACES['home']`. This is a controller-applied seam for this fan-out; the Cockpit build lane lists it but does **not** edit `src/components/layout/rebuiltSurfaces.ts`.
> **Controller delta:** flag-ON nav label changes `Home` -> `Cockpit`; flag-OFF legacy nav and `WorkspaceHome` remain byte-identical. No URL changes and no D8 redirect-map row.
> **Cross-surface laws:** C-3 keeps actionable `AnomalyAlerts` on Search & Traffic, with Cockpit showing only a hand-off card. AD-004 and AD-023 defer all graduation/promote writes. W6.0 `SB-004` is the server-authoritative work-queue source shared with Global Ops Today; Cockpit consumes it and must not reassemble stream counts client-side.

## 1. ⚠ OWNER DELTAS

These controller deltas bind the build ticket. All C-Q open questions from `surfaces/cockpit.json` are recorded below; where a controller/cross-surface contract narrows the default, that narrowing is the build instruction.

| Delta | Discovery item | Resolution for this build ticket | Backing evidence |
|---|---|---|---|
| **DELTA A** | Page `home` rebuild + label rename | Rebuild the existing `Page 'home'` in place as Cockpit. Keep `/ws/:workspaceId` unchanged. Rename `Home` -> `Cockpit` only behind `ui-rebuild-shell`; flag-OFF `WorkspaceHome` stays byte-identical. Add the missing Parity Ledger row before the build PR. | `src/routes.ts:1-3,38-42`; `src/App.tsx:410,460-480`; `src/lib/navRegistry.tsx:113-115`; AD-007 in `PHASE_A_DECISIONS.md:16`; C-Q1 in `surfaces/cockpit.json:337-341`. |
| **DELTA B** | W6.0 shared contracts | Consume W6.0 `SB-004` work-queue classification, the shared `co-*` layout primitives, `AdminMoneyFrame`, and verdict headline fields. Import shared primitives from `src/components/ui/`; do not re-roll verdict header, stream tiles, work-queue rows, or client rail inside `cockpit-rebuilt`. | `shared/types/work-queue.ts:1-32`; `shared/types/outcome-tracking.ts:171-190`; `server/money-frame-cron.ts:23-87`; `server/money-frame-store.ts:12-17,54-60`; `server-backlog.json:39-48`; `BUILD_CONVENTIONS.md:47-80,99-115`. |
| **DELTA C** | AD-015 health-score -> chip | Keep the composite 0-100 client-signals health score and derive the qualitative `On track` / `At risk` chip from it. Do not replace the number with a chip-only status. | Current score render at `src/components/WorkspaceHome.tsx:558-569`; AD-015 in `owner-decisions.json:218-228`; C-Q6 in `surfaces/cockpit.json:369-373`. |
| **DELTA D** | Workspace-home WS invalidation fan-out | Preserve the centralized workspace-scoped event coverage that refreshes `queryKeys.admin.workspaceHome(workspaceId)`. Current `WorkspaceHome.tsx` has no inline `useWorkspaceEvents`; the actual handler is `useWsInvalidation` -> `invalidateWorkspaceEventQueries`. Rebuilt Cockpit must keep the same key and coverage. | `src/hooks/useWsInvalidation.ts:1-24,30-96`; `src/lib/wsInvalidation.ts:21-32,62-68,117-567`; `src/hooks/admin/useWorkspaceHome.ts:9-15`; `src/components/WorkspaceHome.tsx:294`. |

| Open question / feature | Resolution adopted | Build implication |
|---|---|---|
| C-Q1: Parity Ledger has no Workspace Home row | Adopt proposed default: add `Workspace Home -> Cockpit (+ Today)` ledger row before any build PR. | Parity row is a pre-build requirement. No Cockpit PR starts until the row names every moved/retained function. |
| C-Q2: Meeting Brief home | Adopt proposed default per this ticket: T1 carry-over as a secondary Cockpit tab if the component still exists in the target branch. | Note the conflict with ratified C-8/W0.3 retirement (`PHASE_A_DECISIONS.md:22`; `D8_REDIRECT_MAP.md:7-8`). If the route/component is already removed, do not resurrect the standalone `brief` route; keep the local tab receiver only if a real carry-over component is present. |
| C-Q3: work-order fulfillment home | Adopt proposed default: keep `WorkOrderPanel` launchable from a Cockpit queue row. | Preserve conversation/complete/close-out behavior from `src/components/WorkspaceHome.tsx:176-194,631-635`; wrap as T1 carry-over in a `Drawer`/modal shell, not a redesign. |
| C-Q4: number-free vs compact KPI strip | Adopt proposed default, narrowed by verdict-first composition: compact KPI strip survives below the verdict and stream tiles. | Use `MetricTile`, `Meter`, and honest absent states for Site Health, Search Clicks, Traffic Value, Users, Rank Changes, Content Pipeline, Content Velocity, and Overall Health. It is not the page hero. |
| C-Q5: churn-signal detail rows | Adopt proposed default: render churn signals as work-queue rows in the risk/unclassified bucket. | Health chip alone is insufficient. Preserve type, severity, title, description, and detected time from `src/components/WorkspaceHome.tsx:114,197-205`. |
| C-Q6: composite health score -> chip | Adopt proposed default plus DELTA C. | Keep numeric score, derive chip from score, expose score in detail/tooltip. Score color still goes through `scoreColor()` / `scoreColorClass()`. |
| C-Q7: Activity feed + Weekly accomplishments | Adopt proposed default: keep `WeeklyAccomplishments` under verdict; mount `ActivityFeed` in a toolbar `Drawer`. | Preserve weekly summary from `server/routes/workspace-home.ts:83-95` and current render at `src/components/WorkspaceHome.tsx:388-390,618-626`. |
| C-Q8: freshness + manual refresh | Adopt proposed default: use the system-wide Build Conventions toolbar pattern. | `Toolbar` right slot shows freshness meta and manual Refresh. Keep stale cached-data warning behavior; refresh invalidates `queryKeys.admin.workspaceHome(workspaceId)` (`src/components/WorkspaceHome.tsx:289-294`). |
| C-Q9: net-new P1-P6 | Adopt P1 verdict + P3 provenance. Defer P2 monetization stream, P4 promote-to-signal, P5 graduation/proof-point, and P6 switcher roll-up. | P1/P3 ride as additive server/read fields if not already exposed. P2/P4/P5/P6 get DEF rows; no ad-hoc writes or admin pitch queue in this PR. |
| C-Q10: Action Results before/after GSC | Adopt proposed default: carry `SeoChangeImpact` into Cockpit queue/detail as T1 if Action Results does not yet own change-level before/after GSC. | Preserve current before/after display source at `src/components/WorkspaceHome.tsx:604-614`; no duplicate outcome math. |
| C-Q11: briefing review workflow home | Controller resolution: this lands on the Recommendations surface, **not** Cockpit. | Do not mount `BriefingReviewQueue` in Cockpit's send stream unless a later owner decision reverses this. Current legacy mount at `src/components/WorkspaceHome.tsx:586-593` is excluded from the rebuilt Cockpit body. |
| C-Q12: keyboard shortcuts `Cmd/Ctrl+1/2/3` | Adopt proposed default for Cockpit: preserve `Cmd/Ctrl+1 -> Cockpit`; leave full `Cmd/Ctrl+2/3` scheme to shell/global navigation. | Cockpit must not add component-local shortcut listeners that conflict with the rebuilt shell. Add tests only if the shell-level handler exists in the branch. |
| C-Q13: Content Velocity card | Adopt proposed default: include velocity in the compact KPI strip. | Use `contentVelocity` from `WorkspaceHomeData` (`src/api/platform.ts:81-87`) and current card behavior (`src/components/WorkspaceHome.tsx:530-543`), retargeting old `content` navigation to Content Pipeline. |

## 2. Capability Checklist

Every `capabilityClassification` row in `surfaces/cockpit.json:4-233` is an acceptance criterion. Cockpit is intentionally **verdict-first**: orient -> act -> evidence. It is not a dashboard-of-widgets, and the rebuilt KPI strip is secondary to the server-authored verdict + stream queue.

### 2.1 Shell, mount, verdict, and freshness

- [ ] **Row 1 default landing `/ws/:id -> home`.** Preserve `Page 'home'` and `/ws/:workspaceId` URL semantics (`src/routes.ts:1-3,38-42`). No route rename, no D8 redirect.
- [ ] **Row 2 nav registry label.** Flag-ON label is `Cockpit`; flag-OFF label remains `Home`. This is controller-applied outside the build lane; do not edit `src/lib/navRegistry.tsx` unless the controller assigns it.
- [ ] **Row 3 keyboard shortcut.** Preserve `Cmd/Ctrl+1 -> home/Cockpit`. `Cmd/Ctrl+2/3` are shell-level reservations; Cockpit must not implement competing local shortcuts.
- [ ] **Rows 4, 36, 37 Meeting Brief.** Adopt C-Q2's T1 local-tab default only if the carry-over component still exists after W0.3. Do not resurrect Page `brief`; no new D8 row. Runtime-test `?tab=meeting-brief` only if the receiver is present.
- [ ] **Row 5 aggregated workspace-home GET.** Continue to read `GET /api/workspace-home/:id?days=28` through React Query (`src/hooks/admin/useWorkspaceHome.ts:9-15`; `src/api/platform.ts:92-95`), with additive fields for work queue, verdict, and money frame.
- [ ] **Rows 6-7 loading/error.** Replace legacy `LoadingState` / `ErrorState` copy (`src/components/WorkspaceHome.tsx:122-138`) with rebuilt contextual skeletons and `ErrorState` + Retry. Do not drop the Refresh-page secondary action unless the rebuilt stale-data banner covers it.
- [ ] **Rows 9-10 freshness + manual refresh.** Use `Toolbar`, `ToolbarSpacer`, freshness meta, and manual Refresh per `BUILD_CONVENTIONS.md:15-45`. Current legacy freshness source is `dataUpdatedAt` / `lastFetched` (`src/components/WorkspaceHome.tsx:69-77,120,289-294,356-372`).
- [ ] **P1 verdict headline + narrative.** Render only server-derived verdict/status fields; no client-composed judgment copy. If absent, render an honest absence state. This consumes the W1.1/W1.2 verdict contract; any missing serialization is additive server work.
- [ ] **P3 money provenance chips.** Render `AdminMoneyFrame.valueAtStake`, `recoveredSoFar`, `provenance`, and `precomputedAt` with basis pill. Do not call `computeROI()` or compute dollars on render (`shared/types/outcome-tracking.ts:171-190`; `server/money-frame-store.ts:54-60`).

### 2.2 Server-authoritative work queue and stream layout

- [ ] **Row 8 WS invalidation.** Preserve all 25 workspace-home invalidators listed in §2.6. The rebuilt surface must stay on `queryKeys.admin.workspaceHome(workspaceId)` so existing broadcasts refresh the same aggregate.
- [ ] **Row 13 NeedsAttention -> stream tiles + grouped queue.** Replace client-side `attentionItems.push(...)` assembly (`src/components/WorkspaceHome.tsx:160-287`) with W6.0 `WorkQueueClassification` from the server. Stream counts must match Global Ops Today because both read the same `SB-004` source (`shared/types/work-queue.ts:1-32`).
- [ ] **Row 14 client-requests deep link.** Preserve the current `requests?tab=requests` two-halves sender (`src/components/WorkspaceHome.tsx:165-174`) and receiver in `App.tsx:241-256,435-451`.
- [ ] **Row 15 work-order rows.** Preserve open-order semantics: pending/in_progress/completed are open; completed rows are ready to close out (`src/components/WorkspaceHome.tsx:176-194`). Queue row opens `WorkOrderPanel` T1 carry-over (`src/components/WorkspaceHome.tsx:631-635`).
- [ ] **Row 16 churn-signal rows.** Render each critical/warning signal as a row, not only as a health chip (`src/components/WorkspaceHome.tsx:114,197-205`).
- [ ] **Row 17 content-decay row.** Keep the sender to `content-pipeline?tab=content-health` (`src/components/WorkspaceHome.tsx:207-218,501-509`), matching the Content Pipeline receiver contract.
- [ ] **Row 18 pending briefs.** Retarget to `content-pipeline?tab=briefs` instead of an ambiguous pipeline default, preserving the current pending-content count (`src/components/WorkspaceHome.tsx:145,221-228`).
- [ ] **Row 19 SEO audit errors.** Route to Site Audit; retain error/warning/score detail (`src/components/WorkspaceHome.tsx:230-237`).
- [ ] **Row 20 rank drops.** Route to Keyword Hub (`seo-keywords`) and preserve `rankUp` / `rankDown` counts (`src/components/WorkspaceHome.tsx:109,146-147,239-246`).
- [ ] **Row 21 pages needing review.** Preserve content-plan review rows from `contentPipeline.reviewCells` and route to Content Pipeline (`src/components/WorkspaceHome.tsx:248-255`).
- [ ] **Rows 12, 22 onboarding/setup.** Keep setup tasks owned by `OnboardingChecklist` while active; do not duplicate Webflow/GSC/GA4 setup rows into the queue until the checklist is dismissed (`src/components/WorkspaceHome.tsx:84-96,153-158,257-283,331-348`).
- [ ] **P2 monetization stream.** Deferred. Do not fabricate a money stream from client purchase upsells. Until `SB-041` lands, the money stream tile may show an honest unavailable/empty state, but no admin pitch queue ships in this PR.

### 2.3 KPI strip, health chip, and evidence rails

- [ ] **Rows 23-26 compact KPI strip.** Keep Site Health, Search Clicks, Traffic Value, and Users as compact `MetricTile`s below verdict/streams (`src/components/WorkspaceHome.tsx:401-488`). Missing provider data renders an em dash or connect-state, not zero.
- [ ] **Row 27 Rank Changes mini-board.** Preserve tracked keyword count and up/down/equal summary from `ranks` (`src/components/WorkspaceHome.tsx:490-499`) using `DataTable` or `GroupBlock`, not a standalone card wall.
- [ ] **Row 28 Content Decay card.** Keep decay summary in the KPI/evidence area plus queue row; destination remains Content Pipeline Content Health.
- [ ] **Row 29 Content Pipeline meter.** Replace client-side percent-only display with `Meter` over the same `contentPipeline` totals (`src/components/WorkspaceHome.tsx:514-528`), or the additive server denominator if `SB-004` exposes it.
- [ ] **Row 30 Content Velocity card.** Include the C-Q13 velocity tile from `contentVelocity` (`src/api/platform.ts:81-87`; `src/components/WorkspaceHome.tsx:530-543`). Retarget legacy `content` navigation to `content-pipeline?tab=published` or the W4 receiver selected by Content Pipeline.
- [ ] **Row 31 Coverage Gaps.** Cockpit may show a hand-off count, but Insights Engine owns the full feed. Do not rebuild coverage-gap analysis here (`src/components/WorkspaceHome.tsx:545-556`; C-4 in `CROSS_SURFACE_CONTRACTS.md:28-35`).
- [ ] **Row 32 Overall Health composite score.** Keep the numeric 0-100 composite score and derive the chip from it (DELTA C). Current source is `intel.clientSignals.compositeHealthScore` (`src/components/WorkspaceHome.tsx:79,558-569`).
- [ ] **Row 34 Weekly Accomplishments.** Keep `WeeklyAccomplishments` directly under the verdict, backed by server weekly summary (`server/routes/workspace-home.ts:83-95`; `src/components/WorkspaceHome.tsx:388-390`).
- [ ] **Rows 43-45 Activity, Rankings, Requests/Annotations.** Activity opens a `Drawer` from the toolbar; rankings and active-request/annotation summaries live as evidence rail modules or hand-off rows (`src/components/WorkspaceHome.tsx:618-627`). Search & Traffic owns annotations as a deep workshop.

### 2.4 Relocated, excluded, or T1 carry-over modules

- [ ] **Row 33 WorkOrderPanel.** T1 carry-over only. Wrap the existing behavior in rebuilt shell chrome; do not redesign work-order conversation/close-out flows.
- [ ] **Row 35 AnomalyAlerts.** Do not mount actionable `AnomalyAlerts` in Cockpit. Search & Traffic keeps ack/dismiss/scan; Cockpit may render a hand-off row/card only (`CROSS_SURFACE_CONTRACTS.md:20-27`; legacy mount at `src/components/WorkspaceHome.tsx:574-575`).
- [ ] **Row 39 BriefingReviewQueue.** Excluded from Cockpit by C-Q11 controller resolution. Recommendations owns approve/publish/skip-note/generate-now. Do not preserve the legacy Cockpit mount (`src/components/WorkspaceHome.tsx:586-593`) in the rebuilt surface.
- [ ] **Row 40 AdminRecommendationQueue.** Recommendations owns the admin queue. Cockpit may link to it or show summary counts only; no second queue mount (`src/components/WorkspaceHome.tsx:595-600`; C-1 in `CROSS_SURFACE_CONTRACTS.md:8-18`).
- [ ] **Row 41 SeoWorkStatus grid.** Site Audit + SEO Editor receive this capability. Cockpit should not mount `SeoWorkStatus` as a grid; it may surface a Technicals queue group with destination links (`src/components/WorkspaceHome.tsx:604-611`).
- [ ] **Row 42 SeoChangeImpact.** Carry into a queue detail/Action Results hand-off as T1 only if the outcomes surface has no change-level before/after GSC home (`src/components/WorkspaceHome.tsx:610-614`).
- [ ] **Row 44 RankingsSnapshot.** Supersede with rank mini-board from the same `ranks` payload; do not mount the old component directly unless needed as T1 detail (`src/components/WorkspaceHome.tsx:621-624`).
- [ ] **Row 45 ActiveRequestsAnnotations.** Requests route to Inbox/Admin Requests; annotations route to Search & Traffic. Cockpit shows a concise rail, not the old combined component (`src/components/WorkspaceHome.tsx:625-627`).

### 2.5 Adopted kit features and composition floor

- [ ] **Primitive set.** Use F3/F4 primitives plus W6.0 `co-*` primitives: `PageContainer`, `Toolbar`, `ToolbarSpacer`, `MetricTile`, `GroupBlock`, `DataTable` self-carded, `Meter`, `Sparkline`, `Drawer`, `Segmented`, `Avatar`, and `FilterChip`. Import shared `co-*` verdict header, stream tile, work-queue row, and client rail primitives from `src/components/ui/` once W6.0 lands; do not duplicate them under `cockpit-rebuilt`.
- [ ] **Verdict-first ordering.** Top-to-bottom structure is: Page header/verdict, freshness toolbar, stream tiles, grouped work queue, From-client rail, Technicals/evidence rail, compact KPI strip, drawers/details.
- [ ] **DataTable self-card rule.** Any queue table uses `DataTable` directly, not inside `SectionCard` or another card wrapper (`BUILD_CONVENTIONS.md:159-163`).
- [ ] **Sparkline honesty.** KPI sparklines render only from real series. `contentVelocity.monthly` is real; scalar-only metrics get an absent state, not fabricated trend bars.
- [ ] **Mutation feedback.** Work-order actions, refresh, and any T1 carried mutations use the existing `useToast` and `mutationErrorMessage` patterns; do not build a second toast system.
- [ ] **Accessibility.** Queue rows, stream filters, and toolbar controls need accessible names, keyboard focus order, and roving-tabindex behavior from the shared primitives. Drawer focus/scroll lock must come from `Drawer` / `overlayUtils`.

### 2.6 Workspace-home WS invalidation acceptance list

The rebuilt Cockpit must preserve these 25 workspace-scoped event handlers against `queryKeys.admin.workspaceHome(workspaceId)`. The source is centralized `useWsInvalidation` (`src/hooks/useWsInvalidation.ts:23-96`) plus `adminInvalidationKeys` (`src/lib/wsInvalidation.ts:117-567`), not an inline handler in `WorkspaceHome.tsx`.

- [ ] `WS_EVENTS.APPROVAL_UPDATE` invalidates workspace home (`src/lib/wsInvalidation.ts:123-130`).
- [ ] `WS_EVENTS.APPROVAL_APPLIED` invalidates workspace home (`src/lib/wsInvalidation.ts:131-139`).
- [ ] `WS_EVENTS.REQUEST_CREATED` invalidates workspace home (`src/lib/wsInvalidation.ts:140-147`).
- [ ] `WS_EVENTS.REQUEST_UPDATE` invalidates workspace home (`src/lib/wsInvalidation.ts:140-147`).
- [ ] `WS_EVENTS.CONTENT_REQUEST_CREATED` invalidates workspace home via `contentPipelineKeys()` (`src/lib/wsInvalidation.ts:21-27,148-156`).
- [ ] `WS_EVENTS.CONTENT_REQUEST_UPDATE` invalidates workspace home via `contentPipelineKeys()` (`src/lib/wsInvalidation.ts:21-27,148-156`).
- [ ] `WS_EVENTS.BRIEF_UPDATED` invalidates workspace home (`src/lib/wsInvalidation.ts:157-162`).
- [ ] `WS_EVENTS.CONTENT_UPDATED` invalidates workspace home via `contentPipelineKeys()` (`src/lib/wsInvalidation.ts:163-176`).
- [ ] `WS_EVENTS.ACTIVITY_NEW` invalidates workspace home (`src/lib/wsInvalidation.ts:177-183`).
- [ ] `WS_EVENTS.AUDIT_COMPLETE` invalidates workspace home (`src/lib/wsInvalidation.ts:184-194`).
- [ ] `WS_EVENTS.WORKSPACE_UPDATED` invalidates workspace home (`src/lib/wsInvalidation.ts:203-227`).
- [ ] `WS_EVENTS.PAGE_STATE_UPDATED` invalidates workspace home (`src/lib/wsInvalidation.ts:228-237`).
- [ ] `WS_EVENTS.CONTENT_PUBLISHED` invalidates workspace home via `contentPipelineKeys()` (`src/lib/wsInvalidation.ts:238-245`).
- [ ] `WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED` invalidates workspace home via `contentSubscriptionKeys()` (`src/lib/wsInvalidation.ts:30-35,246-249`).
- [ ] `WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED` invalidates workspace home via `contentSubscriptionKeys()` (`src/lib/wsInvalidation.ts:30-35,246-249`).
- [ ] `WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED` invalidates workspace home via `contentSubscriptionKeys()` (`src/lib/wsInvalidation.ts:30-35,246-249`).
- [ ] `WS_EVENTS.COPY_SECTION_UPDATED` invalidates workspace home (`src/lib/wsInvalidation.ts:250-257`).
- [ ] `WS_EVENTS.SUGGESTED_BRIEF_UPDATED` invalidates workspace home (`src/lib/wsInvalidation.ts:339-345`).
- [ ] `WS_EVENTS.CLIENT_ACTION_UPDATE` invalidates workspace home (`src/lib/wsInvalidation.ts:370-378`).
- [ ] `WS_EVENTS.COPY_BATCH_COMPLETE` invalidates workspace home (`src/lib/wsInvalidation.ts:383-391`).
- [ ] `WS_EVENTS.RECOMMENDATIONS_UPDATED` invalidates workspace home (`src/lib/wsInvalidation.ts:414-423`).
- [ ] `WS_EVENTS.RANK_TRACKING_UPDATED` invalidates workspace home via `rankTrackingMutationKeys()` (`src/lib/wsInvalidation.ts:62-78,431-432`).
- [ ] `WS_EVENTS.EEAT_ASSETS_UPDATED` invalidates workspace home (`src/lib/wsInvalidation.ts:484-490`).
- [ ] `WS_EVENTS.POST_UPDATED` invalidates workspace home in both post-id and all-posts branches (`src/lib/wsInvalidation.ts:515-532`).
- [ ] `WS_EVENTS.WORK_ORDER_UPDATE` invalidates workspace home (`src/lib/wsInvalidation.ts:543-551`).

## 3. Server Tickets

Consume verifier-adjusted backlog IDs, not gatherer-only `sn-*` labels. W6.0 `SB-004` is a prerequisite/shared source; Cockpit is a primary consumer and may carry only narrow additive serialization needed by this surface.

| SB / sn | Title | Effort | Disposition | Build instruction |
|---|---|---:|---|---|
| **sn-cockpit-1** | Per-client verdict headline + narrative | M | **RIDE / CONSUME** | Render only the server-derived field. If the W1.1/W1.2 field is not yet on `WorkspaceHomeData`, add it additively to the workspace-home payload and shared/client type. No client-composed verdict prose. Backing: `surfaces/cockpit.json:244-253,498-504`; AD-002 in `PHASE_A_DECISIONS.md:11`; `BUILD_CONVENTIONS.md:47-80`. |
| **SB-004** (`sn-cockpit-2`) | Unified server-side work-queue / stream classification | L | **RIDE W6.0 / CONSUME** | Use `WorkQueueClassification` (`shared/types/work-queue.ts:1-32`) exposed additively on the workspace-home endpoint. Counts for opt/send/money/unclassified must match Global Ops Today because both read this shared source. Do not rebuild the legacy `attentionItems` client mapper. |
| **SB-003** (`sn-cockpit-3`) | Read-safe money-frame projection + provenance pill | M | **RIDE / CONSUME** | Consume precomputed `AdminMoneyFrame` (`shared/types/outcome-tracking.ts:171-190`) and `OutcomeProvenance`; never use `OutcomeCoverageProvenance` for the basis pill and never compute ROI on GET/render. If missing from the cockpit payload, serialize from `loadAdminMoneyFrame()` additively. |
| **SB-002** (`sn-cockpit-4`) | Promote client request -> strategy signal / backing move | M | **DEFER -> `DEF-cockpit-002`** | AD-023 requires one flagged, contract-backed flow across Cockpit, Global Ops, Engine, Insights, and Recommendations. No Cockpit-only POST, activity log, or broadcast path ships here. |
| **SB-041** (`sn-cockpit-5`) | Monetization "to pitch" admin queue | M | **DEFER -> `DEF-cockpit-001`** | No admin pitch queue exists. Do not fabricate a money stream from client purchase-rec upsells; show honest absence until the projection lands. |
| **sn-cockpit-6** | Client-switcher book roll-up | S | **DEFER -> `DEF-cockpit-004`** | Belongs to shell/global-ops switcher work, not this single-client surface. Do not extend `/api/workspace-overview` from the Cockpit lane unless the controller explicitly assigns it. |
| **SB-001 / SB-061** (P5) | Graduation / technical proof-point write contract | L / M-L | **DEFER -> `DEF-cockpit-003`** | AD-004 defers all graduation bridges to a C3-era owner-signed contract. Cockpit may show technical hand-offs, but no proof-point/insight graduation write ships here. |

**Net:** 3 `sn-cockpit-*` rows ride or are consumed in W6 (`sn-cockpit-1`, `sn-cockpit-2`/`SB-004`, `sn-cockpit-3`/`SB-003`). 3 `sn-cockpit-*` rows defer (`sn-cockpit-4`, `sn-cockpit-5`, `sn-cockpit-6`). P5 graduation is an additional deferred cross-surface write covered by a DEF row.

## 4. Deep-Link Receiver Matrix

The rebuilt surface must keep the two-halves deep-link contract: every sender here must land on a receiver that reads and validates the param (`BUILD_CONVENTIONS.md:186-195`). Do not overload `tab` for local stream filters; use a separate query param such as `stream=opt|send|money|unclassified`.

| URL / sender | Receiver requirement | Evidence | Acceptance test |
|---|---|---|---|
| `/ws/:workspaceId` and `/ws/:workspaceId/home` fallback | Open Cockpit default view. | `adminPath()` maps `home` to `/ws/:workspaceId` at `src/routes.ts:38-42`; legacy mount at `src/App.tsx:410`. | Runtime flag-ON route test asserts Cockpit surface mounts; flag-OFF still renders legacy `WorkspaceHome`. |
| `/ws/:workspaceId?tab=meeting-brief` | If C-Q2 carry-over component exists, open Meeting Brief tab. If removed by W0.3, fallback to Cockpit and do not crash. | C-Q2 at `surfaces/cockpit.json:342`; D8 conflict at `D8_REDIRECT_MAP.md:7-8`. | Runtime receiver test covers present-component branch or fallback branch, whichever matches target branch reality. |
| `Cmd/Ctrl+1` | Navigate/focus Cockpit (`Page 'home'`). | C-Q12 at `surfaces/cockpit.json:399-403`. | Shell shortcut test if handler exists; otherwise assert Cockpit adds no local conflicting listener. |
| WorkspaceHome new client request sender | `requests?tab=requests` opens admin Requests sub-tab. | Sender at `src/components/WorkspaceHome.tsx:165-174`; receiver at `src/App.tsx:241-256,435-451`. | Static contract keeps sender; runtime receiver asserts Requests tab active. |
| Work-order queue row | Open Cockpit work-order drawer/modal, no URL navigation. | Legacy click opens local panel at `src/components/WorkspaceHome.tsx:176-194,631-635`. | Component test clicks row and asserts `WorkOrderPanel` carry-over opens and closes. |
| Content decay sender | `content-pipeline?tab=content-health`. | Legacy sender already retargeted at `src/components/WorkspaceHome.tsx:217,508`; Content Pipeline ticket owns receiver. | Static `?tab=` contract plus runtime Content Pipeline receiver test. |
| Pending content / briefs sender | `content-pipeline?tab=briefs`. | Legacy sender points to Content Pipeline default at `src/components/WorkspaceHome.tsx:221-228`; Content Pipeline receiver at its ticket §4. | Runtime receiver test asserts Briefs/workspace mode. |
| SEO audit errors / Site Health KPI | `seo-audit` default audit lens. | Error sender at `src/components/WorkspaceHome.tsx:230-237`; Site Health KPI at `src/components/WorkspaceHome.tsx:407-419`. | Runtime navigation test asserts Site Audit route. |
| Rank drops / Rank Changes mini-board | `seo-keywords`. | `ranksTab` set at `src/components/WorkspaceHome.tsx:63-65`; senders at `src/components/WorkspaceHome.tsx:239-246,490-499`. | Runtime navigation test asserts Keyword Hub route. |
| Search Clicks / Users KPI | `analytics-hub` / Search & Traffic. | Current senders at `src/components/WorkspaceHome.tsx:436-448,473-488`. | Runtime navigation test asserts Search & Traffic route; future label change must not alter Page id unless route contract updates. |
| Traffic Value KPI | Client ROI route or rebuilt Action Results hand-off, depending on existing receiver in target branch. | Current sender uses `clientPath(workspaceId, 'roi')` at `src/components/WorkspaceHome.tsx:451-459`; Action Results page exists as `outcomes` at `src/routes.ts:20`. | Test the chosen receiver explicitly and avoid dead client/admin cross-routing. |
| Content Pipeline / Content Velocity KPI | `content-pipeline?tab=published` or the W4 Content Pipeline receiver chosen for published/velocity evidence. | Current pipeline sender at `src/components/WorkspaceHome.tsx:514-528`; current velocity sender still targets retired/zombie `content` at `src/components/WorkspaceHome.tsx:530-543`. | Static contract forbids `content` zombie target; runtime receiver asserts selected Content Pipeline mode. |
| Coverage Gaps hand-off | Operator Insights Engine / Strategy owner route, not a Cockpit-owned feed. | Current sender targets `seo-strategy` at `src/components/WorkspaceHome.tsx:545-556`; C-4 says Engine is single feed home. | Test selected route after Engine ticket finalizes; until then keep existing `seo-strategy` sender rather than dropping the affordance. |
| Activity toolbar action | Opens Activity drawer; no `?tab=activity` local receiver unless explicitly added. | Legacy local tab at `src/components/WorkspaceHome.tsx:577-584,618-627`; C-Q7 says Drawer. | Component test opens drawer and asserts `ActivityFeed` data / empty state. |

## 5. Flag Disposition

| Flag / mount | Required behavior |
|---|---|
| `ui-rebuild-shell` | This is the only feature flag for the rebuilt Cockpit. No surface-specific flag is introduced. |
| `REBUILT_SURFACES['home']` | Controller-applied mount in `src/components/layout/rebuiltSurfaces.ts`. The Cockpit build lane lists this fact but must not edit the registry file in this PR. |
| Flag-OFF behavior | Legacy `WorkspaceHome` remains byte-identical through the current `App.tsx` branch (`src/App.tsx:410`). Do not edit `src/components/WorkspaceHome.tsx`. |
| Flag-ON nav label | `Home` label becomes `Cockpit` behind the flag. This is controller/shell work, not owned by `cockpit-rebuilt/**`. |
| No D8 map | No URL change, no route retirement, and no new D8 redirect-map row from this Cockpit ticket. |
| Flag retirement | None in W6. Do not retire `ui-rebuild-shell`. |
| Real-render smoke | Required before merge: flag ON in browser with a workspace that has requests, work orders, churn signals, audit data, ranks, content pipeline data, content velocity, ROI/money-frame data, and activity. Click stream filters, work-order detail, refresh, all KPI hand-offs, and the Activity drawer. |

## 6. File Ownership

### Owned by the Cockpit build PR

- `src/components/cockpit-rebuilt/**` - rebuilt `@ds-rebuilt` surface. Suggested split: `CockpitSurface.tsx`, `CockpitVerdictHeader.tsx` only if the W6.0 shared primitive is not already named/exported, `CockpitToolbar.tsx`, `CockpitStreams.tsx`, `CockpitWorkQueue.tsx`, `CockpitEvidenceRail.tsx`, `CockpitKpiStrip.tsx`, `CockpitActivityDrawer.tsx`, `CockpitWorkOrderDrawer.tsx`, `useCockpitSurfaceState.ts`, and formatters. Every file first line `// @ds-rebuilt`.
- `src/hooks/admin/useCockpitRebuilt*.ts` - React Query adapters over `useWorkspaceHomeData`, additive work-queue/verdict/money fields, and narrow carried-over detail reads. No raw `fetch()` in components.
- `tests/component/cockpit-rebuilt/**` - flag-ON mount, seeded real `useFeatureFlag`, a11y floor, loading/error/stale states, stream filter behavior, work-order drawer, Activity drawer, KPI hand-offs, DataTable overflow, and deep-link/shortcut receiver tests from §4.
- `tests/contract/tab-deep-link-wiring.test.ts` or adjacent contract coverage - preserve `requests?tab=requests`, `content-pipeline?tab=content-health`, `content-pipeline?tab=briefs`, and zombie-target cleanup for the legacy `content` sender.
- `tests/contract/ws-invalidation-coverage.test.ts` / `tests/unit/useWsInvalidation-pure.test.ts` or adjacent coverage - assert the 25 events in §2.6 still invalidate `queryKeys.admin.workspaceHome(workspaceId)` after Cockpit adapters land.
- `server/routes/workspace-home.ts`, shared types, and `src/api/platform.ts` only for additive `sn-cockpit-1`, `sn-cockpit-2`/`SB-004`, and `sn-cockpit-3`/`SB-003` serialization that the chosen default requires. Keep the legacy raw fields compatible.
- `data/ui-rebuild-deferred-ledger.json` - add the §7 DEF rows in the same PR as the surface implementation.
- `data/roadmap.json` / `FEATURE_AUDIT.md` - add/update W6 Cockpit implementation status per project completion rules.

### Reused, not rewritten

- `src/hooks/admin/useWorkspaceHome.ts:9-15` - workspace-home query key and stale-time source. Wrap/adapt; do not fork the query prefix.
- `server/routes/workspace-home.ts:32-123` - aggregate endpoint and safe partial-failure pattern. Add fields only; do not remove legacy fields during flag-ON rollout.
- `src/hooks/useWsInvalidation.ts:17-96` and `src/lib/wsInvalidation.ts:117-567` - centralized workspace-scoped broadcast handling.
- `src/components/admin/WorkOrderPanel.tsx` and `src/api/work-orders.ts` - work-order fulfillment T1 carry-over. Restyle shell only.
- `src/components/workspace-home/*` modules for `SeoChangeImpact`, `WeeklyAccomplishments`, `ActivityFeed`, `RankingsSnapshot`, and `ActiveRequestsAnnotations` as T1 references. Prefer rebuilt composition over direct remount where the destination owner has moved the capability.
- W6.0 shared `co-*` primitives and F3/F4 primitives from `src/components/ui/`. Use the barrel exports; no deep imports.
- `server/money-frame-store.ts` / `server/money-frame-cron.ts` - read-safe money-frame backing. Cockpit consumes stored frames; it does not own the cron lifecycle.

### Must not touch / other-owner constraints

- `src/components/WorkspaceHome.tsx` - legacy flag-OFF path remains byte-identical.
- `src/components/layout/rebuiltSurfaces.ts` - mount is controller-applied for this fan-out, listed here only as a contract.
- `src/AppShell.tsx`, `RebuiltAppChrome`, global shell primitives, and other surface directories.
- `src/lib/navRegistry.tsx` unless the controller explicitly assigns the flag-gated label rename to this PR; default assumption is controller/shell ownership.
- Search & Traffic's actionable `AnomalyAlerts` panel, ack/dismiss/scan APIs, and annotations workshop.
- Recommendations' `AdminRecommendationQueue` and briefing review workflow.
- Insights Engine / Strategy operator feed ownership for coverage gaps and promote-to-signal target.
- Global Ops Today and workspace switcher roll-up internals.
- Any ad-hoc graduation/proof-point/promote write path; AD-004 and AD-023 require shared contracts first.

## 7. D8 / DEF Entries

### D8 redirect-map rows to add

None. Cockpit rebuilds in place at Page `home`; `/ws/:workspaceId` does not change, and the controller explicitly says no D8 map is needed.

### Deferred-ledger rows to add in the surface PR

Each row uses the exact deferred-ledger shape required for this ticket and a valid class enum from `BUILD_CONVENTIONS.md`: `token`, `primitive`, `behavior`, `data`, `a11y`, `perf`, or `copy`.

```json
[
  {
    "id": "DEF-cockpit-001",
    "surface": "cockpit",
    "item": "Monetization to-pitch admin stream",
    "decision": "Do not invent an admin upsell or scope-expansion queue in the Cockpit rebuild; ship opt/send/unclassified streams on the shared work-queue source and show honest absence for money-stream pitch work until SB-041 lands.",
    "class": "data",
    "upgradeTrigger": "SB-041 ships a server-authored admin pitch queue with source provenance, counts shared with Global Ops Today, activity/audit coverage, and tests proving client purchase upsells are not reused as admin pitch items.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "decision": "C-Q9 P2",
      "surface": "docs/ui-rebuild/phase-a/surfaces/cockpit.json:406-411,514-526",
      "backlog": "docs/ui-rebuild/phase-a/server-backlog.json:558-568"
    }
  },
  {
    "id": "DEF-cockpit-002",
    "surface": "cockpit",
    "item": "Promote client request to strategy signal",
    "decision": "Do not build a Cockpit-only promote-to-signal POST; keep client requests as queue rows and route operators to the owning surface until the shared flagged flow is signed.",
    "class": "behavior",
    "upgradeTrigger": "AD-023 follow-up lands SB-002 with one shared endpoint, request status transition, provenance snapshot, activity log, broadcast, and coordinated receivers across Cockpit, Global Ops, Engine, Insights, and Recommendations.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "decision": "AD-023 / C-Q9 P4",
      "surface": "docs/ui-rebuild/phase-a/surfaces/cockpit.json:421-426,516-520",
      "backlog": "docs/ui-rebuild/phase-a/server-backlog.json:24-38"
    }
  },
  {
    "id": "DEF-cockpit-003",
    "surface": "cockpit",
    "item": "Technicals graduate to proof point or Insights Engine",
    "decision": "Do not build a Cockpit-specific graduation/proof-point write from technical rows; keep technicals as hand-off evidence and wait for the C3 owner-signed graduation contract.",
    "class": "behavior",
    "upgradeTrigger": "AD-004/SB-001 or SB-061 lands a shared graduation/proof-point contract with typed source provenance, attribution honesty, activity logging, broadcasts, and receiver UI.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "decision": "AD-004 / C-Q9 P5",
      "phaseA": "docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13,28-30",
      "surface": "docs/ui-rebuild/phase-a/surfaces/cockpit.json:427-432",
      "backlog": "docs/ui-rebuild/phase-a/server-backlog.json:7-23,786-796"
    }
  },
  {
    "id": "DEF-cockpit-004",
    "surface": "cockpit",
    "item": "Client-switcher book roll-up",
    "decision": "Do not extend the global workspace switcher from the single-client Cockpit lane; leave at-risk/open-request/in-setup roll-ups to Global Ops or shell ownership.",
    "class": "data",
    "upgradeTrigger": "The shell/global-ops owner extends the existing /api/workspace-overview aggregation with typed roll-up fields and proves the switcher, Global Ops Today, and Cockpit read any shared counts from one source.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "decision": "C-Q9 P6",
      "surface": "docs/ui-rebuild/phase-a/surfaces/cockpit.json:433-438,528-536",
      "backlog": "docs/ui-rebuild/phase-a/surfaces/cockpit.json:319-332"
    }
  }
]
```

### Gates before merge

`npm run typecheck && npx vite build && npx vitest run` (full suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` + `npm run verify:deferred-ledger`. Add seeded real-flag component coverage, runtime receiver tests from §4, work-queue count parity tests with Global Ops Today if that surface is present, 25-event workspace-home invalidation coverage, and a flag-ON browser smoke with realistic cockpit data.
