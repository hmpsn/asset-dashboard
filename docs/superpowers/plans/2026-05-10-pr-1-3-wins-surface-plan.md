# PR 1.3 — Insights / Wins Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `<WinsSurface>` to the Insights page showing completed actions with measured outcomes. Gate the legacy `PredictionShowcaseCard` on OverviewTab behind the same `client-wins-surface` flag.

**Architecture:** 3 tasks. Task 1 extends the shared `OutcomeWinEntry` type and the backend wins route (one new field). Task 2 creates the WinsSurface component with unit tests first. Task 3 wires it into InsightsBriefingPage and gates OverviewTab.

**Tech Stack:** React 19, Vite 8, TailwindCSS 4, Vitest + @testing-library/react, @tanstack/react-query, existing outcome-tracking types, useFeatureFlag hook, TierGate, SectionCard.

**Feature flag:** `client-wins-surface` (default `false`, already in `shared/types/feature-flags.ts`)

**Worktree:** `.claude/worktrees/client-wins-surface/`

---

### Task 1: Extend OutcomeWinEntry with `score` + populate in server route

**Files:**
- Modify: `shared/types/outcome-tracking.ts:243-251`
- Modify: `server/routes/outcomes.ts:377-385`

- [ ] **Step 1: Add `score` field to `OutcomeWinEntry` in shared types**

In `shared/types/outcome-tracking.ts`, find the `OutcomeWinEntry` interface at line 243 and add the `score` field:

```typescript
/** Client-facing "we called it" win entry for outcome API routes and WeCalledIt component. */
export interface OutcomeWinEntry {
  actionId: string;
  actionType: ActionType;
  pageUrl: string | null;
  targetKeyword: string | null;
  recommendation: string;
  delta: DeltaSummary;
  score: OutcomeScore;          // ← add this field
  detectedAt: string;
}
```

- [ ] **Step 2: Populate `score` in the server wins endpoint**

In `server/routes/outcomes.ts`, find the wins mapping block at ~line 377 and add `score: w.score`:

```typescript
const entries: OutcomeWinEntry[] = wins.map(w => ({
  actionId: w.actionId,
  actionType: w.actionType,
  pageUrl: w.pageUrl,
  targetKeyword: w.targetKeyword,
  recommendation: `${w.actionType.replace(/_/g, ' ')} action`,
  delta: w.delta,
  score: w.score,               // ← add this line
  detectedAt: w.scoredAt,
}));
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd .claude/worktrees/client-wins-surface && npm run typecheck`
Expected: 0 errors. The `getSafe<OutcomeWinEntry[]>` in `src/api/outcomes.ts` inherits the new field automatically.

- [ ] **Step 4: Commit**

```bash
git add shared/types/outcome-tracking.ts server/routes/outcomes.ts
git commit -m "feat(wins): add score field to OutcomeWinEntry + populate in wins endpoint"
```

---

### Task 2: Create WinsSurface component (TDD)

**Files:**
- Create: `tests/unit/WinsSurface.test.tsx`
- Create: `src/components/client/Briefing/WinsSurface.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/WinsSurface.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WinsSurface } from '../../src/components/client/Briefing/WinsSurface';
import type { OutcomeWinEntry } from '../../shared/types/outcome-tracking';

// Mock useClientOutcomeWins
vi.mock('../../src/hooks/client/useClientOutcomes', () => ({
  useClientOutcomeWins: vi.fn(),
}));

// Mock useFeatureFlag — not used inside WinsSurface directly but TierGate may call it
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn().mockReturnValue(false),
}));

import { useClientOutcomeWins } from '../../src/hooks/client/useClientOutcomes';

const mockWin = (overrides: Partial<OutcomeWinEntry> = {}): OutcomeWinEntry => ({
  actionId: 'act-1',
  actionType: 'meta_updated',
  pageUrl: 'https://example.com/services',
  targetKeyword: null,
  recommendation: 'meta_updated action',
  delta: { primary_metric: 'clicks', baseline_value: 10, current_value: 15, delta_absolute: 5, delta_percent: 50, direction: 'improved' },
  score: 'win',
  detectedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('WinsSurface', () => {
  it('renders "What we shipped" heading', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin()], isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('What we shipped')).toBeInTheDocument();
  });

  it('renders human label for meta_updated action type', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin()], isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Updated meta description')).toBeInTheDocument();
  });

  it('renders "Win" badge for score=win', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin({ score: 'win' })], isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Win')).toBeInTheDocument();
  });

  it('renders "Strong win" badge for score=strong_win', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin({ score: 'strong_win' })], isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Strong win')).toBeInTheDocument();
  });

  it('shows empty state when wins is []', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText(/We're working/)).toBeInTheDocument();
  });

  it('shows skeleton rows when loading', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows "See full history" link when exactly 10 wins returned', () => {
    const wins = Array.from({ length: 10 }, (_, i) => mockWin({ actionId: `act-${i}` }));
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: wins, isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('See full history →')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd .claude/worktrees/client-wins-surface && npx vitest run tests/unit/WinsSurface.test.tsx`
Expected: FAIL — "Cannot find module '../../src/components/client/Briefing/WinsSurface'"

