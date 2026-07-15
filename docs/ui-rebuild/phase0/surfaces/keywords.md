# Phase 0 Additive-Parity Ledger — Keywords (2→1 merge)

- **Zone:** Strategy & Content
- **HEAD surface:** `Page 'seo-keywords'` → `KeywordHub` (`src/routes.ts:7`, `src/lib/navRegistry.tsx:137`, `src/App.tsx:400`)
- **Prototype view:** `hmpsn studio Design System/mockup/keywords.js` (view-keywords) + `Reference Screen - Keywords.html`
- **Audit basis:** branch `ui-rebuild-phase-0` (post-Reconcile staging HEAD). Read-only audit; every claim carries file:line evidence at HEAD.

## What the "2→1" actually is (verify before build)

Three kit documents describe the merge three different ways:

1. `mockup/keywords.js:328` — banner: *"Replaces **Keyword Hub · Page Intelligence**"*.
2. `Platform Parity Ledger.html` (Page Intelligence row) — Page Intelligence → **SEO Editor (Research mode)**, `editor.js`, status improved: *"Merged into the SEO Editor via an Edit ⇄ Research toggle"*.
3. `UI Rebuild Handoff Brief.html` (Part 4 worked example U1) — Keywords *"merges the former standalone **keyword-picking and keyword-recommendation** screens"*.

At HEAD the 2→1 already happened once: KeywordHub is the canonical consolidated surface (legacy Keyword Command Center + standalone Rank Tracker retired in the W4 cutover — `src/components/KeywordHub.tsx:16-19`; memory: Keyword Hub cutover complete 2026-06-12). So the prototype merge is **not** a repeat of that; the only *new* absorption the mockup claims is Page Intelligence, which the Parity Ledger contradicts. **Stop-and-ask #1 below.**

---

## 1. Capability ledger (HEAD → new IA)

Legend: **preserved** = has an obvious home, same or better · **improved** = prototype upgrades it · **new_proposed** = prototype-only, needs sign-off · **at_risk** = exists at HEAD, no visible home in mockup or Parity Ledger. Uncertain = at_risk.

### A. Route, nav, deep links

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 1 | Admin route `seo-keywords` under SEO/Strategy nav group, needsSite | `src/routes.ts:7`, `src/lib/navRegistry.tsx:137`, `src/App.tsx:360,400` | preserved | Keywords (nav id `keywords`, Strategy & Content zone) | Ledger row status: improved |
| 2 | `?tab=` deep-link receiver — seeds one of 7 segments (two-halves contract) | `src/components/KeywordHub.tsx:185-198`; `src/lib/keywordHubDeepLink.ts:22-44` | at_risk | none visible | Prototype has no URL-param handling. Contract test + pr-check enforce receiver wiring; sender set must be remapped to new lens/filter ids |
| 3 | `?q=` deep-link — normalized keyword opens the detail drawer on mount (fires once, guarded ref) | `src/components/KeywordHub.tsx:189-197,283-295` | at_risk | none visible | Cross-surface keyword identity links depend on this |
| 4 | Cross-surface deep-link senders into Hub (`buildHubDeepLinkQuery`) from Strategy opportunity/gap/target components + drawer replaced-by | senders: `src/components/strategy/KeywordOpportunities.tsx`, `KeywordGaps.tsx`, `SiteTargetKeywords.tsx`, `issue/KeywordTargetsLens.tsx`, `src/lib/strategyNextActionTarget.ts`; contract `src/lib/keywordHubDeepLink.ts:1-14` | at_risk | none visible | Every sender must be repointed in the same change that renames the surface (route-removal checklist) |

### B. Summary, trust signals, page chrome

