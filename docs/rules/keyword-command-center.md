# Keyword Command Center

The Keyword Command Center is the admin operating layer for keyword lifecycle management. It lives at `/ws/:workspaceId/seo-keywords` and owns the question, "What keywords exist, where did they come from, what state are they in, and what safe action comes next?"

## Surface Boundaries

- **Command Center owns lifecycle operations:** track, pause, retire, decline, restore, and promote raw evidence into the active operating loop.
- **Rank Tracker remains measurement-only:** ranking history, current positions, and snapshot capture belong there. Do not add broad management workflows to Rank Tracker when the action is keyword lifecycle state.
- **Strategy remains generation/explanation:** strategy can explain selected terms and regeneration diffs, but it should not become the primary keyword manager.
- **Page Intelligence remains page-first:** it can show a mapped page keyword and hand off to the Command Center, but keyword-universe filtering belongs in the Command Center.
- **Client Strategy remains client-safe:** client feedback and tracked keywords feed the Command Center, but admin-only raw/provider evidence labels must not leak into client copy.

## Data Contract

- Use `shared/types/keyword-command-center.ts` for rows, filters, actions, counts, tracking state, feedback state, and next-action payloads.
- Use `normalizeKeywordForComparison()` from `shared/keyword-normalization.ts` for Command Center joins and touched keyword lifecycle comparisons.
- Preserve raw display strings for user-facing keyword labels and provider payloads. Canonical normalization is for equality, dedupe, and map keys.
- Raw provider evidence must be labeled as evidence, not a selected strategy action.
- Inactive lifecycle rows are preserved for auditability; active rank views should continue hiding paused/deprecated/replaced rows by default.

## Value Scoring (the `opportunity` sort)

- When the `keyword-value-scoring` flag is **ON**, the `opportunity` sort uses `computeKeywordValueScore` (`server/scoring/keyword-value-score.ts`) precomputed **once per key** — at candidate merge-back (`addCandidateKeysFromBundle`) and at row finalize (`finalizeDraftRow`), using the **same function + same per-request `ScoringContext`** (built once via `buildValueScoringConfig`: `getLocalSeoPosture` + `listLocalSeoMarkets` + `businessProfile.address`, never per keyword). The accessor is then a trivial **field read** of the precomputed score (`candidate.valueScore` on the candidate side, the `rowValueScore` WeakMap on the row side). **Never recompute the score inside the comparator** — `keywordSortComparator` runs the accessor `O(n log n)` times.
- The accessor SET is selected by one conditional at the sorter dispatch (`sortRowsForQuery` / `candidateSortForQuery` take a `valueScoringOn` flag); both stages must pick the SAME branch from the SAME request flag, or candidate↔row order drifts.
- `intent` (from `pageMap.searchIntent` → `contentGaps.intent` → `trackedKeywords.intent`, in that source order) and `cpc` (from `trackedKeywords`) must be merged **symmetrically** in BOTH `resolveBundleMetrics` and `populateDraftRows` so the per-key score inputs are parity-guaranteed.
- When the flag is **OFF**, `valueScore` is never populated and the accessor is exactly today's `computeOpportunityScore({ volume, difficulty })` for both stages — rows, order, and scores are **byte-identical** to pre-flag. The flag-OFF path does **no** extra DB work (`buildValueScoringConfig` skips the posture/markets reads).
- Drift guard: `__candidateRowMetricParityForTest` asserts candidate/row **key-set equality** AND per-key `valueScore` parity (it calls `ensureLocalVisibilityRows` on the row side to mirror the skinny path). A one-sided source addition or a per-stage scoring divergence fails it loudly.

## Value Scoring Layers (the Layer 1 / Layer 2 contract)

The platform has **two distinct value scorers**, by design. They share the same value DNA (intent × commercial value × demand × winnability × local) but answer different questions and must never be merged:

