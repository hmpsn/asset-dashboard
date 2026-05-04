# Strategy Keywords — Component Rebuild Pre-Plan Audit

**Date:** 2026-05-03
**Spec:** docs/superpowers/specs/2026-05-03-strategy-keywords-design.md
**Total findings:** Single file, ~565 lines touched (415 removed, ~150 state/function lines removed, ~250 new lines)

---

## Scope Confirmation

This is a **single-file render-layer replacement** inside `src/components/client/StrategyTab.tsx`. The data layer (API calls, data-building functions, state management for add/remove) is preserved. Only the JSX render and table-specific state/helpers change.

---

## Findings: What Gets Removed

### Panel JSX — FULL REPLACEMENT

| Item | Lines | Notes |
|------|-------|-------|
| `priorityKeywordsPanel` JSX | 749–1163 | 415-line panel — entire block replaced |
| Panel rendering + TierGate | 1259–1262 | Kept; new panel replaces `{priorityKeywordsPanel}` |

### State Variables — REMOVE

| Variable | Line | Reason |
|----------|------|--------|
| `priorityKeywordSearch` | 187 | Search input removed |
| `includeKeywordIdeas` | 188 | Ideas toggle removed; suggestions always shown |
| `expandedKeywordRows` | 189 | Accordion removed; replaced by drawer |
| `keywordSort` | 190 | Sort controls removed |
| `confirmRemoveKeyword` | 185 | Inline confirm flow removed; drawer handles remove |
| `managingKeyword` | 192 | Manage mode removed |
| `confirmRemoveKeywordButtonRef` | 194 | Ref for confirm button removed |
| `useEffect` for ref focus | 196–198 | Only served `confirmRemoveKeywordButtonRef` |

### State Variables — ADD

| Variable | Type | Purpose |
|----------|------|---------|
| `openKeywordDrawer` | `string \| null` | Normalized keyword string of row whose drawer is open |

### Functions / Computed Values — REMOVE

| Item | Lines | Reason |
|------|-------|--------|
| `filteredKeywordRows` | 613–621 | Search filter gone |
| `roleOrder` | 623–634 | Role sort gone |
| `sortedKeywordRows` (complex) | 636–655 | Full sort replaced by simple `opportunityScore` desc sort |
| `hasPriorityKeywordSearch` | 657 | Search gone |
| `priorityKeywordEmptyMessage` | 658 | Search gone |
| `keywordSearchLabel` | 665 | Search input gone |
| `toggleKeywordRow` | 671–676 | Accordion gone |
| `handleKeywordConfirmKeyDown` | 687 | Inline confirm gone |
| `opportunityClass` | 700–707 | Table chip coloring gone |
| `keywordSortColumns` | 691–698 | Sort gone |
| `roleBadgeClass` const | 698 | Replaced by per-role logic in new list rows |
| `handleKeywordSort` | 667–669 | Sort gone |
| `getKeywordRemovalCopy` | 680–689 | Inline removal copy gone |
| `getKeywordRemovalActionLabel` | 709–713 | Inline action label gone |
| `getKeywordKeepActionLabel` | 715 | Inline keep label gone |

### Icon Imports — REMOVE (after panel replacement)

| Import | Used At | Status |
|--------|---------|--------|
| `Search` | Line 840 (panel only) | Remove after rebuild |
| `ArrowUpDown` | Line 886 (panel only) | Remove after rebuild |

---

## Findings: What Stays

### State / Functions — KEEP

| Item | Lines | Why kept |
|------|-------|---------|
| `trackedKeywords` | 181 | Core data for list |
| `newTrackedKeyword` | 182 | Add input state |
| `addingKeyword` | 183 | Loading state |
| `removingKeyword` | 184 | Loading state |
| `trackedKeywordsLoading` | 186 | Loading state |
| `trackedKeywordsError` | 191 | Error state (rendered outside TierGate at line 1322) |
| `addStrategyKeyword` | 717 | API handler — called by new add form |
| `removePriorityKeyword` | 200 | API handler — called by drawer remove action |
| `loadTrackedKeywords` | 253 | Data loader |
| `priorityKeywordMap` | 340–383 | Core data merge logic |
| `strategyKeywords` | 385 | Confirmed keywords list |
| `keywordIdeas` | 386 | Suggestions list |
| `getKeywordRole` | 403 | Called by `buildKeywordRow` |
| `getOpportunitySignal` | 436 | Called by `buildKeywordRow` |
| `getNextMove` | 515 | Called by `buildKeywordRow` |
| `buildKeywordRow` | 551 | Builds `StrategyKeywordTableRow` — needed for drawer data |
| `strategyKeywordRows` | 610 | Pre-computed confirmed rows for list + drawer |
| `keywordIdeaRows` | 611 | Pre-computed suggestion rows for list + drawer |

### Data Available for Drawer

| Drawer Section | Data Source | Field |
|----------------|-------------|-------|
| Keyword name | `StrategyKeywordTableRow.label` | Always present |
| Role badge | `StrategyKeywordTableRow.role` + `roleLabel` | Always present |
| Volume | `StrategyKeywordTableRow.volume` | Optional |
| KD (difficulty) | `StrategyKeywordTableRow.difficulty` | Optional; field name is `difficulty` |
| Trend | `strategyData.contentGaps.find(g => g.targetKeyword === kw)?.trendDirection` | `'rising' \| 'declining' \| 'stable'`, content gap keywords only |
| "Why it's here" | `StrategyKeywordTableRow.opportunityDetail` (computed) | Always present |
| Raw AI rationale | `strategyData.contentGaps.find(g => g.targetKeyword === kw)?.rationale` | Content gap keywords only |
| Signals chips | `StrategyKeywordTableRow.contextSources` (array) | Always present |
| SERP features | `strategyData.contentGaps.find(g => g.targetKeyword === kw)?.serpFeatures` | Content gap keywords only |
| Next move text | `StrategyKeywordTableRow.nextMoveDetail` | Always present |
| Page link | `StrategyKeywordTableRow.pagePath` + `pageTitle` | Optional |

