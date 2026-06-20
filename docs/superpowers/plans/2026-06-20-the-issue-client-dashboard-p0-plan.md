# The Issue — Client Dashboard P0 Implementation Plan

> **Status:** Implementation plan — **review gate before any code.** **Date:** 2026-06-20. **Scope:** P0 only (the trust spine on GA4 estimates), one PR. Built from the [client re-design spec](../specs/2026-06-20-the-issue-client-redesign-design.md), which was built from the [client-discovery panel](../specs/2026-06-20-the-issue-client-discovery-spec.md). P1 (push/export/local insert/segment competitor) and the integration-dependent reconciliation are roadmapped, not in this plan. A separate **cutover + teardown** phase (remove the legacy Overview + Briefing-v2 variants, collapse the flags) follows after P0 proves out on staging.
> For agentic workers: REQUIRED SUB-SKILL — `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Every step is a `- [ ]` checkbox. Each task is strict TDD (write failing test → run RED → minimal implement → run GREEN → commit). Read-before-write every cross-module contract: re-read the actual `shared/types/*.ts` interface before consuming it — guessed field names are the #1 silent-data-loss bug in this codebase.

**Goal.** Invert the client "The Issue" dashboard from a 0–100 vanity-ring/content-plan hero into a verdict-first trust spine that leads with a dollarized, baseline-anchored, GA4-grounded outcome verdict — shipped entirely behind one master feature flag so flag-OFF is byte-identical to today.

**Architecture.** A net-new GA4 conversion-snapshot substrate (daily cron, 90-day rolling history + a never-pruned engagement-start anchor at `workspace.createdAt`) feeds an additive `ROIData.outcomeVerdict` block hydrated by `computeROI()` only when both pinned GA4 conversions and a per-workspace `outcomeValue` exist; the client surface (`TheIssueClientPage`) re-sequences to verdict → outcome count → money frame → needs-me → content plan → under-the-hood, with a new `IssueVerdictHeadline` (no ring) + `OutcomeCountBand`, all gated by `the-issue-client-spine`. Every new field is optional/additive and unread on the OFF path; the verdict sentence and all numbers are server-assembled and ride the public `/api/public/roi` payload (the client never re-derives them).

**Tech stack.** React 19 + Vite 8 + TailwindCSS 4 + React Router DOM 7 (frontend); Express + TypeScript + better-sqlite3 (backend); Zod v3 validation; Pino logging; `callAI()` unified dispatcher; Vitest (unit/integration/component) + Playwright (DOM probe). GA4 via `getGA4Conversions()`; feature flags via `FEATURE_FLAGS`/`FEATURE_FLAG_CATALOG`.

---

## Task Dependency Graph

```
                  ┌─────────────────────────────────────────────┐
                  │  PRE-DISPATCH COMMIT (single commit, FIRST)  │
                  │  Lane A (A1–A10, the shared contracts +      │
                  │  data substrate) + D0 (flag family)          │
                  │  + D2 (shared-type contract test)            │
                  └───────────────────────┬─────────────────────┘
                                          │ (all contracts frozen & committed)
                          ┌───────────────┴───────────────┐
                          ▼                                ▼
            ┌──────────────────────────┐    ┌──────────────────────────┐
            │  Lane B (parallel)       │    │  Lane C (parallel)       │
            │  verdict/outcome/money   │    │  evergreen split +       │
            │  spine UI + reorder +    │    │  eventConfig/segment     │
            │  flag wiring             │    │  wiring + admin inputs   │
            └─────────────┬────────────┘    └────────────┬─────────────┘
                          │   (B and C share ZERO files;  │
                          │    OverviewTab edit reconciled │
                          │    once at the checkpoint)     │
                          └───────────────┬───────────────┘
                                          ▼
                          ┌──────────────────────────────┐
                          │  DIFF-REVIEW CHECKPOINT       │
                          │  (git diff, grep dupes, tsc,  │
                          │   full vitest, scaled review) │
                          └───────────────┬───────────────┘
                                          ▼
                          ┌──────────────────────────────┐
                          │  Lane D (finalize)            │
                          │  D1,D3,D4,D5,D6,D7 — the      │
                          │  RED acceptance tests + the   │
                          │  flag-OFF DOM-probe harness   │
                          │  turn GREEN against A/B/C     │
                          └──────────────────────────────┘
```

**Sequencing rules (mandatory):**
1. **Lane A + D0 + D2 are ONE pre-dispatch contract commit.** Per the project's "pre-commit shared contracts before dispatch" rule, no parallel lane starts until every type, flag, column, mapper, resolver, and the `outcomeVerdict` hydration are committed and `npm run typecheck && npx vite build && npx vitest run` are green.
2. **Lanes B and C run in parallel** against the frozen Lane A surface. They share **zero owned files**. The single shared touchpoint — `src/components/client/OverviewTab.tsx` (prop-thread edit) — is owned by **Lane B**; if Lane C needs a sibling edit there, it is reconciled once at the diff-review checkpoint (never two independent edits).
3. **Lane D finalizes.** D1/D3/D4/D5/D6/D7 are written RED-first (they pin acceptance) and turn GREEN as A/B/C land. D7 (the flag-OFF DOM-probe baseline) must be **captured on pre-redesign HEAD before Lane C touches `TheIssueClientPage.tsx`**.
4. **Phase-per-PR.** This entire plan is P0 — one PR. The P1 child flags are *declared* (so the flag family/group is stable) but stay OFF and unread. Do not open P1 work until P0 is merged to `staging` and green.

---

## File Ownership (exclusive — no two lanes edit the same file)

### Lane A (shared contracts + data substrate) — owns:
- `shared/types/outcome-tracking.ts` (add `OutcomeProvenance`)
- `shared/types/the-issue.ts` (NEW — `IssueVerdict`, `IssueOutcomeCount`, `OutcomeBaseline`, `Ga4ConversionSnapshot`)
- `shared/types/workspace.ts` (add `ClientSegment`, `SegmentConfig`, `ResolvedSegmentProfile`, `Workspace.outcomeValue`, `Workspace.segmentConfig`)
- `shared/types/roi.ts` (add `ROIData.outcomeVerdict`)
- `server/db/migrations/146-ga4-conversion-snapshots.sql`, `147-workspace-segment-config.sql` (NEW)
- `server/ga4-snapshots.ts`, `server/the-issue-outcome.ts`, `server/the-issue-lead-value-ai.ts`, `server/ga4-conversion-snapshot-scheduler.ts` (NEW)
- `server/workspaces.ts` (`WorkspaceRow`, `rowToWorkspace`, `workspaceToParams`, `columnMap`, add `resolveSegmentProfile`)
- `server/schemas/workspace-schemas.ts` (add `outcomeValueSchema`, `segmentConfigSchema`)
- `server/ai-operation-registry.ts` (add `the-issue-lead-value-enrich` op)
- `server/roi.ts` (extend `computeROI()` with `outcomeVerdict`)
- `server/serializers/client-safe.ts` (`PublicWorkspaceView` + body — add `segmentProfile`, flag-gated)
- `server/startup.ts` (register the snapshot cron)
- Lane A's own test files (see tasks)

> **Lane A pre-commits these as the shared contract; D0 (`shared/types/feature-flags.ts`) and D2 (`tests/contract/the-issue-types.test.ts`) are committed in the same pre-dispatch commit.** `server/routes/stripe.ts:63-66` (public ROI route) gets one inline comment from Lane A; the `/api/public/workspace/:id` route caller is updated by Lane A to pass the flag to `toPublicWorkspaceView`.

### Lane B (verdict/outcome/money spine UI) — owns:
- `src/components/client/the-issue/IssueVerdictHeadline.tsx` (NEW)
- `src/components/client/the-issue/OutcomeCountBand.tsx` (NEW)
- `src/components/client/the-issue/TheIssueClientPage.tsx` (reorder + flag wiring + segment toggles)
- `src/components/client/ROIDashboard.tsx` (`compact` prop + lead-value frame + methodology prose edit)
- `src/utils/formatNumbers.ts` (add `fmtEstimateMoney`, `fmtEstimateRatio`)
- `src/components/client/OverviewTab.tsx` (**the single Lane-B-owned shared edit** — flag read + prop thread)
- Lane B's own test files

### Lane C (evergreen split + eventConfig/segment wiring + admin inputs) — owns:
- `src/components/client/the-issue/evergreenCopy.ts` (two-zone split + `baselineVerdict()`)
- `src/components/client/the-issue/outcomeNoun.ts` (NEW — shared eventConfig helpers)
- `src/components/ClientDashboard.tsx` (rewire the inline helpers to the shared module — pure refactor, behavior-identical)
- `src/components/settings/ClientDashboardTab.tsx` (admin `Outcome value` + segment subsections)
- `server/segment-derivation.ts`, `server/routes/the-issue-admin.ts` (NEW)
- `server/ai-operation-registry.ts` → **NO**: see drift resolution below. Lane C does **not** touch the AI registry; the single AI-enrich operation lives in Lane A.
- `server/routes/workspaces.ts` (PATCH boundary validation for `outcomeValue`/`segmentConfig`)
- `server/workspaces.ts` → **NO**: Lane A owns this file. Lane C's `updateWorkspace` Pick-union widening is **pre-committed by Lane A** (see drift resolution).
- Lane C's own test files

### Lane D (flag + tests + verification) — owns:
- `shared/types/feature-flags.ts` (flag family + catalog + group) — **pre-committed with Lane A**
- `tests/unit/the-issue-client-flags.test.ts` (NEW)
- `tests/contract/the-issue-types.test.ts` (NEW) — committed with Lane A
- `tests/integration/the-issue-client-roi-public.test.ts` (NEW)
- `tests/integration/ga4-conversion-snapshot.test.ts` (NEW)
- `tests/component/IssueVerdictHeadline.test.tsx`, `tests/component/the-issue-spine-order.test.tsx` (NEW)
- `scripts/verify/the-issue-flag-off-domprobe.ts` (NEW)
- Extends `tests/unit/the-issue-evergreen-copy.test.ts` (the two-zone assertions)

### Shared-file resolution table (every file touched by >1 draft is resolved here)

| File | Resolved owner | Reason |
|---|---|---|
| `shared/types/feature-flags.ts` | **Lane D (pre-committed with A)** | One flag family; declared once in the contract commit. B/C only *consume* `'the-issue-client-spine'` via `useFeatureFlag`. |
| `shared/types/outcome-tracking.ts` (`OutcomeProvenance`) | **Lane A** | Drafts A and B both proposed it; A owns. B/C/D import. |
| `shared/types/the-issue.ts` | **Lane A** | B's "B0 stub" is **deleted** from this plan — Lane A's commit lands first (pre-dispatch), so no stub is ever needed. |
| `src/components/client/the-issue/evergreenCopy.ts` | **Lane C** | Drafts B, C, and D all rewrote it. **Lane C is sole owner.** Lane D writes the RED assertions in `tests/unit/the-issue-evergreen-copy.test.ts`; Lane C makes them green. Lane B imports `baselineVerdict`/`hasTemporalLanguage` but does not edit the file. |
| `src/components/settings/ClientDashboardTab.tsx` | **Lane C** | |
| `src/components/ClientDashboard.tsx` | **Lane C** | The inline helper extraction. |
| `src/components/client/OverviewTab.tsx` | **Lane B** | Single prop-thread edit. |
| `server/workspaces.ts` | **Lane A** | All edits (row/mapper/params/columnMap/`resolveSegmentProfile`, **and the `updateWorkspace` Pick-union widening for `outcomeValue`/`segmentConfig`**) are pre-committed by Lane A. |
| `server/schemas/workspace-schemas.ts` | **Lane A** | `outcomeValueSchema`/`segmentConfigSchema` defined once (Lane A). Lane C imports them in the PATCH route. |
| `server/ai-operation-registry.ts` | **Lane A** | **Single registry entry: `the-issue-lead-value-enrich`** (see AI-op drift resolution). Lane A owns; Lane C's `server/segment-derivation.ts` consumes it. |
| `server/routes/workspaces.ts` | **Lane C** | PATCH boundary validation. |

---

## Model Assignments per lane

| Lane | Model | Rationale |
|---|---|---|
| **Lane A — A1–A4 (enum, types, migration, snapshot store)** | **Sonnet** (Codex: GPT-5.4-Mini→GPT-5.4) | Mechanical type/migration/mapper work against verified shapes. |
| **Lane A — A5–A10 (resolver, GA4 aggregation, AI op, cron, computeROI, public lockstep)** | **Opus** (Codex: GPT-5.4→GPT-5.5) | Cross-context judgment: segment resolution authority chain, baseline anchoring, additive `computeROI` extension without breaking legacy, public-serialization lockstep. |
| **Lane B — B1, B2 (formatters, evergreen consumed)** | **Sonnet** | Pure functions + token-grounded JSX. |
| **Lane B — B3–B6 (components + spine reorder + flag gating)** | **Opus** | The flag-OFF byte-identical reorder is the highest-risk judgment call (a silent layout regression passes all four code gates). |
| **Lane C — C1, C2, C3 (evergreen split, baselineVerdict, eventConfig helper)** | **Sonnet** | Mechanical regex/zone logic + helper extraction. |
| **Lane C — C4, C5, C6 (Zod write-path, admin UI, AI advisory ops)** | **Opus** (Codex: GPT-5.4→GPT-5.5) | Trust-guard semantics (advisory-never-persists, basis precedence, auth conventions). |
| **Lane D — D0, D1, D2 (flag, evergreen RED, contract test)** | **Sonnet** | Catalog mechanics + assertion authoring. |
| **Lane D — D3, D4, D5, D6, D7 (public read-path, snapshot, components, DOM probe)** | **Opus** | Acceptance-criteria authorship + the mandatory real-browser flag-OFF proof. |
| **Final integration + scaled-code-review** | **Opus** | Multi-agent batch → `scaled-code-review` skill is mandatory (Quality Gates). |

---

## Cross-lane drift resolutions (canonical names — identical everywhere)

These were divergent across the four drafts. The canonical form below is now used in every task:

1. **Two-zone evergreen export names.** Drafts B/C/D each invented different constant names (`BANNED_EVERYWHERE` vs `ROLLING_WINDOW_PATTERNS`; `BANNED_PLAN_ONLY` vs `PLAN_RELATIVE_PATTERNS`; `baselineVerdict` arg `outcomeNounPlural` vs `outcomeNoun`). **Canonical (Lane C owns, Lane D pins):**
   - `ROLLING_WINDOW_PATTERNS` (banned in both zones)
   - `BANNED_TEMPORAL_PATTERNS` (preserved superset = rolling + plan-only; back-compat for the pr-check static twin + existing tests)
   - `ALLOWED_BASELINE_PATTERNS` (verdict-zone anchors)
   - `hasTemporalLanguage(text: string, zone: 'plan' | 'verdict' = 'plan'): boolean`
   - **`hasBaselineAnchor(text: string): boolean`** (the inverse-law helper — Draft C's name; Lane D's D1 asserts the inverse law via `hasTemporalLanguage(text, 'verdict')` returning `true` for a dateless verdict).
   - **`baselineVerdict(args: { outcomeNoun: string; current: number; baseline: number | null }): string`** — arg is **`outcomeNoun`** (Draft C). Lane B passes `verdict.outcomeUnitLabel` into `outcomeNoun`.
   - **Inverse-law semantics:** `hasTemporalLanguage(text, 'verdict')` returns `true` (violation) when the text contains a rolling window **OR** carries no `ALLOWED_BASELINE_PATTERNS` anchor. This is the single agreed definition; D1 and C1 tests assert it identically.

2. **`fmtEstimate` surface.** Draft A1/A10 referenced a single `fmtEstimate()`; Draft B split it into two. **Canonical:** two named exports `fmtEstimateMoney(value)` and `fmtEstimateRatio(ratio)` in `src/utils/formatNumbers.ts` (Lane B owns). Any prose referring to "`fmtEstimate()`" means this pair.

3. **AI operations.** Draft A7 registered `the-issue-lead-value-enrich`; Draft C6 registered two ops (`the-issue-segment-derive` + `the-issue-outcome-value-enrich`). **Canonical for P0:** exactly **one** registry entry, **`the-issue-lead-value-enrich`** (Lane A owns), used by the outcome-value AI-enrich fallback. The **non-local segment derivation is P1** (its flag `the-issue-client-segment-inserts` is declared OFF) — therefore the segment-derivation route and its op are **deferred out of P0**. Lane C's C6 in P0 is reduced to: the admin **segment confirm/override** UI (reads the deterministic local/multi seed from `resolveSegmentProfile` via the public view; the non-local 3-way is a manual `FormSelect` the admin sets, persisted as `segmentConfig`). The "Propose with AI" affordance and `server/routes/the-issue-admin.ts` segment-proposal endpoint are **P1, not built in P0**. The outcome-value AI-enrich endpoint (`POST /api/workspaces/:id/outcome-value-enrich`) **is** P0 (Lane C route, calling Lane A's `enrichLeadValue` from `server/the-issue-lead-value-ai.ts`).

4. **GA4 snapshot module + function names.** Draft A used `server/ga4-snapshots.ts` with `saveGa4Snapshot`/`loadGa4SnapshotHistory`/`getEarliestGa4Snapshot`; Draft D used `server/ga4-conversion-snapshots.ts` with `saveGa4ConversionSnapshot`/`loadGa4ConversionHistory`/`computeOutcomeBaseline`. **Canonical (Lane A owns):**
   - Module: **`server/ga4-snapshots.ts`**
   - `saveGa4Snapshot(snap: Ga4ConversionSnapshot): void`
   - `loadGa4SnapshotHistory(workspaceId: string): Ga4ConversionSnapshot[]`
   - `getEarliestGa4Snapshot(workspaceId: string): Ga4ConversionSnapshot | null`
   - Baseline + aggregation live in **`server/the-issue-outcome.ts`**: `aggregatePinnedOutcomes(ws, byEvent)`, `computeOutcomeBaseline(ws)`, `ensureEngagementAnchor(ws)`, `backfillGa4SnapshotsFromHistory(ws)`.
   - **Lane D's D3/D4 tests import these exact names.** (D's earlier draft used `server/ga4-conversion-snapshots.ts`/`saveGa4ConversionSnapshot` — those are corrected to the canonical names throughout D3/D4 below.)

5. **`saveGa4Snapshot` signature.** Canonical: **`saveGa4Snapshot(snap: Ga4ConversionSnapshot)`** (single object arg, `snap.workspaceId` inside). D4's `saveGa4ConversionSnapshot(wsId, {...})` two-arg form is replaced by `saveGa4Snapshot({ workspaceId: wsId, ...})`.

6. **Migration numbers.** Canonical: `146-ga4-conversion-snapshots.sql` and `147-workspace-segment-config.sql` (the `147` migration adds **both** `segment_config TEXT` and `outcome_value TEXT` columns). Lane D's D4 reference to "`0NN-`" resolves to `146`.

7. **Public segment field name.** Draft B/A used `segmentProfile`; Draft D used `resolvedSegmentProfile`. **Canonical: `segmentProfile`** on `PublicWorkspaceView`. D3's companion assertion uses `segmentProfile`.

8. **Spine flag prop name into `TheIssueClientPage`.** Draft B read the flag internally via `useFeatureFlag('the-issue-client-spine')`; Draft D passed a `theIssueClientSpine` boolean prop. **Canonical:** `TheIssueClientPage` reads the flag via **`useFeatureFlag('the-issue-client-spine')` internally** (Rules-of-Hooks-safe, unconditional at top), AND accepts an optional `theIssueClientSpine?: boolean` prop that, when provided, **overrides** the hook (for deterministic component tests). Implementation: `const spineEnabled = theIssueClientSpine ?? useFeatureFlag('the-issue-client-spine');` → **NO** (conditional hook). Correct: `const flagValue = useFeatureFlag('the-issue-client-spine'); const spineEnabled = theIssueClientSpine ?? flagValue;`. D6 passes `theIssueClientSpine`; B6's own tests mock `useFeatureFlag`.

9. **`data-testid` markers on slots (D6 contract).** Canonical, set by Lane B in B6: `the-issue-client-page` (root), `slot-verdict` (IssueVerdictHeadline wrapper — note: B3 also sets `issue-verdict-headline` on the component's own `<section>`; both exist, `slot-verdict` is the page-level wrapper), `slot-outcome-count`, `slot-money` (the slot-3 ROIDashboard wrapper), `slot-content-plan` (the IssueContentPlanSection wrapper). Lane D's D6 mocks `ROIDashboard` and tags the stub `slot-money`; Lane B must wrap the real slot-3 ROIDashboard in `<div data-testid="slot-money">`.

---

## Per-phase Acceptance Criteria (pulled from spec)

A phase is **not done** until every box is checkable with evidence:

- [ ] **Verdict leads with dollar + baseline.** Slot 1 (`IssueVerdictHeadline`) renders `fmtEstimateMoney(estimatedValue)` and the baseline-anchored sentence (`up from N when we started`) ABOVE everything except the action strip. (D5, B3)
- [ ] **Ring not in the headline.** No `MetricRing` is imported or rendered by `IssueVerdictHeadline`; the 0–100 ring no longer appears in any client headline. The ring survives only under the collapsed "Under the hood". (D5, B3, B6)
- [ ] **Content demoted.** The content plan renders BELOW the proof/money band (slot 5), not as the hero; no `<details>` wraps the money frame on the flag-ON path. (D6, B6)
- [ ] **Flag-OFF byte-identical.** With `the-issue-client-spine` OFF, `TheIssueClientPage` DOM equals pre-redesign HEAD (ring headline, plan-as-hero, collapsed `<details>` "See full report"); proven by the real-browser DOM probe (D7) AND the component-level flag-OFF tests (B6, D6). (D7, B6, D6)
- [ ] **Segment toggles.** Slot inserts read from `ResolvedSegmentProfile` (`showCompetitorAuthority`/`showLocalMapAndReviews`/`showPortfolioRollup`); `local_smb` hides competitor, surfaces local. (B6, A5)
- [ ] **Outcome from pinned `eventConfig`.** Outcome count/verdict sum ONLY pinned `eventConfig` events, labeled by `displayName`; fall back to all key-events when none pinned. (A6, C3, B4)
- [ ] **Evergreen two-zone contract.** Verdict zone allows the engagement-start anchor and a dateless verdict FAILS CI (inverse law); plan zone bans all temporal phrasing; rolling windows banned everywhere. (C1, C2, D1)
- [ ] **Provenance = `estimate_ga4` at P0.** Every outcome/money number carries `provenance: 'estimate_ga4'`; estimates render banded (`~$11,000`, `~7×`), never two-decimal precision; named-record reconciliation (`actual_reconciled`) is P1 and absent from the public payload. (A9, B1, D3)
- [ ] **Public read-path lockstep.** `outcomeVerdict` flows through `GET /api/public/roi` only when the flag is ON + `outcomeValue` set + GA4 conversions exist; integration test exercises the **public** route, not admin. (A10, D3)
- [ ] **All quality gates green.** `typecheck`, `vite build`, `vitest run` (full suite), `pr-check`, `verify:feature-flags`, `verify:coverage-ratchet`. (Verification section)

---

# Lane A — Shared contracts + data substrate (DEPENDENCY ROOT — committed FIRST, with D0 + D2)

Nothing in Lane A renders anything client-facing; every new field is additive/optional and unread on the flag-OFF path. Lane A depends only on verified existing exports: `computeEffectiveTier` (`server/workspaces.ts:59`), `getClientLocations` (`server/client-locations.ts:103`), `getGA4Conversions` (`server/google-analytics.ts:438`), `computeGrowthPercent`/`saveSnapshot`/`createStmtCache` (`server/roi.ts:29-79`), `callAI` + `AI_OPERATION_REGISTRY` (`server/ai.ts`, `server/ai-operation-registry.ts`).

**Intra-lane sequence:** A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9 → A10. (A2 depends A1; A3 depends A1; A5 depends A3+A4; A6 depends A1+A4; A7 depends A1; A8 depends A6; A9 depends A1+A6; A10 depends A9+A5.)

### Task A1 — `OutcomeProvenance` enum + the `the-issue-client-*` flag family
> This task is fused with **Lane D's D0** — the flag declaration lives in D0 (Lane D owns `feature-flags.ts`), and the `OutcomeProvenance` enum lives here. They are committed together as the pre-dispatch contract. See D0 for the full flag/catalog/group implementation and `tests/unit/the-issue-client-flags.test.ts`.

**Files:** Modify `shared/types/outcome-tracking.ts` (after the `EarlySignal`/`BaselineSnapshot` block); add `tests/unit/outcome-provenance.test.ts`.

- [ ] **Write failing test** `tests/unit/outcome-provenance.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { OutcomeProvenance } from '../../shared/types/outcome-tracking.js';

describe('OutcomeProvenance enum', () => {
  it('admits exactly the two phased provenance values', () => {
    const p0: OutcomeProvenance = 'estimate_ga4';
    const p1: OutcomeProvenance = 'actual_reconciled';
    expect([p0, p1]).toEqual(['estimate_ga4', 'actual_reconciled']);
  });
});
```
- [ ] **Run** `npx vitest run tests/unit/outcome-provenance.test.ts` → **FAIL**.
- [ ] **Implement** in `shared/types/outcome-tracking.ts`:
```ts
/**
 * Single confidence/provenance source carried on EVERY client-facing outcome and money number
 * across The Issue client surface. P0 hard-codes 'estimate_ga4'; P1 graduates to
 * 'actual_reconciled' once named records reconcile the count. The render contract derives the
 * human "estimate" label + rounding precision from this field — see fmtEstimateMoney/Ratio (Lane B).
 */
