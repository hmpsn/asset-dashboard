# Pre-Commit Hooks (husky) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce typecheck + pr-check on every commit so broken code never reaches a push.

**Architecture:** Husky v9 installs a git pre-commit hook via a `prepare` script. The hook runs project-wide gates (typecheck, pr-check) and a fast changed-files-only test pass via `vitest run --changed`. No lint-staged — there are no per-file formatters/linters configured yet. When eslint/prettier are added later, lint-staged can be layered on top of the existing husky setup.

**Tech Stack:** husky 9, existing npm scripts

**Not applicable (infrastructure change):** FEATURE_AUDIT.md, BRAND_DESIGN_LANGUAGE.md, data/features.json. Will add to data/roadmap.json if a roadmap item is created.

---

## Pre-requisites

- [ ] No spec needed (self-contained infrastructure)
- [ ] No pre-plan audit needed (new files only, no codebase-wide refactor)

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Add husky devDependency, `prepare` script |
| `.husky/pre-commit` | Create | Shell script running project-wide gates |
| `.github/workflows/ci.yml` | No change | CI already runs the same gates; hooks catch issues earlier |

---

## Task Dependencies

```
Sequential:
  Task 1 (Install + configure) → Task 2 (Test the hook) → Task 3 (Code review + commit)
```

All tasks are single-agent, sequential. Model: **sonnet** (straightforward config, no judgment calls).

**File ownership (single-agent, but documented for completeness):**
- **Owns:** `package.json` (scripts + devDependencies only), `.husky/pre-commit`
- **Must not touch:** `.github/workflows/ci.yml`, `vite.config.ts`, any `server/` or `src/` files

---

### Task 1: Install husky and configure the hook (Model: sonnet)

**Files:**
- Modify: `package.json` (devDependencies, scripts)
- Create: `.husky/pre-commit`

- [ ] **Step 1: Install husky**

```bash
npm install --save-dev husky
```

- [ ] **Step 2: Initialize husky**

```bash
npx husky init
```

This does three things: (a) adds `"prepare": "husky"` to `package.json` scripts, (b) creates the `.husky/` directory, (c) writes `.husky/pre-commit` with default content `npm test`. We overwrite the pre-commit file in the next step.

**Note:** `husky init` also creates `.husky/_/` with internal wiring files. This directory has its own `.gitignore` and is NOT committed — only `.husky/pre-commit` is committed.

- [ ] **Step 3: Write the pre-commit hook**

Overwrite `.husky/pre-commit` (created by `husky init` in Step 2) with:

```bash
# Project-wide gates — these check the full project, not just staged files.
# typecheck: ~5-10s, pr-check: ~3-5s (diffs against remote branch)
npm run typecheck
npm run pr-check

# Run only tests affected by staged changes (fast subset of full 35s suite).
# Full suite runs in CI; this catches the obvious local regressions.
# Exits 0 cleanly when no test files are affected by the changes.
npx vitest run --changed HEAD
```

The file does NOT need `chmod +x` — husky v9 sources it via `sh -e`, not direct execution.

- [ ] **Step 4: Verify package.json changes look correct**

```bash
node -e "const p=require('./package.json'); console.log('prepare:', p.scripts.prepare); console.log('husky in devDeps:', !!p.devDependencies.husky)"
```

Expected:
```
prepare: husky
husky in devDeps: true
```

---

### Task 2: Test the hook end-to-end (Model: sonnet)

**Files:** None (verification only)

- [ ] **Step 1: Verify the hook fires on a clean commit**

Stage and commit the plan file itself:

```bash
git add docs/superpowers/plans/2026-04-11-pre-commit-hooks.md
git commit -m "test: verify pre-commit hook fires"
```

Expected: typecheck, pr-check, and vitest --changed all run and pass. The commit succeeds.

- [ ] **Step 2: Verify a type error blocks the commit**

Temporarily introduce a type error (this is intentionally destructive as part of the test procedure):

```bash
echo "const x: number = 'not a number';" >> server/constants.ts
git add server/constants.ts
git commit -m "test: this should fail"
```

Expected: `npm run typecheck` fails, commit is rejected.

Clean up the intentional type error:

```bash
git restore server/constants.ts
```

- [ ] **Step 3: Undo the test commit**

Reset the test commit from Step 1 (the hook files are still in the working tree, just unstaged):

```bash
git reset --soft HEAD~1
```

The hook setup files remain staged and ready for the real commit in Task 3.

---

### Task 3: Code review + commit (Model: sonnet)

**Files:** All files from Task 1

- [ ] **Step 1: Run the full quality gate**

```bash
npm run typecheck && npx vite build && npm run pr-check
```

- [ ] **Step 2: Run code review**

Invoke `superpowers:requesting-code-review` (single-domain, <10 files). Fix any Critical or Important issues before proceeding. Per CLAUDE.md: "All bugs surfaced during review are fixed — never dismiss a fixable bug."

- [ ] **Step 3: Stage and commit**

```bash
git add package.json package-lock.json .husky/pre-commit
git commit -m "chore(dx): add pre-commit hooks (husky + typecheck + pr-check + vitest --changed)"
```

The pre-commit hook runs on this commit itself — which validates the setup is working.

---

## Systemic Improvements

- **Shared utilities:** None needed — uses existing npm scripts.
- **pr-check rules:** None needed — the hook invokes pr-check as-is.
- **New tests:** The hook is tested manually in Task 2. No vitest test needed for shell hook wiring.
- **Future:** When eslint/prettier are added, install lint-staged and add `npx lint-staged` as the first line of `.husky/pre-commit`. The husky wiring is already in place.

## Verification Strategy

- [ ] `git commit` on a clean change succeeds (typecheck + pr-check + vitest --changed all pass)
- [ ] `git commit` on a type-error change is rejected by typecheck
- [ ] `.husky/pre-commit` exists in the repo
- [ ] `npm install` in a fresh clone runs `husky` via the `prepare` script (sets up hooks automatically)
- [ ] CI still passes (no change to ci.yml)

## Notes

- **Skipping hooks:** `git commit --no-verify` bypasses the hook. CLAUDE.md says "Never skip hooks" — this is enforced by convention, not code. If a hook is wrong, fix the hook.
- **Performance:** typecheck ~5-10s + pr-check ~3-5s + vitest --changed ~2-5s = ~10-20s per commit depending on machine. Acceptable for the bug-prevention ROI. `npm test` (full suite, 35s) is NOT run in the hook — that stays in CI.
- **pr-check scope:** `pr-check` diffs against `origin/staging` or `origin/main`, so it checks all files changed on the branch, not just the staged files in this commit. This is intentional — it catches violations introduced earlier on the branch that weren't caught.
- **Fresh clone behavior:** `npm install` triggers the `prepare` script, which runs `husky`. This sets up `.husky/_/` (the internal hook wiring). New team members get hooks automatically — no manual setup needed.
- **husky v9 internals:** `.husky/_/` contains husky's internal scripts and is auto-gitignored. Only `.husky/pre-commit` (user-authored) is committed.
