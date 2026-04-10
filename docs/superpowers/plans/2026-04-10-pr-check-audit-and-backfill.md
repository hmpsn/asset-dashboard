# PR-Check Audit and Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the structural gap between CLAUDE.md's ~60 rules and pr-check's automated enforcement by (1) adding 11 new pr-check rules that correspond to recurring bug classes, (2) mechanically backfilling all existing pr-check violations in the codebase so the `--all` scan is clean, (3) adding a nightly full-scan CI job, and (4) splitting CLAUDE.md into a philosophical overview + an auto-enforced rules reference so humans and agents can tell at a glance which rules the machine is watching.

**Architecture:** 3 PRs to `staging`, each independently mergeable.

- **PR A — Rule authoring + nightly scan (1 PR, 2 commits)** — adds 11 new pr-check rules with `// rule-name-ok` escape hatches, adds nightly full-scan GitHub Action, creates `docs/rules/pr-check-rule-authoring.md`. No touching violations yet — this PR ships rules in **warn** severity so the signal is visible without blocking existing PRs.
- **PR B — Mechanical backfill (1 PR, ~6 commits)** — walks the full-scan violation backlog category by category, cleaning each to zero. Color violations, studio-name hardcodes, source-sniffing tests, vacuous `.every()` tests, unguarded `recordAction`, untyped dynamic imports, bare JSON.parse on disk files. One commit per category; final commit upgrades the PR A rules from `warn` → `error` now that the codebase is clean.
- **PR C — CLAUDE.md split (1 PR, 2 commits)** — splits `CLAUDE.md` into `CLAUDE.md` (philosophical, decision-framework, session protocol) + `docs/rules/automated-rules.md` (generated from `scripts/pr-check.ts` metadata — human-readable table of every enforced rule with its severity, file scope, and escape hatch). Adds a generator script so the table stays in sync.

**Tech Stack:** TypeScript, Node 20, `tsx`, `scripts/pr-check.ts` (existing), GitHub Actions (existing `.github/workflows/`), better-sqlite3 (for grep scope — many new rules scan `server/`).

**Why this plan, not just "fix the bugs":** The last 6 brand-engine review rounds surfaced ~30 bug classes. ~8 were one-offs. The other ~22 are recurring patterns already documented in `CLAUDE.md` but invisible to pr-check. Every fix lands a new CLAUDE.md rule but no pr-check rule, so the next contributor repeats the bug. This plan closes the loop: every CLAUDE.md rule that can be mechanically checked becomes a pr-check rule, and the backlog of pre-existing violations hiding behind the diff-only scan is exhumed and fixed in one sustained pass.

---

## Task Dependency Graph

```
PR A: Rule authoring + nightly scan
  └── Task A1: Author 11 new pr-check rules (severity: warn)
  └── Task A2: Add nightly full-scan GitHub Action
  └── Task A3: Write docs/rules/pr-check-rule-authoring.md
  └── Task A4: Add data/roadmap.json follow-up entry
  ──▶ [merge PR A to staging] ──▶ [verify staging CI green] ──▶ [STOP — do not touch main]

PR B: Mechanical backfill (depends on PR A merged to staging + staging CI green)
  └── Task B1: Fix violet/indigo color violations (24 matches)
  └── Task B2: Fix hardcoded "hmpsn.studio" strings (6 matches)
  └── Task B3: Fix bare JSON.parse on disk files (5 real + 51 false positives — refine rule exclusions)
  └── Task B4: Fix source-sniffing readFileSync tests (37 matches)
  └── Task B5: Fix vacuous .every() test assertions (91 matches)
  └── Task B6: Fix untyped dynamic imports (44 matches)
  └── Task B7: Fix unguarded recordAction calls (8 matches)
  └── Task B8: Backfill UPDATE/DELETE missing workspace_id scope (39 matches)
  └── Task B9: Polish pr-check.ts from scaled-review findings (rationale, Record spacing, pathFilter, variable shadow, forEach)
  └── Task B10: Upgrade PR A rules warn → error
  ──▶ [merge PR B to staging] ──▶ [verify staging CI green] ──▶ [STOP — do not touch main]

PR C: CLAUDE.md split (depends on PR B merged to staging + staging CI green)
  └── Task C1: Add rule-metadata generator script
  └── Task C2: Split CLAUDE.md → CLAUDE.md + docs/rules/automated-rules.md
  ──▶ [merge PR C to staging] ──▶ [verify staging CI green] ──▶ [release: cut ONE staging → main PR carrying brand engine + all 3 audit PRs]
```

**Critical path:** PR A → PR B → PR C. These are **strictly sequential** to `staging`. Do not open PR B until PR A is merged to `staging` **and** staging CI is green. PR A establishes new rule definitions that PR B's backfill diff references; if PR B lands first, the backfill commits touch files with no justification.

