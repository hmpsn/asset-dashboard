# Wave 6 BUILD TICKET - Engine (`seo-strategy`)

> Surface: operator Insights Engine rebuilt in place at admin Page `seo-strategy`.
> Current mount: `src/App.tsx:415` mounts `KeywordStrategyPanel`; route type includes `seo-strategy` at `src/routes.ts:1-22`; nav entry is `src/lib/navRegistry.tsx:133-135`.
> Current legacy receiver: `src/components/KeywordStrategy.tsx:96-111` reads `?tab=overview|content|rankings|competitive`; tab changes clear the param at `src/components/KeywordStrategy.tsx:817-821`.
> Current cockpit/core children: `src/components/strategy/StrategyCockpit.tsx:54-103` builds curation state, `src/components/strategy/StrategyCockpit.tsx:107-244` renders the active cockpit, and the row/bulk machinery lives in `CockpitRow.tsx`, `CurationBulkActionBar.tsx`, `cockpitRowModel.ts`, and `useCurationSelection.ts`.
> Mount contract: use `REBUILT_SURFACES['seo-strategy']` as the controller-applied seam. This build ticket lists the seam; the build lane implementing this ticket does not edit `src/components/layout/rebuiltSurfaces.ts`.

## 1. ⚠ OWNER DELTAS

| ID | Owner delta | Build-ticket decision |
| --- | --- | --- |
| **E-Q1** | Send-issue commit entry point. | Adopt proposed default: reuse the current HEAD docked send bar from `src/components/KeywordStrategy.tsx:690-716`, keep `/bulk` as the backing mutation path, and move only the presentation into the rebuilt Engine shell. |
| **E-Q2** | Curation machinery placement. | Adopt proposed default: move-row Drawer on Engine exposes every existing verb, T1 carry-over first. No curation verb may be dropped; source behavior is `CockpitRow.tsx:74-160`, `CockpitRow.tsx:216-257`, `CurationBulkActionBar.tsx:6-121`, and `useCurationSelection.ts:19-75`. |
| **E-Q3** | Legacy `seo-strategy?tab=` tabs. | Adopt proposed default: dissolve legacy interior tabs through a D8 redirect map. The rebuilt surface uses `lens`, not `tab`, for its own state. Each old `?tab=` has a two-halves receiver entry below. |
| **E-Q4** | Trust ladder, setup readiness, leads, doorbell target, and outcome-value enrich. | Adopt proposed default: collapse into an Engine Operations Disclosure. E6/outcome-value setup deep-links to workspace settings next to outcome value instead of staying as an Engine tab. |
| **E-Q5** | Cannibalization sub-verbs. | Adopt proposed default: keep sub-verbs inside the move-row Drawer for cannibalization-archetype moves; preserve current actions from `CannibalizationTriage.tsx:52-119` and selection behavior from `KeeperSelector.tsx:40-143`. |
| **E-Q6** | Money-frame and verdict dollar rendering. | Adopt proposed default with controller delta B: consume the shipped W1.1/W1.2 contracts, `AdminMoneyFrame` and `StrategyPov.verdictHeadline`. This is owner-sign-off context, not a blocker for the build ticket. |
| **E-Q7** | Diagnostics fate. | Adopt proposed default: Diagnostics remains its own admin nav surface and report-list lens; Engine links into the existing deep-diagnostic job where applicable. |
| **E-Q8** | Generation model. | Adopt proposed default: keep full vs incremental generation plus `RefreshOrderingPrompt`; source behavior is `StrategyHeaderActions.tsx:9-67`, `useStrategyGeneration.ts:60-91`, and `RefreshOrderingPrompt.tsx:24-82`. |
| **E-Q9** | Promote client request to signal/backing move. | Adopt proposed default as amended by AD-023/controller delta C: v1 keeps feedback approval and manual-rec paths; generic promote-to-signal is a flagged, contract-backed follow-up, not built here. |
| **E-Q10** | Page-map moves. | Adopt proposed default: page-map ownership moves to Keywords/SEO Editor lanes. Engine may deep-link, but does not own page-map editing. |
| **E-Q11** | `strategy-signal-fold`. | Adopt proposed default: keep the panel; retire the fold flag as not-pursued in owner follow-up only if the flag exists in the final flag audit. Do not add a new fold flag here. |
| **E-Q12** | Money-frame read safety. | Adopt proposed default as a hard acceptance criterion: Engine header consumes the precomputed snapshot and must never call `computeROI` during render or a hot GET. |
| **DELTA-A** | `engine.json` mount note says to retire `strategy-command-center` / `strategy-the-issue`. | Controller override: flag retirement is deferred. Build additively behind `ui-rebuild-shell`; flag-OFF renders legacy `StrategyCockpit` byte-identical. `strategy-command-center` retirement moves to owner-gated `DEF-engine-001`. `strategy-the-issue` is a client flag entangled through `theIssueEnabled = commandCenterEnabled && theIssueFlag` at `src/components/KeywordStrategy.tsx:136-147`; do not retire or touch it in this ticket. |
| **DELTA-B** | Money-frame/verdict contracts have shipped since the surface JSON was drafted. | Consume W1.1/W1.2: `AdminMoneyFrame` is precomputed by cron/store (`server/money-frame-cron.ts:59-135`, `server/money-frame-store.ts:44-60`) and read through `GET /api/workspaces/:id/admin-money-frame` (`server/routes/the-issue-admin.ts:27-46`); verdict copy is `StrategyPov.verdictHeadline` (`shared/types/strategy-pov.ts:13-35`). |
| **DELTA-C** | Graduation and promotion are not Engine-local writes. | Graduation writes are deferred wholesale per AD-004 to `DEF-engine-002`. Promote-to-signal is deferred per AD-023 to `DEF-engine-003`. No Engine-only bridge write is allowed in this ticket. |
| **DELTA-D** | W6.0 shared contracts already exist. | Consume, do not rebuild: SB-004 `workQueue` classification on the workspace endpoint (`server/routes/workspace-home.ts:126-159`, `src/api/platform.ts:71-92`) and `src/components/ui/co/` primitives exported from `src/components/ui/index.ts:152-171`: `CommandCenterVerdict`, `WorkStreamSelector`, `WorkQueueRow`, `ProvenanceChip`, `ClientSwitcherRow`, `ClientThreadRow`. |

