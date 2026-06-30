# Design Cleanup Sprint — Pre-Plan Audit

**Date:** 2026-06-30
**Spec:** `docs/design-cleanup/design-cleanup-sprint.json` (30 items, 6 waves) + `docs/design-cleanup/design-cleanup-working-agreement.md`
**Baseline:** `origin/staging` @ `348cee8f5` (audited in worktree `asset-dashboard-design-cleanup`)
**Method:** 12-agent workflow (10 parallel Explore finders + 2 adversarial verifiers), ~937K subagent tokens, 253 tool calls.
**Coverage:** Completeness critic swept all 730 files / 31 component subdirs + utils/lib/hooks. `src/assets`, `src/types`, `src/api` confirmed clean of color patterns.

> All 23 cited existing file paths were independently confirmed present on `origin/staging`. The 4 "missing" paths (`NeedsAttention.tsx`, `Menu.tsx`, `Disclosure.tsx`, `SectionLabel.tsx`) are the new primitives to create — correctly absent.

---

## 1. Color / token drift (Wave 0b) — findings by category

### 1a. Mint-on-static-data (`design-color-law-sweep-mint-on-data`, `design-cp-healthbar-color`)
**16 confirmed violations** (verifier: classifications accurate; 2 "uncertain" Badge items resolved as **NON-violations** — see §4).

| File | Lines | Current | Fix |
|------|-------|---------|-----|
| RevenueDashboard.tsx | 138, 185, 203, 231 | `text-accent-brand` on revenue/amount/count | → `text-accent-info` (blue, data) |
| WorkspaceOverview.tsx | 116, 134, 393, 408 | `text-accent-brand` on pending/active counts | → `text-accent-info` (blue) |
| WorkspaceOverview.tsx | 428 | `text-accent-brand` on **delivered** count | → `text-accent-success` (emerald, completed) |
| WorkspaceOverview.tsx | 484 | `text-accent-brand` on activity icon | → `text-accent-info` (blue) |
| ContentPipeline.tsx | 176 | `text-accent-brand` Clipboard/briefs icon (health bar) | → `text-accent-info` |
| RequestManager.tsx | 233 | `text-accent-brand` active count | → `text-accent-info` |
| ContentPerformance.tsx | 107, 110, 269 | `bg-teal-500/10 text-accent-brand border-teal-500/20` static type badges | → blue badge (or `<Badge tone="blue">`) |

