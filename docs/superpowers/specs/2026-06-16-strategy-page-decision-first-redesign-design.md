# Admin Strategy Page — Decision-First Redesign

**Date:** 2026-06-16
**Status:** SUPERSEDED 2026-06-17 by the v2 "SEO command center" IA (`docs/superpowers/specs/2026-06-17-strategy-v2-command-center.md`). Phases 0–5 shipped behind `strategy-decision-bands`; the 3-band layout + flag were retired in Phase R before flag removal, with reusable components carried into v2.
**Owner:** Josh (hmpsn.studio)
**Surface:** Admin `seo-strategy` page (`KeywordStrategyPanel`, `src/components/KeywordStrategy.tsx`)

---

## 1. Problem

The admin Strategy page is a single ~1064-line component rendering ~30 stacked sections in one vertical scroll, sequenced by **data-model category, not by decision priority**. Worse, the sections that *name* actions loudest are pure read-only text:

- Of ~30 sections, only **3** genuinely lead to an action (PageHeader regen cluster, Client Keyword Feedback "Add to strategy", ContentGaps "Draft brief"), and 2 of those sit below the fold.
- Quick Wins, Low-Hanging Fruit, Cannibalization, and the "What Changed" next-action badges render as inert chips/text even though the **server already computes the exact action** (e.g. a paste-ready `<link rel=canonical>` tag).
- The platform's prioritized recommendation engine (`server/recommendations.ts`, surfaced via `useRecommendationSet` on the client Overview/Health tabs) has **zero consumers** on the admin Strategy page — the page whose job is "what next" ignores the engine that ranks "what next."

**Goal:** turn the page from a passive scroll into a decision-leading surface, and in doing so break the monolith into digestible, independently-ownable modules that unlock parallel shipping.

This was validated by a 21-agent audit + 2 independent synthesizers (product/UX and data/engineering), which converged on the findings above.

---

## 2. Decisions locked (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Overall approach | Phased rebuild, decision-first 3-band IA | Ships value early, respects phase-per-PR; not a fusion |
| Site Health fusion | **No** — cross-link instead | Distinct cockpits, two job runners, ~zero data overlap. Natural adjacency is Page Intelligence (shared `pageMap`), not Site Health |
| Decomposition | **Phase 0, extract-first** (behavior-preserving) | Splitting the monolith *is* the parallelism unlock; a clean refactor de-risks all later phases |
| Parallelism | **Build leaves in parallel, integrate per phase** | Leaf components are independent files → fan out wide; integration stays sequential + staging-gated |
| Signal generation | On-mutation recompute + daily activity-gated cron + visible "computed X ago" + manual recompute | Today signals are lazy/view-triggered + 24h-throttled with no cron — unviewed workspaces go stale/empty silently |
| Decision Queue source | Same engine as client, **admin sees the superset** | One source of truth (`useRecommendationSet`), admin additionally sees admin-only signals (e.g. `emvPerWeek`) |
| Cannibalization apply | Deep-link into SEO Editor write-target prefilled → **Send to client** | Reuses the existing approval workflow; no silent live-site change; client sign-off preserved |
| Keyword Opportunities | Pipe into Hub/QuickWins as trackable rows | Freeform AI prose that exists nowhere in the Hub — don't blind-delete |
| Backlink Profile | Merge with Competitive Intel → "Authority & Backlinks" (stays on Strategy) | Lowest-actionability section; its true adjacency is competitive context |
| Settings placement | Collapsed disclosure co-located with Generate | Config changes rarely between runs |
| Page Intelligence de-dup | **Out of scope** (follow-up) | Shared Track-keyword / LocalSeoVisibilityPanel patterns noted for later |

---

## 3. Target architecture — three decision-first bands

Top to bottom, replacing the category-ordered scroll:

**Header** — PageHeader + regen cluster + a **collapsed** Settings disclosure co-located with Generate. Subtitle becomes a one-line decision summary ("N decisions pending · M gaps to brief · K requested keywords") instead of artifact freshness.

