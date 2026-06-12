# Keyword Surface Consolidation — Cross-Phase Contracts

> Guardrail reference for the multi-wave keyword/strategy/rank-tracker consolidation.
> Written **before** the first contract change (CLAUDE.md Session-Protocol §7).
> Plan: `docs/plans/2026-06-03-keyword-surface-consolidation-plan.md`.
> No new umbrella flag (the work is behavior-preserving). The standing constraint is
> the **`seo-generation-quality` flag-OFF byte-identity** guarantee until that umbrella
> reaches 100% and its legacy path is retired (Wave 0).

The recurring failure mode (the gen-quality "inbox lesson"): **a shape's producer is easy
to find; its full reader list is not — and readers don't error, they quietly diverge.**
Every PR that changes one of the contracts below MUST enumerate and re-verify its reader
list, and add a **public** read-path test (not just the admin route).

---

## Surface Boundaries (authoritative division of labor)

> **Superseded by the Keyword Hub cutover (2026-06-11).** The three surfaces below were consolidated into one **Keyword Hub** (`seo-keywords`): the standalone Keyword Command Center and Rank Tracker (`seo-ranks`) no longer exist as separate surfaces. Lifecycle + measurement both live in the Hub. The current authoritative contract is `docs/rules/keyword-hub.md`; the division below is retained for historical context.

Reaffirms and extends `docs/rules/keyword-hub.md`:

- **The Keyword Hub = lifecycle + measurement** — track / pause / retire / decline / restore / promote, plus GSC positions, history, and snapshots (folded in from the retired Rank Tracker). The only keyword *manager*.
- **Strategy = generation/explanation** — generation + regeneration diffs; not a keyword manager.
- **Page Intelligence = page-first** — annotate + hand off to the Hub.
- **Client Strategy = client-safe** — no raw provider/evidence labels (`keyword-hub.md`).

---

## Contract A — the keyword-row primitive (`KeywordTable`)

**Producer (Wave 2):** a new `src/components/shared/KeywordTable.tsx` that **subsumes** the
current `src/components/shared/RankTable.tsx` (fold in `RankChange`, `RankHistoryChart`,
`RankTrackingSection`). Typed column model + `renderActions` slot + optional variant sub-row
+ flag-gated local-seo columns + built-in `EmptyState`/`Skeleton`.

**Full reader list / call sites to migrate (every hand-rolled keyword/rank table — verified):**
- `src/components/shared/RankTable.tsx` — the primitive being subsumed (only current importer: `client/SearchTab`).
- `src/components/RankTracker.tsx:439,452,502` — CSS-grid rank table + inline color.
- `src/components/keyword-command-center/KeywordRow.tsx:50,100` + `VariantSubRow.tsx:6` — `KEYWORD_ROW_GRID` (carries lifecycle/selection/variant state → migrate via `renderActions`/sub-row slot, **not** by forcing into the simple table).
- `src/components/workspace-home/RankingsSnapshot.tsx:40` — `divide-y` flex rows.
- `src/components/strategy/LowHangingFruit.tsx:34` + `strategy/KeywordGaps.tsx:32` — `justify-between` flex rows.
- `src/components/client/SearchTab.tsx:150,197-238` — both the shared `RankTrackingSection` **and** a hand-rolled `<table>` (raw `overview.topQueries`); add a "tracked vs all-queries" explainer.

**Invariant:** preserve flag-gated local-seo columns and the KCC cheap-vs-Evaluated-variant column contract. pr-check rule: ban new keyword/rank `<table>`/grid outside `KeywordTable`.

## Contract B — `positionColor` / `rankBand` authority

**Producer (Wave 2):** ONE export in `src/components/ui/constants.ts` (or re-exported by
`KeywordTable`). Thresholds 3/10/20; one token hue per band honoring the **Four Laws**
(emerald=success, NOT teal); optional `granularity` param for the ≤50 band.

