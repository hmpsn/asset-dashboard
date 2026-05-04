# Strategy Keywords — Component Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sortable keyword table and accordion expand pattern in the Strategy Keywords section of `StrategyTab.tsx` with a two-zone flat list (confirmed above, suggestions below) and a slide-in detail drawer.

**Architecture:** Single-file render-layer replacement in `src/components/client/StrategyTab.tsx`. The data layer (API calls, `buildKeywordRow`, `priorityKeywordMap` assembly) stays intact. We remove ~8 state variables and ~15 table-specific functions, add 1 state variable (`openKeywordDrawer`), extend `StrategyKeywordTableRow` with 2 optional fields (`rationale`, `trendDirection`), and replace the 415-line `priorityKeywordsPanel` JSX with the new two-zone list. The drawer renders at component top-level as a fixed overlay, not inside `priorityKeywordsPanel`.

**Tech Stack:** React 19, TypeScript strict, TailwindCSS 4, design system tokens (`--surface-*`, `--brand-*`, `--z-*`, `--radius-*`), Lucide icons via `<Icon>`, project UI primitives (`Button`, `EmptyState`, `Skeleton`, `Icon`).

---

## Pre-requisites

- [ ] Spec on disk: `docs/superpowers/specs/2026-05-03-strategy-keywords-design.md`
- [ ] Pre-plan audit on disk: `docs/superpowers/audits/2026-05-03-strategy-keywords-rebuild-audit.md`
- [ ] No parallel agents — single file, single agent, all tasks sequential

---

## File Map

| File | Change |
|------|--------|
| `src/components/client/StrategyTab.tsx` | All changes — interfaces, state, helpers, panel JSX, drawer JSX |
| `FEATURE_AUDIT.md` | Update Strategy Keywords entry (Task 5) |
| `data/roadmap.json` | Mark item done with notes (Task 5) |
| `BRAND_DESIGN_LANGUAGE.md` | Update if any new color patterns introduced (Task 5) |

---

## Key Facts (read before starting)

- `priorityKeywordsPanel` definition: **lines 749–1163** (full replacement)
- `priorityKeywordsPanel` rendered at: **lines 1259–1262** inside `<TierGate>` — keep the TierGate, only swap the panel content
- `strategyKeywordRows` (confirmed) and `keywordIdeaRows` (suggestions) are already computed earlier in the component — reuse them
- `roleBadgeClass` is currently a const string at line 698 — replace with a function in Task 4
- `StrategyKeywordTableRow` has no `rationale` or `trendDirection` fields — Task 1 adds them
- `trendDirection` only exists on `contentGaps[]`, not on all keyword types — look it up via content gap match in `buildKeywordRow`
- Drawer animation pattern: follow `src/components/ContentPipeline.tsx` lines 248–266
- `fixed inset-0` requires `// fixed-inset-ok` comment; z-index must use `z-[var(--z-*)]` tokens
- `t-micro` is monospace uppercase (timestamps/IDs only) — use `t-caption-sm` for small labels

---

## Task Dependencies

All tasks are sequential — they all modify the same file and each task's output is required before the next can run without TypeScript errors.

```
Task 1 (Extend interface)
  → Task 2 (Remove dead code)
    → Task 3 (Replace panel JSX)
      → Task 4 (Add drawer)
        → Task 5 (Verify + docs)
```

No parallel dispatch possible for this plan.

---

### Task 1: Extend `StrategyKeywordTableRow` and `buildKeywordRow` (Model: sonnet)

**Owns:** `src/components/client/StrategyTab.tsx`
**Must not touch:** all other files

The detail drawer needs `rationale` (AI explanation, from `contentGaps[].rationale`) and `trendDirection` (from `contentGaps[].trendDirection`). Neither exists on the interface today. We add both and populate in `buildKeywordRow` using the content gap match that already happens inside it.

- [ ] **Step 1: Add two optional fields to `StrategyKeywordTableRow`**

Find the `interface StrategyKeywordTableRow extends PriorityKeywordItem` block (~line 87). After the last existing field (`contextSources: string[]`), add:

```typescript
  contextSources: string[];
  rationale?: string;                                      // AI rationale from contentGaps, if available
  trendDirection?: 'rising' | 'declining' | 'stable';    // from contentGaps, if available
}
```

