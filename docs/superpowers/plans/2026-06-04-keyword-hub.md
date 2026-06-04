The anchors are confirmed. The drafts are well-grounded against real code. I have everything I need to synthesize the complete plan. Producing it now.

The anchors verified (`finalizeDraftRow` at `server/keyword-command-center.ts:1108`, `sourceGapKey` projected at `:1143` but `strategyOwned` NOT projected, `KeywordTable` props at `src/components/shared/RankTable.tsx:271`/`:317`, the flag catalog shape + `assertFeatureFlagGroupingConsistency()` at `shared/types/feature-flags.ts:882`) all match the drafts. Here is the complete plan.

---

# Keyword Hub — Wave 4 Implementation Plan

> **For agentic workers: REQUIRED SUB-SKILL — `superpowers:subagent-driven-development`.** Execute this plan one phase at a time, dispatching the per-phase tasks per the within-phase dependency graph (parallel batches where marked), with a diff-review checkpoint after each parallel batch. Each phase is its own flag-gated PR — merged and green on `staging` before the next phase begins.

**Plan file:** `docs/superpowers/plans/2026-06-04-keyword-hub.md`
**Spec:** `docs/superpowers/specs/2026-06-04-keyword-hub-design.md` (approved)
**Worktree/branch:** `/Users/joshuahampson/CascadeProjects/asset-dashboard/.worktrees/feat-keyword-wave4` (`feat/keyword-hub-wave4`, off latest `staging`)

## Goal

A user can follow any keyword's full journey — from the strategy gap that proposed it → the decision to track it → its live national + per-market rank → why anything was retired — in **one** admin surface (the **Keyword Hub**), with keyword identity carried in every cross-surface URL. This consolidates the admin **Keyword Command Center** (KCC, `seo-keywords`) and the standalone **Rank Tracker** (`seo-ranks`) into one keyword-first Hub. It is the visible payoff of the Wave 1–3 data-model consolidation (`sourceGapKey` provenance, `strategy_owned` ownership, normalized tables).

## Architecture

- **One list, one renderer.** The Hub list is the canonical `KeywordTable`/`RankTable` primitive (`src/components/shared/RankTable.tsx:271`) configured with curated segments, debounced search, interactive column sort, multi-select, `showLocalSeo`, density, `renderActions`, `renderKeywordMeta`, `renderExpanded`. P0 migrates **both** the bespoke KCC `KeywordRow` grid and the hand-rolled RankTracker grid onto it (behavior-preserving), extending the primitive additively where the KCC's bespoke columns demand it.
- **One data source.** The Hub reads the existing KCC bundle (`buildKeywordCommandCenterModel` / `buildKeywordCommandCenterRows` / `buildKeywordCommandCenterDetail`, `server/keyword-command-center.ts`) — already carrying lifecycle, `sourceGapKey`, local-SEO summary, and the rank snapshot. The **only** server addition is exposing `strategyOwned` on the emitted tracking row (additive, admin-only).
- **Deep-links carry identity.** Cross-surface links use a shared `?q=` (normalized keyword) + `?tab=` (segment) contract that honors the `?tab=` two-halves rule (receiver reads `useSearchParams`). The KCC becomes a compliant receiver.
- **Lifecycle becomes declarative.** A keyword transition map is added to `server/state-machines.ts` and the KCC action engine routes status changes through `validateTransition` — closing the "keywords are the only status entity not state-machine-guarded" gap. Remove = **Retire (soft, restorable)** by default; **Delete (hard, confirmed, separated, red)** is its own channel, never a lifecycle action.
- **Dark by default.** The whole Hub gates behind `<FeatureFlag flag="keyword-hub">` (added P0, dark/OFF), flipped only at P5 cutover. `seo-ranks` folds in via redirect (route-removal-checklist), not deletion, until P5.

## Tech Stack

- **Frontend:** React + TypeScript, React Query (admin-prefixed keys), `src/components/ui` primitives (`KeywordTable`, `StatusBadge`, `Badge`, `SectionCard`, `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton`, `TierGate`, `ConfirmDialog`, `FeatureFlag`, `PageHeader`, `FormInput`, `Button`/`IconButton`), `useWorkspaceEvents` broadcasts, `useSearchParams` deep-links. Build: Vite. Tests: Vitest + React Testing Library.
- **Server:** TypeScript, SQLite (BEGIN IMMEDIATE writers), the KCC bundle + tracked-keywords store + rank-tracking modules, `validateTransition` state machines, `broadcastToWorkspace` + activity log.
- **Gates:** `npm run typecheck` (project-aware `tsc -b`), `npx vite build`, `npx vitest run`, `npx tsx scripts/pr-check.ts`, `npm run verify:feature-flags`, `npm run verify:deprecations` (P5), `npm run verify:coverage-ratchet`.

---

## Overview

Six sequential phases, each a flag-gated PR (merged + green on `staging` before the next):

| Phase | Theme | Net behavior | Model headline |
|---|---|---|---|
| **P0** | Shell + flag + table migration | Additive flag + field; behavior-preserving renderer migration | Opus (Task 3 blast radius) |
| **P1** | Unified Hub list (segments/search/sort/multi-select) | New visible surface, dark behind flag | Sonnet |
| **P2** | Keyword journey drawer (origin/tracking/rank/local/lifecycle) | New render of already-exposed data | Haiku + Sonnet |
| **P3** | Action model (state machine + retire-soft/delete-hard) | New behavior on reused engine | Opus |
| **P4** | Deep-links + nav + Rank-Tracker fold-in | New deep-links + behavior-preserving redirect | Opus |
| **P5** | Cutover (flag lifecycle + dead-code removal) | Flag-active + behavior-preserving deletion | Haiku/Sonnet + Opus checklist |

The flag stays **OFF in production** through P4; the visible-to-users flip is gated on owner staging sign-off in P5.

---

## Pre-requisites

- [ ] **Spec committed.** `docs/superpowers/specs/2026-06-04-keyword-hub-design.md` is approved and committed in the worktree.
- [ ] **Grounding in lieu of a separate pre-plan audit.** Per `docs/PLAN_WRITING_GUIDE.md` Step 1, a standalone `pre-plan-audit` is **not** re-run here: this plan is largely *new-file* feature work (Hub components, hooks, deep-link module, state-machine block) grounded in **two prior audits** — the UX-consolidation audit and the actions/lifecycle audit — whose verified `file:line` anchors are embedded per task. The two genuinely cross-file, "all sites" operations (the route-removal blast radius in P4 and the dead-code sweep in P5) carry their **own** enumerated grep-confirmed file lists in-phase, which is where audit coverage is load-bearing. **Execution rule:** every task RE-CONFIRMS its cited `file:line` against real code before writing (anchors drift); if real code contradicts a contract here, STOP and report `NEEDS_CONTEXT`.
- [ ] **Shared contracts pre-committed before each parallel batch.** Per `docs/PLAN_WRITING_GUIDE.md` Step 3: before dispatching any parallel batch, commit the shared artifacts that batch imports (shared types, exported signatures, new contract modules). Each phase's dependency graph below names exactly which artifact must be pre-committed before its parallel fan-out.
- [ ] **Worktree on latest `staging`.** `feat/keyword-hub-wave4` is branched off the latest `staging`.
- [ ] **Port hygiene (memory).** Before any commit/push, kill orphan `13xxx` ports or the pre-commit hook flakes. New integration tests use **13900** (current max in `tests/` is 13899) — `grep -rEo 'createTestContext\(13[0-9]{3}' tests/ | sort | uniq -d` must be empty.

---

## Bounded Context + Ownership

- **Owning bounded context** (per `docs/rules/platform-organization.md`): **keyword / rank-tracking + Keyword Command Center** (`server/keyword-command-center.ts`, `server/rank-tracking.ts`, `server/state-machines.ts`; the admin `seo-keywords` surface). **Secondary integrations:** `seo-health` (local-SEO annotation already on the KCC row), platform routing/nav (`src/routes.ts`, `src/App.tsx`, `src/components/layout/*`, `src/components/CommandPalette.tsx`), and `seo-strategy` (the keyword on-ramp + deep-link sender).
- **Route / API surface:** Pages `seo-keywords` (evolves into the Hub) and `seo-ranks` (folds in via redirect, deleted only at P5). API: the existing KCC bundle endpoints (`GET …/keyword-command-center/:workspaceId/rows|summary`, the actions route) + one dedicated hard-delete route (P3). No new "what counts as a keyword" definition.
- **Shared type contracts:** `shared/types/feature-flags.ts` (the `keyword-hub` flag), `shared/types/keyword-command-center.ts` (`KeywordCommandCenterTrackingState.strategyOwned`, the row/sort/filter/counts types), `shared/types/local-seo.ts` (per-market `markets[]`), `shared/types/rank-tracking.ts` (`TRACKED_KEYWORD_STATUS`), `server/state-machines.ts` (`TRACKED_KEYWORD_TRANSITIONS`), and the new `src/lib/keywordHubDeepLink.ts`.
- **React Query keys:** the `admin-keyword-command-center` family (already in `src/lib/queryKeys.ts`) + `queryKeys.admin.rankTrackingHistoryQueries`. **No new key family** is introduced; the Hub reuses admin-prefixed keys.
- **WebSocket events:** `RANK_TRACKING_UPDATED` + `STRATEGY_UPDATED` (+ `INTELLIGENCE_SIGNALS_UPDATED` on add/decline/restore) — all already registered; **no new events**. Both-halves: `broadcastToWorkspace` after mutation + `useWorkspaceEvents` on the Hub host (never `useGlobalAdminEvents`).
- **Test ownership:** per-phase, declared in each task's Owns block (unit at `tests/unit/`, component at `tests/component/`, integration at `tests/integration/` port 13900, contract at `tests/contract/`).
- **New vs behavior-preserving, per phase:** P0 = additive contract + behavior-preserving renderer migration; P1 = new surface (dark); P2 = new render of already-exposed data; P3 = new lifecycle/delete behavior on a reused engine; P4 = new deep-links + behavior-preserving redirect/relabel; P5 = flag-activation (new) + behavior-preserving dead-code deletion.

---

## Phase P0 — Shell + Flag + Table Migration

> Behavior-preserving foundation. Ships **dark** behind `<FeatureFlag flag="keyword-hub">`. Three tasks: add the flag, expose `strategyOwned` on the KCC tracking row (additive, server-only), and migrate **both** the bespoke KCC `KeywordRow` grid and the `RankTracker` grid onto `KeywordTable`. No nav/route changes (those are P4). **Owning context:** keyword surface (KCC). Secondary read surface: `seo-health` (local-seo annotation already on the KCC row).

### Task P0-T1 — Add the `keyword-hub` feature flag (Model: **Sonnet**)

**Owns:** `shared/types/feature-flags.ts`; `data/roadmap.json` (add the linked roadmap item the verifier requires); `tests/unit/feature-flags-keyword-hub.test.ts` (new).
**May READ, must NOT modify:** `scripts/feature-flag-lifecycle.ts`, `src/hooks/useFeatureFlag.ts`, `src/components/ui/FeatureFlag.tsx`.

**Contract (the SHAPE — verified against `shared/types/feature-flags.ts`, four lockstep insertion sites):**
- Add `'keyword-hub': false` to `FEATURE_FLAGS` (near `:100`, after `'seo-generation-quality': false`). Default **false** = dark. This makes `'keyword-hub'` a member of `FeatureFlagKey`.
- Add group label `'Keyword Hub'` to `FEATURE_FLAG_GROUP_LABELS` (`:144`) — widens `FeatureFlagGroupLabel` (`:160`).
- Add `FEATURE_FLAG_CATALOG['keyword-hub']` (`:187`) of type `FeatureFlagCatalogEntry`: `{ label, group: 'Keyword Hub', lifecycle }`. `lifecycle` requires ALL of `owner: 'analytics-intelligence'` (or `'seo-keywords'` — confirm the canonical owner string at read time), `createdAt: '2026-06-04'`, `rolloutTarget: 'staging-validation'` (∈ `FEATURE_FLAG_ROLLOUT_TARGETS`), `removalCondition`, `linkedRoadmapItemId: 'keyword-hub-wave4'`, `staleAuditCadence` (∈ `FEATURE_FLAG_AUDIT_CADENCES`), `lastReviewedAt: '2026-06-04'`. **Mirror the `local-seo-visibility` precedent** (catalog entry `:637`, group `:793`).
- Add `{ label: 'Keyword Hub', keys: ['keyword-hub'] }` to `FEATURE_FLAG_GROUPS` (`:732`).

**Test assertions:**
- `FEATURE_FLAGS['keyword-hub'] === false`.
- `FEATURE_FLAG_CATALOG['keyword-hub'].group === 'Keyword Hub'` and `.lifecycle.rolloutTarget === 'staging-validation'`.
- The module imports without throwing — `assertFeatureFlagGroupingConsistency()` (`:856`–`:882`) runs at import time and throws if the key is missing from a group, mis-grouped, duplicated, or unknown. Add an explicit assertion documenting that importing the module exercises this.
- `FEATURE_FLAG_GROUPS.find(g => g.label === 'Keyword Hub')?.keys` equals `['keyword-hub']`.

**Constraints/gotchas:**
- **`verify:feature-flags` (`scripts/feature-flag-lifecycle.ts`) is a hard gate.** `lifecycle.linkedRoadmapItemId` must be a legacy id (`LEGACY_FEATURE_FLAG_ROADMAP_IDS`) OR a **real** id in `data/roadmap.json` — add a `keyword-hub-wave4` roadmap item, else `missingRoadmapLinks` exits non-zero. It also rejects future-dated `createdAt`/`lastReviewedAt`; today (`2026-06-04`) is fine.
- The four insertion sites move in lockstep or the import-time assertion throws — let it catch you in red.
- Per "Phase-per-PR," the flag MUST be added before the first commit that gates anything on it. This task is that rule's embodiment.

**Verification:** `npm run verify:feature-flags`; `npx vitest run tests/unit/feature-flags-keyword-hub.test.ts`; `npm run typecheck`.

### Task P0-T2 — Expose `strategyOwned` on the emitted KCC tracking row (Model: **Sonnet**)

