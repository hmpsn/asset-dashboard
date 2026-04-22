# Roadmap Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-accordion roadmap UI with a dual-mode Sprint View (flat section headers) + Backlog View (sortable table), add `createdAt`/`featureId`/`tags` fields to `RoadmapItem`, and migrate 25 stranded pending items out of the `shipped-earlier` archive bucket.

**Architecture:** All filtering is client-side — 541 items with React state is well within budget. Filter state lives in `useSearchParams` so every combination is deep-linkable. A new pure-function module (`src/lib/roadmapFilters.ts`) owns all filter/sort logic so components stay thin. The orchestrator (`Roadmap.tsx`) parses URL params and passes a typed `RoadmapFilters` object down to view components.

**Tech Stack:** React 19, React Router DOM 7 (`useSearchParams`), React Query (`@tanstack/react-query`), TypeScript strict, Tailwind CSS 4, Vitest.

---

## Pre-requisites

- [x] Spec committed: `docs/superpowers/specs/2026-04-22-roadmap-redesign-design.md`

---

## File Structure

**Created:**
- `src/lib/roadmapFilters.ts` — pure filter/sort functions, `RoadmapFilters` type, `DEFAULT_FILTERS`, `FlatRoadmapItem` type
- `src/components/RoadmapFilterBar.tsx` — shared filter dropdowns, reads/writes `useSearchParams`
- `src/components/RoadmapSprintView.tsx` — sprint section-header flat list
- `src/components/RoadmapBacklogView.tsx` — sortable table with inline row detail drawer
- `src/components/RoadmapVelocityChart.tsx` — `ShippingVelocityChart` extracted from `Roadmap.tsx`
- `scripts/migrate-roadmap-strays.ts` — one-time migration script (run once, keep for audit trail)
- `tests/unit/roadmapMigration.test.ts` — data integrity guard
- `tests/unit/roadmapFilters.test.ts` — unit tests for pure filter/sort functions

**Modified:**
- `shared/types/roadmap.ts` — add `createdAt?`, `featureId?`, `tags?` to `RoadmapItem`
- `data/roadmap.json` — 25 pending items moved from `shipped-earlier` → `backlog` (via migration script)
- `scripts/sort-roadmap.ts` — add `createdAt` reminder comment
- `src/components/Roadmap.tsx` — orchestrator refactor (TabBar, filter state, view dispatch)

---

## Task Dependencies

```
Task 1 (Schema + Migration)
        ↓
Task 2 (Filter Utils + Tests)
        ↓
  ┌─────┼─────┐
Task 3  Task 4  Task 5    ← parallel
(FilterBar) (SprintView) (BacklogView)
  └─────┴─────┘
        ↓
Task 6 (Orchestrator — Roadmap.tsx)
        ↓
Task 7 (Quality Gates)
```

Sequential: Task 1 → Task 2 → [Tasks 3, 4, 5 in parallel] → Task 6 → Task 7.

---

## Task 1 — Schema + Data Migration (Model: haiku)

**Owns:** `shared/types/roadmap.ts`, `data/roadmap.json`, `scripts/sort-roadmap.ts`, `scripts/migrate-roadmap-strays.ts`, `tests/unit/roadmapMigration.test.ts`
**Must not touch:** any file in `src/`

### Step 1: Update `shared/types/roadmap.ts`

Replace the entire file:

```ts
// ── Roadmap domain types ────────────────────────────────────────

export interface RoadmapItem {
  id: number;
  title: string;
  source: string;
  est: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  notes: string;
  status: 'done' | 'in_progress' | 'pending';
  shippedAt?: string;   // ISO date — set when item first reaches 'done'
  createdAt?: string;   // ISO date — forward-only; undefined for pre-existing items
  featureId?: number;   // soft reference to id field in data/features.json
  tags?: string[];      // free-form labels e.g. ["auth", "infra"]
}

export interface SprintData {
  id: string;
  name: string;
  rationale: string;
  hours: string;
  items: RoadmapItem[];
}
```

### Step 2: Write the migration test (failing first)

Create `tests/unit/roadmapMigration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function loadRoadmap() {
  const raw = fs.readFileSync(path.resolve('data/roadmap.json'), 'utf-8');
  return JSON.parse(raw) as { sprints: Array<{ id: string; items: Array<{ status: string }> }> };
}

describe('roadmap data integrity', () => {
  it('shipped-earlier sprint has no pending items', () => {
    const { sprints } = loadRoadmap();
    const earlier = sprints.find(s => s.id === 'shipped-earlier');
    expect(earlier, 'shipped-earlier sprint must exist').toBeDefined();
    const pending = earlier!.items.filter(i => i.status === 'pending');
    expect(pending, 'no pending items should remain in shipped-earlier').toHaveLength(0);
  });
});
```

### Step 3: Run test to verify it fails

```bash
npx vitest run tests/unit/roadmapMigration.test.ts --reporter=verbose
```

Expected: FAIL — `expect(received).toHaveLength(0)` with received length 25.

