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

### The Three Laws of Color

1. **Teal for actions.** Every CTA, active state, toggle, accent highlight, tier badge, and interactive element uses teal. Never violet, blue, or indigo for buttons or interactive highlights.
2. **Blue for data.** Clicks, sessions, impressions, links, info badges, "Needs Review" status, "unsaved" state, progress bars for data metrics — all blue. Blue is read-only, never actionable.
3. **Purple for admin AI only.** The admin chatbot (`AdminChat.tsx`) and admin-only AI features (`SeoAudit.tsx` "Flag for Client") use purple to visually distinguish admin intelligence from client-facing teal UI. Purple never appears in any client-facing view.

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

### Surface Colors (Dark Mode — Default)

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `--bg-base` | `#0f1219` | — | Page background |
| `--bg-card` | `#18181b` | `bg-zinc-900` | Card backgrounds |
| `--bg-elevated` | `#27272a` | `bg-zinc-800` | Inputs, active tabs, hover states |
| `--border-default` | `#27272a` | `border-zinc-800` | Card borders |
| `--border-hover` | `#3f3f46` | `border-zinc-700` | Hover border state |
| `--text-primary` | `#f4f4f5` | `text-zinc-100` | Headings, key content |
| `--text-secondary` | `#b4b4bc` | `text-zinc-400` | Descriptions |
| `--text-muted` | `#a1a1aa` | `text-zinc-500` | Captions, labels |

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
| **SectionCard** | `SectionCard.tsx` | `bg-zinc-900 border-zinc-800` | Header row optional; title: `text-sm font-semibold text-zinc-200` |
| **PageHeader** | `PageHeader.tsx` | `text-lg font-semibold text-zinc-100` | Title + optional subtitle + action slot |
| **Badge** | `Badge.tsx` | 9 colors: `teal`, `blue`, `emerald`, `green`, `amber`, `red`, `orange`, `purple`, `zinc` | Pattern: `bg-{color}-500/10 text-{color}-400` |
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
| **WorkflowStepper** | `ui/WorkflowStepper.tsx` | Current: `bg-teal-500/10 border-teal-500 text-teal-400`; Completed: `bg-green-500/10 border-green-500/40 text-green-400`; Future: `bg-zinc-800/50 border-zinc-700 text-zinc-500` | Horizontal step indicator. Green = success/done state. Teal = active step. |
| **WorkspaceHealthBar** | `ui/WorkspaceHealthBar.tsx` | Progress bars: `bg-blue-500` (data/read-only); recommendation arrows: `text-teal-500` hover `text-teal-400` (action) | Wraps SectionCard. Blue = data metrics. Teal = actionable next steps. |
| **ChartCard** | `ui/ChartCard.tsx` | Same as SectionCard (`bg-[var(--surface-2)] border-zinc-800`) | Thin SectionCard wrapper for chart-friendly defaults: tighter padding (`px-4 py-3`), inline title + optional `<TrendBadge>` row, no `border-b` separator. Preserves signature `10px 24px` radius. |
| **TrendBadge** | `ui/TrendBadge.tsx` | Positive: `text-emerald-400` + `TrendingUp`; Negative: `text-red-400` + `TrendingDown`; Zero (when `hideOnZero={false}`): `text-zinc-400` + `Minus` | Canonical directional delta indicator. Props: `value`, `suffix='%'`, `invert`, `showSign`, `label`, `size='sm'\|'md'`, `hideOnZero=true`. Replaces all hand-rolled `TrendingUp/Down + emerald/red` ternaries. Use `invert` when lower=better (positions, error counts). |
| **FormField** | `ui/forms/FormField.tsx` | Label text: `text-zinc-300`; error message: `text-red-400`; hint: `text-zinc-500`; required asterisk: `text-red-400` | Phase 5. Wraps an input with label + optional error/hint. Generates `useId()` and wires `htmlFor` ↔ child `id` via Context so label clicks focus the input. forwardRef. |
| **FormInput / FormSelect / FormTextarea** | `ui/forms/Form{Input,Select,Textarea}.tsx` | Default border: `border-zinc-700`, focus: `border-[var(--brand-mint)]` + `ring-[var(--brand-mint-glow)]` (Law 01). Error border: `border-red-500/50`. Placeholder: `text-zinc-500`. | Phase 5. Dark-theme inputs, mint focus ring. Consume error state + id from FormFieldContext. FormTextarea shows optional `maxLength` counter (red near limit). forwardRef. |
| **Checkbox** | `ui/forms/Checkbox.tsx` | Checked: `bg-[var(--brand-mint)] border-[var(--brand-mint)]` (Law 01). Unchecked: `bg-zinc-800 border-zinc-700`. Check icon: `text-zinc-900`. | Phase 5. Custom visual checkbox over hidden native input (preserves Space-key + a11y). Required `label` string. forwardRef to input. |
| **Toggle** | `ui/forms/Toggle.tsx` | Track ON: `bg-[var(--brand-mint)]` (Law 01). Track OFF: `bg-zinc-700`. Knob: `bg-white` with translate transition. | Phase 5. `role="switch"` with implicit aria-checked from `checked` attribute. Required `label` string. forwardRef to input. |

