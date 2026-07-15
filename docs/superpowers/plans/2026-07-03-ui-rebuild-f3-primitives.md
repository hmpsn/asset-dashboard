# UI Rebuild F3 — Net-New Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This is the rebuild's first PARALLEL phase — the coordination rules in §"Parallel dispatch" are load-bearing, not ceremony.**

**Goal:** Build the 18 design-system components that have no HEAD counterpart (19 in the audit; Toast removed — review CP1: a HEAD Toast/useToast already exists) ([cross-design-system.md §4.3](../../ui-rebuild/phase0/cross-design-system.md)) as production-grade primitives in `src/components/ui/`, consolidating real HEAD duplication (5+ hand-rolled drawers, 7 hand-rolled tables, 15 hand-rolled lens switchers, per-feature toast state).

**Architecture:** D1 ratified: port under HEAD conventions — kit `.jsx` is the **pixel spec**, kit `.d.ts` is the **prop floor**, HEAD conventions win (TS, `className`, tokens-only, `var(--z-*)`, focus/portal machinery from `ui/overlay/`). Every new file carries the `// @ds-rebuilt` marker → the seven F2a gates apply at error severity from the first line. Kit components are visual-only (§1.3 of the audit) — production grade (portals, focus traps, keyboard nav, reduced motion) is THIS plan's job, not the kit's.

**Tech Stack:** React 19 + TS strict, tokens from `src/tokens.css` (F1), existing `ui/overlay/` machinery (portal, focus trap, `reducedMotion.ts`), lucide-react (D5). **No new dependencies** — Sparkline/Meter are hand-rolled SVG like the kit's.

**Platform/Model (Claude/Anthropic):** contracts + integration + review = **Opus**; each build lane = **Sonnet** (implementation with local judgment against a written spec); mechanical styleguide demos = Sonnet.

---

## Scope — the 18 components, with target paths