### Step 4: Write the migration script

Create `scripts/migrate-roadmap-strays.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('data/roadmap.json');
const raw = fs.readFileSync(filePath, 'utf-8');
const data = JSON.parse(raw) as { sprints: Array<{ id: string; items: Array<{ status: string }> }> };

const earlierIdx = data.sprints.findIndex(s => s.id === 'shipped-earlier');
const backlogIdx = data.sprints.findIndex(s => s.id === 'backlog');
if (earlierIdx === -1) throw new Error('shipped-earlier sprint not found');
if (backlogIdx === -1) throw new Error('backlog sprint not found');

const strays = data.sprints[earlierIdx].items.filter(i => i.status === 'pending');
data.sprints[earlierIdx].items = data.sprints[earlierIdx].items.filter(i => i.status !== 'pending');
data.sprints[backlogIdx].items = [...data.sprints[backlogIdx].items, ...strays];

fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
console.log(`Moved ${strays.length} pending items from shipped-earlier → backlog`);
```

### Step 5: Run the migration

```bash
npx tsx scripts/migrate-roadmap-strays.ts
```

Expected output: `Moved 25 pending items from shipped-earlier → backlog`

### Step 6: Run test to verify it passes

```bash
npx vitest run tests/unit/roadmapMigration.test.ts --reporter=verbose
```

Expected: PASS.

### Step 7: Add `createdAt` reminder to `scripts/sort-roadmap.ts`

Find the top of `scripts/sort-roadmap.ts` (after any existing imports) and add:

```ts
// When adding new items to roadmap.json manually, include:
//   "createdAt": "YYYY-MM-DD"
// Existing items intentionally omit this field (forward-only policy).
```

### Step 8: Commit

```bash
git add shared/types/roadmap.ts data/roadmap.json scripts/sort-roadmap.ts scripts/migrate-roadmap-strays.ts tests/unit/roadmapMigration.test.ts
git commit -m "feat(roadmap): add createdAt/featureId/tags schema fields + migrate 25 stranded items to backlog"
```

---

## Task 2 — Filter Utilities + Tests (Model: sonnet)

**Owns:** `src/lib/roadmapFilters.ts`, `tests/unit/roadmapFilters.test.ts`
**Must not touch:** any component files, `shared/types/roadmap.ts`
**Depends on:** Task 1 complete

### Step 1: Write the failing tests

Create `tests/unit/roadmapFilters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesFilters, sortItems, DEFAULT_FILTERS } from '../../src/lib/roadmapFilters.js';
import type { RoadmapItem } from '../../shared/types/roadmap.js';

const base: RoadmapItem = {
  id: 1, title: 'Test', source: 'test', est: '1h',
  priority: 'P1', notes: '', status: 'pending',
};

describe('matchesFilters', () => {
  it('returns true when all filters are "all"', () => {
    expect(matchesFilters(base, DEFAULT_FILTERS, 'backlog')).toBe(true);
  });

  it('filters by priority', () => {
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, priority: 'P0' }, 'backlog')).toBe(false);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, priority: 'P1' }, 'backlog')).toBe(true);
  });

  it('filters by status', () => {
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, status: 'done' }, 'backlog')).toBe(false);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, status: 'pending' }, 'backlog')).toBe(true);
  });

  it('filters by sprint id', () => {
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, sprint: 'backlog' }, 'backlog')).toBe(true);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, sprint: 'other' }, 'backlog')).toBe(false);
  });

  it('filters by tags with OR semantics', () => {
    const tagged: RoadmapItem = { ...base, tags: ['auth', 'infra'] };
    expect(matchesFilters(tagged, { ...DEFAULT_FILTERS, tags: 'auth' }, 'backlog')).toBe(true);
    expect(matchesFilters(tagged, { ...DEFAULT_FILTERS, tags: 'infra,analytics' }, 'backlog')).toBe(true);
    expect(matchesFilters(tagged, { ...DEFAULT_FILTERS, tags: 'analytics' }, 'backlog')).toBe(false);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, tags: 'auth' }, 'backlog')).toBe(false);
  });

  it('filters by featureId (compared as string)', () => {
    const withFeature: RoadmapItem = { ...base, featureId: 5 };
    expect(matchesFilters(withFeature, { ...DEFAULT_FILTERS, feature: '5' }, 'backlog')).toBe(true);
    expect(matchesFilters(withFeature, { ...DEFAULT_FILTERS, feature: '6' }, 'backlog')).toBe(false);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, feature: '5' }, 'backlog')).toBe(false);
  });
});

describe('sortItems', () => {
  type FlatItem = RoadmapItem & { sprintId: string; sprintName: string };
  const items: FlatItem[] = [
    { ...base, id: 3, priority: 'P2', status: 'pending', sprintId: 'a', sprintName: 'A' },
    { ...base, id: 1, priority: 'P0', status: 'done', sprintId: 'b', sprintName: 'B' },
    { ...base, id: 2, priority: 'P1', status: 'in_progress', sprintId: 'c', sprintName: 'C' },
  ];

  it('sorts by priority asc (P0 first)', () => {
    const sorted = sortItems(items, 'priority', 'asc');
    expect(sorted.map(i => i.priority)).toEqual(['P0', 'P1', 'P2']);
  });

  it('sorts by priority desc (P4 first)', () => {
    const sorted = sortItems(items, 'priority', 'desc');
    expect(sorted.map(i => i.priority)).toEqual(['P2', 'P1', 'P0']);
  });

  it('sorts by status asc — in_progress → pending → done', () => {
    const sorted = sortItems(items, 'status', 'asc');
    expect(sorted.map(i => i.status)).toEqual(['in_progress', 'pending', 'done']);
  });

  it('sorts by id asc', () => {
    const sorted = sortItems(items, 'id', 'asc');
    expect(sorted.map(i => i.id)).toEqual([1, 2, 3]);
  });

  it('does not mutate the original array', () => {
    const original = items.map(i => i.id);
    sortItems(items, 'priority', 'asc');
    expect(items.map(i => i.id)).toEqual(original);
  });
});
```

