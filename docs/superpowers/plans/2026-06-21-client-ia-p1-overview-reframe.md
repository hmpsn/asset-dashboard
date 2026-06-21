# Client IA — P1: Overview Reframe + Real Month-over-Month Delta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first phase of the ratified client IA v2 — a real month-over-month delta on the outcome verdict, the typed outcome breakdown surfaced in the hero, and the client's own captured leads surfaced one tap from the outcome count — all behind a new `client-ia-v2` master flag that renders byte-identically when OFF.

**Architecture:** The verdict-first spine (`TheIssueClientPage` spine-ON, gated by `the-issue-client-spine`) already implements the bulk of the tournament's "Overview reframe" (dollar-lead verdict, health ring demoted to "Under the hood", predictions cut, two-speed disclosure). P1 adds the three persona-gut-check-driven enhancements **on top of** that spine, gated by a new master flag `client-ia-v2` so the full P1 reframe can be dark-launched and validated on staging before becoming default. The MoM delta is an additive server field on `ROIData.outcomeVerdict`; everything else is client render gated by the flag.

**Tech Stack:** React 19 + TypeScript (client), Express + better-sqlite3 (server), Vitest (unit/integration/component), feature-flag catalog in `shared/types/feature-flags.ts`.

**Scope source of truth:** `docs/superpowers/audits/2026-06-21-client-ia-preplan-audit.md` (verified file:line scope) + `docs/superpowers/audits/2026-06-21-client-ia-tournament.md` (ratified IA).

**Out of scope (later phases):** the 4-tab nav shell collapse (P2), content→Inbox (P3), Share/Export (P4), multi-location (P5). P1 does NOT move any tab — it only reframes the Overview content.

---

## ⚠️ Owner decision blocking Task 5 only (rest of P1 proceeds without it)

The ratified tournament says **cut** the "Curated by your strategist" byline; the current spine **keeps** it deliberately as the "human-curation moat" ([`IssueVerdictHeadline.tsx:16-19,104-108`](../../../src/components/client/the-issue/IssueVerdictHeadline.tsx)). Task 5 implements the owner's choice. **Plan default if unanswered: keep the byline** (less destructive, reversible; let the built-surface persona review settle it). Tasks 0–4 + 6 do not depend on this.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `shared/types/feature-flags.ts` | Flag catalog | Add `client-ia-v2`, `client-locations` (FEATURE_FLAGS + CATALOG + GROUPS) |
| `shared/types/roi.ts` | Client-facing ROI contract | Add `priorPeriodCount` to `outcomeVerdict` |
| `server/roi.ts` | `computeROI()` + its duplicated local `ROIData` | Add `priorPeriodCount` to the local type AND compute it via prior snapshot; export pure helper `findPriorOutcomeSnapshot` |
| `src/components/client/the-issue/IssueVerdictHeadline.tsx` | Hero verdict (slot 1) | Render MoM clause + typed breakdown row; new `iaV2` prop |
| `src/components/client/the-issue/TheIssueClientPage.tsx` | Spine orchestrator | Read `client-ia-v2`; pass `iaV2` to headline; reposition `IssueYourLeadsSection` (un-bury) when iaV2 |
| `src/components/client/OverviewTab.tsx` | Outcome-count assembly seam | Read `client-ia-v2` + return-hook flags; set `namedRecordsAvailable` truthfully |
| `tests/unit/roi-prior-snapshot.test.ts` *(new)* | Pure MoM helper | Deterministic window logic |
| `tests/integration/the-issue-roi-mom.test.ts` *(new)* | Real read path | `priorPeriodCount` rides `GET /api/public/roi/:id` |
| `tests/component/client/IssueVerdictHeadline.iaV2.test.tsx` *(new)* | Hero render | MoM + typed row appear ON, absent OFF |
| `tests/component/client/TheIssueClientPage.iaV2Leads.test.tsx` *(new)* | Lead positioning | Leads surfaced after count when ON; in under-the-hood when OFF |