| Open question / feature | Adopted default | Acceptance effect |
| --- | --- | --- |
| E-Q1 | HEAD docked send bar over `/bulk`. | Rebuilt Engine must expose the same send/stage affordance and mutation semantics as the current Issue spine. |
| E-Q2 | T1 carry-over curation Drawer. | No legacy curation action is deleted or renamed in v1. |
| E-Q3 | D8 redirect map from old `?tab=` values. | Old bookmarks resolve to rebuilt lenses or owning surfaces; receiver reads `useSearchParams`. |
| E-Q4 | Operations Disclosure. | Trust/readiness/leads move behind progressive disclosure, not separate top-level tabs. |
| E-Q5 | Cannibalization sub-verbs in move Drawer. | Cannibalization keeps Send, Mark resolved, Fix in editor, and keeper override as row-level work. |
| E-Q6 | Shipped money/verdict contracts. | Header renders server-owned verdict and cached money frame with provenance. |
| E-Q7 | Diagnostics stays separate. | Engine links out; it does not absorb Diagnostics. |
| E-Q8 | Full/incremental generation preserved. | Generation controls remain explicit and keep refresh-order warnings. |
| E-Q9 | Promotion deferred. | Existing feedback/manual-rec flows remain; new generic promote path waits for AD-023 follow-up. |
| E-Q10 | Page-map ownership moves out. | Engine only points to Keywords/SEO Editor for page-map work. |
| E-Q11 | Keep signal fold panel. | Do not introduce a new strategy-signal fold flag. |
| E-Q12 | Cron snapshot only. | `computeROI` is banned from rebuilt render/read paths. |

## 2. Capability Checklist

