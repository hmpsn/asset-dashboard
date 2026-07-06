# UI Rebuild F2b — Remaining Consistency Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Single-author, sequential.

**Goal:** Ship the remaining consistency gates the Keywords pilot's DoD depends on — a frontend `verify:bundle-budget` ratchet and a theme×state visual-snapshot harness — and reconcile the F2b backlog (drop the now-redundant `lint:ds-adherence`).

**Architecture:** F2a already shipped the mechanized token-purity gates (the 7 pr-check `ds-*` rules) + the deferred ledger. F2b closes the two remaining AUTO gates from Build Conventions: **bundle budget** (a vite-manifest chunk-size ratchet, modeled on **`scripts/report-style-drift.ts` + `data/style-drift-baseline.json`** — the repo's actual committed-baseline ratchet with an `--update` rewrite pattern; NOT `report-coverage-ratchet.ts`, whose floors are hardcoded constants with no baseline file) and the **theme×state snapshot matrix** (an extension of the existing deployed-staging `playwright.visual.config.ts`). Design authority: [cross-consistency.md §3.3-3.4](../../ui-rebuild/phase0/cross-consistency.md); the ratchet precedent is §1.3.

**Tech Stack:** tsx scripts, the vite build manifest, `@playwright/test` (already a dep), the existing `tests/playwright/visual/` suite, GitHub Actions.

**Platform/Model:** Claude/Anthropic — **Opus** single-author (touches CI + a new verify script — the F2a governance/registry lessons apply).

---

## ⚠ Two scope decisions (owner — flagged, defaults documented)

**D-F2b-1 — DROP `lint:ds-adherence` (recommended).** The original F2b spec (cross-consistency §3.1) wanted an ESLint-wrapper lane consuming the kit's `_adherence.oxlintrc.json`. Since that spec was written, two things changed that make it **redundant and counter-productive**:
1. F2a shipped the 7 pr-check `ds-*` rules → **token purity** (hex/palette/motion/theme-parity/icon/deep-import/per-view-css) is already gated at error severity on `@ds-rebuilt` files.
2. The components were ported to typed `.tsx` (D1). The adherence config's core value was **prop conformance** (undeclared props on DS components) — but **TypeScript already enforces that** for typed props. The kit's config existed because the kit was untyped `.jsx`.
3. Worse: the kit's prop *allowlists* are the kit's NARROW prop sets; our ratified D1 deliberately WIDENED props (`className`/`id`/HEAD extras). Running the kit allowlists would **false-positive on our intentional superset props** — actively fighting D1 (cross-consistency §4.5 called this "exactly backwards").
**Default: do not build `lint:ds-adherence`; remove it from the pilot DoD (Task 3). tsc + the F2a `ds-*` rules cover its intent.** Veto if you want the ESLint wrapper anyway.

*Verified by adversarial review (2026-07-05): tsc genuinely errors on undeclared props at direct JSX call sites for every `@ds-rebuilt` component (closed `interface`, no index signature, no `...rest`-onto-DOM); the 7 `ds-*` rules cover hex/palette/motion/theme/icon/deep-import/per-view-css. The ONE thing the kit adherence config caught that nothing here does is **raw-px literals** (`padding: '8px 10px'`). We ACCEPT that gap deliberately: (i) it was `warn`-only even in the kit; (ii) the rebuilt components use inline-style px as the kit's own deliberate pattern (`--space-*` tokens are for layout composition, not every inline value); (iii) a `ds-raw-px` error rule would retroactively flag every shipped F3/F4 inline style. Adding such a rule is explicitly NOT in scope.*

**D-F2b-2 — `@axe-core/playwright` dependency (owner approval).** The a11y AUTO gate (44px targets, focus visibility) needs `@axe-core/playwright` — a new devDependency (cross-consistency §3.4, §7 stop-and-ask #4). **Default: do NOT add the dep in F2b; the a11y DoD box stays REVIEW (manual keyboard/focus check + the component-test a11y assertions the pilot already writes), never silently AUTO.** Approve the dep and I'll wire axe into the snapshot run (Task 2 optional step).

---

## Pre-requisites & scope
- Branch off staging **after F4 merges**: `ui-rebuild-f2b-gates`. Standard git rules; controller commits.
- IN: `verify:bundle-budget` (Task 1), the theme×state snapshot harness scaffold (Task 2), pilot-DoD + doc reconciliation (Task 3).
- OUT (per D-F2b-1/2): `lint:ds-adherence`, `@axe-core/playwright` (unless approved).
- The snapshot **baselines** are captured per-surface as each surface deploys to staging (the existing phase2-baseline pattern) — F2b builds the *harness*, the pilot captures Keywords' cells. F2b is not blocked on a deployed rebuilt surface.

## Task dependency graph
```
Task 1  verify:bundle-budget (script + baseline + governance + CI)   ← the concrete gate the pilot DoD needs
Task 2  theme×state snapshot harness (extend playwright.visual)      ← scaffold; pilot captures cells
Task 3  reconcile: pilot DoD (drop lint:ds-adherence) + docs + F2b backlog
Task 4  verification + PR
```

## File ownership
- Create: `scripts/verify-bundle-budget.ts`, `data/bundle-budget-baseline.json`, `tests/playwright/visual/rebuild-surface.matrix.spec.ts` (harness skeleton)
- Modify: `package.json` (one script), `.github/workflows/ci.yml` (one step), `docs/rules/verification-governance.md` (classify the new script), `docs/superpowers/plans/2026-07-05-ui-rebuild-pilot-keywords.md` (DoD reconcile), `docs/rules/ui-rebuild-consistency.md` (F2b backlog → done), `data/ui-rebuild-deferred-ledger.json` (close the F2b backlog rows if any)

---

### Task 1 — `verify:bundle-budget` (frontend chunk-size ratchet)

Distinct from `verify:performance-budgets` (that's *server* AI/query/timing budgets). This gates **frontend route chunk sizes** from the vite build manifest — the kit's "no 100KB+ monolith (the editor.js lesson)" (Build Conventions).

**Files:** Create `scripts/verify-bundle-budget.ts`, `data/bundle-budget-baseline.json`

- [ ] **1.1** `build.manifest` is UNSET in `vite.config.ts` (verified) — so a plain `vite build` emits NO manifest. Use **`npx vite build --manifest`** (emits `dist/.vite/manifest.json`) everywhere the build is run in this task, OR have the script glob `dist/assets/*.js` sizes directly. Route code-splitting is real (`src/App.tsx` lazy-imports ~30 routes), so per-route chunks exist and the ratchet is meaningful. Read `vite.config.ts` for output naming.
- [ ] **1.2** Write `scripts/verify-bundle-budget.ts` (mirror the ratchet semantics of **`scripts/report-style-drift.ts`** — read it first for its `data/style-drift-baseline.json` read + the `--update`-rewrites-baseline + regression-fails / improvement-updates pattern; do NOT copy `report-coverage-ratchet.ts`, which uses hardcoded floor constants and has no `--update`/baseline file):
  - Read `dist/.vite/manifest.json` (from `vite build --manifest`); compute the gzipped size per top-level entry/route chunk (Node `zlib.gzipSync` on the emitted file bytes).
  - Compare against `data/bundle-budget-baseline.json` (`{ version, updatedAt, entries: { <chunk>: <maxGzipBytes> } }`).
  - A chunk exceeding its baseline by > a tolerance (e.g. 5%) → exit 1, naming the chunk + old/new size. A new chunk with no baseline → warn (must be added via `--update`). `--update` rewrites the baseline.
  - Zero new dependencies (Node `zlib` gzip + fs).
- [ ] **1.3** Generate the initial baseline: `npx vite build --manifest && npx tsx scripts/verify-bundle-budget.ts --update`; commit `data/bundle-budget-baseline.json`.
- [ ] **1.4** `package.json`: `"verify:bundle-budget": "tsx scripts/verify-bundle-budget.ts"`. Add a governance row to `docs/rules/verification-governance.md` classified **`pr-ci-blocking`** (the `quality` job runs on PRs) — the F2a lesson: `tests/contract/verification-governance-wiring.test.ts` asserts every `verify:*` script is classified AND referenced in `ci.yml`, or it fails.
- [ ] **1.5** CI: the `quality` job **already runs `npm run build` on every PR and push** (`ci.yml:~134`) — there is NO separate push-only build job. Add a `Verify bundle budget` step to the `quality` job **immediately after the existing Build step** (change the build to emit the manifest: `npm run build -- --manifest` or add `--manifest` to the build script); the step reuses that build's output — it costs only the size comparison, not a second build.
- [ ] **1.6** Verify: `npx vite build --manifest && npm run verify:bundle-budget` → passes (baseline just captured); tamper a baseline entry down → exit 1 naming the chunk; revert. `npx tsx scripts/pr-check.ts` clean. Commit.

### Task 2 — Theme×state visual-snapshot harness

Extend the existing deployed-staging visual suite (`playwright.visual.config.ts` → `tests/playwright/visual/`) with the surface × {dark, `.dashboard-light`} × {loading, empty, error, locked, populated} dimension (Build Conventions "both themes" + "four states"). F2b builds the **parametrized harness**; each surface's baselines are captured when that surface deploys (the pilot captures Keywords').

- [ ] **2.1** Read `tests/playwright/visual/phase2-baseline.spec.ts` for the existing capture pattern (auth via `PHASE2_ADMIN_TOKEN`, navigation, `toHaveScreenshot()`).
- [ ] **2.2** Create `tests/playwright/visual/rebuild-surface.matrix.spec.ts`: a **parametrized skeleton** iterating a `REBUILD_SURFACES` list (empty or `['keywords']` initially) × themes × states. For each cell: navigate to the surface with the `ui-rebuild-shell` flag ON + a state query param (e.g. `?__ds-state=empty`), toggle theme (add/remove `.dashboard-light` on the root via `page.evaluate`), `toHaveScreenshot(\`\${surface}-\${theme}-\${state}.png\`)`. It captures nothing until a surface + its reachable states exist — that's intended (the pilot adds `keywords` + wires the state param).
- [ ] **2.3** Document the state-reachability contract: a rebuilt surface must expose its four non-populated states via a harness query param (the pilot's Task 8.3 owes this). Add this to `docs/rules/ui-rebuild-consistency.md`.
- [ ] **2.4** Cadence note in the config comment: PR-diff-scoped (changed surface's cells) per PR, full matrix nightly (cross-consistency §3.3). No baselines committed in F2b (none exist yet). Commit.
- [ ] **2.5 (ONLY if D-F2b-2 approved)** Add `@axe-core/playwright` (devDep); in the matrix spec's populated cell, run `AxeBuilder` and assert zero critical violations. If not approved, skip — a11y stays REVIEW.

### Task 3 — Reconcile the pilot DoD + docs + F2b backlog

- [ ] **3.1** Edit `docs/superpowers/plans/2026-07-05-ui-rebuild-pilot-keywords.md` — **remove `lint:ds-adherence` from ALL THREE sites** (per D-F2b-1): Pre-req 2, **Task 8.5** (`"confirm lint:ds-adherence + verify:bundle-budget pass"`), and Task 9.3's gate list. **Add** `verify:bundle-budget` to Task 9.3 (it is NOT currently listed there — Task 9.3 lists `verify:coverage-ratchet`; this is an add, not a keep). Point the snapshot DoD box at the Task 2 harness (the pilot adds `keywords` to `REBUILD_SURFACES` + wires the `?__ds-state=` param + captures baselines against staging). Update the "F2b outstanding" pre-req note to reflect what F2b actually shipped.
- [ ] **3.2** `docs/rules/ui-rebuild-consistency.md` F2b backlog section: mark `verify:bundle-budget` + snapshot-matrix DONE; record `lint:ds-adherence` as **retired-redundant** with the D-F2b-1 rationale (incl. the accepted raw-px gap); note axe status (REVIEW pending dep approval). **While in this file, fix the stale D5 reference** (~lines 22-23 still say `ds-icon-discipline` → "lucide-react is the ratified system" — D5 was reversed to Font Awesome Sharp Regular; the actual rule at `pr-check.ts:7150` flags emoji, and lucide `as=` is the migration path). Correct the icon row to match.
- [ ] **3.3** If any deferred-ledger row tracked the F2b gates, update it. Commit.

### Task 4 — Verification + PR

- [ ] **4.1** Full gates, sequential: `npm run typecheck && npx vite build && npm run verify:bundle-budget && npx tsx scripts/pr-check.ts && npm run lint:hooks && npm run verify:deferred-ledger && npm run verify:governance && npx vitest run` (the governance-wiring contract test must be green — it enforces the new script's classification).
- [ ] **4.2** Confirm `npx playwright test --config playwright.visual.config.ts --list` includes the new matrix spec without error (it lists zero cells until a surface is added — that's expected; the skeleton must parse).
- [ ] **4.3** PR to `staging`: "UI Rebuild F2b — bundle-budget gate + theme×state snapshot harness". Body: the two scope decisions (D-F2b-1 drop lint:ds-adherence, D-F2b-2 axe status), what shipped, and the pilot-DoD reconciliation. Verify CI actually ran.

---

## Cross-phase contracts (F2b → Pilot)
- The pilot adds `'keywords'` to `REBUILD_SURFACES` and wires the `?__ds-state=` harness param (pilot Task 8.3/8.5); it captures the Keywords baselines against staging in its own PR.
- `verify:bundle-budget` runs on every subsequent surface PR; each surface's chunk gets a baseline entry as it lands.

## Systemic improvements
- Establishes the "harness-in-F2b, baselines-per-surface" pattern the whole fan-out reuses.
- Removes a redundant would-be gate (`lint:ds-adherence`) before it's built — YAGNI applied with evidence.

## Risks
- **Vite manifest shape uncertainty** → Task 1.1 confirms it empirically before writing the script.
- **Snapshot harness captures nothing yet** → intended; the skeleton must parse + list clean (Task 4.2), baselines come with surfaces.
- **Governance/contract-test trap (F2a lesson)** → Task 1.4 classifies the new script; Task 4.1 runs `verify:governance`.

## Definition of done
- [ ] `verify:bundle-budget` script + committed baseline + governance classification + CI wire; tamper-test demonstrated red
- [ ] Theme×state matrix harness skeleton parses + lists clean; state-reachability contract documented
- [ ] Pilot DoD reconciled (lint:ds-adherence removed, bundle-budget + snapshot harness pointed to); consistency doc F2b backlog closed
- [ ] `lint:ds-adherence` explicitly retired-redundant (D-F2b-1) OR built (if vetoed); axe REVIEW (D-F2b-2) OR wired (if approved)
- [ ] All gates green; PR to `staging` with CI that ran
