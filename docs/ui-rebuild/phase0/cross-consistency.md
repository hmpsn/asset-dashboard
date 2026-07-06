# Phase 0 — Build-Consistency Enforcement + Deferred-Work Tracking

> Read-only audit + design, branch `ui-rebuild-phase-0` (== post-Reconcile origin/staging HEAD), 2026-07-03.
> Mandate: design the machinery that keeps an 18-surface parallel rebuild consistent, and the ledger that keeps quick-win trade-offs from rotting. Nothing here changes code; every mechanism below is a proposal grounded in what exists at HEAD.
> Companion docs: `cross-client-dashboard.md` (client gate), `surfaces/*.md` (per-surface parity ledgers).

---

## 1. What exists at HEAD — the enforcement stack (evidence inventory)

The rebuild does not start from zero. HEAD already has a five-layer enforcement stack; the design in §3–§5 extends it rather than inventing a parallel one.

### 1.1 `scripts/pr-check.ts` — the CHECKS array

- 9,790 lines; `export type Check` at `scripts/pr-check.ts:308-338`, `export const CHECKS: Check[]` at `scripts/pr-check.ts:1537`. Two detection modes: single-line ripgrep `pattern` and cross-line `customCheck(files) => CustomCheckMatch[]` (`scripts/pr-check.ts:306`).
- Rule metadata (`rationale`, `claudeMdRef`, `displayScope`) drives the generated `docs/rules/automated-rules.md`; CI fails if it drifts (`.github/workflows/ci.yml:209-213`, `npm run rules:generate`).
- Escape-hatch convention: every rule ships a `// <short-name>-ok` inline hatch, honoured on the flagged line or the line above via `hasHatch()` (`scripts/pr-check.ts:579-581`); destructive-migration hatches are inline-only by design (`scripts/pr-check.ts:2440-2458`).
- Authoring contract (`docs/rules/pr-check-rule-authoring.md`): 4 preconditions for a new rule (grep-able symptom, TS can't catch it, happened ≥2×, CLAUDE.md anchor, lines 9-16); ship at `warn`, promote to `error` at zero `--all` hits (lines 127-134); <20% false-positive budget; retire criteria (line 206).
- Default scope is diff-only (changed + untracked files); `--all` for audits (`scripts/pr-check.ts:3-13`).

### 1.2 CI gates (`.github/workflows/ci.yml`)

Quality job (lines 131-167): `typecheck` → `build` → `pr-check` → `check:circular-deps` (ratchet) → `verify:feature-flags` → `verify:lexicon` → `verify:governance` → `lint:hooks` (rules-of-hooks only) → `verify:style-drift` → `verify:staging-merge-integrity` → AI-reliability soft gate. Plus Phase-2 frozen-paths guard (lines 189-200) and the automated-rules sync check (lines 209-213). Test job: 8 sharded vitest lanes (lines 237-252). Coverage: `test:coverage` + `verify:coverage-ratchet` (lines 350-355), manual-only lane. Nightly: `pr-check-nightly.yml` runs staging-merge integrity soft-gate at 06:17 UTC (lines 5, 37).

### 1.3 `scripts/report-style-drift.ts` — the style ratchet (the key precedent)

1,062 lines. Already implements exactly the shape the rebuild needs, one layer down:

- **Metric ratchet against a committed baseline** — `data/style-drift-baseline.json`; regression in any `StyleMetricKey` (raw buttons, typography bypass, radius literals, disallowed hues, non-primitive actions, exception count) fails CI unless `--advisory` (`report-style-drift.ts:9-16, 100, 113-114`).
- **Expiring, owned exceptions** — `data/style-exceptions.json` with `StyleExceptionEntry { id, rule, file, reason, owner, expiresOn, createdAt }` (`report-style-drift.ts:19-27, 94`). Currently empty (`data/style-exceptions.json:4`). This owner+expiry pattern is reused for the deferred ledger (§5).
- **Primitive-divergence detectors already live**: badge-like spans, duplicate headings, nested-card density, blue-action semantic drift, status semantic mapping, muted-text tiers, raw z-index literals, focus-ring contract, stat-primitive bypass (`report-style-drift.ts:56-79`). The rebuild's "no reinvented primitives" gate should extend these categories, not fork a second scanner.

### 1.4 Visual + e2e infrastructure

- `playwright.visual.config.ts` exists — Phase-2 visual baseline suite, staging-deployed target, `toHaveScreenshot()` zero-diff policy, own testDir `tests/playwright/visual` (`playwright.visual.config.ts:4-33`); npm scripts `phase2:baseline` / `phase2:baseline:update` (`package.json:34-35`). It snapshots **dark theme only, populated state only** today.
- **No axe/a11y automation exists** — `@axe-core`/`axe-playwright` absent from `package.json` (verified by grep, no hits).
- **No bundle-size gate exists** — no `bundle` script or budget assertion in `package.json` (verified by grep, no hits).
- Light theme exists at HEAD only as `.dashboard-light` override CSS in `src/index.css:321-408`; `src/tokens.css` has no `.dashboard-light` scope — the kit's "new token goes in both `:root` and `.dashboard-light`" rule has no enforcement target at HEAD yet.

### 1.5 Existing agentic review machinery

- CLAUDE.md mandates diff review after every parallel batch and `scaled-code-review` before merging multi-agent work (Quality Gates); `persona-audit` skill exists for evaluative surface reviews; the Reconcile run added an explicit 3-tier review cadence (commit `ecc691128`).

---

## 2. The kit's `_adherence.oxlintrc.json` — what it enforces, and whether it runs here as-is

Location: `"hmpsn studio Design System/_adherence.oxlintrc.json"` (33.2KB). **Auto-generated by the kit compiler — never hand-edit** (kit `CLAUDE.md`, "Authoring this design system": "Never hand-write `_ds_bundle.js` / `_ds_manifest.json` / `_adherence.oxlintrc.json`").

### 2.1 Contents (verified by parsing)

| Rule | What it enforces | Count |
|---|---|---|
| `no-restricted-imports` (warn) | Barrel-only imports: forbids `components/buttons/**`, `components/data/**`, …, `mockup/**`, `ui_kits/**` — "Import design-system components from 'index.js', not component internals." Overridden off for `**/index.js` itself. | 1 pattern group, 10 globs |
| `no-restricted-syntax` (warn) | 3 global selectors: raw hex literal (`Literal[value=/#[0-9a-fA-F]{3,8}\b/]` → "use a design-system color token via var()"), raw px literal (`Literal[value=/\b\d+px\b/]` → spacing token), font-family outside {DIN Pro, Inter, JetBrains Mono}. | 3 selectors |
| `no-restricted-syntax` (warn) | **Component-prop conformance**: 66 esquery selectors of the form `JSXOpeningElement[name.name='Avatar'] > JSXAttribute > JSXIdentifier[name!=/^(?:initials|icon|src|tone|…)$/]` — one per DS component, rejecting undeclared props. Covers all 59 kit components (AppShell, Badge, Button … Toolbar, Tooltip, TrendBadge, WorkflowStep). | 66 selectors |
| `react/forbid-elements` (warn) | Present but **empty** (`"forbid": []`) — a placeholder the compiler will populate (presumably raw `<button>`/`<input>` bans) once `x-omelette.components[*].replaces` is filled. | 0 |
| `x-omelette` metadata | Per-component `replaces: []` arrays — **all empty**. The intended old-component→DS-component mapping (e.g. `StatCard replaces src/components/ui/StatCard`) is unpopulated. | 59 entries, 0 mappings |

### 2.2 Can it run in this repo's CI as-is? **No — four adaptations required.**

1. **No runner.** The repo has ESLint 9 only (`package.json:159`); oxlint is not a dependency. Two options: (a) add `oxlint` as a devDependency and validate that its `no-restricted-syntax` implementation accepts these regex-valued esquery attribute matchers (`[name!=/^(?:…)$/]` and `Literal[value=/…/]`) — this must be **empirically verified**, not assumed; or (b) mount the same JSON under an ESLint flat-config wrapper (the three rule names and selector syntax are ESLint-native), reusing the existing `lint:hooks`-style focused-config pattern (`eslint.rules-of-hooks.config.js`, `package.json:39`).
2. **Import paths are kit-relative.** The `no-restricted-imports` globs (`components/buttons/**` etc.) describe the kit's own tree, not wherever the DS lands in `src/`. The config must be regenerated (or path-mapped in the wrapper) once the DS import root is fixed — and regeneration is the kit compiler's job, not a hand edit (→ stop-and-ask #2).
3. **Everything is `warn`.** As-is it fails nothing. CI needs a severity policy: run with `--max-warnings=0` scoped to rebuild paths (see §3.1), mirroring the authoring guide's warn→error promotion ladder.
4. **Blind spots to cover elsewhere.** The selectors only see JSX/JS *literals*: they miss template-literal classNames, Tailwind palette utilities (`bg-zinc-800`), CSS files, and `style={{ color: '#…' }}` object values whose AST shape isn't a bare Literal in some cases. §3.2's pr-check rules close these gaps; the adherence lint is necessary, not sufficient.

**Verdict:** treat `_adherence.oxlintrc.json` as the machine-readable *contract* (prop unions, token-purity intent) and give it a thin repo-side runner. The kit's own instruction agrees: "Seed the CI gates (adherence lint = `_adherence.oxlintrc.json`, theme×state visual snapshots, bundle budget) against the reference screen *before* real surfaces land" (kit `CLAUDE.md`, Process).

---

## 3. Design — the consistency auditor, mechanized layer

Scoping principle: every new rule takes a `pathFilter` on the rebuild root (whatever directory the owner designates for rebuilt surfaces — stop-and-ask #1) so the legacy app never drowns the signal, plus warn-first severity per the authoring guide. Each rule below is named, with its detection pattern and hatch.

### 3.1 New lint lane: `lint:ds-adherence`

- `npm run lint:ds-adherence` → runner (oxlint or ESLint wrapper per §2.2 decision) over the rebuild path with the adherence config, `--max-warnings=0`.
- Wire as a new step in the CI quality job directly after `lint:hooks` (`.github/workflows/ci.yml:155-156`).
- This lane owns: raw hex/px literals in JSX, font allowlist, barrel-only imports, **component-prop conformance** (the 66 selectors — the only place prop conformance is checkable without hand-writing 59 pr-check rules).
- When the DS compiler regenerates the config, the committed copy in-repo must be byte-identical to the kit's — add a sync check exactly like the automated-rules.md drift gate (`ci.yml:209-213`): `diff <kit>/_adherence.oxlintrc.json <repo-copy> || fail`.

### 3.2 New pr-check rules (CHECKS array additions)

All follow the authoring contract: `name`, ripgrep `pattern` or `customCheck`, `excludeLines` hatch named in `message`, `rationale`, `claudeMdRef` (a new CLAUDE.md "UI Rebuild conventions" anchor to be added when the first build PR opens — guardrails-before-first-commit, CLAUDE.md Session Protocol §8).

| Rule name | Detection pattern | Hatch | Catches what the adherence lint can't |
|---|---|---|---|
| `ds-raw-hex-anywhere` | `#[0-9a-fA-F]{3,8}\b` in `*.tsx`, `*.ts`, `*.css` under the rebuild root (CSS files + template literals + style objects — the lint only sees JS literals) | `// raw-hex-ok` (CSS: `/* raw-hex-ok */`) | Hex in tailwind arbitrary values `bg-[#0a0a0a]`, CSS files, template strings |
| `ds-tailwind-palette-bypass` | `(?:text\|bg\|border\|ring\|from\|to\|via)-(?:zinc\|slate\|gray\|neutral\|stone\|red\|amber\|emerald\|teal\|blue\|purple\|violet\|indigo\|rose\|pink)-\d{2,3}` in rebuild `*.tsx` | `// palette-ok` | Tokens-only styling: a rebuilt surface must style via DS components + `var(--…)` tokens, not raw Tailwind hues. (Legacy `src/` keeps its existing Four-Laws rules; this stricter rule is rebuild-scoped only.) |
| `ds-per-view-css-block` | `` const\s+\w*(?:css\|styles?)\w*\s*=\s*[`{] `` + any `<style` tag in rebuild `*.tsx` | `// view-css-ok` | The Primitive Reuse Audit's #1 anti-pattern: per-view const css blocks (kit CLAUDE.md, Standing rules) |
| `ds-reinvented-primitive` | Extend `report-style-drift.ts` categories (badge-like-span, stat-primitive-bypass, raw form control — `report-style-drift.ts:56-79`) with a rebuild-root domain; add categories `card-like-div` (`className` containing `rounded` + `border` + `bg-` on a `div` not composed from `SectionCard`) and `hand-rolled-modal` (`fixed inset-0` outside DS `Modal`/`Drawer`) | existing exceptions file (`data/style-exceptions.json`, owned + expiring) | Structural duplication a regex on one line can't prove — this is why it lives in the drift scanner, which already does multi-line context |
| `ds-token-theme-parity` | customCheck: parse the rebuild token CSS; every `--*` custom property declared under `:root` must also be declared under `.dashboard-light`, and vice versa (mirror of the existing `styleguide-token-parity` check cited in CLAUDE.md Token authority) | none — a missing theme value is never intentional | "Both themes work by construction" (Build Conventions gate 3) at the token layer |
| `ds-icon-discipline` | emoji codepoint class in rebuild `*.tsx` (**D5 reversed 2026-07-03: `fa-*` is now ALLOWED — FA Sharp Regular is the icon system; lucide stays as the `<Icon as>` migration bridge, so neither `fa-*` nor `from 'lucide-react'` is flagged**) | `// icon-ok` | Font Awesome Sharp Regular via `<Icon name>`/`ICON_NAMES`; emoji-as-icon forks the system. Icons go through the `<Icon>` component. |
| `ds-deep-import` | `from ['"].*components/(?:buttons\|data\|feedback\|flow\|forms\|icon\|layout)/` (remapped to the real DS root) | `// deep-import-ok` | Backstop for the barrel rule when files sit outside the lint lane's globs (tests, stories) |
| `ds-state-matrix-presence` | customCheck: for each rebuild surface entry file, require at least one reference each to the DS loading (`Skeleton`), empty (`EmptyState`), and error primitives (locked state where the surface's access row demands it) — a missing state is a warn pointing at Build Conventions §01 | `// state-matrix-ok: <justified N/A>` | "All four states exist" (DoD gate 4) — presence is mechanizable; correctness stays with the story/snapshot gate (§3.3) and review |

Not mechanized (deliberately): mutation-contract conformance (optimistic-vs-confirm classing), derived-vs-delivered numbers, copy voice. These have no grep-able symptom (authoring guide precondition 1 fails) → agentic layer (§4) + DoD review gates (§5).

### 3.3 Snapshot + story gates (extends `playwright.visual.config.ts`)

- **Matrix**: per surface × {dark, `.dashboard-light`} × {loading, empty, error, locked, populated} — the Build Conventions "AUTO · SNAPSHOT ×2" and "AUTO · STORY PER STATE" gates. Today's suite is dark×populated only (§1.4), so this is a new axis, not a new system: same config, same zero-diff policy, `toHaveScreenshot()` per cell.
- States are driven by a fixture/query-param harness per surface (each surface must expose its four states reachably — which is itself DoD gate 4), seeded from `npm run seed:demo` fixtures.
- Cadence: full matrix per rebuild PR would be slow; run changed-surface cells per PR (diff-scoped, like pr-check) and the full matrix nightly alongside `pr-check-nightly.yml`.

### 3.4 New budget + a11y gates (net-new dependencies — flagged, not assumed)

- `verify:bundle-budget` — vite build manifest → per-route chunk sizes vs a committed `data/bundle-budget-baseline.json`; ratchet semantics copied from `check:circular-deps`/`verify:coverage-ratchet` (regression fails, improvement rewrites baseline via explicit update flag). Covers DoD "AUTO · BUNDLE CHECK" and the kit's "no 100KB+ monolith (the editor.js lesson)". No new dependency needed (build manifest is already emitted).
- `@axe-core/playwright` in the state-matrix run for DoD "AUTO · AXE" (44px targets, focus visibility partially automatable; focus-trap/keyboard stay on the review list). **New devDependency — owner approval required** (stop-and-ask #4).

---

## 4. Design — the consistency auditor, agentic layer

Lint proves token-purity and prop shapes; it cannot see that two agents built the same filter bar two different ways, or that a surface drifted from its prototype. Three recurring reviews, each with a defined trigger, scope, and output sink:

### 4.1 Per-batch diff review (already mandatory — extended, not new)

- **Trigger**: after every parallel worker batch (existing CLAUDE.md multi-agent rule).
- **Rebuild-specific additions to the checklist**: (a) grep the batch diff for the §3.2 rule hatches — every new hatch needs its justification comment; (b) cross-surface duplicate scan: any two surfaces in the batch implementing the same interaction (filter chips, bulk-select, sort headers) must share the DS component or a shared hook (CLAUDE.md UI/UX rule 9); (c) prop-shape spot-check against the component `.d.ts` files (read-before-write rule).
- **Output**: fix-now items in the batch; anything consciously punted → deferred ledger (§5), never a TODO comment.

### 4.2 Consistency sweep — every 3 merged surfaces (or weekly, whichever first)

A `scaled-code-review`-class multi-agent pass whose scope is *cross-surface*, not per-diff:

| Lane | Checks (things lint cannot) | Reference artifacts |
|---|---|---|
| Visual drift | Screenshot each merged surface (both themes) and compare side-by-side against `Reference Screen - Keywords.html` and the surface's mockup: spacing rhythm, card density, header hierarchy, toast tones | kit Reference Screen, `screenshots/`, state-matrix snapshots |
| Primitive divergence | Diff how surfaces solve identical jobs: same empty-state voice? same table skeleton? same drawer behavior? Flag any second implementation of an interaction the DS or a shared hook already owns | `Which Primitive - Decision Guide.html`, `_ds_manifest.json` component list |
| Prototype fidelity | IA/flows vs the prototype: lens/filter placement, drill-down direction, URL state (deep links survive refresh — Handoff Brief field 6) | `mockup/`, Surface Model, per-surface Handoff Brief |
| Behavior contract | Mutation loop conformance (optimistic-vs-confirm classing, undo on reversible, bulk summary toast — Build Conventions §02); state matrix *correctness* (skeleton matches populated layout; empty ≠ error ≠ locked) | `Build Conventions.html` §01–02 |
| Words & numbers | Copy voice vs Content & Access Conventions; every client-facing figure display-only (no UI money/score math) | `Content & Access Conventions.html` |

- **Output**: findings ranked; Critical/Important fixed before the next batch dispatches (CLAUDE.md: never defer a fixable bug); consistency *improvements* that would bloat the current wave → deferred ledger with an upgrade trigger.
- Cadence intentionally matches the 3-tier review rhythm already ratified for Reconcile (commit `ecc691128`) — same muscle, rebuild-specific checklist.

### 4.3 Phase-gate holistic review (per rebuild phase / per ~6 surfaces)

- Whole-arc end-to-end pass before a phase merges to staging: the memory-documented lesson is that per-lane review + green gates miss fixture-masked broken features (Strategy P3 send spine). Includes a flag-ON real-browser smoke of every surface in the phase (CLAUDE.md UI/UX rule 13) and an evaluative `persona-audit` on client-facing surfaces.
- This is also the deferred-ledger review checkpoint (§5.4).

---

## 5. Design — deferred-work / trade-off ledger

### 5.1 Why a new file (and where)

Quick-win trade-offs today die in three places: PR descriptions, TODO comments, and agent memory. The repo's proven pattern for "tracked exception with an owner and an expiry" is `data/style-exceptions.json` (`report-style-drift.ts:19-27`); the proven pattern for "work that must eventually land" is `data/roadmap.json` items with `status: "deferred"` (18 exist today; statuses in use: pending 74 / done 116 / deferred 18 / in_progress 9). The ledger composes both:

**Proposed file: `data/ui-rebuild-deferred-ledger.json`** — machine-readable (verifier-checkable, same reason style-exceptions lives in `data/`), colocated with the baselines it resembles.

### 5.2 Schema

```jsonc
{
  "version": 1,
  "updatedAt": "2026-07-03",
  "entries": [
    {
      "id": "DEF-keywords-001",             // DEF-<surface>-<seq>, stable
      "surface": "keywords",                 // one of the 18 surface slugs (matches docs/ui-rebuild/phase0/surfaces/*.md)
      "item": "Bulk stage action ships without per-row undo; summary toast only",
      "decision": "Undo queue needs a server-side revert endpoint; shipped confirm-first instead to unblock the pilot",
      "class": "behavior",                   // token | primitive | behavior | data | a11y | perf | copy
      "upgradeTrigger": "when bulk revert endpoint lands (platform ticket) OR before client-facing launch of Keywords",
      "owner": "josh",                       // a person, never a team-of-none
      "status": "open",                      // open | scheduled | done | retired
      "roadmapItemId": null,                 // REQUIRED once status=scheduled — must match an id in data/roadmap.json
      "createdAt": "2026-07-03",
      "reviewBy": "2026-08-14",              // hard expiry; stale entries fail the verifier
      "links": { "pr": "#1500", "kitDoc": "Build Conventions.html §02" }
    }
  ]
}
```

Field rationale: `decision` records *what was traded and why* (so a future agent doesn't "fix" it blind or re-litigate it); `upgradeTrigger` is the condition that converts the deferral into scheduled work — every entry must have one, "someday" is not a trigger; `class` lets the consistency sweep (§4.2) pull its lane's deferreds; `reviewBy` is the anti-rot mechanism borrowed from `StyleExceptionEntry.expiresOn`.

### 5.3 Verifier: `verify:deferred-ledger` (new script, quality-job step)

Mirrors the feature-flag verifier's role (`verify:feature-flags`, `ci.yml:143-144`):

1. Schema-validate every entry (Zod).
2. **Expiry**: `status: "open"` entries past `reviewBy` → CI failure with the entry id and owner. The forced action is a review (extend `reviewBy` with a fresh decision, schedule it, or retire it) — never silent aging.
3. **Cross-link integrity**: `status: "scheduled"` requires `roadmapItemId` that exists in `data/roadmap.json`; `status: "done"` requires the roadmap item be `done` too. This is the roadmap integration: the ledger holds the *decision record*, roadmap holds the *work item* — one direction of reference, no duplication of status truth beyond the done-consistency check.
4. **Hatch reconciliation**: every `// <rule>-ok` hatch added under the rebuild root by a §3.2 rule must be reachable from some ledger entry (`links` or `item` referencing the file) — a hatch with no ledger entry is an untracked trade-off, warn-level initially.

### 5.4 Review cadence (so deferreds do not rot)

| When | What happens |
|---|---|
| Every rebuild PR | CI runs `verify:deferred-ledger`; the PR that *introduces* a trade-off must add its entry in the same PR (checked socially at per-batch review §4.1 — the diff has a hatch or a punted DoD box, the ledger must have a row). |
| Consistency sweep (§4.2) | Each lane reads its `class` slice; sweeps may flip `upgradeTrigger`-met entries to `scheduled` (creating the roadmap item). |
| Phase gate (§4.3) | Full ledger walk with the owner: every `open` entry re-justified or scheduled/retired. A phase does not merge to staging with unreviewed expired entries. |
| Platform-health checkpoint (`docs/workflows/platform-health-cadence.md`, every 4–6 sprints) | Ledger size and age become health metrics: count of `open`, oldest `createdAt`, expired count — same reporting posture as the style-drift metrics. |
| Nightly | Optional: fold the expiry check into `pr-check-nightly.yml` soft-gate so an expiring ledger pings before it blocks a PR. |

### 5.5 Explicit non-goals

- Not a bug tracker: review-found bugs get fixed in-PR (CLAUDE.md decision framework), never ledgered.
- Not a second roadmap: the ledger never carries estimates or sprint assignment — the moment work is real it becomes a roadmap item and the entry just points at it.

---

## 6. Where the Build-Conventions DoD gates plug into CI (the mapping)

Build Conventions §03 defines 10 done-boxes with AUTO/REVIEW tags. Concrete homes:

| DoD gate (Build Conventions) | Tag in kit | Concrete mechanism (this design) |
|---|---|---|
| Token-pure (no raw hex/px, both themes by construction) | AUTO · LINT | §3.1 `lint:ds-adherence` + §3.2 `ds-raw-hex-anywhere`, `ds-tailwind-palette-bypass`, `ds-token-theme-parity` — quality job |
| Composed from the system (no re-rolled primitive, no per-view css) | REVIEW | §3.2 `ds-per-view-css-block` + `ds-reinvented-primitive` (drift scanner) as the mechanical floor; §4.1/§4.2 primitive-divergence lane as the judgment layer |
| Both themes verified | AUTO · SNAPSHOT ×2 | §3.3 snapshot matrix, dark + `.dashboard-light` per surface |
| All four states exist | AUTO · STORY PER STATE | §3.2 `ds-state-matrix-presence` (presence) + §3.3 state cells (reachable + screenshotted) |
| Mutations follow the contract | REVIEW | §4.2 behavior-contract lane; per-batch checklist §4.1 |
| Data map complete (every prop has a Data-Source Ledger row) | REVIEW | Definition-of-ready gate at ticket dispatch (Handoff Brief); §4.1 spot-check |
| Accessibility floors | AUTO · AXE + REVIEW | §3.4 axe in the state-matrix run (pending dependency approval); focus/keyboard on the §4.2 review list |
| Numbers unchanged (UI computes no money/score/rank) | REVIEW | §4.2 words-&-numbers lane + phase-gate persona/holistic pass §4.3 |
| Within perf budget | AUTO · BUNDLE CHECK | §3.4 `verify:bundle-budget` ratchet |
| Visual regression clean | AUTO · PLAYWRIGHT | §3.3 (extends existing `playwright.visual.config.ts` zero-diff policy) |

Sequencing per the kit: seed the AUTO gates against the Reference Screen **before** real surfaces land (kit CLAUDE.md, Process), i.e. the Keywords pilot validates every gate above end-to-end before the 18-surface fan-out.

---

## 7. Stop-and-ask (owner decisions required — not decided here)

1. **Rebuild root path.** Every §3 rule needs a `pathFilter`. Where do rebuilt surfaces live — a new top-level dir, `src/rebuild/`, or in-place behind flags (the P2 memory note says incremental-behind-flags)? In-place makes rebuild-scoped strict rules much harder to scope; this decision gates the entire mechanized layer.
2. **Adherence-lint runner: oxlint dep vs ESLint wrapper.** Adding oxlint is a new toolchain dependency whose esquery-regex support must be empirically validated; the ESLint wrapper reuses existing tooling but means the "oxlintrc" is consumed by a different engine than its name implies. Also: who re-runs the kit compiler when the DS changes (the config is generated; import-path remapping can't be a hand edit)?
3. **Severity timeline.** Warn-first is the authoring-guide default, but the kit's intent is hard gates from day one on *net-new* rebuild code (zero backlog by construction). Proposal: rebuild-scoped rules ship at `error` immediately (nothing exists to backfill); confirm or reject.
4. **New devDependencies** (`@axe-core/playwright`, any snapshot/story tooling) — approval needed before the a11y AUTO gate is real; otherwise that DoD box silently degrades to REVIEW.
5. **Ledger location** `data/ui-rebuild-deferred-ledger.json` (machine-checkable, follows style-exceptions precedent) vs `docs/ui-rebuild/` (human-first). Design assumes `data/`; confirm.
6. **Snapshot infra cost.** 18 surfaces × 2 themes × 5 states ≈ 180 cells against a deployed env at 1 worker (`playwright.visual.config.ts:41`) — nightly-full/PR-diff split is proposed in §3.3; confirm the split or fund parallel workers.

---

*Sources verified this session: `scripts/pr-check.ts` (:3-13, :306-338, :579-581, :1537, :2440-2458), `docs/rules/pr-check-rule-authoring.md`, `.github/workflows/ci.yml` (:131-167, :189-213, :237-252, :350-355), `.github/workflows/pr-check-nightly.yml` (:5, :37), `scripts/report-style-drift.ts` (:9-33, :56-79, :94-114), `data/style-exceptions.json`, `data/roadmap.json` (status census), `playwright.visual.config.ts` (:4-50), `package.json` (:34-39, :53, :59, :139-166), `_adherence.oxlintrc.json` (parsed: 3 rule families, 69 selectors, 66 prop-conformance, x-omelette replaces all empty), `_ds_manifest.json` (59 components, themes `.dashboard-light`), kit `CLAUDE.md`, `Build Conventions.html` (extracted), `UI Rebuild Handoff Brief.html` (extracted), `hmpsn studio Design System/tokens/colors.css` (:1-12).*
