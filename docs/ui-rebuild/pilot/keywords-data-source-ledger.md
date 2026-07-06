# Keywords Data-Source Ledger (Pilot definition-of-ready)

**Date:** 2026-07-05 · **Surface:** Keywords (the pilot, `Page 'seo-keywords'`) · **Status:** DRAFT — owner sign-off on §5 decisions + §6 scope before the pilot plan is written.
**Method:** kit intent (keywords.js + Reference Screen + Data-Source Ledger §3 + U1) × HEAD data layer (`KeywordHub.tsx` + KCC services), both mapped by read-only agents with file:line evidence. This is the kit's prescribed "definition-of-ready" — the prop-by-prop wiring map that gates the build.

## Scope (D3, LOCKED)
Page Intelligence → **SEO Editor Research mode**, NOT Keywords (`PHASE_D_DECISIONS.md:12`, "Bounds the Keywords pilot scope"). Two kit docs (keywords.js banner, IA Consolidation Map) say Keywords absorbs Page Intelligence; **D3 overrides both.** The rule for this build: in Keywords, **"Pages" = a lightweight grouping of keywords by ranking page** (avg-rank / opp-traffic / cannibalization *flag*); the per-page optimization score, content-gap authoring, and recommendation authoring are Page Intelligence's job and live in SEO Editor. The `review_page` drawer handoff is **remapped** (→ SEO Editor), not dropped (D8 redirect map). This closes stop-and-ask #1.

---

## 1. Headline: the surface is ~85% buildable on existing data
The KCC read model already serves the hard parts. **EXISTS today:** paginated rows with filter/search/sort + `pageInfo` (`GET .../rows`), the `filters[]` count taxonomy that feeds both the lens switcher and the filter chips, KPI counts (tracked/inStrategy/strikingDistance/local/needsReview/retired), the full detail drawer *including* an outcome read-back the mockup didn't even show, cpc/difficulty/volume/position/clicks/impressions/ctr per row, realized+upside `$` per row (server-computed, display-only), the entire mutation set (single + bulk lifecycle, hard-delete, add, pin, national/local refresh), and the WS-event invalidation contract. The pilot is a **UI + wiring** exercise, not a data-layer project — *provided* the four genuine data-layer gaps in §3 are scoped per the recommendation.

