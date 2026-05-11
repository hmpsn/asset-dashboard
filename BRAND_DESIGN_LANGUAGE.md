# hmpsn.studio — Brand & Design Language

> **Canonical reference** for brand identity, color rules, product-design principles, and
> AI prompting guidelines. Governs both the **admin dashboard** and **client dashboard**.
>
> For component specs (StatCard, Badge, MetricRing, etc.) and Tailwind classes, see
> **`DESIGN_SYSTEM.md`**. For the feature inventory, see **`FEATURE_AUDIT.md`**.

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
2. **Blue for data.** Clicks, sessions, impressions, links, info badges, "Needs Review" status, "unsaved" state, progress bars for data metrics — all blue. Blue is read-only, never actionable.
3. **Emerald for success.** `scoreColorClass()` returns `text-emerald-400` for score ≥80; `scoreColor()` hex is `#34d399` (emerald-400). Never `text-green-400` for success/score indicators — green and emerald are distinct hues, emerald is canonical.
4. **Purple for admin AI only.** The admin chatbot (`AdminChat.tsx`) and admin-only AI features (`SeoAudit.tsx` "Flag for Client") use purple to visually distinguish admin intelligence from client-facing teal UI. Purple never appears in any client-facing view.

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
| **Blue** | `#60a5fa` | `#2563eb` | `blue-400`/`blue-600` | Clicks, sessions, links, info badges, "Needs Review", progress bars, commercial intent |
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

