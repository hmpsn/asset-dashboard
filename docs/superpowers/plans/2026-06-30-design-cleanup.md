# Design Cleanup Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore hierarchy and consolidate the design system across six surfaces (Command Center, Workspace Home, The Issue client + cockpit, Content Pipeline, Client shell) by extracting 5 shared primitives, enforcing the four color laws repo-wide, and reordering/de-duplicating each screen — 31 items in 6 waves, UI-only, staging-first.

**Architecture:** Two tracks. A **design-system track** (Wave 0 components ∥ Wave 0b color/token discipline) front-loads shared pieces so screen waves consume finished primitives instead of hand-rolling them; several screen findings disappear once the primitive ships. A **product track** (Waves 1–5) reorders each screen. Phase-per-PR, staging-first; every flag-OFF branch stays byte-identical.

**Tech Stack:** React 19, Vite 8, TailwindCSS 4 (token-backed semantic utilities), TypeScript strict, Vitest (unit/component/contract), Playwright (e2e), `preview_*` tools for real-browser verification.

**Canonical inputs:** `docs/design-cleanup/design-cleanup-sprint.json` (per-item notes/acceptanceCriteria/verify), `docs/design-cleanup/design-cleanup-working-agreement.md` (guardrails + primitive API specs §4), `docs/superpowers/audits/2026-06-30-design-cleanup-audit.md` (verified file/line scope).

---

## Global Execution Discipline (applies to EVERY task — stated once)

Per `docs/PLAN_WRITING_GUIDE.md` "Plans Are Contract + Test-Centric": this plan locks **contracts, test assertions, file ownership, and verification** — it does **not** pre-bake implementation bodies. For each task:

