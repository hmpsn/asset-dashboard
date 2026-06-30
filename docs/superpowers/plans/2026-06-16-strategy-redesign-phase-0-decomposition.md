# Strategy Redesign — Phase 0: Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break the 1064-line `src/components/KeywordStrategy.tsx` into a thin orchestrator + focused hooks + presentational leaf components, with **zero behavior change** — the page renders identically, in the same order.

**Architecture:** Extract four cohesive logic clusters into hooks (`useStrategyMetrics`, `useStrategySettings`, `useStrategyGeneration`, `useTrackKeyword`) plus a small `useKeywordFeedback` hook, and extract eleven inline JSX blocks into presentational leaf components under `src/components/strategy/`. The orchestrator (`KeywordStrategyPanel`) keeps the same JSX order, now composed of imported leaves driven by the hooks. No band reordering, no feature flag — that is Phase 1.

**Tech Stack:** React 19, TypeScript (strict), React Query, Vitest (`test:component` / `test:unit`), existing `src/components/ui` primitives.

**Spec:** `docs/superpowers/specs/2026-06-16-strategy-page-decision-first-redesign-design.md`

**Parallelism model:** Tasks marked `[PARALLEL]` create independent new files (one owner each) and can be dispatched concurrently after Task 0 (contracts) lands. The orchestrator rewrite (Task 16) is the integration barrier — controller-only, after all leaves/hooks exist. Workers never run git writes; the controller commits per task. Run `scaled-code-review` after the parallel batch before Task 16.

---

## File Structure

**Create:**
- `src/components/strategy/types.ts` — `PageKeywordMap` (moved from orchestrator) + `StrategyMetrics` + shared leaf prop types
- `src/components/strategy/hooks/useStrategyMetrics.ts` — pure derived metrics
- `src/components/strategy/hooks/useStrategySettings.ts` — settings state + sync effects + `buildStrategyGenerationParams`
- `src/components/strategy/hooks/useStrategyGeneration.ts` — job orchestration (start/regen/refresh, completion effects)
- `src/components/strategy/hooks/useTrackKeyword.ts` — tracking state + `trackKeyword`
- `src/components/strategy/hooks/useKeywordFeedback.ts` — feedback rows + add-to-strategy mutation + add error
- `src/components/strategy/StrategyHeader.tsx`
- `src/components/strategy/StrategyFeedbackNudge.tsx`
- `src/components/strategy/ClientKeywordFeedback.tsx`
- `src/components/strategy/StrategySettings.tsx`
- `src/components/strategy/StrategyStalenessNudges.tsx`
- `src/components/strategy/StrategyEmptyState.tsx`
- `src/components/strategy/StrategyStatGrid.tsx`
- `src/components/strategy/RankingDistribution.tsx`
- `src/components/strategy/SiteTargetKeywords.tsx`
- `src/components/strategy/KeywordOpportunities.tsx`
- `src/components/strategy/StrategyHowItWorks.tsx`
- `src/components/strategy/index.ts` — barrel (controller-owned)
- Test files: one `*.test.tsx` (component) or `*.test.ts` (hook) per file above, under `tests/unit/strategy/`

**Modify:**
- `src/components/KeywordStrategy.tsx` — becomes the thin orchestrator (Task 16)

**Do NOT touch in Phase 0:** the already-extracted components (`QuickWins`, `LowHangingFruit`, `ContentGaps`, `KeywordGaps`, `TopicClusters`, `CannibalizationAlert`, `StrategyDiff`, `BacklinkProfile`, `CompetitiveIntel`, `IntelligenceSignals`, `KeywordStrategyGuide`, `RefreshOrderingPrompt`, `LocalSeoVisibilityPanel`) — they are imported and rendered exactly as today.

---

## Pre-flight contracts (the shared interfaces every parallel worker codes against)

These are committed in **Task 0** before any leaf/hook task is dispatched. They are the authority — workers import these types, they do not redefine them.

`src/components/strategy/types.ts`:

