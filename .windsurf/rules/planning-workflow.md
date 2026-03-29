# Planning Workflow — Spec → Audit → Plan → Execute

## The Flow

```
brainstorming → spec → pre-plan-audit → writing-plans → execution
```

The `pre-plan-audit` skill is the bridge between brainstorming and writing-plans. It exists because plans written from memory or spot-checks consistently miss 50-70% of affected files.

## When to Use pre-plan-audit

**Always use for:**
- Refactoring or migration work (changing patterns across many files)
- Audit work (finding and fixing all instances of something)
- Any task where the spec says "all," "every," or "throughout the codebase"

**Skip for:**
- New feature work where you're creating new files (no existing codebase to audit)
- Bug fixes in a single file
- Documentation-only changes

## What pre-plan-audit Produces

1. **Exhaustive findings table** — every file, line, value, and category
2. **Coverage verification** — which existing mechanisms already handle which findings
3. **Infrastructure recommendations** — shared utilities, pr-check rules, test coverage
4. **Parallelization strategy** — dependency graph and model assignments

## Plan Requirements (from CLAUDE.md)

Every implementation plan must include:
- Parallelization strategy with dependency graph
- Model assignments (Haiku/Sonnet/Opus) per task
- Systemic improvements section (shared utilities, pr-check, tests)
- Verification strategy (preview screenshots, specific commands)
