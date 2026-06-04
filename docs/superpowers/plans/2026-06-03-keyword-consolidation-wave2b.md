# Keyword Surface Consolidation — Wave 2b (KeywordTable surface migrations + lock-in)

> Contract + test-centric (per `PLAN_WRITING_GUIDE.md`). Surface details: `docs/superpowers/audits/2026-06-03-keyword-consolidation-wave2-audit.md`. Branch `feat/keyword-consolidation-wave2b` (off staging; Wave 2 primitives present).

**Goal:** Migrate the remaining hand-rolled keyword/rank tables onto the `KeywordTable` primitive (the dedup payoff), finish the deferred inline `positionColor` variants, and lock the consolidation in with forward-looking pr-check rules. **Behavior-preserving** — each migrated surface must render equivalently (component-tested); flag-OFF byte-identity preserved.

## Tasks (risk order)
- **B1 — finish inline `positionColor` variants** [Sonnet]: route the deferred inline 2-tier ternaries to the T1 authority (`ui/constants.positionColor`/`positionTone`): `SearchTab.tsx:222,233`, `SearchDetail.tsx:321,348`, `ContentPerformance.tsx:301,353`, `ContentTab.tsx:704`, `StrategyKeywordDrawer.tsx:143`, `RankTracker.tsx:500`. These were already emerald (or teal for RankTracker — teal→emerald is the accepted fix). Note any band/tail-bucket change; update any pinning test. Removes the last `positionColor` dups so pr-check rule #1 has zero false-positives.
- **B2 — SearchTab + SearchDetail raw tables → `KeywordTable`** [Sonnet]: replace the hand-rolled `<table>` markup with `KeywordTable` (sort headers, position via authority). Keep data wiring (`useQuery`/keys) verbatim. Component test: renders equivalent rows; SearchTab's "tracked vs all-queries" distinction preserved (add the explainer if absent).
- **B3 — RankTracker grid → `KeywordTable`** [Opus]: migrate the rank grid to `KeywordTable` (`changeSign='lowerIsBetter'`, pin/source/expand via slots, sparkline in the expand slot). **Byte-identity-ish** — the rendered table must match; do NOT change the Wave-1 cache wiring. Strong component test.
- **B4 — KCC `KeywordRow`/`VariantSubRow` → `KeywordTable`** [Opus]: the most complex — variant sub-row, selection, lifecycle action column, flag-gated local-seo columns. Use `KeywordTable`'s `renderActions`/variant/selection/local-seo slots. Preserve the cheap-vs-Evaluated variant contract + the 19-filter behavior (don't touch filters). Strong component test. **If migration would change behavior or is too risky, STOP and report — a wrapper that keeps KCC's current markup while adopting the shared cells is an acceptable fallback.**
- **B5 — forward-looking pr-check rules** [Sonnet, LAST]: (1) ban new `positionColor`/rank-color function definitions outside `ui/constants`; (2) ban new hand-rolled keyword/rank `<table>`/grid outside `KeywordTable`. Forward-looking (zero false-positives on the now-migrated code). Fixture tests; `npm run rules:generate`.

## Constraints
Behavior-preserving; component tests per migration; flag-OFF byte-identity; Four Laws; reuse `ui` primitives; do NOT alter `useQuery`/`useMutation`/`queryKeys` or generation code. Each task = its own commit, component-tested, gates green. Whole-wave review before PR.

## Verification
Per task: `npm run typecheck` · `npx vite build` · the component test · `npx tsx scripts/pr-check.ts`. Wave-end: full suite + scaled-code-review + grep `purple-` in `src/components/client/`.
