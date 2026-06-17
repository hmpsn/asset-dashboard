# Strategy v2 — Design-Conformance Reference

**Companion to:** `docs/superpowers/plans/2026-06-17-strategy-v2-command-center.md`
**Purpose:** Map every v2 visual element to a REAL codebase primitive + token + `.t-*` class so implementation workers never hand-roll markup or hardcode colors. This is the per-phase UI-conformance gate. Produced from a grounded read of `BRAND_DESIGN_LANGUAGE.md`, `DESIGN_SYSTEM.md`, `src/tokens.css`, `src/index.css`, and `src/components/ui/`. **Workers must still read each primitive's real props before wiring — do not guess.**

---

## Element → Primitive / Token Map

### Orient zone
| Element | Primitive | Key props / tokens |
|---|---|---|
| Visibility-score ring | `MetricRing` (`src/components/ui/MetricRing.tsx`) | `score` (0–100, auto-colors via `scoreColor()`), `size`; ring color = `#34d399`/`#fbbf24`/`#f87171` by band — never hardcode |
| Hero trend chart | `ChartCard` + `AnnotatedTrendChart` (`src/components/charts/AnnotatedTrendChart.tsx`) | `lines=[{key:'clicks', color: CHART_SERIES_COLORS.blue, yAxisId:'left'}]`; grid via `chartGridColor()`, axis via `chartAxisColor()` |
| 4-stat strip | `CompactStatBar` (`src/components/ui/StatCard.tsx`) | `items=[{label, value, valueColor:'text-blue-400', sub, subColor:'text-emerald-400'}]`; label `.t-label`, value `.t-stat-sm` |
| Stat deltas | `TrendBadge` (`src/components/ui/TrendBadge.tsx`) | `value`, `suffix:'%'`, `showSign`, `invert` (for avg-position where down=good) |
| Verdict line | plain `.t-body text-[var(--brand-text)]` | — |
| Staleness nudge | existing `StrategyStalenessNudges` | relocate above the score |

### Act queue
| Element | Primitive | Key props / tokens |
|---|---|---|
| Queue container | `SectionCard` | `title`, `action` slot for item-count `Badge` |
| Filter chips | `Badge` (`tone='teal'` active solid / inactive soft, `shape='pill'`) OR `TabBar` | counts in label; teal = action (Law 1) |
| Row | `ClickableRow` (`src/components/ui/ClickableRow.tsx`) | hover lifts to `bg-[var(--surface-3)]/60`; keyboard-accessible button |
| Impact pill | `Badge tone='blue' variant='soft'` | blue = data (Law 2); `$/mo` value |
| "Health fix" chip | `Badge tone='red'/'amber' variant='soft'` icon | zero-traffic critical (Decision 5); NOT "$0/mo" |
| CTA (Create brief/cluster/refresh) | `Button variant='primary' size='sm'` | teal gradient `from-teal-600 to-emerald-600` (Law 1) |
| #1 lever emphasis | row + `border-l-4 border-teal-500` (full-radius caveat: this is a left accent → set `border-radius:0` on the accent, keep card radius) | — |

### Interior tabs
| Element | Primitive | Key props / tokens |
|---|---|---|
| Sub-tab bar | `TabBar` (`src/components/ui/TabBar.tsx`) | `tabs/active/onChange`; active = teal underline; has built-in Arrow/Home/End keyboard nav |
| Per-tab card | `SectionCard` | mind the `p-4` auto-wrap (see guards) |

### Content / Rankings / Competitive
| Element | Primitive | Key props / tokens |
|---|---|---|
| Position distribution | reuse `RankingDistribution` bars; rank-band color helper `positionColor()` (`src/components/ui/constants.ts`) already exists — reuse, don't hand-roll | emerald top / amber 11–20 / red beyond |
| 30-day movement tiles | `StatCard` × 4 (improved/declined/new/lost) | emerald / red / blue / muted per Law |
| Striking-distance | `Badge tone='amber'` + deep-link via `keywordHubDeepLink` | amber = opportunity |
| Share-of-voice (NET-NEW) | extract `<ShareBar>` from `CompetitiveIntel` ComparisonBar (binary→n-way) or `AIUsageSection` bar pattern | self=blue, rivals=`#52525b`; no new dep |
| Topic-coverage bars | `RankingDistribution`-style bar / extracted `<DistributionBar>` | emerald/amber/red by coverage |
| Backlink stats | `StatCard` × 4 (ref domains / authority / new / lost) | new=emerald, lost=red |
| Keyword-gap row | `DataList` / `ClickableRow` + `Button variant='secondary'` "Create brief" | — |