- [ ] **Step 3: Create WinsSurface component**

Create `src/components/client/Briefing/WinsSurface.tsx`:

```typescript
// src/components/client/Briefing/WinsSurface.tsx
import { Sparkles } from 'lucide-react';
import { SectionCard, Skeleton, Icon } from '../../ui';
import { TierGate } from '../../ui/TierGate';
import { useClientOutcomeWins } from '../../../hooks/client/useClientOutcomes';
import type { Tier } from '../../ui/TierGate';
import type { ActionType, OutcomeWinEntry, OutcomeScore } from '../../../../shared/types/outcome-tracking';

// ── Action type → human label ───────────────────────────────────────────────

const ACTION_LABELS: Record<ActionType, string> = {
  meta_updated:           'Updated meta description',
  content_published:      'Published new post',
  content_refreshed:      'Refreshed existing content',
  schema_deployed:        'Added structured data',
  internal_link_added:    'Added internal links',
  audit_fix_applied:      'Fixed audit issue',
  brief_created:          'Created content brief',
  strategy_keyword_added: 'Added keyword to strategy',
  voice_calibrated:       'Calibrated brand voice',
  insight_acted_on:       'Acted on a recommendation',
};

function actionLabel(type: ActionType): string {
  return ACTION_LABELS[type] ?? type.replace(/_/g, ' ');
}

// ── Relative time ──────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

// ── Win quality badge ──────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: OutcomeScore }) {
  if (score === 'strong_win') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-emerald-500/15 text-accent-success border border-emerald-500/30">
        Strong win
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-[var(--surface-3)] text-accent-brand border border-[var(--brand-border)]">
      Win
    </span>
  );
}

// ── Win row ────────────────────────────────────────────────────────────────

function WinRow({ entry }: { entry: OutcomeWinEntry }) {
  const pageLabel = entry.targetKeyword
    ? `"${entry.targetKeyword}"`
    : entry.pageUrl
      ? entry.pageUrl.replace(/^https?:\/\/[^/]+/, '') || '/'
      : null;

  const deltaSign = entry.delta.delta_absolute >= 0 ? '+' : '';
  const pctSign = entry.delta.delta_percent >= 0 ? '+' : '';
  const deltaStr = `${deltaSign}${entry.delta.delta_absolute.toFixed(1)} (${pctSign}${entry.delta.delta_percent.toFixed(1)}%)`;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-[var(--brand-border)] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="t-ui font-medium text-[var(--brand-text-bright)]">{actionLabel(entry.actionType)}</span>
          <ScoreBadge score={entry.score} />
        </div>
        {pageLabel && (
          <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 truncate">{pageLabel}</p>
        )}
        <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
          {entry.delta.primary_metric}: <span className="text-accent-success font-medium">{deltaStr}</span>
        </p>
      </div>
      <span className="t-caption text-[var(--brand-text-muted)] flex-shrink-0 pt-0.5">{relativeTime(entry.detectedAt)}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface WinsSurfaceProps {
  workspaceId: string;
  effectiveTier: Tier;
}

export function WinsSurface({ workspaceId, effectiveTier }: WinsSurfaceProps) {
  const { data: wins = [], isLoading } = useClientOutcomeWins(workspaceId);

  const body = (
    <>
      {isLoading && (
        <div className="space-y-3 py-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {!isLoading && wins.length === 0 && (
        <p className="t-caption text-[var(--brand-text-muted)] py-4">
          We&rsquo;re working &mdash; wins appear here once your changes start showing measurable impact.
        </p>
      )}
      {!isLoading && wins.length > 0 && (
        <>
          <div>
            {wins.map(w => <WinRow key={w.actionId} entry={w} />)}
          </div>
          {wins.length === 10 && (
            <a
              href="#"
              title="Coming soon"
              className="block mt-3 t-caption text-accent-brand hover:text-[var(--brand-text-bright)] transition-colors"
              onClick={e => e.preventDefault()}
            >
              See full history →
            </a>
          )}
        </>
      )}
    </>
  );

  return (
    <SectionCard
      title="What we shipped"
      titleIcon={<Icon as={Sparkles} size="md" className="text-accent-success" />}
    >
      {effectiveTier === 'free' ? (
        <TierGate
          tier={effectiveTier}
          required="growth"
          feature="Wins ledger"
          teaser={`${wins.length} wins shipped this month — upgrade to see what we built.`}
        >
          {body}
        </TierGate>
      ) : (
        body
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd .claude/worktrees/client-wins-surface && npx vitest run tests/unit/WinsSurface.test.tsx`
Expected: 7 tests PASS

