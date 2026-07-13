# Keyword Hub

The Keyword Hub is the admin operating layer for keyword lifecycle management. It lives at `/ws/:workspaceId/seo-keywords` and owns the question, "What keywords exist, where did they come from, what state are they in, and what safe action comes next?"

> **Cutover note (2026-06-11).** The Hub is now the **only** keyword surface. It absorbed the former standalone Keyword Command Center (`seo-keywords`) and the standalone Rank Tracker (`seo-ranks`, now a redirect → `seo-keywords`). Rank history, current positions, and snapshot capture are surfaced inside the Hub (the detail drawer's national-rank section). The `keyword-hub` feature flag was retired at this cutover. The server module + shared types below were **not** renamed — they keep their `keyword-command-center` identifiers (`server/keyword-command-center.ts`, `shared/types/keyword-command-center.ts`, `/api/webflow/keyword-command-center/...` routes), which the Hub consumes directly.

## Surface Boundaries

- **The Hub owns lifecycle operations:** track, pause, retire, decline, restore, and promote raw evidence into the active operating loop.
- **The Hub owns rank measurement:** ranking history, current positions, and snapshot capture are surfaced in the Hub's detail drawer (national-rank section + history chart). There is no longer a separate Rank Tracker surface.
- **Strategy remains generation/explanation:** strategy can explain selected terms and regeneration diffs, but it should not become the primary keyword manager.
- **Page Intelligence remains page-first:** it can show a mapped page keyword and hand off to the Hub, but keyword-universe filtering belongs in the Hub.
- **Client Strategy remains client-safe:** client feedback and tracked keywords feed the Hub, but admin-only raw/provider evidence labels must not leak into client copy.

## Data Contract

- Use `shared/types/keyword-command-center.ts` for rows, filters, actions, counts, tracking state, feedback state, and next-action payloads.
- Use `normalizeKeywordForComparison()` from `shared/keyword-normalization.ts` for Hub joins and touched keyword lifecycle comparisons.
- Preserve raw display strings for user-facing keyword labels and provider payloads. Canonical normalization is for equality, dedupe, and map keys.
- Raw provider evidence must be labeled as evidence, not a selected strategy action.
- Inactive lifecycle rows are preserved for auditability; active rank views should continue hiding paused/deprecated/replaced rows by default.

## Skinny read paths and local candidates

- The Hub's rows/summary/detail/initial endpoints take the **skinny** path (`buildKeywordCommandCenterRowsSkinny` for rows and initial rows): a page-bounded source bundle, never the full keyword-universe model.
- First paint uses `buildKeywordCommandCenterInitialView()` to return the existing summary shape plus the existing rows/pageInfo shape from one shared source snapshot. `/summary`, `/rows`, and `/detail` remain compatibility endpoints and must preserve their public response shapes.
- The retired full-model builder (`buildKeywordCommandCenterModel` / `model-service.ts`) must not be reintroduced. pr-check rule **`Keyword Command Center read paths must not use full model`** keeps the facade and all KCC domain read services on source snapshots or skinny projections.
- **`local_candidates` advanced filter.** `/rows?filter=local_candidates` now uses a skinny local-candidate projection: call the cheap `buildLocalSeoKeywordCandidates()` default, prioritize unselected candidates before selected candidates, apply `LOCAL_CANDIDATE_ROW_LIMIT`, then finalize only that capped candidate slice through the normal row finalizer. The uncapped keyword-universe path (`UNIVERSE_SAFETY_CEILING`, unconditional since the `keyword-universe-full` flag was retired in flag-sunset Wave 2b) does NOT lift this cap. `/initial?filter=local_candidates` is rejected so first paint cannot enter the advanced filter indirectly; the client falls back to the normal capped `/rows` read for that filter.
- The `not_checked` filter literal remains in shared types and route validation for compatibility, but summary filter metadata does not expose a "Not Checked" advanced facet because the skinny source-key path intentionally returns no rows for it.

### KCC-owned projection and first-paint cache contract

- `server/domains/keyword-command-center/read-projection.ts` is the KCC read authority. It reads the lite page projection plus content gaps, keyword gaps, and site metrics once; summary-only cluster/cannibalization sources are conditional. Do not route KCC reads through `assembleStoredKeywordStrategy()`.
- Normalized arrays preserve the established table-first, blob-fallback rule (`tableRows.length > 0 ? tableRows : blobRows`) and their source ordering. Page assignments remain table-only; the blob never authoritatively owns `pageMap`.
- `/initial` is a first-mount transport optimization, not an interaction endpoint. Its transport query key is deliberately outside the canonical KCC prefix, uses infinite freshness, and is never replayed by mutation or workspace-event invalidation. The initial hook seeds the canonical summary key and the exact first rows key; both UIs render those canonical observers immediately after hydration. Search, filter, sort, lens, and pagination changes use `/rows` with React Query previous-data retention; canonical invalidation refreshes `/summary` and active `/rows` only. Summary retry/refetch must always call `/summary`, never `/initial`.
- Rank freshness comes from the latest authoritative `rank_snapshots.date`, exposed as `rankFreshness { snapshotDate, ageDays, status }` on summary and rows responses. A snapshot is `stale` after 14 whole days, matching the existing outcome-measurement tolerance; absent data is `missing`. UI copy must never substitute strategy generation time or request time for rank observation time.
- Performance budget: no AI/external calls, at most 22 executed SQL statements per `/initial` or `/rows` request, and a production p95 target below 250ms. CI hard-gates executed SQL through the test-only better-sqlite3 execution counter and pins one read per normalized projection source. Seeded wall-clock p50/p95 is recorded as advisory evidence because shared-runner contention makes elapsed-time assertions nondeterministic; production telemetry owns the 250ms release signal.

Local advisory evidence (2026-07-13, 400-page seeded fixture, 30 warmed samples): interaction p50 `49.60ms → 38.50ms` (-22%), p95 `65.32ms → 44.76ms` (-31%). Independently of timing, the deterministic CI test hard-fails above 22 executed SQL statements and pins every normalized projection source to exactly one read.

## Value Scoring (the `opportunity` sort)

- The `opportunity` sort uses `computeKeywordValueScore` (`server/scoring/keyword-value-score.ts`) precomputed **once per key** — at candidate merge-back (`addCandidateKeysFromBundle`) and at row finalize (`finalizeDraftRow`), using the **same function + same per-request `ScoringContext`** (built once via `buildKeywordValueScoringContext`: `getLocalSeoPosture` + `listLocalSeoMarkets` + `businessProfile.address`, never per keyword). The accessor is then a trivial **field read** of the precomputed score (`candidate.valueScore` on the candidate side, the `rowValueScore` WeakMap on the row side). **Never recompute the score inside the comparator** — `keywordSortComparator` runs the accessor `O(n log n)` times. Value-first scoring is **unconditional** (the `keyword-value-scoring` flag was retired in SEO Decision Engine P1, 2026-06-23); `computeOpportunityScore` remains only as the signal-gate fallback + backfill/projection basis.
- There is one `opportunity` accessor (the value-first field read), shared by `sortRowsForQuery` and `candidateSortForQuery`. Both stages read the same precomputed score per key (`rowValueScore` WeakMap / `candidate.valueScore`), so candidate↔row order cannot drift.
- `intent` (from `pageMap.searchIntent` → `contentGaps.intent` → `trackedKeywords.intent`, in that source order) and `cpc` (from `trackedKeywords`) must be merged **symmetrically** in BOTH `resolveBundleMetrics` and `populateDraftRows` so the per-key score inputs are parity-guaranteed.
- `buildValueScoringConfig` remains as the Keyword Command Center compatibility wrapper around `buildKeywordValueScoringContext`; cross-surface callers should import the scoring-owned helper instead of reaching into the KCC domain.
- Drift guard: `__candidateRowMetricParityForTest` asserts candidate/row **key-set equality** AND per-key `valueScore` parity (it calls `ensureLocalVisibilityRows` on the row side to mirror the skinny path). A one-sided source addition or a per-stage scoring divergence fails it loudly.

## Value Scoring Layers (the Layer 1 / Layer 2 contract)

The platform has **two distinct value scorers**, by design. They share the same value DNA (intent × commercial value × demand × winnability × local) but answer different questions and must never be merged:

- **Layer 1 — `computeKeywordValueScore`** (`server/scoring/keyword-value-score.ts`): a keyword's *intrinsic worth* — a cheap, drift-free, position-agnostic relative 0–100. This is the **Hub** scorer (the `opportunity` sort above) and the **content-gap spine** input.
- **Layer 2 — `computeOpportunityValue`** (`server/scoring/opportunity-value.ts`): a recommendation's *action ROI* — an EMV/ROI model (`emvPerWeek × HorizonWeeks × businessFit × confidence × calibration ÷ effort`) with explainability components. **As of #1100 it is the *sole* canonical recommendation scorer** (the legacy `pickImpactScore` fallback was removed — never re-introduce it; pr-check rule `recommendation impactScore must flow from canonical OV scorer` guards this). `Recommendation.impactScore` flows only from `OpportunityScore.value`.

**Layer 1 → Layer 2 grounded spine.** For keyword-bearing content-gap branches, the Layer-1 keyword value `base` is fed into Layer 2 as the `opportunityScore` composite spine (`keyword-strategy-enrichment.ts`). This is the documented spine; it does **not** force the spine onto branches that legitimately use direct provider deltas (`ranking_opp` CTR-uplift, `ctr_opportunity` direct gap).

**One classifier — `deriveValueIntent`** (`server/scoring/keyword-value-score.ts`). All keyword intent — on BOTH layers — goes through this single function: provided-intent-first (`comparison → commercial`, 4-bucket passthrough via `toValueIntent`), else a deterministic `classifyLocalKeywordIntent` regex fallback from the keyword. It is **non-null by construction**. **Never add a parallel intent coercion** (the retired `toOpportunityIntent` + its inline copy are gone) — a second path re-opens the Hub-vs-recs `comparison` drift (0.7 vs the old 0.5 default) by construction. Call sites pass the keyword string (`PageKeywordMap.primaryKeyword` — NOT `.keyword`; `ContentGap.targetKeyword`) so the regex fallback can fire when `searchIntent` is absent.

**Surface ownership.** Keyword-ranking surfaces (Hub, content-plan, the keyword side of briefs/titles, and keyword-bearing briefing recommendation order) rank by **Layer 1**. Action/recommendation surfaces (recommendation impact, client briefing display score, ROI) render **Layer 2**. Post-#1100, Layer 2 is the sole canonical recommendation score, so do not replace public recommendation display semantics with Layer 1.

## Mutation Rules

- Default "Remove" means lifecycle retirement or feedback suppression — NOT a row delete.
- **Hard-delete exception (P3-3c).** A deliberate, narrow hard-delete channel exists: `deleteKeywordHard()` (`server/keyword-command-center.ts`), exposed via `DELETE /api/webflow/keyword-command-center/:workspaceId/keywords/:keyword`. It is eligible ONLY for `source === MANUAL`, unpinned, non-client-requested, non-strategy-owned, non-gap-provenance rows (`isHardDeleteEligible`); ineligible rows throw without `?force=true`. It is a SEPARATE channel — never in `KEYWORD_COMMAND_CENTER_ACTIONS`, never a default/bulk action — and it **intentionally drops rank history**. This is the one sanctioned exception to "no hard deletes"; everything else still retires/suppresses. (Note: the former standalone Rank Tracker untrack endpoint, `DELETE /api/rank-tracking/:workspaceId/keywords/:query`, was removed at the Hub cutover; the Hub's hard-delete + lifecycle-retire channels are the surviving keyword-removal paths. The pin endpoint `PATCH /api/rank-tracking/:workspaceId/keywords/:query/pin` survives — the Hub drawer's pin toggle uses it.)
- Manual, pinned, and client-requested keywords are protected from accidental retirement or decline. Actions that target them must require explicit confirmation/force semantics.
- Mutations must preserve rank history and metadata whenever possible (the P3-3c hard delete is the documented exception).
- Mutations must broadcast the affected surfaces:
  - `WS_EVENTS.RANK_TRACKING_UPDATED` for tracking lifecycle changes.
  - `WS_EVENTS.STRATEGY_UPDATED` when strategy/feedback consideration changes.
  - `WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED` when feedback/suppression can affect strategy signals.
- Mutations must add activity entries for admin-visible lifecycle changes.
- No Hub action may publish content, write live metadata, or regenerate strategy automatically.

## UI Rules

- Use shared primitives (`PageHeader`, `SectionCard`, `Badge`, `Button`, `ClickableRow`, `EmptyState`, form primitives) before hand-rolling UI.
- Teal is for safe actions and active filters, blue is for read-only metrics, amber is for review/protection posture, red is for decline/retire.
- The detail drawer must explicitly distinguish:
  - selected strategy keyword,
  - tracked keyword,
  - raw provider evidence,
  - client/admin feedback,
  - retired/declined lifecycle state.
- The detail drawer's national-rank section surfaces multi-keyword rank history (`RankHistoryChart`) and the pin toggle — both folded in from the retired Rank Tracker.
- Handoffs should navigate with context only:
  - Generate brief → content planning/brief flow.
  - Review page → Page Intelligence.

## Follow-Up Boundary

The Hub includes only the minimal shared keyword normalizer needed by this surface. The broader `intel-quality-keyword-normalization-route-reliability-hardening` roadmap item remains responsible for migrating legacy keyword equality variants and keyword-loop async routes across the repo before local SEO work begins.