### Step 2: Run tests to verify they fail

```bash
npx vitest run tests/unit/roadmapFilters.test.ts --reporter=verbose
```

Expected: FAIL — `Cannot find module '../../src/lib/roadmapFilters.js'`

### Step 3: Create `src/lib/roadmapFilters.ts`

```ts
import type { RoadmapItem } from '../../shared/types/roadmap.js';

export interface RoadmapFilters {
  priority: string;  // 'all' | 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
  status: string;    // 'all' | 'done' | 'in_progress' | 'pending'
  sprint: string;    // 'all' | sprint id
  feature: string;   // 'all' | feature id as string (matches String(item.featureId))
  tags: string;      // 'all' | comma-separated tag values (OR semantics)
}

export const DEFAULT_FILTERS: RoadmapFilters = {
  priority: 'all',
  status: 'all',
  sprint: 'all',
  feature: 'all',
  tags: 'all',
};

export function matchesFilters(
  item: RoadmapItem,
  filters: RoadmapFilters,
  sprintId: string,
): boolean {
  if (filters.priority !== 'all' && item.priority !== filters.priority) return false;
  if (filters.status !== 'all' && item.status !== filters.status) return false;
  if (filters.sprint !== 'all' && sprintId !== filters.sprint) return false;
  if (filters.feature !== 'all' && String(item.featureId ?? '') !== filters.feature) return false;
  if (filters.tags !== 'all') {
    const selected = filters.tags.split(',').filter(Boolean);
    if (!item.tags || !selected.some(t => item.tags!.includes(t))) return false;
  }
  return true;
}

export type SortKey = 'id' | 'priority' | 'status' | 'est' | 'createdAt';
export type SortDir = 'asc' | 'desc';

export type FlatRoadmapItem = RoadmapItem & { sprintId: string; sprintName: string };

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const STATUS_ORDER: Record<string, number> = { in_progress: 0, pending: 1, done: 2 };

export function sortItems(
  items: FlatRoadmapItem[],
  sortKey: SortKey,
  sortDir: SortDir,
): FlatRoadmapItem[] {
  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'priority':
        cmp = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
        break;
      case 'status':
        cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        break;
      case 'createdAt':
        cmp = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
        break;
      case 'est':
        cmp = a.est.localeCompare(b.est);
        break;
      default:
        cmp = a.id - b.id;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

export function filtersFromParams(params: URLSearchParams): RoadmapFilters {
  return {
    priority: params.get('priority') ?? 'all',
    status: params.get('status') ?? 'all',
    sprint: params.get('sprint') ?? 'all',
    feature: params.get('feature') ?? 'all',
    tags: params.get('tags') ?? 'all',
  };
}

export function deriveAllTags(sprints: Array<{ items: RoadmapItem[] }>): string[] {
  const set = new Set<string>();
  for (const sprint of sprints) {
    for (const item of sprint.items) {
      item.tags?.forEach(t => set.add(t));
    }
  }
  return Array.from(set).sort();
}
```

### Step 4: Run tests to verify they pass

```bash
npx vitest run tests/unit/roadmapFilters.test.ts --reporter=verbose
```

Expected: PASS — all 10 tests green.

### Step 5: Commit

```bash
git add src/lib/roadmapFilters.ts tests/unit/roadmapFilters.test.ts
git commit -m "feat(roadmap): add roadmapFilters utility — filter/sort/derive helpers with tests"
```

---

## Task 3 — RoadmapFilterBar (Model: sonnet) [PARALLEL with Tasks 4 & 5]

**Owns:** `src/components/RoadmapFilterBar.tsx`
**Must not touch:** `Roadmap.tsx`, `RoadmapSprintView.tsx`, `RoadmapBacklogView.tsx`
**Read-only imports:** `src/lib/roadmapFilters.ts` (Task 2), `shared/types/roadmap.ts` (Task 1)
**Depends on:** Tasks 1 and 2 complete