## 2. Region → component → HEAD data ledger
Component stack from `Reference Screen - Keywords.html` (authoritative; U1's DataList/CompactStatBar text is stale). KCC endpoints: `GET /api/webflow/keyword-command-center/:ws/{summary·initial·rows·detail}` (`initial` = summary+page-1 in one call).

| Region | DS component · prop | HEAD source (endpoint → field) | Status |
|---|---|---|---|
| Frame | `AppShell` → `PageContainer` | F4 shell (`RebuiltAppChrome`) | EXISTS (F4) |
| Header | `PageHeader` | static | EXISTS |
| KPI row | `MetricTile` ×N · value | `summary.counts.{tracked,inStrategy,strikingDistance,local,needsReview,retired}` (`keyword-command-center.ts:276-303`) | **EXISTS** |
| KPI row | `MetricTile` · value (avg position) | ✕ only per-row `metrics.currentPosition`; no summary rollup | **BUILD** (§3-c) |
| KPI row | `MetricTile` · value (traffic-value total) | per-row `currentMonthly` exists; workspace total lives in `roi.ts`, not KCC summary | **PARTIAL** (§3-d) |
| KPI row | `MetricTile` · delta | ✕ no period-over-period in summary | **BUILD** (§3-c) |
| Lens bar | `LensSwitcher` · options + counts | `summary.filters[]` → `{id,label,count}` (reconcile lens labels → KCC filter ids) | **EXISTS** |
| Toolbar | `SearchField` · value; sort | `/rows?search=&sort=&direction=` (debounced URL state) | **EXISTS** |
| Toolbar | `FilterChip` ×N · label/count | `summary.filters[].count`, `summary.counts.*` (the 12-filter advanced taxonomy) | **EXISTS** |
| Table | `DataTable` · rows + pageInfo | `GET .../rows?filter&search&sort&page` → `rows[]` + `pageInfo` (skinny model) | **EXISTS** |
| Cell | `IntentTag` · intent | `row.metrics.intent` (raw optional string) → normalize via F3 `INTENT_TONE` | **PARTIAL** (§3-e) |
| Cell | text/`MetricTile` · $ | `row.currentMonthly` / `row.upsideMonthly` (display-only, §4) | **EXISTS** |
| Cell | `Meter` · value (opportunity) | numeric `valueScore` EXISTS server-side (drives `opportunity` sort) but is NOT serialized on the row (transient WeakMap, `row-query.ts:29-31`) | **PARTIAL** (§3-b) |
| Cell | `Sparkline` · data (row trend) | ✕ no rank series on the row; history is a per-keyword lazy fetch `GET /api/rank-tracking/:ws/history` | **BUILD/DEFER** (§3-a) |
| Cell | `Badge`/StatusBadge · lifecycle + provenance | `row.lifecycleStatus`, `row.tracking.{sourceGapKey,strategyOwned}` (three-state) | **EXISTS** |
| Cell | local-visibility column | `row.localSeo` posture (kept in Hub by design, FEATURE_AUDIT #87) | **EXISTS** |
| Row select | `Checkbox` (multi, indeterminate) + bulk bar | server bulk EXISTS: `useKeywordCommandCenterBulkAction` → `POST .../actions/bulk` (5 of 7 verbs) | **EXISTS** (mockup omits UI — §5) |
| Drawer | `Drawer` · title/subtitle | `GET .../detail?keyword=` → `detail.row` (FULL model), lazy on open | **EXISTS** |
| Drawer | `MetricTile` ×3 · rank/opp/difficulty | `row.metrics.{currentPosition,volume,ctr,difficulty}` | **EXISTS** |
| Drawer | `DefinitionList` · rankings/origin/pages | `row.tracking.*`, `row.sourceLabels[]`, `row.assignment` | **EXISTS** |
| Drawer | `Sparkline` (drawer trend) | `GET /api/rank-tracking/:ws/history?query=` (already works, gated on `tracking.status !== 'not_tracked'`) | **EXISTS** |
| Drawer | outcome read-back chip | `detail.outcome` → `OutcomeReadback` (bonus — mockup didn't show it) | **EXISTS** |
| Drawer | Live SERP / AI-Overview (P6) | `row.metrics.{nationalPosition,serpFeatures,aiOverviewPresent,aiOverviewCited}` (flag `national-serp-tracking`) | **EXISTS** (flag-gated) |
| Drawer | local per-market breakdown | `row.localSeo.markets[]`, `.topCompetitors` (full model only) | **EXISTS** |
| Drawer | lifecycle action menu (7 verbs) + hard-delete + protection | `POST .../actions`, `DELETE .../keywords/:kw`, protection gating mirrors server | **EXISTS** |
| Feedback panel | `SectionCard` + `Badge` + inline "Add to Strategy" | `row.feedback.{status,reason}`; relocated from Strategy | **EXISTS** |
| Pages/Clusters lens | `GroupBlock` (group + stats + cannibalization flag) | `topic_clusters` / `cannibalization_issues` tables (keyword-analytics, in scope); NO per-page authoring (D3) | **PARTIAL** (grouping read) |
| Lifecycle lens | `BoardColumn` ×5 (discovered→…→winning) | ✕ no HEAD field carries this stage taxonomy ("published" needs a content-join) | **BUILD/DEFER** (§5 N2) |

## 3. Platform build backlog + build-vs-defer recommendation
The four data-layer items and how I'd sequence each so the pilot stays a UI/wiring validation:

- **(a) Row sparkline / Δ-trend column (N5)** — rank history exists *per-keyword* (`/history`) but isn't batched for a list; inline sparklines would N+1. **RECOMMEND: DEFER.** Ship the list **without** an inline sparkline column; the trend sparkline **stays in the drawer** (where it already works). Inline list sparklines become a fast-follow behind a new batched `history-by-keyword` read model. Ledger `DEF-kw-*`.
- **(b) Opportunity score as a `Meter`** — numeric `valueScore` exists server-side but isn't serialized. **RECOMMEND: DO IT (small).** Add `opportunityScore` to the serialized skinny `KeywordCommandCenterRow` (one field; the Opportunities lens needs it). A bounded data-layer task inside the pilot, not a deferral.
- **(c) Summary deltas + avg-position rollup (KPI variants)** — genuinely new server computation (snapshot diffing + rollup). **RECOMMEND: DEFER the KPI variants that need them.** Ship the KPI tiles that map to existing counts (+ opportunity); the mockup's "Avg position" and "Δ vs last period" tiles are ledgered fast-follows. No fabricated numbers (Four-Laws/attribution-honesty).
- **(d) Traffic-value total** — exists in `roi.ts`, not KCC summary. **RECOMMEND: wire it (PARTIAL).** Thread the existing roi rollup into the summary response, or render the tile from the roi hook the surface already can call. Bounded wiring, no new computation.

Net: **one small serialization add (b) + one wiring (d) inside the pilot; two defers (a, c) ledgered.** The surface ships whole minus inline-list-sparklines and two KPI variants — both honestly deferred, neither faked.

## 4. Parity spine to preserve (non-negotiable, additive mandate)
- **Mutations:** single + bulk lifecycle (`POST .../actions`, `.../actions/bulk`), hard-delete (`DELETE`, MANUAL/unpinned/no-provenance only), add (`POST /api/rank-tracking/:ws/keywords`), pin (`PATCH …/pin`), national refresh (flag+tier+budget gated bg job), local check. Protection model (`isProtected`/force-confirm) mirrors server — keep it.
- **WS invalidation (both halves):** re-register `useWorkspaceEvents` for `RANK_TRACKING_UPDATED`, `SERP_SNAPSHOTS_REFRESHED`, `STRATEGY_UPDATED`, each invalidating `queryKeys.admin.keywordCommandCenter(ws)`. Static prototype registers none — a rebuilt surface that skips this silently regresses live updates.
- **Display-only money/score:** `currentMonthly`/`upsideMonthly` from `keywordDollarValue` (`server/scoring/keyword-value-money.ts` — sole producer); `valueScore`/`positionColor` via `ui/constants`. The UI **renders, never computes** these (hard floor T3). Handle "no cpc → no $" as an empty state, never `$0`.
- **Trust signals:** truncation honesty banner (`rawEvidenceTotal` vs returned), metric-window disclosure label, provenance badges. These are why clients trust the surface — preserve them.
- **Deep-link two-halves:** the `?tab=`/`?q=` receiver + the 5 cross-surface senders (Strategy/issue) must be remapped in the same PR (route-removal checklist).

## 5. Owner decisions
| # | Decision | Recommendation |
|---|---|---|
| N2 | Lifecycle **Kanban lens** (discovered→targeted→published→ranking→winning) — no HEAD field carries this taxonomy; "published" needs a content-join | **BUILD NOW (owner 2026-07-05).** Via a new server-**derived** `lifecycleStage` field — a bounded computation over existing data, NOT net-new collection: discovered=raw-evidence/not-in-strategy · targeted=in-strategy+page-assigned+not-published · published=assigned page has published content *(the one content-join, via content-pipeline data)* · ranking=has GSC position · winning=position ≤ top-3. Serialize onto the skinny row (feeds the `BoardColumn` lens). Honest (derived, not faked). This is the pilot's largest data task. |
| N6 | Mockup styles the `local` intent chip **purple** (Four-Laws violation) | **Auto-resolved:** use F3 `IntentTag`'s canonical `INTENT_TONE` map (never purple) instead of the mockup's color. Just confirm. |
| #4 | Bulk multi-select — parity ledger claims it, mockup shows nothing | **Not really open — PRESERVE it.** The server + hook exist (`POST .../actions/bulk`); it's a live HEAD capability the mockup omits. Build DataTable multi-select + a bulk action bar (additive-parity). |
| Scope §3 | The build-vs-defer split (a-d above) | Confirm: serialize opportunityScore + wire traffic-value in-pilot; defer inline sparklines + avg-pos/delta KPIs. |

## 6. Recommended pilot scope (what ships in the pilot PR)
**Decisions ratified (owner 2026-07-05):** Lifecycle lens = BUILD NOW (derived `lifecycleStage`); build-vs-defer split = APPROVED; bulk = PRESERVE; `local` intent hue = F3 `INTENT_TONE` (auto).
**IN:** AppShell/PageContainer frame (F4) → PageHeader → KPI tiles (existing counts + opportunity) → LensSwitcher (**5 lenses:** Rankings/Opportunities/Pages/Clusters/**Lifecycle**) → Toolbar (SearchField + FilterChips) → DataTable (rows/filter/search/sort/pagination, multi-select + bulk bar, IntentTag/Meter/Badge cells, **no inline sparkline**) → **BoardColumn Lifecycle Kanban** (backed by the derived `lifecycleStage`) → Drawer (full detail incl. drawer sparkline, outcome, live-SERP, local, 7-verb actions, hard-delete, protection) → feedback panel → all mutations + WS invalidation + display-only money → all four states (empty/loading/error/locked) → deep-link receiver+senders remapped. **Data-layer tasks (in-pilot):** serialize `opportunityScore`, wire traffic-value total, **build the derived `lifecycleStage` field + content-published join**.
**LEDGERED FAST-FOLLOWS:** inline-list sparkline (needs batched history read model), Avg-position + Δ KPI tiles (need rollup/snapshot-diff).
**OUT (D3):** all per-page authoring/scoring (→ SEO Editor).

---
*Sources: `docs/ui-rebuild/phase0/surfaces/keywords.md`, `PHASE_D_DECISIONS.md:12`, kit `keywords.js` / `Reference Screen - Keywords.html` / `Data-Source Ledger.html` §3 / U1, and HEAD `KeywordHub.tsx` + `keyword-command-center/*` services + `keyword-value-money.ts` + `ws-events.ts` (file:line in the source agent transcripts).*