```typescript
import type { MetricsSource } from '../../../shared/types/keywords.js';
import type { AdminKeywordFeedbackListRow } from '../../../shared/types/keyword-feedback';

/** Page→keyword mapping row as rendered by the Strategy page. Moved verbatim from KeywordStrategy.tsx. */
export interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  metricsSource?: MetricsSource;
  validated?: boolean;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

/** Derived metrics computed from a strategy + feedback rows. Pure function of inputs. */
export interface StrategyMetrics {
  pageMap: PageKeywordMap[];
  filteredPageMap: PageKeywordMap[];
  ranked: PageKeywordMap[];
  avgPos: number;
  totalImpressions: number;
  totalClicks: number;
  top3: PageKeywordMap[];
  top10: PageKeywordMap[];
  top20: PageKeywordMap[];
  beyond20: PageKeywordMap[];
  notRankingCount: number;
  lowHangingFruit: PageKeywordMap[];
  intentCounts: Record<string, number>;
  declinedFeedback: AdminKeywordFeedbackListRow[];
  requestedFeedback: AdminKeywordFeedbackListRow[];
  approvedFeedback: AdminKeywordFeedbackListRow[];
  feedbackNewerThanStrategy: boolean;
}

/** Minimum monthly search volume to display a strategy card. Below this is noise. */
export const VOLUME_THRESHOLD = 10;
```

The component Props interfaces (also in `types.ts`, or co-located in each component file — choose co-located to keep each leaf self-contained, but the orchestrator-facing shape must match these exactly):

```typescript
// StrategyHeader
export interface StrategyHeaderProps {
  isRealStrategy: boolean;
  generatedAt: string | null | undefined;
  pageCount: number;
  generating: boolean;
  localSyncApplies: boolean;
  localNeedsRefresh: boolean;
  refreshPending: boolean;
  onIncremental: () => void;
  onFullRefresh: () => void;
  onGenerate: () => void;
}

// StrategyFeedbackNudge
export interface StrategyFeedbackNudgeProps {
  requestedCount: number;
  declinedCount: number;
}

// ClientKeywordFeedback
export interface ClientKeywordFeedbackProps {
  rows: AdminKeywordFeedbackListRow[];
  requested: AdminKeywordFeedbackListRow[];
  declined: AdminKeywordFeedbackListRow[];
  approved: AdminKeywordFeedbackListRow[];
  addPending: boolean;
  addError: string | null;
  onAdd: (keyword: string) => void;
  onDismissError: () => void;
}

// StrategySettings — receives the full settings bundle from useStrategySettings
export interface StrategySettingsProps {
  workspaceId: string;
  isAuxLoading: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  seoDataAvailable: boolean;
  seoDataMode: 'none' | 'quick' | 'full';
  setSeoDataMode: (m: 'none' | 'quick' | 'full') => void;
  maxPages: number;
  setMaxPages: (n: number) => void;
  competitors: string;
  setCompetitors: (v: string) => void;
  businessContext: string;
  setBusinessContext: (v: string) => void;
  contextOpen: boolean;
  setContextOpen: (v: boolean) => void;
  discoveringCompetitors: boolean;
  discoverError: string | null;
  onDiscoverCompetitors: () => void;
}

// StrategyStalenessNudges
export interface StrategyStalenessNudgesProps {
  hasVolumeValidation: boolean;
  localSyncApplies: boolean;
  strategyStaleVsLocal: boolean;
  lastLocalRefreshAt: string | null | undefined;
  lastStrategyGeneratedAt: string | null | undefined;
  dismissedRefreshAt: string | null;
  onDismiss: () => void;
  onGenerate: () => void;
}

// StrategyStatGrid
export interface StrategyStatGridProps {
  filteredPageMap: PageKeywordMap[];
  totalPageCount: number;
  totalImpressions: number;
  totalClicks: number;
  ranked: PageKeywordMap[];
  avgPos: number;
}

// RankingDistribution
export interface RankingDistributionProps {
  filteredPageMap: PageKeywordMap[];
  ranked: PageKeywordMap[];
  top3: PageKeywordMap[];
  top10: PageKeywordMap[];
  top20: PageKeywordMap[];
  beyond20: PageKeywordMap[];
  notRankingCount: number;
  intentCounts: Record<string, number>;
}

// SiteTargetKeywords
export interface SiteTargetKeywordsProps {
  workspaceId: string;
  siteKeywords: string[];
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
  trackedKeywords: Set<string>;
  trackingPending: Set<string>;
  trackingErrors: Map<string, string>;
  onTrack: (kw: string) => void;
}

// KeywordOpportunities
export interface KeywordOpportunitiesProps {
  opportunities: string[];
}

// StrategyHowItWorks
export interface StrategyHowItWorksProps {
  displayedSeoDataMode: 'none' | 'quick' | 'full' | undefined;
  hasAnyRanking: boolean;
}
```

