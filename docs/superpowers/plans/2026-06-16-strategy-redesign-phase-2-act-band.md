# Strategy Redesign — Phase 2: Act Band Actionable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Strategy page's **Act** band actually lead the admin to action — merge Quick Wins + Low-Hanging Fruit into one CTA-bearing `OpportunitiesList`, wire `StrategyDiff` "What Changed" badges to navigate (and keep their cache fresh), and add two new outcome cards: `DecayingPagesCard` and `LostQueryRecoveryCard`.

**Architecture:** All four pieces mount inside `<StrategyBand label="Act">` in `src/components/KeywordStrategy.tsx`, which only renders when the `strategy-decision-bands` flag is ON. The flag-OFF (legacy) layout is left **byte-identical** — it keeps using the existing `quickWins`/`lhf`/`strategyDiff` leaves untouched. New leaves are added as additional `realLeaves` element-consts; the controller rewires only the bands Act band. Shared contracts (query keys, WS invalidation, shared decay types, new leaf prop interfaces) are pre-committed by the controller before parallel workers are dispatched, so each worker owns only net-new files (plus, for Worker B, sole ownership of `StrategyDiff.tsx`).

**Tech Stack:** React 19, React Router DOM 7, React Query (`@tanstack/react-query`), TailwindCSS 4, TypeScript strict, Vitest + Testing Library.

**Feature flag:** `strategy-decision-bands` (already exists, default `false`). No new flag. Gating is at the band level — **do not** add per-leaf `useFeatureFlag` calls.

**Phase-per-PR:** This is ONE PR (one phase). Branch `strategy-phase-2-act-band` (already cut off staging-with-1b). Merge to `staging` only.

---

## Verified facts this plan is built on (do not re-derive)

- **Orchestrator** `src/components/KeywordStrategy.tsx`:
  - `realLeaves` record built at **lines 293–372** (only when `isRealStrategy && strategy`). In scope at that site: `strategy` (KeywordStrategy), `metrics` (StrategyMetrics — has `.lowHangingFruit: PageKeywordMap[]`, `.pageMap: PageKeywordMap[]`), `workspaceId`, `navigate`, `tracking`, `settings`, `generation`, `feedback`, `intentColor`.
  - `quickWins` leaf (328–332): `<div id="quick-wins-section"><QuickWins quickWins={strategy.quickWins ?? []} /></div>` — the `id` is the scroll target of the post-generation `NextStepsCard` "Review Quick Wins" step (line 246).
  - `lhf` leaf (333): `<LowHangingFruit pages={metrics.lowHangingFruit} />`.
  - `strategyDiff` leaf (349): `<StrategyDiff workspaceId={workspaceId} />`.
  - Bands Act band (**394–401**): `{contentGaps}{quickWins}{lhf}{keywordGaps}{cannibalization}{strategyDiff}`.
  - Legacy layout (**420–459**, flag OFF, byte-identical): uses `quickWins` (439), `lhf` (440), `contentGaps` (441), `strategyDiff` (450) — **must not change**.
  - Leaf imports come from the `./strategy` barrel (lines 22–43).
- **Data shapes (different — need a unified row model):**
  - `QuickWin` (inline in `QuickWins.tsx:4-10`): `{ pagePath: string; action: string; estimatedImpact: string; rationale: string; roiScore?: number }`. Source: `strategy.quickWins`.
  - `PageKeywordMap` (canonical, `src/components/strategy/types.ts:6-21`): `{ pagePath; pageTitle; primaryKeyword; secondaryKeywords; searchIntent?; currentPosition?; impressions?; clicks?; volume?; difficulty?; cpc?; metricsSource?; validated?; secondaryMetrics? }`. Source: `metrics.lowHangingFruit`.
- **Page-identity join helpers** (`shared/page-address-utils.ts`): `matchPageIdentity(a: string, b: string): boolean` (line 33), `findPageMapEntry<T extends { pagePath: string }>(pageMap: T[], path: string): T | undefined` (line 37). Normalize + lowercase + strip trailing slash.
- **CTA pattern (template)** — every Fix CTA navigates via router **state** (not URL): `navigate(adminPath(workspaceId, tab), { state: { fixContext: { targetRoute: tab, ...} } })`. `FixContext` (`src/App.tsx:77-98`) requires only `targetRoute: string`; the rest optional. `PageIntelligence` (`src/components/PageIntelligence.tsx:107-126`) auto-expands a page **only** when `fixContext.targetRoute === 'page-intelligence'` AND `pageSlug` (or `pageId`) matches — so page CTAs must set both. `adminPath(workspaceId, tab: Page)` from `src/routes.ts`.
- **StrategyDiff** (`src/components/strategy/StrategyDiff.tsx`): currently raw `useState`+`useEffect` calling `keywords.strategyDiff(workspaceId)` (GET `/api/webflow/keyword-strategy/:wsId/diff`, returns `KeywordStrategyDiff | null`); **no** `useWorkspaceEvents`, **never re-fetches** after a regen. `nextAction` renders as a passive `Badge` (lines 71–92) over `diff.explanations` filtered `!rawEvidenceOnly`, `.slice(0,3)`. Tone ternary: `generate_brief→emerald`, `optimize_page→blue`, else `teal`.
  - `KeywordStrategyExplanation` (`shared/types/keyword-strategy-ux.ts:45-90`) carries `keyword`, `pagePath?`, `pageTitle?`, `nextAction`, `reasons[]`, `normalizedKeyword`, `role`, `rawEvidenceOnly?`.
  - `KeywordStrategyNextAction` (`:17-31`): `{ type: 'generate_brief'|'optimize_page'|'track_keyword'|'watch'|'review_evidence'; label; detail; keyword?; pagePath?; targetTab? }`. `targetTab` is a **free string, NOT a `Page`** — never cast it; map `type → Page` explicitly. `pagePath` exists on **both** explanation and `nextAction` — prefer `nextAction.pagePath`, fall back to `explanation.pagePath`.
  - `queryKeys.admin` has **no** `strategyDiff` key (`src/lib/queryKeys.ts:90`). `strategyMutationKeys()` (`src/lib/wsInvalidation.ts:38-57`) is the array the `WS_EVENTS.STRATEGY_UPDATED` admin case delegates to.