| Primitive | File | Key Colors | Notes |
|-----------|------|------------|-------|
| **StatCard** | `StatCard.tsx` | Sparkline default: `#2dd4bf` (teal); value: `text-zinc-100` or passed color | Also exports `CompactStatBar` for inline metric rows |
| **MetricRing** | `MetricRing.tsx` | Auto from `scoreColor()`: ≥80 green, ≥60 amber, <60 red | DIN Pro 700, font size = `0.38 × ring size` |
| **MetricRingSvg** | `MetricRing.tsx` | Same as MetricRing | Smaller inline SVG variant for tight spaces |
| **SectionCard** | `SectionCard.tsx` | `bg-[var(--surface-2)] border-[var(--brand-border)]` | Header row optional; title: `.t-body font-semibold text-[var(--brand-text-bright)]` |
| **ChartCard** | `ChartCard.tsx` | Same as SectionCard (`bg-[var(--surface-2)] border-[var(--brand-border)]`) | Thin SectionCard wrapper for chart-friendly defaults: tighter padding (`px-4 py-3`), `.t-ui` inline title + optional `<TrendBadge>` row, no `border-b` separator. Preserves signature card radius. |
| **TrendBadge** | `TrendBadge.tsx` | Positive: `text-emerald-400` + `TrendingUp`; Negative: `text-red-400` + `TrendingDown`; Zero (when `hideOnZero={false}`): `text-zinc-400` + `Minus` | Canonical directional delta indicator. Props: `value`, `suffix='%'`, `invert`, `showSign`, `label`, `size='sm'\|'md'`, `hideOnZero=true`. Replaces all hand-rolled `TrendingUp/Down + emerald/red` ternaries. Use `invert` when lower=better (positions, error counts). |
| **PageHeader** | `PageHeader.tsx` | Title `.t-h2 text-[var(--brand-text-bright)]`; subtitle `.t-caption-sm text-[var(--brand-text-muted)]` | Title + optional subtitle + action slot |
| **Badge** | `Badge.tsx` | 7 colors: `teal`, `blue`, `emerald`, `amber`, `red`, `orange`, `zinc` | Pattern: `bg-{color}-500/10 text-{color}-400` |
| **TabBar** | `TabBar.tsx` | Active: `border-teal-500 text-teal-200` | Underline style, `border-b-2` |
| **DateRangeSelector** | `DateRangeSelector.tsx` | Active: `bg-zinc-700 text-zinc-200` | Segmented control style |
| **EmptyState** | `EmptyState.tsx` | Icon: `text-zinc-400` in `bg-zinc-800` container | Centered layout with optional CTA |
| **NextStepsCard** | `NextStepsCard.tsx` | Title icon: `text-emerald-400` (success) / `text-blue-400` (info). Step rows: `hover:bg-teal-500/5 group-hover:text-teal-300`. Dismiss: zinc | Completion card after AI operations. Wraps `SectionCard` with `noPadding` + `staggerIndex` passthrough. `success` = green CheckCircle2, `info` = blue Info. Empty steps guard: returns null. |
| **ProgressIndicator** | `ProgressIndicator.tsx` | Progress bar: `bg-blue-500` (data law). Container: `bg-zinc-900 border border-blue-500/20 rounded-xl`. Complete: `text-emerald-400`. Cancel: zinc → `hover:text-red-400` | Unified progress bar. Idle/error → null. Indeterminate: `animate-pulse w-2/3`. Deterministic: `transition-all duration-500`. Auto-fades 3s after complete. `role="progressbar"` with ARIA attrs. |
| **TierGate** | `TierGate.tsx` | Growth: `teal`, Premium: `amber` | Blurred preview + overlay lock. Exports `TierBadge`. `onGateHit` callback (optional) fires when gate blocks access for upsell tracking. |
| **InsightsDigest** | `client/InsightsDigest.tsx` | Green=win, amber=opportunity/warning, red=critical, teal=CTA links | Unified feed: local + server insights merged. Server insights mapped via `SEVERITY_TO_COLOR` + `INSIGHT_TYPE_ACTIONS`. |
| **InsightCards (Tier 2)** | `client/InsightCards.tsx` | CompetitorAlertCard: red/amber severity badge, amber border for critical; EmergingKeywordCard: emerald (rising trend), blue (stable), amber (declining); FreshnessAlertCard: amber staleness badge, blue data metrics | 3 new card types added to the 9-card grid. No purple. All client-facing. OpportunityScore badge: `bg-blue-500/20 text-blue-300` (data law). |
| **MonthlyDigest** | `client/MonthlyDigest.tsx` | Emerald=wins, blue=ROI highlights, teal=pages optimized count | Growth-gated. No purple. |
| **ActionQueue** | `admin/ActionQueue.tsx` | Blue=impact scores (data), teal=resolve CTA (action) | Admin-only. No purple. |
| **DataList** | `DataList.tsx` | Rank: `text-zinc-500`, label: `text-zinc-300`, value: `text-zinc-400` | Optional ranking numbers |
| **OnboardingChecklist** | `ui/OnboardingChecklist.tsx` | Progress bar: `bg-blue-500` (data); checkmarks: `text-teal-400` (action); celebration: `text-teal-400` | Modal overlay. Blue = read-only progress metric. Teal = completion/action state. |
| **WorkflowStepper** | `ui/WorkflowStepper.tsx` | Current: `bg-teal-500/10 border-teal-500 text-teal-400`; Completed: `bg-emerald-500/10 border-emerald-500/40 text-emerald-400`; Future: `bg-zinc-800/50 border-zinc-700 text-zinc-500` | Horizontal step indicator. Emerald = success/done state. Teal = active step. |
| **WorkspaceHealthBar** | `ui/WorkspaceHealthBar.tsx` | Progress bars: `bg-blue-500` (data/read-only); recommendation arrows: `text-teal-500` hover `text-teal-400` (action) | Wraps SectionCard. Blue = data metrics. Teal = actionable next steps. |
| **Heading** | `ui/typography/Heading.tsx` | Inherits `var(--brand-text-bright)`; `level={1\|2\|3}` → `.t-h1` / `.t-h2` / `.t-page` | Phase 5. `as` prop overrides HTML tag. forwardRef. |
| **Stat** | `ui/typography/Stat.tsx` | Inherits text color (caller controls via parent `text-*`); `size="hero"\|"default"\|"sm"` → `.t-stat-lg` / `.t-stat` / `.t-stat-sm` | Phase 5. DIN Pro numerals. forwardRef. |
| **BodyText** | `ui/typography/BodyText.tsx` | `tone="default"` → `var(--brand-text)` (zinc-400); `tone="muted"` → `var(--brand-text-muted)` (zinc-500); `tone="dim"` → `var(--brand-text-dim)` (zinc-600). Tone is the API for color — Tailwind color utilities passed via `className` are overridden by inline tone style. | Phase 5. Renders `.t-body`. forwardRef. |
| **Caption** | `ui/typography/Caption.tsx` | Inherits muted text (`var(--brand-text-muted)`); `size="default"\|"sm"` → `.t-caption` / `.t-caption-sm` | Phase 5. Secondary metadata, timestamps. forwardRef. |
| **Label** | `ui/typography/Label.tsx` | Inherits muted text; uppercase DIN Pro via `.t-label` | Phase 5. Form labels, uppercase section markers. forwardRef. |
| **Mono** | `ui/typography/Mono.tsx` | Fira Code / JetBrains Mono / Menlo. `size="default"\|"micro"` → `.t-mono` (12px) / `.t-micro` (10px). Both monospace. | Phase 5. IDs, slugs, tokens, timestamps. forwardRef. |
| **Icon** | `ui/Icon.tsx` | Inherits `currentColor`; consumer supplies hue via `className` (e.g. `text-teal-400`). Inner SVG `aria-hidden="true"` by default — pass `aria-label` for semantic icons. | Phase 5. Wraps any Lucide component. Strict size enum: `xs\|sm\|md\|lg\|xl\|2xl` (8/12/16/20/24/32px). Inline-flex `<span>` wrapper so it is safe inside `<p>`, `<li>`, flex rows. forwardRef. |
| **FormField** | `ui/forms/FormField.tsx` | Label text: `text-zinc-300`; error message: `text-red-400`; hint: `text-zinc-500`; required asterisk: `text-red-400` | Phase 5. Wraps an input with label + optional error/hint. Generates `useId()` and wires `htmlFor` ↔ child `id` via Context so label clicks focus the input. forwardRef. |
| **FormInput / FormSelect / FormTextarea** | `ui/forms/Form{Input,Select,Textarea}.tsx` | Default border: `border-zinc-700`, focus: `border-[var(--brand-mint)]` + `ring-[var(--brand-mint-glow)]` (Law 01). Error border: `border-red-500/50`. Placeholder: `text-zinc-500`. | Phase 5. Dark-theme inputs, mint focus ring. Consume error state + id from FormFieldContext. FormTextarea shows optional `maxLength` counter (red near limit). forwardRef. |
| **Checkbox** | `ui/forms/Checkbox.tsx` | Checked: `bg-[var(--brand-mint)] border-[var(--brand-mint)]` (Law 01). Unchecked: `bg-zinc-800 border-zinc-700`. Check icon: `text-zinc-900`. | Phase 5. Custom visual checkbox over hidden native input (preserves Space-key + a11y). Required `label` string. forwardRef to input. |
| **Toggle** | `ui/forms/Toggle.tsx` | Track ON: `bg-[var(--brand-mint)]` (Law 01). Track OFF: `bg-zinc-700`. Knob: `bg-white` with translate transition. | Phase 5. `role="switch"` with implicit aria-checked from `checked` attribute. Required `label` string. forwardRef to input. |
| **Button** | `ui/Button.tsx` | Primary: `from-teal-600 to-emerald-600` (Law 1 teal gradient); secondary: `bg-zinc-800`; ghost: transparent; danger: `bg-red-600`; link: `text-teal-400` | 5 variants × 3 sizes (sm/md/lg). Sizes preserve hierarchy: `.t-caption-sm` / `.t-caption` / `.t-body`. Spinner replaces icon while `loading`. `link` variant skips size padding. |
| **IconButton** | `ui/IconButton.tsx` | Ghost: `text-zinc-400 hover:text-zinc-200`; solid: `bg-zinc-800` | Icon-only with required `label` for ARIA. 3 sizes (sm/md/lg), 2 variants (ghost/solid). |
| **ActionPill** | `ui/ActionPill.tsx` | start: teal tint; approve: emerald tint; decline: red tint; send: blue tint; request-changes: amber tint | Compact tinted pill for workflow action buttons. Each variant maps to the status-color family (Law 1/success/error/data/warning). |
| **SegmentedControl** | `ui/SegmentedControl.tsx` | Active: `bg-zinc-700 text-white`; inactive: `text-zinc-400`; container: `bg-zinc-900 border-zinc-800` | WAI-ARIA radiogroup. Roving tabIndex (selected=0, others=-1). Arrow-key navigation (Left/Right + Home/End). Fallback tab stop on first non-disabled option when `value` matches none. 2 sizes (sm/md). |
| **Row** | `ui/layout/Row.tsx` | No color — structural only | `flex flex-row`. Props: `gap` (xs–xl), `align` (start/center/end/baseline, default: center), `justify` (start/center/end/between/around), `wrap` (bool). `forwardRef`. |
| **Stack** | `ui/layout/Stack.tsx` | No color — structural only | `flex flex-col` (or `flex-row` with `dir="row"`). Props: `gap`, `align` (start/center/end/stretch), `dir`. `forwardRef`. |
| **Column** | `ui/layout/Column.tsx` | No color — structural only | Strict `flex flex-col` — never `flex-row`. Convenience alias for vertical stacks. Props: `gap`, `align`, `className`. `forwardRef`. |
| **Grid** | `ui/layout/Grid.tsx` | No color — structural only | Responsive CSS grid. Props: `cols` (`{ sm?, md?, lg?, xl? }` with values 1–12), `gap`. Uses static `Record<number, string>` maps per breakpoint so Tailwind's scanner can detect all class strings. `forwardRef`. |
| **Divider** | `ui/layout/Divider.tsx` | `border-[var(--brand-border)]` | Thin rule. `orientation="horizontal"` (default, `border-b w-full`) or `"vertical"` (`border-r h-full`). Role=separator + aria-orientation. `forwardRef`. |
| **Modal** | `ui/overlay/Modal.tsx` | Panel: `bg-zinc-900 border-zinc-800`; close ×: `text-zinc-400 hover:text-zinc-200`; focus ring: `focus-visible:ring-teal-500` | Compound: `<Modal.Header>`, `<Modal.Body>`, `<Modal.Footer>`. Portals to `document.body`. Focus trap + Escape + backdrop-click to close. Restores focus to trigger on close. Backdrop at `--z-modal-backdrop` (40), panel at `--z-modal` (50). |
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
| Content pipeline review badge | `bg-blue-500/10 text-blue-400` | Info/attention — blue for "needs review" |
| Content request "client" chat bubbles | `bg-blue-500/10 text-blue-300` | Client = blue (read-only context) |
| Clicks metric | `text-blue-400` | Blue = data metric |
| Sessions metric | `text-blue-400` | Blue = data metric |
| Approval batch "applied" badge | `bg-blue-500/10 text-blue-400` | Info state |
| Request status "new" badge | `bg-blue-500/10 text-blue-400` | Info state |
| Informational intent badge | `text-blue-400 bg-blue-500/10` | Intent = info |
| Full Post service badge | `bg-teal-500/10 text-teal-300` | Brand accent (was blue, fixed) |
| Page type badge | `bg-teal-500/10 text-teal-400` | Brand accent |
| Tier badges (all tiers) | `bg-teal-500/15 text-teal-300` (Growth/Premium), `zinc` (Free) | Teal intensity |
| User avatar gradient | `from-teal-500 to-emerald-500` | Brand gradient |
| AI chat FAB + messages | `from-teal-600 to-emerald-600` (FAB), `bg-teal-600/20` (user msg) | Client chat = teal |
| Welcome modal | `from-teal-500 to-emerald-500` icon/glow | Brand accent |
| Payment modal | All teal (header, price, topic, CTA) | Unified teal |