**Owns:** `shared/types/keyword-command-center.ts` (the `KeywordCommandCenterTrackingState` interface); `server/keyword-command-center.ts` (the `finalizeDraftRow` tracking whitelist only); `tests/unit/keyword-command-center.test.ts` (extend); `tests/integration/tracked-keywords-row-table.test.ts` (extend).
**May READ, must NOT modify:** `server/rank-tracking-reconciliation.ts`, `server/tracked-keywords-store.ts`, `shared/types/rank-tracking.ts`, `server/rank-tracking.ts`.

**Contract (the SHAPE — re-confirmed: `sourceGapKey` IS projected at `finalizeDraftRow` `:1143`; `strategyOwned` is merged end-to-end via `mergeTrackedKeywordProvenance` `:387`/`:397` and consumed by `lifecycleStatus` `:446` but **NOT projected** onto the emitted row):**
- `KeywordCommandCenterTrackingState` (`shared/types/keyword-command-center.ts:127-154`) gains one optional field `strategyOwned?: boolean` (three-state; `undefined` = ownership unknown). JSDoc it exactly like the sibling `sourceGapKey` (`:135-142`): admin-only, sourced from the provenance-bearing table read, three-state — a truthiness guard is a bug (`false` is a real value).
- `finalizeDraftRow` (`server/keyword-command-center.ts:1108-1169`) adds **one line** to the `tracking` object literal alongside `sourceGapKey` (`:1143`): `strategyOwned: row.tracking.strategyOwned,`.
- **No new read, no new merge, no new DB work.** The field exists end-to-end; this opens only the projection gate.