**Band 1 — DECIDE** (above the fold, persistent)
- **Decision Queue** — top recommendation card + tier buckets, from `useRecommendationSet` (admin superset). Each row's CTA routes to its fix surface.
- **Requested-keyword triage** — hoisted from the buried Client Keyword Feedback card ("Add to strategy" already works).

**Band 2 — ACT** (opportunities with real CTAs)
- **Opportunities** — merged Quick Wins + Low-Hanging Fruit + Content Gaps, every row carrying the proven ContentGaps `navigate()` + fixContext CTA pattern.
- **Decaying pages** — NEW card from `content_decay` (already computed; feeds generation as a hidden input today).
- **Lost-query recovery** — NEW card from `seoContext.discoveredQuerySummary.topLostQueries`.
- **Cannibalization triage** — rebuilt as an actionable queue (see §5).
- **What changed** — `StrategyDiff` hoisted here, default-expanded when `totalChanges > 0`, `nextAction` badges wired to `navigate()`.

**Band 3 — REFERENCE** (below the divider, correctly demoted)
- Compact stat bar + Ranking Distribution (segments click-to-filter).
- **Authority & Backlinks** — Backlink Profile + Competitive Intel comparison bars, merged; own-domain stat bar removed; cache-label fixed.
- **Competitor evidence** — the single deduped Keyword Gaps surface, with inline Track.
- Topic Clusters; Keyword Opportunities (piped to Hub/QuickWins); declined-keyword log.
- Site Target Keywords → replaced by a "Manage in Keyword Hub →" deep-link (`?tab=in_strategy`).
- Guide tab + "How it works" footer → collapsed into a single help disclosure (prose is currently triplicated).

---

## 4. Decomposition target

Phase 0 extracts the inline sections of `KeywordStrategy.tsx` into named leaf components, **preserving current order and behavior** (no IA change, no flag). The IA reorder happens in the feature phases.

```
src/components/strategy/
  KeywordStrategyPanel.tsx     thin orchestrator (data, flag, band layout)   [SHARED — controller]
  index.ts                     barrel exports                                [SHARED — controller]
  hooks/
    useStrategyDecisionSummary.ts   header/queue counts                      [SHARED CONTRACT — pre-commit]
  bands/
    DecideBand.tsx  ActBand.tsx  ReferenceBand.tsx                           [1 file/band — one owner each]
  decide/
    DecisionQueue.tsx               NEW (recommendation engine)
    RequestedKeywordTriage.tsx      hoisted from Client Keyword Feedback
    SettingsDisclosure.tsx          collapse + maxPages persistence fix
    HeaderSummary.tsx               decision-count subtitle
  act/
    OpportunitiesList.tsx           merged QuickWins + LowHangingFruit + ContentGaps pattern
    DecayingPagesCard.tsx           NEW (content_decay)
    LostQueryRecoveryCard.tsx       NEW (topLostQueries)
    CannibalizationTriage.tsx       REBUILD
    WhatChangedPanel.tsx            StrategyDiff hoisted + wired
  reference/
    StrategyStatBar.tsx  RankingDistribution.tsx  TopicClusters.tsx
    AuthorityAndBacklinks.tsx       Backlink + Competitive merged
    CompetitorEvidence.tsx          KeywordGaps deduped + Track
    KeywordOpportunities.tsx        piped to Hub/QuickWins
```