Every row in `docs/ui-rebuild/phase-a/surfaces/engine.json` `capabilityClassification` is an acceptance criterion. The build lane must check these off against the rebuilt page, not against the legacy fallback.

### Shell, Routing, And Generation

- [ ] `A1 route-mount`: `seo-strategy` routes through the controller-applied `REBUILT_SURFACES['seo-strategy']` seam, with `ui-rebuild-shell` OFF rendering legacy `KeywordStrategyPanel` byte-identical.
- [ ] `A2 engine-header`: header uses `PageContainer`, `PageHeader`, and co-owned `CommandCenterVerdict`; no custom page chrome.
- [ ] `A3 verdict-headline`: render server-owned `StrategyPov.verdictHeadline`; no client-side verdict generation or fallback copy that pretends to be a verdict.
- [ ] `A4 money-frame`: render cached `AdminMoneyFrame` with `ProvenanceChip`; empty/error states explain missing cron data instead of computing live.
- [ ] `A5 generation-actions`: preserve Update, Full refresh, and disabled/loading states from `StrategyHeaderActions.tsx:9-67`.
- [ ] `A6 refresh-ordering`: preserve `RefreshOrderingPrompt` behavior before full refresh (`RefreshOrderingPrompt.tsx:24-82`).
- [ ] `A7 status-progress`: preserve current progress/error/empty behavior from `src/components/KeywordStrategy.tsx:388-421` using `Skeleton`, `EmptyState`, and `ErrorState`.
- [ ] `A8 tab-dissolve`: old `overview|content|rankings|competitive` `?tab=` values redirect through D8 rows below.
- [ ] `A9 lens-state`: rebuilt Engine uses `lens` for internal state and reads it with `useSearchParams`; it does not overload `?tab=`.
- [ ] `A10 mobile-fit`: workstream selector, verdict, money frame, and docked action affordances fit at mobile widths without clipped labels.
- [ ] `A11 ds-marker`: all new rebuilt files under `src/components/engine-rebuilt/**` carry `@ds-rebuilt` and pass token/icon/motion rebuild gates.

### Curation And Work Queue

- [ ] `B1 workstream-selector`: consume `WorkStreamSelector` from `src/components/ui/`, backed by SB-004 `workQueue` classification.
- [ ] `B2 queue-row`: consume `WorkQueueRow` for repeated work rows; do not create a second queue-row primitive.
- [ ] `B3 selection-model`: preserve `useCurationSelection.ts:19-75` semantics in a new Engine-owned hook only if needed; otherwise call existing mutation hooks without touching legacy files.
- [ ] `C1 curation-meter`: preserve the meter intent from `CurationMeter.tsx:13-27`, restyled with rebuilt primitives.
- [ ] `C2 attention-strip`: preserve `NeedsAttentionStrip.tsx:5-61` and `cockpitAttention.ts:62-112` prioritization.
- [ ] `C3 fix-now-cap`: preserve `FIX_NOW_CAP` and lifecycle bucketing from `cockpitRowModel.ts:3-124`.
- [ ] `C4 row-verbs`: keep stage, send, fix, park, throttle, strike, and bulk verbs from `CockpitRow.tsx:74-160` and `CockpitRow.tsx:216-257`.
- [ ] `C5 bulk-bar`: carry over `CurationBulkActionBar.tsx:6-121` semantics; presentation may change, payload may not.
- [ ] `C6 sendable-counts`: preserve staged/sendable counts from `src/components/KeywordStrategy.tsx:531-566`.
- [ ] `C7 docked-send`: preserve the docked send bar from `src/components/KeywordStrategy.tsx:690-716`.
- [ ] `C8 manual-add`: preserve `AddRecommendationModal.tsx:60-157` for manual recommendations; no promote-to-signal write is added.
- [ ] `C9 cannibalization`: expose `CannibalizationTriage.tsx:52-119` actions in the move Drawer.
- [ ] `C10 keeper-override`: expose `KeeperSelector.tsx:40-143` only for cannibalization archetypes.
- [ ] `C11 source-provenance`: row provenance uses `ProvenanceChip`, not bespoke badges.
- [ ] `C12 no-legacy-edits`: legacy `src/components/strategy/**` remains untouched by this build lane.