- **Content decay**:
  - Authoritative types live in `server/content-decay.ts:25-55` (`DecayingPage`, `DecayAnalysis`). `ContentDecay.tsx` has **stale local copies** (missing `title`, `isRepeatDecay`, `priority`).
  - API client `contentDecay.get(wsId)` (`src/api/content.ts:407-417`) returns `unknown` — GET `/api/content-decay/:wsId` is **cache-read-only**, returns HTTP 200 `null` if no analysis ever ran. No `useContentDecay` hook exists. No `queryKeys.admin.contentDecay`.
  - `DecayingPage` field names: page path = `page`; decline = `clickDeclinePct`; severity = `severity: 'critical'|'warning'|'watch'`. **No `trafficLost` field** — derive from `previousClicks → currentClicks`.
  - Existing CTA pattern (`ContentDecay.tsx:256-281`): "Refresh brief" → `content-pipeline` `{ pageSlug: page.page, pageName: page.page }`; "Review page" → `page-intelligence` `{ pageSlug: page.page, pageName: page.page }`.
- **Lost visibility**:
  - `useInsightFeed(workspaceId)` (`src/hooks/admin/useInsightFeed.ts:496`) fetches `getSafe<AnalyticsInsight[]>('/api/public/insights/' + workspaceId, [])` under key `['admin-insight-feed', wsId]`, returns `{ feed: FeedInsight[], ... }`. **`FeedInsight` is lossy** — exposes `details: string[]` but NOT structured `topQueries`.
  - `InsightType` literal is exactly `'lost_visibility'`. `LostVisibilityData` (`shared/types/analytics.ts:477-493`): `{ lostCount: number; topQueries: Array<{ query: string; lastPosition: number|null; lastSeen: string; totalImpressions: number }>; detectedAt: string }`. `topQueries` capped at 5, ordered by `totalImpressions` DESC.

---

## File ownership (no two tasks touch the same file)

| Owner | Files |
|-------|-------|
| **Task 0 — Controller (me)** | `src/lib/queryKeys.ts`, `src/lib/wsInvalidation.ts`, `shared/types/content-decay.ts` (new), `server/content-decay.ts`, `src/components/strategy/types.ts`, `src/components/strategy/index.ts` (barrel) |
| **Worker A — Opportunities** | `src/components/strategy/OpportunitiesList.tsx` (new), `src/components/strategy/buildOpportunityRows.ts` (new), `tests/unit/strategy/OpportunitiesList.test.tsx` (new), `tests/unit/strategy/buildOpportunityRows.test.ts` (new) |
| **Worker B — What Changed** | `src/components/strategy/StrategyDiff.tsx`, `src/lib/strategyNextActionTarget.ts` (new), `tests/unit/strategy/strategyNextActionTarget.test.ts` (new), `tests/unit/strategy/StrategyDiff.test.tsx` (new) |
| **Worker C — Decay** | `src/hooks/admin/useContentDecay.ts` (new), `src/components/strategy/DecayingPagesCard.tsx` (new), `tests/unit/strategy/DecayingPagesCard.test.tsx` (new) |
| **Worker D — Lost Queries** | `src/hooks/admin/useLostVisibility.ts` (new), `src/components/strategy/LostQueryRecoveryCard.tsx` (new), `tests/unit/strategy/LostQueryRecoveryCard.test.tsx` (new) |
| **Task 5 — Controller (me)** | `src/components/KeywordStrategy.tsx` (orchestrator integration), `src/components/strategy/index.ts` (barrel exports for the 3 new leaves), `tests/component/KeywordStrategyBackgroundJob.test.tsx` (orchestrator assertions) |

**Dependency graph:** Task 0 → (Worker A, B, C, D in parallel) → scaled review → Task 5 integration → flag-off parity verify → PR.
Workers B, C, D depend on Task 0's query-key / shared-type / wsInvalidation pre-commits. Worker A depends on Task 0's `OpportunityRow` + `OpportunitiesListProps` in `types.ts`. **Parallel workers must not run any git commands** — the controller commits per task.

---

## Task 0: Pre-commit shared contracts (Controller)

**Files:**
- Modify: `src/lib/queryKeys.ts:90` (admin keys)
- Modify: `src/lib/wsInvalidation.ts:38-57` (`strategyMutationKeys`)
- Create: `shared/types/content-decay.ts`
- Modify: `server/content-decay.ts:25-55` (re-export from shared)
- Modify: `src/components/strategy/types.ts` (add `OpportunityRow`, `StrategyQuickWin`, 4 new prop interfaces)

- [ ] **Step 1: Add two admin query keys.** In `src/lib/queryKeys.ts`, immediately after the `keywordStrategy` line (90), keeping the keyword cluster contiguous:

```ts
    keywordStrategy: (wsId: string) => ['keyword-strategy', wsId] as const,
    strategyDiff: (wsId: string) => ['admin-strategy-diff', wsId] as const,
    contentDecay: (wsId: string) => ['admin-content-decay', wsId] as const,
    keywordFeedback: (wsId: string) => ['admin-keyword-feedback', wsId] as const,
```

- [ ] **Step 2: Register strategyDiff for WS invalidation.** In `src/lib/wsInvalidation.ts`, add to the `strategyMutationKeys()` array (it backs the `WS_EVENTS.STRATEGY_UPDATED` admin case), right after `queryKeys.admin.keywordStrategy(workspaceId),`:

```ts
    queryKeys.admin.keywordStrategy(workspaceId),
    queryKeys.admin.strategyDiff(workspaceId),
```

(Do NOT add `contentDecay` here — decay is recomputed by its own analyze job, not by strategy regen, and the GET is cache-only.)

- [ ] **Step 3: Promote decay types to shared.** Create `shared/types/content-decay.ts` with the authoritative interfaces (verbatim copy from `server/content-decay.ts:25-55`), so the new hook, the new card, and `ContentDecay.tsx` can all consume one non-drifting type:

```ts
/**
 * Content-decay shared contract. Single source of truth for the shape returned by
 * GET /api/content-decay/:workspaceId. Both the server analyzer and frontend consumers
 * (useContentDecay hook, DecayingPagesCard, ContentDecay panel) import from here so the
 * frontend's previously-drifted local copies can't fall out of sync again.
 */
export interface DecayingPage {
  page: string; // URL path; used as React key
  title?: string;
  currentClicks: number;
  previousClicks: number;
  clickDeclinePct: number;
  currentImpressions: number;
  previousImpressions: number;
  impressionChangePct: number;
  currentPosition: number;
  previousPosition: number;
  positionChange: number;
  severity: 'critical' | 'warning' | 'watch';
  refreshRecommendation?: string;
  isRepeatDecay?: boolean;
  priority?: string;
}

export interface DecayAnalysis {
  workspaceId: string;
  analyzedAt: string;
  totalPages: number;
  decayingPages: DecayingPage[];
  summary: {
    critical: number;
    warning: number;
    watch: number;
    totalDecaying: number;
    avgDeclinePct: number;
  };
}
```

- [ ] **Step 4: Re-point the server type to shared.** In `server/content-decay.ts`, replace the local `DecayingPage`/`DecayAnalysis` interface declarations (25–55) with a re-export so existing server imports keep working and the shapes stay lockstep:

```ts
export type { DecayingPage, DecayAnalysis } from '../shared/types/content-decay.js';
```

(Verify the relative path resolves from `server/`; adjust to match sibling imports in that file. Run `npm run typecheck` after — server callers like `loadDecayAnalysis` must still compile.)

- [ ] **Step 5: Add the unified opportunity row model + new leaf prop interfaces** to `src/components/strategy/types.ts` (append after `VOLUME_THRESHOLD` / `SeoDataMode`, before the leaf-prop block — keep alongside the other leaf contracts):

```ts
/** A Quick Win as stored on the strategy blob (structurally identical to the inline type in QuickWins.tsx). */
export interface StrategyQuickWin {
  pagePath: string;
  action: string;
  estimatedImpact: string;
  rationale: string;
  roiScore?: number;
}

/**
 * One actionable row in the Act band's OpportunitiesList. Discriminated by `kind`:
 * - 'quick_win'  → an AI-suggested page action (from strategy.quickWins)
 * - 'low_hanging' → a page ranking #4–20 with impressions (from metrics.lowHangingFruit)
 * Both carry a pagePath so a per-row Fix CTA can deep-link into Page Intelligence.
 */
export type OpportunityRow =
  | { kind: 'quick_win'; pagePath: string; action: string; estimatedImpact: string; rationale: string; roiScore?: number }
  | {
      kind: 'low_hanging';
      pagePath: string;
      pageTitle: string;
      primaryKeyword: string;
      currentPosition?: number;
      impressions?: number;
      clicks?: number;
      volume?: number;
    };

export interface OpportunitiesListProps {
  quickWins: StrategyQuickWin[];
  lowHangingFruit: PageKeywordMap[];
  workspaceId: string;
}

export interface DecayingPagesCardProps {
  workspaceId: string;
}

export interface LostQueryRecoveryCardProps {
  workspaceId: string;
}
```

- [ ] **Step 6: Verify + commit.** Run `npm run typecheck`. Expected: zero errors. Commit:

```bash
git add src/lib/queryKeys.ts src/lib/wsInvalidation.ts shared/types/content-decay.ts server/content-decay.ts src/components/strategy/types.ts
git commit -m "Strategy Phase 2 — Task 0: pre-commit Act-band shared contracts (query keys, decay types, opportunity row model)"
```

---

## Task A (Worker): OpportunitiesList — merge Quick Wins + Low-Hanging Fruit with per-row Fix CTAs

**Files:**
- Create: `src/components/strategy/buildOpportunityRows.ts`
- Create: `src/components/strategy/OpportunitiesList.tsx`
- Test: `tests/unit/strategy/buildOpportunityRows.test.ts`
- Test: `tests/unit/strategy/OpportunitiesList.test.tsx`

**Context:** A single `<SectionCard title="Opportunities">` replaces the two separate cards in the bands Act band. It has two labeled subsections — **Quick Wins** (emerald accent) and **Low-Hanging Fruit** (amber accent) — preserving today's visual semantics, but every row gets a per-row "Optimize page" Fix CTA that deep-links into Page Intelligence (auto-expand). **Dedup:** if a Low-Hanging Fruit page's `pagePath` matches a Quick Win's `pagePath` (via `matchPageIdentity`), drop it from the LHF subsection — the Quick Win already gives that page a specific action. Read `src/components/strategy/ContentGaps.tsx` for the canonical per-row CTA button styling and `src/components/admin/recommendations/RecommendationRow.tsx` for the `onFixCta` + `e.stopPropagation()` contract.

- [ ] **Step 1: Write the failing pure-function test.** `tests/unit/strategy/buildOpportunityRows.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildOpportunityRows } from '../../../src/components/strategy/buildOpportunityRows';
import type { PageKeywordMap } from '../../../src/components/strategy/types';

const qw = (over = {}) => ({ pagePath: '/pricing', action: 'Add FAQ schema', estimatedImpact: 'high', rationale: 'r', roiScore: 80, ...over });
const lhf = (over = {}): PageKeywordMap => ({ pagePath: '/blog/seo', pageTitle: 'SEO', primaryKeyword: 'seo tips', secondaryKeywords: [], currentPosition: 8, impressions: 1200, ...over } as PageKeywordMap);

describe('buildOpportunityRows', () => {
  it('returns quick_win rows first (by roiScore desc) then low_hanging rows (by impressions desc)', () => {
    const rows = buildOpportunityRows(
      [qw({ pagePath: '/a', roiScore: 10 }), qw({ pagePath: '/b', roiScore: 90 })],
      [lhf({ pagePath: '/x', impressions: 100 }), lhf({ pagePath: '/y', impressions: 5000 })],
    );
    expect(rows.map(r => r.kind)).toEqual(['quick_win', 'quick_win', 'low_hanging', 'low_hanging']);
    expect((rows[0] as { pagePath: string }).pagePath).toBe('/b'); // higher roi first
    expect((rows[2] as { pagePath: string }).pagePath).toBe('/y'); // higher impressions first
  });

  it('drops a low-hanging page that duplicates a quick-win page (matchPageIdentity, trailing-slash insensitive)', () => {
    const rows = buildOpportunityRows([qw({ pagePath: '/pricing' })], [lhf({ pagePath: '/pricing/' })]);
    expect(rows.filter(r => r.kind === 'low_hanging')).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it('returns [] when both inputs are empty', () => {
    expect(buildOpportunityRows([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`buildOpportunityRows` not defined). `npx vitest run tests/unit/strategy/buildOpportunityRows.test.ts`

- [ ] **Step 3: Implement `buildOpportunityRows.ts`:**

```ts
import { matchPageIdentity } from '../../../shared/page-address-utils';
import type { OpportunityRow, PageKeywordMap, StrategyQuickWin } from './types';

