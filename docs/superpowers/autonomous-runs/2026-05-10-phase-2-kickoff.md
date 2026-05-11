# Autonomous Run — Client IA Redesign Phase 2

**Date:** 2026-05-10
**Mode:** Autonomous `/loop` (dynamic), self-paced
**Spec:** `docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md`
**Audit:** `docs/superpowers/audits/2026-05-09-client-ia-redesign-audit.md`
**Plan:** `docs/superpowers/plans/2026-05-10-client-ia-redesign-phase2.md`

---

## Scope

Ship these two PRs end-to-end (plan already written — skip to execution):

**Primary (must complete):**
1. **PR 2.1** — Presenter unification: `NormalizedDecision` type + adapters, `<DecisionCard>`, `<DecisionDetailModal>`, InboxTab routing fix
2. **PR 2.2** — At-scale Decisions: type breakdown pills, search bar, grouped collapse (threshold: 25 items)

The implementation plan at `docs/superpowers/plans/2026-05-10-client-ia-redesign-phase2.md` is complete and verified. **Do not re-audit or re-plan.** Go straight to execution.

---

## Skills to Use

| Step | Skill | Notes |
|------|-------|-------|
| Worktree setup | `superpowers:using-git-worktrees` | Required for branch isolation |
| Execution | `superpowers:subagent-driven-development` | Fresh implementer subagent per task, two-stage review per task |
| Parallel batch dispatch | `superpowers:dispatching-parallel-agents` | Tasks 3+4+5 of PR 2.1 run concurrently |
| Scaled review (PR 2.1) | `scaled-code-review` | Required — parallel agents used |
| Code review (PR 2.2) | `superpowers:requesting-code-review` | Single-agent task, 2 files |
| Codex review (both PRs) | Codex CLI | Independent second opinion on each draft PR |
| Multi-failure investigation | `superpowers:dispatching-parallel-agents` | If CI surfaces 3+ unrelated failures, dispatch one investigator per failure |

---

## Per-PR Workflow

Each PR follows this exact sequence. Do not skip steps.

1. **Worktree setup** — create new worktree from `staging` for this PR
2. **Execute plan tasks** — use `superpowers:subagent-driven-development` with the plan at `docs/superpowers/plans/2026-05-10-client-ia-redesign-phase2.md`:
   - PR 2.1 tasks: 1, 2 (parallel) → 3, 4, 5 (parallel after commit) → diff-review checkpoint → 6, 7
   - PR 2.2 tasks: 8 (sequential, after PR 2.1 merged)
   - Fresh implementer subagent per task; two-stage review (spec compliance → code quality) before next task
3. **Local verification gate** — `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts` — ALL green. Fix and re-run until clean.
4. **Scaled code review** (PR 2.1) or **requesting-code-review** (PR 2.2) — fix all Critical and Important findings before opening PR
5. **Open draft PR** to `staging` — `gh pr create --draft`
6. **Codex CLI independent review** — `codex "Review the open draft PR for [branch]. Focus on: [key routing logic / state management for this PR]. CLAUDE.md is the project convention doc (.codex/config.toml points there)."` — fix all Critical and Important findings, push to draft PR
7. **Mark PR ready** — `gh pr ready` — only after both reviews clean
8. **Wait for staging CI** — green required before merge
9. **Merge to staging** — `gh pr merge --squash`
10. **Move to next PR** — PR 2.2 only starts after PR 2.1 is merged

---

## Branching Strategy

```
PR 2.1:  new worktree from staging, branch: feat/ia-presenter-unification
PR 2.2:  new worktree from staging (after 2.1 merges), branch: feat/ia-at-scale-decisions
```

---

## Parallel Execution Details for PR 2.1

The plan's task dependency graph:

```
Tasks 1 + 2  →  commit shared types  →  Tasks 3 ∥ 4 ∥ 5  →  diff-review checkpoint  →  Task 6  →  Task 7
```

When dispatching Tasks 3, 4, 5 in parallel via `superpowers:dispatching-parallel-agents`:
- **Task 3** owns: `src/lib/decision-adapters.ts`, `tests/unit/decision-adapters.test.ts`
- **Task 4** owns: `src/components/client/DecisionCard.tsx`, `tests/unit/DecisionCard.test.tsx`
- **Task 5** owns: `src/components/client/DecisionDetailModal.tsx`, `tests/unit/DecisionDetailModal.test.tsx`

Run diff-review checkpoint after all three return before dispatching Task 6.

---

## Fix-and-Continue Policy

**The default is: figure out what's wrong, fix it, keep moving.** Do not halt on every failure.

| Failure | Action |
|---------|--------|
| `pr-check` error | Read error, fix the violation, re-run |
| Test failure | Read failure, diagnose, fix code OR fix test (only if test was wrong), re-run |
| `typecheck` error | Read error, fix types, re-run |
| Build error | Read error, fix, re-run |
| CI failure with debuggable logs | Investigate, fix, re-run |
| Codex finding (non-critical) | Apply suggested fix, re-request review |
| Subagent DONE_WITH_CONCERNS | Address concerns, re-dispatch |
| Subagent NEEDS_CONTEXT | Provide context, re-dispatch |
| Subagent BLOCKED | Try once with stronger model; if still blocked, escalate |

### Halt and surface (only when genuinely stuck)

| Condition | Why halt |
|-----------|----------|
| Same failure persists after 3 fix attempts | Risk of infinite thrash |
| Codex flags a critical security or data integrity issue | Cannot self-resolve |
| Approval endpoint (`PATCH /api/public/approvals/:wsId/:batchId/approve`) does not exist | Architectural gap — requires human decision on whether to build it or stub it |
| Test suite regression: previously-passing test now fails AND fixing it would mask a real bug | Cannot self-resolve safely |

When halting: write a summary to `docs/superpowers/autonomous-runs/2026-05-10-halt-phase2-<timestamp>.md`, push notification, exit gracefully.

---

## Push Notifications

Notify on:
- ✅ Each PR opened (draft)
- ✅ Each PR un-drafted (reviews clean)
- ✅ Each PR merged to staging
- 🛑 Any halt condition triggered
- 🎉 Both PRs merged to staging

---

## Time Bound

Hard cap: **6 hours** from loop start. If not done by then, complete the in-flight task, commit progress, and write a wake-up summary regardless of remaining queue.

---

## Reference Documents

Read these once at start:

- `docs/superpowers/plans/2026-05-10-client-ia-redesign-phase2.md` — the complete task list (already written and verified)
- `docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md` — routing rules and interaction spec
- `CLAUDE.md` — project conventions, design system, quality gates
- `docs/PLAN_WRITING_GUIDE.md` — parallel dispatch rules and verification steps
- `docs/rules/multi-agent-coordination.md` — file ownership and diff-review protocol

---

## Wake-Up Summary

When the loop completes or halts, write a summary to `docs/superpowers/autonomous-runs/2026-05-10-wakeup-summary-phase2.md` with:

- Each PR's status (draft opened, reviews clean, merged to staging, blocked, not started)
- Links to each PR
- Any halt reasons with paths to halt-summary docs
- Failures encountered and how they were resolved
- What's left for the human (typically: flip `client-wins-surface` and `new-inbox-ia` flags on staging to verify UX, then merge staging → main)