**Single-owner seam:** `OverviewTab.tsx` (data assembly). **Separately owned:** `IssueVerdictHeadline.tsx`, `TheIssueClientPage.tsx`. Do not let two parallel workers touch `TheIssueClientPage.tsx` simultaneously (Tasks 3-leads and 5-byline both touch it — sequence them).

---

## Task 0: Declare the IA v2 flags (Phase 0 — commit first, before any consumer)

**Files:**
- Modify: `shared/types/feature-flags.ts` (`FEATURE_FLAGS` ~`:12`, `FEATURE_FLAG_CATALOG` ~`:189`, `FEATURE_FLAG_GROUPS` `:520-553`)
- Test: `tests/unit/feature-flags.test.ts` (existing consistency test must stay green)

- [ ] **Step 1: Run the existing flag consistency test to confirm baseline green**

Run: `npx vitest run tests/unit/feature-flags.test.ts tests/unit/feature-flag-lifecycle.test.ts`
Expected: PASS (before any edit).

- [ ] **Step 2: Add the two keys to `FEATURE_FLAGS`**

In `shared/types/feature-flags.ts`, add to the `FEATURE_FLAGS` object (keep alphabetical/grouped with the other `the-issue` client flags if that's the local convention; otherwise append):

```typescript
  'client-ia-v2': false,
  'client-locations': false,
```

- [ ] **Step 3: Add catalog entries** (in `FEATURE_FLAG_CATALOG`)

```typescript
  'client-ia-v2': {
    label: 'Client dashboard — IA v2 (verdict-first Overview reframe → 4-tab shell)',
    group: 'The Issue (Client)',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-21',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once client IA v2 (P1 Overview reframe through P4) is validated on staging and shipped as the default client dashboard.',
      linkedRoadmapItemId: 'client-dashboard-ia-restructure',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-21',
    },
  },
  'client-locations': {
    label: 'Client dashboard — conditional Locations tab (multi-location track)',
    group: 'The Issue (Client)',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-21',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once the multi-location leaderboard + Locations drill-down (P5) is validated and becomes default for accounts with >1 location.',
      linkedRoadmapItemId: 'client-dashboard-ia-restructure',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-21',
    },
  },
```

- [ ] **Step 4: Add both keys to the `'The Issue (Client)'` group** in `FEATURE_FLAG_GROUPS` (append to the existing `keys` array for that group label).

- [ ] **Step 5: Verify catalog consistency**

Run: `npx vitest run tests/unit/feature-flags.test.ts tests/unit/feature-flag-lifecycle.test.ts && npm run verify:feature-flags`
Expected: PASS — both new keys present in FEATURE_FLAGS + CATALOG + a GROUP, lifecycle fields valid.

- [ ] **Step 6: Commit**

```bash
git add shared/types/feature-flags.ts
git commit -m "feat(client-ia): declare client-ia-v2 + client-locations flags (P1 Phase 0)"
```

---

## Task 1: Server — real month-over-month delta on the outcome verdict

**Files:**
- Modify: `shared/types/roi.ts` (`outcomeVerdict`, `:56-75`)
- Modify: `server/roi.ts` (local `ROIData.outcomeVerdict` `:118-132`; `computeROI` outcome block `:358-400`; add exported helper)
- Test: `tests/unit/roi-prior-snapshot.test.ts` (new), `tests/integration/the-issue-roi-mom.test.ts` (new)

> Note: `ROIData` is declared TWICE (the shared contract in `shared/types/roi.ts` and a local copy in `server/roi.ts:87`). Both `outcomeVerdict` definitions must get the new field or the server object won't type-check against the client contract.

- [ ] **Step 1: Write the failing pure-helper unit test**

Create `tests/unit/roi-prior-snapshot.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { findPriorOutcomeSnapshot } from '../../server/roi.js';
import type { Ga4ConversionSnapshot } from '../../shared/types/the-issue.js';

function snap(daysAgoFromLatest: number, latestIso: string): Ga4ConversionSnapshot {
  const ms = new Date(latestIso).getTime() - daysAgoFromLatest * 24 * 60 * 60 * 1000;
  return {
    workspaceId: 'ws_test',
    capturedAt: new Date(ms).toISOString(),
    totalConversions: 0,
    totalUsers: 0,
    byEvent: [],
  };
}

describe('findPriorOutcomeSnapshot', () => {
  const latest = '2026-06-21T00:00:00.000Z';

  it('returns the snapshot closest to 30 days before latest when inside the 15–45 day window', () => {
    const history = [snap(30, latest), snap(5, latest), snap(0, latest)];
    const result = findPriorOutcomeSnapshot(history, latest);
    expect(result?.capturedAt).toBe(history[0].capturedAt); // the 30-day-prior one
  });

  it('returns null when the nearest candidate is outside the window (e.g. only a 5-day-old snapshot)', () => {
    const history = [snap(5, latest), snap(0, latest)];
    expect(findPriorOutcomeSnapshot(history, latest)).toBeNull();
  });

  it('never returns the latest snapshot itself', () => {
    const history = [snap(0, latest)];
    expect(findPriorOutcomeSnapshot(history, latest)).toBeNull();
  });

  it('accepts a snapshot 44 days prior (just inside the window) and rejects 46 days', () => {
    expect(findPriorOutcomeSnapshot([snap(44, latest)], latest)).not.toBeNull();
    expect(findPriorOutcomeSnapshot([snap(46, latest)], latest)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/roi-prior-snapshot.test.ts`
Expected: FAIL — `findPriorOutcomeSnapshot is not a function`.

- [ ] **Step 3: Add the field to both `outcomeVerdict` definitions**

In `shared/types/roi.ts` `outcomeVerdict` (after `baselineDeltaCount`, `:63`):

```typescript
    /**
     * P1 (IA v2): outcome count for the previous comparable 30-day period — the snapshot closest to
     * 30 days before the latest, within a 15–45 day window. null when no qualifying prior snapshot
     * exists (the client then shows the honest "establishing your trend" line, never a fabricated
     * delta). The month-over-month delta is `outcomeCount − priorPeriodCount`.
     */
    priorPeriodCount: number | null;
```

Apply the identical field + JSDoc to the local copy in `server/roi.ts` `outcomeVerdict` (after `baselineDeltaCount`, `:125`).

- [ ] **Step 4: Add the exported helper to `server/roi.ts`**

Add near `computeGrowthPercent` (after `:85`). Import the snapshot type at the top alongside the existing `the-issue` type import (`:21`): add `Ga4ConversionSnapshot` to that import list.

```typescript
/**
 * The GA4 conversion snapshot closest to 30 days before `latestCapturedAt`, but only if it lands
 * within the 15–45-day window (mirrors computeGrowthPercent's guard so MoM is apples-to-apples and
 * never anchored to a too-recent or too-stale snapshot). Excludes the latest snapshot itself.
 * Returns null when nothing qualifies — caller surfaces the honest "establishing" state.
 */
export function findPriorOutcomeSnapshot(
  history: Ga4ConversionSnapshot[],
  latestCapturedAt: string,
): Ga4ConversionSnapshot | null {
  const target = new Date(latestCapturedAt).getTime() - 30 * 24 * 60 * 60 * 1000;
  let closest: Ga4ConversionSnapshot | null = null;
  let closestDiff = Infinity;
  for (const s of history) {
    if (s.capturedAt === latestCapturedAt) continue;
    const diff = Math.abs(new Date(s.capturedAt).getTime() - target);
    if (diff < closestDiff) { closest = s; closestDiff = diff; }
  }
  if (!closest) return null;
  // closestDiff is distance from the 30-day mark; ≤15 days ⇒ snapshot is 15–45 days before latest.
  return closestDiff <= 15 * 24 * 60 * 60 * 1000 ? closest : null;
}
```

- [ ] **Step 5: Run the unit test — verify it passes**

Run: `npx vitest run tests/unit/roi-prior-snapshot.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 6: Wire it into `computeROI`**

In `server/roi.ts`, inside the `if (latest) {` block (`:361`), after `const baselineDeltaCount = …` (`:364-367`), add:

```typescript
      // P1 (IA v2): real month-over-month — re-aggregate the SAME pinned outcomes from the prior
      // snapshot so the delta is apples-to-apples. null when no snapshot lands in the window.
      const priorSnapshot = findPriorOutcomeSnapshot(history, latest.capturedAt);
      const priorPeriodCount = priorSnapshot
        ? aggregatePinnedOutcomes(ws, priorSnapshot.byEvent).totalConversions
        : null;
```

Then add `priorPeriodCount,` to the `result.outcomeVerdict = { … }` object literal (`:379-388`), alongside `baselineDeltaCount`.

- [ ] **Step 7: Write the failing integration test (real read path)**

Create `tests/integration/the-issue-roi-mom.test.ts`. First confirm the exact GA4-snapshot write helper and client-ROI auth:

Run: `grep -nE 'export function (save|insert|upsert|record).*[Ss]napshot' server/ga4-snapshots.ts` and `grep -n 'public/roi' server/routes/stripe.ts`

Then author the test using `createEphemeralTestContext(import.meta.url)`: seed a workspace with `outcomeValue` set, enable `the-issue-client-spine`, write two GA4 conversion snapshots (one stamped ~30 days before the other, each with a pinned key-event in `byEvent`), authenticate the client portal, and assert:

```typescript
// ... after seeding 2 snapshots (prior: 5 conversions @ ~30d ago, current: 12 conversions today)
const res = await fetch(`${baseUrl}/api/public/roi/${workspaceId}`, { headers: clientAuthHeaders });
expect(res.status).toBe(200);
const roi = await res.json();
expect(roi.outcomeVerdict).toBeTruthy();
expect(roi.outcomeVerdict.priorPeriodCount).toBe(5);
expect(roi.outcomeVerdict.outcomeCount - roi.outcomeVerdict.priorPeriodCount).toBe(7); // +7 MoM

// Single-snapshot account → honest null, never fabricated
// (seed a second workspace with only one snapshot)
const res2 = await fetch(`${baseUrl}/api/public/roi/${workspaceId2}`, { headers: clientAuthHeaders2 });
const roi2 = await res2.json();
expect(roi2.outcomeVerdict.priorPeriodCount).toBeNull();
```

Use the established integration helpers (`tests/integration/helpers.ts`, `seedWorkspace().cleanup()`); model auth + seeding on an existing `the-issue` integration test (e.g. `tests/integration/the-issue-conversion-webhook.test.ts`).

- [ ] **Step 8: Run the integration test**

Run: `npx vitest run tests/integration/the-issue-roi-mom.test.ts`
Expected: PASS — `priorPeriodCount` rides the public ROI payload; null on the single-snapshot account.

- [ ] **Step 9: Commit**

```bash
git add shared/types/roi.ts server/roi.ts tests/unit/roi-prior-snapshot.test.ts tests/integration/the-issue-roi-mom.test.ts
git commit -m "feat(client-ia): real month-over-month outcome delta on the verdict (P1)"
```

---

## Task 2: Client — month-over-month clause in the hero verdict

**Files:**
- Modify: `src/components/client/the-issue/IssueVerdictHeadline.tsx`
- Modify: `src/components/client/the-issue/TheIssueClientPage.tsx` (read flag, pass prop)
- Test: `tests/component/client/IssueVerdictHeadline.iaV2.test.tsx` (new)

- [ ] **Step 1: Write the failing component test**

Create `tests/component/client/IssueVerdictHeadline.iaV2.test.tsx`. Render `IssueVerdictHeadline` with a `verdict` whose `baseline.state === 'ready'`, `outcomeCount: 12`, `priorPeriodCount: 5`, and assert:
- with `iaV2` ON → text matching `/7 .*vs last month/i` is present;
- with `iaV2` OFF → no `vs last month` text (byte-identical to today);
- with `iaV2` ON but `priorPeriodCount: null` → an "establishing" month-over-month line, NOT a number.

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { IssueVerdictHeadline } from '../../../src/components/client/the-issue/IssueVerdictHeadline';
import type { ROIData } from '../../../shared/types/roi';

const base: NonNullable<ROIData['outcomeVerdict']> = {
  outcomeCount: 12, outcomeUnitLabel: 'new patients', valuePerOutcome: 800,
  estimatedValue: 9600, monthlyRetainer: 2000,
  baseline: { engagementStart: '2026-01-01T00:00:00Z', baselineConversions: 4, baselineCapturedAt: '2026-01-01T00:00:00Z', state: 'ready' },
  baselineDeltaCount: 8, provenance: 'estimate_ga4', priorPeriodCount: 5,
};

describe('IssueVerdictHeadline — IA v2 MoM', () => {
  it('shows the month-over-month delta when iaV2 ON', () => {
    render(<IssueVerdictHeadline verdict={base} iaV2 />);
    expect(screen.getByText(/7\b.*vs last month/i)).toBeInTheDocument();
  });
  it('hides the MoM clause when iaV2 OFF (byte-identical)', () => {
    render(<IssueVerdictHeadline verdict={base} />);
    expect(screen.queryByText(/vs last month/i)).toBeNull();
  });
  it('shows the establishing line, never a fabricated delta, when priorPeriodCount is null', () => {
    render(<IssueVerdictHeadline verdict={{ ...base, priorPeriodCount: null }} iaV2 />);
    expect(screen.getByText(/establishing your month-over-month/i)).toBeInTheDocument();
    expect(screen.queryByText(/vs last month/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/component/client/IssueVerdictHeadline.iaV2.test.tsx`
Expected: FAIL — `iaV2` prop unknown / MoM text absent.

- [ ] **Step 3: Add the `iaV2` prop + MoM render**

In `IssueVerdictHeadline.tsx`, extend props (`:39-44`):

```typescript
interface IssueVerdictHeadlineProps {
  verdict: OutcomeVerdict | null;
  topRec?: Recommendation | null;
  /** P1 (IA v2): when true, render the month-over-month clause + typed breakdown row. */
  iaV2?: boolean;
}
```

Destructure `iaV2 = false` in the signature (`:46`). Compute the delta near the other derived values (`:54-61`):

```typescript
  const momDelta = iaV2 && verdict != null && verdict.priorPeriodCount != null
    ? verdict.outcomeCount - verdict.priorPeriodCount
    : null;
```

Render inside the `verdict != null` branch, immediately after the dollar-lead `</div>` (`:89`), before the verdict sentence:

```tsx
          {iaV2 && verdict != null && (
            momDelta != null ? (
              <p data-testid="verdict-mom" className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">
                {momDelta > 0 ? '↑ ' : momDelta < 0 ? '↓ ' : '→ '}
                {Math.abs(momDelta).toLocaleString()} {verdict.outcomeUnitLabel} vs last month
              </p>
            ) : (
              <p data-testid="verdict-mom" className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">
                Establishing your month-over-month trend
              </p>
            )
          )}
```

- [ ] **Step 4: Run the component test — verify it passes**

Run: `npx vitest run tests/component/client/IssueVerdictHeadline.iaV2.test.tsx`
Expected: PASS.

- [ ] **Step 5: Thread the flag through `TheIssueClientPage`**

In `TheIssueClientPage.tsx`, add the test-override prop (after `theIssueReturnHook`, `:104`):

```typescript
  /** P1 (IA v2) — test override for the client-ia-v2 flag. When provided, overrides useFeatureFlag. */
  iaV2?: boolean;
```

Destructure it in the signature (`:125`). Read the flag unconditionally with the other flag reads (`:144`):

```typescript
  const iaV2Flag = useFeatureFlag('client-ia-v2');
  const iaV2Enabled = iaV2 ?? iaV2Flag;
```

Pass it to the headline (`:215`): `<IssueVerdictHeadline verdict={resolvedVerdict ?? null} topRec={topRec} iaV2={iaV2Enabled} />`.

- [ ] **Step 6: Build + commit**

Run: `npm run typecheck && npx vitest run tests/component/client/IssueVerdictHeadline.iaV2.test.tsx`
Expected: PASS.

```bash
git add src/components/client/the-issue/IssueVerdictHeadline.tsx src/components/client/the-issue/TheIssueClientPage.tsx tests/component/client/IssueVerdictHeadline.iaV2.test.tsx
git commit -m "feat(client-ia): month-over-month clause in the hero verdict (P1)"
```

---

## Task 3: Client — typed outcome breakdown surfaced in the hero

**Files:**
- Modify: `src/components/client/the-issue/IssueVerdictHeadline.tsx`
- Test: extend `tests/component/client/IssueVerdictHeadline.iaV2.test.tsx`

> The data (`verdict.outcomeTypeBreakdown`) is already assembled server-side when measured-capture is ON ([`server/roi.ts:392-393`](../../../server/roi.ts)). This task only renders it in the hero so the dentist sees "41 calls · 12 form fills" instead of a blended count.

- [ ] **Step 1: Add the failing test case** to `IssueVerdictHeadline.iaV2.test.tsx`:

```typescript
  it('renders the typed breakdown row in the hero when iaV2 ON and breakdown present', () => {
    const withTypes = { ...base, outcomeTypeBreakdown: [
      { outcomeType: 'call' as const, label: 'calls', current: 41, baseline: null, priorPeriod: null },
      { outcomeType: 'form_fill' as const, label: 'form fills', current: 12, baseline: null, priorPeriod: null },
    ]};
    render(<IssueVerdictHeadline verdict={withTypes} iaV2 />);
    const row = screen.getByTestId('verdict-type-breakdown');
    expect(row).toHaveTextContent(/41\s*calls/i);
    expect(row).toHaveTextContent(/12\s*form fills/i);
  });
  it('omits the typed row when iaV2 OFF', () => {
    const withTypes = { ...base, outcomeTypeBreakdown: [
      { outcomeType: 'call' as const, label: 'calls', current: 41, baseline: null, priorPeriod: null },
    ]};
    render(<IssueVerdictHeadline verdict={withTypes} />);
    expect(screen.queryByTestId('verdict-type-breakdown')).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/component/client/IssueVerdictHeadline.iaV2.test.tsx`
Expected: FAIL — `verdict-type-breakdown` not found.

- [ ] **Step 3: Render the typed row**

In `IssueVerdictHeadline.tsx`, inside the `verdict != null` branch, after the verdict sentence `</p>` (`:95`) and before the provenance disclosure (`:96`):

```tsx
          {iaV2 && verdict.outcomeTypeBreakdown && verdict.outcomeTypeBreakdown.length > 0 && (
            <div data-testid="verdict-type-breakdown" className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {verdict.outcomeTypeBreakdown.map((b) => (
                <span key={b.outcomeType} className="t-caption-sm text-[var(--brand-text)]">
                  <span className="text-accent-success font-medium">{b.current.toLocaleString()}</span> {b.label}
                </span>
              ))}
            </div>
          )}
```

(`text-accent-success` = emerald per the $/success law; no new hue, tokens only.)

- [ ] **Step 4: Run the test — verify pass**

Run: `npx vitest run tests/component/client/IssueVerdictHeadline.iaV2.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/client/the-issue/IssueVerdictHeadline.tsx tests/component/client/IssueVerdictHeadline.iaV2.test.tsx
git commit -m "feat(client-ia): typed outcome breakdown in the hero verdict (P1, dentist gut-check)"
```

---

## Task 4: Client — surface the named-lead list one tap from the outcome count

**Files:**
- Modify: `src/components/client/the-issue/TheIssueClientPage.tsx` (reposition `IssueYourLeadsSection`)
- Modify: `src/components/client/OverviewTab.tsx` (truthful `namedRecordsAvailable`)
- Test: `tests/component/client/TheIssueClientPage.iaV2Leads.test.tsx` (new)

> Today `IssueYourLeadsSection` is mounted only inside the collapsed "Under the hood" block ([`TheIssueClientPage.tsx:328-332`](../../../src/components/client/the-issue/TheIssueClientPage.tsx)). The check-signer wants the "receipts" one tap from the count. When iaV2 ON, mount it directly after the outcome-count slot (slot 2.5) and remove it from under-the-hood (no duplication). When OFF, keep current behavior (byte-identical).

- [ ] **Step 1: Write the failing component test**

Create `tests/component/client/TheIssueClientPage.iaV2Leads.test.tsx`. Render `TheIssueClientPage` with `theIssueClientSpine` and `theIssueReturnHook` overrides ON, `outcomeCount` non-empty, and assert the `IssueYourLeadsSection` (its testid — confirm via `grep -n data-testid src/components/client/the-issue/IssueYourLeadsSection.tsx`) renders. With `iaV2` ON, assert it appears in document order BEFORE the "Under the hood" `<details>` summary; with `iaV2` OFF, assert it appears only inside `<details>` (after the summary). Mock the data hooks (`useClientROI`, `useClientTheIssue`, `useClientMyLeads`, etc.) as the existing `the-issue` component tests do.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/component/client/TheIssueClientPage.iaV2Leads.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Reposition the leads section under iaV2**

In `TheIssueClientPage.tsx` spine-ON branch, after the outcome-count slot `</ErrorBoundary>` (`:238`), add:

```tsx
          {/* 2.5 Your leads — surfaced directly under the count when IA v2 (the check-signer's
              "show me the N people behind these numbers"). Gated on the return-hook flag; suppressed
              in admin preview (client PII is not the operator's). When iaV2 OFF this stays in the
              collapsed "Under the hood" block below (byte-identical). */}
          {iaV2Enabled && exportEnabled && !previewMode && (
            <ErrorBoundary label="Your captured leads">
              <IssueYourLeadsSection workspaceId={workspaceId} />
            </ErrorBoundary>
          )}
```

Then guard the existing under-the-hood mount (`:328`) so it only renders when iaV2 is OFF (prevents double-mount):

```tsx
                {!iaV2Enabled && exportEnabled && !previewMode && (
                  <ErrorBoundary label="Your captured leads">
                    <IssueYourLeadsSection workspaceId={workspaceId} />
                  </ErrorBoundary>
                )}
```

- [ ] **Step 4: Make `namedRecordsAvailable` truthful**

In `OverviewTab.tsx`, add two unconditional flag reads beside `measuredCapture` (`:127`):

```typescript
  const iaV2 = useFeatureFlag('client-ia-v2');
  const returnHookEnabled = useFeatureFlag('the-issue-client-return-hook');
```

Then in the `outcomeCount` object (`:185`), replace the hardcoded `namedRecordsAvailable: false` with:

```typescript
      // Names ARE available below when IA v2 surfaces the leads section + the return-hook is on.
      // Flag-OFF this stays false so the honest "names available with tracking" upsell is unchanged.
      namedRecordsAvailable: iaV2 && returnHookEnabled,
```

(When true, `OutcomeCountBand` hides the "Names available with call & CRM tracking" upsell — correct, because the named list now renders right below it.)

- [ ] **Step 5: Run the component test — verify pass**

Run: `npx vitest run tests/component/client/TheIssueClientPage.iaV2Leads.test.tsx`
Expected: PASS — leads above the fold (before under-the-hood) when iaV2 ON; inside under-the-hood when OFF; never both.

- [ ] **Step 6: Commit**

```bash
git add src/components/client/the-issue/TheIssueClientPage.tsx src/components/client/OverviewTab.tsx tests/component/client/TheIssueClientPage.iaV2Leads.test.tsx
git commit -m "feat(client-ia): surface captured leads one tap from the outcome count (P1, check-signer gut-check)"
```

---

## Task 5: Owner decision — the "Curated by your strategist" byline

**Files (only if owner chooses CUT):** `src/components/client/the-issue/IssueVerdictHeadline.tsx` (`:104-108`), `src/components/client/the-issue/TheIssueClientPage.tsx` (spine-OFF byline `:359-362`)

- [ ] **Step 1: Confirm the owner's choice** (see the ⚠️ note at the top). Default = KEEP → this task is a no-op; record the decision in the PR description and skip to Task 6.

- [ ] **Step 2 (only if CUT): gate the byline behind `iaV2`** rather than deleting it outright (preserves the OFF-path moat, removes it only in IA v2). In `IssueVerdictHeadline.tsx`, wrap the byline block (`:104-108`) in `{!iaV2 && ( … )}`. Leave the spine-OFF copy (`TheIssueClientPage.tsx:359-362`) untouched (that path predates IA v2). Add a test case: byline absent when `iaV2` ON, present when OFF.

- [ ] **Step 3 (only if CUT): run the headline test + commit**

```bash
git add src/components/client/the-issue/IssueVerdictHeadline.tsx tests/component/client/IssueVerdictHeadline.iaV2.test.tsx
git commit -m "feat(client-ia): drop strategist byline in IA v2 hero per ratified tournament (P1)"
```

---

## Task 6: Verification gate (run before PR)

- [ ] **Step 1: Flag-OFF byte-identical parity**

The existing `the-issue` component tests render the spine with `client-ia-v2` unset (OFF). Confirm none of them changed output:
Run: `npx vitest run tests/component/client/`
Expected: PASS — every pre-existing spine test still passes (proves OFF-path parity).

- [ ] **Step 2: Flag-ON real read path smoke** — covered by `tests/integration/the-issue-roi-mom.test.ts` (Task 1) exercising `GET /api/public/roi/:id`.

- [ ] **Step 3: Full quality gate**

Run, expecting all PASS / zero errors:
```bash
npm run typecheck
npx vite build
npx vitest run
npx tsx scripts/pr-check.ts
npm run lint:hooks
npm run verify:feature-flags
npm run verify:coverage-ratchet
```

- [ ] **Step 4: Scaled review** — if any of Tasks 1–5 were implemented by parallel subagents, invoke the `scaled-code-review` skill; fix Critical/Important before PR. Otherwise `superpowers:requesting-code-review`.

- [ ] **Step 5: Docs** — update `FEATURE_AUDIT.md` (IA v2 P1 entry), `data/roadmap.json` (`client-dashboard-ia-restructure` → P1 done + notes; run `npx tsx scripts/sort-roadmap.ts`), and `BRAND_DESIGN_LANGUAGE.md` only if the hero's visual treatment changed.

- [ ] **Step 6: Open the P1 PR into `staging`** (phase-per-PR). Do NOT start P2 until P1 is merged and CI is green on staging. PR body must state the byline decision (Task 5) and that `client-ia-v2` ships OFF (dark-launch), to be flipped on staging for validation.

---

## Self-Review (completed by plan author)

- **Spec coverage:** tournament P1 items mapped — MoM delta (Task 1-2), typed hero (Task 3, dentist), clickable/surfaced leads (Task 4, check-signer), health-ring demote + predictions cut + two-speed = **already in the spine** (no task needed; noted in Architecture), byline = Task 5 (owner). Outcome-language CTAs: the spine's `IssueContentPlanSection` already drives the action surface; no copy regression in P1 scope — deferred to P2 nav work.
- **Placeholder scan:** one deliberate grep step each in Task 1 Step 7 (GA4 snapshot writer name) and Task 4 Step 1 (leads testid) — the helper/testid names are environment facts to confirm, not invented code; all rendered/logic code is complete and exact.
- **Type consistency:** `iaV2` prop named identically across `IssueVerdictHeadline` and `TheIssueClientPage`; `priorPeriodCount` added to BOTH `ROIData.outcomeVerdict` definitions (shared + server local copy) — the #1 silent-failure trap for this file pair. `findPriorOutcomeSnapshot` signature consistent between the unit test, the export, and the `computeROI` call site.
- **Flag-OFF parity:** every visible change is gated by `iaV2`/`iaV2Enabled`; the leads section is moved (not duplicated) via the `!iaV2Enabled` guard on the under-the-hood mount.

---

## Execution Handoff

Plan saved. Two execution options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks. Tasks 1 (server) and 2-3 (headline) can pipeline; Task 4 and Task 5 both touch `TheIssueClientPage.tsx` so they must be sequenced, not parallel.
2. **Inline Execution** — execute in-session with checkpoints.

Phase-per-PR: this plan is P1 only. P2 (4-tab nav shell) is planned after P1 merges green on staging.
