# A2 — Outcomes Overview Aggregate SQL (audit #10)

**Branch:** `claude/core-a2-outcomes-overview-sql`
**Lane:** A (serial after A1)
**Audit item:** #10 — `GET /api/outcomes/overview` runs ~3×W×A synchronous per-action loops on main thread.

---

## Problem statement

`GET /api/outcomes/overview` (`server/routes/outcomes.ts:156-204`) runs two O(W×A) nested loops for each workspace in the system:

1. `computeScorecard(ws.id)` calls `getActionsByWorkspace` then `getOutcomesForAction` per-action (three separate inner loops for `byType`, `recentActions`, `olderActions`). For a workspace with 100 actions this is 300+ synchronous DB round-trips per workspace.
2. The `scoredLast30d` calculation calls `getActionsByWorkspace(ws.id)` AGAIN (a duplicate fetch) then `getOutcomesForAction` per-action.

With W workspaces and average A actions each, this is O(W × A) queries on the main Express thread — no async escape.

---

## A1 attribution-exclusion semantics (re-verified against merged code)

A1 introduced `not_acted_on` exclusions in two places:

1. **`getTopWinsFromActions`** (outcome-tracking.ts): filters `a.attribution !== 'not_acted_on'` before the wins loop. This is the only wins surface, so `topWin` in the overview is already `not_acted_on`-clean.
2. **`computeWorkspaceLearnings`** (workspace-learnings.ts): skips `not_acted_on` actions in the scored aggregation used for learnings.

**`computeScorecard` (the path used for `winRate` and `trend` in the overview) does NOT exclude `not_acted_on` actions.** The loop version includes them in `totalWins`, `totalScored`, `recentWins`, `olderWins`. The aggregate SQL must match this exactly — include `not_acted_on` in the win-rate and trend calculation, exclude them only from `topWin` (which delegates to `getTopWinsForWorkspace`).

**`scoredLast30d`** also does NOT exclude `not_acted_on`. The loop counts all actions with any outcome `measuredAt >= thirtyDaysAgo`.

---

## Response shape (byte-identical)

```typescript
// WorkspaceOutcomeOverview
{
  workspaceId: string;
  workspaceName: string;
  winRate: number;             // = computeScorecard().overallWinRate
  trend: LearningsTrend;       // = computeScorecard().trend
  activeActions: number;       // = getWorkspaceCounts().pending (measurement_complete=0)
  scoredLast30d: number;       // distinct actions with any outcome.measuredAt >= now-30d
  topWin: TopWin | null;       // = getTopWinsForWorkspace(ws.id, 1)[0] ?? null
  attentionNeeded: boolean;
  attentionReason?: string;
}
```

All fields identical to the current loop version.

---

## Aggregate SQL design

### New function: `getOverviewAggregateByWorkspace`

Replaces the `computeScorecard` + duplicate `getActionsByWorkspace` calls for the overview path.

Returns a single row per workspace with all fields needed to build `WorkspaceOutcomeOverview`, except `topWin` and workspace name.

#### SQL for winRate + pending + scoredLast30d

```sql
SELECT
  ta.workspace_id,
  COUNT(DISTINCT ta.id)                                    AS total_actions,
  COALESCE(SUM(CASE WHEN ta.measurement_complete = 0 THEN 1 ELSE 0 END), 0) AS pending_count,
  -- Win rate: scored actions that have a conclusive outcome
  COUNT(DISTINCT CASE
    WHEN ao.score NOT IN ('insufficient_data', 'inconclusive') AND ao.score IS NOT NULL
    THEN ta.id END)                                         AS total_scored,
  COUNT(DISTINCT CASE
    WHEN ao.score IN ('win', 'strong_win')
    THEN ta.id END)                                         AS total_wins,
  -- scoredLast30d: distinct actions with ANY outcome measured in last 30 days
  COUNT(DISTINCT CASE
    WHEN ao.measured_at >= datetime('now', '-30 days')
    THEN ta.id END)                                         AS scored_last_30d
FROM tracked_actions ta
LEFT JOIN action_outcomes ao ON ao.action_id = ta.id
WHERE ta.workspace_id = ?
GROUP BY ta.workspace_id
```

#### Trend calculation

The trend requires the split-half comparison. The loop version:
1. Gets all actions ordered by `created_at DESC` (the default order from `getByWorkspace`)
2. Splits at `Math.ceil(actions.length / 2)` — first half = "recent", second half = "older"
3. For each half, counts scored actions and wins among the latest conclusive outcome

This is non-trivial to do in a single aggregate SQL. Strategy: fetch just the action IDs ordered by created_at DESC (lightweight: no JSON column parsing), then run two aggregate queries with LIMIT/OFFSET for the split halves, OR use a window function approach.