**Decomposition principles**
- Each leaf takes a consistent prop shape (`{ workspaceId, strategy, ... }`) so leaves are interchangeable slot contents.
- The orchestrator owns data fetching (`useKeywordStrategy`) and passes down; leaves do their own scoped queries only where they already do (these get migrated off hand-rolled `useState+useEffect+fetch` to React Query — `StrategyDiff`, `BacklinkProfile`).
- **Phase 0 is flat extraction** under `src/components/strategy/` in the *current* render order (pure mechanical extract: inline JSX → leaf components, cohesive logic → hooks). **Phase 1** introduces the `bands/` containers and moves leaves into the `decide/ act/ reference` folders as part of the reorder — this keeps the behavior-preserving extraction diff cleanly separate from the IA categorization decision (a few components' band assignment is itself a Phase-1 design call).
- Cohesive orchestrator logic is extracted into hooks so the orchestrator becomes genuinely thin (not "dumb leaves + a still-fat parent"): `useStrategyMetrics` (derived page/feedback metrics), `useStrategySettings` (settings state + sync effects + `buildStrategyGenerationParams`), `useStrategyGeneration` (job orchestration), `useTrackKeyword` (tracking state), `useKeywordFeedback` (rows + add-to-strategy mutation).

---

## 5. Data wiring — reuse map (verified symbols)

Almost everything is reuse of already-computed server data.

| Need | Reuse | Path (verified) |
|---|---|---|
| Decision Queue | `useRecommendationSet(workspaceId)` → `summary.topRecommendationId` + tier buckets; shares InsightsEngine's warm React Query cache | `src/hooks/useRecommendations.ts:13`, pattern in `src/components/client/OverviewTab.tsx:99` |
| Decaying pages | `content_decay` insight (already computed, feeds generation) | `get_content_decay` / content_decay insight type |
| Lost-query recovery | `seoContext.discoveredQuerySummary.topLostQueries` | intelligence seoContext slice |
| What Changed CTAs | `StrategyDiff` already ships `type/label/pagePath/targetTab` | `src/components/strategy/StrategyDiff.tsx` |
| Cannibalization remediation + canonical tag | server already picks remediation + emits paste-ready tag | `server/keyword-strategy-enrichment.ts:656-770` |
| Mark resolved | `cannibalization_resolved` outcome action type (scored, no UI today) | `shared/types/outcome-tracking.ts:17`, `server/outcome-scoring-defaults.ts:60` |
| Send to client | SEO Editor approval workflow | `useSeoEditorApprovalWorkflow` → `sendForApproval` → `PendingApprovals` |

**New backend (Phase 5 only) — no new tables:**
- On-mutation scoped insight recompute after `STRATEGY_UPDATED`, rank-snapshot reconciliation, and content publish — reuse the scoped-refresher pattern of `refreshContentDecayInsights` (`server/analytics-intelligence.ts:934`) rather than full recompute.
- A **daily activity-gated** insight recompute cron (separate from the existing 6h cron, which only warms the prompt-assembly LRU — it does NOT recompute insights), gated on `hasRecentActivity` to bound GSC/GA4 cost.
- "Computed {relativeTime} ago" caption + manual "Recompute now" on the IntelligenceSignals card (live-update half already exists: `INTELLIGENCE_SIGNALS_UPDATED` broadcast + invalidation).
- Snapshot `strategy_history` on the manual PATCH edit path so What Changed stops misattributing human edits to the last regeneration.

---

## 6. Cannibalization triage contract (the headline rebuild)

`CannibalizationAlert.tsx` today has **zero interactive elements**. Rebuilt `CannibalizationTriage.tsx`:

- Per issue, render the CTA matching the server-computed remediation:
  - **Apply canonical** → deep-link into the SEO Editor with the page resolved as a write target (`static-page` / `cms-item`) and the canonical prefilled → human reviews → **Send to client** (standard single-button convention) → lands in client Inbox → Reviews. No silent live-site change.
  - **Differentiate** → `create_content_request`.
  - **Copy canonical tag** → copies the already-computed snippet.
  - **Mark resolved** → writes the `cannibalization_resolved` tracked action (closes the scored-but-unloggable feedback loop).
- **Open verification for the plan:** confirm whether the SEO Editor form currently exposes an editable canonical-URL field on the page-SEO write path. If not, adding it is a small, contained piece scoped into Phase 3.

---

## 7. Phase plan

Each phase is one PR, merged to `staging` and verified before the next opens. Dark-launched behind a single `strategyDecisionBands` feature flag (added to `FEATURE_FLAG_CATALOG` in `shared/types/feature-flags.ts` before the first commit of **Phase 1** — Phase 0 is a flag-free, behavior-preserving refactor). Old layout remains the fallback until the flag is removed after Phase 4.

| Phase | Scope | Acceptance gate |
|---|---|---|
| **0 — Decompose** | Extract inline sections → leaf components in current order; thin orchestrator; barrel; no flag, no behavior change | Page renders identically; `typecheck`/`build`/`vitest`/`pr-check` green; diff is pure move |
| **1 — Decide band** | 3-band scaffold + flag; Decision Queue (`useRecommendationSet`, admin superset); requested-keyword triage hoist; Settings disclosure + **maxPages persistence fix**; header decision summary | Behind flag: queue renders top rec + buckets; triage adds keywords; maxPages survives remount; old layout unchanged with flag off |
| **2 — Act band** | OpportunitiesList (merge QuickWins+LHF, ContentGaps CTA pattern); WhatChangedPanel hoist + `navigate()` wiring + React Query migration; DecayingPagesCard; LostQueryRecoveryCard | Every Act row has a working CTA; What Changed refreshes after in-session regen |
| **3 — Cannibalization triage** | Rebuild per §6 (SEO Editor prefill + Send to client; Differentiate; Copy tag; Mark resolved) | Each issue actionable; `cannibalization_resolved` writes; canonical-field verification resolved |
| **4 — Reference + Hub handoff** | Authority & Backlinks merge + cache-label fix + React Query migration; CompetitorEvidence dedup + Track; Site Keywords → Hub deep-link; Keyword Opportunities → trackable rows; Ranking Distribution click-to-filter; stat compaction; delete dead code; demote Guide; **remove the flag** | New IA is the default; no orphaned code; `verify:feature-flags` clean |
| **5 — Signal generation** (concurrent lane) | On-mutation recompute + daily activity-gated cron + "computed X ago" + manual Recompute + `strategy_history` snapshot fix | Signals fresh for active workspaces; staleness visible; cost bounded |

**Construction wave:** after Phase 0, the new/rebuilt leaf components (`DecisionQueue`, `OpportunitiesList`, `DecayingPagesCard`, `LostQueryRecoveryCard`, `CannibalizationTriage`, `WhatChangedPanel`, `AuthorityAndBacklinks`, `CompetitorEvidence`, etc.) are built in parallel — each owned by one agent, component-tested in isolation behind the flag — then wired into bands during the integration phases above.

---

## 8. Parallelism, file ownership & coordination

| Layer | Files | Parallel? | Owner |
|---|---|---|---|
| Orchestrator + barrel + band containers | `KeywordStrategyPanel.tsx`, `index.ts`, `bands/*` | Serial | Controller, edited between batches |
| Leaf components | ~15 files under `decide/ act/ reference/` | Fully parallel | One agent per file |
| Shared contracts | `useStrategyDecisionSummary`, new shared types, leaf prop shape | Pre-committed before dispatch | Controller |
| Signal-gen backend (Phase 5) | `server/analytics-intelligence.ts`, crons, `strategy_history` | Concurrent with all frontend | Separate lane |

**Coordination rules (per `docs/rules/multi-agent-coordination.md`):**
- Pre-commit shared contracts (leaf prop interface, `useStrategyDecisionSummary`, types, barrel) **before** dispatching any parallel batch.
- Exclusive file ownership: workers own one leaf file each; the controller owns the orchestrator/bands/barrel and wires leaves in between batches.
- Workers in the shared checkout **never run git writes** — the controller commits per lane.
- `scaled-code-review` after every parallel batch (git diff, grep duplicates, `tsc`, full test suite).
- Model ladder (Anthropic): Haiku = Phase 0 mechanical extraction; Sonnet = standard leaves + integration; Opus = Decision Queue wiring, Cannibalization rebuild, signal-gen backend, review.

---

## 9. Cut / move / dead-code list
- **Delete:** the duplicate Keyword Gaps section *inside* `CompetitiveIntel` (~lines 259-289); Competitive Intel's own-domain stat bar; orphaned `src/components/admin/ActionQueue.tsx` (or mount it — its `useActionQueue` hook + `/api/insights/:id/queue` endpoint already work).
- **Replace:** Site Target Keywords → Hub deep-link.
- **Merge:** Backlink Profile + Competitive Intel → Authority & Backlinks.
- **Demote:** Keyword Opportunities → trackable rows; Guide tab + footer → one help disclosure.

## 10. Bugs to fix (folded into the phase that touches each area)
- `maxPages` silently resets to 500 every remount — absent from `PersistKeywordStrategyOptions` (`server/keyword-strategy-persistence.ts:34`) and `useState(500)` never hydrates from `strategy` (Phase 1).
- Competitive Intel mislabels cache freshness — footer says "Cached 48h" / 48h `staleTime` but server file-cache TTL is 168h/7d and `fetchedAt` is stamped at response-assembly time, not provider-fetch time (Phase 4).
- `STRATEGY_UPDATED` broadcasts don't invalidate the competitorIntel query (Phase 4).
- `StrategyDiff` / `BacklinkProfile` use hand-rolled `useState+useEffect+fetch` — migrate to React Query + `useWorkspaceEvents` (Phases 2/4).

---

## 11. Testing strategy
- Phase 0: snapshot/parity — page renders identically (component tests + manual verify); diff is a pure move.
- Leaf components: component tests (`test:component`) in isolation behind the flag.
- Integration phases: integration tests on the actual read paths (recommendation set, content_decay, cannibalization write, SEO Editor send-to-client); contract test for the Hub deep-link `?tab=` two-halves contract.
- Signal-gen: FM-2 pattern (mock provider error → assert `failed` status); cron gating test for `hasRecentActivity`.
- All phases: `typecheck` + `vite build` + `vitest run` + `pr-check` + `verify:feature-flags` + `verify:coverage-ratchet`.

## 12. CLAUDE.md deliverables
- Feature flag `strategyDecisionBands` in `FEATURE_FLAG_CATALOG` before the first commit of Phase 1.
- A `docs/rules/strategy-decision-bands.md` reference doc (band IA contract, leaf prop shape, Decision Queue admin-superset rule, cannibalization write-target contract) + per-phase acceptance checklists embedded in the implementation plan — authored **before** implementation code.
- Per task: update `FEATURE_AUDIT.md`, `data/roadmap.json` (+ `sort-roadmap`), `BRAND_DESIGN_LANGUAGE.md` (band layout), and `data/features.json` if client-relevant.

## 13. Out of scope (follow-ups)
- Page Intelligence ↔ Strategy de-duplication (shared Track-keyword / LocalSeoVisibilityPanel patterns).
- WorkspaceHome strategy+health rollup and reciprocal Strategy ↔ Site Health cross-links (mentioned in audit; not required for this redesign).
- Append-only strategy event log beyond the `strategy_history` PATCH-snapshot fix.

## 14. Open risks
- **maxPages persistence** touches the server persist contract — small migration of the options interface + write/read path; verify no other caller breaks.
- **Cannibalization → SEO Editor** depends on the canonical field being writable (verification scoped into Phase 3).
- **Signal-gen cron cost** — daily recompute pulls GSC/GA4; gating on `hasRecentActivity` is mandatory, not optional.
- **Flag scope** — the flag gates the new band layout container specifically (the intended sub-feature), with the old layout as fallback; removed in Phase 4. Not a composite-parent wrap.
