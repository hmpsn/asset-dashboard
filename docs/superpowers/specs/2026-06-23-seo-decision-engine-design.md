# SEO Decision Engine — Program Design

- **Date:** 2026-06-23
- **Owner:** Josh (hmpsn.studio)
- **Status:** Approved (brainstorm) → pending spec review → pre-plan-audit → writing-plans (per phase)
- **Source:** 15-agent SEO feature audit (2026-06-23, against `origin/staging` HEAD `1bcb48fca`). Overall grade **C** — *"A-grade architecture wired to a C-grade decision surface."*
- **Baseline worktree:** `../asset-dashboard-seo-audit` (detached `origin/staging`); all `file:line` refs below are at that SHA.

## Thesis

The platform collects more SEO data than it uses, defaults non-US clients to the US/English SERP, and runs an AEO program it can't measure. This program closes the data→decision gap in three groups: **flip the loops already built** (Group A), **fix correctness + add a cost-governed foundation** (Group B), then **add the paid capabilities** the platform's goals require (Group C). 8 moves → 8 phases, one PR per phase, staging-first.

## Non-goals (deferred to roadmap, not this program)

- Revenue grounding: replacing the CPC proxy in EMV with GA4 `estimatedRevenue` / Stripe conversion value. (Its own brainstorm; a cross-cutting blind spot, not bolted into P2.)
- Lower-leverage unused endpoint classes: historical/seasonality (`google_trends`, `historical_keyword_data`), link-gap/intersection (`domain_intersection`, `page_intersection`, `backlinks/competitors`, `backlinks/anchors`, `bulk_spam_score`, new/lost link monitoring), content-analysis sentiment (`content_analysis/*`), `on_page/lighthouse` (CWV already via PageSpeed), `bulk_traffic_estimation`, `search_intent` labs, `keyword_overview`, `serp_competitors`, share-of-voice scoring, competitor momentum trend.

All deferreds are tracked in `data/roadmap.json` under sprint `sprint-seo-decision-engine-2026-06-23` (status `deferred`).

---

## Phase map

| Phase | Move | Goal | Flag | Cost | Depends on |
|---|---|---|---|---|---|
| **P1** | #1 | Value-first keyword scoring live; crude Hub-sort path deleted | retires `keyword-value-scoring` | none | — |
| **P2** | #4 | EMV calibration loop closed (self-correcting recs) | none | none | — |
| **P3** | #2-free | AI-Overview/SERP-feature triggers surfaced from data on hand | none | none | — |
| **P4** | #3 | Geo correctness + workspace target-geo field | `geo-targeting` | none | — |
| **P5** | #8 | Reliability + cost governance | none | none (saves) | — |
| **P6** | #5 + 2-paid | National advanced-SERP rank + AI-Overview citation layer | `national-serp-tracking` | paid | P4, P5 |
| **P7** | #6 | GBP + reviews local layer | `local-gbp` | paid | P4, P5 |
| **P8** | #7 | AI-visibility (LLM citation) slice | `ai-visibility` | paid | P4, P5 |

### Dependency graph & parallelism

```
Group A (quick wins, no spend):   P2  ‖  (P1 → P3)        ← P1,P3 share keyword-strategy-enrichment.ts
Group B (foundations, no spend):  P4  →  P5               ← P4,P5 share dataforseo-provider.ts
                                  (P4 may run ‖ Group A — disjoint files)
Group C (paid, flag-gated):       P4+P5 ──► { P6 ‖ P7 ‖ P8 }   ← after a shared provider-methods PR
```

- Peak concurrency Groups A+B: **3 lanes** (P2 ‖ P1→P3 ‖ P4), then P5.
- Group C: a small provider-methods PR (adds the three endpoint methods behind flags), then **P6/P7/P8 in parallel**.
- Lanes run in **separate worktrees**; the controller commits per lane (never parallel git writes in a shared checkout).

---

## Phases

