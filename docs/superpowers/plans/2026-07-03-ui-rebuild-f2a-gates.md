# UI Rebuild F2a — Consistency Gates + Deferred Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the rebuild's consistency machinery that is enforceable *today*: the deferred-work ledger + CI verifier, the motion-vocabulary unification (PR #1472 review finding #1), the styleguide reconciliation (findings #3–#6), seven rebuild-scoped pr-check rules, and the agentic-review process doc.

**Architecture:** All mechanized gates scope to files carrying the `@ds-rebuilt` marker (Phase D, D2) at **error** severity (D7) — nothing exists to backfill, so no warn-first ladder. The ledger follows the `data/style-exceptions.json` owner+expiry precedent; the verifier follows `verify:feature-flags`'s CI role. Design authority: [cross-consistency.md](../../ui-rebuild/phase0/cross-consistency.md) §3.2/§5 + [STRATEGY.md](../../ui-rebuild/phase0/STRATEGY.md) §3–4. Decisions authority: [PHASE_D_DECISIONS.md](../../ui-rebuild/phase0/PHASE_D_DECISIONS.md) — do not relitigate.

**Tech Stack:** TypeScript (tsx scripts), Zod v3, ripgrep-style regex rules in `scripts/pr-check.ts` CHECKS array, GitHub Actions.

**Platform/Model:** Claude/Anthropic — single agent, **Opus** (pr-check.ts + ci.yml have repo-wide blast radius). Sequential; one PR to `staging`.

