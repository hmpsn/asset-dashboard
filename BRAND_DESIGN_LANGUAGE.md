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
| **Green** | `#4ade80` | `#15803d` | `green-400` | Positive deltas, delivery confirmations, approved states |
| **Amber** | `#fbbf24` | `#b45309` | `amber-400` | Warnings, medium scores (60–79), trial badges, premium tier gate (TierGate only) |
| **Red** | `#f87171` | `#dc2626` | `red-400` | Errors, bad scores (<60), high-priority items, destructive actions |
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
| **TierGate** | `TierGate.tsx` | Growth: `teal`, Premium: `amber` | Blurred preview + overlay lock. Exports `TierBadge`. `onGateHit` callback (optional) fires when gate blocks access for upsell tracking. |
| **InsightsDigest** | `client/InsightsDigest.tsx` | Green=win, amber=opportunity/warning, red=critical, teal=CTA links | Unified feed: local + server insights merged. Server insights mapped via `SEVERITY_TO_COLOR` + `INSIGHT_TYPE_ACTIONS`. |
| **MonthlyDigest** | `client/MonthlyDigest.tsx` | Emerald=wins, blue=ROI highlights, teal=pages optimized count | Growth-gated. No purple. |
| **ActionQueue** | `admin/ActionQueue.tsx` | Blue=impact scores (data), teal=resolve CTA (action) | Admin-only. No purple. |
| **DataList** | `DataList.tsx` | Rank: `text-zinc-500`, label: `text-zinc-300`, value: `text-zinc-400` | Optional ranking numbers |

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
| **AdminChat.tsx** | FAB, header, messages, send button, focus ring | `purple-600`, `purple-400` | Admin AI = purple (differentiated from client teal chat) |
| **SeoAudit.tsx** | "Flag for Client" button, badge, actions | `purple-600`, `purple-400` | Admin-only AI feature |
| **SchemaSuggester.tsx** | CMS template badge | `purple-500/15 text-purple-400` | Technical admin badge |
| **ContentBriefs.tsx** | Full Post badge, brief toggle, word count badge | `blue-500/10 text-blue-400` | Data/info context on admin side |
| **KeywordStrategy.tsx** | Page type badge, content gap cards | `teal` | Matches design system |
| **WorkspaceOverview.tsx** | Tier badges on workspace cards | `teal-500/15 text-teal-400` | Unified |
| **WorkspaceSettings.tsx** | Knowledge base icon, client users icon, avatar gradient | `teal` | Unified |
| **AssetAudit.tsx** | Action buttons (Crawl, Export) | `bg-blue-700 hover:bg-blue-600` | Admin data-action context (acceptable) |
| **SeoEditor.tsx** | "Unsaved" badge | `blue-500/10 text-blue-400` | State indicator |
| **RequestManager.tsx** | "New" status | `blue-500/10 text-blue-400` | Info state |

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
| Page-level section gap | `space-y-5` (20px) |
| Card padding | `p-4` standard, `p-3` compact |
| Card header | `px-4 py-3` |
| Grid gap | `gap-3` stat cards, `gap-4`/`gap-5` content sections |
| Stat card grid | `grid-cols-2 sm:grid-cols-4` |
| Content opportunity grid | `grid-cols-1 md:grid-cols-2` |

---

## 7. Interaction Patterns

| Pattern | Spec |
|---------|------|
| Card hover | `border-zinc-700` + `box-shadow: 0 4px 24px -4px rgba(0,0,0,0.3)` |
| Button transition | `transition-colors` (150ms) or `transition-all` for complex states |
| Active tab (segmented) | `bg-zinc-700 text-zinc-200` |
| Active tab (underline) | `border-teal-500 text-teal-300` |
| Loading | `Loader2 animate-spin text-teal-400` |
| Toast | Top-right, auto-dismiss after 5s, success=teal, error=red |
| Modal enter | `animate-[scaleIn_0.2s_ease-out]` |
| Modal overlay | `bg-black/70 backdrop-blur-md` |
| Modal container | `bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl max-w-md` |

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
| `src/components/ui/TierGate.tsx` | Tier lock overlay + TierBadge |
| `src/components/ui/DataList.tsx` | Ranked data list |
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

---

> **Golden rule**: Teal for actions, blue for data, purple for admin AI, zinc for structure. When in doubt, check the decision tree above.