/**
 * Merge Quick Wins + Low-Hanging Fruit into one ordered, de-duplicated opportunity list.
 * Quick Wins lead (they are specific "do this now" actions), ordered by roiScore desc;
 * Low-Hanging Fruit follow, ordered by impressions desc. A LHF page whose path matches a
 * Quick Win page is dropped (the Quick Win already owns that page).
 */
export function buildOpportunityRows(
  quickWins: StrategyQuickWin[],
  lowHangingFruit: PageKeywordMap[],
): OpportunityRow[] {
  const quickWinRows: OpportunityRow[] = [...quickWins]
    .sort((a, b) => (b.roiScore ?? 0) - (a.roiScore ?? 0))
    .map(qw => ({ kind: 'quick_win', pagePath: qw.pagePath, action: qw.action, estimatedImpact: qw.estimatedImpact, rationale: qw.rationale, roiScore: qw.roiScore }));

  const lhfRows: OpportunityRow[] = [...lowHangingFruit]
    .filter(p => !quickWins.some(qw => matchPageIdentity(qw.pagePath, p.pagePath)))
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .map(p => ({ kind: 'low_hanging', pagePath: p.pagePath, pageTitle: p.pageTitle, primaryKeyword: p.primaryKeyword, currentPosition: p.currentPosition, impressions: p.impressions, clicks: p.clicks, volume: p.volume }));

  return [...quickWinRows, ...lhfRows];
}
```

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Write the component test.** `tests/unit/strategy/OpportunitiesList.test.tsx` — mirror `tests/unit/strategy/DecisionQueue.test.tsx`'s structure (MemoryRouter + `useNavigate` mock). Assert: (a) renders nothing when both inputs empty (returns `null`); (b) renders both subsection headers + rows when populated; (c) clicking a row's "Optimize page" button calls `navigate` with `expect.stringContaining('page-intelligence')` and `state.fixContext` containing `{ targetRoute: 'page-intelligence', pageSlug: '<pagePath>' }`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OpportunitiesList } from '../../../src/components/strategy/OpportunitiesList';
import type { PageKeywordMap } from '../../../src/components/strategy/types';

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigateMock }));

const lhf = (over = {}): PageKeywordMap => ({ pagePath: '/blog/seo', pageTitle: 'SEO Guide', primaryKeyword: 'seo tips', secondaryKeywords: [], currentPosition: 8, impressions: 1200, ...over } as PageKeywordMap);

describe('OpportunitiesList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders null when there are no opportunities', () => {
    const { container } = render(<MemoryRouter><OpportunitiesList quickWins={[]} lowHangingFruit={[]} workspaceId="ws1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders quick wins + low-hanging fruit and routes the Fix CTA into Page Intelligence', () => {
    render(<MemoryRouter><OpportunitiesList
      quickWins={[{ pagePath: '/pricing', action: 'Add FAQ schema', estimatedImpact: 'high', rationale: 'why', roiScore: 80 }]}
      lowHangingFruit={[lhf()]}
      workspaceId="ws1"
    /></MemoryRouter>);
    expect(screen.getByText('Opportunities')).toBeInTheDocument();
    expect(screen.getByText('Add FAQ schema')).toBeInTheDocument();
    expect(screen.getByText('SEO Guide')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /optimize page/i })[0]);
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('page-intelligence'),
      expect.objectContaining({ state: { fixContext: expect.objectContaining({ targetRoute: 'page-intelligence', pageSlug: '/pricing' }) } }),
    );
  });
});
```

- [ ] **Step 6: Run it — expect FAIL** (component not defined).

- [ ] **Step 7: Implement `OpportunitiesList.tsx`.** Use `SectionCard` (title "Opportunities", titleIcon `Zap` teal). Build rows via `buildOpportunityRows(quickWins, lowHangingFruit)`; return `null` if empty. Render two labeled subsections (only when that kind has rows): "Quick Wins" (emerald) and "Low-Hanging Fruit" (amber). Reuse the existing row visuals from `QuickWins.tsx` / `LowHangingFruit.tsx` (impact badge, `positionColor`, impressions) — but add a per-row footer button:

```tsx
import { useNavigate } from 'react-router-dom';
import { Zap, ArrowUpRight } from 'lucide-react';
import { Button, Icon, SectionCard, positionColor } from '../ui';
import { adminPath } from '../../routes';
import { buildOpportunityRows } from './buildOpportunityRows';
import type { OpportunitiesListProps } from './types';

export function OpportunitiesList({ quickWins, lowHangingFruit, workspaceId }: OpportunitiesListProps) {
  const navigate = useNavigate();
  const rows = buildOpportunityRows(quickWins, lowHangingFruit);
  if (rows.length === 0) return null;

  const optimize = (pagePath: string) =>
    navigate(adminPath(workspaceId, 'page-intelligence'), {
      state: { fixContext: { targetRoute: 'page-intelligence', pageSlug: pagePath, pageName: pagePath } },
    });

  const fixButton = (pagePath: string) => (
    <Button onClick={() => optimize(pagePath)} variant="ghost" size="sm"
      className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 flex-shrink-0">
      <Icon as={ArrowUpRight} size="sm" className="text-teal-300" /> Optimize page
    </Button>
  );

  const quickWinRows = rows.filter(r => r.kind === 'quick_win');
  const lhfRows = rows.filter(r => r.kind === 'low_hanging');

  return (
    <SectionCard id="quick-wins-section" title="Opportunities" titleIcon={<Icon as={Zap} size="md" className="text-accent-brand" />}>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">High-impact changes to make now — ranked by expected return.</p>
      {/* Quick Wins subsection (emerald): render qw.action, qw.rationale, impact badge, roiScore, + fixButton(qw.pagePath) */}
      {/* Low-Hanging Fruit subsection (amber): render pageTitle, pagePath, primaryKeyword, positionColor(currentPosition), impressions, + fixButton(pagePath) */}
    </SectionCard>
  );
}
```