1. **READ the real code first** (`Read` the cited file at the cited lines). The audit line numbers are from `origin/staging` @ `348cee8f5` and may drift — confirm before editing. If the real code contradicts a contract here, **STOP and report**, do not guess (read-before-write is this repo's #1 bug class).
2. **Write the failing test from this task's assertions and RUN it** — confirm it fails for the right reason (component not found / wrong color / extra mount). Never author test+impl together.
3. **Implement minimally** against the real signatures.
4. **RUN** the test (green) **+ `npm run typecheck`**.
5. **Commit** (one item = one commit; one wave/phase = one PR).

**Per-PR gates (all must pass before opening the PR):**
```
npm run typecheck            # tsc -b, zero errors
npx vite build               # builds
npx vitest run               # FULL suite, not just new tests
npx tsx scripts/pr-check.ts  # zero violations
npm run lint:hooks           # zero react-hooks/rules-of-hooks
npm run verify:feature-flags # flag catalog consistent (Wave 5)
npm run verify:coverage-ratchet
```
Plus visual states from each item's `verify`: **dark + light**, **empty + populated**, and **flag ON + OFF** where gated. Use `preview_*` (configure a workspace + flip the flag); never ask the user to check manually.

**Flag-OFF byte-identical (non-negotiable).** Any task that edits a file containing a flag branch must preserve EVERY branch in that file (we only modify flag-ON paths). The six flags and the files/tasks that touch them:

| Flag | Lives in (file) | Touched by | OFF-branch test required |
|------|-----------------|-----------|--------------------------|
| `the-issue-client-spine` | TheIssueClientPage.tsx | T3.1, T3.2, T3.3 | yes |
| `the-issue-client-return-hook` | TheIssueClientPage.tsx (nested) | T3.1/T3.2 (preserve, not modify) | yes — assert ON/OFF surfaces unchanged |
| `client-ia-v2` (nested in spine) | TheIssueClientPage.tsx | T3.1/T3.2 (preserve) | yes |
| `strategy-command-center` | KeywordStrategy.tsx | T3.4, T3.5 (preserve baseline) | yes |
| `strategy-the-issue` | KeywordStrategy.tsx | T3.4, T3.5 | yes |
| `the-issue-client-measured-capture` | KeywordStrategy.tsx (nested) | T3.4/T3.5 (preserve) | yes |
| `client-ia-v2` (shell nav) | ClientDashboard.tsx | T5.1 (flips default) | yes until T5.1 flips |

So all six ARE in edited files — none is "unmapped"; the rule is "preserve all branches in any file you edit." Only touch the ON path unless an item says otherwise. **Test convention:** flag-OFF contract tests live at `tests/contract/<Component>.flag-off.test.tsx` with `describe("<flag> flag OFF", ...)` asserting the OFF-branch render is snapshot-identical to the current stable output — so reviewers can grep coverage. All `useFeatureFlag` calls stay at component root before any early return (Rules of Hooks).

**Color law quick ref:** mint/`text-accent-brand` = action only; blue/`text-accent-info` = data; emerald/`text-accent-success` = success/completed; amber/`text-accent-warning` = warning; red/`text-accent-danger` = danger; purple = admin-AI only. Tokens only — no raw `text-amber-400`, `bg-red-500/8`, or `#hex` (except `// chart-hex-ok` brand colors). `--radius-signature*` is reserved for StatCard/SectionCard.

---

## Bounded Context Ownership

- **Primary owner:** `design-system` (shared `src/components/ui/*`) for Wave 0 + 0b; `ui-platform` (screen components) for Waves 1–5.
- **Shared contracts (Wave 0, committed before screen waves consume them):** `NeedsAttention`/`AttentionItem`, `Disclosure`, `Menu`/`MenuItem` + `useClickOutside`, `StatCard` `tone` prop, `SectionLabel`.
- **No new routes, API, DB, WS events, or React Query keys.** This is a presentation-layer sprint. Cache keys and broadcasts unchanged.
- **Test ownership:** new primitives own `*.test.tsx` in `src/components/ui/`; flag-gated screens own contract tests under `tests/contract/` / `tests/component/`.

---

## Task Dependency Graph

```
Wave 0 = PR 1 (components, parallel — distinct new files), MERGES BEFORE Wave 0b PR 2 starts (this removes the StatCard.tsx T0.4↔T0b.2 race cleanly):
  T0.1 NeedsAttention  ∥  T0.2 Disclosure  ∥  T0.3 Menu(+useClickOutside)  ∥  T0.4 StatCard tone  ∥  T0.5 SectionLabel
  → then T0c (4 pr-check rules) in the SAME PR 1, after the primitives exist

Wave 0b = PR 2 (color/token). Files conflict on WorkspaceHome.tsx / WorkspaceOverview.tsx / ContentPipeline.tsx, so serialize per-file:
  T0b.1 mint-on-data sweep   →  T0b.2a purple Law-4 (design-wh-purple-on-data) → T0b.2b repo-wide hex sweep (design-x-hex-tokenize-sweep)  →  T0b.4 ContentPipeline healthbar-color
  T0b.3 InlineBanner root → T0b.3a trial banners → T0b.3b staleness nudges   (independent file set; runs ∥ the T0b.1 chain)

Wave 1 Command Center = PR 3 (after T0.1 + T0b.1). All four edit WorkspaceOverview.tsx → SEQUENTIAL within one PR (no parallel; shared file):
  T1.1 header-primary-action → T1.2 needs-attention-hero (needs T0.1) → T1.3 statrow-hierarchy → T1.4 workspace-row-density

Wave 2 Workspace Home (after T0.1; shared file WorkspaceHome.tsx → sequential):
  T2.1 setup-triplicated → T2.2 health-four-ways ; T2.3 statcard-hierarchy → T2.4 worklist-order (needs T0.1)

Wave 3 The Issue (client ∥ cockpit):
  client: T3.1 plan-above-proof ; T3.2 roi-double-mount (needs T0.2) ; T3.3 pending-surfaces
  cockpit: T3.4 ac-send-near-staging ; T3.5 ac-add-rec-placement  (+ T0.2 splits Supporting detail)

Wave 4 Content Pipeline (shared ContentPipeline.tsx → sequential):
  T4.1 unify-stepper-tabs → T4.2 use-tabbar-primitive (needs T0.3 Menu for Export) → T4.3 consolidate-alert-bands

Wave 5 Client shell (after W4 for notice-region):
  T5.1 finish-ia-v2-nav (L) → T5.2 dedupe-panel-mounts ; T5.3 notice-region (needs T4.3) ; T5.4 pageheader-title-echo
```

**Model assignments (Anthropic ladder):** Wave 0 primitives → **Sonnet** build, **Opus** review (high reuse). Wave 0b: single-file mint recolor (T0b.1, T0b.4) → **Haiku**; the repo-wide hex sweep (T0b.2b, ~20+ files, semantic color judgment) → **Sonnet**; InlineBanner refactor (T0b.3) → **Sonnet**. T0c pr-check rules → **Sonnet**. Waves 1–4 → **Sonnet**. Wave 5 nav migration → **Opus** (broad blast radius). All reviewers → **Opus**, never downgrade.

**File-ownership hotspots (NEVER parallel within a wave):** `WorkspaceOverview.tsx`, `WorkspaceHome.tsx`, `ContentPipeline.tsx`, `KeywordStrategy.tsx`, `ClientDashboard.tsx`, `TheIssueClientPage.tsx`, `StatCard.tsx` (T0.4 vs T0b.2 — sequence T0.4 first), `InlineBanner.tsx`.

---

## Wave 0 — Shared Components (PR 1)

> All new files in `src/components/ui/`. Follow house style of `Button.tsx`/`Badge.tsx`/`SectionCard.tsx`. Reference working agreement §4 for full prop specs. **Radius reservation:** `--radius-signature*` is for StatCard + SectionCard ONLY; all other containers (Disclosure, Menu, SectionLabel) use `--radius-lg`.
>
> **Test format:** T0.1 below shows the full React-Testing-Library skeleton. T0.2–T0.5 list their assertions in prose — author each as a `*.test.tsx` in the **same RTL style** (`render()` + `screen.getBy*` + `expect`), one `test()` per assertion, RUN-to-fail before implementing.

### T0.1 — `NeedsAttention` / `AttentionRow` (retires CC-F3, WH-F5)
**Files:** Create `src/components/ui/NeedsAttention.tsx`, `src/components/ui/NeedsAttention.test.tsx`.

**Contract (lock):**
```ts
export type AttentionSeverity = 'critical' | 'warning' | 'info';
export interface AttentionItem {
  id: string; label: string; sub?: string; severity: AttentionSeverity;
  icon?: LucideIcon; href?: string; onClick?: () => void;
  meta?: string;      // right-aligned context (e.g. workspace name)
  badge?: string;     // optional Badge value
}
export interface NeedsAttentionProps {
  items: AttentionItem[]; title?: string;  // default "Needs Attention"
  cap?: number;         // collapse beyond N with "show more"
  showCount?: boolean;  // append "· N" to title
}
```
**Rules:** ONE severity→token map — `critical`→`--red`/`text-accent-danger`, `warning`→`--amber`/`text-accent-warning`, `info`→`--blue`/`text-accent-info`. **`info` is blue, NOT mint** (this supersedes working agreement §4.1's "mint-or-blue" — mint is action-only, never on an attention row). Rows render via `ClickableRow` with an always-visible trailing chevron; container gets a subtle red/amber left-accent when any `critical` item is present. Wraps content in `SectionCard` (noPadding) titled by `title` (+ `· N` when `showCount`).

- [ ] **Step 1 — failing tests** (`NeedsAttention.test.tsx`):
```tsx
import { render, screen } from '@testing-library/react';
import { AlertTriangle } from 'lucide-react';
import { NeedsAttention } from './NeedsAttention';

const items = [
  { id: 'a', label: 'Churn risk', severity: 'critical' as const, meta: 'Acme', href: '/x' },
  { id: 'b', label: 'New request', severity: 'info' as const, badge: '3' },
];
test('renders title with count when showCount', () => {
  render(<NeedsAttention items={items} showCount />);
  expect(screen.getByText(/Needs Attention · 2/)).toBeInTheDocument();
});
test('critical item drives container left-accent', () => {
  const { container } = render(<NeedsAttention items={items} />);
  expect(container.querySelector('[data-attention-accent="critical"]')).toBeTruthy();
});
test('caps and shows "show more" beyond cap', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), label: `i${i}`, severity: 'info' as const }));
  render(<NeedsAttention items={many} cap={5} />);
  expect(screen.getByRole('button', { name: /show .*more/i })).toBeInTheDocument();
});
test('each row is a clickable control with a chevron', () => {
  render(<NeedsAttention items={items} />);
  expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2);
});
```
- [ ] **Step 2** — `npx vitest run src/components/ui/NeedsAttention.test.tsx` → FAIL (module not found).
- [ ] **Step 3** — implement `NeedsAttention.tsx` to satisfy the contract + tests (severity map, ClickableRow rows, cap/show-more via `useToggleSet` or local state, `data-attention-accent` on container when a critical exists).
- [ ] **Step 4** — vitest green + `npm run typecheck`.
- [ ] **Step 5** — commit `feat(ui): add NeedsAttention/AttentionRow primitive`.

### T0.2 — `Disclosure` (retires AC-F2 + client "Under the hood"; unblocks T3.2)
**Files:** Create `src/components/ui/Disclosure.tsx`, `src/components/ui/Disclosure.test.tsx`.

**Contract (lock):**
```ts
export interface DisclosureProps {
  summary: React.ReactNode;
  badges?: Array<{ label: string; tone?: BadgeTone }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}
```
**Rules:** wraps native `<details>/<summary>` with canonical chrome — `t-ui`/`t-label` summary, chevron that rotates on open via `group-open:` (respect `prefers-reduced-motion` on the rotation transition), `--radius-lg` container (NOT `--radius-signature`), `--surface-2` bg, `--brand-border`, focus-visible ring. Keyboard-operable (native `<details>` gives this). Composable/nestable so an 8-surface drawer becomes 2–3 grouped `Disclosure`s.

- [ ] **Step 1 — failing tests:** open/close toggles `children` visibility via `<details open>`; `defaultOpen` honored; chevron present; `badges` render in summary; container uses `--radius-lg` not signature; `prefers-reduced-motion` removes the rotate transition class.
- [ ] **Step 2** — vitest FAIL.
- [ ] **Step 3** — implement.
- [ ] **Step 4** — green + typecheck.
- [ ] **Step 5** — commit `feat(ui): add Disclosure collapsible-section primitive`.

### T0.3 — `Menu` / `Dropdown` + `useClickOutside` (retires CP-F5; the only net-new interactive component)
**Files:** Create `src/components/ui/Menu.tsx`, `src/components/ui/Menu.test.tsx`, `src/hooks/useClickOutside.ts` (+ `src/hooks/useClickOutside.test.ts`).

**Contract (lock):**
```ts
export interface MenuItem { label: string; onSelect: () => void; icon?: LucideIcon; trailing?: React.ReactNode; }
export interface MenuProps { trigger: React.ReactNode; items: MenuItem[]; align?: 'start' | 'end'; }
export function useClickOutside<T extends HTMLElement>(ref: React.RefObject<T>, onOutside: () => void, active?: boolean): void;
```
**Rules:** click-outside (via `useClickOutside`) + Escape dismiss; panel at `z-[var(--z-dropdown)]`, `--surface-2` + `--brand-border` + `--radius-lg`; arrow-key navigation between items; `trailing` supports the pipeline's CSV/JSON dual-action rows.

- [ ] **Step 1 — failing tests:** `useClickOutside` fires on outside mousedown only when `active`; `Menu` opens on trigger click, closes on Escape, closes on outside click; ArrowDown moves focus to next item; `onSelect` fires + closes; panel has `z-[var(--z-dropdown)]`.
- [ ] **Step 2** — vitest FAIL.
- [ ] **Step 3** — implement `useClickOutside` then `Menu`.
- [ ] **Step 4** — green + typecheck.
- [ ] **Step 5** — commit `feat(ui): add Menu primitive + useClickOutside hook`.

### T0.4 — `StatCard` `tone` prop (retires ISSUE-F5; must precede T0b.2 on StatCard)
**Files:** Modify `src/components/ui/StatCard.tsx`; Test `src/components/ui/StatCard.test.tsx` (create if absent).

**Contract (lock):** add `tone?: 'neutral' | 'teal' | 'emerald' | 'blue' | 'amber'` (default `neutral` = today's look, byte-identical). Non-neutral applies ONE canonical `linear-gradient(to bottom right, <accent>/8 → surface-2 → surface-2)` + `border <accent>/20` defined ONCE (a `TONE_GRADIENT` map). Keeps `--radius-signature`. No other prop behavior changes.

- [ ] **Step 1 — failing tests:** `tone="neutral"` (or omitted) renders identical class list to current (snapshot); `tone="emerald"` adds the emerald gradient+border classes from the single map; unknown tones rejected by types.
- [ ] **Step 2** — vitest FAIL.
- [ ] **Step 3** — implement `TONE_GRADIENT` + apply.
- [ ] **Step 4** — green + typecheck; visually confirm neutral unchanged.
- [ ] **Step 5** — commit `feat(ui): add StatCard tone prop (gradient variants)`.

### T0.5 — `SectionLabel` (retires ISSUE-F4)
**Files:** Create `src/components/ui/SectionLabel.tsx`, `src/components/ui/SectionLabel.test.tsx`.

**Contract (lock):** `export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string })` → renders the canonical `t-label` uppercase kicker with `text-[var(--brand-text-muted)]`. **Convention (documented in the file's header comment + `docs/design-cleanup`):** top-level page sections use `SectionLabel`; `SectionCard` headers are for cards *within* a section; `<summary>` only for `Disclosure`.

- [ ] **Step 1 — failing test:** renders children inside a `t-label` element with muted token color + uppercase tracking.
- [ ] **Step 2** — vitest FAIL. **Step 3** — implement. **Step 4** — green + typecheck.
- [ ] **Step 5** — commit `feat(ui): add SectionLabel section-header primitive`.

### T0c — Add 4 pr-check rules (same PR 1, after the primitives exist) — **Sonnet**
**Files:** `scripts/pr-check.ts` (CHECKS array), `scripts/__tests__/*` (rule tests), then regenerate `docs/rules/automated-rules.md`. **Read `docs/rules/pr-check-rule-authoring.md` first** for the CHECKS entry shape, regex vs `customCheck`, and inline-hatch placement (hatches are inline-only for pattern rules — see `feedback_pr_check_hatch_placement`).
**Rules (each with a fixture test asserting it fires + an escape hatch):**
- `mint-on-static-data` — `text-accent-brand`/`var(--teal)` on non-`<button>`/`<a>` text. Hatch `// mint-data-ok`.
- `raw-warning-surface` — raw `bg-amber-500/*`/`bg-red-500/*` + `border-*` on banner-like containers (route via InlineBanner/soft tokens). Hatch `// raw-warning-ok`.
- `hand-rolled-details` / `hand-rolled-dropdown` — new `<details>`/`<summary>` or `useState(open)+mousedown` panels outside `Disclosure`/`Menu`. Hatch `// disclosure-ok` / `// menu-ok`.
- `hand-rolled-gradient-card` — `bg-gradient-to-br from-*-500/` outside the StatCard tone prop. Hatch `// gradient-card-ok`.
- [ ] Steps per rule: read authoring doc → write fixture test (rule fires on a bad sample, passes on a good sample) → RUN fail → implement CHECKS entry → RUN pass → `npm run rules:generate` (CI fails on drift) → commit.

> **Sequencing note:** these rules are added in PR 1 but the existing violations they'd catch are fixed in Wave 0b. To avoid PR 1 failing its own new rules, either (a) land each rule with its fixes co-located, or (b) seed `data/style-exceptions.json` time-bounded entries for the known-pending 0b sites and resolve them in PR 2. Prefer (b) so the rules guard new code immediately while 0b clears the backlog.

**Wave 0 PR gate:** all 5 primitives + tests green; 4 pr-check rules added + `rules:generate` clean; primitives exported where the repo expects (check `src/components/ui/` barrel if one exists). **Opus review** of the 5 primitives before merge → staging.

---

## Wave 0b — Color & Token Discipline (PR 2; parallelizable with Wave 0)

> Highest-leverage, lowest-risk. Each sub-task is a focused diff + a regression check. Order: run T0b.1 + T0b.2 + T0b.3 in parallel (distinct files), T0b.4 after T0b.1.

### T0b.1 — Mint-on-static-data sweep (`design-color-law-sweep-mint-on-data`)
**Files (exact, from audit §1a):** `RevenueDashboard.tsx:138,185,203,231`; `WorkspaceOverview.tsx:116,134,393,408,428,484`; `ContentPipeline.tsx:176`; `RequestManager.tsx:233`; `ContentPerformance.tsx:107,110,269`. **Do NOT touch** `WorkspaceOverview.tsx:443,446` (semantic Badge tone — verified non-violations).

**Contract:** static counts/labels/icons → `text-accent-info` (blue); the **delivered** count (`WorkspaceOverview.tsx:428`) → `text-accent-success` (emerald); static type badges (`ContentPerformance`) → blue badge. Mint stays only on real click targets.

- [ ] **Step 1 — read-before-write** each cited line; confirm it's non-interactive.
- [ ] **Step 2 — failing test:** add/extend a component or contract test asserting the recolored elements do NOT carry `text-accent-brand` (e.g. render RevenueDashboard total → assert class is `text-accent-info`). RUN → fails.
- [ ] **Step 3** — recolor.
- [ ] **Step 4** — test green; `npx tsx scripts/pr-check.ts` (expect `blue-action-semantic-drift`/`status-semantic-mapping-drift` clean); spot-check 5 screens in preview dark+light.
- [ ] **Step 5** — commit `fix(color): recolor static counts off mint (law 1/2 sweep)`.

### T0b.2 — Hex → token sweep + Law-4 purple (`design-wh-purple-on-data` + `design-x-hex-tokenize-sweep`)
> **Both sub-tasks are IN-SPRINT** (owner included D4 2026-06-30). Split for reviewability and commit boundaries:
> - **T0b.2a (`design-wh-purple-on-data`):** the 3 Law-4 purple cards + WorkspaceHome sibling iconColor hexes. ~6 files. Commit 1.
> - **T0b.2b (`design-x-hex-tokenize-sweep`):** the repo-wide remainder (~20+ files / ~50+ hexes) → `CHART_SERIES_COLORS`/tokens. Commit 2+ (group by directory). **Sonnet** (semantic, non-local).
>
> Runs AFTER T0b.1 (mint sweep) because both touch WorkspaceHome.tsx / ContentPipeline.tsx / WorkspaceOverview.tsx — serialize per file, don't parallelize on shared files.

**Files (from audit §1b):** purple Law-4 → `WorkspaceHome.tsx:413-424`, `LlmsTxtGenerator.tsx:212`, `SiteArchitecture.tsx:330` (`#a78bfa`→`#60a5fa`/`CHART_SERIES_COLORS.blue`). Hex→`CHART_SERIES_COLORS` (`src/components/ui/constants.ts`): `WorkspaceHome.tsx`, `RedirectManager.tsx`, `SiteArchitecture.tsx`, `LocalSeoVisibilityPanel.tsx`, `GbpAuthenticatedReviewsPanel.tsx`, `OutcomeScorecard.tsx`, `matrix/CellDetailPanel.tsx`, `client/OverviewTab.tsx`, `client/AnalyticsTab.tsx`, `client/helpers.tsx`, `TrafficDetail.tsx`, `SearchDetail.tsx`, `ContentPerformance.tsx`, `Annotations.tsx`, `workspace-home/ActiveRequestsAnnotations.tsx`, `DropZone.tsx`, `audit/*`, `SalesReport.tsx`, `settings/ClientDashboardTab.tsx`. Add `// chart-hex-ok` markers to `ScoreTrendChart.tsx` + `pageRewriteChatActions.ts:78`. **KEEP** brand-justified (`#059669`, `#ea580c` with markers) and CSS-var fallbacks (`MetricRing.tsx`).

**Contract:** every data/icon hex maps to an existing `CHART_SERIES_COLORS` constant or a token var; purple removed from all data/client surfaces (stays admin-AI only); where no constant exists, add one to `constants.ts` (single source). Read-before-write each — do not blindly replace `as any`-typed props.

- [ ] **Step 1** — inventory against `CHART_SERIES_COLORS`; list any new constants needed; add them first (committed contract).
- [ ] **Step 2 — failing test:** assert no `#a78bfa` remains in the 3 purple files; assert WorkspaceHome Users icon uses the blue constant.
- [ ] **Step 3** — replace hexes file-by-file (Haiku-mechanical; verify each prop is really a color).
- [ ] **Step 4** — pr-check (hardcoded-dark-hex / SVG rules clean); preview dark+light on 3+ chart screens (Recharts colors intact).
- [ ] **Step 5** — commit per logical group: `fix(color): purple→blue on data cards (law 4)` then `refactor(color): tokenize hardcoded hexes → CHART_SERIES_COLORS`.

### T0b.3 — InlineBanner root + trial banners + staleness nudges (`design-cd-trial-banner-tokens`, `design-ac-staleness-tokens` + D1/D2/D3)
**Files:** `src/components/ui/InlineBanner.tsx` (TONE_STYLES root), `src/index.css` (verify/fix soft tokens), `ClientDashboard.tsx:668-674,688-694,698-707` (trial countdown/ended/section-errors), `KeywordStrategy.tsx:596-602,658-660` (POV-staleness), `StrategyStalenessNudges.tsx:20,33`.

**Contract:**
1. **D2 is already correct (no fix needed).** Verified: `src/index.css:200-201/207-208` — `.bg-accent-warning-soft`/`.border-accent-warning-soft` use `var(--amber)`, `.bg-accent-danger-soft`/`.border-accent-danger-soft` use `var(--red)`. Optionally add a guard test locking danger-soft to a red-based computed color so a future edit can't regress it. Do NOT "fix" it to red — it's red.
2. **InlineBanner root:** migrate `TONE_STYLES` to the soft tokens — `error: container 'border-accent-danger-soft bg-accent-danger-soft text-accent-danger'`, `warning: 'border-accent-warning-soft bg-accent-warning-soft text-accent-warning'`, message → `text-[var(--brand-text-muted)]` (kills the raw `text-amber-100/80`). This fixes the section-errors banner automatically.
3. **Trial + staleness:** replace raw `bg-amber-500/8 border-amber-500/20`, `bg-red-500/8 border-red-500/20`, `border-amber-500/30 bg-amber-500/5` → route through `<InlineBanner tone="warning|danger">` (or the soft-token classes). Trial banners keep the View Plans CTA + dismiss.

- [ ] **Step 1** — read index.css soft tokens; confirm danger=red/warning=amber (already correct); optionally add the guard test.
- [ ] **Step 2 — failing tests:** InlineBanner `tone="warning"` container has `bg-accent-warning-soft` (not `bg-amber-500/8`); render trial-countdown → no raw `amber-500` class; POV-staleness → no raw `amber-400`.
- [ ] **Step 3** — migrate `TONE_STYLES` (root, shared) → then **T0b.3a** trial banners (`design-cd-trial-banner-tokens`) → then **T0b.3b** staleness nudges (`design-ac-staleness-tokens`, depends on trial-banner per spec) + `StrategyStalenessNudges.tsx`.
- [ ] **Step 4** — full vitest (InlineBanner is widely used — watch snapshots); pr-check; preview trial-active(≤5d) + trial-ended + staleness, dark+light.
- [ ] **Step 5** — commit `fix(color): route warning/danger surfaces through InlineBanner tokens`.

### T0b.4 — ContentPipeline healthbar color (`design-cp-healthbar-color`) — after T0b.1
**Files:** `ContentPipeline.tsx:173-181`. **Contract:** brief/matrix/post counts + icons render neutral-bright or blue (data), not mint/amber; amber reserved for genuine decay/cannibalization warnings.
- [ ] Steps: read → failing test (counts not `text-accent-brand`/`text-accent-warning`) → recolor → pr-check + preview → commit `fix(color): neutralize ContentPipeline health-bar counts`.

**Wave 0b PR gate:** pr-check clean; `report-style-drift` not increased vs `data/style-drift-baseline.json` (radius/hue/button counts stay 0; mint sweep is enforced by pr-check rules, not the 6 drift counts — see audit §3); full vitest green.

---

## Wave 1 — Command Center / WorkspaceOverview.tsx (PR 3; after T0.1 + T0b.1)

Single file — **sequential edits**. Both P1s live here.

### T1.1 — header-primary-action (P1) — `WorkspaceOverview.tsx:169-182`
**Contract:** ≤1 mint primary (new/onboard workspace) + one neutral secondary cluster or a `Menu` "More" overflow (reuse T0.3) holding Prospect/Roadmap/AI Usage/Revenue/Features; zero amber/emerald/teal on header chrome; all 5 destinations still reachable.
- [ ] read → failing test (header has exactly one primary Button; no `text-amber/emerald/teal` on header buttons; all 5 routes still present as links/menu items) → implement → pr-check + preview dark/light → commit.

### T1.2 — needs-attention-hero (P1) — `WorkspaceOverview.tsx:184-218` (needs T0.1)
**Contract:** Needs Attention becomes the FIRST block under PageHeader; rendered via `NeedsAttention` (`showCount`, `cap`); critical (churn/new-request) → red/amber left-accent; always-visible chevron.
- [ ] read → failing test (NeedsAttention is first child after PageHeader; title shows `· N`; critical present → accent) → implement (replace inline rows with `<NeedsAttention items={...} />`) → preview empty+populated, P1 present vs none → commit.

### T1.3 — statrow-hierarchy — `WorkspaceOverview.tsx:220-228` (after T1.2)
**Contract:** one hero metric (Hours Saved) at `size="hero"` spanning 2 cols; drop counts duplicated by Needs Attention (New Requests, Approvals); remaining = at-a-glance trends (Avg Health, Active, Content). Row 6→~4.
- [ ] read → failing test (exactly one `size="hero"`; New Requests/Approvals StatCards removed) → implement → preview populated + zero-state → commit.

### T1.4 — workspace-row-density — `WorkspaceOverview.tsx:274-456` (parallel-safe vs T1.1 only if separate commit; treat sequential)
**Contract:** each row leads with health score (band color) + name + one "N need you" rollup pill; 5-column breakdown moves to hover/expanded or detail; color only on score + rollup, neutral elsewhere.
- [ ] read → failing test (row renders score + single rollup pill; 5 inline metric columns no longer always-rendered) → implement → preview 1/3/10 workspaces, at-risk + healthy → commit.

**Wave 1 PR gate:** standard gates + preview all four states; no flag here.

---

## Wave 2 — Workspace Home / WorkspaceHome.tsx (PR 4; after T0.1)

Single file — **sequential**. Dependency chains: T2.1→T2.2, T2.3→T2.4.

### T2.1 — setup-triplicated — `WorkspaceHome.tsx:229-288` (+ `OnboardingChecklist.tsx`, `WorkspaceHealthBar.tsx`)
**Contract:** a given connect-task (Webflow/GSC/GA4) appears in exactly ONE component at a time — OnboardingChecklist owns setup while unconfigured; once dismissed/complete, HealthBar + Needs Attention show only operational follow-ups.
- [ ] read → failing test (unconfigured ws: connect-task appears once across the three surfaces) → implement (gate HealthBar recs + NeedsAttention setupActions on checklist-dismissed/complete) → preview unconfigured/partial/full + dismissed → commit.

### T2.2 — health-four-ways — `WorkspaceHome.tsx:264-354` (+ `WorkspaceHealthBadge.tsx`, `WorkspaceHealthBar.tsx`) (after T2.1)
**Contract:** ONE canonical health block = Site Health StatCard + trailing MetricRing; remove standalone `WorkspaceHealthBadge` from this screen; fold HealthBar setup% into the onboarding consolidation (T2.1).
- [ ] read → failing test (only one health representation renders; no WorkspaceHealthBadge on screen) → implement → preview audit-present vs no-audit → commit.

### T2.3 — statcard-hierarchy — `WorkspaceHome.tsx:368-510`
**Contract:** ≤3 StatCards at `size="hero"`; rest at `size="default"` in a compact secondary rail; every metric still present + deep-linked.
- [ ] read → failing test (≤3 hero cards; all 9 metrics still rendered) → implement → preview few vs all-9 → commit.

### T2.4 — worklist-order — `WorkspaceHome.tsx:291-622` (after T2.3 + T0.1)
**Contract:** order = (onboarding for new ws) → Needs Attention → trimmed metric grid → operational sections; group lower-half under existing TabBar so default view isn't a 10-section scroll; most-actionable block above the fold.
- [ ] read → failing test (NeedsAttention precedes metric grid in DOM order; lower sections under TabBar) → implement → preview new vs established ws → commit.

---

## Wave 3 — The Issue: client + cockpit (PR 5; client ∥ cockpit)

### Client — `TheIssueClientPage.tsx` (spine-ON path only; OFF byte-identical)
**T3.1 plan-above-proof** (`:225-380`): reorder spine to verdict → Content Plan → proof (outcome, money, wins). Content Plan directly under verdict. **Test:** contract test asserts spine-ON DOM order; **flag-OFF branch byte-identical** (snapshot unchanged).
**T3.2 roi-double-mount** (`:278` + `:348-375`, needs T0.2): ROIDashboard mounts ONCE (compact at slot 3); "Under the hood" via `Disclosure` holds methodology/tables only. **Test:** single `<ROIDashboard>` in spine-ON tree; network shows one ROI fetch.
**T3.3 pending-surfaces** (`ActionQueueStrip.tsx`, `IssueLoopFooter.tsx`): top "Your turn" strip = count/jump anchoring to the loop footer; shared visual language. **Test:** strip renders count + anchor to footer id.

### Cockpit — `KeywordStrategy.tsx` (issue branch only; command-center/baseline byte-identical)
**T3.4 ac-send-near-staging** (`:577-660` issueOverviewEl, `IssueHeader.tsx`, `BackingMovesQueue.tsx`): sticky send bar (or Send docked to BackingMovesQueue) appears when `stagedCount > 0`, showing staged count + Send from where staging happens; keep header Send; no double-send. **Test:** stagedCount>0 → docked Send present; stagedCount=0 → absent.
**T3.5 ac-add-rec-placement** (`:603-608`): move "Add a recommendation" into BackingMovesQueue header action slot (SectionCard `action` pattern); remove the orphan line. **Test:** button is inside the queue header, not a standalone row.
> T0.2 Disclosure also splits the cockpit "Supporting detail" 8-surface `<details>` (`:618-659`) into 2–3 grouped `Disclosure`s — do this in T3.4's PR.

- [ ] Each: read → failing test (incl. flag-OFF byte-identical contract test) → implement → preview flag ON+OFF, previewMode+live, dark+light → commit.

---

## Wave 4 — Content Pipeline / ContentPipeline.tsx (PR 6; sequential; needs T0.3)

**T4.1 unify-stepper-tabs** (`:155-171`): stepper phases map 1:1 to tabs + labels (Subscriptions→Publish); stepper "Strategy" → in-page Planner tab (not off-page); Calendar = view toggle, not peer phase. **Test:** stepper labels === tab labels; stepper clicks land in-page.
**T4.2 use-tabbar-primitive** (`ContentPipeline.tsx:227-290`, needs T0.3): sub-tab bar → `TabBar` primitive; Export → `Menu` primitive beside tabs (not a fake tab); fix the missing click-outside on the snooze menu in `src/components/pipeline/AiSuggested.tsx:46-74,81` (D5 — adopt `Menu`/`useClickOutside`). **Test:** no inline `border-b-2` tab reimpl; Export is a Menu with CSV/JSON `trailing` rows; keyboard nav works; AiSuggested snooze dismisses on outside click.
**T4.3 consolidate-alert-bands** (`:173-225`): keep neutral health summary as the one persistent bar; roll decay + cannibalization + AI-suggestions into a single collapsible "Alerts & suggestions (N)" strip (reuse `Disclosure`) or move into the acting tab. **Test:** ≤1 persistent band + one collapsible group; operator reaches tab content within one screen.
- [ ] Each: read → failing test → implement → preview 0 vs many alerts, keyboard tab nav, dark+light → commit.

---

## Wave 5 — Client Dashboard shell / ClientDashboard.tsx (PR 7; after W4; Opus)

**T5.1 finish-ia-v2-nav (L, ~16–20h — split into a/b)** (`ClientDashboard.tsx`, `client/client-dashboard/clientDashboardNav.ts`, `client/ClientHeader.tsx`):
- **T5.1a — nav migration:** build the 4-tab two-speed shell (Overview/Deep Dive/Inbox/Settings); ensure every one of the 12 legacy destinations is reachable within it. Ships flag-gated (OFF still byte-identical 12-tab). **Test:** nav returns 4 tabs when ON; all legacy destinations reachable; mobile width OK; OFF branch unchanged.
- **T5.1b — default-ON / flag retirement (after staging soak):** flip `client-ia-v2` default ON or remove the flag per `docs/rules/feature-flag-lifecycle.md`. **Test:** `npm run verify:feature-flags` passes; no two-front-doors state.

> **Client vs operator flag scope:** `client useFeatureFlag` (src/hooks/useFeatureFlag.ts) reads the **GLOBAL** `/api/feature-flags` map — NOT per-workspace overrides (those gate only the server/admin; see CLAUDE.md). So flipping `client-ia-v2` default-ON lights up ALL clients' shells at once — there is no per-workspace pilot for this client UI. `client-ia-v2` (client shell) and the `strategy-*` flags (operator/admin cockpit) are **independent** surfaces; changing one does not affect the other. Plan the rollout as all-clients-at-once and verify on staging before default-ON.
**T5.2 dedupe-panel-mounts** (`:726-850`, after T5.1): define each tab panel once (const/registry keyed by tab id); no verbatim duplicated `HealthTab`/`PerformanceTab`/`StrategyTab` markup; each surface a single home under the shell. **Test:** panel registry referenced in both nav + Deep Dive slots; no duplicate inline JSX.
**T5.3 notice-region** (`:657-707`, needs T4.3): one notice region, priority errors > trial > education tip, ≤1 shown at a time; education tip yields to a real error (reuse W4 consolidation pattern). **Test:** trial + error simultaneously → only error (or compact dock); first-visit tip yields.
**T5.4 pageheader-title-echo** (`:657`): per-tab PageHeader no longer renders a title that only repeats the active nav label — drop it (subtitle/content carries) or make it earn its row (verdict/freshness/primary action). **Test:** clicking Health does not render an `<h1>Health</h1>` that duplicates the nav.
- [ ] Each: read → failing test (incl. `client-ia-v2` flag-OFF byte-identical until T5.1 flips default) → implement → preview flag ON+OFF, mobile, dark+light → commit.

---

## Systemic Improvements

**Shared utilities (built in Wave 0):** `useClickOutside` (T0.3, replaces 8+ hand-rolls), `NeedsAttention` severity→token map (T0.1), `StatCard` `TONE_GRADIENT` (T0.4), `SectionLabel` convention (T0.5).

**pr-check rules to ADD — built as task T0c in Wave 0 (PR 1)**, with fixture tests per `docs/rules/pr-check-rule-authoring.md`; see T0c for sequencing (seed `data/style-exceptions.json` for known-pending 0b sites):
- `mint-on-static-data` — `text-accent-brand`/`var(--teal)` on non-`<button>`/`<a>` text. Escape `// mint-data-ok`.
- `raw-warning-surface` — raw `bg-amber-500/*`/`bg-red-500/*` + `border-*` on banner containers. Escape `// raw-warning-ok`.
- `hand-rolled-details` / `hand-rolled-dropdown` — new `<details>` or `useState(open)+mousedown` panels outside `Disclosure`/`Menu`. Escape `// disclosure-ok`/`// menu-ok`.
- `hand-rolled-gradient-card` — `bg-gradient-to-br from-*-500/` outside StatCard tone. Escape `// gradient-card-ok`.
- Run `npm run rules:generate` after adding (CI fails on drift).

**Tests required:** 5 primitive `*.test.tsx` (Wave 0); flag-OFF byte-identical contract tests for the 6 flags; color-regression assertions per 0b sub-task; `useClickOutside` hook test. Respect `verify:coverage-ratchet`.

**Feature-class DoD:** design-system primitives (Wave 0) + client-facing surfaces (Waves 3, 5) gates from `docs/workflows/feature-class-definition-of-done.md`.

---

## Verification Strategy

- **Per primitive (Wave 0):** `npx vitest run src/components/ui/<Name>.test.tsx` green; Opus review.
- **Per color sub-task (0b):** `npx tsx scripts/pr-check.ts` clean; `node scripts/report-style-drift.ts` (or `npm run` equivalent) not increased vs baseline; `preview_*` dark+light spot-check 5 screens.
- **Per screen wave:** full `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run lint:hooks`; `preview_*` through each item's `verify` states (empty/populated, dark/light, **flag ON+OFF**); for flag-gated screens, the contract test asserting OFF byte-identical must pass.
- **Wave 5 extra:** `npm run verify:feature-flags`; mobile-width preview; confirm no two-front-doors state.
- **Sprint close:** update `data/roadmap.json` items → `done` with notes (`npx tsx scripts/sort-roadmap.ts`); update `FEATURE_AUDIT.md` + `BRAND_DESIGN_LANGUAGE.md` (new primitives, tone prop, banner convention); `scaled-code-review` (multi-agent work) before staging→main.

---

## Self-Review (run against the spec)

- **Spec coverage:** all 30 recovered JSON items mapped to tasks (T0.1–T5.4). The recovered snapshot `docs/design-cleanup/design-cleanup-sprint.json` stays at 30 (historical artifact); the **31st item `design-x-hex-tokenize-sweep` is an owner-approved scope addition tracked in `data/roadmap.json`** (sprint = 31 there) and built as T0b.2b. ✅
- **Deltas folded:** D1 (InlineBanner root)→T0b.3; **D2 = FALSE POSITIVE** (danger-soft already `var(--red)`; no fix, optional guard test); D3 (StrategyStalenessNudges)→T0b.3b; D4 (repo-wide hex) **INCLUDED** per owner→T0b.2b; D5 (AiSuggested click-outside)→T4.2; D6 (chart-hex markers)→T0b.2. ✅
- **Dependency correctness (post-review):** Wave 0 (PR1) fully precedes Wave 0b (PR2) → no StatCard T0.4↔T0b.2 race. Within 0b, hex/healthbar serialize after mint on shared files. Wave 1 is fully sequential (one file). T1.2/T2.4 wait on T0.1; T3.2/T4.3/T5.3 on T0.2/T0.3/T4.3. ✅
- **No placeholders:** primitive contracts + T0.1 test code concrete; T0.2–T0.5 + screen items give contract + assertions + verify in one RTL style (bodies authored at execution per repo's contract-centric override). ✅
- **Flag safety:** all six flags map to edited files; each editing task carries a `tests/contract/<Component>.flag-off.test.tsx` asserting OFF byte-identical. ✅
- **Model fit:** repo-wide hex sweep upgraded Haiku→Sonnet (non-local, semantic). ✅

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-30-design-cleanup.md`. Recommended: **subagent-driven-development** (fresh subagent per task, two-stage review between tasks), one PR per wave, staging-first, merge only on green. Wave 0 + 0b first (foundations), then Waves 1→5 (Wave 5 can run on its own track).