### POV, Signals, And Operations

- [ ] `D1 issue-spine`: preserve the Issue spine composition from `src/components/KeywordStrategy.tsx:618-689` as an Engine lens.
- [ ] `D2 issue-header`: preserve `IssueHeader.tsx:62-123` behavior and the no-new-endpoint note in `IssueHeader.tsx:1-21`.
- [ ] `D3 drafted-pov`: preserve autosave/editor behavior from `DraftedPovEditor.tsx:143-268`.
- [ ] `D4 stance-bar`: preserve `StanceBar.tsx:45-100` semantics.
- [ ] `D5 backing-moves`: preserve grouping, staging counters, and add-rec flow from `BackingMovesQueue.tsx:186-323`.
- [ ] `D6 strategy-diff`: preserve what-changed summary/why-cards from `StrategyDiff.tsx:16-113`.
- [ ] `D7 intelligence-signals`: preserve recompute/read behavior from `IntelligenceSignals.tsx:38-124`.
- [ ] `E1 readiness`: collapse `IssueSetupReadiness.tsx:30-124` into Operations Disclosure and keep its workspace-settings deep links.
- [ ] `E2 trust-ladder`: collapse `TrustLadderPanel.tsx:94-135` into Operations Disclosure; do not touch `strategy-trust-ladder-autosend`.
- [ ] `E3 leads-readout`: collapse `AdminLeadsReadout.tsx:40-125` into Operations Disclosure.
- [ ] `E4 content-work-orders`: link out using the existing `ContentWorkOrderLens.tsx:84-122` target rules.
- [ ] `E5 keyword-targets`: link out using `KeywordTargetsLens.tsx:80-119` and `buildHubDeepLinkQuery`.
- [ ] `E6 lost-query-recovery`: preserve `LostQueryRecoveryCard.tsx:15-56` as an Engine signal card or link-out affordance.
- [ ] `E7 staleness-nudges`: preserve `StrategyStalenessNudges.tsx:6-65` refresh prompts.
- [ ] `E8 diagnostics`: link to Diagnostics for report drill-ins; do not absorb Diagnostics into Engine.
- [ ] `E9 admin-client-preview`: defer SB-039 preview spine to `DEF-engine-004`.

### Dissolved Legacy Tabs And Cross-Surface Ownership

- [ ] `F1 overview-tab`: old `?tab=overview` lands on `?lens=spine`.
- [ ] `F2 content-tab`: old `?tab=content` lands on Content Pipeline, not an Engine tab.
- [ ] `F3 rankings-tab`: old `?tab=rankings` lands on Keyword Hub rankings lens.
- [ ] `F4 competitive-tab`: old `?tab=competitive` lands on Competitors.
- [ ] `F5 page-map`: page-map work is handed to Keywords/SEO Editor; Engine does not create page-map UI.
- [ ] `F6 content-send`: content work-order CTAs use `content-pipeline?tab=briefs|posts` and rely on that receiver.
- [ ] `F7 settings-send`: setup/outcome-value CTAs use workspace-settings receivers.
- [ ] `F8 diagnostics-send`: deep diagnostic CTAs use Diagnostics receivers.
- [ ] `F9 no-client-flag-touch`: `strategy-the-issue` is not edited, retired, or reclassified.
- [ ] `F10 no-command-flag-retire`: `strategy-command-center` retirement is deferred to `DEF-engine-001`.

### Kit And Composition Floor

- [ ] `G1 co-primitives`: import `CommandCenterVerdict`, `WorkStreamSelector`, `WorkQueueRow`, `ProvenanceChip`, `ClientSwitcherRow`, and `ClientThreadRow` from `src/components/ui/`.
- [ ] `G2 no-new-card-shell`: use existing rebuilt primitives (`PageContainer`, `PageHeader`, `Toolbar`, `LensSwitcher`, `SearchField`, `MetricTile`, `DataTable`, `GroupBlock`, `Drawer`) before adding Engine-local components.
- [ ] `G3 operator-language`: preserve operator/admin framing; no client-facing claims of shipped work for unexecuted recommendations.
- [ ] `G4 flag-on-smoke`: verify rebuilt Engine with `ui-rebuild-shell` ON against realistic seeded strategy data, including empty, stale, generated, staged, and error states.