- [ ] **Step 2: Populate both fields in `buildKeywordRow`**

Inside `buildKeywordRow` (~line 551), find the `return {` statement that assembles the final row object. The function already looks up a content gap match to get `opportunityScore` — find that variable (likely named `contentGap` or `gap`). In the return object, add:

```typescript
    rationale: contentGap?.rationale,
    trendDirection: contentGap?.trendDirection,
```

If `buildKeywordRow` does not already have a named variable for the content gap match (i.e., it accesses `opportunityScore` inline), extract it first:

```typescript
const contentGap = strategyData.contentGaps?.find(
  g => normalizeKeyword(g.targetKeyword) === item.normalized
);
// then use contentGap?.opportunityScore, contentGap?.rationale, contentGap?.trendDirection
```

Do not add a second `.find()` call — use one variable.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. The new optional fields have no required usages yet, so nothing else should break.

- [ ] **Step 4: Commit**

```bash
git add src/components/client/StrategyTab.tsx
git commit -m "feat(strategy-keywords): extend StrategyKeywordTableRow with rationale and trendDirection"
```

---

### Task 2: Remove dead state, functions, and imports (Model: haiku)

**Owns:** `src/components/client/StrategyTab.tsx`
**Must not touch:** all other files

After this task the file will have TypeScript errors because the old `priorityKeywordsPanel` still references removed items. **Do not run typecheck after this task** — errors are resolved in Task 3.

- [ ] **Step 1: Remove table-specific state declarations (~lines 185–192)**

Delete these six lines (find by variable name — order may vary):

```typescript
const [confirmRemoveKeyword, setConfirmRemoveKeyword] = useState<string | null>(null);
const [priorityKeywordSearch, setPriorityKeywordSearch] = useState('');
const [includeKeywordIdeas, setIncludeKeywordIdeas] = useState(false);
const [expandedKeywordRows, setExpandedKeywordRows] = useState<Set<string>>(new Set());
const [keywordSort, setKeywordSort] = useState<{ key: StrategyKeywordSortKey; asc: boolean }>({ key: 'role', asc: true });
const [managingKeyword, setManagingKeyword] = useState<string | null>(null);
```

- [ ] **Step 2: Remove the `confirmRemoveKeyword` ref and its useEffect (~lines 194–198)**

```typescript
// DELETE:
const confirmRemoveKeywordButtonRef = useRef<HTMLButtonElement | null>(null);
useEffect(() => {
  if (confirmRemoveKeyword) confirmRemoveKeywordButtonRef.current?.focus();
}, [confirmRemoveKeyword]);
```

- [ ] **Step 3: Remove the `StrategyKeywordSortKey` type alias (line ~74)**

```typescript
// DELETE:
type StrategyKeywordSortKey = 'keyword' | 'role' | 'opportunity' | 'page';
```

- [ ] **Step 4: Remove table-specific helper functions and computed values (~lines 613–715)**

Find and delete each of the following by name (entire const/function block):

| Name | What it does |
|------|-------------|
| `filteredKeywordRows` | Search filter — search is gone |
| `roleOrder` | Role sort order object — sort is gone |
| `sortedKeywordRows` | Complex multi-key sort — replaced by simple sort |
| `hasPriorityKeywordSearch` | Search state derived value |
| `priorityKeywordEmptyMessage` | Search empty message |
| `keywordSearchLabel` | Search input aria-label |
| `toggleKeywordRow` | Accordion toggle |
| `handleKeywordConfirmKeyDown` | Keyboard handler for confirm dialog |
| `opportunityClass` | Table chip coloring |
| `keywordSortColumns` | Sort column definitions |
| `roleBadgeClass` (const string) | Replaced by function in Task 4 |
| `handleKeywordSort` | Sort click handler |
| `getKeywordRemovalCopy` | Inline removal confirmation copy |
| `getKeywordRemovalActionLabel` | Inline removal action label |
| `getKeywordKeepActionLabel` | Inline keep label |

- [ ] **Step 5: Remove two now-unused icon imports**

In the import block at the top of the file, remove `Search` and `ArrowUpDown`:

```typescript
// Before: import { ..., Search, ArrowUpDown, ... } from 'lucide-react'
// After: remove only Search and ArrowUpDown — everything else is used elsewhere
```

- [ ] **Step 6: Add the new `openKeywordDrawer` state**