| # | Capability | Evidence | Status | Home | Notes |
|---|-----------|----------|--------|------|-------|
| 5 | 5 KPI summary cards: In Strategy / Tracked / Local / Needs Review / Retired counts | `src/components/KeywordHub.tsx:592-599`; counts `shared/types/keyword-command-center.ts:275-304` | improved | mockup `kw-sumrow` (keywords.js:331-336) | **Metric set changes**: prototype shows Tracked / Avg position / Winning(top 5) / High-opportunity. Lifecycle counts (Needs Review, Retired, Local, In Strategy) lose their KPI slot — see #10 and stop-and-ask #3/#8 |
| 6 | Summary loading skeleton grid (never zeros) | `src/components/KeywordHub.tsx:600-609` | preserved | Build Conventions state matrix (loading = shimmer, not zeros) | |
| 7 | Summary-fetch error band (`role="status"`, rows stay usable) | `src/components/KeywordHub.tsx:254-259,613-620` | preserved | Build Conventions error contract | |
| 8 | Truncation honesty banner — "N more keywords below the display cap" (`rawEvidenceTotal` vs `rawEvidenceReturned`) | `src/components/KeywordHub.tsx:243-252,675-686`; `shared/types/keyword-command-center.ts:311-315` | at_risk | none visible | Trust signal; silently dropping the hidden tail is exactly what it exists to prevent |
| 9 | Metric-window disclosure label (clicks/impressions window from `GSC_METRIC_WINDOW_DAYS`, rank = window avg, volume = provider estimate) | `src/components/KeywordHub.tsx:664-671`; `shared/keyword-window.ts` | at_risk | none visible | Number-provenance disclosure; pairs with "never change a client-facing number's meaning" law |

### C. Segments, filters, search, sort, pagination

| # | Capability | Evidence | Status | Home | Notes |
|---|-----------|----------|--------|------|-------|
| 10 | 7 status segment pills with live counts: All · Striking Distance · In Strategy · Tracked · Needs Review · Retired · Local | `src/components/keyword-hub/HubSegmentBar.tsx:46-54`; `src/components/KeywordHub.tsx:155-178,343-351`; `src/hooks/admin/useKeywordHubState.ts:24-31,88-107` | at_risk | partial: lens counts + ledger's "CurationMeter → review-queue triage" claim | Prototype lenses (Rankings/Opps/Pages/Clusters/Lifecycle) are a **view axis**, not the status axis. Needs Review triage, Retired, Local, In Strategy segments have no demonstrated home; ledger asserts triage is covered but the mockup doesn't show it. Stop-and-ask #3 |
| 11 | 12 advanced (non-primary) filters: content · page_assigned · raw_evidence · local_candidates · visible_locally · possible_match · not_visible · not_checked · provider_degraded · requested · declined · lost_visibility — server-counted metas, clearable chip | `src/components/keyword-hub/HubAdvancedFilters.tsx:1-14,29-37,146-186`; `shared/types/keyword-command-center.ts:22-49` | at_risk | mockup shows two static chip buttons "Intent" and "Stage" (keywords.js:342-343) | Filter taxonomy replaced wholesale; local-posture and feedback filters (requested/declined) have no home. Stop-and-ask #3 |
| 12 | Keyword/page search, 300 ms debounced, server-side | `src/components/KeywordHub.tsx:553-560`; `src/hooks/admin/useKeywordHubState.ts:60-63` | preserved | mockup `kw-search` (keywords.js:341,352-353) | |
| 13 | User-controlled column sorting — 8 keys (opportunity, keyword, position, change, clicks, volume, difficulty, date) mapped to 7 server sorts incl. dedicated `opportunity`/`clicks`/`difficulty`; toggle asc/desc; sort-summary badge | `src/components/KeywordHub.tsx:92-131,647-654`; `shared/types/keyword-command-center.ts:320`; `useKeywordHubState.ts:33-46,191` | at_risk | none visible | Prototype sorts are fixed per lens (Reference Screen sorts by lens only); no user sort affordance |
| 14 | Server pagination — 50/page, Page N of M, total count, prev/next | `src/components/KeywordHub.tsx:210-220`; `src/components/keyword-hub/HubKeywordList.tsx:303-338` | at_risk | none visible | Mockup renders a full 12-row static list; real universes are capped+paged (keyword-hub OOM guard, `docs/rules/keyword-hub.md`) |
| 15 | Reset-filters + filtered-vs-unfiltered empty-state branching ("No keywords yet" CTA vs "No keywords match your filters" + Clear) | `src/components/KeywordHub.tsx:469-475,491-496`; `HubKeywordList.tsx:210-244` | preserved | Handoff Brief field 5 mandates empty state; Build Conventions | Unfiltered empty CTA currently focuses the add-keyword input — depends on #23 surviving |
| 16 | Rows error state with Retry (refetches the active query) | `HubKeywordList.tsx:196-208`; `KeywordHub.tsx:477-479` | preserved | Handoff Brief field 5 (error state) | |

### D. List, rows, bulk operations