Fill in the two subsection bodies by porting the existing markup from `QuickWins.tsx:26-43` and `LowHangingFruit.tsx:33-46` (keep the emerald / amber accents and `positionColor`), appending `fixButton(row.pagePath)` to each row's right side. **Note:** the `id="quick-wins-section"` on the SectionCard preserves the `NextStepsCard` "Review Quick Wins" scroll target in bands mode (the legacy layout still has its own `quick-wins-section` div; only one layout renders at a time, so no duplicate id). Follow the SectionCard double-wrap warning — do not add `space-y`/`p-` to the immediate child.

- [ ] **Step 8: Run both tests — expect PASS.** `npx vitest run tests/unit/strategy/buildOpportunityRows.test.ts tests/unit/strategy/OpportunitiesList.test.tsx`

- [ ] **Step 9: Self-verify** `npm run typecheck`. Do NOT touch `QuickWins.tsx`/`LowHangingFruit.tsx` (legacy parity). Do NOT add to the barrel (controller does that). Do NOT run git.

---

## Task B (Worker): StrategyDiff — navigate on nextAction + keep cache fresh

**Files:**
- Create: `src/lib/strategyNextActionTarget.ts`
- Modify: `src/components/strategy/StrategyDiff.tsx`
- Test: `tests/unit/strategy/strategyNextActionTarget.test.ts`
- Test: `tests/unit/strategy/StrategyDiff.test.tsx`

**Context:** Two changes. (1) Migrate StrategyDiff's raw `useEffect` fetch to `useQuery` keyed on `queryKeys.admin.strategyDiff(workspaceId)` (Task 0 added the key + wsInvalidation entry, so it now auto-refetches on `strategy:updated`). (2) Turn each `nextAction` Badge into a navigating CTA for actionable types, leaving `watch`/`review_evidence` as passive badges (no dead CTAs). Reuse `RecFixContext` from `src/lib/recTypeTab.ts` for the fixContext shape.

- [ ] **Step 1: Write the failing mapping test.** `tests/unit/strategy/strategyNextActionTarget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { strategyNextActionTarget } from '../../../src/lib/strategyNextActionTarget';
import type { KeywordStrategyExplanation } from '../../../shared/types/keyword-strategy-ux';

const expl = (over: Partial<KeywordStrategyExplanation> = {}): KeywordStrategyExplanation => ({
  keyword: 'seo tips', normalizedKeyword: 'seo tips', role: 'primary', surfaceLabel: '', sourceEvidence: [], reasons: ['r'], fitSignals: [],
  pagePath: '/blog/seo', nextAction: { type: 'optimize_page', label: 'Optimize page', detail: '' }, ...over,
} as KeywordStrategyExplanation);

describe('strategyNextActionTarget', () => {
  it('maps optimize_page → page-intelligence with pageSlug (auto-expand)', () => {
    const t = strategyNextActionTarget(expl());
    expect(t).toEqual({ tab: 'page-intelligence', fixContext: { targetRoute: 'page-intelligence', pageSlug: '/blog/seo', pageName: undefined, primaryKeyword: 'seo tips' } });
  });
  it('maps generate_brief → content-pipeline', () => {
    expect(strategyNextActionTarget(expl({ nextAction: { type: 'generate_brief', label: 'Draft brief', detail: '' } }))?.tab).toBe('content-pipeline');
  });
  it('maps track_keyword → seo-keywords', () => {
    expect(strategyNextActionTarget(expl({ nextAction: { type: 'track_keyword', label: 'Track', detail: '' } }))?.tab).toBe('seo-keywords');
  });
  it('returns null for watch and review_evidence (no dead CTA)', () => {
    expect(strategyNextActionTarget(expl({ nextAction: { type: 'watch', label: 'Watch', detail: '' } }))).toBeNull();
    expect(strategyNextActionTarget(expl({ nextAction: { type: 'review_evidence', label: 'Review', detail: '' } }))).toBeNull();
  });
  it('prefers nextAction.pagePath over explanation.pagePath', () => {
    const t = strategyNextActionTarget(expl({ pagePath: '/explanation', nextAction: { type: 'optimize_page', label: 'x', detail: '', pagePath: '/next-action' } }));
    expect(t?.fixContext.pageSlug).toBe('/next-action');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement `src/lib/strategyNextActionTarget.ts`:**

```ts
import type { Page } from '../routes';
import type { RecFixContext } from './recTypeTab';
import type { KeywordStrategyExplanation } from '../../shared/types/keyword-strategy-ux';

/**
 * Maps a "What Changed" explanation's nextAction to a navigation target + fixContext, or null
 * for informational actions (watch / review_evidence) that have no actionable destination.
 * optimize_page → page-intelligence (auto-expands the page via pageSlug); generate_brief →
 * content-pipeline; track_keyword → seo-keywords. nextAction.pagePath wins over explanation.pagePath.
 */
