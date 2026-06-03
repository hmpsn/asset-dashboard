# Keyword Surface Consolidation — Master Plan

**Date:** 2026-06-03 · **Owner:** josh@hmpsn.com (analytics-intelligence) · **Status:** design approved; per-wave executable plans pending `pre-plan-audit` + `writing-plans` before any code.

**Method:** grounded in the read-only multi-lane audit (`docs/audits/2026-06-03-strategy-keyword-rank-tracker-audit-prompt.md` → 22 verified findings, 2 Critical / 10 High / 7 Medium / 3 Low) and a gen-quality flip-readiness assessment (this session). Every cited `file:line` was adversarially re-verified against `origin/staging` code.

**Companion contract doc (required by CLAUDE.md §7, multi-phase work):** `docs/rules/keyword-surface-consolidation.md` — surface boundaries, the new primitive contracts, and the full reader lists (the gen-quality "inbox lesson": a shape's producer is easy to find, its readers are not).

**Umbrella feature flag:** none new for the consolidation itself (it is behavior-preserving). Wave 0 is the **rollout of the existing `seo-generation-quality` umbrella** (default `false` today, `rolloutTarget: staging-validation`). Flag-OFF byte-identity for that umbrella is a hard constraint on every wave until it reaches 100% and its legacy path is retired.

---

## 1. Why this plan exists (the owner's six goals)

The Keywords / Strategy / Rank-Tracker surface accreted duplication, divergent read paths, and a context-less hand-off. The audit mapped 22 findings to six goals: (G1) remove duplicates, (G2) fix strange/inconsistent UI/UX, (G3) clarify how Keywords and Rank Tracker relate, (G4) platform stability, (G5) easier gap-recognition / what's-next signal, (G6) level up generation overall.

This is a **consolidation, not a rebuild** — the data model, primitives, and contracts are sound; the positive template (`local-seo/LocalSeoVisibilityPanel` shared across 6+ surfaces) already exists. The defects are duplicated render/format logic, copy-pasted read paths that drifted, an unguarded blob RMW, and a context-less deep-link. Each is fixable in place.

The two **Critical** findings drive the spine:
- **#1 — lost-update race** on the `tracked_keywords` JSON blob (every writer does `readConfig → mutate-in-JS → writeConfig` with no transaction; `server/rank-tracking.ts:187-195`, race across 5 writers incl. post-generation reconcile).
- **#2 — quad reassembly** of the keyword strategy with no shared assembler and divergent blob-vs-table fallback policies (`server/routes/keyword-strategy.ts:218-227`, `server/routes/public-content.ts:133-148`, `server/keyword-command-center.ts:1143/1870/2088`, `server/intelligence/seo-context-slice.ts:42-52`, `server/recommendations.ts:1494`).

---

## 2. Locked design decisions

| Fork | Decision | Rationale |
|---|---|---|
| `tracked_keywords` data model | **Guard now → normalize later** — Wave 1 wraps the RMW in `BEGIN IMMEDIATE`; Wave 3 promotes to a `(workspace_id, normalized_query)` row table | Kills the data-loss race in ~½ day with zero shape change; the risky migration follows the cheap safety net (mirrors the 088–090 precedent + CLAUDE.md "normalize large repeated arrays out of JSON columns") |
| 4 strategy read paths | **Backfill + strip blob → one table-as-truth assembler** (`assembleStoredKeywordStrategy`) | Single source of truth, no per-request `length>0?table:blob` ternary that can flip mid-flight |
| UI consolidation | **New `KeywordTable` that subsumes `shared/RankTable`** | Build one canonical primitive (fold in `RankChange`/`RankHistoryChart`/`RankTrackingSection`) rather than grow a 6th table type |
| Provenance (#6/#7) | **Full persisted provenance pointers** (`sourcePageId`/`sourceGapKey` at promotion); retire `inferTrackedKeywordSources` | Stop re-inferring source at read; decouple "who approved it" from "is it auto-deprecatable" |
| Docs | **One combined master doc** (this) + `docs/rules/keyword-surface-consolidation.md` contract | Matches the gen-quality precedent; §7 requires the contract doc before the first contract-changing commit |
| Sequencing vs gen-quality | **Flip-first (Wave 0)**, flag-agnostic quick wins in parallel during the soak | The canary is the only thing that retires the flag-OFF byte-identity tax, and it is blocked on nothing but owner decisions |

---

## 3. Target-state architecture

### 3.1 Canonical UI primitives (Wave 2)
- **`KeywordTable`** — new shared primitive that **subsumes `shared/RankTable.tsx`**: typed column model, `renderActions` slot + optional variant sub-row (KCC cheap-vs-Evaluated split), flag-gated local-seo columns, built-in `EmptyState`/`Skeleton`. Replaces the ≥5 hand-rolled grids (`RankTracker`, KCC `KEYWORD_ROW_GRID`, `RankingsSnapshot`, `LowHangingFruit`/`KeywordGaps` flex, `SearchTab`'s raw `<table>`). *(#3)*
- **One `positionColor` + `rankBand`** in `src/components/ui/constants.ts` — 3/10/20 thresholds, token hues honoring the Four Laws (emerald=success, **not** teal), optional ≤50 granularity param. Delete all 5 copies. *(#4)*
- **One volume/KD format** — standardize on `src/utils/formatNumbers.fmtNum` + a single `kdColor`/`kdLabel` (extend `strategyKeywordDisplay`). Casing (`K` vs `k`) and `/mo` suffix decided deliberately, null-handling preserved. *(#16/#17)*
- **One `ContentGapRow`** — audience-parameterized + **`ovGainActive` prop, flag-OFF byte-identical** (gen-quality Contract 3). Replaces the triplicated content-gap row. *(#5)*
- **One `CannibalizationAlert`** — normalized warning shape via `SectionCard`, optional `tier` prop. Replaces the two divergent components. *(#14)*
- **Shared page-map leaf metric cell** — admin row + client content both consume; ADR-0004 admin/client split preserved (share the leaf, not the component). *(#15)*

### 3.2 Server single-source-of-truth (Wave 3)
- **`assembleStoredKeywordStrategy(workspaceId)`** — table-as-truth after a backfill migration strips the legacy blob arrays; one documented policy; replaces all 4 read paths. *(#2)*
- **`tracked_keywords`** — Wave 1 `BEGIN IMMEDIATE` on every writer; Wave 3 promote to a `(workspace_id, normalized_query)` row table with lifecycle columns. *(#1/#12)*
- **Provenance** — route all `TrackedKeyword` writes through one helper with a **non-remapped** origin (stop laundering feedback→`STRATEGY_*`), persist `sourcePageId`/`sourceGapKey` at promotion, align the WS-broadcast vocab with the stored enum, retire `inferTrackedKeywordSources`. *(#6/#7)*
- **One keyword equality** everywhere via `keywordComparisonKey` / `normalizeKeywordForComparison` — this **is** the deferred `intel-quality-keyword-normalization-route-reliability-hardening` roadmap item; reconcile, don't fork. *(#6/#12)*
- **`strategy_history`** typed schema + `FK … ON DELETE CASCADE`; built from the assembler shape. *(#18)*
- Normalize `siteKeywordMetrics`/`competitorKeywordData` out of the blob; delete dead `topicClusters`/`cannibalization` Zod branches. *(#19)*

### 3.3 Relationship / UX (Wave 4)
- **Division-of-labor** baked into shared subtitles (per `docs/rules/keyword-command-center.md`): Command Center = lifecycle, Rank Tracker = measurement-only, Strategy = generation.
- **Keyword-level deep-link** honoring the **`?tab=` two-halves contract** (`docs/rules` UI-UX #12): KCC `view_rankings` + `KeywordDetailDrawer` pass `?query=`/state; `RankTracker` reads `useSearchParams` to init `expandedQuery` + scroll-to; contract test mirroring `tab-deep-link-wiring`. *(#10)*
- **Nav co-location / cross-link** so the lifecycle→measurement relationship is discoverable. *(#10)*
- **One "keyword of record" count** from the assembler (CLAUDE.md numerator/denominator-same-source rule). *(#6)*
- **Auto-deprecation transparency** — a reviewable "recently retired/replaced by regeneration" section sourced from the reconciliation changeset; unify the `lost/deprecated/replaced/retired/removed` vocabulary. *(#9)*
- **Single query key** (`rankTrackingKeywords`); delete `rankTrackingKeywordRows`; fix the `togglePin` partial invalidation. *(#11)*
- **#8 (downgraded Low)** — cosmetic copy on the existing "Tracked but no rank data" section (`RankTracker.tsx:585-608`).

### 3.4 Orphans (#21)
Delete `KeywordAnalysis.tsx` + `strategy/PageKeywordMap.tsx` (both zero production imports — verified). **`FixRecommendations.tsx` is held**: the gen-quality plan's Contract 1/3 reader lists still name it as a live client renderer, so it is reconciled against that plan before disposition — not unilaterally deleted.

---

## 4. Waves & sequencing

```
Wave 0 (rollout, owner-gated)  ── canary → soak → ramp → 100% → retire legacy path
        │  (runs on calendar time; flag-agnostic Wave 1 proceeds in parallel)
        ▼
Wave 1 (stability quick wins, flag-agnostic)  ── parallel-safe during the soak
        ▼
Wave 2 (shared primitives)        ┐
Wave 3 (data-model consolidation) ┤── gated on umbrella reaching 100% + legacy path retired
Wave 4 (relationship / UX)        ┘   (these touch the rec/strategy/flag surface)
```

**Why this order:** Wave 0 starts the only clock that retires the flag-OFF byte-identity tax. Wave 1 is genuinely flag-agnostic (it touches `tracked_keywords`, query keys, and dead code — not the rec/strategy/flag surface), so it runs during the soak without entangling the canary. Waves 2–4 touch shared rec/strategy primitives and benefit from operating on one settled code path, so they wait for the umbrella at 100%.

### Wave 0 — gen-quality rollout (OWNER-GATED; I do not execute the flip)

Readiness verified this session: **flip is technically safe to start — no code/infra blocker.** Per-workspace plumbing (P0) and the OV-divergence shadow-log (P4, G1 fixed) are GREEN and proven end-to-end; the only RED (P6 telemetry) is plan-sequenced to be built *after* the soak.

**Runbook:**
1. **Owner picks the canary cohort** — plan intent: *Faros + one non-US + one broad-business workspace*. (A broad-business member exercises only the non-local path; cover local behavior via the Faros / non-US members.)
2. **Owner confirms thresholds as production values** — `OV_TIER_BANDS` (70/45/20) and `OV_GAIN_BANDS` (600/150/1) at `server/recommendations.ts:766-778`/`:151`. These are immutable `as const` literals: changing them is a code change, not a flip-time knob.
3. **Owner decides sibling-flag posture** — `opportunity-value-scorer` is a **global** cutover (`recommendations.ts:1134`); flipping the umbrella on one workspace does **not** flip `pickImpactScore` for it. Decide whether the OV sibling flags move in lockstep.
4. **Owner sets the per-workspace override** for `seo-generation-quality` on the cohort via the admin UI (runtime, no code; blast radius = exactly the chosen workspaces).
5. **Soak** — review the in-app `OvDivergencePanel` (cross-tier reorder + invariant-broken rate). P6 generation-quality telemetry is **log-only** during the soak (Pino/Sentry queries); confirm a non-zero volume of flag-ON runs lands in the sink, and define the quantitative GO thresholds (floorHit rate, suppressedCount distribution, backfilledCount ceiling) — none are encoded yet.
6. **Per-phase owner GO/NO-GO** — P1 credit ceiling, P4 thresholds+cohort, P5 cannibalization dedup, P6 telemetry, P7 posture.
7. **Ramp → 100%**, then **retire the legacy flag-OFF path** (the flag's own `removalCondition`). *This is the event that unlocks Waves 2–4's simplification.*

**Findings covered:** none directly — this is the precondition. **Effort:** owner decisions + soak time. **Risk:** Medium (changes live client recommendation/ranking behavior; mitigated by per-workspace blast radius + in-app divergence review). **Owner-gate:** entire.

### Wave 1 — stability quick wins (flag-agnostic; parallel-safe during the soak)
| # | Finding | Sev | Note |
|---|---|---|---|
| 1 | `tracked_keywords` RMW → `BEGIN IMMEDIATE` on every writer + concurrency test | **Critical** | Per the DB-lock memory (PR #1030); updaters are pure → safe inside the txn |
| 11 | Collapse duplicate query keys; fix `togglePin` invalidation | High | Update all invalidation sites in the same change |
| 13 | Rec auto-gen off the inline unauth GET → background job and/or `requireAuthenticatedClientPortalAuth()` | High | *Touches `recommendations.ts` — see flag-surface caveat below* |
| 22 | Delete dead `strategy.quickWins \|\| []` fallback | Low | Pure cleanup |
| 21 | Delete the 2 confirmed-dead components (`KeywordAnalysis`, `strategy/PageKeywordMap`) | Medium | `FixRecommendations` held pending gen-quality reconciliation |
| 19a | Delete dead `topicClusters`/`cannibalization` Zod schema branches | Medium | Schema must reflect stored shape |
| — | Collapse 3× blob parse per `tracked_keywords` mutation | Medium | Efficiency |

**Caveat:** #13 touches `recommendations.ts`, which is on the gen-quality flag surface. If the canary is mid-soak, scope #13 to the route/job boundary only (no change to rec *generation* logic) to avoid muddying canary attribution, or defer it to the front of Wave 2. **Effort:** S. **Risk:** Low (except #1 = Critical-value/Low-risk). **Owner-gate:** none.

### Wave 2 — shared primitives (after umbrella 100%)
`positionColor` authority (#4) → `fmtNum`/`kdColor` (#16/#17) → `KeywordTable` build + migrate (#3) → `ContentGapRow` (#5, `ovGainActive` byte-identical) → `CannibalizationAlert` (#14) → page-map leaf cell (#15). **Effort:** L. **Risk:** Medium (broad UI blast radius; preserve flag-gated columns + the KCC variant contract).

### Wave 3 — data-model consolidation (after umbrella 100%, gated)
Backfill + strip + `assembleStoredKeywordStrategy` (#2, one consumer per PR + public-read test) → `strategy_history` typed+FK (#18) → normalize `siteKeywordMetrics` (#19b) → `tracked_keywords` row table (#12, after #1+#2) → provenance pointers + retire inference (#6/#7) → diff-based upserts (#20) → KCC read-model cache. **Effort:** XL. **Risk:** High (migrations + the central read paths). **Owner-gate:** review the backfill on staging before each strip.

### Wave 4 — relationship / UX redesign
Keyword-level deep-link + nav + division-of-labor subtitle (#10) → auto-deprecation transparency + churn vocabulary (#9) → UI provenance (#7) → next-focus signal (G5). **Effort:** L. **Risk:** Medium.

---

## 5. Task dependency graph (wave level)

```
Wave 0 rollout ──(100% + legacy retired)──┐
                                          │
Wave 1 (parallel during soak):            │
  #1 RMW IMMEDIATE  ∥  #11 query keys  ∥  #21 orphans  ∥  #22/#19a dead-code  ∥  3×-parse
  (#13 route/job — scope-limited or front-of-Wave-2)
                                          ▼
Wave 2:  #4 positionColor → #16/#17 formatters → #3 KeywordTable → #5 ContentGapRow
         #14 CannibalizationAlert  ∥  #15 page-map leaf   (after #4 + formatters)
                                          ▼
Wave 3:  #2 backfill→assembler → #12 tracked_keywords table (needs #1 + #2)
         #18 strategy_history  ∥  #19b normalize  ∥  #6/#7 provenance  → #20 upserts → cache
                                          ▼
Wave 4:  #10 deep-link/nav → #9 auto-deprecation → #7 UI provenance → next-focus signal
```

**Hard dependencies:** `positionColor` + formatters **before** `KeywordTable`; #1 **before** #12; backfill **before** assembler **before** #12; assembler **before** reducing recs' re-derivation.

---

## 6. Bounded-context ownership & integration surfaces

- **Primary owning context:** keyword/strategy intelligence (`server/keyword-*`, `server/rank-tracking*`, `server/intelligence/*-slice.ts`). Confirm against `docs/rules/platform-organization.md` per wave.
- **Route/API surface:** `server/routes/{keyword-strategy,rank-tracking,keyword-command-center,public-content,recommendations}.ts`.
- **Shared types:** `shared/types/{keyword-command-center,rank-tracking,keyword-strategy,keyword-strategy-ux}.ts`, `shared/keyword-normalization.ts`; new contracts go in `shared/types/` **before** implementation.
- **React Query keys / invalidation:** `src/lib/queryKeys.ts` (collapse the duplicate), `useWsInvalidation.ts`, `useKeywordCommandCenter.ts`.
- **WS events:** `WS_EVENTS.{RANK_TRACKING_UPDATED, STRATEGY_UPDATED, INTELLIGENCE_SIGNALS_UPDATED}` (per `keyword-command-center.md` mutation rules).
- **Intelligence wiring:** any new store surfaces through a `server/intelligence/*-slice.ts` (Data-Flow #6).
- **Work classification:** Waves 1–3 are largely **behavior-preserving extraction**; Wave 4 is **new behavior** (deep-link, transparency UI).

---

## 7. Model assignments (Anthropic ladder)

| Task class | Model |
|---|---|
| Dead-code deletion, query-key collapse, schema-branch removal, fixture updates | Haiku |
| `KeywordTable`/`ContentGapRow`/`CannibalizationAlert` build, service-layer extraction, migrations, tests | Sonnet |
| The assembler (#2), `tracked_keywords` normalization (#12), provenance (#6/#7), the deep-link contract, every cross-context/flag-surface change, all reviewers | Opus |

---

## 8. Systemic improvements

- **Shared utilities to extract:** `KeywordTable`, one `positionColor`/`rankBand`, one `fmtNum` + `kdColor`/`kdLabel`, `ContentGapRow`, `assembleStoredKeywordStrategy`, one tracked-keyword write helper (txn-guarded).
- **pr-check rules to add (forward-looking):**
  - ban new `positionColor`/rank-color definitions outside the authority module;
  - ban new hand-rolled keyword/rank `<table>`/grid outside `KeywordTable`;
  - ban bare `tracked_keywords` read-modify-write outside the txn-guarded helper;
  - require `keywordComparisonKey` for keyword equality (no ad-hoc `normalizeQuery` variants);
  - (extend) `opportunity-money-field-must-be-stripped` coverage if `ContentGapRow` adds fields.
- **Test coverage:** concurrency test for #1; public-read-path test for the assembler (#2) and each blob-strip; deep-link contract test (#10); `KeywordTable` component tests; flag-OFF byte-identity test for `ContentGapRow` (#5).
- **Feature-class gates:** UI primitive (Wave 2), data-migration (Wave 3), client-visible (Wave 4) sections of `feature-class-definition-of-done.md`.

---

## 9. Verification strategy

Per wave, all of: `npm run typecheck` · `npx vite build` · `npx vitest run` · `npx tsx scripts/pr-check.ts` · `npm run verify:feature-flags` · `npm run verify:coverage-ratchet`. Plus:
- **#1:** a two-writer concurrency test proving no lost update.
- **#2 / blob strips:** a `GET /api/public/seo-strategy/:id` test asserting the field survives the public read path (not just the admin route).
- **#10:** the `tab-deep-link-wiring`-style contract test (sender appends `?query=`/`?tab=`, `RankTracker` reads it).
- **#5:** flag-OFF render is byte-identical to pre-consolidation (`RecommendedForYou`-style pin test).
- **UI waves:** preview screenshots + a `positionColor` contrast/hue check against the Four Laws.
- **Parallel batches:** `superpowers:scaled-code-review` (10+ files); `git diff` + duplicate-import grep + full suite after each batch.

---

## 10. Roadmap reconciliation

Map onto existing items — **extend/sequence, don't fork:**
- `keyword-surface-dedup-audit` → this plan is its execution.
- `intel-quality-keyword-strategy-tracking-reconciliation` → #7/#9 (handoff, auto-deprecation).
- `intel-quality-keyword-command-center` (+ `…-latency-hardening-followup`) → KCC parts of #3, KCC read-model cache.
- `intel-quality-keyword-normalization-route-reliability-hardening` → #6/#12 (one equality + the row-table normalization); the `keyword-command-center.md` Follow-Up Boundary says this must precede local-SEO work.
- `audit-drift-public-route-auth-sweep-followup` → #13 (the auth half).

Mark items `done` with notes per wave (CLAUDE.md "After completing a task").

---

## 11. Flag boundaries & risk register

**Flag boundaries to preserve until Wave 0 hits 100% + legacy retired:**
- `seo-generation-quality` flag-OFF byte-identity — especially #5 (`ovGainActive`), the assembler's dual-basis `content_gaps` reads, and any `recommendations.ts` touch.
- `local-seo-visibility` P7 columns (KCC `LOCAL*` columns, the RankTracker disambiguation banner) — do not alter.

**Consolidation risks (call out in every touching PR):**
| Risk | Guard |
|---|---|
| Persist `BEGIN IMMEDIATE` txn (`keyword-strategy-persistence.ts:183-191`) | #20 optimizes lock-hold; **never revert IMMEDIATE** (it was the SQLITE_BUSY_SNAPSHOT fix) |
| `tracked_keywords` blob RMW | #1 `IMMEDIATE` first, #12 normalize second; never both in one PR |
| Reconciliation auto-deprecation | preserve pinned/manual/client protection + inactive-row auditability (`keyword-command-center.md` Data Contract) |
| The 4 read paths | backfill-before-assembler; one consumer per PR with a public-read test |

---

## 12. Process (per CLAUDE.md)

For **each wave** before code: (1) run `pre-plan-audit` to produce the exhaustive per-file findings table for that wave; (2) `writing-plans` to produce the executable task list with file ownership + model assignments; (3) **phase-per-PR**, dark-launch incomplete UI behind a flag; (4) **staging before main**; (5) update `FEATURE_AUDIT.md` / `data/roadmap.json` / `BRAND_DESIGN_LANGUAGE.md` on completion. The companion `docs/rules/keyword-surface-consolidation.md` is updated as each wave lands (the cross-phase contracts ledger).
