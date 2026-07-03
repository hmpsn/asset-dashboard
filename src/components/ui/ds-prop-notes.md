# F3 — DS primitive prop notes (temp; folded into PR body + deleted in F3.2)

Per-component: kit-floor props kept, HEAD-convention props added, and deviations
from the kit `.d.ts` with rationale. HEAD conventions win (D1); kit `.d.ts` = prop
floor; kit `.jsx` = pixel spec. Every file carries `// @ds-rebuilt`.

Standing conventions applied to ALL 18: `className?`, `id?` added; `icon` props
typed `LucideIcon` (D5, replacing kit `ComponentType<{style}>`); `style?:
CSSProperties` kept; no `purple` in any tone/color union (Four Laws); "mint" →
"teal" in prop vocabulary (D6 — teal is the canonical action word; `--brand-mint`
token names are unchanged).

## Lane A — overlay & feedback

| Component | Kit props kept | Added (HEAD) | Deviations + why |
|---|---|---|---|
| **Drawer** | open, onClose, title, subtitle, eyebrow, width, side, footer, headerAction, children, style | className, id, `closeOnBackdrop?` | `closeOnBackdrop` added — plan requires backdrop-click-close be prop-controllable. Portal/focus-trap/scroll-lock come from `overlayUtils.ts`, not the kit's plain fixed div. |
| **Avatar** | initials, icon, src, color, iconColor, size, shape, label, style | className, id | tone union `'mint'\|'blue'\|'purple'\|'amber'\|'emerald'\|'zinc'` → `'teal'\|'blue'\|'amber'\|'emerald'\|'zinc'` — **purple removed** (Four Laws), **mint→teal** (D6). icon: `ComponentType`→`LucideIcon`. |
| **IntentTag** | intent, abbreviate, size, style | className, id | Kit mapped `local→purple`; **remapped `local→orange`** (Four Laws). Canonical `INTENT_TONE` const now lives here (commercial→amber, informational→blue, transactional→emerald, local→orange) and is THE source of truth — resolves the prior HEAD disagreement (KeywordStrategy transactional→amber vs IssueContentCard transactional→emerald; emerald wins, matching the kit). `INTENT_ABBREV` const exported for the short-form. |

## Lane B — data display

| Component | Kit props kept | Added (HEAD) | Deviations + why |
|---|---|---|---|
| **DataTable** | columns, rows, onRowClick, getRowKey, stickyHeader, style; DataColumn{key,label,width,align,render} | className, id, `loading?`, `empty?`; DataColumn `sortable?` | `render` value/row types `any`→`unknown`/`Record<string,unknown>` (HEAD strict). `sortable` per-column (aria-sort). `loading`→Skeleton rows, `empty`→EmptyState slot. NO selection prop (kit `.d.ts` has none — not added to the frozen contract). |
| **MetricTile** | label, value, delta, deltaLabel, sub, accent, invertDelta, icon, onClick, style | className, id | delta composes `<TrendBadge>` (no direct TrendingUp/Down import). icon→LucideIcon. |
| **Sparkline** | data, width, height, color, area, strokeWidth, style | className, id, `label?` | `label` added for the a11y contract (label present = accessible; absent = aria-hidden). Hand-rolled SVG; series color from `CHART_SERIES_COLORS`/`color` prop. |
| **Meter** | value, max, color, gradient, height, label, showValue, style | className, id | role="meter" + aria-valuenow/min/max in the impl. "mint fill" → teal fill (D6). |
| **KeyValueRow (+DefinitionList)** | KeyValueRow{label,value,valueColor,divider}; DefinitionList{items} | className, id, `mono?` (both) | `mono` added — plan requires a mono value option via `var(--font-mono)`. DefinitionList renders semantic `<dl>`. |
| **BoardColumn (+BoardCard)** | BoardColumn{title,count,accent,empty,children}; BoardCard{title,meta,onClick,children} | className, id (both) | No drag-drop (presentational only — surface behavior). |

## Lane C — forms

| Component | Kit props kept | Added (HEAD) | Deviations + why |
|---|---|---|---|
| **Segmented** | options (SelectOption), value, onChange, style | className, id | `SelectOption` imported from HEAD `./FormSelect` (kit imported `./Select`). Roving tabindex + arrow keys. teal active. |
| **LensSwitcher** | options (LensOption{value,label,icon,count}), value, onChange, size, mono, style | className, id | icon→LucideIcon. Same keyboard bar as Segmented. |
| **FilterChip** | label, active, count, icon, onClick, style | className, id, `onRemove?` | `onRemove` added — plan requires an accessible removable variant (≥44px hit target). icon→LucideIcon. |
| **SearchField** | value, onChange, onSubmit, placeholder, kbd, icon, autoFocus, style | className, id, `debounceMs?` | `debounceMs` added (plan: debounce prop, timer cleanup on unmount). Composes FormInput styling; Escape clears; type="search". icon→LucideIcon. |
| **RadioGroup** | options (RadioOption{value,label}), value, onChange, name, direction, style | className, id | Full WAI-ARIA radiogroup + roving tabindex; integrates FormField aria-invalid. teal dot. |

## Lane D — layout

| Component | Kit props kept | Added (HEAD) | Deviations + why |
|---|---|---|---|
| **AppShell** | sidebar, topbar, rail, children, style | className, id | **Frozen F4 wiring surface (review CP3): `sidebar`/`topbar`/`rail:boolean` names not renamed.** Presentational only — no nav content/registry/flags. |
| **PageContainer** | width, center, gap, children, style | className, id, `as?: 'div'\|'main'` | `as` added (plan: semantic `<main>` option). width variants map to `--page-max*` tokens. |
| **Toolbar (+ToolbarSpacer)** | children, gap, align, wrap, style | className, id, `label?` | `label` added for the `role="toolbar"` accessible-name; arrow-key focus movement. |
| **GroupBlock** | icon, iconColor, title, meta, stats, flag, collapsible, defaultOpen, children, style; GroupStat, GroupFlag | className, id, `headingLevel?: 'h2'\|'h3'\|'h4'` | `headingLevel` added (plan: heading semantics prop). icon→LucideIcon. |
