# Roadmap Redesign — Design Spec
**Date:** 2026-04-22
**Status:** Approved

---

## Problem Statement

The current roadmap page has four pain points:
1. Single-accordion-at-a-time UX makes cross-sprint scanning impossible
2. 25 items are buried in `shipped-earlier` with `status: "pending"` — never shipped, just lost
3. Item ID and creation date are not visible anywhere
4. No way to see which feature an item applies to when deciding sprint fit

---

## Solution Overview

**Dual-mode roadmap** with a shared filter bar, schema additions for feature tagging and creation date, and a one-time data migration to rescue the 25 stranded items.

---

## Section 1 — Schema Changes

### `RoadmapItem` (in `shared/types/roadmap.ts`)

Three new optional fields added:

```ts
export interface RoadmapItem {
  id: number;
  title: string;
  source: string;
  est: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  notes: string;
  status: 'done' | 'in_progress' | 'pending';
  shippedAt?: string;    // existing — ISO date string
  createdAt?: string;    // new — ISO date string, forward-only
  featureId?: number;    // new — soft reference to features.json numeric id
  tags?: string[];       // new — free-form labels (e.g. "auth", "infra")
}
```

`SprintData` is unchanged. All three new fields are optional — no migration required for the type change; existing items parse correctly without them.

**`featureId` resolution:** The UI resolves the feature name client-side by matching `featureId` against the `id` field in `data/features.json`. No server-side join needed. A missing or unmatched `featureId` silently renders nothing.

**`createdAt` policy:** Added to new items going forward only. Existing 541 items get no backfill. The UI renders "—" where no value exists.

---

## Section 2 — Data Migration

### Rescue 25 stranded pending items

All items in the `shipped-earlier` sprint with `status: "pending"` are moved to the `backlog` sprint. No field changes — bucket move only.

**Why `shipped-earlier` has them:** Items were archived into the shipped bucket without being marked done. The `sort-roadmap.ts` script archives sprints by date range, not by completion state, so pending items got swept in.

**Post-migration:** `shipped-earlier` retains its ~100 done items. The `backlog` sprint gains ~25 pending items. The `sort-roadmap.ts` script is unaffected — it operates on sprint structure, not individual item fields.

**Going forward:** Add a reminder comment to `scripts/sort-roadmap.ts` to prompt for `createdAt: "YYYY-MM-DD"` when adding new items manually.

---

## Section 3 — Sprint View

The sprint accordion is replaced with a **flat list with sprint section headers**.

### Layout

- Sprint names appear as non-collapsible section headers with a thin divider line
- All items are always visible — nothing hidden behind a click
- Sprint headers show: sprint name, item count, done/total ratio, sprint rationale (smaller text)
- A **Sprint** dropdown filter at the top lets the user focus on one sprint or view all

### Item Rows

Each row shows (left to right):
- `#ID` — dim prefix (e.g. `#166`)
- Status toggle button (existing cycling behaviour: pending → in_progress → done)
- Title (strikethrough when done)
- Priority badge
- Feature tag (teal, resolved from `featureId` → features.json name) — omitted if no `featureId`
- Tags as zinc pills — omitted if empty
- Est + Source (right-aligned, dim)

Notes are **not** shown inline. They appear in the inline detail drawer (see Backlog View section — same behaviour in both modes).

### Filter Bar (shared with Backlog View)

```
Priority ▾   Status ▾   Sprint ▾   Feature ▾   Tags ▾   [Clear filters]
```

Sprints with zero items matching the active filter are hidden entirely (section header collapses out). The existing `PageHeader` priority `<select>` is removed and replaced by this bar.

---

## Section 4 — Backlog View

A flat sortable table showing all items across all sprints.

### Columns

| Column | Default | Notes |
|--------|---------|-------|
| # | — | Item ID, dim prefix |
| Title | — | Full title |
| Priority | sort col 1 ↑ | P0 → P4 |
| Status | sort col 2 ↑ | in_progress → pending → done |
| Sprint | — | Sprint name |
| Feature | — | Resolved from featureId, blank if none |
| Tags | — | Pill list |
| Est | — | Estimate string |
| Added | — | `createdAt` or "—" |

Default sort: Priority ASC, then Status (in_progress first), then id ASC.

Clicking any column header toggles sort asc/desc on that column.

### Row Detail Drawer

Clicking a row expands an inline detail section (slides down in place) showing:
- Full `notes` text
- `source` 
- `shippedAt` if present

This replaces the always-visible notes in the current implementation, recovering significant row height.

### Filter Bar

Same shared filter bar as Sprint View. Switching modes preserves active filter state.

---

## Section 5 — Mode Toggle & Filter State

### Toggle

A two-segment tab bar at the top of the page (using the existing `TabBar` primitive):

```
[ Sprint View ]  [ Backlog View ]
```

### URL / Deep-link State

Filter state and active mode live in `useSearchParams`:

| Param | Values | Default |
|-------|--------|---------|
| `view` | `sprint` \| `backlog` | `sprint` |
| `priority` | `P0`–`P4` \| `all` | `all` |
| `status` | `done` \| `in_progress` \| `pending` \| `all` | `all` |
| `sprint` | sprint id \| `all` | `all` |
| `feature` | feature id \| `all` | `all` |
| `tags` | comma-separated tag values \| `all` | `all` | OR semantics — item matches if it has any of the selected tags |

Switching modes updates `view` param only — other params are preserved.

### "Clear filters" behaviour

Resets all params to their defaults except `view`.

---

## Section 6 — What Doesn't Change

- `SprintData` interface — unchanged
- `sort-roadmap.ts` script — unchanged (plus a comment reminder)
- `PATCH /api/roadmap/:id` status toggle endpoint — unchanged
- `ShippingVelocityChart` — unchanged
- Progress stat cards and overall progress bar — unchanged
- The `SPRINT_ICONS` mapping — extended to cover any newly visible sprints, but same pattern

---

## Implementation Notes

- **Feature name resolution:** fetch `data/features.json` alongside `data/roadmap.json` at page load, build a `Map<id, name>` client-side. No new API endpoint needed.
- **Tag population:** tags are free-form strings. No managed tag list needed initially — derive available tags from the union of all `tags[]` arrays across all items for the filter dropdown.
- **Client-side filtering:** 541 items with client-side filter + sort is well within browser performance budget. No server-side filtering needed.
- **Roadmap.tsx size:** the current file is ~310 lines. With dual-mode, this will grow. Extract `SprintView` and `BacklogView` into sibling components in `src/components/` rather than keeping everything inline.

---

## Acceptance Criteria

- [ ] `shared/types/roadmap.ts` has `createdAt?`, `featureId?`, `tags?` on `RoadmapItem`
- [ ] 25 pending items moved from `shipped-earlier` to `backlog` in `data/roadmap.json`
- [ ] Sprint View shows flat list with section headers — no accordion
- [ ] Item rows show `#ID`, feature tag, and tag pills
- [ ] Backlog View shows sortable table with all columns
- [ ] Row detail drawer shows notes/source on click
- [ ] Shared filter bar works in both modes and preserves state on mode switch
- [ ] All filter + view params are deep-linkable via `useSearchParams`
- [ ] `npm run typecheck && npx vite build` pass
- [ ] `npx tsx scripts/pr-check.ts` passes
