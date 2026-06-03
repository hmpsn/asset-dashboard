# Keyword Surface Consolidation — Wave 2 Implementation Plan (shared UI primitives)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
>
> **CONTRACT + TEST-CENTRIC** (per `docs/PLAN_WRITING_GUIDE.md`). This plan gives **contracts**, **test assertions**, **constraints**, and the **exact call-site lists live in the audit** (`docs/superpowers/audits/2026-06-03-keyword-consolidation-wave2-audit.md`, 126 sites). Implementation bodies are written at **execution** against the real code with a real red→green loop — not pre-baked here.

**Goal:** Collapse the duplicated keyword/rank UI onto canonical primitives — one `positionColor`, one volume/KD formatter, one `KeywordTable` (subsuming `RankTable`), one audience-parameterized `ContentGapRow`, one `CannibalizationAlert`, one page-map leaf cell — without changing rendered behavior except the one deliberate Four-Laws fix.

**Branch:** `feat/keyword-consolidation-wave2` (stacked on Wave 1). **Flag posture:** `seo-generation-quality` is dark (default OFF) — **preserve flag-OFF byte-identity** (gen-quality Contract 3). Do NOT change generation-surface code.

---

## Standing constraints (every task)
- **Read real code first; real red→green** (write the failing test, SEE it fail for the right reason, then implement). No tautological tests.
- **Four Laws of color** (CLAUDE.md): emerald = success, teal = actions. Read-only rank metrics must NOT use teal.
- **Reuse existing primitives** (audit §"Existing primitives to reuse"): `SectionCard`, `EmptyState`, `Skeleton`/`LoadingState.TableSkeleton`, `Badge`, `ClickableRow`, `TierGate`, `kdFraming`. Never hand-roll a card/stat.
- **Wave-1 wiring is frozen** — do NOT alter `useQuery`/`useMutation`/`queryKeys`/`select` in `RankTracker.tsx`/`KeywordStrategy.tsx` (the rankTrackingKeywords cache). Migrate markup only.
- **Class-string churn:** accent-token vs raw-tailwind can be visually identical but different class strings. When re-pointing a `positionColor` call site, either confirm the class string is unchanged OR explicitly note the accepted churn (no snapshot test asserts exact class — verify).

---

## Task dependency graph
```
Phase 1 (parallel, land FIRST — leaf utilities):
  T1 positionColor authority   ∥   T2 fmtNum + kdColor/kdLabel authority
        (both touch pageIntelligenceDisplay.ts → pre-commit its final shape, or serialize T1→T2 on that file)
  T7 pr-check rules (after T1 lands the authority module)
Phase 2 (after T1+T2):  T3 KeywordTable  ∥  T6 page-map leaf cell  ∥  T5 CannibalizationAlert (indep)
Phase 3 (after T2; FLAG-SENSITIVE):  T4 ContentGapRow
Phase 4 (after T3):  migrate each KeywordTable bypass surface (one owner per surface)
```

---

## T1 — `positionColor` authority (#4)  [Sonnet]
**Files:** `src/components/ui/constants.ts` (create the authority), `src/components/page-intelligence/pageIntelligenceDisplay.ts` (re-export/delegate), `tests/unit/page-intelligence-display.test.ts` (update the token lock — lockstep). Migrate the 5 standalone defs + ~9 inline variants per audit §positionColor.
**Contract:**
```ts
// src/components/ui/constants.ts  (pure, React-free)
export function positionColor(pos?: number | null): string   // accent tokens; bands 3/10/20; undefined/0 → muted
export function positionTone(pos?: number | null): BadgeTone  // for the Badge path (PageKeywordMapContent)
```
- **Resolve the Four-Laws bug:** ≤10 band → **emerald (`accent-success`)**, NOT teal. (`pageIntelligenceDisplay`/`KeywordStrategy`/`RankTracker` currently use teal at ≤10.) The undefined/0→muted guard is the superset.
- `pageIntelligenceDisplay.positionColor` re-exports/delegates to the authority (keeps barrel imports + the unit test contract working). Delete the inline copies in `KeywordStrategy.tsx:240` (byte-identical to B) and route `LowHangingFruit` to import the authority instead of taking a prop.
**Test assertions (red first):** a unit test for the authority: `positionColor(undefined)`/`(0)` → muted; `(3)` → success; `(10)` → **success/emerald** (the fix); `(20)` → warning; `(21)` → danger. **Update `page-intelligence-display.test.ts:25-30`** in the same commit to expect emerald at `(10)` — and flag this as a reviewed *visual change* on page-intelligence surfaces.
**Constraints:** the teal→emerald change is a deliberate, reviewed visual change (the only intended behavior change in Wave 2). Every other migrated call site must keep its rendered hue identical (they were already emerald) — verify class strings.