After the existing `trackedKeywordsError` state declaration (the last tracked-keyword state, ~line 191), add:

```typescript
const [openKeywordDrawer, setOpenKeywordDrawer] = useState<string | null>(null);
```

---

### Task 3: Replace `priorityKeywordsPanel` with two-zone list (Model: sonnet)

**Owns:** `src/components/client/StrategyTab.tsx` (lines 749–1163)
**Must not touch:** all other files

The entire 415-line `priorityKeywordsPanel` block is replaced. The TierGate wrapper at lines 1259–1262 is unchanged. The new panel has: a header, an add-keyword form, a confirmed zone sorted by `opportunityScore` descending, and a suggestions zone. No sort controls, no search input, no accordion expand.

- [ ] **Step 1: Add `roleSubLabel` helper and `sortedConfirmed` computed value immediately before `priorityKeywordsPanel`**

```typescript
const roleSubLabel = (row: StrategyKeywordTableRow): string => {
  const labelMap: Record<StrategyKeywordRole, string> = {
    content: 'content opportunity',
    page: 'page opportunity',
    strategy: 'strategy keyword',
    idea: 'keyword idea',
  };
  const label = labelMap[row.role];
  const hasMetrics = row.volume != null || row.difficulty != null;
  if (!hasMetrics) return `${label} · no data yet`;
  const parts: string[] = [label];
  if (row.volume != null) {
    parts.push(row.volume >= 1000 ? `${(row.volume / 1000).toFixed(1)}k/mo` : `${row.volume}/mo`);
  }
  if (row.difficulty != null) parts.push(`KD ${row.difficulty}`);
  return parts.join(' · ');
};

const sortedConfirmed = [...strategyKeywordRows].sort(
  (a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0)
);
```

- [ ] **Step 2: Replace the entire `priorityKeywordsPanel` const (lines 749–1163) with the following**

