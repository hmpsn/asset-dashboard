# Audit Drift Closure — Plan B: AI Output Validation + Missing Broadcast/Activity Wiring

> Source: Audit artifact [2026-05-27-audit-drift-closure.md](../audits/2026-05-27-audit-drift-closure.md) (four parallel Explore agents + verification pass)
> Sprint: `sprint-platform-health-wave8-audit-drift-closure`
> Platform: Claude/Anthropic
> Scope: Add Zod validation to 4 AI structured-output callers and wire `broadcastToWorkspace` + `addActivity` into 3 mutation route files that silently skip both. Independent of Plan A and Plan C; can run in parallel.

## Overview

Two unrelated correctness failures bundled because they share patterns (boundary-validation rules) and reviewers:

1. Four AI callers parse JSON without Zod validation. If the prompt drifts or the model returns a different shape, silent runtime garbage propagates. Worst offender (`server/content-brief.ts:1020`) uses the exact "guessed field-name fallback" anti-pattern called out in CLAUDE.md (`outlineParsed.outline ?? outlineParsed.sections`).
2. Three workspace-scoped mutation route files perform writes without broadcasting or logging activity. The frontend never invalidates, the activity log never sees the change, and any feature that should react via `useWorkspaceEvents` is silently broken.

Both are mechanizable: when finished, add a pr-check rule for each pattern so they cannot reopen.

## Pre-requisites

- [x] Roadmap items added
- [ ] Branch: `audit-drift-closure-plan-b` cut from latest `staging`
- [ ] Plan A Task 1 (auth) ideally merged first — not a hard dependency, but reviewers will want security to land before AI validation churn.

## Bounded Context Ownership

| Concern | Owner | Secondary |
|---|---|---|
| AI operation contracts | `server/ai-operation-registry.ts` + per-caller schema | `docs/rules/ai-operation-contracts.md` |
| Content-brief generation | `server/content-brief.ts` | `server/routes/content-briefs.ts` |
| AEO page review | `server/aeo-page-review.ts` | `server/routes/aeo-page-review.ts` |
| Diagnostic orchestration | `server/diagnostic-orchestrator.ts` | `server/routes/diagnostic.ts` |
| Schema planning | `server/schema-plan.ts` | `server/routes/schema.ts` |
| Client actions wiring | `server/routes/client-actions.ts` | `server/ws-events.ts`, `src/hooks/client/useClientActions.ts` |
| Keyword command center wiring | `server/routes/keyword-command-center.ts` | `server/ws-events.ts`, `src/hooks/admin/useKeywordCommandCenter.ts` |
| Anomalies wiring | `server/routes/anomalies.ts` | `server/ws-events.ts` |

---

## Task List

### Task 1 — Shared AI schema scaffolding (Platform: Claude/Anthropic; Model: Haiku)

**Owns:**
- `server/schemas/ai-content-brief.ts` (new — `aiContentBriefOutlineSchema`)
- `server/schemas/ai-aeo-review.ts` (new)
- `server/schemas/ai-diagnostic.ts` (new — `aiRootCauseAnalysisSchema`)
- `server/schemas/ai-schema-plan.ts` (new)
- `server/ai-operation-registry.ts` (register 4 new operations)

**Must not touch:** The caller files (handled in Tasks 2–5).

**Steps:**
1. For each of the four callers, read the producing prompt to derive the expected output shape. Write a Zod schema that accepts what the model actually returns (use existing parsed payloads in tests/fixtures if present). Each schema must have `.strict()` semantics — fail closed.
2. Register four named operations in `server/ai-operation-registry.ts`: `content-brief-outline`, `aeo-page-review`, `diagnostic-root-causes`, `schema-plan-generate`. Each entry references its schema and the canonical model.
3. Export `parseContentBriefOutline`, `parseAeoReview`, `parseDiagnosticRootCauses`, `parseSchemaPlan` thin wrappers from each schema file that wrap `parseAIJson()` and run the schema; throw a typed error on mismatch.

**Verification:**
```
npx vitest run tests/unit/ai-operation-registry.test.ts
```

---

### Task 2 — Migrate `server/content-brief.ts` to validated path (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/content-brief.ts` (lines 38, 1017, 1020-1021)
- `tests/unit/content-brief-ai-contract.test.ts` (new)

**Must not touch:** Schema files (Task 1 owns them), other AI callers.

