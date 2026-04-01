---
description: Always use shared UI primitives when building or modifying components. Create new primitives when none exist.
---

# UI Primitive Workflow

Every time you build or modify a UI component in this project, follow these steps:

## 1. Check existing primitives first

Before writing any card, stat display, header, badge, empty state, tab bar, date picker, or score indicator, check if a shared primitive already exists in `src/components/ui/`:

| Primitive | File | Use for |
|-----------|------|---------|
| `SectionCard` | `SectionCard.tsx` | Any card container (`bg-zinc-900 rounded-xl border border-zinc-800`) |
| `StatCard` / `CompactStatBar` | `StatCard.tsx` | Metric displays (default, hero, compact) |
| `PageHeader` | `PageHeader.tsx` | Page/tab top section with title + actions |
| `MetricRing` / `MetricRingSvg` | `MetricRing.tsx` | Score rings |
| `DateRangeSelector` | `DateRangeSelector.tsx` | Segmented date pickers |
| `DataList` | `DataList.tsx` | Ranked list displays |
| `Badge` | `Badge.tsx` | Status/category pills |
| `EmptyState` | `EmptyState.tsx` | Empty data placeholders |
| `TabBar` | `TabBar.tsx` | Sub-navigation tabs |
| `scoreColorClass` | `constants.ts` | Tailwind class for score colors (text-green-400 etc.) |
| `scoreBgBarClass` | `constants.ts` | Solid background class for progress bar fills |
| `scoreBgClass` | `constants.ts` | Translucent background class for badges |
| `scoreColor` | `constants.ts` | Hex color for inline styles (theme-aware) |

## 2. Use the primitive — never hand-roll

- **DO**: `<SectionCard>...</SectionCard>`
- **DON'T**: `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">...</div>`
- **DO**: `<StatCard label="Pages" value={42} />`
- **DON'T**: Hand-coded stat display with custom classes
- **DO**: `scoreColorClass(score)` from `./ui`
- **DON'T**: Local `function scoreColor(s) { ... }` in the component file

## 3. Follow the unified card pattern for expandable page lists

When a component renders a list of expandable items (pages, issues, etc.):

```
Container:  bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden
Title:      text-sm font-medium text-zinc-200 truncate
Subtitle:   text-xs text-zinc-500 truncate
Spacing:    space-y-2 between cards
Hover:      hover:bg-zinc-800/50
```

Inner nested elements (checklists, tip boxes) may use `rounded-lg` to differentiate from top-level cards.

## 4. If no primitive exists — create one

If you need a UI pattern that doesn't match any existing primitive:

1. Create a new component in `src/components/ui/`
2. Export it from `src/components/ui/index.ts`
3. Add a spec section to `DESIGN_SYSTEM.md`
4. Use the new primitive in your component
5. Mention the new primitive in your commit message

## 5. Color rules — always check before choosing a color

Before assigning any color to a new or modified element, consult the **Color Decision Tree** in `BRAND_DESIGN_LANGUAGE.md` § 10:

- **Teal** → CTAs, active states, toggles, tier badges, interactive highlights
- **Blue** → Data metrics (clicks, sessions, impressions), info badges, progress bars
- **Purple** → Admin AI chat only (`AdminChat.tsx`, SeoAudit "Flag for Client"). **Never client-facing.**
- **Never** use `violet` or `indigo` anywhere

## 6. Reference docs

- **Brand & Color Rules**: `BRAND_DESIGN_LANGUAGE.md` — **read first** for color decisions, per-component color map, admin vs client rules, and AI prompting guidelines
- **Design System**: `DESIGN_SYSTEM.md` — typography, component specs, spacing, Tailwind classes, migration checklist
- **Barrel export**: `src/components/ui/index.ts` — all available primitives
- **Constants**: `src/components/ui/constants.ts` — shared helpers (`scoreColor`, `scoreColorClass`, date presets)
