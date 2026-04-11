# Verified-Clean pr-check Rules

> Load-bearing allowlist of rules in `scripts/pr-check.ts` that currently
> report `✓` (zero matches) on a full-repo scan. Enforced by the
> `pr-check --all status parity with allowlist` meta-test in
> `tests/pr-check.test.ts`. See Round 2 Task P1.5 of the
> `2026-04-10-pr-check-audit-and-backfill` plan for the motivation.

---

## Why this file exists

A rule in `scripts/pr-check.ts` can silently fail in four ways:

1. **Category A (file-list)** — `resolveCheckFileList` applies a filter that
   excludes all files before `customCheck` runs, so the callback sees an
   empty array and returns zero hits.
2. **Category B (regex-too-narrow)** — the regex only matches one variant
   (e.g. single quotes) while real violations use the other (double
   quotes).
3. **Category C (parser-lite)** — a hand-rolled string scan (`search(/[{=]/)`,
   brace counting without depth tracking) truncates on a perfectly legal
   syntactic construct.
4. **Category D (shell-quoting)** — a regex with an embedded `"` or a
   lookbehind/lookahead collides with the outer `grep -E "${pattern}"`
   shell invocation. `grep` errors, `|| true` swallows it, the runner
   reports `✓`.

A `✓` in `pr-check --all` output means one of:

- the rule is genuinely finding zero violations (codebase is clean), or
- the rule is silently broken.

This file pins the first case. Every entry is a rule that has been
**manually spot-checked** to confirm its pattern is reachable, its shell
invocation runs without error, and its `✓` reflects a genuinely-clean
codebase.

If a rule moves from `⚠`/`✗` back to `✓` after a backfill, add it here in
the same commit. If a new rule lands at `✓` on day one, either backfill a
fixture that forces a positive match (preferred) or add it here with an
explicit justification.

---

## How to add a rule to this file

1. Run `npx tsx scripts/pr-check.ts --all` and confirm the rule reports `✓`.
2. Run the rule's regex manually against the repo to confirm the shell
   invocation succeeds (no `grep: repetition-operator operand invalid`,
   no `sh: syntax error near unexpected token`, no exit-code-2 errors).
   For customCheck rules, confirm the callback is reachable on a
   representative file (write a minimal trigger and pass it via a
   fixture test).
3. Add an entry to the table below with: rule name (exact), verification
   method (`regex-shell`, `regex-manual`, `customCheck-fixture`,
   `backfill-complete`), and a one-line justification.
4. The P1.5 meta-test will fail until your entry matches the rule name
   exactly — that failure is the gate doing its job.

---

## Allowlist

