# Strategy Redesign — Phase 1a: Decision-First IA Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind a `strategy-decision-bands` feature flag, render the admin Strategy page's **existing** content reorganized into a decision-first three-band IA (Decide / Act / Reference), plus the supporting changes that don't need the recommendation engine: hoist the requested-keyword triage into the Decide band, collapse Settings by default, fix the `maxPages` persistence bug, and add a header decision summary. Flag OFF = today's layout, byte-identical.

**Architecture:** A new `StrategyBand` container (labeled section wrapper) groups the existing leaf components in a new order. The orchestrator forks on `useFeatureFlag('strategy-decision-bands')`: enabled → band layout; disabled → the current sequential layout (unchanged). `RequestedKeywordTriage` is split out of `ClientKeywordFeedback` (which becomes declined-only). The `maxPages` setting is threaded through the persistence chain so it survives a remount. **The Decision Queue and any new data cards (Decaying Pages, etc.) are NOT in this phase — Phase 1b and later.**

**Tech Stack:** React 19, TypeScript strict, React Query, Vitest, `src/components/ui` primitives, `shared/types/feature-flags.ts`.

**Spec:** `docs/superpowers/specs/2026-06-16-strategy-page-decision-first-redesign-design.md` · **Base:** branch off `staging` (Phase 0 merged as `65f04751b`).

**Deviations from spec (justified by Phase-1 research, workflow `wf_12a1d3c5`):**
- Leaves stay **flat** under `src/components/strategy/` (no physical `decide/act/reference` folder moves). Bands are achieved by the `StrategyBand` container + render order — folder moves are pure churn with no UX benefit and real import-breakage risk. The folder split is dropped, not deferred.
- The header decision summary in 1a is sourced from on-page data (`metrics`/`strategy`: gaps, requested keywords, quick wins) — NOT the recommendation engine (that arrives with the Decision Queue in 1b).

---

## File Structure

**Create:**
- `src/components/strategy/StrategyBand.tsx` — labeled band container
- `src/components/strategy/RequestedKeywordTriage.tsx` — requested-keyword "Add to strategy" triage (split from `ClientKeywordFeedback`)
- Tests: `tests/unit/strategy/StrategyBand.test.tsx`, `tests/unit/strategy/RequestedKeywordTriage.test.tsx`

**Modify:**
- `shared/types/feature-flags.ts` — register `strategy-decision-bands` (5 coordinated edits)
- `data/roadmap.json` — add the Strategy-redesign sprint (Phase 0 done; 1a/1b items) — the flag's `linkedRoadmapItemId` target
- `shared/types/workspace.ts` — `KeywordStrategy.maxPages?: number`
- `server/keyword-strategy-persistence.ts` — persist `maxPages`
- `server/keyword-strategy-generation.ts` — thread `maxPages` (clamped) into persist (full + incremental)
- `server/schemas/workspace-schemas.ts` — `keywordStrategySchema.maxPages`
- `src/components/strategy/hooks/useStrategySettings.ts` — `settingsOpen` default false; hydrate `maxPages` from saved strategy
- `src/components/strategy/ClientKeywordFeedback.tsx` — declined-only (requested block removed)
- `src/components/strategy/types.ts` — `StrategyBandProps`, `RequestedKeywordTriageProps`, updated `ClientKeywordFeedbackProps`
- `src/components/strategy/index.ts` — barrel exports for the two new leaves
- `src/components/KeywordStrategy.tsx` — flag fork + band layout (controller, integration barrier)
- `tests/unit/strategy/ClientKeywordFeedback.test.tsx`, `tests/unit/strategy/useStrategySettings.test.tsx` — update for the split + hydration

**Parallelism:** Tasks 1–5 are independent (`[PARALLEL]`) once Task 0 lands; Task 6 (orchestrator fork) is the controller-owned integration barrier. Workers never run git; controller commits per task. `scaled-code-review` after the parallel batch, before Task 6.

---

## Pre-flight contracts (committed in Task 0/1 before parallel dispatch)

Add to `src/components/strategy/types.ts`:

```typescript
export interface StrategyBandProps {
  /** Band label shown in the section divider, e.g. "Decide". */
  label: string;
  /** First band suppresses the top border so it sits flush under the header. */
  first?: boolean;
  children: React.ReactNode;
}

export interface RequestedKeywordTriageProps {
  requested: AdminKeywordFeedbackListRow[];
  addPending: boolean;
  addError: string | null;
  onAdd: (keyword: string) => void;
  onDismissError: () => void;
}
```

Change `ClientKeywordFeedbackProps` (remove the requested/add fields — they move to triage):

```typescript
export interface ClientKeywordFeedbackProps {
  rows: AdminKeywordFeedbackListRow[];
  declined: AdminKeywordFeedbackListRow[];
  approved: AdminKeywordFeedbackListRow[];
}
```

