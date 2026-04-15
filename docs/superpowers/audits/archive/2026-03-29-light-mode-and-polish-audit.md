# Light Mode + Visual Polish — Pre-Plan Audit

**Date:** 2026-03-29
**Spec:** `docs/superpowers/specs/2026-03-29-light-mode-audit-design.md`
**Total findings:** 148 instances across 42 files

---

## Scope

Two combined audits:
1. **Light mode:** Every hardcoded dark color that bleeds through in light mode
2. **Visual polish gaps:** Remaining components missing asymmetric border radius, `space-y-8` page spacing, or uppercase heading removal from the March 2026 sweep

---

## Findings by Category

### INLINE_STYLE (20 instances, 10 files)

| File | Line | Value | Context |
|------|------|-------|---------|
| `ScannerReveal.tsx` | 69 | `#0f1219` | `backgroundColor: '#0f1219'` — overlay |
| `RequestManager.tsx` | 342 | `#27272a` | `borderColor: '#27272a'` — conditional |
| `RequestManager.tsx` | 360 | `#18181b`, `#27272a` | `backgroundColor: '#18181b', border: '1px solid #27272a'` |
| `RequestManager.tsx` | 369 | `#27272a` | `borderColor: '#27272a'` — conditional |
| `RequestManager.tsx` | 487 | `#0f1219`, `#27272a` | `backgroundColor: '#0f1219', border: '1px solid #27272a'` |
| `settings/ClientDashboardTab.tsx` | 259 | `#18181b`, `#a1a1aa`, `#27272a` | `backgroundColor`, `color`, `border` |
| `settings/ClientDashboardTab.tsx` | 505 | `#27272a`, `#a1a1aa` | `backgroundColor: '#27272a', color: '#a1a1aa'` |
| `settings/ClientDashboardTab.tsx` | 626 | `#27272a`, `#a1a1aa` | `backgroundColor: '#27272a', color: '#a1a1aa'` |
| `BrandHub.tsx` | 219 | `#27272a`, `#a1a1aa` | `backgroundColor: '#27272a', color: '#a1a1aa'` |
| `DropZone.tsx` | 86-87 | `#3f3f46`, `#18181b` | `borderColor`, `backgroundColor` — conditional |
| `InternalLinks.tsx` | 222 | `#71717a` | `color: '#71717a'` |
| `RedirectManager.tsx` | 408 | `#71717a` | `color: '#71717a'` |
| `WorkspaceSettings.tsx` | 176 | `#71717a` | `color: '#71717a'` — inactive tab |
| `client/OverviewTab.tsx` | 434 | `#0f1219` | `backgroundColor: '#0f1219'` — timeline dot |
| `StripePaymentForm.tsx` | 190-217 | `#a1a1aa`, `#52525b`, `#71717a` | Stripe Elements theme colors |
| `StripePaymentForm.tsx` | 206-264 | `rgba(24,24,27,0.8)`, `rgba(63,63,70,*)`, `rgba(39,39,42,0.5)` | Stripe Elements dark backgrounds/borders |

### SVG_ATTR (13 instances, 5 files)

| File | Line | Value | Context |
|------|------|-------|---------|
| `MetricRing.tsx` | 43 | `#303036` | `stroke="#303036"` — track circle |
| `MetricRing.tsx` | 79 | `#303036` | `stroke="#303036"` — track circle (SVG variant) |
| `RankTracker.tsx` | 101 | `#27272a` | `stroke="#27272a"` — grid line |
| `RankTracker.tsx` | 102 | `#52525b` | `fill="#52525b"` — axis label |
| `RankTracker.tsx` | 123 | `#52525b` | `fill="#52525b"` — axis label |
| `Roadmap.tsx` | 89 | `#27272a` | `stroke="#27272a"` — grid line |
| `Roadmap.tsx` | 102 | `#0f0f0f` | `fill="#0f0f0f"` — data dot center |
| `AnnotatedTrendChart.tsx` | 167 | `#18181b` | `stroke="#18181b"` — annotation dot ring |
| `Styleguide.tsx` | 451 | `#18181b` | `stroke="#18181b"` — chart dot |
| `Styleguide.tsx` | 509 | `#a1a1aa` | `stroke="#a1a1aa"` — reference line |
| `Styleguide.tsx` | 510 | `#18181b` | `stroke="#18181b"` — chart dot |
| `Styleguide.tsx` | 511 | `#18181b` | `stroke="#18181b"` — chart dot |

