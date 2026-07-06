# UI Rebuild Pilot — Keywords Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **This is the golden-path pilot — deliberately SEQUENTIAL, one team (NOT parallel lanes). Its job is to shake out the conventions + prove the CI gates on ONE real surface before the fan-out.**

**Goal:** Rebuild the Keywords surface (`Page 'seo-keywords'`) as a DS-native, `@ds-rebuilt` surface composed from the F3 primitives inside the F4 shell — additive-parity with today's Keyword Hub, flag-gated, validating the whole kit end-to-end.

**Architecture:** The surface reads the existing KCC endpoints (`GET /api/webflow/keyword-command-center/:ws/{initial·rows·detail}` + `/api/rank-tracking/*`), composes F3 primitives (DataTable, LensSwitcher, MetricTile, Meter, IntentTag, FilterChip, Drawer, GroupBlock, BoardColumn, SearchField, Toolbar) inside F4's `RebuiltAppChrome`, and preserves every capability in the parity ledger. Three bounded server tasks add derived fields the rebuilt UI needs. Gated on `ui-rebuild-shell` (F4) — OFF = today's `KeywordHub` unchanged.

**Authority docs (read first, do not re-derive):**
- [keywords-data-source-ledger.md](../../ui-rebuild/pilot/keywords-data-source-ledger.md) — the prop-by-prop wiring map + ratified scope. **This is the contract.**
- [surfaces/keywords.md](../../ui-rebuild/phase0/surfaces/keywords.md) — the ~24 at-risk capabilities = the DoD checklist.
- [PHASE_D_DECISIONS.md](../../ui-rebuild/phase0/PHASE_D_DECISIONS.md) — D3 bounds scope (Page Intelligence OUT → SEO Editor).
- kit `Reference Screen - Keywords.html` (component stack, authoritative), `keywords.js` (IA/layout), U1 in the Handoff Brief (9-field template).

**Tech Stack:** React 19 + TS strict, React Query, existing KCC services (`server/domains/keyword-command-center/*`), F3/F4 primitives, tokens, FA Sharp icons (D5).

**Platform/Model:** Claude/Anthropic — **Opus**, single-author, sequential.

---

## Pre-requisites (MUST be true before this plan executes)
1. **F4 merged to staging.** This surface mounts inside `RebuiltAppChrome` + reads `useRebuildShellEnabled()`. ⚠ **RECONCILE against the as-built F4 API** — the mount contract below is written against F4's *planned* exports; before Task 4.x, `grep` the merged `src/components/layout/RebuiltAppChrome.tsx` + the `ui-rebuild-shell` flag and correct any drift.
2. **🚫 BLOCKING — the F2b gates PR must merge FIRST.** F2b (`docs/superpowers/plans/2026-07-05-ui-rebuild-f2b-gates.md`) ships the two CI-native gates this pilot's DoD uses: **`verify:bundle-budget`** and **`vitest-axe`** (`expectNoA11yViolations`). Both are absent from `package.json` today. `lint:ds-adherence` was retired (redundant — tsc + the F2a `ds-*` rules cover it). Automated **visual** regression is NOT an F2b gate — this pilot builds it (Task 8.6, Playwright Component Testing) and is its first proving ground. Until F2b merges, `verify:bundle-budget` / `vitest-axe` don't exist; sequence F2b → pilot.
3. Branch off staging: `ui-rebuild-pilot-keywords`. Standard rules: `git status`/branch check before writes; stage explicitly; controller commits; new files carry `// @ds-rebuilt`.