**Steps:**
1. **Delete the local `parseAiJson` function at `server/content-brief.ts:35`** — it is a lowercase-named, context-tagging wrapper distinct from the canonical `parseAIJson` (uppercase) in `server/openai-helpers.ts:505`. Two parsers with near-identical names is exactly the drift this plan exists to close.
2. Replace the three local-`parseAiJson` call sites at lines 889, 1017, and 1480 with the new typed `parseContentBriefOutline(rawText)` / `parseContentBriefSchema(rawText)` wrappers from Task 1. Each Task 1 wrapper internally uses canonical `parseAIJson` followed by Zod validation.
3. **Remove the guessed-field-name fallback** at lines 1020-1022 (`(outlineParsed as Record<string,unknown>).outline ?? (outlineParsed as Record<string,unknown>).sections ?? []`). The schema now decides the canonical field name; aliases that the schema doesn't accept are a prompt drift, not a fallback.
4. Route the actual AI call through `callAI({ operation: 'content-brief-outline', ... })` per [ai-operation-contracts.md](../../rules/ai-operation-contracts.md).
5. Unit test feeding 3 fixture responses: valid → parsed object; missing-field → throws; alias-field-only (`sections` instead of `outline`) → throws (regression-locking the fallback removal).

**Verification:**
```
npx vitest run tests/unit/content-brief-ai-contract.test.ts
```

---

### Task 3 — Migrate `server/aeo-page-review.ts` (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/aeo-page-review.ts` (lines 63, 242)
- `tests/unit/aeo-page-review-ai-contract.test.ts` (new)

**Steps:** Mirror Task 2 — replace both bare `JSON.parse` sites with `parseAeoReview()`, route through `callAI({ operation: 'aeo-page-review' })`, add unit test.

---

### Task 4 — Migrate `server/diagnostic-orchestrator.ts` (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/diagnostic-orchestrator.ts` (line 466)
- `tests/unit/diagnostic-orchestrator-ai-contract.test.ts` (new)

**Steps:** Mirror Task 2. Note the four `unknown` downstream fields (`rootCauses?`, …) — the schema must narrow them to concrete types so callers don't need defensive casts.

---

### Task 5 — Migrate `server/schema-plan.ts` (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/schema-plan.ts` (line 358)
- `tests/unit/schema-plan-ai-contract.test.ts` (new)

**Steps:** Mirror Task 2.

---

### Task 6 — pr-check rule: bare `JSON.parse` on AI text response (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `scripts/pr-check.ts` (add rule)
- `docs/rules/automated-rules.md` (regenerated)

**Steps:**
1. Add pr-check rule flagging `JSON.parse(` where the input variable name matches `/^(raw|response|aiText|completion|text|output)$/` inside files under `server/` that import from `server/ai*` or `server/openai-helpers` or `server/anthropic-helpers`. Allow inline hatch `// ai-json-parse-ok: <reason>`.
2. Run `npm run rules:generate`.

---

### Task 7 — Wire client-actions route (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/routes/client-actions.ts` (lines 49, 67, 84)
- `server/ws-events.ts` (add constants if missing)
- `tests/integration/client-actions-wiring.test.ts` (new, port 13873)
- `src/hooks/client/useClientActions.ts` (add `useWorkspaceEvents` invalidation)

**Steps:**
1. Add WS event constants in `server/ws-events.ts`: `CLIENT_ACTION_CREATED`, `CLIENT_ACTION_UPDATED`, `CLIENT_ACTION_RESPONDED`. No inline string literals — see [data-flow.md](../../rules/data-flow.md).
2. After each successful write at lines 49, 67, 84: read the resource (for activity-log context), call `broadcastToWorkspace(workspaceId, { type: '...' })`, call `addActivity(workspaceId, '...', { ...context })`.
3. Frontend: wire `useWorkspaceEvents(workspaceId, { onClientAction: invalidate })` in `src/hooks/client/useClientActions.ts`. Per CLAUDE.md, never use `useGlobalAdminEvents` for workspace-scoped events.
4. Integration test asserts: after `POST /client-actions`, the workspace WS channel emits `CLIENT_ACTION_CREATED`; activity log contains a new row; React Query cache key `client-actions:${workspaceId}` is invalidated (asserted via observable invalidation count or DOM refetch).

---