## 3. Server Tickets

| Ticket | Disposition | Engine build instruction | Notes |
| --- | --- | --- | --- |
| `SB-003` / `sn-engine-1` Admin money-frame projection | **RIDE / consume shipped W1.1** | Add only Engine read/render wiring if absent. Read the persisted money-frame endpoint and render `AdminMoneyFrame` with provenance. | Hard ban: no `computeROI` call in render, hook, route loader, or hot GET. |
| `SB-038` / `sn-engine-2` Admin verdict headline | **RIDE / consume shipped W1.2** | Render `StrategyPov.verdictHeadline` from the existing POV payload. | Server schema/API already carry the field; do not draft verdict text client-side. |
| `SB-002` / `sn-engine-3` Promote client request to strategy signal | **DEFER** -> `DEF-engine-003` | Do not build in this ticket. Keep feedback-approve/manual recommendation paths. | AD-023 requires a flagged, contract-backed follow-up. |
| `SB-039` / `sn-engine-4` Admin what-the-client-sees spine preview | **DEFER** -> `DEF-engine-004` | Do not build preview spine in this ticket. | Needs a read-safe admin source and owner-gated E9 scope. |
| `SB-001` Graduation write seam | **DEFER** -> `DEF-engine-002` | Do not add graduation writes, bridge callbacks, or status mutations. | AD-004 defers graduation wholesale. |
| `SB-004` Unified work-queue classification | **CONSUME SHIPPED DEPENDENCY** | Read `workQueue` from workspace home data and feed co-primitives. | Not counted as a riding server ticket; already available via `WorkspaceHomeData.workQueue`. |

Server-ticket count for this build table: 2 riding, 3 deferred, 1 consumed dependency.

## 4. Deep-Link Receiver Matrix