Add to `KeywordStrategy` in `shared/types/workspace.ts` (after `seoDataMode`, ~line 184):

```typescript
  /** The effective (clamped) page-limit used for the last generation. 0 = no limit. Persisted so the Settings UI can rehydrate it. */
  maxPages?: number;
```

---

### Task 0: Feature flag + roadmap item [controller — atomic]

`strategy-decision-bands` registration requires 5 coordinated edits in `shared/types/feature-flags.ts` (a runtime assertion at module load throws on any inconsistency), and the flag's `linkedRoadmapItemId` must be a real `data/roadmap.json` item.

**Files:**
- Modify: `data/roadmap.json`, `shared/types/feature-flags.ts`

- [ ] **Step 1: Add the roadmap sprint.** Insert a sprint into `data/roadmap.json` `sprints[]` (match the existing object shape: `id`, `name`, `hours`, `rationale`, `notes`, `items[]`). Items (each: `id`, `title`, `source`, `est`, `priority`, `status`, `createdAt`, `notes`):
  - `strategy-redesign-phase-0-decomposition` — status `done`, createdAt `2026-06-16`, notes: "Done 2026-06-16 (PR #1248): KeywordStrategy.tsx 1064→~350 lines; 5 hooks + 11 leaves; behavior-preserving."
  - `strategy-redesign-phase-1a-ia-scaffold` — status `in_progress`, createdAt `2026-06-16`. **This is the flag's `linkedRoadmapItemId`.**
  - `strategy-redesign-phase-1b-decision-queue` — status `pending`.
  Sprint id: `sprint-strategy-decision-first-redesign-2026-06-16`.

- [ ] **Step 2: Register the flag** — 5 edits in `shared/types/feature-flags.ts`, copying an existing active flag entry (e.g. `'client-work-feed'`) as the template:
  1. `FEATURE_FLAGS`: add `'strategy-decision-bands': false,`
  2. `FEATURE_FLAG_CATALOG`: add an entry with `label`, `group`, and all 7 lifecycle fields: `owner`, `createdAt: '2026-06-16'`, `rolloutTarget: 'staging-validation'`, `removalCondition` (e.g. "Remove after the 3-band Strategy IA is the default and Phase 4 lands"), `linkedRoadmapItemId: 'strategy-redesign-phase-1a-ia-scaffold'`, `staleAuditCadence: 'monthly'`, `lastReviewedAt: '2026-06-16'`.
  3. `FEATURE_FLAG_GROUPS`: add `'strategy-decision-bands'` to an existing group's `keys` (reuse a Strategy/SEO-adjacent group; do NOT create a new group unless none fits — a new group also needs a `FEATURE_FLAG_GROUP_LABELS` entry).
  4–5. Only if a new group label is introduced: add it to `FEATURE_FLAG_GROUP_LABELS`.

