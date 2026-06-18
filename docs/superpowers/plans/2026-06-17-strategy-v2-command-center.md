# Strategy v2 — SEO Command Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **PLAN FORMAT — read this first.** Per `docs/PLAN_WRITING_GUIDE.md`, this plan is **contract + test-centric**, which *overrides* the generic writing-plans "complete implementation code in every step" default. Each task locks the **contract** (signatures/types), the **test assertions** (behavioral spec), **constraints/gotchas**, **file ownership**, and **exact verification commands** — NOT a pre-written implementation body. Execution discipline for every task: (1) READ the real current code; (2) write the failing test from the assertions and RUN it (confirm it fails for the right reason); (3) implement minimally against the *real* signatures; (4) RUN test + typecheck (green); (5) commit. **Never transcribe; never skip the red. If the real code contradicts a contract here, STOP and report.** Several files were marked "[need to read]" in the audit — reading-before-writing is mandatory, not optional.

**Goal:** Replace the ~20-card Strategy "wall" with a decision-first SEO command center — one visibility score + trend (Orient), one impact-ranked action queue (Act), and on-demand Content/Rankings/Competitive interior tabs (Evidence) — plus a thin client reframe, shipped phase-per-PR behind a new flag, byte-identical when off.

**Architecture:** Reuse-heavy recomposition (audit: 75 modules mapped, only 9 net-new). New top-level `?tab=overview|content|rankings|competitive` sub-routing under the existing Strategy surface (copying the proven `ContentPipeline` pattern), gated by a new `strategy-command-center` flag. The one net-new metric (a CTR-decay-weighted visibility score) is computed server-side in the intelligence layer. The action queue extends the existing `buildOpportunityRows` + recommendation engine; signals fold into it. Client view reframes the same server data with tier gating.

**Tech Stack:** React 19 + Vite + Tailwind 4 (frontend), Express + TS + better-sqlite3 (backend), recharts v3.8 + existing UI primitives (`MetricRing`, `AnnotatedTrendChart`, `ChartCard`, `TrendBadge`, `StatCard`, `TierGate`), React Query, WebSocket broadcasts.

**Inputs:** Spec `docs/superpowers/specs/2026-06-17-strategy-v2-command-center.md`; Audit `docs/superpowers/audits/2026-06-17-strategy-v2-command-center-audit.md`.

---

## Locked Decisions (owner-confirmed 2026-06-17)