**Test assertions:**
- **Unit** (mirror the `addTrackedKeyword(..., { strategyOwned: true })` seed + `hasSignal` pattern): seed a tracked keyword with `strategyOwned: true`, build via `buildKeywordCommandCenterDetail` (`:2195`), assert `detail.row.tracking.strategyOwned === true`. Seed a second WITHOUT it, assert `row.tracking.strategyOwned === undefined` (three-state default — NOT `false`).
- **Integration** (sibling to the existing "KCC tracking row exposes sourceGapKey" test, `:472-473`): via the admin KCC route, assert the emitted tracking row carries `strategyOwned` when `strategy_owned = 1`.
- **No-leak guard (REQUIRED, spec §Risks #3):** the **public** read path never echoes `strategyOwned`. Extend the existing strip/no-leak test (`:441-469`): `getTrackedKeywords` row has no own property `strategyOwned` and `JSON.stringify(publicBody)` does not contain `'strategyOwned'` (pinned by `tracked-keywords-store.ts:351` `delete out.strategyOwned`).

**Constraints/gotchas:**
- **Additive, server-only, admin-only.** Do NOT touch `getTrackedKeywords`, public serializers, or `tracked-keywords-store.ts` — they intentionally STRIP `strategyOwned`.
- **Three-state discipline:** project the raw value, never `Boolean(...)`/`?? false` — coercing `undefined`→`false` mislabels every pre-3d-ii row as "explicitly not owned."
- NOT a DB-column-add (column + mapper already exist) — the "DB column + mapper lockstep" rule does not apply; confirm at read time.

**Verification:** `npx vitest run tests/unit/keyword-command-center.test.ts tests/integration/tracked-keywords-row-table.test.ts`; `npm run typecheck`.

### Task P0-T3 — Migrate the KCC grid AND the RankTracker grid onto `KeywordTable` (behavior-preserving) (Model: **Opus**)

> The risky, sequential core (spec §Risks #6: "P0 table migration may be *extension*, not a swap"). Migrating the bespoke KCC row onto `KeywordTable` means **extending the primitive and/or driving it via a Hub-specific row config**, not a clean drop-in. **Opus** for broad blast radius across two surfaces + a shared primitive with many existing consumers.

**Owns:** `src/components/shared/RankTable.tsx` (the `KeywordTable` primitive — extend **only additively**); `src/components/KeywordCommandCenter.tsx` + `src/components/keyword-command-center/KeywordRow.tsx` + `VariantSubRow.tsx`; `src/components/RankTracker.tsx`; `tests/component/KeywordTable.test.tsx`, `tests/component/KeywordCommandCenter.test.tsx`, `tests/component/RankTracker.test.tsx`.
**May READ, must NOT modify:** `shared/types/keyword-command-center.ts` (P0-T2 owns — import `strategyOwned`), `shared/types/feature-flags.ts` (P0-T1), `KeywordBulkActionBar.tsx`, `KeywordDetailDrawer.tsx`, `kccDisplayHelpers.ts`, `kccActionHelpers.ts`, `src/components/ui/constants.ts`, `pageIntelligenceDisplay.ts`. **Do NOT touch the other `KeywordTable` consumers** (`client/SearchTab` → `RankTrackingSection`, the `RankTable` legacy wrapper, `RankTable.tsx:497-579`) — their byte-identical contract + tests (`KeywordTable.test.tsx:329-394`) must stay green.

**What `KeywordTable` ALREADY provides** (verified `src/components/shared/RankTable.tsx`): superset row `KeywordTableRow` (`:100`), `renderActions` (`:207`), `renderKeywordMeta` (`:209`), `renderVariant` (`:215`), `selection` checkbox column (`:185`), `showLocalSeo` flag-gated `Local` column reading `row.localSeoLabel` (`:177`/`:344`), `sort` headers (`:187`), per-row expand `isRowExpanded`/`renderExpanded` (`:210-213`), `density`, `loading` skeleton + `emptyState`, `stickyHeader`, built-in data columns `position|change|clicks|impressions|ctr|volume|difficulty` (`KeywordColumnKey` `:85`), and `changeSign` resolving the RankChange-vs-RankTracker sign conflict (`:168`).

**Gap analysis — what the KCC bespoke row needs that `KeywordTable` lacks** (re-confirm against `KeywordRow.tsx`+`VariantSubRow.tsx`):
1. **Custom non-metric columns** with no `KeywordColumnKey` equivalent: **Status** (`StatusBadge domain="keyword-command-center"`), **Local** (bespoke `LocalSeoStateBadge`, richer than the plain `localSeoLabel`), **Demand** (volume/impressions via `compactNumber`), **Rank/KD** (currentPosition OR `difficulty/100`), **Assignment** (page title/path, amber unmapped state), **Next** (variant-count + up-to-2 next-action badges). `KeywordTable` has **no generic custom-column slot** today.
2. **Rich in-cell keyword meta** (Protected, Lost-Visibility, LocalSeo badges + source sub-label) — `renderKeywordMeta` exists and can carry this.
3. **Variant sub-rows** — KCC aligns to a CSS-grid template; `KeywordTable.renderVariant` renders a single full-width `<td colSpan>` — alignment differs.
4. **RankTracker affordances that must survive** (spec §2a): pin toggle, hard-remove trash, expand-to-sparkline, Strategy/Client source badges, Open-page deep-link, pinned-sort, and the separate pinned **Trends** chart + Capture-Snapshot action (which stay as **siblings** of the table, like `RankHistoryChart`/`RankTrackingSection` already do).

**Extension contract (the decision this phase EXPORTS) — pick ONE, additive, non-breaking:**
- **Option A (recommended): a generic custom-column slot on `KeywordTable`** — `customColumns?: Array<{ key: string; header: ReactNode; align?: 'left'|'right'; sortKey?: string; render: (row: T) => ReactNode }>`, rendered between the keyword cell and the `showLocalSeo`/actions columns, wired into the existing `SortHeader`/`sort` machinery and counted in `totalCols` (`:317-322`) so variant/expanded `colSpan` rows stay aligned.
- **Option B: a Hub-specific `KeywordHubTable` wrapper** composing `KeywordTable` with a fixed column set, if the generic slot proves too invasive to the byte-identical legacy wrappers.
- Whichever — **purely additive**: every existing prop default and the `RankTable`/`RankTrackingSection` byte-identical output stay unchanged (enforced by `KeywordTable.test.tsx` staying green).

**Test assertions (extend, do not rewrite):**
- **Primitive (`KeywordTable.test.tsx`):** the new slot renders custom headers + per-row cells; custom columns participate in `sort` (clicking a custom header fires `onSort` with its `sortKey`); `totalCols`/`colSpan` stays correct (an expanded/variant row still spans full width — assert the expanded `<td>` `colSpan`). ALL pre-existing assertions (`:46-394`, incl. the byte-identical wrappers) remain green unmodified.
- **KCC (`KeywordCommandCenter.test.tsx`):** post-migration the same visible affordances still render — Status badge, Local cell, Demand value, Rank/KD value, Assignment text (incl. amber "Not yet mapped"), variant-count + next-action badges, multi-select wired to the existing bulk bar, expand-variants toggle, server pagination Prev/Next, search/filter pills. Re-use the existing mock harness; this is a migration-equivalence test (existing behavioral assertions retargeted at the new DOM).
- **RankTracker (`RankTracker.test.tsx`):** pin toggle, remove (trash), row-expand sparkline, Strategy/Client source badges, Open-page deep-link, pinned-first sort, the Trends-chart sibling, and Capture-Snapshot all still function. The `lowerIsBetter` change-sign convention is preserved (negative change = improvement = emerald ↑, matching `RankTable.tsx:485-495` + `KeywordTable.test.tsx:108-121`).

**Constraints/gotchas:**
- **Behavior-preserving is the bar** — a refactor onto a shared renderer, not a redesign. No segment curation, no new search/sort UX, no journey drawer (those are P1/P2). Visible output effectively unchanged.
- **Four Laws of Color:** both surfaces already comply (teal actions, blue data `text-blue-400`, emerald success, amber/red warn). Preserve exactly — no `violet`/`indigo`/`rose`/`pink`/`text-green-400`. Route KCC's hand-rolled `#${pos.toFixed(1)}` and RankTracker's `positionColor` through the primitive's `position` column where the format matches, or a custom column where KCC's KD-fallback differs (`positionColor()`/`kdColor()`/`fmtNum` are already consumed by the primitive).
- **Primitives over hand-roll:** continue using `StatusBadge`, `Badge`, `Checkbox`, `Button`, `IconButton`, `EmptyState` inside the custom-column `render` callbacks.
- **Mobile + a11y (spec §Risk #7, DoD):** preserve `overflow-x-auto`/`min-w` horizontal-scroll; keep `srOnlyLabel` checkbox labels, `aria-label`s on icon actions, and keyboard-focusable row-open affordance (`ClickableRow`).
- **Do not regress the other consumers** — run the FULL component suite, not just new tests.
- **Sequential within this task:** extend the primitive FIRST (red→green on `KeywordTable.test.tsx`), THEN migrate KCC, THEN migrate RankTracker — each its own red→green→commit so a break is localized.

**Verification:** `npx vitest run tests/component/KeywordTable.test.tsx tests/component/KeywordCommandCenter.test.tsx tests/component/RankTracker.test.tsx`; `npm run typecheck`; `npx vite build`; preview screenshots of the migrated KCC + Rank Tracker confirming unchanged appearance.

### P0 within-phase dependency graph

```
Pre-commit before the parallel batch: (nothing external — both tasks own disjoint files)

Parallel batch (independent files, no shared state):
  P0-T1 (flag: feature-flags.ts + roadmap.json)   ∥   P0-T2 (strategyOwned: kcc types + server projection)

Diff-review checkpoint (after the parallel batch, before T3):
  git diff · npx tsc --noEmit --skipLibCheck · npx vitest run (full)

Pre-commit before T3: commit P0-T2's shared type (KeywordCommandCenterTrackingState.strategyOwned).

Sequential core:
  P0-T3 (table migration)  — internally sequential: extend primitive → migrate KCC → migrate RankTracker
```

- **T1 ∥ T2** are fully parallel (disjoint ownership, no import relationship).
- **T3 depends on T2** ONLY for the `strategyOwned` type (so the migrated KCC row/drawer reads it without a type error). **Commit T2's shared type before dispatching T3.** T3 does not need T1 to compile — the flag is consumed at the Hub-mount site (P1+); P0 keeps both surfaces mounted as-is.

### P0 exports (downstream)

- `FeatureFlagKey` now includes `'keyword-hub'` (P1 mounts under it; P5 flips it).
- `KeywordCommandCenterTrackingState.strategyOwned?: boolean` — emitted by `buildKeywordCommandCenterDetail`/`buildKeywordCommandCenterRows` on every tracking row, admin-only, never on the public read path (invariant pinned by T2's no-leak test). P1's row meta + P2's drawer read it.
- The **extended `KeywordTable` contract** (Option A custom-column slot or Option B `KeywordHubTable`) is the canonical Hub list renderer. P1 adds segments/search/sort/multi-select on top; P2 wires `renderExpanded` to the drawer; P3 wires `renderActions` to the action set.

---

## Phase P1 — Unified Hub List

> Builds the visible Hub list inside the existing `seo-keywords` page, dark behind `keyword-hub`. Introduces a **parallel** `KeywordHub` component (not a replacement of the existing `KeywordCommandCenter` renderer) using `KeywordTable` directly with KCC data. No nav rename, no journey drawer, no actions — those are P4/P2/P3. **Owner:** `seo-keywords` / keyword lifecycle. Consumes `admin-keyword-command-center` keys (already registered). WS: `RANK_TRACKING_UPDATED`, `STRATEGY_UPDATED` (both already registered; no new events).

### Task P1-T1 — Hub list shell + shared interaction-state hook (Model: **Sonnet**) — sequential gate

**Owns:** `src/components/KeywordHub.tsx` (new — stub shell only in this task); `src/hooks/admin/useKeywordHubState.ts` (new — the single shared interaction hook).
**Must NOT touch:** `src/App.tsx` (T4 wires the mount), `src/components/KeywordCommandCenter.tsx`, `src/components/shared/RankTable.tsx` (P0 owns), `shared/types/feature-flags.ts` (P0 owns).

**Contract: `useKeywordHubState`**

```typescript
// src/hooks/admin/useKeywordHubState.ts
export type HubSegment = 'all' | 'in_strategy' | 'tracked' | 'needs_review' | 'retired' | 'local';
export type HubSortKey = 'keyword' | 'position' | 'change' | 'clicks' | 'volume' | 'difficulty' | 'date';
export interface HubSortState { key: HubSortKey; direction: 'asc' | 'desc'; }

export interface UseKeywordHubStateReturn {
  segment: HubSegment; setSegment: (s: HubSegment) => void;
  advancedFilter: KeywordCommandCenterFilter | null; setAdvancedFilter: (f: KeywordCommandCenterFilter | null) => void;
  activeKccFilter: KeywordCommandCenterFilter; // segment→filter map OR advancedFilter override
  searchTerm: string; setSearchTerm: (s: string) => void; debouncedSearch: string; // 300ms
  sort: HubSortState; setSort: (key: HubSortKey) => void; // toggles direction if key unchanged
  page: number; setPage: (p: number) => void;
  selectedKeys: Set<string>; toggleKey: (k: string) => void; toggleAll: (keys: string[]) => void; clearSelection: () => void;
  someSelected: boolean; allSelected: (visibleKeys: string[]) => boolean;
}
// Hook accepts initialSegment?: HubSegment (derived by the caller from useSearchParams).
```

**Contract: `KeywordHub` shell (stub)**

```typescript
// src/components/KeywordHub.tsx
export interface KeywordHubProps { workspaceId: string; }
export function KeywordHub({ workspaceId }: KeywordHubProps): JSX.Element // T1: minimal <SectionCard> "Keyword Hub" placeholder
```

**Constraints:**
- `HubSegment` maps to `KeywordCommandCenterFilter` via a local const (`all→ALL`, `local→LOCAL`, …). Non-null `advancedFilter` overrides the segment mapping to produce `activeKccFilter`.
- `debouncedSearch` uses the existing `useDebouncedValue(searchTerm, 300)` (`src/hooks/useDebouncedValue.ts`) — do NOT reimplement debounce.
- Reset rules: segment-change → page=1 + clear selection + clear advancedFilter; debouncedSearch-change → page=1 + clear selection; page-change → clear selection only.
- `setSort`: same key toggles direction; new key sets `'asc'`.
- This is the shared interaction hook the "extract shared interaction patterns" rule requires — prevents segment/search/sort/selection state being re-implemented across T2/T3.
- **`?tab=` two-halves:** the primary segment initializes from `useSearchParams().get('tab')` when valid; this happens INSIDE the hook via `initialSegment` derived by the caller.

**Test assertions** (`tests/component/useKeywordHubState.test.ts`, `renderHook`; debounce test uses `vi.useFakeTimers()` + `act(() => vi.advanceTimersByTime(300))`):
init defaults (segment=all, no search, sort=keyword/asc, page=1, empty selection); setSegment resets page+clears selection+clears advancedFilter; setSearchTerm → debouncedSearch after 300ms; debouncedSearch-change resets page+selection; setPage clears selection but preserves segment+search; setSort same-key toggles asc→desc→asc, new-key sets asc; toggleKey add/remove; toggleAll selects all; clearSelection empties; someSelected false-when-empty/true-when-any; allSelected true only when every visible key selected; initialSegment overrides default; invalid initialSegment → all; advancedFilter overrides activeKccFilter and clearing reverts to segment mapping; full HubSegment→filter mapping table.

### Task P1-T2 — Hub segments + advanced filters control (Model: **Sonnet**) — parallel after T1

**Owns:** `src/components/keyword-hub/HubSegmentBar.tsx` (new); `src/components/keyword-hub/HubAdvancedFilters.tsx` (new).
**Must NOT touch:** `src/components/KeywordHub.tsx` (T4 assembles), `useKeywordHubState.ts` (T1), `shared/types/keyword-command-center.ts`.

**Contract: `HubSegmentBar`**

```typescript
export interface HubSegmentMeta { id: HubSegment; label: string; count: number | undefined; icon?: LucideIcon; }
interface HubSegmentBarProps { segments: HubSegmentMeta[]; active: HubSegment; onChange: (s: HubSegment) => void; isLoading?: boolean; }
export function HubSegmentBar(props: HubSegmentBarProps): JSX.Element
```

Six primary segments in order: `All · In Strategy · Tracked · Needs Review · Retired · Local`. Counts from `useKeywordCommandCenterSummary` (`counts.total/inStrategy/tracked/needsReview/retired/local`, all in `KeywordCommandCenterCounts`, `shared/types/keyword-command-center.ts:214`). Use `<Badge>` for counts, teal active pill; the Local segment gets a `MapPin` icon (teal) when active; `isLoading` → `<Skeleton>` count placeholders. No `violet`/`indigo`.

**Contract: `HubAdvancedFilters`**

```typescript
interface HubAdvancedFiltersProps {
  activeAdvancedFilter: KeywordCommandCenterFilter | null;
  filterMetas: KeywordCommandCenterFilterMeta[]; // summary.filters, filtered to non-primary
  onChange: (f: KeywordCommandCenterFilter | null) => void;
}
export function HubAdvancedFilters(props: HubAdvancedFiltersProps): JSX.Element
```

A "Filters" button opening a dropdown of the remaining `KEYWORD_COMMAND_CENTER_FILTERS` not surfaced as primary (`content`, `page_assigned`, `raw_evidence`, `local_candidates`, `visible_locally`, `possible_match`, `not_visible`, `not_checked`, `provider_degraded`, `requested`, `declined`, `lost_visibility`). Selecting emits `onChange(filterId)` and closes; a clear button appears when active. Use only `src/components/ui` primitives; if no dropdown primitive exists, an ARIA-compliant `<details>`/`<summary>` with `role="listbox"` + `aria-expanded`.

**Test assertions:**
`HubSegmentBar.test.tsx` — renders all 6 labels; active segment teal/active styling; click calls onChange with the correct segment; Local shows MapPin when active; count Skeleton when isLoading; numeric badge when loaded; "—" when undefined.
`HubAdvancedFilters.test.tsx` — renders Filters button; opens list on click (aria-expanded changes); selecting calls onChange(filterId); clear button appears when active; clear calls onChange(null); does NOT include the 6 primary segment filters.

### Task P1-T3 — Hub list table + bulk bar (Model: **Sonnet**) — parallel after T1

**Owns:** `src/components/keyword-hub/HubKeywordList.tsx` (new); `src/components/keyword-hub/HubKeywordRowMeta.tsx` (new — the `renderKeywordMeta` slot).
**Must NOT touch:** `src/components/KeywordHub.tsx` (T4 assembles), `KeywordBulkActionBar.tsx` (read-only, reused as-is), `RankTable.tsx` (read-only).

**Contract: `HubKeywordList`** (interaction state passed as props from `useKeywordHubState`)

```typescript
interface HubKeywordListProps {
  workspaceId: string;
  rows: KeywordCommandCenterRow[]; pageInfo: KeywordCommandCenterPageInfo | undefined; isLoading: boolean; isError: boolean;
  sort: HubSortState; onSort: (key: HubSortKey) => void;
  selectedKeys: Set<string>; onToggleKey: (k: string) => void; onToggleAll: (visibleKeys: string[]) => void;
  someSelected: boolean; allSelected: boolean;
  page: number; onPageChange: (p: number) => void;
  isBulkPending: boolean; onBulkAction: (action: KeywordCommandCenterBulkActionType) => void; onClearSelection: () => void;
  showLocalSeo: boolean;
}
export function HubKeywordList(props: HubKeywordListProps): JSX.Element
// also exports: localSeoColumnLabel(row: KeywordCommandCenterRow): string | undefined  (pure helper)
```

Implementation notes (contract, not body): uses `<KeywordTable<KeywordCommandCenterRow>>` with `columns={['position','change','clicks','volume','difficulty']}`, `changeSign="lowerIsBetter"`, `showLocalSeo`, `sort={{ key, direction, onSort }}` (onSort translates `HubSortKey`→server `KeywordCommandCenterSort` (`:253`, `'priority'|'keyword'|'demand'|'rank'`) via a local const), `selection={{ selected, onToggle, rowId: r => r.normalizedKeyword }}`, `renderKeywordMeta={r => <HubKeywordRowMeta row={r} />}`, `emptyState` (action-oriented, Clear-filters button), `loading`, `stickyHeader`, `density="comfortable"`. Wrap in `<div className="overflow-y-auto">` with a `// TODO: virtualize when rows > 200 (react-virtual)` comment. Pagination = ghost prev/next + "Page N of M" + total. `<KeywordBulkActionBar>` rendered at bottom (reused unchanged) when `someSelected`. `<ErrorState>` when `isError`. `localSeoColumnLabel`: `visible_locally→"Visible"`, `possible_match→"Possible"`, `not_visible→"Not Visible"`, `provider_degraded→"Degraded"`; lifecycle label when only `localSeoState`; `undefined` when neither.

**Contract: `HubKeywordRowMeta`**

```typescript
interface HubKeywordRowMetaProps { row: KeywordCommandCenterRow; }
export function HubKeywordRowMeta({ row }: HubKeywordRowMetaProps): JSX.Element
```

Renders below the keyword text: `<StatusBadge domain="keyword-command-center">` for `row.lifecycleStatus`; a `<Badge color="blue">` "From gap" when `row.tracking.sourceGapKey` defined; a `<Badge color="teal">` "Auto-managed" when `row.tracking.strategyOwned === true`. **Four Laws:** lifecycle via `StatusBadge`, gap=blue (data), strategy-owned=teal (managed/action). No `violet`/`indigo`/`rose`/`pink`/`text-green-400`.

**Test assertions** (`HubKeywordList.test.tsx` mocks `KeywordTable`, `KeywordBulkActionBar`, passes props directly):
renders KeywordTable with the hub column set; passes sort config + onSort toggles same-key direction; selection checkboxes toggle selectedKeys; bulk bar shown when someSelected else hidden; isBulkPending → bulk bar disabled; pagination bar when pageInfo defined; prev disabled on page 1 / next disabled on last; ErrorState when isError; loading state when isLoading + rows=[]; action-oriented EmptyState when rows=[] not-loading not-error; passes showLocalSeo; `localSeoColumnLabel` mapping cases + undefined.
`HubKeywordRowMeta` — StatusBadge for lifecycleStatus; blue "From gap" when sourceGapKey defined / omitted when undefined; teal "Auto-managed" when strategyOwned true / omitted when falsy; **three-state guard:** strategyOwned `false` and `undefined` both omit "Auto-managed"; no violet/indigo/rose/pink class names in rendered HTML.

### Task P1-T4 — Shell assembly + flag-gated mount (Model: **Sonnet**) — sequential after T1+T2+T3

**Owns:** `src/components/KeywordHub.tsx` (full, replacing T1 stub); `src/App.tsx` (narrow flag-gated render switch for `seo-keywords`).
**Must NOT touch:** `src/components/KeywordCommandCenter.tsx`, `useKeywordHubState.ts` (T1; read-only here), `src/routes.ts` (P4), `src/components/layout/Sidebar.tsx` (P4).

**Contract:** the full `KeywordHub` shell: reads `useSearchParams()` `tab`, validates as `HubSegment`, passes `initialSegment`; calls `useKeywordCommandCenterSummary` (counts → `HubSegmentBar`), `useKeywordCommandCenterRows({ filter: activeKccFilter, search: debouncedSearch || undefined, sort: hubSortToKccSort(sort.key), page, pageSize: 50 })`, `useKeywordCommandCenterBulkAction`; wires `useWorkspaceEvents(workspaceId, [WS_EVENTS.RANK_TRACKING_UPDATED, WS_EVENTS.STRATEGY_UPDATED], () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(workspaceId) }))` (NOT `useGlobalAdminEvents`); renders `<PageHeader title="Keyword Hub" />`, `<HubSegmentBar>`, a `<FormInput>` search (Search icon, same pattern as KCC `:117`), `<HubAdvancedFilters>`, `<HubKeywordList>`. `showLocalSeo` is true only when `isFeatureEnabled('local-seo-visibility')`. The component is NOT itself wrapped in `<FeatureFlag>` — the gate lives in `App.tsx`.

`hubSortToKccSort` mapping (executor verifies `KeywordCommandCenterSort` at `:253` and updates to actual server capabilities): `keyword→keyword`; `position|change→rank`; `volume|difficulty→demand`; `date|clicks→priority` (fallback).

**App.tsx edit (trivial — exact change):** at `src/App.tsx:436`, replace
`if (tab === 'seo-keywords') return <KeywordCommandCenter key={\`keywords-${selected.id}\`} workspaceId={selected.id} />;`
with
```tsx
if (tab === 'seo-keywords') return isFeatureEnabled('keyword-hub')
  ? <KeywordHub key={`hub-${selected.id}`} workspaceId={selected.id} />
  : <KeywordCommandCenter key={`keywords-${selected.id}`} workspaceId={selected.id} />;
```
(`isFeatureEnabled` is the existing flag check used elsewhere in `App.tsx`; confirm the exact import/call pattern at read time.)

**`?tab=` two-halves compliance:** `KeywordHub` reads `useSearchParams` and passes `initialSegment`. `tests/contract/tab-deep-link-wiring.test.ts` picks up the `seo-keywords` → `KeywordHub` mapping (it scans `App.tsx`) and verifies `useSearchParams` is called inside `KeywordHub` — confirm the static grep catches the pattern.

**Test assertions** (`tests/component/KeywordHub.test.tsx`, `MemoryRouter` + `initialEntries`):
initializes segment from `?tab=tracked`; invalid `?tab=` → all; no `?tab=` → all; PageHeader "Keyword Hub"; HubSegmentBar with counts; search input updates searchTerm; renders HubAdvancedFilters; loading state when rows pending; rows when loaded; showLocalSeo true/false per `local-seo-visibility` flag; changing segment resets to page 1; changing search resets to page 1 after debounce; `useWorkspaceEvents` registered for RANK_TRACKING_UPDATED + STRATEGY_UPDATED; bulk action mutation called when emitted from list.

### Task P1-T5 — Integration test (Model: **Sonnet**) — sequential after T4

**Owns:** `tests/integration/keyword-hub-list.test.ts` (new, **port 13900** — verify free via `grep -r 'createTestContext(' tests/`).
**Must NOT touch:** all other files.

Exercises the REAL read path: the KCC rows endpoint (`GET /api/webflow/keyword-command-center/:workspaceId/rows`) with filter/search/sort/pagination, verifying the response matches `KeywordCommandCenterRowsResponse`.

**Test assertions** (`beforeAll`: seedWorkspace, `createTestContext(13900)`; `afterAll`: cleanup):
filter=all returns rows + pageInfo; filter=in_strategy returns only in_strategy rows (**assert `rows.length > 0` BEFORE `.every()`**); filter=tracked → tracked-status rows; filter=local → only rows with `localSeo`/`localSeoState`; filter=retired → retired rows; search=`<term>` → keyword contains term (case-insensitive); page=2/pageSize=5 → page-2 slice + `hasPreviousPage=true`; sort=rank → rows in position-ascending order; GET summary → `KeywordCommandCenterCounts` shape; all rows include `normalizedKeyword` (selection rowId); all rows include `tracking.status`; rows with `tracking.sourceGapKey` are type-valid strings.

### P1 within-phase dependency graph

```
Sequential gate:
  P1-T1 (useKeywordHubState + KeywordHub shell stub)   ← pre-commit this hook + stub before the parallel batch

Parallel batch after T1 (exclusive file ownership):
  P1-T2 (HubSegmentBar + HubAdvancedFilters)   ∥   P1-T3 (HubKeywordList + HubKeywordRowMeta)

Diff-review checkpoint (between parallel batch and T4):
  git diff (verify T2/T3 no overlap) · grep -r 'violet\|indigo\|rose-\|pink-\|text-green-400' src/components/keyword-hub/ (empty)
  · npm run typecheck · npx vitest run T2+T3 component tests

Sequential after T2+T3:
  P1-T4 (KeywordHub full shell + App.tsx flag gate)
Sequential after T4:
  P1-T5 (integration test, port 13900)
```

### P1 exports (downstream)

- **`KeywordHub` component** — P2 adds `selectedKeyword`/`onSelectKeyword` state + renders the drawer; P3 wires real per-row + bulk actions; P4 adds cross-surface deep-link initialization.
- **`useKeywordHubState`** — the single interaction-state owner; P2 adds `selectedKeyword`/`setSelectedKeyword`; P3 reads `selectedKeys` for per-row confirms.
- **`HubKeywordList.onBulkAction`** + the wired `KeywordBulkActionBar` — P3 replaces the pass-through with the real bulk mutation.
- **Receiver reads `?tab=` from `useSearchParams`** — P4 constructs `adminPath(workspaceId, 'seo-keywords') + ?tab=<HubSegment>` senders against this receiver.

---

## Phase P2 — The Keyword Journey Drawer

> Evolves `KeywordDetailDrawer` (`src/components/keyword-command-center/KeywordDetailDrawer.tsx`) into the full keyword journey: five new/deepened sections (Origin, Tracking Decision, National Rank, Local Visibility per-market, Lifecycle/why-retired) + empty states. Dark behind `keyword-hub`; reads exclusively the data P0 exposed (`strategyOwned`); **no server changes**. **Owner:** KCC (admin-only). The drawer is the primary P2 export. **Grounded:** zero render sites today for `sourceGapKey`/`strategyOwned`/`replacedBy`/`deprecatedAt`; `PositionSparkline` is file-private in `RankTracker.tsx:23-60`; `LocalSeoKeywordVisibilitySummary.markets: LocalSeoKeywordVisibility[]` at `shared/types/local-seo.ts:289-297`.

**Pre-requisite gate:** if the real `KeywordCommandCenterTrackingState` does NOT yet have `strategyOwned` (P0 not merged), STOP and report `NEEDS_CONTEXT` — do not add it from P2.

### Task P2-T0 — Extract `PositionSparkline` to a shared helper (Model: **Haiku**) — sequential gate for T3

**Owns:** `src/components/keyword-command-center/KeywordSparkline.tsx` (new).
**Must NOT touch:** `src/components/RankTracker.tsx` (extract only; original stays until P5 cleanup); any other file.

**Contract:**
```typescript
// src/components/keyword-command-center/KeywordSparkline.tsx
export interface KeywordSparklineProps { data: Array<{ date: string; position: number }>; width?: number; height?: number; }
export function KeywordSparkline({ data, width = 200, height = 40 }: KeywordSparklineProps): ReactElement | null;
// Returns null when < 2 points. Y-axis inverted (lower position = higher on chart).
// Colors: line + endpoint dot = blue-400; improvement delta text = emerald-400; regression = red-400.
// Summary below: Best #N · Worst #N, snapshot count, date range, delta.
```

**Constraints:** copy the SVG math from `RankTracker.tsx:23-60` faithfully — do NOT alter visual output. Four Laws (blue data line, emerald/red delta). No new deps, no raw fetch. Mechanical.

**Test assertions** (in `tests/component/keyword-hub/KeywordJourneyDrawer.test.tsx`, section "KeywordSparkline"): `data=[]` → null; single point → null; two points → renders `<svg>`; improved (latest < first) → delta text has `text-emerald-400`; regressed → `text-red-400`.

### Tasks P2-T1…T5 — the five drawer sections (all write `KeywordDetailDrawer.tsx`)

All five sections own additive blocks in `src/components/keyword-command-center/KeywordDetailDrawer.tsx` and additive assertions in `tests/component/keyword-hub/KeywordJourneyDrawer.test.tsx`. Because they share one file, they are **either run sequentially T1→T2→T3→T4→T5, or dispatched as section-drafting agents whose JSX + assertions a single integrator agent (full file ownership) composes** after reading the real current file. Each section renders only when `open && row`.

**P2-T1 — Origin (`sourceGapKey` provenance) (Model: Sonnet).** Owns the Origin block + `formatSourceGapKey(sourceGapKey: string | undefined): string | null` in `kccDisplayHelpers.ts`. First section, above the metrics grid, in `<SectionCard>`/`<KeywordDetailPanel>`. Display logic: `sourceGapKey` defined → "From content gap" + formatted key + a `<Button variant="ghost" size="sm">` "View in Strategy" with `data-testid="view-in-strategy-link"` (href is `#`, `// TODO P4: wire real href`, must NOT navigate in P2); `source==='client_requested'` → "Client requested"; `source==='manual'` → "Manually added"; `strategy_primary|strategy_site_keyword` → "Added via strategy"; otherwise the section is **omitted entirely**. **Assertions:** gap → "From content gap" + the test-id button; `client_requested` → "Client requested" + no button; `manual` → "Manually added"; `unknown` → section absent.

**P2-T2 — Tracking Decision (`strategyOwned` + `pinned` + `addedAt`) (Model: Sonnet).** Enriches (not replaces) the existing "Tracking State" panel: keep `trackingLabel`/`trackingSourceLabel`; `addedAt` defined → "Tracked since [formatDateShort]"; `strategyOwned === true` → teal inline note "Auto-managed — strategy refreshes maintain this keyword's lifecycle"; `pinned === true` → blue "Pinned" badge; keep the existing "Rank Tracker" button (P4 repoints it). **Constraint:** three-state — only `=== true` triggers "Auto-managed"; `false` and `undefined` both omit it (never treat falsy as empty). **Assertions:** strategyOwned true→"Auto-managed", false→absent, undefined→absent; `addedAt='2025-11-15…'` → "Tracked since Nov 15, 2025"; pinned true → "Pinned"; no addedAt → "Tracked since" absent.

**P2-T3 — National Rank + 90-day sparkline (Model: Sonnet; depends on T2-T0).** Adds a "National rank" section using `KeywordSparkline`. Renders current position `#N.N` via `positionColor()` (`src/components/ui/constants.ts`), "—" when absent; change only if `row.metrics` actually carries it (executor verifies `KeywordCommandCenterMetrics` — `currentPosition/clicks/impressions/ctr/volume/difficulty` confirmed, `change` may be absent → omit, do not invent); clicks/impressions via `compactNumber` (blue). Sparkline fetch contract (lazy, only when `open && row && row.tracking.status !== 'not_tracked'`):
```typescript
useQuery({
  queryKey: queryKeys.admin.rankTrackingHistoryQueries(workspaceId, [row.keyword]),
  queryFn: () => get<HistoryPoint[]>(`/api/rank-tracking/${workspaceId}/history?queries=${encodeURIComponent(row.keyword)}`),
  enabled: open && !!row && row.tracking.status !== 'not_tracked', staleTime: 60_000,
}); // HistoryPoint = { date: string; positions: Record<string, number> }
```
Import `get` from `src/api/client` (no raw fetch); `queryKeys.admin.rankTrackingHistoryQueries` already at `src/lib/queryKeys.ts:95`. Loading → `<Skeleton className="h-10 w-full" />`; < 2 points → inline `<EmptyState>` "Not enough snapshots for trend yet." (no CTA); `not_tracked` → no fetch, no section. **Assertions:** position `6.3` → "#6.3" + `positionColor(6.3)` class; undefined → "—"; `not_tracked` → section absent + no query triggered; ≥ 2 points → `<KeywordSparkline>` with correct `data`; < 2 usable → "Not enough snapshots"; clicks/impressions blue-toned.

**P2-T4 — Local Visibility per-market (Model: Sonnet).** Replaces the single-summary local panel with a per-market breakdown when `row.localSeo?.markets` has ≥ 1 item. Per market (`LocalSeoKeywordVisibility[]`, `shared/types/local-seo.ts:270-287`): `marketLabel` (bold); `posture` via `<LocalSeoVisibilityBadge visibility={market} />` or `<StatusBadge domain="keyword-command-center">`; `localRank` → "Pack rank #N" / "Not ranked"; `businessMatchConfidence` → amber for `possible_match`, emerald for `verified`, zinc otherwise; `label` beneath rank. Show up to 6 inline + a "+N more" inline toggle (`useState`, no modal); markets already sorted by `marketLabel`. Graceful empty: omit the whole section when `row.localSeo` undefined/empty AND `row.localSeoState` undefined; show the existing single-summary unchanged when only `localSeoState` exists. Colors: emerald `VISIBLE`, amber `POSSIBLE_MATCH`, zinc others; never purple. Keep the existing "Local SEO is market-specific…" note; label the section "Local visibility" (plain language). **Assertions:** two markets render two rows (Austin "Pack rank #2", Round Rock "Not ranked"); `localSeo` undefined → section absent; > 6 → exactly 6 rows + "+N more"; Austin `visible` emerald badge / Round Rock `not_visible` zinc; clicking "+N more" expands all.

**P2-T5 — Lifecycle / Why Retired (Model: Sonnet).** New section, rendered only when `row.lifecycleStatus === 'retired'` OR `row.tracking.deprecatedAt` defined; omitted for active/tracked (the header `StatusBadge` already shows status). `KeywordDetailPanel tone="amber"`: "Retired on [formatDateShort(deprecatedAt)]" when defined; `replacedBy` defined → "Replaced by: [replacedBy]" + a "View in Hub →" affordance `data-testid="view-replaced-by-link"` (not wired in P2, `// TODO P4`); undefined → "No replacement recorded"; do not duplicate `feedback.reason`. **Constraints:** amber tone (Four Laws warning); never surface the raw `'deprecated'` enum — display "Retired"; `replacedBy` is a keyword string, render as text + the (unwired) deep-link. **Assertions:** retired + `deprecatedAt='2026-03-01…'` + `replacedBy='dental implants austin tx'` → "Retired on Mar 1, 2026" + "Replaced by: …" + the test-id button; retired + deprecatedAt + no replacedBy → "No replacement recorded"; `tracked` + no deprecatedAt → section absent; `in_strategy` → absent; amber border/background classes present.

### P2 within-phase dependency graph

```
Sequential gate:  P2-T0 (KeywordSparkline)  → pre-commit before T3 (T3 imports it)
                       → P2-T3 (National Rank imports KeywordSparkline)

Parallel (section drafting, after T0):  T1 (Origin) ∥ T2 (Tracking) ∥ T4 (Local) ∥ T5 (Lifecycle)
  …but all five sections + T3 write the SAME KeywordDetailDrawer.tsx, so the file-write is serialized:
    Option (a) run T1→T2→T3→T4→T5 sequentially (simplest), OR
    Option (b) section-drafting agents produce JSX + assertions → one integrator agent (full file ownership)
               reads the real current file and composes all five sections + T3's fetch hook.

Diff-review checkpoint after the batch: git diff · npm run typecheck · npx vitest run tests/component/keyword-hub/
```

### P2 exports (downstream)

- `KeywordDetailDrawer` renders the action footer (unchanged) — P3 extends `onAction` + the action set.
- `data-testid="view-in-strategy-link"` (Origin) and `data-testid="view-replaced-by-link"` (Lifecycle) — affordances exist but unwired; P4 wires the real `href`s.
- The Tracking Decision "Rank Tracker →" button — P4 repoints from `adminPath(workspaceId, 'seo-ranks')` to the Hub.
- `KeywordSparkline` is the shared sparkline primitive; `RankTracker.tsx` adopts it at P5 cleanup.

---

## Phase P3 — The Action Model (behavior-sensitive)

> New behavior (keyword state machine, Delete-hard reconciliation) layered on a **behavior-preserving** reuse of the existing KCC action engine (no reimplementation of the action switch). **Owner:** SEO/Keyword (`server/keyword-command-center.ts`, `server/rank-tracking.ts`, `server/state-machines.ts`) + the Hub UI from P0–P2. **Inherits from P0–P2:** the flag, `strategyOwned`, the Hub list on `KeywordTable` (`renderActions`/`renderExpanded`/multi-select), and the journey drawer. **Engine P3 reuses (verified, read before writing):** `applyKeywordCommandCenterActionInternal` `:2438` (switch `:2456–2533`); `retireTrackedKeyword(…, PAUSED|DEPRECATED)` `:2400`; `protectedReason` `:281` + `canModifyProtected` `:2293`; `broadcastKeywordCommandCenterAction` `:2418`; hard delete `removeTrackedKeyword(workspaceId, query)` `server/rank-tracking.ts:310` (does NOT broadcast/log — the existing DELETE route `server/routes/rank-tracking.ts:67-77` wraps it); state-machine pattern in `server/state-machines.ts` (`validateTransition` `:259`); `TRACKED_KEYWORD_STATUS = { ACTIVE, PAUSED, DEPRECATED, REPLACED }` (`shared/types/rank-tracking.ts:13`); `buildNextActions` `:544-660` (per-row `nextActions[]` with tones); `ConfirmDialog` (`variant?: 'default'|'destructive'`, no typed-confirmation today).

### Task 3a — Keyword lifecycle state machine in `server/state-machines.ts` (Model: **Opus**)

> Opus: broad blast radius (new entity guarded across the switch + two enumerating contract tests) + lifecycle-correctness judgment.

**Contract (the SHAPE — add to `server/state-machines.ts`, mirroring the existing `*_TRANSITIONS` blocks):**
```ts
export const TRACKED_KEYWORD_TRANSITIONS: Record<string, readonly string[]> = {
  active:     [ /* paused, deprecated, replaced */ ],
  paused:     [ /* active, deprecated, replaced */ ],
  deprecated: [ /* active (= restore) */ ],
  replaced:   [ /* terminal: [] — confirm against real replace semantics */ ],
};
export type TrackedKeywordTransitionStatus = 'active' | 'paused' | 'deprecated' | 'replaced';
```
The exact edge set is the executor's deliverable **derived from the real action switch** (`:2456–2533`) — the minimal map that ADMITS every transition the switch performs and REJECTS the illegal ones. Grounded constraints (verify each, do not transcribe): `active→paused` (PAUSE_TRACKING `:2481`); `active→deprecated` (RETIRE `:2487`, DECLINE-of-tracked `:2494`); `paused→active` and `deprecated→active` (RESTORE `:2496-2503` revives to ACTIVE, `updateTrackedKeywords` clears `deprecatedAt`/`replacedBy` on revive — `server/rank-tracking.ts:250-251`); `deprecated`/`replaced` NOT freely interconvertible; `replaced` terminal unless the reconcile code shows a revive edge. A `not_tracked` row is **not** a machine state — `TRACK`/`PROMOTE_EVIDENCE`/`ADD_TO_STRATEGY` create a row at `ACTIVE` (an **insert, not a transition** — do not route inserts through `validateTransition`).

**Test assertions** (`tests/unit/keyword-state-machine.test.ts`, mirror `tests/unit/state-machines.test.ts`): every legal edge returns its `to`; each illegal edge throws `InvalidTransitionError` (at minimum `deprecated→paused`, `replaced→active` if terminal, any self-transition); unknown `from` (`'not_tracked'`) throws; thrown error carries `entity==='tracked_keyword'`, correct `from`/`to`.

**Graph-contract wiring (REQUIRED):** add `{ name: 'tracked_keyword', map: TRACKED_KEYWORD_TRANSITIONS }` to `TRANSITION_GRAPHS` in `tests/unit/state-machine-graph-contract.test.ts` (asserts ≥1 terminal, no dup targets, no self-edge, known states, `validateTransition` matches the map — so the map MUST have ≥1 terminal; `replaced: []` satisfies it). Add `{ entity: 'keyword', file: 'server/keyword-command-center.ts', transitionToken: 'TRACKED_KEYWORD_TRANSITIONS' }` to `GUARD_SIGNALS` in `tests/contract/state-machine-guard-coverage-contract.test.ts` (asserts the file literally contains `validateTransition(` AND the token — Task 3b's wiring turns this green; sequential 3a→3b).

**Constraints/gotchas:** the catalog comment must explain WHY (close the "keywords are the only status entity not state-machine-guarded" gap), matching neighboring machines' style. Do NOT alter `TRACKED_KEYWORD_STATUS`. Grep `state-machines.test.ts` import lists in case they enumerate all maps.

**Owns:** `server/state-machines.ts` (additive block); `tests/unit/keyword-state-machine.test.ts` (new); append one entry each to `tests/unit/state-machine-graph-contract.test.ts` + `tests/contract/state-machine-guard-coverage-contract.test.ts` (shared test files — coordinate).
**Must NOT touch:** the action switch (3b), `shared/types/rank-tracking.ts`.

### Task 3b — Route the action handlers through `validateTransition` (Model: **Opus**)

> Opus: behavior-sensitive edit inside the live engine every keyword mutation flows through.

**Contract:** inside `applyKeywordCommandCenterActionInternal` (`:2438`), for the cases that **change the status of an existing tracked row** (`PAUSE_TRACKING`, `RETIRE`, tracked-branch of `DECLINE` `:2494`, `RESTORE` when `existing` is paused/deprecated), call `validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? 'active', <target>)` BEFORE the `retireTrackedKeyword`/`upsertTrackedKeywordByKey` write. Import both from `./state-machines.js`. The call stays INSIDE the existing `db.transaction(run)` (`:2455`) so an illegal transition rolls back with no partial write/broadcast. **Order: protection guard → transition guard → write** (orthogonal: protected = "needs confirmation"; illegal = "never allowed"). Insert-style cases (`ADD_TO_STRATEGY`/`TRACK`/`PROMOTE_EVIDENCE` when `existing` undefined, or idempotent re-asserts when active) are NOT guarded. `InvalidTransitionError` must propagate to the route — map it in `server/routes/keyword-command-center.ts:127` (the `actions` catch) to **409 Conflict** (confirm no existing 4xx covers the message).

**Test assertions** (extend `tests/unit/keyword-command-center.test.ts` or new `keyword-command-center-lifecycle.test.ts`; `setBroadcast(vi.fn(), wsBroadcast)` per `keyword-command-center-bulk.test.ts`): each action from its valid state (active→PAUSE→paused; active→RETIRE→deprecated w/ `deprecatedAt`; deprecated→RESTORE→active w/ `deprecatedAt`/`replacedBy` cleared); each rejected from an invalid state (deprecated→PAUSE throws `InvalidTransitionError`, DB row **unchanged**, **no broadcast** fired); protection still independent (protected active + RETIRE no force → protection error not transition error; force:true passes protection then transition); **route-level** (`tests/integration/keyword-hub-actions.test.ts`, new, **port 13900**): illegal action → **409** with the transition message; legal → 200 + `trackedKeywords`.

**Constraints/gotchas:** `existing` read via `findTracked` (`:2299`, `includeInactive:true`) BEFORE the transaction is the authoritative `from` — do not re-read post-write. Keep `retireTrackedKeyword` behavior intact; only gate the CALL. Bulk path reuses `…Internal` per item, so the guard auto-applies — an illegal item lands as `status:'error'` (NOT `skipped_protected`); confirm the bulk catch (`:2588-2599`) routes `InvalidTransitionError.message` to the error bucket and assert it.

**Owns:** `server/keyword-command-center.ts` (action switch only), `server/routes/keyword-command-center.ts` (error mapping), the lifecycle test files.
**Must NOT touch:** `server/state-machines.ts` (3a), `server/rank-tracking.ts` (3c).

### Task 3c — Retire-soft / Delete-hard reconciliation: a separated, confirmed hard Delete (Model: **Opus**)

> Opus: the data-safety crux (hard, irreversible delete) spanning server + a guarded UI.

**Server contract** (verify each fact in code first):
```ts
// server/keyword-command-center.ts (new exported function)
export function deleteKeywordHard(
  workspaceId: string, keyword: string, options?: { force?: boolean },
): { ok: true; keyword: string; trackedKeywords: TrackedKeyword[] };
```
- Resolve `existing` via `findTracked`. **Delete-eligibility predicate** (its own narrower helper `isHardDeleteEligible(existing): boolean`, NOT a blind `protectedReason` reuse — `protectedReason` `:285` flags MANUAL as protected, but MANUAL is the design's delete-eligible class): hard-delete is disallowed without `force` for **pinned / `CLIENT_REQUESTED` / `sourceGapKey`** (strategy/client provenance — must be retired, not deleted) but **ALLOWED for `MANUAL`** (genuine mistakes). Lock the predicate in the helper and TEST it.
- Call `removeTrackedKeyword(workspaceId, keyword)` (`server/rank-tracking.ts:310`) inside a transaction.
- **Broadcast both-halves + activity** (the bare function omits these): `broadcastToWorkspace(ws, RANK_TRACKING_UPDATED, {keyword, action:'deleted', source:'keyword_hub'})` + `addActivity(ws,'rank_tracking_updated','Keyword permanently deleted', …, {keyword, action:'deleted'})`. Keep to `RANK_TRACKING_UPDATED` (delete does not touch strategy/intelligence) to match the existing DELETE route `:73`.
- Delete is **NOT** added to `KEYWORD_COMMAND_CENTER_ACTIONS` / the bulk set / `actionSchema` (`server/routes/keyword-command-center.ts:29`) — it stays OUT of the lifecycle enum (never default/bulk). It gets its **own** route + hook.

**Route contract:** a dedicated `DELETE /api/webflow/keyword-command-center/:workspaceId/keywords/:keyword` (or reuse `DELETE /api/rank-tracking/:workspaceId/keywords/:query` `:67` — executor chooses; **if reusing, that route must also enforce `isHardDeleteEligible`, which it currently does NOT**). Returns the updated tracked list. Protected/ineligible without `force` → **403**.

**UI contract** — the Delete affordance, clearly distinguished, never default:
```tsx
// src/components/keyword-command-center/KeywordActionMenu.tsx (new, P3-owned)
interface KeywordActionMenuProps {
  row: KeywordCommandCenterRow;                                  // lifecycle-aware: drives which items render
  onAction: (action: KeywordCommandCenterActionType, opts?: { force?: boolean }) => void;
  onDeleteHard: (keyword: string) => void;                       // separate channel — NOT an action enum value
  isPending?: boolean;
}
```
- Renders **lifecycle-aware** items from `row.nextActions` (already computed `buildNextActions :544`): Restore-only for retired/declined; Add-to-strategy for needs-review; Track for not-tracked; Pause/Retire/Decline for tracked.
- **Tone reconciliation (deliberate):** `buildNextActions` currently tags Decline `tone:'red'` and Retire `tone:'red'` (`:641`, `:651`); P3 changes **retire/decline → amber**, freeing **red exclusively for the irreversible Delete**. Update `buildNextActions` tones + `BRAND_DESIGN_LANGUAGE.md`. Track/move/restore = teal.
- **Delete permanently** is visually separated (divider + red `Trash2`), gated by `ConfirmDialog variant="destructive"`, and **only rendered when the client `isHardDeleteEligible`-equivalent predicate is true** (computed from `row.tracking.source`/`pinned`/`sourceGapKey`). Ineligible rows hide Delete (retire is the only remove).
- `ConfirmDialog` typed-confirmation: default to **(a)** `variant="destructive"` + explicit copy ("This permanently deletes `<kw>` and its rank history. This cannot be undone."); only widen the primitive with `requireTyped?: string` if review asks (then add a primitive unit test).

**Test assertions:** **Server** (`tests/unit/keyword-hub-delete.test.ts`): MANUAL active → `deleteKeywordHard` (no force) → GONE from `getTrackedKeywords({includeInactive:true})` + `wsBroadcast` fired `RANK_TRACKING_UPDATED` action `'deleted'` + activity row recorded; CLIENT_REQUESTED/`sourceGapKey` → throws without force, row still present, `force:true` deletes; pinned → throws without force. **Retire-is-soft contrast (reconciliation proof):** RETIRE a keyword → still present `status==='deprecated'` (restorable); RESTORE → active; then `deleteKeywordHard` → ABSENT (two distinct removes, only one reversible). **Route** (`tests/integration/keyword-hub-actions.test.ts`, port 13900): DELETE MANUAL → 200 + list no longer contains it; DELETE client/gap without force → 403. **UI** (`tests/component/keyword-command-center/KeywordActionMenu.test.tsx`): retired row → only Restore; tracked MANUAL → Pause/Retire/Decline **and** separated Delete; tracked CLIENT_REQUESTED → Retire but **no Delete**; clicking Delete opens the destructive ConfirmDialog and fires `onDeleteHard` only after confirm.

**Constraints/gotchas:** hard delete drops rank history too — the confirm copy must say so. Don't change the two existing `removeTrackedKeyword` callers (rank route `:67`, public-content `:651`); `deleteKeywordHard` is a THIRD Hub-specific wrapper (activity type `rank_tracking_updated`). Four Laws: Delete is the ONLY red affordance after the retire/decline→amber reconciliation; grep the new files clean.

**Owns:** `server/keyword-command-center.ts` (`deleteKeywordHard` + `buildNextActions` tone changes — **shared file with 3b, so 3c runs AFTER 3b**); the delete route + `useKeywordHardDelete` hook in `src/hooks/admin/useKeywordCommandCenter.ts`; `src/components/keyword-command-center/KeywordActionMenu.tsx`; the delete tests.
**Must NOT touch:** `server/rank-tracking.ts` internals (only CALL `removeTrackedKeyword`), `server/state-machines.ts`.

### Task 3d — Bulk-bar lifecycle wiring + per-item results in the Hub (Model: **Sonnet**)

> Sonnet: pattern-following — the bulk engine + bar already exist. Depends on 3a/3b (the guard must exist so illegal bulk items report `error`).

**Contract:** reuse `KeywordBulkActionBar` (bulk set already = `ADD_TO_STRATEGY, TRACK, PAUSE_TRACKING, RETIRE, DECLINE`) and `summarizeBulkAction` (`kccActionHelpers.ts`). Mount on the Hub list's multi-select selection (P1's `KeywordTable` selection). On apply, call `useKeywordCommandCenterBulkAction`; render `KeywordCommandCenterBulkActionResult.items[]` (`applied|skipped_protected|skipped_not_tracked|error`) as a per-item toast/summary. **No server change**; Delete is NOT in the bulk bar.

**Test assertions:** component (`tests/component/keyword-command-center/HubBulkBar.test.tsx`): selecting N rows shows "N selected"; clicking Retire on a selection with a protected row triggers the existing `KeywordBulkConfirmDialog` (via `summarizeBulkAction(...).requiresConfirmation === true`); the result summary renders applied/skipped/failed counts. Reuse `tests/unit/keyword-command-center-bulk.test.ts` and **add** one case: a bulk action with one illegal-state item lands `status:'error'` (depends on 3b's guard).

**Owns:** the Hub list host's bulk wiring (coordinate with P1's host — read-only beyond the documented selection/bulk mount point; if structural edits to P1's file are required, STOP/`NEEDS_CONTEXT`); `tests/component/keyword-command-center/HubBulkBar.test.tsx`.
**Must NOT touch:** `KeywordBulkActionBar.tsx`/`kccActionHelpers.ts` internals (reuse as-is), the server bulk handler.

### P3 within-phase dependency graph

```
Net order: 3a → 3b → 3c → 3d.

Sequential on server/state-machines.ts + the action engine:
  3a (state machine + map + graph/coverage test entries)   ← pre-commit the exported map before 3b
    → 3b (route the switch through validateTransition; 409 mapping)
       → 3c (deleteKeywordHard + tone reconciliation + Delete UI — shares server/keyword-command-center.ts with 3b, so AFTER 3b)
         → 3d (bulk-bar wiring — needs 3b's guard so illegal items report 'error')

Safely-parallel pair: 3a (server map) ∥ the KeywordActionMenu *scaffold* of 3c (new component file);
  the Delete predicate + tone change land in 3c proper, gated on both 3a and 3b.

Diff-review checkpoint after each step: git diff · npx tsc --noEmit --skipLibCheck · npx vitest run (full).
```

### P3 exports (downstream)

- `TRACKED_KEYWORD_TRANSITIONS` + `TrackedKeywordTransitionStatus` (`server/state-machines.ts`) — any future keyword status write MUST go through `validateTransition('tracked_keyword', …)`.
- **Unchanged on purpose:** `KEYWORD_COMMAND_CENTER_ACTIONS` (no `delete` member) — hard-delete stays a separate channel, never a lifecycle action.
- `deleteKeywordHard(workspaceId, keyword, { force? })` + `isHardDeleteEligible(existing)` (MANUAL, non-pinned, no gap/client provenance).
- `KeywordActionMenu` (props `{ row, onAction, onDeleteHard, isPending }`) — mounts via `KeywordTable.renderActions` + the P2 drawer; `useKeywordHardDelete(workspaceId)` hook; the bulk per-item `items[]` rendering contract.
- **Cross-phase guard:** the two enumerating tests now include `tracked_keyword`/`keyword` — P4/P5 must NOT remove the `validateTransition` call from `server/keyword-command-center.ts` (the coverage contract fails) when retiring/redirecting surfaces.

---

## Phase P4 — Deep-Links + Nav Consolidation + Rank-Tracker Fold-In

> Cross-cutting. Depends on the Hub list/drawer (P1–P3) behind the flag. Wires keyword identity into URLs (both directions), makes the KCC/Hub a compliant `?tab=` receiver, and folds the standalone Rank Tracker `Page` into the Hub via a redirect + the 7-file route-removal checklist. **Owner:** `seo-strategy` (keyword surface) with secondary platform routing/nav. **New behavior** (deep-links) + **behavior-preserving migration** (nav/route fold-in).

**Verified grounding (re-confirmed):** `tab` is derived ONLY from `location.pathname` via `^\/ws\/([^/]+)\/(.+)$` (`src/App.tsx:193-202`) — a `?tab=` query does NOT change which `Page` renders, so the KCC component itself must read `useSearchParams`. The KCC **violates** the two-halves contract (`useState(...ALL)` `:115`, zero `searchParams`). The `<Navigate ... replace />` redirect template exists at `App.tsx:443` (`calendar → content-pipeline?tab=calendar`). The contract test `tests/contract/tab-deep-link-wiring.test.ts` parses `if (tab === 'X') return <Component` senders matching `adminPath(_, 'slug') + '?tab=value'` — **senders MUST use that exact shape**. `keywordTrackingKey(keyword)` (`src/lib/keywordTracking.ts:3`) is the canonical normalizer; the row exposes `normalizedKeyword` (`:185`) — the `q` param carries the **normalized** query so sender/receiver agree on identity.

**`seo-ranks`/`seo-keywords` blast radius (grep-confirmed, the route-removal set):** `src/routes.ts:7`; `src/App.tsx:383,436,465`; `Sidebar.tsx:67,82`; `Breadcrumbs.tsx:9,11`; `CommandPalette.tsx:34,43`; `KeywordCommandCenter.tsx:253`; `KeywordDetailDrawer.tsx:241`; `WorkspaceHome.tsx:207,448`; `RankingsSnapshot.tsx:30`; `PageIntelligence.tsx:275`; `MeetingBriefPage.tsx:55`; `tests/component/KeywordCommandCenter.test.tsx:155` (fixture `targetTab: 'seo-ranks'`).

### Task P4-T1 — Deep-link contract module + Hub receiver wiring (Model: **Opus**)

> Opus: broad blast radius (shared contract consumed by 3+ senders + the contract test) + the load-bearing two-halves receiver fix.

**Owns:** `src/lib/keywordHubDeepLink.ts` (new); `src/components/KeywordCommandCenter.tsx` (receiver: read `useSearchParams`, init filter + open keyword); `tests/unit/keywordHubDeepLink.test.ts` (new); `tests/component/KeywordCommandCenterDeepLink.test.tsx` (new).
**May READ, must NOT modify:** `src/routes.ts`, `src/App.tsx`, `shared/types/keyword-command-center.ts`, `src/lib/keywordTracking.ts`.

**Contract (the SHAPE):**
```ts
// src/lib/keywordHubDeepLink.ts
import type { KeywordCommandCenterFilter } from '../../shared/types/keyword-command-center';
export const HUB_DEEP_LINK_PARAMS: { readonly query: 'q'; readonly segment: 'tab' };
export function buildHubDeepLinkQuery(input: { keyword: string; segment?: KeywordCommandCenterFilter }): string; // normalizes via keywordTrackingKey; returns "?q=...&tab=..." (or just "?q=...")
export function readHubDeepLink(params: URLSearchParams): { query: string | null; segment: KeywordCommandCenterFilter | undefined };
export function isKeywordHubSegment(value: string | null | undefined): value is KeywordCommandCenterFilter;
```
**Receiver wiring in `KeywordCommandCenter.tsx`:** replace the hardcoded `useState(...ALL)` at `:115` with a **lazy `useState` initializer** reading `useSearchParams` (the canonical pattern); seed `searchTerm` from `q`; on mount, if `q` resolves to a visible row, set `selectedKey` to that row's `normalizedKeyword` so the drawer opens on the targeted keyword.

**Test assertions (write FIRST, run red):** `buildHubDeepLinkQuery({ keyword:'Cosmetic  Dentistry', segment:'tracked' })` → starts `?q=`, `q` equals `keywordTrackingKey('Cosmetic  Dentistry')`, contains `tab=tracked`; `{ keyword:'x' }` → has `q=`, no `tab=`; `readHubDeepLink('q=foo&tab=retired')` → `{query:'foo', segment:'retired'}`; `tab=bogus` → `segment: undefined` (ignored, not thrown); empty → `{query:null, segment:undefined}`; `isKeywordHubSegment('tracked')` true / `'nope'` false / `null` false; **round-trip** `readHubDeepLink(URLSearchParams(buildHubDeepLinkQuery({keyword:'a b', segment:'in_strategy'}).slice(1)))` → `{ query: keywordTrackingKey('a b'), segment:'in_strategy' }`; **RTL receiver** (render `<KeywordCommandCenter>` in `MemoryRouter` at `/ws/w1/seo-keywords?q=<key>&tab=tracked`, mock rows hook): active filter pill inits to `tracked` (NOT all), search seeded with `q`; a second render at `?tab=bogus` falls back to the `all` pill (no crash).

**Constraints/gotchas:** the `q` param MUST be `keywordTrackingKey`-normalized on BOTH halves (read-before-write — reuse `normalizedKeyword`/`keywordTrackingKey`). Use a **lazy `useState` initializer** reading `searchParams.get('tab')` — do NOT add a `useEffect` that resets filter on every param change (it would fight user clicks). This file is a shared contract consumed by T2/T3 — **commit it before those tasks run**.

### Task P4-T2 — Strategy quick-track + "View in Hub" deep-link sender (Model: **Sonnet**)

**Owns:** `src/components/KeywordStrategy.tsx`; `tests/component/KeywordStrategyViewInHub.test.tsx` (new).
**May READ, must NOT modify:** `src/lib/keywordHubDeepLink.ts` (T1), `src/routes.ts`.

**Contract:** per the approved boundary (spec §2 "Strategy keeps its fast on-ramp"): on each Site Target Keyword chip (`KeywordStrategy.tsx:743-766`), KEEP the existing one-click Track toggle (`trackKeyword(kw)` `:756`) AND ADD a per-keyword **"View in Hub"** action: `navigate(adminPath(workspaceId, 'seo-keywords') + buildHubDeepLinkQuery({ keyword: kw }))`. Label/title "View in Hub"; teal `IconButton variant="ghost"` (e.g. `ArrowUpRight`). The Track toggle's "Track in Rank Tracker" copy becomes "Track" (verify against `docs/workflows/ui-vocabulary.md`).

**Test assertions (write FIRST, run red):** the chip shows BOTH a Track control AND a "View in Hub" control (two distinct buttons); clicking "View in Hub" calls `navigate` with a path ending `/seo-keywords` whose query parsed via `readHubDeepLink` yields `query === keywordTrackingKey('cosmetic dentistry')` (assert via the helper, not a brittle string match); clicking Track still fires the existing `trackKeyword` path (no regression); the Track button no longer renders the literal "Rank Tracker" copy.

**Constraints:** Strategy is the upstream generation surface — add a navigation affordance only, do NOT move generation logic. The sender MUST use the literal `adminPath(workspaceId, 'seo-keywords') + buildHubDeepLinkQuery(...)` form; a `View in Hub` link with no segment is contract-safe (the static test only enforces wiring when a `?tab=` literal is present), but if a segment is added later it must be a real filter id.

### Task P4-T3 — Hub→Strategy back-link + KCC/drawer Rank-Tracker call-site updates (Model: **Sonnet**)

**Owns:** `src/components/keyword-command-center/KeywordDetailDrawer.tsx`; `src/components/KeywordCommandCenter.tsx` (the `view_rankings` handler `:252-254` ONLY); `tests/component/KeywordDetailDrawerLinks.test.tsx` (new).
**May READ, must NOT modify:** `src/lib/keywordHubDeepLink.ts` (T1), `src/routes.ts`, `src/App.tsx`.
**Coordination note:** T1 and T3 both touch `KeywordCommandCenter.tsx`. T1 owns the receiver-init region (`~:115`) + imports; T3 owns ONLY the `view_rankings` branch (`:252-254`). **T3 runs AFTER T1 (sequential, same file)**; T3 must not re-edit T1's regions. If the executor finds T1 has not committed, STOP (`NEEDS_CONTEXT`).

**Contract:** (1) **Drawer "View in Strategy" back-link** — a teal action deep-linking to the originating gap: `navigate(adminPath(workspaceId, 'seo-strategy'))` carrying the keyword/`sourceGapKey` in nav `state` or `?q=` (read the real drawer to see what origin data is on `row`); wire the P2 `data-testid="view-in-strategy-link"`. (2) **Drawer Rank-Tracker jump** (`:236-245`, the `seo-ranks` `Button` `:241`) — rank now lives IN the Hub drawer (P2's national-rank section); remove/repoint it to the in-drawer section rather than navigating away. (3) **KCC `view_rankings`** (`:252-254`, currently `navigate(adminPath(workspaceId, 'seo-ranks'))`) — repoint to open the keyword's drawer/rank section in-place (or remove the action); update the fixture `tests/component/KeywordCommandCenter.test.tsx:155` (`targetTab: 'seo-ranks'`) in the SAME commit.

**Test assertions (write FIRST, run red):** drawer renders a "View in Strategy" control → clicking navigates to a path ending `/seo-strategy`; drawer no longer renders a control navigating to `/seo-ranks` (assert on mocked navigate args); KCC `view_rankings` no longer produces a `navigate(... 'seo-ranks')` call.

**Constraints:** "View in Strategy" is an action = teal. Leave no `'seo-ranks'` literal in these two files after this task (it is retired in T4).

### Task P4-T4 — Rank Tracker fold-in: route redirect + route-removal checklist + nav relabel (Model: **Opus**)

> Opus: shared-file cross-file invariant (`routes.ts` + `App.tsx` + Sidebar + Breadcrumbs + CommandPalette change in lockstep in ONE commit) and the highest-risk "no broken bookmarks" task. **OWNS all shared routing/nav files — strictly sequential after T1–T3.**

**Owns:** `src/routes.ts` (`:7`); `src/App.tsx` (`SEO_TABS :383`, the `seo-ranks` redirect, `seo-keywords` route `:436`); `Sidebar.tsx` (`:67, :82`); `Breadcrumbs.tsx` (`TAB_LABELS :9,11`); `CommandPalette.tsx` (`NAV_ITEMS :34, :43`); `WorkspaceHome.tsx` (`:207, :448`); `RankingsSnapshot.tsx` (`:30`); `MeetingBriefPage.tsx` (`:55`); `PageIntelligence.tsx` (`:275`, verify); `tests/unit/route-fold-in-seo-ranks.test.ts` (new grep smoke test); `tests/component/seoRanksRedirect.test.tsx` (new).

**Contract — the fold-in approach (spec §3 + route-removal-checklist):** because P4 ships dark and P5 does the final cutover, P4 does **NOT delete** the `seo-ranks` `Page` value or `RankTracker`. It makes `seo-ranks` a **redirect into the Hub** and relabels nav (the rename/relabel half of the checklist; the full 7-file union delete is gated to P5):
1. **Nav label → "Keyword Hub":** `Sidebar.tsx:82` `'Keywords'`→`'Keyword Hub'` (description updated); **remove** the standalone Rank Tracker sidebar entry (`:67`). `CommandPalette.tsx:43` →`'Keyword Hub'`; **remove** the Rank Tracker `NAV_ITEMS` entry (`:34`). `Breadcrumbs.tsx` `TAB_LABELS`: `'seo-keywords': 'Keyword Hub'` (`:9`); `seo-ranks` label retained only while the redirect route exists.
2. **`seo-ranks` → Hub redirect** in `App.tsx` (mirror the `calendar` template `:443`): `if (tab === 'seo-ranks') return <Navigate to={adminPath(selected.id, 'seo-keywords')} replace />;` (no `?tab=` — folding the whole surface). Replaces the current `<RankTracker .../>` at `:465`. The `RankTracker` import stays for P5 (`// P5: removed at cutover` if linter-unused).
3. **Repoint remaining `seo-ranks` navigators** (`WorkspaceHome.tsx`, `RankingsSnapshot.tsx`, `MeetingBriefPage.tsx`) to `adminPath(_, 'seo-keywords')` (optionally `+ buildHubDeepLinkQuery` `tab=tracked`).
4. **`SEO_TABS` (`:383`):** keep `seo-ranks` (the redirect needs `needsSite` gating to resolve) — verify the redirect fires before the `needsSite` empty-state.

**Test assertions (write FIRST, run red):** **redirect render** (`MemoryRouter` at `/ws/w1/seo-ranks`, workspace mock) → renders a redirect to `/ws/w1/seo-keywords`, NOT the `RankTracker` grid (bookmark preserved, no 404/blank); **nav relabel** → `Sidebar` shows "Keyword Hub" and NO "Rank Tracker"; `CommandPalette` `NAV_ITEMS` has "Keyword Hub" and no "Rank Tracker"; **grep smoke** (`tests/unit/route-fold-in-seo-ranks.test.ts`, static `readFile`) → no `src/` file outside `App.tsx` (the redirect) and `routes.ts`/`Breadcrumbs.tsx` (the retained label) contains a `navigate(adminPath(_, 'seo-ranks'))` call; **`tab-deep-link-wiring` stays green** after T1's receiver fix.

**Constraints/gotchas:** ALL nav-label + redirect changes in ONE commit (route-removal completeness + "string literal renames"). No broken bookmarks: `seo-ranks` resolves to a redirect for the entire rollout; NOT deleted from the `Page` union in P4 (that is P5). The contract test's static parser keys off `if (tab === 'X') return <Component` — the `<Navigate>` redirect correctly does NOT register `seo-ranks` as a `?tab=` receiver. Verify `npm run typecheck` (the `Page` union is exhaustive across `renderContent()` — the `seo-ranks` `case` remains, now returning `<Navigate>`).

### P4 within-phase dependency graph

```
Sequential (shared contract first):
  P4-T1 (deep-link module + Hub receiver)   ← MUST commit first; T2/T3 import from it

Parallel after T1:
  P4-T2 (Strategy sender)   ∥   P4-T3 (drawer/KCC link updates — edits ONLY the view_rankings branch of KCC.tsx;
                                          T1 already committed the receiver/imports region, so non-overlapping)
  Diff-review checkpoint: git diff (verify T2/T3 no overlap) · npm run typecheck · npx vitest run T2+T3 tests

Sequential shared-file task LAST (owns routes.ts + App.tsx + Sidebar + Breadcrumbs + CommandPalette):
  P4-T4 (route redirect + 7-file relabel + nav consolidation)  — after T2+T3 so the seo-ranks literals
    in drawer/KCC (T3) are already gone before T4 sweeps the remaining navigators in one commit.
```

### P4 exports (downstream)

- **Deep-link contract** `src/lib/keywordHubDeepLink.ts` — `buildHubDeepLinkQuery`/`readHubDeepLink`/`isKeywordHubSegment`/`HUB_DEEP_LINK_PARAMS`; `q` always `keywordTrackingKey`-normalized, `tab` a `KeywordCommandCenterFilter`. Any keyword deep-link MUST use these.
- **Receiver compliance** — `KeywordCommandCenter` reads `useSearchParams` (`q`+`tab`); a valid two-halves receiver; P5 can target it with `?tab=<segment>` freely.
- **Nav consolidation** — single "Keyword Hub" entry (Sidebar + CommandPalette + Breadcrumbs); standalone "Rank Tracker" gone; `seo-ranks` is a live redirect. **P5 contract:** the final `seo-ranks` `Page`-union removal (full 7-file delete) is deferred to P5 — P4 leaves the union value + redirect so bookmarks survive.
- No `src/` component navigates TO `seo-ranks` except the `App.tsx` redirect (enforced by the grep smoke test).

---

## Phase P5 — Cutover (terminal)

> Three sequenced gates: (1) flag registration with `lifecycle: active` (dark default — the only change shipping before staging verification); (2) **owner-gated** staging verification; (3) dead-code removal of the bespoke KCC `KeywordRow` grid + the standalone `RankTracker` page nav (route already redirected in P4), registered in `DEPRECATION_REGISTRY`. Uses the `docs/rules/deprecation-lifecycle.md` taxonomy: `deprecated` (P0–P4 fallback) → `hidden` (P4 redirect) → `migrated`/`removed` (P5). **Owner:** `seo-keywords`. Secondary: `seo-ranks`. **New** (flag activation) + **behavior-preserving** (dead-code deletion).

### Task P5-T1 — Feature flag registration / lifecycle activation (Model: **Haiku**)

**Owns:** `shared/types/feature-flags.ts`; `data/roadmap.json` (if the `keyword-hub-wave4` item is absent, add a `pending` stub in the same commit so `verify:feature-flags` does not fail the roadmap link).
**May READ, must NOT modify:** all others.

**Contract:** ensure the `keyword-hub` flag is registered with `lifecycle.owner: 'seo-keywords'`, `createdAt: '2026-06-04'`, `rolloutTarget: 'staging-validation'`, `removalCondition` (Hub-is-only-surface + grid/nav deleted + no flag-off fallback), `linkedRoadmapItemId: 'keyword-hub-wave4'`, `staleAuditCadence: 'weekly'`, `lastReviewedAt: '2026-06-04'`, default `false`. The four lockstep insertion sites (`FEATURE_FLAGS`, `FEATURE_FLAG_GROUP_LABELS`, `FEATURE_FLAG_CATALOG`, `FEATURE_FLAG_GROUPS`) must all be present (P0-T1 added them; P5-T1 reconciles `lifecycle` to `active` if P0 used a different lifecycle value). **Note:** if P0-T1 already registered the flag with the final lifecycle, P5-T1 is a no-op verification — confirm at read time, do not duplicate keys (the import-time `assertFeatureFlagGroupingConsistency()` will throw on a dup).

**Test assertions:** `npm run verify:feature-flags` exits 0; importing the module does not throw; `FEATURE_FLAGS['keyword-hub'] === false`; the flag is in the `'Keyword Hub'` group; `.lifecycle.rolloutTarget === 'staging-validation'`.

**Constraints:** read `shared/types/feature-flags.ts` in full before editing; do NOT add the flag to any component (registration only). **Verification:** `npm run verify:feature-flags`; `npm run typecheck`; `npx vite build`.

### Task P5-T2 — Staging verification checklist (owner-gated; Model: **Opus** to draft) — NO code

The owner flips `keyword-hub` ON per-workspace on staging and verifies ALL of the following before authorizing P5-T3. Opus drafts this because "complete" requires judgment about a multi-phase Hub. This task modifies no files.

**Routing/nav (flag-ON):** `/ws/:id/seo-keywords` renders `KeywordHub` (not the old KCC); `/ws/:id/seo-ranks` redirects to `seo-keywords`; Sidebar shows "Keyword Hub" only ("Keywords"/"Rank Tracker" gone); Breadcrumbs + CommandPalette show "Keyword Hub". **Flag-OFF regression:** Sidebar still shows "Keywords" + "Rank Tracker" separately (the fallback still renders before deletion).
**P1:** segments All/In Strategy/Tracked/Needs Review/Retired/Local; debounced search + column sort; multi-select + bulk actions; server pagination handles 50+ keywords without timeout.
**P2:** row drawer shows Origin (`sourceGapKey`), Tracking (`strategyOwned`), national rank, per-market local visibility, lifecycle (incl. why-retired `replacedBy`/`deprecatedAt`); "View in Strategy" navigates to the gap; retired keywords show the why-retired block.
**P3:** per-row menu (Retire soft / Restore / Delete permanently confirmed red, lifecycle-appropriate); bulk retire + add-to-strategy; hard delete requires `ConfirmDialog`, soft retire does not; protected keywords require explicit confirm for retire/decline.
**P4:** Strategy "View in Hub →" opens the Hub with the keyword pre-selected (`?q=`); Hub "View in Strategy →" opens the gap; `?tab=` honored; `tab-deep-link-wiring.test.ts` green.
**Functional parity (nothing dropped):** Snapshot capture, pinned-trends, history sparkline (rows + drawer), per-market Local roll-up + Local segment, all 18 KCC filters reachable (primary pills + Advanced).
**No regressions:** `npm run typecheck`, `npx vitest run`, `npx tsx scripts/pr-check.ts`, `npm run verify:feature-flags` all green; no `violet`/`indigo`/`rose`/`pink` in `src/components/keyword-hub/`.
**Owner sign-off:** ________ Date: ________.

### Task P5-T3 — Dead-code removal + deprecation registry (Model: **Sonnet**)

**Pre-condition:** owner staging sign-off from P5-T2 complete. Two sub-tasks: (3a) verify the flag-OFF suite green; (3b) delete dead code + update registry + docs.

**Owns:** `src/components/KeywordCommandCenter.tsx` / `src/components/keyword-command-center/` (remove the bespoke `KeywordRow` grid only); `src/App.tsx` (`seo-keywords` always renders `<KeywordHub>`; confirm `seo-ranks` is a `<Navigate>` redirect from P4); `Sidebar.tsx`/`Breadcrumbs.tsx`/`CommandPalette.tsx` (labels/entries); `scripts/deprecation-lifecycle.ts` (two `DEPRECATION_REGISTRY` entries); `docs/rules/keyword-hub.md` (new contract doc); `docs/rules/keyword-command-center.md` (supersession notice); `FEATURE_AUDIT.md`; `data/roadmap.json`; `BRAND_DESIGN_LANGUAGE.md`; `tests/integration/keyword-hub-routing.test.ts` (new, unique port in 13201–13899); `tests/unit/deprecation-lifecycle.test.ts` (extend).
**May READ, must NOT modify:** `shared/types/feature-flags.ts` (P5-T1), `src/routes.ts` (the `Page` union — `seo-ranks`/`seo-keywords` STAY: `seo-ranks` redirects, `seo-keywords` renders the Hub; deleting union values would break the exhaustive switch), `server/keyword-command-center.ts` (the Hub reads it).

**Contract — 3a (run BEFORE any deletion):** `VITE_FEATURE_KEYWORD_HUB=false npx vitest run` — all existing KCC + RankTracker tests pass (the components still exist flag-OFF). Only proceed to 3b if green; otherwise STOP and report `NEEDS_CONTEXT` with failing test names.

**Contract — 3b (the bounded dead-code set; READ each file before deleting):**
1. The hand-rolled `KeywordRow` grid in KCC (renders rows WITHOUT `KeywordTable`) — dead once the Hub's `KeywordTable`-backed list is the only renderer; `KeywordCommandCenter` becomes a thin wrapper (or is deleted if `App.tsx` imports `KeywordHub` directly).
2. `App.tsx` `case 'seo-ranks'` — confirm it is a `<Navigate>` redirect (P4 work); nothing to delete if so.
3. `Sidebar.tsx:67` Rank Tracker entry — remove; `:82` `seo-keywords` label → `'Keyword Hub'`.
4. `Breadcrumbs.tsx:9` `seo-keywords` → `'Keyword Hub'`; `seo-ranks` removed or kept as a redirect-fallback label.
5. `CommandPalette.tsx:34` Rank Tracker `NAV_ITEMS` removed; `:43` `seo-keywords` → `'Keyword Hub'`.
**NOT deleted:** the `Page` union values, `server/keyword-command-center.ts`, and `src/components/RankTracker.tsx` (deleting the file requires the larger full route-removal — leave it, mark `migrated`).

**`docs/rules/keyword-hub.md`** must contain: surface boundaries (Hub owns lifecycle + measurement; Strategy stays generation; KCC server bundle stays the data source); the flag lifecycle (default OFF; cutover on staging verification; removal condition); the deprecation status of superseded surfaces (KCC `KeywordRow` grid `removed`; `seo-ranks` Page nav `migrated`); the `docs/rules/keyword-command-center.md` supersession notice; mutation rules (inherited broadcast + activity); UI rules (Four Laws + primitives `KeywordTable`/`StatusBadge`/`ConfirmDialog`).

**`DEPRECATION_REGISTRY` entries** (read the real shape in `scripts/deprecation-lifecycle.ts` first; match the existing structure exactly):
```typescript
{ id: 'kcc-keyword-row-grid', surface: 'KeywordRow bespoke grid renderer in KeywordCommandCenter',
  status: 'removed', replacedBy: 'src/components/keyword-hub/HubKeywordList.tsx via KeywordTable primitive',
  codeEvidence: 'src/components/KeywordCommandCenter.tsx (or keyword-command-center/ dir)',
  testEvidence: 'tests/component/KeywordHub.test.tsx — Hub list renders via KeywordTable', removalPR: 'keyword-hub-wave4-p5' },
{ id: 'rank-tracker-page-nav', surface: 'RankTracker Page nav entry (seo-ranks Sidebar item + CommandPalette entry)',
  status: 'migrated', replacedBy: 'Keyword Hub (seo-keywords) — seo-ranks route redirects to seo-keywords',
  codeEvidence: 'src/App.tsx case seo-ranks → Navigate redirect; Sidebar.tsx seo-ranks entry removed',
  testEvidence: 'tests/integration/keyword-hub-routing.test.ts — seo-ranks redirects to Hub', removalPR: 'keyword-hub-wave4-p5' },
```

**Test assertions:** `tests/integration/keyword-hub-routing.test.ts` (new, unique port — `grep -r 'createTestContext(' tests/`): `GET …/keyword-command-center/:workspaceId/rows` → 200; navigating to `seo-ranks` does NOT render `RankTracker` (the `renderContent()` case returns a redirect). `tests/unit/deprecation-lifecycle.test.ts`: registry contains `id:'kcc-keyword-row-grid' status:'removed'` and `id:'rank-tracker-page-nav' status:'migrated'`. `npm run verify:deprecations` zero errors. Flag-OFF + flag-ON suites green. `tests/contract/tab-deep-link-wiring.test.ts` green. `grep -r "violet-\|indigo-\|rose-\|pink-" src/components/keyword-hub/ src/components/KeywordCommandCenter.tsx` → zero.

**Constraints:** STOP before deleting if 3a is red. Route-removal-checklist: `seo-ranks` is NOT fully removed from the union in P5 (the redirect keeps it alive) — only the Sidebar + CommandPalette entries are removed; document this in PR notes. Sidebar label change may be unconditional OR `useFeatureFlag`-gated — do NOT call `useFeatureFlag` inside `buildNavGroups()`; add `keywordHubEnabled` as a param alongside `copyEngineEnabled` (read the existing `{ id:'brand', hidden:!copyEngineEnabled }` pattern `~:91`). `docs/rules/keyword-command-center.md` gets a supersession notice, not deletion. Do NOT add the admin Hub to `data/features.json` (admin features excluded from the sales reference). No raw `fetch()`. Unique test port.

### P5 within-phase dependency graph

```
P5-T1 (Flag registration — Haiku)
  └─→ [OWNER GATE: P5-T2 staging verification checklist — no code]
        └─→ P5-T3 (Dead-code removal — Sonnet)
              ├─ 3a: flag-OFF regression gate (green BEFORE any deletion)
              └─ 3b: deletion + registry + docs (after 3a green)
```
P5-T1 and P5-T3 are strictly sequential; P5-T2 is the owner-executed gate between them. P5 exports nothing downstream (terminal). After P5 merges + CI green on `staging`, the owner merges `staging → main`.

---

## Task Dependencies (global graph)

```
Phases are STRICTLY SEQUENTIAL — each its own flag-gated PR, merged + green on `staging` before the next:

  P0 ──► P1 ──► P2 ──► P3 ──► P4 ──► P5
 (flag+ (Hub  (journey (action (deep- (cutover)
  table  list)  drawer)  model)  links+
  migr.)                          nav fold-in)

Within each phase (parallel ∥ vs sequential), with pre-commit-shared-contracts BEFORE each parallel batch
and a diff-review checkpoint AFTER each batch:

P0:  (T1 ∥ T2)  →[commit T2 type]→  T3                      [Opus on T3]
P1:  T1 (gate)  →  (T2 ∥ T3)  →  T4  →  T5
P2:  T0 (gate)  →  (T1 ∥ T2 ∥ T4 ∥ T5 drafting)  →  serialized drawer-file merge (incl. T3)
P3:  3a  →  3b  →  3c  →  3d        (3a ∥ 3c-UI-scaffold is the only safe parallel pair)
P4:  T1 (gate)  →  (T2 ∥ T3)  →  T4 (owns all shared routing/nav, LAST)
P5:  T1  →  [owner gate T2]  →  T3 (3a flag-off green → 3b delete)
```

**Pre-commit-shared-contracts rule (per parallel batch):** P0 → commit `strategyOwned` type before T3. P1 → commit the `useKeywordHubState` hook + `KeywordHub` stub before the T2∥T3 batch. P2 → commit `KeywordSparkline` before T3. P3 → commit `TRACKED_KEYWORD_TRANSITIONS` before 3b. P4 → commit `keywordHubDeepLink.ts` before the T2∥T3 batch.

**Diff-review checkpoint (after each parallel batch):** `git diff` (verify no file overlap); grep for duplicate imports/conflicting edits; `npx tsc --noEmit --skipLibCheck`; `npx vitest run` (full suite, not just new tests); the per-batch color grep where new `src/components/keyword-hub/` files exist.

---

## Cross-Phase Contracts (what each phase exports downstream)

| Contract | Produced by | Consumed by |
|---|---|---|
| **`keyword-hub` flag** in `FEATURE_FLAG_CATALOG` (dark/OFF, lifecycle active) | P0-T1 (registers); P5-T1 (lifecycle activation) | P1 mounts the Hub under it; P4 nav gating; P5 flips it |
| **`KeywordCommandCenterTrackingState.strategyOwned?: boolean`** on the emitted row (admin-only, three-state, never public) | P0-T2 | P1 row meta "Auto-managed" badge; P2 drawer Tracking-Decision; P3 delete-eligibility predicate inputs |
| **Extended `KeywordTable` contract** (Option A custom-column slot or Option B `KeywordHubTable`) | P0-T3 | P1 list (`columns`/`sort`/`selection`/`renderKeywordMeta`); P2 (`renderExpanded`→drawer); P3 (`renderActions`→`KeywordActionMenu`) |
| **`useKeywordHubState`** shared interaction hook + **`KeywordHub`** host | P1 | P2 adds `selectedKeyword`; P3 reads `selectedKeys`; P4 deep-link init |
| **`KeywordDetailDrawer`** journey sections + `KeywordSparkline` + the two unwired `data-testid` affordances | P2 | P3 action footer; P4 wires the deep-link `href`s + repoints the Rank Tracker button |
| **Keyword state machine** `TRACKED_KEYWORD_TRANSITIONS` + `validateTransition('tracked_keyword', …)` wired into the engine | P3-3a/3b | P4/P5 must NOT remove the guard call (coverage contract fails); any future keyword status write |
| **`deleteKeywordHard` + `isHardDeleteEligible` + `KeywordActionMenu` + `useKeywordHardDelete`** (hard-delete as a separate channel, never a lifecycle action) | P3-3c | P4/P5 treat hard-delete as separate; `KEYWORD_COMMAND_CENTER_ACTIONS` stays delete-free |
| **Deep-link contract** `keywordHubDeepLink.ts` (`q` = normalized keyword, `tab` = `KeywordCommandCenterFilter`) + KCC as a compliant `?tab=` receiver | P4-T1 | P4 senders (Strategy, navigators); P5 may target `?tab=<segment>` freely |
| **Nav consolidation** (single "Keyword Hub", `seo-ranks` redirect; union value retained) | P4-T4 | P5 deletes the dead grid + nav entries; the `Page`-union delete stays deferred |
| **`DEPRECATION_REGISTRY` entries** (`kcc-keyword-row-grid` removed; `rank-tracker-page-nav` migrated) | P5-T3 | terminal; release gate |

---

## Systemic Improvements

**Shared utilities to extract:**
- `useKeywordHubState` (P1) — the single segment/sort/selection/search interaction hook (CLAUDE.md UI/UX #9), preventing re-hand-rolled state across P1's sub-tasks and P2/P3.
- The **`KeywordTable` custom-column slot** (P0) — the shared-interaction extraction that prevents P1+ from re-hand-rolling column logic per surface.
- `KeywordSparkline` (P2) — the shared sparkline primitive; `RankTracker.tsx` adopts it at P5 cleanup (kills the two-copy drift).
- `keywordHubDeepLink.ts` (P4) — the single `?q=`/`?tab=` builder/parser; both Strategy and any future client-facing Hub reuse it.
- `deleteKeywordHard` (P3) — consolidates the broadcast+activity wrapper the rank route hand-rolls (`server/routes/rank-tracking.ts:71-76`); the two existing callers are a P5 cleanup candidate (NOT refactored in P3).
- `localSeoColumnLabel` / `hubSortToKccSort` (P1) — pure helpers; extract to `src/utils/keywordHubFormatters.ts` only when needed in a second location (YAGNI).

**pr-check rules to add:**
- **P1:** `keyword-hub-useWorkspaceEvents-required` — a `customCheck` warning any `src/components/keyword-hub/` file calling `useKeywordCommandCenterRows`/`useKeywordCommandCenterBulkAction` without `useWorkspaceEvents` wired in the file/import graph (broadcast-after-mutation completeness).
- **P3:** extend the state-machine guard-coverage check so any new `tracked_keywords` status write outside `validateTransition('tracked_keyword', …)` is flagged (mirrors `GUARD_SIGNALS`). Confirm `scripts/pr-check.ts` reads that contract or add the rule.
- **P3 (consider):** a grep rule flagging `row.tracking.strategyOwned` truthiness checks using `!strategyOwned` rather than `=== true`/`=== false` (three-state contract).
- **P5 (consider):** a rule detecting any new import of `RankTracker` into `App.tsx` after removal (guard against reintroduction).
- **P4:** no new pr-check rule (route-removal is a cross-file constraint the docs say NOT to mechanize) — use the `tests/unit/route-fold-in-seo-ranks.test.ts` grep smoke test as the drift safety net.

**New tests required (by phase):** P0 — `feature-flags-keyword-hub` unit; extended `strategyOwned` unit/integration/no-leak; extended `KeywordTable`/KCC/RankTracker migration-equivalence. P1 — `useKeywordHubState`, `HubSegmentBar`, `HubAdvancedFilters`, `HubKeywordList`, `KeywordHub` component tests; `keyword-hub-list` integration (port 13900). P2 — `KeywordJourneyDrawer` (all 5 sections + empties + sparkline). P3 — keyword state-machine unit + graph/coverage entries; lifecycle red→green; hard-delete-vs-retire reconciliation; route 409/403 integration (port 13900); `KeywordActionMenu` + `HubBulkBar`. P4 — `keywordHubDeepLink` unit; receiver/sender/back-link/redirect component tests; `route-fold-in-seo-ranks` grep smoke. P5 — `keyword-hub-routing` integration; `deprecation-lifecycle` entries.

**Feature-class DoD gates (`docs/workflows/feature-class-definition-of-done.md`), per phase:** behavior-preserving refactor + additive contract (P0); flag-gated feature + admin CRUD golden path + WS two-halves + `?tab=` two-halves (P1); admin-only behind-flag mobile/a11y drawer (P2); state-machine DoD + data-safety (irreversible delete → `ConfirmDialog` + restriction predicate + activity audit) + broadcast-both-halves (P3); route-removal-checklist + two-halves contract + no-broken-bookmarks (P4); deprecation lifecycle (`verify:deprecations`) + docs (`FEATURE_AUDIT.md`/`roadmap.json`/`BRAND_DESIGN_LANGUAGE.md`/`keyword-hub.md`) (P5). Across all phases: Four Laws of Color audit; `scaled-code-review` (each phase spans modules / parallel agents); flag stays OFF in production until P5.

---

## Verification Strategy

**Every phase (the standard gate):**
```bash
npm run typecheck                  # zero errors (tsc -b, project-aware — NOT npx tsc)
npx vite build                     # production build succeeds
npx vitest run                     # FULL suite green (catches RankTable/SearchTab consumer regressions, not just new tests)
npx tsx scripts/pr-check.ts        # zero violations (color laws, JSON.parse, hardcoded names, customChecks)
npm run verify:feature-flags       # keyword-hub grouped/consistent; zero invalidLifecycle / missingRoadmapLinks
# color audit on new/changed files (must be empty):
grep -rnE 'violet|indigo|rose-|pink-|text-green-400' <phase's new/changed src files>
```

**Per-phase targeted commands:**

- **P0:** `npx vitest run tests/unit/feature-flags-keyword-hub.test.ts tests/unit/keyword-command-center.test.ts tests/integration/tracked-keywords-row-table.test.ts tests/component/KeywordTable.test.tsx tests/component/KeywordCommandCenter.test.tsx tests/component/RankTracker.test.tsx` + **preview screenshots** of the migrated KCC + Rank Tracker confirming **byte-identical/behavior-preserving appearance** (the flag-OFF surfaces are unchanged).
- **P1:** the five new component suites + `npx vitest run tests/integration/keyword-hub-list.test.ts` (port 13900) + `npm run verify:coverage-ratchet`; **manual smoke** on staging (flag OFF → KCC unchanged; flag ON → Hub; `?tab=tracked` lands on Tracked; search debounce; column sort; multi-select bulk bar; Local segment MapPin; Advanced filters; 375px mobile horizontal scroll).
- **P2:** `npx vitest run tests/component/keyword-hub/KeywordJourneyDrawer.test.tsx` + `npx vitest run tests/component/`; `tests/contract/tab-deep-link-wiring.test.ts` stays green (P2 wires no `?tab=` sender); mobile drawer/bottom-sheet at 375px.
- **P3:** `npx vitest run tests/unit/keyword-state-machine.test.ts tests/unit/state-machine-graph-contract.test.ts tests/contract/state-machine-guard-coverage-contract.test.ts tests/unit/keyword-command-center.test.ts tests/unit/keyword-command-center-bulk.test.ts tests/unit/keyword-hub-delete.test.ts tests/integration/keyword-hub-actions.test.ts tests/component/keyword-command-center/KeywordActionMenu.test.tsx tests/component/keyword-command-center/HubBulkBar.test.tsx`; confirm Delete is the only red and retire/decline are amber post-reconciliation (`grep -n "tone:" server/keyword-command-center.ts`); port uniqueness `grep -rEo 'createTestContext\(13[0-9]{3}' tests/ | sort | uniq -d` (empty).
- **P4:** `npx vitest run tests/contract/tab-deep-link-wiring.test.ts tests/unit/keywordHubDeepLink.test.ts tests/component/KeywordCommandCenterDeepLink.test.tsx tests/component/KeywordStrategyViewInHub.test.tsx tests/component/KeywordDetailDrawerLinks.test.tsx tests/component/seoRanksRedirect.test.tsx tests/unit/route-fold-in-seo-ranks.test.ts tests/component/KeywordCommandCenter.test.tsx`; **manual:** load `/ws/:id/seo-ranks` → lands on the Hub (redirect); Strategy "View in Hub" → Hub opens with the keyword seeded + drawer on the right row; Hub drawer "View in Strategy" → Strategy; screenshot the relabeled Sidebar.
- **P5:** `VITE_FEATURE_KEYWORD_HUB=false npx vitest run` (flag-OFF green BEFORE deletion) → then `npx vitest run` (both paths) + `npx vitest run tests/unit/deprecation-lifecycle.test.ts tests/contract/tab-deep-link-wiring.test.ts tests/integration/keyword-hub-routing.test.ts` + `npm run verify:deprecations` + `npm run verify:coverage-ratchet`.

**Flag-OFF byte-identity until cutover:** through P0–P4 the flag stays OFF in production; the flag-OFF render path (the existing KCC + standalone Rank Tracker) must stay behavior-preserving and green at every phase gate (P0's migration is the only phase that touches the flag-OFF surfaces, and only behavior-preservingly). P5-T3-3a is the explicit flag-OFF regression gate before any deletion.

**Code review:** each phase spans modules (and, where parallelized, agents) — invoke `superpowers:scaled-code-review` before each merge; fix all Critical/Important findings. CI green on `staging` before the next phase starts.

---

## Execution Discipline (mandatory, every task)

Per `docs/PLAN_WRITING_GUIDE.md` "Plans Are Contract + Test-Centric": for each task — (1) **READ** the real code at the cited `file:line` (re-confirm — anchors drift); (2) write the failing test from the assertions above and **RUN it red**, confirming it fails for the right reason; (3) implement **minimally** against the real signatures; (4) **RUN** the test green + `npm run typecheck`; (5) commit. **Never transcribe; never skip the red.** If the real code contradicts a contract in this plan, **STOP and report `NEEDS_CONTEXT`** — do not invent field names or coerce types (the project's #1 bug pattern is guessed field names that compile via `as any` but cause silent data loss). Honor the three-state `strategyOwned` discipline, the transaction-wrapped guard ordering (protection → transition → write), and the hard-delete-is-separate-and-confirmed contract exactly as specified.