> Note: `StrategyHeader`, `ClientKeywordFeedback`, and `StrategySettings` also need the small helper functions currently inline in the orchestrator. `intentColor` (lines 292-300) is passed to `ContentGaps` and used by the stat/intent rendering — keep `intentColor` in the orchestrator and pass it where needed (it is already passed to `ContentGaps` as a prop). `defaultSeoDataProvider` (lines 46-50) moves into `useStrategySettings`.

---

### Task 0: Pre-commit shared contracts [controller]

**Files:**
- Create: `src/components/strategy/types.ts`
- Create: `src/components/strategy/index.ts` (empty barrel with a header comment; populated as files land)

- [ ] **Step 1: Create `types.ts`** with the exact content from the "Pre-flight contracts" section above (the `PageKeywordMap`, `StrategyMetrics`, `VOLUME_THRESHOLD`, and all `*Props` interfaces).

- [ ] **Step 2: Create the barrel** `src/components/strategy/index.ts`:

```typescript
export * from './types';
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no consumers yet; types are self-contained).

- [ ] **Step 4: Commit**

```bash
git add src/components/strategy/types.ts src/components/strategy/index.ts
git commit -m "refactor(strategy): pre-commit Phase 0 shared contracts (types + props interfaces)"
```

---

### Task 1: `useStrategyMetrics` hook [PARALLEL]

**Files:**
- Create: `src/components/strategy/hooks/useStrategyMetrics.ts`
- Test: `tests/unit/strategy/useStrategyMetrics.test.ts`

Source of truth: orchestrator lines 303-342 (the derived computations + feedback splits + `feedbackNewerThanStrategy`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStrategyMetrics } from '../../../src/components/strategy/hooks/useStrategyMetrics';

const baseStrategy = {
  generatedAt: '2026-01-01T00:00:00Z',
  pageMap: [
    { pagePath: '/a', pageTitle: 'A', primaryKeyword: 'a', secondaryKeywords: [], currentPosition: 2, impressions: 100, clicks: 10, volume: 50 },
    { pagePath: '/b', pageTitle: 'B', primaryKeyword: 'b', secondaryKeywords: [], currentPosition: 8, impressions: 200, clicks: 5, volume: 50, searchIntent: 'commercial' },
    { pagePath: '/c', pageTitle: 'C', primaryKeyword: 'c', secondaryKeywords: [], volume: 1 }, // below VOLUME_THRESHOLD
  ],
};

describe('useStrategyMetrics', () => {
  it('filters by volume threshold and computes ranking tiers', () => {
    const { result } = renderHook(() => useStrategyMetrics(baseStrategy as any, [], true));
    expect(result.current.filteredPageMap).toHaveLength(2); // /c dropped
    expect(result.current.top3.map(p => p.pagePath)).toEqual(['/a']);
    expect(result.current.top10.map(p => p.pagePath)).toEqual(['/b']);
    expect(result.current.totalClicks).toBe(15);
    expect(result.current.totalImpressions).toBe(300);
  });

  it('flags feedbackNewerThanStrategy when a requested row postdates generation', () => {
    const rows = [{ keyword: 'x', status: 'requested', created_at: '2026-02-01T00:00:00Z', updated_at: null }];
    const { result } = renderHook(() => useStrategyMetrics(baseStrategy as any, rows as any, true));
    expect(result.current.feedbackNewerThanStrategy).toBe(true);
    expect(result.current.requestedFeedback).toHaveLength(1);
  });

  it('never flags newer-feedback when no real strategy', () => {
    const rows = [{ keyword: 'x', status: 'requested', created_at: '2026-02-01T00:00:00Z', updated_at: null }];
    const { result } = renderHook(() => useStrategyMetrics({ ...baseStrategy, generatedAt: null } as any, rows as any, false));
    expect(result.current.feedbackNewerThanStrategy).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/strategy/useStrategyMetrics.test.ts`
Expected: FAIL — "Cannot find module .../useStrategyMetrics".

