# UI Rebuild F2b — Remaining Consistency Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Single-author, sequential.

**Goal:** Ship the two **CI-native** consistency gates the rebuild needs on every PR — a frontend `verify:bundle-budget` ratchet and **`vitest-axe` component-level accessibility** — and reconcile the pilot DoD. (Automated *visual* regression is deliberately NOT here — see Architecture — it's built + proven on the Keywords pilot as Playwright Component Testing.)

**Architecture:** F2a shipped the token-purity gates (7 pr-check `ds-*` rules). F2b adds the two remaining gates that run **in CI without a deploy or secrets**:
1. **`verify:bundle-budget`** — a vite-manifest chunk-size ratchet (precedent: `scripts/report-style-drift.ts` + `data/style-drift-baseline.json`, NOT `report-coverage-ratchet.ts`).
2. **`vitest-axe`** — the axe accessibility engine run against jsdom-rendered components **inside the existing CI component-test suite** (`test:component`, sharded, runs on every PR).

**Why NOT a snapshot-matrix gate here (grounded finding):** the repo's *visual* snapshot suite (`playwright.visual.config.ts`) screenshots full pages against **deployed staging with `PHASE2_*` secrets that are wired into NO workflow** — it can't run in CI and has been dormant since 2026-05-16. Extending it would build a gate that never auto-runs. Real automated visual regression wants **component-isolated** snapshots (deterministic, no live data), which is a proper investment done via **Playwright Component Testing on the Keywords pilot** (the pilot's states × themes are the first real matrix, validated before the Phase A fan-out). The dormant deploy-coupled suite is left as-is / retired, not resurrected.

**Tech Stack:** tsx scripts, the vite build manifest, `vitest` + `@testing-library/react` (present) + `vitest-axe` (new), GitHub Actions.

**Platform/Model:** Claude/Anthropic — **Opus** single-author (touches CI + a new verify script — the F2a governance/registry lessons apply).

---

## Decisions (owner)

**D-F2b-1 — DROP `lint:ds-adherence` (recommended, review-validated).** F2a's 7 `ds-*` rules gate token purity, and the ported components are typed `.tsx` so **tsc already errors on undeclared props** at direct call sites (verified). The kit's narrow prop allowlists would also fight the ratified D1 (widened props). The one thing the kit adherence config caught that nothing here does is **raw-px literals** — accepted deliberately (warn-only even in the kit; rebuilt components use inline-style px as the kit's own pattern; a `ds-raw-px` error rule would flag every shipped F3/F4 inline style). Do not build the ESLint-wrapper lane.

**D-F2b-2 — Accessibility = `vitest-axe` (RESOLVED — component-level, not Playwright).** `@axe-core/playwright` would plug axe into the dormant, deploy-coupled visual suite → a dormant a11y check. `vitest-axe` runs the **same axe engine** against jsdom-rendered components in the CI component-test suite — per-component, every PR, no deploy/secrets. This is the right layer. (Owner: veto only if you specifically want browser-level axe later; the component-level check is the durable automated floor.)

---

## Pre-requisites & scope
- Branch: `ui-rebuild-f2b-gates` (already created off staging; the F2b plan doc is on it). Standard git rules; controller commits.
- IN: `verify:bundle-budget` (Task 1), `vitest-axe` a11y infra + retroactive coverage of the shipped F3/F4 primitives (Task 2), pilot-DoD + doc reconciliation (Task 3).
- OUT: `lint:ds-adherence` (D-F2b-1), `@axe-core/playwright` + the deploy-coupled snapshot matrix (moved to component-visual-regression on the pilot).

## Task dependency graph
```
Task 1  verify:bundle-budget (script + baseline + governance + CI)
Task 2  vitest-axe a11y (dep + helper + apply to F3/F4 primitives + CI already runs it)
Task 3  reconcile: pilot DoD + docs + F2b backlog
Task 4  verification + PR
```

## File ownership
- Create: `scripts/verify-bundle-budget.ts`, `data/bundle-budget-baseline.json`, `tests/component/a11y.ts` (the axe helper)
- Modify: `package.json` (scripts + the `vitest-axe` devDep), `.github/workflows/ci.yml` (bundle step), `docs/rules/verification-governance.md`, `tests/component/setup.ts` (register the axe matcher if needed), a handful of `tests/component/ui/*.test.tsx` + `tests/component/layout/*.test.tsx` (add axe assertions), `docs/superpowers/plans/2026-07-05-ui-rebuild-pilot-keywords.md`, `docs/rules/ui-rebuild-consistency.md`, `data/ui-rebuild-deferred-ledger.json`

---

### Task 1 — `verify:bundle-budget` (frontend chunk-size ratchet)

Distinct from `verify:performance-budgets` (that's *server* AI/query/timing budgets). Gates **frontend route chunk sizes** from the vite manifest — the kit's "no 100KB+ monolith (the editor.js lesson)".

**Files:** Create `scripts/verify-bundle-budget.ts`, `data/bundle-budget-baseline.json`

- [ ] **1.1** `build.manifest` is UNSET in `vite.config.ts` (verified) — a plain `vite build` emits no manifest. Use **`npx vite build --manifest`** (emits `dist/.vite/manifest.json`) wherever the build runs here, OR glob `dist/assets/*.js` sizes directly. Route code-splitting is real (`src/App.tsx` lazy-imports ~30 routes) → per-route chunks exist, ratchet is meaningful. Read `vite.config.ts` for output naming.
- [ ] **1.2** Write `scripts/verify-bundle-budget.ts` mirroring **`scripts/report-style-drift.ts`** (read it first — its `data/style-drift-baseline.json` read + `--update`-rewrites-baseline + regression-fails/improvement-updates pattern; do NOT copy `report-coverage-ratchet.ts`, which has hardcoded floors + no `--update`):
  - Read `dist/.vite/manifest.json`; gzipped size per top-level entry/route chunk (Node `zlib.gzipSync`).
  - Compare to `data/bundle-budget-baseline.json` (`{ version, updatedAt, entries: { <chunk>: <maxGzipBytes> } }`); chunk > baseline + tolerance (5%) → exit 1 naming chunk + old/new; new chunk w/o baseline → warn; `--update` rewrites. Zero new deps (`zlib` + `fs`).
- [ ] **1.3** Baseline: `npx vite build --manifest && npx tsx scripts/verify-bundle-budget.ts --update`; commit `data/bundle-budget-baseline.json`.
- [ ] **1.4** `package.json`: `"verify:bundle-budget": "tsx scripts/verify-bundle-budget.ts"`. Add a `pr-ci-blocking` row to `docs/rules/verification-governance.md` (F2a lesson: `tests/contract/verification-governance-wiring.test.ts` fails if a `verify:*` script is unclassified or not referenced in `ci.yml`).
- [ ] **1.5** CI: the `quality` job already builds on every PR + push (`ci.yml:~134`) — no push-only build job. Add a `Verify bundle budget` step to `quality` immediately after the Build step (ensure the build emits the manifest: `--manifest`); reuses that build's output.
- [ ] **1.6** Verify: `npx vite build --manifest && npm run verify:bundle-budget` passes; tamper a baseline down → exit 1 naming the chunk; revert. `npx tsx scripts/pr-check.ts` clean. Commit.

### Task 2 — `vitest-axe` component accessibility

The axe engine in the CI component-test suite — catches contrast/ARIA/label/focus violations per component, every PR, no deploy.

**Files:** add `vitest-axe` devDep; create `tests/component/a11y.ts`; modify `tests/component/setup.ts` + select component tests

- [ ] **2.1** Add `vitest-axe` (devDependency). Confirm its peer (`axe-core`) resolves. Read `tests/component/setup.ts` for how matchers are currently registered (`@testing-library/jest-dom` is present).
- [ ] **2.2** Create `tests/component/a11y.ts`: export `async function expectNoA11yViolations(container: HTMLElement)` that runs `axe(container)` and asserts `toHaveNoViolations()` (register the `vitest-axe` matcher in `setup.ts` if not auto). Keep it a one-liner for tests to call.
- [ ] **2.3** Apply it to the **shipped F3/F4 primitives** as the proving ground (retroactive coverage): add an `expectNoA11yViolations` assertion to the render of `NavItem`, `NavGroup`, `RebuiltSidebar`, `RebuiltBreadcrumb`, `DataTable`, `Drawer`, `Segmented`, `RadioGroup`, `FilterChip`, `MetricTile` (their tests exist). Fix any real violation surfaced (that's the point — e.g. a missing label or contrast issue); if a violation is a known jsdom limitation (axe can't compute some contrast in jsdom), disable that specific rule with a comment, don't blanket-skip.
- [ ] **2.4** Document the contract in `docs/rules/ui-rebuild-consistency.md`: every `@ds-rebuilt` component/surface test must call `expectNoA11yViolations` on its primary render. Run `npm run test:component` (the CI-native suite) → green.
- [ ] **2.5** Commit.

### Task 3 — Reconcile the pilot DoD + docs + F2b backlog

- [ ] **3.1** Edit `docs/superpowers/plans/2026-07-05-ui-rebuild-pilot-keywords.md` (if not already reconciled in the same effort): **remove `lint:ds-adherence`** from Pre-req 2, Task 8.5, and Task 9.3; **add** `verify:bundle-budget` to Task 9.3; the a11y DoD box = `expectNoA11yViolations` (vitest-axe, Task 2); the **visual** DoD box points at the pilot's own Playwright-CT visual-regression task (the pilot builds + proves it). Update the "F2b outstanding" pre-req note to what F2b actually shipped.
- [ ] **3.2** `docs/rules/ui-rebuild-consistency.md` F2b backlog: mark `verify:bundle-budget` + `vitest-axe` DONE; record `lint:ds-adherence` **retired-redundant** (D-F2b-1, incl. accepted raw-px gap); record the visual gate as **component-isolated Playwright CT, built on the pilot** (NOT the dormant deploy suite). Fix the stale D5 icon reference (~lines 22-23 say "lucide-react is the ratified system" — D5 reversed to Font Awesome Sharp Regular; the rule flags emoji, lucide `as=` is the migration path).
- [ ] **3.3** Any deferred-ledger row tracking the F2b gates → update. Commit.

### Task 4 — Verification + PR

- [ ] **4.1** Full gates, sequential: `npm run typecheck && npx vite build --manifest && npm run verify:bundle-budget && npx tsx scripts/pr-check.ts && npm run lint:hooks && npm run verify:deferred-ledger && npm run verify:governance && npm run test:component && npx vitest run` (governance-wiring contract test must be green).
- [ ] **4.2** PR to `staging`: "UI Rebuild F2b — bundle-budget gate + vitest-axe a11y". Body: the two decisions (D-F2b-1 drop lint:ds-adherence, D-F2b-2 vitest-axe), why the visual matrix moved to the pilot (dormant deploy suite), the pilot-DoD reconciliation. Verify CI actually ran.

---

## Cross-phase contracts (F2b → Pilot → Phase A)
- **Every `@ds-rebuilt` surface test calls `expectNoA11yViolations`** (the a11y floor) and lands a `verify:bundle-budget` baseline entry.
- The pilot introduces **Playwright Component Testing visual regression** (states × themes) and proves it on Keywords; Phase A adopts it per surface.

## Systemic improvements
- Removes a redundant would-be gate (`lint:ds-adherence`) before it's built, and a dormant-infra gate (deploy-coupled snapshots) — YAGNI with evidence.
- `vitest-axe` gives the whole rebuild a real, CI-native a11y floor at the right layer.

## Risks
- **Vite manifest shape** → Task 1.1 uses `--manifest` explicitly.
- **vitest-axe surfaces real violations in shipped primitives** → that's the point; fix them (in-scope per the house "fix review bugs" rule). Distinguish jsdom limitations (rule-scope disable) from real issues.
- **Governance/contract-test trap (F2a lesson)** → Task 1.4 classifies the script; Task 4.1 runs `verify:governance`.

## Definition of done
- [ ] `verify:bundle-budget` script + baseline + governance + CI wire; tamper-test demonstrated red
- [ ] `vitest-axe` dep + `expectNoA11yViolations` helper + applied to the shipped F3/F4 primitives (real violations fixed); runs in the CI `test:component` suite
- [ ] Pilot DoD reconciled (lint:ds-adherence removed; bundle-budget + vitest-axe added; visual gate = pilot's Playwright CT task); consistency doc F2b backlog closed + D5 reference fixed
- [ ] All gates green; PR to `staging` with CI that ran