| # | Capability | Evidence | Status | Home | Notes |
|---|-----------|----------|--------|------|-------|
| 17 | Row metric columns: position · clicks · volume · difficulty (flat-field adapter over `row.metrics`) | `HubKeywordList.tsx:85-101,186-194,257-259` | at_risk (clicks) / preserved (rank, volume, difficulty) | Rankings lens has rank/Δ/trend/page; Opps lens has score/gain; volume in row meta | **GSC clicks column has no prototype home** (impressions/CTR already drawer-only at HEAD). Rank/volume/difficulty visible across lenses |
| 18 | Local-visibility column (posture label: Visible/Possible/Not Visible/Degraded, lifecycle fallback) | `HubKeywordList.tsx:104-135` (localSeoColumnLabel); `KeywordHub.tsx:200,714` | at_risk | none in table; drawer points to Local Presence for local intent (keywords.js:412) | Keyword-level local evidence was deliberately kept in Hub when Local Presence split out (FEATURE_AUDIT.md:87) |
| 19 | Row provenance meta badges: lifecycle StatusBadge + "From gap" (blue) + "Auto-managed" (teal, three-state `strategyOwned === true`) | `src/components/keyword-hub/HubKeywordRowMeta.tsx:27-52`; `shared/types/keyword-command-center.ts:252-266` | at_risk | mockup rows show intent chip + volume only | Reconcile-ownership visibility; losing it re-opens "who manages this keyword" confusion |
| 20 | Multi-select (per-row + select-all-visible) with selection state | `HubKeywordList.tsx:268-284`; `useKeywordHubState.ts` selection API | preserved (per ledger) — **unverified in prototype** | Parity Ledger: "CurationBulkActionBar → present at bulk actions"; ledger note: "Rebuilt as the multi-select command surface" | Neither `keywords.js` nor the Reference Screen renders checkboxes/bulk UI (grep: 0 hits). Verify before build — stop-and-ask #4 |
| 21 | Bulk lifecycle actions (max 50): add_to_strategy · track · pause_tracking · retire · decline; protected-row confirm dialog (force); per-item result summary (applied/skipped_protected/skipped_not_tracked/skipped_noop/error) | `KeywordBulkActionBar.tsx`; `shared/types/keyword-command-center.ts:395-431`; `KeywordHub.tsx:353-392,738-761`; server `server/routes/keyword-command-center.ts:181` | preserved (per ledger) — unverified | same as #20 | Includes the skip/fail explanation band (`KeywordHub.tsx:745-750`) |
| 22 | Per-row lifecycle action menu — full 7-verb catalog (add_to_strategy, promote_evidence, track, pause_tracking, retire, decline, restore) from server-computed `nextActions`, amber-tone remap, protected-action ConfirmDialog | `src/components/keyword-command-center/KeywordActionMenu.tsx:26-53`; `shared/types/keyword-command-center.ts:59-69`; `KeywordHub.tsx:394-397`; server `keyword-command-center.ts:146` | at_risk | drawer CTAs in mockup cover only stage + open-editor | The action catalog is contract-tested (`tests/contract/action-catalog.test.ts`); `promote_evidence`/`restore`/`pause_tracking` have no visible home |
| 23 | Hard delete — separate channel (never a lifecycle verb), client eligibility mirror of server `isHardDeleteEligible` (manual, unpinned, no strategy/client provenance), red reserved exclusively for it, ConfirmDialog | `KeywordActionMenu.tsx:18-20,55-60+`; `KeywordHub.tsx:398-407`; `useKeywordHardDelete` `src/hooks/admin/useKeywordCommandCenter.ts:89`; server `keyword-command-center.ts:165` | at_risk | none visible | |
| 24 | Protected-keyword model: `isProtected`/`protectionReason`, disabledReason-gated force override (drawer + bulk), "why protected" shown before force | `shared/types/keyword-command-center.ts:241-243`; `KeywordHub.tsx:360-362,451-467,763-788` | at_risk | none visible | Guards client-requested / strategy-owned / gap-sourced / pinned keywords from silent lifecycle damage |
| 25 | Add keyword (manual) — input + Enter/Add, writes through rank-tracking add path, error surfaced in shared band | `KeywordHub.tsx:266-270,498-509,528-551`; `useRankTrackingAddKeyword` hook :108; server `server/routes/rank-tracking.ts:75` | at_risk | none visible | Also an MCP tool (`add_keyword_to_strategy`, `add_keywords_batch`) but the UI affordance itself has no home |
| 26 | Row click → per-keyword detail drawer with instant list-row preview while detail fetches | `KeywordHub.tsx:206-208,272-278,712`; detail endpoint `keyword-command-center.ts:131` | preserved | mockup drawer (keywords.js:358-416) | |
| 27 | Shared mutation-failure error band (row/drawer/local/national/bulk/add — first error wins, `role="alert"`) | `KeywordHub.tsx:511-519,580-587` | preserved | Build Conventions mutation & feedback contract | |