Kit sources: `hmpsn studio Design System/components/<dir>/<Name>.jsx` + `<Name>.d.ts` (read BOTH per component before writing code — read-before-write is the #1 anti-bug rule here).

| # | Component (+secondary exports) | Kit source dir | Target file (HEAD conventions) | Lane |
|---|---|---|---|---|
| 1 | Drawer | layout/ | `src/components/ui/overlay/Drawer.tsx` | A |
| 2 | ~~Toast~~ **REMOVED — HEAD counterpart exists** (adversarial review CP1): `src/components/Toast.tsx` already ships `ToastProvider` + `useToast` (mounted in App.tsx, 15+ consumers, tested). It is the canonical mutation-feedback primitive; the kit Toast's visuals become a tokens-only restyle of the existing component during the pilot (T1 carry-over policy — ledger row added in F3.2). Do NOT build a second Toast. | — | — |
| 3 | Avatar | feedback/ | `src/components/ui/Avatar.tsx` | A |
| 4 | IntentTag | feedback/ | `src/components/ui/IntentTag.tsx` | A |
| 5 | DataTable | data/ | `src/components/ui/DataTable.tsx` | B |
| 6 | MetricTile | data/ | `src/components/ui/MetricTile.tsx` | B |
| 7 | Sparkline | data/ | `src/components/ui/Sparkline.tsx` | B |
| 8 | Meter | data/ | `src/components/ui/Meter.tsx` | B |
| 9 | KeyValueRow (+ DefinitionList) | data/ | `src/components/ui/KeyValueRow.tsx` | B |
| 10 | BoardColumn (+ BoardCard) | flow/ | `src/components/ui/BoardColumn.tsx` | B |
| 11 | Segmented | forms/ | `src/components/ui/forms/Segmented.tsx` | C |
| 12 | LensSwitcher | forms/ | `src/components/ui/forms/LensSwitcher.tsx` | C |
| 13 | FilterChip | forms/ | `src/components/ui/forms/FilterChip.tsx` | C |
| 14 | SearchField | forms/ | `src/components/ui/forms/SearchField.tsx` | C |
| 15 | RadioGroup | forms/ | `src/components/ui/forms/RadioGroup.tsx` | C |
| 16 | AppShell | layout/ | `src/components/ui/layout/AppShell.tsx` | D |
| 17 | PageContainer | layout/ | `src/components/ui/layout/PageContainer.tsx` | D |
| 18 | Toolbar (+ ToolbarSpacer) | layout/ | `src/components/ui/layout/Toolbar.tsx` | D |
| 19 | GroupBlock | layout/ | `src/components/ui/layout/GroupBlock.tsx` | D |

**Explicitly NOT in scope:** the 28 same-name components (HEAD survives; kit = visual spec — do NOT touch Button/Badge/SectionCard/Modal/etc. in this PR); the renamed equivalents (§4.2 — Input→FormInput, Sidebar/NavItem/NavGroup → F4 wires HEAD's `layout/Sidebar.tsx`); the ~27 HEAD-only primitives (F5 rolling restyle); **AppShell nav wiring** (F3 builds AppShell as a pure presentational shell taking `sidebar`/`topbar`/`rail`/`children` props per its `.d.ts`; F4 wires it to `navRegistry.tsx` — no nav content, no flags, no workspace switcher here); any consumer migration (legacy drawers/toasts/tables migrate per-surface during the fan-out, not in this PR).

## Task dependency graph

```
F3.0 contracts (single author, Opus)  ← blocks everything
  → Lane A ∥ Lane B   (dispatch wave 1 — 2 concurrent, per review-capacity rule)
  → Lane C ∥ Lane D   (dispatch wave 2 — after wave 1's diff review)
  → F3.2 integration: barrel, styleguide, docs (single author)
  → F3.3 scaled-code-review (MANDATORY — parallel agents were used) → full gates → PR
```

## File ownership (exclusive; violations = stop the lane)

- **F3.0/F3.2 owner:** `src/components/ui/index.ts`, `ui/forms/index.ts`, `ui/layout/index.ts`, `ui/overlay/index.ts`, `src/components/ui/ds-prop-notes.md` (temp, deleted in F3.2), `public/styleguide.html`, docs
- **Lane A:** only files #1–4 + their test files
- **Lane B:** only files #5–10 + their test files
- **Lane C:** only files #11–15 + their test files
- **Lane D:** only files #16–19 + their test files
- **NO lane touches a barrel** (index.ts files are pre-committed in F3.0 with all exports; a lane that needs a signature change STOPS and reports — contract changes are the controller's, in a dedicated commit)
- **NO lane runs any git command** (controller commits per-lane — the W1 index-contention lesson)

---

### Task F3.0 — Pre-committed shared contracts (single author, Opus; blocks dispatch)

**Files:** Create the 18 target files as **typed stubs**, update the 4 barrels, create `src/components/ui/ds-prop-notes.md`.

- [ ] **0.1** For each of the 18: read the kit `.d.ts` + `.jsx`, then author the merged TS interface in the target file as a stub (interface + `export function X() { throw new Error('F3 stub — lane not yet run') }` or minimal null render). Derivation rules — apply to every component, no exceptions:
  1. Kit `.d.ts` props = the **floor** (every kit prop survives, same names/types unless a rule below overrides). **AppShell's kit contract is `{ sidebar?: ReactNode; topbar?: ReactNode; rail?: boolean; children }` — `sidebar` is the nav slot, `rail` is the boolean collapse flag. Do not rename either (review CP3).**
  2. Add HEAD-convention props: `className?: string`, `id?: string` where the kit omits them.
  3. `icon` props type as `LucideIcon` (D5) — kit leaf `.d.ts` files already assume this shape.
  4. No `purple` in any tone/color union (Four Laws; Badge precedent). **IntentTag: the kit maps `local`→purple — remap `local`→`--orange` and define the canonical intent→hue map as one documented const in IntentTag.tsx (HEAD call sites currently disagree: transactional→amber at KeywordStrategy.tsx:232 vs →emerald at IssueContentCard.tsx:79 — IntentTag's map becomes canonical going forward; name the mapping in ds-prop-notes + the PR body for owner visibility).**
  5. Event handlers follow HEAD naming (`onSelect`, `onDismiss` — match the closest existing HEAD primitive's vocabulary; note deviations in `ds-prop-notes.md`).
  6. Every stub file's first line: `// @ds-rebuilt` (activates F2a gates immediately — stubs must already pass them).
- [ ] **0.2** Add ALL exports (components + prop types) to the four barrels now, so lanes never touch shared files. Follow the existing `index.ts` export style (named exports + `export type`).
- [ ] **0.3** **Extract the overlay machinery (review CP2 — Lane A cannot run without this):** the focus trap (`getFocusable`, `FOCUSABLE_SELECTOR`), scroll lock (`acquireScrollLock`/`releaseScrollLock`), and portal logic are module-private in `ui/overlay/Modal.tsx:25–99`. Move them to a new exported `src/components/ui/overlay/overlayUtils.ts` (NOT under `ui/internal/` — the `ds-deep-import` rule fires there), refactor Modal.tsx to import them (zero behavior change), run the existing Modal/overlay tests green. Controller-owned file.
- [ ] **0.4** **Pre-commit `src/components/ui/useRovingTabindex.ts`** (exported via the ui barrel): the roving-tabindex + arrow-key hook Lanes C (Segmented/LensSwitcher/RadioGroup), D (Toolbar), and B (DataTable rows) all need — without it, 4–5 independent implementations are guaranteed (review finding). API: `useRovingTabindex(itemCount, { orientation, wrap, onActivate })` returning per-item props.
- [ ] **0.5** **Fix `ds-per-view-css-block` before dispatch (review CP4):** its regex (`scripts/pr-check.ts:7084`) matches any `const xStyles = {` object literal — the standard React style-map pattern every lane will write (kit props include `style?: CSSProperties`). Narrow it to template-literal CSS + `<style` tags only (`const\s+\w*(?:css|styles?)\w*\s*=\s*\`` and `<style`), add regression tests (object-map fixture NOT flagged, template-literal fixture flagged), run `npm run rules:generate` (drift check fails CI otherwise).
- [ ] **0.6** `ds-prop-notes.md`: one row per component — kit props kept, props added, deviations + why. Review artifact for F3.3; deleted in F3.2 after folding into the PR description.
- [ ] **0.7** Gates on stubs: `npm run typecheck && npx tsx scripts/pr-check.ts && npx vitest run tests/pr-check.test.ts && npx vite build` — all green (contracts + markers + rule edit clean before any lane starts). Commit: `feat(ui-rebuild/f3): typed contracts, overlay utils, roving-tabindex hook, barrel exports (stubs)`.

### Tasks F3.A–F3.D — Build lanes (parallel; Sonnet; one dispatch prompt each)

**Dispatch preamble (paste verbatim into every lane prompt, filled per lane):**

> You are building design-system primitives for hmpsn.studio's UI rebuild. Repo: /Users/joshuahampson/CascadeProjects/asset-dashboard, branch ui-rebuild-phase-0. RULES: (1) You own ONLY these files: <lane file list + test files> — touch nothing else; barrels are pre-committed, do not edit any index.ts. (2) NEVER run git commands. (3) The TS interface in each stub is a FROZEN contract — if implementation proves it wrong, STOP and report; do not change it. (4) Kit pixel spec: read `hmpsn studio Design System/components/<dir>/<Name>.jsx` before each component; match its visual output through tokens (`var(--…)` only — the F2a `ds-*` rules will error on raw hex/palette/motion literals; `var(--dur-*)`/`var(--ease-*)` for all motion; `var(--z-*)` for all layering). (5) Kit `.jsx` is visual-only — YOU add the production behavior listed per component below. (6) Overlay behavior (portal/focus-trap/scroll-lock) comes from `ui/overlay/overlayUtils.ts` + `reducedMotion.ts` — never hand-roll it; keyboard-nav bars use the pre-committed `useRovingTabindex` hook. (7) Both themes by construction (tokens only); tabular numerals on all data values. (8) TEXT + COLOR TRAPS (error-severity rules with NO ui/ exclusion): no `text-[Npx]` arbitrary sizes (use `.t-*` utilities or `--type-*` tokens) and no `text/bg/border-zinc-N` classes (use `--brand-text-*`/`--surface-*`/`--brand-border` tokens); `--radius-signature-lg` is SectionCard-only. (9) Component tests in `tests/component/ui/<Name>.test.tsx` per the acceptance list; use existing test utils; no fixed ports; every test asserts. (10) When done: run `npm run typecheck && npx vitest run <your own test files only — another lane's WIP tests may be red> && npx tsx scripts/pr-check.ts` and report results honestly — the controller commits.

**Per-component production requirements + test musts:**

- [ ] **Lane A — overlay & feedback** (3 files)
  - **Drawer**: portal render; focus trap + focus restore on close; Escape closes (**the `document` keydown listener needs the `isContentEditable` guard or an inline `// keydown-ok -- <reason>` hatch — the 'Global keydown missing isContentEditable guard' rule is error-severity with no ui/ exclusion; see Modal.tsx:160 precedent**); backdrop click closes (prop-controllable); `var(--z-modal-backdrop)`/`var(--z-modal)`; reduced-motion honored. Import the machinery from `ui/overlay/overlayUtils.ts` (pre-committed in F3.0.3) + `reducedMotion.ts` — the kit's plain fixed-div is NOT acceptable, and hand-rolling the trap is forbidden. Tests: opens/closes, focus trapped + restored, Escape, backdrop prop.
  - **Avatar**: initials fallback (derive from name), image error → fallback, size scale from kit `.d.ts`, `aria-hidden` when decorative + name-labeled otherwise. Tests: fallback on image error, initials derivation.
  - **IntentTag**: pure presentational; tone union + canonical intent→hue map per the F3.0 contract (`local`→orange, no purple). Tests: renders each tone, rejects unknown at type level (type test).
- [ ] **Lane B — data display**
  - **DataTable**: THE flagship. Column defs + rows per kit `.d.ts`; sortable headers (`aria-sort`); **row interaction fully keyboard-accessible — `role="button"`/proper semantics, `tabIndex={0}`, Enter/Space activate (this was a CONFIRMED launch-blocker in the design review — the kit's div-onClick is forbidden)**; row selection (if per kit `.d.ts`) uses the shared `useToggleSet` hook — the 'Hand-rolled Set toggle' rule is error-severity and INCLUDES ui/; sticky header option; empty → `EmptyState` slot; loading → `Skeleton` rows; tabular numerals on numeric cells. Tests: sort toggles + aria-sort, keyboard row activation, empty/loading slots.
  - **MetricTile**: label/value/delta per kit `.d.ts`; **the delta MUST compose `<TrendBadge>` — importing `TrendingUp`/`TrendingDown` directly trips two error-severity rules ('Hand-rolled trend badge' + 'Trend icon import outside TrendBadge', which excludes only `ui/TrendBadge.tsx`)**; tabular numerals. Tests: renders delta directions, zero-delta case.
  - **Sparkline**: hand-rolled SVG (no dep); grid/axis/tooltip via `--chart-*` tokens; **series color from `CHART_SERIES_COLORS` (`ui/constants.ts:128`) or an accent prop — there is NO series-color token**; `aria-hidden` + accessible label prop; handles empty/single-point series without NaN paths. Tests: renders path for series, empty series safe.
  - **Meter**: determinate bar/arc per kit; `role="meter"` + `aria-valuenow/min/max`; token colors only. Tests: aria values, bounds clamping.
  - **KeyValueRow (+DefinitionList)**: semantic `<dl>/<dt>/<dd>`; mono option for values via `var(--font-mono)`. Tests: semantic structure.
  - **BoardColumn (+BoardCard)**: presentational kanban column (NO drag-drop in F3 — that's surface behavior); header count; scroll region with `--scrollbar-*` tokens. Tests: renders cards, count.
- [ ] **Lane C — forms**
  - **Segmented**: `role="radiogroup"` semantics or tablist per kit intent (decide from kit `.d.ts` usage notes; document in code comment); roving tabindex; arrow-key navigation; mint/teal active state via tokens. Tests: arrow-key moves selection, roving tabindex.
  - **LensSwitcher**: per the Which Primitive? guide it is distinct from TabBar/Segmented — read `"hmpsn studio Design System/Which Primitive - Decision Guide.html"` (textutil) before building; same keyboard bar as Segmented. Tests: selection change fires, keyboard nav.
  - **FilterChip**: toggle button with `aria-pressed`; removable variant with accessible remove button (≥44px hit target incl. padding). Tests: toggle state, remove fires.
  - **SearchField**: controlled input composing HEAD `forms/FormInput` patterns (do NOT fork input styling); debounce prop (timer cleanup on unmount); clear button; Escape clears; `type="search"` semantics. Tests: debounce fires once, Escape clears, cleanup (no act warnings).
  - **RadioGroup**: full WAI-ARIA radio group — `role="radiogroup"`, roving tabindex, arrow keys wrap, Space selects; integrates with `forms/FormField` context (aria-invalid). Tests: full keyboard matrix, FormField integration.
- [ ] **Lane D — layout**
  - **AppShell**: presentational shell per the kit `.d.ts` contract — `sidebar?: ReactNode` (the nav slot), `topbar?: ReactNode`, `rail?: boolean` (collapsed-to-icon-rail flag), `children` (review CP3 — these names are the frozen F4 wiring surface, do not rename); sized by `var(--shell-sidebar)`/`var(--shell-sidebar-rail)`/`var(--shell-topbar)`; skip-to-content link; NO nav content/registry/flags (F4's job). Tests: slots render, `rail` toggles widths via style assertion.
  - **PageContainer**: width variants mapping to `var(--page-max)` / `var(--page-max-narrow)` / `var(--page-max-wide)` + `var(--page-pad-x/y/bottom)`; semantic `<main>` option. Tests: variant → token mapping.
  - **Toolbar (+ToolbarSpacer)**: `role="toolbar"` + arrow-key focus movement between controls; wraps per kit spec. Tests: toolbar keyboard nav.
  - **GroupBlock**: presentational section grouping per kit `.d.ts`; heading semantics prop (h2–h4). Tests: heading level renders.

### Task F3.2 — Integration (single author, Opus)

- [ ] **2.1** Diff review of every lane (mandatory checkpoint): read the full diff per lane; grep for cross-lane duplication (two lanes implementing the same helper → extract to `ui/` shared util in a controller commit); verify each component against its kit `.d.ts` (prop floor intact) and `ds-prop-notes.md`.
- [ ] **2.2** Styleguide: add a demo block per component to `public/styleguide.html` §05 Components (follow the existing card markup patterns; `var(--…)` only — no `--*` declarations; **trap: the 'Static styleguide migrated note and radius debt' error rule scans this file for `rounded-*` and `Npx Npx` sequences even in prose — write radius/spacing prose via token names**). AppShell/PageContainer get a miniature scaled demo, not a full-page one.
- [ ] **2.3** **Dev harness route (review CP5 — the static styleguide cannot exercise behavior):** add a dev-only route (e.g. `/__ds-harness`, mounted in App.tsx behind `import.meta.env.DEV` with a comment exempting it from nav/registry conventions) rendering the real React primitives interactively — Drawer open/close, DataTable sort + keyboard rows, RadioGroup/Segmented arrow-nav, Toast (existing provider). This is the keyboard-walk target for F3.3.3 and stays for the pilot/F4.
- [ ] **2.4** Docs: BRAND_DESIGN_LANGUAGE.md component inventory + CLAUDE.md "UI Primitives — always check before hand-rolling" list gain the 18 names; FEATURE_AUDIT.md entry for the DS primitive set; delete `ds-prop-notes.md` after folding its content into the PR description. **Ledger row (same PR): `DEF-foundation-004` — kit-Toast visual restyle of the existing `src/components/Toast.tsx`, trigger: Keywords pilot ships mutations.**
- [ ] **2.5** Refine `ds-deep-import` (pr-check) if any internal helper files were created; otherwise record "no internal/ dir exists yet" in the rule's comment.

### Task F3.3 — Review + gates + PR

- [ ] **3.1** **Invoke `scaled-code-review`** (mandatory — parallel agents built this). Fix Critical/Important before proceeding; improvements → ledger rows (`DEF-*`, same PR).
- [ ] **3.2** Full gates, sequentially: `npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts && npm run lint:hooks && npm run verify:deferred-ledger && npm run verify:feature-flags && npm run verify:coverage-ratchet && npx vitest run` (FULL suite, one run at a time; `rules:generate` already ran in F3.0.5).
- [ ] **3.3** Real-render smoke: (a) static styleguide in a browser — every new primitive's specimen visible, both themes toggled; (b) the `/__ds-harness` dev route — keyboard-walk Drawer (trap/restore/Escape), DataTable (sort + row Enter/Space), RadioGroup + Segmented (arrow keys, roving tabindex), Toolbar.
- [ ] **3.4** PR to `staging`: "UI Rebuild F3 — 18 design-system primitives". Body: per-component prop deviations (from ds-prop-notes), ledger rows added, kit-fidelity notes. **Verify CI actually ran** (Actions billing history).

---

## Cross-phase contracts (F3 → Keywords pilot / F4)

- The four barrels export all 18 components + prop types — the pilot imports ONLY from barrels.
- AppShell's kit-floor API (`sidebar`, `topbar`, `rail: boolean`, `children`) is F4's wiring surface — F4 fills `sidebar`/`topbar` from `navRegistry.tsx`; the API freezes at F3.0.
- The EXISTING `src/components/Toast.tsx` `useToast` is the canonical mutation-feedback primitive for every rebuilt surface (Build Conventions mutation contract); its kit-visual restyle is `DEF-foundation-004`.
- `ui/overlay/overlayUtils.ts` + `useRovingTabindex` are the only sanctioned sources of focus/keyboard machinery for all future DS work.

## Systemic improvements (this PR)

- Drawer/DataTable/Segmented consolidate 25+ hand-rolled HEAD implementations (Toast consolidation already exists at HEAD) — consumers migrate per-surface later; each lane must NOT modify legacy call sites.
- First real exercise of the F2a `ds-*` gates on actual code (they've only ever run dormant) — any rule false-positive found by lanes gets fixed in this PR and a regression test added (precedent: PR #1473 fixes).

## Risks

- **Contract drift mid-lane** (a lane "improves" a frozen interface) → stop-and-report rule + F3.2 diff review catches; controller owns all contract changes.
- **A11y shortcuts under parallel pressure** → per-component test musts above are the DoD, not suggestions; scaled-code-review checks the keyboard matrix explicitly.
- **Kit visual fidelity vs production behavior tension** → pixel spec is the kit, behavior spec is this plan; when they conflict, behavior wins and the deviation is noted in the PR.

## Definition of done

- [ ] 18 components implemented at their target paths, each `// @ds-rebuilt`, tokens-only, both themes
- [ ] Every per-component test-must exists and passes; full vitest suite green
- [ ] Keyboard matrix proven for Drawer, DataTable, Segmented, LensSwitcher, RadioGroup, Toolbar, FilterChip
- [ ] Barrels export everything; no lane touched a barrel; no legacy call site modified
- [ ] scaled-code-review run; Critical/Important fixed; deferrals ledgered in the same PR
- [ ] Styleguide demos both themes; BRAND_DESIGN_LANGUAGE + CLAUDE.md primitive list + FEATURE_AUDIT updated
- [ ] All gates green; PR to `staging` with CI that actually ran