## Scope (ratified — [ledger §5-6](../../ui-rebuild/pilot/keywords-data-source-ledger.md))
**IN:** 5 lenses (Rankings/Opportunities/Pages/Clusters/**Lifecycle**), DataTable w/ multi-select + bulk bar, BoardColumn Kanban, full detail Drawer, all mutations + WS invalidation + display-only money, all four states, deep-link receiver+senders remapped. **Data tasks:** serialize `opportunityScore`, wire traffic-value total, build derived `lifecycleStage`.
**DEFER (ledgered):** inline-list sparkline (drawer sparkline stays), avg-position/Δ KPI tiles.
**OUT (D3):** all per-page authoring/scoring → SEO Editor. In Keywords, "Pages" = lightweight keyword grouping only.

## Task dependency graph
```
Task 1-3  Server: opportunityScore · traffic-value · lifecycleStage   (data-layer first — the UI consumes these)
  → Task 4  Surface scaffold: flag-gated mount in RebuiltAppChrome, URL/lens/filter state
  → Task 5  DataTable + cells + multi-select/bulk
  → Task 6  The 5 lenses (Rankings/Opportunities/Pages/Clusters/Lifecycle)
  → Task 7  Detail Drawer (all regions)
  → Task 8  Mutations + WS invalidation + 4 states + deep-links + gate-seeding
  → Task 9  DoD walk (24 capabilities) + review + full gates + PR
```

## File ownership
- Server: `server/domains/keyword-command-center/{read-model,row-query,rows-service,detail-service}.ts`, `shared/types/keyword-command-center.ts`, a new `server/scoring/keyword-lifecycle-stage.ts`, contract tests.
- Client: new `src/components/keywords-rebuilt/` (the rebuilt surface — keep separate from legacy `KeywordHub.tsx`, which stays untouched until the flag flips), its hooks reuse `src/hooks/admin/useKeywordCommandCenter.ts`.
- **Do NOT modify** `KeywordHub.tsx` or the legacy `keyword-hub/`/`keyword-command-center/` components — the flag switches between old and new at the mount point.

---

### Task 1 — Server: serialize `opportunityScore` onto the row

**Files:** `shared/types/keyword-command-center.ts`, `server/domains/keyword-command-center/row-query.ts`, contract test

The numeric `valueScore` exists server-side (drives the `opportunity` sort) but lives in a transient WeakMap (`row-query.ts:29-31`) and isn't serialized. The Opportunities lens `Meter` needs it.

- [ ] **1.1** Add `opportunityScore?: number /** 0-100, server-computed; display-only. */` to `KeywordCommandCenterRow` (`shared/types/keyword-command-center.ts:228-274`).
- [ ] **1.2** In **`read-model.ts:414`** (`finalizeDraftRow` — NOT `row-query.ts`), where `score` is already the local passed to `setKeywordCommandCenterRowValueScore(finalized, score)`, add `finalized.opportunityScore = score;`. **RETAIN the existing WeakMap `.set()` — do NOT replace it** (the `opportunity` sort accessor at `row-query.ts:56` reads the WeakMap; removing it silently breaks opportunity-sort). `computeKeywordValueScore` already returns 0-100 (`keyword-value-score.ts:226`) — assign verbatim, **no normalization** (double-normalizing would corrupt it). `stripRowForList` spreads `...row`, so the new property survives the skinny strip; the detail path also runs `finalizeDraftRow`, so the drawer gets it free.
- [ ] **1.3** Contract test (`tests/contract/`): a row with a known `valueScore` serializes `opportunityScore`; a row without one omits it (optional). Assert it appears in the `/rows` response shape.
- [ ] **1.4** `npm run typecheck && npx vitest run <the contract test>`. Commit.

### Task 2 — Server: wire the traffic-value total into the summary

**Files:** `server/domains/keyword-command-center/{summary-service}.ts`, `shared/types/keyword-command-center.ts`, contract test

Per-row `currentMonthly` exists; the workspace total is `ROIData.organicTrafficValue` (`server/roi.ts:111,368`). **Trap (review):** the only producer, `computeROI(workspaceId)`, is heavy AND calls `saveSnapshot()` — it INSERTs a `roi_snapshots` row on every invocation (`roi.ts:383`). Calling it from a hot skinny read endpoint would write DB rows on every page load. Do NOT thread `computeROI` into the summary service.

- [ ] **2.1** **Preferred: render the KPI tile client-side** from the existing roi hook the surface can already call (ledger §3-d) — the traffic-value `MetricTile` reads `useRoi(workspaceId).organicTrafficValue` in `KeywordsSurface`, no server change. If a server field is genuinely needed, instead extract a **snapshot-free** `organicTrafficValue`-only helper from `roi.ts` (no `saveSnapshot`) and call that — never `computeROI`. Decide at execution; default to client-side.
- [ ] **2.2** Test the chosen path: client-side → component test the tile renders from the roi hook (handles the `null`/no-page-keywords case as an empty state, not `$0`); server helper → contract test the helper returns `organicTrafficValue` with no snapshot write.
- [ ] **2.3** Gates + commit.

### Task 3 — Server: derived `lifecycleStage` field + content-published join

**Files:** new `server/scoring/keyword-lifecycle-stage.ts`, `server/domains/keyword-command-center/read-model.ts`, `shared/types/keyword-command-center.ts`, contract test

The Lifecycle Kanban lens needs a 5-stage field. It is **derived** (not collected) from existing data + one content-join.

- [ ] **3.1** Add `lifecycleStage?: 'discovered' | 'targeted' | 'published' | 'ranking' | 'winning'` to `KeywordCommandCenterRow` (a shared const union — import both sides, never string literals).
- [ ] **3.2** Create `server/scoring/keyword-lifecycle-stage.ts` exporting `deriveLifecycleStage(row, publishedPagePaths: Set<string>): LifecycleStage`. Logic (read the actual field names from `keyword-command-center.ts` — do not guess):
```
winning:   metrics.currentPosition != null && currentPosition <= 3
ranking:   metrics.currentPosition != null && currentPosition <= 20   (and not winning)
published: tracking.pagePath && publishedPagePaths.has(normalize(tracking.pagePath))   (assigned page has published content)
targeted:  tracking.status is ACTIVE / in-strategy (source) && page assigned but not published
discovered: everything else (raw-evidence / not-in-strategy)
```
Evaluate top-down (first match wins). Winning/ranking take priority over published/targeted — a keyword that ranks IS ranking regardless of content state (the board shows where it actually is). **⚠ Address-space normalization (review):** published paths come from post `published_slug` (normalized via `normalizePageUrl`, `roi.ts:282`); the row exposes `tracking.pagePath`. **Both sides MUST be normalized to the same page-address form before `.has()`** — else "published" silently under-populates (keywords fall through to targeted/discovered, a fabricated-looking board). Use the canonical page-address helper.
- [ ] **3.3** **Build a published-paths read — no reusable helper exists** (review: no `getPublishedPagePaths`; `listPosts(ws)` returns full `GeneratedPost[]` with bodies). Add a lightweight projection returning `Set<normalizedPath>` of posts with `publishedAt || webflowItemId`, from `published_slug`, normalized. Build once per workspace in `read-model.ts populateDraftRows` (the bundle carries `workspaceId`), then call `deriveLifecycleStage(row, publishedPaths)` per row — no N+1. This IS a new query; the ledger's "reuse, don't add" was wrong here.
- [ ] **3.4** Unit test `keyword-lifecycle-stage.test.ts`: a table of (row fixture, publishedPaths) → expected stage, covering all 5 stages + the priority ordering (a ranking keyword on an unpublished page → `ranking`, not `targeted`).
- [ ] **3.5** Contract test: `/rows` serializes `lifecycleStage`. Gates + commit.

### Task 4 — Surface scaffold: flag-gated mount + URL/lens/filter state

**Files:** new `src/components/keywords-rebuilt/KeywordsSurface.tsx` + `useKeywordsSurfaceState.ts`, mount edit at the Keywords route

- [ ] **4.1** ⚠ **Reconcile F4 first (verified at HEAD 86e2d0c2a):** `RebuiltAppChrome` is a **COMPLETE app frame** — it renders its own `AppShell` + `RebuiltSidebar` + topbar + breadcrumb + `PageContainer`, and requires **11 props**: `workspaces, selected, tab, theme, pendingContentRequests, onCreate, onDelete, onLinkSite, onUnlinkSite, toggleTheme, onLogout` + `children`. `useRebuildShellEnabled()` reads `ui-rebuild-shell`. Re-grep the merged file to confirm before 4.2.
- [ ] **4.2** **Mount at the OUTER layout, NOT the inner content switch** (the review's blocking finding — mounting inside the legacy `<Sidebar>+<main>` produces a shell-in-shell). In `App.tsx`, branch at the layout root (~`App.tsx:460`, the `<div className="flex h-screen">` that wraps `<Sidebar>` + `<main>`): `useRebuildShellEnabled()` ON **and** `tab === 'seo-keywords'** → return `<RebuiltAppChrome {...the 11 props already passed to <Sidebar> at App.tsx:462-476}><KeywordsSurface workspaceId={selected.id}/></RebuiltAppChrome>` (replacing the entire legacy `<Sidebar>+<main>` block); otherwise → today's layout unchanged. Read the flag once at top level of the component (`feedback_mocked_hook_hides_rules_of_hooks`). This is a **structural top-level branch**, not a minimal inner conditional — but flag-OFF (or any non-Keywords tab) still renders the legacy shell byte-identical because the branch only diverts when BOTH the flag is ON and the tab is Keywords. The 11 props already exist at the outer scope, so threading is a copy of the existing `<Sidebar>` prop set.
- [ ] **4.3** `useKeywordsSurfaceState.ts`: the `?tab=`/`?q=`/lens/filter/search/sort/page URL state (the two-halves deep-link contract — receiver reads `useSearchParams`; preserve the 7-segment receiver + `?q=` opens-drawer-on-mount per parity #2/#3). Debounced search. Reuse `hubSortToKccSort` mapping semantics.
- [ ] **4.4** Component test: the surface mounts inside a flag-ON transition without throwing (real flag query loading→loaded, per `OverviewTab.flagTransition.test.tsx`); a `?tab=` deep link selects the right lens. Gates + commit.

### Task 5 — DataTable + cells + multi-select/bulk

**Files:** `src/components/keywords-rebuilt/KeywordsTable.tsx`, tests

- [ ] **5.1** Compose F3 `DataTable` reading `useKeywordCommandCenterRows` (reuse the existing hook). Columns per the ledger: keyword, IntentTag (via F3 `INTENT_TONE` — never the mockup's purple `local`), rank/position, opportunity `Meter` (the new `opportunityScore`), `$` (currentMonthly, display-only, "no cpc → no $" empty state not `$0`), lifecycle/provenance `Badge`s (StatusBadge + "From gap" + "Auto-managed" three-state). **No inline sparkline** (deferred). Keyboard-accessible rows (F3 DataTable already provides this). Row → opens Drawer.
- [ ] **5.2** Multi-select: F3 DataTable selection via `useToggleSet` (never hand-rolled). A `Toolbar`-based bulk action bar appears on selection → the 5 bulk verbs via `useKeywordCommandCenterBulkAction` (`POST .../actions/bulk`). Preserve protection gating (protected keywords need force-confirm).
- [ ] **5.3** Pagination from `pageInfo`; truncation-honesty banner (parity #8 — `rawEvidenceTotal` vs returned) and the metric-window disclosure label (parity #9) — both are trust signals, preserve them.
- [ ] **5.4** Tests: rows render + sort + paginate; multi-select → bulk bar → bulk action fires; protected keyword gates to confirm; money empty-state (no `$0`). Gates + commit.

### Task 6 — The 5 lenses

**Files:** `src/components/keywords-rebuilt/KeywordsLenses.tsx` (+ lens sub-views), tests

- [ ] **6.1** F3 `LensSwitcher` with 5 options from `summary.filters[]` mapped to lenses (reconcile lens labels → KCC filter ids; counts from `summary.filters[].count`). URL-synced (Task 4.3).
- [ ] **6.2** **Rankings** (default): the DataTable (Task 5) sorted by position. **Opportunities**: same table sorted by `opportunityScore`, the `Meter` column prominent. Both are DataTable configs, not new tables.
- [ ] **6.3** **Pages** + **Clusters**: F3 `GroupBlock` per group (ranking page / topic cluster), each header showing avg-rank + opp-traffic + a cannibalization *flag* (from `topic_clusters`/`cannibalization_issues` — read the tables; **grouping only, NO per-page authoring** per D3). Child rows are the keyword rows.
- [ ] **6.4** **Lifecycle**: F3 `BoardColumn` ×5 (discovered→targeted→published→ranking→winning) grouping rows by the new `lifecycleStage`. Presentational board (no drag-drop — that's not a HEAD capability); card → opens Drawer.
- [ ] **6.5** Tests: each lens renders its shape; lens switch updates URL + re-groups; Lifecycle board buckets rows by stage. Gates + commit.

### Task 7 — Detail Drawer

**Files:** `src/components/keywords-rebuilt/KeywordDrawer.tsx`, tests

Compose F3 `Drawer`. Read `useKeywordCommandCenterDetail` (full model) + the lazy rank-history query (drawer sparkline — this one STAYS, it already works). Regions per the ledger + parity #28-40 (read `KeywordDetailDrawer.tsx` for the exact fields — do not guess):

- [ ] **7.1** Header (lifecycle/protection/lost-visibility badges) · Origin (sourceLabels) · rank/opp/difficulty `MetricTile`s · **outcome read-back chip** (`detail.outcome`) · Revenue Potential (currentMonthly/upsideMonthly, display-only) · valueReasons ("why this score") · Tracking state + pin · National rank + Live SERP (flag `national-serp-tracking`) + the drawer `Sparkline` (from `/history`) · local per-market breakdown · replaced-by chain · feedback · Safe Next Actions footer.
- [ ] **7.2** The 7-verb lifecycle action menu (`useKeywordCommandCenterAction`) + hard-delete (`useKeywordHardDelete`, MANUAL/unpinned/no-provenance eligibility, red reserved) + pin toggle + national/local refresh triggers (with their tier/flag/budget gates preserved). The `review_page` handoff **remaps to SEO Editor** (D3/D8 redirect), `generate_brief` → content-pipeline.
- [ ] **7.3** Drawer a11y from F3 `Drawer` (focus trap/restore/Escape — do not hand-roll). Tests: opens on row-click + on `?q=` mount; renders detail incl. outcome; an action fires + shows feedback; hard-delete eligibility gating. Gates + commit.

### Task 8 — Mutations, WS invalidation, states, deep-links, gate-seeding

- [ ] **8.1** Verify every mutation (Tasks 5/7) uses the shared `keywordMutationInvalidationKeys` invalidation and shows success/failure via the existing `useToast` (the canonical primitive — DEF-foundation-004 restyle happens here per its trigger; do the tokens-only Toast restyle now).
- [ ] **8.2** WS invalidation: `useWorkspaceEvents(ws, …)` for `RANK_TRACKING_UPDATED`, `SERP_SNAPSHOTS_REFRESHED`, `STRATEGY_UPDATED`, each invalidating `queryKeys.admin.keywordCommandCenter(ws)`. (Both halves — the server already broadcasts.) Test: a simulated event invalidates the cache.
- [ ] **8.3** The four states (Build Conventions): empty (`EmptyState` — "connect a source / run initial strategy"), loading (`Skeleton` rows + stat shimmer, never zeros), error (inline retry, table preserved if stale), **locked** (plan-without-keyword-access → permissioned state, not a broken empty table). Each must be reachable + tested.
- [ ] **8.4** Deep-link contract — **DEFAULT: preserve the existing `?tab=<HubSegment>`/`?q=` ids** (`buildHubDeepLinkQuery`, `src/lib/keywordHubDeepLink.ts`; receiver `KeywordHub.tsx:185-196`). If the rebuilt receiver (Task 4.3) honors the SAME segment ids, the **12+ existing senders need ZERO edits** (review found ~10 files / 12+ call sites — `KeywordStrategy`, `PageIntelligence`, `WorkspaceHome`, `RankingsSnapshot`, `MeetingBriefPage`, `KeywordOpportunities`, `StrategyRankingsTab`, `RankingDistribution`, `KeywordGaps`, `SiteTargetKeywords`, `KeywordTargetsLens`, `strategyNextActionTarget` — NOT the 5 the plan first claimed). Only if ids genuinely change: repoint ALL 12+ in the same PR (route-removal checklist). Extract `hubSortToKccSort` (currently module-private in the do-not-touch `KeywordHub.tsx:92`) into a shared util so both surfaces consume one mapping (CLAUDE.md UI/UX #9 — don't re-implement). Test the two-halves contract.
- [ ] **8.5** Gate-seeding: (a) a11y — call `expectNoA11yViolations` (F2b's `vitest-axe` helper, `tests/component/a11y.ts`) on the KeywordsSurface + Drawer + each lens render in their component tests; fix any real violation. (b) bundle — `npx vite build --manifest && npm run verify:bundle-budget --update` to add the Keywords chunk's baseline entry; commit it. Commit.

- [ ] **8.6** **Visual regression (Playwright Component Testing — the pilot introduces + proves this gate for the whole rebuild).** This is the automated appearance check that green code-gates can't do (Phase 0 found 14 blockers that passed all technical gates, incl. theme/state breakage). Component-isolated (deterministic, no deploy/secrets — unlike the dormant `playwright.visual.config.ts` full-page-vs-staging suite).
  - Add `@playwright/experimental-ct-react` (devDep) + `playwright-ct.config.ts` (component-test mode; reuses the vite config for resolution). Read the Playwright CT docs for the `mount` fixture.
  - Write `tests/ct/keywords-surface.matrix.spec.tsx`: mount `KeywordsSurface` (or its state-variant sub-renders) with **fixture data** for each of the 5 states (empty/loading/error/locked/populated) × 2 themes (toggle `.dashboard-light` on the mount root), `await expect(component).toHaveScreenshot(\`keywords-\${state}-\${theme}.png\`)`. ~10 cells. Fixture data must be static (no live KCC calls — mock the hooks) so diffs are deterministic.
  - Capture baselines locally (`--update-snapshots`), commit them under the CT snapshot dir.
  - Wire a `test:ct` script + a CI step in the `quality` or e2e job (`npx playwright test -c playwright-ct.config.ts`); it runs in CI without a deploy (CT renders in a bundled browser). Add its governance classification if it's a `verify:*`; if it's a `test:*` script, note it in the e2e/visual CI doc.
  - This is the template Phase A copies per surface. Commit.

### Task 9 — DoD walk + review + gates + PR

- [ ] **9.1** **Ledger-as-DoD:** walk every row in `surfaces/keywords.md` — mark each preserved / improved / new / ledgered-deferral. The ~24 at-risk capabilities must each resolve. Any that can't → stop-and-ask, don't drop. This is the additive-parity gate.
- [ ] **9.2** `superpowers:requesting-code-review` (single-surface). Fix Critical/Important; deferrals → ledger (`DEF-kw-*` for the inline sparkline + avg-pos/Δ KPI tiles).
- [ ] **9.3** Full gates, sequential: `npm run typecheck && npx vite build --manifest && npm run verify:bundle-budget && npx tsx scripts/pr-check.ts && npm run lint:hooks && npm run verify:feature-flags && npm run verify:deferred-ledger && npm run verify:coverage-ratchet && npx vitest run && npx playwright test -c playwright-ct.config.ts` (FULL suite — the KCC contract tests + nav/tab-deep-link tests must stay green; `vitest run` includes the `vitest-axe` `expectNoA11yViolations` assertions; the CT run is the visual-regression gate). **No `lint:ds-adherence`** — retired (F2b D-F2b-1).
- [ ] **9.4** **Flag-ON real-browser smoke** (`preview_*`, the mandate that catches what gates can't): configure a workspace with keyword data, flip `ui-rebuild-shell` ON, walk all 5 lenses, open the drawer, run a lifecycle action + a bulk action, verify live update on a mutation, check all four states + both themes, confirm money renders from the data layer (no client math). With flag OFF, confirm the legacy `KeywordHub` is unchanged.
- [ ] **9.5** PR to `staging`: "UI Rebuild Pilot — Keywords surface (flag-gated)". Body: the DoD walk result (24 capabilities), the 3 data-layer fields added, the 2 ledgered defers, F2b gates seeded, D3 scope note. Verify CI actually ran.

---

## Cross-phase contracts (Pilot → Fan-out A)
- This surface is the **template** every fan-out surface copies: flag-gated mount in `RebuiltAppChrome`, ledger-as-DoD, the F2b gate set, the data-source-ledger-first discipline.
- The 3 new server fields (`opportunityScore`, `trafficValueMonthly`, `lifecycleStage`) are additive to the KCC contract — other surfaces may read them.
- F2b gates, proven here, become mandatory for all Phase A surfaces.

## Systemic improvements
- First real exercise of F3 primitives + F4 shell together on a stateful surface — any primitive gap found gets fixed in `ui/` (system addition, not a local fork) + regression-tested.
- The `lifecycleStage` derivation is reusable by Strategy/Insights surfaces later.

## Risks
- **Pilot scope creep** → the ledger's IN/DEFER/OUT is the fence; deferrals are ledgered, not silently dropped; D3 keeps Page Intelligence out.
- **F4 API drift** → Task 4.1 reconciliation is mandatory before mount code.
- **Legacy-surface regression** → the flag+tab branch is a **structural top-level swap** in `App.tsx` (Task 4.2, the review's blocking fix — NOT a minimal inner conditional); `KeywordHub.tsx` and `Sidebar.tsx` are never edited; the branch only diverts when the flag is ON *and* the tab is Keywords, so flag-OFF / any other tab renders the legacy shell byte-identical (DoD gate 9.4).
- **Fabricated numbers** → `lifecycleStage` is derived+tested, money is display-only; no client-side computation (hard floor).

## Definition of done
- [ ] 3 server fields shipped + contract-tested (opportunityScore, trafficValueMonthly, lifecycleStage)
- [ ] Surface composed from F3/F4 primitives, `@ds-rebuilt`, tokens-only, both themes, flag-gated (OFF = legacy unchanged)
- [ ] All 5 lenses + DataTable (multi-select/bulk) + BoardColumn + full Drawer + feedback panel
- [ ] All mutations + WS invalidation + 4 states + deep-link two-halves (receiver + 5 senders)
- [ ] **Ledger-as-DoD:** all ~24 at-risk capabilities resolved (preserved/improved/new/ledgered); no silent drops
- [ ] Deferrals ledgered (inline sparkline, avg-pos/Δ KPIs); F2b gates green (`verify:bundle-budget` baseline entry + `expectNoA11yViolations` on the surface)
- [ ] **Visual-regression gate built + proven** (Task 8.6): Playwright Component Testing set up, Keywords 5-states × 2-themes snapshots committed + green in CI — the template Phase A reuses
- [ ] requesting-code-review done; all gates green; flag-ON browser smoke passed; PR to `staging` with CI that ran