export function strategyNextActionTarget(
  explanation: KeywordStrategyExplanation,
): { tab: Page; fixContext: RecFixContext } | null {
  const { nextAction } = explanation;
  const pageSlug = nextAction.pagePath ?? explanation.pagePath;
  const base = { pageName: explanation.pageTitle, primaryKeyword: explanation.keyword };
  switch (nextAction.type) {
    case 'optimize_page':
      return { tab: 'page-intelligence', fixContext: { targetRoute: 'page-intelligence', pageSlug, ...base } };
    case 'generate_brief':
      return { tab: 'content-pipeline', fixContext: { targetRoute: 'content-pipeline', pageSlug, ...base } };
    case 'track_keyword':
      return { tab: 'seo-keywords', fixContext: { targetRoute: 'seo-keywords', ...base } };
    case 'watch':
    case 'review_evidence':
      return null;
  }
}
```

(If `RecFixContext`'s `pageName`/`primaryKeyword` are not optional in a way that allows `undefined`, confirm against `src/lib/recTypeTab.ts:33-38` — they are optional there, so spreading `undefined` is fine. Adjust the object literal to satisfy strict types if needed.)

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Migrate the data fetch to useQuery.** In `StrategyDiff.tsx`, replace the `useState<StrategyDiffType|null>` + `loading` + `useEffect(... keywords.strategyDiff ...)` block with:

```tsx
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
// ...
const { data: diff, isLoading: loading } = useQuery({
  queryKey: queryKeys.admin.strategyDiff(workspaceId),
  queryFn: () => keywords.strategyDiff(workspaceId),
  enabled: !!workspaceId,
});
if (loading || !diff) return null;
```

Keep the `expanded` `useState`. The component now auto-refetches when `strategy:updated` fires (Task 0 registered the key in `strategyMutationKeys`).

- [ ] **Step 6: Wire navigation into the nextAction Badge.** At the badge block (current lines 71–92), compute `const target = strategyNextActionTarget(explanation);`. When `target` is non-null, render the Badge inside a `<button>` (or wrap with an onClick + `cursor-pointer` + a trailing `ArrowUpRight` icon) that calls `navigate(adminPath(workspaceId, target.tab), { state: { fixContext: target.fixContext } })`. When `target` is null, render the passive Badge exactly as today. Preserve the existing tone ternary. Add `import { useNavigate } from 'react-router-dom'; import { adminPath } from '../../routes'; import { strategyNextActionTarget } from '../../lib/strategyNextActionTarget';` to the top import block (never mid-file).

- [ ] **Step 7: Write the component test.** `tests/unit/strategy/StrategyDiff.test.tsx` — wrap in `QueryClientProvider` + `MemoryRouter`, mock `../../src/api/seo` so `keywords.strategyDiff` resolves a diff whose `explanations` include one `optimize_page` and one `watch`. Assert the `optimize_page` row's clickable badge navigates to `page-intelligence` with the right `fixContext`, and the `watch` row's badge is NOT a button. (Mirror the QueryClientProvider setup in `tests/component/KeywordStrategyBackgroundJob.test.tsx`.)

- [ ] **Step 8: Run tests — expect PASS.** `npx vitest run tests/unit/strategy/strategyNextActionTarget.test.ts tests/unit/strategy/StrategyDiff.test.tsx`

- [ ] **Step 9: Self-verify** `npm run typecheck`. Do NOT run git.

---

## Task C (Worker): DecayingPagesCard + useContentDecay hook

**Files:**
- Create: `src/hooks/admin/useContentDecay.ts`
- Create: `src/components/strategy/DecayingPagesCard.tsx`
- Test: `tests/unit/strategy/DecayingPagesCard.test.tsx`

**Context:** New React Query hook over the cache-only decay endpoint, and a slim Act-band card surfacing the top decaying pages with Refresh-brief / Review-page CTAs. The GET returns `null` until an analyze job has run — handle that as "render nothing" (the card is a problems-surfacer; no decay = no card, matching `QuickWins` returning `null` when empty).

- [ ] **Step 1: Implement the hook `src/hooks/admin/useContentDecay.ts`:**

```ts
import { useQuery } from '@tanstack/react-query';
import { contentDecay } from '../../api';
import { queryKeys } from '../../lib/queryKeys';
import type { DecayAnalysis } from '../../../shared/types/content-decay';

/**
 * Reads the cached content-decay analysis for a workspace. GET /api/content-decay/:wsId is
 * cache-only and returns null until an analyze job has run, so callers must handle null.
 */
export function useContentDecay(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.admin.contentDecay(workspaceId!),
    queryFn: async () => ((await contentDecay.get(workspaceId!)) as DecayAnalysis | null) ?? null,
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Write the card test.** `tests/unit/strategy/DecayingPagesCard.test.tsx` — mock `../../src/hooks/admin/useContentDecay` (mirror DecisionQueue's hook-mock pattern) + `useNavigate`. Cases: (a) returns `null` when data is `null`; (b) returns `null` when `decayingPages` is empty; (c) renders the top decaying pages (critical first) and fires "Refresh brief" → `content-pipeline` and "Review page" → `page-intelligence` with `fixContext.pageSlug = page.page`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DecayingPagesCard } from '../../../src/components/strategy/DecayingPagesCard';
import type { DecayAnalysis } from '../../../shared/types/content-decay';

const state = vi.hoisted(() => ({ data: null as DecayAnalysis | null, isLoading: false }));
vi.mock('../../../src/hooks/admin/useContentDecay', () => ({ useContentDecay: () => ({ data: state.data, isLoading: state.isLoading }) }));
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigateMock }));

const analysis = (pages: Partial<DecayAnalysis['decayingPages'][number]>[]): DecayAnalysis => ({
  workspaceId: 'ws1', analyzedAt: '2026-06-01', totalPages: 10,
  decayingPages: pages.map(p => ({ page: '/p', currentClicks: 5, previousClicks: 50, clickDeclinePct: 90, currentImpressions: 100, previousImpressions: 900, impressionChangePct: 88, currentPosition: 12, previousPosition: 4, positionChange: 8, severity: 'critical', ...p } as DecayAnalysis['decayingPages'][number])),
  summary: { critical: 1, warning: 0, watch: 0, totalDecaying: pages.length, avgDeclinePct: 90 },
});