**Ratified in-scope decisions (from the PR #1472 review, owner-approved):**
- **Motion: the F1 tokens are the law.** `--dur-fast: 0.15s / --dur-base: 0.25s / --dur-slow: 0.5s` + `--ease-out/--ease-draw` become the canonical motion vocabulary. The styleguide Motion Law prose (100/240/600) is rewritten to the token trio; the pr-check duration rule accepts `var(--dur-*)` everywhere and keeps the legacy `120/180/400ms` literals valid ONLY outside `@ds-rebuilt` scope; legacy-literal migration is ledgered for Z.
- Styleguide "Sidebar navigation" demo annotated as superseded-by-F4; F1 demo block redistributed (fonts→02 Type, motion→07 Motion); `.eyebrow` consumes `var(--font-mono)` in both files; `--bp-*` reference-only caveat restored.

**Deliberately NOT in F2a (F2b, triggered by the Keywords pilot / F3):** `lint:ds-adherence` ESLint-wrapper lane + adherence-config sync gate (needs the DS import root + regenerated config after F3); `ds-state-matrix-presence`; snapshot theme×state matrix; `verify:bundle-budget`; `@axe-core/playwright` (owner dep approval outstanding); `ds-reinvented-primitive` drift-scanner categories. Each is named in the process doc (Task 7) with its trigger.

---

## Pre-requisites & ground rules

- Branch: `ui-rebuild-phase-0` (F1 merged to staging; pull first). `git status` + branch check before any git write; stage explicitly by path.
- Read before Task 4: `docs/rules/pr-check-rule-authoring.md` (rule contract + how to test) and the `styleguide-token-parity` customCheck at `scripts/pr-check.ts:6651+` (the CustomCheckMatch API to mirror — conform to the actual local types, the snippets below are structurally correct but must compile against them).
- Every new rule: `name`, pattern or customCheck, hatch named in `message`, `rationale`, `claudeMdRef`. Inline hatches only (above-line is silently ignored — house memory).
- Docs are part of DoD; `npm run rules:generate` after CHECKS changes (CI fails on drift).

## Task dependency graph

```
Task 1 (ledger+verifier) → Task 2 (CI wiring) → Task 3 (motion unification)
  → Task 4 (pr-check rules) → Task 5 (styleguide reconciliation)
  → Task 6 (docs: process doc + CLAUDE.md anchor) → Task 7 (verification + PR)
```
Sequential (Tasks 3–5 all touch pr-check/styleguide; Task 6 references rule names from Task 4).

## File ownership (exclusive to this plan)

- Create: `data/ui-rebuild-deferred-ledger.json`, `scripts/verify-deferred-ledger.ts`, `docs/rules/ui-rebuild-consistency.md`
- Modify: `package.json` (one script), `.github/workflows/ci.yml` (one quality-job step), `scripts/pr-check.ts`, `docs/rules/automated-rules.md` (generated), `public/styleguide.html`, `public/styleguide.css`, `src/index.css`, `src/tokens.css` (comment only), `BRAND_DESIGN_LANGUAGE.md`, `CLAUDE.md`, `tests/pr-check.test.ts`

---

### Task 1: Deferred ledger + verifier

**Files:** Create `data/ui-rebuild-deferred-ledger.json`, `scripts/verify-deferred-ledger.ts`

- [ ] **Step 1.1** — Create `data/ui-rebuild-deferred-ledger.json` seeded with F1's three known deferrals:
```json
{
  "version": 1,
  "updatedAt": "2026-07-03",
  "entries": [
    {
      "id": "DEF-foundation-001",
      "surface": "foundation",
      "item": ".t-* utility classes do not yet consume the --type-* role tokens (values duplicated in src/index.css)",
      "decision": "F1 shipped tokens only to avoid behavioral risk; the .t-* refactor rides the F3 primitive ports where each class is re-verified",
      "class": "token",
      "upgradeTrigger": "F3 net-new-primitives PR opens (the ports consume --type-* and prove the values)",
      "owner": "josh",
      "status": "open",
      "roadmapItemId": null,
      "createdAt": "2026-07-03",
      "reviewBy": "2026-08-14",
      "links": { "pr": "#1472", "kitDoc": "tokens/typography.css" }
    },
    {
      "id": "DEF-foundation-002",
      "surface": "foundation",
      "item": "--brand-shadow-* call sites not yet migrated to canonical --shadow-*",
      "decision": "Two shadow families coexist deliberately; deprecation direction documented in src/tokens.css comment (F1)",
      "class": "token",
      "upgradeTrigger": "Phase Z consolidation closeout (per-surface retirement sweep)",
      "owner": "josh",
      "status": "open",
      "roadmapItemId": null,
      "createdAt": "2026-07-03",
      "reviewBy": "2026-09-30",
      "links": { "pr": "#1472", "kitDoc": "tokens/effects.css" }
    },
    {
      "id": "DEF-foundation-003",
      "surface": "foundation",
      "item": "Legacy transition-duration-[120ms|180ms|400ms] literals across src/ not yet migrated to var(--dur-*) motion tokens",
      "decision": "Motion tokens ratified as canonical (F2a); legacy literals stay valid outside @ds-rebuilt scope to avoid a repo-wide churn PR",
      "class": "token",
      "upgradeTrigger": "Phase Z consolidation closeout, or earlier per-surface as each surface is rebuilt",
      "owner": "josh",
      "status": "open",
      "roadmapItemId": null,
      "createdAt": "2026-07-03",
      "reviewBy": "2026-09-30",
      "links": { "pr": "#1472" }
    }
  ]
}
```

- [ ] **Step 1.2** — Create `scripts/verify-deferred-ledger.ts` (mirror the tone/exit-code conventions of the existing `verify:feature-flags` script — locate it via `grep -n "verify:feature-flags" package.json` and read it first):
```typescript
import { readFileSync } from 'fs';
import { z } from 'zod';

const SURFACES = [
  'foundation', 'cockpit', 'insights', 'engine', 'keywords', 'competitors',
  'content-pipeline', 'local-presence', 'search-traffic', 'site-audit',
  'performance', 'links', 'asset-manager', 'ai-visibility', 'seo-editor',
  'schema', 'page-rewriter', 'brand-ai', 'recommendations', 'client-portal', 'global-ops',
] as const;

const entrySchema = z.object({
  id: z.string().regex(/^DEF-[a-z-]+-\d{3}$/),
  surface: z.enum(SURFACES),
  item: z.string().min(10),
  decision: z.string().min(10),
  class: z.enum(['token', 'primitive', 'behavior', 'data', 'a11y', 'perf', 'copy']),
  upgradeTrigger: z.string().min(5).refine(t => !/^someday$/i.test(t.trim()), '\"someday\" is not a trigger'),
  owner: z.string().min(2),
  status: z.enum(['open', 'scheduled', 'done', 'retired']),
  roadmapItemId: z.string().nullable(),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviewBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  links: z.record(z.string()).optional(),
});

const ledgerSchema = z.object({ version: z.literal(1), updatedAt: z.string(), entries: z.array(entrySchema) });

const failures: string[] = [];
const ledger = ledgerSchema.parse(JSON.parse(readFileSync('data/ui-rebuild-deferred-ledger.json', 'utf-8')));
const roadmap = JSON.parse(readFileSync('data/roadmap.json', 'utf-8'));
const roadmapById = new Map<string, { status?: string }>();
// Conform this walk to data/roadmap.json's actual shape — read the file first;
// collect every item that has an `id`, wherever items nest (sprints/sections).
JSON.stringify(roadmap, (_k, v) => {
  if (v && typeof v === 'object' && typeof v.id === 'string') roadmapById.set(v.id, v);
  return v;
});

const today = new Date().toISOString().slice(0, 10);
const ids = new Set<string>();
for (const e of ledger.entries) {
  if (ids.has(e.id)) failures.push(`${e.id}: duplicate id`);
  ids.add(e.id);
  if (e.status === 'open' && e.reviewBy < today)
    failures.push(`${e.id}: OPEN past reviewBy=${e.reviewBy} (owner: ${e.owner}) — review it: extend with a fresh decision, schedule it, or retire it`);
  if (e.status === 'scheduled') {
    if (!e.roadmapItemId) failures.push(`${e.id}: scheduled but roadmapItemId is null`);
    else if (!roadmapById.has(e.roadmapItemId)) failures.push(`${e.id}: roadmapItemId ${e.roadmapItemId} not found in data/roadmap.json`);
  }
  if (e.status === 'done' && e.roadmapItemId && roadmapById.get(e.roadmapItemId)?.status !== 'done')
    failures.push(`${e.id}: marked done but roadmap item ${e.roadmapItemId} is not done`);
}

if (failures.length) {
  console.error(`✗ deferred-ledger: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ deferred-ledger: ${ledger.entries.length} entries valid (${ledger.entries.filter(e => e.status === 'open').length} open)`);
```
(Hatch-reconciliation — §5.3 item 4 — is deferred to F2b when the first `-ok` hatches can exist; note it in the script header comment.)

- [ ] **Step 1.3** — Run it, expect pass:
```bash
npx tsx scripts/verify-deferred-ledger.ts   # expected: "✓ deferred-ledger: 3 entries valid (3 open)"
```
Then test the expiry path: temporarily set one `reviewBy` to `2026-01-01`, re-run, expect exit 1 naming the id+owner; revert.

- [ ] **Step 1.4** — Commit:
```bash
git add data/ui-rebuild-deferred-ledger.json scripts/verify-deferred-ledger.ts
git commit -m "feat(ui-rebuild/f2a): deferred-work ledger + verifier"
```

### Task 2: Wire verifier into npm + CI

**Files:** Modify `package.json`, `.github/workflows/ci.yml`

- [ ] **Step 2.1** — `package.json` scripts (alphabetical near `verify:feature-flags`): `"verify:deferred-ledger": "tsx scripts/verify-deferred-ledger.ts"`.
- [ ] **Step 2.2** — `.github/workflows/ci.yml`: in the **quality** job, add a step directly after the `verify:feature-flags` step (locate: `grep -n "verify:feature-flags" .github/workflows/ci.yml`), same shape:
```yaml
      - name: Verify deferred ledger
        run: npm run verify:deferred-ledger
```
- [ ] **Step 2.3** — `npm run verify:deferred-ledger` passes locally. Commit: `git add package.json .github/workflows/ci.yml && git commit -m "ci(ui-rebuild/f2a): verify:deferred-ledger in quality job"`.

### Task 3: Motion-vocabulary unification

**Files:** Modify `public/styleguide.html` (Motion Law §07), `scripts/pr-check.ts` (duration rule), `BRAND_DESIGN_LANGUAGE.md`, `src/tokens.css` (comment only)

- [ ] **Step 3.1** — `public/styleguide.html` §07 Motion (`id="sec-motion"`): rewrite the Motion Law to the token trio. The three cards become: **01 · Instant — `--dur-fast` 150ms** (hover, focus, toggle, press) / **02 · Standard — `--dur-base` 250ms** (card entries, modal open/close, tab switch, toast, stagger via `--stagger-step` 60ms) / **03 · Deliberate — `--dur-slow` 500ms** (ring charge-up, scanner reveal, celebration glow). Update the intro sentence to: "Three durations, exposed as tokens — every animation picks `var(--dur-fast)`, `var(--dur-base)`, or `var(--dur-slow)`; ease is `var(--ease-out)` unless noted (`var(--ease-draw)` for chart draws)." Keep card structure/classes; only numbers + token references change.
- [ ] **Step 3.2** — `scripts/pr-check.ts` `'Non-standard transition duration'` rule (~line 6085): update the customCheck to ALSO accept `var(--dur-fast|--dur-base|--dur-slow)` as standard (alongside the legacy `120ms|180ms|400ms` literals), and update `message` to: "Use var(--dur-fast|base|slow) (canonical motion tokens), or the legacy 120/180/400ms literals in pre-rebuild code. Non-standard durations break motion consistency." Read the existing customCheck implementation first and modify minimally.
- [ ] **Step 3.3** — `BRAND_DESIGN_LANGUAGE.md`: in the F1 foundation-token table's Motion row, append: "**Canonical**: all new motion uses `var(--dur-*)`/`var(--ease-*)`. The legacy 120/180/400ms literal standard applies to pre-rebuild code only (migration: DEF-foundation-003)."
- [ ] **Step 3.4** — `src/tokens.css` Motion section: extend the comment: `/* ─── Motion (canonical — legacy 120/180/400ms literals migrate per DEF-foundation-003) ─── */`.
- [ ] **Step 3.5** — Verify + commit:
```bash
npx tsx scripts/pr-check.ts        # zero errors
git add public/styleguide.html scripts/pr-check.ts BRAND_DESIGN_LANGUAGE.md src/tokens.css
git commit -m "feat(ui-rebuild/f2a): unify motion vocabulary on --dur-*/--ease-* tokens"
```

### Task 4: Rebuild-scoped pr-check rules (7)

**Files:** Modify `scripts/pr-check.ts`, `tests/pr-check.test.ts`, regenerate `docs/rules/automated-rules.md`

- [ ] **Step 4.1** — Add a shared helper near the CHECKS array (mirror local style):
```typescript
/** True when the file opts into UI-rebuild strict gates (Phase D, D2). */
const isDsRebuilt = (content: string): boolean => content.includes('@ds-rebuilt');
```
- [ ] **Step 4.2** — Add seven rules to CHECKS, each `severity: 'error'` (D7), each implemented as a customCheck that first gates on `isDsRebuilt(fileContent)` then applies its pattern per line (mirror the file-read pattern of `styleguide-token-parity`; skip lines matching the hatch). Specs — implement each with `rationale` + `claudeMdRef: 'UI Rebuild conventions'`:

| name | applies to | line-regex (flag when matched) | hatch |
|---|---|---|---|
| `ds-raw-hex-anywhere` | `*.tsx,*.ts,*.css` | `#[0-9a-fA-F]{3,8}\b` | `raw-hex-ok` |
| `ds-tailwind-palette-bypass` | `*.tsx` | `(?:text\|bg\|border\|ring\|from\|to\|via)-(?:zinc\|slate\|gray\|neutral\|stone\|red\|amber\|emerald\|teal\|blue\|purple\|violet\|indigo\|rose\|pink)-\d{2,3}` | `palette-ok` |
| `ds-per-view-css-block` | `*.tsx` | `const\s+\w*(?:css\|styles?)\w*\s*=\s*[\`{]` OR `<style` | `view-css-ok` |
| `ds-token-theme-parity` | `*.css` | customCheck: every `--*` declared in a `:root` block must also appear in `.dashboard-light` and vice versa, EXCEPT theme-neutral families (`--font-,--type-,--space-,--shell-,--page-,--section-,--grid-,--bp-,--ease-,--dur-,--stagger,--radius,--icon,--z-`) | none |
| `ds-icon-discipline` | `*.tsx` | `\bfa-[a-z-]+\b` OR emoji codepoints (`[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]` with `u` flag) — D5 ratified lucide, so lucide imports are ALLOWED; Font Awesome and emoji are not | `icon-ok` |
| `ds-deep-import` | `*.tsx,*.ts` | `from\s+['"].*components/ui/internal/` (backstop; refine to the real DS internal layout in F3 — note this in the rule comment) | `deep-import-ok` |
| `ds-motion-token` | `*.tsx,*.css` | `transition[^;\n]*\b\d+m?s\b` or `duration-\[?\d+` (any literal duration) — rebuilt code must use `var(--dur-*)` | `motion-ok` |

- [ ] **Step 4.3** — Tests: per `docs/rules/pr-check-rule-authoring.md`, add fixtures to `tests/pr-check.test.ts` for at least `ds-raw-hex-anywhere`, `ds-tailwind-palette-bypass`, `ds-motion-token`: each with (a) a violating snippet WITH `@ds-rebuilt` → flagged, (b) the same snippet WITHOUT the marker → not flagged, (c) with the inline hatch → not flagged.
- [ ] **Step 4.4** — Regenerate + verify + commit:
```bash
npm run rules:generate
npx tsx scripts/pr-check.ts && npx vitest run tests/pr-check.test.ts
git add scripts/pr-check.ts tests/pr-check.test.ts docs/rules/automated-rules.md
git commit -m "feat(ui-rebuild/f2a): 7 rebuild-scoped pr-check rules (@ds-rebuilt, error severity)"
```

### Task 5: Styleguide reconciliation (review findings #3–#6)

**Files:** Modify `public/styleguide.html`, `public/styleguide.css`, `src/index.css`, `src/tokens.css` (comment only)

- [ ] **Step 5.1** — **Supersede annotation** (finding #3): in the "Sidebar navigation" demo (§05, `grep -n "Sidebar navigation" public/styleguide.html` ~line 1713), insert directly under the `col-label` a visually-distinct warning band:
```html
<div style="border:1px solid var(--brand-yellow);border-radius:var(--radius-md);padding:10px 14px;margin:8px 0;color:var(--brand-yellow);font-size:13px;">
  ⚠ SUPERSEDED — this demo documents the pre-rebuild sidebar. The ratified navigation is the two-zone rail (AppShell, lands in rebuild phase F4; spec: UI Rebuild Kit → nav model). Do not build new navigation to this demo.
</div>
```
- [ ] **Step 5.2** — **Redistribute the F1 demo block** (finding #4): move the font-families sub-block from the `F1:FoundationTokens` section (§04, ~line 1177) to the end of §02 Type (`id="sec-type"`), and the motion sub-block to §07 Motion directly after the (now token-based) Motion Law cards. Spacing + elevation sub-blocks stay in §04. Keep the `F1:FoundationTokens START/END` comment markers around what remains; add matching markers at the two destinations.
- [ ] **Step 5.3** — **`.eyebrow` token consumption** (finding #5): in `public/styleguide.css:94` and `src/index.css` (the F1 copy), change `font-family:'JetBrains Mono',ui-monospace,monospace;` → `font-family:var(--font-mono);` in BOTH files (keeps parity; same primary font).
- [ ] **Step 5.4** — **`--bp-*` caveat** (finding #6): in `src/tokens.css`, on the line above `--bp-sm`, restore the kit's comment: `/* Breakpoints — reference values for JS/container queries; CSS @media cannot read var() */`.
- [ ] **Step 5.5** — Verify + commit:
```bash
npx tsx scripts/pr-check.ts && npx vite build
git add public/styleguide.html public/styleguide.css src/index.css src/tokens.css public/tokens.css
git commit -m "fix(ui-rebuild/f2a): styleguide reconciliation — supersede old nav demo, redistribute F1 demos, .eyebrow token, --bp caveat"
```
(`public/tokens.css` only if the build regenerated it.)

### Task 6: Process doc + CLAUDE.md anchor

**Files:** Create `docs/rules/ui-rebuild-consistency.md`; modify `CLAUDE.md`

- [ ] **Step 6.1** — Create `docs/rules/ui-rebuild-consistency.md` containing: (a) the `@ds-rebuilt` marker contract (what it opts a file into: the 7 rules at error severity, and the F2b lint lane later); (b) the **3-tier agentic cadence** verbatim from [STRATEGY.md §4.2](../../ui-rebuild/phase0/STRATEGY.md) (per-batch diff review → consistency sweep every 3 merged surfaces or weekly → phase-gate holistic review + flag-ON smoke + persona-audit on client-facing); (c) the **ledger discipline** (the PR that introduces a trade-off adds its `DEF-*` row in the same PR; verifier semantics; review cadence table from cross-consistency §5.4); (d) the **F2b backlog** with triggers: `lint:ds-adherence` + config sync gate (trigger: F3 DS import root exists), `ds-state-matrix-presence` + snapshot theme×state matrix (trigger: Keywords pilot), `verify:bundle-budget` (trigger: pilot), `@axe-core/playwright` (trigger: owner dep approval — until then the a11y DoD box is REVIEW, never silently), `ds-reinvented-primitive` drift-scanner categories (trigger: pilot), hatch-reconciliation in the ledger verifier (trigger: first `-ok` hatch lands).
- [ ] **Step 6.2** — `CLAUDE.md`: (a) add a short **"UI Rebuild conventions"** subsection under Code Conventions: "Files carrying the `@ds-rebuilt` marker opt into strict rebuild gates (tokens-only styling, motion tokens, lucide-only icons, error severity). Full contract: `docs/rules/ui-rebuild-consistency.md`. Every quick-win trade-off shipped in a PR adds a `DEF-*` row to `data/ui-rebuild-deferred-ledger.json` in the same PR (`npm run verify:deferred-ledger` enforces expiry + roadmap links)."; (b) add the doc to the Key Documentation table; (c) add `npm run verify:deferred-ledger` to the Commands table and the Quality Gates checklist.
- [ ] **Step 6.3** — Commit: `git add docs/rules/ui-rebuild-consistency.md CLAUDE.md && git commit -m "docs(ui-rebuild/f2a): consistency process doc + CLAUDE.md conventions anchor"`.

### Task 7: Full verification + PR

- [ ] **Step 7.1** — Full gates, sequentially:
```bash
npm run typecheck && npx vite build
npx tsx scripts/pr-check.ts          # zero errors (incl. the 7 new rules against the whole repo — nothing carries @ds-rebuilt yet, so zero hits expected)
npm run lint:hooks
npm run verify:deferred-ledger
npm run verify:feature-flags
npx vitest run                       # FULL suite
```
- [ ] **Step 7.2** — Negative test: create a scratch file with `// @ds-rebuilt` + a raw hex + a `duration-[300ms]`, run `npm run pr-check:all` targeting it, confirm both rules fire, delete the file.
- [ ] **Step 7.3** — Push + PR to `staging`: title "UI Rebuild F2a — consistency gates, deferred ledger, motion unification". Body: summary + the three seeded DEF entries + F2b backlog pointer. Note: verify CI actually RAN (Actions billing failed on #1472 — inspect red, never merge on not-started checks).

---

## Verification strategy (summary)

The new rules are dormant-by-construction (no `@ds-rebuilt` files exist), so the negative test in 7.2 + the fixtures in 4.3 are the proof they work; the ledger verifier is exercised both green (3 valid entries) and red (expiry tamper test in 1.3); the motion unification is proven by pr-check passing with the updated rule + the styleguide reading token values; the full vitest suite guards everything else.

## Definition of done

- [ ] `verify:deferred-ledger` green locally + wired in CI quality job
- [ ] 3 seeded DEF entries valid; expiry tamper test demonstrated red
- [ ] One motion vocabulary: styleguide Motion Law = token trio; pr-check rule accepts `var(--dur-*)`; legacy literals confined to pre-rebuild code; DEF-foundation-003 tracks migration
- [ ] 7 `ds-*` rules land at error severity, gated on `@ds-rebuilt`, each with tests + hatch + `rules:generate` run
- [ ] Styleguide: old nav demo superseded-annotated; F1 demos redistributed (fonts→02, motion→07); `.eyebrow` consumes `var(--font-mono)` both files; `--bp-*` caveat present
- [ ] `docs/rules/ui-rebuild-consistency.md` + CLAUDE.md anchor + Commands/Quality-Gates entries
- [ ] All gates green; PR open to `staging` with checks that actually ran
