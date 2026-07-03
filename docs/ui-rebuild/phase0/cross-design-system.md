# Phase 0 Cross-Cutting Audit — Design-System Wiring Readiness

**Question:** can the UI Rebuild Kit's components actually become the production UI?
**Auditor scope:** kit inventory · integration path · token drift · kit-vs-HEAD primitive mapping.
**Repo state:** branch `ui-rebuild-phase-0` (post-Reconcile staging HEAD). Kit at `hmpsn studio Design System/` (all kit paths below are relative to that directory).
**Verdict up front:** the kit is a **high-fidelity visual + prop-contract spec, not a drop-in library**. It is genuinely React, genuinely typed (53/53 components ship `.d.ts`), and its token values are ~95% identical to HEAD `src/tokens.css` (it was lifted from this repo). But the `.jsx` implementations are inline-style, `className`-less, hook-free prototypes with hard-coded z-indexes and 21 token references that don't exist at HEAD — and HEAD's same-named primitives are **prop supersets** of the kit's. Wholesale adoption of the kit `.jsx` would *lose* capability (props, focus traps, a11y, statusConfig domains, ~25 HEAD-only primitives). The viable path is **port/merge, not replace**: adopt kit visuals + net-new components into `src/components/ui/` under HEAD conventions, keep HEAD's superset prop contracts.

---

## 1. Kit inventory — what is actually in the box

### 1.1 Structure (verified on disk)