1. **Orient hero = search-visibility score (NEW), CTR-decay-weighted.** Not the existing `calculateStrategyHealth` (that measures strategy progress; it may appear as a *secondary* stat, but the hero is visibility). Formula uses the existing calibrated CTR curve, NOT a linear `100 − pos×2.5`.
2. **30-day rankings movements (improved/declined/new/lost) are IN v1** (Rankings tab). ~20-line `useStrategyMetrics` extension behind the flag.
3. **"What Changed" (`StrategyDiff`) is RETIRED** from v2. History remains via `strategy_history` / activity log elsewhere.
4. **New flag `strategy-command-center`** — do NOT extend `strategy-decision-bands` (which gates layout only and is already scheduled for deletion). If both flags are ON during overlap, `strategy-command-center` wins.
5. **Zero-impact display:** queue rows whose computed impact is a real zero (zero-traffic `technical`/`freshness` criticals short-circuited to `fix_now`) render a **"Health fix"** chip, NOT "$0/mo". Urgency tier is decoupled from the impact pill.
6. **Inline keyword Track is retired from Strategy** — Track routes to the Keyword Hub via the existing deep-link. `useTrackKeyword` retires from Strategy surfaces (Hub owns tracking).
7. **`RequestedKeywordTriage` stays** (compact, in the Decide/Act area — an actionable admin queue item). The separate **declined-feedback admin card retires** (folds into queue context).
8. **Visibility score is admin-internal by default.** It is added to the client payload ONLY through the explicit client-safe serializer in Phase 6 (it describes the client's own site, so it is client-appropriate as a headline number). A pr-check guard prevents it leaking through the *generic* admin serializer; the per-keyword breakdown and EMV internals are never serialized.

---

## Bounded-Context Ownership

(Per `docs/rules/platform-organization.md`.)

- **Primary owner:** `analytics-intelligence` — recommendation/queue engine (`server/recommendations.ts`, `server/scoring/`), intelligence slices (`server/intelligence/*`), `useStrategyMetrics`, visibility score, Orient + Act zones.
- **Secondary:** `seo-health` (rankings distribution, backlinks/competitive provider routes), `content-pipeline` (gaps→briefs, Create-cluster CTA), `billing-monetization` (purchase/tier gating), `client-portal` (client reframe), `keyword-hub` (deep-link target; READ-ONLY from Strategy — no forks).
- **Shared coordination files (must be pre-committed in Phase 0 before any parallel dispatch):** `shared/types/feature-flags.ts`, `shared/types/intelligence.ts`, `shared/types/recommendations.ts`, `shared/types/decision.ts`, `src/components/strategy/types.ts`, `src/hooks/useFeatureFlag.ts`, `src/lib/tab-search-param.ts`, `server/activity-log.ts`, `src/lib/queryKeys.ts`, `server/ws-events.ts`.

---

## Cross-Phase Contracts (Phase 0 exports; all downstream phases import these)

```ts
// shared/types/feature-flags.ts — FEATURE_FLAG_CATALOG entry
'strategy-command-center': {
  key: 'strategy-command-center', group: 'Strategy', lifecycle: 'active',
  owner: 'analytics-intelligence', createdAt: '2026-06-17',
  rolloutTarget: 'staging-validation',
  removalCondition: 'Remove after v2 ships as default; legacy layout deleted',
}

// shared/types/intelligence.ts — extend SeoContextSlice.rankTracking
visibilityScore?: { current: number; delta: number | null } // 0–100; admin-internal (see Decision 8)

// server/scoring/visibility-score.ts (NEW)
export interface VisibilityInput { position: number | null; volume: number | null }
export function computeVisibilityScore(pages: VisibilityInput[]): number // 0–100, CTR-decay weighted

// src/components/strategy/types.ts (or new strategy-tabs.ts)
export const STRATEGY_INTERIOR_TABS = ['overview','content','rankings','competitive'] as const
export type StrategyInteriorTab = (typeof STRATEGY_INTERIOR_TABS)[number]

// src/hooks/useFeatureFlag.ts — add workspace-scoped variant
export function useWorkspaceFeatureFlag(flag: FeatureFlagKey, workspaceId: string): boolean

// shared/types/decision.ts — add source value
// NormalizedDecision source union gains: 'strategy_recommendation'

// server/activity-log.ts — ActivityType union gains: 'strategy_generated' (bug fix)
```

---

## Task Dependencies

```
Phase R (Reset — remove decision-bands layout)  ── first, standalone PR ──┐
Phase 0 (Contracts + score + bug fixes)          ── sequential, blocking ──┤
   ├─→ Phase 1 (Orient zone)                                               │
   └─→ Phase 2 (Act queue)                                                 │
Phase 0 + Phase 2 ─→ Phase 3 (Interior tab shell + Content tab)
Phase 3 ─→ Phase 4 (Rankings tab)  ∥  Phase 5 (Competitive tab)
Phases 1–5 ─→ Phase 6 (Client reframe)
```

Each phase = **one PR to `staging`**. Phase N+1 does not start until Phase N is merged and green. After Phase R, the **flag-OFF baseline is the original `legacyAnalysis`** layout; every v2 phase is gated by `strategy-command-center` and must be byte-identical to `legacyAnalysis` when the flag is off (verify per phase via real-browser DOM probe). At the very end, once v2 is the default, `legacyAnalysis` is deleted too → one layout.

---

## Phase R — Reset: remove the decision-bands layout (Model: Sonnet)

Standalone deletion PR — do NOT mix with Phase 0's additive contracts (keep the diff clean). After this lands, `legacyAnalysis` (the original pre-bands layout) is the sole shipped Strategy layout and the flag-OFF baseline for all v2 phases. Grounded by the bands blast-radius audit (this session).

**Owns:** `src/components/KeywordStrategy.tsx`, `shared/types/feature-flags.ts`, `src/components/strategy/index.ts`, the 4 bands-only wrapper files + their tests, `tests/component/KeywordStrategyBackgroundJob.test.tsx`. **Must not touch** the reusable leaf components (kept for v2).

**Checklist:**
- Remove the `strategy-decision-bands` flag everywhere: `FEATURE_FLAGS` entry, `FEATURE_FLAG_CATALOG` entry, the `'Strategy'` group membership (leave `signal-auto-recompute`). Run `npm run verify:feature-flags`.
- In `KeywordStrategy.tsx`: remove `decisionBandsEnabled`, the `bandsAnalysis` JSX block, the `if (decisionBandsEnabled) return bandsAnalysis` return, the bands-only summary-line conditional, and the `decisionBandsEnabled` arg to `useStrategySettings`. The legacy TabBar + `legacyAnalysis` return becomes the sole return path.
- Delete the 4 bands-only WRAPPERS (no v2 reuse): `StrategyBand`, `StrategyStatBar`, `StrategyHelpDisclosure`, `ManageInHubCard` + their unit tests + their `src/components/strategy/index.ts` exports.
- Update `tests/component/KeywordStrategyBackgroundJob.test.tsx`: drop the bands mock + the "renders decision-bands layout" case; keep a single-layout assertion.
- **KEEP (do NOT delete) the reusable leaves** — `DecisionQueue`, `OpportunitiesList`, `DecayingPagesCard`, `LostQueryRecoveryCard`, `CannibalizationTriage`, `RankingDistribution`, `ContentGaps`, `TopicClusters`, `KeywordGaps`, `BacklinkProfile`, `CompetitiveIntel`. Several become **temporarily orphaned** (zero importers) until Phases 1–5 re-home them — add an orphan-tracker comment to `index.ts` naming the v2 phase that re-imports each. *(Update: `AuthorityAndBacklinks` — the Phase-4 merged wrapper — was **removed in Phase 5**; the Competitive tab composes `BacklinkProfile` + `CompetitiveIntel` directly in research order rather than through the wrapper.)*
- **NEVER delete `CannibalizationAlert`** (`src/components/ui/`) — shared with `ContentPipeline`.
- Update `docs/superpowers/specs/2026-06-16-...redesign-design.md` (note supersession), `data/roadmap.json` (mark `strategy-decision-bands` removal satisfied), `FEATURE_AUDIT.md`.

**Risk to verify at execution:** if CI/pr-check runs an unused-export/dead-code check (knip/ts-prune), the orphaned leaves will trip it. If so, either keep the documented orphan-tracker suppression or pull Phase 1/2's first re-homing forward. Confirm before committing.

**Assertions:** `verify:feature-flags` green; `grep -rn "strategy-decision-bands\|decisionBandsEnabled\|bandsAnalysis\|StrategyBand" src tests` returns nothing; legacy layout renders unchanged (DOM probe); full vitest green.

**Gate:** all quality gates + flag verifier + DOM probe of the (now sole) legacy layout. PR to staging.

---

## Phase 0 — Contracts, Visibility Score, Bug Fixes (Model: Opus for score; Sonnet for contracts/bugs)

**Owns:** `shared/types/feature-flags.ts`, `shared/types/intelligence.ts`, `shared/types/decision.ts`, `src/components/strategy/types.ts`, `src/hooks/useFeatureFlag.ts`, `server/activity-log.ts`, `server/scoring/visibility-score.ts` (new), `server/intelligence/seo-context-slice.ts`, plus tests.
**Must not touch:** any Strategy component render path (later phases).

### Task 0.1 — `strategy-command-center` feature flag (Sonnet)
- **Files:** Modify `shared/types/feature-flags.ts` (catalog + Strategy group + lifecycle); Test: `tests/contract/feature-flags.test.ts` (or the existing flag-catalog verifier).
- **Contract:** catalog entry per Cross-Phase Contracts above.
- **Assertions:** `npm run verify:feature-flags` passes; flag present in catalog with `group:'Strategy'`, `lifecycle:'active'`; `isFeatureEnabled('strategy-command-center')` returns false by default.
- **Verify:** `npm run verify:feature-flags`.

### Task 0.2 — `useWorkspaceFeatureFlag` hook (Sonnet)
- **Files:** Modify `src/hooks/useFeatureFlag.ts` (add workspace-scoped variant calling `isFeatureEnabled(flag, workspaceId)` server-side via existing flag endpoint); Test: `tests/unit/useFeatureFlag.test.tsx`.
- **Contract:** `useWorkspaceFeatureFlag(flag, workspaceId): boolean`; returns static default (false) on cold cache (match existing `useFeatureFlag` semantics — see the Phase-5 settings-collapse async-flag lesson).
- **Assertions:** returns false before resolve; returns server value after resolve; does not throw when workspaceId is empty.
- **Verify:** `npx vitest run tests/unit/useFeatureFlag.test.tsx`.

### Task 0.3 — Visibility score helper (Opus)
- **Files:** Create `server/scoring/visibility-score.ts`; Test: `tests/unit/scoring/visibility-score.test.ts`.
- **Contract:** `computeVisibilityScore(pages: VisibilityInput[]): number`. Formula: `round(100 * Σ(volumeᵢ · ctrAt(positionᵢ)) / Σ(volumeᵢ · ctrAt(1)))` using `ctrAt()` from `server/scoring/ctr-curve.ts`. Unweighted mean of `ctrAt(position)/ctrAt(1)` when all volumes are null. Pages with null position contribute 0 capture but DO count in the denominator (unranked = lost opportunity). Empty input → 0.
- **Assertions:** all pages at position 1 → 100; all unranked (null position) → 0; a mid set is monotonic (improving any page's position never lowers the score); null-volume set falls back to unweighted and still returns 0–100; zero-traffic (all volume 0) → unweighted fallback, no divide-by-zero.
- **Constraints:** pure function, no DB/AI. Read `server/scoring/ctr-curve.ts` for the real `ctrAt`/`industryCtr` signatures before implementing — do NOT guess.
- **Verify:** `npx vitest run tests/unit/scoring/visibility-score.test.ts`.

### Task 0.4 — Wire visibility score into the seoContext slice (Opus)
- **Files:** Modify `shared/types/intelligence.ts` (add `rankTracking.visibilityScore`); Modify `server/intelligence/seo-context-slice.ts` (`assembleSeoContext` computes `{current, delta}`); Test: `tests/unit/intelligence/seo-context-slice.test.ts` (or existing slice test).
- **Contract:** `seoContext.rankTracking.visibilityScore = { current, delta }` where `current = computeVisibilityScore(pages)` from `PageKeywordMap` (`position` = `currentPosition`, `volume` = `volume`), and `delta = current − prior` from the prior `strategy_history` snapshot (null if no prior).
- **Assertions:** slice populates `visibilityScore.current` in 0–100; `delta` null when no prior snapshot; field is `.optional()` in any Zod schema for the slice (schema-vs-stored-shape rule).
- **Constraints:** READ `server/intelligence/seo-context-slice.ts` and `shared/types/workspace.ts:PageKeywordMap` first for exact field names (`currentPosition`, `volume`). Do NOT serialize this field through public/client serializers (Decision 8) — Phase 6 adds the client-safe path deliberately.
- **Verify:** `npx vitest run`, `npm run typecheck`.

### Task 0.5 — Fix `strategy_generated` ActivityType (Sonnet)
- **Files:** Modify `server/activity-log.ts` (add `'strategy_generated'` to `ActivityType` union); Test: assert `addActivity` accepts it without a type cast.
- **Assertions:** typecheck passes with the literal used un-casted; a test logs `strategy_generated` and reads it back.
- **Verify:** `npm run typecheck`, `npx vitest run`.

### Task 0.6 — Pre-commit shell + decision-source types (Sonnet)
- **Files:** Modify `src/components/strategy/types.ts` (`STRATEGY_INTERIOR_TABS` + `StrategyInteriorTab`); Modify `shared/types/decision.ts` (add `'strategy_recommendation'` to the source union — JSON payload, no DB migration).
- **Assertions:** typecheck passes; `STRATEGY_INTERIOR_TABS` includes the four tab ids; decision adapter exhaustiveness check (if any) still compiles.
- **Verify:** `npm run typecheck`.

**Phase 0 gate:** typecheck + build + full vitest + pr-check + `verify:feature-flags` all green. Flag OFF → zero behavior change (these are additive types/helpers + a flag default-false). Commit; PR to staging.

---

## Phase 1 — Orient Zone (Model: Sonnet UI; Opus only if score-rendering edge cases arise)

**Owns:** new `src/components/strategy/OrientZone.tsx` (or section within the orchestrator), `src/components/strategy/hooks/useStrategyMetrics.ts` (delta-field extension — isolate new fields), Orient layout in `KeywordStrategy.tsx` (flag-gated branch only). **Must not touch** the Act/queue leaves (Phase 2).
**Reuse:** `MetricRing`+`scoreColor()` (score ring), `AnnotatedTrendChart`+`ChartCard` (hero trend), `StatCard`+`TrendBadge` (4-stat strip), `StrategyStalenessNudges` (relocate above the score), `StrategyEmptyState`.

### Task 1.1 — Extend `useStrategyMetrics` with deltas + visibility score (Sonnet)
- **Files:** Modify `src/components/strategy/hooks/useStrategyMetrics.ts`; Test: `tests/unit/strategy/useStrategyMetrics.test.ts(x)`.
- **Contract:** add memoized `deltas: { clicks, impressions, avgPosition, rankedKw }` (current vs prior snapshot) and surface `visibilityScore` (from the seoContext slice / strategy payload). New fields are additive — existing return shape unchanged so flag-OFF consumers are untouched.
- **Assertions:** with a prior snapshot, deltas are signed numbers; with no prior, deltas are null; existing metrics (`ranked`, `top3/10/20`, `intentCounts`) byte-identical to before (snapshot/identity test).
- **Constraints:** READ the hook first (audit only read lines 1–89). Do not mutate existing fields.
- **Verify:** `npx vitest run tests/unit/strategy/useStrategyMetrics.test.tsx`.

### Task 1.2 — OrientZone component (Sonnet)
- **Files:** Create `src/components/strategy/OrientZone.tsx`; Test: `tests/component/strategy/OrientZone.test.tsx`.
- **Contract:** renders `MetricRing` with the visibility score colored via `scoreColor()`; the hero `AnnotatedTrendChart` (single organic-clicks `TrendLine`, 6mo) inside `ChartCard`; a 4-stat strip (`StatCard` × 4 with `TrendBadge` deltas); a one-line verdict; staleness nudges above the score.
- **Assertions:** score uses `scoreColor()` (no hardcoded score colors — pr-check); renders empty state when no strategy; no `purple-`/`violet`/`indigo`; one chart only.
- **Constraints:** Four Laws — teal=action, blue=data, emerald=good. READ `AnnotatedTrendChart` props before wiring (audit: lines 1–447).
- **Verify:** component test + `npx tsx scripts/pr-check.ts`.

### Task 1.3 — Flag-gated Orient branch in the orchestrator (Sonnet)
- **Files:** Modify `src/components/KeywordStrategy.tsx` (add `if (commandCenterEnabled) render OrientZone …`; legacy path untouched).
- **Contract:** `useWorkspaceFeatureFlag('strategy-command-center', workspaceId)` gates the new layout. Flag OFF → existing `bandsAnalysis`/`legacyAnalysis` path unchanged.
- **Assertions:** flag-OFF snapshot of `KeywordStrategy` is byte-identical to pre-change (render test / DOM probe); flag-ON shows OrientZone.
- **Verify:** component test; **real-browser DOM probe** (per the Phase-5 multi-layer-verification lesson) confirming flag-OFF parity.

**Phase 1 gate:** all quality gates + flag-OFF parity probe. PR to staging.

---

## Phase 2 — Act Queue (Model: Opus — highest-complexity cross-context work)

**Owns:** `src/components/strategy/buildOpportunityRows.ts` (extend), new `src/components/strategy/ActQueue.tsx`, `src/components/strategy/DecisionQueue.tsx` (adapt), conversion of `IntelligenceSignals` → recommendations. **Must not touch** Orient files or interior tabs.
**Reuse:** recommendation engine (`server/recommendations.ts`, `computeOpportunityValue`), `RecommendationRow`, `useAdminRecommendationSet`, `buildRecFixContext`/`REC_TYPE_ADMIN_TAB`.

### Task 2.1 — Extend `buildOpportunityRows` to merge all action types (Opus)
- **Files:** Modify `src/components/strategy/buildOpportunityRows.ts`; Test: `tests/unit/strategy/buildOpportunityRows.test.ts`.
- **Contract:** merge QuickWins, LHF, ContentGaps, Decay, LostQueries, Cannibalization into one row list, deduped by page identity, each carrying a numeric impact (`opportunity.value ?? impactScore`) and a `kind` (content|technical|quick-win) for filter chips. Sort by impact desc.
- **Assertions:** dedup by page identity holds across all sources; rows sorted desc by impact; a zero-impact `fix_now` critical is flagged `healthFix:true` (Decision 5); `kind` assigned for every row.
- **Constraints:** READ the real `buildOpportunityRows` (only 41 lines) + the rec types. Do NOT guess field names (`opportunity.value`, `impactScore`, page identity util).
- **Verify:** `npx vitest run tests/unit/strategy/buildOpportunityRows.test.ts`.

### Task 2.2 — Signals → recommendations (Opus)
- **Files:** Modify the signals source feeding `IntelligenceSignals` (READ `src/components/strategy/IntelligenceSignals.tsx:1-124` + its data hook first); route each signal into the queue as a row with impact. Test: assertion that a momentum/misalignment/content_gap signal appears as a queue row, not a standalone card.
- **Assertions:** each signal type maps to a queue row with a `kind` + impact (or `healthFix`); `IntelligenceSignals` standalone card not rendered in command-center layout.
- **Verify:** component/unit test.

### Task 2.3 — ActQueue component with filter chips + impact + CTAs + zero-impact chip (Opus)
- **Files:** Create `src/components/strategy/ActQueue.tsx`; Test: `tests/component/strategy/ActQueue.test.tsx`.
- **Contract:** filter chips All/Content/Technical/Quick-wins with live counts; elevated #1 lever; each row = title + target + impact pill (or "Health fix" chip when `healthFix`) + CTA (Create brief/cluster/refresh via `buildRecFixContext` deep-link, or Fix). Teal CTAs, blue impact.
- **Assertions:** chip counts match filtered rows; `healthFix` rows render the chip not "$0/mo"; CTA navigation targets resolve via `REC_TYPE_ADMIN_TAB`; no purple.
- **Verify:** component test + pr-check.

**Phase 2 gate:** all gates + flag-OFF parity. PR to staging.

---

## Phase 3 — Interior Tab Shell + Content Tab (Model: Sonnet shell; Sonnet/Opus for Content composition)

**Owns:** sub-tab routing in the orchestrator (`KeywordStrategyPanel`), new `src/components/strategy/ContentTab.tsx`, `TopicClusters.tsx` (add Create-cluster CTA), `ContentGaps.tsx`/`DecayingPagesCard.tsx` (compose into Content tab). **Must not touch** Rankings/Competitive leaves.
**Reuse:** `ContentPipeline.tsx:57-105` `?tab=` template, `resolveTabSearchParam`/`clearTabSearchParam`, `content-gaps.ts`/`content-decay.ts`/`topic-clusters.ts` data, `content-brief`/`content-requests` flows.

### Task 3.1 — Sub-tab routing shell (Sonnet)
- **Files:** Modify the Strategy orchestrator to read `?tab=` via `resolveTabSearchParam` and render Overview/Content/Rankings/Competitive (`TabBar`); Test: extend `tests/contract/tab-deep-link-wiring.test.ts`.
- **Contract:** two-halves `?tab=` contract — sender appends `?tab=X`, receiver initializes from the param (per CLAUDE.md rule #12). Tabs gated by the command-center flag; flag-OFF = no sub-tabs.
- **Assertions:** `?tab=content` deep-links to Content tab; invalid param → Overview; contract test covers all four ids; flag-OFF shows no tab bar.
- **Verify:** `npx vitest run tests/contract/tab-deep-link-wiring.test.ts`.

### Task 3.2 — Content tab composition (Sonnet)
- **Files:** Create `src/components/strategy/ContentTab.tsx`; Test: `tests/component/strategy/ContentTab.test.tsx`.
- **Contract:** compose ContentGaps + DecayingPages + TopicClusters; summary line "N opportunities · ~$X/mo combined value"; per-item `$/mo` from the rec/opportunity value.
- **Assertions:** summary count + total match the rendered items (numerator/denominator share a source — CLAUDE.md rate-display rule); each item has a real CTA.
- **Verify:** component test.

### Task 3.3 — Create-cluster CTA + batch handler (Sonnet/Opus) — the one net-new monetization CTA
- **Files:** Modify `src/components/strategy/TopicClusters.tsx` (add CTA); server batch handler looping `gap[]` into `createContentRequest`/generate-brief (READ `server/content-requests.ts:177,290` + `server/content-brief.ts` first). Test: integration test through the real route.
- **Contract:** "Create cluster" loops the cluster's gap keywords into content requests / brief generation using the EXISTING endpoints (no new monetization route). Activity logged; broadcast on mutation.
- **Assertions:** clicking Create-cluster creates N content requests (one per gap) via the real endpoint; FM-2 (provider error → failed status); `broadcastToWorkspace` + `useWorkspaceEvents` invalidation both present (feedback-loop completeness).
- **Verify:** integration test (`createEphemeralTestContext`), pr-check.

**Phase 3 gate:** all gates + flag-OFF parity + deep-link contract test. PR to staging.

---

## Phase 4 — Rankings Tab (Model: Sonnet)

**Owns:** new `src/components/strategy/RankingsTab.tsx`, `useStrategyMetrics` 30-day-movements extension, `RankingDistribution.tsx` (reuse). **Must not touch** Competitive leaves.
**Reuse:** `RankingDistribution`, `keywordHubDeepLink` (striking-distance → Hub), `RankHistoryChart`/`KeywordSparkline` (interior-tab sparklines allowed), `rank-tracking.ts` output (read-only — no forks).

### Task 4.1 — 30-day movements in `useStrategyMetrics` (Sonnet)
- **Files:** Modify `src/components/strategy/hooks/useStrategyMetrics.ts`; Test: `tests/unit/strategy/useStrategyMetrics.test.tsx`.
- **Contract:** `movements: { improved, declined, new, lost }` from snapshot[0] vs snapshot[~30d] of rank history (READ `server/rank-tracking.ts:getRankHistory` for the real shape). Additive field; flag-OFF unaffected.
- **Assertions:** counts computed from a seeded two-snapshot fixture; null/empty history → all zeros; existing fields unchanged.
- **Verify:** `npx vitest run`.

### Task 4.2 — RankingsTab (Sonnet)
- **Files:** Create `src/components/strategy/RankingsTab.tsx`; Test: `tests/component/strategy/RankingsTab.test.tsx`.
- **Contract:** position distribution (reuse `RankingDistribution`) + 4 movement tiles (`StatCard`) + striking-distance rows deep-linking to the Hub via `buildHubDeepLinkQuery({segment:'striking_distance'})`. A visible "Full tracking lives in the Keyword Hub →" link. Inline Track retired (Decision 6).
- **Assertions:** striking-distance link uses the real `HUB_SEGMENT_VALUES.STRIKING_DISTANCE`; no inline track mutation; movement tiles colored emerald/red appropriately.
- **Verify:** component test + pr-check.

**Phase 4 gate:** all gates + flag-OFF parity. PR to staging.

---

## Phase 5 — Competitive Tab (Model: Opus for share-of-voice chart; Sonnet for the rest)

**Owns:** new `src/components/strategy/CompetitiveTab.tsx`, `CompetitiveIntel.tsx` (generalize ComparisonBar to n-way), new `<ShareBar>` (or generalized bar), `KeywordGaps.tsx` (add Create-brief CTA), `BacklinkProfile.tsx` (optional new/lost). **Must not touch** other tabs.
**Reuse:** `CompetitiveIntel` (`variant='full'`), `BacklinkProfile`, `KeywordGaps`, `useBacklinkProfile`, `/api/seo/competitive-intel`, `/api/backlinks/:id`, `keyword-gaps.ts` cache fallback.

### Task 5.1 — Share-of-voice chart (Opus) — net-new
- **Files:** Create `src/components/strategy/ShareBar.tsx` (or generalize `CompetitiveIntel` ComparisonBar `:81-97` from binary to n-way); compute SOV = `myTraffic / (myTraffic + Σ competitorTraffic)` from domain-overview data (READ `server/routes/seo-provider.ts:53-160` for the real response shape). Test: unit test for SOV math + component test.
- **Assertions:** SOV percentages sum to ~100; "You" bar highlighted (blue); graceful degrade when provider data missing (audit: route degrades gracefully); no new dependency (reuse recharts/`AIUsageSection` bar pattern).
- **Verify:** unit + component test.

### Task 5.2 — CompetitiveTab composition + KeywordGaps Create-brief (Sonnet)
- **Files:** Create `src/components/strategy/CompetitiveTab.tsx`; Modify `KeywordGaps.tsx` (add Create-brief CTA per row). Test: component test.
- **Contract:** mount `CompetitiveIntel variant='full'` + `ShareBar` + `BacklinkProfile` + `KeywordGaps`-with-Create-brief; Create-brief reuses the content-request flow (no new route).
- **Assertions:** each gap row has a Create-brief CTA wired to the real flow; backlink stats render; competitive refresh piggybacks on `STRATEGY_UPDATED` (no dedicated event needed — audit).
- **Verify:** component test + pr-check.

**Phase 5 gate:** all gates + flag-OFF parity. PR to staging.

---

## Phase 6 — Client Reframe (Model: Sonnet — strict design laws, pattern-bound)

**Owns:** `src/components/client/StrategyTab.tsx` (rebuild into Overview + Content + Rankings + Competitive), client-safe visibility-score serialization, new `decision-adapters.ts` branch. **Must not touch** admin Strategy.
**Reuse:** `useClientIntelligence`, `DecisionCard`/`DecisionDetailModal`, `TierGate`, `TrendChart`/`DualTrendChart` (no-purple), `ROIDashboard` data, public approve + cart-checkout + upgrade flows (ALL already ship — audit Open-Q3).

### Task 6.1 — Client-safe visibility score (Sonnet)
- **Files:** Modify `server/serializers/client-safe.ts` (+ `server/routes/client-intelligence.ts` if needed) to expose `visibilityScore` deliberately; add pr-check guard that it is NOT serialized via the generic admin path. Test: public read-path integration test.
- **Contract:** the 0–100 score (and delta) appear in the client payload through the explicit client-safe serializer ONLY; the per-keyword breakdown/EMV never leak.
- **Assertions:** `GET /api/public/workspace/:id` (or client-intelligence) returns `visibilityScore`; admin EMV/opportunity raw values absent (extend `stripEmvFromPublicRecs` coverage); integration test exercises the PUBLIC route (not admin) per CLAUDE.md.
- **Verify:** integration test + pr-check.

### Task 6.2 — Client Strategy reframe (Sonnet)
- **Files:** Rebuild `src/components/client/StrategyTab.tsx` into Overview + interior tabs (`useSearchParams` for `?tab=`); recs as `DecisionCard` (Approve = retainer via public approve; Add·$price = cart-checkout/upgrade); Competitive Premium-gated via `TierGate`. Test: client component + e2e where feasible.
- **Contract:** plain-language framing; Approve → `POST /api/public/content-request/:id/approve`; Add·$price → existing cart-checkout; Competitive wrapped in `<TierGate>`. New `decision-adapters.ts` branch for `source='strategy_recommendation'`.
- **Assertions:** `grep -r "purple-" src/components/client/strategy/` → zero (pr-check); Approve hits the real endpoint; Premium gate hides competitive below tier; `?tab=` receiver wired.
- **Verify:** component test, `grep` purple check, pr-check, e2e if available.

**Phase 6 gate:** all gates + no-purple grep + public read-path test. PR to staging.

---

## Systemic Improvements

**Shared utilities to extract:**
- `server/scoring/visibility-score.ts` (Phase 0) — single source of truth for the score.
- `useWorkspaceFeatureFlag` (Phase 0) — per-workspace flag reads, reusable beyond Strategy.
- `<ShareBar>`/`<DistributionBar>` (Phases 4–5) — n-way + distribution bars extracted from `RankingDistribution`/`CompetitiveIntel` for reuse.

**pr-check rules to add:**
- No-purple in `src/components/client/strategy/`.
- Visibility score never serialized via the generic admin serializer (only the explicit client-safe path).
- `?tab=` two-halves wiring for the new interior tabs (extend the contract test).
- Premium-discount constant sync between `SeoCart.tsx` and `server/stripe.ts` (audit-flagged divergence).

**Test coverage to add:** visibility-score unit (Phase 0); deep-link contract update (Phase 3); Content/Competitive CTA integration through the PUBLIC read path (Phases 3, 5, 6); EMV-leak coverage extension (Phase 6); `strategy_generated` activity test (Phase 0).

**Feature-class gates:** this is a cross-context, client-impactful, monetization-touching feature — apply the analytics/client-visible/background-adjacent gates in `docs/workflows/feature-class-definition-of-done.md` per phase.

---

## Design Conformance (mandatory, every UI phase)

UI work in every phase MUST follow the companion **`docs/superpowers/plans/2026-06-17-strategy-v2-design-conformance.md`** — the element→primitive/token map, the Four-Laws table, the 8 silent-regression guards, mandatory loading/empty/error states, and the per-phase UI gate. The approved mockups were *directional* (hardcoded palette inside the visualizer); the build uses real `src/components/ui/` primitives + `src/tokens.css` tokens + `.t-*` classes ONLY — no hand-rolled cards/stats, no hardcoded hex. The conformance doc already pins the real primitives (`MetricRing`, `AnnotatedTrendChart`, `ChartCard`, `CompactStatBar`, `TrendBadge`, `ClickableRow`, `TabBar`, `Badge`, `TierGate`) and reuse helpers (`scoreColor()`, `positionColor()`, `CHART_SERIES_COLORS`, `chartGridColor()`). Each phase's verification includes the design gate; workers still read each primitive's real props before wiring.

## Parallelization & Execution Model

**Cross-phase parallelism is intentionally limited.** Phase-per-PR + staging gates serialize the dependency chain on purpose — that discipline is what caught the cross-phase bugs in the prior redesign's cumulative review. We do NOT start Phase 3 before Phase 0's contracts merge. The only cross-phase parallel pair is **Phase 4 ∥ Phase 5** (Rankings ∥ Competitive) after Phase 3 lands — disjoint files.

**Within a phase, fan out on exclusive files.** Each phase runs as one Workflow: pre-commit that phase's shared contracts → parallel implementer subagents each owning *disjoint* files → barrier → `scaled-code-review` → fix Critical/Important → quality gates → PR. Examples:
- Phase 1: agent A owns `OrientZone` layout; agent B owns the `useStrategyMetrics` delta extension (a coordination file — pre-commit its signature first; only one agent touches it).
- Phase 5: agent A owns `<ShareBar>` extraction; agent B owns `KeywordGaps` Create-brief; agent C owns `BacklinkProfile` new/lost. Zero file overlap.

**Rules (multi-agent-coordination + recorded lessons):**
- Pre-commit shared contracts (types, signatures, the `StrategyInteriorTab` union, the flag) before any parallel dispatch — agents read committed code, never each other's working state.
- Exclusive file ownership per agent; an agent needing a file outside its list STOPS and reports.
- **No parallel agent runs git writes** in the shared checkout — the controller commits per lane (a prior run's index contention destroyed work).
- Diff review after every parallel batch: `git diff`, duplicate-import grep, `tsc`, full vitest.
- The speed lever is within-phase fan-out + Phase R/0 contract pre-commit — NOT collapsing the phase chain.

## Verification Strategy

- **Per task:** the exact `npx vitest run <path>` command in the task; `npm run typecheck`.
- **Per phase (all must pass before PR):** `npm run typecheck` · `npx vite build` · `npx vitest run` (full suite) · `npx tsx scripts/pr-check.ts` · `npm run verify:feature-flags` · `grep -rE 'violet|indigo' src/components/` (zero) · **flag-OFF parity**: real-browser DOM probe confirming the legacy Strategy render is byte-identical with the flag off (per the Phase-5 multi-layer-verification lesson — typecheck+build+pr-check can all pass while a silent CSS/layout regression ships).
- **Cross-phase review:** parallel-agent work in any phase → invoke `scaled-code-review` before merge; fix all Critical/Important. Single-agent phases → `superpowers:requesting-code-review`.
- **Staging:** each phase merges to `staging`, validates on the staging deploy, then `staging → main`. Phase N+1 starts only after N is green on staging.
- **Docs per phase:** update `FEATURE_AUDIT.md`, `data/roadmap.json` (run `npx tsx scripts/sort-roadmap.ts`), and `BRAND_DESIGN_LANGUAGE.md` if tokens/patterns change.

---

## Carried-Forward Reads (do NOT guess — read at execution)

The audit could not fully read these; the owning task must READ them first: `StrategyHeaderActions.tsx`, `StrategySettings.tsx`, `StrategyFeedbackNudge.tsx`, and the hooks `useStrategySettings`/`useStrategyGeneration`/`useKeywordFeedback` line ranges; the exact `useStrategyMetrics` internals (audit read 1–89); `IntelligenceSignals` data hook; `server/rank-tracking.ts:getRankHistory` shape; `seo-context-slice.ts` assembly point. If real code contradicts a contract here, STOP and report.
