# Table Mapper Pattern Review (2026-05-28)

## Scope

Reviewed repeated mapper families across keyword strategy table modules:

- `server/quick-wins.ts`
- `server/keyword-gaps.ts`
- `server/content-gaps.ts`

Patterns reviewed:

- `rowToModel(...)`
- `modelToParams(...)`
- `migrateFromJsonBlob(...)`
- local normalization helpers

## Decision

Keep these mappers **module-local** for now. Do not extract a generic shared mapper layer.

## Rationale

1. The apparent duplication is primarily structural, not semantic. Each module has domain-specific nullable handling, enum normalization, and JSON parsing context.
2. Local mappers keep DB-shape-to-domain mapping explicit and easier to audit during schema changes.
3. Generic abstraction would likely introduce conditional branching and indirection that reduces readability without measurable bug-risk reduction.
4. Existing consistency guardrails already enforce the important parts (`createStmtCache`, JSON parsing helpers, workspace scoping, transactions where needed).

## Extraction Criteria (Future)

Only extract shared mapper utilities if all of the following are true:

1. At least three modules share identical mapping logic (not just similar function names).
2. Extraction removes net branching/complexity in each adopter.
3. The extracted API can remain strongly typed without `any` or lossy generic casts.
4. Existing module tests remain clear and do not need fragile mocks around shared mapping internals.

If those criteria are not met, preserve local mappers.