**Chosen approach:** Two SQL queries for the trend (recent half vs older half), each using the action IDs returned by a keyset-scoped query. The action IDs query is `SELECT id FROM tracked_actions WHERE workspace_id = ? ORDER BY created_at DESC` — no JSON parsing, just IDs and a sort.

Actually, simpler: use SQLite's `ROW_NUMBER()` window function approach — single query tags each action with a row number, then the trend sub-query partitions by that. But SQLite window functions require version ≥ 3.25.0 (2018). Let me use the simpler two-query approach instead.

**Simpler pattern matching the loop exactly:**

```sql
-- Step 1: Get action IDs in order (cheap — no JSON parsing)
SELECT id FROM tracked_actions WHERE workspace_id = ? ORDER BY created_at DESC
-- Compute splitIdx = Math.ceil(count / 2) in application code

-- Step 2a: Recent half wins/scored (IDs 0..splitIdx-1)
SELECT
  COALESCE(SUM(CASE WHEN ao.score IN ('win','strong_win') THEN 1 ELSE 0 END), 0) AS recent_wins,
  COALESCE(SUM(CASE WHEN ao.score IS NOT NULL AND ao.score NOT IN ('insufficient_data','inconclusive') THEN 1 ELSE 0 END), 0) AS recent_scored
FROM (
  SELECT ao.action_id, ao.score
  FROM action_outcomes ao
  WHERE ao.action_id IN (/* recent IDs */)
    AND ao.checkpoint_days = (SELECT MAX(ao2.checkpoint_days) FROM action_outcomes ao2 WHERE ao2.action_id = ao.action_id AND ao2.score IS NOT NULL AND ao2.score NOT IN ('insufficient_data','inconclusive'))
)
```

Wait — this is getting complex. The loop version finds the "latest scored" outcome as the LAST element of `outcomes.filter(...)` sorted by checkpoint_days ASC. This is the highest-checkpoint conclusive outcome.

Better to keep the trend computation in application code using the aggregate data, using a lightweight ID-fetch + two aggregate queries.

**Final approach:** Two new lightweight SQL queries for trend:
- `getWinRateForActions(actionIds: string[])` → `{ wins: number; scored: number }` — parameterized with `IN (...)` for the ID list

This is safe for the list sizes involved (typically <100 items per workspace for an admin overview). The `IN` list is bounded by the 50-action guard already in the overview loop implicitly (split at `actions.length / 2` for the trend).

#### Implementation plan

New aggregate readers in `server/outcome-tracking.ts`:

1. **`getOverviewStats(workspaceId: string)`** — returns `{ totalActions, pendingCount, totalScored, totalWins, scoredLast30d }` via a single aggregate SQL with LEFT JOIN and COALESCEs.

2. **`getWinRateForActionIds(actionIds: string[])`** — returns `{ wins: number; scored: number }` for a given list of action IDs. Used for the trend split-half calculation. Returns `{ wins: 0, scored: 0 }` for empty list (no DB call).

3. **`getActionIdsByWorkspace(workspaceId: string)`** — returns `string[]` of action IDs ordered `created_at DESC`. Replaces `getActionsByWorkspace` in the trend path — avoids deserializing JSON columns we don't need.

The route handler for overview becomes:
```
for each workspace:
  stats = getOverviewStats(ws.id)                      // 1 query
  ids = getActionIdsByWorkspace(ws.id)                 // 1 query  
  splitIdx = Math.ceil(ids.length / 2)
  recentRate = getWinRateForActionIds(ids.slice(0, splitIdx))   // 1 query or no-op
  olderRate = getWinRateForActionIds(ids.slice(splitIdx))       // 1 query or no-op
  topWin = getTopWinsForWorkspace(ws.id, 1)[0] ?? null         // uses existing prepared stmt
```

Total: 4 queries per workspace instead of O(A) queries. For 100 actions, ~100x fewer DB calls.

`getTopWinsForWorkspace` is kept as-is — it already uses the prepared `getWinsWithValueByWorkspace` statement and applies the `not_acted_on` filter per A1.

---

## Contracts

**New exports from `server/outcome-tracking.ts`:**
```typescript
export interface WorkspaceOverviewStats {
  totalActions: number;
  pendingCount: number;
  totalScored: number;
  totalWins: number;
  scoredLast30d: number;
}

export function getOverviewStats(workspaceId: string): WorkspaceOverviewStats;
export function getActionIdsByWorkspace(workspaceId: string): string[];
export function getWinRateForActionIds(actionIds: string[]): { wins: number; scored: number };
```