#### Client Insights — Magazine Briefing Layout (`Briefing/`, behind `client-briefing-v2`)

When the `client-briefing-v2` feature flag is on, the client Insights tab swaps to a magazine-rhythm editorial briefing. Layout convention:

| Element | Color | Rationale |
|---------|-------|-----------|
| **Action queue strip** (top) | `bg-amber-500/15 border-amber-500/30 text-amber-300` | Amber = "needs attention" — same hue as the existing inbox banner. Renders null when all 5 counts are zero. |
| Action chip hover | `hover:text-amber-200` | Subtle one-step lift (avoids invisible-hover trap from CLAUDE.md memory) |
| **Hero card** wrapper | `border-l-2 border-teal-400 pl-3` around `<SectionCard>` | Teal-accent left stripe (SectionCard has no built-in accent prop, so use a wrapper div) |
| Hero category label | `t-label text-teal-400 font-semibold tracking-wider` | Teal = brand action / editorial accent |
| Hero headline | `t-h2 font-bold text-[var(--brand-text-bright)]` | Largest type on the page |
| Hero metric pills | `bg-teal-500/10 text-teal-400 rounded-full t-caption inline-flex` | 0–2 per story, max — supporting numbers, not data dump |
| Hero "See the data →" | `t-caption text-teal-400 hover:text-teal-300` | Drill-in link, teal action |
| **Secondary divider rows** | `border-b border-[var(--brand-border)] last:border-b-0 hover:bg-[var(--surface-3)]/50` | No card chrome — plain rows, hover state for affordance |
| Secondary category icon | category-mapped: `win=star/emerald-400`, `risk=alert-triangle/amber-400`, `opportunity=lightbulb/blue-400`, `competitive=search/teal-400`, `period_change=trending-up/blue-400` | Color-codes the category at a glance |
| **Free-tier upgrade CTA** | Same teal-accent wrapper as Hero, solid `bg-teal-500 hover:bg-teal-400` button | NEVER hand-rolled gradient (pr-check enforces) |

