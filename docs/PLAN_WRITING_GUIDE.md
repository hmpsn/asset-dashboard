# Plan Writing Guide

> Single reference for writing implementation plans on this project. Read this before opening a plan file.

---

## The Flow

```
brainstorming  →  spec  →  pre-plan-audit  →  writing-plans  →  execution
```

Every plan goes through this sequence. The skills are:
- `superpowers:brainstorming` — divergent ideation, produces a spec
- `superpowers:writing-plans` — structured plan from a spec
- `superpowers:executing-plans` — dispatches subagents, runs checkpoints
- `superpowers:subagent-driven-development` — single-session parallel execution

---

## Step 1: Pre-Plan Audit (when required)

Run the `pre-plan-audit` skill **before writing-plans** for:
- Refactoring or migration work (changing patterns across many files)
- Audit work (finding and fixing all instances of something)
- Any task where the spec says "all", "every", or "throughout the codebase"

**Skip for:** new feature work creating new files, single-file bug fixes, docs-only changes.

**What it produces:**
1. Exhaustive findings table — every affected file, line, value, category
2. Coverage verification — which existing mechanisms already handle which findings
3. Infrastructure recommendations — shared utilities, pr-check rules, test coverage gaps
4. Parallelization strategy — dependency graph + model assignments

Plans written without a pre-plan audit miss 50–70% of affected files. Don't skip it for applicable tasks.

---

## Step 2: Every Plan Must Contain

### 1. Task dependency graph

Explicit sequential and parallel task ordering. "Obviously sequential" is not acceptable — dispatchers don't infer dependencies.

```
## Task Dependencies

Sequential (must run in order):
  Task 1 (Migration) → Task 2 (Shared Types) → Task 3+ (Services)

Parallel after Task 2:
  Task 3 (Service A)  ∥  Task 4 (Service B)  ∥  Task 5 (Service C)

Sequential shared-file tasks (after parallel batch):
  Task 7 (seo-context.ts additions)
  Task 8 (app.ts route registration)

Parallel after Task 8:
  Task 9 (Frontend Tab A)  ∥  Task 10 (Frontend Tab B)
```

Rules for the graph:
- Any task that creates a file another task imports from is a sequential dependency
- Any task that modifies a shared file (`app.ts`, `seo-context.ts`, barrel exports) is sequential
- Backend services owning different files can be parallel
- Frontend components modifying different files can be parallel

### 2. Model assignments per task

Use the least capable model that can handle the task:

| Task type | Model | Signal |
|-----------|-------|--------|
| Migration SQL, shared types from spec, route boilerplate, API client wrappers | `haiku` | Pure transcription — no judgment calls |
| Service/CRUD layers, React components, tasks with edge-case awareness | `sonnet` | Pattern-following with local judgment |
| Prompt engineering, brand context logic, complex shared components, auto-summarization | `opus` | Creative judgment or high reuse surface |
| Spec compliance reviewer | `opus` | Review quality scales with model capability |
| Code quality reviewer | `opus` | Never downgrade reviewers |

### 3. File ownership declarations

Every parallel task must list what it owns and must not touch:

```
## File Ownership — Task 3

Files you OWN (create or modify freely):
- server/brandscript.ts
- server/routes/brandscript.ts
- src/components/brand/BrandscriptTab.tsx

Files you may READ but must NOT modify:
- shared/types/brand-engine.ts (owned by Task 2)
- server/app.ts (sequential task, handled after this batch)

If you need to change a file not on your ownership list, STOP and report
back with status NEEDS_CONTEXT. Do not modify files outside your ownership.
```

### 4. Cross-phase contracts (multi-phase features only)

A companion guardrails doc listing what each phase exports for downstream:

```markdown
## Phase 1 → Phase 2 Contracts

### Database Tables (Phase 2 reads from)
- brandscripts, brandscript_sections

### Exported Functions (Phase 2 calls)
- buildBrandscriptContext(workspaceId, emphasis?) → string

### Shared Types (Phase 2 imports)
- Brandscript, VoiceProfile from shared/types/brand-engine.ts
```

This document lives alongside the plans and gets updated as phases complete.

### 5. Systemic improvements section

Every plan must include:
- **Shared utilities to extract** — if 3+ files do the same fix, extract a helper
- **pr-check rules to add** — to prevent the same class of bug recurring
- **Test coverage additions** — what new tests this plan requires

### 6. Verification strategy

Specify *how* to verify each phase, not just "manual verification":
- Preview screenshots for UI changes
- Specific `npx vitest run --reporter=verbose` test commands
- `curl` commands for API endpoints
- Contrast or color checks for design work