| # | Sender / URL | Receiver half | Required behavior | Source reference |
| --- | --- | --- | --- | --- |
| 1 | `/ws/:workspaceId/seo-strategy` | Engine default receiver | Initialize `lens=spine` when no query is present. | Route type `src/routes.ts:1-22`; mount `src/App.tsx:415`. |
| 2 | `/ws/:workspaceId/seo-strategy?lens=<bad>` | Engine lens receiver | Sanitize invalid lens to `spine` without crashing. | Build Conventions: use `lens`, not `tab`, for rebuilt state. |
| 3 | `/ws/:workspaceId/seo-strategy?tab=overview` | D8 legacy receiver | Redirect/replace to `/ws/:workspaceId/seo-strategy?lens=spine`. | Legacy tab IDs `src/components/KeywordStrategy.tsx:68-87`. |
| 4 | `/ws/:workspaceId/seo-strategy?tab=content` | D8 legacy receiver | Redirect/replace to `/ws/:workspaceId/content-pipeline?tab=content-health`. | Legacy receiver `src/components/KeywordStrategy.tsx:96-111`. |
| 5 | `/ws/:workspaceId/seo-strategy?tab=rankings` | D8 legacy receiver | Redirect/replace to `/ws/:workspaceId/seo-keywords?lens=rankings`. | Legacy branch `src/components/KeywordStrategy.tsx:850-1015`. |
| 6 | `/ws/:workspaceId/seo-strategy?tab=competitive` | D8 legacy receiver | Redirect/replace to `/ws/:workspaceId/competitors`. | Legacy branch `src/components/KeywordStrategy.tsx:850-1015`. |
| 7 | `/ws/:workspaceId/seo-strategy?lens=spine` | Engine lens receiver | Render Issue spine, verdict, money frame, backing moves, and docked send bar. | Issue spine `src/components/KeywordStrategy.tsx:618-716`. |
| 8 | `/ws/:workspaceId/seo-strategy?lens=changes` | Engine lens receiver | Render what-changed and diff cards. | `StrategyDiff.tsx:16-113`. |
| 9 | `/ws/:workspaceId/seo-strategy?lens=signals` | Engine lens receiver | Render intelligence signals, lost-query recovery, and staleness nudges. | `IntelligenceSignals.tsx:38-124`; `LostQueryRecoveryCard.tsx:15-56`; `StrategyStalenessNudges.tsx:6-65`. |
| 10 | `/ws/:workspaceId/seo-strategy?lens=pov` | Engine lens receiver | Render POV editor and stance controls. | `DraftedPovEditor.tsx:143-268`; `StanceBar.tsx:45-100`. |
| 11 | `/ws/:workspaceId/seo-strategy?lens=moves` | Engine lens receiver | Render curation rows, move Drawer, bulk selection, and send queue. | `StrategyCockpit.tsx:54-244`; `CockpitRow.tsx:74-257`. |
| 12 | `/ws/:workspaceId/seo-strategy?lens=operations` | Engine lens receiver | Render collapsed setup/trust/leads disclosure. | `IssueSetupReadiness.tsx:30-124`; `TrustLadderPanel.tsx:94-135`; `AdminLeadsReadout.tsx:40-125`. |
| 13 | Engine content work-order CTA -> `content-pipeline?tab=briefs|posts` | Content Pipeline receiver | Sender appends the tab; receiving surface must read it and initialize its tab. | `ContentWorkOrderLens.tsx:84-122`. |
| 14 | Engine setup/outcome CTA -> `workspace-settings?tab=connections|dashboard` | Workspace Settings receiver | Sender appends the tab; receiver must initialize from `useSearchParams`. | `IssueSetupReadiness.tsx:37-40`. |
| 15 | Engine keyword target CTA -> `seo-keywords?...` | Keyword Hub receiver | Sender preserves current keyword target query semantics. | `KeywordTargetsLens.tsx:80-119`. |
| 16 | Engine diagnostic CTA -> Diagnostics report drill-in | Diagnostics receiver | Sender links to existing Diagnostics job/report path; receiver remains Diagnostics-owned. | E-Q7 / C-7 decision; Engine does not absorb Diagnostics. |

## 5. Flag Disposition

| Flag | Ticket disposition | Notes |
| --- | --- | --- |
| `ui-rebuild-shell` | Build behind this flag. | ON mounts the rebuilt Engine at the controller seam; OFF renders legacy `KeywordStrategyPanel`/`StrategyCockpit` byte-identical. |
| `strategy-command-center` | **Do not retire here.** | Retirement is destructive and owner-gated; deferred to `DEF-engine-001`. |
| `strategy-the-issue` | **Do not touch.** | This is a client flag per the authoritative flag disposition; `engine.json` mount note is wrong to imply retirement here. It is entangled through `theIssueEnabled = commandCenterEnabled && theIssueFlag` in `src/components/KeywordStrategy.tsx:136-147`. |
| `strategy-trust-ladder-autosend` | Do not touch. | Permanent safety-style behavior stays outside this rebuild ticket. |
| `strategy-signal-fold` | No new work. | E-Q11 adopts not-pursued/keep-panel default; if a stale flag exists, retirement is owner follow-up, not this build. |

## 6. File Ownership

The build lane implementing this ticket owns only:

- `src/components/engine-rebuilt/**`
- `src/hooks/admin/useEngineRebuilt*.ts`
- associated Engine rebuilt tests
- any riding `sn-engine-*` server-ticket files required for the riding rows above, with the understanding that W1.1/W1.2 are already shipped and should be consumed rather than rebuilt

The build lane explicitly must not touch:

- legacy `src/components/strategy/**`
- legacy `src/components/KeywordStrategy.tsx`
- `AppShell` or shell navigation implementation files
- `src/components/layout/rebuiltSurfaces.ts` (the seam is controller-applied)
- any other rebuild lane's files
- `strategy-command-center` or `strategy-the-issue` flag definitions, migrations, or cleanup paths

