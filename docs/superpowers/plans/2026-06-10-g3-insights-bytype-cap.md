# G3 — InsightsSlice.byType cap (absorbed audit item 7b)

> Lane G, after G2. Branch: `claude/core-g3-insights-bytype-cap` (base `origin/staging` @ ad677b0a, #1188/#1189 present).
> Master plan: `2026-06-10-core-features-remediation-master.md` §G3.
> Platform: Claude (Sonnet implementation, Opus review).

---

## Problem

`assembleInsights` caps `all` at 100 (prompt-facing bound) but `byType` is built from the **full**
sorted set — unbounded. On large workspaces the intelligence bundle (AdminChat context, MCP
`get_workspace_intelligence`, generation-context builders) carries every insight twice. The token-budget
rationale in `docs/rules/workspace-intelligence.md` bounds everything else; `byType` is the leak.

**The risk class this PR exists to prevent:** any consumer computing counts or full iteration from
`byType` silently under-reports the moment the cap lands. So consumer redirection MUST land before the
cap (hard internal ordering, enforced by commit order in this PR).

## Hard internal ordering

1. **(a)** Add `countsByType: Partial<Record<InsightType, number>>` (required field, full PRE-cap counts
   per type) to `InsightsSlice` in `shared/types/intelligence.ts` (now ~:230 — file touched by A1
   `LearningsSlice.availability` and D2 `inFlightTargetKeywords` since the audit; both additive, do not
   disturb) + populate in `server/intelligence/insights-slice.ts`.
2. **(b)** Redirect every consumer (inventory below) to `all` / `countsByType` / pre-cap aggregates.
3. **(c)** Only then cap `byType` at top 25 per type ordered by `impactScore` desc.
4. **(d)** Measure intelligence payload size before vs after the cap on a seeded large workspace
   (throwaway script, not committed); numbers go in the final report / PR body.

## Consumer inventory (re-verified against staging head ad677b0a, 2026-06-11)

Full-repo grep of `byType` across `server/`, `src/`, `tests/`, `shared/`, `scripts/`:

### InsightsSlice.byType readers needing redirection

| Reader | Pre-cap dependence | Redirect |
|---|---|---|
| `server/intelligence/insights-slice.ts:8` `listAllInsightsFromSlice` | reconstructs full set from uncapped byType | return the `all` list (top 100 by impact — the slice's intended prompt-facing bound) |
| ↳ `server/monthly-digest.ts:69` | via helper | no file change; behavior now bounded at 100 (intended) |
| ↳ `server/admin-chat-context.ts:619` | via helper | no file change |
| ↳ `server/intelligence/diagnostic-context-builder.ts:38,77` | via helper | no file change; `:38` path already has a direct-store fallback for cache misses |
| `server/meeting-brief-generator.ts:48` `assembleMeetingBriefMetrics` | `byType.ranking_opportunity?.length` as a COUNT | `countsByType.ranking_opportunity ?? 0` |
| `server/meeting-brief-generator.ts:161` (cache-key fingerprint) | same count | `countsByType.ranking_opportunity` |
| `server/routes/client-intelligence.ts:42` `summarizeInsightsForClient` | flattens uncapped byType for filtered totals | filter `insights.all` (the full-iteration surface). The scrub contract (`tests/contract/client-intelligence-tiers.test.ts` seeds a `strategy_alignment` insight and requires it never be exposed) needs joint type×severity filtering, which pre-cap aggregates (`countsByType`/`bySeverity`) cannot provide — so exact scrubbing wins over exact >100-scale totals. Counts are bounded by the pre-existing `all` 100-cap on pathological workspaces; exact per-type totals remain available in `countsByType`. |

### byType occurrences verified NOT InsightsSlice (no change)

- `server/intelligence/formatters.ts:755-757` — `EeatAssetsSummary.byType` (different field).
- `server/schema/schema-validation-core.ts` — Google validation type evaluations.
- `server/routes/outcomes.ts:60-93` — local Map over ActionType.
- `scripts/backfill-deliverables-{approval,client-action}.ts` + their integration tests — backfill result counters.

### src/ readers

None. No frontend code reads `intel.insights.byType` (grep-verified). MCP
(`server/mcp/tools/intelligence.ts:88`) serializes the whole bundle via `JSON.stringify(intel)` —
`countsByType` flows through automatically; cap shrinks the payload.

### Tests / fixtures touched

- `tests/unit/insights-slice.test.ts` — rewrite "reconstructs full insight coverage from uncapped byType
  rollups" to the new contract (cap 25, impact-ordered with divergent insertion order, countsByType =
  pre-cap totals, `all` unaffected, helper returns `all`).
- `tests/unit/workspace-intelligence-extended.test.ts:366-367` — expects uncapped 120/30 → now 25/25 +
  countsByType 120/30.
- Meeting-brief fixtures gain `countsByType`: `server/__tests__/meeting-brief-generator.test.ts`,
  `tests/unit/meeting-brief-generator.test.ts`, `server/__tests__/meeting-brief-generator-ai.test.ts`.
- `server/__tests__/digest-issues-addressed.test.ts` — mock context builder sets `all: fullInsights.slice(0,100)`;
  helper now reads `all`, verify fixture insight counts ≤ 100 still exercise the digest paths.
- `tests/fixtures/rich-intelligence.ts` + any typed `InsightsSlice` literals (`formatters-prompt-format`,
  `token-budget`, etc.) — add `countsByType` where typecheck requires.
- `tests/contract/intelligence-slice-population.test.ts` — add `countsByType` property + type assertions.
- New integration test `tests/integration/g3-insights-bytype-cap.test.ts`
  (`createEphemeralTestContext(import.meta.url)`): seed >25 insights of one type via
  `upsertInsight`, hit `GET /api/public/intelligence/:workspaceId` (the actual client read path) and
  assert summary counts equal PRE-cap totals; assert slice `byType` capped/ordered + `countsByType` full.

### Guardrail files

- `scripts/pr-check.ts` `KNOWN_UNRENDERED_FIELDS` (~:602) — add `countsByType` (aggregate rollup;
  severity summary already rendered; byType itself intentionally unrendered).
- `docs/rules/workspace-intelligence.md` — note the byType cap + countsByType contract in the
  InsightsSlice row.
- `FEATURE_AUDIT.md` — next free entry number.

## Tests (TDD)

Contract pinned by fixture with >25 insights of one type where the highest-impact insight is NOT first
by insertion order:
- `byType[type].length === 25`, ordered by impactScore desc.
- `countsByType[type]` equals pre-cap total.
- `all` unaffected (still 100-cap semantics).
- Redirected consumers (`assembleMeetingBriefMetrics`, client intelligence route summary,
  `listAllInsightsFromSlice`) report pre-cap-equal counts.

## Verification

`npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts` + targeted shards
(`npx vitest run tests/unit/insights-slice.test.ts tests/unit/workspace-intelligence-extended.test.ts tests/contract/intelligence-slice-population.test.ts tests/integration/g3-insights-bytype-cap.test.ts server/__tests__/meeting-brief-generator.test.ts ...`)
+ full suite via pre-commit hook. Payload measurement script run pre/post cap.