### P1 — Value-first keyword scoring (move #1)
**Goal:** production ranks keywords by commercial value, not `vol*0.45+ease*0.45`.
**Change (one PR — flip + delete):**
- Flip `'keyword-value-scoring': false → true` (`shared/types/feature-flags.ts:54`).
- Delete the **crude Hub-sort branches only** (the value-first-vs-crude accessor pairs in `server/keyword-command-center.ts`: ~`:909/:920-934`, `:2530/:2540-2566`, plus the `valueScoringOn` plumbing) and unconditionalize the value-first path in `keyword-strategy-enrichment.ts:607-648` and `keyword-strategy-ux.ts:420-460`.
- **Keep `computeOpportunityScore`** (`keyword-strategy-helpers.ts:90-108`) — it remains the value-first gate-failure fallback (`enrichment.ts:626`), the content-gap backfill basis (`helpers.ts:158`), and the fallback in `briefing-candidates.ts:239`, `briefing-client-projection.ts:67`, `routes/public-content.ts:225`. Do **not** delete the function.
- Coordinated: update `tests/unit/feature-flags-keyword-hub.test.ts:33` (`toBe(false)`→`true`); advance the `keyword-value-scoring-dark-launch` deprecation-registry entry (`scripts/deprecation-lifecycle.ts`) state + evidence; update `data/roadmap.json` `keyword-value-scoring`, `docs/rules/keyword-hub.md`, and the flag comment block.
- If removing the flag key entirely: also delete the catalog entry (`feature-flags.ts:315`) and group-list entry (`:574`) in the same commit (import-time consistency assertion).
**Acceptance:** value-first ordering live for all workspaces; no crude Hub-sort branch remains; `verify:feature-flags` green; existing ON/OFF tests pass (the OFF cases that relied on the default are updated).
**Blast radius:** re-ranks keywords on admin Hub + client Strategy surfaces; persisted `opportunityScore` shifts on next enrichment. No DB/Zod change.

### P2 — EMV calibration loop (move #4)
**Goal:** recommendation ranking self-corrects from realized outcomes; effort estimates come from measured reality.
**Change:**
- In `server/recommendations.ts` (~`:1382-1386`, once-per-cycle resolve), add `getEffortPriorDays(workspaceId)`.
- Thread `effortDays: priors[recommendationOutcomeActionType(type, source)] ?? null` into the 16 `computeOpportunityValue` inputs (existing `:346` fallback handles null → branch default).
- Swap `computeOvCalibration`'s basis **in place** (`server/scoring/ov-calibration.ts:75`) to read **conclusive** `getEmvCalibrationForWorkspace` entries (median realized/predicted), preserving the `[0.75,1.25]` clamp + identity gate so the `:1383` call site is byte-identical.
- Decision (resolve in plan): per-workspace single multiplier (aggregate conclusive ratios — smaller edit) vs per-actionType (more fidelity, larger edit). **Recommend single-multiplier** to preserve the existing contract.
**Guards:** reuse existing sample-size floors (≥5 pairs, ≥3 effort samples → NULL → identity/default). Read only `status==='conclusive'`. No new guard.
**Acceptance:** effort priors + realized ratio flow into ranking; tiny samples fall back to identity; no double-calibration; `predictedEmv` unchanged (so client dollar language is unchanged — ranking only).
**Blast radius:** reorders rec queue (fix_now/soon/later). Admin/AI EMV only; public routes strip EMV.