- **Layer 1 — `computeKeywordValueScore`** (`server/scoring/keyword-value-score.ts`): a keyword's *intrinsic worth* — a cheap, drift-free, position-agnostic relative 0–100. This is the **Hub** scorer (the `opportunity` sort above) and the **content-gap spine** input.
- **Layer 2 — `computeOpportunityValue`** (`server/scoring/opportunity-value.ts`): a recommendation's *action ROI* — an EMV/ROI model (`emvPerWeek × HorizonWeeks × businessFit × confidence × calibration ÷ effort`) with explainability components. **As of #1100 it is the *sole* canonical recommendation scorer** (the legacy `pickImpactScore` fallback was removed — never re-introduce it; pr-check rule `recommendation impactScore must flow from canonical OV scorer` guards this). `Recommendation.impactScore` flows only from `OpportunityScore.value`.

**Layer 1 → Layer 2 grounded spine.** For keyword-bearing content-gap branches, the Layer-1 keyword value `base` is fed into Layer 2 as the `opportunityScore` composite spine (`keyword-strategy-enrichment.ts`). This is the documented spine; it does **not** force the spine onto branches that legitimately use direct provider deltas (`ranking_opp` CTR-uplift, `ctr_opportunity` direct gap).

**One classifier — `deriveValueIntent`** (`server/scoring/keyword-value-score.ts`). All keyword intent — on BOTH layers — goes through this single function: provided-intent-first (`comparison → commercial`, 4-bucket passthrough via `toValueIntent`), else a deterministic `classifyLocalKeywordIntent` regex fallback from the keyword. It is **non-null by construction**. **Never add a parallel intent coercion** (the retired `toOpportunityIntent` + its inline copy are gone) — a second path re-opens the Hub-vs-recs `comparison` drift (0.7 vs the old 0.5 default) by construction. Call sites pass the keyword string (`PageKeywordMap.primaryKeyword` — NOT `.keyword`; `ContentGap.targetKeyword`) so the regex fallback can fire when `searchIntent` is absent.

**Surface ownership.** Keyword-ranking surfaces (Hub, content-plan, the keyword side of briefs/titles) render **Layer 1**; action/recommendation surfaces (recs, client briefing, ROI) render **Layer 2**. Post-#1100, Layer 2 is the sole canonical rec score, so this ownership is unambiguous.

## Mutation Rules

- No hard deletes from the Command Center. "Remove" means lifecycle retirement or feedback suppression.
- Manual, pinned, and client-requested keywords are protected from accidental retirement or decline. Actions that target them must require explicit confirmation/force semantics.
- Mutations must preserve rank history and metadata whenever possible.
- Mutations must broadcast the affected surfaces:
  - `WS_EVENTS.RANK_TRACKING_UPDATED` for tracking lifecycle changes.
  - `WS_EVENTS.STRATEGY_UPDATED` when strategy/feedback consideration changes.
  - `WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED` when feedback/suppression can affect strategy signals.
- Mutations must add activity entries for admin-visible lifecycle changes.
- No Command Center action may publish content, write live metadata, or regenerate strategy automatically.

## UI Rules

- Use shared primitives (`PageHeader`, `SectionCard`, `Badge`, `Button`, `ClickableRow`, `EmptyState`, form primitives) before hand-rolling UI.
- Teal is for safe actions and active filters, blue is for read-only metrics, amber is for review/protection posture, red is for decline/retire.
- The detail drawer must explicitly distinguish:
  - selected strategy keyword,
  - tracked keyword,
  - raw provider evidence,
  - client/admin feedback,
  - retired/declined lifecycle state.
- Handoffs should navigate with context only:
  - Generate brief → content planning/brief flow.
  - Review page → Page Intelligence.
  - View rankings → Rank Tracker.

## Follow-Up Boundary

The Command Center includes only the minimal shared keyword normalizer needed by this surface. The broader `intel-quality-keyword-normalization-route-reliability-hardening` roadmap item remains responsible for migrating legacy keyword equality variants and keyword-loop async routes across the repo before local SEO work begins.