### Helper Functions (`constants.ts`)

| Function | Returns | Usage |
|----------|---------|-------|
| `scoreColor(score)` | Hex string (`#34d399`, `#fbbf24`, `#f87171`) | MetricRing, any health score |
| `scoreColorClass(score)` | Tailwind class (`text-green-400`, etc.) | Text coloring for scores |
| `scoreBgClass(score)` | Background class (`bg-green-500/10`, etc.) | Score badges, backgrounds |
| `scoreBgBarClass(score)` | Solid bg class (`bg-green-500`, etc.) | Progress bar fills (4-tier: green/amber/orange/red) |
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

### Admin Components

| Component | Element | Color | Rationale |
|-----------|---------|-------|-----------|
| **OnboardingChecklist** | Backdrop overlay | `bg-black/60 backdrop-blur-sm` | Full-screen modal, admin-only |
| **OnboardingChecklist** | Progress bar | `bg-blue-500` | Data — read-only completion metric |
| **OnboardingChecklist** | Completed step checkmark | `text-teal-400` | Action/completion state |
| **OnboardingChecklist** | Celebration icon | `bg-teal-500/10 text-teal-400` | Completion success |
| **WorkflowStepper** | Current step circle | `bg-teal-500/10 border-teal-500 text-teal-400` | Active = teal |
| **WorkflowStepper** | Completed step circle | `bg-green-500/10 border-green-500/40 text-green-400` | Success = green |
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
| **WorkflowStepper.tsx** | Completed step circle | `bg-emerald-500 text-white` | Green = done |
| **WorkflowStepper.tsx** | Current step circle | `bg-teal-500 text-white` | Teal = active |
| **WorkflowStepper.tsx** | Future step circle | `bg-zinc-700 text-zinc-400` | Zinc = inactive |
| **WorkspaceHealthBar.tsx** | Metric progress bars | `bg-blue-500` | Blue = data metric (read-only) |
| **WorkspaceHealthBar.tsx** | Recommended Next CTA | `from-teal-600 to-emerald-600` | Teal = action |
| **AssetAudit.tsx** | Action buttons (Crawl, Export) | `bg-blue-700 hover:bg-blue-600` | Admin data-action context (acceptable) |
| **SeoEditor.tsx** | "Unsaved" badge | `blue-500/10 text-blue-400` | State indicator |
| **RequestManager.tsx** | "New" status | `blue-500/10 text-blue-400` | Info state |

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

### Stripe Payment (`StripePaymentForm.tsx`)

| Element | Color |
|---------|-------|
| Header gradient | `from-teal-600/15 via-emerald-600/10` |
| Decorative glow | `bg-teal-500` |
| Price text | `text-teal-300` |
| Keyword text | `text-teal-400/80` |
| Submit button | `from-teal-600 to-emerald-600` |
| Success state | `bg-teal-500/15 ring-teal-500/30`, `text-teal-400` |