**None of these PRs merge to `main` directly.** The brand engine work (PR #162) is currently staging-only by design — `main` only gets updated when the full release (brand engine + audit fixes) is verified together. Once all three audit PRs are merged to staging and verified, a single `staging → main` release PR carries everything to production.

**Parallelism within PR B:** Tasks B1–B8 are independent (disjoint file sets, different check targets) and can be executed in parallel subagent dispatches once the rules are stable in PR A. B9 (pr-check.ts polish) is sequential after B1–B8 because it edits `scripts/pr-check.ts`, which several earlier tasks also touch via the exclusion lists. B10 (warn → error promotion) is sequential after B1–B9.

**No parallelism within PR A or PR C.** These are small enough to execute inline.

---

## Model Assignments

| Task | Model | Rationale |
|------|-------|-----------|
| A1 (author 11 rules) | **opus** | Regex authoring + false-positive tuning is the highest-stakes task in the plan. One sloppy regex produces hundreds of nuisance failures across the codebase. |
| A2 (nightly workflow) | **haiku** | Mechanical YAML edit following existing `.github/workflows/` patterns. |
| A3 (authoring doc) | **sonnet** | Writing doc, judgment on which patterns deserve examples. |
| A4 (roadmap item) | **haiku** | One-line JSON edit. |
| B1 (color backfill) | **haiku** | Mechanical `violet-` → `purple-` / `indigo-` → `teal-` replacements, each with a one-line visual sanity check. |
| B2 (studio-name backfill) | **haiku** | Import `STUDIO_NAME` and swap string literals. |
| B3 (JSON.parse backfill) | **sonnet** | Judgment call per file: refine rule exclusion list vs. actually use `parseJsonSafe`. The 56 matches are mostly disk-file reads that need exclusion, not rewrite. |
| B4 (source-sniffing tests) | **sonnet** | Case-by-case: some are migration guards (add `// readFile-ok`), some need real behavioral test rewrites. |
| B5 (vacuous .every) | **haiku** | Mechanical — add `expect(arr.length).toBeGreaterThan(0)` before each `.every()`. |
| B6 (untyped dynamic imports) | **sonnet** | Each dynamic import needs a matching `import type` and local type annotation. Requires reading the imported module's exports. |
| B7 (recordAction guards) | **haiku** | Add `if (workspaceId)` wrapper around each call. |
| B8 (workspace_id backfill) | **opus** | SQL edits + caller threading + hatch judgment on 39 sites. Highest-stakes backfill task — a wrong hatch opens a cross-tenant read. |
| B9 (pr-check.ts polish) | **sonnet** | Rule copy-edit, pattern tweak, variable rename, `.forEach` → `for...of` migration. All internal to `scripts/pr-check.ts`. |
| B10 (warn → error upgrade) | **haiku** | Severity string swap in `scripts/pr-check.ts`. |
| C1 (generator script) | **sonnet** | Parse `CHECKS` array, emit markdown table. Moderate TS authoring. |
| C2 (CLAUDE.md split) | **sonnet** | Judgment on what stays philosophical vs. auto-enforced. Copy-edit. |

---

## File Ownership (per-task, exclusive)

Every parallel task in PR B declares exactly which files it owns. A subagent dispatched to one task must NEVER edit files owned by another task. Any cross-cutting concerns must be pre-committed to the branch before dispatch.

| Task | Owns (may edit) | Must not touch |
|------|-----------------|----------------|
| A1 | `scripts/pr-check.ts` | everything else |
| A2 | `.github/workflows/pr-check-nightly.yml` (new) | `.github/workflows/pr-check.yml` (existing) |
| A3 | `docs/rules/pr-check-rule-authoring.md` (new) | — |
| A4 | `data/roadmap.json` | — |
| B1 | `src/components/ContentPerformance.tsx`, `src/components/ContentCalendar.tsx`, `src/components/PostEditor.tsx`, and 8 other files identified by the B1 prelude grep | `scripts/pr-check.ts`, any test file |
| B2 | `src/components/LandingPage.tsx`, `src/components/Styleguide.tsx` (2 call sites), and 2 other files | anything else |
| B3 | `server/semrush.ts`, `server/providers/dataforseo-provider.ts`, `scripts/pr-check.ts` (exclusion list only — add filenames, don't touch rule body) | everything else |
| B4 | `tests/` files identified by B4 prelude grep | `scripts/pr-check.ts`, `server/`, `src/` |
| B5 | `tests/` files identified by B5 prelude grep | `scripts/pr-check.ts`, `server/`, `src/` |
| B6 | `server/` files with `await import(` identified by B6 prelude grep | anything outside `server/` |
| B7 | `server/outcome-backfill.ts`, `server/routes/insights.ts`, `server/routes/content-decay.ts`, and 2 other files | anything else |
| B8 | `server/` files identified by B8 prelude grep (workspace_id backfill call sites) | `scripts/pr-check.ts`, any test file, `src/` |
| B9 | `scripts/pr-check.ts` (rule metadata + internal code quality only — do not touch severity fields) | everything else |
| B10 | `scripts/pr-check.ts` (severity field only) | — |
| C1 | `scripts/generate-rules-doc.ts` (new) | anything else |
| C2 | `CLAUDE.md`, `docs/rules/automated-rules.md` (new) | anything else |

**Diff review checkpoint:** after every parallel batch in PR B (after B1–B8 complete), run:

```bash
git diff --stat origin/staging...HEAD     # confirm file ownership was respected
npx tsx scripts/pr-check.ts --all          # count must drop to zero for that category
npm run typecheck                          # no regressions
npx vitest run                             # full suite green
```

If any task's diff touches a file outside its owned list, revert that file's changes and re-dispatch the task with a tighter prompt.

---

## Cross-Phase Contracts

These interfaces are defined once and frozen across PRs. Later PRs depend on them being stable.

### Contract 1: `// rule-name-ok` escape hatch format

Every new rule introduced in PR A must use a standardized per-line escape hatch comment: `// <rule-short-name>-ok`. The short name is derived from the rule's kebab-cased key in `CHECKS`, e.g. `// global-keydown-ok`, `// txn-wrap-ok`. Documented in `docs/rules/pr-check-rule-authoring.md` (Task A3).

PR B's backfill must use these exact hatch names. PR C's generator script reads these from the `excludeLines` field in each `CHECKS` entry and emits them in the `automated-rules.md` table.

### Contract 2: Rule metadata fields on `Check` type

In Task A1 (PR A), extend the existing `Check` type in `scripts/pr-check.ts` with two new optional fields used by the PR C generator:

```ts
type Check = {
  name: string;
  pattern: string;
  fileGlobs: string[];
  exclude?: string | string[];
  pathFilter?: string;
  excludeLines?: string[];
  message: string;
  severity: 'error' | 'warn';
  // NEW (added in Task A1, consumed by Task C1):
  rationale?: string;      // 1-sentence explanation of the bug class this prevents
  claudeMdRef?: string;    // anchor or heading in CLAUDE.md, e.g. '#code-conventions'
};
```

Adding the fields in PR A (even though PR C consumes them) means PR C has nothing to refactor — it just reads metadata that's already populated.

### Contract 3: Nightly workflow name + artifact

The nightly GitHub Action (Task A2) is named `pr-check-nightly` and uploads a `pr-check-full-scan.txt` artifact on failure. PR C references this artifact name in `CLAUDE.md` when describing how to inspect the full-scan output. Freeze the name in PR A.

---

## Systemic Improvements Section

This plan itself is a systemic improvement — but it introduces several smaller ones that survive after execution:

1. **`Check` type gets `rationale` + `claudeMdRef`** (Contract 2) — every pr-check rule now self-documents its purpose. Future contributors don't need to grep CLAUDE.md to understand why a rule fires.
2. **`docs/rules/pr-check-rule-authoring.md`** (Task A3) — formalizes the "when to write a rule" decision (diff-only vs full-scan gating, warn vs error, false-positive allowlist pattern, `// rule-ok` hatch convention, positive-and-negative test against current codebase).
3. **Nightly full-scan** (Task A2) — catches violations that land in unchanged files via refactors (the #1 blind spot of diff-only mode — see the `useGlobalAdminEvents.ts` rename episode that triggered this audit).
4. **`scripts/generate-rules-doc.ts`** (Task C1) — automates `docs/rules/automated-rules.md` so splits between CLAUDE.md and pr-check stay in sync. Checked into CI via a `npm run rules:generate` that fails if the doc is stale.
5. **Roadmap item for `docs/rules/*.md` audit follow-up** (Task A4) — user explicitly requested this be tracked separately from the main plan.

---

## Verification Strategy

The verification strategy is **specific commands per task** — not "manual verification."

- **Per task in PR A:**
  - `npx tsx scripts/pr-check.ts` (diff-only, on the branch) — expect all new rules to pass on the PR A branch itself.
  - `npx tsx scripts/pr-check.ts --all` — expect new rules to surface their existing-codebase matches as warnings (not errors). These are the exact match counts PR B will drive to zero.
  - `npm run typecheck && npx vite build && npx vitest run` — no regressions.
  - Manual: open `.github/workflows/pr-check-nightly.yml` in the GitHub Actions tab and trigger a `workflow_dispatch` run; confirm green.

- **Per task in PR B:**
  - `npx tsx scripts/pr-check.ts --all 2>&1 | grep "<Rule name>"` — the count drops to zero (for that category).
  - `npm run typecheck && npx vite build && npx vitest run` — full suite, not just new tests.
  - For B1 (color): `npx playwright test tests/e2e/light-mode.spec.ts` if it exists; visual diff on affected components (PostEditor, ContentCalendar, ContentPerformance).
  - For B5 (vacuous .every): verify at least one test in the edited file actually fails when the assertion is negated (to prove the test is no longer vacuous).

- **Per task in PR C:**
  - `npx tsx scripts/generate-rules-doc.ts` — produces `docs/rules/automated-rules.md` identical to the committed version.
  - `git diff docs/rules/automated-rules.md` after re-running generator — must be empty.
  - `npm run typecheck && npx vitest run` — full suite green.
  - Manual: re-read split `CLAUDE.md` end-to-end. Verify philosophical content is preserved; verify every rule removed from CLAUDE.md is present in `docs/rules/automated-rules.md`.

- **Final gate before each PR merges to staging:**
  - `npm run typecheck`
  - `npx vite build`
  - `npx vitest run`
  - `npx tsx scripts/pr-check.ts` (branch diff)
  - `npx tsx scripts/pr-check.ts --all` (full scan — required)
  - `npx playwright test` (if E2E suite is healthy)

---

## PR A — Rule Authoring + Nightly Scan

### Task A1: Author 11 new pr-check rules

**Files:**
- Modify: `scripts/pr-check.ts` (add 11 entries to `CHECKS`, extend `Check` type with `rationale` + `claudeMdRef`)

**Context for subagent:** Read `scripts/pr-check.ts` in full before starting. The `CHECKS` array is ~600 lines. Each entry follows a consistent shape. New rules are inserted at the end of the array, grouped with a `// ─── New rules (2026-04-10 audit) ───` section comment. Every new rule starts at severity `'warn'` — PR B's final task promotes them to `'error'` after the backfill is clean.

Each rule below specifies:
- **Rule name** (exact `name` field)
- **Bug class** it prevents (the CLAUDE.md pattern)
- **Regex** (`pattern` field) — test it against the current codebase before committing
- **Scope** (`fileGlobs` / `pathFilter`)
- **Exclusions** (known false positives)
- **Escape hatch** comment (`excludeLines`)
- **Expected hits on current codebase** — after writing the rule, run `npx tsx scripts/pr-check.ts --all 2>&1 | grep -A2 "<name>"` and note the hit count. Any rule with >200 hits needs regex refinement before commit (false-positive rate too high).

#### Rules to add:

**Rule 1 — useGlobalAdminEvents import restriction**
- **Bug class:** useGlobalAdminEvents used for workspace-scoped events (the PR #162 failure mode).
- **Pattern:** `from ['\"][^'\"]*useGlobalAdminEvents`
- **Scope:** `['*.ts', '*.tsx']`, no `pathFilter`
- **Exclusions:** hard-coded allowlist of audited global-event sites. Build the allowlist now by running: `grep -rn 'useGlobalAdminEvents' src --include='*.tsx' --include='*.ts'` — each file in the result IS an existing caller and should be in the exclusion list (one per line).
- **Hatch:** `// global-events-ok`
- **Severity:** `'error'` (this one is error from day one — no existing violations, we're just freezing the allowlist)
- **Rationale:** `'useGlobalAdminEvents does not subscribe — workspace-scoped events will be silently filtered. Only audited global-fanout sites may import it.'`
- **claudeMdRef:** `'#data-flow-rules-mandatory'`

**Rule 2 — Global keydown missing isContentEditable guard**
- **Bug class:** Keyboard shortcut fires inside contenteditable, breaking rich-text editors.
- **Pattern:** `addEventListener\s*\(\s*['\"]keydown['\"]`
- **Scope:** `['*.ts', '*.tsx']`, `pathFilter: 'src/'`
- **Exclusions:** file-level allowlist of audited sites: `src/App.tsx` (canonical guard), `src/hooks/useHotkey.ts` if it exists
- **Hatch:** `// keydown-ok`
- **Severity:** `'warn'`
- **Verification pattern:** This regex matches the listener registration but cannot prove the handler body has the guard. The rule is intentionally high-false-positive — every match is a "did you remember the guard?" nag. Pair each warn with a subsequent grep for `isContentEditable` in the same file. If both are present, it's safe; if not, add `// keydown-ok` or add the guard.
- **Rationale:** `'Global keydown handlers must early-return if e.target is an input/textarea/contenteditable — otherwise Escape/Enter/arrows hijack typing.'`
- **claudeMdRef:** `'#uiux-rules-mandatory'`

**Rule 3 — Multi-step DB writes outside db.transaction()**
- **Bug class:** Two sequential `db.prepare().run()` calls with partial-failure corruption risk (outcome-tracking race, brand-identity dedup race).
- **Pattern:** (function-body regex is hard with ripgrep) — use a marker pattern instead: `db\.prepare\([^)]+\)\.run\(`
- **Scope:** `['*.ts']`, `pathFilter: 'server/'`
- **This rule uses a `multiline: true`-style custom check.** Since the existing `runCheck` uses ripgrep regex, extend `pr-check.ts` to add a **`customCheck?: (files: string[]) => { file: string; line: number; text: string }[]`** field on `Check`. If set, the runner calls `customCheck(files)` instead of ripgrep. The body of this rule's customCheck walks each file, finds consecutive `db.prepare(...).run(` statements within 10 lines of each other, and reports any pair not preceded (within 5 lines) by `db.transaction(` or `const tx = db.transaction`. See `server/outcome-tracking.ts archiveOldActions` for the canonical correct pattern.
- **Exclusions:** `server/db/migrations/` (migrations run once at startup, different semantics)
- **Hatch:** `// txn-ok`
- **Severity:** `'warn'`
- **Rationale:** `'Multiple sequential db.prepare().run() calls on the same function path must be wrapped in db.transaction() or a partial failure leaves inconsistent state.'`
- **claudeMdRef:** `'#code-conventions'`

**Rule 4 — AI call immediately followed by db.prepare without transaction**
- **Bug class:** AI-call-before-DB-write race (brand-identity.ts `generateDeliverable` deduplication bug).
- **Pattern:** `(callOpenAI|callAnthropic|callCreativeAI)\s*\(`
- **Scope:** `['*.ts']`, `pathFilter: 'server/'`
- **Exclusions:** `server/openai-helpers.ts`, `server/anthropic-helpers.ts` (definitions), `server/prompt-assembly.ts`
- **Custom check:** for each match, scan the next 30 lines of the file. If any line contains `db.prepare(` or `stmts().` AND none of the lines contain `db.transaction(`, report as warning.
- **Hatch:** `// ai-race-ok`
- **Severity:** `'warn'`
- **Rationale:** `'AI calls take ~5s. Concurrent requests race existence checks before the write. Put the existence check + INSERT inside db.transaction() and catch SQLITE_CONSTRAINT_UNIQUE.'`
- **claudeMdRef:** `'#code-conventions'`

**Rule 5 — Missing `AND workspace_id = ?` in UPDATE/DELETE on workspace-scoped tables**
- **Bug class:** Cross-tenant data access via compromised or mis-routed request.
- **Pattern:** `db\.prepare\(\s*[\`'"](UPDATE|DELETE FROM)\s+(\w+)`
- **Scope:** `['*.ts']`, `pathFilter: 'server/'`
- **Custom check:** maintain a hard-coded list of workspace-scoped table names (pulled from existing migrations — query with `grep -l 'workspace_id' server/db/migrations/*.sql` and list all tables that contain the column). For each `UPDATE <table>` / `DELETE FROM <table>` where `<table>` is in the list, scan the next 5 lines of the SQL string for `workspace_id`. If absent, report error.
- **Exclusions:** `server/db/migrations/`
- **Hatch:** `// ws-scope-ok` (for rare admin-cross-workspace queries)
- **Severity:** `'warn'` in PR A, promote to `'error'` in PR B
- **Rationale:** `'Workspace-scoped tables must include AND workspace_id = ? in every UPDATE and DELETE. Defence-in-depth against compromised auth.'`
- **claudeMdRef:** `'#code-conventions'`

**Rule 6 — getOrCreate* functions returning `| null`**
- **Bug class:** Dead null check on the caller side that hides the real shape.
- **Pattern:** `function\s+getOrCreate\w+[^{]*:\s*[^{]*\|\s*null`
- **Scope:** `['*.ts']`, `pathFilter: 'server/'`
- **Exclusions:** none
- **Hatch:** `// getorcreate-nullable-ok` (for genuine throw-vs-null distinctions; must be commented)
- **Severity:** `'error'`
- **Rationale:** `'getOrCreate* always returns an entity (creates one if missing). Its type must not include | null or callers write dead guard branches.'`
- **claudeMdRef:** `'#code-conventions'`

**Rule 7 — `Record<string, unknown>` in shared/types/**
- **Bug class:** Untyped data contracts at layer boundaries (the canonical repeating bug).
- **Pattern:** `Record<string,\s*unknown>`
- **Scope:** `['*.ts']`, `pathFilter: 'shared/types/'`
- **Exclusions:** none
- **Hatch:** `// record-unknown-ok` (must be commented with justification)
- **Severity:** `'error'`
- **Rationale:** `'Typed data contracts at boundaries: define an interface, not Record<string, unknown>. Silent type drift across layers is the #1 recurring bug.'`
- **claudeMdRef:** `'#data-flow-rules-mandatory'`

**Rule 8 — PATCH spread without nested merge**
- **Bug class:** `{...existing, ...req.body}` replaces nested `address` object when only top-level spread is done.
- **Pattern:** `\.\.\.existing,\s*\.\.\.req\.body` (and `\.\.\.current,\s*\.\.\.req\.body`)
- **Scope:** `['*.ts']`, `pathFilter: 'server/routes/'`
- **Exclusions:** none
- **Hatch:** `// patch-spread-ok` (for endpoints with no nested sub-objects)
- **Severity:** `'warn'`
- **Rationale:** `'PATCH endpoints on JSON columns with nested sub-objects must deep-merge. Top-level spread silently replaces nested objects on clients that send partial payloads.'`
- **claudeMdRef:** `'#code-conventions'`

**Rule 9 — Public-portal mutations without `addActivity()`**
- **Bug class:** Client portal engagement invisible in activity feed.
- **Pattern:** `router\.(post|put|patch|delete)\s*\(`
- **Scope:** `['*.ts']`, `pathFilter: 'server/routes/public-portal.ts'`
- **Custom check:** for each match, scan the next 60 lines. If no `addActivity(` call is found before the next `router.` boundary, report warning.
- **Exclusions:** endpoints that genuinely don't need activity logs (e.g. GET-cached-as-POST); these must `// activity-ok`.
- **Hatch:** `// activity-ok`
- **Severity:** `'warn'`
- **Rationale:** `'Every public-portal POST/PUT/PATCH/DELETE must call addActivity() — admins need visibility into client engagement.'`
- **claudeMdRef:** `'#code-conventions'`

**Rule 10 — Inline `broadcastToWorkspace` call inside bridge callback**
- **Bug class:** Bridge callbacks must return `{ modified: N }` and let `executeBridge` dispatch the broadcast; inline dispatch double-fires.
- **Pattern:** `broadcastToWorkspace\(`
- **Scope:** `['*.ts']`, `pathFilter: 'server/bridges/'` (or wherever bridge files live; confirm with `ls server/bridges/` or `grep -l 'executeBridge' server/`)
- **Exclusions:** none
- **Hatch:** `// bridge-broadcast-ok`
- **Severity:** `'warn'`
- **Rationale:** `'Bridge callbacks must never import broadcastToWorkspace — return { modified: N } from the callback and executeBridge dispatches automatically.'`
- **claudeMdRef:** `'#code-conventions (Bridge authoring rules)'`

**Rule 11 — Layout-driving state set inside `useEffect` without synchronous derivation**
- **Bug class:** One-frame layout flash when a `useEffect` resets focus-mode / sidebar-visible state.
- **Pattern:** `useEffect\s*\(` (very broad — will generate lots of matches; refine with custom check)
- **Scope:** `['*.tsx']`, `pathFilter: 'src/'`
- **Custom check:** for each `useEffect(` match, scan the next 20 lines. If the body contains a `setX(` call where `X` also appears in a JSX conditional / className within 100 lines above the effect AND a synchronous condition exists in the same component, report warning. (This is intentionally fuzzy — false-positive rate will be high. Ship in `warn` severity with the intent that contributors add `// effect-layout-ok` generously, and the signal eventually curates itself.)
- **Hatch:** `// effect-layout-ok`
- **Severity:** `'warn'`
- **Rationale:** `'Layout-driving state must be derived synchronously in the render body, not via useEffect. Effects run after the browser paints — one-frame flash.'`
- **claudeMdRef:** `'#uiux-rules-mandatory'`

---

#### Task A1 steps

- [ ] **Step 1: Extend `Check` type with `rationale` and `claudeMdRef` fields**

```ts
type Check = {
  name: string;
  pattern: string;
  fileGlobs: string[];
  exclude?: string | string[];
  pathFilter?: string;
  excludeLines?: string[];
  message: string;
  severity: 'error' | 'warn';
  rationale?: string;
  claudeMdRef?: string;
  customCheck?: (files: string[]) => { file: string; line: number; text: string }[];
};
```

- [ ] **Step 2: Add `customCheck` handling to the `runCheck` function**

Before the existing ripgrep branch, add:

```ts
if (check.customCheck) {
  const files = getFilesForCheck(check);
  const matches = check.customCheck(files);
  return matches;  // same shape as ripgrep path
}
```

Verify the existing `runCheck` function's return type. If it returns `string[]`, instead make `customCheck` return `string[]` formatted identically (`<file>:<line>:<text>`).

- [ ] **Step 3: Add the 11 rules, one at a time, verifying each against `--all`**

For each rule:
1. Add the `CHECKS` entry.
2. Run `npx tsx scripts/pr-check.ts --all 2>&1 | grep -A5 "<rule name>"`.
3. Count matches. If >200, refine the regex before adding the next rule.
4. Spot-check 3 matches by opening the reported file and confirming the match is a real violation (not a comment, type declaration, test fixture, etc.).

- [ ] **Step 4: Add helper functions for custom checks at the bottom of `scripts/pr-check.ts`**

The functional rules (3, 4, 5, 9, 11) need helper functions. Keep them co-located at the bottom of the file in a `// ─── Custom check helpers ───` section.

- [ ] **Step 5: Run `npm run typecheck`**

Expected: zero errors. `scripts/pr-check.ts` has no tests, but the typecheck validates the `Check` type extension.

- [ ] **Step 6: Run `npx tsx scripts/pr-check.ts --all` end-to-end**

Expected: all 11 new rules surface in the output. None of them block (severity: warn for 10 of 11; rule 1 and rule 6 and rule 7 are error from day one and must report zero real matches — if they report any, fix them immediately in this task because they block CI).

- [ ] **Step 7: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "feat(pr-check): add 11 new rules for automation gap closure

Adds rules covering useGlobalAdminEvents import restriction, global
keydown guards, multi-step DB writes, AI-call-before-DB-write race,
workspace scoping, getOrCreate* return types, Record<string, unknown>
in shared/types, PATCH nested merge, public-portal addActivity pairing,
inline bridge broadcasts, and layout-driving state in useEffect.

All rules except three (useGlobalAdminEvents, getOrCreate*, and
Record<string, unknown>) ship as warn severity. PR B's mechanical
backfill drives existing matches to zero, then PR B's final commit
promotes warn → error.

Also extends Check type with rationale + claudeMdRef fields consumed
by PR C's rule metadata generator.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task A2: Nightly full-scan GitHub Action

**Files:**
- Create: `.github/workflows/pr-check-nightly.yml`

- [ ] **Step 1: Read the existing pr-check workflow as a template**

```bash
cat .github/workflows/pr-check.yml 2>/dev/null || ls .github/workflows/
```

If no existing `pr-check.yml`, read whatever workflow runs `npx tsx scripts/pr-check.ts` currently. Match its Node version, cache strategy, and checkout config.

- [ ] **Step 2: Create the nightly workflow**

```yaml
name: pr-check-nightly

on:
  schedule:
    - cron: '17 6 * * *'  # 06:17 UTC daily (off-peak, avoids cron thundering herd)
  workflow_dispatch: {}

jobs:
  full-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: staging  # staging is the release candidate branch; main is strictly
                        # a lagging copy updated only on explicit releases. Scanning
                        # staging catches regressions in the release candidate before
                        # they ship; scanning main would miss everything in-flight.
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Run pr-check --all
        id: scan
        run: |
          set -o pipefail
          npx tsx scripts/pr-check.ts --all 2>&1 | tee pr-check-full-scan.txt
      - name: Upload scan output on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: pr-check-full-scan
          path: pr-check-full-scan.txt
          retention-days: 14
```

- [ ] **Step 3: Verify workflow syntax**

```bash
# If actionlint is available:
which actionlint && actionlint .github/workflows/pr-check-nightly.yml
# Otherwise just verify YAML parses:
npx --yes js-yaml .github/workflows/pr-check-nightly.yml >/dev/null && echo ok
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pr-check-nightly.yml
git commit -m "ci: nightly pr-check --all full-scan workflow

Catches violations that land in unchanged files via renames and
refactors — the diff-only blind spot that allowed the bare JSON.parse
regression in PR #162 (useGlobalAdminEvents rename).

Runs 06:17 UTC daily; uploads pr-check-full-scan.txt artifact on
failure (14 day retention).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task A3: `docs/rules/pr-check-rule-authoring.md`

**Files:**
- Create: `docs/rules/pr-check-rule-authoring.md`

- [ ] **Step 1: Write the authoring guide**

Contents must cover:

1. **When to write a pr-check rule** — decision tree: "Does the bug have a grep-able symptom? Can it be caught at compile time instead (if yes, prefer TypeScript)? Does CLAUDE.md already document the rule? Has the bug occurred ≥2 times?"
2. **Regex vs customCheck** — regex for single-line patterns, customCheck for cross-line/functional checks. Examples of each.
3. **False-positive allowlist pattern** — `exclude: string[]` for file paths; `excludeLines: string[]` for inline patterns.
4. **`// rule-ok` escape hatch convention** — every new rule MUST provide an `excludeLines` hatch. Hatch name = kebab-case short form of the rule + `-ok`. Documented at top of the CHECKS array.
5. **Severity selection** — `'warn'` for fuzzy/high-false-positive rules and during rule introduction (until backfill is clean); `'error'` for rules with zero false positives.
6. **Testing a new rule** — positive test (one file that should match) + negative test (one file that should not). Run `--all` on the current codebase to discover the false-positive rate before committing.
7. **Pre-PR checklist for rule authors** — regex tested against ≥10 files, false-positive rate <20%, escape hatch documented, rationale + claudeMdRef metadata filled, committed at `warn` severity unless absolutely certain.
8. **Link to CLAUDE.md split** — explain the relationship: CLAUDE.md is philosophical/process; `docs/rules/automated-rules.md` (generated) is the mechanical enforcement table; `scripts/pr-check.ts` is the source of truth.

Do not use emojis. Keep headings ATX-style. Keep the document under 200 lines.

- [ ] **Step 2: Commit**

```bash
git add docs/rules/pr-check-rule-authoring.md
git commit -m "docs: authoring guide for pr-check rules

Documents when to write a rule, regex vs customCheck, escape hatch
convention, severity selection, and pre-commit checklist. Companion
to the 11 new rules added in the previous commit.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task A4: Roadmap follow-up entry for `docs/rules/*.md` audit

**Files:**
- Modify: `data/roadmap.json`

- [ ] **Step 1: Find the highest numeric `id` in `data/roadmap.json`**

```bash
grep -E '"id": [0-9]+' data/roadmap.json | awk -F'"id": ' '{print $2}' | tr -d ',' | sort -n | tail -1
```

Expected: `584` or higher. Use `max + 1` as the new id.

- [ ] **Step 2: Find the appropriate sprint (platform hardening / tech debt)**

```bash
grep -n '"id": "sprint-' data/roadmap.json
```

Use whichever sprint currently hosts tech-debt / audit items. If unsure, append to the last active sprint.

- [ ] **Step 3: Add the entry**

```json
{
  "id": 585,
  "title": "Audit docs/rules/*.md for staleness and coverage gaps",
  "source": "PR-check audit follow-up (2026-04-10)",
  "est": "2-3h",
  "priority": "P2",
  "notes": "Follow-up from the pr-check-audit-and-backfill plan. Walk every file in docs/rules/*.md and (a) verify it references current file paths and type names, (b) cross-check each rule against CLAUDE.md for drift, (c) flag any rule that could be mechanized into a pr-check check. User explicitly requested this be tracked separately.",
  "status": "pending"
}
```

- [ ] **Step 4: Re-sort the roadmap**

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 5: Verify JSON is valid**

```bash
npx --yes json5 data/roadmap.json >/dev/null && echo ok
# or: node -e 'JSON.parse(require("fs").readFileSync("data/roadmap.json","utf-8")); console.log("ok")'
```

- [ ] **Step 6: Commit**

```bash
git add data/roadmap.json
git commit -m "chore(roadmap): add docs/rules audit follow-up (585)

Per user request, track the docs/rules/*.md staleness audit as a
separate P2 roadmap item rather than conflating with the pr-check
audit plan.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### PR A final gate

- [ ] **Step 1: Run full verification**

```bash
npm run typecheck && \
npx vite build && \
npx vitest run && \
npx tsx scripts/pr-check.ts && \
npx tsx scripts/pr-check.ts --all
```

Expected: typecheck + build + tests green. `pr-check` (diff-only) green. `pr-check --all` reports the existing backlog (266+ matches) plus whatever the 11 new rules surface, all as warnings except the three error-from-day-one rules (which must be at zero).

- [ ] **Step 2: Push branch and open PR**

```bash
git push -u origin chore/pr-check-audit-and-backfill
gh pr create --base staging --title "chore(pr-check): add 11 rules + nightly full-scan (PR A of audit)" --body "$(cat <<'EOF'
## Summary
- Adds 11 new pr-check rules covering recurring bug classes from the brand-engine review rounds
- Adds nightly full-scan GitHub Action to catch violations hiding in unchanged files
- Creates docs/rules/pr-check-rule-authoring.md authoring guide
- Tracks docs/rules/*.md audit as a separate roadmap follow-up item

This is PR A of 3 in the pr-check-audit-and-backfill plan. PR B
mechanically backfills existing violations. PR C splits CLAUDE.md
into philosophical + auto-enforced sections.

All new rules except useGlobalAdminEvents-import-restriction,
getOrCreate-nullable, and Record-unknown-in-shared-types ship as
warn severity. PR B's final commit promotes warn → error.

## Test plan
- [ ] CI green
- [ ] `pr-check` diff-only reports zero failures on the PR
- [ ] `pr-check --all` reports the existing backlog as warnings (not errors)
- [ ] Manual workflow_dispatch of pr-check-nightly succeeds
EOF
)"
```

- [ ] **Step 3: After staging CI green, merge to staging**
- [ ] **Step 4: Verify staging deploy (asset-dashboard-staging.onrender.com) is healthy**
- [ ] **Step 5: STOP. Do not touch main. Do not cut a staging → main release.**

**PR A done.** Wait for staging CI green + staging deploy verification before starting PR B. Main will only receive the final bundled release after PR C merges to staging.

---

## PR B — Mechanical Backfill

**Precondition:** PR A is merged to `staging` and staging CI is green. The 11 new rules exist on staging and are surfaced as warnings. **Do not wait for main** — the brand engine release is staging-only by design until the full audit lands.

**Branch:** `chore/pr-check-backfill` (branch from `origin/staging` after PR A merges).

**Dispatch model:** tasks B1–B8 can be dispatched in parallel as subagents. Each owns its file set exclusively (see File Ownership section above). After all 8 complete, review diffs for overlap, run full suite, then sequentially commit B9 (pr-check.ts polish) and B10 (warn → error promotion).

### Task B1: Fix violet/indigo color violations (24 matches)

**Files owned by this task:**
- Identified by prelude grep:

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A50 "Forbidden hues" | grep -oE '\./src/components/[^:]+' | sort -u
```

Expected output includes: `ContentPerformance.tsx`, `ContentCalendar.tsx`, `PostEditor.tsx`, and up to 9 others.

- [ ] **Step 1: Enumerate every violation**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A50 "Forbidden hues" | grep -E "violet-|indigo-"
```

- [ ] **Step 2: Classify each match**

For each match, decide the target color per the Three Laws of Color (`BRAND_DESIGN_LANGUAGE.md`):

- `violet-*` in admin AI contexts → `purple-*`
- `violet-*` anywhere else → `teal-*` (if actionable) or `blue-*` (if data)
- `indigo-*` in pillar/tier contexts → `teal-*`
- `indigo-*` in data contexts → `blue-*`

Document the decision per file in a scratch table before editing.

- [ ] **Step 3: Apply replacements file by file**

For each file, use `Edit` with `replace_all: true` where the hue is unambiguous, otherwise per-instance edits. After each file, open it in the editor and visually confirm no orphaned references.

- [ ] **Step 4: Verify the category is clean**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A2 "Forbidden hues"
```

Expected: `✓ Forbidden hues (violet/indigo) in components`

- [ ] **Step 5: Verify no regressions**

```bash
npm run typecheck && npx vite build && npx vitest run
```

- [ ] **Step 6: Visual smoke test (if Playwright is healthy)**

```bash
npx playwright test tests/e2e/ --grep "ContentPerformance|ContentCalendar|PostEditor"
```

If no targeted E2E exists, skip and rely on visual diff during PR review.

- [ ] **Step 7: Commit**

```bash
git add src/components/ContentPerformance.tsx src/components/ContentCalendar.tsx src/components/PostEditor.tsx # ... and other affected files
git commit -m "fix(design): eliminate violet/indigo — enforce Three Laws of Color

Swaps violet-/indigo- hues in 24 call sites across ContentPerformance,
ContentCalendar, PostEditor, and 8 other components. Admin AI contexts
became purple-; data contexts became blue-; actionable contexts became
teal-.

Clears the 'Forbidden hues' pr-check rule category.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task B2: Fix hardcoded `hmpsn.studio` strings (6 matches)

**Files owned by this task:**
- `src/components/LandingPage.tsx` (2 matches)
- `src/components/Styleguide.tsx` (3 matches)
- One other (identified by prelude grep)

- [ ] **Step 1: Enumerate**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A10 "Hard-coded studio name" | grep -E "[a-z]"
```

- [ ] **Step 2: Classify the replacement**

Each match is one of:

- **Logo alt text / image src** (`hmpsn-studio-logo-wordmark-white.svg`, `alt="hmpsn studio"`): these are PATHS and alt text for actual image files. Rename isn't appropriate — these reference real SVG filenames that shouldn't change for brand continuity. Use the rule's exclude list — add these specific files to the rule's `exclude` array in `scripts/pr-check.ts`.
- **User-facing prose** (`"This module needs to be enabled by hmpsn studio."`, `"hmpsn studio will begin content production."`): replace with `{STUDIO_NAME}` template using the imported constant.
- **Footer attribution**: replace with `{STUDIO_NAME}` template.

- [ ] **Step 3: Import STUDIO_NAME at the top of each affected file**

```ts
import { STUDIO_NAME } from '../constants';  // adjust path as needed
```

Follow the existing import grouping (top of file, grouped with other internal imports). Never add imports mid-file.

- [ ] **Step 4: Replace user-facing prose**

```tsx
// Before
description="This module needs to be enabled by hmpsn studio."
// After
description={`This module needs to be enabled by ${STUDIO_NAME}.`}
```

- [ ] **Step 5: Add logo path exclusions to `scripts/pr-check.ts`**

Add the specific files to the existing rule's `exclude` list (NOT a new path filter — this preserves error-severity on actual prose violations):

```ts
{
  name: 'Hard-coded studio name',
  pattern: 'hmpsn[ .]studio',
  fileGlobs: ['*.ts', '*.tsx'],
  exclude: [
    'server/constants.ts',
    'src/constants.ts',
    // New exclusions: files containing ONLY logo paths/alt text (verified 2026-04-10)
    // NOTE: if you add a user-facing prose string to these files, remove them from this list first.
    // ❌ don't add the whole file — revisit the pattern to exclude just logo-path lines
  ],
  // ...
}
```

Actually, prefer `excludeLines` to exclude only the logo lines, not the whole file:

```ts
excludeLines: [
  'hmpsn-studio-logo-wordmark-white.svg',
  'alt="hmpsn studio"',
],
```

- [ ] **Step 6: Verify the category is clean**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A2 "Hard-coded studio"
```

- [ ] **Step 7: Verify no regressions**

```bash
npm run typecheck && npx vite build && npx vitest run
```

- [ ] **Step 8: Commit**

```bash
git add src/components/LandingPage.tsx src/components/Styleguide.tsx scripts/pr-check.ts
git commit -m "fix(constants): use STUDIO_NAME in user-facing prose; exclude logo paths from rule

Replaces 4 hardcoded 'hmpsn studio' user-facing strings with
{STUDIO_NAME} template interpolation. Logo filename references
(hmpsn-studio-logo-wordmark-white.svg) and associated alt text are
excluded via excludeLines — these are intentional brand asset paths
that should not be templated.

Clears the 'Hard-coded studio name' pr-check rule category.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task B3: Fix bare JSON.parse on server (56 matches — mostly disk files)

**Files owned by this task:**
- `server/semrush.ts`
- `server/providers/dataforseo-provider.ts`
- `scripts/pr-check.ts` (rule exclusion list only)
- Any other server/ files identified by the prelude grep

- [ ] **Step 1: Enumerate**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A60 "Bare JSON.parse on server" | grep -E "^\s+server/"
```

- [ ] **Step 2: Classify each match**

For each match, open the file and determine:

- **Disk file read** (`JSON.parse(fs.readFileSync(...))`): this is NOT a DB column read; it's an on-disk cache/log file. Rule intent excludes these. Add the file to the rule's `exclude` array.
- **WebSocket/HTTP message parse**: also not DB. Exclude.
- **AI response parse**: also not DB. Exclude.
- **Actual DB column read**: rewrite to use `parseJsonSafe()` or `parseJsonFallback()` from `server/db/json-validation.ts`.

The existing exclude list already has ~12 files. Expect most of the 56 to be additions to this list.

- [ ] **Step 3: Expand the exclude list in `scripts/pr-check.ts`**

Walk the 56 matches file by file. For each unique file not already in the exclude list, read the file to confirm it contains only non-DB parses, then add it to the list with an inline comment:

```ts
exclude: [
  // ... existing entries ...
  'server/semrush.ts',                   // disk-based usage log files
  'server/providers/dataforseo-provider.ts', // disk-based credit log
  // ... etc
],
```

- [ ] **Step 4: Rewrite any actual DB column parses**

If any of the 56 matches turn out to be DB column reads (unlikely given the sample), rewrite using:

```ts
// Before
const data = JSON.parse(row.json_column);
// After
import { parseJsonSafe } from './db/json-validation.js';
const data = parseJsonSafe(row.json_column, mySchema, { fallback }, 'context-tag');
```

- [ ] **Step 5: Verify the category is clean**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A2 "Bare JSON.parse on server"
```

Expected: `✓` or a sharply reduced count (<5, all genuinely new-since-PR-A).

- [ ] **Step 6: Verify no regressions**

```bash
npm run typecheck && npx vite build && npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add scripts/pr-check.ts server/semrush.ts server/providers/dataforseo-provider.ts # + other edited files
git commit -m "fix(pr-check): exclude disk-file JSON.parse sites from DB-column rule

The 'Bare JSON.parse on server' rule targets DB column reads, not
disk file caches, WebSocket messages, or AI response parsing. Walks
the 56 existing matches and adds genuine disk-read files
(server/semrush.ts, server/providers/dataforseo-provider.ts, and
~10 others) to the rule's exclude list with inline justification.

No behavior change — only rule scope refinement.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task B4: Fix source-sniffing readFileSync tests (37 matches)

**Files owned by this task:**
- `tests/` files identified by prelude grep. Examples from the current scan: `tests/send-to-planner.test.ts`, `tests/ws-intelligence-cache.test.ts`, `tests/bridge-wiring.test.ts`.

- [ ] **Step 1: Enumerate**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A50 "Source-sniffing" | grep -E "^\s+tests/"
```

- [ ] **Step 2: Classify each match**

For each file:

- **Migration guard** — the test asserts a deprecated endpoint is no longer referenced. Add `// readFile-ok` to the `readFileSync` line.
- **Fragile semantic test** — the test reads source to assert template literal fragments or variable names. Rewrite as a real behavioral test (import the module, exercise the function, assert on output).
- **Contract test on generated code** — the test verifies codegen output. Add `// readFile-ok` with comment.

Use judgment. The user explicitly said "case by case judgment" for this category.

- [ ] **Step 3: For each file, write an ADR-style comment**

Above each `readFileSync` call, add a one-sentence justification:

```ts
// readFile-ok — deliberate migration guard: asserts the deprecated
// /api/pages endpoint is no longer referenced in ContentGaps.tsx.
const contentGapsSrc = readFileSync('src/components/strategy/ContentGaps.tsx', 'utf-8');
```

- [ ] **Step 4: Rewrite fragile tests that do NOT qualify for the hatch**

For tests that should be behavioral, delete the readFileSync and import the module directly. If the function isn't exported, export it. If the test needs mocking, use existing mock factories in `tests/mocks/`.

- [ ] **Step 5: Verify the category is clean**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A2 "Source-sniffing"
```

Expected: zero matches (all either hatched or rewritten).

- [ ] **Step 6: Run the affected tests**

```bash
npx vitest run tests/send-to-planner.test.ts tests/ws-intelligence-cache.test.ts tests/bridge-wiring.test.ts # and others
```

Expected: all green. Any tests that were rewritten (not hatched) must pass with the new assertion logic.

- [ ] **Step 7: Verify the full suite**

```bash
npx vitest run
```

- [ ] **Step 8: Commit**

```bash
git add tests/
git commit -m "test: annotate or rewrite source-sniffing readFileSync assertions

Walks the 37 source-sniffing matches in tests/ and case-by-case:
(a) annotates with // readFile-ok when the test is a deliberate
migration guard; (b) rewrites as behavioral tests using module imports
and mocks when the source-sniffing was incidental.

Clears the 'Source-sniffing in tests' pr-check rule category.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task B5: Fix vacuous .every() test assertions (91 matches)

**Files owned by this task:**
- `tests/` files identified by prelude grep.

- [ ] **Step 1: Enumerate**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A150 "Vacuous .every" | grep -E "^\s+tests/" > /tmp/vacuous-every.txt
wc -l /tmp/vacuous-every.txt
```

Expected: 91 lines.

- [ ] **Step 2: Apply the mechanical fix to every match**

For each `.every()` call, add a `length > 0` guard on the same array:

```ts
// Before
expect(result.every((item) => typeof item.level === 'number')).toBe(true);
// After
expect(result.length).toBeGreaterThan(0);
expect(result.every((item) => typeof item.level === 'number')).toBe(true);
```

- [ ] **Step 3: For any `.every()` where the array is genuinely allowed to be empty**

If the test's intent is "all items (which may be none) satisfy condition X" — this is rare and usually a sign of a broken test. Add `// every-ok` with a comment explaining the semantic. Default is to add the guard.

- [ ] **Step 4: Verify the category is clean**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A2 "Vacuous"
```

Expected: zero matches or only hatched lines.

- [ ] **Step 5: Run the full test suite**

```bash
npx vitest run
```

Expected: some tests may now legitimately FAIL — because the `length > 0` guard exposes arrays that were empty in the test fixture. This is THE BUG the rule was designed to catch. For each newly-failing test:
1. Read the test fixture.
2. Determine why the array was empty.
3. Fix the fixture OR the code under test so the array is populated.
4. Re-run.

Do NOT revert the guard to make the test pass. That was the vacuous behavior we're eliminating.

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "test: add length > 0 guard before .every() assertions (91 sites)

[].every(fn) returns true for any fn — vacuous. Adds a
toBeGreaterThan(0) assertion before each .every() to ensure the
collection actually contains items.

Surfaced N tests with empty fixtures where the assertion was passing
on zero iterations; those fixtures are fixed in this commit.

Clears the 'Vacuous .every() in tests' pr-check rule category.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task B6: Fix untyped dynamic imports (44 matches)

**Files owned by this task:**
- `server/` files identified by prelude grep. Canonical examples: `server/content-decay.ts`, `server/reports.ts`.

- [ ] **Step 1: Enumerate**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A60 "Untyped dynamic import" | grep -E "^\s+server/" > /tmp/dynamic-imports.txt
```

- [ ] **Step 2: For each dynamic import, add a matching `import type`**

Pattern:

```ts
// Before (at some point in the file body)
const { upsertInsight } = await import('./analytics-insights-store.js');

// After:
// 1. Add at top of file, grouped with other imports:
import type { upsertInsight as UpsertInsightFn } from './analytics-insights-store.js';
// 2. Annotate the dynamic import:
const { upsertInsight } = await import('./analytics-insights-store.js') as { upsertInsight: typeof UpsertInsightFn };
```

Or, if the function is a direct export, the cleaner pattern is:

```ts
// Top of file:
import type * as InsightsStore from './analytics-insights-store.js';
// Body:
const mod: typeof InsightsStore = await import('./analytics-insights-store.js');
const { upsertInsight } = mod;
```

Use whichever pattern makes the specific call site most readable. Both satisfy the rule (TypeScript can now verify field names on the destructure).

- [ ] **Step 3: If a circular dependency prevents value import, use `import type` only**

This is the safe escape: `import type` is erased at compile time and never introduces a runtime cycle.

- [ ] **Step 4: If the imported module doesn't export its types**

Add the export in the target module (e.g. `export type { SomethingType }`). Commit this as part of the same task.

- [ ] **Step 5: For truly untypeable cases (third-party dynamic imports)**

Add `// dynamic-import-ok` on the line with a comment explaining why.

- [ ] **Step 6: Verify the category is clean**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A2 "Untyped dynamic import"
```

- [ ] **Step 7: Verify typechecking catches the newly-visible field name errors**

```bash
npm run typecheck
```

Expected: some typecheck errors may surface — these are the "guessed field names" the rule was designed to catch. Fix each by updating the destructure or the type reference to match reality.

- [ ] **Step 8: Full verification**

```bash
npm run typecheck && npx vite build && npx vitest run
```

- [ ] **Step 9: Commit**

```bash
git add server/
git commit -m "fix(server): type all dynamic imports (44 sites)

Adds `import type` declarations for every `await import(...)` call in
server/. Exposes N previously-silent field name drifts where the
destructured names did not match the imported module's exports; those
are fixed in this commit.

Clears the 'Untyped dynamic import' pr-check rule category.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task B7: Fix unguarded recordAction calls (8 matches)

**Files owned by this task:**
- `server/outcome-backfill.ts` (3 matches)
- `server/routes/insights.ts` (1 match)
- `server/routes/content-decay.ts` (1 match)
- Up to 3 others.

- [ ] **Step 1: Enumerate**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A15 "Unguarded recordAction"
```

- [ ] **Step 2: For each match, open the file and determine the workspaceId source**

Read 20 lines of context above the `recordAction(` call. Find where `workspaceId` is set — it may come from:
- A function parameter
- A loop variable
- A JWT decode
- A Webflow siteId lookup (DANGEROUS — that's the bug)

- [ ] **Step 3: Wrap the call in `if (workspaceId) { ... }`**

```ts
// Before
recordAction({ workspaceId, action: 'x', ... });

// After
if (workspaceId) {
  recordAction({ workspaceId, action: 'x', ... });
}
```

- [ ] **Step 4: If the source is a Webflow siteId / sourceId (not a workspaceId)**

Look up the real workspaceId from the siteId. Example pattern:

```ts
const workspace = getWorkspaceBySiteId(siteId);
if (workspace) {
  recordAction({ workspaceId: workspace.id, ... });
}
```

- [ ] **Step 5: If the workspaceId is guaranteed non-null by an earlier guard**

Add `// recordAction-ok` with a comment explaining why.

- [ ] **Step 6: Verify the category is clean**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A2 "Unguarded recordAction"
```

- [ ] **Step 7: Run the full suite**

```bash
npm run typecheck && npx vite build && npx vitest run
```

- [ ] **Step 8: Commit**

```bash
git add server/outcome-backfill.ts server/routes/insights.ts server/routes/content-decay.ts # + others
git commit -m "fix(server): guard recordAction() calls with workspaceId check (8 sites)

Per CLAUDE.md: recordAction() must be gated by `if (workspaceId)`.
Walks the 8 unguarded sites in outcome-backfill, routes/insights,
routes/content-decay, and wraps each call. None of the sites were
passing siteIds as workspaceIds (good), but the defensive guard now
blocks a future bug.

Clears the 'Unguarded recordAction() call' pr-check rule category.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task B8: Backfill UPDATE/DELETE missing workspace_id scope (39 matches)

> Added 2026-04-10 from the PR A scaled code review (low-signal finding #1). Post-PR-A fixes landed Rule 5 at 39 real matches; this is the largest remaining backfill and the reason Rule 5 must stay at `warn` until this task completes.

**Files owned by this task:**
- Identified by prelude grep. Expected includes `server/content-requests.ts`, `server/content-brief.ts`, `server/requests.ts`, `server/churn-signals.ts`, and up to 15 others.

- [ ] **Step 1: Enumerate every violation**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -B1 -A50 "UPDATE/DELETE missing workspace_id" | grep -E "server/.*\.ts:[0-9]+"
```

- [ ] **Step 2: Classify each match**

For each match, decide between two outcomes:

- **Add `AND workspace_id = ?` to the SQL**: default choice. The query string gains the clause; the call site gains the binding. This is the correct fix when the row key is not UUID-unique across workspaces (auto-increment IDs, composite keys, names).
- **Add `// ws-scope-ok` hatch**: the row key is already workspace-unique (UUIDv4, nanoid, `crypto.randomUUID()`). Verify by reading the migration that created the column — if it's a UUID and the table has no foreign-key re-use across workspaces, the hatch is justified. Add a comment explaining why above the hatch.

Document the decision per match in a scratch table before editing.

- [ ] **Step 3: Apply SQL fixes (the common case)**

For each UPDATE/DELETE that needs scoping:

```ts
// Before
db.prepare('UPDATE foo SET status = ? WHERE id = ?').run(status, id);

// After
db.prepare('UPDATE foo SET status = ? WHERE id = ? AND workspace_id = ?').run(status, id, workspaceId);
```

If the function doesn't already take `workspaceId`, thread it through — do not invent a `getWorkspaceIdForFoo(id)` helper. A function that can't prove the caller's workspace context has no business writing to a workspace-scoped table.

- [ ] **Step 4: Apply hatches for UUID-keyed rows**

```ts
// ws-scope-ok — churn_signals.id is a nanoid, unique across all workspaces
dismiss: db.prepare('UPDATE churn_signals SET dismissed_at = ? WHERE id = ?'),
```

- [ ] **Step 5: Verify the category is clean**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A2 "UPDATE/DELETE missing workspace_id"
```

Expected: `✓ UPDATE/DELETE missing workspace_id scope`

- [ ] **Step 6: Full verification**

```bash
npm run typecheck && npx vite build && npx vitest run
```

**Critical:** the test suite must catch any call site that was silently dropping the workspace filter. Any test that now fails with "row not found" where it previously passed is uncovering a real bug where the test fixture's `workspaceId` wasn't aligned with the row being updated — fix the fixture, not the query.

- [ ] **Step 7: Commit**

```bash
git add server/  # specific files only
git commit -m "fix(db): scope UPDATE/DELETE queries to workspace_id (39 sites)

Threads workspace_id through every non-UUID-keyed UPDATE/DELETE in the
server tree. UUID-keyed rows (nanoid/crypto.randomUUID) use the
// ws-scope-ok hatch with a justification comment.

Clears the 'UPDATE/DELETE missing workspace_id scope' pr-check rule.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task B9: Polish pr-check.ts from scaled-review findings

> Added 2026-04-10 from the PR A scaled code review (low-signal findings #2–#7). None block merge; all improve rule quality, consistency, or maintainability. Bundled into one commit because each edit is small and the blast radius is contained to `scripts/pr-check.ts`.

**Files owned by this task:**
- `scripts/pr-check.ts`

- [ ] **Step 1: Collapse `message` ≈ `rationale` duplication (finding #2)**

10 of the 11 PR A rules have a `message` and `rationale` that say nearly the same thing. The `message` is shown to developers on a hit; the `rationale` is shown in the generated docs. Either (a) make `rationale` strictly the one-sentence bug class (≤ 12 words) and keep `message` as the actionable remediation, or (b) delete `rationale` on rules where it adds no information beyond `message` and fall back to `message` in the generator.

Pick option (a). For each rule, rewrite `rationale` to be a single noun phrase: the bug class prevented. Examples:

```ts
// Before
rationale: 'A workspace-scoped broadcast via useGlobalAdminEvents results in dead-code handlers because the server only fans out to explicitly subscribed connections.',

// After
rationale: 'Silent dead-code handlers on misused hook.',
```

- [ ] **Step 2: Extend Record<string,unknown> pattern to tolerate spacing (finding #4)**

The current pattern is `Record<string, unknown>` with a single space after the comma. A developer writing `Record<string,  unknown>` (double space) or `Record< string, unknown >` (padded brackets) would bypass the rule. Extend the regex:

```ts
pattern: 'Record<\\s*string\\s*,\\s*unknown\\s*>',
```

Verify full-scan output is unchanged (should still be zero matches after the shared-types exclusions).

- [ ] **Step 3: Harden public-portal pathFilter (finding #5)**

Current `pathFilter: 'server/routes/public-portal.ts'` is a file path. It works — `find <file> -name '*.ts'` returns the file — but is fragile if the rule runner is ever refactored to assume a directory prefix. Replace with:

```ts
pathFilter: 'server/routes/',
exclude: [
  // existing exclusions...
  'server/routes/',  // restrict further via fileGlobs + customCheck path filter
],
```

Or, more cleanly, keep the rule as a customCheck and early-return if `!file.endsWith('public-portal.ts')`. Pick the latter — explicit in code, no indirection through the glob engine.

- [ ] **Step 4: Rename shadowed `window` variable (finding #6)**

Rule 3's customCheck uses `window` as a local variable name for the sliding DB-write window. This shadows the global `window` in any context that cares. Rename to `txnWindow` or `writeWindow`:

```ts
const writeWindow = lines.slice(Math.max(0, a - 5), Math.min(lines.length, b + 5)).join('\n');
if (/db\.transaction\s*\(/.test(writeWindow)) continue;
```

- [ ] **Step 5: Normalize `.forEach` → `for...of` (finding #7)**

Five call sites in `scripts/pr-check.ts` still use `.forEach()` despite the rest of the file using `for...of`. Replace for consistency:

```ts
// Before
files.forEach((file) => { ... });
// After
for (const file of files) { ... }
```

Skip this step if any `.forEach` callback uses `return` for early-exit — `for...of` needs `continue` instead, and the rewrite is non-trivial in that case. For those sites, leave a `// TODO: migrate when refactoring` comment instead.

- [ ] **Step 6: Verify no regressions**

```bash
npm run typecheck && npx tsx scripts/pr-check.ts --all
```

Expected: identical error/warning counts to the pre-polish baseline. None of these edits should change any rule's match count.

- [ ] **Step 7: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "chore(pr-check): polish from scaled-review findings

- rationale collapsed to single-noun bug class on 10 rules
- Record<string,unknown> pattern tolerates padded/wide spacing
- public-portal rule uses explicit file guard instead of pathFilter hack
- Rule 3 local shadowed variable renamed from 'window' → 'writeWindow'
- .forEach call sites normalized to for...of where safe

All changes are internal to pr-check.ts; full scan emits identical
counts before and after.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task B10: Promote PR A rules warn → error

**Files owned by this task:**
- `scripts/pr-check.ts` (severity field edits only — do not touch any other fields)

**Precondition:** Tasks B1–B9 complete. `npx tsx scripts/pr-check.ts --all` reports zero errors and zero warnings for all PR A rules.

- [ ] **Step 1: Verify zero violations**

```bash
npx tsx scripts/pr-check.ts --all
```

Expected: every category is `✓`. If any rule still has matches, STOP — that task wasn't completed. Do not proceed with the upgrade.

- [ ] **Step 2: Promote `warn` → `error` on the PR A rules that landed at warn**

Rules to promote (8 total):
- Global keydown missing isContentEditable guard
- Multi-step DB writes outside db.transaction()
- AI call immediately followed by db.prepare without transaction
- Missing AND workspace_id in UPDATE/DELETE
- PATCH spread without nested merge
- Public-portal mutations without addActivity()
- Inline broadcastToWorkspace inside bridge callback
- Layout-driving state set inside useEffect

Rules that stay warn (too fuzzy for error):
- Layout-driving state in useEffect (rule 11) — high false-positive rate; keep at warn forever

Revise: of the 8, promote 7 to error; keep rule 11 at warn.

For each, edit the `severity: 'warn'` field to `severity: 'error'`.

- [ ] **Step 3: Verify the promotion does not fail CI**

```bash
npx tsx scripts/pr-check.ts --all
```

Expected: all green. No rule should now be firing as an error.

- [ ] **Step 4: Full verification**

```bash
npm run typecheck && npx vite build && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "chore(pr-check): promote 7 PR A rules from warn to error

With the B1-B9 backfill + polish complete, the codebase is clean against:
- Global keydown missing isContentEditable guard
- Multi-step DB writes outside db.transaction()
- AI-call-before-DB-write race
- Workspace scoping in UPDATE/DELETE
- PATCH spread without nested merge
- Public-portal addActivity() pairing
- Inline broadcastToWorkspace inside bridge callback

Promoting severity warn → error so future regressions block CI.

Layout-driving state in useEffect (rule 11) stays at warn due to
high false-positive rate.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### PR B final gate

- [ ] **Step 1: Run full verification**

```bash
npm run typecheck && \
npx vite build && \
npx vitest run && \
npx tsx scripts/pr-check.ts && \
npx tsx scripts/pr-check.ts --all
```

Expected: all green. `pr-check --all` reports zero errors and zero warnings across all categories.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin chore/pr-check-backfill
gh pr create --base staging --title "chore(pr-check): mechanical backfill of existing violations (PR B of audit)" --body "$(cat <<'EOF'
## Summary
- Backfills all 300+ existing pr-check violations identified by the PR A nightly full-scan
- One commit per category: colors, studio-name, JSON.parse exclusions, source-sniffing tests, vacuous .every, dynamic imports, recordAction guards, workspace_id scoping
- Incorporates scaled-review polish (rationale copy, Record spacing, pathFilter hardening, variable shadow, forEach normalization)
- Final commit promotes 7 PR A rules from warn → error

This is PR B of 3 in the pr-check-audit-and-backfill plan. PR C
splits CLAUDE.md into philosophical + auto-enforced sections.

## Test plan
- [ ] CI green
- [ ] `pr-check --all` reports zero errors AND zero warnings
- [ ] Full `vitest run` passes including tests fixed by B5 length guards
- [ ] Visual review of color changes (B1) in PostEditor, ContentCalendar, ContentPerformance
EOF
)"
```

- [ ] **Step 3: After staging CI green, merge to staging**
- [ ] **Step 4: Verify staging deploy (asset-dashboard-staging.onrender.com) is healthy — spot-check admin chat, brandscript tab, voice calibration tab; ensure no color regressions from B1**
- [ ] **Step 5: STOP. Do not touch main.**

**PR B done.** Wait for staging verification before starting PR C. Main still does not get updated yet.

---

## PR C — CLAUDE.md Split

**Precondition:** PR B is merged to `staging` and staging CI is green. **Do not wait for main** — see note in PR B precondition.

**Branch:** `chore/claude-md-split` (branch from `origin/staging` after PR B merges).

### Task C1: Add rule-metadata generator script

**Files:**
- Create: `scripts/generate-rules-doc.ts`
- Modify: `package.json` (add `rules:generate` npm script)

- [ ] **Step 1: Write the generator**

```ts
#!/usr/bin/env tsx
/**
 * generate-rules-doc.ts — Generates docs/rules/automated-rules.md from
 * the CHECKS array in scripts/pr-check.ts. Run on every PR via CI;
 * fails if the committed file is out of sync.
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const ROOT = path.join(import.meta.dirname, '..');

// Import the CHECKS array from pr-check.ts. Since pr-check is a script,
// not a library, we extract by dynamic import with a type-only cast.
import type * as PrCheck from './pr-check.js';

async function main() {
  // pr-check exports CHECKS if we add `export` in Task C1 step 2.
  const { CHECKS } = (await import('./pr-check.js')) as typeof PrCheck & { CHECKS: Check[] };

  type Check = {
    name: string;
    pattern: string;
    fileGlobs: string[];
    pathFilter?: string;
    excludeLines?: string[];
    severity: 'error' | 'warn';
    rationale?: string;
    claudeMdRef?: string;
  };

  const header = `# Automated Rules (generated)

> **DO NOT EDIT.** This file is regenerated from \`scripts/pr-check.ts\` on every PR.
> Run \`npm run rules:generate\` to update.

Total rules: **${CHECKS.length}**

| Rule | Severity | Scope | Escape hatch | Rationale |
|------|----------|-------|--------------|-----------|
`;

  const rows = CHECKS.map((c: Check) => {
    const scope = c.pathFilter ?? c.fileGlobs.join(', ');
    const hatch = c.excludeLines?.find((l: string) => l.includes('-ok')) ?? '—';
    const rationale = c.rationale ?? '(undocumented)';
    return `| ${c.name} | ${c.severity} | \`${scope}\` | \`${hatch}\` | ${rationale} |`;
  }).join('\n');

  const footer = `

---

## How to add a new rule

See [docs/rules/pr-check-rule-authoring.md](./pr-check-rule-authoring.md).

## How to regenerate this file

\`\`\`bash
npm run rules:generate
\`\`\`
`;

  const output = header + rows + footer;
  writeFileSync(path.join(ROOT, 'docs/rules/automated-rules.md'), output);
  console.log(`Wrote ${CHECKS.length} rules to docs/rules/automated-rules.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Export `CHECKS` from `scripts/pr-check.ts`**

Change `const CHECKS: Check[] = [...]` to `export const CHECKS: Check[] = [...]`. Also export the `Check` type. Verify the script still runs as an entry point (export does not affect script behavior).

```bash
npx tsx scripts/pr-check.ts  # should still work
```

- [ ] **Step 3: Add npm script**

In `package.json`:

```json
{
  "scripts": {
    "rules:generate": "tsx scripts/generate-rules-doc.ts"
  }
}
```

- [ ] **Step 4: Run the generator**

```bash
npm run rules:generate
```

Expected: creates `docs/rules/automated-rules.md`. Inspect the output for formatting (table renders cleanly; no truncated messages; escape hatches are correct).

- [ ] **Step 5: Add CI check that the file is in sync**

In whatever workflow runs `pr-check` (likely `.github/workflows/ci.yml` or similar), add a step:

```yaml
- name: Verify rules doc is in sync
  run: |
    npm run rules:generate
    git diff --exit-code docs/rules/automated-rules.md || (echo "docs/rules/automated-rules.md is out of sync. Run 'npm run rules:generate' and commit." && exit 1)
```

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-rules-doc.ts scripts/pr-check.ts package.json docs/rules/automated-rules.md .github/workflows/ci.yml
git commit -m "feat(docs): rule-metadata generator for automated-rules.md

Adds scripts/generate-rules-doc.ts which reads CHECKS from pr-check.ts
and emits a human-readable markdown table. CI enforces that the
committed file matches the generator output.

Also exports CHECKS + Check type from pr-check.ts so the generator
can import them.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task C2: Split CLAUDE.md → CLAUDE.md + docs/rules/automated-rules.md

**Files:**
- Modify: `CLAUDE.md` (remove auto-enforced rules; keep philosophical + session protocol)
- Already exists (from C1): `docs/rules/automated-rules.md` (no edits — it's generated)
- Modify: `CLAUDE.md` (add a "See also" link to the generated doc)

- [ ] **Step 1: Read current `CLAUDE.md` in full**

```bash
wc -l CLAUDE.md
```

Expected: ~313 lines (confirmed in prelude).

- [ ] **Step 2: Classify every bullet/rule in CLAUDE.md**

Walk the file section by section. For each rule:

- **Philosophical / process / session protocol** — keep in CLAUDE.md.
  - Session Protocol, Decision Framework, Commands, Quality Gates, Auth Conventions, Design System (Three Laws), Session-start-reading links.
- **Mechanically enforced by pr-check** — move to `docs/rules/automated-rules.md` (generated). Add a one-line stub in CLAUDE.md that says "See [automated-rules.md](./docs/rules/automated-rules.md) — enforced by scripts/pr-check.ts."
- **Mechanically enforceable but not yet automated** — keep in CLAUDE.md with a `TODO: rule` annotation.
- **Philosophical guardrail that will never be automated** — keep in CLAUDE.md.

Build a mapping table in a scratch file before editing.

- [ ] **Step 3: Edit CLAUDE.md**

Delete the bullets that are now in the generated doc. Replace the "Code Conventions" and "Data Flow Rules" bullet-lists with:

```markdown
## Code Conventions

- TypeScript strict, no `any` unless unavoidable
- API error shape: `{ error: string }`
- [Full conventions + auto-enforced rules table →](./docs/rules/automated-rules.md)
```

- [ ] **Step 4: Add a top-level pointer**

Near the top of CLAUDE.md (after "Project Overview"), add:

```markdown
## Enforcement Layers

Claude Code project rules live in three places:

1. **CLAUDE.md** (this file) — session protocol, decision framework, and philosophical guardrails
2. **[docs/rules/automated-rules.md](./docs/rules/automated-rules.md)** — every rule enforced by `scripts/pr-check.ts` (auto-generated from pr-check.ts; do not edit)
3. **[docs/rules/*.md](./docs/rules/)** — deep-dive references for specific subsystems (data-flow, UI/UX, multi-agent coordination, etc.)

When a CLAUDE.md rule can be mechanized, it moves to layer 2. See [docs/rules/pr-check-rule-authoring.md](./docs/rules/pr-check-rule-authoring.md).
```

- [ ] **Step 5: Verify line count dropped**

```bash
wc -l CLAUDE.md
```

Expected: noticeably shorter (~180-220 lines). If it's still 313, nothing was moved.

- [ ] **Step 6: Regenerate the auto-rules doc (no-op sanity check)**

```bash
npm run rules:generate
git diff docs/rules/automated-rules.md
```

Expected: no diff — the file is already up to date from Task C1.

- [ ] **Step 7: Full verification**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts --all
```

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: split CLAUDE.md — philosophical in CLAUDE.md, mechanized in docs/rules/automated-rules.md

CLAUDE.md was ~313 lines with ~60 rules, of which ~35 are now
mechanically enforced by pr-check. This commit:

- Extracts auto-enforced rules into docs/rules/automated-rules.md
  (generated by scripts/generate-rules-doc.ts from CHECKS)
- Keeps session protocol, decision framework, design system, and
  philosophical guardrails in CLAUDE.md
- Adds an 'Enforcement Layers' pointer at the top so contributors
  and agents know where each rule class lives

Drops CLAUDE.md to ~200 lines.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### PR C final gate

- [ ] **Step 1: Run full verification**

```bash
npm run typecheck && \
npx vite build && \
npx vitest run && \
npx tsx scripts/pr-check.ts && \
npx tsx scripts/pr-check.ts --all && \
npm run rules:generate && \
git diff --exit-code docs/rules/automated-rules.md
```

- [ ] **Step 2: Open PR**

```bash
git push -u origin chore/claude-md-split
gh pr create --base staging --title "docs: split CLAUDE.md + auto-generated rules table (PR C of audit)" --body "$(cat <<'EOF'
## Summary
- Adds scripts/generate-rules-doc.ts which emits docs/rules/automated-rules.md from pr-check.ts CHECKS
- Splits CLAUDE.md: philosophical rules stay; mechanized rules move to the generated table
- CI enforces the generated file is in sync

This is PR C of 3 in the pr-check-audit-and-backfill plan. Completes
the audit.

## Test plan
- [ ] CI green
- [ ] `npm run rules:generate && git diff --exit-code docs/rules/automated-rules.md` — clean
- [ ] CLAUDE.md reads coherently end-to-end after the split
- [ ] Every rule removed from CLAUDE.md is present in docs/rules/automated-rules.md
EOF
)"
```

- [ ] **Step 3: After staging CI green, merge to staging**
- [ ] **Step 4: Verify staging deploy end-to-end — brand engine full flow (brandscript creation, voice calibration, deliverables), admin chat, color regression spot-check**
- [ ] **Step 5: Hand off to the user for the final `staging → main` release decision.**

Do NOT cut the release PR autonomously. The user decides when the full bundle (PR #162 brand engine + PR A + PR B + PR C audit work) is ready to ship to production. When they give the go-ahead, a single PR from `staging` to `main` carries everything in one release.

**Plan complete.**

---

## Amendments

_(Empty. Any spec changes discovered during execution must be recorded here with date + rationale + affected tasks, per docs/rules/multi-agent-coordination.md.)_

---

## Self-Review Checklist (completed before presenting to user)

1. **Spec coverage** — every one of the 7 user decisions is reflected:
   - ✅ All 11 rules (Task A1)
   - ✅ Manual annotation for `.every` cleanup (Task B5 + `// every-ok` hatch)
   - ✅ Source-sniffing fix in place with case-by-case judgment (Task B4)
   - ✅ CLAUDE.md split (PR C, Tasks C1 + C2)
   - ✅ Nightly full-scan, PR-check stays diff-only in normal CI (Task A2)
   - ✅ PR per phase (PR A / PR B / PR C, strictly sequential)
   - ✅ Roadmap follow-up for docs/rules/*.md audit (Task A4)

2. **Placeholder scan** — searched for "TBD", "TODO", "implement later", "fill in details", "similar to". No hits in the actual task bodies. Appropriate uses only ("details fill out during execution" in the amendments section template).

3. **Type / name consistency** — `Check` type extended once in Task A1 with `rationale` and `claudeMdRef` and `customCheck`; consumed in Task C1 with matching field names. Hatch naming convention (`// <short>-ok`) is used consistently across all 11 rules and the backfill tasks.

4. **Self-review result:** plan is ready for user approval.