### RECHARTS_PROP (15 instances, 5 files)

| File | Line | Value | Context |
|------|------|-------|---------|
| `AnnotatedTrendChart.tsx` | 325 | `#27272a` | `CartesianGrid stroke` |
| `AnnotatedTrendChart.tsx` | 328 | `#71717a` | `XAxis tick fill` |
| `AnnotatedTrendChart.tsx` | 330 | `#3f3f46` | `XAxis axisLine stroke` |
| `AnnotatedTrendChart.tsx` | 361 | `#18181b` | `Tooltip contentStyle backgroundColor` |
| `AnnotatedTrendChart.tsx` | 362 | `#3f3f46` | `Tooltip contentStyle border` |
| `AnnotatedTrendChart.tsx` | 366 | `#a1a1aa` | `Tooltip labelStyle color` |
| `ScoreTrendChart.tsx` | 30 | `rgba(255,255,255,0.04)` | `CartesianGrid stroke` — INVISIBLE on light |
| `ScoreTrendChart.tsx` | 48 | `#0f1219` | `Area dot fill` |
| `ScoreTrendChart.tsx` | 48 | `#18181b` | `Area activeDot stroke` |
| `client/helpers.tsx` | 44 | `#18181b` | `activeDot stroke` (TrendChart) |
| `client/helpers.tsx` | 79 | `#18181b` | `activeDot stroke` (DualTrendChart imps) |
| `client/helpers.tsx` | 80 | `#18181b` | `activeDot stroke` (DualTrendChart clicks) |
| `client/helpers.tsx` | 129 | `#18181b` | `activeDot stroke` (SiteHealthTrendChart) |
| `client/AnalyticsTab.tsx` | 206 | `#18181b` | `activeDot stroke` (GA4 chart) |
| `client/AnalyticsTab.tsx` | 425 | `#18181b` | `activeDot stroke` (Events chart) |
| `WorkspaceOverview.tsx` | 666 | `#52525b` | `XAxis tick fill` |

### JS_CONST — Theme-Unaware Color Props (14 instances, 4 files)

These are JS variables/props passing dark hex to child components (primarily `iconColor` on `StatCard`):

| File | Lines | Value | Context |
|------|-------|-------|---------|
| `WorkspaceOverview.tsx` | 152-157 | `#71717a` (×6) | `iconColor` fallback on 6 StatCards |
| `WorkspaceHome.tsx` | 253, 270, 277, 317 | `#71717a` (×4) | `iconColor` fallback on 4 StatCards |
| `SiteArchitecture.tsx` | 334 | `#71717a` | `iconColor` conditional fallback |
| `client/HealthTab.tsx` | 807 | `#71717a` | `CAT_LABELS` fallback color |
| `matrix/CellDetailPanel.tsx` | 239 | `#71717a` | Timeline dot fallback color |
| `AnnotatedTrendChart.tsx` | 318-319 | `#71717a` (×2) | Axis color fallback defaults |

### CSS_CLASS — Missing `.dashboard-light` Overrides (22 gap classes)

These Tailwind classes are used in components but have NO `.dashboard-light` rule:

| Class | Used in N files | Light mode override |
|-------|----------------|-------------------|
| `bg-zinc-800/40` | 3+ | **MISSING** |
| `bg-zinc-800/20` | 5+ | **MISSING** |
| `bg-zinc-800/80` | 4+ | **MISSING** |
| `bg-zinc-900/60` | 1 | **MISSING** |
| `bg-zinc-950/50` | 4+ | **MISSING** |
| `bg-zinc-700/50` | 4+ | **MISSING** |
| `bg-zinc-700/30` | 1 | **MISSING** |
| `border-zinc-800/30` | 3+ | **MISSING** |
| `border-zinc-800/60` | 3+ | **MISSING** |
| `border-zinc-500/20` | 4+ | **MISSING** |
| `border-zinc-500/30` | 3+ | **MISSING** |
| `border-zinc-600/20` | 1+ | **MISSING** |
| `bg-zinc-500/10` | 5+ | **MISSING** |
| `bg-zinc-500/15` | 1 | **MISSING** |
| `from-zinc-900` | 3+ | **MISSING** |
| `to-zinc-900/50` | 1 | **MISSING** |
| `text-[#0f1219]` | 7+ files | **MISSING** |
| `divide-zinc-800/50` | 10+ | needs verification |
| `divide-zinc-800/30` | 5+ | needs verification |
| `ring-zinc-900` | 1 | needs verification |
| `bg-cyan-950` | 1 | exists but maps to `#f0f9ff` — near-invisible against `#f8fafc` bg |

### Skeleton Shimmer

| File | Line | Issue |
|------|------|-------|
| `Skeleton.tsx` | 11 | `bg-zinc-800` with `animate-pulse` — both map to near-white in light mode, shimmer invisible |

### VISUAL_POLISH — Spacing Gaps (11 files)

Page-level outer wrappers still using `space-y-4` or `space-y-6` instead of `space-y-8`:

| File | Line | Current | Should Be |
|------|------|---------|-----------|
| `AnalyticsAnnotations.tsx` | 81 | `space-y-4` | `space-y-8` |
| `Annotations.tsx` | 55 | `space-y-4` | `space-y-8` |
| `AssetBrowser.tsx` | 527 | `space-y-4` | `space-y-8` |
| `CmsEditor.tsx` | 450 | `space-y-4` | `space-y-8` |
| `ContentPlanner.tsx` | 180 | `space-y-4` | `space-y-8` |
| `LinksPanel.tsx` | 22 | `space-y-4` | `space-y-8` |
| `LlmsTxtGenerator.tsx` | 97 | `space-y-4` | `space-y-8` |
| `PostEditor.tsx` | 256 | `space-y-4` | `space-y-8` |
| `PublishSettings.tsx` | 164 | `space-y-4` | `space-y-8` |
| `FeatureLibrary.tsx` | ~top | `space-y-6` | `space-y-8` |
| `RequestManager.tsx` | 218 | `space-y-6` | `space-y-8` |
| `RevenueDashboard.tsx` | 79 | `space-y-6` | `space-y-8` |

### VISUAL_POLISH — Border Radius Gaps (11 locations, 6 files)

**Section cards (should be `10px 24px 10px 24px`):**

| File | Line | Current |
|------|------|---------|
| `AnalyticsAnnotations.tsx` | 90 | `rounded-xl` |
| `Annotations.tsx` | 64 | `rounded-xl` |
| `RequestManager.tsx` | 231 | `rounded-xl` |
| `PageRewriteChat.tsx` | 334 | `rounded-xl` |
| `PageRewriteChat.tsx` | 368 | `rounded-xl` |
| `PageRewriteChat.tsx` | 381 | `rounded-xl` |

**Compact/stat cards (should be `6px 12px 6px 12px`):**

| File | Line | Current |
|------|------|---------|
| `FeatureLibrary.tsx` | 32 | `rounded-xl` |
| `AnalyticsAnnotations.tsx` | 134 | `rounded-xl` |
| `Annotations.tsx` | 102 | `rounded-xl` |
| `LinkChecker.tsx` | 229 | `rounded-xl` |
| `LandingPage.tsx` | 144 | `rounded-xl` |

---

## Existing Coverage