describe('DecayingPagesCard', () => {
  beforeEach(() => { vi.clearAllMocks(); state.data = null; state.isLoading = false; });
  it('renders null when no analysis exists', () => {
    const { container } = render(<MemoryRouter><DecayingPagesCard workspaceId="ws1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
  it('renders decaying pages and routes the Refresh-brief CTA', () => {
    state.data = analysis([{ page: '/pricing', severity: 'critical' }]);
    render(<MemoryRouter><DecayingPagesCard workspaceId="ws1" /></MemoryRouter>);
    expect(screen.getByText('/pricing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh brief/i }));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('content-pipeline'),
      expect.objectContaining({ state: { fixContext: expect.objectContaining({ targetRoute: 'content-pipeline', pageSlug: '/pricing' }) } }));
  });
});
```

- [ ] **Step 3: Run it — expect FAIL.**

- [ ] **Step 4: Implement `DecayingPagesCard.tsx`.** Use `useContentDecay(workspaceId)`. Return `null` if `!data` or `data.decayingPages.length === 0`. Sort by severity (`critical`>`warning`>`watch`) then `clickDeclinePct` desc, `.slice(0, 5)`. `SectionCard title="Decaying pages"` (titleIcon `TrendingDown`, red/amber accent per severity). Per row: `page` (mono path), a severity `Badge` (critical→red, warning→amber, watch→blue), the click delta `{previousClicks} → {currentClicks} ({clickDeclinePct}% clicks)`, and two CTA buttons mirroring `ContentDecay.tsx:256-281`:
  - "Refresh brief" → `navigate(adminPath(workspaceId,'content-pipeline'), { state: { fixContext: { targetRoute: 'content-pipeline', pageSlug: page.page, pageName: page.page } } })`
  - "Review page" → `navigate(adminPath(workspaceId,'page-intelligence'), { state: { fixContext: { targetRoute: 'page-intelligence', pageSlug: page.page, pageName: page.page } } })`

  **Do NOT** display a `trafficLost` field (none exists). Top imports only.

- [ ] **Step 5: Run it — expect PASS.** `npx vitest run tests/unit/strategy/DecayingPagesCard.test.tsx`

- [ ] **Step 6: Self-verify** `npm run typecheck`. Do NOT modify `ContentDecay.tsx` (out of scope for this PR — the shared-type migration of that panel is a separate cleanup). Do NOT run git.

---

## Task D (Worker): LostQueryRecoveryCard + useLostVisibility hook

**Files:**
- Create: `src/hooks/admin/useLostVisibility.ts`
- Create: `src/components/strategy/LostQueryRecoveryCard.tsx`
- Test: `tests/unit/strategy/LostQueryRecoveryCard.test.tsx`

**Context:** Surface queries that lost visibility (GSC drop-off) with a path to recover. Reuse the **existing** insights endpoint/cache — no new endpoint. The `lost_visibility` insight's structured `topQueries` (query + totalImpressions) is NOT exposed by `useInsightFeed` (lossy), so this hook reads the raw `AnalyticsInsight[]` under the *same* query key (React Query shares the cache; a different `select` is per-observer) and extracts `LostVisibilityData`.

- [ ] **Step 1: Implement the hook `src/hooks/admin/useLostVisibility.ts`:**

```ts
import { useQuery } from '@tanstack/react-query';
import { getSafe } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { AnalyticsInsight, LostVisibilityData } from '../../../shared/types/analytics';

/**
 * Reads the workspace's lost_visibility insight (top lost queries) from the public insights feed.
 * Shares the ['admin-insight-feed', wsId] cache with useInsightFeed (same queryFn) but selects the
 * raw structured LostVisibilityData (topQueries with query strings + totalImpressions) that the
 * lossy FeedInsight transform drops. Returns null when there is no lost_visibility insight.
 */
export function useLostVisibility(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.admin.insightFeed(workspaceId!),
    queryFn: () => getSafe<AnalyticsInsight[]>('/api/public/insights/' + workspaceId, []),
    enabled: !!workspaceId,
    select: (insights): LostVisibilityData | null => {
      const found = insights.find(i => i.insightType === 'lost_visibility');
      return found ? (found.data as LostVisibilityData) : null;
    },
  });
}
```

(Confirm the field is `insightType` on `AnalyticsInsight` and that `getSafe` is exported from `src/api/client.ts` — `useInsightFeed.ts:496-517` uses exactly this queryFn. Match its import path for `getSafe`.)

- [ ] **Step 2: Write the card test.** `tests/unit/strategy/LostQueryRecoveryCard.test.tsx` — mock `../../src/hooks/admin/useLostVisibility` + `useNavigate`. Cases: (a) `null` data → renders `null`; (b) empty `topQueries` → renders `null`; (c) renders the lost queries (capped 5) with `query` + `lastPosition`, and a "Create recovery content" CTA → `content-pipeline` with `fixContext.primaryKeyword = topQueries[0].query`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LostQueryRecoveryCard } from '../../../src/components/strategy/LostQueryRecoveryCard';
import type { LostVisibilityData } from '../../../shared/types/analytics';

const state = vi.hoisted(() => ({ data: null as LostVisibilityData | null }));
vi.mock('../../../src/hooks/admin/useLostVisibility', () => ({ useLostVisibility: () => ({ data: state.data, isLoading: false }) }));
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigateMock }));

describe('LostQueryRecoveryCard', () => {
  beforeEach(() => { vi.clearAllMocks(); state.data = null; });
  it('renders null when there is no lost_visibility insight', () => {
    const { container } = render(<MemoryRouter><LostQueryRecoveryCard workspaceId="ws1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
  it('renders lost queries and routes the recovery CTA with the top query as keyword', () => {
    state.data = { lostCount: 2, detectedAt: '2026-06-01', topQueries: [
      { query: 'best crm', lastPosition: 7, lastSeen: '2026-05-01', totalImpressions: 900 },
      { query: 'crm pricing', lastPosition: null, lastSeen: '2026-04-01', totalImpressions: 300 },
    ] };
    render(<MemoryRouter><LostQueryRecoveryCard workspaceId="ws1" /></MemoryRouter>);
    expect(screen.getByText('best crm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create recovery content/i }));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('content-pipeline'),
      expect.objectContaining({ state: { fixContext: expect.objectContaining({ targetRoute: 'content-pipeline', primaryKeyword: 'best crm', autoGenerate: true }) } }));
  });
});
```

- [ ] **Step 3: Run it — expect FAIL.**

- [ ] **Step 4: Implement `LostQueryRecoveryCard.tsx`.** Use `useLostVisibility(workspaceId)`. Return `null` if `!data || data.topQueries.length === 0`. `SectionCard title="Lost visibility"` (titleIcon `TrendingDown` or `Search`, blue accent — data hue). Render up to 5 `topQueries`: `query`, and `lastPosition != null ? "was #{lastPosition}" : "unranked"`, plus `{totalImpressions.toLocaleString()} impressions at risk`. One primary CTA "Create recovery content" → `navigate(adminPath(workspaceId,'content-pipeline'), { state: { fixContext: { targetRoute: 'content-pipeline', primaryKeyword: data.topQueries[0].query, autoGenerate: true } } })`. Top imports only.

- [ ] **Step 5: Run it — expect PASS.** `npx vitest run tests/unit/strategy/LostQueryRecoveryCard.test.tsx`

- [ ] **Step 6: Self-verify** `npm run typecheck`. Do NOT run git.

---

## Scaled review gate (Controller)

After all four workers return, before integration: review the four diffs together (`scaled-code-review`). Confirm: no field-name guesses (cross-check against the verified-facts section), no `purple-` (admin page so allowed, but unnecessary — keep to teal/blue/emerald/amber/red), no SectionCard double-wrap, CTAs use router state + required `targetRoute`, EMV not rendered in any new card (none of these surface emvPerWeek — confirm). Fix Critical/Important before integrating.

---

## Task 5: Orchestrator integration (Controller)

**Files:**
- Modify: `src/components/strategy/index.ts` (barrel — export the 3 new leaf components)
- Modify: `src/components/KeywordStrategy.tsx`
- Modify: `tests/component/KeywordStrategyBackgroundJob.test.tsx`

- [ ] **Step 1: Barrel exports.** In `src/components/strategy/index.ts`, export `OpportunitiesList`, `DecayingPagesCard`, `LostQueryRecoveryCard` (follow the existing export style). `buildOpportunityRows` need not be barrel-exported.

- [ ] **Step 2: Import the new leaves** in `KeywordStrategy.tsx` from the `./strategy` barrel block (lines 22–43): add `OpportunitiesList, DecayingPagesCard, LostQueryRecoveryCard`.

- [ ] **Step 3: Add three new element-consts to `realLeaves`** (after `lhf`, keep `quickWins`/`lhf` intact for legacy parity):

```tsx
    opportunitiesList: <OpportunitiesList quickWins={strategy.quickWins ?? []} lowHangingFruit={metrics.lowHangingFruit} workspaceId={workspaceId} />,
    decayingPages: <DecayingPagesCard workspaceId={workspaceId} />,
    lostQueries: <LostQueryRecoveryCard workspaceId={workspaceId} />,
```

- [ ] **Step 4: Rewire ONLY the bands Act band** (lines 394–401). Replace `{realLeaves.quickWins}{realLeaves.lhf}` with the merged list and add the two new cards:

```tsx
          <StrategyBand label="Act">
            {realLeaves.contentGaps}
            {realLeaves.opportunitiesList}
            {realLeaves.decayingPages}
            {realLeaves.lostQueries}
            {realLeaves.keywordGaps}
            {realLeaves.cannibalization}
            {realLeaves.strategyDiff}
          </StrategyBand>
```

**Do NOT touch `legacyAnalysis` (lines 419–459).** It keeps `realLeaves.quickWins`/`realLeaves.lhf`/`realLeaves.strategyDiff` exactly as-is → flag-OFF stays byte-identical.

- [ ] **Step 5: Orchestrator tests.** In `tests/component/KeywordStrategyBackgroundJob.test.tsx`:
  - The existing flag-on/flag-off tests use `strategy: null` (no `realLeaves`), so the new Act cards don't mount and need no mocks — confirm they still pass.
  - Add ONE flag-on test with a populated `strategy` (real `generatedAt`, `quickWins`, `pageMap`) asserting the Act band shows **"Opportunities"** and does NOT show the separate legacy **"Quick Wins"**/**"Low-Hanging Fruit"** card headers; and a flag-off test asserting the legacy layout STILL shows **"Quick Wins"**/**"Low-Hanging Fruit"** as separate cards. Mock `useContentDecay`/`useLostVisibility` to return empty (so those cards render null and don't interfere). This protects both the merge and flag-off parity.

- [ ] **Step 6: Full verify.** Run the quality gates:

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run verify:feature-flags && npm run verify:coverage-ratchet
```

Expected: all green. Then commit the integration + worker files per-task (controller owns all git writes).

- [ ] **Step 7: Flag-off parity proof.** With the flag OFF (default), confirm the legacy layout is byte-identical: `git stash`-free reasoning — the only orchestrator edits are additive consts + the bands-only Act band; legacy JSX is untouched. Spot-check by diffing the `legacyAnalysis` block against `origin/staging`.

---

## Docs + closeout (Controller)

- [ ] `FEATURE_AUDIT.md` — update the Strategy redesign entry: Phase 2 Act band actionable (OpportunitiesList, navigating What-Changed, Decaying pages, Lost-query recovery).
- [ ] `data/roadmap.json` — mark `strategy-redesign-phase-2-act-band` (or equivalent) done with notes; `npx tsx scripts/sort-roadmap.ts`.
- [ ] `BRAND_DESIGN_LANGUAGE.md` — only if any new color/pattern was introduced (the new cards reuse existing accents; likely no change — verify).
- [ ] Memory: update `project_strategy_redesign.md` Phase 2 status to PR-open.
- [ ] Open PR → `staging` with a phase-scoped description (what changed, flag-off parity statement, test coverage).

---

## Self-review (against the spec)

- **Spec coverage:** merge QuickWins+LHF ✅ (Task A); What-Changed actionable ✅ (Task B); Decaying pages ✅ (Task C); Lost-query recovery ✅ (Task D). All in the Act band, flag-gated, one PR.
- **Type consistency:** `OpportunityRow`/`StrategyQuickWin`/`OpportunitiesListProps` defined once in `types.ts` (Task 0), consumed by Task A. `DecayAnalysis` single source in `shared/types/content-decay.ts` (Task 0), consumed by Task C hook + card. `RecFixContext` reused by Task B. Query keys `strategyDiff`/`contentDecay` defined in Task 0, consumed by B and C. `LostVisibilityData`/`AnalyticsInsight` are existing shared types (Task D).
- **No placeholders:** every component step cites exact source lines to port from and exact CTA payloads.
- **Parity:** flag-OFF legacy layout untouched; new behavior lives entirely in the bands Act band + new files.