- [ ] **Step 3: Verify** — `npx tsx scripts/sort-roadmap.ts` then `npm run verify:feature-flags` (must exit 0 — checks dates aren't future, `linkedRoadmapItemId` resolves) then `npm run typecheck`.
- [ ] **Step 4: Commit** — `git commit -m "feat(strategy): add strategy-decision-bands flag + roadmap items (phase 1a)"`

---

### Task 1: `StrategyBand` container [PARALLEL]

**Files:** Create `src/components/strategy/StrategyBand.tsx`; Test `tests/unit/strategy/StrategyBand.test.tsx`. (Add `StrategyBandProps` to `types.ts` first if Task 0 didn't.)

Source reference for the divider markup: the current "Reference & Analysis" divider in `KeywordStrategy.tsx` (the `border-t` + uppercase label + flex-1 rule).

- [ ] **Step 1: Failing test** — renders `label`; renders children; when `first` the top border element is absent.

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrategyBand } from '../../../src/components/strategy/StrategyBand';

describe('StrategyBand', () => {
  it('renders the label and children', () => {
    render(<StrategyBand label="Decide"><div>child-content</div></StrategyBand>);
    expect(screen.getByText('Decide')).toBeInTheDocument();
    expect(screen.getByText('child-content')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail** (`npx vitest run tests/unit/strategy/StrategyBand.test.tsx`).
- [ ] **Step 3: Implement** — a labeled section wrapper. The header row mirrors the existing divider (uppercase `t-caption` muted label + a `flex-1 border-t`); `first` omits the leading `border-t`/spacing so the first band sits flush under the PageHeader. Children render in a `space-y-8` (or matching) column. Imports use leaf depth (`'../ui'` if any primitive is needed; otherwise none).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `refactor(strategy): add StrategyBand container`.

---

### Task 2: `maxPages` persistence fix [PARALLEL — server]

Full chain (research lane R3). Persist the **effective clamped** value, and thread through BOTH full and incremental generation.

**Files:** `shared/types/workspace.ts`, `server/keyword-strategy-persistence.ts`, `server/keyword-strategy-generation.ts`, `server/schemas/workspace-schemas.ts`; Test: `tests/unit/keyword-strategy-maxpages-persistence.test.ts` (or extend an existing persistence/generation test).

- [ ] **Step 1: Failing test** — call `persistKeywordStrategy({ ...opts, maxPages: 200 })`, read the strategy back (via the same read the GET route uses / `rowToWorkspace` strategy blob), assert `strategy.maxPages === 200`. Add a second case: incremental mode persists `maxPages` too.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the 6 edits:
  1. `shared/types/workspace.ts` — `KeywordStrategy.maxPages?: number` (contract above).
  2. `server/keyword-strategy-persistence.ts` — add `maxPages?: number` to `PersistKeywordStrategyOptions` (after `seoDataMode`, ~line 48); destructure it; write `maxPages: maxPages ?? undefined` into the strategy blob alongside `seoDataMode`/`businessContext` (~lines 106–128).
  3. `server/keyword-strategy-generation.ts` — at the `persistKeywordStrategy({ ... })` call, pass `maxPages: <the clamped maxPagesParam>` (the `rawMaxPages > 0 ? Math.min(rawMaxPages, KEYWORD_STRATEGY_MAX_PAGE_CAP) : 0` value, ~line 180). Ensure the incremental branch threads it too.
  4. `server/schemas/workspace-schemas.ts` — `keywordStrategySchema`: add `maxPages: z.number().optional()`.
  - (GET serialization already spreads `...strategy`, so no serializer change.)
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `fix(strategy): persist maxPages through the keyword-strategy chain`.

---

### Task 3: `RequestedKeywordTriage` split [PARALLEL — touches types + ClientKeywordFeedback]

**Files:** Create `src/components/strategy/RequestedKeywordTriage.tsx`; Modify `src/components/strategy/ClientKeywordFeedback.tsx`, `src/components/strategy/types.ts`, `src/components/strategy/index.ts`; Tests: new `RequestedKeywordTriage.test.tsx`, update `ClientKeywordFeedback.test.tsx`.

- [ ] **Step 1: Failing tests** — (a) `RequestedKeywordTriage`: renders each requested keyword; "Add to Strategy" calls `onAdd(keyword)`; renders the `addError` banner + `onDismissError`; renders nothing/empty-state when `requested` is empty. (b) `ClientKeywordFeedback` (updated): renders the declined log; no longer renders the requested block or an Add button.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — lift the InlineBanner + "Requested by client" block from `ClientKeywordFeedback.tsx` into `RequestedKeywordTriage.tsx`, wrapped in a `SectionCard` (teal `titleIcon`, title "Requested Keywords", count in `titleExtra`). Props = `RequestedKeywordTriageProps`. Strip that block from `ClientKeywordFeedback`; update its props to the new `ClientKeywordFeedbackProps` (declined-only — keep `rows`/`declined`/`approved` for the count + log). Add `RequestedKeywordTriage` to the barrel.
- [ ] **Step 4: Run → pass** (both files).
- [ ] **Step 5: Commit** — `refactor(strategy): split RequestedKeywordTriage out of ClientKeywordFeedback`.

---

### Task 4: Settings collapsed-by-default + `maxPages` hydration [PARALLEL — hook]

**Files:** `src/components/strategy/hooks/useStrategySettings.ts`; Test: update `tests/unit/strategy/useStrategySettings.test.tsx`.

- [ ] **Step 1: Failing test** — (a) `settingsOpen` initial value is `false`. (b) when `strategy.maxPages` is set, the hook hydrates `maxPages` to it on mount (set-once).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — change `useState(true)` → `useState(false)` for `settingsOpen`. Extend the hook's local `StrategyShape` with `maxPages?: number`. In the strategy-sync `useEffect` (the existing set-once block, ~lines 73–82), add `if (strategy?.maxPages != null) setMaxPages(strategy.maxPages);` guarded by the same set-once pattern (use a ref/initialized flag so a React Query background refetch never clobbers an in-session change). Keep the existing eslint-disable + justification.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `feat(strategy): collapse Settings by default + hydrate persisted maxPages`.

---

### Task 5: Header decision-summary helper [PARALLEL]

**Files:** add a tiny pure helper `src/components/strategy/strategySummaryLine.ts` (+ unit test) that builds the subtitle string from on-page counts.

- [ ] **Step 1: Failing test** — `buildStrategySummaryLine({ contentGaps, requested, quickWins })` returns e.g. `"3 gaps to brief · 2 requested keywords · 5 quick wins"`, omitting zero-count clauses, and returns the existing default subtitle when all are zero / no real strategy.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the pure function (no React). Pluralization mirrors the existing nudge copy.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `feat(strategy): add header decision-summary line builder`.

---

### Task 6: Orchestrator flag fork + band layout [controller — integration barrier]

Run after Tasks 1–5 merged + `scaled-code-review` of the batch is clean.

**Files:** `src/components/KeywordStrategy.tsx`.

- [ ] **Step 1:** Add `const decisionBandsEnabled = useFeatureFlag('strategy-decision-bands');` (import `useFeatureFlag` from its module per research). Split the single `<ClientKeywordFeedback .../>` call site into `<RequestedKeywordTriage .../>` + the declined-only `<ClientKeywordFeedback .../>`.
- [ ] **Step 2:** Inside the `analysis` tab, fork:
  - **`decisionBandsEnabled` true →** render the three `StrategyBand`s in order:
    - **Decide** (`first`): header decision summary (PageHeader `subtitle` via `buildStrategySummaryLine`), `RequestedKeywordTriage`, `StrategySettings` (now collapsed).
    - **Act:** `ContentGaps`, merged `QuickWins` + `LowHangingFruit`, `KeywordGaps`, `CannibalizationAlert`, `StrategyDiff` (moved up — position only, no rewiring this phase).
    - **Reference:** `StrategyStatGrid`, `RankingDistribution`, `TopicClusters`, `BacklinkProfile`, `CompetitiveIntel`, `SiteTargetKeywords`, `KeywordOpportunities`, `ClientKeywordFeedback` (declined log), `IntelligenceSignals`, `StrategyHowItWorks`.
  - **`decisionBandsEnabled` false →** the current layout, unchanged (today's order), with the `ClientKeywordFeedback`/`RequestedKeywordTriage` split rendered in the same spot the combined card used to be (so flag-off is visually identical).
  - Keep the shared chrome (header, RefreshOrderingPrompt, AIContextIndicator, LocalSeoVisibilityPanel, ProgressIndicator, error, NextStepsCard, empty state) outside the band fork — only the post-empty-state content reorganizes.
- [ ] **Step 3:** `npm run typecheck && npx vite build`.
- [ ] **Step 4:** `npx vitest run` (full suite).
- [ ] **Step 5:** `npm run pr-check` (watch the PageHeader rule — `<PageHeader>` stays in the orchestrator).
- [ ] **Step 6: Commit** — `feat(strategy): decision-first 3-band layout behind strategy-decision-bands flag`.

---

### Task 7: Verify + parity [controller]

- [ ] **Step 1: Flag-OFF parity** — with the flag off (default), confirm the page renders identically to `staging` (this is the safety guarantee). Component tests + a preview smoke if available.
- [ ] **Step 2: Flag-ON smoke** — enable the flag (admin feature-flag UI or query) and confirm the three bands render in order with no console errors; Settings is collapsed; requested keywords appear in the Decide band; declined log in Reference.
- [ ] **Step 3: Final gates** — `npm run typecheck && npx vite build && npx vitest run && npm run pr-check && npm run verify:feature-flags`.
- [ ] **Step 4:** Update the roadmap item `strategy-redesign-phase-1a-ia-scaffold` → `done` with notes when merged to staging (per definition-of-done).

---

## Self-Review (against the spec + research)

- **Spec coverage (Phase 1 clauses in 1a's scope):** flag ✓ (Task 0), band reorder ✓ (Task 6), Settings collapsed + `maxPages` fix ✓ (Tasks 2/4), requested-keyword triage hoist ✓ (Task 3), header decision summary ✓ (Tasks 5/6). Decision Queue is explicitly **1b** (out of scope here). ✓
- **Placeholder scan:** none — each task has exact files, anchors from research, and code/interfaces for new units. ✓
- **Type consistency:** `RequestedKeywordTriageProps`/`StrategyBandProps`/updated `ClientKeywordFeedbackProps`/`KeywordStrategy.maxPages` defined once in the contracts section, consumed by name. ✓
- **Risks flagged:** (1) flag registration is atomic-or-crash — Task 0 is one commit + `verify:feature-flags`. (2) `maxPages` must thread the incremental path too (Task 2). (3) set-once hydration guard so refetch can't clobber in-session edits (Task 4). (4) flag-off must be byte-identical — Task 7 Step 1 is the gate.

---

## Phase 1b preview (next plan, after 1a merges)
Decision Queue in the Decide band: extract `RecRow`/`OvBreakdown` from `AdminRecommendationQueue` into a shared admin module (point WorkspaceHome's queue at it too — behavior-preserving); build a focused `DecisionQueue` leaf using `useAdminRecommendationSet` (admin superset incl. `emvPerWeek`); render top rec + fix-now/fix-soon with **fix-CTA routing** (`navigate(adminPath(...), { state: { fixContext } })`, REC_TYPE_TAB extracted to a shared constant); fold the rec `summary` aggregates into the header decision summary.