- [ ] **Step 3: Implement the hook** by moving orchestrator lines 303-342 into a `useMemo`. Signature: `useStrategyMetrics(strategy: StrategyOutput | null, keywordFeedbackRows: AdminKeywordFeedbackListRow[], isRealStrategy: boolean): StrategyMetrics`. Use the `StrategyOutput` type already imported by `useKeywordStrategy` (import it from the same shared types module the hook uses; if unavailable, accept `strategy: { pageMap?: PageKeywordMap[]; generatedAt?: string | null } | null` — match the orchestrator's current loose access). Wrap the whole computation in `useMemo` keyed on `[strategy, keywordFeedbackRows, isRealStrategy]`. Return the `StrategyMetrics` object. `VOLUME_THRESHOLD` comes from `../types`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/strategy/useStrategyMetrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/strategy/hooks/useStrategyMetrics.ts tests/unit/strategy/useStrategyMetrics.test.ts
git commit -m "refactor(strategy): extract useStrategyMetrics hook"
```

---

### Task 2: `useStrategySettings` hook [PARALLEL]

**Files:**
- Create: `src/components/strategy/hooks/useStrategySettings.ts`
- Test: `tests/unit/strategy/useStrategySettings.test.ts`

Source of truth: orchestrator lines 46-50 (`defaultSeoDataProvider`), 95-103 (settings `useState`), 114-116 (`selectedSeoDataProvider`), 164-203 (the three sync effects + `buildStrategyGenerationParams`), 671-697 (the discover-competitors handler).

**Returned bundle:** `{ businessContext, setBusinessContext, contextOpen, setContextOpen, seoDataAvailable, seoDataMode, setSeoDataMode, maxPages, setMaxPages, competitors, setCompetitors, settingsOpen, setSettingsOpen, discoveringCompetitors, discoverError, discoverCompetitors, selectedSeoDataProvider, buildStrategyGenerationParams }`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStrategySettings } from '../../../src/components/strategy/hooks/useStrategySettings';

vi.mock('../../../src/api/seo', () => ({
  keywords: {
    discoverCompetitors: vi.fn().mockResolvedValue({ competitors: [{ domain: 'rival.com' }] }),
    saveCompetitors: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('useStrategySettings', () => {
  it('builds generation params with current settings', () => {
    const { result } = renderHook(() => useStrategySettings({ seoDataAvailable: true } as any, null, 'ws1'));
    act(() => result.current.setMaxPages(200));
    const params = result.current.buildStrategyGenerationParams();
    expect(params.maxPages).toBe(200);
    expect(params.seoDataProvider).toBe('dataforseo');
  });

  it('discoverCompetitors populates the competitors field', async () => {
    const { result } = renderHook(() => useStrategySettings({ seoDataAvailable: true } as any, null, 'ws1'));
    await act(async () => { await result.current.discoverCompetitors(); });
    await waitFor(() => expect(result.current.competitors).toContain('rival.com'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/strategy/useStrategySettings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook.** Move all settings state, the three sync effects (lines 164-172, 175-179, 182-190), `defaultSeoDataProvider`, `selectedSeoDataProvider`, `buildStrategyGenerationParams` (192-203), and the discover-competitors handler (the async body at 672-688, extracted as `discoverCompetitors`) into the hook. Signature: `useStrategySettings(keywordData, strategy, workspaceId: string)`. Keep the `import { keywords } from '../../../api/seo'` at the top. **Preserve the existing `eslint-disable` discipline:** the effects currently have implicit deps — replicate their exact dependency arrays; if any needs a suppression, add it with an inline justification per the project convention.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/strategy/useStrategySettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/strategy/hooks/useStrategySettings.ts tests/unit/strategy/useStrategySettings.test.ts
git commit -m "refactor(strategy): extract useStrategySettings hook"
```

---

### Task 3: `useStrategyGeneration` hook [PARALLEL]

**Files:**
- Create: `src/components/strategy/hooks/useStrategyGeneration.ts`
- Test: `tests/unit/strategy/useStrategyGeneration.test.ts`

Source of truth: orchestrator lines 77-80, 104, 106-110, 120 (`refresh`), 206-260 (job-tracking effects + `runStartJob` + `generateStrategy`), 783-806 (consumes `error`/`showNextSteps`). Owns: `startingStrategyJob`, `lastStartedJobId`, `error`, `setError`, `showNextSteps`, `setShowNextSteps`, `refreshOrderingPromptOpen`, `setRefreshOrderingPromptOpen`, `dismissedRefreshAt`, `setDismissedRefreshAt`, `activeStrategyJob`, `generating`, `runStartJob`, `generateStrategy`, `refresh`.

**Signature:** `useStrategyGeneration({ workspaceId, localSync, buildStrategyGenerationParams }: { workspaceId: string; localSync: ...; buildStrategyGenerationParams: () => GenerationParams })`.

- [ ] **Step 1: Write the failing test** — mock `useBackgroundTasks` and `useLocalSeoRefresh`; assert `generating` is true while a job is active and that `generateStrategy('full')` opens the ordering prompt when `localSync.localNeedsRefresh` is true.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStrategyGeneration } from '../../../src/components/strategy/hooks/useStrategyGeneration';

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ jobs: [], startJob: vi.fn().mockResolvedValue('job1'), findActiveJob: () => undefined }),
}));
vi.mock('../../../src/hooks/admin', () => ({ useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false }) }));