### Client view
| Element | Primitive | Constraint |
|---|---|---|
| Verdict | `.t-page` plain prose | no jargon |
| Visits trend | `AnnotatedTrendChart` / client `TrendChart` (`src/components/client/helpers.tsx`) | blue data |
| Rec rows | `DecisionCard` + `Badge` ("Included" emerald / "$price" blue) + `Button` (Approve primary / Add secondary) | — |
| Competitive (gated) | `TierGate` (`requiredTier='premium'`) | amber lock; **NO purple** |

---

## Color-law conformance (the Four Laws, applied)
- **Teal = action only:** filter-chip active, all CTAs, tab underline, deep-links.
- **Blue = data only:** stat values, impact pills, trend lines, score badges.
- **Emerald = good:** score ≥80, positive deltas, "new" backlinks, "Included" badge.
- **Amber 60–79 / Red <60:** score bands (`scoreColor()`), striking-distance (amber=opportunity), critical fixes (red), Premium lock (amber).
- **No purple in any client surface** — `grep -r "purple-" src/components/client/` must be empty (pr-check gate).

---

## Silent-regression guard checklist (gate EVERY phase on these)
These pass typecheck+build+pr-check yet still ship broken — they are the repo's recorded silent-regression traps:
1. **Never hardcode hex** — use tokens / `scoreColor()` / `chartGridColor()` / `CHART_SERIES_COLORS`. (pr-check: hardcoded-hex)
2. **`--surface-1/2/3` are z-depth, not lightness** (surface-1 darkest). Inner surface inside a surface-2 card must be **surface-3**, else it blends invisibly.
3. **Hover must step a tier** — `text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]`. Never `hover:` the same token. For bg hover use `--brand-border-hover`, NOT `/80` opacity (composites darker on surface-2).
4. **`.t-caption-sm` / `.t-micro` carry NO color** — add an explicit text token. `t-micro` is mono UPPERCASE 10px (timestamps/IDs) — NOT a small-sans replacement; `text-[11px]` maps to `t-caption-sm`, not `t-micro`.
5. **Icon size is an enum** — `size="lg"` (=20px) for `w-5 h-5` source; never a numeric `size={18}`. Workers consistently downgrade `w-5 h-5`→`md`; it's `lg`.
6. **`SectionCard` already wraps children in `p-4`** — don't add another `p-4`/`px-`; `space-y-N` on the outer never reaches grandchildren. Use `noPadding` if you need control.
7. **Tailwind v4 arbitrary values use `_` not comma** — `grid-cols-[1fr_80px]`. `grid-cols-[1fr,80px]` silently emits invalid CSS and collapses to one column. Prefer the `Grid` primitive.
8. **`t-caption-sm` migrations from `text-zinc-500`** must re-add `text-[var(--brand-text-muted)]`.

---

## Mandatory states (per surface)
Every data surface needs all three, using primitives (no ad-hoc markup):
- **Loading** — `Skeleton` (layout-preserving), contextual message ("Analyzing rankings…" not "Loading…").
- **Empty** — `EmptyState` with icon + action-oriented CTA (hero icon `w-8`/`2xl`, not `w-6`).
- **Error** — `ErrorState`/`NetworkError`/`DataError` with retry; client errors stay generic (no technical detail).

Required at: Orient (chart), Act queue, each interior tab, client view.

---

## Accessibility + mobile
- **Queue rows:** `ClickableRow` is a `<button>`; Tab order natural; Enter/Space activates; Escape closes any expanded detail.
- **TabBar:** built-in Arrow/Home/End; `aria-selected`; roving `tabIndex`.
- **Stat strip:** `grid-cols-2 sm:grid-cols-4` (wraps on mobile).
- **Interior tabs on mobile:** horizontal scroll wrapper if >3 tabs.
- **Charts:** Recharts `ResponsiveContainer`, capped height on mobile.

---

## Per-phase UI gate (add to each phase's verification)
Before any phase PR: (1) only real primitives, no hand-rolled cards/stats; (2) zero hardcoded hex (`pr-check`); (3) the 8 guards above visually verified; (4) loading/empty/error present; (5) `grep -rE 'violet|indigo|purple-' src/components/` clean for client surfaces; (6) **real-browser DOM probe** confirming flag-OFF parity AND the new layout's tokens resolve (per the Phase-5 multi-layer-verification lesson — typecheck+build+pr-check can all be green while a collapsed grid or undefined token ships).