### Step 1: Create `src/components/RoadmapFilterBar.tsx`

```tsx
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import type { SprintData } from '../../shared/types/roadmap.js';

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All Priorities' },
  { value: 'P0', label: '🔴 P0 — Do Now' },
  { value: 'P1', label: '🟠 P1 — Do Next' },
  { value: 'P2', label: '🟡 P2 — Do Soon' },
  { value: 'P3', label: '🟢 P3 — Backlog' },
  { value: 'P4', label: '⚪ P4 — Someday' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: '○ Pending' },
  { value: 'in_progress', label: '◑ In Progress' },
  { value: 'done', label: '● Done' },
];

interface Props {
  sprints: SprintData[];
  featureMap: Map<number, string>;
  allTags: string[];
}

export function RoadmapFilterBar({ sprints, featureMap, allTags }: Props) {
  const [params, setParams] = useSearchParams();

  const priority = params.get('priority') ?? 'all';
  const status = params.get('status') ?? 'all';
  const sprint = params.get('sprint') ?? 'all';
  const feature = params.get('feature') ?? 'all';
  const tags = params.get('tags') ?? 'all';

  const setParam = (key: string, val: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (val === 'all') next.delete(key);
      else next.set(key, val);
      return next;
    }, { replace: true });
  };

  const clearAll = () => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      ['priority', 'status', 'sprint', 'feature', 'tags'].forEach(k => next.delete(k));
      return next;
    }, { replace: true });
  };

  const hasActiveFilter = [priority, status, sprint, feature, tags].some(v => v !== 'all');

  const cls = 'px-2.5 py-1.5 rounded-lg text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-200 cursor-pointer hover:border-zinc-600 transition-colors';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={priority} onChange={e => setParam('priority', e.target.value)} className={cls}>
        {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <select value={status} onChange={e => setParam('status', e.target.value)} className={cls}>
        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <select value={sprint} onChange={e => setParam('sprint', e.target.value)} className={cls}>
        <option value="all">All Sprints</option>
        {sprints.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {featureMap.size > 0 && (
        <select value={feature} onChange={e => setParam('feature', e.target.value)} className={cls}>
          <option value="all">All Features</option>
          {Array.from(featureMap.entries()).map(([id, name]) => (
            <option key={id} value={String(id)}>{name}</option>
          ))}
        </select>
      )}

      {allTags.length > 0 && (
        <select value={tags} onChange={e => setParam('tags', e.target.value)} className={cls}>
          <option value="all">All Tags</option>
          {allTags.map(tag => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      )}

      {hasActiveFilter && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 transition-colors"
        >
          <X className="w-3 h-3" />
          Clear filters
        </button>
      )}
    </div>
  );
}
```

### Step 2: Run typecheck

```bash
npm run typecheck 2>&1 | grep 'error TS' | head -20
```

Expected: zero errors.

### Step 3: Commit

```bash
git add src/components/RoadmapFilterBar.tsx
git commit -m "feat(roadmap): add RoadmapFilterBar — shared filter bar with URL param state"
```

---

## Task 4 — RoadmapSprintView (Model: sonnet) [PARALLEL with Tasks 3 & 5]

**Owns:** `src/components/RoadmapSprintView.tsx`
**Must not touch:** `Roadmap.tsx`, `RoadmapFilterBar.tsx`, `RoadmapBacklogView.tsx`
**Read-only imports:** `src/lib/roadmapFilters.ts`, `shared/types/roadmap.ts`
**Depends on:** Tasks 1 and 2 complete

### Step 1: Create `src/components/RoadmapSprintView.tsx`