```tsx
const priorityKeywordsPanel = (
  // pr-check-disable-next-line -- Brand signature radius intentional for top-level strategy surface
  <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>

    {/* Header */}
    <div className="px-4 pt-4 pb-3 border-b border-[var(--brand-border)]">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/15 flex items-center justify-center flex-shrink-0">
          <Icon as={Target} size="md" className="text-accent-brand" />
        </div>
        <div className="min-w-0">
          <h3 className="t-h3 text-[var(--brand-text)]">Strategy Keywords</h3>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            {strategyKeywords.length} keyword{strategyKeywords.length === 1 ? '' : 's'} guiding tracking and recommendations
          </p>
        </div>
      </div>
    </div>

    {/* Add keyword form */}
    {workspaceId && (
      <div className="px-4 py-3 border-b border-[var(--brand-border)]">
        <form
          onSubmit={async e => {
            e.preventDefault();
            await addStrategyKeyword(newTrackedKeyword, { clearInput: true });
          }}
          className="flex gap-2"
        >
          <input
            id="strategy-keyword-input"
            type="text"
            value={newTrackedKeyword}
            onChange={e => setNewTrackedKeyword(e.target.value)}
            placeholder="Search or add a keyword..."
            disabled={addingKeyword}
            className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-3 py-2 t-caption-sm text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors"
            maxLength={120}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={addingKeyword}
            disabled={addingKeyword || newTrackedKeyword.trim().length < 2}
          >
            Add
          </Button>
        </form>
      </div>
    )}

    <div className="px-4 py-3 flex flex-col gap-4">

      {/* Confirmed zone */}
      <div>
        <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-2">
          In strategy · {sortedConfirmed.length}
        </div>
        {trackedKeywordsLoading && sortedConfirmed.length === 0 ? (
          <div className="flex flex-col gap-1">
            <Skeleton className="h-[52px] rounded-[var(--radius-lg)]" />
            <Skeleton className="h-[52px] rounded-[var(--radius-lg)]" />
            <Skeleton className="h-[52px] rounded-[var(--radius-lg)]" />
          </div>
        ) : sortedConfirmed.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No keywords in strategy yet"
            description="Add your first keyword above to start tracking and shaping recommendations."
          />
        ) : (
          <div className="flex flex-col gap-1">
            {sortedConfirmed.map(row => {
              const isOpen = openKeywordDrawer === row.normalized;
              const isRemoving = removingKeyword === row.normalized;
              return (
                <div
                  key={row.normalized}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] cursor-pointer transition-colors ${
                    isOpen
                      ? 'bg-[var(--surface-3)] border border-teal-500/40 ring-1 ring-teal-500/10'
                      : 'bg-[var(--surface-3)] border border-transparent hover:border-[var(--brand-border)]'
                  }`}
                  onClick={() => setOpenKeywordDrawer(isOpen ? null : row.normalized)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{row.label}</div>
                    <div className="t-caption text-[var(--brand-text-muted)] truncate">{roleSubLabel(row)}</div>
                  </div>
                  {isOpen ? (
                    <span className="text-teal-400 t-caption flex-shrink-0 select-none">→</span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remove ${row.label} from strategy`}
                      className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40"
                      disabled={isRemoving}
                      onClick={e => {
                        e.stopPropagation();
                        void removePriorityKeyword(row);
                      }}
                    >
                      <Icon as={X} size="xs" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Suggestions zone */}
      {keywordIdeaRows.length > 0 && (
        <div>
          <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-2">
            Suggestions · {keywordIdeaRows.length}
          </div>
          <div className="flex flex-col gap-1">
            {keywordIdeaRows.map(row => (
              <div
                key={row.normalized}
                className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] bg-blue-950/60 border border-blue-900/50 cursor-pointer hover:border-blue-800/60 transition-colors"
                onClick={() => setOpenKeywordDrawer(openKeywordDrawer === row.normalized ? null : row.normalized)}
              >
                <div className="flex-1 min-w-0">
                  <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{row.label}</div>
                  {(row.volume != null || row.difficulty != null) && (
                    <div className="t-caption text-[var(--brand-text-muted)] truncate">
                      {[
                        row.volume != null && (row.volume >= 1000 ? `${(row.volume / 1000).toFixed(1)}k/mo` : `${row.volume}/mo`),
                        row.difficulty != null && `KD ${row.difficulty}`,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    className="t-caption text-teal-400 hover:text-teal-300 transition-colors whitespace-nowrap disabled:opacity-40"
                    disabled={addingKeyword}
                    onClick={e => {
                      e.stopPropagation();
                      void addStrategyKeyword(row.label);
                    }}
                  >
                    Add to strategy
                  </button>
                  <button
                    type="button"
                    aria-label={`Dismiss ${row.label}`}
                    className="w-6 h-6 flex items-center justify-center text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                    onClick={e => {
                      e.stopPropagation();
                      void submitFeedback(row.label, 'declined', 'suggestion');
                    }}
                  >
                    <Icon as={X} size="xs" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  </div>
);
```

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors. If typecheck fails:
- `X` icon: confirm it's imported (used elsewhere in the file — should already be there)
- `Skeleton`, `EmptyState`, `Button`, `Icon`, `Target`: confirm all imported
- `openKeywordDrawer`, `setOpenKeywordDrawer`: confirm added in Task 2 Step 6
- `sortedConfirmed`, `roleSubLabel`: confirm added in Step 1 of this task

- [ ] **Step 4: Commit**

```bash
git add src/components/client/StrategyTab.tsx
git commit -m "feat(strategy-keywords): replace table with two-zone flat list"
```

---

### Task 4: Add the keyword detail drawer (Model: sonnet)

**Owns:** `src/components/client/StrategyTab.tsx` (component body + return statement)
**Must not touch:** all other files

The drawer is a fixed-position overlay that slides in from the right (or up from the bottom on mobile) when a row is clicked. It renders at the top level of the component return — **not** inside `priorityKeywordsPanel`. It contains: header (keyword name + role badge + close), metrics strip (volume/KD/trend), rationale, signals chips, next move with CTA, and footer actions.

**PR-check compliance required:**
- `fixed inset-0` backdrop: must have `// fixed-inset-ok` comment
- z-index: must use `z-[var(--z-modal-backdrop)]` and `z-[var(--z-modal)]`

- [ ] **Step 1: Add `roleBadgeClass` helper function in the component body (before the return statement, near other helpers)**

```typescript
const roleBadgeClass = (role: StrategyKeywordRole): string => {
  switch (role) {
    case 'content': return 'border-emerald-500/20 bg-emerald-500/8 text-accent-success';
    case 'page':    return 'border-blue-500/20 bg-blue-500/10 text-accent-info';
    case 'strategy':return 'border-teal-500/20 bg-teal-500/8 text-accent-brand';
    case 'idea':    return 'border-[var(--brand-border)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]';
  }
};
```

- [ ] **Step 2: Add escape key handler**

In the existing group of `useEffect` hooks, add:

```typescript
useEffect(() => {
  if (!openKeywordDrawer) return;
  const handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (
      e.key === 'Escape' &&
      !target.isContentEditable &&
      target.tagName !== 'INPUT' &&
      target.tagName !== 'TEXTAREA'
    ) {
      setOpenKeywordDrawer(null);
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [openKeywordDrawer]);
```

- [ ] **Step 3: Add drawer JSX to the component return**

In the component's `return (...)`, find the outermost wrapper `<div>` that contains all tab sections. Add the following **after** the section that renders `{priorityKeywordsRef}` / `{priorityKeywordsPanel}` and **before** the closing tag of the outermost wrapper:

```tsx
{/* Keyword detail drawer */}
{openKeywordDrawer && (() => {
  const allRows: StrategyKeywordTableRow[] = [...sortedConfirmed, ...keywordIdeaRows];
  const drawerRow = allRows.find(r => r.normalized === openKeywordDrawer);
  if (!drawerRow) return null;
  const isConfirmed = drawerRow.status === 'client' || drawerRow.status === 'strategy';
  const isRemoving = removingKeyword === drawerRow.normalized;
  const kdColorClass =
    drawerRow.difficulty == null  ? 'text-[var(--brand-text-muted)]'
    : drawerRow.difficulty < 30   ? 'text-emerald-400'
    : drawerRow.difficulty < 50   ? 'text-amber-400'
    : 'text-red-400';
  const trendIcon =
    drawerRow.trendDirection === 'rising'   ? '↑'
    : drawerRow.trendDirection === 'declining' ? '↓'
    : drawerRow.trendDirection === 'stable'    ? '→'
    : '—';
  const trendColorClass =
    drawerRow.trendDirection === 'rising'    ? 'text-emerald-400'
    : drawerRow.trendDirection === 'declining' ? 'text-red-400'
    : 'text-[var(--brand-text-muted)]';
  return (
    <>
      {/* fixed-inset-ok: keyword detail drawer backdrop */}
      <div
        className="fixed inset-0 z-[var(--z-modal-backdrop)]"
        onClick={() => setOpenKeywordDrawer(null)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label={`Keyword details: ${drawerRow.label}`}
        className="fixed inset-x-0 bottom-0 h-[65vh] sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-auto sm:w-full sm:max-w-sm bg-[var(--surface-2)] border-t border-[var(--brand-border)] sm:border-t-0 sm:border-l z-[var(--z-modal)] flex flex-col overflow-hidden animate-in slide-in-from-bottom sm:slide-in-from-right duration-200 rounded-t-[var(--radius-signature-lg)] sm:rounded-none"
      >
        {/* Drawer header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[var(--brand-border)] flex-shrink-0">
          <div className="min-w-0">
            <div className="t-page font-semibold text-[var(--brand-text-bright)] leading-snug break-words">
              {drawerRow.label}
            </div>
            <span className={`inline-flex items-center mt-2 px-2 py-0.5 rounded-[var(--radius-pill)] border t-caption-sm font-medium ${roleBadgeClass(drawerRow.role)}`}>
              {drawerRow.roleLabel}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close keyword detail"
            className="flex-shrink-0 mt-0.5 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-colors"
            onClick={() => setOpenKeywordDrawer(null)}
          >
            <Icon as={X} size="sm" />
          </button>
        </div>

        {/* Metrics strip */}
        <div className="grid grid-cols-3 divide-x divide-[var(--brand-border)] border-b border-[var(--brand-border)] flex-shrink-0">
          <div className="px-3 py-2.5">
            <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Volume</div>
            <div className="t-stat-sm text-[var(--brand-text-bright)]">
              {drawerRow.volume != null
                ? drawerRow.volume >= 1000
                  ? `${(drawerRow.volume / 1000).toFixed(1)}k/mo`
                  : `${drawerRow.volume}/mo`
                : '—'}
            </div>
          </div>
          <div className="px-3 py-2.5">
            <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Difficulty</div>
            <div className={`t-stat-sm ${kdColorClass}`}>
              {drawerRow.difficulty != null ? `KD ${drawerRow.difficulty}` : '—'}
            </div>
          </div>
          <div className="px-3 py-2.5">
            <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Trend</div>
            <div className={`t-stat-sm ${trendColorClass}`}>
              {drawerRow.trendDirection != null
                ? `${trendIcon} ${drawerRow.trendDirection}`
                : trendIcon}
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">

          {/* Why it's in the strategy */}
          <div>
            <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">
              Why it's in the strategy
            </div>
            <p className="t-body text-[var(--brand-text-muted)] leading-relaxed">
              {drawerRow.rationale ?? drawerRow.opportunityDetail}
            </p>
          </div>

          {/* Signals */}
          {drawerRow.contextSources.length > 0 && (
            <div>
              <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">
                Signals
              </div>
              <div className="flex flex-wrap gap-1.5">
                {drawerRow.contextSources.map(src => (
                  <span
                    key={src}
                    className="px-2 py-0.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] t-caption text-[var(--brand-text-muted)]"
                  >
                    {src}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Next move */}
          <div className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] p-3">
            <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">
              Next move
            </div>
            <p className="t-body text-[var(--brand-text)] leading-relaxed mb-3">
              {drawerRow.nextMoveDetail}
            </p>
            {drawerRow.role === 'content' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onTabChange?.('content');
                  setOpenKeywordDrawer(null);
                }}
              >
                Request content
              </Button>
            )}
            {(drawerRow.role === 'page' || drawerRow.role === 'strategy') && drawerRow.pagePath && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onTabChange?.('pages');
                  setOpenKeywordDrawer(null);
                }}
              >
                Go to page
              </Button>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--brand-border)] flex-shrink-0">
          {isConfirmed ? (
            <button
              type="button"
              className="t-caption text-[var(--brand-text-muted)] hover:text-red-400 transition-colors disabled:opacity-50"
              disabled={isRemoving}
              onClick={() => {
                void removePriorityKeyword(drawerRow);
                setOpenKeywordDrawer(null);
              }}
            >
              {isRemoving ? 'Removing...' : 'Remove from strategy'}
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                loading={addingKeyword}
                disabled={addingKeyword}
                onClick={() => {
                  void addStrategyKeyword(drawerRow.label);
                  setOpenKeywordDrawer(null);
                }}
              >
                Add to strategy
              </Button>
              <button
                type="button"
                className="t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                onClick={() => {
                  void submitFeedback(drawerRow.label, 'declined', 'suggestion');
                  setOpenKeywordDrawer(null);
                }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

      </div>
    </>
  );
})()}
```

**Note on `onTabChange` prop type:** Check the `StrategyTabProps` interface for the exact type of `onTabChange`. If it takes a `ClientTab` union (not a plain `string`), you may need to cast: `onTabChange?.('content' as ClientTab)`. Look up the `ClientTab` type in `src/routes.ts` if needed.

- [ ] **Step 4: Typecheck and build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors. Specifically verify:
- `sortedConfirmed` is in scope at the drawer site (it's defined just before `priorityKeywordsPanel`)
- `keywordIdeaRows` is in scope (defined earlier in the component body)
- `StrategyKeywordTableRow` type annotation on `allRows` is recognized
- `roleBadgeClass` is a function, not the old const string (the old one was removed in Task 2)

- [ ] **Step 5: Commit**

```bash
git add src/components/client/StrategyTab.tsx
git commit -m "feat(strategy-keywords): add keyword detail drawer with metrics, rationale, and signals"
```

---

### Task 5: Final verification and docs (Model: any)

**Owns:** `FEATURE_AUDIT.md`, `data/roadmap.json`, `BRAND_DESIGN_LANGUAGE.md`
**Must not touch:** `src/components/client/StrategyTab.tsx` (code changes complete)

- [ ] **Step 1: Full quality gates**

```bash
npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts
```

Expected:
- `typecheck`: zero errors
- `vite build`: successful
- `pr-check`: zero errors (the "Page component missing PageHeader" warning is pre-existing — ignore it)

Specifically confirm in pr-check output:
- ✓ Hand-rolled fixed inset-0 outside overlay — the `fixed-inset-ok` comment satisfies this
- ✓ Raw z-index class — all z-index uses `z-[var(--z-*)]` tokens
- ✓ text-green-{N} — none (used `text-emerald-*` for success)
- ✓ Forbidden hues — no violet, indigo, rose, pink

- [ ] **Step 2: Manual acceptance criteria**

Start the dev server (`npm run dev:all`) and open the client dashboard Strategy tab. Verify:

| Criterion | How to verify |
|-----------|--------------|
| No row wrapping | Drag browser to 320px width — keyword name truncates, sublabel stays one line |
| Confirmed zone shows strategy keywords | "In strategy · N" header visible, keyword rows listed |
| Suggestions zone shows ideas | "Suggestions · N" header visible below confirmed zone |
| Clicking confirmed row opens drawer | Drawer slides in from right (desktop) or bottom (mobile) |
| Selected row has teal ring | The open row gets a teal border/ring |
| Clicking same row again closes drawer | Second click toggles closed |
| Clicking different row swaps content | Drawer stays open, content updates to new keyword |
| ✕ on confirmed row removes without opening drawer | `e.stopPropagation()` prevents drawer from opening |
| "Add to strategy" on suggestion adds and removes it | Keyword moves to confirmed zone |
| Dismiss (✕) on suggestion removes it | Suggestion disappears |
| Drawer header shows role badge with correct color | emerald=content, blue=page, teal=strategy, zinc=idea |
| Metrics strip shows volume / KD / trend | KD colored by difficulty; trend only shown for content gap keywords |
| "Why it's in the strategy" uses rationale or opportunityDetail | Body text visible in drawer |
| Signals chips render | If contextSources is non-empty, chips appear |
| Next move text visible | Drawer scrollable body shows nextMoveDetail |
| Drawer closes on ✕ button | Click X in drawer header |
| Drawer closes on backdrop click | Click outside the drawer panel |
| Drawer closes on Escape key | Press Escape (while not focused on an input) |
| Empty state shown when no keywords | Remove all confirmed keywords — EmptyState appears |

- [ ] **Step 3: Update `FEATURE_AUDIT.md`**

Find the Strategy Keywords entry and update it to reflect the new design: two-zone flat list with a slide-in detail drawer, no sort controls, role labels as text sublabels.

- [ ] **Step 4: Update `data/roadmap.json`**

Mark the strategy-keywords-rebuild item `"status": "done"` and add a `"notes"` field summarizing what shipped. Run:

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 5: Update `BRAND_DESIGN_LANGUAGE.md`**

If any new color patterns were introduced (e.g., `bg-blue-950/60` for suggestion rows, role badge classes), add them under the Strategy Keywords section or the relevant component entry.

- [ ] **Step 6: Code review**

Invoke `superpowers:requesting-code-review` (single task, single file — not scaled review). Fix any Critical or Important issues before opening the PR.

- [ ] **Step 7: Final commit**

```bash
git add src/components/client/StrategyTab.tsx
git commit -m "$(cat <<'EOF'
feat(strategy-keywords): complete two-zone list and detail drawer rebuild

Replaces sortable 7-column table + accordion expand with a two-zone
flat list (confirmed above, suggestions below) and a 360px slide-in
detail drawer. Zero row-wrapping: keyword name and role·volume·KD
sublabel both truncate on one line. Drawer shows metrics, AI rationale,
signals chips, and next move with CTA. Mobile renders as bottom sheet.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Systemic Improvements

- **Shared utilities:** None needed. The drawer is sufficiently local to `StrategyTab.tsx`. Extract only if a second component needs the same pattern.
- **pr-check rules:** None needed. Existing rules for `fixed-inset-ok` (backdrop), `z-[var(--z-*)]` (z-index tokens), and forbidden hue classes already cover everything introduced here.
- **New tests:** None required. This is a render-layer replacement with no new data logic, API routes, or state transitions. Existing integration tests cover the `removePriorityKeyword` and `addStrategyKeyword` API calls unchanged. Revisit if the drawer's `submitFeedback` (dismiss) path lacks coverage.

---

## Verification Strategy

All verification commands are in Task 5, Steps 1–2. Summary:

```bash
npm run typecheck        # zero type errors
npx vite build           # production build green
npx tsx scripts/pr-check.ts  # zero violations
npm run dev:all          # manual acceptance criteria (see Task 5 table)
```

PR target: `staging` branch. After staging deploy verifies, merge `staging` → `main`.
