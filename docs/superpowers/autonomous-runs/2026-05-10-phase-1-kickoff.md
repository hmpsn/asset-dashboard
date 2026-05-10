# Autonomous Run — Client IA Redesign Phase 1

**Date:** 2026-05-10
**Mode:** Autonomous `/loop` (dynamic), unsupervised overnight
**Spec:** `docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md`
**Audit:** `docs/superpowers/audits/2026-05-09-client-ia-redesign-audit.md`

---

## Tonight's Scope

Ship these PRs end-to-end (spec → audit → plan → execute → review → CI → staging → main):

**Primary (must complete):**
1. **PR 1.0a** — Retire `feedback` table
2. **PR 1.0b** — Deprecate `keyword_strategy` client_action
3. **PR 1.1** — Shared contracts (types, migrations, route alias updates, AeoChangeDiff payload enrichment, ClientRequestStatus mapping)

**Stretch (if time and energy permit):**
4. **PR 1.4** — Platform "Send to client" optional-note convention across 13 admin components
5. **PR 1.5** — Prevention pr-check rules + doc updates

**Explicitly held for human review (DO NOT ship overnight):**
- **PR 1.2** — Inbox restructure (high UX blast radius, behind feature flag)
- **PR 1.3** — Insights / Wins surface (new component, behind feature flag)

These two require visual UX validation on staging before production rollout. Land their groundwork (specs and plans) if time permits, but stop short of opening their PRs.

---

## Skills to Use

The loop should treat these skills as the canonical execution methods. Do not improvise — use the skill where it applies:

| Step | Skill | Notes |
|------|-------|-------|
| Worktree setup | `superpowers:using-git-worktrees` | Required for branch isolation |
| Pre-plan audit | `pre-plan-audit` | Use `superpowers:dispatching-parallel-agents` to run multiple Explore agents concurrently for speed (the main audit pattern proved this works) |
| Implementation plan | `superpowers:writing-plans` | TDD-disciplined task list |
| Execution | `superpowers:subagent-driven-development` | The user's preferred workflow — fresh implementer subagent per task with mandatory two-stage review (spec compliance → code quality) |
| Scaled review | `scaled-code-review` | Multi-agent review on the open PR diff |
| Codex review | (gh CLI) | Independent second opinion on the same PR |
| Multi-failure investigation | `superpowers:dispatching-parallel-agents` | If a PR's CI surfaces 3+ unrelated failures (e.g. different test files, different subsystems), dispatch one investigator agent per failure rather than serializing |
| Test discipline within tasks | `superpowers:test-driven-development` | Implicit in subagent-driven-development; do not skip |

## Per-PR Workflow

Each PR follows this exact sequence. Do not skip steps.