- **CSS overrides:** 242 rules exist in `.dashboard-light` block
- **CSS variables:** 16 defined, only 5 used (body bg, body color, placeholder, focus ring, selection). **11 variables defined but never referenced by any component** (`--brand-bg-surface`, `--brand-bg-elevated`, `--brand-bg-card`, `--brand-text`, `--brand-mint`, `--brand-mint-hover`, `--brand-mint-dim`, `--brand-mint-glow`, `--brand-yellow`, `--brand-yellow-dim`, `--brand-border`)
- **Theme detection utility:** `scoreColor()` in `ui/constants.ts` — only theme-aware function. No `useIsLightMode` hook exists.
- **Theme state:** `App.tsx` uses `localStorage('admin-theme')`, `ClientDashboard.tsx` uses `localStorage('dashboard-theme')`. Class `.dashboard-light` applied to root div. NOT prop-drilled beyond `Dashboard` → `Sidebar`.
- **Prevention checks:** pr-check.ts has **zero** light-mode checks. CI has zero light-mode tests. No Playwright light-mode scenarios.
- **Arbitrary class override:** `.dashboard-light .bg-\[\#0f1219\]` exists (→ `#f8fafc`). `text-[#0f1219]`, `ring-[#0f1219]`, `from-[#0f1219]` overrides do **NOT** exist.

---

## Infrastructure Recommendations

### 1. Shared Chart Theme Helpers (affects 7 chart files)

Extend `ui/constants.ts` with:
- `chartGridColor()` — returns `#e2e8f0` (light) or `#27272a` (dark)
- `chartAxisColor()` — returns `#94a3b8` (light) or `#71717a` (dark)
- `chartDotStroke()` — returns `#f1f5f9` (light) or `#18181b` (dark)
- `chartTooltipStyle()` — returns full `contentStyle` object for light/dark
- `themeColor(dark, light)` — generic helper for any two-value theme switch

Pattern: reuse `scoreColor()`'s `document.querySelector('.dashboard-light')` detection. No React hook needed for these (they're called during render, not in effects).

### 2. pr-check Light Mode Rules (prevents recurrence)

Add 2 new checks to `scripts/pr-check.ts`:

```
{
  name: 'Hardcoded dark hex in inline styles',
  pattern: 'style=\\{[^}]*(#0f1219|#18181b|#27272a|#303036)',
  fileGlobs: ['*.tsx'],
  pathFilter: 'src/components/',
  exclude: 'Styleguide.tsx',
  message: 'Use CSS variables or chartColor helpers. Hardcoded dark hex breaks light mode.',
  severity: 'warn',
},
{
  name: 'SVG with hardcoded dark fill/stroke',
  pattern: '(fill|stroke)="(#0f1219|#18181b|#27272a|#303036|#52525b)"',
  fileGlobs: ['*.tsx'],
  pathFilter: 'src/components/',
  exclude: 'Styleguide.tsx',
  message: 'Use chartDotStroke() or CSS variables for SVG colors. Dark hex breaks light mode.',
  severity: 'warn',
},
```

### 3. `#71717a` iconColor Fallback (affects 12+ StatCard usages)

`#71717a` is used as the "inactive/muted" icon color in StatCard across WorkspaceOverview, WorkspaceHome, SiteArchitecture. In light mode this renders as a medium gray — acceptable but not ideal. The fix is to use `themeColor('#71717a', '#94a3b8')` for the muted state. This is a lower priority since `#71717a` is readable on both backgrounds, just not optimally contrast-tuned.

### 4. Root Cause

Components bypass the CSS variable system entirely — 11 of 16 defined `--brand-*` variables are never referenced. Inline styles use raw hex values instead of `var(--brand-bg-card)`, `var(--brand-border)`, etc. The CSS variable system was built but never adopted by component authors. Future components should use CSS variables for any background/border/text color that differs between themes.

---

## Parallelization Strategy