```tsx
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import { Badge } from './ui/index.js';
import type { SprintData } from '../../shared/types/roadmap.js';
import type { RoadmapFilters } from '../lib/roadmapFilters.js';
import { matchesFilters } from '../lib/roadmapFilters.js';

const PRIORITY_BADGE: Record<string, { label: string; color: 'red' | 'orange' | 'amber' | 'green' | 'zinc' }> = {
  P0: { label: 'P0', color: 'red' },
  P1: { label: 'P1', color: 'orange' },
  P2: { label: 'P2', color: 'amber' },
  P3: { label: 'P3', color: 'green' },
  P4: { label: 'P4', color: 'zinc' },
};

const STATUS_ICON = {
  done: <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />,
  in_progress: <Clock className="w-3.5 h-3.5 text-teal-400 animate-pulse flex-shrink-0" />,
  pending: <Circle className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />,
};

interface Props {
  sprints: SprintData[];
  filters: RoadmapFilters;
  featureMap: Map<number, string>;
  onToggleStatus: (itemId: number) => void;
}

export function RoadmapSprintView({ sprints, filters, featureMap, onToggleStatus }: Props) {
  const visibleSprints = sprints.filter(sprint =>
    sprint.items.some(item => matchesFilters(item, filters, sprint.id)),
  );

  if (visibleSprints.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500 text-sm">
        No items match the current filters.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {visibleSprints.map(sprint => {
        const filteredItems = sprint.items.filter(item =>
          matchesFilters(item, filters, sprint.id),
        );
        const done = sprint.items.filter(i => i.status === 'done').length;
        const total = sprint.items.length;

        return (
          <div key={sprint.id}>
            {/* Sprint section header */}
            <div className="flex items-center gap-3 pb-2 border-b border-zinc-700/60">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">
                    {sprint.name}
                  </span>
                  <span className="text-[11px] text-zinc-500">{done}/{total} done</span>
                  {done === total && total > 0 && (
                    <CheckCircle2 className="w-3 h-3 text-green-400" />
                  )}
                </div>
                {sprint.rationale && (
                  <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{sprint.rationale}</p>
                )}
              </div>
              <span className="text-[11px] text-zinc-600 flex-shrink-0">{sprint.hours} hrs</span>
            </div>

            {/* Item list */}
            <div className="mt-2 bg-zinc-900/40 border border-zinc-800 rounded-lg divide-y divide-zinc-800/50">
              {filteredItems.map(item => {
                const pb = PRIORITY_BADGE[item.priority];
                const featureName = item.featureId != null ? featureMap.get(item.featureId) : undefined;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/30 transition-colors"
                  >
                    <span className="text-[10px] text-zinc-600 font-mono w-10 flex-shrink-0 text-right">
                      #{item.id}
                    </span>
                    <button
                      onClick={() => onToggleStatus(item.id)}
                      className="flex-shrink-0 hover:scale-110 transition-transform"
                      title={`Status: ${item.status} — click to cycle`}
                    >
                      {STATUS_ICON[item.status]}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs font-medium ${
                            item.status === 'done' ? 'text-zinc-500 line-through' : 'text-zinc-200'
                          }`}
                        >
                          {item.title}
                        </span>
                        <Badge label={pb.label} color={pb.color} />
                        {featureName && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                            {featureName}
                          </span>
                        )}
                        {item.tags?.map(tag => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-[11px] text-zinc-500">{item.est}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

### Step 2: Run typecheck

```bash
npm run typecheck 2>&1 | grep 'error TS' | head -20
```

Expected: zero errors.

### Step 3: Commit

```bash
git add src/components/RoadmapSprintView.tsx
git commit -m "feat(roadmap): add RoadmapSprintView — flat list with sprint section headers"
```

---

## Task 5 — RoadmapBacklogView (Model: sonnet) [PARALLEL with Tasks 3 & 4]

**Owns:** `src/components/RoadmapBacklogView.tsx`
**Must not touch:** `Roadmap.tsx`, `RoadmapFilterBar.tsx`, `RoadmapSprintView.tsx`
**Read-only imports:** `src/lib/roadmapFilters.ts`, `shared/types/roadmap.ts`
**Depends on:** Tasks 1 and 2 complete

### Step 1: Create `src/components/RoadmapBacklogView.tsx`

```tsx
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Circle, Clock, ArrowUpDown } from 'lucide-react';
import { Badge } from './ui/index.js';
import type { SprintData } from '../../shared/types/roadmap.js';
import type { RoadmapFilters, SortKey, SortDir, FlatRoadmapItem } from '../lib/roadmapFilters.js';
import { matchesFilters, sortItems } from '../lib/roadmapFilters.js';

const PRIORITY_BADGE: Record<string, { label: string; color: 'red' | 'orange' | 'amber' | 'green' | 'zinc' }> = {
  P0: { label: 'P0', color: 'red' },
  P1: { label: 'P1', color: 'orange' },
  P2: { label: 'P2', color: 'amber' },
  P3: { label: 'P3', color: 'green' },
  P4: { label: 'P4', color: 'zinc' },
};

const STATUS_ICON = {
  done: <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />,
  in_progress: <Clock className="w-3.5 h-3.5 text-teal-400 animate-pulse" />,
  pending: <Circle className="w-3.5 h-3.5 text-zinc-600" />,
};

interface Props {
  sprints: SprintData[];
  filters: RoadmapFilters;
  featureMap: Map<number, string>;
  onToggleStatus: (itemId: number) => void;
}

export function RoadmapBacklogView({ sprints, filters, featureMap, onToggleStatus }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const flatItems: FlatRoadmapItem[] = sprints.flatMap(sprint =>
    sprint.items
      .filter(item => matchesFilters(item, filters, sprint.id))
      .map(item => ({ ...item, sprintId: sprint.id, sprintName: sprint.name })),
  );

  const sorted = sortItems(flatItems, sortKey, sortDir);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-zinc-600" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-teal-400" />
      : <ChevronDown className="w-3 h-3 text-teal-400" />;
  }

  const th = 'px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-300 select-none';
  const thStatic = 'px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider';

  if (sorted.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500 text-sm">
        No items match the current filters.
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead className="border-b border-zinc-800">
          <tr>
            <th className={thStatic} style={{ width: '52px' }}>#</th>
            <th className={thStatic} style={{ minWidth: '220px' }}>Title</th>
            <th className={th} onClick={() => handleSort('priority')}>
              <span className="flex items-center gap-1">Priority <SortIcon col="priority" /></span>
            </th>
            <th className={th} onClick={() => handleSort('status')}>
              <span className="flex items-center gap-1">Status <SortIcon col="status" /></span>
            </th>
            <th className={thStatic}>Sprint</th>
            <th className={thStatic}>Feature</th>
            <th className={thStatic}>Tags</th>
            <th className={th} onClick={() => handleSort('est')}>
              <span className="flex items-center gap-1">Est <SortIcon col="est" /></span>
            </th>
            <th className={th} onClick={() => handleSort('createdAt')}>
              <span className="flex items-center gap-1">Added <SortIcon col="createdAt" /></span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {sorted.map(item => {
            const pb = PRIORITY_BADGE[item.priority];
            const featureName = item.featureId != null ? featureMap.get(item.featureId) : undefined;
            const isExpanded = expandedId === item.id;

            return (
              <Fragment key={item.id}>
                <tr
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="hover:bg-zinc-800/30 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2.5 font-mono text-[10px] text-zinc-600">#{item.id}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={e => { e.stopPropagation(); onToggleStatus(item.id); }}
                        className="hover:scale-110 transition-transform flex-shrink-0"
                        title={`Status: ${item.status} — click to cycle`}
                      >
                        {STATUS_ICON[item.status]}
                      </button>
                      <span className={item.status === 'done' ? 'text-zinc-500 line-through' : 'text-zinc-200'}>
                        {item.title}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge label={pb.label} color={pb.color} />
                  </td>
                  <td className="px-3 py-2.5 text-zinc-400 capitalize">
                    {item.status.replace('_', ' ')}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-500 text-[11px] max-w-[120px] truncate">
                    {item.sprintName}
                  </td>
                  <td className="px-3 py-2.5">
                    {featureName && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20 whitespace-nowrap">
                        {featureName}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {item.tags?.map(tag => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 whitespace-nowrap"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-500 whitespace-nowrap">{item.est}</td>
                  <td className="px-3 py-2.5 text-zinc-500 font-mono text-[10px] whitespace-nowrap">
                    {item.createdAt ?? '—'}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-zinc-800/20">
                    <td colSpan={9} className="px-4 py-3">
                      <div className="space-y-1.5">
                        {item.notes && (
                          <p className="text-[11px] text-zinc-300 leading-relaxed">{item.notes}</p>
                        )}
                        <div className="flex items-center gap-4 text-[10px] text-zinc-500">
                          <span>Source: {item.source}</span>
                          {item.shippedAt && <span>Shipped: {item.shippedAt}</span>}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

### Step 2: Run typecheck

```bash
npm run typecheck 2>&1 | grep 'error TS' | head -20
```

Expected: zero errors.

### Step 3: Commit

```bash
git add src/components/RoadmapBacklogView.tsx
git commit -m "feat(roadmap): add RoadmapBacklogView — sortable table with inline detail drawer"
```

---

## Task 6 — Roadmap Orchestrator Refactor (Model: sonnet)

**Owns:** `src/components/Roadmap.tsx`, `src/components/RoadmapVelocityChart.tsx`
**Must not touch:** `RoadmapFilterBar.tsx`, `RoadmapSprintView.tsx`, `RoadmapBacklogView.tsx`, `src/lib/roadmapFilters.ts`
**Depends on:** Tasks 3, 4, 5 all complete

### Step 1: Run typecheck baseline before touching anything

```bash
npm run typecheck 2>&1 | grep 'error TS' | wc -l
```

Expected: 0 errors.

### Step 2: Extract `ShippingVelocityChart` to its own file

Create `src/components/RoadmapVelocityChart.tsx` by moving the function out of `Roadmap.tsx`. Copy the `ShippingVelocityChart` function and its local helpers exactly as they appear in the current `Roadmap.tsx`, with adjusted import paths:

```tsx
import { useMemo } from 'react';
import type { RoadmapItem } from '../../shared/types/roadmap.js';
import { chartGridColor, chartDotFill } from './ui/constants.js';

export function ShippingVelocityChart({ items }: { items: RoadmapItem[] }) {
  const data = useMemo(() => {
    const shipped = items.filter(i => i.status === 'done' && i.shippedAt);
    const byMonth: Record<string, number> = {};
    shipped.forEach(i => {
      const key = i.shippedAt!.slice(0, 7);
      byMonth[key] = (byMonth[key] || 0) + 1;
    });
    const sorted = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.reduce<Array<{ month: string; count: number; cumulative: number }>>((acc, [month, count]) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0;
      acc.push({ month, count, cumulative: prev + count });
      return acc;
    }, []);
  }, [items]);

  if (data.length < 2) return null;

  const W = 600, H = 180, PAD_L = 40, PAD_R = 20, PAD_T = 20, PAD_B = 32;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const maxY = Math.max(...data.map(d => d.cumulative));
  const xStep = chartW / (data.length - 1);

  const points = data.map((d, i) => ({
    x: PAD_L + i * xStep,
    y: PAD_T + chartH - (d.cumulative / maxY) * chartH,
    ...d,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${PAD_T + chartH} L${points[0].x},${PAD_T + chartH} Z`;

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatMonth = (m: string) => {
    const [, mo] = m.split('-');
    return MONTH_NAMES[parseInt(mo, 10) - 1] || mo;
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 p-4" style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-zinc-400">Shipping Velocity</span>
        <span className="text-[11px] text-zinc-500">{data[data.length - 1].cumulative} features shipped</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
        <defs>
          <linearGradient id="vel-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = PAD_T + chartH - f * chartH;
          return (
            <g key={f}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={chartGridColor()} strokeWidth="1" />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" className="fill-zinc-600" fontSize="10">
                {Math.round(f * maxY)}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill="url(#vel-grad)" />
        <path d={linePath} fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3.5" fill={chartDotFill()} stroke="#2dd4bf" strokeWidth="2" />
            <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-teal-400" fontSize="10" fontWeight="600">
              +{p.count}
            </text>
            <text x={p.x} y={PAD_T + chartH + 16} textAnchor="middle" className="fill-zinc-500" fontSize="10">
              {formatMonth(p.month)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
```

### Step 3: Replace `src/components/Roadmap.tsx`

```tsx
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, Clock, Rocket, Map, Loader2, LayoutList, Table2,
} from 'lucide-react';
import { PageHeader, StatCard, TabBar } from './ui/index.js';
import { ShippingVelocityChart } from './RoadmapVelocityChart.js';
import { RoadmapFilterBar } from './RoadmapFilterBar.js';
import { RoadmapSprintView } from './RoadmapSprintView.js';
import { RoadmapBacklogView } from './RoadmapBacklogView.js';
import { roadmap as roadmapApi, features as featuresApi } from '../api/misc.js';
import { queryKeys } from '../lib/queryKeys.js';
import { filtersFromParams, deriveAllTags } from '../lib/roadmapFilters.js';
import type { SprintData } from '../../shared/types/roadmap.js';
import type { FeaturesData } from '../../shared/types/features.js';

const VIEW_TABS = [
  { id: 'sprint', label: 'Sprint View', icon: LayoutList },
  { id: 'backlog', label: 'Backlog View', icon: Table2 },
];

export function Roadmap() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();

  const view = params.get('view') ?? 'sprint';

  const { data: roadmap = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.roadmap(),
    queryFn: async () => {
      const data = await roadmapApi.get() as { sprints?: SprintData[] };
      return Array.isArray(data?.sprints) ? data.sprints : [];
    },
  });

  const { data: featuresData } = useQuery({
    queryKey: queryKeys.admin.features(),
    queryFn: () => featuresApi.get(),
  });

  const featureMap = useMemo<Map<number, string>>(() => {
    const map = new Map<number, string>();
    for (const f of ((featuresData as FeaturesData | undefined)?.features ?? [])) {
      map.set(f.id, f.title);
    }
    return map;
  }, [featuresData]);

  const allTags = useMemo(() => deriveAllTags(roadmap), [roadmap]);
  const filters = useMemo(() => filtersFromParams(params), [params]);

  const toggleStatus = async (itemId: number) => {
    const cycle: Array<'pending' | 'in_progress' | 'done'> = ['pending', 'in_progress', 'done'];
    let newStatus: 'pending' | 'in_progress' | 'done' = 'pending';
    queryClient.setQueryData(queryKeys.admin.roadmap(), (prev: SprintData[] = []) =>
      prev.map(sprint => ({
        ...sprint,
        items: sprint.items.map(item => {
          if (item.id !== itemId) return item;
          const idx = cycle.indexOf(item.status);
          newStatus = cycle[(idx + 1) % cycle.length];
          return { ...item, status: newStatus };
        }),
      })),
    );
    roadmapApi.updateItem(itemId, { status: newStatus }).catch(err => {
      console.error('Roadmap status update failed:', err);
    });
  };

  const handleViewChange = (id: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('view', id);
      return next;
    }, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
      </div>
    );
  }

  const allItems = roadmap.flatMap(s => s.items);
  const done = allItems.filter(i => i.status === 'done').length;
  const inProgress = allItems.filter(i => i.status === 'in_progress').length;
  const pending = allItems.filter(i => i.status === 'pending').length;
  const total = allItems.length;
  const currentSprint = roadmap.find(s => s.items.some(i => i.status !== 'done'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roadmap"
        subtitle={`${total} items · ${done} done · ${inProgress} active · ${pending} pending`}
        icon={<Map className="w-5 h-5 text-teal-400" />}
      />

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Items" value={total} icon={Map} iconColor="#2dd4bf" size="hero" staggerIndex={0} />
        <StatCard label="Completed" value={done} icon={CheckCircle2} iconColor="#4ade80" size="hero" staggerIndex={1} />
        <StatCard label="In Progress" value={inProgress} icon={Clock} iconColor="#fbbf24" size="hero" staggerIndex={2} />
        <StatCard label="Completion" value={total > 0 ? `${Math.round((done / total) * 100)}%` : '0%'} icon={Rocket} iconColor="#60a5fa" size="hero" staggerIndex={3} />
      </div>

      <ShippingVelocityChart items={allItems} />

      <div className="bg-zinc-900 border border-zinc-800 px-4 py-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-zinc-400">Overall Progress</span>
          {currentSprint && <span className="text-[11px] text-teal-400">Current: {currentSprint.name}</span>}
        </div>
        <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden flex">
          {done > 0 && <div className="h-full bg-green-500 transition-all" style={{ width: `${(done / total) * 100}%` }} />}
          {inProgress > 0 && <div className="h-full bg-teal-400 transition-all" style={{ width: `${(inProgress / total) * 100}%` }} />}
        </div>
        <div className="flex items-center gap-4 mt-1.5 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Done ({done})</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-400" /> Active ({inProgress})</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-700" /> Pending ({pending})</span>
        </div>
      </div>

      <div className="space-y-3">
        <TabBar tabs={VIEW_TABS} active={view} onChange={handleViewChange} />
        <RoadmapFilterBar sprints={roadmap} featureMap={featureMap} allTags={allTags} />
      </div>

      {view === 'sprint' ? (
        <RoadmapSprintView
          sprints={roadmap}
          filters={filters}
          featureMap={featureMap}
          onToggleStatus={toggleStatus}
        />
      ) : (
        <RoadmapBacklogView
          sprints={roadmap}
          filters={filters}
          featureMap={featureMap}
          onToggleStatus={toggleStatus}
        />
      )}
    </div>
  );
}
```

### Step 4: Run typecheck

```bash
npm run typecheck 2>&1 | grep 'error TS' | head -20
```

Expected: zero errors. If `FeaturesData` type import fails, check the exact path used in `src/api/misc.ts` and mirror it.

### Step 5: Commit

```bash
git add src/components/Roadmap.tsx src/components/RoadmapVelocityChart.tsx
git commit -m "feat(roadmap): refactor Roadmap orchestrator — dual-mode Sprint/Backlog with URL-state filters"
```

---

## Task 7 — Quality Gates

**Depends on:** Task 6 complete

### Step 1: Full typecheck

```bash
npm run typecheck
```

Expected: 0 errors.

### Step 2: Full test suite

```bash
npx vitest run --reporter=verbose
```

Expected: all tests pass. New tests: `roadmapMigration.test.ts` (1 test) and `roadmapFilters.test.ts` (10 tests).

### Step 3: Production build

```bash
npx vite build
```

Expected: build succeeds with no errors.

### Step 4: pr-check

```bash
npx tsx scripts/pr-check.ts
```

Expected: 0 violations.

### Step 5: Update `FEATURE_AUDIT.md`

Find the existing Roadmap entry and update it (or add if not present):

```markdown
### Roadmap (Admin)
- **Location:** `src/components/Roadmap.tsx` + `RoadmapSprintView.tsx` + `RoadmapBacklogView.tsx` + `RoadmapFilterBar.tsx`
- **What it does:** Dual-mode roadmap. Sprint View = flat list grouped by sprint section headers. Backlog View = sortable table with inline detail drawer. Shared filter bar; all filter + view state is URL-param-driven and deep-linkable.
- **Schema:** `RoadmapItem` now has `createdAt?` (forward-only), `featureId?` (soft ref to features.json), `tags?` (free-form)
- **Filter params:** `?view=sprint|backlog&priority=P0&status=pending&sprint=backlog&feature=5&tags=auth`
```

### Step 6: Final commit

```bash
git add FEATURE_AUDIT.md
git commit -m "docs: update FEATURE_AUDIT.md — roadmap redesign"
```

---

## Systemic Improvements

- **Shared utility extracted:** `src/lib/roadmapFilters.ts` — all filter/sort logic is pure and reusable (e.g. future command-palette roadmap search can import `matchesFilters`)
- **No new pr-check rules needed** — no new patterns introduced that could silently fail
- **New tests:**
  - `tests/unit/roadmapFilters.test.ts` — 10 cases: filter by priority/status/sprint/tags/feature, sort asc/desc, immutability
  - `tests/unit/roadmapMigration.test.ts` — 1 data integrity guard: no pending items in `shipped-earlier`

---

## Verification Strategy

After Task 6, load the page and manually verify:

```
/ws/:workspaceId/roadmap                   → Sprint View, no accordions, section headers visible
/ws/:workspaceId/roadmap?view=backlog      → table with 9 columns
/ws/:workspaceId/roadmap?priority=P0       → Sprint View filtered to P0 only
switch to Backlog View                     → P0 filter persists in URL
click a row in Backlog View               → notes/source drawer expands below row
click status icon on any item             → cycles pending → in_progress → done
?view=backlog&status=pending              → pre-filtered backlog on load
```

After Task 7:
```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```
All four must exit with code 0.
