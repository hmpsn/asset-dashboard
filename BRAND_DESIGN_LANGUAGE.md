# hmpsn.studio — Brand & Design Language

> **Canonical reference** for brand identity, color rules, product-design principles, and
> AI prompting guidelines. Governs both the **admin dashboard** and **client dashboard**.
>
> For component specs (StatCard, Badge, MetricRing, etc.) and Tailwind classes, see
> **`DESIGN_SYSTEM.md`**. For the feature inventory, see **`FEATURE_AUDIT.md`**.

---

## Registry-Wide Admin Visual Baseline — Owner-Approved 2026-07-10

All 26 route homes mounted through `REBUILT_SURFACES` have explicit owner-approved desktop visual parity or an owner-approved exception. The per-surface contracts in `docs/ui-rebuild/parity/` remain the authority for exact geometry and exceptions; this section records the shared baseline that emerged from the source-led pass.

- Use the real prototype implementation as composition authority at 1440×900 and 1600×1000. Preserve production routes, deep links, governed actions, and exact-once capability homes when the prototype is simpler.
- Favor compact surface context, bounded desktop canvases, dense first-viewport evidence, clear section order, and progressive disclosure. Do not inflate a shared header simply because a page is rebuilt; the historical 28px Performance header pilot was superseded by the compact source-led header.
- Keep the rebuilt shell's prototype-zone navigation and design-system color semantics. Prototype hue differences do not override the Four Laws of Color.
- Truthful unavailable/empty states are part of the approved composition for provider-dependent surfaces. Never fabricate assets, PageSpeed results, GSC/GA4 reports, DataForSEO evidence, GBP reviews, revenue, or outcomes to imitate a populated prototype.
- Production-only Drawers, dialogs, bulk modes, compatibility receivers, dense workspace settings, and governed workflows may exceed the prototype when their owning parity contract records the approved exception.
- Page Rewriter Focus intentionally retains the shared shell's 62px icon rail. Joshua explicitly approved that difference; Save draft and Publish remain separate backend lifecycle work.
- Later fine feedback is a refinement pass. Do not silently reinterpret this baseline as permission to remove capabilities, change route meaning, add backend contracts, or generalize a surface-specific exception.

---

## 1. Brand Identity

| Element | Value |
|---------|-------|
| **Brand name** | hmpsn.studio |
| **Product name** | Client Insights Engine / Dashboard |
| **Domain** | hmpsn.studio |
| **Tagline** | *SEO strategy, made visible.* |

### Brand Personality
- **Expert but approachable** — professional, never jargon-heavy
- **Data-driven** — every recommendation backed by metrics
- **Transparent** — clients see what the agency sees
- **Minimal & focused** — no clutter, every pixel earns its place

### Voice & Tone

| Context | Tone |
|---------|------|
| Dashboard headings | Concise, confident, noun-led ("Content Opportunities", "Site Health") |
| Descriptions / subtitles | Helpful, brief — one sentence max |
| Empty states | Encouraging, forward-looking ("Ready to grow your traffic?") |
| Error messages | Empathetic, actionable ("Something went wrong — try refreshing") |
| CTAs | Action-verb led, specific ("Get a Brief", "Browse Content Opportunities") |
| Pricing / payment | Direct, trust-building ("Pay $300 securely", "SSL Encrypted") |

---

## 2. Color System — Master Rules

### The Four Laws of Color

1. **Teal for actions.** Every CTA, active state, toggle, accent highlight, tier badge, and interactive element uses teal. Never violet, blue, or indigo for buttons or interactive highlights.
2. **Blue for data.** Clicks, sessions, impressions, links, info badges, "unsaved" state, and progress bars for data metrics — all blue. Blue is read-only, never actionable. Review/action-required statuses use teal.
3. **Emerald for success.** `scoreColorClass()` returns `text-emerald-400` for score ≥80; `scoreColor()` hex is `#34d399` (emerald-400). Never `text-green-400` for success/score indicators — green and emerald are distinct hues, emerald is canonical.
4. **Purple for admin AI only.** The admin chatbot (`AdminChat.tsx`) and admin-only AI features (`SeoAudit.tsx` "Flag for Client") use purple to visually distinguish admin intelligence from client-facing teal UI. Purple never appears in any client-facing view.

Action-link nuance: links that initiate user actions (review, open-tool, perform/fix flows) use teal hover/active states; blue link treatment is reserved for informational/data navigation only.

> **"Teal" is the canonical vocabulary for the action color (`#2dd4bf`).** The `--brand-mint*` token names are historical aliases for the same family — do not introduce "mint" in new docs or UI copy. (Ratified Phase D, D6.)

### Primary Palette

| Role | Dark Mode | Light Mode | Tailwind | Usage |
|------|-----------|------------|----------|-------|
| **Brand accent** | `#2dd4bf` | `#0d9488` | `teal-400` / `teal-600` | Primary CTAs, active states, highlights |
| **Brand accent (light)** | `#99f6e4` | `#14b8a6` | `teal-200` / `teal-500` | Premium tier text, hover states |
| **CTA gradient** | — | — | `from-teal-600 to-emerald-600` | All primary action buttons |
| **Soft CTA** | — | — | `bg-teal-600/20 border-teal-500/30 text-teal-300` | Secondary interactive elements |

### Semantic Colors

| Name | Dark | Light | Tailwind | Allowed Usage |
|------|------|-------|----------|---------------|
| **Blue** | `#60a5fa` | `#2563eb` | `blue-400`/`blue-600` | Clicks, sessions, links, info badges, progress bars, commercial intent |
| **Emerald** | `#34d399` | `#047857` | `emerald-400` | Success, good scores (80+), score ring fill |
| **Green / Emerald** | `#34d399` | `#047857` | `emerald-400/80` | Positive deltas, approved states, success indicators. Use `emerald-400/80` (not `green-400`) to match muted palette |
| **Amber** | `#fbbf24` | `#b45309` | `amber-400/80` | Warnings, medium scores (60–79), trial badges, premium tier gate (TierGate only). Use `/80` opacity for status indicators |
| **Red** | `#f87171` | `#dc2626` | `red-400/80` | Errors, bad scores (<60), high-priority items, destructive actions. Use `/80` opacity for status indicators |
| **Orange** | `#fb923c` | `#c2410c` | `orange-400` | "Changes requested" status, urgent attention |
| **Cyan** | `#22d3ee` | `#0e7490` | `cyan-400` | Navigational intent badges, social data |
| **Purple** | `#a78bfa` | `#7c3aed` | `purple-400`/`purple-600` | **Admin AI chat only** — FAB, messages, input focus, send button. Also admin "Flag for Client" in SeoAudit |
| **Zinc** | `#a1a1aa` | `#475569` | `zinc-400`/`zinc-500` | Muted text, inactive states, disabled UI, free-tier badges |

### Surface Colors

> **Canonical tokens are `--surface-N`.** The `--brand-bg-*` names are legacy aliases kept for backward compatibility — do not use them in new code.

#### Dark Mode (default)

| Canonical Token | Value | Tailwind Equivalent | Legacy Alias | Usage |
|-----------------|-------|---------------------|--------------|-------|
| `--surface-1` | `#0f1219` | body background | `--brand-bg` | Page background / absolute base |
| `--surface-2` | `#18181b` | `bg-zinc-900` | `--brand-bg-surface`, `--brand-bg-elevated` | Primary card surfaces |
| `--surface-3` | `#27272a` | `bg-zinc-800` | `--brand-bg-card` | Elevated: inputs, active tabs, hover states |
| `--border-default` | `#27272a` | `border-zinc-800` | `--brand-border` | Card borders |
| `--border-hover` | `#3f3f46` | `border-zinc-700` | `--brand-border-hover` | Hover border state |
| `--text-primary` | `#f4f4f5` | `text-zinc-100` | — | Headings, key content |
| `--text-secondary` | `#b4b4bc` | `text-zinc-400` | — | Descriptions, supporting text |
| `--text-muted` | `#a1a1aa` | `text-zinc-500` | — | Captions, timestamps, labels |
| `--text-subtle` | `#71717a` | `text-zinc-600/700` | — | Disabled, dividers |

#### Light Mode (`.dashboard-light`)

| Canonical Token | Value | Usage |
|-----------------|-------|-------|
| `--surface-1` | `#f8fafc` | Page background |
| `--surface-2` | `#ffffff` | Card backgrounds |
| `--surface-3` | `#f1f5f9` | Inputs, active tabs |
| `--border-default` | `#e2e8f0` | Card borders |
| `--text-primary` | `#0f172a` | Dark navy — headings, key content |
| `--text-secondary` | `#334155` | Descriptions |
| `--text-muted` | `#475569` | Captions, labels |
| `--text-subtle` | `#64748b` | Disabled |

### Tier Color Rules

| Tier | Client Dashboard (Plans page, badges) | TierGate Primitive | Rationale |
|------|---------------------------------------|-------------------|-----------|
| **Free / Starter** | `zinc` (muted) | `zinc` | Minimal, no accent |
| **Growth** | `teal-300` / `teal-500` | `teal` | Brand accent |
| **Premium** | `teal-200` / `teal-400` (brighter) | `amber` (gold-gated) | Client sees teal; TierGate uses amber to signal "premium lock" on admin feature gates |

> **Note:** `TierGate.tsx` intentionally uses amber for Premium locks. This is an admin-facing component showing locked features. The client plans page uses teal for all tiers since amber/gold would be confusing in a client pricing context.

---

## 3. UI Primitive Inventory

All shared primitives live in `src/components/ui/`. Full specs in `DESIGN_SYSTEM.md`.