### Phase 0 — Shared Infrastructure (sequential, must commit before parallel work)
- **Task 0a:** Chart theme helpers in `ui/constants.ts`
- **Task 0b:** CSS gap classes + missing arbitrary overrides in `index.css`
- **Task 0c:** Skeleton shimmer fix in `index.css`
- **Task 0d:** pr-check light mode rules

### Phase 1 — Critical UI Components (parallel, 3 agents)
- **Agent 1:** ScannerReveal + MetricRing (2 files — exclusive ownership)
- **Agent 2:** AnnotatedTrendChart + ScoreTrendChart (2 files — exclusive ownership)
- **Agent 3:** client/helpers.tsx + client/AnalyticsTab.tsx (2 files — exclusive ownership)

### Phase 2 — Inline Style Components (parallel, 4 agents)
- **Agent 1:** RequestManager.tsx (7 inline styles + spacing + border radius)
- **Agent 2:** ClientDashboardTab.tsx + BrandHub.tsx (9 inline styles)
- **Agent 3:** RankTracker + Roadmap + WorkspaceOverview (SVG + Recharts)
- **Agent 4:** DropZone + InternalLinks + RedirectManager + WorkspaceSettings (1-2 fixes each)

### Phase 3 — Visual Polish Gaps (parallel, 3 agents)
- **Agent 1:** Spacing fixes batch 1: AnalyticsAnnotations, Annotations, AssetBrowser, CmsEditor, ContentPlanner, LinksPanel
- **Agent 2:** Spacing fixes batch 2: LlmsTxtGenerator, PostEditor, PublishSettings, FeatureLibrary, RevenueDashboard
- **Agent 3:** Border radius fixes: PageRewriteChat (×3), LinkChecker, LandingPage, AnalyticsAnnotations, Annotations, FeatureLibrary

### Phase 4 — Edge Cases (parallel, 2 agents)
- **Agent 1:** StripePaymentForm Stripe Elements theming
- **Agent 2:** client/OverviewTab + HealthTab + CellDetailPanel + SiteArchitecture iconColor fixes

### Phase 5 — Verification (sequential, orchestrator)
- Full test suite + build + pr-check
- Preview screenshots of key pages in light mode
- Docs update + PR

---

## Model Assignments

| Task Type | Recommended Model | Reasoning |
|-----------|------------------|-----------|
| CSS additions (gap classes, shimmer, overrides) | Haiku | Mechanical pattern matching |
| Chart helper functions in constants.ts | Sonnet | Logic for theme detection pattern |
| pr-check rule additions | Haiku | Pattern-based, follows existing structure |
| Single-line CSS var swaps (ScannerReveal, MetricRing) | Haiku | Mechanical replacement |
| Chart component refactoring (AnnotatedTrendChart, ScoreTrendChart) | Sonnet | Needs to read component logic, apply helpers |
| Inline style → CSS var conversion (RequestManager, ClientDashboardTab) | Sonnet | Multiple conditional styles, needs context |
| Visual polish spacing/radius fixes | Haiku | Mechanical class replacement |
| StripePaymentForm Stripe Elements theming | Sonnet | Stripe API-specific theme object |
| Verification + orchestration | Opus | Full-context judgment |

---

## Files NOT Requiring Changes

These were audited and confirmed clean:
- `CommandPalette.tsx` — Tailwind classes only, all covered by existing overrides
- `NotificationBell.tsx` — Tailwind classes only (uses `ring-[#0f1219]` but this renders correctly in light mode since it's a focus ring on a dark element)
- `WorkspaceSelector.tsx` — Tailwind classes only
- `SearchableSelect.tsx` — Tailwind classes only
- `ErrorBoundary.tsx` — Tailwind classes only
- `Toast.tsx` — Tailwind classes only
- `PostEditor.tsx` — needs spacing fix only (no color issues)
- `CmsEditor.tsx` — needs spacing fix only (no color issues)
- `Styleguide.tsx` — dev-only reference page, lower priority (addressed separately if desired)