---

## Step 3: Parallel Agent Dispatch Rules

When dispatching subagents in parallel, these rules are mandatory. Full detail: `docs/rules/multi-agent-coordination.md`.

**Pre-commit shared contracts first.** Before any agent starts, commit all shared artifacts:
- Shared types (`shared/types/`)
- Exported function signatures
- Barrel exports (index files)
- Migration files
- Constants and enums

Agents read from committed code, never from each other's working state.

**Diff review after every parallel batch.** Before dispatching the next batch:
1. `git diff` — review all modified files
2. Grep for duplicate imports in files touched by multiple agents
3. Check for conflicting edits (two agents adding the same function differently)
4. `npx tsc --noEmit --skipLibCheck` — catch type contract mismatches
5. `npx vitest run` — full suite, not just new tests

**Implementer dispatch prompts must include:**
- Full task text
- File ownership list (owns / must not touch)
- Relevant cross-phase contracts (what to import, not recreate)
- Relevant CLAUDE.md conventions for the task (e.g., `createStmtCache` pattern, `parseJsonSafe` for DB columns)
- Known gotchas (e.g., literal routes before param routes in Express)
- Model assignment

---

## Step 4: Pre-Commit Checklist (STOP before claiming done)

These gates must all pass before a PR is opened:

```
[ ] npx tsc --noEmit --skipLibCheck         — zero type errors
[ ] npx vite build                           — production build succeeds
[ ] npx vitest run                           — full test suite green (not just new tests)
[ ] npx tsx scripts/pr-check.ts             — zero violations
[ ] FEATURE_AUDIT.md updated                — new features documented
[ ] data/roadmap.json updated               — items marked done with notes
[ ] BRAND_DESIGN_LANGUAGE.md updated       — if any UI colors/patterns changed
[ ] No violet or indigo in src/components/ — grep to confirm
[ ] Code review invoked:
    - 10+ files changed → superpowers:scaled-code-review
    - Single task      → superpowers:requesting-code-review
[ ] All bugs surfaced during review fixed  — never defer a fixable bug
[ ] If multi-phase: this PR = exactly one phase. Phase N+1 not started until N is merged + green.
```

**Staging gate:** All PRs merge to `staging` first. Only after staging verification does `staging` → `main`.

See `docs/workflows/deploy.md` for the full branch model and deploy steps.

---

## Step 5: Testing Patterns

- **Write tests alongside code** — new routes get integration tests, new state transitions get guard tests
- **Infrastructure:** mock factories in `tests/mocks/`, seed fixtures in `tests/fixtures/`, HTTP helper `createTestContext(port)` in `tests/integration/helpers.ts`
- **Port uniqueness** — each integration test file needs a unique port. Check existing range: `grep -r 'createTestContext(' tests/`. Current range: 13201–13316.
- **External API error tests** — mock the API to return an error, assert the operation records `failed`/`error` status (FM-2 pattern)
- **Cleanup** — every `beforeAll` resource creation must have a matching `afterAll` cleanup. Use `seedWorkspace().cleanup()` or `deleteWorkspace(id)`. Never leave orphaned test data.
- **Collection assertions** — never assert `.every()` or `.some()` on a potentially empty array without first asserting `length > 0`. `[].every(fn)` returns `true` vacuously.

---

## Quick Reference: Wiring Patterns

Before writing any plan that touches data flow, read `docs/workflows/wiring-patterns.md`.  
It covers 12 canonical patterns: chat endpoints, strategy generation, content briefs, monthly reports, proactive insights, custom date ranges, activity logging, auth, anomaly detection, multi-modal chat, WebSocket broadcasts, email notifications.

For client-feature placement (which tab, which narrative arc): `docs/workflows/feature-integration.md`.

---

## What Goes in a Plan File

```markdown
# [Feature Name] — Implementation Plan

## Overview
One paragraph: what this implements and why.

## Pre-requisites
- [ ] Spec committed: docs/superpowers/specs/[file].md
- [ ] Pre-plan audit complete (if applicable): docs/superpowers/audits/[file].md
- [ ] Shared contracts committed (for parallel work)

## Task List

### Task 1 — [Name] (Model: haiku | sonnet | opus)
**Owns:** [files]
**Must not touch:** [files]
Steps...

### Task 2 — ...

## Task Dependencies
[dependency graph]

## Cross-Phase Contracts (if multi-phase)
[what this phase exports for downstream phases]

## Systemic Improvements
- Shared utilities: ...
- pr-check rules to add: ...
- New tests required: ...

## Verification Strategy
- [ ] [specific command or screenshot check]
```