> **All client-facing payment UI is teal.** The `accentColor` prop still exists in the interface for backward compat but is no longer branched on.

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
| `src/components/ui/Badge.tsx` | 9-color badge primitive |
| `src/components/ui/StatCard.tsx` | Default + CompactStatBar |
| `src/components/ui/MetricRing.tsx` | MetricRing + MetricRingSvg |
| `src/components/ui/SectionCard.tsx` | Standard card container |
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
| `src/components/ui/WorkflowStepper.tsx` | Horizontal numbered stepper (green=done, teal=current, zinc=future) |
| `src/components/ui/WorkspaceHealthBar.tsx` | Multi-metric health bars + recommended next action (blue fills, teal CTA) |
| `src/components/ClientDashboard.tsx` | Client-facing dashboard (largest component) |
| `src/components/AdminChat.tsx` | Admin AI chat (purple accent) |
| `src/components/KeywordStrategy.tsx` | SEO strategy + content gaps |
| `src/components/ContentBriefs.tsx` | Admin content brief management |
| `src/components/StripePaymentForm.tsx` | Stripe payment UI (teal unified) |
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
| 2025-03-07 | **v2 rewrite**: Full codebase audit (43 components + 12 primitives). Fixed StripePaymentForm, WorkspaceOverview, WorkspaceSettings. Added per-component color map, primitive inventory, admin vs client rules, AI prompting section |
| 2026-03-27 | **Analytics Hub redesign**: Added `AnnotatedTrendChart` with dual Y-axes, annotation markers, click-to-annotate. Merged SearchConsole + GoogleAnalytics into `AnalyticsHub`. |
| 2026-03-27 | **Connected Intelligence Phase 1**: New `InsightFeed` priority feed component (severity icons: red=critical TrendingDown, amber=warning AlertTriangle, blue=opportunity Target, green=win TrendingUp). `SummaryPills` with colored dots (red/amber/green/blue/purple) and toggle-filter interaction. `InsightSkeleton` shimmer loading. `AnnotatedTrendChart` gains toggleable line chips (solid=active, outline=inactive, grayed=at-max). All three hub tabs now insight-first with sub-tabs. |
| 2026-03-28 | **Visual Polish** (10 refinements): Asymmetric card radius (SectionCard `10px 24px`, StatCard `6px 12px`), MetricRing outward glow + charge-up animation, noise overlay on body, ScannerReveal page transitions, spacing variation (`space-y-8` between sections), removed uppercase from section headings, StatCard `size="hero"` prop, stagger-fade entrance animations, interactive card hover (teal left-border accent), status color muting (`emerald-400/80`, `amber-400/80`, `red-400/80`, bg at `/8` opacity). Updated: SectionCard, StatCard, MetricRing, Skeleton, TierGate, Badge, statusConfig, ~60 consumer files. |
| 2026-03-29 | **Outcome Intelligence Engine**: Added Outcome Tracking color map — win rate rings use `scoreColor()`, score badges (strong_win/win=green, neutral=amber, loss=red, insufficient_data/inconclusive=zinc), action type badges (blue), delta indicators (green/red/zinc), confidence badges (green/amber/red). Client "We Called It" uses soft teal. All outcome CTAs use standard teal gradient. |
| 2026-03-30 | **Light Mode Audit + Visual Polish**: Fixed 148 dark-color instances across 42 files. Added 7 chart theme helpers to `constants.ts` (`themeColor`, `chartGridColor`, `chartAxisColor`, `chartDotStroke`, `chartDotFill`, `chartTooltipStyle`, `chartTooltipLabelStyle`). Fixed MetricRing glow to match score color (not always teal). Fixed ScannerReveal overlay, MetricRing track, Skeleton shimmer, Stripe Elements theming, all Recharts chart axes/grids/dots/tooltips. Added 17 missing `.dashboard-light` CSS overrides. Added 2 pr-check rules for dark hex enforcement. Standardized `space-y-8` on 10 page wrappers, asymmetric border radius on 11 cards. |
| 2026-04-09 | **Page Rewriter UI** (Feature #138): Apply interaction uses teal highlight — `background-color: rgba(13,148,136,0.2)` + `border-left: 2px solid #0d9488` — fades over 2s via CSS transition (all three properties cleared). Floating formatting toolbar uses `bg-zinc-700 border-zinc-600` (no teal — it's a utility tool, not an action). Issue chips: `red-*` for errors, `amber-*` for warnings, `blue-*` for info — follows existing status color convention. Focus mode toggle: teal active state (`text-teal-400 bg-teal-500/10`) per Law 1 (toggle = action). **Integration note for Copy & Brand Engine:** `data-section` attribute on all document headings and `applyToSection()` in `PageRewriteChat.tsx` are the designated extension points for inline text-selection targeting. |
| 2026-04-13 | **Admin UX PR4 — Onboarding & Guided Flows**: Added 3 new shared UI primitives. `OnboardingChecklist`: modal overlay with blue progress bar (data), teal checkmarks (action accomplished), focus trap, Escape-key dismiss, localStorage persistence per workspace. `WorkflowStepper`: horizontal numbered stepper — green=completed, teal=current, zinc=future; compact variant. `WorkspaceHealthBar`: blue progress fills (data metric law) + teal Recommended Next CTA (action law). Added per-component color map rows for all three. Also fixed purple violations in `PageIntelligence` (admin-only component with no client-facing exposure — purple removed per Three Laws). |
| 2026-04-20 | **Light Mode Overhaul (client portal)**: `.dashboard-light` token set expanded from 10 → 25 variables (WCAG AA verified). New tokens: `--brand-bg-hover`, `--brand-bg-active`, `--brand-text-disabled`, `--brand-border-strong`, `--brand-shadow-sm/md`, `--scrollbar-thumb/hover`, `--chart-grid`, `--chart-tooltip-bg/text`, `--brand-overlay`, `--brand-mint/hover/dim`, `--metric-ring-track`. `--brand-text-muted` adjusted `#64748b`→`#475569` (slate-600, 6.5:1 contrast). Four-step text hierarchy restored. `chartGridColor()` and `chartTooltipStyle()` now read from CSS variables via `getCssVar()`. New UI primitive: `ConfirmDialog` (centered modal, teal CTA, Escape/Enter keyboard support, destructive variant). ApprovalsTab: 3 `window.confirm()` calls replaced with `ConfirmDialog`; filter bar added (All / Needs Action / Ready to Apply / Applied with live batch counts). |

---

> **Golden rule**: Teal for actions, blue for data, purple for admin AI, zinc for structure. When in doubt, check the decision tree above.
