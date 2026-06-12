# Local ↔ Strategy Refresh Ordering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Plan style (owner preference — overrides the writing-plans "show full impl code" rule):** contract + test-centric. Each task gives the **exact contract** (types/signatures/return shapes), the **full test code** (the test is the spec), and the **constraints/anchors** to obey. The **implementation itself is written at execution against the real code** — do NOT paste pre-baked impl bodies into this plan. Re-confirm every line anchor before editing (stale-grounding guard; anchors verified against staging `f51247f1`).

**Goal:** For local/hybrid workspaces, make the correct refresh order (local SEO → strategy) discoverable and one-click, and surface staleness in both directions, without auto-spending provider credits.

**Architecture:** One shared read-only comparator (`getLocalStrategySyncStatus`) is the source of truth for both directions; its fields ride on the existing strategy status read (`KeywordStrategyUxPayload.localSync`). A server-side job chain lets a local refresh optionally regenerate the strategy on completion (abort if the crawl returned nothing). Two admin surfaces consume the comparator: a forward smart-prompt + "Full refresh" button, and a reverse "strategy older than local" nudge.

**Tech Stack:** Express + better-sqlite3 (server), React 19 + React Query (client), Vitest (4 projects: unit/component/integration/contract), the in-house background-job platform (`server/jobs.ts`).

---

## Decisions locked (from the approved spec + grounding)

- **Scope:** both surfaces (smart prompt + dedicated button) + both directions (forward + reverse nudge).
- **Staleness rule:** local data is stale when `missing` | `stale` (older than `LOCAL_DATA_STALE_DAYS = 30`) | `markets_changed` (a market `updated_at` after the latest snapshot `captured_at`).
- **Sequencing:** combined action auto-chains local → strategy; **abort the strategy regen if the local refresh produced zero snapshots** (`result.refreshed === 0`); a degraded-but-partial crawl (`refreshed > 0`) proceeds.
- **Orchestration:** server-side, in the local-refresh worker completion hook.
- **Posture:** `applies` only for `local`/`hybrid`; `non_local`/`unknown` see nothing and get no behavior change.
- **No new tables. No new feature flag** (additive, non-blocking, posture-gated; matches the consolidation precedent). If the owner later wants a dark-launch, a flag with the full lifecycle block would be added first — out of scope here.
- **Bounded context:** `analytics-intelligence`.

## Grounded reality corrections (MUST honor — these differ from first assumptions)