If implementation discovers that a required change falls outside the owned files, stop the build lane and raise an owner delta instead of widening the diff.

## 7. D8 / DEF Entries

| D8 ID | Legacy URL | Rebuilt target | Receiver contract |
| --- | --- | --- | --- |
| `D8-engine-tab-overview` | `/ws/:workspaceId/seo-strategy?tab=overview` | `/ws/:workspaceId/seo-strategy?lens=spine` | Engine reads `tab`, maps it once, then receives `lens=spine`. |
| `D8-engine-tab-content` | `/ws/:workspaceId/seo-strategy?tab=content` | `/ws/:workspaceId/content-pipeline?tab=content-health` | Sender appends `?tab=content-health`; Content Pipeline receiver must read it. |
| `D8-engine-tab-rankings` | `/ws/:workspaceId/seo-strategy?tab=rankings` | `/ws/:workspaceId/seo-keywords?lens=rankings` | Sender appends `lens=rankings`; Keyword Hub receiver must initialize from it. |
| `D8-engine-tab-competitive` | `/ws/:workspaceId/seo-strategy?tab=competitive` | `/ws/:workspaceId/competitors` | Sender redirects to Competitors; no Engine tab remains. |

Deferred-ledger rows to add in the implementation PR:

```json
[
  {
    "id": "DEF-engine-001",
    "surface": "engine",
    "item": "strategy-command-center retirement and strategy-the-issue no-touch guard",
    "decision": "Build the rebuilt seo-strategy surface additively behind ui-rebuild-shell. Defer destructive strategy-command-center retirement to an owner-gated follow-up and do not touch the client strategy-the-issue flag.",
    "class": "behavior",
    "upgradeTrigger": "Owner approves a separate flag-retirement PR with OFF-branch deletion, override cleanup migration, and strategy-the-issue lifecycle audit.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-engine-002",
    "surface": "engine",
    "item": "Graduation writes from Engine",
    "decision": "Defer graduation writes wholesale per AD-004; Engine ships parity/read-only curation behavior and does not add bridge writes or status mutations.",
    "class": "behavior",
    "upgradeTrigger": "Graduation seam is approved as a shared contract with tests and cross-surface write ownership.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-engine-003",
    "surface": "engine",
    "item": "Promote client request to strategy signal/backing move",
    "decision": "Defer E-Q9 and AD-023 promote-to-signal path; keep existing feedback-approve and manual recommendation flows in this ticket.",
    "class": "behavior",
    "upgradeTrigger": "A flagged, contract-backed promote-to-signal follow-up defines source snapshots, attribution, events, tests, and inbox/request ownership.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  },
  {
    "id": "DEF-engine-004",
    "surface": "engine",
    "item": "Admin what-the-client-sees spine preview",
    "decision": "Defer SB-039/E9 preview spine; Engine v1 does not add a client preview without a read-safe admin source.",
    "class": "data",
    "upgradeTrigger": "Owner approves the admin preview contract and read path, including public-boundary parity tests and no-client-claim copy review.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {}
  }
]
```

Gates for the implementation PR:

- `npm run typecheck && npx vite build`
- `npx vitest run`
- `npm run pr-check`
- `npm run lint:hooks`
- `npm run verify:bundle-budget`
- `npm run verify:deferred-ledger`
- Contract coverage for every D8 row above and the two-halves receiver behavior for old `?tab=` plus new `lens`.
- Component coverage for `ui-rebuild-shell` loading -> ON transition with the real flag hook, not a mocked hook.
- Real-browser flag-ON smoke with seeded strategy data covering empty, generated, stale, staged/sendable, money-frame-missing, money-frame-present, and invalid legacy-tab URLs.
- Search guard before closeout: no rebuilt Engine file imports from `src/components/strategy/**` except type-only references explicitly approved by the owner; no `computeROI` reference in any `src/components/engine-rebuilt/**` or `src/hooks/admin/useEngineRebuilt*.ts` file.