### P3 — AI-Overview / SERP-feature surfacing from data on hand (move #2-free)
**Goal:** content for AI-Overview/SERP-feature keywords gets AEO treatment, grounded in signals already fetched (`ranked_keywords serp_item_types`). *Not* "are we cited" (that is P6).
**Change:**
- Add `ai_overview` (and any other dropped types) recognition to `hasSerpOpportunity` (`server/seo-provider-signals.ts:45-58`) — string-label case, not the vestigial numeric map.
- Extend `SerpFeatures` intelligence type (`shared/types/intelligence.ts:798-804`) with `aiOverview`; update aggregation (`server/intelligence/seo-context-slice.ts:347-363`) + formatter (`formatters.ts:395-396`).
- Push `ai_overview` into the stored `serpFeatures` lists at `keyword-strategy-enrichment.ts:360-369` & `:532-538` (JSON-TEXT columns absorb the new member — no migration).
- Add an `ai_overview` directive case to `serpFeaturesDirectiveBlock` (`server/content-brief.ts:1254-1283`).
**Acceptance:** keywords whose SERP triggers an AI Overview/feature carry the signal end-to-end into the brief directive + scoring; integration test exercises the read path.
**Note:** sequence after P1 in the same lane (shared `keyword-strategy-enrichment.ts`).