| Rule Name | Verified By | Justification |
|-----------|-------------|---------------|
| Purple in client components | regex-shell | Simple literal `purple-`; grep succeeds; zero hits in `src/components/client/` confirmed. |
| Forbidden hues (violet/indigo) in components | regex-shell | Pattern `(violet-\|indigo-)`; grep succeeds; zero hits in `src/components/` confirmed via manual grep. |
| Hard-coded studio name | regex-shell | Pattern `hmpsn[ .]studio`; two excludes (`server/constants.ts`, `src/constants.ts`); three excludeLines for SVG alt text; `tests/` dir in EXCLUDED_DIRS so test fixtures don't count; zero hits in scanned dirs. |
| Local prepared statement caching | regex-shell | Literal `let stmt`; grep succeeds; zero hits outside `server/db/`. |
| z.array(z.unknown()) on server | regex-shell | Fully-escaped literal `z\.array\(z\.unknown\(\)\)`; exclude list `server/db/json-validation.ts`; grep succeeds. |
| Bare SUM() without COALESCE in db.prepare | regex-shell | Pattern `(^\|[^(])SUM\(`; standard alternation; grep succeeds; zero hits outside `server/`. |
| as any on dynamic import results | regex-shell | Pattern `(\([a-z]+:\s*any\)\|as any[);,.])`; standard alternation with char class; grep succeeds. |
| Hardcoded dark hex in inline styles | regex-shell | Pattern `style=\{[^}]*(#0f1219\|...)`; brace char class; grep succeeds; only Styleguide.tsx (excluded) would match. |
| SVG with hardcoded dark fill/stroke | regex-shell | Pattern contains `\"` inside outer shell double-quotes; manually confirmed shell escape works (returns 3 Styleguide.tsx matches, all excluded). **Fragile — prefer customCheck if edited.** |
| Direct listPages() outside workspace-data | regex-shell | Literal function name; grep succeeds; workspace-data.ts and webflow-pages.ts are excluded as the only legitimate call sites. |
| Direct buildSeoContext() call | regex-shell | Literal function name; grep succeeds. |
| buildWorkspaceIntelligence() without slices (assembles all 8 slices) | regex-shell | Literal function name; grep succeeds. |
| formatForPrompt with inline sections literal (use buildIntelPrompt or sections: slices) | regex-shell | Literal function name with nested match; grep succeeds. |
| Placeholder test assertion — expect(true).toBe(true) | regex-shell | Fully-escaped literal; grep succeeds; `tests/` pathFilter correctly opted in after the EXCLUDED_DIRS fix. |
| Bare JSON.parse on DB row column | regex-shell | Literal `JSON\.parse\(row\.`; grep succeeds; json-validation.ts and migrate-json.ts are excluded. |
| Unguarded SET status = ? (state machine transition) | regex-shell | Pattern `SET\s+(status\|batch_status)\s*=\s*[?@]`; standard alternation; grep succeeds. |
| Raw bulk_lookup string outside keywords type file | regex-shell | Literal `'bulk_lookup'`; grep succeeds. |
| Raw ai_estimate string in server files | regex-shell | Literal `'ai_estimate'`; grep succeeds. |
| replaceAllPageKeywords called outside keyword-strategy route | regex-shell | Literal function name; grep succeeds. |
| getBacklinksOverview called outside workspace-intelligence | regex-shell | Literal function name; grep succeeds. |
| Silent bare catch in workspace-intelligence assemblers | regex-shell | Pattern `\} catch \{$`; end-anchor; grep succeeds. |
| useGlobalAdminEvents import restriction | customCheck-fixture | P1.1 Round 2 fix — converted to customCheck with dual-quote regex and inline+above-line hatch. 6 fixture tests cover all paths. |
| getOrCreate* function returns nullable | customCheck-fixture | P1.2 Round 2 fix — depth-tracked `findReturnRegionEnd()` walker replaced fragile `.search(/[{=]/)`. 11 fixture tests cover object-literal, Promise, Array, arrow, intersection, and non-null return shapes. |
| Record<string, unknown> in shared/types | regex-shell | Pattern `Record<string,\s*unknown>`; grep succeeds. |
| PATCH spread without nested merge | regex-shell | Pattern `\.\.\.(existing\|current),\s*\.\.\.req\.body([^.\w]\|$)`; standard alternation; grep succeeds. |
| Assembled-but-never-rendered slice fields | customCheck-fixture | customCheck; describe block in tests/pr-check.test.ts. |
| callCreativeAI json-mode consistency | customCheck-fixture | customCheck; describe block in tests/pr-check.test.ts. |
| Brand-engine routes: requireWorkspaceAccess (not requireAuth) | customCheck-fixture | customCheck; describe block in tests/pr-check.test.ts. |
| useEffect external-sync dirty guard against the live prop | customCheck-fixture | customCheck; describe block in tests/pr-check.test.ts. |
| Constants in sync (STUDIO_NAME, STUDIO_URL) | customCheck-fixture | customCheck; describe block in tests/pr-check.test.ts. |

**Count: 30 verified-clean rules.**

---

## What "verified by" means

- **regex-shell** — the rule's regex pattern has been manually invoked via
  `grep -rn ... -E "${pattern}" src/` (or the relevant root) and confirmed
  to produce either the expected matches or a clean zero with no shell
  error. This catches Categories B and D (regex too narrow, shell
  quoting).
- **regex-manual** — the regex was run manually in `node -e` or similar
  to confirm it matches at least one synthetic trigger and rejects at
  least one synthetic negative.
- **customCheck-fixture** — the rule has a `describe('Rule: <name>', ...)`
  block in `tests/pr-check.test.ts` with at least trigger, negative, and
  hatch tests. This is the strongest guarantee — a regression in the
  customCheck callback will be caught by the harness, not by silent
  passage through `pr-check --all`.
- **backfill-complete** — the rule was previously `⚠` with real
  violations, the violations have been fixed, and re-running
  `pr-check --all` shows `✓`. Prefer this over manual spot-checks.

When a rule's verification method changes (e.g., a `regex-shell` rule is
converted to `customCheck`), update the row in the same commit as the
refactor.

---

## Removing a rule

If a rule should no longer report `✓` (e.g., a new backfill item surfaces
violations, or the rule is deleted), remove its row from the table
**before** the commit that causes the state change. The meta-test will
otherwise fail with a mismatch error that points at this file.