- [ ] **Step 5: Run typecheck**

Run: `cd .claude/worktrees/client-wins-surface && npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add tests/unit/WinsSurface.test.tsx src/components/client/Briefing/WinsSurface.tsx
git commit -m "feat(wins): add WinsSurface component with unit tests"
```

---

### Task 3: Wire WinsSurface into InsightsBriefingPage + gate OverviewTab

**Files:**
- Modify: `src/components/client/Briefing/InsightsBriefingPage.tsx`
- Modify: `src/components/client/OverviewTab.tsx`

- [ ] **Step 1: Update InsightsBriefingPage imports**

In `src/components/client/Briefing/InsightsBriefingPage.tsx`, add two imports at the top alongside existing ones:

After the existing import block (around line 38), add:
```typescript
import { useFeatureFlag } from '../../../hooks/useFeatureFlag';
import { WinsSurface } from './WinsSurface';
```

- [ ] **Step 2: Add winsEnabled flag + WinsSurface to paid path**

In `src/components/client/Briefing/InsightsBriefingPage.tsx`:

a) After the `isFree` declaration (currently at line 63), add:
```typescript
const winsEnabled = useFeatureFlag('client-wins-surface');
```

b) Find the paid briefing path at lines 250-255 (MonthlyDigestContent → DataSpread sequence):
```typescript
{digestLoading ? (
  <LoadingState message="Loading this period's snapshot..." />
) : hasDigest ? (
  <MonthlyDigestContent digest={digest} />
) : null}
<DataSpread wins={spreadColumns.wins} risks={spreadColumns.risks} />
```

Replace with:
```typescript
{digestLoading ? (
  <LoadingState message="Loading this period's snapshot..." />
) : hasDigest ? (
  <MonthlyDigestContent digest={digest} />
) : null}
{winsEnabled && (
  <WinsSurface workspaceId={workspaceId} effectiveTier={effectiveTier} />
)}
<DataSpread wins={spreadColumns.wins} risks={spreadColumns.risks} />
```

- [ ] **Step 3: Gate PredictionShowcaseCard in OverviewTab**

In `src/components/client/OverviewTab.tsx`, add `winsEnabled` flag (the hook is already imported at line 19).

After the existing `briefingV2Enabled` declaration at line 96, add:
```typescript
const winsEnabled = useFeatureFlag('client-wins-surface');
```

Find line 331:
```typescript
{clientIntel?.weCalledIt !== undefined && <PredictionShowcaseCard predictions={clientIntel.weCalledIt} />}
```

Replace with:
```typescript
{!winsEnabled && clientIntel?.weCalledIt !== undefined && <PredictionShowcaseCard predictions={clientIntel.weCalledIt} />}
```

- [ ] **Step 4: Run typecheck**

Run: `cd .claude/worktrees/client-wins-surface && npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Run full test suite**

Run: `cd .claude/worktrees/client-wins-surface && npx vitest run`
Expected: All tests pass (including the 7 new WinsSurface tests)

- [ ] **Step 6: Run pr-check**

Run: `cd .claude/worktrees/client-wins-surface && npx tsx scripts/pr-check.ts`
Expected: 0 errors (the existing 1 warning about PageHeader is pre-existing)

- [ ] **Step 7: Run build**

Run: `cd .claude/worktrees/client-wins-surface && npx vite build`
Expected: Build succeeds

- [ ] **Step 8: Update FEATURE_AUDIT.md and roadmap.json**

In `FEATURE_AUDIT.md`, add an entry under the Client Inbox / Insights section:
```markdown
## Client Wins Surface (client-wins-surface flag)
- WinsSurface component on Insights page (InsightsBriefingPage, between MonthlyDigestContent and DataSpread)
- Source: tracked_actions + action_outcomes (GET /api/public/outcomes/:wsId/wins)
- Gate: client-wins-surface feature flag (default off)
- Tier: Growth+ required; free tier sees a teaser
- Legacy PredictionShowcaseCard on OverviewTab hidden when flag is on
```

In `data/roadmap.json`, find the PR 1.3 item and mark it `"done"`.

- [ ] **Step 9: Commit**

```bash
git add src/components/client/Briefing/InsightsBriefingPage.tsx \
        src/components/client/OverviewTab.tsx \
        FEATURE_AUDIT.md \
        data/roadmap.json
git commit -m "feat(wins): wire WinsSurface into Insights page + gate PredictionShowcaseCard"
```