## T2 — `fmtNum` + `kdColor`/`kdLabel` authority (#16/#17)  [Sonnet]
**Files:** `src/utils/formatNumbers.ts` (canonical `fmtNum` exists), `src/components/page-intelligence/pageIntelligenceDisplay.ts` / `src/lib/kdFraming.ts` (host `kdColor`/`kdLabel`), `kccDisplayHelpers.ts` (reconcile `compactNumber`). Migrate the 6 named volume dups + inline sites + the KD helpers per audit §formatters.
**Contract:** one volume formatter `fmtNum` (decide casing `K` vs `k` + the `/mo` suffix convention deliberately; **preserve null-handling** — `compactNumber` returns `'-'`); one `kdColor(kd)` + `kdLabel(kd)` with ONE band scheme (the audit proposes 30/50/70 or an audience flag for the admin 4th orange band). Delete the named dups (`strategyKeywordDisplay.fmtNum`, `ContentGaps.fmtNum`, `InsightsEngine.num`, `FixRecommendations.num`, `compactNumber`→`fmtNum`).
**Test assertions (red first):** a formatter unit test pinning the chosen volume output + null handling, and `kdColor`/`kdLabel` band outputs. Each consumer's visible output must be intentional (note any casing change as a reviewed visual change).
**Constraints:** `FixRecommendations.tsx` is HELD (dead) — if it uses `num`, leave it or update minimally without un-holding it. Don't alter flag-gated gen-quality rendering.

## T3 — `KeywordTable` primitive (#3)  [Opus]
**Files:** grow `src/components/shared/RankTable.tsx` → `KeywordTable` (fold in `RankRow`/`RankChange`/`RankTable`/`RankTrackingSection`; keep `RankHistoryChart` sibling). Consumes T1+T2.
**Contract:** a generic `KeywordTable` with: a superset/generic row type (reconciling `RankEntry`+previousPosition / `latestRanks`+ctr / `LatestRank`+pinned/source/pagePath); a `renderActions` slot (pin/remove/open-page/next-action badges); an optional variant sub-row slot (KCC — generalize the existing `KEYWORD_ROW_GRID`, don't invent a new grid string); a selection checkbox option; **column-level flag-gated local-seo columns**; sort headers; per-row expand (sparkline / GSC grid); built-in `EmptyState` + `TableSkeleton` (fix RankTable's null-return); a density/compact variant. **Resolve the change-sign conflict** (`RankChange`: change>0=good vs `RankTracker`: change<0=good) via an explicit sign param.
**Test assertions (red first):** component tests (`tests/component/`, `@testing-library/react`, `vi.mock` pattern at `RankTracker.test.tsx`) asserting: rows render with shared `positionColor`/`fmtNum`; `renderActions` slot renders; empty → `EmptyState`; loading → skeleton; the sign param flips the change indicator correctly. Build the primitive in this task; migrations are Phase 4.
**Constraints:** do NOT disturb Wave-1 cache wiring. Preserve the KCC variant column contract + flag-gated local-seo columns.

## T4 — `ContentGapRow` (#5, FLAG-SENSITIVE)  [Opus]
**Files:** `src/components/strategy/ContentGaps.tsx`, `src/components/client/strategy/StrategyContentOpportunitiesSection.tsx`, `src/components/client/Briefing/RecommendedForYou.tsx` (the 3 renderers, 1 call site each). Consumes T2.
**Contract:** ONE audience-parameterized `ContentGapRow` with axes: (a) KD prefix `KD`|`Difficulty`; (b) SERP label set `plain|descriptive|emoji`; (c) intentTone map; (d) est-clicks mode `always|flag-gated|never`; (e) **`ovGainActive` (briefing only, default `false`)**; (f) `backfilled` "Expanded pick" slot (field-presence-driven). Container = `SectionCard`. Reuse `kdFraming`/`kdTooltip` + canonical `fmtNum` + shared `kdColor`.
**FLAG-OFF byte-identity (hard):** preserve the **two exact deltas** in the briefing path (audit §flag-OFF):
- Δ1 badge: `ovGainActive ? \`Opportunity ${score}\` : \`${score}/100\`` (Badge tone="blue", shape="pill", `ml-2`).
- Δ2 est-clicks: `!ovGainActive && volume>0` → `~{fmtNum(round(volume*0.103))}/mo est. clicks at rank #3`, `impact<10 → null`. **Preserve `0.103` and the `<10` floor verbatim.**
- Triple OFF-default (absent prop / `undefined` / explicit `false`) must all render the OFF surface. **No client `useFeatureFlag` read** — thread the server-resolved `ovGainActive` prop exactly as today. Do NOT thread `ovGainActive` into the admin/strategy-tab consumers. Do NOT alter the `StrategyContentOpportunitiesSection` backfilled sort/affordance.
**Test assertions (red first):** re-point `tests/unit/RecommendedForYou.test.tsx` (or add `ContentGapRow.test.tsx`) at the shared component: OFF (and absent prop) → `NN/100` + `~824/mo est. clicks at rank #3` present, `Opportunity NN` absent; ON → inverse. This is the byte-identity gate — it MUST pass unchanged.