export type OutcomeProvenance =
  | 'estimate_ga4'        // GA4 key-event aggregate × client lead value. Renders an "estimate" label.
  | 'actual_reconciled';  // Reconciled to call-tracking / CRM / form capture. Renders "actual".
```
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit** (with D0): `feat(the-issue-client): OutcomeProvenance enum + the-issue-client-* flag family (P0 contracts)`

### Task A2 — Net-new client payload types (`shared/types/the-issue.ts`)
> `OutcomeBaseline` is workspace/engagement-start-anchored — intentionally distinct from the per-action `BaselineSnapshot` in `outcome-tracking.ts`. Do not conflate.

**Files:** Create `shared/types/the-issue.ts`; create `tests/unit/the-issue-types.test.ts`.

- [ ] **Write failing test** `tests/unit/the-issue-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { IssueVerdict, IssueOutcomeCount, OutcomeBaseline } from '../../shared/types/the-issue.js';
import type { OutcomeProvenance } from '../../shared/types/outcome-tracking.js';

describe('the-issue client payload types', () => {
  it('IssueVerdict carries the single provenance field', () => {
    const prov: OutcomeProvenance = 'estimate_ga4';
    const v: IssueVerdict = {
      outcomeNoun: 'new patients', current: 14, baseline: 6, priorPeriod: 9,
      unit: 'count', sentence: '14 new patients, up from 6 when we started', provenance: prov,
    };
    expect(v.provenance).toBe('estimate_ga4');
    expect(v.unit).toBe('count');
  });
  it('IssueOutcomeCount exposes per-unit dual baselines + namedRecordsAvailable honesty flag', () => {
    const c: IssueOutcomeCount = {
      units: [{ label: 'calls', current: 8, baseline: 3, priorPeriod: 5, eventName: 'phone_call' }],
      provenance: 'estimate_ga4', namedRecordsAvailable: false,
    };
    expect(c.namedRecordsAvailable).toBe(false);
    expect(c.units[0].eventName).toBe('phone_call');
  });
  it('OutcomeBaseline is engagement-anchored with establishing/ready states', () => {
    const b: OutcomeBaseline = {
      engagementStart: '2026-01-01T00:00:00.000Z', baselineConversions: null,
      baselineCapturedAt: null, state: 'establishing',
    };
    expect(b.state).toBe('establishing');
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** `shared/types/the-issue.ts`:
```ts
// shared/types/the-issue.ts — client-facing verdict/outcome/baseline payload contracts (P0).
import type { OutcomeProvenance } from './outcome-tracking.js';
export type { OutcomeProvenance } from './outcome-tracking.js';

export interface IssueVerdict {
  outcomeNoun: string;            // per-segment, e.g. 'new patients' | 'qualified leads'
  current: number;                // current-period outcome value (count or dollars)
  baseline: number | null;        // same metric at workspace.createdAt; null until baseline exists
  priorPeriod: number | null;     // previous comparable period; null when unavailable
  unit: 'count' | 'dollars';
  sentence: string;               // plain-English, pre-templated server-side
  provenance: OutcomeProvenance;  // 'estimate_ga4' (P0) | 'actual_reconciled' (P1)
}

export interface IssueOutcomeCount {
  units: {
    label: string;                // 'calls' | 'form fills' | 'demos' | …
    current: number;
    baseline: number | null;
    priorPeriod: number | null;
    eventName?: string;           // GA4 key-event backing this unit (P0)
  }[];
  provenance: OutcomeProvenance;
  namedRecordsAvailable: boolean; // false at P0 → render the honest upsell affordance
}

export interface OutcomeBaseline {
  engagementStart: string;            // workspace.createdAt — fixed, never shifts
  baselineConversions: number | null; // earliest snapshot at/after engagementStart; null until enough history
  baselineCapturedAt: string | null;  // ISO of the snapshot used, for "vs. Jan" labeling + audit
  state: 'establishing' | 'ready';
}

/**
 * Backing table: ga4_conversion_snapshots (Task A4).
 * @remarks `rate` is already a percentage (e.g. 6.3 for 6.3%). Do NOT multiply by 100.
 */
export interface Ga4ConversionSnapshot {
  workspaceId: string;
  capturedAt: string;            // ISO; daily cron stamp
  totalConversions: number;
  totalUsers: number;
  byEvent: { eventName: string; conversions: number; users: number; rate: number }[];
}
```
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): IssueVerdict/IssueOutcomeCount/OutcomeBaseline/Ga4ConversionSnapshot types`

### Task A3 — `ClientSegment` + `SegmentConfig` + `ResolvedSegmentProfile` + `Workspace.outcomeValue`
> Added adjacent to `contentPricing` (`workspace.ts:352`) / `intelligenceProfile` (`:376`). Optional + additive → flag-OFF byte-identical. Mirror both new fields onto `AdminWorkspaceView`.

**Files:** Modify `shared/types/workspace.ts`; create `tests/unit/workspace-segment-types.test.ts`.

- [ ] **Write failing test** `tests/unit/workspace-segment-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { Workspace, ClientSegment, SegmentConfig, ResolvedSegmentProfile } from '../../shared/types/workspace.js';

describe('segment + outcomeValue workspace contracts', () => {
  it('ClientSegment admits the five spec segments', () => {
    const segs: ClientSegment[] = ['local_smb', 'b2b_saas', 'board_vc', 'professional_services', 'multi_location'];
    expect(segs).toHaveLength(5);
  });
  it('outcomeValue carries valuePerOutcome + basis precedence enum', () => {
    const ov: NonNullable<Workspace['outcomeValue']> = {
      valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500,
    };
    expect(ov.basis).toBe('agency_estimate');
  });
  it('ResolvedSegmentProfile pre-resolves boolean inserts + altitude', () => {
    const p: ResolvedSegmentProfile = {
      segment: 'local_smb', outcomeNounSingular: 'new patient', outcomeNounPlural: 'new patients',
      moneyFrameAltitude: 'production_vs_retainer', showCompetitorAuthority: false,
      showPortfolioRollup: false, showLocalMapAndReviews: true, exportProfile: 'sms_recap',
    };
    expect(p.showLocalMapAndReviews).toBe(true);
  });
  it('SegmentConfig.segment is the stored admin override', () => {
    const sc: SegmentConfig = { segment: 'b2b_saas', outcomeNounSingular: 'qualified lead' };
    expect(sc.segment).toBe('b2b_saas');
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** in `shared/types/workspace.ts`:
```ts
// Near the other exported unions (top of file):
export type ClientSegment =
  | 'local_smb'             // single-location service: calls/forms/bookings
  | 'b2b_saas'              // pipeline-led: leads/demos → pipeline $ → influenced revenue
  | 'board_vc'              // efficiency-led: organic CAC vs paid
  | 'professional_services' // authority-led: qualified inbound by title/firm
  | 'multi_location';       // portfolio/triage: roll-up + ranked needs-attention

export interface SegmentConfig {
  segment: ClientSegment;
  outcomeNounSingular?: string;   // admin override, e.g. "new patient"
  outcomeNounPlural?: string;     // "new patients"
  reportingAudience?: 'self' | 'board' | 'partners' | 'owners';
}

/** Single pre-resolved representation injected directly into the client surface (authority-layered-fields rule). */
export interface ResolvedSegmentProfile {
  segment: ClientSegment;
  outcomeNounSingular: string;
  outcomeNounPlural: string;
  moneyFrameAltitude: 'production_vs_retainer' | 'pipeline_ratio' | 'cac_vs_paid' | 'portfolio_cost_per_lead';
  showCompetitorAuthority: boolean;
  showPortfolioRollup: boolean;
  showLocalMapAndReviews: boolean;
  exportProfile: 'sms_recap' | 'board_one_pager' | 'partner_summary' | 'owner_portfolio' | null;
}
```
```ts
// On Workspace, after contentPricing (:352):
/** P0: per-workspace converted-outcome value powering the dollar verdict. Absent = count-only. */
outcomeValue?: {
  valuePerOutcome: number;
  unitLabel: string;                 // 'new patient' | 'qualified lead' | 'booking' …
  currency: string;                  // reuse contentPricing currency convention
  basis: 'client_provided' | 'agency_estimate' | 'ai_enriched';
  monthlyRetainer?: number;
};
// On Workspace, after intelligenceProfile (:376):
/** Backing column: segment_config (typed JSON, parseJsonSafe at read boundary). */
segmentConfig?: SegmentConfig;
```
Mirror onto `AdminWorkspaceView`: `outcomeValue?: Workspace['outcomeValue']; segmentConfig?: Workspace['segmentConfig'];`.
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): ClientSegment/SegmentConfig/ResolvedSegmentProfile + Workspace.outcomeValue types`

### Task A4 — `ga4_conversion_snapshots` migration + typed store (`server/ga4-snapshots.ts`)
> Models `roi_snapshots` (`server/roi.ts:52-61`). Migrations auto-discovered lexicographically; next free slot is **146**.

**Files:** Create `server/db/migrations/146-ga4-conversion-snapshots.sql`, `server/ga4-snapshots.ts`; create `tests/integration/ga4-snapshots.test.ts`.

- [ ] **Write failing test** `tests/integration/ga4-snapshots.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveGa4Snapshot, loadGa4SnapshotHistory, getEarliestGa4Snapshot } from '../../server/ga4-snapshots.js';

let ctx: Awaited<ReturnType<typeof createEphemeralTestContext>>;
let wsId: string; let cleanup: () => void;
beforeAll(async () => { ctx = await createEphemeralTestContext(import.meta.url); const s = seedWorkspace(); wsId = s.id; cleanup = s.cleanup; });
afterAll(async () => { cleanup(); await ctx.teardown(); });

describe('ga4_conversion_snapshots store', () => {
  it('round-trips a snapshot through the typed mapper (byEvent parsed via parseJsonSafeArray)', () => {
    saveGa4Snapshot({
      workspaceId: wsId, capturedAt: '2026-02-01T00:00:00.000Z',
      totalConversions: 14, totalUsers: 200,
      byEvent: [{ eventName: 'phone_call', conversions: 8, users: 100, rate: 4 }],
    });
    const hist = loadGa4SnapshotHistory(wsId);
    expect(hist).toHaveLength(1);
    expect(hist[0].byEvent[0].eventName).toBe('phone_call');
    expect(hist[0].totalConversions).toBe(14);
  });
  it('getEarliestGa4Snapshot returns the createdAt-anchored row for the baseline', () => {
    saveGa4Snapshot({ workspaceId: wsId, capturedAt: '2026-01-01T00:00:00.000Z', totalConversions: 6, totalUsers: 80, byEvent: [] });
    expect(getEarliestGa4Snapshot(wsId)?.totalConversions).toBe(6);
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement migration** `146-ga4-conversion-snapshots.sql`:
```sql
-- The Issue (Client) P0: daily GA4 key-event conversion snapshots, modeled on roi_snapshots.
-- One row per workspace per day; by_event holds the per-event breakdown (mirrors GA4ConversionSummary).
-- Back-anchored to workspace.createdAt so the baseline is "since we started," not "since first query."
CREATE TABLE IF NOT EXISTS ga4_conversion_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id      TEXT NOT NULL,
  captured_at       TEXT NOT NULL,
  total_conversions INTEGER NOT NULL,
  total_users       INTEGER NOT NULL,
  by_event          TEXT NOT NULL,       -- JSON: { eventName, conversions, users, rate }[]
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ga4_conv_snapshots_workspace ON ga4_conversion_snapshots(workspace_id, captured_at);
```
- [ ] **Implement** `server/ga4-snapshots.ts` — `createStmtCache`, `parseJsonSafeArray` for `by_event` (never bare `JSON.parse`), `rowToGa4Snapshot` mapper, 90-day prune mirroring `roi.ts:58-60`. Exports: `saveGa4Snapshot(snap)`, `loadGa4SnapshotHistory(workspaceId)`, `getEarliestGa4Snapshot(workspaceId)`. The earliest row is the durable engagement anchor and is read by `computeOutcomeBaseline` (A6); the 90-day prune cutoff is guarded so it never deletes the earliest anchor row.
```ts
import { z } from 'zod';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import type { Ga4ConversionSnapshot } from '../shared/types/the-issue.js';

const byEventSchema = z.object({
  eventName: z.string(), conversions: z.number(), users: z.number(), rate: z.number(),
}).passthrough();

interface Ga4SnapshotRow {
  id: number; workspace_id: string; captured_at: string;
  total_conversions: number; total_users: number; by_event: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO ga4_conversion_snapshots
       (workspace_id, captured_at, total_conversions, total_users, by_event)
     VALUES (@workspace_id, @captured_at, @total_conversions, @total_users, @by_event)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM ga4_conversion_snapshots WHERE workspace_id = ? ORDER BY captured_at ASC`,
  ),
  earliest: db.prepare(
    `SELECT * FROM ga4_conversion_snapshots WHERE workspace_id = ? ORDER BY captured_at ASC LIMIT 1`,
  ),
  pruneOld: db.prepare(
    // Prune rolling history older than the cutoff, but NEVER the earliest (anchor) row.
    `DELETE FROM ga4_conversion_snapshots
       WHERE workspace_id = ? AND captured_at < ?
         AND id <> (SELECT id FROM ga4_conversion_snapshots WHERE workspace_id = ? ORDER BY captured_at ASC LIMIT 1)`,
  ),
}));

function rowToGa4Snapshot(row: Ga4SnapshotRow): Ga4ConversionSnapshot {
  return {
    workspaceId: row.workspace_id,
    capturedAt: row.captured_at,
    totalConversions: row.total_conversions,
    totalUsers: row.total_users,
    byEvent: parseJsonSafeArray(row.by_event, byEventSchema, { workspaceId: row.workspace_id, field: 'by_event', table: 'ga4_conversion_snapshots' }),
  };
}

export function saveGa4Snapshot(snap: Ga4ConversionSnapshot): void {
  stmts().insert.run({
    workspace_id: snap.workspaceId, captured_at: snap.capturedAt,
    total_conversions: snap.totalConversions, total_users: snap.totalUsers,
    by_event: JSON.stringify(snap.byEvent),
  });
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  stmts().pruneOld.run(snap.workspaceId, cutoff, snap.workspaceId);
}

export function loadGa4SnapshotHistory(workspaceId: string): Ga4ConversionSnapshot[] {
  return (stmts().selectByWorkspace.all(workspaceId) as Ga4SnapshotRow[]).map(rowToGa4Snapshot);
}

export function getEarliestGa4Snapshot(workspaceId: string): Ga4ConversionSnapshot | null {
  const row = stmts().earliest.get(workspaceId) as Ga4SnapshotRow | undefined;
  return row ? rowToGa4Snapshot(row) : null;
}
```
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): ga4_conversion_snapshots table + typed store (saveGa4Snapshot/loadGa4SnapshotHistory/getEarliestGa4Snapshot)`

### Task A5 — `segment_config` + `outcome_value` column lockstep + `resolveSegmentProfile()` + `updateWorkspace` Pick widening
> Six-site lockstep (migration → `WorkspaceRow` → `rowToWorkspace` → type (done A3) → `workspaceToParams` → `columnMap`). `resolveSegmentProfile` mirrors `computeEffectiveTier`: deterministic local/multi via `getClientLocations().length`; non-local 3-way is advisory (read from admin-confirmed `segmentConfig`, safe non-local default otherwise). **Lane A also widens the `updateWorkspace` Pick union here** so Lane C's PATCH route can persist these fields.

**Files:** Create `server/db/migrations/147-workspace-segment-config.sql`; modify `server/workspaces.ts` (`WorkspaceRow`, `rowToWorkspace`, `workspaceToParams`, `columnMap`, `updateWorkspace` Pick, add `resolveSegmentProfile`); modify `server/schemas/workspace-schemas.ts` (`segmentConfigSchema`, `outcomeValueSchema`); create `tests/unit/resolve-segment-profile.test.ts`.

- [ ] **Write failing test** `tests/unit/resolve-segment-profile.test.ts` (uses ephemeral ctx + `seedWorkspace`; adapt `createClientLocation` to the actual insert helper in `server/client-locations.ts`):
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from '../integration/helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { resolveSegmentProfile, getWorkspace } from '../../server/workspaces.js';
import { createClientLocation } from '../../server/client-locations.js'; // adapt to real export

let ctx: Awaited<ReturnType<typeof createEphemeralTestContext>>; let wsId: string; let cleanup: () => void;
beforeAll(async () => { ctx = await createEphemeralTestContext(import.meta.url); const s = seedWorkspace(); wsId = s.id; cleanup = s.cleanup; });
afterAll(async () => { cleanup(); await ctx.teardown(); });

describe('resolveSegmentProfile', () => {
  it('one client_locations row → local_smb, local insert ON, competitor OFF', () => {
    createClientLocation({ workspaceId: wsId, name: 'Main St Dental', isPrimary: true });
    const p = resolveSegmentProfile(getWorkspace(wsId)!);
    expect(p.segment).toBe('local_smb');
    expect(p.showLocalMapAndReviews).toBe(true);
    expect(p.showCompetitorAuthority).toBe(false);
    expect(p.moneyFrameAltitude).toBe('production_vs_retainer');
  });
  it('two+ rows → multi_location with portfolio rollup ON', () => {
    createClientLocation({ workspaceId: wsId, name: 'Second Office', isPrimary: false });
    const p = resolveSegmentProfile(getWorkspace(wsId)!);
    expect(p.segment).toBe('multi_location');
    expect(p.showPortfolioRollup).toBe(true);
  });
  it('zero locations + admin-set segmentConfig=b2b_saas → competitor ON, pipeline_ratio', () => {
    const s2 = seedWorkspace();
    const ws = { ...getWorkspace(s2.id)!, segmentConfig: { segment: 'b2b_saas' as const } };
    const p = resolveSegmentProfile(ws);
    expect(p.segment).toBe('b2b_saas');
    expect(p.showCompetitorAuthority).toBe(true);
    s2.cleanup();
  });
  it('zero locations + no segmentConfig → safe non-local default (b2b_saas), never throws', () => {
    const s3 = seedWorkspace();
    const p = resolveSegmentProfile(getWorkspace(s3.id)!);
    expect(p.segment).toBe('b2b_saas');
    s3.cleanup();
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement migration** `147-workspace-segment-config.sql`:
```sql
-- The Issue (Client) P0/P1: typed-JSON segment classification + the dollar-verdict outcome value.
-- Both optional; absent = resolveSegmentProfile() falls back to deterministic location detection
-- or the safe non-local default. parseJsonSafe at the read boundary.
ALTER TABLE workspaces ADD COLUMN segment_config TEXT;
ALTER TABLE workspaces ADD COLUMN outcome_value TEXT;
```
- [ ] **Implement schemas** in `server/schemas/workspace-schemas.ts`:
```ts
export const outcomeValueSchema = z.object({
  valuePerOutcome: z.number().nonnegative(),
  unitLabel: z.string().min(1),
  currency: z.string().min(1),
  basis: z.enum(['client_provided', 'agency_estimate', 'ai_enriched']),
  monthlyRetainer: z.number().nonnegative().optional(),
}).passthrough();

export const segmentConfigSchema = z.object({
  segment: z.enum(['local_smb', 'b2b_saas', 'board_vc', 'professional_services', 'multi_location']),
  outcomeNounSingular: z.string().optional(),
  outcomeNounPlural: z.string().optional(),
  reportingAudience: z.enum(['self', 'board', 'partners', 'owners']).optional(),
}).passthrough();
```
- [ ] **Implement** `server/workspaces.ts`:
  - `WorkspaceRow`: add `segment_config: string | null;` and `outcome_value: string | null;`.
  - `rowToWorkspace`: parse both via `parseJsonSafe(row.segment_config, segmentConfigSchema, null, {...})` / `parseJsonSafe(row.outcome_value, outcomeValueSchema, null, {...})`, assign when non-null.
  - `workspaceToParams`: `segment_config: ws.segmentConfig ? JSON.stringify(ws.segmentConfig) : null,` and `outcome_value: ws.outcomeValue ? JSON.stringify(ws.outcomeValue) : null,`.
  - `columnMap`: `segmentConfig: 'segment_config', outcomeValue: 'outcome_value',`.
  - **`updateWorkspace` Pick union: add `'outcomeValue' | 'segmentConfig'`** to the existing union (alongside `'contentPricing' | … | 'intelligenceProfile'`).
  - Imports: add `segmentConfigSchema, outcomeValueSchema` to the schema import group; add `getClientLocations` from `./client-locations.js`; ensure `ClientSegment`/`ResolvedSegmentProfile` imported from `../shared/types/workspace.js`.
  - Add `resolveSegmentProfile` after `computeEffectiveTier` (`:66`):
```ts
const SEGMENT_DEFAULTS: Record<ClientSegment, Omit<ResolvedSegmentProfile, 'segment' | 'outcomeNounSingular' | 'outcomeNounPlural'>> = {
  local_smb:             { moneyFrameAltitude: 'production_vs_retainer',  showCompetitorAuthority: false, showPortfolioRollup: false, showLocalMapAndReviews: true,  exportProfile: 'sms_recap' },
  b2b_saas:              { moneyFrameAltitude: 'pipeline_ratio',          showCompetitorAuthority: true,  showPortfolioRollup: false, showLocalMapAndReviews: false, exportProfile: 'board_one_pager' },
  board_vc:              { moneyFrameAltitude: 'cac_vs_paid',             showCompetitorAuthority: true,  showPortfolioRollup: false, showLocalMapAndReviews: false, exportProfile: 'board_one_pager' },
  professional_services: { moneyFrameAltitude: 'pipeline_ratio',          showCompetitorAuthority: true,  showPortfolioRollup: false, showLocalMapAndReviews: false, exportProfile: 'partner_summary' },
  multi_location:        { moneyFrameAltitude: 'portfolio_cost_per_lead', showCompetitorAuthority: false, showPortfolioRollup: true,  showLocalMapAndReviews: true,  exportProfile: 'owner_portfolio' },
};

const DEFAULT_NOUN_SINGULAR: Record<ClientSegment, string> = {
  local_smb: 'lead', b2b_saas: 'qualified lead', board_vc: 'qualified lead',
  professional_services: 'qualified inquiry', multi_location: 'lead',
};

/**
 * Resolve the single client-facing segment profile (sibling to computeEffectiveTier).
 * Local axis is DETERMINISTIC + authoritative from client_locations count; the non-local 3-way
 * is ADVISORY — read from an admin-confirmed segmentConfig, defaulting to a safe non-local
 * segment (never a local noun) so a misclassification can't fabricate a verdict.
 */
export function resolveSegmentProfile(ws: Workspace): ResolvedSegmentProfile {
  const locationCount = getClientLocations(ws.id).length;
  let segment: ClientSegment;
  if (locationCount >= 2) segment = 'multi_location';
  else if (locationCount === 1) segment = 'local_smb';
  else segment = ws.segmentConfig?.segment ?? 'b2b_saas';
  const base = SEGMENT_DEFAULTS[segment];
  const singular = ws.segmentConfig?.outcomeNounSingular ?? ws.outcomeValue?.unitLabel ?? DEFAULT_NOUN_SINGULAR[segment];
  const plural = ws.segmentConfig?.outcomeNounPlural ?? `${singular}s`;
  return { segment, outcomeNounSingular: singular, outcomeNounPlural: plural, ...base };
}
```
- [ ] **Run** → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): segment_config + outcome_value column lockstep + resolveSegmentProfile() + updateWorkspace Pick widening`

### Task A6 — GA4 pinned-event aggregation + baseline anchor + historical backfill (`server/the-issue-outcome.ts`)
> Sum **pinned** `eventConfig` events only (`displayName` = outcome noun; fall back to all key-events when none pinned). Engagement anchor backfilled at `createdAt` via GA4 historical API; legacy fallback labeled, never throws.

**Files:** Create `server/the-issue-outcome.ts`; create `tests/integration/the-issue-outcome.test.ts`.

- [ ] **Write failing test** `tests/integration/the-issue-outcome.test.ts` (mock GA4 via `tests/mocks/google`; seed pinned `eventConfig` via `updateWorkspace`):
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { aggregatePinnedOutcomes, computeOutcomeBaseline } from '../../server/the-issue-outcome.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { updateWorkspace, getWorkspace } from '../../server/workspaces.js';

let ctx: Awaited<ReturnType<typeof createEphemeralTestContext>>; let wsId: string; let cleanup: () => void;
beforeAll(async () => {
  ctx = await createEphemeralTestContext(import.meta.url); const s = seedWorkspace(); wsId = s.id; cleanup = s.cleanup;
  updateWorkspace(wsId, { eventConfig: [
    { eventName: 'phone_call', displayName: 'Calls', pinned: true },
    { eventName: 'form_submit', displayName: 'Form fills', pinned: true },
    { eventName: 'scroll', displayName: 'Scroll', pinned: false },
  ] });
});
afterAll(async () => { cleanup(); await ctx.teardown(); });

describe('pinned-event outcome aggregation', () => {
  it('sums ONLY pinned eventConfig events and labels units by displayName', () => {
    const byEvent = [
      { eventName: 'phone_call', conversions: 8, users: 60, rate: 4 },
      { eventName: 'form_submit', conversions: 6, users: 40, rate: 3 },
      { eventName: 'scroll', conversions: 999, users: 900, rate: 50 },
    ];
    const agg = aggregatePinnedOutcomes(getWorkspace(wsId)!, byEvent);
    expect(agg.totalConversions).toBe(14);
    expect(agg.units.map(u => u.label)).toEqual(['Calls', 'Form fills']);
  });
  it('falls back to ALL key-events when no events are pinned', () => {
    const s2 = seedWorkspace();
    const agg = aggregatePinnedOutcomes(getWorkspace(s2.id)!, [{ eventName: 'x', conversions: 3, users: 3, rate: 1 }]);
    expect(agg.totalConversions).toBe(3);
    expect(agg.usedFallback).toBe(true);
    s2.cleanup();
  });
});

describe('engagement baseline anchor', () => {
  it('state=establishing with null baseline when no snapshot at/after createdAt', () => {
    const b = computeOutcomeBaseline(getWorkspace(wsId)!);
    expect(b.state).toBe('establishing');
    expect(b.baselineConversions).toBeNull();
  });
  it('state=ready, baselineConversions from earliest snapshot once one exists', () => {
    saveGa4Snapshot({ workspaceId: wsId, capturedAt: getWorkspace(wsId)!.createdAt, totalConversions: 6, totalUsers: 50, byEvent: [] });
    const b = computeOutcomeBaseline(getWorkspace(wsId)!);
    expect(b.state).toBe('ready');
    expect(b.baselineConversions).toBe(6);
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** `server/the-issue-outcome.ts`:
  - `aggregatePinnedOutcomes(ws, byEvent): { totalConversions: number; units: IssueOutcomeCount['units']; usedFallback: boolean }` — build a `Set` of pinned `eventName`s + `Map<eventName, displayName>` from `ws.eventConfig`. Sum `conversions` for pinned events into `units[]` (label = displayName, eventName preserved, `current` = conversions). When no events pinned, sum **all** `byEvent` and set `usedFallback: true`.
  - `computeOutcomeBaseline(ws): OutcomeBaseline` — `engagementStart = ws.createdAt`; read `getEarliestGa4Snapshot(ws.id)`. If null → `{ engagementStart, baselineConversions: null, baselineCapturedAt: null, state: 'establishing' }`; else `{ …, baselineConversions: earliest.totalConversions, baselineCapturedAt: earliest.capturedAt, state: 'ready' }`.
  - `ensureEngagementAnchor(ws): Promise<void>` (used by A8 + backfill) — if `getEarliestGa4Snapshot(ws.id)` exists, no-op. Else if `ws.ga4PropertyId`, call `getGA4Conversions(ws.ga4PropertyId, undefined, { startDate: ws.createdAt.slice(0,10), endDate: ws.createdAt.slice(0,10) })`, persist via `saveGa4Snapshot` stamped `capturedAt = ws.createdAt`. On GA4 error/empty (legacy beyond retention), try the earliest available date; wrap in try/catch + `log.warn`; **never throw** (FM-2 honest degradation).
  - `backfillGa4SnapshotsFromHistory(ws): Promise<void>` — thin wrapper that calls `ensureEngagementAnchor(ws)` (D4 imports this name).
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): pinned-event outcome aggregation + engagement baseline anchor + GA4 backfill`

### Task A7 — AI lead-value enrich as a named `callAI` operation (Zod-validated)
> `outcomeValue.basis` precedence `client_provided → agency_estimate → ai_enriched`. Named operation in `AI_OPERATION_REGISTRY` + Zod-validated output. This is the **single** AI op for P0 (segment derivation is P1).

**Files:** Modify `server/ai-operation-registry.ts`; create `server/the-issue-lead-value-ai.ts`; create `tests/integration/the-issue-lead-value-ai.test.ts`.

- [ ] **Write failing test** (mock AI via `tests/mocks/openai`; FM-2 error path):
```ts
import { describe, it, expect } from 'vitest';
import { isAIOperationId } from '../../server/ai-operation-registry.js';
import { enrichLeadValue } from '../../server/the-issue-lead-value-ai.js';

describe('the-issue-lead-value-enrich operation', () => {
  it('is registered in AI_OPERATION_REGISTRY', () => {
    expect(isAIOperationId('the-issue-lead-value-enrich')).toBe(true);
  });
  it('returns a Zod-validated estimate stamped basis=ai_enriched', async () => {
    const out = await enrichLeadValue({ workspaceId: 'ws_x', industry: 'B2B SaaS', currency: 'USD' });
    expect(out?.basis).toBe('ai_enriched');
    expect(out?.valuePerOutcome).toBeGreaterThan(0);
  });
  it('returns null (honest degradation) when the model output fails schema validation', async () => {
    const out = await enrichLeadValue({ workspaceId: 'ws_bad', industry: '', currency: 'USD' });
    expect(out).toBeNull();
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** registry contract `the-issue-lead-value-enrich` (mirror an existing JSON op's field set in `server/ai-operation-registry.ts`; `defaultProvider: 'openai'`, `defaultModel: 'gpt-5.4-nano'`, `outputMode: 'json'`, `researchMode: 'forbidden'`, `executionMode: 'sync-only'`, `defaultResponseFormat: { type: 'json_object' }`, `defaultMaxRetries: 2`, `defaultTimeoutMs: 20_000`). Implement `server/the-issue-lead-value-ai.ts` — `enrichLeadValue({ workspaceId, industry, currency }): Promise<{ valuePerOutcome: number; unitLabel: string; currency: string; basis: 'ai_enriched' } | null>` via `callAI({ operation: 'the-issue-lead-value-enrich', … })`, `parseAIJson` then `leadValueEnrichSchema.safeParse` (shape validation — `parseAIJson` is boundary cleanup only). On parse failure or AI error → `null`; the caller stamps nothing fabricated. `basis: 'ai_enriched'` is stamped in code, not by the model.
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): the-issue-lead-value-enrich named callAI operation + Zod contract`

### Task A8 — Daily GA4 conversion snapshot cron + startup wiring
> Mirrors `startRankTrackingScheduler` (`server/rank-tracking-scheduler.ts:103-121`): idempotent, `setTimeout(2m)` + `setInterval(DAILY_MS)`, iterates workspaces, persists via `saveGa4Snapshot`, calls `ensureEngagementAnchor`. Registered in `server/startup.ts`.

**Files:** Create `server/ga4-conversion-snapshot-scheduler.ts`; modify `server/startup.ts`; create `tests/integration/ga4-conversion-snapshot-cron.test.ts`.

- [ ] **Write failing test** — extract a testable `runGa4ConversionSnapshots()` (don't test timers); mock GA4 (the mock must expose `setConversions`/`setError`/`reset` — extend `tests/mocks/google` if absent):
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { runGa4ConversionSnapshots } from '../../server/ga4-conversion-snapshot-scheduler.js';
import { loadGa4SnapshotHistory } from '../../server/ga4-snapshots.js';
import { updateWorkspace } from '../../server/workspaces.js';

let ctx: Awaited<ReturnType<typeof createEphemeralTestContext>>; let wsId: string; let cleanup: () => void;
beforeAll(async () => { ctx = await createEphemeralTestContext(import.meta.url); const s = seedWorkspace(); wsId = s.id; cleanup = s.cleanup;
  updateWorkspace(wsId, { ga4PropertyId: '123456' }); });
afterAll(async () => { cleanup(); await ctx.teardown(); });

it('persists one snapshot row per GA4-connected workspace per pass', async () => {
  await runGa4ConversionSnapshots();
  expect(loadGa4SnapshotHistory(wsId).length).toBeGreaterThanOrEqual(1);
});
it('skips (no throw) a workspace whose GA4 call errors — FM-2 honest degradation', async () => {
  const s2 = seedWorkspace(); updateWorkspace(s2.id, { ga4PropertyId: 'GA4_ERROR' });
  await expect(runGa4ConversionSnapshots()).resolves.not.toThrow();
  s2.cleanup();
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** `server/ga4-conversion-snapshot-scheduler.ts` — `runGa4ConversionSnapshots()` loops `listWorkspaces()`, skips those without `ga4PropertyId`, calls `getGA4Conversions(ws.ga4PropertyId, 1)`, maps `GA4ConversionSummary[]` → `Ga4ConversionSnapshot` (`totalConversions = Σ conversions`, `byEvent` = the summary array, `totalUsers` from the summary), `saveGa4Snapshot(...)`, then `await ensureEngagementAnchor(ws)` — each workspace wrapped in try/catch + `log.warn` (FM-2). Export idempotent `startGa4ConversionSnapshotScheduler()` (timer guard) + `stopGa4ConversionSnapshotScheduler()`. Wire the start call into `server/startup.ts` (grouped with the existing scheduler registrations; import at top).
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `feat(the-issue-client): daily ga4_conversion_snapshots cron + startup wiring`

### Task A9 — `computeROI()` returns the additive `outcomeVerdict` block
> Extend `ROIData` (`shared/types/roi.ts`, after `computedAt`) and `computeROI` (`server/roi.ts:146`) — do not fork the endpoint. Hydrate `outcomeVerdict` ONLY when the flag is ON for the workspace AND `ws.outcomeValue` AND a GA4 snapshot both exist; otherwise leave `undefined`. `provenance` ALWAYS `'estimate_ga4'` in P0.

**Files:** Modify `shared/types/roi.ts`; modify `server/roi.ts`; create `tests/unit/compute-roi-outcome-verdict.test.ts`.

- [ ] **Write failing test** `tests/unit/compute-roi-outcome-verdict.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from '../integration/helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { computeROI } from '../../server/roi.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

let ctx: Awaited<ReturnType<typeof createEphemeralTestContext>>; let wsId: string; let cleanup: () => void;
beforeAll(async () => { ctx = await createEphemeralTestContext(import.meta.url); const s = seedWorkspace(); wsId = s.id; cleanup = s.cleanup;
  /* seed page_keywords so computeROI != null; seed pinned eventConfig */ });
afterAll(async () => { cleanup(); await ctx.teardown(); });

it('omits outcomeVerdict when outcomeValue is unset (legacy byte-identical)', () => {
  setWorkspaceFlagOverride('the-issue-client-spine', wsId, true);
  expect(computeROI(wsId)?.outcomeVerdict).toBeUndefined();
});
it('omits outcomeVerdict when the flag is OFF even if outcomeValue is set', () => {
  setWorkspaceFlagOverride('the-issue-client-spine', wsId, false);
  updateWorkspace(wsId, { outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 } });
  saveGa4Snapshot({ workspaceId: wsId, capturedAt: new Date().toISOString(), totalConversions: 14, totalUsers: 200, byEvent: [{ eventName: 'phone_call', conversions: 14, users: 200, rate: 7 }] });
  expect(computeROI(wsId)?.outcomeVerdict).toBeUndefined();
});
it('hydrates outcomeVerdict (estimate_ga4) when flag ON + outcomeValue + GA4 conversions present', () => {
  setWorkspaceFlagOverride('the-issue-client-spine', wsId, true);
  const v = computeROI(wsId)?.outcomeVerdict;
  expect(v?.provenance).toBe('estimate_ga4');
  expect(v?.estimatedValue).toBe(14 * 800);
  expect(v?.monthlyRetainer).toBe(1500);
  expect(v?.baseline.state).toBeDefined();
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** `shared/types/roi.ts` `ROIData` (after `computedAt`):
```ts
/** The Issue (Client) P0 — outcome-denominated verdict. Present only when the spine flag is ON,
 *  GA4 conversions exist, AND workspace.outcomeValue is set; additive + optional → legacy callers
 *  and flag-OFF unaffected. */
outcomeVerdict?: {
  outcomeCount: number;
  outcomeUnitLabel: string;
  valuePerOutcome: number;
  estimatedValue: number;            // outcomeCount × valuePerOutcome
  monthlyRetainer: number | null;
  baseline: OutcomeBaseline;
  baselineDeltaCount: number | null; // null while establishing
  provenance: OutcomeProvenance;     // ALWAYS 'estimate_ga4' in P0
};
```
(import `OutcomeBaseline`/`OutcomeProvenance` from `./the-issue.js`.) In `computeROI` (`:146`), after the existing `ROIData` is assembled and before `return`: if `!isFeatureEnabled('the-issue-client-spine', workspaceId)` OR `!ws.outcomeValue` → leave unset. Else read the most recent `loadGa4SnapshotHistory(ws.id)` row → `aggregatePinnedOutcomes(ws, row.byEvent)` for `outcomeCount`; if no snapshot exists, leave unset (no fabricated number). `baseline = computeOutcomeBaseline(ws)`; `baselineDeltaCount = baseline.state === 'ready' && baseline.baselineConversions != null ? outcomeCount - baseline.baselineConversions : null`; `provenance: 'estimate_ga4'`; `estimatedValue = outcomeCount * ws.outcomeValue.valuePerOutcome`; `monthlyRetainer = ws.outcomeValue.monthlyRetainer ?? null`; `outcomeUnitLabel = ws.outcomeValue.unitLabel`.
- [ ] **Run** → **PASS**; full `npx vitest run` → **PASS** (legacy ROI tests unaffected — field is additive).
- [ ] **Commit:** `feat(the-issue-client): computeROI() hydrates additive outcomeVerdict block (flag-gated, estimate_ga4)`

### Task A10 — Public-portal payload lockstep (`segmentProfile` + `outcomeVerdict`) — flag-gated
> Every net-new public field added to the serializer's explicit list in the same commit. The integration test (D3) exercises the **public** read path. `outcomeVerdict` rides automatically (route returns `computeROI()` whole, already flag-gated in A9); `segmentProfile` must be **explicitly added** to `PublicWorkspaceView` (pre-resolved, not a raw passthrough), gated by `the-issue-client-spine`.

**Files:** Modify `server/serializers/client-safe.ts` (`PublicWorkspaceView` + body); update the `/api/public/workspace/:id` route caller (in the route module that calls `toPublicWorkspaceView`) to pass the resolved flag; add an inline comment at `server/routes/stripe.ts:63-66`.

- [ ] **Implement** — `PublicWorkspaceView`: add `segmentProfile?: ResolvedSegmentProfile;` (optional → OFF byte-identical). `toPublicWorkspaceView(ws, opts?)`: accept an additive `opts?: { theIssueClientSpine?: boolean }`; when `opts?.theIssueClientSpine`, set `segmentProfile: resolveSegmentProfile(ws)`. Import `resolveSegmentProfile` from `../workspaces.js` and `ResolvedSegmentProfile` from `../../shared/types/workspace.js`. Update the `/api/public/workspace/:id` caller to compute `isFeatureEnabled('the-issue-client-spine', ws.id)` and pass it. Add inline comment at `stripe.ts:63-66`: `// the-issue-client P0: outcomeVerdict rides this payload additively via computeROI() (flag-gated inside computeROI); no serializer change needed here.`
- [ ] **(Test owned by Lane D — D3.)** A10's correctness is pinned by D3's public-route integration test; Lane A confirms `npm run typecheck && npx vitest run && npx tsx scripts/pr-check.ts` green after the change.
- [ ] **Commit:** `feat(the-issue-client): public-portal serialization lockstep for segmentProfile (flag-gated) + outcomeVerdict comment`

### Lane A exit gate (run before unblocking B/C/D)
- [ ] `npm run typecheck` — zero errors.
- [ ] `npx vite build` — succeeds.
- [ ] `npx vitest run` — full suite green (legacy ROI/workspace/serializer tests unaffected).
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (no bare `JSON.parse`; `parseJsonSafe`/`parseJsonSafeArray` at every JSON boundary; `createStmtCache` for prepared statements; UPDATE/DELETE workspace-scoped; named callAI op + Zod for A7; six-site DB-column lockstep; public-serialization lockstep).
- [ ] `npm run verify:feature-flags` — the-issue-client flag family consistent (with D0).
- [ ] **Flag-OFF byte-identity preserved by construction** — every new column/field additive/optional; `toPublicWorkspaceView` emits `segmentProfile` only when the flag is ON; `computeROI` omits `outcomeVerdict` when OFF. No client render changes in this lane.
- [ ] **Docs in the same commit set:** `FEATURE_AUDIT.md` (outcome/snapshot/segment substrate entries), `data/roadmap.json` (mark P0 data-substrate item; note `actual_reconciled`/P1 deferred; add the five `linkedRoadmapItemId` items; `npx tsx scripts/sort-roadmap.ts`), `data/features.json` (sales-relevant: dollar-verdict spine).

**Hand-off contract for B/C/D:**
`shared/types/the-issue.ts` → `IssueVerdict`, `IssueOutcomeCount`, `OutcomeBaseline`, `Ga4ConversionSnapshot`, `OutcomeProvenance` (re-export). `shared/types/workspace.ts` → `ClientSegment`, `SegmentConfig`, `ResolvedSegmentProfile`, `Workspace.outcomeValue`, `Workspace.segmentConfig`. `shared/types/roi.ts` → `ROIData.outcomeVerdict`. `shared/types/feature-flags.ts` → `the-issue-client-spine` (+ 4 P1 flags). Server: `resolveSegmentProfile(ws)`, `computeOutcomeBaseline(ws)`, `aggregatePinnedOutcomes(ws, byEvent)`, `backfillGa4SnapshotsFromHistory(ws)`, `enrichLeadValue(...)`, `saveGa4Snapshot`/`loadGa4SnapshotHistory`/`getEarliestGa4Snapshot`. Public payload carries `segmentProfile` (flag-ON) + `outcomeVerdict` via `GET /api/public/roi`. **B/C/D read these via `useClientROI` / the public payload — never re-derive raw `industry` client-side, never hand-assemble the verdict sentence client-side.**

---

# Lane B — verdict/outcome/money spine (client UI)

Runs in parallel with Lane C after Lane A's contract commit. The verdict copy is a **pure render** — `sentence` and all numbers come from the server-assembled `IssueVerdict`/`ROIData.outcomeVerdict`; Lane B formats already-resolved values through `fmtEstimateMoney`/`fmtEstimateRatio` and uses `baselineVerdict()` (Lane C) only as a client-side fallback when `sentence` is empty.

### Task B1 — `fmtEstimateMoney()` + `fmtEstimateRatio()` estimate-labeled formatters
**Files:** Create `tests/unit/format-estimate.test.ts`; modify `src/utils/formatNumbers.ts` (append after `fmtMoneyFull`).

- [ ] **Write failing test** `tests/unit/format-estimate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fmtEstimateMoney, fmtEstimateRatio } from '../../src/utils/formatNumbers';

describe('fmtEstimateMoney (banded, estimate-labeled)', () => {
  it('bands dollars to two significant figures with a ~ prefix', () => {
    expect(fmtEstimateMoney(11_234)).toBe('~$11,000');
    expect(fmtEstimateMoney(1_499)).toBe('~$1,500');
    expect(fmtEstimateMoney(94_900)).toBe('~$95,000');
  });
  it('never emits cents on an estimate', () => {
    expect(fmtEstimateMoney(11_234)).not.toMatch(/\.\d/);
  });
  it('floors small values to a readable band, not $0', () => {
    expect(fmtEstimateMoney(42)).toBe('~$42');
    expect(fmtEstimateMoney(0)).toBe('~$0');
  });
});

describe('fmtEstimateRatio (one significant figure, estimate-labeled)', () => {
  it('rounds a multiple to one significant figure with ~ and ×', () => {
    expect(fmtEstimateRatio(7.34)).toBe('~7×');
    expect(fmtEstimateRatio(4.2)).toBe('~4×');
    expect(fmtEstimateRatio(11.9)).toBe('~10×');
  });
  it('uses one decimal only below 1×', () => {
    expect(fmtEstimateRatio(0.62)).toBe('~0.6×');
  });
  it('guards divide-by-zero / non-finite to an em-dash sentinel', () => {
    expect(fmtEstimateRatio(Infinity)).toBe('—');
    expect(fmtEstimateRatio(Number.NaN)).toBe('—');
  });
});
```
- [ ] **Run** `npx vitest run tests/unit/format-estimate.test.ts` → **FAIL**.
- [ ] **Implement** — append to `src/utils/formatNumbers.ts`:
```ts
/**
 * Estimate-labeled money band. Used ONLY when provenance === 'estimate_ga4'. Rounds to two
 * significant figures and prefixes "~"; never emits cents. Exact figures use fmtMoneyFull.
 */
export function fmtEstimateMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '~$0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)) - 1);
  const banded = Math.round(abs / magnitude) * magnitude;
  return `~${sign}$${banded.toLocaleString('en-US')}`;
}

/**
 * Estimate-labeled ratio ("~7×"). One significant figure at/above 1×, one decimal below.
 * Non-finite → em-dash sentinel.
 */
export function fmtEstimateRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  if (ratio >= 1) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(ratio)));
    return `~${Math.round(ratio / magnitude) * magnitude}×`;
  }
  return `~${ratio.toFixed(1)}×`;
}
```
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `P0 Lane B: fmtEstimateMoney/fmtEstimateRatio banded/one-sig-fig estimate formatters`

### Task B3 — Net-new `IssueVerdictHeadline` component
> Replaces `NarratedStatusHeadline` at the headline (DROPS `MetricRing` + the `evergreenVerdict()` band; KEEPS the curated-by byline + opt-in `topRec.opportunity` why-bars). The verdict number is a pure render; `provenance === 'estimate_ga4'` renders a visible estimate label. Thin state when `verdict.baseline === null`; honest no-number degradation when `verdict === null`. **Depends on B1 (`fmtEstimateMoney`) and Lane C C2 (`baselineVerdict`).**

**Files:** Create `tests/component/IssueVerdictHeadline.test.tsx`; create `src/components/client/the-issue/IssueVerdictHeadline.tsx`.

- [ ] **Write failing test** `tests/component/IssueVerdictHeadline.test.tsx`:
```ts
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Recommendation } from '../../shared/types/recommendations';
import type { ROIData } from '../../shared/types/roi';
import { IssueVerdictHeadline } from '../../src/components/client/the-issue/IssueVerdictHeadline';
import { hasTemporalLanguage } from '../../src/components/client/the-issue/evergreenCopy';

const verdict: NonNullable<ROIData['outcomeVerdict']> = {
  outcomeCount: 14, outcomeUnitLabel: 'new patients', valuePerOutcome: 800,
  estimatedValue: 11_234, monthlyRetainer: 1_500,
  baseline: { engagementStart: '2026-01-01T00:00:00Z', baselineConversions: 6,
    baselineCapturedAt: '2026-01-01T00:00:00Z', state: 'ready' },
  baselineDeltaCount: 8, provenance: 'estimate_ga4',
};

describe('IssueVerdictHeadline', () => {
  it('leads with a banded estimated dollar value, the outcome count, and an estimate label', () => {
    render(<IssueVerdictHeadline verdict={verdict} topRec={null} />);
    expect(screen.getByText(/~\$11,000/)).toBeInTheDocument();
    expect(screen.getByText(/14 new patients/)).toBeInTheDocument();
    expect(screen.getByText(/estimate/i)).toBeInTheDocument();
  });
  it('renders the baseline anchor and passes the verdict-zone evergreen guard', () => {
    const { container } = render(<IssueVerdictHeadline verdict={verdict} topRec={null} />);
    expect(screen.getByText(/up from 6/)).toBeInTheDocument();
    expect(hasTemporalLanguage(container.textContent ?? '', 'verdict')).toBe(false);
  });
  it('never renders a MetricRing (D3 / Reversal 3)', () => {
    const { container } = render(<IssueVerdictHeadline verdict={verdict} topRec={null} />);
    expect(container.querySelector('[data-metric-ring]')).toBeNull();
  });
  it('thin state: baseline null → establishing copy, no fabricated delta', () => {
    render(<IssueVerdictHeadline verdict={{ ...verdict, baselineDeltaCount: null,
      baseline: { ...verdict.baseline, baselineConversions: null, state: 'establishing' } }} topRec={null} />);
    expect(screen.getByText(/establishing your baseline/i)).toBeInTheDocument();
    expect(screen.queryByText(/up from/)).not.toBeInTheDocument();
  });
  it('null verdict → honest no-number degradation', () => {
    render(<IssueVerdictHeadline verdict={null} topRec={null} />);
    expect(screen.queryByText(/~\$/)).not.toBeInTheDocument();
    expect(screen.getByText(/appears here as outcomes land/i)).toBeInTheDocument();
  });
  it('KEEPS the opt-in why-bars when topRec carries an opportunity breakdown', () => {
    const topRec = { id: 'r1', title: 'Publish KPI guide',
      opportunity: { components: [{ dimension: 'demand', contribution: 0.7, evidence: '900 searches/mo' }] },
    } as unknown as Recommendation;
    render(<IssueVerdictHeadline verdict={verdict} topRec={topRec} />);
    fireEvent.click(screen.getByRole('button', { name: /why this is the move/i }));
    expect(screen.getByText('Publish KPI guide')).toBeInTheDocument();
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** `src/components/client/the-issue/IssueVerdictHeadline.tsx`. Port the why-bars block from `NarratedStatusHeadline.tsx:68-101`; import `Sparkles` for the byline; **do not** import `MetricRing`; use `fmtEstimateMoney` (B1) + `baselineVerdict` (Lane C). Root `<section>` carries `data-testid="issue-verdict-headline"`. Color: teal for byline/action, blue for the why-bars, emerald for the value, tokens only, no purple. Props: `{ verdict: NonNullable<ROIData['outcomeVerdict']> | null; topRec?: Recommendation | null; }`. Render branches: (a) `verdict == null` → "your verdict appears here as outcomes land"; (b) `verdict.baseline.state === 'establishing'` → value + "establishing your baseline" line, no delta; (c) ready → `fmtEstimateMoney(estimatedValue)` + retainer ratio + `baselineVerdict({ outcomeNoun: verdict.outcomeUnitLabel, current: verdict.outcomeCount, baseline: verdict.baseline.baselineConversions })`. When `provenance === 'estimate_ga4'`, render the estimate disclosure line. Always render the "Curated by your strategist" byline. Why-bars are an opt-in `<Button variant="link">` toggle (KEEP from spec).
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `P0 Lane B: IssueVerdictHeadline (dollar verdict, baseline, no ring)`

> **MetricRing note:** `IssueVerdictHeadline` *replaces* `NarratedStatusHeadline` at the headline only. `NarratedStatusHeadline.tsx` is **not deleted** (the flag-OFF path still renders it). The ring stays a primitive. Diff-review asserts `grep -rn "MetricRing" src/components/client/the-issue/IssueVerdictHeadline.tsx` returns nothing.

### Task B4 — Net-new `OutcomeCountBand` component (slot 2)
> Composes `StatCard` (`size="hero"`) per pinned-event unit; dual trend (vs last period AND vs baseline). `namedRecordsAvailable === false` (always P0) renders the honest upsell affordance. Thin state (no units) → `EmptyState` with set-up CTA. Reads `IssueOutcomeCount` (Lane A).

**Files:** Create `tests/component/OutcomeCountBand.test.tsx`; create `src/components/client/the-issue/OutcomeCountBand.tsx`.

- [ ] **Write failing test** `tests/component/OutcomeCountBand.test.tsx`:
```ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IssueOutcomeCount } from '../../shared/types/the-issue';
import { OutcomeCountBand } from '../../src/components/client/the-issue/OutcomeCountBand';

const count: IssueOutcomeCount = {
  units: [
    { label: 'calls', current: 9, baseline: 4, priorPeriod: 7, eventName: 'phone_call' },
    { label: 'form fills', current: 5, baseline: 2, priorPeriod: 6, eventName: 'generate_lead' },
  ],
  provenance: 'estimate_ga4', namedRecordsAvailable: false,
};

describe('OutcomeCountBand', () => {
  it('renders one hero stat per pinned-event unit with the current count', () => {
    render(<OutcomeCountBand count={count} />);
    expect(screen.getByText('calls')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('form fills')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
  it('shows BOTH trends: vs last period AND since we started', () => {
    render(<OutcomeCountBand count={count} />);
    expect(screen.getAllByText(/vs last period/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/since we started/i).length).toBeGreaterThan(0);
  });
  it('shows the honest upsell affordance when named records are unavailable (P0)', () => {
    render(<OutcomeCountBand count={count} />);
    expect(screen.getByText(/names available with call/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view names/i })).not.toBeInTheDocument();
  });
  it('thin state: no units → set-up CTA, never a zero count as an outcome', () => {
    render(<OutcomeCountBand count={{ units: [], provenance: 'estimate_ga4', namedRecordsAvailable: false }} />);
    expect(screen.getByText(/no conversion events configured/i)).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });
  it('honest flat period: priorPeriod === current renders "flat vs last period"', () => {
    render(<OutcomeCountBand count={{ units: [{ label: 'calls', current: 7, baseline: 4, priorPeriod: 7 }],
      provenance: 'estimate_ga4', namedRecordsAvailable: false }} />);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/flat vs last period/i)).toBeInTheDocument();
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** `src/components/client/the-issue/OutcomeCountBand.tsx` — root wrapper `data-testid="outcome-count-band"`. Use `StatCard size="hero"`; a `trendSub(current, priorPeriod, baseline)` helper builds the dual-trend sub line (`flat vs last period` / `+N vs last period` · `up from N since we started`). When `!namedRecordsAvailable`, render a muted caption upsell (no link). Empty units → `<EmptyState>` with a set-up message. Emerald for counts, no purple, tokens only.
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `P0 Lane B: OutcomeCountBand (dual-trend pinned-event counts + honest upsell)`

### Task B5 — `ROIDashboard` lead-value money frame + `compact` prop + prose edit
> Add `compact?: boolean`: when `true`, hide the per-page traffic-value table + content-attribution table (they relocate to slot 6). When `data.outcomeVerdict` exists, render the lead-value frame alongside a demoted traffic-value model. Preserve the `evergreen` prop name. Rewrite the methodology prose at lines 67-68 **in this commit**. Legacy callers (`evergreen=false`, `compact=false`) stay byte-identical.

**Files:** Modify `tests/component/ROIDashboard.test.tsx` (or create); modify `src/components/client/ROIDashboard.tsx`.

- [ ] **Write failing test** (mock `useClientROI`) — assert: `compact=true` hides "Traffic Value by Page"; `compact=false` (default) still renders it (byte-identical); `outcomeVerdict` present → `~$11,000` + unit label render; traffic-value demotes to a labeled secondary metric; methodology prose now states the lead-value multiplier (no "do not multiply by lead value").
- [ ] **Run** → **FAIL**.
- [ ] **Implement** in `src/components/client/ROIDashboard.tsx`:
  - **Props:** add `compact?: boolean` (default `false`); widen `evergreen` JSDoc to "no-rolling-window". Add `import { fmtEstimateMoney, fmtEstimateRatio } from '../../utils/formatNumbers';`.
  - **Prose (67-68):** thread a `hasOutcomeVerdict` flag into `ROIMethodologyDisclosure`; when true the closing `<p>` reads: "We multiply your tracked conversions by the per-lead value you gave us — a labeled estimate, not booked revenue. We do not yet reconcile to named records." When false, keep the original sentence byte-identical.
  - **Lead-value frame:** when `data.outcomeVerdict`, render a hero `StatCard` (`fmtEstimateMoney(estimatedValue)`, label = `outcomeUnitLabel`, retainer ratio via `fmtEstimateRatio(estimatedValue / monthlyRetainer)` when `monthlyRetainer`); relabel the existing "Organic Traffic Value" StatCard to "Traffic value (reference)".
  - **Baseline stat:** keep `showMoM` suppressed under `evergreen`; when `data.outcomeVerdict?.baseline.state === 'ready' && evergreen`, render a "vs. when we started" StatCard from `baselineDeltaCount`.
  - **Tables:** wrap the "Traffic Value by Page" and "Content ROI Attribution" `SectionCard`s in `{!compact && ( … )}`.
- [ ] **Run** → **PASS** (re-run any existing ROI test to confirm `evergreen=false && compact=false` byte-identical).
- [ ] **Commit:** `P0 Lane B: ROIDashboard compact prop + lead-value frame + methodology prose edit`

### Task B6 — `TheIssueClientPage` spine reorder + flag gating + segment toggles
> New canonical order: Your turn → **Verdict** → **Outcome count** → **Money frame (un-collapsed)** → What needs me → **Content plan + work-log** → Under the hood. Flag gates the new ordering + verdict/count slots at the narrowest point; OFF renders today's exact body. Segment booleans read from `ResolvedSegmentProfile`. Slot wrappers carry the D6 `data-testid` markers.

**Files:** Modify `tests/component/TheIssueClientPage.test.tsx`; modify `src/components/client/the-issue/TheIssueClientPage.tsx`; modify `src/components/client/OverviewTab.tsx` (prop thread).

- [ ] **Write failing tests** — extend `tests/component/TheIssueClientPage.test.tsx`: mock `useFeatureFlag`, stub `IssueVerdictHeadline`/`OutcomeCountBand`; assert (flag ON) verdict before outcome-band before content-plan, money not in `<details>`, `local_smb` hides competitor; (flag OFF, default) legacy "See full report" `<details>` present, no `stub-verdict`.
- [ ] **Run** → **FAIL**.
- [ ] **Implement** `src/components/client/the-issue/TheIssueClientPage.tsx`:
  - **Imports:** `import { useFeatureFlag } from '../../../hooks/useFeatureFlag';`, `IssueVerdictHeadline`, `OutcomeCountBand`. Keep `NarratedStatusHeadline` (OFF path).
  - **Props:** add optional `outcomeVerdict?: ROIData['outcomeVerdict'] | null;`, `outcomeCount?: IssueOutcomeCount | null;`, `segmentProfile?: ResolvedSegmentProfile | null;`, `theIssueClientSpine?: boolean;` (test override). Root element gets `data-testid="the-issue-client-page"`.
  - **Flag read (unconditional, top, Rules-of-Hooks):** `const flagValue = useFeatureFlag('the-issue-client-spine'); const spineEnabled = theIssueClientSpine ?? flagValue;`.
  - **Branch:** keep the existing JSX as the `!spineEnabled` body, byte-identical. Add the `spineEnabled` body with the new order, each slot wrapped: `<div data-testid="slot-verdict"><IssueVerdictHeadline verdict={outcomeVerdict ?? null} topRec={topRec} /></div>`, `{outcomeCount && <div data-testid="slot-outcome-count"><OutcomeCountBand count={outcomeCount} /></div>}`, `<div data-testid="slot-money"><ROIDashboard workspaceId={workspaceId} tier={effectiveTier} evergreen compact={false} /></div>` (rendered open, no `<details>`, statItems strip removed from here), then `ActionQueueStrip` full queue, then `<div data-testid="slot-content-plan"><IssueContentPlanSection .../></div>` + `IssueAlsoOnPlanSection` + `WinsSurface` + `OutcomeSummary` + `StrategyRequestedKeywordTrendSection` + `IssueLoopFooter` (positional demotion, nothing cut), then a collapsed `<details>` "Under the hood" containing the statItems `CompactStatBar` + a second `<ROIDashboard … compact />` (tables only) + `{showCompetitor && <CompetitorGapsSection .../>}`. Segment booleans: `const showCompetitor = segmentProfile?.showCompetitorAuthority ?? true;` (default-visible preserves current surface when segment unresolved). P1 insert points (`showLocalMapAndReviews`/`showPortfolioRollup`) are gated now (`{segmentProfile?.showLocalMapAndReviews && null /* P1 local insert */}`) so the wiring contract exists.
  - Keep the loading early-return + all hooks above it unchanged in both branches.
  - **OverviewTab thread** (`src/components/client/OverviewTab.tsx`): pass `outcomeVerdict={roiData?.outcomeVerdict ?? null}`, `outcomeCount={…}` (built from `aggregatePinnedOutcomes` data surfaced via the ROI/overview payload), `segmentProfile={ws.segmentProfile ?? null}`. This is the single Lane-B-owned shared edit.
- [ ] **Run** → **PASS**, including the existing legacy `TheIssueClientPage` tests (default `spineEnabled=false`).
- [ ] **Commit:** `P0 Lane B: spine reorder behind the-issue-client-spine (flag-OFF byte-identical) + segment toggles`

### Lane B verification
- [ ] `npm run typecheck` — zero errors.
- [ ] `npx vite build` — succeeds.
- [ ] `npx vitest run tests/unit/format-estimate.test.ts tests/component/IssueVerdictHeadline.test.tsx tests/component/OutcomeCountBand.test.tsx tests/component/ROIDashboard.test.tsx tests/component/TheIssueClientPage.test.tsx` — green.
- [ ] **Full suite** `npx vitest run` — no regression (legacy `TheIssueClientPage` tests pass on the OFF path).
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (evergreen-copy rule; score-color/no-purple rules).
- [ ] **Anti-feature greps:** `grep -rn "MetricRing" src/components/client/the-issue/IssueVerdictHeadline.tsx` → empty; `grep -rn "purple-" src/components/client/the-issue/` → empty.

---

# Lane C — evergreen two-zone split + eventConfig/segment wiring + admin inputs

Runs in parallel with Lane B after Lane A's contract commit. **Lane C is the sole owner of `evergreenCopy.ts`** (Lane B imports its exports; Lane D writes RED assertions against it). For the canonical export names see drift resolution #1.

### Task C1 — Two-zone evergreen split in `evergreenCopy.ts`
**Files:** Modify `src/components/client/the-issue/evergreenCopy.ts`; modify `tests/unit/the-issue-evergreen-copy.test.ts`.

- [ ] **Write failing test** — append the zone assertions (matching D1's canonical inverse-law semantics):
```ts
import {
  hasTemporalLanguage, hasBaselineAnchor, ALLOWED_BASELINE_PATTERNS, ROLLING_WINDOW_PATTERNS,
} from '../../src/components/client/the-issue/evergreenCopy';

describe('the-issue evergreen — two-zone split (D2)', () => {
  it("plan zone bans rolling + relative windows", () => {
    expect(hasTemporalLanguage('up since last week', 'plan')).toBe(true);
    expect(hasTemporalLanguage('vs last refresh', 'plan')).toBe(true);
    expect(hasTemporalLanguage('Issue #15', 'plan')).toBe(true);
    expect(hasTemporalLanguage('The pieces we recommend writing next', 'plan')).toBe(false);
  });
  it("verdict zone allows since-engagement-start baselines, still bans rolling windows", () => {
    expect(hasTemporalLanguage('14 new patients, up from 6 since we started', 'verdict')).toBe(false);
    expect(hasTemporalLanguage('up from 9 since January', 'verdict')).toBe(false);
    expect(hasTemporalLanguage('up 12% vs last week', 'verdict')).toBe(true);
  });
  it("INVERSE law: a dateless verdict is a violation", () => {
    expect(hasTemporalLanguage('Your search visibility is strong', 'verdict')).toBe(true);
    expect(hasBaselineAnchor('Your search visibility is strong')).toBe(false);
    expect(hasBaselineAnchor('14 new patients, up from 6 since we started')).toBe(true);
    for (const re of ALLOWED_BASELINE_PATTERNS) expect(re).toBeInstanceOf(RegExp);
    expect(ROLLING_WINDOW_PATTERNS.length).toBeGreaterThan(0);
  });
  it("1-arg call defaults to plan-zone banning (back-compat)", () => {
    expect(hasTemporalLanguage('vs last refresh')).toBe(true);
    expect(hasTemporalLanguage('what is working right now')).toBe(false);
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** — replace the guard block (lines 90-105) in `evergreenCopy.ts` with the canonical exports (drift resolution #1):
```ts
/** Rolling / shifting / cherry-picked windows — banned in EVERY zone. */
export const ROLLING_WINDOW_PATTERNS: RegExp[] = [
  /\bsince last week\b/i,
  /\bthis week\b/i,
  /\blast week\b/i,
  /\bvs\.?\s+last\s+(refresh|period|week|month)\b/i,
  /\bvs\.?\s+(?:the\s+)?previous\b/i,
  /\b\d+\s+days?\s+ago\b/i,
  /\byesterday\b/i,
];

/** Plan-zone-only bans (issue numbers, week-of, manufactured cadence). */
export const PLAN_RELATIVE_PATTERNS: RegExp[] = [
  /\bissue\s+#\d+\b/i,
  /\bweek of\b/i,
];

/**
 * Plan-zone ban superset = rolling + plan-relative. Preserved under the original name for the
 * pr-check static evergreen rule and the existing contract test.
 */
export const BANNED_TEMPORAL_PATTERNS: RegExp[] = [...ROLLING_WINDOW_PATTERNS, ...PLAN_RELATIVE_PATTERNS];

/** The ONLY temporal phrases allowed in the verdict/proof zone — fixed engagement-start anchors. */
export const ALLOWED_BASELINE_PATTERNS: RegExp[] = [
  /\bsince we started\b/i,
  /\bwhen we started\b/i,
  /\bvs\.?\s+when we started\b/i,
  /\bsince [A-Z][a-z]+\b/, // "since January" — a fixed month anchor
];

export type EvergreenZone = 'plan' | 'verdict';

/**
 * Zone-aware temporal guard — returns TRUE on a VIOLATION.
 *  - 'plan' (default): any BANNED_TEMPORAL_PATTERNS match.
 *  - 'verdict': a rolling-window match OR the ABSENCE of a baseline anchor (inverse law, D2).
 */
export function hasTemporalLanguage(text: string, zone: EvergreenZone = 'plan'): boolean {
  if (ROLLING_WINDOW_PATTERNS.some((re) => re.test(text))) return true;
  if (zone === 'verdict') return !ALLOWED_BASELINE_PATTERNS.some((re) => re.test(text));
  return BANNED_TEMPORAL_PATTERNS.some((re) => re.test(text));
}

/** True when `text` carries at least one allowed engagement-start anchor (inverse-law helper). */
export function hasBaselineAnchor(text: string): boolean {
  return ALLOWED_BASELINE_PATTERNS.some((re) => re.test(text));
}
```
- [ ] **Run** → **PASS** (pre-existing tests still pass; `hasTemporalLanguage(text)` defaults to plan zone; `Issue #15` stays banned via `PLAN_RELATIVE_PATTERNS`).
- [ ] **Commit:** `P0 Lane C: evergreenCopy two-zone split (ROLLING_WINDOW + ALLOWED_BASELINE + inverse law)`

### Task C2 — `baselineVerdict()` companion
**Files:** Modify `src/components/client/the-issue/evergreenCopy.ts`; modify `tests/unit/the-issue-evergreen-copy.test.ts`.

- [ ] **Write failing test**:
```ts
import { baselineVerdict } from '../../src/components/client/the-issue/evergreenCopy';

describe('baselineVerdict — verdict-zone copy generator', () => {
  it('emits a baseline-anchored sentence passing the verdict guard + carrying an anchor', () => {
    const s = baselineVerdict({ outcomeNoun: 'new patients', current: 14, baseline: 6 });
    expect(s).toContain('14 new patients');
    expect(s).toContain('since we started');
    expect(hasTemporalLanguage(s, 'verdict')).toBe(false);
    expect(hasBaselineAnchor(s)).toBe(true);
  });
  it('degrades to an establishing line (no fabricated delta) when baseline is null', () => {
    const s = baselineVerdict({ outcomeNoun: 'qualified leads', current: 3, baseline: null });
    expect(s).toContain('3 qualified leads');
    expect(s).toContain('establishing your baseline');
  });
  it('reports a decline honestly', () => {
    const s = baselineVerdict({ outcomeNoun: 'bookings', current: 5, baseline: 8 });
    expect(s).toContain('5 bookings');
    expect(s).toContain('down from 8');
    expect(hasTemporalLanguage(s, 'verdict')).toBe(false);
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** — append to `evergreenCopy.ts` (canonical arg `outcomeNoun`):
```ts
/**
 * Baseline-anchored verdict copy (D2, verdict zone). Carries an ALLOWED_BASELINE anchor when a
 * baseline exists (inverse law), never a rolling window, reports declines truthfully, and degrades
 * to an honest establishing line when baseline is null.
 */
export function baselineVerdict(args: { outcomeNoun: string; current: number; baseline: number | null }): string {
  const { outcomeNoun, current, baseline } = args;
  const head = `${current.toLocaleString()} ${outcomeNoun}`;
  if (baseline == null) {
    return `${head} — we're establishing your baseline now; your trend appears here as outcomes land.`;
  }
  if (current > baseline) return `${head}, up from ${baseline.toLocaleString()} since we started.`;
  if (current < baseline) return `${head}, down from ${baseline.toLocaleString()} since we started.`;
  return `${head} — holding steady since we started.`;
}
```
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `P0 Lane C: baselineVerdict() — baseline-anchored verdict copy (degrades honestly)`

> **Lane B handoff:** `IssueVerdictHeadline` (B3) imports `baselineVerdict`; renders `verdict.sentence` server-side normally and uses `baselineVerdict` as the client fallback when `sentence` is empty. The band-only `evergreenVerdict()` stays in `NarratedStatusHeadline.tsx` (flag-OFF path) — do not delete.

### Task C3 — Shared `eventConfig` outcome-noun helper
> Promote the inline `eventDisplayName`/`isEventPinned` (`ClientDashboard.tsx:443-449`, verified) into one module both `ClientDashboard` and the Lane B components consume. Pure refactor — behavior-identical, flag-OFF byte-identical.

**Files:** Create `src/components/client/the-issue/outcomeNoun.ts`; create `tests/unit/the-issue-outcome-noun.test.ts`; modify `src/components/ClientDashboard.tsx:443-449`.

- [ ] **Write failing test** `tests/unit/the-issue-outcome-noun.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { eventDisplayName, isEventPinned, pinnedOutcomeNouns } from '../../src/components/client/the-issue/outcomeNoun';
import type { EventDisplayConfig } from '../../shared/types/workspace';

const cfg: EventDisplayConfig[] = [
  { eventName: 'generate_lead', displayName: 'New patients', pinned: true },
  { eventName: 'book_appointment', displayName: 'Bookings', pinned: true },
  { eventName: 'scroll_90', displayName: 'scroll_90', pinned: false },
];

describe('outcomeNoun helpers', () => {
  it('eventDisplayName returns custom displayName, falls back to de-underscored eventName', () => {
    expect(eventDisplayName(cfg, 'generate_lead')).toBe('New patients');
    expect(eventDisplayName(cfg, 'page_view')).toBe('page view');
  });
  it('isEventPinned reflects the pinned flag, false for unknown', () => {
    expect(isEventPinned(cfg, 'generate_lead')).toBe(true);
    expect(isEventPinned(cfg, 'scroll_90')).toBe(false);
    expect(isEventPinned(cfg, 'unknown')).toBe(false);
  });
  it('pinnedOutcomeNouns returns only pinned events as {eventName, label}', () => {
    expect(pinnedOutcomeNouns(cfg)).toEqual([
      { eventName: 'generate_lead', label: 'New patients' },
      { eventName: 'book_appointment', label: 'Bookings' },
    ]);
  });
  it('pinnedOutcomeNouns is empty for undefined config', () => {
    expect(pinnedOutcomeNouns(undefined)).toEqual([]);
  });
});
```
- [ ] **Run** → **FAIL**.
- [ ] **Implement** `src/components/client/the-issue/outcomeNoun.ts` — `eventDisplayName(config, eventName)`, `isEventPinned(config, eventName)`, `pinnedOutcomeNouns(config)`. Logic mirrors the verified inline helpers exactly (custom displayName when it differs from the raw eventName; else de-underscored; pinned flag with `|| false`).
- [ ] **Rewire `ClientDashboard.tsx`** — add to the top import group: `import { eventDisplayName as deriveEventDisplayName, isEventPinned as deriveIsEventPinned } from './client/the-issue/outcomeNoun';`. Replace lines 443-449:
```ts
  const eventDisplayName = (eventName: string): string => deriveEventDisplayName(ws?.eventConfig, eventName);
  const isEventPinned = (eventName: string): boolean => deriveIsEventPinned(ws?.eventConfig, eventName);
```
(Preserves the exact call signatures passed to `OverviewTab` at `:700` — no behavior change.)
- [ ] **Run** `npx vitest run tests/unit/the-issue-outcome-noun.test.ts && npm run typecheck` → **PASS**.
- [ ] **Commit:** `P0 Lane C: promote eventConfig outcome-noun helpers to shared module; rewire ClientDashboard`

> **Lane B handoff:** Lane B threads `ws.eventConfig` into `TheIssueClientPage` and feeds `pinnedOutcomeNouns(eventConfig)` into the verdict/count components; when `.length === 0`, Lane B renders the admin-nudge-to-pin fallback (the `OutcomeCountBand` thin state).

### Task C4 — `outcomeValue` PATCH boundary validation
> Lane A pre-committed the `outcomeValue?`/`segmentConfig?` interface fields, the `segment_config`/`outcome_value` column lockstep, `workspaceToParams`, `columnMap`, AND the `updateWorkspace` Pick widening. Lane C adds the **validation at the PATCH boundary** + the integration test. Schemas (`outcomeValueSchema`/`segmentConfigSchema`) are Lane A's — Lane C imports them.

**Files:** Modify `server/routes/workspaces.ts:315` region; create `tests/integration/workspace-outcome-value-update.test.ts`.

- [ ] **Write failing integration test** `tests/integration/workspace-outcome-value-update.test.ts` (`createEphemeralTestContext`, `seedWorkspace`, `authedFetch`): valid `outcomeValue` round-trips on admin GET; invalid `basis` → 400 (not silent drop); `outcomeValue: null` clears it. Add parallel `segmentConfig` cases (valid `segment` round-trips; invalid `segment` → 400).
- [ ] **Run** → **FAIL**.
- [ ] **Implement** in `server/routes/workspaces.ts` — add to the top import group: `import { outcomeValueSchema, segmentConfigSchema } from '../schemas/workspace-schemas.js';`. After the existing inline boundary checks in the PATCH handler:
```ts
  if ('outcomeValue' in updates && updates.outcomeValue !== null) {
    const parsed = outcomeValueSchema.safeParse(updates.outcomeValue);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid outcomeValue' });
    updates.outcomeValue = parsed.data;
  }
  if ('segmentConfig' in updates && updates.segmentConfig !== null) {
    const parsed = segmentConfigSchema.safeParse(updates.segmentConfig);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid segmentConfig' });
    updates.segmentConfig = parsed.data;
  }
```
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `P0 Lane C: outcomeValue + segmentConfig PATCH boundary validation`

### Task C5 — Admin "Outcome value" subsection in `ClientDashboardTab.tsx`
> Net-new `SectionCard` after Content Pricing, reusing `patchWorkspace`. Admin sets the value with `basis='agency_estimate'`; an "Estimate with AI" button (visible only when no value is set) calls the C6 endpoint and stamps `basis='ai_enriched'` (labeled lowest-confidence). `WorkspaceData` gains the `outcomeValue` shape.

**Files:** Modify `src/components/settings/ClientDashboardTab.tsx`; create/modify `tests/component/ClientDashboardTab.test.tsx`.

- [ ] **Write failing component test** — renders the "Outcome Value" section after Content Pricing; "Configure outcome value" → fill value/unit → "Save outcome value" calls `patchWorkspace` with `outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', basis: 'agency_estimate' }`; an existing `ai_enriched` value shows an "AI estimate" confidence label.
- [ ] **Run** → **FAIL**.
- [ ] **Implement** in `ClientDashboardTab.tsx`: extend `WorkspaceData` with the `outcomeValue` shape; add state (`showOutcomeValue`, `ovValue`, `ovUnit`, `ovRetainer`, `ovCurrency`, `ovBasis` seeded `'agency_estimate'`, `savingOutcomeValue`, `enriching`); a `basisLabel(b)` helper; a `saveOutcomeValue()` handler that PATCHes `outcomeValue` (or `null` to clear, with `basis: ovBasis`); a new `<SectionCard>` after the Content Pricing card mirroring its markup exactly (icon tile, `Configure`/`Close` toggle, `FormInput` for value `placeholder="800"`/unit `placeholder="new patient"`/optional retainer, currency `FormSelect`, Save button `aria-label="Save outcome value"`, header `aria-label="Configure outcome value"`). When `ws?.outcomeValue` exists, the collapsed summary shows value/unit + a basis chip via `basisLabel`. Add `Sparkles` to the `lucide-react` import; use only `SectionCard`/`Button`/`FormInput`/`FormSelect` (no hand-rolled cards).
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `P0 Lane C: admin Outcome Value subsection in ClientDashboardTab (basis precedence + AI-enrich affordance)`

### Task C6 — Outcome-value AI-enrich endpoint + admin segment confirm/override UI
> **Scope reduced from the draft (drift resolution #3):** P0 builds (a) the **single** outcome-value AI-enrich endpoint calling Lane A's `enrichLeadValue`, and (b) the admin **segment confirm/override** UI (manual `FormSelect`, persists `segmentConfig`). The **AI segment-derivation op + endpoint are P1** (`the-issue-client-segment-inserts` is OFF) and are NOT built here.

**Files:** Create `server/routes/the-issue-admin.ts` (one endpoint) + mount it in the route registry; modify `src/components/settings/ClientDashboardTab.tsx` (AI-enrich button wiring + segment subsection); create `tests/integration/the-issue-outcome-value-enrich.test.ts`.

- [ ] **Write failing integration test** `tests/integration/the-issue-outcome-value-enrich.test.ts` (mock AI): `POST /api/workspaces/:id/outcome-value-enrich` returns `{ valuePerOutcome, unitLabel }` and does NOT persist (workspace `outcomeValue` stays unset until the admin PATCHes with `basis='ai_enriched'`); a 404 for an unknown workspace; a 502 when the AI enrich fails.
- [ ] **Run** → **FAIL**.
- [ ] **Implement** `server/routes/the-issue-admin.ts`:
```ts
import express from 'express';
import { requireWorkspaceAccess } from '../middleware/workspace-access.js';
import { getWorkspace } from '../workspaces.js';
import { enrichLeadValue } from '../the-issue-lead-value-ai.js';

export const theIssueAdminRouter = express.Router();

// Read-only proposer — never persists. The admin's confirm is the standard PATCH carrying
// outcomeValue with basis: 'ai_enriched'. requireWorkspaceAccess (NOT requireAuth) per Auth Conventions.
theIssueAdminRouter.post('/api/workspaces/:id/outcome-value-enrich', requireWorkspaceAccess(), async (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  try {
    const v = await enrichLeadValue({ workspaceId: ws.id, industry: ws.intelligenceProfile?.industry, currency: ws.outcomeValue?.currency ?? 'USD' });
    if (!v) return res.status(502).json({ error: 'Outcome-value estimate failed' });
    res.json({ valuePerOutcome: v.valuePerOutcome, unitLabel: v.unitLabel });
  } catch { res.status(502).json({ error: 'Outcome-value estimate failed' }); }
});
```
Mount `theIssueAdminRouter` next to the other admin routers. In `ClientDashboardTab.tsx`: wire the AI-enrich button to `POST /api/workspaces/${workspaceId}/outcome-value-enrich`, populate `ovValue`/`ovUnit` from the response, set `ovBasis='ai_enriched'`; add a **segment subsection** (`SectionCard` after Outcome Value): show the deterministic local/multi seed read-only (from `ws.segmentProfile`/`segmentConfig`), and for the non-local case a `FormSelect` (`b2b_saas`/`professional_services`/`board_vc`) that PATCHes `segmentConfig` on save.
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `P0 Lane C: outcome-value AI-enrich endpoint (advisory, Zod-validated via Lane A op) + admin segment confirm/override UI`

### Lane C verification
- [ ] `npm run typecheck && npx vite build`.
- [ ] `npx vitest run tests/unit/the-issue-evergreen-copy.test.ts tests/unit/the-issue-outcome-noun.test.ts tests/component/ClientDashboardTab.test.tsx tests/integration/workspace-outcome-value-update.test.ts tests/integration/the-issue-outcome-value-enrich.test.ts` — green.
- [ ] `npx tsx scripts/pr-check.ts` — named-operation contract present (Lane A's op consumed); admin routes use `requireWorkspaceAccess`, never `requireAuth`; no `purple-` in any `src/components/client/` touch; imports grouped at top of every modified file.
- [ ] **Flag-OFF byte-identical:** the only client-render touch is the `ClientDashboard.tsx` C3 pure refactor — verify with the D7 DOM probe at the checkpoint.

---

# Lane D — feature flag + tests + verification (FINALIZES)

D0 + D2 ship with Lane A (pre-dispatch contract commit). D1/D3/D4/D5/D6/D7 are written RED-first and turn GREEN as A/B/C land. **D7's baseline must be captured on pre-redesign HEAD before Lane C touches `TheIssueClientPage.tsx`.**

### Task D0 — Register the `the-issue-client-*` flag family (pre-dispatch, FIRST)
**Files:** Modify `shared/types/feature-flags.ts` (FEATURE_FLAGS, FEATURE_FLAG_GROUP_LABELS, FEATURE_FLAG_CATALOG, FEATURE_FLAG_GROUPS); create `tests/unit/the-issue-client-flags.test.ts`.

- [ ] **Write failing test** `tests/unit/the-issue-client-flags.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FEATURE_FLAGS, FEATURE_FLAG_CATALOG, FEATURE_FLAG_GROUPS, FEATURE_FLAG_GROUP_LABELS } from '../../shared/types/feature-flags';

const FAMILY = [
  'the-issue-client-spine', 'the-issue-client-reconciliation', 'the-issue-client-return-hook',
  'the-issue-client-segment-inserts', 'the-issue-client-next-bets',
] as const;

describe('the-issue-client feature flag family', () => {
  it('declares every family member as default-OFF', () => {
    for (const key of FAMILY) expect(FEATURE_FLAGS[key], `${key} must exist`).toBe(false);
  });
  it('the P0 master flag carries pilot-clients rollout + a linked roadmap item', () => {
    const meta = FEATURE_FLAG_CATALOG['the-issue-client-spine'].lifecycle;
    expect(meta.rolloutTarget).toBe('pilot-clients');
    expect(meta.linkedRoadmapItemId).toBe('the-issue-client-redesign-p0');
    expect(meta.owner).toBeTruthy();
  });
  it('the return-hook child watches delivery cost on staging first', () => {
    expect(FEATURE_FLAG_CATALOG['the-issue-client-return-hook'].lifecycle.rolloutTarget).toBe('staging-validation');
  });
  it('every family member is grouped under "The Issue (Client)"', () => {
    expect(FEATURE_FLAG_GROUP_LABELS).toContain('The Issue (Client)');
    const group = FEATURE_FLAG_GROUPS.find(g => g.label === 'The Issue (Client)');
    expect(group).toBeDefined();
    for (const key of FAMILY) {
      expect(group!.keys).toContain(key);
      expect(FEATURE_FLAG_CATALOG[key]).toBeDefined();
    }
  });
});
```
- [ ] **Run** → **FAIL** (TS compile + assertion failures); confirm `npm run verify:feature-flags` is currently green (proving the lockstep gate exists).
- [ ] **Implement** — add the five flags to `FEATURE_FLAGS` (all `false`, with the master flag's comment noting OFF = byte-identical); add `'The Issue (Client)'` to `FEATURE_FLAG_GROUP_LABELS`; add catalog entries (master: `owner: 'analytics-intelligence'`, `createdAt: '2026-06-20'`, `rolloutTarget: 'pilot-clients'`, `linkedRoadmapItemId: 'the-issue-client-redesign-p0'`, `staleAuditCadence: 'monthly'`, `lastReviewedAt: '2026-06-20'`; `the-issue-client-return-hook` uses `rolloutTarget: 'staging-validation'`; the other three use `'pilot-clients'` with their own `linkedRoadmapItemId`s `…-p1-reconciliation` / `…-p1-segments` / `…-p1-next-bets`); add the `FEATURE_FLAG_GROUPS` entry with all five keys. Add the five `linkedRoadmapItemId` values as `pending` items to `data/roadmap.json` and run `npx tsx scripts/sort-roadmap.ts`.
- [ ] **Run** → `npx vitest run tests/unit/the-issue-client-flags.test.ts` → **PASS**; `npm run verify:feature-flags` → **PASS**; `npm run typecheck` → **PASS**.
- [ ] **Commit** (with Lane A + D2): `flag(the-issue): register the-issue-client-* family (P0 master + P1 children, all OFF)`

### Task D2 — Contract tests for the net-new shared types (ships with Lane A)
**Files:** Create `tests/contract/the-issue-types.test.ts`.

- [ ] **Write failing test** `tests/contract/the-issue-types.test.ts` — typed object literals pinning `IssueVerdict`, `IssueOutcomeCount`, `OutcomeBaseline`, `Workspace.outcomeValue`, `ROIData.outcomeVerdict`, plus `@ts-expect-error` lines that pin closed unions: no third `OutcomeProvenance` value; `outcomeVerdict` is additive (legacy `Pick<ROIData,'organicTrafficValue'>` still satisfies). P0 invariant: `outcomeVerdict.provenance === 'estimate_ga4'`.
- [ ] **Run** → **FAIL** (types not yet declared).
- [ ] **Implement = Lane A lands the types** exactly as A2/A3/A9 specify (this test is the executable acceptance for Lane A).
- [ ] **Run** → **PASS** once Lane A's commit lands; `npm run typecheck` → **PASS**.
- [ ] **Commit** (with Lane A + D0): `test(the-issue): contract tests for P0 shared types (verdict/count/baseline/provenance)`

### Task D1 — Two-zone evergreen guard acceptance (the inverse assertion)
**Files:** Extend `tests/unit/the-issue-evergreen-copy.test.ts` (the canonical-name assertions). Consumes `evergreenCopy.ts` (Lane C C1).

- [ ] **Write the RED assertions** — the same canonical semantics as C1 (Lane C owns the implementation; D1 is the acceptance pin):
```ts
import { ALLOWED_BASELINE_PATTERNS, hasTemporalLanguage as zoneGuard, hasBaselineAnchor } from '../../src/components/client/the-issue/evergreenCopy';

describe('the-issue evergreen — two zones (D2 / Reversal 1) [acceptance]', () => {
  it("plan zone bans every rolling/dated phrase", () => {
    expect(zoneGuard('Up 12% since last week', 'plan')).toBe(true);
    expect(zoneGuard('Issue #15', 'plan')).toBe(true);
    expect(zoneGuard('Your strategist is sizing up your next content opportunities.', 'plan')).toBe(false);
  });
  it("verdict zone REQUIRES a baseline anchor — a dateless verdict FAILS", () => {
    expect(zoneGuard('New patient inquiries: 14', 'verdict')).toBe(true);
    expect(zoneGuard('14 new patients, up from 6 when we started', 'verdict')).toBe(false);
    expect(zoneGuard('Organic pipeline $42k vs. when we started', 'verdict')).toBe(false);
  });
  it("verdict zone still bans rolling windows even with an anchor", () => {
    expect(zoneGuard('14 since we started, up vs last month', 'verdict')).toBe(true);
  });
  it("ALLOWED_BASELINE_PATTERNS matches anchors, not rolling windows", () => {
    expect(hasBaselineAnchor('since we started')).toBe(true);
    expect(ALLOWED_BASELINE_PATTERNS.some(re => re.test('vs last week'))).toBe(false);
  });
  it("legacy single-arg call defaults to plan zone", () => {
    expect(zoneGuard('vs last refresh')).toBe(true);
    expect(zoneGuard('what is working right now')).toBe(false);
  });
});
```
- [ ] **Run** → **FAIL** until C1 lands.
- [ ] **Implement = Lane C C1.**
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `test(the-issue): two-zone evergreen guard acceptance — dateless verdict fails CI (D2)`

### Task D3 — Public read-path: `outcomeVerdict` flows through `GET /api/public/roi` only when flag ON; flag-OFF byte-identical
**Files:** Create `tests/integration/the-issue-client-roi-public.test.ts`. Consumes `setWorkspaceFlagOverride` (`server/feature-flags.ts`), `updateWorkspace`, `saveGa4Snapshot` (Lane A), `computeROI` extension (Lane A A9), public route (Lane A A10).

- [ ] **Write failing test** `tests/integration/the-issue-client-roi-public.test.ts` (pattern from `recommendations-public-allowlist.test.ts`: `createEphemeralTestContext(import.meta.url, { autoPublicAuth: true })`, real public GET, text+JSON inspection). Use canonical names: `import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';`, `saveGa4Snapshot({ workspaceId: wsId, … })`. Cases:
  - flag-OFF + outcomeValue set → raw response does NOT contain `outcomeVerdict`/`estimatedValue`; `organicTrafficValue` present (byte-identical).
  - flag-ON but outcomeValue unset → no `outcomeVerdict` (honest degradation).
  - flag-ON + outcomeValue set + a current `saveGa4Snapshot` of 14 conversions → `body.outcomeVerdict.outcomeCount === 14`, `estimatedValue === 14 * 800`, `monthlyRetainer === 1500`, `provenance === 'estimate_ga4'`; raw payload must NOT contain `actual_reconciled` or `contactName` (no P1 leakage).
  - **companion (segment lockstep):** with `the-issue-client-segment-inserts` OFF (P0) → `GET /api/public/workspace/:id` raw text does NOT contain `segmentProfile`; with `the-issue-client-spine` ON → `segmentProfile` present (A10).
- [ ] **Run** → **FAIL** until Lane A A4/A9/A10 land.
- [ ] **Implement = Lane A.** (Add `seedRoiCpcData` to `tests/integration/helpers.ts` only if no equivalent CPC fixture exists.)
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `test(the-issue): public ROI read-path gate for outcomeVerdict (flag-ON only, flag-OFF byte-identical)`

### Task D4 — GA4 snapshot aggregation + baseline anchor + backfill acceptance
**Files:** Create `tests/integration/ga4-conversion-snapshot.test.ts`. Consumes the canonical Lane A modules: `server/ga4-snapshots.ts` (`saveGa4Snapshot`/`loadGa4SnapshotHistory`/`getEarliestGa4Snapshot`) + `server/the-issue-outcome.ts` (`computeOutcomeBaseline`/`backfillGa4SnapshotsFromHistory`). Mock GA4 via `tests/mocks/google` (`setConversions`/`setError`/`reset`).

- [ ] **Write failing test** `tests/integration/ga4-conversion-snapshot.test.ts` — use canonical `saveGa4Snapshot({ workspaceId: wsId, … })`. Cases: round-trip + `byEvent` parsed at boundary (`rate` stays a percentage, never ×100); 90-day prune removes far-old rolling rows **but never the earliest anchor**; `computeOutcomeBaseline` flips `establishing → ready` once a snapshot exists, anchored to `createdAt`; `backfillGa4SnapshotsFromHistory` seeds the anchor from the GA4 historical mock; on GA4 error the baseline stays `establishing` (FM-2 honest degradation, never fabricated).
- [ ] **Run** → **FAIL** until Lane A A4/A6 land.
- [ ] **Implement = Lane A** (migration `146` + `server/ga4-snapshots.ts` + `server/the-issue-outcome.ts`). The cron is exercised by Lane A's A8 test.
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `test(the-issue): GA4 conversion snapshot aggregation + engagement baseline + backfill (P0.1/P0.2)`

### Task D5 — Component: `IssueVerdictHeadline` leads, no MetricRing, dateless verdict guarded
**Files:** Create `tests/component/IssueVerdictHeadline.test.tsx` (this is a Lane-D acceptance test distinct from B3's own component test — D5 spies on the `MetricRing` primitive to prove it is never invoked). Consumes Lane B's `IssueVerdictHeadline`.

- [ ] **Write failing test** — spy-mock `MetricRing` from `src/components/ui` (`ringSpy`), render `IssueVerdictHeadline` with a `ROIData['outcomeVerdict']` fixture: assert the baseline-anchored headline renders; `ringSpy` is never called AND `queryByTestId('metric-ring')` is null; the byline survives; the rendered text passes `hasTemporalLanguage(text, 'verdict')`; `estimate_ga4` shows an estimate label and never two-decimal precision (`fmtEstimateMoney` banding); thin state (`baseline === null`) shows establishing copy with no fabricated delta.
- [ ] **Run** → **FAIL** until Lane B B3 lands.
- [ ] **Implement = Lane B B3.**
- [ ] **Run** → **PASS**.
- [ ] **Commit:** `test(the-issue): IssueVerdictHeadline leads, no ring, dateless-verdict guarded (Slot 1/D3)`

### Task D6 — Component: spine order + content demotion + flag-OFF byte-identical
**Files:** Create `tests/component/the-issue-spine-order.test.tsx`. Consumes Lane B's re-sequenced `TheIssueClientPage` + the `theIssueClientSpine` prop + the slot `data-testid`s (drift resolution #8, #9).

- [ ] **Write failing test** — reuse the `TheIssueClientPage.test.tsx` mock shape; stub `IssueVerdictHeadline`→`slot-verdict`, `OutcomeCountBand`→`slot-outcome-count`, `ROIDashboard`→`slot-money`. Cases: flag-ON (`theIssueClientSpine: true`) → DOM order `slot-verdict < slot-outcome-count < slot-money < slot-content-plan`, and `slot-money` is NOT inside a `<details>`; flag-OFF (`theIssueClientSpine: false`) → no `slot-verdict`/`slot-outcome-count`, "Your content plan" present, the legacy money `<details>` present; no `metric-ring` in either state.
- [ ] **Run** → **FAIL** until Lane B B6 lands.
- [ ] **Implement = Lane B B6** (slot test-ids + `theIssueClientSpine` override + un-collapsed money on the ON path).
- [ ] **Run** → **PASS**; the pre-existing `tests/component/TheIssueClientPage.test.tsx` (flag-OFF default) STILL passes (component-level byte-identity).
- [ ] **Commit:** `test(the-issue): spine order (verdict/count/money lead, content demoted) + flag-OFF identity`

### Task D7 — Flag-OFF byte-identical DOM-probe harness (mandatory real-browser proof)
> The four code gates can ALL pass while a layout reorder silently regresses the visible surface. This Playwright probe compares the flag-OFF render to a baseline captured on pre-redesign HEAD.

**Files:** Create `scripts/verify/the-issue-flag-off-domprobe.ts`; add a `package.json` script.

- [ ] **Write the harness** `scripts/verify/the-issue-flag-off-domprobe.ts` — Playwright (`chromium`) loads `/client/:workspaceId/overview` (seeded fixture) with the flag OFF (default), normalizes the `[data-testid="the-issue-client-page"]` innerHTML (strip ids/timestamps/whitespace), and diffs against `scripts/verify/__baselines__/the-issue-client-flag-off.html`. Regression guards: throw if `slot-verdict` renders with the flag OFF; throw if the legacy headline ring is missing. `--capture-baseline` writes the baseline; default run diffs and exits 1 on drift. Parameterize via `PROBE_BASE_URL`/`PROBE_WS_ID`.
- [ ] **Capture baseline on pre-redesign HEAD** (before Lane C touches `TheIssueClientPage.tsx`): `npm run seed:demo`, `npm run dev:all`, then `npx tsx scripts/verify/the-issue-flag-off-domprobe.ts --capture-baseline`. Commit the baseline.
- [ ] **Run after the spine lands** (flag OFF): `npx tsx scripts/verify/the-issue-flag-off-domprobe.ts` → must print `flag-OFF byte-identical: PASS`.
- [ ] **Wire** `"verify:the-issue-flag-off": "tsx scripts/verify/the-issue-flag-off-domprobe.ts"` into `package.json` scripts; reference in the P0 PR checklist (not in the default `verify:platform` chain — it needs a running server + seeded data).
- [ ] **Commit:** `chore(the-issue): flag-OFF DOM-probe harness + committed pre-redesign baseline`

### Lane D verification rollup
```
npx vitest run tests/unit/the-issue-client-flags.test.ts \
              tests/unit/the-issue-evergreen-copy.test.ts \
              tests/contract/the-issue-types.test.ts \
              tests/integration/the-issue-client-roi-public.test.ts \
              tests/integration/ga4-conversion-snapshot.test.ts \
              tests/component/IssueVerdictHeadline.test.tsx \
              tests/component/the-issue-spine-order.test.tsx \
              tests/component/TheIssueClientPage.test.tsx   # must STILL pass (flag-OFF default)
npm run typecheck
npm run verify:feature-flags
npm run verify:coverage-ratchet
npx tsx scripts/pr-check.ts
npx tsx scripts/verify/the-issue-flag-off-domprobe.ts   # requires running server + seed:demo
grep -r "purple-" src/components/client/                # must be empty
```
Do **not** run two full `npx vitest run` passes concurrently (per-file deterministic ports → EADDRINUSE; kill orphaned `tsx server/index.ts` PPID-1 processes if a run wedges). Per the holistic-review rule, the **full** suite must pass before the P0 PR — per-lane-green can coexist with a fixture-masked dead feature; the public read-path test (D3) and the DOM probe (D7) are the specific guards.

---

## Verification Strategy (exact commands)

After each lane's tasks and again before the P0 PR, run the full gate (single sequential run — never two concurrent `vitest` passes):

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run verify:feature-flags
```

Then the P0-specific gates:

```bash
npm run verify:coverage-ratchet
npm run seed:demo && npm run dev:all   # in a background shell for the probe
npx tsx scripts/verify/the-issue-flag-off-domprobe.ts
grep -rn "purple-" src/components/client/                                  # must be empty
grep -rn "MetricRing" src/components/client/the-issue/IssueVerdictHeadline.tsx  # must be empty
```

**Diff-review checkpoint (after the B‖C parallel batch, before Lane D finalizes):**
- `git diff` every changed file; `grep -rn "interface IssueVerdict" shared/types/` returns exactly one definition (no stub survived).
- Re-read `shared/types/roi.ts` and `shared/types/workspace.ts` before finalizing B5/B6 — confirm `outcomeVerdict.{outcomeCount,outcomeUnitLabel,valuePerOutcome,estimatedValue,monthlyRetainer,baseline,baselineDeltaCount,provenance}` and `ResolvedSegmentProfile.{showCompetitorAuthority,showPortfolioRollup,showLocalMapAndReviews}` field names match exactly (read-before-write — guessed names are the #1 silent-data-loss bug here).
- Confirm `OverviewTab.tsx` was edited once (Lane B), not twice.
- Because multiple/parallel agents were used: invoke the **`scaled-code-review`** skill before merging; fix all Critical/Important findings in this PR.

**Flag-OFF byte-identical + phase-per-PR note.** Every net-new field is optional/additive and unread on the OFF path; `computeROI` omits `outcomeVerdict` when OFF; `toPublicWorkspaceView` omits `segmentProfile` when OFF. The OFF-path identity is proven at three layers: component tests (B6, D6), the public payload integration test (D3), and the mandatory real-browser DOM probe (D7). This entire plan is **one phase (P0) = one PR**, merged to `staging` first, verified on the staging deploy, then `staging → main`. The four P1 child flags are declared (family stable) but OFF and unread; **do not start P1 until P0 is merged and green on `staging`**. Use `<FeatureFlag flag="the-issue-client-spine">` semantics (read via `useFeatureFlag`) so production never serves the incomplete spine.

---

## Systemic Improvements (per the plan-writing guide)

**Shared utilities introduced (reused across lanes + future features):**
1. `src/components/client/the-issue/outcomeNoun.ts` — single source for eventConfig → outcome-noun mapping (`eventDisplayName`/`isEventPinned`/`pinnedOutcomeNouns`), promoted out of the inline `ClientDashboard` helpers (UI/UX rule #9 — kills the drift between `ClientDashboard` and the Issue components).
2. `fmtEstimateMoney`/`fmtEstimateRatio` (`src/utils/formatNumbers.ts`) — the estimate-labeled twins of `fmtMoney`/`fmtMoneyFull`; any future estimate surface uses them, never re-rolls banding.
3. `resolveSegmentProfile(ws)` (`server/workspaces.ts`) — the segment sibling to `computeEffectiveTier`, the single authority-resolved representation injected directly into the client surface (authority-layered-fields rule).
4. `server/ga4-snapshots.ts` + `server/the-issue-outcome.ts` — a reusable GA4 daily-snapshot + engagement-anchor substrate (mirrors `roi_snapshots`); any future "since we started" metric reuses it.
5. Zone-aware `hasTemporalLanguage(text, zone)` + `hasBaselineAnchor` — the executable form of a "comparison allowed here, banned there" rule, reusable by any surface needing zone-scoped copy policy.

**New tests (acceptance pins + drift guards):**
- `tests/unit/the-issue-client-flags.test.ts` — a reusable pattern for asserting a *flag family* (declaration + catalog + group + rollout) as a focused, greppable per-feature gate complementing the global `verify:feature-flags` load-time check.
- `tests/contract/the-issue-types.test.ts` — pins the producer/consumer contract for the new shared types (closed-union `@ts-expect-error` guards).
- `tests/integration/the-issue-client-roi-public.test.ts` — exercises the **public** read path (not admin), the specific guard against a fixture-masked serialization regression on a money surface.
- `scripts/verify/the-issue-flag-off-domprobe.ts` — a generic, parameterized flag-OFF byte-identical DOM-probe harness any future flag-gated layout reorder can copy; directly addresses the captured failure mode where design-system/layout batches pass all four code gates while silently regressing the visible surface.

**New pr-check rule (recommended, author with `docs/rules/pr-check-rule-authoring.md`):** a static `evergreen-verdict-zone` rule that flags any string literal passed to a Zone-1 render path (verdict/proof) that matches no `ALLOWED_BASELINE_PATTERNS` anchor — the static twin of the runtime inverse law (so a dateless verdict is caught at PR time, not only in the unit test). Scope it narrowly to `the-issue` files to avoid false positives.

---

## Self-Review Pass (gaps found + fixed inline)

I scanned the fused plan for placeholders, name consistency, and spec-P0 coverage. Findings, all applied above:

1. **Cross-lane drift — RESOLVED (8 items in the drift-resolution table).** The four drafts diverged on: evergreen export names (`BANNED_EVERYWHERE`/`ROLLING_WINDOW_PATTERNS`, `baselineVerdict` arg `outcomeNounPlural`/`outcomeNoun`), `fmtEstimate` vs the two named exports, the GA4 module name (`ga4-snapshots.ts` vs `ga4-conversion-snapshots.ts`) and function signatures (`saveGa4Snapshot(snap)` vs `saveGa4ConversionSnapshot(wsId, {…})`), the public field name (`segmentProfile` vs `resolvedSegmentProfile`), the spine flag prop (`theIssueClientSpine` prop vs internal hook), migration numbers, and the number of AI ops. Each is now pinned to ONE canonical form used identically in every task. D3/D4 were rewritten to the canonical `server/ga4-snapshots.ts` names.

2. **Conditional-hook bug (would have shipped) — FIXED.** Draft B's `theIssueClientSpine ?? useFeatureFlag(...)` short-circuits the hook (Rules-of-Hooks violation). Corrected to call the hook unconditionally first (`const flagValue = useFeatureFlag(...); const spineEnabled = theIssueClientSpine ?? flagValue;`).

3. **Double file ownership — FIXED.** `evergreenCopy.ts` was rewritten by Drafts B, C, and D (three owners). Now sole-owned by **Lane C**; Lane D writes acceptance assertions only; Lane B imports. `server/workspaces.ts` was edited by both A and C — Lane A now pre-commits the `updateWorkspace` Pick widening (C only adds the PATCH boundary in `routes/workspaces.ts`). `server/ai-operation-registry.ts` was edited by both A and C — collapsed to one op in Lane A.

4. **Scope creep into P1 — FIXED.** Draft C6 built an AI segment-derivation op + endpoint, but `the-issue-client-segment-inserts` is a P1 flag (declared OFF). The plan now defers the segment-derivation AI op/endpoint to P1; P0's C6 builds only the outcome-value AI-enrich endpoint + a manual segment confirm/override `FormSelect`. The two AI ops collapse to one (`the-issue-lead-value-enrich`, Lane A).

5. **`outcome_value` column — was implied, now explicit.** Draft A4's note said `outcome_value` needs its own column; the canonical migration `147` now adds **both** `segment_config` and `outcome_value` columns, and A5's lockstep covers both (row/mapper/params/columnMap).

6. **90-day prune could erase the baseline anchor — FIXED.** The `pruneOld` statement now explicitly excludes the earliest (anchor) row, so the engagement baseline survives beyond 90 days (D4's prune test asserts this).

7. **`computeROI` flag gate — was ambiguous, now explicit.** Draft A9 gated on `outcomeValue + GA4` but not the flag; Draft D3 expected flag-gating. Canonicalized: `computeROI` hydrates `outcomeVerdict` only when `isFeatureEnabled('the-issue-client-spine', workspaceId)` AND `outcomeValue` AND a snapshot exist. A9's test now includes the flag-OFF case.

8. **Spec P0 requirement → task coverage (every requirement maps to a task):**
   - Verdict leads (dollar + baseline) → A9, B3, D5 ✓
   - Outcome count band (pinned events) → A6, B4, C3 ✓
   - Money frame un-collapsed + demoted → B5, B6, D6 ✓
   - Ring removed from headline → B3, D5 ✓
   - Content demoted below proof → B6, D6 ✓
   - Flag-OFF byte-identical → B6, D6, D7 ✓
   - Segment toggles → A5, B6 ✓
   - Two-zone evergreen + inverse law → C1, C2, D1 + recommended pr-check rule ✓
   - `OutcomeProvenance` single source, `estimate_ga4` at P0 → A1, A9, D2 ✓
   - GA4 snapshot table + daily cron + backfill → A4, A6, A8, D4 ✓
   - `OutcomeBaseline` engagement-anchored → A2, A6, D2 ✓
   - `Workspace.outcomeValue` + admin input → A3, A5, C4, C5 ✓
   - `ROIData.outcomeVerdict` + public lockstep → A9, A10, D3 ✓
   - `fmtEstimate` banded/one-sig-fig → B1 ✓
   - AI lead-value enrich (Zod, named op) → A7, C6 ✓
   - Flag family declared → A1/D0 ✓
   - **No gap found** after the scope correction (#4 moved P1 items out, leaving P0 fully mapped).

9. **Placeholders scrubbed.** All `0NN` migration numbers resolved to `146`/`147`; the `// adjust to actual insert helper` notes are flagged as adapt-on-implement (the only legitimate runtime-discovery points: the `client-locations` insert export name and any missing GA4-mock accessors — both explicitly called out for the implementing agent to confirm via read-before-write, not guessed).

Plan is internally consistent and complete for P0.
