# Strategy Redesign — Phase 1b: Decision Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox (`- [ ]`) steps.

**Goal:** Add a focused **Decision Queue** to the top of the Strategy page's Decide band (flag `strategy-decision-bands`, ON only): the #1 recommendation + the `fix_now`/`fix_soon` buckets from the admin recommendation engine, each row with a one-click **Fix** CTA that deep-links to its fix surface. Reuse the existing admin rec rendering by extracting it into a shared row.

**Architecture:** Extract `RecRow`/`OvBreakdown`/`formatEmv` out of `AdminRecommendationQueue` into shared modules (behavior-preserving — `WorkspaceHome`'s queue must render identically), adding an optional `onFixCta` slot. Build `DecisionQueue` (strategy leaf) on `useAdminRecommendationSet` (admin route → full `OpportunityScore` incl. `emvPerWeek`), routing Fix CTAs via a new admin `REC_TYPE_ADMIN_TAB` map + `fixContext`. Mount it first in the Decide band — **flag-on only, so the legacy layout is untouched and flag-off parity is automatic.**

**Tech Stack:** React 19, TS strict, React Query, Vitest. **Base:** branch off `staging` (Phase 1a merged as `645349ae2`).

**Spec:** `docs/superpowers/specs/2026-06-16-strategy-page-decision-first-redesign-design.md`. Research: `wf_786d50ea`.

---

## Key facts (from research — do not re-derive)

- **Admin hook:** `useAdminRecommendationSet(workspaceId)` (`src/hooks/admin/useAdminRecommendations.ts:19`) → `UseQueryResult<RecommendationSet>`, GET `/api/recommendations/:id` (admin, **emvPerWeek NOT stripped** — safe to render here), staleTime 30s. `RecommendationSet.summary.topRecommendationId` points at the #1. Recs have `priority: 'fix_now'|'fix_soon'|'fix_later'|'ongoing'`, `opportunity?.value` (0-100), `opportunity?.emvPerWeek`, `type: RecType`, `affectedPages[]`, `targetKeyword?`, `status`.
- **Bucket sort** (match AdminRecommendationQueue): within a priority, `(b.opportunity?.value ?? b.impactScore) - (a.opportunity?.value ?? a.impactScore)`; filter `status !== 'dismissed'`.
- **emvPerWeek boundary:** `stripEmvFromPublicRecs` only runs on the PUBLIC route; the admin route is full. pr-check `opportunity-money-field-must-be-stripped` does NOT apply to admin surfaces. Safe.
- **Fix-CTA routing — per-RecType (NOT the client `REC_TYPE_TAB` verbatim):**
  | RecType(s) | tab | fixContext receiver? |
  |---|---|---|
  | `metadata` | `seo-editor` | ✅ SeoEditorWrapper (pageSlug, pageName) |
  | `schema` | `seo-schema` | ✅ SchemaSuggester (pageSlug) |
  | `content`, `content_refresh` | **`content-pipeline`** (NOT `seo-briefs` — zombie redirect drops state) | ✅ ContentPipeline (primaryKeyword, pageName) |
  | `technical`, `accessibility`, `aeo`, `cannibalization` | `seo-audit` | ❌ tab-nav only |
  | `strategy`, `keyword_gap`, `topic_cluster`, `local_visibility`, `local_service_gap` | `seo-strategy` | ❌ tab-nav only |
  | `performance` | `performance` | ❌ tab-nav only |
- **fixContext shape** (`src/App.tsx:77`): `targetRoute` (REQUIRED) + `pageId?/pageSlug?/pageName?/primaryKeyword?/autoGenerate?/...`. Navigate: `navigate(adminPath(workspaceId, tab), { state: { fixContext } })`.
- **Shared row:** `AdminRecommendationQueue.tsx` `RecRow` (props `{ rec; showUndismiss?; onUndismiss? }`, lines 113-257) + `OvBreakdown` (`{ rec }`, 85-110) + `formatEmv` (77-82, file-private). No CTAs today.

---

## File Structure

**Create:**
- `src/lib/formatEmv.ts` — moved `formatEmv` (+ test)
- `src/lib/recTypeTab.ts` — `REC_TYPE_ADMIN_TAB: Record<RecType, Page>` + `buildRecFixContext(rec)` helper (+ test)
- `src/components/admin/recommendations/RecommendationRow.tsx` — extracted `RecRow` (+ `OvBreakdown`), with an additive `onFixCta?: (rec: Recommendation) => void` (renders a "Fix" button when provided) (+ test)
- `src/components/strategy/DecisionQueue.tsx` — the queue leaf (+ test)
- `tests/...` per file

**Modify:**
- `src/components/admin/AdminRecommendationQueue.tsx` — import the extracted row/breakdown/formatEmv; delete the local copies (behavior-preserving; pass no `onFixCta`)
- `src/components/strategy/types.ts` — `DecisionQueueProps`, `RecommendationRowProps`
- `src/components/strategy/index.ts` — export `DecisionQueue`
- `src/components/KeywordStrategy.tsx` — mount `<DecisionQueue>` first in the flag-on Decide band

---

### Task A: Extract shared rec-row + helpers (behavior-preserving) [controller]

- [ ] **A1:** Create `src/lib/formatEmv.ts` exporting `formatEmv(emv: number): string` (verbatim from `AdminRecommendationQueue.tsx:77-82`) + a unit test (`<$1/wk`, `$X/wk`, `$X.Yk/wk`, `$Xk/wk` thresholds).
- [ ] **A2:** Create `src/components/admin/recommendations/RecommendationRow.tsx` exporting `RecommendationRow` + `OvBreakdown`. Move the JSX verbatim from `AdminRecommendationQueue.tsx:85-257`. Props: `{ rec: Recommendation; showUndismiss?: boolean; onUndismiss?: (recId: string) => void; onFixCta?: (rec: Recommendation) => void }`. When `onFixCta` is set, render a small teal "Fix" `Button` (size sm) in the collapsed header row's right edge (next to the chevron); calls `onFixCta(rec)` and `stopPropagation` so it doesn't toggle expand. `formatEmv` imported from `../../../lib/formatEmv`. `RecommendationRowProps` added to `strategy/types.ts`? No — keep this type co-located in the admin module (it's an admin component); export it from the row file. Test: renders priority/status/OV/title; "Fix" button appears only with `onFixCta` and fires it without toggling expand.
- [ ] **A3:** Refactor `AdminRecommendationQueue.tsx`: delete local `RecRow`/`OvBreakdown`/`formatEmv`; import `RecommendationRow` + `OvBreakdown` from the new module + `formatEmv` from `src/lib/formatEmv`. Replace `<RecRow .../>` usages with `<RecommendationRow .../>` (same props, no `onFixCta`). Verify the existing `WorkspaceHome`/AdminRecommendationQueue tests still pass (behavior-preserving).
- [ ] **A4:** Create `src/lib/recTypeTab.ts`: `REC_TYPE_ADMIN_TAB: Record<RecType, Page>` per the routing table above, and `buildRecFixContext(rec: Recommendation): { tab: Page; fixContext: { targetRoute: Page; pageSlug?: string; pageName?: string; primaryKeyword?: string } }` (tab = map[rec.type] ?? 'seo-audit'; fixContext.targetRoute = tab; include pageSlug=rec.affectedPages[0], pageName=rec.title, primaryKeyword=rec.targetKeyword). Test: every `RecType` has a mapping; `content`/`content_refresh` map to `content-pipeline` (NOT `seo-briefs`).
- [ ] **A5:** typecheck + `vitest run` the affected tests (RecommendationRow, formatEmv, recTypeTab, AdminRecommendationQueue) + pr-check; commit.

### Task B: DecisionQueue leaf [1 agent or controller]

- [ ] **B1:** Add `DecisionQueueProps { workspaceId: string }` to `strategy/types.ts`.
- [ ] **B2:** Create `src/components/strategy/DecisionQueue.tsx`:
  - `useAdminRecommendationSet(workspaceId)`; loading → `<Skeleton>`/`<LoadingState>`; error → null (don't block the page).
  - From the set: `topRec` = recommendations.find(id === summary.topRecommendationId); buckets = recommendations filtered `status !== 'dismissed'`, grouped into `fix_now` + `fix_soon`, each sorted by `(opportunity?.value ?? impactScore)` desc.
  - Render inside a `SectionCard` titled "Do this next": the topRec as a lead `RecommendationRow` (with `onFixCta`), then the fix_now + fix_soon rows (excluding topRec to avoid dupes), each `RecommendationRow` with `onFixCta`.
  - `onFixCta(rec)` = `const { tab, fixContext } = buildRecFixContext(rec); navigate(adminPath(workspaceId, tab), { state: { fixContext } });` (uses `useNavigate`).
  - Empty state (no fix_now/fix_soon): `<EmptyState>` "No urgent actions — your strategy is on track." Returns the card with the empty state (don't render null, so the band has a stable anchor).
  - Test (mock `useAdminRecommendationSet`): renders the top rec + bucket rows; clicking "Fix" on a `content` rec navigates to `content-pipeline` with fixContext (wrap in MemoryRouter, assert navigation); empty state when no fix_now/fix_soon.
- [ ] **B3:** Export `DecisionQueue` from `strategy/index.ts`. typecheck + test; commit.

### Task C: Mount in the Decide band [controller — integration]

- [ ] **C1:** In `KeywordStrategy.tsx`, import `DecisionQueue` from `./strategy`; in the **bands** layout's Decide band, render `<DecisionQueue workspaceId={workspaceId} />` FIRST (before `feedbackNudgeEl`, `requestedTriageEl`, `settingsEl`). Do NOT touch the legacy layout (flag-off parity is automatic).
- [ ] **C2:** Add a flag-on orchestrator test (extend `KeywordStrategyBackgroundJob.test.tsx`): with `decisionBandsEnabled=true`, the Decision Queue card ("Do this next") renders in the Decide band. Mock `useAdminRecommendationSet` (add to the file's mocks). Confirm flag-off still shows neither the bands nor the queue.
- [ ] **C3:** Full gates: `typecheck && vite build && vitest run && pr-check`. Flag-off parity = automatic (legacy branch untouched) but confirm the existing `KeywordStrategyBackgroundJob` flag-off tests still pass.

### Task D: Verify + PR
- [ ] Scaled review (parallel) — focus: AdminRecommendationQueue/WorkspaceHome parity after extraction; DecisionQueue routing correctness (the seo-briefs gotcha, non-receiver tabs); emvPerWeek only on admin. Fix confirmed findings.
- [ ] Update roadmap item `strategy-redesign-phase-1b-decision-queue` → done on merge. Push + PR to staging.

---

## Self-Review
- **Spec coverage:** Decision Queue (top rec + fix_now/fix_soon + fix-CTAs) ✓; admin superset via `useAdminRecommendationSet` ✓; reuse existing rendering (extract shared row) ✓; no new rec renderer ✓.
- **Parity:** two surfaces — (1) Strategy flag-off: automatic (queue is bands-only). (2) WorkspaceHome AdminRecommendationQueue: Task A is behavior-preserving (no `onFixCta` passed).
- **Routing gotchas encoded:** `content*` → `content-pipeline` (not zombie `seo-briefs`); non-receiver tabs are tab-nav only. `REC_TYPE_ADMIN_TAB` is the single admin source of truth (separate from the client map by design).
- **Type consistency:** `DecisionQueueProps`, `RecommendationRowProps`, `buildRecFixContext` defined once.
