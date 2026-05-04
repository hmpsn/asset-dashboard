# Platform Consolidation Phase 1 - Background Generation Foundation

## Overview

Phase 1 makes the existing background job platform the official contract for long-running admin generation. This phase does not migrate content or keyword generation flows yet; it adds shared job metadata, TaskPanel parity improvements, route guardrails, and tests so Phase 2 migrations have one platform path.

Status: completed on 2026-05-04. Phase 2 migration work remains pending.

## Phase Boundary

Included:

- Shared job type metadata and labels.
- TaskPanel/useBackgroundTasks parity improvements.
- Background-generation guardrail docs.
- A pr-check warning for new synchronous long-running generation routes.
- Tests for metadata, TaskPanel rendering, and guardrail fixtures.

Excluded:

- Migrating content brief/post generation.
- Migrating keyword strategy from SSE to jobs.
- Consolidating schema/page-analysis workers.
- Billing, client data, AI dispatch, provider boundary, or monolith splits.

## Task Dependencies

Sequential:

Task 1 (Guardrails) -> Task 2 (Shared Metadata) -> Task 3 (Frontend Parity) -> Task 4 (pr-check Rule) -> Task 5 (Tests) -> Task 6 (Roadmap/Audit Updates)

No parallel implementation batch is needed because Phase 1 intentionally touches shared contracts and small shared UI surfaces.

## Task 1 - Guardrails

Model: `sonnet`

Owns:

- `CLAUDE.md`
- `docs/rules/background-generation.md`
- This plan

Acceptance:

- Background-generation contract is documented before code changes.
- Phase 1/Phase 2 boundary is explicit.

## Task 2 - Shared Metadata

Model: `sonnet`

Owns:

- `shared/types/background-jobs.ts`
- `server/jobs.ts`

Acceptance:

- All existing job types have labels and cancellation semantics.
- Server default job messages use the shared label.
- Unknown legacy/test job types still work.

## Task 3 - Frontend Parity

Model: `sonnet`

Owns:

- `src/hooks/useBackgroundTasks.tsx`
- `src/components/TaskPanel.tsx`

Acceptance:

- `startJob` uses the shared job type union.
- TaskPanel labels every known central and SEO bulk job type.
- TaskPanel only shows cancel when the job metadata says cancellation is supported.
- Helpers exist for future surfaces to rediscover active jobs by type/workspace.

## Task 4 - pr-check Rule

Model: `sonnet`

Owns:

- `scripts/pr-check.ts`
- `docs/rules/automated-rules.md`

Acceptance:

- New warning rule catches suspicious long-running route handlers outside `/api/jobs`.
- The rule has a `// background-generation-ok` hatch and an allowlist for intentional current exceptions.
- Generated rule docs are updated.

## Task 5 - Tests

Model: `sonnet`

Owns:

- `tests/unit/background-jobs.test.ts`
- `tests/component/TaskPanel.test.tsx`
- `tests/pr-check.test.ts`

Acceptance:

- Metadata test covers labels, known job types, and cancellation semantics.
- TaskPanel test covers labels and non-cancellable jobs.
- pr-check fixtures cover trigger, job-backed negative, allowlisted/hatch negative, and fire-and-forget trigger.

## Task 6 - Roadmap And Audit Updates

Model: `haiku`

Owns:

- `data/roadmap.json`
- `FEATURE_AUDIT.md`
- `docs/superpowers/audits/2026-05-04-platform-consolidation-audit.md`

Acceptance:

- Phase 1 roadmap items are marked done with notes.
- Phase 2 migration items remain pending.
- Feature audit reflects background job contract improvements.

## Verification

```bash
npm run rules:generate
npx tsx scripts/sort-roadmap.ts
npx vitest run tests/unit/background-jobs.test.ts tests/component/TaskPanel.test.tsx tests/pr-check.test.ts --reporter=verbose
npm run typecheck
npx vite build
npx tsx scripts/pr-check.ts
```

Full suite target before PR:

```bash
npx vitest run
```
