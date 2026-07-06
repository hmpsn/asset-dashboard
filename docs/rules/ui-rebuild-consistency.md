# UI Rebuild — Consistency Contract

> The enforcement + review machinery for the UI rebuild. Mechanized gates keep
> rebuilt surfaces token-pure and prop-correct; the agentic cadence catches what
> grep can't; the deferred ledger keeps quick-win trade-offs from rotting into
> permanent debt. Design authority: [cross-consistency.md](../ui-rebuild/phase0/cross-consistency.md) §3–§5 + [STRATEGY.md](../ui-rebuild/phase0/STRATEGY.md) §4. Decisions: [PHASE_D_DECISIONS.md](../ui-rebuild/phase0/PHASE_D_DECISIONS.md).

---

## 1. The `@ds-rebuilt` marker contract

A file carrying the `@ds-rebuilt` marker (anywhere — a header comment is the convention) opts into the UI-rebuild strict gates. This is the D2 rebuild scope: **in-place-behind-flags** with a per-file marker, so the gates apply to rebuilt surfaces only and pre-rebuild code is untouched.

Adding the marker opts a file into **seven pr-check rules at error severity (D7)** — no warn-first ladder, because nothing exists to backfill:

| Rule | Flags (in `@ds-rebuilt` files only) | Inline hatch |
|---|---|---|
| `ds-raw-hex-anywhere` | raw `#rrggbb` hex — use a `--*` token | `// raw-hex-ok` |
| `ds-tailwind-palette-bypass` | raw Tailwind palette class (`text-zinc-400`, `bg-blue-500`, …) — use token-backed classes | `// palette-ok` |
| `ds-per-view-css-block` | `const *css*/*styles* =` or `<style>` — compose primitives, don't fork CSS per view | `// view-css-ok` |
| `ds-token-theme-parity` | a themeable `--*` in `:root` without a `.dashboard-light` override (or vice versa); theme-neutral families exempt | none (structural) |
| `ds-icon-discipline` | raw Font Awesome `fa-*` classes or emoji-as-icon — use `<Icon name="…">`; `<Icon as={LucideIcon}>` remains a migration path (D5) | `// icon-ok` |
| `ds-deep-import` | import into `components/ui/internal/` — import the public primitive (backstop; refined in F3) | `// deep-import-ok` |
| `ds-motion-token` | literal transition/animation duration — use `var(--dur-fast\|base\|slow)` | `// motion-ok` |

**Hatch discipline:** inline only (the same-line hatch; above-line is silently ignored for these rules — house memory). Every hatch needs a justifying comment; a bare hatch is a review reject.