### E. Detail drawer (per-keyword journey)

| # | Capability | Evidence | Status | Home | Notes |
|---|-----------|----------|--------|------|-------|
| 28 | Origin section (source descriptor) + "View in Strategy" back-link | `src/components/keyword-command-center/KeywordDetailDrawer.tsx:169-196,268-291` | at_risk | mockup drawer has no provenance section | |
| 29 | Source labels (strategy / page_assignment / content_gap / feedback / client_request / manual / rank_data / local_*) as badges | `KeywordDetailDrawer.tsx:354`; `shared/types/keyword-command-center.ts:99-113` | at_risk | none visible | |
| 30 | Closed-loop outcome read-back chip (baseline→current verdict, W5.1) | `KeywordDetailDrawer.tsx:39-40,316-322`; `shared/types/outcome-tracking.ts` | at_risk | none visible | Outcomes Sweep doc may re-home it — not demonstrated for Keywords |
| 31 | Pin/unpin tracked keyword | `KeywordDetailDrawer.tsx:67,413-422`; server `rank-tracking.ts:94` | at_risk | none visible | Pin also feeds protection (#24) and hard-delete eligibility (#23) |
| 32 | Rank trend: lazy national rank-history fetch + `RankHistoryChart` + sparkline; "not enough snapshots" empty | `KeywordDetailDrawer.tsx:79-92,519-532`; server history `rank-tracking.ts:211` | improved | mockup puts a 7-pt sparkline **in every row** (keywords.js:226-241) + drawer rank section | Row-level trend is an upgrade, but needs a per-row history source that HEAD's rows response does not carry (see N5) |
| 33 | Live SERP detail (P6): national live rank vs GSC avg, AI Overview present/cited badge, SERP-feature badges | `KeywordDetailDrawer.tsx:478-508`; `shared/types/keyword-command-center.ts:131-146` | at_risk | none visible | Flag-gated (`national-serp-tracking`) paid data; silently dropping it orphans the paid refresh (#40) |
| 34 | Local visibility per-market breakdown (pack rank, match confidence, show-all beyond 6) + "check local visibility" on-demand refresh + local candidate lifecycle/priority panel | `KeywordDetailDrawer.tsx:34,196-198,543-581,648-703`; `KeywordHub.tsx:447-450` (`useLocalSeoRefresh`) | at_risk | mockup: only a pointer link "Local ranking & GBP health live in Local Presence" (keywords.js:412) | Keyword-level per-market evidence stays in Hub by design at HEAD (FEATURE_AUDIT.md:87); confirm whether Local Presence surface absorbs it or Keywords keeps it |
| 35 | Replaced-by chain — deprecated keyword links to its replacement (in-place select or Hub deep-link fallback) | `KeywordDetailDrawer.tsx:45-51,598-621`; `KeywordHub.tsx:729` | at_risk | none visible | |
| 36 | Protection / lost-visibility badges in drawer header | `KeywordDetailDrawer.tsx:239-240` | at_risk | none visible | Lost-visibility *recovery* moved to Insights Engine per ledger (LostQueryRecoveryCard row); the per-keyword flag + `lost_visibility` filter still need a home |
| 37 | Drawer navigation actions: `review_page` → Page Intelligence with fixContext; `generate_brief` → content-pipeline with fixContext; `view_rankings` self-anchor | `KeywordHub.tsx:414-446` | at_risk (review_page) / preserved (generate_brief per ledger "handoffs") | review_page target is being merged into SEO Editor (Research mode) | Handoff must be **remapped**, not dropped, in the same change (route-removal checklist) |
| 38 | Drawer a11y: focus trap, Esc close, focus restore, background scroll lock | `KeywordDetailDrawer.tsx:74-120+` | preserved | System `Drawer` primitive (Reference Screen uses `Drawer`) | |
| 39 | GSC query variants aggregation on a row (`variantCount`, `variants[]`) + value transparency (`valueReasons`, `currentMonthly`/`upsideMonthly` $) | `shared/types/keyword-command-center.ts:244-273` | at_risk | prototype has opp score + "est. gain" (keywords.js:256-263) which *loosely* map to upside | $ figures are display-only by the rebuild rules ("UI presents, never computes money") — the mapping opp-score↔valueReasons↔$ must be specified, not improvised |

### F. Panels, jobs, flags, tiers, live updates

| # | Capability | Evidence | Status | Home | Notes |
|---|-----------|----------|--------|------|-------|
| 40 | National SERP rank refresh trigger — flag `national-serp-tracking` + Growth+ tier gate + budget observe-gate + global/per-workspace job serialization + NotificationBell progress | `KeywordHub.tsx:562-575`; server `rank-tracking.ts:133-161`; `shared/types/feature-flags.ts:38,230` | at_risk | none visible | The paid data it produces feeds #33; keep trigger + gates together |
| 41 | AI Visibility (LLM-mention) KPI panel + refresh (Growth+ tier, background job) | `KeywordHub.tsx:635-637`; `src/components/strategy/AiVisibilityPanel.tsx:12-22`; server `rank-tracking.ts:163-211` | preserved (moved) | Parity Ledger: AiVisibilityPanel → "Brand & AI / AI Visibility" | Cross-surface: Brand & AI auditor owns the destination; Keywords rebuild must not orphan the mount |
| 42 | Local Presence handoff card (markets/checked-keywords summary, setup-state tone, deferred idle-callback mount) | `KeywordHub.tsx:202-204,297-319,622-633`; `src/components/local-seo/LocalPresenceHandoff.tsx:15-30` | preserved (moved) | Local Presence surface + drawer pointer link | |
| 43 | Client keyword feedback (declined + reasons, requested, approved counts; admin add-requested action) — at HEAD lives on the **Strategy** page | `src/components/strategy/ClientKeywordFeedback.tsx:6-40`; mounted `src/components/KeywordStrategy.tsx:435`, `strategy/StrategyRankingsTab.tsx:36`; server `keyword-strategy.ts:615-687` | improved (relocated) | mockup feedback panel below the table with one-click "Add to Strategy" (keywords.js:160-197,418-426); ledger tool row confirms | Coordinate with the Strategy-surface auditor so it isn't double-homed or dropped from both |
| 44 | WebSocket live invalidation: `RANK_TRACKING_UPDATED`, `SERP_SNAPSHOTS_REFRESHED`, `STRATEGY_UPDATED` → React Query invalidation (both-halves contract) | `KeywordHub.tsx:321-341` | at_risk | none visible (prototype is static) | Mandatory data-flow rule; the rebuilt surface must re-register all three handlers |
| 45 | Combined initial view fetch (`/initial` = summary+rows in one round-trip) with per-query fallback on error | `KeywordHub.tsx:222-241`; server `keyword-command-center.ts:103` | preserved | implementation detail; carry into new data wiring | Perf contract, not UI |
| 46 | Tier-locked behavior — Free workspace gets 403 surfaced in error band; brief demands an explicit **locked** state | `KeywordHub.tsx:562-564`; Handoff Brief field 5 ("locked → permissioned state, not a broken empty table") | improved | Handoff Brief state matrix | Rebuild upgrades ad-hoc 403 text into a designed locked state |
| 47 | MCP keyword tooling parity (research_keywords, add_keyword_to_strategy, add_keywords_batch, get_keyword_analysis, replace_keyword_strategy, remove_page_keyword) reads/writes the same store this surface renders | `server/mcp/tools/` (keywords category, CLAUDE.md MCP section) | preserved | server-side; unaffected by UI rebuild | Listed so nobody "simplifies" the write paths the UI no longer exercises |

### G. Prototype-only proposals (need owner sign-off — never build silently)

| # | Proposal | Prototype evidence | Notes |
|---|----------|--------------------|-------|
| N1 | Five-lens view model: Rankings · Opportunities · Pages · Clusters · Lifecycle (sticky LensSwitcher with counts) | keywords.js:215-221,308-314,338; Reference Screen `LensSwitcher` | The core IA upgrade. Lenses are views, not filters — must coexist with, not replace, the status/filter axis (#10/#11) |
| N2 | Lifecycle **stage** taxonomy: discovered → targeted → published → ranking → winning (kanban board) | keywords.js:152-158,298-306 | No HEAD field carries this. HEAD lifecycle = in_strategy/tracked/needs_review/raw_evidence/declined/retired (`shared/types/keyword-command-center.ts:10-17`). "published" requires a content-join. Data ticket + mapping sign-off — stop-and-ask #2 |
| N3 | Pages lens: group keywords by ranking page with avg-rank/opp-traffic stats and an "N terms compete here" cannibalization flag | keywords.js:275-296 | Data exists at HEAD (`cannibalization_issues` table, migrations 088-090; `assignment.pagePath`), but surfaced today in Strategy/Page Intelligence — cross-surface with stop-and-ask #1 |
| N4 | Clusters lens: group by topic cluster | keywords.js:312 | HEAD `topic_clusters` table (migration 089) feeds Strategy today; new read for this surface |
| N5 | Per-row Δ7d change pill + 7-point rank sparkline in the table | keywords.js:226-241,247-254 | HEAD rows have **no per-row change/history source** — explicitly documented (`HubKeywordList.tsx:88-94`). Requires a read-model addition (history join) — data ticket |
| N6 | Intent chips in rows/drawer (commercial/informational/transactional/local) | keywords.js:49-53,249 | Data exists: `metrics.intent` (`shared/types/keyword-command-center.ts:122-126`). NOTE: mockup styles `local` intent **purple** (keywords.js:53) — Four Laws reserve purple for admin-AI; needs a hue decision (stop-and-ask #6) |
| N7 | "Stage into Insights Engine" drawer CTA for discovered/targeted keywords | keywords.js:406-409,424 | Semantics undefined vs HEAD `add_to_strategy` action — same mutation or a new staging flow? Stop-and-ask #5 |
| N8 | "SERP" external-link drawer button | keywords.js:410 | Small additive affordance; no HEAD equivalent |
| N9 | Intent / Stage filter chip buttons in the toolbar | keywords.js:342-343 | Static in mockup; would be new filter dimensions (intent filter has no HEAD server filter) |

---

## 2. Prototype coverage notes

**Demonstrates:** populated state only — unified table, 4-stat summary row, 5 lenses (2 table shapes + 2 grouped shapes + 1 kanban), live search, row → drawer (3 metric tiles, rankings/opportunity/pages sections, stage-aware CTAs), client-feedback panel with a working "Add to Strategy" interaction, local-intent pointer to Local Presence.

**Omits (must still exist per Handoff Brief field 5 + Build Conventions):** empty / loading / error / locked states; pagination; sorting; multi-select & bulk bar; row action menus; add-keyword; all protection/force flows; all WS/live behavior; all flag/tier gating. The Handoff Brief explicitly instructs treating sample data as placeholder and demands all five states — the omissions are mockup scope, but each one above is ledgered so none is lost *by* that scope.

**Reference Screen cross-check:** `Reference Screen - Keywords.html` uses `LensSwitcher`, `FilterChip`, `IntentTag`, `Badge`, `Drawer`; it also contains **no** multi-select/bulk UI (grep 0 hits) — reinforcing stop-and-ask #4.

## 3. Parity Ledger reconciliation

Keyword Hub row (`Platform Parity Ledger.html`): status **improved**, home `keywords.js` → Keywords. All 6 tool rows are marked `present`:

| Ledger tool row | Claimed home | This audit's verdict |
|---|---|---|
| Lifecycle + rank tracking | table + drawer | Partially demonstrated; 7-verb action catalog not visible (#22) |
| National + local rank | rank lenses | National avg rank yes; live-SERP/AI-Overview detail (#33) and per-market local (#34) not demonstrated |
| CurationBulkActionBar | bulk actions | **Claimed but not demonstrated** in mockup or Reference Screen (#20/#21) |
| CurationMeter | review-queue triage | Claimed but not demonstrated (#10) |
| KeywordOpportunities | opportunity scoring | Demonstrated (Opportunities lens) |
| ClientKeywordFeedback | Keywords · feedback panel | Demonstrated (#43) |

**No Gap/Partial rows exist for this surface in the ledger** — so `parityLedgerGaps` is formally empty — but the two "claimed-not-demonstrated" rows above function as unresolved partials and are carried into stop-and-ask.

Related rows touching this surface: Page Intelligence → SEO Editor Research mode (conflicts with keywords.js banner — stop-and-ask #1); AiVisibilityPanel → Brand & AI (#41); LostQueryRecoveryCard → Insights Engine (#36); RankingDistribution → "Keywords / Traffic"; SiteTargetKeywords → "Workspace inputs / Keywords".

## 4. Trade-offs — quick win vs full implementation

| Item | Quick win | Full version | Risk of quick win |
|---|---|---|---|
| Lens model (N1) | Ship Rankings + Opportunities lenses only (both are table reshapes of the existing rows response); keep HEAD segment pills as FilterChips beside the LensSwitcher | All 5 lenses incl. Pages/Clusters grouped reads and the Lifecycle kanban (needs N2 taxonomy + new reads) | 3 of 5 promised lenses missing at launch; toolbar busier than mockup; upgrade path is purely additive |
| Per-row trend (N5) | Reuse existing lazy history fetch + `KeywordSparkline` in the **drawer** only (exactly HEAD behavior) | Extend rows read-model with 7d history + prev-rank so every row renders Δ+sparkline | Table looks flatter than mockup until the read-model lands; no data risk |
| Detail drawer | Port the existing `KeywordDetailDrawer` content wholesale into the system `Drawer` primitive (keeps pin, live SERP, outcome, per-market local, replaced-by), restyled with tokens | Re-compose per mockup's 3-section layout, then re-add the HEAD-only sections as designed modules | Quick win is denser than the mockup; full version risks dropping #28-#36 if sections are "simplified" away — the ledger above is the checklist |
| Bulk operations (#20/#21) | Reuse `KeywordBulkActionBar` + confirm/result flow unchanged under the new table | Design-system `CurationBulkActionBar` per ledger claim | None functionally; visual inconsistency until the DS component exists (which is the right order: extend the system, not the screen) |
| Client feedback panel (#43) | Reuse `ClientKeywordFeedback` component + existing `keyword-feedback` endpoints inside the new surface | Mockup's redesigned rows (tag chips, inline reasons, toast-on-add) | Low; data wiring identical either way |
| Status/filter parity (#10/#11) | Expose all 19 server filters through a single Filters dropdown (HEAD pattern) + lens counts | Owner-approved new filter taxonomy (intent/stage) mapped onto or extending `KEYWORD_COMMAND_CENTER_FILTERS` | Quick win preserves capability but diverges from mockup toolbar; full version needs the stop-and-ask #3 decision first |

## 5. Open questions (stop-and-ask — owner sign-off required)

1. **Which "2→1" is authoritative?** keywords.js banner says Keywords replaces Keyword Hub **· Page Intelligence**; the Parity Ledger routes Page Intelligence to **SEO Editor (Research mode)**; the Handoff Brief U1 says the merge is "keyword-picking + keyword-recommendation screens" (both already consolidated into KeywordHub at HEAD). Decide the canonical merge scope — it determines whether the Pages lens must absorb per-page metrics/recommendations or stay a lightweight grouping.
2. **Lifecycle stage taxonomy (N2):** map discovered/targeted/published/ranking/winning onto HEAD's 6 lifecycle statuses + tracking states, or add a new derived field? "published" needs a content join that doesn't exist on the row today.
3. **Filter taxonomy:** which of the 7 segments + 12 advanced filters survive as filters vs become lenses vs are dropped? Needs Review triage, Retired, Local posture, requested/declined feedback filters currently have no demonstrated home.
4. **Bulk multi-select:** ledger claims `CurationBulkActionBar` is present; neither mockup nor Reference Screen shows any selection UI. Confirm the intended design before building (hard requirement — bulk lifecycle is a headline HEAD capability).
5. **"Stage into Insights Engine" (N7):** same mutation as `add_to_strategy` or a new staging flow? Define the cross-surface contract with the Insights Engine before wiring the CTA.
6. **Purple `local` intent chip (keywords.js:53)** violates the Four Laws (purple = admin-AI only). Confirm replacement hue.
7. **Summary KPI redefinition (#5):** "Avg position", "Winning (top 5)", "worth ~9.6k visits" are new derived numbers. Under the "never change a client-facing number's meaning / UI never computes money" rules, confirm each is produced by the data layer and that the lifecycle counts' loss of KPI placement is intentional.
8. **Per-market local evidence (#34):** does the rebuilt Keywords keep keyword-level per-market pack-rank detail (HEAD behavior, FEATURE_AUDIT.md:87), or does Local Presence absorb it? One of the two must own it explicitly.

---
*Phase 0 read-only audit. No code changed. This file is the only write.*