1. The admin "Generate Strategy" button → `startJob()` ([useBackgroundTasks.tsx:156](src/hooks/useBackgroundTasks.tsx#L156)) → `POST /api/jobs` → inline dispatcher [jobs.ts:716-802](server/routes/jobs.ts#L716). The MCP `runKeywordStrategyJob` is module-private. **The chain calls `generateKeywordStrategy()` directly via dynamic import + its own `createJob(KEYWORD_STRATEGY)`** (mirror the `generateRecommendations` dynamic import already in the completion hook).
2. `LocalSeoRefreshResult` = `{ refreshed, skipped, failed, markets, keywords }` ([shared/types/local-seo.ts:583](shared/types/local-seo.ts#L583)) — **no** `status`/`usableSnapshots`/`degraded` field. Hard-fail = `refreshed === 0`. Also the empty-plan early-return finishes with job `status:'done'` + `refreshed:0` ([local-seo.ts:2269](server/local-seo.ts#L2269)) — so gate on `result.refreshed`, never on job status.
3. `keyword_strategy` is a **JSON TEXT column on `workspaces`** ([migration 005:19](server/db/migrations/005-workspaces.sql#L19)); `generatedAt` is `getWorkspace(id).keywordStrategy?.generatedAt` ([workspaces.ts:159](server/workspaces.ts#L159)). No strategy table to SELECT.
4. No workspace-wide `MAX(captured_at)` reader exists — add a prepared statement alongside the other `local_visibility_snapshots` stmts in `server/local-seo.ts` ([columns: migration 096:25,39](server/db/migrations/096-local-seo-visibility.sql#L25)).
5. `ConfirmDialog` renders 2 buttons only ([ConfirmDialog.tsx:15](src/components/ui/ConfirmDialog.tsx#L15)) → the 3-action prompt is a small dedicated modal.
6. The admin `useKeywordStrategy` returns `KeywordStrategy | null` ([useKeywordStrategy.ts:31](src/hooks/admin/useKeywordStrategy.ts#L31)) and does **not** type `strategyUx`, though the server attaches it in both GET branches ([keyword-strategy.ts:110](server/routes/keyword-strategy.ts#L110), shell branch :223). Carry `localSync` on `KeywordStrategyUxPayload` and widen the admin read type.
7. `KeywordStrategy.tsx` has **no** `useWorkspaceEvents` handler; `useLocalSeoRefresh` invalidates on job *start* not completion ([useLocalSeo.ts:23](src/hooks/admin/useLocalSeo.ts#L23)). Add invalidation of the strategy key on `STRATEGY_UPDATED` + `LOCAL_SEO_UPDATED` in `src/hooks/useWsInvalidation.ts` (centralized; inline duplicate subs are a pr-check ERROR).
8. Route read/write contract annotations are an ERROR-level pr-check for `keyword-strategy.ts` and `jobs.ts` ([pr-check.ts:4929](scripts/pr-check.ts#L4929)) — update `@reads`/`@writes` when those routes read local tables / chain jobs.
9. Worker modules can't import `broadcastToWorkspace` directly (data-flow rule #4) — reuse the existing init-callback already wired in the completion hook.
10. Four Laws of Color: CTAs (Full refresh, Generate) = teal; staleness warnings = amber; hard-fail = red; never purple/violet/indigo/rose/pink/`text-green-400`; use `Button`/`IconButton`/`SectionCard` (raw `<button>` + raw gradient literals are pr-check errors).

## File structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `shared/types/local-seo.ts` | `LocalStrategySyncStatus` interface, `LOCAL_NEEDS_REFRESH_REASON` const+type, `LOCAL_DATA_STALE_DAYS`; add `thenRegenerateStrategy?` to `LocalSeoRefreshRequest` | Modify |
| `shared/types/keyword-strategy-ux.ts` | add `localSync?: LocalStrategySyncStatus` to `KeywordStrategyUxPayload` | Modify |
| `server/local-seo.ts` | new prepared stmt + `latestLocalSnapshotAt(workspaceId)`; completion-hook chain branch | Modify |
| `server/local-strategy-sync.ts` | `getLocalStrategySyncStatus(workspaceId)` comparator (focused new module; keeps the 2510-line local-seo.ts from growing) | Create |
| `server/routes/keyword-strategy.ts` | populate `strategyUx.localSync` in both GET branches; update `@reads` contract | Modify |
| `server/routes/local-seo.ts` | pass `thenRegenerateStrategy` through to the refresh job | Modify |
| `src/hooks/admin/useKeywordStrategy.ts` | widen read type to expose `strategyUx.localSync` | Modify |
| `src/hooks/useWsInvalidation.ts` | invalidate strategy key on `STRATEGY_UPDATED` + `LOCAL_SEO_UPDATED` | Modify |
| `src/components/keyword-strategy/RefreshOrderingPrompt.tsx` | 3-action smart-prompt modal | Create |
| `src/components/KeywordStrategy.tsx` | mount Full-refresh button + prompt + reverse nudge | Modify |
| `src/api/localSeo.ts` / `src/hooks/admin/useLocalSeo.ts` | thread `thenRegenerateStrategy` into the refresh mutation | Modify |
| tests (unit/component) | per-phase | Create |

---

## Phase 0 — Shared types + staleness comparator

### Task 0.1: Shared types for the comparator

**Files:**
- Modify: `shared/types/local-seo.ts` (near `LOCAL_SEO_POSTURE` at :3)

**Contract (define exactly):**
```ts
export const LOCAL_DATA_STALE_DAYS = 30;
export const LOCAL_NEEDS_REFRESH_REASON = {
  MISSING: 'missing',
  STALE: 'stale',
  MARKETS_CHANGED: 'markets_changed',
} as const;
export type LocalNeedsRefreshReason =
  (typeof LOCAL_NEEDS_REFRESH_REASON)[keyof typeof LOCAL_NEEDS_REFRESH_REASON];

export interface LocalStrategySyncStatus {
  applies: boolean;                       // posture is local | hybrid
  localNeedsRefresh: boolean;
  localNeedsRefreshReason: LocalNeedsRefreshReason | null;
  strategyStaleVsLocal: boolean;
  lastLocalRefreshAt: string | null;      // ISO; max(local_visibility_snapshots.captured_at)
  lastStrategyGeneratedAt: string | null; // ISO; ws.keywordStrategy.generatedAt
}
```
Also add `thenRegenerateStrategy?: boolean;` to the existing `LocalSeoRefreshRequest` ([:570](shared/types/local-seo.ts#L570)).

**Constraints:** typed shared contract per CLAUDE.md Data-Flow rule #5; no `Record<string,unknown>`. No test for a pure type change — verified by `npm run typecheck` in later tasks.

- [ ] Add the types; `npm run typecheck` clean.
- [ ] Commit: `feat(types): LocalStrategySyncStatus + thenRegenerateStrategy refresh flag`.

### Task 0.2: `latestLocalSnapshotAt` reader (new prepared stmt)

**Files:**
- Modify: `server/local-seo.ts` (add to the existing `local_visibility_snapshots` stmt cache; export the reader near `countLocalVisibilitySnapshots` :2400)
- Test: `tests/unit/local-strategy-sync.test.ts` (new)

**Contract:** `export function latestLocalSnapshotAt(workspaceId: string): string | null` — returns the max `captured_at` (ISO) across all of a workspace's `local_visibility_snapshots`, or `null` when none.

**Constraints:** lazy prepared stmt via the module's existing `stmts()`/`createStmtCache` pattern (no bare `db.prepare`); workspace-scoped; this is a cheap aggregate read — do NOT touch the Evaluated/full-model builders (pr-check ERROR [:1342/:1377](scripts/pr-check.ts#L1342)).

- [ ] **Step 1 — failing test** (`tests/unit/local-strategy-sync.test.ts`):
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { latestLocalSnapshotAt } from '../../server/local-seo.js';
// Seed helper mirrors tests/unit/keyword-command-center.test.ts:589-645 (posture+market+snapshot insert).
// Re-confirm the exact seeding API at execution: updateLocalSeoConfiguration(server/local-seo.ts:800)
// for posture+markets, and the snapshot-insert path used in keyword-command-center.test.ts.

let workspaceId = '';
beforeEach(() => { workspaceId = createWorkspace(`sync ${Date.now()}`).id; });
afterEach(() => { if (workspaceId) deleteWorkspace(workspaceId); workspaceId = ''; });

describe('latestLocalSnapshotAt', () => {
  it('returns null when the workspace has no snapshots', () => {
    expect(latestLocalSnapshotAt(workspaceId)).toBeNull();
  });
  it('returns the max captured_at across snapshots', () => {
    // seed two snapshots with captured_at '2026-05-01...' and '2026-06-01...'
    // (use the seeding helper resolved at execution)
    // expect(latestLocalSnapshotAt(workspaceId)).toBe('2026-06-01T00:00:00.000Z')
  });
});
```
- [ ] **Step 2** — run `npx vitest run tests/unit/local-strategy-sync.test.ts`; expect FAIL (null case fails / import missing).
- [ ] **Step 3** — implement `latestLocalSnapshotAt` against the real schema/stmt cache (no pre-baked body here). Fill the seeding in Step 1's second case using the resolved helper.
- [ ] **Step 4** — re-run; expect PASS.
- [ ] **Step 5** — commit: `feat(local-seo): latestLocalSnapshotAt workspace-wide max(captured_at)`.

### Task 0.3: `getLocalStrategySyncStatus` comparator

**Files:**
- Create: `server/local-strategy-sync.ts`
- Test: extend `tests/unit/local-strategy-sync.test.ts`

**Contract:** `export function getLocalStrategySyncStatus(workspaceId: string): LocalStrategySyncStatus`. Reads: `getLocalSeoPosture` ([local-seo.ts:575](server/local-seo.ts#L575)), `listLocalSeoMarkets` ([:605](server/local-seo.ts#L605)), `latestLocalSnapshotAt` (0.2), `getWorkspace(id).keywordStrategy?.generatedAt`. Rules exactly per spec:
- `applies = posture === 'local' || posture === 'hybrid'`. If false → all flags false, reasons null, but still return the timestamps as read (or null).
- reason precedence: `missing` (no snapshots) → else `markets_changed` (any `market.updatedAt > lastLocalRefreshAt`) → else `stale` (`lastLocalRefreshAt` older than `LOCAL_DATA_STALE_DAYS`) → else null.
- `localNeedsRefresh = applies && reason !== null`.
- `strategyStaleVsLocal = applies && lastStrategyGeneratedAt != null && lastLocalRefreshAt != null && lastStrategyGeneratedAt < lastLocalRefreshAt`.

**Constraints:** read-only; no provider calls; no Evaluated/full-model builders. Handle `null` `generatedAt` (shell-strategy workspaces) — `strategyStaleVsLocal` stays false but `localNeedsRefresh` can still fire (onboarding). Confirm `LocalSeoMarket.updatedAt` field name at execution.

- [ ] **Step 1 — failing tests** (append):
```ts
import { getLocalStrategySyncStatus } from '../../server/local-strategy-sync.js';

describe('getLocalStrategySyncStatus', () => {
  it('applies=false and fires nothing for non-local posture', () => {
    // posture default/unknown
    const s = getLocalStrategySyncStatus(workspaceId);
    expect(s.applies).toBe(false);
    expect(s.localNeedsRefresh).toBe(false);
    expect(s.strategyStaleVsLocal).toBe(false);
    expect(s.localNeedsRefreshReason).toBeNull();
  });
  it("reason 'missing' for a local workspace with no snapshots", () => {
    // set posture local (updateLocalSeoConfiguration), no snapshots
    // expect applies true, localNeedsRefresh true, reason 'missing'
  });
  it("reason 'markets_changed' when a market was edited after the latest crawl", () => {
    // snapshot captured_at older than a market updated_at
    // expect reason 'markets_changed'
  });
  it("reason 'stale' when the latest crawl is older than 30 days", () => {
    // snapshot captured_at = 40 days ago; markets older than that
    // expect reason 'stale'
  });
  it('reason null when local data is fresh', () => {
    // snapshot captured_at = today; markets older
    // expect localNeedsRefresh false, reason null
  });
  it('strategyStaleVsLocal true when strategy generatedAt predates the latest crawl', () => {
    // strategy blob generatedAt older than snapshot captured_at (updateWorkspace({keywordStrategy}))
    // expect strategyStaleVsLocal true
  });
  it('strategyStaleVsLocal false when there is no strategy blob (shell)', () => {
    // no keywordStrategy; local snapshot present
    // expect strategyStaleVsLocal false, but localNeedsRefresh reflects local freshness
  });
});
```
- [ ] **Step 2** — run; expect FAIL (module missing).
- [ ] **Step 3** — implement the comparator against real signatures; fill the seeding in each case (posture via `updateLocalSeoConfiguration`; strategy via `updateWorkspace({ keywordStrategy })` per recommendations-keyword-normalization.test.ts:58-64; snapshots/markets per keyword-command-center.test.ts:589-645).
- [ ] **Step 4** — run; all PASS.
- [ ] **Step 5** — commit: `feat(local-strategy-sync): bidirectional staleness comparator`.

---

## Phase 1 — Status wiring (so the client can read sync state)

### Task 1.1: Attach `localSync` to the strategy GET response

**Files:**
- Modify: `shared/types/keyword-strategy-ux.ts:95` — add `localSync?: LocalStrategySyncStatus`.
- Modify: `server/routes/keyword-strategy.ts` — populate `strategyUx.localSync = getLocalStrategySyncStatus(workspaceId)` in BOTH GET branches (real [:253](server/routes/keyword-strategy.ts#L253)/serialize [:110](server/routes/keyword-strategy.ts#L77), and shell [:223-242](server/routes/keyword-strategy.ts#L223)). Update the route's `@reads` contract comment to include `local_visibility_snapshots, local_seo_markets` (pr-check ERROR if missing).
- Modify: `src/hooks/admin/useKeywordStrategy.ts:31` — widen the return type so `strategyUx?.localSync` is typed admin-side.
- Test: `tests/integration/keyword-strategy-localsync-read.test.ts` (spawned-server; assert the field is present) **OR** a focused route-level unit if a server handler is callable in-process — prefer reusing the existing keyword-strategy read test pattern; allocate port ~13905 if integration.

**Contract:** GET `/api/webflow/keyword-strategy/:id` response carries `strategyUx.localSync: LocalStrategySyncStatus` in both the shell and real branches; non-local workspace → `applies:false`.

- [ ] **Step 1 — failing test:** assert a local workspace (posture local, a snapshot, no strategy) returns `strategyUx.localSync.applies === true` and `localNeedsRefresh === true`; a default workspace returns `applies === false`.
- [ ] **Step 2** — run; FAIL.
- [ ] **Step 3** — implement; keep `@reads` contract valid; `npm run typecheck`.
- [ ] **Step 4** — run; PASS.
- [ ] **Step 5** — commit: `feat(keyword-strategy): expose localSync on the strategy read`.

### Task 1.2: WS-event invalidation for the strategy read

**Files:**
- Modify: `src/hooks/useWsInvalidation.ts` — invalidate `queryKeys.keywordStrategy(workspaceId)` ([queryKeys.ts:83](src/lib/queryKeys.ts#L83)) on `STRATEGY_UPDATED` ([ws-events.ts:133](server/ws-events.ts#L133)) and `LOCAL_SEO_UPDATED` ([:137](server/ws-events.ts#L137)).
- Test: extend an existing `useWsInvalidation` test if present; else a component test asserting the query key is invalidated on the event (mock the query client).

**Contract:** when either event fires for the active workspace, the strategy read (and thus `localSync`) refetches — so the reverse nudge and the prompt reflect a just-finished chain. Centralized in `useWsInvalidation.ts` (inline `useWorkspaceEvents` in components is a pr-check ERROR; hatch `// ws-invalidation-ok` only if unavoidable).

- [ ] Write/extend the test → FAIL → implement → PASS → commit: `fix(ws-invalidation): refresh strategy read on strategy/local-seo updates`.

---

## Phase 2 — Server job chain (local → strategy)

### Task 2.1: Thread `thenRegenerateStrategy` to the refresh job

**Files:**
- Modify: `server/routes/local-seo.ts:208-238` — accept `thenRegenerateStrategy` from `req.body` and pass it into `runLocalSeoRefreshJob(...)`; keep the existing global coalescing 409 ([:219-226](server/routes/local-seo.ts#L219)). Update `@reads`/`@writes` if needed (jobs.ts contract is separate).
- Modify: `server/local-seo.ts` `runLocalSeoRefreshJob` signature ([:2261](server/local-seo.ts#L2261)) to receive the flag through its request param.

**Contract:** the flag flows route → job; absent/false preserves today's exact behavior (byte-identical for every existing caller).

- [ ] Covered by Task 2.2's test (the chain). Type-only plumbing here; `npm run typecheck`. Commit with 2.2 or as `feat(local-seo): accept thenRegenerateStrategy on refresh`.

### Task 2.2: Completion-hook chain branch (the core)

**Files:**
- Modify: `server/local-seo.ts:2376-2398` — after the existing posture-gated recommendations regen (dynamic-import `generateRecommendations` at [:2389](server/local-seo.ts#L2389)) and before the final `updateJob(status:'done')` ([:2397](server/local-seo.ts#L2397)).
- Test: `tests/unit/local-strategy-chain.test.ts` (new) — **in-process unit**, mirroring the Scope D recs-regen test ([local-seo.test.ts:1563-1647](tests/unit/local-seo.test.ts#L1563)).

**Contract (exact branch behavior):**
- Only when `request.thenRegenerateStrategy === true`.
- Compute `proceed = result.refreshed > 0` (hard-fail `refreshed === 0` → do NOT regen; degraded-but-partial → regen). The empty-plan early-return ([:2269](server/local-seo.ts#L2269)) never reaches this hook, but the `refreshed > 0` gate is the backstop.
- On `proceed`: `createJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, …)` and run `generateKeywordStrategy(...)` via **dynamic import** (mirror the recs-regen import-to-break-cycle), wrapped in try/catch so a strategy failure (e.g. `KeywordStrategyGenerationError`, missing tier/OPENAI key/webflowSiteId) logs and is swallowed — it must NOT fail the already-successful local-refresh job.
- The chained strategy regen broadcasts `STRATEGY_UPDATED` through its own path (reuse the existing init-callback; do not import `broadcastToWorkspace` in the worker).

**Tests (full, mirror Scope D — spy the dynamic import, run the job in-process with `__setRefreshTimingsForTesting` + a `FakeSeoProvider.getLocalVisibility` stub [:142-162](server/providers/fake-seo-provider.ts#L142)):**
```ts
// tests/unit/local-strategy-chain.test.ts
// - flag off → strategy generator NOT called (byte-identical)
// - flag on + provider returns SUCCESS (refreshed>0) → generator called once
// - flag on + provider DEGRADED but refreshed>0 → generator called (proceed)
// - flag on + provider hard-fails / refreshed===0 → generator NOT called (abort)
// - flag on + generator throws → local-refresh job still ends status:'done' (swallowed)
// Spy pattern: vi.mock('../../server/keyword-strategy-generation.js', ...) or vi.spyOn the
// dynamically-imported module exactly as Scope D spies the recs generator; assert call count + job status.
```
- [ ] Steps 1-4 (write → FAIL → implement branch → PASS for all five cases).
- [ ] Step 5 — commit: `feat(local-seo): chain strategy regen after local refresh (abort on empty crawl)`.

---

## Phase 3 — Forward UI (smart prompt + Full refresh button)

### Task 3.1: `thenRegenerateStrategy` through the client refresh mutation

**Files:**
- Modify: `src/api/localSeo.ts:60` (`refresh`) + `src/hooks/admin/useLocalSeo.ts:16` (`useLocalSeoRefresh`) to accept `{ thenRegenerateStrategy?: boolean }` in the mutation variables (default false preserves the standalone button).

**Contract:** existing `refresh.mutate({})` callers unchanged; new callers pass `{ thenRegenerateStrategy: true }`.
- [ ] typecheck + existing local-seo hook/component tests still green → commit `feat(useLocalSeo): pass thenRegenerateStrategy`.

### Task 3.2: 3-action smart-prompt modal

**Files:**
- Create: `src/components/keyword-strategy/RefreshOrderingPrompt.tsx`
- Test: `tests/component/refresh-ordering-prompt.test.tsx`

**Contract:** props `{ open, reason: LocalNeedsRefreshReason, lastLocalRefreshAt: string | null, onFullRefresh(), onGenerateAnyway(), onCancel() }`. Renders reason-specific copy (missing → "No local SEO data yet"; stale → "Local SEO data is 30+ days old"; markets_changed → "Your markets changed since the last local crawl"). Three actions via `<Button>`: **Full refresh (local → strategy)** [primary/teal], **Generate anyway** [secondary], **Cancel** [ghost]. Mirror `ConfirmDialog` structure/overlay; do NOT extend the shared 2-button `ConfirmDialog`.

**Constraints:** Four Laws — teal CTA via `<Button variant="primary">` (no raw gradient literal), amber accent for the warning copy, no purple. Use the modal overlay primitive (confirm the one `ConfirmDialog` uses).

**Test (full):**
```tsx
// renders each reason's copy; clicking each of the 3 buttons fires the right callback exactly once;
// not rendered when open=false. Mirror tests/component/keyword-dollar-value-drawer.test.tsx render style.
```
- [ ] FAIL → implement → PASS → commit `feat(keyword-strategy): 3-action refresh-ordering prompt`.

### Task 3.3: Mount Full-refresh button + prompt on the strategy surface

**Files:**
- Modify: `src/components/KeywordStrategy.tsx` — in the PageHeader actions container ([:308/:321](src/components/KeywordStrategy.tsx#L321)) add a **"Full refresh"** `<Button>` (shown when `localSync.applies`, visually flagged when `localNeedsRefresh`); intercept `generateStrategy` ([:187](src/components/KeywordStrategy.tsx#L187)) so that when `localSync.localNeedsRefresh` it opens `RefreshOrderingPrompt` instead of immediately calling `startJob`. Wire: Full refresh → `refresh.mutate({ thenRegenerateStrategy: true })`; Generate anyway → existing `startJob(KEYWORD_STRATEGY)`; Cancel → close.
- Test: `tests/component/KeywordStrategy.refresh-ordering.test.tsx` (mirror [KeywordStrategyBackgroundJob.test.tsx](tests/component/KeywordStrategyBackgroundJob.test.tsx)).

**Contract / behavior:** non-local (`applies:false`) → no Full-refresh button, no intercept (plain Generate). local/hybrid + fresh → Full-refresh button present but un-flagged, Generate runs directly (no prompt). local/hybrid + stale → Generate opens the prompt; "Generate anyway" is the non-blocking override. Disambiguate from the standalone LocalSeoVisibilityPanel "Refresh" ([:317](src/components/local-seo/LocalSeoVisibilityPanel.tsx#L317)) by label ("Full refresh (local → strategy)" vs "Refresh").

**Tests (full):** mock `useKeywordStrategy` to return each `localSync` state + `useLocalSeoRefresh`; assert: button visibility per posture/freshness; Generate→prompt only when stale; each prompt action calls the right mutation/job; "Generate anyway" bypasses refresh.
- [ ] FAIL → implement → PASS → commit `feat(keyword-strategy): Full-refresh button + ordering intercept`.

---

## Phase 4 — Reverse nudge

### Task 4.1: "Strategy older than local" nudge banner

**Files:**
- Modify: `src/components/KeywordStrategy.tsx` — render a non-blocking amber nudge (mirror the existing amber warning div [:642](src/components/KeywordStrategy.tsx#L642): `bg-amber-500/10 border border-amber-500/30` + `AlertTriangle` + `text-accent-warning`) when `localSync.applies && localSync.strategyStaleVsLocal`, with copy referencing `lastLocalRefreshAt`/`lastStrategyGeneratedAt` and a teal **Generate Strategy** CTA; include a dismiss control (local component state; reappears on reload / next stale read).
- Test: `tests/component/KeywordStrategy.reverse-nudge.test.tsx`.

**Contract:** shows only when `applies && strategyStaleVsLocal`; hidden for non-local, for fresh strategies, and after dismiss; CTA triggers the existing `generateStrategy`.

**Tests (full):** mock `useKeywordStrategy` localSync states → assert show/hide across (non-local | strategyStaleVsLocal true | false); dismiss hides it; CTA calls generate.
- [ ] FAIL → implement → PASS → commit `feat(keyword-strategy): reverse staleness nudge`.

---

## Final verification (before PR)

- [ ] `npm run typecheck` → 0
- [ ] `npm run build` → ok
- [ ] `npx tsx scripts/pr-check.ts` → all automated checks pass (esp. route-contract annotations, inline query-key, ws-invalidation, raw-button/gradient, color laws)
- [ ] Targeted suites green: `tests/unit/local-strategy-sync.test.ts`, `tests/unit/local-strategy-chain.test.ts`, the new component tests, plus the touched `useLocalSeo` / keyword-strategy read tests.
- [ ] No orphan 13xxx ports before commit/push.
- [ ] Adversarial review (subagent-driven two-stage per task; final scaled review of the branch) → fix confirmed findings.
- [ ] PR to **staging** only; staging→main is the owner's step.

## Self-review (run against the spec — done at plan write)

- **Spec coverage:** comparator (0.3) ✓; forward smart prompt (3.2/3.3) ✓; Full-refresh button (3.3) ✓; combined action server chain w/ abort-on-fail + degraded-proceeds (2.2) ✓; reverse nudge (4.1) ✓; staleness rule missing|stale|markets_changed (0.3) ✓; non-local untouched (asserted in 0.3, 1.1, 3.3, 4.1) ✓; no new tables ✓; status-on-existing-read (1.1) ✓; WS refresh of the read (1.2) ✓.
- **Type consistency:** `LocalStrategySyncStatus` / `localNeedsRefreshReason` union / `thenRegenerateStrategy` used identically across types, comparator, route, chain, hooks, components.
- **Placeholder scan:** no impl-body placeholders by design (contract+test-centric per owner preference); every task has a concrete contract + concrete test + resolved anchors + acceptance command. The handful of "confirm at execution" notes are stale-grounding guards on line anchors, not missing decisions.