**F3/F4 net-new primitives (UI rebuild, `@ds-rebuilt`, tokens-only, both themes):** `Drawer` (`overlay/`, portal slide-over — one replacement for the app's five bespoke drawers), `Avatar`, `IntentTag` (canonical keyword-intent→hue via `INTENT_TONE`; `local`→orange, never purple), `DataTable` (grid table, sortable `aria-sort` headers, keyboard-activatable rows), `MetricTile` (composes `TrendBadge`), `Sparkline` (dependency-free SVG), `Meter` (`role="meter"`), `KeyValueRow`/`DefinitionList`, `BoardColumn`/`BoardCard`, `Segmented`, `LensSwitcher`, `FilterChip`, `SearchField`, `RadioGroup`, `AppShell` (shell frame, `sidebar`/`topbar`/`rail` slots), `PageContainer`, `Toolbar`/`ToolbarSpacer`, `GroupBlock`, `NavItem`, `NavGroup`. Action color is **teal** throughout (D6); selected/active states use `--brand-mint-dim`/`--teal`. Keyboard bars use the shared `useRovingTabindex` hook; overlay focus-trap/scroll-lock comes from `ui/overlay/overlayUtils.ts`. Live specimens: `/styleguide.html` §05f and the DEV-only `/__ds-harness` route.

**F4 rebuilt shell chrome:** `ui-rebuild-shell` defaults OFF and is mounted only by rebuilt pilot surfaces. `RebuiltSidebar` reads `NAV_REGISTRY` for identity/route truth, `RebuiltBreadcrumb` preserves registry labels plus `?tab=` sub-state, and `RebuiltAppChrome` composes both into `AppShell`; live `App.tsx`, `Sidebar.tsx`, `Breadcrumbs.tsx`, and `navRegistry.tsx` remain untouched by the foundation layer.

| Primitive | File | Key Colors | Notes |
|-----------|------|------------|-------|
| **StatCard** | `StatCard.tsx` | Sparkline default: `#2dd4bf` (teal); value: `text-zinc-100` or passed color | Also exports `CompactStatBar` for inline metric rows |
| **MetricRing** | `MetricRing.tsx` | Auto from `scoreColor()`: ≥80 green, ≥60 amber, <60 red | DIN Pro 700, font size = `0.38 × ring size` |
| **MetricRingSvg** | `MetricRing.tsx` | Same as MetricRing | Smaller inline SVG variant for tight spaces |
| **SectionCard** | `SectionCard.tsx` | `bg-[var(--surface-2)] border-[var(--brand-border)]` | Header row optional; title: `.t-body font-semibold text-[var(--brand-text-bright)]` |
| **ChartCard** | `ChartCard.tsx` | Same as SectionCard (`bg-[var(--surface-2)] border-[var(--brand-border)]`) | Thin SectionCard wrapper for chart-friendly defaults: tighter padding (`px-4 py-3`), `.t-ui` inline title + optional `<TrendBadge>` row, no `border-b` separator. Preserves signature card radius. |
| **TrendBadge** | `TrendBadge.tsx` | Positive: `text-emerald-400` + `TrendingUp`; Negative: `text-red-400` + `TrendingDown`; Zero (when `hideOnZero={false}`): `text-zinc-400` + `Minus` | Canonical directional delta indicator. Props: `value`, `suffix='%'`, `invert`, `showSign`, `label`, `size='sm'\|'md'`, `hideOnZero=true`. Replaces all hand-rolled `TrendingUp/Down + emerald/red` ternaries. Use `invert` when lower=better (positions, error counts). |
| **FreshnessStamp** | `FreshnessStamp.tsx` | `text-[var(--brand-text-muted)]` + muted clock icon | Compact metadata stamp for real data recency ("Data as of ..."). Renders nothing when the timestamp is missing or invalid so unavailable data never looks current. |
| **PageHeader** | `PageHeader.tsx` | Default title `.t-h2`; default subtitle `.t-caption-sm`. The available `rebuilt-admin` variant uses semantic `h2` with `.t-h1` and `.t-body`. | Title + optional subtitle + action slot. The owner-approved rebuilt registry uses source-led surface composition; the historical 28px Performance pilot was superseded by the compact header, and no broader `rebuilt-admin` adoption is authorized. |
| **Badge** | `Badge.tsx` | 7 tones: `teal`, `blue`, `emerald`, `amber`, `red`, `orange`, `zinc`; variants `soft`, `outline`, `solid`; shapes `sm`, `pill` | Canonical category/metadata/counter pill. New code uses `tone`; legacy `color` remains as a compatibility alias during migration. Optional `icon`, `dot`, and `ariaLabel` replace hand-rolled dense-table pills. |
| **StatusBadge** | `StatusBadge.tsx` | Central registry by domain: page-edit, content, approval, client-action, request, schema, matrix, integration, job, keyword-command-center, severity, priority | Canonical status/severity/priority badge. Unknown statuses hide by default; `fallback="neutral"` renders a zinc badge. |
| **TabBar** | `TabBar.tsx` | Active: `border-teal-500 text-teal-200` | Underline style, `border-b-2`; horizontally scroll-safe on constrained widths |
| **DateRangeSelector** | `DateRangeSelector.tsx` | Active: `bg-zinc-700 text-zinc-200` | Segmented control style |
| **EmptyState** | `EmptyState.tsx` | Icon: muted currentColor in a neutral surface container | Centered layout with optional CTA. Accepts any className-aware icon component; rebuilt surfaces should pass a small `<Icon name="…">` adapter, while legacy lucide icons remain compatible during migration. |
| **InlineBanner** | `InlineBanner.tsx` | Error: `bg-red-500/8 border-red-500/20 text-accent-danger`; Warning: amber; Info: blue; Success: emerald | Inline, non-modal alert/status banner for recoverable section errors and compact workflow failures. Defaults `role="alert"` for error/warning, `role="status"` for info/success; supports optional dismiss and compact sizing. Use instead of hand-rolled red/amber alert divs. |
| **NextStepsCard** | `NextStepsCard.tsx` | Title icon: `text-emerald-400` (success) / `text-blue-400` (info). Step rows: `hover:bg-teal-500/5 group-hover:text-teal-300`. Dismiss: zinc | Completion card after AI operations. Wraps `SectionCard` with `noPadding` + `staggerIndex` passthrough. `success` = green CheckCircle2, `info` = blue Info. Empty steps guard: returns null. |
| **ProgressIndicator** | `ProgressIndicator.tsx` | Progress bar: `bg-blue-500` (data law). Container: `bg-zinc-900 border border-blue-500/20 rounded-xl`. Complete: `text-emerald-400`. Cancel: zinc → `hover:text-red-400` | Unified progress bar. Idle/error → null. Indeterminate: `animate-pulse w-2/3`. Deterministic: `transition-all duration-500`. Auto-fades 3s after complete. `role="progressbar"` with ARIA attrs. |
| **TierGate** | `TierGate.tsx` | Growth: `teal`, Premium: `amber` | Blurred preview + overlay lock. Exports `TierBadge`. `onGateHit` callback (optional) fires when gate blocks access for upsell tracking. |
| **InsightsDigest** | `client/InsightsDigest.tsx` | Green=win, amber=opportunity/warning, red=critical, teal=CTA links | Unified feed: local + server insights merged. Server insights mapped via `SEVERITY_TO_COLOR` + `INSIGHT_TYPE_ACTIONS`. |
| **InsightCards (Tier 2)** | `client/InsightCards.tsx` | CompetitorAlertCard: red/amber severity badge, amber border for critical; EmergingKeywordCard: emerald (rising trend), blue (stable), amber (declining); FreshnessAlertCard: amber staleness badge, blue data metrics | 3 new card types added to the 9-card grid. No purple. All client-facing. OpportunityScore badge: `bg-blue-500/20 text-blue-300` (data law). |
| **MonthlyDigest** | `client/MonthlyDigest.tsx` | Emerald=wins, blue=ROI highlights, teal=pages optimized count | Growth-gated. No purple. |
| **ActionQueue** | `admin/ActionQueue.tsx` | Blue=impact scores (data), teal=resolve CTA (action) | Admin-only. No purple. |
| **DataList** | `DataList.tsx` | Rank: `text-zinc-500`, label: `text-zinc-300`, value: `text-zinc-400` | Optional ranking numbers |
| **OnboardingChecklist** | `ui/OnboardingChecklist.tsx` | Progress bar: `bg-blue-500` (data); checkmarks: `text-teal-400` (action); celebration: `text-teal-400` | Modal overlay. Blue = read-only progress metric. Teal = completion/action state. |
| **WorkflowStepper** | `ui/WorkflowStepper.tsx` | Current: `bg-teal-500/10 border-teal-500 text-teal-400`; Completed: `bg-emerald-500/10 border-emerald-500/40 text-emerald-400`; Future: `bg-zinc-800/50 border-zinc-700 text-zinc-500` | Horizontal step indicator from `sm` up; vertical compact list below `sm` to avoid label collisions. Emerald = success/done state. Teal = active step. |
| **WorkspaceHealthBar** | `ui/WorkspaceHealthBar.tsx` | Progress bars: `bg-blue-500` (data/read-only); recommendation arrows: `text-teal-500` hover `text-teal-400` (action) | Wraps SectionCard. Blue = data metrics. Teal = actionable next steps. |
| **Heading** | `ui/typography/Heading.tsx` | Inherits `var(--brand-text-bright)`; `level={1\|2\|3}` → `.t-h1` / `.t-h2` / `.t-page` | Phase 5. `as` prop overrides HTML tag. forwardRef. |
| **Stat** | `ui/typography/Stat.tsx` | Inherits text color (caller controls via parent `text-*`); `size="hero"\|"default"\|"sm"` → `.t-stat-lg` / `.t-stat` / `.t-stat-sm` | Phase 5. DIN Pro numerals. forwardRef. |
| **BodyText** | `ui/typography/BodyText.tsx` | `tone="default"` → `var(--brand-text)` (zinc-400); `tone="muted"` → `var(--brand-text-muted)` (zinc-500); `tone="dim"` → `var(--brand-text-dim)` (zinc-600). Tone is the API for color — Tailwind color utilities passed via `className` are overridden by inline tone style. | Phase 5. Renders `.t-body`. forwardRef. |
| **Caption** | `ui/typography/Caption.tsx` | Inherits muted text (`var(--brand-text-muted)`); `size="default"\|"sm"` → `.t-caption` / `.t-caption-sm` | Phase 5. Secondary metadata, timestamps. forwardRef. |
| **Label** | `ui/typography/Label.tsx` | Inherits muted text; uppercase DIN Pro via `.t-label` | Phase 5. Form labels, uppercase section markers. forwardRef. |
| **Mono** | `ui/typography/Mono.tsx` | Fira Code / JetBrains Mono / Menlo. `size="default"\|"micro"` → `.t-mono` (12px) / `.t-micro` (10px). Both monospace. | Phase 5. IDs, slugs, tokens, timestamps. forwardRef. |
| **Icon** | `ui/Icon.tsx` | Inherits `currentColor`; consumer supplies hue via `className` (e.g. `text-teal-400`). Glyphs are decorative by default unless an accessible label is provided. | Font Awesome Sharp Regular semantic names (`name={...}` from `ICON_NAMES`) are the system of record. `<Icon as={LucideIcon}>` remains a migration bridge. Strict size enum: `xs\|sm\|md\|lg\|xl\|2xl` (8/12/16/20/24/32px). Inline-flex `<span>` wrapper so it is safe inside `<p>`, `<li>`, flex rows. forwardRef. |
| **FormField** | `ui/forms/FormField.tsx` | Label text: `text-[var(--brand-text-bright)]`; error message: `text-red-400`; success message: `text-emerald-400`; hint: `text-[var(--brand-text-muted)]`; required asterisk: `text-red-400` | Phase 5. Wraps an input with label + optional error/success/hint. Generates `useId()` and wires `htmlFor` ↔ child `id` via Context so label clicks focus the input. Errors are authoritative over valid state. forwardRef. |
| **FormInput / FormSelect / FormTextarea** | `ui/forms/Form{Input,Select,Textarea}.tsx` | Surface: `bg-[var(--surface-3)]`; default border: `border-[var(--brand-border)]`, focus: `border-[var(--brand-mint)]` + `ring-[var(--brand-mint-glow)]` (Law 01). Error border: `border-red-500/50`. Valid border: `border-emerald-500/50`. Placeholder: `text-[var(--brand-text-muted)]`. | Phase 5. Tokenized theme-aware inputs, mint focus ring. Consume error/valid state + id from FormFieldContext and wire `aria-invalid` / `aria-describedby`. FormInput/FormTextarea support `commitOnBlur` for editor fields. FormTextarea shows optional `maxLength` counter (red near limit). forwardRef. |
| **Checkbox** | `ui/forms/Checkbox.tsx` | Checked: `bg-[var(--brand-mint)] border-[var(--brand-mint)]` (Law 01). Unchecked: `bg-zinc-800 border-zinc-700`. Check icon: `text-zinc-900`. | Phase 5. Custom visual checkbox over hidden native input (preserves Space-key + a11y). Required `label` string. forwardRef to input. |
| **Toggle** | `ui/forms/Toggle.tsx` | Track ON: `bg-[var(--brand-mint)]` (Law 01). Track OFF: `bg-zinc-700`. Knob: `bg-white` with translate transition. | Phase 5. `role="switch"` with implicit aria-checked from `checked` attribute. Required `label` string. forwardRef to input. |
| **Button** | `ui/Button.tsx` | Primary: `from-teal-600 to-emerald-600` (Law 1 teal gradient); secondary: `bg-zinc-800`; ghost: transparent; danger: `bg-red-600`; link: `text-teal-400` | 5 variants × 3 sizes (sm/md/lg). Sizes preserve hierarchy: `.t-caption-sm` / `.t-caption` / `.t-body`. Spinner replaces icon while `loading`. `link` variant skips size padding. |
| **IconButton** | `ui/IconButton.tsx` | Ghost: `text-zinc-400 hover:text-zinc-200`; solid: `bg-zinc-800` | Icon-only with required `label` for ARIA. 3 sizes (sm/md/lg), 2 variants (ghost/solid). |
| **Row** | `ui/layout/Row.tsx` | No color — structural only | `flex flex-row`. Props: `gap` (xs–xl), `align` (start/center/end/baseline, default: center), `justify` (start/center/end/between/around), `wrap` (bool). `forwardRef`. |
| **Stack** | `ui/layout/Stack.tsx` | No color — structural only | `flex flex-col` (or `flex-row` with `dir="row"`). Props: `gap`, `align` (start/center/end/stretch), `dir`. `forwardRef`. |
| **Column** | `ui/layout/Column.tsx` | No color — structural only | Strict `flex flex-col` — never `flex-row`. Convenience alias for vertical stacks. Props: `gap`, `align`, `className`. `forwardRef`. |
| **Grid** | `ui/layout/Grid.tsx` | No color — structural only | Responsive CSS grid. Props: `cols` (`{ sm?, md?, lg?, xl? }` with values 1–12), `gap`. Uses static `Record<number, string>` maps per breakpoint so Tailwind's scanner can detect all class strings. `forwardRef`. |
| **Divider** | `ui/layout/Divider.tsx` | `border-[var(--brand-border)]` | Thin rule. `orientation="horizontal"` (default, `border-b w-full`) or `"vertical"` (`border-r h-full`). Role=separator + aria-orientation. `forwardRef`. |
| **Modal** | `ui/overlay/Modal.tsx` | Panel: `bg-zinc-900 border-zinc-800`; close ×: `text-zinc-400 hover:text-zinc-200`; focus ring: `focus-visible:ring-teal-500` | Compound: `<Modal.Header>`, `<Modal.Body>`, `<Modal.Footer>`. Portals to `document.body`. Focus trap + Escape + backdrop-click to close. Restores focus to trigger on close. Backdrop at `--z-modal-backdrop` (40), panel at `--z-modal` (50). `size="workflow"` is the owner-approved compact editor shell at 42.5rem / 680px. |
| **SchemaReviewModal** | `client/SchemaReviewModal.tsx` | Shell: `fixed inset-0 z-[var(--z-modal-fullscreen)] bg-black/80 backdrop-blur-sm`; inner panel fills viewport | Full-screen WAI-ARIA dialog wrapping `SchemaReviewTab`. Opened from InboxTab SEO Changes schema plan card. `autoFocus` on close button, Escape key dismiss. See full-screen modal pattern below. |
| **ClientActionDetailModal** | `client/ClientActionDetailModal.tsx` | Same full-screen shell as SchemaReviewModal | Full-screen WAI-ARIA dialog for Tier-3 client action cards. Four typed payload renderers: `internal_link`, `redirect_proposal`, `keyword_strategy`, `aeo_change`. Default raw JSON fallback. `respondToClientAction` re-throws on error (retry-safe). |
| **Popover** | `ui/overlay/Popover.tsx` | Panel: `bg-zinc-900 border-zinc-800`; normal item: `text-zinc-200 hover:bg-zinc-800`; danger item: `text-red-400 hover:bg-red-500/10` | Compound: `<Popover.Item>`, `<Popover.Separator>`. Portals to `document.body`. Arrow key + Home/End navigation. Tab closes (focus moves naturally). Outside-click + Escape to close. |
| **Tooltip** | `ui/overlay/Tooltip.tsx` | `bg-zinc-950 text-zinc-100 text-xs px-2 py-1 rounded shadow-lg` | Hover (500 ms delay) + focus (instant). `role="tooltip"`, `aria-describedby` on trigger. Portals to `document.body` — safe under `transform`/`filter` ancestors. |

### Helper Functions (`constants.ts`)

| Function | Returns | Usage |
|----------|---------|-------|
| `scoreColor(score)` | Hex string (`#34d399`, `#fbbf24`, `#f87171`) | MetricRing, any health score |
| `scoreColorClass(score)` | Tailwind class (`text-emerald-400`, etc.) | Text coloring for scores |
| `scoreBgClass(score)` | Background class (`bg-emerald-500/10`, etc.) | Score badges, backgrounds |
| `scoreBgBarClass(score)` | Solid bg class (`bg-emerald-500`, etc.) | Progress bar fills (4-tier: emerald/amber/orange/red) |
| `DATE_PRESETS_SHORT` | `[7d, 28d, 90d]` | Compact date selectors |
| `DATE_PRESETS_FULL` | `[7d, 14d, 28d, 90d, 6mo, 1y]` | Full date selectors |
| `DATE_PRESETS_SEARCH` | `[7d, 28d, 90d, 6mo, 16mo]` | Search Console selectors |

### Chart Theme Helpers (`constants.ts`)

For inline styles and Recharts props that can't be overridden by CSS class rules, always use these helpers — never hardcode dark hex values:

| Helper | Dark mode | Light mode | Usage |
|--------|-----------|------------|-------|
| `chartGridColor()` | `#27272a` | `#e2e8f0` | `<CartesianGrid stroke={chartGridColor()} />` |
| `chartAxisColor()` | `#71717a` | `#64748b` | `<XAxis tick={{ fill: chartAxisColor() }} />` |
| `chartDotStroke()` | `#18181b` | `#f1f5f9` | `activeDot={{ stroke: chartDotStroke() }}` |
| `chartDotFill()` | `#0f1219` | `#ffffff` | `dot={{ fill: chartDotFill() }}` |
| `chartTooltipStyle()` | dark bg/border | white bg/border | `<Tooltip contentStyle={chartTooltipStyle()} />` |
| `chartTooltipLabelStyle()` | zinc label | slate label | `<Tooltip labelStyle={chartTooltipLabelStyle()} />` |
| `themeColor(dark, light)` | returns `dark` | returns `light` | Any two-value theme switch |

**Rule:** Never use hardcoded dark hex (`#0f1219`, `#18181b`, `#27272a`, `#303036`) in inline `style={{}}` props or SVG `fill`/`stroke` attributes. Use these helpers or CSS variables (`var(--brand-bg)`, `var(--brand-bg-card)`, `var(--brand-border)`). Violations are caught by `npx tsx scripts/pr-check.ts`.

---

## 4. Per-Component Color Map

### Client Dashboard (`ClientDashboard.tsx`)

| Element | Color | Rationale |
|---------|-------|-----------|
| All CTAs (submit, upgrade, pay, suggest) | `from-teal-600 to-emerald-600` | Brand CTA |
| Soft CTAs (suggest topic, custom date) | `bg-teal-600/20 text-teal-300` | Soft variant |
| Tab active state | `bg-zinc-800 text-zinc-300` | Segmented control |
| Content pipeline review badge | `StatusBadge domain="content"` (`teal` for client-review states) | Action-required review status |
| Content request "client" chat bubbles | `bg-blue-500/10 text-blue-300` | Client = blue (read-only context) |
| Clicks metric | `text-blue-400` | Blue = data metric |
| Sessions metric | `text-blue-400` | Blue = data metric |
| AnalyticsTab tracked-action conversion rate | `text-accent-success` ≥5%, `text-accent-warning` 2-4.9%, `text-accent-danger` <2% | Conversion rate is a performance judgment, not raw data; the underlying event count remains neutral metric text. Rates are already display percentages — do not multiply by 100. |
| Approval batch "applied" badge | `bg-blue-500/10 text-blue-400` | Info state |
| Request status badge | `StatusBadge domain="request"` (`teal` awaiting/team-replied, `amber` in progress, `emerald` resolved) | Canonical request lifecycle semantics |
| Unified inbox work-order TRACK chip (R5, `unified-inbox`) | `ordered` = amber (`text-accent-warning bg-amber-500/10 border-amber-500/20`, `Clock`); `in_progress` = blue (`text-accent-info bg-blue-500/10 border-blue-500/20`, `Loader2` + `animate-spin`); `completed` = emerald (`text-accent-success bg-emerald-500/10 border-emerald-500/20`, `CheckCircle2`) | Read-only order-progress chip in the "Work in progress" track lane (`UnifiedInbox.tsx`). Mirrors the legacy `OrderStatus.tsx` STATUS_BADGE tokens. NEVER teal for the chip (teal = actions; the track lane has no action). The `OrderTrackStepper` completed-step dots/connectors MAY use teal — they mark completed PROGRESS, a data affordance consistent with the legacy `OrderStatus` stepper. |
| Unified inbox work-order conversation — client's own bubble (`unified-inbox`) | `bg-blue-500/10 border-blue-500/30` (SG-2) | Client context = blue (read-only data per Law 2); teal is reserved for actions. The team bubble stays neutral (`--surface-3`). Mirrors the content-request client-bubble rule above. |
| Unified inbox work-order comment-count badge (`unified-inbox`) | `<Badge tone="blue" variant="soft" shape="pill" icon={MessageSquare}>` | Comment count is read-only conversation data, not an action. Rendered on Work in progress cards for 0/1/plural counts. |
| Unified inbox "Ready to publish" approved pill (`unified-inbox`) | `<StatusBadge domain="approval" status="approved" />` → emerald (SG-1) | Success state reads as emerald (Law 3), not a neutral zinc pill. |
| Informational intent badge | `text-blue-400 bg-blue-500/10` | Intent = info |
| Full Post service badge | `bg-teal-500/10 text-teal-300` | Brand accent (was blue, fixed) |
| Page type badge | `bg-teal-500/10 text-teal-400` | Brand accent |
| Tier badges (all tiers) | `bg-teal-500/15 text-teal-300` (Growth/Premium), `zinc` (Free) | Teal intensity |
| User avatar gradient | `from-teal-500 to-emerald-500` | Brand gradient |
| AI chat FAB + messages | `from-teal-600 to-emerald-600` (FAB), `bg-teal-600/20` (user msg) | Client chat = teal |
| Welcome modal | `from-teal-500 to-emerald-500` icon/glow | Brand accent |
| Payment modal | All teal (header, price, topic, CTA) | Unified teal |
| Client header at mobile widths | Responsive stacked toolbar (`flex-col` on mobile, `sm:flex-row` on desktop) with contained horizontal scrollers | Prevent document-level horizontal overflow at 375px while preserving tab/date-range scroll affordances |

#### Client Insights — Magazine Briefing Layout — REMOVED 2026-06-20

The client-facing magazine briefing variant (`src/components/client/Briefing/InsightsBriefingPage` + sub-components, gated on `client-briefing-v2`) was removed when the client overview consolidated on The Issue. The shared primitives it composed survive: `ActionQueueStrip` (amber action strip, `bg-amber-500/15 border-amber-500/30`, stale-pill escalation) and `WinsSurface` are still used by The Issue and the legacy overview; `MonthlyDigestContent` / `StatCard size="hero"` / `MetricRing` / `ContentGapRow` design conventions documented elsewhere are unchanged. The Briefing-v2-exclusive Phase 2.5b (DateLine / IssueSummaryLine / PulseStrip / DataSpread / RecommendedForYou) and Phase 2.5e (`WeeklyOpener`, gated on `client-briefing-v2-ai-polish`) layout sections below describe deleted components — retained briefly as historical reference, not active design law. The server briefing pipeline + admin `BriefingReviewQueue` remain live (see FEATURE_AUDIT #528).

#### Client Inbox IA — 3-Section Layout

InboxTab renders three named sections in the canonical client inbox routing model. Section headers use existing design system patterns — no new color families introduced.

| Element | Color | Rationale |
|---------|-------|-----------|
| **Section header** ("Decisions", "Reviews", "Conversations") | `t-label text-[var(--brand-text-muted)] tracking-wider uppercase` | Muted label — structural chrome, not a CTA |
| **Section header divider** | `border-b border-[var(--brand-border)]` | Standard border token |
| **Approve CTA** (within action cards) | `bg-teal-600 hover:bg-teal-500` | Teal = action (Law 1) |
| **Request Changes CTA** | `bg-amber-600/20 border-amber-500/30 text-amber-300 hover:bg-amber-600/30` | Amber = needs attention |
| **SchemaReviewModal / ClientActionDetailModal** backdrop | `bg-[var(--brand-overlay)]` | Token-only — no raw `bg-black/X` |
| Modal close ("✕") | `text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]` | Standard muted-to-default step |

The legacy single-list fallback and the `new-inbox-ia` rollout flag are retired.

##### Phase 2.5b — investor-briefing reading rhythm — REMOVED 2026-06-20 (Briefing-v2 client variant teardown; historical reference only)

Phase 2.5b extends the magazine layout with five new sections in the 8-stop reading rhythm: Dateline → Issue Summary → Action Strip → **Pulse** → Lead → **Data Spread** → **Recommended for You** → Watch List. New layout conventions:

| Element | Color | Rationale |
|---------|-------|-----------|
| **DateLine** ("WEEK OF MMM DD · ISSUE N") | `t-label tracking-wider text-[var(--brand-text-muted)]` + hairline divider below | Anchors the reader; "ISSUE N" parallels print briefings. Issue badge omitted when null. |
| **IssueSummaryLine** | `t-body text-[var(--brand-text-muted)] leading-relaxed` | One-line investor-briefing prose; deterministic from story composition. |
| **ActionQueueStrip stale pill** (Phase 2.5b extension) | `bg-amber-500/30 border-amber-400/50 text-amber-200` + Clock icon | Brighter amber than the regular chips — escalation step for items >7d old. Renders only when `staleCount > 0`. |
| **PulseStrip** wrapper | `<SectionCard variant="subtle">` titled "THE PULSE", `titleExtra` "vs prev 28d" | Subtle chrome — Pulse is a snapshot, not the story |
| Pulse cell — Site Health | `<MetricRing size={56}>` (built-in score color: emerald ≥80 / amber ≥60 / red <60) + label/delta to the right | Ring is the canonical health visualisation |
| Pulse cell — Visitors / Clicks / Avg Position | `<StatCard size="hero" valueColor="text-blue-400">` (data hue) | Blue = data; default delta colors handle direction |
| Pulse cell — Avg Position | StatCard with `invertDelta` | Lower position number = better; invert flips the sign for color rendering |
| **DataSpread** wrapper | Two `<SectionCard variant="subtle" noPadding>` columns in a `grid grid-cols-1 md:grid-cols-2 gap-6` | `noPadding` prevents the SectionCard inner wrapper from doubling internal padding |
| Data Spread "WINS" icon | `text-emerald-400` (TrendingUp) | Emerald — success / positive change |
| Data Spread "RISKS" icon | `text-amber-400` (TrendingDown) | Amber — needs attention |
| Data Spread row hover (clickable) | `hover:bg-[var(--surface-3)]/60 transition-colors` | One-step surface lift; cursor pointer when `drillInUrl` present |
| **RecommendedForYou** wrapper | `<SectionCard variant="default">` titled "RECOMMENDED FOR YOU" | Default chrome — primary upsell moment |
| RecommendedForYou row | `bg-[var(--surface-3)]/40 border-[var(--brand-border)] rounded-[var(--radius-lg)]` | Surface-3 inside surface-2 (SectionCard) — visible separation |
| Opportunity score badge | `bg-blue-500/10 text-blue-400 rounded-full` | Blue — read-only data metric (0/100 score) |
| Generate Brief CTA (Growth/Premium) | `bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/40` + Sparkles icon (Growth) / Check icon (Premium) | Teal — primary action; Premium variant signals "included" |
| Free-tier upgrade block (replaces row list) | Locked icon + "{N} opportunities locked" + Upgrade button | Free tier never sees individual rows — single CTA simplifies the choice |
| **HeroStoryCard dataReceipt line** (Phase 2.5b extension) | `border-t border-[var(--brand-border)]/30 pt-3` + `t-caption-sm text-[var(--brand-text-muted)] leading-relaxed` | Citation prose ("─ Source: GSC last-28-day vs prior-28-day window…"); rendered only when `story.dataReceipt` is populated by Phase 2.5a templates |

**Phase 2.5b principles:**

1. **Compose, don't duplicate.** PulseStrip uses existing `<StatCard size="hero">` + `<MetricRing>` primitives, not new variants. RecommendedForYou ports the admin `<ContentGaps>` row layout verbatim, swapping only the CTAs.
2. **Reuse existing data sources.** `pulseData` is computed client-side from `useClientAuditSummary` / `useClientGA4` / `useClientSearch` (the same hooks the Performance/Health tabs use). `recommendations` are sourced live from `keywordStrategy.contentGaps[]` at endpoint serve-time. No new tables, no migrations in 2.5b.
3. **Stale-item escalation is opt-in.** The ActionQueueStrip's escalation pill renders only when the composer passes `staleCount > 0`. Callers without staleness data (free tier, older code paths) see no escalation — back-compat preserved.
4. **Free tier is unchanged.** Phase 2.5b explicitly does NOT extend the free-tier branch; it stays at `<ActionQueueStrip>` + `<FreeTierUpgradeCTA>` + un-gated `<MonthlyDigestContent>` per the Phase 2 contract.

**Typography update (Phase 2.5b):** `.t-caption` switched from `'Inter' 400` to `'DIN Pro' 600` — global typography refresh aligning caption text with the rest of the DIN Pro hierarchy.

##### Phase 2.5e — Premium AI polish (`<WeeklyOpener>`) — REMOVED 2026-06-20 (Briefing-v2 client variant teardown; historical reference only)

Premium-only one-line "letter from the editor" rendered ABOVE the dateline when the `client-briefing-v2-ai-polish` flag is on. Free/Growth tiers and any fail-soft path → component is omitted entirely; the dateline remains the first element.

| Element | Treatment | Rationale |
|---|---|---|
| `<WeeklyOpener>` text | `t-body italic text-[var(--brand-text-muted)] leading-relaxed mb-2` | Italic body — visually distinct from the deterministic IssueSummaryLine that follows the dateline. Muted color signals "editorial overlay, not the lede." |
| Position | Above DateLine | Sets the tone before the reader anchors on the date. Mirrors a magazine's pull-quote intro. |
| Render guard | `briefing.weeklyOpener && <WeeklyOpener>` | Component itself returns null on empty input (defensive); composer skips the render when the wire field is absent (the common case). |

**2.5e principles:**

1. **Fail-soft is the default.** Both AI passes (`punchHeroHeadline`, `writeWeeklyOpener`) catch every error and return the deterministic original / null. The cron's surrounding try/catch is a backup, not the primary safety net. A flag-flip is the only rollback needed — no schema migration, no frontend conditional.
2. **Premium-only by tier check.** The flag gates the AI call; the workspace's `tier === 'premium'` is a second gate. Both must clear. A workspace flipping to Growth mid-week would cleanly stop receiving polish on the next cron tick.
3. **No quotes inside the opener.** The model is instructed to omit quote characters and the helper rejects responses that contain them. Quote characters clash with magazine chrome (story headlines already use `"`-wrapped queries).

### Admin Components

| Component | Element | Color | Rationale |
|-----------|---------|-------|-----------|
| **OnboardingChecklist** | Backdrop overlay | `bg-black/60 backdrop-blur-sm` | Full-screen modal, admin-only |
| **OnboardingChecklist** | Progress bar | `bg-blue-500` | Data — read-only completion metric |
| **OnboardingChecklist** | Completed step checkmark | `text-teal-400` | Action/completion state |
| **OnboardingChecklist** | Celebration icon | `bg-teal-500/10 text-teal-400` | Completion success |
| **WorkflowStepper** | Current step circle | `bg-teal-500/10 border-teal-500 text-teal-400` | Active = teal |
| **WorkflowStepper** | Completed step circle | `bg-emerald-500/10 border-emerald-500/40 text-emerald-400` | Success = emerald |
| **WorkflowStepper** | Future step circle | `bg-zinc-800/50 border-zinc-700 text-zinc-500` | Inactive = zinc |
| **WorkspaceHealthBar** | Progress bars | `bg-blue-500` | Data metric — read-only |
| **WorkspaceHealthBar** | Recommendation arrows | `text-teal-500 hover:text-teal-400` | Action CTAs |
| **AdminChat.tsx** | FAB, header, messages, send button, focus ring | `purple-600`, `purple-400` | Admin AI = purple (differentiated from client teal chat) |
| **SeoAudit.tsx** | "Flag for Client" button, badge, actions | `purple-600`, `purple-400` | Admin-only AI feature |
| **SchemaSuggester.tsx** | CMS template badge | `purple-500/15 text-purple-400` | Technical admin badge |
| **ContentBriefs.tsx** | Full Post badge, brief toggle, word count badge | `blue-500/10 text-blue-400` | Data/info context on admin side |
| **KeywordStrategy.tsx** | Page type badge, content gap cards | `teal` | Matches design system |
| **StrategyRequestedKeywordTrendSection.tsx** | Section icon chip, chart series | `bg-blue-500/20 text-blue-400`, `CHART_SERIES_ORDER` | Rank data = blue / chart tokens (read-only, client-facing, no purple) |
| **LocalPresencePage.tsx** | PageHeader icon, tabs, setup CTAs, local/GBP aggregate stats | Header/action accents use teal; local visibility/review counts use blue; success posture uses emerald | Admin-only IA shell for workspace-level local presence. No new hues, no purple; Keyword Hub keeps keyword-level evidence. |
| **WorkspaceOverview.tsx** | Tier badges on workspace cards | `teal-500/15 text-teal-400` | Unified |
| **WorkspaceSettings.tsx** | Knowledge base icon, client users icon, avatar gradient | `teal` | Unified |
| **OnboardingChecklist.tsx** | Progress bar | `bg-blue-500` | Data metric — tracks setup completion |
| **OnboardingChecklist.tsx** | Completed step checkmarks | `text-teal-400` | Teal = action accomplished |
| **OnboardingChecklist.tsx** | Dismiss button | `text-zinc-400 hover:text-zinc-200` | Neutral close action |
| **WorkflowStepper.tsx** | Completed step circle | `bg-emerald-500/10 border-emerald-500/40 text-emerald-400` | Emerald = done |
| **WorkflowStepper.tsx** | Current step circle | `bg-teal-500 text-white` | Teal = active |
| **WorkflowStepper.tsx** | Future step circle | `bg-zinc-700 text-zinc-400` | Zinc = inactive |
| **WorkspaceHealthBar.tsx** | Metric progress bars | `bg-blue-500` | Blue = data metric (read-only) |
| **WorkspaceHealthBar.tsx** | Recommended Next CTA | `from-teal-600 to-emerald-600` | Teal = action |
| **AssetAudit.tsx** | Action buttons (Crawl, Export) | `bg-blue-700 hover:bg-blue-600` | Admin data-action context (acceptable) |
| **SeoEditor.tsx** | "Unsaved" badge | `blue-500/10 text-blue-400` | State indicator |
| **RequestManager.tsx** | "New" status | `blue-500/10 text-blue-400` | Info state |
| **RichTextEditor.tsx** (BubbleMenu) | Active format button (B/I/H2/H3/Link) | `bg-teal-500/20 text-teal-300` | Teal = active interactive state (Law 1) |
| **RichTextEditor.tsx** (BubbleMenu) | Inactive format button | `text-[var(--brand-text)] hover:bg-[var(--surface-3)]` | Standard hover pattern |
| **RichTextEditor.tsx** (BubbleMenu) | Inline link input | `border-b border-teal-500/50` | Teal underline = actionable input |
| **RichTextEditor.tsx** (ProseMirror) | Links in content | `text-teal-400 underline` | Teal = interactive/actionable |
| **PostEditor.tsx** / **PostReviewCard.tsx** | Auto-save status "Saving…" | `t-caption-sm text-[var(--brand-text-muted)]` | Muted = passive state indicator |
| **PostEditor.tsx** / **PostReviewCard.tsx** | Auto-save status "Saved" | `t-caption-sm text-emerald-400` | Emerald = success (Law 3) |
| **FixDiffModal.tsx** | Backdrop | `bg-[var(--brand-overlay)] z-[var(--z-modal-backdrop)]` | Token-only — no raw `bg-black/X` |
| **FixDiffModal.tsx** | "Before" column header | `text-[var(--brand-text-muted)]` | Muted = old/passive content |
| **FixDiffModal.tsx** | "After" column header | `text-teal-300` | Teal = new/actionable suggestion |
| **FixDiffModal.tsx** | "Apply Fix" CTA | `bg-teal-600 hover:bg-teal-500` | Teal = action (Law 1) |
| **OvDivergencePanel.tsx** | Section title icon (`Activity`) | `text-blue-400` | Blue = data — this is a read-only diagnostic, not an action surface |
| **OvDivergencePanel.tsx** | Agree-rate value (`CompactStatBar`) | `text-emerald-400` (≥80%) / `text-amber-400` (≥50%) / `text-red-400` (<50%) | Health read on the rate — emerald/amber/red per Laws; NEVER teal (no action) |
| **OvDivergencePanel.tsx** | Red-flag counts (invariant-broken, OV-null) | `text-red-400` when > 0, else `text-[var(--brand-text-bright)]` | Red = the flag is raised; neutral when clean |
| **OvDivergencePanel.tsx** | OV pick quality badges (confidence / EMV / grounded-spine) | `Badge tone="blue"` | Blue = read-only data metric (Law 2) |
| **OvDivergencePanel.tsx** | `invariantHeld` indicator | `Badge tone="emerald"` (held) / `Badge tone="red"` (broken, `AlertTriangle`) | Emerald = success; red = failure |
| **OvDivergencePanel.tsx** | "OV no pick" flag | `Badge tone="red"` (`ShieldOff`) | Red = missing OV pick (red flag) |
| **OvDivergencePanel.tsx** | Show/Hide collapse + disagreement rows | `Button variant="ghost"` + `ClickableRow` | Primitives only — no raw `<button>`. Admin-only, no purple. |
| **CompetitorsPage.tsx** (The Issue Phase 6) | PageHeader icon (`Users`) | `text-accent-brand` | Brand-tinted page icon, matches KeywordStrategy/Strategy chrome |
| **CompetitorsPage.tsx** | Page composition | `CompetitorAlertsPanel` → existing `StrategyCompetitiveTab` (ShareBar + CompetitiveIntel + KeywordGaps + BacklinkProfile) | Maximal reuse; admin-only, no purple. NON_REGISTRY page (no global nav), reached via flag-ON deep-link from The Issue cockpit |
| **CompetitorAlertsPanel.tsx** | SectionCard title icon (`Swords`) | `text-accent-brand` | Brand-tinted section icon |
| **CompetitorAlertsPanel.tsx** | Position-change metric (`#12 → #7`) + volume | `text-blue-400` | Blue = data metric, read-only (Law 2) |
| **CompetitorAlertsPanel.tsx** | Severity Badge | `critical → Badge tone="red"`, `warning → tone="amber"`, `opportunity → tone="emerald"` | Severity map per Laws (red=critical, amber=warning, emerald=opportunity); never teal (no action), never purple |
| **KeywordStrategy.tsx** (issueOverviewEl, flag-ON only) | "Competitor intelligence →" deep-link | `Button variant="link"` (teal) | Teal = action/link (Law 1); flag-ON deep-link to the Competitors page, not rendered flag-OFF |

### Outcome Tracking

| Element | Color | Rationale |
|---------|-------|-----------|
| Win rate rings | `scoreColor()` scale: green ≥70, amber 40–69, red <40 | Score = data, uses standard score helpers |
| Score badges: strong_win / win | `bg-emerald-500/10 text-emerald-400` | Positive outcome = green |
| Score badges: neutral | `bg-amber-500/10 text-amber-400` | No clear signal = amber |
| Score badges: loss | `bg-red-500/10 text-red-400` | Negative outcome = red |
| Score badges: insufficient_data / inconclusive | `bg-zinc-500/10 text-zinc-400` | Unknown = zinc |
| Action type badges | `bg-blue-500/10 text-blue-400` | Data indicator — blue for read-only labels |
| Delta indicators: improved | `text-emerald-400` + ↑ arrow | Positive direction = green |
| Delta indicators: declined | `text-red-400` + ↓ arrow | Negative direction = red |
| Delta indicators: stable | `text-zinc-400` + → arrow | No change = zinc |
| Confidence badges: high | `bg-emerald-500/10 text-emerald-400` | High confidence = green |
| Confidence badges: medium | `bg-amber-500/10 text-amber-400` | Medium confidence = amber |
| Confidence badges: low | `bg-red-500/10 text-red-400` | Low confidence = red |
| Outcome CTAs (admin) | `from-teal-600 to-emerald-600` | Standard CTA gradient |
| Client "We Called It" highlight | `bg-teal-600/20 border-teal-500/30 text-teal-300` | Soft teal — client-facing positive signal |
| Attributed dollar value (admin Top Wins + client WinsSurface) | `text-accent-info` (blue) | Realized $ attribution is a read-only data metric — blue, never teal/emerald |
| Client "Your results" scorecard (`OutcomeSummary`, client Overview) | Win-rate stats: emerald ≥60% / amber ≥40% / red <40% via local `winRateColor()`; trend arrows emerald/red/neutral | Tiered via `<TierGate>` (free teaser → growth scorecard → premium breakdown); no purple |
| Client verdict hero MoM + typed breakdown (`IssueVerdictHeadline`, IA v2 — gated on `client-ia-v2`) | Outcome counts emerald (`text-accent-success`); month-over-month clause muted (`text-[var(--brand-text-muted)]`) with ↑/↓/→ direction glyphs | MoM is an honest read-only delta (muted, never a fabricated ↑ on a decline); the typed breakdown ("41 calls · 12 form fills") emerald = success/count law. No purple, tokens only. Flag-OFF byte-identical |

### Diagnostic Report (`DiagnosticReport/`)

| Element | Color | Rationale |
|---------|-------|-----------|
| Confidence: high | `bg-emerald-500/10 text-emerald-400` | High confidence = green (consistent with Outcome Tracking) |
| Confidence: medium | `bg-amber-500/10 text-amber-400` | Medium confidence = amber |
| Confidence: low | `bg-zinc-500/10 text-zinc-400` | Low confidence = zinc (not red — avoids false alarm) |
| Priority badge: P0 | `bg-red-500/10 text-red-400` | Urgent / ship this week |
| Priority badge: P1 | `bg-amber-500/10 text-amber-400` | This sprint |
| Priority badge: P2 | `bg-blue-500/10 text-blue-400` | Backlog — blue for low-urgency data |
| Priority badge: P3 | `bg-zinc-500/10 text-zinc-400` | Nice to have = zinc |
| Effort: low | `text-emerald-400` | Low effort = green (quick win) |
| Effort: medium | `text-amber-400` | Medium effort = amber |
| Effort: high | `text-red-400` | High effort = red |
| Impact: high | `text-emerald-400` | High impact = green |
| Impact: medium | `text-amber-400` | Medium impact = amber |
| Impact: low | `text-zinc-400` | Low impact = zinc |
| Owner badge | `bg-zinc-800 text-zinc-300` | Neutral metadata |
| Status badge: completed | `bg-emerald-500/10 text-emerald-400` | Done = green |
| Status badge: failed | `bg-red-500/10 text-red-400` | Error = red |
| Status badge: running/pending | `bg-amber-500/10 text-amber-400` | In-progress = amber |

### Strategy Keywords (`StrategyTab.tsx` — `priorityKeywordsPanel`)

Two-zone flat list + slide-in detail drawer introduced in the May 2026 rebuild.

#### Two-zone flat list

| Element | Color | Rationale |
|---------|-------|-----------|
| Confirmed keyword row (default) | `bg-[var(--surface-2)]` (via SectionCard/standard row) | No special tint — confirmed = native surface |
| Suggestion keyword row | `bg-blue-500/5 border border-blue-500/20` | Blue tint distinguishes suggestions from confirmed; hover `border-blue-500/30` |
| Row keyword name | `text-[var(--brand-text-bright)]` truncated 1 line | Primary identifier |
| Role·volume·KD sublabel | `text-[var(--brand-text-muted)]` truncated 1 line | Supporting metadata, not primary |
| **Role indicator dot — content** | `w-1.5 h-1.5 rounded-full bg-emerald-400 mt-0.5` | Emerald = content role (Law 3); `aria-hidden="true"` |
| **Role indicator dot — page** | `bg-blue-400` | Blue = page/data role (Law 2); `aria-hidden="true"` |
| **Role indicator dot — strategy** | `bg-teal-400` | Teal = strategy/action role (Law 1); `aria-hidden="true"` |
| **Role indicator dot — unknown** | `bg-[var(--brand-text-muted)]` | Muted = unclassified; `aria-hidden="true"` |
| **Enrichment pending suffix** | ` · data pending` appended to sublabel when `enrichmentStatus === 'unenriched'` | Plain English, no special color |
| **Opportunity accent bar** | `absolute left-0 top-0 bottom-0 w-0.5 bg-blue-400` + inline `opacity` scaled to `opportunityScore/100` (min 0.2) | Blue = data metric (Law 2); strength visually encoded; `aria-hidden="true"` |

#### Keyword detail drawer (desktop = right slide-in, mobile = bottom sheet)

**Three enrichment states:**
- `unenriched` — pulsing `w-1.5 h-1.5 rounded-full bg-[var(--brand-text-muted)] animate-pulse` dot + "Gathering data for this keyword…" message
- `partial` — metric cards render with "Gathering…" placeholder for missing fields
- `enriched` — full plain-English metrics rendered

**Plain-English metric translation layer** (`fmtAudience`, `fmtCompetition`, `fmtMomentum` helpers):
- KD 0–29 → "Approachable" (`text-emerald-400`)
- KD 30–49 → "Moderate competition" (`text-amber-400`)
- KD 50–74 → "Competitive" (`text-red-400`)
- KD 75+ → "Highly competitive" (`text-red-400`)
- Volume → audience size label (e.g. "~2.4K searches/mo")
- Trend → "Interest growing / steady / declining"

### Keyword Hub (`KeywordHub.tsx`)

The admin Keywords surface (the Keyword Hub, the sole keyword surface after the 2026-06-11 cutover) uses a full-width dense table with overlay detail, not a persistent side column.

| Element | Color | Rationale |
|---------|-------|-----------|
| Row hover / selected tint | `bg-teal-500/5` | Teal = active interaction state |
| Multi-select checkbox | `Checkbox` primitive (`--brand-mint`) | Teal action law; native checkbox accessibility preserved |
| Bulk action bar | `bg-[var(--surface-2)] border-[var(--brand-border)]` with Button primitives | Operational control surface, not a marketing card |
| Bulk add-to-strategy | Primary Button (`from-teal-600 to-emerald-600`) | Strategy action |
| Bulk track | Secondary Button | Lifecycle action with lower emphasis than strategy add |
| Bulk pause / retire | Ghost Button; retire uses amber caution semantics | Pause is reversible; retire preserves rank history and needs confirmation |
| Bulk decline | Amber Ghost Button | Decline is reversible strategy feedback, not an irreversible delete |
| Lifecycle badges | `StatusBadge domain="keyword-command-center"` | Keeps keyword, local lifecycle, and feedback status semantics centralized |
| Detail drawer | Fixed right slide-over desktop, bottom sheet mobile; `bg-[var(--surface-2)]`, token z-index, token shadow | Matches StrategyKeywordDrawer pattern while preserving table width |
| Drawer mini-panels | `KeywordDetailPanel` local helper with tokenized surface/border variants | Prevents repeated hand-rolled panel classes inside the drawer |
| Metric values | Blue for volume/CTR, neutral for rank | Blue = read-only demand/performance data |
| Value reasons | `text-[var(--brand-text-muted)]` with blue metric accents | Reasons explain read-only scoring inputs; blue only for data values such as CPC/search volume |
| Revenue potential / realized keyword value | `text-emerald-400` | Dollar value is positive outcome potential/success, not an action |
| Awaiting-data copy | Muted text inside tracking-state block | New tracking entries should not look like an error |
| Source badges | Badge primitive, wrapping cluster | Prevents long source labels from overflowing the drawer |

| Element | Color | Rationale |
|---------|-------|-----------|
| Drawer backdrop | `fixed inset-0 z-[var(--z-modal-backdrop)]` | Standard modal backdrop token |
| Drawer panel (desktop) | `sm:inset-y-0 sm:right-0 sm:border-l bg-[var(--surface-2)]` | Right-side slide-in, surface-2 for contrast |
| Drawer panel (mobile) | `inset-x-0 bottom-0 h-[65vh] rounded-t-[var(--radius-signature-lg)]` | Bottom sheet with brand signature radius |
| **Role badge — content opportunity** | `border-emerald-500/20 bg-emerald-500/8 text-accent-success` | Emerald = content/success opportunity |
| **Role badge — page opportunity** | `border-blue-500/20 bg-blue-500/10 text-accent-info` | Blue = data/page-level read |
| **Role badge — strategy keyword** | `border-teal-500/20 bg-teal-500/8 text-accent-brand` | Teal = primary strategy signal (Law 1) |
| **Role badge — keyword idea** | `border-[var(--brand-border)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]` | Zinc/muted = low-confidence idea |
| **Competition label — Approachable** | `text-emerald-400` | Low KD = quick win (Law 3) |
| **Competition label — Moderate** | `text-amber-400` | Medium KD = caution |
| **Competition label — Competitive / Highly competitive** | `text-red-400` | High KD = costly |
| **Trend — growing** | `text-emerald-400` | Positive direction (Law 3) |
| **Trend — declining** | `text-red-400` | Negative direction |
| **Trend — steady / unknown** | `text-[var(--brand-text-muted)]` | No direction signal |
| AI rationale prose | `t-caption-sm text-[var(--brand-text-muted)] leading-relaxed` | Supporting context, not the headline |
| Foldable "See the numbers" section | `bg-[var(--surface-3)] rounded-[var(--radius-lg)]` | Raw KD/volume/CPC hidden by default (progressive disclosure) |
| Next move CTA (add to strategy) | `bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30` | Teal = action (Law 1) |
| Footer "Remove" action | `text-[var(--brand-text-muted)] hover:text-red-400` | Destructive = red on hover |

**Intent coloring (search intent badges in inline rows):**
- `commercial` → `text-accent-info bg-blue-500/10 border-blue-500/20`
- `informational` → `text-accent-success bg-emerald-500/10 border-emerald-500/20`
- `transactional` → `text-accent-warning bg-amber-500/10 border-amber-500/20`
- `navigational` → `text-accent-cyan bg-cyan-500/10 border-cyan-500/20`

### Keyword Hub action affordances (`KeywordActionMenu.tsx`)

The Keyword Hub (Wave 4) introduces a deliberate **action-tone reconciliation** that frees **red exclusively for the one irreversible affordance — permanent Delete.** The shared server `buildNextActions` still emits `tone:'red'` for retire/decline; the Hub remaps those to amber locally in `KeywordActionMenu` rather than changing the server. (Post-cutover the `keyword-hub` flag is retired and the Hub is the only renderer — there is no longer a flag-OFF legacy path.)

The bulk action bar follows the same tone contract as row actions: Retire and Decline are amber ghost actions, not red danger buttons. Red remains reserved for permanent Delete only.

| Affordance | Tone | Rationale |
|------------|------|-----------|
| Track / Add to strategy / Restore | **Teal** | Constructive lifecycle actions (Law 1 — teal for actions) |
| View rankings (navigation) | **Blue** | Read-only data surface (Law 2) |
| **Retire / Decline** | **Amber** | Reversible removal (rank history preserved, restorable) — caution, NOT danger. Remapped from the server's flag-OFF red. |
| **Delete permanently** | **Red** (`IconButton variant="danger"`, `Trash2`) | The ONLY red affordance in the Hub. Visually separated (divider + icon button), gated by `ConfirmDialog variant="destructive"` with explicit copy ("This permanently deletes `<kw>` and its rank history. This cannot be undone."), and rendered ONLY when the client eligibility predicate (`canHardDelete`: MANUAL, unpinned, no gap/client provenance) is true. Ineligible rows hide Delete — retire is their only remove. |

This is the canonical example of the Four Laws' "red = irreversible/destructive only" discipline: soft retire (reversible) is amber; hard delete (irreversible, drops rank history) is red.

### Stripe Checkout

| Element | Color |
|---------|-------|
| Confirmation modal CTA | `from-teal-600 to-emerald-600` |
| Price text | `text-teal-300` |
| Keyword text | `text-teal-400/80` |
| Billing settings status | teal for configured actions, emerald for success |
| Checkout redirect errors | red error copy with retry |

> **All client-facing payment UI is teal.** Payments use Stripe Checkout redirects; the retired Stripe Elements form/modal should not be reintroduced.

---

## 5. Product Design Principles

### Information Hierarchy
1. **Topic / title first** — the most important thing
2. **Rationale / description second** — why it matters, one line
3. **Metadata last** — intent, keyword, page type as supporting context
4. **Single CTA** — one clear action per card. Lead with lower-commitment action (Brief), upsell later

### Client-Facing Decisions
- **Auto-recommend content type**: `suggestedPageType` from AI strategy, not client-selected
- **Simplify purchase flows**: Payment modal = Topic → Price → Pay. No feature lists, bundles, or comparison tables
- **Tier gates**: Blurred preview + upgrade prompt, not locked empty state
- **Priority badges removed** from client view — card ordering conveys priority

### Admin vs. Client

| Aspect | Admin | Client |
|--------|-------|--------|
| **Information density** | Full detail — priority badges, all metadata, raw data | Curated — less noise, guided actions |
| **AI chat accent** | Purple (distinguished from client) | Teal (brand accent) |
| **Content briefs** | StatusBadge registry for lifecycle states, blue only for read-only metadata | Teal review badges, preview-only, approve/request changes |
| **Design tokens** | Same primitives (`SectionCard`, `Badge`, etc.) | Same primitives |
| **Purple allowed?** | Yes — admin AI chat, Flag for Client, CMS badges | **Never** |

---

## 6. Spacing & Layout

| Context | Value |
|---------|-------|
| Page-level section gap | `space-y-8` (32px) between major sections |
| Related items within a section | `gap-3` (12px) |
| Between cards within a section | `gap-4` (16px) |
| Card padding | `p-4` standard (`size="hero"`), `p-3` default |
| Card header | `px-4 py-3` |
| Stat card grid | `grid-cols-2 sm:grid-cols-4` |
| Content opportunity grid | `grid-cols-1 md:grid-cols-2` |

### Card Border Radius — Asymmetric Signature Shape

The platform's signature shape is an asymmetric diagonal radius — tight top-left/bottom-right, rounded top-right/bottom-left:

| Component | Radius | Implementation |
|-----------|--------|----------------|
| `SectionCard` / `ChartCard` signature surfaces | `--radius-signature-lg` (`10px 24px 10px 24px`) | Owned by the primitive; do not inline in consumers |
| `StatCard` | `--radius-signature` (`6px 12px 6px 12px`) | Owned by the primitive |
| Generic panels / nested cards | `--radius-lg` (`10px`) | `rounded-[var(--radius-lg)]` |
| Buttons, inputs | `--radius-md` (`8px`) | `rounded-[var(--radius-md)]` |
| Badges, pills | `--radius-sm` (`4px`) or `--radius-pill` | Tokenized primitive styles |

### Foundation token families (F1 — UI rebuild)

The UI rebuild adds six token families to `src/tokens.css` (the single token source). All are consumed via `var(--…)`; never redeclare them elsewhere.

| Family | Tokens | Purpose |
|--------|--------|---------|
| **Font families** | `--font-display`, `--font-sans`, `--font-mono` | Canonical font stacks. Display = DIN Pro→Inter; sans = Inter; mono = JetBrains Mono (Fira Code retired, D6/§6). |
| **Type roles** | `--type-{hero,h1,h2,stat-lg,stat,stat-sm,page,body,ui,label,caption,mono,micro}-{size,line,weight,track}` | Size/weight/line/tracking values the `.t-*` utilities and ported DS components read (the `.t-*` refactor to consume them lands in F3). |
| **Spacing scale** | `--space-1 … --space-16` (4px rhythm) | Layout/gap/padding at the 4px grid. |
| **Shell / page layout** | `--shell-{sidebar,sidebar-rail,topbar}`, `--page-max{,-narrow,-wide}`, `--page-pad-{x,y,bottom}`, `--section-gap`, `--grid-gap{,-lg}`, `--bp-{sm,md,lg}` | App-shell + content boundary values (AppShell / PageContainer). |
| **Motion** | `--ease-out`, `--ease-draw`, `--dur-{fast,base,slow}`, `--stagger-step` | Canonical easing curves + durations. **Canonical**: all new motion uses `var(--dur-*)`/`var(--ease-*)`. The legacy 120/180/400ms literal standard applies to pre-rebuild code only (migration: DEF-foundation-003). |
| **Elevation** | `--shadow-{sm,md,lg,glow}` (canonical, both themes) | Canonical elevation family. `--brand-shadow-*` is **deprecated** (kept; migration is a Z-phase item). |

---

## 7. Interaction Patterns

| Pattern | Spec |
|---------|------|
| Card hover (data-only) | `border-zinc-700` + `box-shadow: 0 4px 24px -4px rgba(0,0,0,0.3)` |
| Card hover (interactive/clickable) | Left border `rgba(45,212,191,0.4)` teal accent. Use `interactive` prop on `SectionCard` |
| Button transition | `transition-colors` (150ms) or `transition-all` for complex states |
| Active tab (segmented) | `bg-zinc-700 text-zinc-200` |
| Active tab (underline) | `border-teal-500 text-teal-300` |
| Loading | `Loader2 animate-spin text-teal-400` |
| Toast | Top-right, auto-dismiss after 5s, tokenized surface/radius/shadow. Success=`border-accent-success-soft`, error=`border-accent-danger-soft`, info=`border-accent-info-soft`. |
| Modal enter | `animate-[scaleIn_0.2s_ease-out]` |
| Modal overlay | `bg-black/70 backdrop-blur-md` |
| Modal container | `bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl max-w-md` |
| Full-screen modal | `fixed inset-0 z-[var(--z-modal-fullscreen)] bg-black/80 backdrop-blur-sm` | Used for takeover dialogs (SchemaReviewModal, ClientActionDetailModal). `--z-modal-fullscreen: 55` sits between `--z-modal` (50) and `--z-toast` (60). |

**Full-screen modal shell contract** (`SchemaReviewModal`, `ClientActionDetailModal`):
- `fixed inset-0 z-[var(--z-modal-fullscreen)]` — fills the entire viewport, above standard modals, below toasts
- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` pointing to the `<h2>` title
- `autoFocus` on the close button (first focusable element)
- Escape key handler calls `onClose()`
- Background: `bg-black/80 backdrop-blur-sm`
- Token: `--z-modal-fullscreen: 55` (defined in `src/tokens.css`)

**Z-index token scale** (defined in `src/tokens.css` and mirrored to `public/tokens.css`):
`--z-sticky: 10`, `--z-dropdown: 20`, `--z-tooltip: 30`, `--z-modal-backdrop: 40`, `--z-modal: 50`, `--z-modal-fullscreen: 55`, `--z-toast: 60`, `--z-commerce-backdrop: 60`, `--z-commerce-drawer: 61`, `--z-takeover: 70`, `--z-client-toast: 80`, `--z-command-palette: 100`, `--z-system-toast: 200`, `--z-critical-system: 9999`.
Use named z-index token classes such as `z-[var(--z-modal)]` rather than raw numeric z-index values; new layers need a named token and a concrete stacking rationale.
| Page transition | `ScannerReveal` — muted teal beam sweeps top-to-bottom on navigation (850ms, ease-out) |
| Card entrance | Stagger-fade: `staggerFadeIn` 0.4s + 60ms delay per sibling. Use `staggerIndex` prop on `SectionCard`/`StatCard` |
| MetricRing entrance | Charge-up: ring sweep → number fade at 0.8s → glow bloom at 2s. Disabled with `noAnimation` prop |
| Noise texture | `body::after` SVG feTurbulence at 2% opacity — reduces digital perfection, adds tactile depth |

---

## 8. Accessibility (WCAG AA)

- All accent colors meet **≥ 4.5:1** contrast in light mode (see `DESIGN_SYSTEM.md` Accent Colors table for ratios)
- Score rings: **color + number** (never color alone)
- Severity badges: **color + icon** (AlertTriangle, CheckCircle, Info)
- Delta indicators: **color + directional arrow** (↑/↓)
- Focus rings: `2px solid teal` with `2px offset` on `:focus-visible`
- Minimum font size: **12px** enforced (`text-[11px]` overridden in CSS)
- No text lighter than `zinc-500` on dark backgrounds

---

## 9. File References

| File | Purpose |
|------|---------|
| `DESIGN_SYSTEM.md` | Component specs, Tailwind classes, typography scale, migration checklist |
| `BRAND_DESIGN_LANGUAGE.md` | This file — brand identity, color rules, product design, AI prompting |
| `FEATURE_AUDIT.md` | Feature inventory, shipped/planned items, cascade update prompt |
| `src/components/ui/index.ts` | Barrel export of all primitives |
| `src/components/ui/constants.ts` | `scoreColor()`, `scoreColorClass()`, date presets |
| `src/components/ui/Badge.tsx` | 7-color badge primitive |
| `src/components/ui/StatCard.tsx` | Default + CompactStatBar |
| `src/components/ui/MetricRing.tsx` | MetricRing + MetricRingSvg |
| `src/components/ui/SectionCard.tsx` | Standard card container |
| `src/components/ui/ChartCard.tsx` | SectionCard variant for charts (tighter padding, inline title+trend) |
| `src/components/ui/TrendBadge.tsx` | Canonical directional delta indicator (emerald/red/zinc) |
| `src/components/ui/FreshnessStamp.tsx` | Canonical real-data recency stamp; renders nothing without a valid timestamp |
| `src/components/ui/PageHeader.tsx` | Consistent page header |
| `src/components/ui/TabBar.tsx` | Underline tab navigation |
| `src/components/ui/DateRangeSelector.tsx` | Segmented date picker |
| `src/components/ui/EmptyState.tsx` | Centered empty/placeholder |
| `src/components/ui/NextStepsCard.tsx` | Post-completion next-step card |
| `src/components/ui/ProgressIndicator.tsx` | Blue progress bar, idle/error = null |
| `src/components/ui/TierGate.tsx` | Tier lock overlay + TierBadge |
| `src/components/ui/DataList.tsx` | Ranked data list |
| `src/components/ui/ConfirmDialog.tsx` | Confirmation modal (teal CTA, destructive variant = red CTA, Escape/Enter keyboard, backdrop dismiss) |
| `src/components/ui/OnboardingChecklist.tsx` | First-visit workspace setup modal (blue progress, teal checkmarks, localStorage) |
| `src/components/ui/WorkflowStepper.tsx` | Horizontal numbered stepper (emerald=done, teal=current, zinc=future) |
| `src/components/ui/WorkspaceHealthBar.tsx` | Multi-metric health bars + recommended next action (blue fills, teal CTA) |
| `src/components/ClientDashboard.tsx` | Client-facing dashboard (largest component) |
| `src/components/AdminChat.tsx` | Admin AI chat (purple accent) |
| `src/components/KeywordStrategy.tsx` | SEO strategy + content gaps |
| `src/components/ContentBriefs.tsx` | Admin content brief management |
| `src/components/StripeSettings.tsx` | Stripe Checkout configuration |
| `src/components/WorkspaceOverview.tsx` | Admin workspace grid |
| `src/components/WorkspaceSettings.tsx` | Admin workspace config |

---

## 10. AI Prompting Guidelines (Cascade / Future Sessions)

### When to Reference This Document

Read `BRAND_DESIGN_LANGUAGE.md` **before** making any UI changes. It is the authority on:
- Which color to use for any new element
- Whether purple, blue, or teal is appropriate
- How admin vs. client views differ
- Which UI primitives exist and should be reused

### Color Decision Tree

```
Is it a button, CTA, toggle, or interactive highlight?
  → Teal (from-teal-600 to-emerald-600 for primary, bg-teal-600/20 for soft)

Is it a data metric (clicks, sessions, impressions, CTR)?
  → Blue (text-blue-400, bg-blue-500/10)

Is it the admin AI chat or an admin-only AI feature?
  → Purple (purple-400/purple-600)

Is it a score (health, performance, audit)?
  → Use scoreColor() / scoreColorClass() — auto green/amber/red

Is it a status indicator?
  → Success/delivered: green
  → Warning/trial: amber
  → Error/critical: red
  → Needs attention: orange
  → Info/review: blue
  → Requested by client: teal

Is it a tier badge or plan indicator?
  → Client-facing: teal (all tiers) or zinc (free)
  → TierGate admin lock: teal (growth) or amber (premium)
```

### Before Adding a New Color

1. Check this document's Per-Component Color Map
2. Check `Badge.tsx` — does an existing badge color fit?
3. Check `DESIGN_SYSTEM.md` — is there a primitive for this?
4. **Never introduce violet, indigo, or new hues** without explicit approval
5. If unsure, default to teal for interactive, blue for informational, zinc for neutral

### When Editing UI Components

1. **Use primitives first**: `<StatCard>`, `<SectionCard>`, `<Badge>`, `<EmptyState>`, `<PageHeader>`, `<TabBar>`, `<MetricRing>`, `<DataList>`, `<DateRangeSelector>`, `<TierGate>`
2. **Don't inline what a primitive handles** — if you're writing `bg-zinc-900 rounded-xl border border-zinc-800` for a card, use `<SectionCard>` instead
3. **Check both dark and light mode** — all accent colors have light-mode overrides in CSS
4. **Respect the admin/client split** — purple is admin-only, teal is universal for actions
5. **Clean up stale ternaries** — if a color branch is unified (e.g., `isFull ? blue : teal` → always teal), simplify to static classes

### When Creating New Features

1. Plan the color scheme before writing JSX — reference the Per-Component Color Map
2. Client-facing features: teal accent, no purple, simplified UI
3. Admin features: may use purple for AI-powered elements; blue for data views
4. Always add new components to this doc's Per-Component Color Map
5. Use `<TierGate>` for tier-locked features, not custom lock UI

### Updating This Document

When shipping UI changes that affect color or design patterns:
1. Update the Per-Component Color Map (Section 4)
2. Update `FEATURE_AUDIT.md` Future Additions if applicable
3. Run `tsc --noEmit && vite build` to verify no regressions
4. Commit docs alongside code: `git add BRAND_DESIGN_LANGUAGE.md DESIGN_SYSTEM.md`

---

## 11. Change Log

| Date | Change |
|------|--------|
| 2025-03-07 | Initial creation: unified violet→teal, blue CTA→teal, simplified payment modal, removed client page-type selectors, cleaned content cards, hidden bundles |
| 2025-03-07 | **v2 rewrite**: Full codebase audit (43 components + 12 primitives). Fixed the historical Stripe payment form, WorkspaceOverview, WorkspaceSettings. Added per-component color map, primitive inventory, admin vs client rules, AI prompting section |
| 2026-03-27 | **Analytics Hub redesign**: Added `AnnotatedTrendChart` with dual Y-axes, annotation markers, click-to-annotate. Merged SearchConsole + GoogleAnalytics into `AnalyticsHub`. |
| 2026-03-27 | **Connected Intelligence Phase 1**: New `InsightFeed` priority feed component (severity icons: red=critical TrendingDown, amber=warning AlertTriangle, blue=opportunity Target, green=win TrendingUp). `SummaryPills` with colored dots (red/amber/green/blue/purple) and toggle-filter interaction. `InsightSkeleton` shimmer loading. `AnnotatedTrendChart` gains toggleable line chips (solid=active, outline=inactive, grayed=at-max). All three hub tabs now insight-first with sub-tabs. |
| 2026-03-28 | **Visual Polish** (10 refinements): Asymmetric card radius (SectionCard `10px 24px`, StatCard `6px 12px`), MetricRing outward glow + charge-up animation, noise overlay on body, ScannerReveal page transitions, spacing variation (`space-y-8` between sections), removed uppercase from section headings, StatCard `size="hero"` prop, stagger-fade entrance animations, interactive card hover (teal left-border accent), status color muting (`emerald-400/80`, `amber-400/80`, `red-400/80`, bg at `/8` opacity). Updated: SectionCard, StatCard, MetricRing, Skeleton, TierGate, Badge, statusConfig, ~60 consumer files. |
| 2026-03-29 | **Outcome Intelligence Engine**: Added Outcome Tracking color map — win rate rings use `scoreColor()`, score badges (strong_win/win=green, neutral=amber, loss=red, insufficient_data/inconclusive=zinc), action type badges (blue), delta indicators (green/red/zinc), confidence badges (green/amber/red). Client "We Called It" uses soft teal. All outcome CTAs use standard teal gradient. |
| 2026-03-30 | **Light Mode Audit + Visual Polish**: Fixed 148 dark-color instances across 42 files. Added 7 chart theme helpers to `constants.ts` (`themeColor`, `chartGridColor`, `chartAxisColor`, `chartDotStroke`, `chartDotFill`, `chartTooltipStyle`, `chartTooltipLabelStyle`). Fixed MetricRing glow to match score color (not always teal). Fixed ScannerReveal overlay, MetricRing track, Skeleton shimmer, Stripe Elements theming, all Recharts chart axes/grids/dots/tooltips. Added 17 missing `.dashboard-light` CSS overrides. Added 2 pr-check rules for dark hex enforcement. Standardized `space-y-8` on 10 page wrappers, asymmetric border radius on 11 cards. |
| 2026-04-09 | **Page Rewriter UI** (Feature #138): Apply interaction uses teal highlight — `background-color: rgba(13,148,136,0.2)` + `border-left: 2px solid #0d9488` — fades over 2s via CSS transition (all three properties cleared). Floating formatting toolbar uses `bg-zinc-700 border-zinc-600` (no teal — it's a utility tool, not an action). Issue chips: `red-*` for errors, `amber-*` for warnings, `blue-*` for info — follows existing status color convention. Focus mode toggle: teal active state (`text-teal-400 bg-teal-500/10`) per Law 1 (toggle = action). **Integration note for Copy & Brand Engine:** `data-section` attribute on all document headings and `applyToSection()` in `PageRewriteChat.tsx` are the designated extension points for inline text-selection targeting. |
| 2026-04-13 | **Admin UX PR4 — Onboarding & Guided Flows**: Added 3 new shared UI primitives. `OnboardingChecklist`: modal overlay with blue progress bar (data), teal checkmarks (action accomplished), focus trap, Escape-key dismiss, localStorage persistence per workspace. `WorkflowStepper`: horizontal numbered stepper — green=completed, teal=current, zinc=future; compact variant. `WorkspaceHealthBar`: blue progress fills (data metric law) + teal Recommended Next CTA (action law). Added per-component color map rows for all three. Also fixed purple violations in `PageIntelligence` (admin-only component with no client-facing exposure — purple removed per Four Laws). |
| 2026-04-20 | **Light Mode Overhaul (client portal)**: `.dashboard-light` token set expanded from 10 → 25 variables (WCAG AA verified). New tokens: `--brand-bg-hover`, `--brand-bg-active`, `--brand-text-disabled`, `--brand-border-strong`, `--brand-shadow-sm/md`, `--scrollbar-thumb/hover`, `--chart-grid`, `--chart-tooltip-bg/text`, `--brand-overlay`, `--brand-mint/hover/dim`, `--metric-ring-track`. `--brand-text-muted` adjusted `#64748b`→`#475569` (slate-600, 6.5:1 contrast). Four-step text hierarchy restored. `chartGridColor()` and `chartTooltipStyle()` now read from CSS variables via `getCssVar()`. New UI primitive: `ConfirmDialog` (centered modal, teal CTA, Escape/Enter keyboard support, destructive variant). ApprovalsTab: 3 `window.confirm()` calls replaced with `ConfirmDialog`; filter bar added (All / Needs Action / Ready to Apply / Applied with live batch counts). |
| 2026-04-25 | **Phase 5 Phase 3 — Design system enforcement hardening**: Added 8 new pr-check rules (3 error, 5 warn) to lock in Phase 2's codemod gains. **Error severity** (zero-hit verified): `Forbidden hues (rose/pink) in components`, `text-green-{N} for success/score`, plus warn→error promotions for `Hand-rolled trend badge` and `Non-standard transition duration`. **Warn severity** (long-tail backlog): `Hand-rolled gradient CTA button` (~10 sites), `Arbitrary pixel text-size` (use .t-* utility, ~318 sites), `Raw text-zinc-N` / `bg-zinc-N` / `border-zinc-N` (use --brand-*/--surface-* tokens, ~514 sites combined), `Inline asymmetric border-radius` (use --radius-signature, ~114 sites). Migrations in same PR: 5 hand-rolled gradient CTAs (TemplateEditor×2, ClientDashboardTab×2, AiSuggested, BlueprintDetail) → `<Button variant="primary">`; 1 green button (RequestList Deliver Brief) → emerald; 1 preview-disabled gradient button hatched. Total pr-check rule count: 83 → 91 (49 error, 42 warn). 28 fixture tests added. CLAUDE.md "Forbidden" list and Four Laws Law #3 now mechanized rather than prose-only. |

---

| 2026-04-27 | **Design System Phase A — Tokenize UI primitives** (PR #329): Migrated 10 core UI primitives (SectionCard, Modal, ConfirmDialog, StatCard, TrendBadge, Badge, StatusBadge, DataList, TierGate, AIContextIndicator) from raw Tailwind classes to CSS custom property tokens (`--surface-*`, `--brand-text-*`, `--brand-border`, `--radius-*`). `.t-*` typography sizes boosted to match existing `!important` overrides (`.t-caption-sm` 13.5px, `.t-caption` 13.5px, `.t-body` 15.5px). `@layer components` cascade fix ensures Tailwind utilities override `.t-*` font properties. Historical migration lookup table: `docs/rules/archive/phase-b-migration-map.md`. |
| 2026-04-27 | **Design System Phase B — Domain sweeps** (PRs #332–#336): 5 parallel domain sweeps migrating ~115 consumer files from raw Tailwind to `.t-*` typography classes and `--surface-*`/`--brand-*` tokens. B.1 Admin analytics (5 files), B.2 Admin content (31 files), B.3 Admin operations (21 files, added `iconOnly` prop to TrendBadge, WorkspaceSelector delete → ConfirmDialog), B.4 Client domain (43 files, 4 hand-rolled modals → `<Modal>`), B.5 Brand/schema/revenue (15 files, 8 `window.confirm()` → `<ConfirmDialog>`). |
| 2026-04-27 | **Design System Phase C — New pr-check rules** (PR #337): 5 new rules (`Raw rounded-* literal` warn, `No purple/violet in client domain` error, `Trend icon import outside TrendBadge` warn, `Hand-rolled fixed inset-0 outside overlay` warn, `score-color-law-parity` error) + promoted `styleguide-token-parity` warn→error. Rule count: 91→96 (52 error, 44 warn). |
| 2026-04-27 | **Design System Phase D — Doc drift fixes**: Renamed "Three Laws" → "Four Laws" across all docs and pr-check rule messages. Added emerald Law 3 (success). Updated `DESIGN_SYSTEM.md` typography scale to match `.t-*` class definitions. Synced `automated-rules.md`. |
| 2026-04-28 | **Design System Phase 6D — Blue-on-Button Law 02 Audit**: Audited blue usage on interactive elements per Law 02 ("Blue is read-only, never actionable"). Changed 4 actionable buttons from blue to teal: RequestList "View Brief" toggle, BriefDetail "Generate Full Post", SettingsPanel + ConnectionsTab "Connect Google". SettingsPanel Trash2 prune icon changed blue→red (destructive action). SeoAudit Info StatCard blue retained as severity-category color (consistent with Errors=red, Warnings=amber). |
| 2026-04-28 | **Blog Editor — TipTap BubbleMenu + FixDiffModal patterns**: `RichTextEditor.tsx` BubbleMenu uses `bg-teal-500/20 text-teal-300` for active format buttons (Law 1), `hover:bg-[var(--surface-3)]` for inactive. Link text in ProseMirror content uses `text-teal-400 underline`. Auto-save status: "Saving…" = `text-[var(--brand-text-muted)]`, "Saved" = `text-emerald-400` (Law 3 success). `FixDiffModal` backdrop uses `bg-[var(--brand-overlay)]` (no raw `bg-black/X`), "After" suggestion header `text-teal-300`, "Apply Fix" CTA `bg-teal-600 hover:bg-teal-500`. Per-component entries added to color map table above. |
| 2026-04-29 | **`.t-body` → DIN Pro 500** (PR #379): Body text utility class promoted from `Inter / 400` to `'DIN Pro', 'Inter' / 500` in both `src/index.css` + `public/styleguide.css` (lockstep per styleguide-typography-parity rule). Affects every consumer of `.t-body` platform-wide — page cards, form descriptions, schema widgets, BodyText primitive, etc. Inter remains the fallback so glyphs missing from DIN Pro degrade gracefully. Other `.t-*` classes unchanged. |

---

| 2026-05-03 | **Strategy Keywords rebuild** (PRs #430–#434 + task commits): Two-zone flat list (confirmed rows = standard surface, suggestion rows = `bg-blue-950/60 border border-blue-900/50`). Role badge coloring: content=emerald, page=blue, strategy=teal, idea=zinc/muted. KD difficulty coloring: ≤29=emerald-400, 30–49=amber-400, ≥50=red-400. Trend coloring: rising=emerald-400, declining=red-400, stable/unknown=muted. Drawer: right slide-in on desktop, bottom sheet on mobile. No sort controls. Per-component map section added. |
| 2026-05-09 | **Client Inbox Redesign** (feat/client-inbox-redesign, 5 phases): `PriorityStrip` urgency component (teal CTA, renders null when nothing pending). `InboxTab` restructured into 3 collapsible sections (SEO Changes / Actions / Needs Your Attention) with Active/Completed mode toggle and 4 filter chips. `schema-review` standalone tab retired — schema plan card moves to InboxTab SEO Changes. New `--z-modal-fullscreen: 55` token in `src/tokens.css` (between `--z-modal: 50` and `--z-toast: 60`). `SchemaReviewModal` + `ClientActionDetailModal`: full-screen WAI-ARIA dialogs following canonical shell contract (`fixed inset-0 z-[var(--z-modal-fullscreen)]`, `role="dialog"`, `aria-modal`, `aria-labelledby` → `<h2>`, `autoFocus` on close, Escape key dismiss). `ClientActionDetailModal` has four typed payload renderers (internal_link, redirect_proposal, keyword_strategy, aeo_change) + default JSON fallback. `safeHref()` helper for XSS-safe URL rendering. pr-check rule `inbox-legacy-filter-literal` prevents re-introduction of retired filter literals. |
| 2026-05-11 | **InboxTab Phase 3.5 — Action Playbooks Resolution** (client-inbox-phase35-action-playbooks-resolution): Closes the approval dead-end. Client approves an action → admin team notified via `action_approved` email event. `content_decay` actions auto-create a content brief via `ACTION_PLAYBOOK_EXECUTE` background job and transition to `completed`. Other action types (aeo_change, internal_link, keyword_strategy, redirect_proposal) surface in admin UI with "Awaiting implementation" badge (`bg-amber-500/10 text-amber-400 border-amber-500/20`) and teal "Mark complete" CTA button (`bg-teal-600 hover:bg-teal-500`). Badge styling follows Law 2 (amber for warning/pending state), button follows Law 1 (teal for action CTAs). `ClientActionsTab.tsx` renders approved actions with inline approval acknowledgment and action metadata. |
| 2026-05-16 | **Styleguide migration audit cleanup**: Parallel audit pass removed duplicate embedded page headers in client tabs and PageSpeed, tokenized SectionCard's signature radius, aligned StatCard to `.t-stat*` utilities, and corrected drifted hue usage. Schema/editor actions now use teal, read-only progress/data metrics use blue, saved states use emerald, schema role badges stay within approved hue families, and stale styleguide enforcement copy now matches current pr-check behavior. |
| 2026-05-16 | **Full styleguide migration ratchet**: Migrated all visible raw form controls to shared form primitives, added buffered `commitOnBlur` support for editor-style inputs, cleared static styleguide note/radius advisory debt, and promoted raw-form/static-styleguide drift to blocking pr-check rules with fixture coverage. Native hidden/file/color inputs remain allowed exceptions. |
| 2026-06-02 | **Unified Inbox Work-Order Track Lane (R5)** (`unified-inbox`, dark): new read-only "Work in progress" section in `UnifiedInbox.tsx` for `kind:'order'` work orders. Status chip colors follow the Four Laws (mirrors the legacy `OrderStatus.tsx` STATUS_BADGE): **amber** `ordered` (`text-accent-warning bg-amber-500/10 border-amber-500/20`, `Clock`), **blue** `in_progress` (`text-accent-info bg-blue-500/10 border-blue-500/20`, `Loader2` + `animate-spin`), **emerald** `completed` (`text-accent-success bg-emerald-500/10 border-emerald-500/20`, `CheckCircle2`). NEVER teal for the chip (teal = actions; the track lane has no action). The `OrderTrackStepper` (canonical steps `ordered → in_progress → completed`, skipped for `completed`) keeps teal on the completed-step dots/connectors to mark completed PROGRESS — a data affordance consistent with the legacy `OrderStatus` stepper. The card wires ZERO decision verbs (read/track only). |
| 2026-06-02 | **Work-Order Conversation + Close Panel** (`feat/work-order-conversation-close`): no new tokens or hues. **Admin** `WorkOrderPanel.tsx` (PRODUCTION) is a focused full-screen modal following the canonical shell contract (`fixed inset-0 z-[var(--z-modal-fullscreen)]`, `role="dialog"`, `aria-modal`, `aria-labelledby` → `<h2>`, `autoFocus` on close, Escape dismiss). It is an admin work-order surface, NOT an AI feature → **no purple**: status chips use the Four Laws (`in_progress`=amber, `completed`=emerald, `closed`=blue, `cancelled`=red, `pending`=zinc surface), the team-reply `Send` is the teal primary `Button` (Law 1), and the destructive "Close out" uses the `ConfirmDialog` `variant="destructive"`. **Client** conversation thread (DARK behind `unified-inbox`, inside the "Work in progress" `WorkOrderTrackCard`): message bubbles align the client's own messages right with a teal tint (`bg-teal-500/10 border-teal-500/30`) and the team's left on `--surface-3`/`--surface-2`; the comment `textarea` + teal `Send` are the ONLY interactive elements (the lane stays verb-free — no approve/decline/apply). No purple in any client component (verified via `grep -rn "purple-|violet|indigo" src/components/client/` — clean). |
| 2026-06-02 | **Unified Inbox Finalize UX** (`unified-inbox`, dark): no new tokens or hues — reuses existing primitives + Four Laws colors. New `InlineApprovalCard.tsx` (mounted only from `UnifiedInbox`) renders the approval family inline using the same card grammar as `DecisionCard`/`ApprovalBatchCard` (`bg-[var(--surface-2)]` + `--radius-signature-lg` with the per-site `pr-check-disable-next-line` brand-radius hatch) and the shared presentational `ItemDiffRow`; teal Approve CTA (Law 1), no purple (verified via `grep -rn "purple-|violet|indigo"` — clean). `ItemDiffRow` gained an additive `expandable` prop: when on, long `field:'schema'` values get a teal "Show full ↓ / Show less ↑" toggle that swaps `line-clamp-2` for `overflow-y-auto max-h-[200px] font-mono` (mirrors the legacy schema preview, 200px); default off keeps the existing 2-line clamp byte-identical. `DeliverableDetailModal` schema_plan branch renders read-only page-roles + canonical-entity chips mirroring `SchemaReviewTab` (accent-brand mono `@type`, no new colors). `ProjectedReviewModal` solo panel narrowed `max-w-5xl` → `max-w-3xl` (single-item review removes the wide pipeline chrome; matches `DeliverableDetailModal`). Failed inbox fetch now renders the shared `ErrorState` (Law 4 empathetic + Retry) instead of the green all-caught-up empty state. |
| 2026-06-02 | **Unified Inbox UX Batch** (`unified-inbox`, dark): no new tokens or hues. **Centered review-modal pattern** — `DeliverableDetailModal`, `ProjectedReviewModal`, and the new `SubmitRequestChooserModal` all use a centered dialog shell instead of full-bleed: outer `fixed inset-0 z-[var(--z-modal-fullscreen)] flex items-center justify-center p-4`, backdrop `bg-[var(--brand-overlay)] backdrop-blur-sm` (SG-3, replaces raw `bg-black/80`), panel `relative z-[var(--z-sticky)] flex flex-col w-[90vw] sm:w-[75vw] max-w-[1200px] max-h-[90vh] bg-[var(--surface-1)] shadow-2xl overflow-hidden rounded-[var(--radius-xl)]` (the inline bottom-only radius is dropped). Backdrop-click + Escape (with the `isContentEditable` guard) unchanged. The legacy `DecisionDetailModal`/`SchemaReviewModal`/`ClientActionDetailModal` full-screen takeovers are deliberately NOT changed. **Submit-a-request** — a teal primary `Button` (`icon={Plus}`, "Submit a request", Law 1) at the top of `UnifiedInbox` opens the chooser (two `variant="secondary"` option cards: Sparkles "Ask for content" + MessageSquare "Send a request", both with `text-accent-brand` icons). **SG-1**: the Ready-to-publish "Approved" pill → `<StatusBadge domain="approval" status="approved" />` (emerald success, was neutral zinc). **SG-2**: the client's own work-order chat bubble → `bg-blue-500/10 border-blue-500/30` (client context = data per Law 2; was teal). **Edit-before-approve** — `ItemDiffRow` Proposed cell gains an inline "Edit" (Pencil icon, teal "Save edit", `text-accent-info "· edited"` marker) for `seoTitle`/`seoDescription` only, behind the non-free tier; teal/blue only, no new hues. **Polish** — `ItemDiffRow` diff grid `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`; per-item Flag toggle `aria-pressed`; one canonical approve CTA "Looks good — implement N →" (`approveCtaLabel()`); the actionable section gained a visible `t-label` "Decisions" heading + muted subtitle (shared `SectionHeading`), reconciling the PriorityStrip chip vocab with the section it scrolls to. The extracted `SubmitRequestForm` keeps `RequestsTab` byte-identical. No purple (verified clean). |
| 2026-06-08 | **Keyword value dollarization docs sync**: documented the recent Growth+ keyword value surfaces. Value reasons remain muted prose with blue accents for read-only CPC/volume data (Law 2). Per-keyword realized value, upside potential, and ROI Dashboard "Revenue at stake" use emerald for positive outcome value (Law 3). No new hues or tokens. |
| 2026-06-11 | **Client outcome scorecard + wins ledger on Overview (core-features E5)**: no new tokens or hues. `OutcomeSummary` ("Your results") and `WinsSurface` ("What we shipped") now mount on the legacy client Overview, each in an `ErrorBoundary`, tier passed as `(betaMode ? 'premium' : ws.tier) \|\| 'free'`. Win-rate stats use emerald/amber/red bands; gating via `<TierGate>` (Law 1 teal CTAs come from the gate itself). New attributed-dollar-value line in admin `OutcomeTopWins` and client `WinsSurface` uses `text-accent-info` — realized $ attribution is a data metric (Law 2), not a success badge. No purple in client components (grep verified). |
| 2026-06-11 | **Client Dashboard QW2 PR2 — Analytics takeaway**: no new tokens or hues. `AnalyticsTab` now includes a deterministic takeaway section and tracked-action conversion-rate badges use judgment bands: emerald ≥5%, amber 2-4.9%, red <2%. Conversion rates are already percentages; counts remain neutral/read-only data text. |
| 2026-06-11 | **Client Dashboard QW2 PR3 — Workflow confirmations**: no new tokens or hues. Unified inbox approval toasts reuse the existing client toast shell. Content Plan flagging reuses the existing amber flagged-cell state and success/error toast colors; the plan-list review shortcut is a sibling button beside the row selector, avoiding nested interactive controls while preserving the blue data badge. |
| 2026-06-11 | **Client Dashboard QW2 PR4 — ROI methodology explainer**: no new tokens or hues. `ROIDashboard` now includes an expandable methodology disclosure. The trigger uses teal as an interactive affordance, the informational shell uses blue, and the dollar metrics keep existing emerald/data coloring. |
| 2026-06-11 | **Client Dashboard QW2 PR5 — Composite health breakdown**: no new tokens or hues. `HealthScoreCard` now includes an expandable component breakdown inside the existing card. The disclosure trigger uses teal as the interactive affordance, component score text/bars use `scoreColor()`/`scoreColorClass()` judgment bands, and component weights use blue as read-only data. No client-facing purple. |
| 2026-06-11 | **Client Dashboard QW2 PR6 — Work-order comment-count badges**: no new tokens or hues. `UnifiedInbox` work-order cards use the canonical blue `Badge` for conversation counts because counts are read-only data; the existing teal `Send` button remains the only action in the thread. No client-facing purple. |
| 2026-06-11 | **Client Dashboard QW2 PR7 — Strategy feedback stories**: no new tokens or hues. `StrategyKeywordFeedbackSummaryCard` uses blue for keyword approve-rate data, samples, and progress because it is read-only feedback history. `PredictionShowcaseCard` uses emerald for recorded strong wins, blue for other recorded outcomes, and muted metadata for page/date context. No client-facing purple. |
| 2026-06-24 | **Content-briefs send CTAs cyan→teal (Law 1, admin-surface-audit §5)**: no new tokens or hues. Re-skinned the content-briefs action CTAs off cyan to teal — `RequestList` "Send to client" / "Resubmit to client" / "Send post to client" and `BriefDetail`'s standalone "Send brief to client". Cyan is reserved for navigational-intent badges/social data, not action CTAs (Law 1: teal for actions). Status-indicator cyan on the `client_review`/`post_review` status labels is intentionally untouched here — it belongs to the separate StatusBadge-registry adoption item. Canonical lowercase "Send to client" casing applied; both brief send paths gained the Admin Send Convention optional inline note (teal-accented note panel). |
| 2026-06-29 | **Local Presence IA shell**: no new tokens or hues. Visible admin nav group label changed from "SEO STRATEGY" to "STRATEGY" while keeping the internal group key. New `LocalPresencePage` uses `PageHeader`, `TabBar`, `SectionCard`, `StatCard`, `Badge`, and `Button`; teal remains the tab/action hue, blue is used for read-only local visibility and GBP/review aggregate data, emerald for successful posture/readiness, and zinc for Phase 1/admin-only metadata. |
| 2026-06-29 | **Google Business Profile Phase 2A connection UI**: no new tokens or hues. `GbpConnectionCard`, `GbpMappingStatusBlock`, and `GbpLocationMappingPanel` use teal for connect/sync/save/open actions, blue for read-only discovered account/location counts, emerald for connected/mapped success states, amber for reconnect-needed or connected-but-unmapped attention states, red for save/update errors, and zinc for disconnected/neutral structure. The UI remains admin-only and uses existing `SectionCard`, `Badge`, `Button`, `FormSelect`, and `Icon` primitives. |
| 2026-06-29 | **Google Business Profile Phase 2B reviews UI**: no new tokens or hues. `GbpAuthenticatedReviewsPanel` uses teal for the manual sync action, blue for read-only review counts/averages/newest dates, emerald for synced/healthy states, amber for partial/not-synced/attention states, red for failed sync errors, and zinc for admin-only policy/context copy. The panel remains admin-only, mounted in Local Presence Reviews behind `gbp-auth-reviews`, and uses existing `SectionCard`, `StatCard`, `Badge`, `Button`, and `EmptyState` primitives. |
| 2026-07-06 | **UI Rebuild Keywords pilot**: no new hues. The rebuilt Keywords surface uses teal for Add / bulk / lifecycle / retry actions, blue for read-only rank/traffic/count/SERP data, emerald for winning/value/success states, amber for warnings/protection, red only for destructive/error states, and `IntentTag`'s canonical intent map (`local` never purple). Existing `Toast` was restyled tokens-only instead of adding a second toast primitive. `EmptyState` now accepts DS `<Icon name>` adapters so rebuilt surfaces can avoid direct lucide imports. |
| 2026-07-09 | **UI Rebuild typography calibration**: no new tokens or hues. Restored the live `.t-*` utility font sizes in `src/index.css` and `public/styleguide.css` to the existing token/documented scale: `.t-stat-lg` 34px, `.t-stat` 24px, `.t-stat-sm` 18px, `.t-page`/`.t-body` 15.5px, `.t-ui`/`.t-caption`/`.t-caption-sm` 13.5px, and `.t-label` 11.5px. Added a contract test so `.t-*` sizes cannot drift below token authority again. |
| 2026-07-09 | **UI Rebuild shared shell typography role calibration**: no new tokens or hues. Rebuilt shell navigation and breadcrumbs now use the existing styleguide roles instead of raw compact sizes: `NavGroup` headers use `.t-label`, `NavItem` and `RebuiltBreadcrumb` text use `.t-ui`, nav badge/meta text uses `.t-mono`, and Cockpit stream-card descriptions use `.t-body`. |
| 2026-07-09 | **UI Rebuild sidebar prototype-zone alignment**: no new tokens or hues. Under the flag-gated rebuilt shell, `RebuiltSidebar` now uses prototype presentation zones instead of production registry groups: Cockpit/Insights, Strategy & Content, Search & Site Health, Optimization, Client-facing, and Admin. Route ids and global `NAV_REGISTRY` semantics stay intact; sidebar-only labels map Home→Cockpit, Strategy→Insights Engine, Keyword Hub→Keywords, Pipeline→Content Pipeline, and Assets→Asset Manager. Competitors is surfaced as a rebuilt-sidebar-only item in Strategy & Content. Optimization uses teal rather than prototype purple to preserve the Four Laws. |
| 2026-07-09 | **UI Rebuild Competitors alert-feed parity polish**: no new tokens or hues. Competitor alerts now use a prototype-style `SectionCard` feed instead of a generic alert table: competitor domains use `.t-body`, keywords use `.t-ui`, movement/date metadata uses `.t-caption-sm`, competitor accents stay orange, position/volume data stays blue, and severity remains on red/amber/emerald badges. |
| 2026-07-09 | **UI Rebuild Page Rewriter typography role cleanup**: no new tokens or hues. The capability-risk Focus/write-spine decisions remain owner-gated, but the current export-only two-pane workspace now uses `.t-body` for assistant guidance, generated rewrite copy, document body text, and export status explanation; `.t-ui` for page picker paths, document controls, live-page/export status labels, and loading copy; captions remain on secondary page titles and compact badges. |
| 2026-07-09 | **UI Rebuild Cockpit typography role cleanup**: no new tokens or hues. The calibration Cockpit path and shared CO primitives now map prototype compact typography onto existing roles instead of raw pixel text classes: stream counts use `.t-h1`, evidence rail labels use `.t-ui`, client-thread messages use `.t-body`, compact metadata stays `.t-caption-sm`/`.t-caption`, and funnel counts use `.t-stat-sm`. |
| 2026-07-09 | **UI Rebuild Search & Traffic typography role cleanup**: no new tokens or hues. The rebuilt analytics report keeps the owner-gated Overview IA unchanged, but report-window controls, table counts, Keyword Hub actions, and Traffic source labels now use `.t-ui`; Demand mix explanation and collapsed conversion context use `.t-body`. |
| 2026-07-09 | **UI Rebuild SEO Editor typography role cleanup**: no new tokens or hues. The owner-gated workbench/review-queue IA remains unchanged, but worksheet counts and primary page/SEO values now use `.t-ui`; secondary table summaries use `.t-caption`; research and drawer guidance uses `.t-body`; field labels use `.t-label`. |
| 2026-07-09 | **UI Rebuild Site Audit typography/proof framing cleanup**: no new tokens or hues. The owner-gated diagnostic-lens IA remains unchanged, but audit score context, schedule guidance, drawer recommendations, affected-page labels, and proof framing now use `.t-body`/`.t-ui` roles instead of caption-only sizing; category data accents for index/link findings use blue instead of action teal; the audit table gains an emerald proof footer. |
| 2026-07-09 | **UI Rebuild Insights Engine trust-spine preview**: no new tokens or hues. The owner-gated single-spine IA remains unchanged, but the current spine lens now includes the prototype's client trust-spine preview using existing DS roles: `.t-label` for preview eyebrow, `.t-page` for the client verdict, `.t-body` for proof copy, `MetricTile` / `.t-stat` for value/progress numerals, teal for active/send state, blue for read-only with-client/progress data, and emerald for proof framing. |
| 2026-07-09 | **UI Rebuild Insights Engine single-spine and visual circle-back**: no new tokens or hues. The accepted `ODP-001 A` correction removes visible top-level Engine lenses and uses `?lens=` as anchored section focus/open state. The calibrated composition now uses the 1180px page spine, a compact `.t-label` client eyebrow, `.t-h1` operator verdict, hero `StatCard` / `.t-stat-lg` plus teal measured-value framing for value at stake, blue read-only counts, `.t-body` explanations, icon-chip `SectionCard` headers, a truthfully proportional 34px four-group allocation bar, four-row initial Signals disclosure, one-row-per-archetype initial Backing moves disclosure whose actions stay stacked through intermediate widths, one staged-and-sendable projection `SectionCard`, and canonical `Disclosure` for operational tools. Unsendable rows do not present a teal Stage action, and mixed bulk staging reports the actionable subset. Move detail is evidence-only for every recommendation type, including cannibalization, so lifecycle and keeper-write actions retain one home under the queue or Operations. The client trust preview scopes the existing `.dashboard-light` token set locally to distinguish portal output and keeps three proof metrics on one horizontal row; this reuses the existing theme authority rather than introducing preview-only colors. `CommandCenterVerdict` supports an icon-free prototype treatment while preserving its default icon; no new reusable token or hue was introduced. |
| 2026-07-09 | **UI Rebuild Content Pipeline published proof queue**: no new tokens or hues. The owner-gated lifecycle-board IA remains unchanged, but Published mode now carries a prototype-style proof queue using `GroupBlock`, emerald for measured win/readback framing, blue for read-only readback counts, and `.t-body` for the Insights Engine graduation explanation. |
| 2026-07-09 | **UI Rebuild Local Presence rank/profile typography role cleanup**: no new tokens or hues. The capability-gated geo-grid and GBP Performance data remain owner decisions, but the current real-data Rank & profile workspace now uses `.t-body` for market setup, GBP aggregate, empty-state, and trend explanations; `.t-ui` for competitor/market/suggested-keyword labels and share-of-voice values; and blue for read-only snapshot counts instead of teal action color. |
| 2026-07-09 | **UI Rebuild Asset Manager source-fix proof framing**: no new tokens or hues. The owner-gated single-workshop IA remains unchanged, but the current Browse lens now carries the prototype's source-fix and measured-proof framing using existing `InlineBanner` treatment, `.t-body` explanatory copy, blue info framing for Webflow/CMS source repair, and emerald proof framing for Core Web Vitals/page-speed wins graduating into Insights Engine. |
| 2026-07-09 | **UI Rebuild Keyword Hub typography role cleanup**: no new tokens or hues. The aligned-enough five-lens Keyword Hub keeps deferred sparkline/KPI read models untouched, but client feedback labels now use `.t-ui`, feedback reasons and measurement disclosures use `.t-body`, and drawer SERP/local proof copy uses `.t-ui` / `.t-body` so evidence and client direction no longer read as caption-only metadata. |
| 2026-07-09 | **UI Rebuild Schema workflow typography role cleanup**: no new tokens or hues. The aligned-enough Schema generator keeps the current Generator / Workflow Guide modes and Drawer detail, but workflow phase explanations, pipeline safeguards, client handoff, measurement copy, drawer JSON-LD guidance, drawer publish/send guidance, and empty setup instructions now use `.t-body`; guide action and safeguard rows use `.t-ui`. |
| 2026-07-09 | **UI Rebuild Performance detect/repair typography role cleanup**: no new tokens or hues. The aligned-enough Performance surface keeps the current Page Weight / Page Speed modes and Drawer detail, but Page Weight stale/repair guidance, Page Weight drawer compression context, PageSpeed score context, bulk-test guidance, and Asset Manager repair handoff copy now use `.t-body` so speed-routing guidance no longer reads as caption metadata. |
| 2026-07-09 | **UI Rebuild Links workshop typography role cleanup**: no new tokens or hues. The aligned-enough Links workshop keeps the current Redirects / Internal Links / Dead Links / Architecture modes and the owner-gated row-level Insert decision untouched, but redirect apply guidance, internal-link implementation guidance, dead-link repair guidance, architecture next steps/gap explanations, and the measured-outcome footer now use `.t-body` so workflow copy no longer reads as crawl metadata. |
| 2026-07-09 | **UI Rebuild Wave 2 behavior-first parity corrections**: no new tokens, hues, or reusable primitives. Content Pipeline composes the existing `BoardColumn` / `BoardCard` grammar into an aggregate lifecycle Board, uses blue for read-only Intake counts and amber for waiting Review work, and keeps teal on launch actions. SEO Editor uses `GroupBlock` to separate Static, CMS, and Manual source authority while preserving one shared action region. Site Audit reduces peer modes to Site Audit / History and re-homes diagnostic evidence in the canonical `Disclosure` primitive. Existing typography roles, overlay shells, and Four Laws remain authoritative. |
| 2026-07-09 | **UI Rebuild Wave 3 workshop and focus corrections**: no new tokens, hues, or reusable visual primitives. Search & Traffic uses the existing report `LensSwitcher` with Search Performance as the default and keeps cross-source evidence in a lower report band. Page Rewriter consumes the shared `AppShell` focus state rather than creating new chrome. Asset Manager keeps Browse as one workshop, uses a secondary Repair results command plus a teal primary Upload action, mounts Audit in-flow, and mounts Upload in the canonical `Drawer`; read-only counts and estimates remain blue. Performance and Site Audit use canonical filter-only repair links. Final portfolio cleanup also leaves Cockpit compatibility filters unselected in the primary card control, removes unsupported Global Ops portfolio stats, and deduplicates the Local Presence KPI row without introducing a new pattern. |
| 2026-07-09 | **UI Rebuild PageHeader hierarchy pilot**: adds the opt-in `variant="rebuilt-admin"` visual pattern without changing the default primitive. The variant keeps semantic `h2`, maps page titles to `.t-h1`, maps page context to `.t-body`, and allows copy/actions to wrap. Performance is the sole pilot; broader migration remains gated on prototype comparison. No new token or hue was introduced. |
| 2026-07-10 | **Owner-approved Insights Engine composition**: no new token, hue, or shared DS primitive. The primary spine uses one compact narrated POV card and opens the existing complete editor in the canonical `Drawer`; Engine-level actions portal exact-once into the rebuilt shell topbar while isolated mounts use an explicit inline fallback; compact move rows keep Details and Stage/Unstage inline and disclose Edit/Fix/Park through the accessible `Popover`. Curation and Needs Attention share one compact support row immediately above Backing moves. Truthful live preview height/content, production-only provider evidence plus collapsed Operations, and the Lost visibility backend read gap are explicit surface exceptions approved under `ODP-001-V4` through `V6`; they do not create reusable design-system exceptions. |
| 2026-07-10 | **Owner-approved Brand & AI composition**: the grouped cockpit and modal-first workflow reuse the existing color and type roles; purple remains limited to admin-AI accents, read-only configured evidence stays blue/neutral, and actions stay teal. The surface reports truthful configured-input evidence instead of an inferred readiness score, distributes all 17 generators once across the source groups, and keeps production editors/actions honest. The closest existing `t-ui` role at 13.5px/700 is the approved rail-title exception. The sole shared DS extension is `Modal size="workflow"` at 42.5rem / 680px; it is a compact editor/workflow shell, not a new token or hue. |

> **Golden rule**: Teal for actions, blue for data, emerald for success, purple for admin AI, zinc for structure. When in doubt, check the decision tree above.

### Workspace Settings — Integration Health Center (May 2026)
- `ConnectionsTab` now includes an **Integration Health Center** card.
- **Blue** remains the data/observability hue for the module icon and quota-detail chips (`bg-blue-500/10 text-blue-400`).
- Integration state badges follow semantic status mapping: **emerald** (`configured/healthy`), **amber** (`degraded`), **red** (`missing/error`).
- No purple usage; the surface is admin operational telemetry, not admin AI interaction.

### ContentCalendar (W6.6 planning semantics)
- `kind: 'planned'` items: `bg-teal-500/15 text-accent-brand border border-teal-500/30 border-dashed` — teal = scheduling intent (actionable), dashed = intent-not-outcome
- `kind: 'published'` items: existing solid post treatment
- `kind: 'created'` items: muted fallback
- "Planned" badge: `<Badge tone="teal">`; schedule-a-draft + suggest-dates controls: soft teal CTA (`bg-teal-500/10 text-accent-brand hover:bg-teal-500/20`)

### Health Tab purchase surface (Client Revenue R1)
- "Fix this — $X" CTA: teal Button (Law 1); "In cart" state chip: soft teal outline span (hatched one-off)
- Impact lines: blue data text (Law 2) with conservative ranges + (i) methodology popover (ROI pattern)
- Sticky cart summary: `--z-sticky`, teal accents for actions, fmtMoneyFull for all currency
- Premium / external-billing variants render zero prices — hours-covered / included-in-service framing

### Client Revenue R2 surfaces
- AgencyWorkFeed: teal live-pulse dot (`--radius-pill`), narrative activity labels, job progress in blue
- CompetitorGapsSection: Premium chip in teal (confirmed-access, never amber); banded chips only
- StrategyPageRankStoriesSection: ranked chips blue (data), gap chips amber/10 pill ("worth adding" = attention semantics)
- Cart content items: strikethrough original + discounted price for Premium (MONETIZATION §261 pattern)

### The Issue — TrustLadderPanel (Phase 4, June 2026)
- `src/components/strategy/issue/TrustLadderPanel.tsx` — operator-facing trust ladder, admin-only (mounted inside `KeywordStrategy.tsx` issueOverviewEl after `BackingMovesQueue`, theIssueEnabled-gated). No purple, no TierGate.
- `<SectionCard title="Trust ladder">` with `ShieldCheck` titleIcon (`text-accent-brand`). One row per auto-send-eligible archetype (quick_win, technical).
- Each row uses the shared `<Toggle>` (Law 1 — teal track `--brand-mint` when on). The toggle is **disabled until the archetype is `earned`** (`disabled={!row.earned || isUpdating}`) — disabled-until-earned reuses Toggle's built-in `opacity-50 cursor-not-allowed`; the toggle is the reward for 3 consecutive cycles.
- Progress/state caption is `t-caption-sm`: `--brand-text-muted` while building (`{n}/{threshold} cycles`), `--brand-text` once earned ("Auto-sends each cycle" / "Ready — flip on to automate"). Rows separated by `divide-y divide-[var(--brand-border)]`.

### The Issue — Four-jobs lenses (Phase 5, June 2026)
- `src/components/strategy/issue/KeywordTargetsLens.tsx` + `ContentWorkOrderLens.tsx` — two operator-facing, admin-only read-projections of the curated rec set (mounted in `KeywordStrategy.tsx` issueOverviewEl after `TrustLadderPanel`, theIssueEnabled-gated). No purple, no TierGate.
- Both are `<SectionCard>` ("Keyword targets" / "Content work-orders") with a `text-accent-brand` titleIcon (`Target` / `ClipboardList`) and a leading `t-caption-sm text-[var(--brand-text-muted)]` subtitle. One row per item, `divide-y divide-[var(--brand-border)]`; row title `t-ui font-medium text-[var(--brand-text-bright)]`, sub-label `t-caption-sm text-[var(--brand-text-muted)]`. Empty states use `<EmptyState>` (action-oriented copy). Each row's action is the shared `<Button variant="link" size="sm">` (Law 1 — teal `--teal` text link) deep-linking into the Keyword Hub (`?q=`) / content pipeline (`?tab=briefs|posts`); a keyword target with no resolvable `deepLinkKeyword` renders a muted "No keyword link" span instead.
- **Keyword Targets** sent/proposed badge: `<Badge>` `teal` ("In front of client", curated to client) vs `zinc` ("Proposed", merely active) — teal=action/client-facing, zinc=neutral.
- **Content work-order stage badge** (`ContentWorkOrderStage` → `<Badge tone>` `soft`): `not_started`→`zinc`, `queued`→`blue` (data/queued, read-only), `in_progress`→`teal` (active work), `awaiting_client`→`amber` (warning/blocked-on-client), `changes_requested`→`orange` (changes-requested status color), `approved`→`emerald`, `completed`→`emerald` (success), `declined`→`red` (error). Follows the status-badge palette (green/emerald=success, amber=warning, orange=changes-requested, red=error, blue=info/data, teal=in-progress/client-facing).

### The Issue — Operator steering (§11/§12, June 2026)
Three operator-facing, admin-only curation verbs, all theIssueEnabled-gated (byte-identical OFF). No purple, no TierGate.
- **Inline rec-wording editor** (`src/components/strategy/CockpitRow.tsx`) — an OPTIONAL `onEditWording` prop adds a `Pencil` `<IconButton>` (`variant="ghost"`) to the row's idle action cluster (before "Send to client"). Toggling it reveals an inline editor panel — `bg-[var(--surface-1)]` inset (one tier below the row's `--surface-2`, so the `--surface-3` `FormInput`/`FormTextarea` controls read as nested) with a `--brand-border`, `--radius-lg`. Title via `<FormInput commitOnBlur>` (cap `REC_WORDING_TITLE_MAX`=160), insight via `<FormTextarea commitOnBlur rows={3}>` (cap `REC_WORDING_INSIGHT_MAX`=600); field labels are `t-label text-[var(--brand-text-muted)] uppercase`. When the prop is ABSENT (flag-OFF / command-center / StrategyCockpit consumers) the row renders byte-identically — no pencil, no editor.
- **Cockpit row parking** (`src/components/strategy/CockpitRow.tsx`) — the recommendation row exposes the defer/strike chooser as an explicit secondary `<Button icon={Clock}>` labelled "Park", not an unlabeled overflow affordance. "Park" opens the existing throttle picker (7/30/90 days) plus "Strike instead"; staged rows show "Unstage" as the active toggle state so the operator can reverse staging without decoding a passive "Staged" label.
- **Add-a-recommendation modal** (`src/components/strategy/issue/AddRecommendationModal.tsx`) — ConfirmDialog-style overlay (`z-[var(--z-modal)]`, `--brand-overlay` scrim, `bg-[var(--surface-2)]` panel, `--radius-xl`). Mounted in `KeywordStrategy.tsx` issueOverviewEl; opened by a `<Button variant="secondary" icon={Plus}>` "Add a recommendation" above `BackingMovesQueue`. Body composes `<FormField>` + `FormSelect` (type = `MANUAL_REC_ALLOWED_TYPES`, human labels), `FormInput` (title, required), `FormTextarea` (insight, required), `FormSelect` (priority, default `fix_soon`), optional `FormInput` (target keyword). Primary `<Button variant="primary">` "Add recommendation" (Law 1 teal), `loading` while pending, disabled until title+insight non-empty.
- **Client running order panel** (`src/components/strategy/issue/ClientRunningOrder.tsx`) — `<SectionCard title="Client running order">` with `ListOrdered` titleIcon (`text-accent-brand`), mounted after `BackingMovesQueue`. Lists only the curated/sent recs (`clientStatus` ∈ {sent, approved, discussing} AND not struck) as an `<ol>`; each `<li>` is a `bg-[var(--surface-2)]` row (`--radius-lg`, `--brand-border`) with a tabular-nums position index (`t-caption-sm text-[var(--brand-text-muted)]`), the rec title (`t-ui text-[var(--brand-text)]` truncated), and `ChevronUp`/`ChevronDown` ghost `<IconButton>`s (first row's up + last row's down disabled). `<EmptyState icon={ListOrdered}>` ("Nothing sent yet") when none are in front of the client.

### The Issue (Client) — P1b admin readiness + named-leads (Lane B, June 2026)
Two operator-facing, admin-only panels mounted in `KeywordStrategy.tsx` issueOverviewEl, gated on `the-issue-client-measured-capture` (byte-identical OFF — not mounted). No purple, no TierGate.
- **Setup-readiness checklist** (`src/components/strategy/issue/IssueSetupReadiness.tsx`) — mounted SLOT-0, above `IssueHeader` (config chrome the operator sees first). Tagged `data-p1b-readiness` (flag-OFF DOM-probe hook). An "N steps left" headline badge: AMBER (`bg-amber-500/10 text-amber-400 border-amber-500/20`, warning) when gaps remain, EMERALD ("Setup complete", success) at zero gaps. It RE-MOUNTS the reusable `ConversionTrackingReadout` (no rewrite) for the integrity rows + Measured/Estimate provenance pill (teal when measured) + the step list.
- **Deep-linkable setup steps** (`ConversionSetupStep.onClick`, additive in `ConversionTrackingReadout.tsx`) — an incomplete step WITH an `onClick` renders as a `<ClickableRow>` (shared primitive — never a raw `<button>`); the label hover-steps `--brand-text → --brand-text-bright` (hover-must-step rule) with a trailing `ArrowRight`. Absent `onClick` (the P1a Settings consumer) → today's static `<div>` row, byte-identical. Each open gate deep-links to its fix surface honoring the `?tab=` two-halves contract: GA4 → `workspace-settings?tab=connections`; value / segment / events / Webflow forms → `?tab=dashboard`; POV → no deep-link (edited on the cockpit).
- **Captured-leads readout** (`src/components/strategy/issue/AdminLeadsReadout.tsx`) — mounted inside the collapsed "Supporting detail" `<details>` (progressive disclosure). `<SectionCard noPadding>` "Captured leads"; the count badge uses the unbounded `total` and is BLUE (`bg-blue-500/10 text-blue-400 border-blue-500/20` — Law 2, data not actionable, never teal). Per-lead rows: `leadName` (`--brand-text-bright`, em-dash when null), `leadEmail` (`t-caption-sm` WITH explicit `text-[var(--brand-text-muted)]` — `t-caption-sm` has no color), a BLUE read-only lead-type chip, `formName` + `timeAgo(submittedAt)`. Empty → `<EmptyState icon={Users}>` with a TEAL-equivalent secondary `<Button>` CTA "Connect a Webflow form" (Law 1, action). PII (name/email) is admin-only — this is the `requireWorkspaceAccess` surface (D7: the guard, not the shape, enforces the boundary).

### Design cleanup sprint — new primitives + gradient/color normalization (2026-06-30)
Five shared primitives added to `src/components/ui/` (use these before hand-rolling):
- **`NeedsAttention`/`AttentionRow`** — one prioritized worklist with a single severity→token map: `critical`→`text-accent-danger` (red), `warning`→`text-accent-warning` (amber), **`info`→`text-accent-info` (BLUE, never mint)**. Rows are `ClickableRow` (action) or react-router `<Link>` (href → client-side nav). Critical present → red/amber left-accent; count-in-title; two-way "Show N more"/"Show less".
- **`Disclosure`** — canonical `<details>/<summary>` chrome: `--radius-lg` (NOT `--radius-signature`), `--surface-2`, `motion-safe:` chevron rotation, focus-visible ring. For top-level collapsibles; split catch-all drawers into 2–3 grouped Disclosures.
- **`Menu`** — thin `items[]` wrapper over the accessible `Popover` (cloned focusable trigger + `aria-haspopup/expanded`, roving focus, Escape/Tab/outside-click, portal at `--z-dropdown`). Use for flat action dropdowns; `Popover`/`Popover.Item` for custom panels. `useClickOutside(ref, cb, active?)` extracted for simple cases.
- **`SectionLabel`** — the canonical `t-label` uppercase kicker (`text-[var(--brand-text-muted)]`) for TOP-LEVEL page sections. Convention: `SectionLabel` for section dividers; `SectionCard` title bars for cards *within* a section; `<summary>` only inside `Disclosure`. (Currently renders `<p>`.)
- **`StatCard` `tone` prop** + **`cardToneClasses(tone)`** (exported from `StatCard`) — the ONE canonical tinted-gradient card definition: `bg-gradient-to-br from-<tone>-500/8 via-[var(--surface-2)] to-[var(--surface-2)] border-<tone>-500/20` for `tone ∈ teal|emerald|blue|amber` (`neutral` = today's surface, unchanged). Never hand-roll `bg-gradient-to-br from-*-500/*` on a card — use `<StatCard tone>` or `cardToneClasses()`. This normalized the verdict/outcome/ROI/loop-footer shells to one opacity.

**Color-law sweep (Wave 0b):** static counts/labels no longer wear mint (`text-accent-brand`) — data → `text-accent-info` (blue), completed → `text-accent-success` (emerald); mint stays action-only. Purple removed from all data/client surfaces (Law 4). Hardcoded hex → `CHART_SERIES_COLORS` (unmapped/brand/export hexes carry `// chart-hex-ok`). Warning/danger surfaces route through `InlineBanner` / `bg-accent-warning-soft`/`bg-accent-danger-soft` (the soft tokens live in `src/index.css`; warning=amber, danger=red).