**NON-violations (verifier-confirmed, leave alone):** WorkspaceOverview.tsx:443/446 `<Badge tone="teal">` ('in review' / 'live') — `tone` is a semantic Badge prop (internal `BADGE_TONE_CLASSES`), not raw mint-on-data. (`'live'`→`tone="emerald"` is an optional product polish, not a law violation.) App.tsx:387/471 — interactive (button + status bar). insights/* teal — on interactive elements.

### 1b. Hardcoded hex + purple-on-data (`design-wh-purple-on-data` + broader tokenize theme)
**116 hex instances across ~60 files**, but the large majority are **legitimately mapped** to `CHART_SERIES_COLORS` (`src/components/ui/constants.ts`) or brand-justified with `// chart-hex-ok` (`#059669` OpenAI, `#ea580c` Anthropic). The **actionable in-sprint subset:**

- **3 Law-4 purple violations** (`#a78bfa` on data stat cards): `WorkspaceHome.tsx:413-424` (GA4 Users), `LlmsTxtGenerator.tsx:212` (Content Lines), `SiteArchitecture.tsx:330` (Strategy Pages) → all `#60a5fa` (blue-400).
- **WorkspaceHome sibling iconColor hexes** (`#22d3ee`, `#f87171`, `#22c55e`, `#f59e0b`) → map to `CHART_SERIES_COLORS`.

**Broader hex→token tokenization** (RedirectManager, SiteArchitecture, LocalSeoVisibilityPanel, GbpAuthenticatedReviewsPanel, OutcomeScorecard, matrix/CellDetailPanel, client charts, etc.) is real but **OUT of the 30-item sprint scope** — see §6 "New discoveries." A few unmarked chart hexes need a `chart-hex-ok` marker or a var: `ScoreTrendChart.tsx` (`#2ed9c3`), `pageRewriteChatActions.ts:78` (`#0d9488`).

### 1c. Raw amber/red warning surfaces (`design-ac-staleness-tokens`, `design-cd-trial-banner-tokens`, `design-cp-consolidate-alert-bands`)
**6 surfaces + the InlineBanner root.** The soft-warning/danger token utilities **already exist** in `src/index.css` (~lines 198-210): `.bg-accent-warning-soft`, `.border-accent-warning-soft`, `.bg-accent-danger-soft`, `.border-accent-danger-soft`. Consumers bypass them with raw Tailwind.

| Surface | File:lines | Item |
|---------|-----------|------|
| POV-staleness nudge | KeywordStrategy.tsx:658-660 (also 596-602) | design-ac-staleness-tokens |
| Strategy staleness nudges (v2) | StrategyStalenessNudges.tsx:20, 33 | **NEW** → fold into design-ac-staleness-tokens |
| Trial countdown | ClientDashboard.tsx:668-674 (~753) | design-cd-trial-banner-tokens |
| Trial ended | ClientDashboard.tsx:688-694 (~764) | design-cd-trial-banner-tokens |
| Section-errors banner | ClientDashboard.tsx:698-707 (InlineBanner, no tone) | fixed by InlineBanner root |
| Content decay/cannibalization bands | ContentPipeline.tsx:187 | design-cp-consolidate-alert-bands |

**KEYSTONE:** `InlineBanner.tsx` `TONE_STYLES` (lines ~29-56) themselves use raw Tailwind (`border-red-500/20 bg-red-500/8`, `text-amber-100/80`). Migrating `TONE_STYLES` → the existing soft tokens fixes the section-errors banner for free and gives every banner one definition. **(Correction — D2 was a false positive:** `.bg-accent-danger-soft`/`.border-accent-danger-soft` at `src/index.css:201/208` already use `var(--red)` correctly; no bug. Verified post-audit by two plan-review critics + direct read.)

---

## 2. Primitive-extraction consumer hunts (Wave 0)

### 2a. NeedsAttention (`design-x-needs-attention-shared`)
- **2 in-sprint consumers:** `WorkspaceOverview.tsx:76-218` (dot/icon + label + workspace name + Badge + ChevronRight, ClickableRow, cap-8 + "show N more", 8 priority levels) and `WorkspaceHome.tsx:167-219/520-585` (colored icon + label + sub + ArrowUpRight, ClickableRow, collapsible "setup suggestions" subgroup at p3).
- **1 divergent consumer — do NOT force in:** `strategy/StrategyCockpit.tsx` via `NeedsAttentionStrip.tsx` (shape `{recId, title, kind, detail}` + CTA button + `onAct` callback, card-based not row-based). Different contract (recId/kind/callback vs href/navigate). Note as a possible later adopter; keep its own component for now.
- Severity→color map is duplicated inline in both (red=danger, amber=warning, teal=info, emerald=success). Extract to the new component.

### 2b. Disclosure (`design-x-disclosure-pattern`, unblocks `design-issue-roi-double-mount`)
- **2 spray-painted primaries (in-sprint):** `KeywordStrategy.tsx:700-767` "Supporting detail" (8 surfaces: AdminLeadsReadout, keyword-targets row, ContentWorkOrderLens, TrustLadderPanel, orient, contentGaps, cannibalization, strategyDiff, competitor link) and `TheIssueClientPage.tsx:348-375` "Under the hood".
- **ROI double-mount:** `TheIssueClientPage.tsx` mounts `<ROIDashboard compact />` at slot-3 (~line 278) AND `<ROIDashboard compact={false} />` inside "Under the hood" (~line 359). Fix = keep compact at slot 3; "Under the hood" holds methodology/tables only.
- **~8 other `<details>`** (ROIDashboard methodology, IssueYourLeadsSection, DeepDiveTab, HealthScoreCard, HealthImpactLine, ContentTab, OrganizePreview, HubAdvancedFilters) + **15+ hand-rolled** useState/useToggleSet expand-collapse → large fast-follow consumer surface (not all in-sprint).

### 2c. Menu (`design-x-menu-primitive`) + TabBar adoption (`design-cp-use-tabbar-primitive`)
- **In-sprint:** ContentPipeline Export (`ContentPipeline.tsx:89-122, 250-289`: useState + mousedown click-outside + useRef + absolute panel + per-row CSV/JSON) → new Menu. Sub-tab bar (`228-247`: Button ghost + `border-b-2 border-teal-400`) → existing **TabBar primitive** (already has arrow-key nav + teal active).
- **~10 other hand-rolled menus** (SearchableSelect, SeoGlossary, HubAdvancedFilters, AnnotatedTrendChart, WorkspaceSelector, MatrixGrid) → fast-follow. **Latent bug:** `AiSuggested.tsx` snooze menu has no click-outside handler (fix when adopting Menu). Extract a shared `useClickOutside` hook (8+ duplicated impls).
- **Excluded** (not menus): NotificationBell (drawer), CommandPalette (keyboard modal), AdminChat (resizable panel).

### 2d. Gradient card tone (`design-x-gradient-card-variant`)
- **13 hand-rolled `bg-gradient-to-br from-<hue>-500/<n>` + matching border** cards. In-sprint primaries: `IssueVerdictHeadline.tsx:73` (teal /8 /15), `OutcomeCountBand.tsx:106` (emerald /10 /20).
- Other consumers (fast-follow): NarratedStatusHeadline, IssueContentCard, IssueLoopFooter, OverviewTab×2, **ROIDashboard×6** (incl. a conditional teal/amber at :258). Add `tone?: 'neutral'|'teal'|'emerald'|'blue'|'amber'` to StatCard/card at ONE canonical opacity.

### 2e. Section-header (`design-x-section-header`)
- **3 treatments for one job:** (1) `h2.t-label` muted kicker (TheIssueClientPage:277,325), (2) `SectionCard` title bar — hardcodes `t-body font-semibold` (`SectionCard.tsx:~68`), (3) `<summary>` kicker (under-the-hood rows). Standardize: `SectionLabel` (t-label kicker) for top-level sections; SectionCard headers for cards within a section; `<summary>` only inside Disclosure.

---

## 3. Existing coverage (gates)

- **pr-check.ts: 180 rules** (158 errors, 22 warnings). Directly relevant: purple-in-client (no escape), forbidden-hues violet/indigo/rose/pink (no escape), `text-green` for score (`// green-ok`), raw zinc text/bg/border (`// raw-zinc-ok`), raw radius (`// rounded-literal-ok`), `radius-signature-lg` outside SectionCard (justification), raw `<button>` (`// button-ok`), hand-rolled gradient CTA (no escape), `blue-action-semantic-drift` (`// blue-action-ok`), `status-semantic-mapping-drift` (`// status-semantic-ok`), arbitrary text-size (`// arbitrary-text-ok`), z-index (`z-index-ok`), hardcoded dark hex in inline styles / SVG (no escape — use chart helpers).
- **`data/style-drift-baseline.json`:** all 6 counts at **0** (`raw_button_unallowlisted`, `raw_typography_bypass`, `raw_radius_literal`, `disallowed_hue`, `non_primitive_action`, `exception`). ⚠ **Nuance:** these 6 metrics track button/typography/radius/hue — they do **NOT** directly count "mint-on-static-data." So the color sweep mainly satisfies the **pr-check rules** (`blue-action-semantic-drift`, `status-semantic-mapping-drift`), not the drift baseline number. The working agreement's "report-style-drift count goes down" applies to radius/hue/button items, not the mint sweep. Keep both green; don't expect the mint sweep to move the 6 counts.
- **InlineBanner** already has all 4 tones; **TabBar** already has arrow-key nav + teal active; **StatCard** already has `size='hero'` + `iconColor`/`valueColor`/`trailing`/`staggerIndex` (no `tone`). **NeedsAttention/Menu/Disclosure/SectionLabel confirmed absent.** New primitives → `src/components/ui/` (overlay subdir exists for Menu if preferred; spec says `ui/Menu.tsx`).

---

## 4. Verify-phase corrections (accuracy adjustments)

1. **2 false positives removed:** WorkspaceOverview.tsx:443/446 `<Badge tone="teal">` are NOT mint-on-data violations (semantic Badge prop). → Drop from the sweep.
2. **Unmarked chart hexes** to mark or tokenize: `ScoreTrendChart.tsx` (`#2ed9c3`/`#22d3ee`), `pageRewriteChatActions.ts:78` (`#0d9488`). → add `// chart-hex-ok` or a var (small, fold into 0b or note).
3. **Verify-not-assume during execution:** `statusConfig.ts:32,35` maps `in-review`/`live` → teal (confirm these are status states, keep), `NextStepsCard.tsx` `var(--teal)` group-hover on static text (check), `WorkflowStepper` teal on completed steps (state signaling — acceptable), ChatPanel/AnomalyAlerts purple (confirm admin-only — likely fine per Law 4).
4. **Coverage gaps acknowledged:** hex (40+) and gradient (15+) entries were sampled by the verifier, not 100% re-verified — the finder lists are the working set; execution agents must re-read each file before editing (read-before-write).

---

## 5. Infrastructure recommendations

**Shared utilities to extract:**
- `useClickOutside(ref, onOutside)` hook — 8+ duplicated implementations (consumed by Menu + others).
- Severity→color map (`AttentionSeverity → token`) — inside NeedsAttention, single source.
- Gradient `tone` token set — one canonical opacity (`from <accent>/8/10`, `border <accent>/15/20`) baked into StatCard/card.
- `SectionLabel` (or documented rule) — one t-label kicker treatment.

**pr-check rules to ADD (prevent recurrence):**
- `mint-on-static-data` — flag `text-accent-brand` / `var(--teal)` on non-`<button>`/non-`<a>` text (the sweep's enforcement; currently only partially covered by `blue-action-semantic-drift`).
- `raw-warning-surface` — flag raw `bg-amber-500/*`, `border-amber-500/*`, `bg-red-500/*`, `border-red-500/*` on banner-like containers (route through InlineBanner/soft tokens).
- `hand-rolled-details` / `hand-rolled-dropdown` — flag new `<details>` and `useState(open)+mousedown` panels outside the Disclosure/Menu primitives.
- `hand-rolled-gradient-card` — flag `bg-gradient-to-br from-*-500/` outside the StatCard tone prop.

**Tests required:** `NeedsAttention.test.tsx`, `Menu.test.tsx` (keyboard + click-outside dismiss), `Disclosure.test.tsx` (keyboard + reduced-motion), StatCard tone snapshot, SectionLabel render. Flag-OFF byte-identical assertions for the 3 flag-gated screens (the-issue-client-spine, strategy-the-issue/command-center, client-ia-v2).

---

## 6. New discoveries beyond the original 30 items (scope deltas)

These were NOT in the spec's `files` lists; recommend folding the small ones in, deferring the large one:

| # | Discovery | Recommendation |
|---|-----------|----------------|
| D1 | `InlineBanner.tsx` TONE_STYLES use raw Tailwind (the root of the trial/section-errors items) | **Fold into 0b** — fix once (keystone), add to `design-cd-trial-banner-tokens` files |
| D2 | ~~Possible bug: danger-soft uses `var(--amber)`~~ | **FALSE POSITIVE — verified correct** (`src/index.css:201/208` use `var(--red)`). No fix. Optional: add a guard test locking danger-soft to a red-based computed color. |
| D3 | `StrategyStalenessNudges.tsx:20,33` raw amber (same pattern as POV-staleness) | **Fold into `design-ac-staleness-tokens`** |
| D4 | Repo-wide hex→`CHART_SERIES_COLORS` tokenization (~50+ instances beyond the 3 purple) | **INCLUDED** per owner decision (2026-06-30) — tracked as new item `design-x-hex-tokenize-sweep` in `data/roadmap.json` (sprint now 31 items), Wave 0b T0b.2b |
| D5 | `AiSuggested.tsx` snooze menu missing click-outside | Fix when adopting Menu (note in `design-x-menu-primitive`) |
| D6 | Unmarked chart hexes (ScoreTrendChart, pageRewriteChatActions) | Add `// chart-hex-ok` markers (fold into 0b) |
| D7 | Disclosure/Menu have ~25 total hand-rolled consumers | In-sprint = the named primaries only; the rest are explicit fast-follow (log, don't silently expand) |

---

## 7. Parallelization strategy + model assignments

Platform: **Claude/Anthropic.** Two tracks (design-system foundations ∥ screen waves), screens pull from foundations as they land. Phase-per-PR, staging-first, flag-OFF byte-identical.

```
Wave 0 (foundations: components)  ∥  Wave 0b (foundations: color/token)
        │                                  │
        └──────────────┬───────────────────┘
                       ▼
   W1 Command Center → W2 Workspace Home → W3 The Issue → W4 Pipeline → W5 Client shell
   (W5 can run on its own track in parallel — heaviest, most isolated)
```

| Wave | Items | Parallelism | Model |
|------|-------|-------------|-------|
| 0 — components | needs-attention-shared, disclosure, menu(+useClickOutside), gradient-tone, section-label | 5 parallel (distinct new files in `ui/`) | **Sonnet** build / **Opus** review (shared primitives = high reuse) |
| 0b — color/token | mint-sweep, purple Law-4, **repo-wide hex→token sweep**, InlineBanner+trial+staleness tokens, healthbar-color | mint-sweep ‖ banner-tokens; hex-sweep + cp-healthbar after mint-sweep (shared files) | **Haiku** single-file mint recolor / **Sonnet** repo-wide hex sweep + InlineBanner refactor |
| 1 — Command Center | header-primary-action, needs-attention-hero*, statrow-hierarchy*, workspace-row-density | header + row-density parallel; hero→statrow sequential (*dep on W0 + each other) | **Sonnet** |
| 2 — Workspace Home | setup-triplicated→health-four-ways, statcard-hierarchy→worklist-order | sequential chains (shared file WorkspaceHome.tsx) | **Sonnet** |
| 3 — The Issue | plan-above-proof, roi-double-mount*(dep W0 disclosure), pending-surfaces, ac-send-near-staging, ac-add-rec-placement | client vs cockpit parallel | **Sonnet** |
| 4 — Pipeline | unify-stepper-tabs, use-tabbar-primitive*(dep W0 menu/tabbar), consolidate-alert-bands | sequential (shared ContentPipeline.tsx) | **Sonnet** |
| 5 — Client shell | finish-ia-v2-nav (L)→dedupe-panel-mounts, notice-region*(dep W4), pageheader-title-echo | finish-nav first; others after | **Opus** (nav migration = broad blast radius) |

**File-ownership hotspots (serialize edits):** `WorkspaceOverview.tsx` (W0b mint + W1 ×4), `WorkspaceHome.tsx` (W0b + W2 ×4), `ContentPipeline.tsx` (W0b + W4 ×3), `KeywordStrategy.tsx` (W0b staleness + W3 cockpit ×3), `ClientDashboard.tsx` (W0b banners + W5 ×4), `TheIssueClientPage.tsx` (W3 ×2), `StatCard.tsx` (W0 tone + W0b — coordinate), `InlineBanner.tsx` (W0b root). Within a wave these are single-owner sequential, never parallel.
