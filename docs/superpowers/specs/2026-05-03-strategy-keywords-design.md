# Strategy Keywords — Component Redesign

**Date:** 2026-05-03  
**Status:** Approved  
**Location:** `src/components/client/StrategyTab.tsx` (Strategy Keywords section)

---

## Problem

The existing keyword strategy table has persistent line-breaking, visual clutter, and unclear information hierarchy. Rows frequently wrap because the table has 7 columns (keyword, role, volume, KD, page, next move, actions). Role information is shown three times (group header, badge, expanded panel). The accordion expand shifts list content, breaking scan position. The overall experience is hard to read and hard to act on.

---

## Goals

1. Zero line-breaking — every confirmed keyword fits on one line regardless of keyword length
2. Clear binary distinction — confirmed keywords vs. suggestions; role type is secondary context
3. Rich detail on demand — a drawer gives the client full keyword context without compressing the list
4. Reduce visual noise — fewer columns, no redundant role labels, no sort controls

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Structure | Two-zone list (confirmed above, suggestions below) | Matches the client's primary jobs: review what's tracked, curate what's suggested |
| Role display | Text label inline (`content opportunity · 480/mo · KD 38`) | Explicit — no legend required, client never has to decode a color |
| Expand behavior | Slide-in drawer (not accordion) | List stays fixed; drawer gives unconstrained space for rich detail |
| Sort controls | None | List is a curation surface, not analysis. Default order by opportunity score. |
| Suggestion actions | "Add to strategy" + "Dismiss" | "Add to strategy" is unambiguous — reinforces deliberate curation |
| Remove action | Always-visible muted ✕ on confirmed rows | Works on touch; no hover-only actions |

---

## Component Structure

```
[Strategy Keywords header]  [+ Add keyword button]
[Search or add a keyword... input]  [Add]

── In strategy · {N} ─────────────────────────────
  [Confirmed keyword row]  ...repeats
  [Confirmed keyword row]  ← selected: teal ring + → chevron

── Suggestions · {N} ─────────────────────────────
  [Suggestion row]  ...repeats

                                    ┌─ Drawer (when open) ─┐
                                    │ [Keyword name]  [✕]   │
                                    │ [Role badge]          │
                                    │ [Volume] [KD] [Trend] │
                                    │ Why it's in strategy  │
                                    │ Signals chips         │
                                    │ Next move + CTA       │
                                    │ ──────────────────────│
                                    │ Remove from strategy  │
                                    └───────────────────────┘
```

---

## Row Anatomy

### Confirmed row

```
[keyword name (truncates)]    [role · volume · KD]    [✕]
```

- Keyword name: `--brand-text-bright`, `font-weight: 500`, truncates with ellipsis
- Sublabel: `--brand-text-muted`, `t-caption`, single line — `{role label} · {volume}/mo · KD {score}` — or `{role label} · no data yet` if no metrics
- Remove icon: always-visible muted ✕ (`--brand-text-muted`), larger hit target than visual size
- Row click (anywhere except ✕): opens drawer for this keyword
- Selected state (drawer open): teal border ring + `→` chevron replaces ✕ while drawer is open

### Suggestion row

```
[keyword name (truncates)]    [volume · KD]    [Add to strategy]  [✕]
```

- Background: blue-tinted (`bg-blue-950/60`, `border border-blue-900/50`)
- Keyword name + metrics: same typography as confirmed
- No role label — role is assigned/confirmed on add (or derived from suggestion data)
- "Add to strategy": `text-teal-400`, `t-caption`, taps the add flow
- Dismiss (✕): `--brand-text-muted`
- Row click (anywhere except action buttons): opens drawer for this suggestion

---

## Drawer Design

Width: `360px` fixed. Slides in from right as an overlay — the list does not compress or shift. On viewports narrower than ~700px, the drawer becomes a bottom sheet (full-width, partial-height, scrollable).

Closing: ✕ button in drawer header, or clicking a different row swaps content (drawer stays open, content animates).

### Drawer sections

**Header**
- Keyword name (`t-page`, `--brand-text-bright`)
- Role badge (text, styled per role: emerald=content, blue=page, teal=strategy, zinc=idea)
- ✕ close button

**Metrics strip** (3-column grid, dividers between)
- Volume: `{N}/mo`
- Difficulty: `KD {score}` — colored: green <30, amber 30–49, red ≥50
- Trend: `↑ growing` / `→ stable` / `↓ declining` (or `—` if no data)

**Why it's in the strategy**
- AI-generated rationale (1–3 sentences)
- `t-body`, `--brand-text-muted`

**Signals**
- Inline chips: Organic traffic, SERP features (count), Content gap, Competitor ranks, Has search data, etc.
- Only show chips that apply — no empty/greyed-out chips

**Next move**
- AI-generated recommendation (1–2 sentences)
- CTA button if actionable (e.g., "Request content →", "Optimize page →")
- Contained in a `--surface-3` inset card

**Footer**
- `Remove from strategy` text link (`--brand-text-muted`, `t-caption`) for confirmed keywords
- "Add to strategy" + "Dismiss" for suggestions

---

## Role Labels (canonical text)

| Role value | Display label |
|-----------|--------------|
| `content` | content opportunity |
| `page` | page opportunity |
| `strategy` | strategy keyword |
| `idea` | keyword idea |

---

## Empty States

- **No confirmed keywords**: `<EmptyState>` with prompt to add first keyword
- **No suggestions**: Small muted note: "No suggestions right now — check back after your next data sync"

---

## What's Not in Scope

- Sort or filter controls on the list
- Bulk actions (select multiple, bulk remove)
- Inline editing of keyword metadata
- Drag-to-reorder
- Keyword research / discovery flow (separate concern)

---

## Implementation Note

This is a full replacement of the existing sortable table + accordion expand pattern. The new implementation is a flat list with a drawer — no `<table>`, no expand rows, no sort state. Reuse existing data hooks (`useStrategyKeywords`, etc.) unchanged; only the render layer changes.

---

## Files Affected

- `src/components/client/StrategyTab.tsx` — primary file; Strategy Keywords section (~lines 1400–1900 approximately)
- No new shared components required; drawer can be implemented inline or as a local sub-component

---

## Acceptance Criteria

- [ ] All confirmed keyword rows fit on one line at 320px viewport width (keyword truncates, sublabel stays single-line)
- [ ] Clicking a confirmed row opens the drawer without shifting list position
- [ ] Clicking a different row swaps drawer content without closing it
- [ ] ✕ on confirmed row removes without opening drawer
- [ ] "Add to strategy" on suggestion row adds the keyword and removes the suggestion row
- [ ] "Dismiss" removes the suggestion row without adding
- [ ] Drawer closes when ✕ is clicked
- [ ] All role labels use the canonical text above
- [ ] No `violet`, `indigo`, `rose`, `pink`, or `green-*` color classes (use `emerald` for success)
- [ ] `npm run typecheck && npx vite build` passes