describe('useStrategyGeneration', () => {
  it('opens the ordering prompt for a full run when local data needs refresh', async () => {
    const { result } = renderHook(() => useStrategyGeneration({
      workspaceId: 'ws1',
      localSync: { localNeedsRefresh: true, applies: true },
      buildStrategyGenerationParams: () => ({} as any),
    } as any));
    await act(async () => { await result.current.generateStrategy('full'); });
    expect(result.current.refreshOrderingPromptOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/strategy/useStrategyGeneration.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook** by moving lines 77-80, 104, 106-110, 120, 206-260 into it. Keep `import { useBackgroundTasks }`, `BACKGROUND_JOB_TYPES`, `useLocalSeoRefresh`, `useQueryClient`, `queryKeys` imports. Preserve the two `effect-layout-ok`-commented effects verbatim (lines 206-210, 213-226) including their comments.

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/strategy/useStrategyGeneration.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/strategy/hooks/useStrategyGeneration.ts tests/unit/strategy/useStrategyGeneration.test.ts
git commit -m "refactor(strategy): extract useStrategyGeneration hook"
```

---

### Task 4: `useTrackKeyword` hook [PARALLEL]

**Files:**
- Create: `src/components/strategy/hooks/useTrackKeyword.ts`
- Test: `tests/unit/strategy/useTrackKeyword.test.ts`

Source of truth: orchestrator lines 82-83 (`trackingPending`, `trackingErrors`), 127-134 (`trackedKeywords` query), 262-287 (`trackKeyword`).

**Returns:** `{ trackedKeywords: Set<string>, trackingPending: Set<string>, trackingErrors: Map<string,string>, trackKeyword: (kw: string) => Promise<void> }`.

- [ ] **Step 1: Write the failing test** — mock `rankTracking` (`keywords`, `addKeyword`); assert `trackKeyword` adds to `trackingPending` then clears, and a non-duplicate error populates `trackingErrors`.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTrackKeyword } from '../../../src/components/strategy/hooks/useTrackKeyword';

vi.mock('../../../src/api/seo', () => ({
  rankTracking: { keywords: vi.fn().mockResolvedValue([]), addKeyword: vi.fn().mockRejectedValue(new Error('network down')) },
  keywords: {},
}));

const wrapper = ({ children }: any) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useTrackKeyword', () => {
  it('records a track error on real failure', async () => {
    const { result } = renderHook(() => useTrackKeyword('ws1'), { wrapper });
    await act(async () => { await result.current.trackKeyword('dentist austin'); });
    await waitFor(() => expect(result.current.trackingErrors.size).toBe(1));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run tests/unit/strategy/useTrackKeyword.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the hook** by moving lines 82-83, 127-134, 262-287. Keep `useQuery`, `queryKeys`, `rankTracking`, `keywordTrackingKey`, `extractErrorMessage` imports. Preserve the duplicate-detection logic (`/already|duplicate/i`) and the comment block at 269-272 verbatim.

- [ ] **Step 4: Run to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/strategy/hooks/useTrackKeyword.ts tests/unit/strategy/useTrackKeyword.test.ts
git commit -m "refactor(strategy): extract useTrackKeyword hook"
```

---

### Task 5: `useKeywordFeedback` hook [PARALLEL]

**Files:**
- Create: `src/components/strategy/hooks/useKeywordFeedback.ts`
- Test: `tests/unit/strategy/useKeywordFeedback.test.ts`

Source of truth: orchestrator lines 81 (`addKeywordError`), 136-161 (`keywordFeedbackRows` query + `addRequestedKeywordMutation`).

**Returns:** `{ rows: AdminKeywordFeedbackListRow[], addError: string | null, setAddError, addRequestedKeyword: (kw: string) => void, addPending: boolean }`.

- [ ] **Step 1: Write the failing test** — mock `keywords.feedback` + `keywordCommandCenter.action`; assert `addRequestedKeyword` calls the KCC `ADD_TO_STRATEGY` action and that an error sets `addError`.

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL.

- [ ] **Step 3: Implement** by moving lines 81, 136-161. Keep the existing comments (143-145, 156-160) verbatim. `addPending` = `addRequestedKeywordMutation.isPending`.

- [ ] **Step 4: Run to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/strategy/hooks/useKeywordFeedback.ts tests/unit/strategy/useKeywordFeedback.test.ts
git commit -m "refactor(strategy): extract useKeywordFeedback hook"
```

---

### Tasks 6–16: Presentational leaf components [all PARALLEL except 16]

Each leaf task follows the **same shape**:
1. Create the component file implementing its `*Props` interface from `types.ts`.
2. Move the corresponding JSX block from the orchestrator verbatim, replacing local-state/handler references with `props.*`.
3. Write a component test that renders with representative props and asserts the key visible content.
4. Run the test (fails → passes).
5. Commit.

The extraction is **verbatim JSX** — do not restyle, rename classes, or change markup. Class strings, `t-*` utilities, tokens, and icons move exactly as-is.

| Task | Component | Source lines | Props | Render-test assertion |
|---|---|---|---|---|
| 6 | `StrategyHeader.tsx` | 377-437 | `StrategyHeaderProps` | renders "Keyword Strategy"; "Regenerate" when `isRealStrategy`, "Generate Strategy" otherwise; `onGenerate` fires on primary click |
| 7 | `StrategyFeedbackNudge.tsx` | 470-483 | `StrategyFeedbackNudgeProps` | renders the "New client feedback…" copy with correct counts; renders nothing when both counts are 0 (caller-gated, but assert the count string) |
| 8 | `ClientKeywordFeedback.tsx` | 485-580 | `ClientKeywordFeedbackProps` | renders requested + declined sections; "Add to Strategy" calls `onAdd(keyword)`; empty state when `rows.length === 0`; declined list caps at 12 |
| 9 | `StrategySettings.tsx` | 582-772 | `StrategySettingsProps` | renders "Strategy Settings"; toggling header calls `setSettingsOpen`; Page Limit buttons call `setMaxPages`; "Auto-Discover" calls `onDiscoverCompetitors` |
| 10 | `StrategyStalenessNudges.tsx` | 823-867 | `StrategyStalenessNudgesProps` | renders the unvalidated warning when `!hasVolumeValidation`; renders the reverse-staleness nudge (testid `reverse-staleness-nudge`) when stale + not dismissed; "Generate Strategy" fires `onGenerate` |
| 11 | `StrategyEmptyState.tsx` | 808-819 | (no props) | renders "No keyword strategy yet" |
| 12 | `StrategyStatGrid.tsx` | 870-875 | `StrategyStatGridProps` | renders the four StatCards with computed values (Pages Mapped, Impressions, Clicks, Avg Position) |
| 13 | `RankingDistribution.tsx` | 878-913 | `RankingDistributionProps` | renders "Ranking Distribution"; the five tier counts; the intent-mix badges when `>1` intent |
| 14 | `SiteTargetKeywords.tsx` | 965-1016 | `SiteTargetKeywordsProps` | renders each site keyword as a Badge; Track button calls `onTrack(kw)`; shows "Tracking" state when in `trackedKeywords` |
| 15 | `KeywordOpportunities.tsx` | 1018-1036 | `KeywordOpportunitiesProps` | renders "Keyword Opportunities" + each opportunity row; renders nothing when `opportunities.length === 0` |
| 15b | `StrategyHowItWorks.tsx` | 1038-1058 | `StrategyHowItWorksProps` | renders "How it works"; the DataForSEO line only when `displayedSeoDataMode !== 'none'`; the GSC tip only when `!hasAnyRanking` |

**Example fully-worked leaf (Task 7, the smallest) — use as the template:**

- [ ] **Step 1: Write the failing test** `tests/unit/strategy/StrategyFeedbackNudge.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrategyFeedbackNudge } from '../../../src/components/strategy/StrategyFeedbackNudge';

describe('StrategyFeedbackNudge', () => {
  it('renders requested and declined counts', () => {
    render(<StrategyFeedbackNudge requestedCount={2} declinedCount={1} />);
    expect(screen.getByText(/New client feedback since last strategy generation/i)).toBeInTheDocument();
    expect(screen.getByText(/2 requested keywords/i)).toBeInTheDocument();
    expect(screen.getByText(/1 declined keyword/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run tests/unit/strategy/StrategyFeedbackNudge.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/components/strategy/StrategyFeedbackNudge.tsx` — move lines 470-483, replacing `requestedFeedback.length` → `props.requestedCount` and `declinedFeedback.length` → `props.declinedCount`. The component renders the inner `<div>` (the caller keeps the `{feedbackNewerThanStrategy && ...}` gate, so the component itself does not need the gate — but accept the counts and render the banner). Import `Icon`, `AlertTriangle` from the same sources the orchestrator uses.

```typescript
import { AlertTriangle } from 'lucide-react';
import { Icon } from './ui';
import type { StrategyFeedbackNudgeProps } from './types';

export function StrategyFeedbackNudge({ requestedCount, declinedCount }: StrategyFeedbackNudgeProps) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
      <Icon as={AlertTriangle} size="md" className="text-accent-warning mt-0.5 shrink-0" />
      <div>
        <p className="t-caption font-semibold text-[var(--brand-text-bright)]">New client feedback since last strategy generation</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
          {requestedCount > 0 && `${requestedCount} requested keyword${requestedCount === 1 ? '' : 's'}`}
          {requestedCount > 0 && declinedCount > 0 && ' and '}
          {declinedCount > 0 && `${declinedCount} declined keyword${declinedCount === 1 ? '' : 's'}`}
          {' '}arrived after the last generation. Regenerate the strategy to apply this feedback.
        </p>
      </div>
    </div>
  );
}
```

> Note the import path: leaf components live in `src/components/strategy/`, so `./ui` must become `../ui` (the orchestrator was at `src/components/` and used `./ui`). **Every extracted leaf must fix relative import depth** (`./ui` → `../ui`, `./strategy/X` → `./X`, `../hooks` → `../../hooks`, `../../shared` → `../../../shared`, `../routes` → `../../routes`, `../api` → `../../api`, `../lib` → `../../lib`, `../utils` → `../../utils`). This is the most common error in this batch — verify with `npm run typecheck` per task.

- [ ] **Step 4: Run to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "refactor(strategy): extract StrategyFeedbackNudge leaf"`

Apply this exact shape to Tasks 6, 8–15b using the table above. For Tasks 9 (`StrategySettings`) and 8 (`ClientKeywordFeedback`) — the two largest blocks — the JSX moves verbatim; the only edits are (a) relative-import depth and (b) swapping the orchestrator locals for the matching `props.*`. Do not refactor the markup.

---

### Task 16: Rewrite the orchestrator [controller — integration barrier]

**Files:**
- Modify: `src/components/KeywordStrategy.tsx`
- Modify: `src/components/strategy/index.ts` (add the leaf + hook exports)

Run only after Tasks 1–15b are merged and `scaled-code-review` of the batch is clean.

- [ ] **Step 1: Add barrel exports** for all hooks + leaves in `src/components/strategy/index.ts`.

- [ ] **Step 2: Rewrite `KeywordStrategyPanel`** to:
  - Call the hooks: `useKeywordStrategy`, `useStrategyMetrics`, `useStrategySettings`, `useStrategyGeneration`, `useTrackKeyword`, `useKeywordFeedback`.
  - Keep in the orchestrator: `navigate`, `intentColor`, `isRealStrategy`, `displayedSeoDataMode`, `localSync`, the `loading`/`strategyFetchError`/`!workspaceId` early returns, the `TabBar` + Guide split, the `RefreshOrderingPrompt` modal, `AIContextIndicator`, `LocalSeoVisibilityPanel`, `IntelligenceSignals`, `ProgressIndicator`, the `error` ErrorState, `NextStepsCard`, and the already-extracted section components (`QuickWins`, `LowHangingFruit`, `ContentGaps`, `KeywordGaps`, `TopicClusters`, `CannibalizationAlert`, `StrategyDiff`, `BacklinkProfile`, `CompetitiveIntel`).
  - Render the new leaves **in the exact current order**, passing props from the hooks/metrics.
  - The render order must match lines 367-1062 exactly: TabBar → (guide|analysis) → StrategyHeader → RefreshOrderingPrompt → AIContextIndicator → LocalSeoVisibilityPanel → `{feedbackNewerThanStrategy && <StrategyFeedbackNudge .../>}` → ClientKeywordFeedback → StrategySettings → IntelligenceSignals → ProgressIndicator → error → NextStepsCard → StrategyEmptyState → `{isRealStrategy && strategy && (<>` → StrategyStalenessNudges → StrategyStatGrid → RankingDistribution → QuickWins → LowHangingFruit → ContentGaps → KeywordGaps → Reference divider → TopicClusters → CannibalizationAlert → StrategyDiff → BacklinkProfile → CompetitiveIntel → SiteTargetKeywords → KeywordOpportunities → StrategyHowItWorks → `</>)}`.
  - The orchestrator file should drop from 1064 lines to roughly 150–200.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npx vite build`
Expected: PASS.

- [ ] **Step 4: Full test suite**

Run: `npx vitest run`
Expected: PASS — including the pre-existing `tests/unit/strategy-keyword-feedback.test.ts`.

- [ ] **Step 5: pr-check**

Run: `npm run pr-check`
Expected: zero errors. (Watch the `Hand-rolled card div` / `SectionCard` rules — markup moved verbatim, so any pre-existing `pr-check-disable` comments on the Settings panel must move with the JSX into `StrategySettings.tsx`.)

- [ ] **Step 6: Commit**

```bash
git add src/components/KeywordStrategy.tsx src/components/strategy/index.ts
git commit -m "refactor(strategy): compose KeywordStrategyPanel from extracted leaves + hooks (no behavior change)"
```

---

### Task 17: Render-parity verification [controller]

- [ ] **Step 1: Start the preview** and load a workspace with a real generated strategy (`preview_start`, then navigate to a `seo-strategy` page).
- [ ] **Step 2: Visual + DOM parity check** — confirm the section order, the 4-stat grid, the ranking-distribution bar, the settings panel (open by default), Site Target Keywords with Track buttons, and the "How it works" footer all render identically to `origin/staging`. Capture a screenshot.
- [ ] **Step 3: Interaction smoke** — toggle Settings; click "Add to Strategy" on a requested keyword (if present); click a Track button; confirm no console errors (`preview_console_logs`).
- [ ] **Step 4: Update docs** — add a `FEATURE_AUDIT.md` note that Strategy was decomposed (no behavior change), and add a `data/roadmap.json` item for the Strategy redesign marking Phase 0 done (run `npx tsx scripts/sort-roadmap.ts`).
- [ ] **Step 5: Final gates** — `npm run typecheck && npx vite build && npx vitest run && npm run pr-check` — all green. Commit doc updates.

---

## Self-Review (completed against the spec)

- **Spec coverage:** Phase 0 in §7 of the spec = "extract inline sections → leaf components in current order; thin orchestrator; barrel; no flag, no behavior change." Every clause maps to a task (hooks 1–5, leaves 6–15b, orchestrator 16, parity 17). ✓
- **Placeholder scan:** no "TBD/implement later" — each leaf task points at exact source line ranges + its `*Props` interface; the smallest leaf is fully worked as the template. ✓
- **Type consistency:** all leaf props reference the `*Props` interfaces defined once in Task 0's `types.ts`; hook return shapes are named in their tasks and consumed by name in Task 16. `PageKeywordMap` is defined once and imported everywhere. ✓
- **Known risk flagged:** relative-import-depth fixes are the most error-prone step — called out explicitly with the full path-rewrite map and a per-task `typecheck` gate.

---

## Phase Roadmap (subsequent phases — each gets its own detailed plan at its turn)

Per the phase-per-PR rule, Phases 1–5 are planned in detail only when their turn arrives (their leaf APIs lock during Phase 0 + the construction wave). Summary from the spec §7:

1. **Phase 1 — Decide band + flag:** introduce `bands/` + `decide/act/reference` folders (move leaves), `strategyDecisionBands` flag, `DecisionQueue` (`useRecommendationSet`, admin superset), requested-keyword triage hoist, Settings collapsed-by-default + `maxPages` persistence fix, header decision summary.
2. **Phase 2 — Act band:** `OpportunitiesList` (merge QuickWins+LHF), `WhatChangedPanel` (StrategyDiff hoist + `navigate()` wiring + React Query migration), `DecayingPagesCard`, `LostQueryRecoveryCard`.
3. **Phase 3 — Cannibalization triage:** rebuild → SEO Editor write-target + Send to client; `cannibalization_resolved`.
4. **Phase 4 — Reference + Hub handoff:** Authority & Backlinks merge + cache-label fix, CompetitorEvidence dedup + Track, Site Keywords → Hub deep-link, Opportunities → trackable rows, distribution click-to-filter, delete dead code, remove flag.
5. **Phase 5 — Signal generation (concurrent lane):** on-mutation recompute + daily activity-gated cron + "computed X ago" + `strategy_history` snapshot fix.