## T5 — `CannibalizationAlert` unification (#14)  [Sonnet]
**Files:** `src/components/strategy/CannibalizationAlert.tsx`, `src/components/admin/CannibalizationAlert.tsx`, `shared/types` (new `CannibalizationEntry` superset). 2 call sites (`KeywordStrategy` ungated; `ContentPipeline` growth-gated).
**Contract:** a `CannibalizationEntry` superset type (`{ keyword; severity; pages: {path; position?; impressions?; clicks?; source?}[]; recommendation?; action?; canonicalPath? }`); admin `string[]` paths map via `{ path }`. ONE component `(entries, { tier?, variant?: 'detailed'|'compact' })` rendering via `SectionCard`; **TierGate applied ONLY when `tier` is provided** (KeywordStrategy stays ungated, ContentPipeline stays growth-gated). Preserve the strategy variant's richer remediation (`canonical_tag`/`redirect_301`/`differentiate`/`noindex`). Reuse `normalizePageUrl` for full-URL inputs.
**Test assertions (red first):** component test asserting both shapes render via the one component; tier-provided → gated, tier-absent → ungated; remediation actions preserved.

## T6 — page-map leaf `<KeywordMetricCell>` (#15)  [Sonnet]
**Files:** extract a leaf from `src/components/client/PageKeywordMapContent.tsx` + `src/components/page-intelligence/PageIntelligencePageRow.tsx`. Consumes T1+T2.
**Contract:** a small `<KeywordMetricCell>` (volume + KD + position) consuming `pageIntelligenceDisplay` (positionColor/kdColor/kdLabel) + `fmtNum`, **parameterizing** position rendering (Badge tone vs colored span) + the optional `~` partial-match marker, so each surface keeps its presentation while sharing the authority. **Preserve the ADR-0004 client/admin affordance split** (admin: intent/optimization-score/track; client: TierGate/feedback/content-request) — share only the metric cell.
**Test assertions (red first):** component test: the cell renders volume/KD/position via the shared authority for both Badge and span modes; the `~` marker appears only when partial-match.

## T7 — forward-looking pr-check rules  [Sonnet]
**Files:** `scripts/pr-check.ts` (+ `tests/pr-check.test.ts`, regen `automated-rules.md`). After T1 lands the authority.
**Contract:** two **forward-looking** rules (fire only on NEW reintroductions, zero false-positives on current post-migration code): (1) ban new `positionColor`/rank-color definitions outside the authority module; (2) ban new hand-rolled keyword/rank `<table>`/grid outside `KeywordTable`. Follow `docs/rules/pr-check-rule-authoring.md`; add fixture tests (trigger + hatch + negative); run `npm run rules:generate`.

## Phase 4 — migrate KeywordTable bypass surfaces (after T3)  [Haiku→Sonnet]
One owner per surface (exclusive files): RankTracker grid, KCC `KeywordRow`/`VariantSubRow`, `SearchTab` raw table, `SearchDetail` raw table, `LowHangingFruit`, `KeywordGaps`, `RankingsSnapshot`, `PageKeywordMapContent` leaf grid. Each: swap markup to `KeywordTable`/shared cells, keep data wiring verbatim, component test green. **Haiku** for mechanical flex/grid swaps; **Sonnet** for RankTracker (sparkline/pin/sign) + KCC (variant/selection/flag columns).

---

## Systemic improvements
- Shared utilities (T1 `positionColor`/`positionTone`; T2 `fmtNum`/`kdColor`/`kdLabel`; T3 `KeywordTable`; T4 `ContentGapRow`; T5 `CannibalizationEntry`+component; T6 `KeywordMetricCell`).
- pr-check rules (T7, forward-looking).
- Tests: authority unit tests; `KeywordTable`/`CannibalizationAlert`/`KeywordMetricCell` component tests; the `ContentGapRow` flag-OFF byte-identity gate; the `page-intelligence-display` token-lock update.

## Verification (per task + wave)
`npm run typecheck` · `npx vite build` · the task's `npx vitest run <component/unit test>` · `npx tsx scripts/pr-check.ts` · `npm run verify:feature-flags`. Wave-end: full suite + `scaled-code-review` (multi-agent batch) + grep `purple-` in `src/components/client/` (Four Laws). Next free integration port **13888** (only if a public-read test is added; most Wave 2 tests are pure component/unit, no port).

## Flag boundaries & risk
Preserve `seo-generation-quality` flag-OFF byte-identity (T4 is the only flag surface — the two `RecommendedForYou` deltas). The `positionColor` teal→emerald fix is the one deliberate visual change (update the token-lock test in lockstep, flag for review). Do NOT touch generation-surface code or the `StrategyContentOpportunitiesSection` backfilled affordance.