| Artifact | Contents | Evidence |
|---|---|---|
| `components/` | 53 `.jsx` + 53 `.d.ts` (1:1) + 6 `.prompt.md` + one `*.card.html` per group | `find` count: 53 jsx, 53 d.ts, 6 prompt.md |
| `_ds_manifest.json` | namespace `HmpsnStudioDesignSystem_09a9e3`, **59 component names** (53 files; 6 files export two names: KeyValueRow+DefinitionList, BoardColumn+BoardCard, Popover+MenuItem, Stack+Row, Toolbar+ToolbarSpacer, Icon+ICON_NAMES), `globalCssPaths`, tokens list, `themes: [{selector: '.dashboard-light'}]`, `source: "spa"` | manifest keys dump |
| `styles.css` | `@import`-only manifest → 7 token files + `guidelines/type-scale.css` | file read |
| `tokens/` | `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `layout.css`, `effects.css`, `base.css` | dir listing |
| `templates/app-page/` | `AppPage.dc.html` (+ `ds-base.js`, `support.js`) — a **design-canvas** template using `<x-import component-from-global-scope="HmpsnStudioDesignSystem_09a9e3.PageHeader" …>` | `AppPage.dc.html:11,15` |
| `_ds_bundle.js` | 1.39 MB, `format: 4` header; Babel-transpiled `React.createElement` IIFE; attaches every component to a window-global namespace object (`__ds_ns.Button = __ds_scope.Button; …`); also bundles `ui_kits/` marketing/dashboard recreations with per-file try/catch error swallowing (`__ds_ns.__errors.push(...)`) | bundle head + tail read |
| `_adherence.oxlintrc.json` | oxlint config: 3 rules (`react/forbid-elements`, `no-restricted-imports`, `no-restricted-syntax` with **69 selectors**) — raw hex ban, raw px ban, off-system font ban, and a per-component "doesn't accept that prop" allow-list for all 59 names; plus an `x-omelette` metadata block (`replaces: []` for every component — the replacement map is empty) | python inspection |
| `assets/fonts/` | D-DIN-PRO 400–900 `.otf` (same six files as HEAD `public/fonts/`) | dir listings both sides |

### 1.2 Do components ship `.d.ts` prop contracts as the Handoff Brief claims?

**Yes — verified.** Every one of the 53 `.jsx` files has a sibling `.d.ts` with a full typed props interface and JSDoc usage guidance (e.g. `components/buttons/Button.d.ts` declares `ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>,'children'>` with `variant/size/icon/iconPosition/loading`). The Handoff Brief's "Props are the data contract / read the `.d.ts` before wiring" principle is backed by real files. Two caveats:

- **The `.d.ts` describes the kit's props, which are frequently a *subset* of HEAD's** (see §4.2). Treating the kit `.d.ts` as the authoritative contract would silently drop HEAD capabilities — additive-parity violation.
- The readme claims `.jsx + .d.ts + .prompt.md` per component; only **6 of 53** have a `.prompt.md` (Button, StatCard, Badge, Input, SectionCard, WorkflowStepper). Minor doc drift, matters only if "regenerate from spec" is chosen (§2, option D).

### 1.3 What framework are they?

**Plain React function components (JSX), no TypeScript source, no Tailwind, no external deps.** Verified across all 53 files:

- Imports: `import React from 'react'` ×53; the single cross-import is `Badge` (2 files). Zero third-party imports.
- **Styling is 100% inline `style={{...}}` objects reading CSS custom properties** (`var(--surface-3)`, `var(--radius-md)`…). `className` appears in exactly one component — `Icon`, for Font Awesome classes (`Icon.jsx:53`). **No kit `.d.ts` declares a `className` prop (grep: 0 hits)**; only some components spread `...rest` (Button does; SectionCard does not).
- **Hover/focus states are mostly absent or JS-driven**: only 4 files use `onMouseEnter` (Popover, Tooltip, DataTable, NextStepsCard); 9 use hooks at all (`useState` etc.). Button has a `transition` but no hover style — inline styles cannot express `:hover`. The production-grade interaction polish lives at HEAD, not in the kit.
- **Overlays are not production-grade**: kit `Drawer.jsx` has no portal, no focus trap, no Escape handling, no scroll lock, and hard-codes `zIndex: 90/95` (`Drawer.jsx:23,36`); kit `Modal.jsx:15` hard-codes `zIndex: 100`; `Popover.jsx:15,19` uses 59/60; `Tooltip.jsx:29` uses 70. HEAD's `src/components/ui/overlay/Modal.tsx` is a portal with focus trap, Escape, focus-restore (`Modal.tsx:11,43,115–160`) and uses the token z-scale. The kit's own Build Conventions demand "Drawer/Modal focus-trap + return" as an AUTO a11y gate — **the kit's own overlays currently fail the kit's own gate**.
- **Raw z-index numbers in kit components collide with HEAD's token scale**: 59/60 sits at `--z-toast`/`--z-commerce-backdrop` (60), 70 at `--z-takeover`, 100 at `--z-command-palette` (`src/tokens.css:132–146`). Any port must re-map to `var(--z-*)`.
- **Mounting mechanism:** the bundle is only consumable as a `<script>` that populates `window.HmpsnStudioDesignSystem_09a9e3` and expects a global `React` — a design-canvas/preview mechanism (used by the `.dc.html` templates and the kit's HTML docs), **not** an ESM/npm packaging. The repo's Vite 8 + React 19 ESM app has no `window.React` and no reason to create one.

---

## 2. Integration path — the concrete options

Context that constrains every option: repo is React 19.2 + Vite 8 + Tailwind 4.2 + TS strict (`package.json:117,128,130–131`); pr-check enforces token parity, color laws, and component conventions; `src/components/ui/` already exports ~55 primitives from its barrel (`src/components/ui/index.ts`); ~30 of the kit's 59 names already exist at HEAD because the kit was derived from this repo (`readme.md` "Sources": "lifted directly from that repo's `src/components/ui/*` and `src/tokens.css`").

### Option A — Wrap the bundle (`_ds_bundle.js` + window namespace)
**Effort: low (days). Risk: unacceptable. Recommendation: reject for production.**
- Requires exposing global `React`/`ReactDOM` (dual-React hazard with the ESM app), defeats tree-shaking (1.39 MB unminified including the whole marketing `ui_kits/`), swallows component load errors via try/catch, has no TS types wired to the globals, and every component lacks `className`, so nothing composes with the existing Tailwind codebase.
- Violates HEAD conventions wholesale (TS strict, tokens-only z-index, a11y gates). The bundle exists so design tools/HTML docs can render the kit — that is its job; production is not.

### Option B — Copy the `.jsx` sources into `src/` as-is (allowJs)
**Effort: low-medium (1–2 weeks incl. build plumbing). Risk: high — functional regression by omission.**
- Would compile (Vite handles JSX; `.d.ts` siblings could type them), but:
  - HEAD's same-named components are **prop supersets** (§4.2) — every existing call site using `className`, `staggerIndex`, `tone`, `trailing`, `showZeroDelta`, `id`, statusConfig domains, etc. breaks or loses behavior. This is precisely the "losing a function by omission" hard stop.
  - Inline styles bypass pr-check's class-based color-law enforcement and Tailwind composition; hover/focus states regress; overlay a11y regresses (no focus trap); raw z-indexes collide with the token scale.
  - 21 CSS custom properties referenced by kit components **do not exist at HEAD** (verified by grep against `src/tokens.css`): `--font-display/sans/mono`, `--dur-fast/base/slow`, `--ease-out`, `--shadow-sm/md/lg`, `--shell-sidebar/-rail/topbar`, `--page-max/-narrow/-wide`, `--page-pad-x/y/bottom`, `--section-gap`, `--grid-gap`. Some usages carry fallbacks (`var(--dur-base, .2s)` in Drawer) but many don't (Button's `transition: all var(--dur-fast) ease`, `fontFamily: var(--font-sans)`) — silent visual degradation.

### Option C — Port/merge into `src/components/ui/` under HEAD conventions (RECOMMENDED)
**Effort: medium, front-loaded (~3–5 focused days for tokens + net-new primitives; visual reconciliation of existing primitives folds into the per-surface rebuild). Risk: low and inspectable.**
Treat the kit as: `.d.ts` = minimum prop contract, `.jsx` = pixel/visual spec, tokens = additions to `src/tokens.css`. Concretely:
1. **Token adoption first** (one PR): add the net-new token families (§3.3) to `src/tokens.css` (both `:root` and `.dashboard-light` scopes where themed), regenerate the `public/tokens.css` mirror via the existing `copyTokensPlugin()` (`vite.config.ts:12,64`), and satisfy pr-check `styleguide-token-parity` / `src-index-css-no-token-declarations` (`scripts/pr-check.ts:6651,6964`). Refactor `.t-*` classes in `src/index.css` to read the new `--font-*`/`--type-*` tokens (values already match — §3.2).
2. **Net-new components** (~16 files / 19 names, §4.3): implement each as TS + `className`-accepting + token-consuming components in `src/components/ui/`, using the kit `.jsx` as the visual spec and the kit `.d.ts` as the prop floor, then extend with HEAD conventions (forwardRef where HEAD peers do, `cn()` merge, `var(--z-*)`, lucide icons via existing `Icon`, reduced-motion via `overlay/reducedMotion.ts`). Drawer/Toast must reuse the focus-trap/portal machinery already in `overlay/Modal.tsx`.
3. **Existing components**: keep HEAD implementations and their superset props; restyle to match kit visuals where they drifted (e.g. adopt `variant: 'subtle'` on SectionCard, `side`/`eyebrow` options). Never delete a HEAD prop to match the kit `.d.ts`.
4. **Shell last**: AppShell/PageContainer/Sidebar/NavItem/NavGroup/Toolbar port as the layout foundation, wired to the existing `navRegistry.tsx`-driven nav (`src/components/layout/Sidebar.tsx:4–9` already consumes `NAV_REGISTRY`) rather than the kit's static-prop Sidebar.

### Option D — Regenerate from spec (prompt.md + screenshots)
**Effort: high. Risk: medium (fidelity drift).** Only 6/53 components have `.prompt.md`; the real spec is the `.jsx` itself. This option is strictly dominated by C (which reads the `.jsx` directly). Useful only as a fallback for a component whose `.jsx` is too prototype-y to port (candidate: none found).

**Bottom line:** the Handoff Brief's claim "the hard problem is wiring, not construction" is *half*-true. Data wiring is the biggest cost, yes — but there is a real, non-trivial construction step (Option C, steps 1–2) the Brief under-states: the 59 components are not production artifacts yet; they are typed visual specs. Budget the port explicitly or Phase 2 (pilot surface) will absorb it invisibly.

---

## 3. Token drift — kit vocabulary vs HEAD

### 3.1 Headline: far less drift than feared — the kit was lifted from HEAD

`tokens/colors.css` is value-for-value identical to `src/tokens.css:16–147` for: all 4 surfaces, all 6 text tiers, brand backgrounds, **`--brand-mint` family**, `--brand-yellow`, borders, overlay, scrollbar, the full zinc scale, all 10 accent hues, blue scale, and annotation colors. The light-mode block (`.dashboard-light, .light`) matches `src/tokens.css:151–239` value-for-value too.

**Explicit drift list (complete):**

| # | Dimension | Kit | HEAD | Verdict |
|---|---|---|---|---|
| 1 | **Mint vs teal** | Vocabulary is "mint" (readme: "Mint #2dd4bf — actions"); tokens define BOTH `--brand-mint: #2dd4bf` and `--teal: #2dd4bf` | Identical: HEAD defines both `--brand-mint` (`src/tokens.css:39`) and `--teal` (`:95`), same hex; CLAUDE.md/BRAND_DESIGN_LANGUAGE say "teal for actions" but already use `--brand-mint` tokens throughout (e.g. BRAND_DESIGN_LANGUAGE.md:155–157) | **Naming-only drift, zero value drift.** Same color, two doc vocabularies. Needs one canonical word (stop-and-ask #2) |
| 2 | **Typefaces** | DIN Pro (self-hosted 400–900) + Inter + JetBrains Mono; Fira Code explicitly "retired" (`tokens/fonts.css`) | DIN Pro already self-hosted at HEAD (`src/index.css:6–11`, `public/fonts/` has the same 6 .otf files); Inter loaded from Google (`src/index.css:1`); mono stack lists **'Fira Code' first, JetBrains second** (`src/index.css:602,611`) and **loads neither webfont** (falls through to Menlo) | DIN Pro/Inter: **no drift**. Mono: kit flips preference to JetBrains and actually loads it; HEAD's Fira-first stack is dead weight. Small, real drift |
| 3 | **Font-family tokens** | `--font-display/sans/mono` (`tokens/typography.css`) | Absent — families hard-coded per class in `src/index.css` | **Net-new token family** (21-token gap incl. below; grep-verified) |
| 4 | **Type scale** | `.t-*` utilities in `guidelines/type-scale.css` + `--type-*` role tokens | Same 14 `.t-*` classes, same px sizes/weights/tracking (`src/index.css:501–618`) | Sizes: **identical**. Three micro-drifts: (a) kit `.t-*` classes **set `color:`** (e.g. `.t-hero` → `--brand-text-bright`, `.t-label` → `--zinc-400`); HEAD's set none — porting kit classes verbatim would override call-site text colors; (b) HEAD stat/mono classes carry `font-variant-numeric: tabular-nums` (`src/index.css:533,542,551,606,617`), kit's have **none** (grep: 0) — a regression for data UI if adopted verbatim; (c) kit adds `.eyebrow` — exists in `public/styleguide.css:94` but **not** in `src/index.css` → net-new app utility |
| 5 | **Spacing scale** | `--space-1…16` (4px rhythm) | Absent | Net-new |
| 6 | **Layout/boundary tokens** | `--shell-sidebar/rail/topbar`, `--page-max/-narrow/-wide`, `--page-pad-x/y/bottom`, `--section-gap`, `--grid-gap/-lg`, `--bp-sm/md/lg` (`tokens/layout.css`) | Absent — shell dims hand-rolled in Dashboard/Sidebar | Net-new; this is the kit's genuinely valuable addition |
| 7 | **Motion tokens** | `--ease-out`, `--ease-draw`, `--dur-fast/base/slow`, `--stagger-step` | Absent | Net-new |
| 8 | **Shadow tokens** | Adds `--shadow-sm/md/lg/glow` alongside `--brand-shadow-sm/md` | Only `--brand-shadow-sm/md` (`src/tokens.css:54–55`) | Net-new additions; note two shadow families will coexist — needs a deprecation direction |
| 9 | **Z-index** | `tokens/effects.css` has the HEAD scale **minus** `--z-commerce-backdrop` (60), `--z-commerce-drawer` (61), `--z-client-toast` (80) (`src/tokens.css:140–143`) | HEAD superset | **Kit is missing 3 production z-tokens** — must NOT be dropped (checkout drawer/toast layering depends on them). And kit components ignore the scale entirely (raw 59/60/70/90/95/100, §1.3) |
| 10 | **Radius / icon sizes / chart tokens / blue scale / annotation colors** | Identical values incl. `--radius-signature(-lg)` | Identical (`src/tokens.css:62–130`) | No drift |
| 11 | **Surface scale** | `--surface-1..3, -active` identical; readme documents surface-1 = darkest z-depth semantics | Identical | No drift |
| 12 | **base.css globals** | Body = Inter (`--font-sans`) w/ `letter-spacing:-0.005em`, h1–h6 = display font, keyboard-only mint focus ring, noise overlay | HEAD body also Inter (`src/index.css:17`) | Near-identical by construction; adopt selectively (focus-ring rule is a good add; noise overlay is a design decision) |

### 3.2 Does `.dashboard-light` exist at HEAD, or is light theme net-new?

**It exists and is live at HEAD — light theme is NOT net-new.** `src/tokens.css:151` defines the `.dashboard-light, .light` override block (25+ vars, WCAG-adjusted accents); it is applied at runtime in `src/App.tsx:152–158` (`theme === 'light' ? 'dashboard-light' : ''`) and `src/components/ClientDashboard.tsx:673`, and `src/components/ui/constants.ts:6–10,77–85` provides theme-aware helpers (`themeColor()`, score colors) keyed off `document.querySelector('.dashboard-light')`. The kit's light block matches HEAD's values. What IS true: many older admin components still carry `/* arbitrary-text-ok: has .dashboard-light override */` patches (e.g. `src/components/audit/AuditFilters.tsx:58`) — light theme *coverage* is uneven at HEAD, and the rebuild's "both themes by construction" bar is a genuine improvement target, not a from-scratch build.

### 3.3 Token adoption punch-list (Option C step 1)

Add to `src/tokens.css` (and `.dashboard-light` where themed): `--font-*` (3), `--type-*` (~30 role tokens), `--space-*` (10), layout tokens (12), motion (6), `--shadow-sm/md/lg/glow` (4, light overrides too). Keep HEAD-only tokens the kit lacks: `--z-commerce-*`, `--z-client-toast`, `--radius` legacy alias, `--brand-shadow-*`. Then mirror to `public/tokens.css` (build does this) and update `public/styleguide.css` demos per pr-check parity rules.

---

## 4. Component mapping — kit 59 vs HEAD `src/components/ui/`

### 4.1 Same-name matches — HEAD implementation survives, kit = visual spec (28 names)

Button, IconButton, CompactStatBar, DataList, MetricRing, StatCard, TrendBadge, Badge, EmptyState, ProgressIndicator, Skeleton, StatusBadge, NextStepsCard, OnboardingChecklist, WorkflowStepper, Checkbox, Toggle, Icon, Grid, Modal, PageHeader, Popover(+MenuItem→HEAD `Menu`), SectionCard, Stack, Row, TabBar, Tooltip, ICON_NAMES(≈HEAD lucide imports).

Prop-contract spot checks (the pattern generalizes — **HEAD is the superset**):

| Component | Kit props | HEAD extras the kit lacks | Kit extras HEAD lacks | Evidence |
|---|---|---|---|---|
| SectionCard | title, titleIcon, titleExtra, action, children, noPadding, interactive, variant, style | `id`, `className`, stagger index | `variant: 'default'|'subtle'` | kit `SectionCard.d.ts`; `src/components/ui/SectionCard.tsx:3–28` |
| StatCard | label…size, style | `showZeroDelta`, `trailing`, `className`, `staggerIndex`, `tone` | — | kit `StatCard.d.ts`; `StatCard.tsx:35–57` |
| Button | variant/size/icon/iconPosition/loading | (variants identical: primary/secondary/ghost/danger/link) | — | kit `Button.d.ts`; `src/components/ui/Button.tsx:6–7` |
| Badge | `tone` incl. **'purple'** | prop is named **`color`**; purple was deliberately **removed** from the union (CLAUDE.md Four Laws; `Badge.tsx:5` has no purple) | re-adds purple; renames prop | kit `Badge.d.ts:3,14`; `src/components/ui/Badge.tsx:5,13` |
| DataList | items(label,value,valueColor,sub), `showRank`, `onRowClick`, style | `ranked`, `maxHeight`, `className`, per-item `extra`, built-in EmptyState | `onRowClick` | kit `DataList.d.ts`; `src/components/ui/DataList.tsx:5–20` |
| Icon | FA Sharp Regular registry (`name`→`fa-*` string), requires external `kit.fontawesome.com` script | HEAD Icon wraps **lucide-react** components (`as: LucideIcon`), 6 sizes, a11y span semantics | FA registry, raw-`fa` escape hatch | kit `Icon.jsx:9–53`, `Icon.d.ts`; `src/components/ui/Icon.tsx:1–18`; `package.json:110` (lucide-react; **no** fontawesome dep, none in `index.html`) |
| Modal | plain fixed div, zIndex 100 | portal, focus trap, Escape, focus restore, reduced-motion | — | kit `Modal.jsx:15`; `overlay/Modal.tsx:11,43,115–160` |

Note the internal kit inconsistency on icons: kit **leaf components** declare `icon?: ComponentType` documented as "Lucide icon component, e.g. `ArrowRight`" (`Button.d.ts`, `StatCard.d.ts`, `SectionCard.d.ts`) — i.e. compatible with HEAD's lucide usage — while the kit **Icon/ICON_NAMES** is Font Awesome. The FA dependency is contained to Icon/ICON_NAMES and the readme's iconography section.

### 4.2 Renamed / re-homed equivalents (HEAD survives; map, don't duplicate)

| Kit | HEAD counterpart | Note |
|---|---|---|
| Input / Select / Textarea / FieldGroup | `ui/forms/FormInput / FormSelect / FormTextarea / FormField` | HEAD forms carry FormFieldContext, aria-invalid wiring, commitOnBlur, maxLength counters (BRAND_DESIGN_LANGUAGE.md:155) — supersets |
| Breadcrumb | `src/components/layout/Breadcrumbs.tsx` | HEAD version is navRegistry-driven (single source since W3.4) |
| Sidebar / NavItem / NavGroup | `src/components/layout/Sidebar.tsx` | HEAD Sidebar consumes `NAV_REGISTRY`, feature-flag hiding, workspace selector, NotificationBell (`Sidebar.tsx:4–17`) — kit's static-prop nav chrome is a visual spec only |
| Stack / Row | `ui/layout/Stack.tsx / Row.tsx` (+ HEAD-only `Column`, `Divider`) | |

### 4.3 Kit components with NO shared HEAD primitive — the genuine additions (19 names / 16 files)

DataTable, KeyValueRow(+DefinitionList), Meter, MetricTile, Sparkline, Avatar, IntentTag, Toast, BoardColumn(+BoardCard), FilterChip, LensSwitcher, RadioGroup, SearchField, Segmented, AppShell, PageContainer, Drawer, GroupBlock, Toolbar(+ToolbarSpacer).

These match the Primitive Reuse Audit's findings of hand-rolled duplication at HEAD: e.g. Drawer ≈ 5+ per-feature drawers (`src/components/KeywordHub.tsx`, `client/SeoCart.tsx`, `local-seo/LocalSeoMarketSetupDrawer.tsx` — grep hits), DataTable ≈ 7 hand-rolled grid tables, Segmented ≈ 15 hand-rolled lens switchers, Toast ≈ per-feature `setToast` state (`src/hooks/useContentRequests.ts:9`). **Adopting these consolidates real HEAD duplication — this is where the kit adds capability rather than re-skinning it.** Each must be built to production grade (portals, focus management, keyboard nav) since the kit `.jsx` versions are visual-only (§1.3).

### 4.4 HEAD primitives with NO kit counterpart — must survive (additive-parity critical)

The kit's 59 do **not** cover ~27 shared primitives HEAD ships today (from `src/components/ui/index.ts`):

AIContextIndicator, CannibalizationAlert, CharacterCounter, ChartCard, ClickableRow, ConfirmDialog, DateRangeSelector, Disclosure, ErrorState (+NetworkError/DataError/PermissionError), FeatureFlag, FreshnessStamp, InlineBanner, LoadingState (+TableSkeleton), Menu, MetricToggleCard, NeedsAttention, OutcomeReadbackChip, ScannerReveal, SectionLabel, SerpPreview, SocialPreview, TierGate/TierBadge, WorkspaceHealthBar, the typography set (Heading/Stat/BodyText/Caption/Label/Mono), Column, Divider, plus the non-component exports: `statusConfig` domains, `scoreColor()/scoreColorClass()` and the chart/theme helper suite in `ui/constants.ts`, skeleton presets (StatCardSkeleton/OverviewSkeleton/AnalyticsSkeleton). Client-side there are also the shared inbox components (`DecisionDetailModal`, `DecisionCard`, `ApprovalBatchCard`, `PriorityStrip`, `SchemaReviewModal` in `src/components/client/`).

The Handoff Brief's house rule #1 ("Compose surfaces from [the 59]… Don't re-implement one that exists") **must be read as bidirectional**: the design system gains these HEAD primitives (restyled on-system), not the other way around. Notably `ErrorState`, `TierGate`, `ConfirmDialog`, `DateRangeSelector` are load-bearing for the kit's own Build Conventions (error state, permissioned/locked state, pessimistic-confirm mutations, date-scoped analytics) — the kit prescribes the behaviors but ships no component for them.

### 4.5 Adherence lint (`_adherence.oxlintrc.json`) — usable?

It encodes exactly the right rules (raw-hex ban, raw-px ban, off-system fonts, per-component prop allow-lists for all 59) but as **oxlint** config at **warn** level, keyed to kit-internal import paths (`components/buttons/**`…). The repo's enforcement stack is eslint (`eslint.rules-of-hooks.config.js`) + `scripts/pr-check.ts`. Direct adoption won't run in CI as-is; the Build Conventions doc itself says to "point the app's linter at it." Realistic path: port the raw-hex/raw-px selectors into pr-check rules (per `docs/rules/pr-check-rule-authoring.md`) and regenerate the prop allow-lists from the *merged* TS prop types after the port (the kit's lists would flag HEAD's superset props — e.g. `className` — as violations, which is exactly backwards).

---

## 5. Key risks summarized

1. **Prop-loss by kit adoption** — every same-name kit `.d.ts` is a subset of HEAD's props; treating kit contracts as authoritative deletes capability silently (hard-stop class of bug). Merge direction must be HEAD-props ∪ kit-props.
2. **The 59 don't cover HEAD's primitive inventory** — ~27 shared UI primitives + helper suites have no kit home and must be carried forward explicitly (§4.4).
3. **Kit overlays fail the kit's own a11y gates** — no focus trap/portal/Escape in Drawer/Modal; raw z-indexes collide with the production z-scale (§1.3).
4. **21 missing tokens** — kit components reference token families HEAD doesn't define; without the token PR first, ported visuals silently degrade (§3.3).
5. **Icon-system fork** — FA Sharp Regular (external kit script, licensing, CSP implications) vs lucide-react (bundled, used at hundreds of HEAD call sites). Leaf components are compatible with either; Icon/ICON_NAMES is not.
6. **Purple Badge regression** — kit re-introduces `'purple'` into the Badge tone union that HEAD deliberately removed per the Four Laws; adopting the kit union would re-open a closed policy hole.
7. **Construction cost is understated** — "the pieces are done" is true as *specs*; ~16 net-new components still need production implementations before any surface can be assembled from them.

---

## 6. Stop-and-ask (owner decisions required — not decided here)

1. **Integration path sign-off.** Recommend Option C (port/merge under HEAD conventions, HEAD props win, kit = visual spec + prop floor). Explicitly confirms Option A/B are off the table. Anything else contradicts the additive-parity mandate.
2. **Canonical action-color vocabulary: "mint" or "teal"?** Same hex, two names across CLAUDE.md/BRAND_DESIGN_LANGUAGE ("teal") and the kit ("mint"). One word must win everywhere (docs, token aliases, pr-check messages) or agents will keep forking.
3. **Icon system: lucide-react (HEAD) or Font Awesome Sharp Regular (kit)?** FA implies a paid kit script (`kit.fontawesome.com`), an external runtime dependency, and a migration of hundreds of lucide call sites; lucide implies restyling the kit's Icon/ICON_NAMES contract onto lucide names. The kit's own leaf `.d.ts` files assume Lucide-style component icons, so lucide is the lower-risk reading — but the readme says FA is "the icon system." Owner call.
4. **Badge: does `'purple'` return to the tone union (kit) or stay removed (HEAD policy)?** Also: kit prop `tone` vs HEAD prop `color` — pick one and alias the other during migration.
5. **Same-name/different-contract components (DataList is the concrete case):** merge props under the existing name, or rename the kit shape (it is closer to a simple ranked list + row-click)? Any answer must keep HEAD's `ranked/maxHeight/extra/className` behavior reachable.
6. **Shadow token duplication:** kit adds `--shadow-*` beside HEAD's `--brand-shadow-*`. Adopt both with a documented deprecation direction, or rename on ingest?
7. **Mono font:** ratify the kit's "JetBrains Mono, Fira Code retired" (which means actually loading JetBrains Mono, today HEAD loads no mono webfont), or keep HEAD's stack as-is?
8. **`.t-*` class color declarations:** kit's type utilities bake text colors in; HEAD's don't (color set at call sites). Adopting kit behavior changes rendering at every existing `.t-*` call site — keep HEAD behavior (recommended) or migrate?
9. **Adherence enforcement home:** port the oxlint rules into `scripts/pr-check.ts` (repo-native) vs adding oxlint as a second linter? (Prop allow-lists must be regenerated from merged TS types either way.)
10. **base.css noise overlay + global focus ring:** adopt the kit's 3%-noise texture and global keyboard-only mint focus ring into `src/index.css`? Both are visible product-wide changes.

---

*Auditor: read-only Phase 0 agent · sources verified at file:line as cited · kit paths relative to `hmpsn studio Design System/` · this file is the auditor's single write.*