**Full reader list (5 divergent copies to delete — verified):**
- `src/components/shared/RankTable.tsx:6` (emerald, 3/10/20).
- `src/components/KeywordStrategy.tsx:233` + `src/components/page-intelligence/pageIntelligenceDisplay.ts:3` (byte-identical pair; accent-tokens → #4-10 resolves **teal**).
- `src/components/client/PageKeywordMapContent.tsx:69` (5-band incl. ≤50).
- `src/components/RankTracker.tsx:502` (inline; #4-10 teal).
- Two-tier inline variants: `client/SearchTab.tsx:222,233`, `client/strategy/StrategyKeywordDrawer.tsx:142-150` (also fix its color/label threshold contradiction — amber ≤30 vs "Page 2+" >20).

**Invariant:** emerald=success / teal=actions must not flip across a rank scale. pr-check rule: ban new rank-color definitions outside the authority module.

## Contract C — volume / difficulty format

**Producer (Wave 2):** volume via `src/utils/formatNumbers.ts:fmtNum`; difficulty via ONE
`kdColor`/`kdLabel` (extend `pageIntelligenceDisplay`/`strategyKeywordDisplay`). One casing
(`K` vs `k`) + `/mo` policy, decided deliberately; preserve `compactNumber`'s null→`'-'`.

**Full reader list (copies to delete — verified):**
- Volume: `keyword-command-center/kccDisplayHelpers.ts:55` (`compactNumber`→`1.2K`), `strategy/ContentGaps.tsx:27` (local `fmtNum`→`1.2k`), `KeywordStrategy.tsx:795` / page-intel / `KeywordGaps` (`toLocaleString()+'/mo'`), `client/PageKeywordMapContent.tsx:293` (comma form — the genuine outlier).
- `fmtNum`/`num` copies: `client/strategy/strategyKeywordDisplay.ts:62`, `client/InsightsEngine.tsx:51`, `client/FixRecommendations.tsx:16`, `client/Briefing/RecommendedForYou.tsx:45`.
- Difficulty units diverge: `KD 45%` vs `45/100` (`KeywordRow.tsx:100`) vs `KD 45` (`ContentGaps`) vs `Difficulty 45`; verify the field is 0-100 KD on all surfaces before unifying.

## Contract D — `ContentGapRow` (flag-gated)

**Producer (Wave 2):** one `src/components/shared/ContentGapRow.tsx`, audience-parameterized
(admin vs client copy) + CTA slot + **`ovGainActive` prop**.

**Full reader list (triplicated row — verified):**
- `src/components/strategy/ContentGaps.tsx:26-185` (admin; `KD {n}`, 5-band kdColor incl. orange ≤80, est-clicks always).
- `src/components/client/strategy/StrategyContentOpportunitiesSection.tsx:93-286` (`ContentGapCard`; `Difficulty {n}`, 3-band, no est-clicks).
- `src/components/client/Briefing/RecommendedForYou.tsx:1-312` ("Ported verbatim from ContentGaps"; flag-gated est-clicks).

**Invariant (gen-quality Contract 3):** the shared primitive MUST thread `ovGainActive` and
render **flag-OFF byte-identical** to today (the `NN/100` badge + the `volume × 0.103`
est-clicks line), or it breaks the umbrella-OFF guarantee for all prod clients. Pinned by a
`RecommendedForYou`-style test.

## Contract E — `CannibalizationAlert`

**Producer (Wave 2):** one component accepting a normalized warning shape
(`{severity, pages, recommendation?}`) via `SectionCard`, optional `tier` prop.

**Full reader list (two divergent components — verified):**
- `src/components/strategy/CannibalizationAlert.tsx:4-12,33` (used by `KeywordStrategy.tsx:22,764`; `items: CannibalizationItem[]`, hand-rolled chrome, raw `text-red-400`, no TierGate, richer remediation).
- `src/components/admin/CannibalizationAlert.tsx:29` (used by `ContentPipeline.tsx:11,169`; `warnings: CannibalizationWarning[]`, `SectionCard`+`TierGate`, semantic tokens).

**Invariant:** preserve the strategy variant's canonical/301/differentiate/noindex remediation; reconcile the field-name divergence (`items` vs `warnings`) — a guessed-field-name hazard (CLAUDE.md read-before-write) — and the free-vs-Growth-gated divergence deliberately.

## Contract F — `assembleStoredKeywordStrategy(workspaceId)`

**Producer (Wave 3):** ONE assembler returning a typed `shared/types` shape, **table-as-truth**
after a backfill migration strips the legacy blob arrays. Single documented fallback policy.

**Full reader list (4 copy-pasted reassemblies to replace — verified):**
- `server/routes/keyword-strategy.ts:218-227` (admin; blob-fallback ternary).
- `server/routes/public-content.ts:133-148` (public; hand-copied ternary).
- `server/keyword-command-center.ts:1143-1144,1870-1871,2088-2089` (table-only, no fallback).
- `server/intelligence/seo-context-slice.ts:42-52` (table-only; note `pageMap` at :51 *does* fall back — internal inconsistency).
- `server/recommendations.ts:1494` (contentGaps table-only) + the dead `quickWins||[]` fallback at `:1439` (#22, fold in).

**Invariant:** the public field whitelist on `GET /api/public/seo-strategy/:id` is the spot a §public-read test must cover; preserve the gen-quality `backfilled` honesty flag through it. Migration order: backfill **all** workspaces → assembler table-only → swap one consumer per PR → delete fallbacks. Do **not** touch the persist `BEGIN IMMEDIATE` txn in the same PR.

## Contract G — `tracked_keywords` write path & provenance

**Producer (Wave 1 then Wave 3):** Wave 1 wraps every read-modify-write in
`db.transaction(...).immediate()`. Wave 3 promotes `tracked_keywords` from a JSON blob to a
`(workspace_id, normalized_query)` **row table** and routes ALL writes through ONE helper that
records a **non-remapped** origin + persists `sourcePageId`/`sourceGapKey`.

**Full writer list (4 write paths + the source-tagging remap — every write must use the guarded helper; verified):**
- `server/rank-tracking.ts:187-195,251-262,285-292` (manual add/remove/pin — `updateTrackedKeywords` RMW, currently unguarded).
- `server/keyword-command-center.ts:2222,2275` (KCC upsert/retire).
- `server/keyword-feedback.ts:213` (feedback approve → `addTrackedKeywords`).
- `server/rank-tracking-reconciliation.ts:159` (reconcile; runs from `keyword-strategy-generation.ts:328`, **outside** the persist txn).
- `server/keyword-feedback-tracking.ts` — the `trackedKeywordSourceForFeedback` remap. **DE-LAUNDERED (Wave 3d-ii):** `page_map`/`topic_cluster` approvals now map to `CLIENT_REQUESTED` (protected), NOT `STRATEGY_*`. Lifecycle ownership is carried by the decoupled `strategyOwned` flag (table column `strategy_owned`, three-state 0/1/NULL), of which `reconcileStrategyRankTracking` is the SOLE writer of `=1`. `isStrategyOwned` (reconciliation) and KCC `IN_STRATEGY` classification read `strategyOwned === true` — never the source enum — for **destructive** auto-deprecation. NEVER backfill `strategy_owned` from the source enum (re-bakes the bug).

**Equality:** all keyword joins use `keywordComparisonKey` / `normalizeKeywordForComparison`
(`shared/keyword-normalization.ts`) and ad-hoc `normalizeQuery` variants. The read-time
`inferTrackedKeywordSources` calls in KCC were **retired (Wave 3d-ii)** — KCC now reads the
stored source / `strategyOwned` directly; the inference ladder survives ONLY as the one-time
boot backfill stamp (`inferTrackedKeywordSourcesForWorkspace`, injected at `server/index.ts`).
This **is** the `intel-quality-keyword-normalization-route-reliability-hardening` roadmap item.

**Invariants:** never revert the persist `IMMEDIATE` upgrade; #1 (`IMMEDIATE`) ships before
#12 (row table); preserve pinned/manual/client retirement protection + inactive-row
auditability; the WS broadcast `source` vocabulary must align with the stored enum.

## Contract H — query keys & the Keywords↔Rank-Tracker deep-link

- **One query key** for `GET /api/rank-tracking/:id/keywords`: keep `rankTrackingKeywords`, delete `rankTrackingKeywordRows` (`src/lib/queryKeys.ts:92-93`); derive any "rows" shape via `select`. Update all invalidation sites (`RankTracker.tsx:232-238`, `useWsInvalidation.ts:377-378,392-393`, `useKeywordCommandCenter.ts:48-49,64-65`) so the surviving key can't go stale; `togglePin` must invalidate it.
- **Deep-link (`?tab=` two-halves contract):** `KeywordCommandCenter.tsx:252-254` + `keyword-command-center/KeywordDetailDrawer.tsx:241` pass `?query=`/`location.state`; `RankTracker.tsx` reads `useSearchParams` to init `expandedQuery` + scroll-to (it has none today). The server next-action already carries the keyword + `targetTab` (`keyword-command-center.ts:513-519`). Match on the comparison key, not the display string. Contract test mirrors `tests/contract/tab-deep-link-wiring.test.ts`.

---

## pr-check rules to add (forward-looking)

1. Ban new `positionColor`/rank-color definitions outside the Contract-B authority module.
2. Ban new hand-rolled keyword/rank `<table>`/grid outside `KeywordTable`.
3. Ban bare `tracked_keywords` read-modify-write outside the Contract-G guarded helper.
4. Require `keywordComparisonKey` for keyword equality (flag ad-hoc `normalizeQuery` variants on keyword joins).

These are **forward-looking** — they must not false-positive on current code; they fire the moment a later wave reintroduces the pattern.