**Critical note:** `StrategyKeywordTableRow` does NOT have a `rationale` field or a `trendDirection` field. These must be looked up from `strategyData.contentGaps` by matching keyword. Either look up inline in the drawer render, or add `rationale?: string` and `trendDirection?: string` fields to `StrategyKeywordTableRow` and populate in `buildKeywordRow`.

**Recommendation:** Add `rationale?: string` and `trendDirection?: string` to `StrategyKeywordTableRow` and populate them in `buildKeywordRow` when a content gap match exists. Cleaner than inline lookups in the drawer.

---

## Drawer Implementation Pattern

**Follow:** `src/components/ContentPipeline.tsx` lines 248–266 (right-side overlay drawer).

```tsx
{/* Backdrop — fixed-inset-ok: keyword detail drawer */}
<div
  className="fixed inset-0 z-[var(--z-modal-backdrop)]"
  onClick={() => setOpenKeywordDrawer(null)}
/>
{/* Drawer */}
<div className="fixed inset-y-0 right-0 w-[360px] bg-[var(--surface-2)] border-l border-[var(--brand-border)] z-[var(--z-modal)] flex flex-col animate-in slide-in-from-right duration-200 overflow-hidden">
  ...
</div>
```

**PR-check compliance:**
- `fixed inset-0` → requires `// fixed-inset-ok` comment on same line or `fixed-inset-ok` in the className comment
- z-index → must use `z-[var(--z-modal-backdrop)]` and `z-[var(--z-modal)]`, NOT raw numbers

**Mobile:** On viewports < 700px, convert to bottom sheet:
```tsx
className="fixed inset-x-0 bottom-0 h-[60vh] ... sm:inset-y-0 sm:right-0 sm:w-[360px] sm:h-auto"
```

---

## Existing Coverage Check

| Pattern | Covered? | Notes |
|---------|---------|-------|
| Right-side overlay drawer | ✅ Yes | ContentPipeline.tsx is the reference |
| `z-[var(--z-modal)]` pattern | ✅ Yes | Used in NotificationBell, ContentPipeline |
| `bg-[var(--surface-2)]` for drawer bg | ✅ Yes | Used in NotificationBell |
| `animate-in slide-in-from-right` | ✅ Yes | Used in ContentPipeline |
| `// fixed-inset-ok` pattern | ✅ Yes | Required and documented in pr-check |
| Role label display | ❌ Not yet | New pattern, define in new list rows |
| Keyword detail drawer | ❌ Not yet | New component, no existing precedent |

---

## Infrastructure Recommendations

### 1. Extend `StrategyKeywordTableRow` (in `buildKeywordRow`)
Add two optional fields for drawer use:
```typescript
rationale?: string;       // from contentGaps[].rationale
trendDirection?: 'rising' | 'declining' | 'stable';  // from contentGaps[].trendDirection
```
Populate in `buildKeywordRow` when a content gap match is found. This keeps the drawer render clean — no inline `strategyData.contentGaps.find(...)` calls.

### 2. No new shared components needed
The drawer is sufficiently local to StrategyTab that an inline sub-component is appropriate. If a future feature needs the same drawer pattern, extract then.

### 3. No pr-check rules needed
The existing `fixed-inset-ok` and z-index rules already cover the drawer. No new prevention gaps identified.

### 4. TypeScript: `StrategyKeywordSortKey` type
Once `keywordSort` state and all sort columns are removed, this type alias (line 74) becomes unused. Remove it.

---

## Parallelization Strategy

### This is a single-agent task (no parallelization possible)

`StrategyTab.tsx` is a single 2000+ line file. Splitting it between agents would create merge conflicts. One Sonnet agent owns the entire file.

**Recommended sequence (single agent):**

**Step 1 — Interface extension** (5 min)
- Add `rationale?: string` and `trendDirection?: string` to `StrategyKeywordTableRow` interface
- Populate in `buildKeywordRow` from content gap match

**Step 2 — Remove dead state and functions** (10 min)
- Remove 8 state declarations (lines 185–197)
- Remove 15 functions/computed values (lines 551–715 range)
- Remove 2 unused icon imports

**Step 3 — Replace `priorityKeywordsPanel`** (30 min)
- Replace lines 749–1163 with new two-zone list JSX
- Confirmed zone: `strategyKeywords` rows sorted by `opportunityScore` desc
- Suggestions zone: `keywordIdeaRows` rows
- Row anatomy: keyword name + role sublabel + remove ✕
- Selected state: teal ring on open drawer row

**Step 4 — Add keyword detail drawer** (20 min)
- Add `openKeywordDrawer` state
- Inline drawer component below the list panel
- Sections: header, metrics strip, rationale, signals chips, next move, footer action
- Backdrop + escape key handling

**Step 5 — Verify**
- `npm run typecheck && npx vite build`
- All acceptance criteria from spec

---

## Model Assignments

| Task | Model | Reasoning |
|------|-------|-----------|
| Full StrategyTab.tsx rebuild | **Sonnet** | Large file, needs to read and understand all the data structures, interfaces, and existing patterns before writing. Complex enough for Sonnet, not Haiku. |
| Typecheck + build verification | Any | Mechanical |