**Overlap with pre-rebuild rules (double-hatch cost):** the repo-wide legacy rules (`Raw text-zinc-N`/`bg-zinc-N`/`border-zinc-N`, `Hardcoded dark hex in inline styles`, `Raw hex chart color`) still fire on `@ds-rebuilt` files — their guidance agrees with the `ds-*` rules (both say "use tokens"), so overlap is harmless, but a genuinely-exempt line needs **both** hatches on the same line (e.g. `// palette-ok raw-zinc-ok`). Known cost, accepted: honoring sibling hatches across rules would couple rule implementations. Noise-trimming already applied (review, PR #1473): `ds-raw-hex-anywhere` skips comment contexts (PR refs like `#1472`) and `href="#…"` anchors; `ds-icon-discipline` excludes the dingbat range (✓ ⚠ ★ are string glyphs, not icons).

F2b deliberately retired the proposed `lint:ds-adherence` lane: F2a's seven
`ds-*` rules cover token purity, TypeScript catches invalid direct props, and
the remaining raw-px signal is accepted for rebuilt inline-style components.

---

## 2. Agentic review cadence (3 tiers)

Mechanized gates prove token-purity and prop shapes; they cannot see that two agents built the same filter bar two different ways, or that a surface drifted from its prototype. Three recurring reviews, each with a trigger (verbatim from [STRATEGY.md §4.2](../ui-rebuild/phase0/STRATEGY.md)):

1. **Per-batch diff review** (existing mandate, extended): hatch-justification grep; cross-surface duplicate-interaction scan; prop-shape spot-check against `.d.ts`; punted items → ledger, never TODO.
2. **Consistency sweep every 3 merged surfaces** (or weekly): five lanes — visual drift vs the Reference Screen, primitive divergence, prototype fidelity (IA/flows/URL state), behavior contract (mutation classing, state correctness), words & numbers (copy voice; every client figure display-only). Critical/Important fixed before the next batch dispatches; improvements → ledger.
3. **Phase-gate holistic review per lane/phase:** whole-arc end-to-end + flag-ON real-browser smoke of every surface in the phase (the fixture-masked-bug lesson: green gates missed a dead send spine) + evaluative `persona-audit` on client-facing surfaces + the full ledger walk.

Deliberately not mechanized (no grep-able symptom): mutation-contract classing, derived-vs-delivered numbers, copy voice — these live in sweep lanes 4–5 and the DoD review boxes.

---

## 3. Deferred-ledger discipline

`data/ui-rebuild-deferred-ledger.json` records every rebuild trade-off (a hatch, an unmet DoD box, a T1 carry-over). `npm run verify:deferred-ledger` (quality-job CI step) enforces:

- **Schema** — each entry has `id` (`DEF-<surface>-NNN`), `surface`, `item`, `decision` (what was traded + why, so a future agent doesn't "fix" it blind), `class`, `upgradeTrigger` (the condition that converts the deferral to work — **"someday" is not a trigger**), `owner`, `status`, `roadmapItemId`, `createdAt`, `reviewBy`.
- **Expiry** — an `open` entry past `reviewBy` fails CI with the id + owner. The forced action is a review: extend `reviewBy` with a fresh decision, schedule it, or retire it — never silent aging.
- **Roadmap linkage** — `scheduled`/`done` entries must point at a real `data/roadmap.json` item id in the matching state.

**The core rule:** the PR that *introduces* a trade-off adds its `DEF-*` row **in the same PR** (checked socially at per-batch diff review — if the diff has a hatch or a punted DoD box, the ledger must have a row). Review-found bugs get fixed in-PR — never ledgered.

### Review cadence (so deferreds don't rot)

| When | What happens |
|---|---|
| Every rebuild PR | CI runs `verify:deferred-ledger`; the trade-off-introducing PR adds its row in the same PR. |
| Consistency sweep (§2.2) | Each lane reads its `class` slice; sweeps may flip `upgradeTrigger`-met entries to `scheduled` (creating the roadmap item). |
| Phase gate (§2.3) | Full ledger walk with the owner: every `open` entry re-justified or scheduled/retired. A phase does not merge to staging with unreviewed expired entries. |
| Platform-health checkpoint (`docs/workflows/platform-health-cadence.md`, every 4–6 sprints) | Ledger size + age become health metrics: count of `open`, oldest `createdAt`, expired count. |

---

## 4. F2b gate status

F2b closes the remaining CI-native gates that do not require a deploy or
secrets. Visual regression stays component-isolated and lands on the Keywords
pilot, not in the dormant deploy-coupled snapshot suite.

| Item | Status |
|---|---|
| `verify:bundle-budget` ratchet from the Vite manifest | **DONE in F2b.** `npx vite build --manifest` emits `dist/.vite/manifest.json`; `npm run verify:bundle-budget` compares gzip sizes for all manifest JS chunks plus manifest/index-linked CSS and font assets (including self-hosted Font Awesome) to `data/bundle-budget-baseline.json` with 5% tolerance and runs in PR quality CI. |
| Component-level accessibility | **DONE in F2b.** `tests/component/a11y.ts` exposes `expectNoA11yViolations(container)` via `vitest-axe`; every `@ds-rebuilt` component/surface test must call it on the primary render. The helper disables only axe's `color-contrast` rule because jsdom lacks canvas `getContext`; browser visual/manual review still owns contrast. |
| `lint:ds-adherence` ESLint-wrapper lane | **RETIRED-REDUNDANT (D-F2b-1).** F2a `ds-*` rules + TypeScript prop checking cover the useful parts; the raw-px gap is accepted for inline-style DS components. |
| Browser-level axe via `@axe-core/playwright` | **MOVED OUT.** Would attach to the dormant deploy-coupled snapshot suite; component-level `vitest-axe` is the CI floor. Browser-level axe can be added later as an explicit surface smoke, not F2b. |
| Snapshot theme×state matrix | **MOVED TO PILOT.** The Keywords pilot builds Playwright Component Testing visual regression (component-isolated states × themes) and becomes the Phase A template. |
| `ds-state-matrix-presence` rule (require Skeleton/EmptyState/error refs per surface) | Deferred until the Keywords pilot proves the real state matrix. |
| `ds-reinvented-primitive` drift-scanner categories (extend `scripts/report-style-drift.ts` — never a second scanner) | Deferred until the Keywords pilot gives real duplication categories. |
| Hatch-reconciliation in `verify-deferred-ledger.ts` (cross-check `-ok` hatches ↔ ledger rows) | Deferred until the first `-ok` hatch lands in a rebuilt surface. |