1. **Worktree setup** — create new worktree from `staging` for this PR (per `superpowers:using-git-worktrees`)
2. **Implementation spec** — small, scoped to this PR only (≤ 200 lines), saved to `docs/superpowers/specs/2026-05-10-pr-<number>-<slug>-design.md`
3. **Targeted pre-plan audit** — use `pre-plan-audit` skill scoped to just this PR's surface area, dispatching parallel Explore agents via `superpowers:dispatching-parallel-agents` for speed; save to `docs/superpowers/audits/2026-05-10-pr-<number>-<slug>-audit.md`
4. **Implementation plan** — use `superpowers:writing-plans` to produce a TDD-disciplined task list; save to `docs/superpowers/plans/2026-05-10-pr-<number>-<slug>-plan.md`
5. **Execute** — use `superpowers:subagent-driven-development` (the user's preferred workflow):
   - Fresh implementer subagent per task
   - Two-stage review per task (spec compliance → code quality)
   - Re-review until clean before next task
6. **Local verification gate** — `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts` — ALL green, no warnings. Fix and re-run until clean.
7. **Open PR as DRAFT** to `staging` branch (the PR is the artifact for all subsequent review)
8. **Scaled code review** — run `scaled-code-review` skill against the open PR diff (uses git SHAs from the PR). Capture all findings.
9. **Codex independent review** — request Codex review on the same draft PR. Capture all findings.
10. **Address findings** — fix every Critical and Important finding from BOTH reviews. Push fix commits to the PR. Re-run local verification gate. If significant changes (>20 lines), re-request scaled-review and Codex review on the updated diff.
11. **Mark PR ready for review** (un-draft) once all Critical/Important findings resolved
12. **Wait for staging CI** — green required
13. **Wait for staging deploy + smoke test** — curl any endpoints touched by this PR, verify response shape
14. **Merge to main** if all green (use squash or merge commit per project convention)
15. **Wait for main CI** to confirm production deploy succeeds
16. **Move to next PR** — only after this one is fully merged to main with green CI

---

## Fix-and-Continue Policy

**The default is: figure out what's wrong, fix it, keep moving.** Do not halt the loop on every failure.

### Fix-and-continue (try up to 3 attempts per failure)

If multiple unrelated failures surface at once (e.g. 3 test files in 3 different subsystems), use `superpowers:dispatching-parallel-agents` to investigate in parallel rather than serializing.

| Failure | Action |
|---------|--------|
| `pr-check` error | Read error, fix the violation, re-run |
| Test failure | Read failure, diagnose, fix code OR fix test (only if test was wrong), re-run |
| `typecheck` error | Read error, fix types, re-run |
| Build error | Read error, fix, re-run |
| CI failure with debuggable logs | Investigate, fix, re-run |
| Codex review finding (non-critical) | Apply suggested fix, re-request review |
| Lint warning | Fix per project conventions |
| Subagent returns DONE_WITH_CONCERNS | Read concerns, address each, re-dispatch implementer subagent |
| Subagent returns NEEDS_CONTEXT | Provide missing context, re-dispatch |
| Subagent returns BLOCKED | Try once with more context or stronger model; if still blocked, escalate per below |

### Lean on Codex for second opinions

When stuck on diagnosis or unsure whether a fix is right:
- Open a draft PR with the proposed fix
- Request Codex review explicitly: "I'm uncertain about [X]. Please verify whether [proposed approach] is correct."
- Apply Codex's recommendation if it gives a clear answer
- If Codex is also uncertain, escalate per below

### Halt and surface (only when genuinely stuck)

| Condition | Why halt |
|-----------|----------|
| Same failure persists after 3 fix attempts | Risk of infinite thrash |
| Architectural ambiguity not covered by spec or audit | Requires human judgment, not bug-fixing |
| Codex flags a **critical** security or data integrity issue | Cannot self-resolve |
| Migration would risk data loss with unclear recovery path | Cannot self-resolve |
| Production deploy fails after merge to main | Real users affected — requires human triage |
| Test suite regression: a previously-passing test now fails AND fixing it would mask a real bug | Cannot self-resolve safely |

When halting: write a halt summary to `docs/superpowers/autonomous-runs/2026-05-10-halt-<timestamp>.md` with full context, push notification, exit gracefully.

---

## Push Notifications

Push notify (via available notification mechanism — gh notify, system notification, etc.) on:

- ✅ Each PR opened
- ✅ Each PR merged to staging
- ✅ Each PR merged to main
- 🛑 Any halt condition triggered
- 🎉 Final completion (all primary PRs done)

Notifications should be brief: "PR 1.0a opened: <URL>" or "Halted on PR 1.1: <reason>, see <halt-summary-path>."

---

## Time Bound

Hard cap: **8 hours** from loop start. If not done by then, complete the in-flight PR and stop with summary regardless of remaining queue.

---

## Reference Documents

The loop should read these once at start and treat them as authoritative:

- `docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md` — IA decisions and routing rules
- `docs/superpowers/audits/2026-05-09-client-ia-redesign-audit.md` — file-level inventory and risk areas
- `CLAUDE.md` — project conventions, design system, data flow rules, quality gates
- `docs/PLAN_WRITING_GUIDE.md` — implementation plan structure
- `docs/rules/multi-agent-coordination.md` — parallel agent rules
- `docs/rules/automated-rules.md` — pr-check rules currently enforced
- `docs/workflows/deploy.md` — staging → main flow
- `docs/workflows/feature-shipped.md` — post-ship checklist (FEATURE_AUDIT.md, roadmap.json, etc.)

---

## Branching Strategy

Each PR uses its own worktree branched from `staging`:

```
PR 1.0a:  worktree at .claude/worktrees/feedback-retirement/  branch: feat/feedback-retirement
PR 1.0b:  worktree at .claude/worktrees/keyword-strategy-deprecation/  branch: feat/keyword-strategy-deprecation
PR 1.1:   worktree at .claude/worktrees/ia-shared-contracts/  branch: feat/ia-shared-contracts
PR 1.4:   worktree at .claude/worktrees/send-to-client-convention/  branch: feat/send-to-client-convention
PR 1.5:   worktree at .claude/worktrees/ia-prevention-rules/  branch: feat/ia-prevention-rules
```

PRs 1.0a and 1.0b are independent — could ship in either order. Treat them sequentially overnight to keep the loop simple. PR 1.1 must merge before any of 1.4 (and tomorrow's 1.2/1.3) can begin — 1.4 depends on the AeoChangeDiff type changes from 1.1.

---

## Wake-Up Summary Document

When the loop completes (or halts), write a wake-up summary to `docs/superpowers/autonomous-runs/2026-05-10-wakeup-summary.md` with:

- Each PR's status (opened, merged to staging, merged to main, blocked, not started)
- Links to each PR
- Any halt reasons with paths to halt-summary docs
- Failures encountered and how they were resolved
- What's left for the human to do (typically: review and flip feature flags for 1.2/1.3 once those land)

This is what the user will read first thing in the morning.