### P4 — Geo correctness + workspace target-geo (move #3)
**Goal:** non-US clients stop being silently queried in US/English; national/intl becomes addressable.
**Change:**
- Thread resolved `locationCode` + `languageCode` through `getDomainKeywords`/`getUrlKeywords`/`getCompetitors`/`getKeywordGap` (and `provider-keyword-metrics.ts`) — remove hardcoded `language_code:'en'` + US default (`dataforseo-provider.ts:1116-1117, 1289-1303, 1360-1374, 1415-1430, 1460-1476`); fix callers that omit `database` (`keyword-strategy-seo-data.ts:139,156,181,222`, `analytics-intelligence.ts:1317-1433`, `routes/seo-provider.ts:107-174`).
- Replace the 6-country `LOCATION_CODES` map with a country→`location_code`+default-language lookup (or `serp/google/locations`).
- Add a **workspace-level target-geo/locale/database field** decoupled from the local-market table (migration + shared type + admin UI). Ship the canonical `resolveWorkspaceTargetGeo()` (cross-phase contract; P6 consumes it).
**Flag:** `geo-targeting` (OFF = today's US/en behavior, byte-identical) for safe staged rollout of the query-result change.
**Acceptance:** a non-US workspace's ranked keywords/competitors/gaps reflect its market; integration test asserts location/language threading; OFF = byte-identical.

### P5 — Reliability + cost governance (move #8)
**Goal:** no silent empty-data; per-client credit visibility; tier-margin protection before paid Group C.
**Change:**
- Bounded retry-with-backoff on provider calls (`apiCall`/`apiGet` → `external-fetch.ts`); transient 429/5xx retried, not collapsed to `[]`/null.
- Actually call `markCapabilityDisabled` on subscription errors (`seo-data-provider.ts:178` is defined, never called) so unavailable subscriptions stop re-incurring cost.
- Credit-usage **read/aggregation path** (read `data/dataforseo-usage/*`, currently write-only) + `assertCreditBudget(workspaceId, endpoint, tier)` gate (cross-phase contract; P6–P8 call it).
**Acceptance:** simulated transient error retries then succeeds/records `failed` (not silent empty); capability breaker trips once and short-circuits; per-workspace credit aggregation queryable; budget gate enforced.

### P6 — National advanced-SERP rank + AI-Overview citation (move #5 + item 2-paid)
**Goal:** true SERP rank ("you rank #3"), SERP-feature ownership, and AI-Overview **citation** for tracked national keywords; rank baselines for keywords not yet ranking.
**Change (paid, flag `national-serp-tracking`):**
- New background job (mirror `runLocalSeoRefresh`; `server/jobs.ts` + `BACKGROUND_JOB_TYPES`) calling `serp/google/organic/live/advanced` per tracked national keyword; parse `featured_snippet`/`people_also_ask`/`ai_overview`(+references/owner)/organic owners; store true rank + matched URL + features alongside the GSC reading.
- New insight type `serp_feature_opportunity` (7-part lockstep: union `shared/types/analytics.ts`, `XData`+`InsightDataMap`, Zod `server/schemas/insight-schemas.ts`, renderer `useInsightFeed.ts`, `classifyDomain` `insight-enrichment.ts`, compute+stale-cleanup `analytics-intelligence.ts`, optional filter pill). Mirror `ranking_mover`.
- Backfill via `historical_serps`/`historical_rank_overview`.
- Must call `assertCreditBudget` (P5) and reuse OOM/concurrency guards.
**Acceptance:** tracked national keywords get true rank + feature/AI-Overview presence; insight fires with broadcast (generic insight WS coverage); cost gated; flag OFF = no fetch.

### P7 — GBP + reviews local layer (move #6)
**Goal:** a real local product — diagnose/recommend on the client's GBP and reviews.
**Change (paid, flag `local-gbp`):**
- `business_data/business_listings_search` for the client's own GBP (categories, hours, photos, attributes, completeness).
- Capture `rating`/`rating_count` from `local_pack` items (extend `normalizeLocalResultItem` + `LocalVisibilityBusinessResult` + a local snapshot column) → review-gap recommendation vs pack winners.
- Wire into `local-seo-slice` + recommendations.
**Acceptance:** GBP completeness + review-gap recs for local clients; cost gated; flag OFF = today's local-pack-only behavior.

### P8 — AI-visibility (LLM citation) slice (move #7)
**Goal:** measure whether the client is cited by LLMs for money keywords — close the AEO loop.
**Change (paid, flag `ai-visibility`):**
- `ai_optimization/llm_mentions_*` (optionally `chat_gpt_scraper`) recording client-domain citation for money keywords; new intelligence slice + KPI + before/after AEO proof; competitor LLM-mention benchmarking.
**Acceptance:** AI-visibility KPI surfaced; AEO before/after attributable; cost gated; flag OFF = no fetch.

---

## UI/UX surfaces per phase

Legend: **Wiring** = an existing component already renders this shape of data; **New UI** = net-new component/field/column/badge/panel. Every phase below lists a one-line wiring-vs-new verdict, the net-new items, and the dark risks that MUST become either a new-UI item or an explicit "prompt-only, intentionally not shown" decision.

### Client-surface principle (MVU)

Every phase obeys: **build depth admin-side, surface one "number that matters" client-side, in an existing frame.** The platform's curated, verdict-first delivery (`ROIDashboard`/`OverviewTab` KPI grids, `InsightsDigest` cards, admin-curates-then-sends) is the mechanism — do **not** add net-new client dashboards.

- **One client headline per paid capability**, dropped into an existing KPI slot: P6 → "Winning AI Overviews on N of M target keywords"; P7 → "GBP X% complete · N reviews vs pack avg M"; P8 → "Cited by AI for N of M money keywords" + a before/after `TrendBadge`.
- **Depth is admin-only and curated** — full GBP completeness panel, review benchmark, per-keyword rank drawer, competitor LLM benchmark live admin-side; the admin curates what the client sees.
- **Progressive disclosure + primitives** — client `StatCard` summary → detail on demand; reuse `StatCard`/`Badge`/`TrendBadge`/`ChartCard`/`InsightsDigest`, never hand-roll.
- **Frame in outcomes, not metrics** — plug client surfaces into the verdict-first/ROI Results spine, not raw `serp_item_types`/GBP/LLM tables.
- **MVU resolves no-dark-output simply** — a signal must reach someone via the *narrowest valuable surface* (one client KPI + admin depth), **not** a full build. Competitor benchmarks and rich client local dashboards are "later" within each phase, shipped only after the headline proves used.

### P1 — value-first keyword scoring — **Wiring (fully)**
Renders through existing surfaces: valueReasons chips already mount in `KeywordDetailDrawer.tsx:385-396` and `StrategyKeywordDrawer.tsx:295-303`; reordering rides the overwritten `opportunityScore` field. The raw value score number is intentionally never serialized (transient WeakMap, `keyword-command-center.ts:111-116`).
- New UI (optional, non-blocking): sortable 'Value'/'Opportunity' column header in the admin Hub table — `RankTable.tsx` column union is `position|keyword|clicks|volume|difficulty` only, so value-first order is invisible at list level and cannot be restored after a manual re-sort. **[M]**
- Dark risk: none true. Soft gap — the Hub LIST gives no visible signal of the value reordering (no value column/badge); reasoning lives only in the per-row drawer. Surfaced-but-thin, not dark.

### P2 — EMV calibration loop — **Wiring (fully)**
Reordered rec queue renders via existing `impactScore` sort (`recommendations.ts:802-806`). Clients correctly see neither EMV nor any calibration concept (stripped at `routes/recommendations.ts:195`).
- New UI: none.
- Dark risk (intentional): `outcome_emv_calibration` (migration 131) produces `medianRealizationRatio` + `medianEffortDays`; `getEmvCalibrationForWorkspace()` / `getEffortPriorDays()` (`outcome-emv-calibration.ts:302,312`) have ZERO external callers. **Decision: intentionally not shown — deliberate forward-plumbing for the unshipped P6 basis flip (file header marks it internal-only). Do not surface until P6 consumes it.**

### P3 — AI-Overview / SERP-feature triggers — **Wiring (partial); needs S fixes**
The brief AEO directive is prompt-only. The serp chip renders through existing `ContentGapRow` `serpBadges()`, but `ai_overview` is enumerated out everywhere.
- New UI: **[S]** add `ai_overview` to `SERP_DESCRIPTIVE/PLAIN/EMOJI` + the fixed `order` array (`ContentGapRow.tsx:237`); **[S]** add `aiOverview` to `formatters.ts:395-405` parts list and `client-intelligence.ts:131` `countSerpOpportunities`. **[M, optional]** a real AI-Overview affordance in KeywordHub/drawer or a visible 'AEO guidance' note in the brief preview.
- Dark risk: REAL. (1) brief AEO directive is 100% prompt-only with no render surface — needs an explicit prompt-only decision; (2) `ai_overview` silently dropped from admin chips, briefing chips, AI formatter, and the client count; (3) on the client strategy-tab it renders as a raw unstyled `ai_overview` string; (4) pre-existing `ClientIntelligence.serpOpportunities` has zero consumers.

### P4 — geo correctness + workspace target-geo field — **New UI**
Today the resolved query geo (locationCode + languageCode + database) drives every volume/competitor/gap query yet has NO render surface anywhere. Workspace type has no geo/locale/database field (`shared/types/workspace.ts` — only NAP `country`).
- New UI: **[M]** target-geo/locale/database field (country picker + resolved-locale readout) — new field + migration + shared type, built on `FormSelect`, adjacent to the Local SEO 'Primary market' line; **[S]** disambiguation copy stating which geo wins (national target vs local-pack market) to avoid a dual-geo trap; **[S]** optional resolved-geo readout ('Volume data: United Kingdom / en-GB') on keyword/strategy surfaces.
- Dark risk: PARTIAL. P4 surfaces the INPUT (admin field) but acceptance is data-correctness + flag-OFF byte-identity — it does NOT mandate a resolved-geo readout, so the OUTPUT (which market the numbers reflect) stays dark. Without the readout, an admin who sets the field gets no in-product confirmation it took effect.

### P5 — reliability + cost governance — **Wiring (partial); one M fix**
Credit summary already on Connections tab (`ConnectionsTab.tsx:307-308`); retry is invisible by design (correct).
- New UI: **[S]** wire budget gate into the DataForSEO health card `quotaStatus`/`quotaDetail` (existing badge/chip render it); **[S]** route a budget-blocked reason through the existing NotificationBell job-error path; **[M]** add `dataforseo`/`dataforseoDaily` rendering to `AIUsageSection` (or consciously strip from the payload).
- Dark risk: REAL but small. (1) `getDataForSeoByDay()` is returned by `GET /api/ai/usage` (`routes/ai.ts:127-128`) but `AIUsageData` (`AIUsageSection.tsx:28-33`) omits both fields and never renders them — served-but-unsurfaced; P5 deepens this. (2) budget-blocked UX has no surface today (no 'budget exceeded' string in `src/`) — the plan must answer this, not assume silent.

### P6 — national SERP rank + AI-Overview citation — **New UI (partial)**
Today only GSC avg position renders. True SERP rank, GSC-vs-SERP provenance, matched URL, and AI-Overview citation have no surface.
- New UI: **[M]** `serp_feature_opportunity` insight — 4-part type registration + admin `useInsightFeed` transform case + client `InsightsDigest` icon/action; **[M]** rank-source distinction on KeywordDetailDrawer ('Live SERP #3' vs 'GSC avg #4.2') — extend `KeywordCommandCenterMetrics` beyond single `currentPosition` + matched-URL line; **[M]** AI-Overview citation indicator (per-keyword badge + workspace rollup KPI); **[S]** wire `serpBadges()` into tracked-keyword/rank drawers; **[S]** public-content serialization for any client-facing P6 field (rank-source, matchedUrl, aiOverviewCited).
- Dark risk: HIGHEST. AI-Overview citation is a brand-new sales-relevant concept with zero surface today — must get a dedicated indicator. Matched URL + true-SERP-rank are dark if the drawer keeps showing only the single GSC `currentPosition`. Per-keyword serpFeatures stay dark until `serpBadges()` is mounted on keyword surfaces.

### P7 — GBP + reviews local layer — **New UI (partial)**
Today only an admin-only local-PACK PRESENCE panel exists (`LocalSeoVisibilityPanel.tsx`). GBP completeness and the review-count benchmark have no panel; no client local surface exists at all.
- New UI: **[L]** GBP completeness panel (categories/hours/photos/attributes/completeness score) — #1 dark-output risk, spec names no panel; **[M]** review-gap benchmark row/widget (client rating + review count vs each pack winner) — rating/rating_count is net-new data with no existing render shape; **[S]** `gbpPlaceId` input in LocationsTab; **[S]** `review_gap` RecType label-map entry IF chosen over reusing `local_visibility` (open decision); **[M]** optional client-facing local/GBP surface.
- Dark risk: HIGH. Wiring GBP completeness into LocalSeoSlice surfaces it to AdminChat/AI context ONLY (the slice is not a visible component) — it stays collected-but-unrendered unless a net-new GBP panel ships. The client's own rating/review_count has no column and no render shape; if it only feeds a rec's free text it never appears as a structured benchmark. The review-gap RECOMMENDATION is the only P7 output that reaches users via existing rec/inbox/insights wiring.

### P8 — AI-visibility (LLM citation) slice — **New UI (almost wholly greenfield)**
No LLM-citation surface exists anywhere. The site-health `AeoReadiness {pagesChecked, passingRate}` field is a DECOY — it is a content-pass-rate, not citation. Flag-gated (`ai-visibility`, paid).
- New UI: **[M]** AI-visibility KPI card ('cited by LLMs for N of M money keywords'); **[L]** before/after AEO-proof panel (citation rate baseline vs after AEO work) — highest-value, fully-dark output; **[M]** competitor LLM-mention benchmark; **[M]** new AI-visibility intelligence slice + ClientSignals/insight wiring (without it AdminChat is blind to the KPI); **[S]** optional per-keyword citation field in drawers; **[S]** `ai-visibility` feature-flag catalog entry (FeaturesTab toggle auto-renders).
- Dark risk: HIGH — worst of any phase. KPI, before/after proof, and competitor benchmark all have no surface and the spec names none. Unless the plan adds the StatCard + before/after panel + benchmark + new slice in the same phase, every dollar of paid DataForSEO LLM-mention spend lands in a table no user ever sees.

---

## Shared scaffolding (before first phase commit)

1. **Program reference doc** `docs/rules/seo-decision-engine.md` — holds the four cross-phase contracts:
   - `resolveWorkspaceTargetGeo()` — canonical geo/locale/database resolution (P4 builds, P6 consumes).
   - `SerpFeatures` type extension — P3 adds `aiOverview`; P6 extends with citation/ownership.
   - `serp_feature_opportunity` insight registration — the 7-part lockstep (P6).
   - `assertCreditBudget(workspaceId, endpoint, tier)` — P5 ships, P6–P8 call.
2. **Feature flags** added to `shared/types/feature-flags.ts` before the first commit of each gated phase: `geo-targeting` (P4), `national-serp-tracking` (P6), `local-gbp` (P7), `ai-visibility` (P8). P1 retires `keyword-value-scoring`.
3. **Per-phase Definition of Done:** `npm run typecheck` + `npx vite build` + `npx vitest run` + `npx tsx scripts/pr-check.ts` + `verify:feature-flags` + `verify:coverage-ratchet` all green; tests alongside code; `FEATURE_AUDIT.md` + `data/roadmap.json` + `BRAND_DESIGN_LANGUAGE.md` (if UI) updated; staging-verify before `staging`→`main`.
4. **Flow:** each phase = branch off `staging` → PR → staging-verify → merge `staging`→`main`. No phase N+1 until N merged + green.
5. **No-dark-output rule (same-PR UI):** every phase ships its UI in the same PR as its backend. Each dark risk in the *UI/UX surfaces per phase* section must be resolved as either a net-new UI item or an explicit "prompt-only / intentionally not shown" decision recorded in that phase's plan. A paid phase (P6–P8) does **not** pass DoD if its output lands in a table no user sees.

## Testing & verification strategy

- P1: scorer ON ordering assertions (exist) + flag-default test update; client/admin re-rank smoke.
- P2: calibration basis-swap unit test; effort-prior threading integration; identity-fallback on low samples.
- P3: end-to-end `ai_overview` signal → brief directive integration (exercise the read path, not just the store).
- P4: location/language threading integration for a non-US workspace; flag OFF byte-identity.
- P5: transient-error retry test (FM-2 pattern: assert recorded `failed`, not silent empty); capability-breaker trip; budget-gate enforcement.
- P6–P8: external-API mock error tests; insight registration contract test; flag-OFF = no fetch; cost-gate respected.

## Risks

- **P1 re-rank perception** — keyword ordering visibly changes for clients. Mitigate: staging eyeball before `staging`→`main` (per-PR staging gate).
- **P2 granularity** — per-actionType vs per-workspace calibration is the one open design decision; default to single-multiplier.
- **P4 breadth** — touches many provider callers; the `geo-targeting` flag makes OFF byte-identical so rollout is staged.
- **Group C cost** — paid fetches must land *after* P5's budget gate; each gated + tier-aware.
- **Provider-file contention** — `dataforseo-provider.ts` is touched by P4/P5/P6/P7/P8; enforce exclusive ownership per lane and the Group-C provider-methods-first PR.
- **Dark outputs (collected-but-unsurfaced)** — the platform spine carries Group A automatically, but it STOPS helping at Groups B/C: AI-Overview citation (P6), GBP completeness + review benchmark (P7), and the AI-visibility KPI/before-after proof (P8) are brand-new concepts with no existing render shape. Wiring a signal into an intelligence slice surfaces it to AI prompts only, **not** to a visible component. Every paid phase must add its own surface; see the *UI/UX surfaces per phase* section and the no-dark-output DoD rule. (Decoy watch: `AeoReadiness {pagesChecked, passingRate}` is a content-pass-rate, not LLM citation — do not mistake it for existing AI-visibility coverage.)

## Next steps

1. Spec review (this doc).
2. **pre-plan-audit** across the 8-phase affected surface.
3. **writing-plans** → Phase-1 implementation plan (then each phase as we reach it).