### Task 8 — Wire keyword-command-center route (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/routes/keyword-command-center.ts` (lines 123, 137)
- `server/ws-events.ts`
- `tests/integration/keyword-command-center-wiring.test.ts` (new, port 13874)
- `src/hooks/admin/useKeywordCommandCenter.ts`

**Steps:** Mirror Task 7. WS events: `KCC_ACTION_TAKEN` (single), `KCC_BULK_ACTION_TAKEN` (bulk). Activity types live in `shared/types/activity.ts`.

---

### Task 9 — Wire anomalies route (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/routes/anomalies.ts` (lines 34, 43)
- `server/ws-events.ts`
- `tests/integration/anomalies-wiring.test.ts` (new, port 13875)
- `src/hooks/admin/useAnomalies.ts` (or client equivalent if anomalies are client-visible)

**Steps:** Mirror Task 7. WS events: `ANOMALY_DISMISSED`, `ANOMALY_ACKNOWLEDGED`.

---

### Task 10 — pr-check rule: workspace mutation routes must broadcast + log (Platform: Claude/Anthropic; Model: Opus)

**Owns:**
- `scripts/pr-check.ts`
- `docs/rules/automated-rules.md` (regenerated)

**Steps:**
1. Add pr-check rule scanning `server/routes/*.ts` for `router.(post|patch|put|delete)` handlers that reference `workspaceId` and contain DB writes (`.run(`, `.upsert`, `.insert`, `db.transaction`) but do NOT contain a call to `broadcastToWorkspace(` and `addActivity(` within the same handler scope. Allow inline hatch `// no-broadcast-ok: <reason>`. This is the hardest rule in the plan — needs Opus or careful scope detection (look for matching `{` depth).
2. Run `npm run rules:generate`.
3. Author the rule with a fixture-based test in `tests/unit/pr-check-broadcast-rule.test.ts`.

**Verification:** apply the rule against the three files modified in Tasks 7–9 (must pass) and a synthetic negative fixture (must fail).

---

## Task Dependencies

```
Task 1 (schemas) → Tasks 2,3,4,5 (parallel)  → Task 6 (rule)
Tasks 7, 8, 9 (parallel, independent of 1–6)
Task 10 (rule) — sequential after Tasks 7,8,9

Parallel batches:
  Batch 1: Task 1   (schemas first — others import from it)
  Batch 2: Task 2 ∥ Task 3 ∥ Task 4 ∥ Task 5 ∥ Task 7 ∥ Task 8 ∥ Task 9
  Batch 3: Task 6 ∥ Task 10
```

**Critical pre-batch-2 commit:** Task 1's schema exports must be committed and importable before any of Tasks 2–5 start. Do not let subagents read schemas from each other's working state — see `multi-agent-coordination.md`.

## File Ownership Conflicts

`server/ws-events.ts` is shared between Tasks 7, 8, 9. Resolve by:
- Task 7 commits its constants first
- Task 8 rebases on Task 7's branch (or waits)
- Task 9 same

Alternative: bundle the WS event additions into a Task 6.5 that runs sequentially before Batch 2 launches Tasks 7-9, and have those tasks read-only on `ws-events.ts`. Recommended if dispatching subagents in parallel.

## Systemic Improvements

**Shared utilities to extract:**
- Per-operation Zod schemas in `server/schemas/ai-*.ts`
- Thin `parseX()` wrappers paired with each schema

**pr-check rules to add:**
- Task 6: bare `JSON.parse` on AI-named variables in AI-importing files
- Task 10: workspace mutation routes missing broadcast/activity

**New tests required:**
- 4 unit tests for AI contracts
- 3 integration tests for route wiring (ports 13319–13321)
- 1 pr-check rule fixture test

**Feature-class gates:** AI-generation correctness + workspace mutation event correctness. Apply the [AI generation](../../workflows/feature-class-definition-of-done.md) and [admin CRUD] gates.

## Verification Strategy

Per PR:
- `npm run typecheck`
- `npx vite build`
- `npx vitest run`
- `npx tsx scripts/pr-check.ts`
- For Tasks 2–5: feed each migrated caller a malformed fixture response and assert the typed error fires (catches a future prompt regression).
- For Tasks 7–9: open staging, perform the mutation, watch the WS channel via dev tools, confirm activity log row appears, confirm React Query cache invalidates.