**Magazine layout principles** (mirrors the spec's three rules):

1. **No top-of-page health score, no stat row, no banner CTAs** when the flag is on. Numbers appear ONLY as inline metric badges inside the hero card.
2. **Exactly one hero card** per briefing. The Phase 1 Zod schema enforces `isHeadline: true` on exactly one story.
3. **Secondary stories are divider rows, not cards.** No card chrome. Whole row is a `<button>` so it's keyboard-accessible end-to-end.

**Two-halves contract:** The action chips deep-link via `?tab=<InboxFilter>` to `<InboxTab>` — the Inbox MUST read `useSearchParams().get('tab')` and validate against the `InboxFilter` union for the deep-link to work. Same contract applies to hero/secondary `drillIn.tab` (currently optional / unused by receivers in Phase 2; Phase 4 will wire receivers as the briefing AI starts populating it).

#### Client Inbox IA — 3-Section Layout (`new-inbox-ia` flag)

When the `new-inbox-ia` feature flag is on, InboxTab renders three named sections. Section headers use existing design system patterns — no new color families introduced.

| Element | Color | Rationale |
|---------|-------|-----------|
| **Section header** ("Decisions", "Reviews", "Conversations") | `t-label text-[var(--brand-text-muted)] tracking-wider uppercase` | Muted label — structural chrome, not a CTA |
| **Section header divider** | `border-b border-[var(--brand-border)]` | Standard border token |
| **Approve CTA** (within action cards) | `bg-teal-600 hover:bg-teal-500` | Teal = action (Law 1) |
| **Request Changes CTA** | `bg-amber-600/20 border-amber-500/30 text-amber-300 hover:bg-amber-600/30` | Amber = needs attention |
| **SchemaReviewModal / ClientActionDetailModal** backdrop | `bg-[var(--brand-overlay)]` | Token-only — no raw `bg-black/X` |
| Modal close ("✕") | `text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]` | Standard muted-to-default step |

**Flag-off:** Legacy single-list InboxTab renders unchanged. No color changes in the flag-off path.

##### Phase 2.5b — investor-briefing reading rhythm

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

##### Phase 2.5e — Premium AI polish (`<WeeklyOpener>`)

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
| **Content briefs** | Blue badges, full editing, status management | Teal badges, preview-only, approve/request changes |
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
| `SectionCard` (page-level) | `10px 24px 10px 24px` | `style={{ borderRadius: '10px 24px 10px 24px' }}` |
| `StatCard` | `6px 12px 6px 12px` | `style={{ borderRadius: '6px 12px 6px 12px' }}` |
| Insight cards (standalone) | `8px 16px 8px 16px` | inline style |
| Nested cards (inside SectionCard) | `8px` uniform | `rounded-lg` |
| Badges, pills | `4px` uniform | `rounded` |
| Buttons | unchanged | `rounded-lg` (8px) |

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
| Toast | Top-right, auto-dismiss after 5s, success=teal, error=red |
| Modal enter | `animate-[scaleIn_0.2s_ease-out]` |
| Modal overlay | `bg-black/70 backdrop-blur-md` |
| Modal container | `bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl max-w-md` |
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

| 2026-04-27 | **Design System Phase A — Tokenize UI primitives** (PR #329): Migrated 10 core UI primitives (SectionCard, Modal, ConfirmDialog, StatCard, TrendBadge, Badge, StatusBadge, DataList, TierGate, AIContextIndicator) from raw Tailwind classes to CSS custom property tokens (`--surface-*`, `--brand-text-*`, `--brand-border`, `--radius-*`). `.t-*` typography sizes boosted to match existing `!important` overrides (`.t-caption-sm` 13.5px, `.t-caption` 13.5px, `.t-body` 15.5px). `@layer components` cascade fix ensures Tailwind utilities override `.t-*` font properties. Migration lookup table: `docs/rules/phase-b-migration-map.md`. |
| 2026-04-27 | **Design System Phase B — Domain sweeps** (PRs #332–#336): 5 parallel domain sweeps migrating ~115 consumer files from raw Tailwind to `.t-*` typography classes and `--surface-*`/`--brand-*` tokens. B.1 Admin analytics (5 files), B.2 Admin content (31 files), B.3 Admin operations (21 files, added `iconOnly` prop to TrendBadge, WorkspaceSelector delete → ConfirmDialog), B.4 Client domain (43 files, 4 hand-rolled modals → `<Modal>`), B.5 Brand/schema/revenue (15 files, 8 `window.confirm()` → `<ConfirmDialog>`). |
| 2026-04-27 | **Design System Phase C — New pr-check rules** (PR #337): 5 new rules (`Raw rounded-* literal` warn, `No purple/violet in client domain` error, `Trend icon import outside TrendBadge` warn, `Hand-rolled fixed inset-0 outside overlay` warn, `score-color-law-parity` error) + promoted `styleguide-token-parity` warn→error. Rule count: 91→96 (52 error, 44 warn). |
| 2026-04-27 | **Design System Phase D — Doc drift fixes**: Renamed "Three Laws" → "Four Laws" across all docs and pr-check rule messages. Added emerald Law 3 (success). Updated `DESIGN_SYSTEM.md` typography scale to match `.t-*` class definitions. Synced `automated-rules.md`. |
| 2026-04-28 | **Design System Phase 6D — Blue-on-Button Law 02 Audit**: Audited blue usage on interactive elements per Law 02 ("Blue is read-only, never actionable"). Changed 4 actionable buttons from blue to teal: RequestList "View Brief" toggle, BriefDetail "Generate Full Post", SettingsPanel + ConnectionsTab "Connect Google". SettingsPanel Trash2 prune icon changed blue→red (destructive action). SeoAudit Info StatCard blue retained as severity-category color (consistent with Errors=red, Warnings=amber). |
| 2026-04-28 | **Blog Editor — TipTap BubbleMenu + FixDiffModal patterns**: `RichTextEditor.tsx` BubbleMenu uses `bg-teal-500/20 text-teal-300` for active format buttons (Law 1), `hover:bg-[var(--surface-3)]` for inactive. Link text in ProseMirror content uses `text-teal-400 underline`. Auto-save status: "Saving…" = `text-[var(--brand-text-muted)]`, "Saved" = `text-emerald-400` (Law 3 success). `FixDiffModal` backdrop uses `bg-[var(--brand-overlay)]` (no raw `bg-black/X`), "After" suggestion header `text-teal-300`, "Apply Fix" CTA `bg-teal-600 hover:bg-teal-500`. Per-component entries added to color map table above. |
| 2026-04-29 | **`.t-body` → DIN Pro 500** (PR #379): Body text utility class promoted from `Inter / 400` to `'DIN Pro', 'Inter' / 500` in both `src/index.css` + `public/styleguide.css` (lockstep per styleguide-typography-parity rule). Affects every consumer of `.t-body` platform-wide — page cards, form descriptions, schema widgets, BodyText primitive, etc. Inter remains the fallback so glyphs missing from DIN Pro degrade gracefully. Other `.t-*` classes unchanged. |

---

| 2026-05-03 | **Strategy Keywords rebuild** (PRs #430–#434 + task commits): Two-zone flat list (confirmed rows = standard surface, suggestion rows = `bg-blue-950/60 border border-blue-900/50`). Role badge coloring: content=emerald, page=blue, strategy=teal, idea=zinc/muted. KD difficulty coloring: ≤29=emerald-400, 30–49=amber-400, ≥50=red-400. Trend coloring: rising=emerald-400, declining=red-400, stable/unknown=muted. Drawer: right slide-in on desktop, bottom sheet on mobile. No sort controls. Per-component map section added. |

> **Golden rule**: Teal for actions, blue for data, emerald for success, purple for admin AI, zinc for structure. When in doubt, check the decision tree above.