These are internal to Lane A. E5 consumes the existing `getTopWinsForWorkspace` and public summary endpoint — no contract change there.

---

## Test design (parity test — TDD first)

### File: `tests/integration/a2-outcomes-overview-sql.test.ts` (port 13885)

**Fixture design — divergent across 2 workspaces:**

**Workspace A (ws_a2_test_a):**
- 3 actions, all `platform_executed`
- action1: outcome score `win`, measured 5 days ago
- action2: outcome score `strong_win`, measured 35 days ago (outside 30d window)
- action3: no outcome (pending)
- Expected: `totalActions=3, pendingCount=1, totalScored=2, totalWins=2, winRate=1.0 (2/2), scoredLast30d=1`

**Workspace B (ws_a2_test_b):**
- 4 actions:
  - action4: attribution=`not_acted_on`, outcome=`win`, measured 3 days ago
  - action5: attribution=`platform_executed`, outcome=`loss`, measured 5 days ago
  - action6: attribution=`platform_executed`, outcome=`inconclusive`, measured 2 days ago
  - action7: attribution=`platform_executed`, no outcome (pending)
- Expected: `totalActions=4, pendingCount=1, totalScored=3 (win+loss+inconclusive? No!)`

Wait — re-reading the loop. "scored" in the overview means `latestOutcome` is non-null (not `insufficient_data` or `inconclusive`). So:
- action4 (`not_acted_on`, outcome=`win`): latestScored is not empty → `scored++`, `totalWins++` (not_acted_on IS counted in computeScorecard)
- action5 (`platform_executed`, outcome=`loss`): `scored++` (loss is scored)
- action6 (`platform_executed`, outcome=`inconclusive`): NOT scored (inconclusive excluded)
- action7 (no outcome): NOT scored

Workspace B expected: `totalActions=4, pendingCount=1, totalScored=2 (action4+action5), totalWins=1 (action4), winRate=0.5 (1/2), scoredLast30d=3 (action4+action5+action6 all within 30d)`

Wait — `scoredLast30d` in the loop counts ANY action with `outcomes.some(o => o.measuredAt >= thirtyDaysAgo)`. This includes `inconclusive` outcomes too. action6 has an inconclusive outcome within 30d → counted. action4 has a win measured 3 days ago → counted.

Actually the loop is:
```js
const outcomes = getOutcomesForAction(a.id);
if (outcomes.some(o => o.measuredAt >= thirtyDaysAgo)) scoredLast30d++;
```

So `scoredLast30d` counts ANY outcome (any score) measured within 30d. action4 (win, 3d ago) ✓, action5 (loss, 5d ago) ✓, action6 (inconclusive, 2d ago) ✓, action7 (no outcome) ✗.
Workspace B `scoredLast30d=3`.

**Not_acted_on must NOT be excluded from `not_acted_on` for the aggregate SQL** since `computeScorecard` includes them.

**Test assertions:**
1. Seed ws_a and ws_b with known fixtures
2. Call `getOverviewStats(ws_a.id)` directly and assert matches expected values
3. Call `GET /api/outcomes/overview` and find both workspace entries
4. Assert ws_a entry: `winRate=1.0, activeActions=1, scoredLast30d=1`
5. Assert ws_b entry: `winRate=0.5, activeActions=1, scoredLast30d=3`
6. Assert ws_b `topWin` is null (the only win in ws_b is `not_acted_on`, excluded by `getTopWinsForWorkspace`)

---

## Ownership and files

**OWNS (modify):**
- `server/outcome-tracking.ts` — new aggregate readers
- `server/routes/outcomes.ts` — refactored overview handler
- `tests/integration/a2-outcomes-overview-sql.test.ts` — new parity test

**READS (do not modify):**
- `server/db/outcome-mappers.ts`
- `server/workspaces.ts`
- `shared/types/outcome-tracking.ts`

---

## Verification commands

```bash
npm run typecheck
npx vite build
npx vitest run tests/integration/a2-outcomes-overview-sql.test.ts
npx vitest run  # full suite
npm run pr-check
```

---

## Acceptance gates

- [ ] `getOverviewStats` uses COALESCE on every SUM (pr-check enforced)
- [ ] All SUM/COUNT queries are workspace_id scoped
- [ ] `createStmtCache` pattern used for all new prepared statements
- [ ] Response shape byte-identical to loop version (verified by test)
- [ ] `not_acted_on` included in winRate/scoredLast30d (matches loop semantics)
- [ ] `not_acted_on` excluded from topWin (via existing getTopWinsForWorkspace)
- [ ] Divergent 2-workspace fixture confirms workspace isolation
- [ ] typecheck + build + full vitest + pr-check all green
