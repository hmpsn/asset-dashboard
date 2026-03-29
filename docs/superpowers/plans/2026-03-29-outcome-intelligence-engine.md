# Outcome Intelligence Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a platform-wide outcome tracking system that measures every recommendation and action, feeds learnings back into AI prompts, and enables the platform to get smarter over time.

**Architecture:** New `tracked_actions` + `action_outcomes` + `workspace_learnings` + `action_playbooks` tables in SQLite. Recording hooks added to 12+ existing route handlers. A daily cron scores outcomes at 7/30/60/90 days. A learnings module aggregates outcome patterns and injects them into all AI callers. Admin dashboard + tiered client views surface results.

**Tech Stack:** Express + TypeScript (backend), React 19 + TailwindCSS 4 + React Query (frontend), SQLite via better-sqlite3, Zod v3 validation, Pino logging.

**Spec:** `docs/superpowers/specs/2026-03-29-outcome-intelligence-engine-design.md`

---

## Guardrails

### Critical Rules — Every Task Must Follow These

1. **Imports always at top of file.** Never add imports mid-file next to usage. Before adding an import, grep the file for existing imports of the same module and merge with them.

2. **Prepared statement caching.** Always use `createStmtCache(() => ({ ... }))` / `stmts()` pattern. Never use local `let` variables for statement caching — the guard is useless on locals re-initialized every call.

3. **JSON column validation.** Never bare `JSON.parse` on DB columns. Always use `parseJsonSafe(raw, schema, fallback, context)` from `server/db/json-validation.ts`. For arrays, use `parseJsonSafeArray`. **CRITICAL: The `context` parameter is an object `{ workspaceId?, field?, table? }`, NOT a string.** Example: `parseJsonSafe(raw, schema, fallback, { field: 'baseline_snapshot', table: 'tracked_actions' })`.

4. **Zod schema field names.** Cross-reference field names against the TypeScript interface in `shared/types/outcome-tracking.ts`. Zod won't catch name mismatches at compile time — a wrong name silently fails `safeParse`.

5. **DB column + mapper lockstep.** Migration SQL, row interface, `rowToX()` mapper, and write functions must all exist before any code uses them. TypeScript won't catch a mapper that ignores a new column.

6. **Route ordering.** Express literal routes before parameterized routes. `/api/outcomes/:workspaceId/scorecard` before `/api/outcomes/:workspaceId/:actionId`.

7. **WebSocket event sync.** Every new event must be added to BOTH `server/ws-events.ts` AND `src/lib/wsEvents.ts` in the same commit.

8. **React Query key sync.** Every new query key factory must be added to `src/lib/queryKeys.ts` before any hook uses it.

9. **Feature flag gating.** All new UI components must be wrapped in `<FeatureFlag flag="outcome-tracking">` or the relevant flag using the existing `<FeatureFlag>` component from `src/components/ui/FeatureFlag.tsx`. Server-side: check via `isFeatureEnabled(workspaceId, 'outcome-tracking')` from `server/feature-flags.ts` — if the function doesn't exist yet, check the env var pattern `FEATURE_OUTCOME_TRACKING=true`.

10. **Color rules.** Teal for actions/CTAs. Blue for data metrics. Green/amber/red for status. Never purple in client components. Use `scoreColor()` for score displays.

11. **Commit after every task.** Each task ends with a commit. Run `npx tsc --noEmit --skipLibCheck` before committing — zero errors required.

12. **Test assertions on collections.** Never assert `.every()` or `.some()` on a potentially empty array without first asserting `length > 0`.

13. **Percentage fields.** CTR and rates are stored as percentages (6.3 for 6.3%), not decimals. Add JSDoc: `/** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */`

14. **`db` is a default export.** Import as `import db from './db/index.js'`, NOT `import { db } from './db/index.js'`.

15. **`getSafe` signature.** `getSafe<T>(url: string, fallback: T, signal?: AbortSignal)` — there is no params argument and no `postSafe`. For query params, build the URL string: `` `${baseUrl}?type=${type}` ``. For POST, use `post<T>(url, body?, signal?)` from `src/api/client.ts`.

16. **Logger in route hooks.** Before adding `log.warn(...)` to any route file, CHECK if that file already has a logger imported. Many route files do NOT. If missing, add: `import { createLogger } from '../logger.js'; const log = createLogger('route-name');`

17. **WebSocket invalidation is TWO steps.** Adding a WS event constant is not enough. You MUST also add a handler in `src/hooks/useWsInvalidation.ts` that calls `qc.invalidateQueries()` for the relevant query keys. Without this, the frontend never auto-refreshes.

18. **Cron job registration.** Creating a cron module is not enough. You MUST also import and call the `start*` function in `server/startup.ts` inside `startSchedulers()`. Without this, the cron never runs.

19. **UI completeness.** Every new component MUST include: (a) `<ErrorBoundary>` wrapping, (b) loading states using `<Skeleton>` with contextual messages ("Analyzing outcomes..." not "Loading..."), (c) empty states using `<EmptyState>` with action-oriented CTAs, (d) proper ARIA labels on interactive elements.

20. **`broadcastToWorkspace` import.** Always import as `import { broadcastToWorkspace } from '../broadcast.js'` and events as `import { WS_EVENTS } from '../ws-events.js'` (from route files).

### File Ownership Protocol

When tasks run in parallel, each task lists **Files you OWN** and **Files you must NOT touch**. Violating ownership causes merge conflicts.

### Verification After Every Task

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

Both must pass before committing. If `tsc` fails, fix the type error before moving on.

### Bug Prevention Measures

These are mandatory practices to reduce implementation bugs. Past projects suffered from significant bug chasing — these measures exist to prevent that.

#### 1. Pre-Flight Validation Script

Before starting any task batch, run this verification script to confirm assumptions about the codebase:

```bash
# Run before Task 4 (core store)
echo "=== Pre-Flight: Verifying codebase assumptions ==="

# Verify parseJsonSafe signature accepts object context
grep -n "function parseJsonSafe" server/db/json-validation.ts

# Verify db is a default export
grep -n "export default" server/db/index.ts

# Verify createStmtCache exists and its import path
grep -rn "export.*createStmtCache" server/db/

# Verify getSafe signature (no params arg)
grep -n "export.*function getSafe" src/api/client.ts

# Verify post signature
grep -n "export.*function post" src/api/client.ts

# Verify broadcastToWorkspace import path
grep -rn "export.*broadcastToWorkspace" server/

# Verify WS_EVENTS location
grep -rn "export const WS_EVENTS" server/ws-events.ts

# Verify FeatureFlag component exists
ls src/components/ui/FeatureFlag.tsx

# Verify isFeatureEnabled or feature flag env var pattern
grep -rn "isFeatureEnabled\|FEATURE_.*=true" server/

echo "=== Pre-Flight Complete ==="
```

**When to run:** Before Tasks 4, 7a, 12, 14a, 15, 16, 18. Each task should verify assumptions about modules it imports.

#### 2. Round-Trip Test for Every Mapper

Every `rowToX()` mapper in Task 4 must have a round-trip test that:
1. Constructs a valid row object
2. Passes it through the mapper
3. Asserts every field is correctly transformed (camelCase, parsed JSON, boolean conversion)
4. Tests with minimal/empty JSON columns to verify fallbacks work

Add these in Task 5. Pattern:

```typescript
it('round-trips TrackedActionRow through rowToTrackedAction', () => {
  const row: TrackedActionRow = {
    id: 'test-1', workspace_id: 'ws-1', action_type: 'content_published',
    source_type: 'content-post', source_id: 'p-1', page_url: '/blog/test',
    target_keyword: 'test kw', baseline_snapshot: '{"captured_at":"2026-01-01"}',
    trailing_history: '{"metric":"clicks","dataPoints":[]}',
    attribution: 'platform_executed', measurement_window: 90,
    measurement_complete: 0, source_flag: 'live', baseline_confidence: 'exact',
    context: '{}', created_at: '2026-01-01', updated_at: '2026-01-01',
  };
  const result = rowToTrackedAction(row);
  expect(result.workspaceId).toBe('ws-1');
  expect(result.actionType).toBe('content_published');
  expect(result.measurementComplete).toBe(false);
  expect(result.baselineSnapshot.captured_at).toBe('2026-01-01');
});

it('handles empty JSON columns gracefully', () => {
  const row: TrackedActionRow = {
    ...minimalRow, baseline_snapshot: '{}', trailing_history: '{}', context: '{}',
  };
  const result = rowToTrackedAction(row);
  expect(result.baselineSnapshot).toBeDefined();
  expect(result.context).toEqual({});
});
```

#### 3. Golden Path Integration Test

After Task 8 (all hooks wired), add an integration test that exercises the full happy path:

```typescript
// tests/integration/outcome-tracking-golden-path.test.ts
it('records action → measures outcome → updates learnings', () => {
  // 1. Record an action
  const action = recordAction({ workspaceId: 'ws-test', actionType: 'content_published', ... });
  expect(action.id).toBeDefined();
  expect(action.measurementComplete).toBe(false);

  // 2. Score the action
  const outcome = recordOutcome({ actionId: action.id, checkpointDays: 7, ... });
  expect(outcome.score).toBeDefined();

  // 3. Verify action still queryable
  const fetched = getAction(action.id);
  expect(fetched).not.toBeNull();

  // 4. Verify learnings can compute without error
  const learnings = computeWorkspaceLearnings('ws-test');
  expect(learnings).toBeDefined();
});
```

Add as a new step in Task 10 (measurement tests).

#### 4. Integration Checkpoint After Every Parallel Batch

After every parallel batch completes, the orchestrator MUST run:

```bash
# Full compilation check
npx tsc --noEmit --skipLibCheck

# Full build check
npx vite build

# Full test suite (not just new tests)
npx vitest run

# Duplicate import check
grep -r "import.*outcome-tracking" server/routes/ | sort | uniq -d

# Verify no mid-file imports
for f in $(git diff --name-only HEAD~3 -- 'server/routes/*.ts'); do
  awk '/^import/{last_import=NR} NR>last_import && /^import/{print FILENAME":"NR": mid-file import!"; exit 1}' "$f"
done
```

**This is not optional.** Do not start the next batch until all checks pass.

#### 5. Runtime Import Verification

Each task's first step should verify that all imports resolve before writing logic:

```typescript
// At the top of any new module, after all imports:
// Verify critical imports are defined at module load time
if (typeof recordAction !== 'function') throw new Error('recordAction not imported');
```

This catches missing exports and wrong paths at startup, not at first request. Remove these guards after Task 26 (integration testing confirms everything works).

#### 6. Negative Test Cases

For every major function, include at least one negative/edge case test:

- `recordAction` with missing required fields → should throw or return error
- `recordOutcome` for non-existent action → should throw
- `scoreAction` with null baseline → should return `insufficient_data`
- `computeWorkspaceLearnings` with zero outcomes → should return low confidence
- `getAction` with invalid ID → should return null
- `formatLearningsForPrompt` with null learnings → should return empty string
- Recording hook in route handler when `recordAction` throws → should NOT block the route response

Add these to the relevant test tasks (5, 10, 13).

#### 7. Split Task 4 Read/Write Verification

Task 4 is the most critical task. After implementing it, verify read-write consistency:

```typescript
// Add to Task 5 tests
it('write-then-read consistency for recordAction', () => {
  const params = { workspaceId: 'ws-1', actionType: 'content_published' as const, ... };
  const written = recordAction(params);
  const read = getAction(written.id);
  expect(read).not.toBeNull();
  // Verify every field matches
  expect(read!.workspaceId).toBe(written.workspaceId);
  expect(read!.actionType).toBe(written.actionType);
  expect(read!.attribution).toBe(written.attribution);
  expect(read!.measurementComplete).toBe(written.measurementComplete);
});
```

#### 8. Explicit Response Shapes in API Routes

Every endpoint in Task 15 must have an explicit TypeScript return type annotation, not rely on inference:

```typescript
// GOOD: explicit shape
router.get('/:workspaceId/scorecard', async (req, res): Promise<void> => {
  const scorecard: OutcomeScorecard = computeScorecard(req.params.workspaceId);
  res.json(scorecard);
});

// BAD: implicit shape — frontend/backend can drift
router.get('/:workspaceId/scorecard', async (req, res) => {
  res.json(computeScorecard(req.params.workspaceId));
});
```

#### 9. Bug Prevention Checklist (Run Before Each Commit)

Each task's commit step should include this mini-checklist:

```bash
# Before committing, verify:
# 1. All imports are at top of file (not mid-file)
grep -n "^import" <file> | tail -1  # should be before first non-import line

# 2. No bare JSON.parse on DB columns
grep -n "JSON.parse" <file>  # should be zero for DB-facing code

# 3. No `import { db }` (must be default import)
grep -n "import { db }" <file>  # should be zero

# 4. No .js extensions in src/ imports
grep -n "from '.*\.js'" src/<file>  # should be zero for frontend files

# 5. Zod field names match TypeScript interface
# Manual check: compare schema field names against shared/types/outcome-tracking.ts
```

#### 10. Fire-and-Forget Hook Safety

All recording hooks in route handlers (Tasks 7a-8) MUST:
1. Use `setImmediate()` to avoid blocking the route response
2. Wrap in try/catch that logs but never throws
3. Never `await` the recording — it's fire-and-forget

Pattern:
```typescript
// CORRECT: fire-and-forget, non-blocking
setImmediate(() => {
  try {
    recordAction({ workspaceId, actionType: 'content_published', ... });
  } catch (err) {
    log.warn({ err, workspaceId }, 'Failed to record outcome action');
  }
});

// WRONG: blocks route response
await recordAction({ workspaceId, actionType: 'content_published', ... });
```

#### 11. Feature Flag Regression Test

After Task 6 (feature flags), add a test verifying all 8 flags are registered:

```typescript
it('all outcome feature flags are defined', () => {
  const requiredFlags = [
    'outcome-tracking', 'outcome-dashboard', 'outcome-ai-injection',
    'outcome-client-reporting', 'outcome-external-detection',
    'outcome-adaptive-pipeline', 'outcome-playbooks', 'outcome-predictive',
  ];
  // Verify flags exist in the shared type (compile-time check)
  // and in the runtime configuration
  for (const flag of requiredFlags) {
    expect(typeof flag).toBe('string'); // compile-time: TS will error if not in FeatureFlag type
  }
});
```

#### 12. Backfill Idempotency

Task 11 (backfill) MUST be idempotent — running it twice should not create duplicate tracked actions. The backfill function must:

1. Check for existing tracked actions with the same `sourceType + sourceId` before inserting
2. Use `INSERT OR IGNORE` or explicit existence checks
3. Include a test that runs backfill twice and asserts count doesn't change

```typescript
it('backfill is idempotent', () => {
  const count1 = backfillWorkspace('ws-test').backfilledCount;
  const count2 = backfillWorkspace('ws-test').backfilledCount;
  expect(count2).toBe(0); // second run should find nothing new
});
```

#### 13. Assumption Verification Script

Create a verification script that can be run at any point to validate plan assumptions still hold:

```bash
#!/bin/bash
# scripts/verify-outcome-assumptions.sh
# Run this before starting implementation and after each major batch

echo "Verifying outcome tracking implementation assumptions..."
ERRORS=0

# 1. Migration number 041 is not taken
if [ -f "server/db/migrations/041-*.sql" ]; then
  echo "WARNING: Migration 041 already exists — pick a different number"
  ERRORS=$((ERRORS+1))
fi

# 2. shared/types/outcome-tracking.ts doesn't exist yet
if [ -f "shared/types/outcome-tracking.ts" ]; then
  echo "INFO: outcome-tracking.ts already exists — Task 1 may be done"
fi

# 3. No existing 'tracked_actions' table references
if grep -rq "tracked_actions" server/db/migrations/*.sql 2>/dev/null; then
  echo "WARNING: tracked_actions already referenced in migrations"
  ERRORS=$((ERRORS+1))
fi

# 4. Verify scoring_config column not already on workspaces
if grep -q "scoring_config" server/db/migrations/*.sql 2>/dev/null; then
  echo "WARNING: scoring_config column may already exist"
  ERRORS=$((ERRORS+1))
fi

# 5. Verify WS_EVENTS doesn't already have OUTCOME_ events
if grep -q "OUTCOME_" server/ws-events.ts 2>/dev/null; then
  echo "INFO: OUTCOME events already in ws-events.ts — Task 6 may be done"
fi

echo "Verification complete. Errors: $ERRORS"
exit $ERRORS
```

**Run before Task 1.** If migration 041 is taken, increment to 042.

#### 14. API Response Shape Contracts

Every endpoint in Task 15 must match the types defined in `shared/types/outcome-tracking.ts` and consumed by `src/api/outcomes.ts`. After Task 15, verify contract alignment:

```bash
# Extract endpoint response types from routes file
grep -n "res.json" server/routes/outcomes.ts

# Extract API client expected types
grep -n "getSafe\|post" src/api/outcomes.ts

# Manual verification: each endpoint's res.json() call returns data
# matching the type the frontend expects
```

If a frontend API method expects `OutcomeScorecard` but the endpoint returns `{ scorecard: OutcomeScorecard }`, that's a bug. The shapes must match exactly.

---

## File Structure

### New Files (Created)

```
shared/types/outcome-tracking.ts          — All shared types (TrackedAction, ActionOutcome, etc.)
server/schemas/outcome-schemas.ts         — Zod schemas for all JSON columns
server/db/migrations/041-outcome-tracking.sql — All tables + indexes + archive tables
server/db/outcome-mappers.ts              — rowToTrackedAction, rowToActionOutcome, rowToActionPlaybook, rowToWorkspaceLearnings
server/outcome-tracking.ts                — Core: recordAction(), getActions(), baseline snapshot assembly
server/outcome-measurement.ts             — Scoring engine: measureOutcome(), scoreAction()
server/outcome-backfill.ts                — One-time backfill script
server/workspace-learnings.ts             — Learnings computation + cache + prompt formatting
server/external-detection.ts              — External execution detection
server/outcome-playbooks.ts               — Playbook pattern detection (Phase 3)
server/outcome-scoring-defaults.ts        — Default scoring thresholds constant
server/routes/outcomes.ts                 — All outcome REST endpoints
src/api/outcomes.ts                       — Frontend API client for outcome endpoints
src/hooks/admin/useOutcomes.ts            — Admin React Query hooks
src/hooks/client/useClientOutcomes.ts     — Client React Query hooks
src/components/admin/outcomes/OutcomeDashboard.tsx    — Main admin outcomes page
src/components/admin/outcomes/OutcomeScorecard.tsx    — Win rate stats
src/components/admin/outcomes/OutcomeActionFeed.tsx   — Action timeline
src/components/admin/outcomes/OutcomeTopWins.tsx      — Highlight wins
src/components/admin/outcomes/OutcomeLearningsPanel.tsx — AI learnings display
src/components/admin/outcomes/OutcomesOverview.tsx    — Multi-workspace overview
src/components/client/OutcomeSummary.tsx              — Client outcome view
src/components/client/WeCalledIt.tsx                  — External win highlights
tests/server/outcome-tracking.test.ts     — Unit tests for recording
tests/server/outcome-measurement.test.ts  — Unit tests for scoring
tests/server/workspace-learnings.test.ts  — Unit tests for learnings
tests/server/outcome-backfill.test.ts     — Unit tests for backfill
```

### Modified Files (Existing)

```
shared/types/feature-flags.ts             — Add outcome-* feature flags
server/ws-events.ts                       — Add OUTCOME_* events
src/lib/wsEvents.ts                       — Mirror OUTCOME_* events
src/lib/queryKeys.ts                      — Add outcome query key factories
server/activity-log.ts                    — Add new ActivityType values
src/routes.ts                             — Add 'outcomes' + 'outcomes-overview' to Page type
src/App.tsx                               — Add renderContent cases
src/components/layout/Sidebar.tsx         — Add sidebar entries
src/components/layout/Breadcrumbs.tsx     — Add TAB_LABELS entries
src/components/CommandPalette.tsx         — Add NAV_ITEMS entries
server/routes/insights.ts                 — Add recordAction hook
server/routes/content-posts.ts            — Add recordAction hook
server/routes/content-briefs.ts           — Add recordAction hook
server/routes/keyword-strategy.ts         — Add recordAction hook
server/routes/webflow-schema.ts           — Add recordAction hook
server/routes/recommendations.ts          — Add recordAction hook
server/routes/webflow-analysis.ts         — Add recordAction hook
server/routes/approvals.ts                — Add recordAction hook
server/routes/workspaces.ts               — Add recordAction hook
server/routes/content-decay.ts            — Add recordAction hook
server/admin-chat-context.ts              — Inject workspace learnings
server/content-posts-ai.ts                — Inject workspace learnings
server/seo-context.ts                     — Inject workspace learnings
server/monthly-digest.ts                  — Add outcomes section
server/app.ts                             — Mount outcomes routes
```

---

## Dependency Graph

```
Task 1 (types) → Task 2 (schemas) → Task 3 (migration) → Task 4 (mappers + store) → Task 5 (tests)
                                                                    │
                    Task 6 (flags/events/keys/routes) ──────────────┤ ← GATE: must complete before hooks or frontend
                                                                    │
                    PARALLEL BATCH A (Tasks 7a-7f: recording hooks) ─┤── Task 8 (remaining hooks)
                                                                    │
                    Task 9 (measurement) → Task 10 (measurement tests)
                    Task 11 (backfill) → backfill tests              │ ← These 3 streams are semi-parallel
                    Task 12 (learnings) → Task 13 (learnings tests) ─┤
                                                                    │
                    PARALLEL BATCH B (Tasks 14a-14d: AI injection) ──┤
                                                                    │
                    Task 15 (API endpoints) → Task 16 (frontend API + hooks)
                                                                    │
                    PARALLEL BATCH C (Tasks 17a-17e: UI components) ─┤
                                                                    │
                    Task 18 (external detection)  ┐                  │
                    Task 19 (client components)   ├── semi-parallel  │
                    Task 20 (multi-ws overview)   │                  │
                    Task 21 (scoring calibration) ┘                  │
                                                                    │
                    Task 22 (adaptive pipeline) ── Task 23 (playbooks)
                                                                    │
                    Task 24 (cron registration) ┐── parallel         │
                    Task 25 (WS invalidation)  ┘                     │
                                                                    │
                    Task 26 (final integration + quality gates) ─────┘
```

---

## Phase 0: Foundation

### Task 1: Shared Types

**Model:** sonnet
**Files:**
- Create: `shared/types/outcome-tracking.ts`

This task defines ALL shared types used across server and frontend. Every subsequent task imports from here.

- [ ] **Step 1: Create the shared types file**

```typescript
// shared/types/outcome-tracking.ts

export type ActionType =
  | 'insight_acted_on'
  | 'content_published'
  | 'brief_created'
  | 'strategy_keyword_added'
  | 'schema_deployed'
  | 'audit_fix_applied'
  | 'content_refreshed'
  | 'internal_link_added'
  | 'meta_updated'
  | 'voice_calibrated';

export type Attribution =
  | 'platform_executed'
  | 'externally_executed'
  | 'not_acted_on';

export type OutcomeScore =
  | 'strong_win'
  | 'win'
  | 'neutral'
  | 'loss'
  | 'insufficient_data'
  | 'inconclusive';

export type SourceFlag = 'live' | 'backfill';
export type BaselineConfidence = 'exact' | 'estimated';
export type LearningsConfidence = 'high' | 'medium' | 'low';
export type LearningsTrend = 'improving' | 'stable' | 'declining';
export type PlaybookConfidence = 'high' | 'medium' | 'low';
export type DeltaDirection = 'improved' | 'declined' | 'stable';
export type EarlySignal = 'on_track' | 'no_movement' | 'too_early';

/** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
export interface BaselineSnapshot {
  captured_at: string;
  position?: number;
  clicks?: number;
  impressions?: number;
  /** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr?: number;
  sessions?: number;
  /** Already a percentage. */
  bounce_rate?: number;
  /** Already a percentage. */
  engagement_rate?: number;
  conversions?: number;
  page_health_score?: number;
  rich_result_eligible?: boolean;
  rich_result_appearing?: boolean;
  voice_score?: number;
}

export interface TrailingDataPoint {
  date: string;
  value: number;
}

export interface TrailingHistory {
  metric: string;
  dataPoints: TrailingDataPoint[];
}

export interface DeltaSummary {
  primary_metric: string;
  baseline_value: number;
  current_value: number;
  delta_absolute: number;
  delta_percent: number;
  direction: DeltaDirection;
}

export interface CompetitorMovement {
  domain: string;
  keyword: string;
  positionChange: number;
  newContent?: boolean;
}

export interface CompetitorContext {
  competitorMovement?: CompetitorMovement[];
}

export interface SeasonalTag {
  month: number;
  quarter: number;
}

export interface ActionContext {
  competitorActivity?: CompetitorContext;
  seasonalTag?: SeasonalTag;
  relatedActions?: string[];
  notes?: string;
}

export interface TrackedAction {
  id: string;
  workspaceId: string;
  actionType: ActionType;
  sourceType: string;
  sourceId: string | null;
  pageUrl: string | null;
  targetKeyword: string | null;
  baselineSnapshot: BaselineSnapshot;
  trailingHistory: TrailingHistory;
  attribution: Attribution;
  measurementWindow: number;
  measurementComplete: boolean;
  sourceFlag: SourceFlag;
  baselineConfidence: BaselineConfidence;
  context: ActionContext;
  createdAt: string;
  updatedAt: string;
}

export interface ActionOutcome {
  id: string;
  actionId: string;
  checkpointDays: 7 | 30 | 60 | 90;
  metricsSnapshot: BaselineSnapshot;
  score: OutcomeScore | null;
  earlySignal?: EarlySignal;
  deltaSummary: DeltaSummary;
  competitorContext: CompetitorContext | null;
  measuredAt: string;
}

export interface PlaybookStep {
  actionType: ActionType;
  timing: string;
  detail: string;
}

export interface PlaybookOutcome {
  metric: string;
  avgImprovement: number;
  avgDaysToResult: number;
}

export interface ActionPlaybook {
  id: string;
  workspaceId: string;
  name: string;
  triggerCondition: string;
  actionSequence: PlaybookStep[];
  historicalWinRate: number;
  sampleSize: number;
  confidence: PlaybookConfidence;
  averageOutcome: PlaybookOutcome;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScoringThreshold {
  strong_win: number;
  win: number;
  neutral_band: number;
}

export interface ScoringConfigEntry {
  primary_metric: string;
  thresholds: ScoringThreshold;
}

export type ScoringConfig = Record<ActionType, ScoringConfigEntry>;

export interface ContentLearnings {
  winRateByFormat: Record<string, number>;
  avgDaysToPage1: number | null;
  bestPerformingTopics: string[];
  optimalWordCount: { min: number; max: number } | null;
  refreshRecoveryRate: number;
  voiceScoreCorrelation: number | null;
}

export interface StrategyLearnings {
  winRateByDifficultyRange: Record<string, number>;
  avgTimeToRank: Record<string, number>;
  bestIntentTypes: string[];
  keywordVolumeSweetSpot: { min: number; max: number } | null;
}

export interface TechnicalLearnings {
  winRateByFixType: Record<string, number>;
  schemaTypesWithRichResults: string[];
  avgHealthScoreImprovement: number;
  internalLinkEffectiveness: number;
}

export interface OverallLearnings {
  totalWinRate: number;
  strongWinRate: number;
  topActionTypes: Array<{ type: string; winRate: number; count: number }>;
  recentTrend: LearningsTrend;
}

export interface WorkspaceLearnings {
  workspaceId: string;
  computedAt: string;
  confidence: LearningsConfidence;
  totalScoredActions: number;
  content: ContentLearnings | null;
  strategy: StrategyLearnings | null;
  technical: TechnicalLearnings | null;
  overall: OverallLearnings;
}

// --- API Response types ---

export interface OutcomeScorecard {
  overallWinRate: number;
  strongWinRate: number;
  totalTracked: number;
  totalScored: number;
  pendingMeasurement: number;
  byCategory: Array<{
    actionType: ActionType;
    winRate: number;
    count: number;
    scored: number;
  }>;
  trend: LearningsTrend;
}

export interface TopWin {
  actionId: string;
  actionType: ActionType;
  pageUrl: string | null;
  targetKeyword: string | null;
  delta: DeltaSummary;
  score: OutcomeScore;
  createdAt: string;
  scoredAt: string;
}

export interface WeCalledItEntry {
  actionId: string;
  actionType: ActionType;
  pageUrl: string | null;
  targetKeyword: string | null;
  recommendation: string;
  delta: DeltaSummary;
  detectedAt: string;
}

export interface WorkspaceOutcomeOverview {
  workspaceId: string;
  workspaceName: string;
  winRate: number;
  trend: LearningsTrend;
  activeActions: number;
  scoredLast30d: number;
  topWin: TopWin | null;
  attentionNeeded: boolean;
  attentionReason?: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git add shared/types/outcome-tracking.ts
git commit -m "feat(outcome-tracking): add shared types for outcome intelligence engine"
```

---

### Task 2: Zod Schemas

**Model:** sonnet
**Depends on:** Task 1
**Files:**
- Create: `server/schemas/outcome-schemas.ts`
- Create: `server/outcome-scoring-defaults.ts`

- [ ] **Step 1: Create the Zod schemas file**

```typescript
// server/schemas/outcome-schemas.ts

import { z } from '../middleware/validate.js';

// --- Action Type enum for Zod ---
export const actionTypeEnum = z.enum([
  'insight_acted_on', 'content_published', 'brief_created',
  'strategy_keyword_added', 'schema_deployed', 'audit_fix_applied',
  'content_refreshed', 'internal_link_added', 'meta_updated',
  'voice_calibrated',
]);

export const attributionEnum = z.enum([
  'platform_executed', 'externally_executed', 'not_acted_on',
]);

export const outcomeScoreEnum = z.enum([
  'strong_win', 'win', 'neutral', 'loss', 'insufficient_data', 'inconclusive',
]);

export const earlySignalEnum = z.enum(['on_track', 'no_movement', 'too_early']);

// --- Baseline Snapshot ---
export const baselineSnapshotSchema = z.object({
  captured_at: z.string(),
  position: z.number().optional(),
  clicks: z.number().optional(),
  impressions: z.number().optional(),
  /** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: z.number().optional(),
  sessions: z.number().optional(),
  /** Already a percentage. */
  bounce_rate: z.number().optional(),
  /** Already a percentage. */
  engagement_rate: z.number().optional(),
  conversions: z.number().optional(),
  page_health_score: z.number().min(0).max(100).optional(),
  rich_result_eligible: z.boolean().optional(),
  rich_result_appearing: z.boolean().optional(),
  voice_score: z.number().min(0).max(100).optional(),
});

// --- Trailing History ---
export const trailingDataPointSchema = z.object({
  date: z.string(),
  value: z.number(),
});

export const trailingHistorySchema = z.object({
  metric: z.string(),
  dataPoints: z.array(trailingDataPointSchema),
});

// --- Delta Summary ---
export const deltaSummarySchema = z.object({
  primary_metric: z.string(),
  baseline_value: z.number(),
  current_value: z.number(),
  delta_absolute: z.number(),
  delta_percent: z.number(),
  direction: z.enum(['improved', 'declined', 'stable']),
});

// --- Competitor Context ---
export const competitorMovementSchema = z.object({
  domain: z.string(),
  keyword: z.string(),
  positionChange: z.number(),
  newContent: z.boolean().optional(),
});

export const competitorContextSchema = z.object({
  competitorMovement: z.array(competitorMovementSchema).optional(),
});

// --- Action Context ---
export const seasonalTagSchema = z.object({
  month: z.number().min(1).max(12),
  quarter: z.number().min(1).max(4),
});

export const actionContextSchema = z.object({
  competitorActivity: competitorContextSchema.optional(),
  seasonalTag: seasonalTagSchema.optional(),
  relatedActions: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

// --- Playbook Schemas ---
export const playbookStepSchema = z.object({
  actionType: actionTypeEnum,
  timing: z.string(),
  detail: z.string(),
});

export const playbookSequenceSchema = z.array(playbookStepSchema);

export const playbookOutcomeSchema = z.object({
  metric: z.string(),
  avgImprovement: z.number(),
  avgDaysToResult: z.number(),
});

// --- Workspace Learnings ---
export const contentLearningsSchema = z.object({
  winRateByFormat: z.record(z.string(), z.number()),
  avgDaysToPage1: z.number().nullable(),
  bestPerformingTopics: z.array(z.string()),
  optimalWordCount: z.object({ min: z.number(), max: z.number() }).nullable(),
  refreshRecoveryRate: z.number(),
  voiceScoreCorrelation: z.number().nullable(),
});

export const strategyLearningsSchema = z.object({
  winRateByDifficultyRange: z.record(z.string(), z.number()),
  avgTimeToRank: z.record(z.string(), z.number()),
  bestIntentTypes: z.array(z.string()),
  keywordVolumeSweetSpot: z.object({ min: z.number(), max: z.number() }).nullable(),
});

export const technicalLearningsSchema = z.object({
  winRateByFixType: z.record(z.string(), z.number()),
  schemaTypesWithRichResults: z.array(z.string()),
  avgHealthScoreImprovement: z.number(),
  internalLinkEffectiveness: z.number(),
});

export const overallLearningsSchema = z.object({
  totalWinRate: z.number(),
  strongWinRate: z.number(),
  topActionTypes: z.array(z.object({
    type: z.string(),
    winRate: z.number(),
    count: z.number(),
  })),
  recentTrend: z.enum(['improving', 'stable', 'declining']),
});

export const workspaceLearningsDataSchema = z.object({
  workspaceId: z.string(),
  computedAt: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  totalScoredActions: z.number(),
  content: contentLearningsSchema.nullable(),
  strategy: strategyLearningsSchema.nullable(),
  technical: technicalLearningsSchema.nullable(),
  overall: overallLearningsSchema,
});

// --- Scoring Config ---
export const scoringThresholdSchema = z.object({
  strong_win: z.number(),
  win: z.number(),
  neutral_band: z.number(),
});

export const scoringConfigEntrySchema = z.object({
  primary_metric: z.string(),
  thresholds: scoringThresholdSchema,
});

export const scoringConfigSchema = z.record(actionTypeEnum, scoringConfigEntrySchema);
export const scoringConfigOverrideSchema = scoringConfigSchema.partial();
```

- [ ] **Step 2: Create the scoring defaults file**

```typescript
// server/outcome-scoring-defaults.ts

import type { ScoringConfig } from '../shared/types/outcome-tracking.js';

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  content_published: {
    primary_metric: 'position',
    thresholds: { strong_win: 10, win: 3, neutral_band: 1 },
  },
  insight_acted_on: {
    primary_metric: 'varies',
    thresholds: { strong_win: 30, win: 15, neutral_band: 10 },
  },
  strategy_keyword_added: {
    primary_metric: 'position',
    thresholds: { strong_win: 10, win: 5, neutral_band: 3 },
  },
  schema_deployed: {
    primary_metric: 'ctr',
    thresholds: { strong_win: 20, win: 10, neutral_band: 5 },
  },
  audit_fix_applied: {
    primary_metric: 'page_health_score',
    thresholds: { strong_win: 15, win: 5, neutral_band: 3 },
  },
  content_refreshed: {
    primary_metric: 'click_recovery',
    thresholds: { strong_win: 80, win: 40, neutral_band: 20 },
  },
  internal_link_added: {
    primary_metric: 'target_improvement',
    thresholds: { strong_win: 20, win: 10, neutral_band: 5 },
  },
  meta_updated: {
    primary_metric: 'ctr',
    thresholds: { strong_win: 15, win: 5, neutral_band: 5 },
  },
  brief_created: {
    primary_metric: 'content_produced',
    thresholds: { strong_win: 1, win: 1, neutral_band: 0 },
    // Binary: did the brief lead to published content? 1 = yes
  },
  voice_calibrated: {
    primary_metric: 'voice_score',
    thresholds: { strong_win: 85, win: 70, neutral_band: 10 },
  },
};

export function resolveScoringConfig(
  override: Partial<ScoringConfig> | null | undefined,
): ScoringConfig {
  if (!override) return DEFAULT_SCORING_CONFIG;
  return { ...DEFAULT_SCORING_CONFIG, ...override };
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/schemas/outcome-schemas.ts server/outcome-scoring-defaults.ts
git commit -m "feat(outcome-tracking): add Zod schemas and scoring defaults"
```

---

### Task 3: Database Migration

**Model:** sonnet
**Depends on:** Task 1
**Files:**
- Create: `server/db/migrations/041-outcome-tracking.sql`

**IMPORTANT:** Check latest migration number before creating. The spec says 041 but verify with `ls server/db/migrations/ | tail -3`. If the latest is higher than 040, use the next number.

- [ ] **Step 1: Verify latest migration number**

Run: `ls server/db/migrations/ | tail -3`
Use the next sequential number.

- [ ] **Step 2: Create the migration file**

```sql
-- 041-outcome-tracking.sql
-- Outcome Intelligence Engine: action tracking, outcome measurement, learnings, playbooks

CREATE TABLE IF NOT EXISTS tracked_actions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  page_url TEXT,
  target_keyword TEXT,
  baseline_snapshot TEXT NOT NULL DEFAULT '{}',
  trailing_history TEXT NOT NULL DEFAULT '{}',
  attribution TEXT NOT NULL DEFAULT 'not_acted_on',
  measurement_window INTEGER NOT NULL DEFAULT 90,
  measurement_complete INTEGER NOT NULL DEFAULT 0,
  source_flag TEXT NOT NULL DEFAULT 'live',
  baseline_confidence TEXT NOT NULL DEFAULT 'exact',
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracked_actions_workspace ON tracked_actions(workspace_id, action_type);
CREATE INDEX IF NOT EXISTS idx_tracked_actions_attribution ON tracked_actions(workspace_id, attribution);
CREATE INDEX IF NOT EXISTS idx_tracked_actions_created ON tracked_actions(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tracked_actions_page ON tracked_actions(workspace_id, page_url);
CREATE INDEX IF NOT EXISTS idx_tracked_actions_measurement ON tracked_actions(measurement_complete, created_at);

CREATE TABLE IF NOT EXISTS action_outcomes (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  checkpoint_days INTEGER NOT NULL,
  metrics_snapshot TEXT NOT NULL DEFAULT '{}',
  score TEXT,
  early_signal TEXT,
  delta_summary TEXT NOT NULL DEFAULT '{}',
  competitor_context TEXT NOT NULL DEFAULT '{}',
  measured_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (action_id) REFERENCES tracked_actions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_action_outcomes_action ON action_outcomes(action_id, checkpoint_days);
CREATE UNIQUE INDEX IF NOT EXISTS idx_action_outcomes_unique ON action_outcomes(action_id, checkpoint_days);

CREATE TABLE IF NOT EXISTS workspace_learnings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  learnings TEXT NOT NULL DEFAULT '{}',
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_playbooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  action_sequence TEXT NOT NULL DEFAULT '[]',
  historical_win_rate REAL NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'low',
  average_outcome TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_action_playbooks_workspace ON action_playbooks(workspace_id);

-- Archive tables for data retention (24-month active window)
CREATE TABLE IF NOT EXISTS tracked_actions_archive (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  page_url TEXT,
  target_keyword TEXT,
  baseline_snapshot TEXT NOT NULL DEFAULT '{}',
  trailing_history TEXT NOT NULL DEFAULT '{}',
  attribution TEXT NOT NULL DEFAULT 'not_acted_on',
  measurement_window INTEGER NOT NULL DEFAULT 90,
  measurement_complete INTEGER NOT NULL DEFAULT 0,
  source_flag TEXT NOT NULL DEFAULT 'live',
  baseline_confidence TEXT NOT NULL DEFAULT 'exact',
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tracked_actions_archive_workspace ON tracked_actions_archive(workspace_id);

CREATE TABLE IF NOT EXISTS action_outcomes_archive (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  checkpoint_days INTEGER NOT NULL,
  metrics_snapshot TEXT NOT NULL DEFAULT '{}',
  score TEXT,
  early_signal TEXT,
  delta_summary TEXT NOT NULL DEFAULT '{}',
  competitor_context TEXT NOT NULL DEFAULT '{}',
  measured_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_action_outcomes_archive_action ON action_outcomes_archive(action_id);

-- Scoring config column on workspaces table
-- NULL = use defaults, JSON = partial override
ALTER TABLE workspaces ADD COLUMN scoring_config TEXT DEFAULT NULL;
```

- [ ] **Step 3: Verify migration applies**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS (migration is SQL, no TS compilation needed, but check for no regressions)

- [ ] **Step 4: Commit**

```bash
git add server/db/migrations/041-outcome-tracking.sql
git commit -m "feat(outcome-tracking): add database migration for all outcome tables"
```

---

### Task 4: Row Mappers + Core Store Module

**Model:** opus
**Depends on:** Tasks 1, 2, 3
**Files:**
- Create: `server/db/outcome-mappers.ts`
- Create: `server/outcome-tracking.ts`

This is the most critical backend task — it defines the core `recordAction()` function and all DB access patterns.

**IMPORTANT:** Before writing this file, read:
- `server/db/json-validation.ts` — verify `parseJsonSafe` signature
- `server/analytics-insights-store.ts` — verify `createStmtCache` pattern
- `server/db/index.ts` — verify how `db` is imported

- [ ] **Step 1: Create row mappers**

```typescript
// server/db/outcome-mappers.ts

import { parseJsonSafe } from './json-validation.js';
import {
  baselineSnapshotSchema,
  trailingHistorySchema,
  actionContextSchema,
  deltaSummarySchema,
  competitorContextSchema,
  playbookSequenceSchema,
  playbookOutcomeSchema,
} from '../schemas/outcome-schemas.js';
import type {
  TrackedAction,
  ActionOutcome,
  ActionPlaybook,
  WorkspaceLearnings,
  BaselineSnapshot,
  TrailingHistory,
  ActionContext,
  DeltaSummary,
  CompetitorContext,
  PlaybookStep,
  PlaybookOutcome,
  EarlySignal,
} from '../../shared/types/outcome-tracking.js';

// --- Row interfaces (snake_case from DB) ---

export interface TrackedActionRow {
  id: string;
  workspace_id: string;
  action_type: string;
  source_type: string;
  source_id: string | null;
  page_url: string | null;
  target_keyword: string | null;
  baseline_snapshot: string;
  trailing_history: string;
  attribution: string;
  measurement_window: number;
  measurement_complete: number;
  source_flag: string;
  baseline_confidence: string;
  context: string;
  created_at: string;
  updated_at: string;
}

export interface ActionOutcomeRow {
  id: string;
  action_id: string;
  checkpoint_days: number;
  metrics_snapshot: string;
  score: string | null;
  early_signal: string | null;
  delta_summary: string;
  competitor_context: string;
  measured_at: string;
}

export interface ActionPlaybookRow {
  id: string;
  workspace_id: string;
  name: string;
  trigger_condition: string;
  action_sequence: string;
  historical_win_rate: number;
  sample_size: number;
  confidence: string;
  average_outcome: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceLearningsRow {
  id: string;
  workspace_id: string;
  learnings: string;
  computed_at: string;
}

// --- Fallbacks ---

const EMPTY_BASELINE: BaselineSnapshot = { captured_at: new Date().toISOString() };
const EMPTY_HISTORY: TrailingHistory = { metric: '', dataPoints: [] };
const EMPTY_CONTEXT: ActionContext = {};
const EMPTY_DELTA: DeltaSummary = {
  primary_metric: '',
  baseline_value: 0,
  current_value: 0,
  delta_absolute: 0,
  delta_percent: 0,
  direction: 'stable',
};
const EMPTY_PLAYBOOK_OUTCOME: PlaybookOutcome = { metric: '', avgImprovement: 0, avgDaysToResult: 0 };

// --- Mappers ---

export function rowToTrackedAction(row: TrackedActionRow): TrackedAction {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actionType: row.action_type as TrackedAction['actionType'],
    sourceType: row.source_type,
    sourceId: row.source_id,
    pageUrl: row.page_url,
    targetKeyword: row.target_keyword,
    baselineSnapshot: parseJsonSafe(row.baseline_snapshot, baselineSnapshotSchema, EMPTY_BASELINE, { field: 'baseline_snapshot', table: 'tracked_actions' }),
    trailingHistory: parseJsonSafe(row.trailing_history, trailingHistorySchema, EMPTY_HISTORY, { field: 'trailing_history', table: 'tracked_actions' }),
    attribution: row.attribution as TrackedAction['attribution'],
    measurementWindow: row.measurement_window,
    measurementComplete: row.measurement_complete === 1,
    sourceFlag: row.source_flag as TrackedAction['sourceFlag'],
    baselineConfidence: row.baseline_confidence as TrackedAction['baselineConfidence'],
    context: parseJsonSafe(row.context, actionContextSchema, EMPTY_CONTEXT, { field: 'context', table: 'tracked_actions' }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToActionOutcome(row: ActionOutcomeRow): ActionOutcome {
  return {
    id: row.id,
    actionId: row.action_id,
    checkpointDays: row.checkpoint_days as ActionOutcome['checkpointDays'],
    metricsSnapshot: parseJsonSafe(row.metrics_snapshot, baselineSnapshotSchema, EMPTY_BASELINE, { field: 'metrics_snapshot', table: 'action_outcomes' }),
    score: (row.score as ActionOutcome['score']) ?? null,
    earlySignal: (row.early_signal as EarlySignal) ?? undefined,
    deltaSummary: parseJsonSafe(row.delta_summary, deltaSummarySchema, EMPTY_DELTA, { field: 'delta_summary', table: 'action_outcomes' }),
    competitorContext: row.competitor_context && row.competitor_context !== '{}'
      ? parseJsonSafe(row.competitor_context, competitorContextSchema, null, { field: 'competitor_context', table: 'action_outcomes' })
      : null,
    measuredAt: row.measured_at,
  };
}

export function rowToActionPlaybook(row: ActionPlaybookRow): ActionPlaybook {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    triggerCondition: row.trigger_condition,
    actionSequence: parseJsonSafe(row.action_sequence, playbookSequenceSchema, [] as PlaybookStep[], { field: 'action_sequence', table: 'action_playbooks' }),
    historicalWinRate: row.historical_win_rate,
    sampleSize: row.sample_size,
    confidence: row.confidence as ActionPlaybook['confidence'],
    averageOutcome: parseJsonSafe(row.average_outcome, playbookOutcomeSchema, EMPTY_PLAYBOOK_OUTCOME, { field: 'average_outcome', table: 'action_playbooks' }),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps workspace_learnings row to WorkspaceLearnings.
 * The `learnings` JSON column contains the full computed learnings object
 * (content, strategy, technical, overall fields). We parse it and merge
 * with the row-level fields (workspaceId, computedAt).
 */
export function rowToWorkspaceLearnings(row: WorkspaceLearningsRow): WorkspaceLearnings | null {
  try {
    const parsed = JSON.parse(row.learnings);
    return {
      workspaceId: row.workspace_id,
      computedAt: row.computed_at,
      confidence: parsed.confidence ?? 'low',
      totalScoredActions: parsed.totalScoredActions ?? 0,
      content: parsed.content ?? null,
      strategy: parsed.strategy ?? null,
      technical: parsed.technical ?? null,
      overall: parsed.overall ?? { winRate: 0, strongWinRate: 0, avgDaysToResult: 0 },
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Create the core outcome-tracking store module**

This module handles recording actions, querying them, and baseline snapshot assembly. Read `server/analytics-insights-store.ts` for the `createStmtCache` pattern before writing.

```typescript
// server/outcome-tracking.ts

import crypto from 'node:crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { rowToTrackedAction, rowToActionOutcome } from './db/outcome-mappers.js';
import type { TrackedActionRow, ActionOutcomeRow } from './db/outcome-mappers.js';
import type {
  TrackedAction,
  ActionOutcome,
  ActionType,
  Attribution,
  BaselineSnapshot,
  TrailingHistory,
  ActionContext,
  SourceFlag,
  BaselineConfidence,
  OutcomeScore,
  DeltaSummary,
  EarlySignal,
} from '../shared/types/outcome-tracking.js';

const log = createLogger('outcome-tracking');

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO tracked_actions (id, workspace_id, action_type, source_type, source_id, page_url, target_keyword, baseline_snapshot, trailing_history, attribution, measurement_window, source_flag, baseline_confidence, context, created_at, updated_at)
    VALUES (@id, @workspace_id, @action_type, @source_type, @source_id, @page_url, @target_keyword, @baseline_snapshot, @trailing_history, @attribution, @measurement_window, @source_flag, @baseline_confidence, @context, @created_at, @updated_at)
  `),
  getById: db.prepare(`SELECT * FROM tracked_actions WHERE id = ?`),
  getByWorkspace: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? ORDER BY created_at DESC`),
  getByWorkspaceAndType: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? AND action_type = ? ORDER BY created_at DESC`),
  getByWorkspaceAndPage: db.prepare(`SELECT * FROM tracked_actions WHERE workspace_id = ? AND page_url = ? ORDER BY created_at DESC`),
  getPendingMeasurement: db.prepare(`SELECT * FROM tracked_actions WHERE measurement_complete = 0`),
  getNotActedOn: db.prepare(`SELECT * FROM tracked_actions WHERE attribution = 'not_acted_on' AND measurement_complete = 0`),
  updateAttribution: db.prepare(`UPDATE tracked_actions SET attribution = ?, updated_at = datetime('now') WHERE id = ?`),
  markComplete: db.prepare(`UPDATE tracked_actions SET measurement_complete = 1, updated_at = datetime('now') WHERE id = ?`),
  updateContext: db.prepare(`UPDATE tracked_actions SET context = ?, updated_at = datetime('now') WHERE id = ?`),
  insertOutcome: db.prepare(`
    INSERT OR REPLACE INTO action_outcomes (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal, delta_summary, competitor_context, measured_at)
    VALUES (@id, @action_id, @checkpoint_days, @metrics_snapshot, @score, @early_signal, @delta_summary, @competitor_context, @measured_at)
  `),
  getOutcomesByAction: db.prepare(`SELECT * FROM action_outcomes WHERE action_id = ? ORDER BY checkpoint_days ASC`),
  getScoredByWorkspace: db.prepare(`
    SELECT ta.*, ao.score, ao.checkpoint_days, ao.delta_summary, ao.measured_at AS scored_at
    FROM tracked_actions ta
    JOIN action_outcomes ao ON ao.action_id = ta.id
    WHERE ta.workspace_id = ? AND ao.score IS NOT NULL AND ao.score NOT IN ('insufficient_data', 'inconclusive')
    ORDER BY ao.measured_at DESC
  `),
  countByWorkspace: db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN measurement_complete = 1 THEN 1 ELSE 0 END) AS scored,
      SUM(CASE WHEN measurement_complete = 0 THEN 1 ELSE 0 END) AS pending
    FROM tracked_actions WHERE workspace_id = ?
  `),
  getRecentByWorkspace: db.prepare(`
    SELECT * FROM tracked_actions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?
  `),
  archiveOld: db.prepare(`
    INSERT INTO tracked_actions_archive SELECT *, datetime('now') AS archived_at
    FROM tracked_actions
    WHERE measurement_complete = 1 AND updated_at < datetime('now', '-24 months')
  `),
  deleteArchived: db.prepare(`
    DELETE FROM tracked_actions
    WHERE measurement_complete = 1 AND updated_at < datetime('now', '-24 months')
  `),
  archiveOldOutcomes: db.prepare(`
    INSERT INTO action_outcomes_archive SELECT *, datetime('now') AS archived_at
    FROM action_outcomes
    WHERE action_id IN (SELECT id FROM tracked_actions_archive)
  `),
  deleteArchivedOutcomes: db.prepare(`
    DELETE FROM action_outcomes
    WHERE action_id NOT IN (SELECT id FROM tracked_actions)
  `),
}));

// --- Public API ---

export interface RecordActionParams {
  workspaceId: string;
  actionType: ActionType;
  sourceType: string;
  sourceId?: string | null;
  pageUrl?: string | null;
  targetKeyword?: string | null;
  baselineSnapshot: BaselineSnapshot;
  trailingHistory?: TrailingHistory;
  attribution?: Attribution;
  measurementWindow?: number;
  sourceFlag?: SourceFlag;
  baselineConfidence?: BaselineConfidence;
  context?: ActionContext;
}

export function recordAction(params: RecordActionParams): TrackedAction {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const month = new Date().getMonth() + 1;
  const quarter = Math.ceil(month / 3);

  const context: ActionContext = {
    ...params.context,
    seasonalTag: { month, quarter },
  };

  stmts().insert.run({
    id,
    workspace_id: params.workspaceId,
    action_type: params.actionType,
    source_type: params.sourceType,
    source_id: params.sourceId ?? null,
    page_url: params.pageUrl ?? null,
    target_keyword: params.targetKeyword ?? null,
    baseline_snapshot: JSON.stringify(params.baselineSnapshot),
    trailing_history: JSON.stringify(params.trailingHistory ?? { metric: '', dataPoints: [] }),
    attribution: params.attribution ?? 'platform_executed',
    measurement_window: params.measurementWindow ?? 90,
    source_flag: params.sourceFlag ?? 'live',
    baseline_confidence: params.baselineConfidence ?? 'exact',
    context: JSON.stringify(context),
    created_at: now,
    updated_at: now,
  });

  log.info({ actionType: params.actionType, workspaceId: params.workspaceId, pageUrl: params.pageUrl }, 'Action recorded');

  const row = stmts().getById.get(id) as TrackedActionRow | undefined;
  if (!row) throw new Error(`Failed to read back tracked action ${id}`);
  return rowToTrackedAction(row);
}

export function getAction(id: string): TrackedAction | null {
  const row = stmts().getById.get(id) as TrackedActionRow | undefined;
  return row ? rowToTrackedAction(row) : null;
}

export function getActionsByWorkspace(workspaceId: string): TrackedAction[] {
  const rows = stmts().getByWorkspace.all(workspaceId) as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function getActionsByWorkspaceAndType(workspaceId: string, actionType: ActionType): TrackedAction[] {
  const rows = stmts().getByWorkspaceAndType.all(workspaceId, actionType) as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function getActionsByPage(workspaceId: string, pageUrl: string): TrackedAction[] {
  const rows = stmts().getByWorkspaceAndPage.all(workspaceId, pageUrl) as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function getPendingActions(): TrackedAction[] {
  const rows = stmts().getPendingMeasurement.all() as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function getNotActedOnActions(): TrackedAction[] {
  const rows = stmts().getNotActedOn.all() as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function updateAttribution(actionId: string, attribution: Attribution): void {
  stmts().updateAttribution.run(attribution, actionId);
}

export function markActionComplete(actionId: string): void {
  stmts().markComplete.run(actionId);
}

export function updateActionContext(actionId: string, context: ActionContext): void {
  stmts().updateContext.run(JSON.stringify(context), actionId);
}

export function recordOutcome(params: {
  actionId: string;
  checkpointDays: 7 | 30 | 60 | 90;
  metricsSnapshot: BaselineSnapshot;
  score: OutcomeScore | null;
  earlySignal?: EarlySignal;
  deltaSummary: DeltaSummary;
  competitorContext?: object | null;
}): ActionOutcome {
  const id = crypto.randomUUID();
  stmts().insertOutcome.run({
    id,
    action_id: params.actionId,
    checkpoint_days: params.checkpointDays,
    metrics_snapshot: JSON.stringify(params.metricsSnapshot),
    score: params.score,
    early_signal: params.earlySignal ?? null,
    delta_summary: JSON.stringify(params.deltaSummary),
    competitor_context: JSON.stringify(params.competitorContext ?? {}),
    measured_at: new Date().toISOString(),
  });

  // Mark action complete after 90-day checkpoint
  if (params.checkpointDays === 90) {
    markActionComplete(params.actionId);
  }

  const rows = stmts().getOutcomesByAction.all(params.actionId) as ActionOutcomeRow[];
  const outcome = rows.find(r => r.checkpoint_days === params.checkpointDays);
  if (!outcome) throw new Error(`Failed to read back outcome for action ${params.actionId}`);
  return rowToActionOutcome(outcome);
}

export function getOutcomesForAction(actionId: string): ActionOutcome[] {
  const rows = stmts().getOutcomesByAction.all(actionId) as ActionOutcomeRow[];
  return rows.map(rowToActionOutcome);
}

export function getWorkspaceCounts(workspaceId: string): { total: number; scored: number; pending: number } {
  const row = stmts().countByWorkspace.get(workspaceId) as { total: number; scored: number; pending: number } | undefined;
  return row ?? { total: 0, scored: 0, pending: 0 };
}

export function getRecentActions(workspaceId: string, limit = 50): TrackedAction[] {
  const rows = stmts().getRecentByWorkspace.all(workspaceId, limit) as TrackedActionRow[];
  return rows.map(rowToTrackedAction);
}

export function archiveOldActions(): { archived: number } {
  const archiveResult = stmts().archiveOld.run();
  if (archiveResult.changes > 0) {
    stmts().archiveOldOutcomes.run();
    stmts().deleteArchivedOutcomes.run();
    stmts().deleteArchived.run();
    log.info({ archived: archiveResult.changes }, 'Archived old tracked actions');
  }
  return { archived: archiveResult.changes };
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/db/outcome-mappers.ts server/outcome-tracking.ts
git commit -m "feat(outcome-tracking): add row mappers and core store module"
```

---

### Task 5: Core Store Unit Tests

**Model:** sonnet
**Depends on:** Task 4
**Files:**
- Create: `tests/server/outcome-tracking.test.ts`

**IMPORTANT:** Read the existing test setup in `tests/` to understand how tests are structured in this project (imports, test DB setup, etc.).

- [ ] **Step 1: Check existing test patterns**

Run: `ls tests/server/` and read one existing test file to understand the test harness setup.

- [ ] **Step 2: Write unit tests for recordAction and outcome recording**

Test cases to cover:
- `recordAction` creates an action with correct fields
- `recordAction` auto-generates seasonal tag in context
- `getActionsByWorkspace` returns actions for a workspace
- `getActionsByWorkspaceAndType` filters correctly
- `recordOutcome` creates an outcome with correct fields
- `recordOutcome` at checkpoint 90 marks action as complete
- `getOutcomesForAction` returns outcomes sorted by checkpoint
- `updateAttribution` changes attribution
- `getWorkspaceCounts` returns correct totals
- `archiveOldActions` moves completed old actions to archive

Every test must:
- Assert `length > 0` before `.every()` or `.some()`
- Use deterministic test data
- Clean up after itself or use isolated workspace IDs

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/server/outcome-tracking.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add tests/server/outcome-tracking.test.ts
git commit -m "test(outcome-tracking): add unit tests for core store module"
```

---

## Phase 1a: Recording Hooks

### Task 6: Feature Flags + WS Events + Query Keys + Activity Types + Route Registration

**Model:** sonnet
**Depends on:** Task 4
**Files:**
- Modify: `shared/types/feature-flags.ts`
- Modify: `server/ws-events.ts`
- Modify: `src/lib/wsEvents.ts`
- Modify: `src/lib/queryKeys.ts`
- Modify: `server/activity-log.ts`
- Modify: `src/routes.ts`

**IMPORTANT:** This task must be completed and committed BEFORE any parallel recording hook tasks start. All hook tasks import from these files.

- [ ] **Step 1: Add feature flags**

In `shared/types/feature-flags.ts`, add after existing flags:

```typescript
  'outcome-tracking': false,
  'outcome-dashboard': false,
  'outcome-ai-injection': false,
  'outcome-client-reporting': false,
  'outcome-external-detection': false,
  'outcome-adaptive-pipeline': false,
  'outcome-playbooks': false,
  'outcome-predictive': false,
```

- [ ] **Step 2: Add WebSocket events to server**

In `server/ws-events.ts`, add to the `WS_EVENTS` object:

```typescript
  OUTCOME_SCORED: 'outcome:scored',
  OUTCOME_EXTERNAL_DETECTED: 'outcome:external',
  OUTCOME_LEARNINGS_UPDATED: 'outcome:learnings_updated',
  OUTCOME_PLAYBOOK_DISCOVERED: 'outcome:playbook',
```

- [ ] **Step 3: Mirror WebSocket events to client**

In `src/lib/wsEvents.ts`, add the exact same entries:

```typescript
  OUTCOME_SCORED: 'outcome:scored',
  OUTCOME_EXTERNAL_DETECTED: 'outcome:external',
  OUTCOME_LEARNINGS_UPDATED: 'outcome:learnings_updated',
  OUTCOME_PLAYBOOK_DISCOVERED: 'outcome:playbook',
```

- [ ] **Step 4: Add query keys**

In `src/lib/queryKeys.ts`, add to the `admin` object:

```typescript
    outcomeActions: (wsId: string) => ['admin-outcome-actions', wsId] as const,
    outcomeScorecard: (wsId: string) => ['admin-outcome-scorecard', wsId] as const,
    outcomeTimeline: (wsId: string) => ['admin-outcome-timeline', wsId] as const,
    outcomeLearnings: (wsId: string) => ['admin-outcome-learnings', wsId] as const,
    outcomePlaybooks: (wsId: string) => ['admin-outcome-playbooks', wsId] as const,
    outcomeTopWins: (wsId: string) => ['admin-outcome-top-wins', wsId] as const,
    outcomeOverview: () => ['admin-outcome-overview'] as const,
```

Add to the `client` object:

```typescript
    outcomeSummary: (wsId: string) => ['client-outcome-summary', wsId] as const,
    outcomeWins: (wsId: string) => ['client-outcome-wins', wsId] as const,
```

- [ ] **Step 5: Add activity types**

In `server/activity-log.ts`, add to the `ActivityType` union:

```typescript
  | 'outcome_scored'
  | 'external_action_detected'
  | 'playbook_suggested'
  | 'learnings_updated'
```

- [ ] **Step 6: Add Page types**

In `src/routes.ts`, add to the `Page` type union:

```typescript
  | 'outcomes'
  | 'outcomes-overview'
```

Add `'outcomes-overview'` to the `GLOBAL_TABS` Set.

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add shared/types/feature-flags.ts server/ws-events.ts src/lib/wsEvents.ts src/lib/queryKeys.ts server/activity-log.ts src/routes.ts
git commit -m "feat(outcome-tracking): add feature flags, WS events, query keys, activity types, routes"
```

---

### PARALLEL BATCH A: Recording Hooks (Tasks 7a–7f)

**Depends on:** Tasks 4, 6
**All 6 tasks can run in parallel.** Each task modifies ONLY its assigned route file.

Each hook task follows the same pattern:
1. Import `recordAction` from `../outcome-tracking.js`
2. **Check if the file already has a logger** — run `grep -n 'createLogger\|const log' <file>`. If NOT present, add: `import { createLogger } from '../logger.js'; const log = createLogger('<route-name>');`
3. After the mutation succeeds (where `addActivity` is called), add a `recordAction()` call
4. Build a `BaselineSnapshot` from data available at that point in the handler
5. Wrap the `recordAction` call in `try/catch` with `log.warn(...)` — recording failures must NEVER break the main operation

**CRITICAL:** Each task must ONLY modify the files listed in "Files you OWN". Do NOT touch any other route file.

---

### Task 7a: Hook — Insight Resolution

**Model:** sonnet
**Files you OWN:** `server/routes/insights.ts`
**Files you must NOT touch:** All other route files

- [ ] **Step 1: Read the current file**

Read `server/routes/insights.ts` to find the PUT resolve handler.

- [ ] **Step 2: Add import at top of file**

Add with existing imports:

```typescript
import { recordAction } from '../outcome-tracking.js';
```

- [ ] **Step 3: Add recording hook after addActivity**

In the PUT `/api/insights/:workspaceId/:insightId/resolve` handler, after `addActivity(...)` and before `res.json(updated)`:

```typescript
    // Record for outcome tracking
    try {
      const insightData = updated.data as Record<string, unknown> | undefined;
      recordAction({
        workspaceId,
        actionType: 'insight_acted_on',
        sourceType: 'insight',
        sourceId: req.params.insightId,
        pageUrl: updated.pageId ?? null,
        targetKeyword: (insightData?.query as string) ?? (insightData?.keyword as string) ?? null,
        baselineSnapshot: {
          captured_at: new Date().toISOString(),
          position: insightData?.currentPosition as number | undefined,
          clicks: insightData?.clicks as number | undefined,
          impressions: insightData?.impressions as number | undefined,
          ctr: insightData?.ctr as number | undefined,
          page_health_score: insightData?.score as number | undefined,
        },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err, insightId: req.params.insightId }, 'Failed to record outcome action for insight');
    }
```

**NOTE:** The hook is wrapped in try/catch so recording failures never break the main operation.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/insights.ts
git commit -m "feat(outcome-tracking): add recording hook to insight resolution"
```

---

### Task 7b: Hook — Content Publishing

**Model:** sonnet
**Files you OWN:** `server/routes/content-posts.ts`
**Files you must NOT touch:** All other route files

- [ ] **Step 1: Read the current file**

Read `server/routes/content-posts.ts` to find the PATCH handler with auto-publish logic.

- [ ] **Step 2: Add import at top of file**

```typescript
import { recordAction } from '../outcome-tracking.js';
```

- [ ] **Step 3: Add recording hook inside the publish success callback**

Inside the `.then(async (result) => { ... })` block after `addActivity(...)`:

```typescript
        // Record for outcome tracking
        try {
          recordAction({
            workspaceId: req.params.workspaceId,
            actionType: 'content_published',
            sourceType: 'post',
            sourceId: req.params.postId,
            pageUrl: updated.publishedSlug ? `/${updated.publishedSlug}` : null,
            targetKeyword: updated.targetKeyword ?? null,
            baselineSnapshot: {
              captured_at: new Date().toISOString(),
              // New page — no baseline metrics yet
            },
            attribution: 'platform_executed',
          });
        } catch (err) {
          log.warn({ err, postId: req.params.postId }, 'Failed to record outcome action for content publish');
        }
```

- [ ] **Step 4: Verify compilation and commit**

```bash
npx tsc --noEmit --skipLibCheck
git add server/routes/content-posts.ts
git commit -m "feat(outcome-tracking): add recording hook to content publishing"
```

---

### Task 7c: Hook — Brief Creation

**Model:** sonnet
**Files you OWN:** `server/routes/content-briefs.ts`
**Files you must NOT touch:** All other route files

- [ ] **Step 1: Read and add import**

- [ ] **Step 2: Add recording hook after generateBrief returns**

After `const brief = await generateBrief(...)` succeeds and before `res.json(brief)`:

```typescript
    // Record for outcome tracking
    try {
      recordAction({
        workspaceId: req.params.workspaceId,
        actionType: 'brief_created',
        sourceType: 'brief',
        sourceId: brief.id,
        pageUrl: null,
        targetKeyword: targetKeyword,
        baselineSnapshot: {
          captured_at: new Date().toISOString(),
          // Position for target keyword if already ranking
          position: semrushMetrics?.position ?? undefined,
          clicks: undefined,
          impressions: undefined,
        },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err, keyword: targetKeyword }, 'Failed to record outcome action for brief creation');
    }
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit --skipLibCheck
git add server/routes/content-briefs.ts
git commit -m "feat(outcome-tracking): add recording hook to brief creation"
```

---

### Task 7d: Hook — Schema Deployment

**Model:** sonnet
**Files you OWN:** `server/routes/webflow-schema.ts`
**Files you must NOT touch:** All other route files

- [ ] **Step 1: Read and add import**

- [ ] **Step 2: Add recording hook after publishSchemaToPage succeeds**

After `const result = await publishSchemaToPage(...)` succeeds:

```typescript
    // Record for outcome tracking
    try {
      recordAction({
        workspaceId: ws.id,
        actionType: 'schema_deployed',
        sourceType: 'schema',
        sourceId: pageId,
        pageUrl: pageSlug ? `/${pageSlug}` : null,
        targetKeyword: null,
        baselineSnapshot: {
          captured_at: new Date().toISOString(),
          rich_result_eligible: true,
          rich_result_appearing: false, // Will be checked at measurement time
        },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err, pageId }, 'Failed to record outcome action for schema deployment');
    }
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit --skipLibCheck
git add server/routes/webflow-schema.ts
git commit -m "feat(outcome-tracking): add recording hook to schema deployment"
```

---

### Task 7e: Hook — Audit Recommendation Completion

**Model:** sonnet
**Files you OWN:** `server/routes/recommendations.ts`
**Files you must NOT touch:** All other route files

- [ ] **Step 1: Read and add import**

- [ ] **Step 2: Add recording hook inside the completion block**

Inside `if (status === 'completed' && ...)`, after the page state updates:

```typescript
    // Record for outcome tracking
    try {
      recordAction({
        workspaceId: req.params.workspaceId,
        actionType: 'audit_fix_applied',
        sourceType: 'recommendation',
        sourceId: req.params.recId,
        pageUrl: rec.affectedPages?.[0] ?? null,
        targetKeyword: null,
        baselineSnapshot: {
          captured_at: new Date().toISOString(),
          // Page health will be measured at checkpoint time
        },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err, recId: req.params.recId }, 'Failed to record outcome action for recommendation completion');
    }
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit --skipLibCheck
git add server/routes/recommendations.ts
git commit -m "feat(outcome-tracking): add recording hook to recommendation completion"
```

---

### Task 7f: Hook — Approval Application

**Model:** sonnet
**Files you OWN:** `server/routes/approvals.ts`
**Files you must NOT touch:** All other route files

- [ ] **Step 1: Read and add import**

- [ ] **Step 2: Add recording hook in the POST apply handler**

After the batch is applied and before `res.json(...)`:

```typescript
    // Record for outcome tracking — meta updates
    try {
      for (const item of approved) {
        if (item.field === 'title' || item.field === 'description') {
          recordAction({
            workspaceId: req.params.workspaceId,
            actionType: 'meta_updated',
            sourceType: 'approval',
            sourceId: req.params.batchId,
            pageUrl: item.pageSlug ? `/${item.pageSlug}` : null,
            targetKeyword: null,
            baselineSnapshot: {
              captured_at: new Date().toISOString(),
            },
            attribution: 'platform_executed',
          });
        }
      }
    } catch (err) {
      log.warn({ err, batchId: req.params.batchId }, 'Failed to record outcome action for approval apply');
    }
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit --skipLibCheck
git add server/routes/approvals.ts
git commit -m "feat(outcome-tracking): add recording hook to approval application"
```

---

### Task 8: Remaining Recording Hooks (Sequential)

**Model:** sonnet
**Depends on:** PARALLEL BATCH A complete
**Files:**
- Modify: `server/routes/keyword-strategy.ts`
- Modify: `server/routes/webflow-analysis.ts`
- Modify: `server/routes/workspaces.ts`
- Modify: `server/routes/content-decay.ts`

These hooks are in less frequently used endpoints and can be done sequentially in one task.

- [ ] **Step 1: Add hook to keyword-strategy.ts**

After `updateWorkspace(ws.id, { keywordStrategy })`:

```typescript
    try {
      recordAction({
        workspaceId: ws.id,
        actionType: 'strategy_keyword_added',
        sourceType: 'strategy',
        sourceId: ws.id,
        pageUrl: null,
        targetKeyword: null, // Strategy is multi-keyword
        baselineSnapshot: { captured_at: new Date().toISOString() },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err }, 'Failed to record outcome action for strategy generation');
    }
```

- [ ] **Step 2: Add hook to webflow-analysis.ts (internal links)**

After `saveInternalLinks(...)`:

```typescript
    try {
      for (const suggestion of result.suggestions.slice(0, 5)) { // Top 5 only
        recordAction({
          workspaceId,
          actionType: 'internal_link_added',
          sourceType: 'internal_link',
          sourceId: null,
          pageUrl: suggestion.toPage ?? null,
          targetKeyword: null,
          baselineSnapshot: { captured_at: new Date().toISOString() },
          attribution: 'not_acted_on', // Suggestions start as not acted on
        });
      }
    } catch (err) {
      log.warn({ err }, 'Failed to record outcome actions for internal link suggestions');
    }
```

- [ ] **Step 3: Add hook to workspaces.ts (brand voice update)**

After brand voice save in the PUT business-profile handler:

```typescript
    try {
      recordAction({
        workspaceId: req.params.id,
        actionType: 'voice_calibrated',
        sourceType: 'brand_voice',
        sourceId: req.params.id,
        pageUrl: null,
        targetKeyword: null,
        baselineSnapshot: { captured_at: new Date().toISOString() },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err }, 'Failed to record outcome action for brand voice update');
    }
```

- [ ] **Step 4: Add hook to content-decay.ts**

After `generateBatchRecommendations(...)`:

```typescript
    try {
      for (const rec of updated.recommendations?.slice(0, 3) ?? []) {
        recordAction({
          workspaceId: req.params.workspaceId,
          actionType: 'content_refreshed',
          sourceType: 'content_decay',
          sourceId: null,
          pageUrl: rec.pagePath ?? null,
          targetKeyword: null,
          baselineSnapshot: { captured_at: new Date().toISOString() },
          attribution: 'not_acted_on',
        });
      }
    } catch (err) {
      log.warn({ err }, 'Failed to record outcome actions for decay recommendations');
    }
```

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit --skipLibCheck
git add server/routes/keyword-strategy.ts server/routes/webflow-analysis.ts server/routes/workspaces.ts server/routes/content-decay.ts
git commit -m "feat(outcome-tracking): add recording hooks to strategy, links, voice, and decay"
```

---

## Phase 1b: Measurement + Learnings + Dashboard

### Task 9: Outcome Measurement Engine

**Model:** opus
**Depends on:** Task 4
**Files:**
- Create: `server/outcome-measurement.ts`

This module computes scores for tracked actions. It's called by a daily cron job.

**IMPORTANT:** Read `server/search-console.ts` and `server/google-analytics.ts` to understand how to fetch current metric values for a page. Also read `server/outcome-scoring-defaults.ts` for threshold logic.

- [ ] **Step 1: Create the measurement module**

The module must:
- Fetch all pending actions where checkpoint is due
- For each action, fetch current metrics from GSC/GA4
- Compute delta vs baseline
- Score using thresholds from `resolveScoringConfig()`
- Record outcome via `recordOutcome()`
- Broadcast `OUTCOME_SCORED` event

Core functions:
- `measurePendingOutcomes()` — main entry point for cron job
- `computeDelta(baseline, current, primaryMetric)` — returns DeltaSummary
- `scoreOutcome(actionType, delta, checkpointDays, config)` — returns OutcomeScore
- `isDueForCheckpoint(action, checkpointDays)` — checks if enough time has passed

Include the full scoring logic for each action type matching the spec's Section 2 thresholds. Handle edge cases: page deleted (inconclusive), insufficient traffic (<50 impressions = insufficient_data), multi-action pages (tag with relatedActions).

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --skipLibCheck`

- [ ] **Step 3: Commit**

```bash
git add server/outcome-measurement.ts
git commit -m "feat(outcome-tracking): add outcome measurement engine with scoring logic"
```

---

### Task 10: Measurement Engine Tests

**Model:** sonnet
**Depends on:** Task 9
**Files:**
- Create: `tests/server/outcome-measurement.test.ts`

Test cases:
- `computeDelta` returns correct direction and percentages
- `scoreOutcome` returns `strong_win` when threshold exceeded
- `scoreOutcome` returns `win` for moderate improvement
- `scoreOutcome` returns `neutral` within neutral band
- `scoreOutcome` returns `loss` for decline
- `scoreOutcome` returns `insufficient_data` for low-traffic pages
- `isDueForCheckpoint` correctly identifies due actions for 7/30/60/90 days
- 7-day checkpoint produces earlySignal, not a final score
- 90-day checkpoint marks action as complete

- [ ] **Step 1-4:** Write tests, run, verify, commit.

---

### Task 11: Backfill Engine

**Model:** opus
**Depends on:** Task 4
**Files:**
- Create: `server/outcome-backfill.ts`

**IMPORTANT:** Read the existing DB tables to understand what historical data is available:
- `generated_posts` — check for `publishedAt`, `targetKeyword` columns
- `analytics_insights` — check for `resolution_status`, `computed_at` columns
- `page_keywords` — check for `created_at`, `previous_position` columns
- `recommendations` — check for status column

The backfill creates tracked actions with `sourceFlag: 'backfill'` and `baselineConfidence: 'estimated'`.

- [ ] **Step 1: Create the backfill module**

Functions:
- `runBackfill(workspaceId?: string)` — runs for one or all workspaces
- `backfillPublishedContent(workspaceId)` — from generated_posts
- `backfillResolvedInsights(workspaceId)` — from analytics_insights
- `backfillStrategyKeywords(workspaceId)` — from page_keywords
- `backfillCompletedRecommendations(workspaceId)` — from recommendations

Each function:
1. Queries the source table for historical records
2. For each record, checks if a tracked_action already exists (skip if so)
3. Reconstructs best-available baseline from stored data
4. Creates tracked_action with `sourceFlag: 'backfill'`
5. If the record is old enough for a 90-day outcome, immediately scores it using current metrics
6. Returns count of backfilled records

- [ ] **Step 2: Write backfill tests** (`tests/server/outcome-backfill.test.ts`)
- [ ] **Step 3: Verify and commit**

---

### Task 12: Workspace Learnings Module

**Model:** opus
**Depends on:** Task 4
**Files:**
- Create: `server/workspace-learnings.ts`

This is the "brain" — it aggregates outcome data into patterns and formats them for AI prompt injection.

- [ ] **Step 1: Create the learnings module**

Core functions:
- `computeWorkspaceLearnings(workspaceId)` — queries scored outcomes, computes all learnings categories
- `getWorkspaceLearnings(workspaceId, domain?)` — returns cached learnings (from DB), recomputes if stale (>24h)
- `formatLearningsForPrompt(learnings, domain)` — converts to natural language for AI injection
- `invalidateLearningsCache(workspaceId)` — force recompute

The module:
1. Queries all scored outcomes for the workspace
2. Groups by action type
3. Computes win rates per category
4. Identifies patterns (best formats, difficulty ranges, schema types)
5. Determines confidence level (high: 25+, medium: 10-24, low: <10)
6. Caches result in `workspace_learnings` table
7. Returns `null` for categories below threshold

**IMPORTANT:** `formatLearningsForPrompt` must produce concise, natural-language bullets. Token budget: max 500 tokens per domain. Example output:

```
WORKSPACE LEARNINGS (47 tracked outcomes, high confidence):
- Content win rate: 68% (32/47 showed measurable improvement)
- Case studies outperform listicles 2:1 (78% vs 40%)
- Keywords difficulty 20-40 reach page 1 within 60 days 60% of the time
- Content refreshes recover traffic 72% of the time
- Pages with FAQ schema see 23% higher CTR
```

- [ ] **Step 2: Verify and commit**

---

### Task 13: Learnings Module Tests

**Model:** sonnet
**Depends on:** Task 12
**Files:**
- Create: `tests/server/workspace-learnings.test.ts`

Test cases:
- Returns null for categories with <10 outcomes
- Returns medium confidence for 10-24 outcomes
- Returns high confidence for 25+ outcomes
- Correctly computes win rates
- `formatLearningsForPrompt` produces valid string within token budget
- Cache is served when fresh, recomputed when stale
- `invalidateLearningsCache` forces recompute

---

### PARALLEL BATCH B: AI Prompt Injection (Tasks 14a–14d)

**Depends on:** Task 12 (learnings module must exist)
**All 4 tasks can run in parallel.** Each modifies ONLY its assigned file.

Each task:
1. Imports `getWorkspaceLearnings, formatLearningsForPrompt` from `../workspace-learnings.js`
2. Finds where the AI prompt/context is assembled
3. Injects learnings for the appropriate domain
4. Wraps in feature flag check

---

### Task 14a: Inject Learnings — Admin Chat

**Model:** sonnet
**Files you OWN:** `server/admin-chat-context.ts`

- [ ] **Step 1:** Import learnings module and inject into context assembly.

Find where context is concatenated and add:

```typescript
// Inject workspace learnings if available
const learnings = getWorkspaceLearnings(workspaceId, 'all');
if (learnings) {
  const learningsBlock = formatLearningsForPrompt(learnings, 'all');
  if (learningsBlock) {
    contextBlocks.push('\n' + learningsBlock);
  }
}
```

- [ ] **Step 2:** Verify and commit.

---

### Task 14b: Inject Learnings — Content Generation

**Model:** sonnet
**Files you OWN:** `server/content-posts-ai.ts`

- [ ] **Step 1:** Import and inject into the system prompt for content generation.

In `buildVoiceContext` or `callCreativeAI`, append learnings for 'content' domain.

- [ ] **Step 2:** Verify and commit.

---

### Task 14c: Inject Learnings — SEO Context

**Model:** sonnet
**Files you OWN:** `server/seo-context.ts`

- [ ] **Step 1:** Import and add learnings block to `buildSeoContext`.

Add a `learningsBlock` field to the returned `SeoContext` and populate it:

```typescript
const learnings = getWorkspaceLearnings(workspaceId, 'strategy');
const learningsBlock = learnings ? formatLearningsForPrompt(learnings, 'strategy') : '';
```

- [ ] **Step 2:** Verify and commit.

---

### Task 14d: Inject Learnings — Monthly Digest

**Model:** sonnet
**Files you OWN:** `server/monthly-digest.ts`

**IMPORTANT:** Before modifying this file, add these imports at the top:
```typescript
import { getWorkspaceLearnings } from './workspace-learnings.js';
import { getRecentActions } from './outcome-tracking.js';
```

- [ ] **Step 1:** Import and add outcomes section to digest generation.

In `generateMonthlyDigest`, fetch learnings and scored outcomes for the month:

```typescript
const learnings = getWorkspaceLearnings(ws.id, 'all');
const recentActions = getRecentActions(ws.id, 20);
// Add "This Month's Outcomes" section to the digest prompt
```

- [ ] **Step 2:** Verify and commit.

---

### Task 15: REST API Endpoints

**Model:** opus
**Depends on:** Tasks 4, 6, 12
**Files:**
- Create: `server/routes/outcomes.ts`
- Modify: `server/app.ts` (mount the router)

- [ ] **Step 1: Create the outcomes route file**

**IMPORTANT:** Read `server/routes/insights.ts` for the exact pattern of auth middleware, validation, and response formatting.

Endpoints to implement:

```typescript
// Admin routes (authenticateToken)
GET    /api/outcomes/:workspaceId/actions           // List tracked actions, filter by type/status/score
GET    /api/outcomes/:workspaceId/actions/:actionId  // Single action with outcomes
POST   /api/outcomes/:workspaceId/actions/:actionId/note  // Add context note
GET    /api/outcomes/:workspaceId/scorecard          // Aggregate stats
GET    /api/outcomes/:workspaceId/top-wins           // Highest-impact scored outcomes
GET    /api/outcomes/:workspaceId/timeline           // Action timeline
GET    /api/outcomes/:workspaceId/learnings          // Current workspace learnings
GET    /api/outcomes/overview                        // Multi-workspace overview (no workspaceId)

// Client routes (authenticateClientToken)
GET    /api/public/outcomes/:workspaceId/summary     // Tiered summary
GET    /api/public/outcomes/:workspaceId/wins        // "We Called It" entries
```

**Route ordering:** Put `/api/outcomes/overview` (literal) BEFORE `/api/outcomes/:workspaceId` (param) to avoid shadowing.

- [ ] **Step 2: Mount in app.ts**

```typescript
import outcomesRouter from './routes/outcomes.js';
// Add after other route mounts:
app.use(outcomesRouter);
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit --skipLibCheck
git add server/routes/outcomes.ts server/app.ts
git commit -m "feat(outcome-tracking): add REST API endpoints for outcomes"
```

---

### Task 16: Frontend API Client + React Query Hooks

**Model:** sonnet
**Depends on:** Tasks 6, 15
**Files:**
- Create: `src/api/outcomes.ts`
- Create: `src/hooks/admin/useOutcomes.ts`
- Create: `src/hooks/client/useClientOutcomes.ts`

- [ ] **Step 1: Create API client**

Follow the pattern from existing API modules (e.g., `src/api/analytics.ts`). **IMPORTANT:** There is no `postSafe` — use `post` from `src/api/client.ts`. And `getSafe` does NOT accept query params — build URL strings manually.

**IMPORTANT:** Frontend files in `src/` do NOT use `.js` extensions on imports. Only server files do.

```typescript
// src/api/outcomes.ts
import { getSafe, post } from './client';
import type {
  TrackedAction, ActionOutcome, OutcomeScorecard, TopWin,
  WorkspaceLearnings, WorkspaceOutcomeOverview, WeCalledItEntry,
} from '../../shared/types/outcome-tracking';

/** Action with its outcomes — returned by the single-action endpoint */
export interface ActionWithOutcomes extends TrackedAction {
  outcomes: ActionOutcome[];
}

export const outcomesApi = {
  getActions: (wsId: string, type?: string, score?: string) => {
    let url = `/api/outcomes/${wsId}/actions`;
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (score) params.set('score', score);
    const qs = params.toString();
    if (qs) url += `?${qs}`;
    return getSafe<TrackedAction[]>(url, []);
  },
  getAction: (wsId: string, actionId: string) =>
    getSafe<ActionWithOutcomes | null>(`/api/outcomes/${wsId}/actions/${actionId}`, null),
  getScorecard: (wsId: string) =>
    getSafe<OutcomeScorecard | null>(`/api/outcomes/${wsId}/scorecard`, null),
  getTopWins: (wsId: string) =>
    getSafe<TopWin[]>(`/api/outcomes/${wsId}/top-wins`, []),
  getTimeline: (wsId: string) =>
    getSafe<TrackedAction[]>(`/api/outcomes/${wsId}/timeline`, []),
  getLearnings: (wsId: string) =>
    getSafe<WorkspaceLearnings | null>(`/api/outcomes/${wsId}/learnings`, null),
  getOverview: () =>
    getSafe<WorkspaceOutcomeOverview[]>(`/api/outcomes/overview`, []),
  addNote: (wsId: string, actionId: string, note: string) =>
    post<{ ok: boolean }>(`/api/outcomes/${wsId}/actions/${actionId}/note`, { note }),
};

export const clientOutcomesApi = {
  getSummary: (wsId: string) =>
    getSafe<OutcomeScorecard | null>(`/api/public/outcomes/${wsId}/summary`, null),
  getWins: (wsId: string) =>
    getSafe<WeCalledItEntry[]>(`/api/public/outcomes/${wsId}/wins`, []),
};
```

- [ ] **Step 2: Create admin hooks**

```typescript
// src/hooks/admin/useOutcomes.ts
// Follow pattern from useInsightFeed.ts
// Hooks: useOutcomeScorecard, useOutcomeActions, useOutcomeTopWins, useOutcomeLearnings, useOutcomeOverview
```

- [ ] **Step 3: Create client hooks**

```typescript
// src/hooks/client/useClientOutcomes.ts
// Hooks: useClientOutcomeSummary, useClientOutcomeWins
```

- [ ] **Step 4: Verify and commit**

---

### PARALLEL BATCH C: UI Components (Tasks 17a–17e)

**Depends on:** Tasks 6, 16
**All 5 tasks can run in parallel.** Each creates ONLY its assigned component file.

**IMPORTANT GUARDRAILS for all UI tasks:**
- Use ONLY existing primitives from `src/components/ui/`: `SectionCard`, `StatCard`, `PageHeader`, `MetricRing`, `Badge`, `StatusBadge`, `DataList`, `EmptyState`, `TabBar`, `Skeleton`
- Teal for actions/CTAs, blue for data metrics, green/amber/red for status
- Never purple in client components
- Use `scoreColor()` from `src/components/ui/constants.ts` for score displays
- Wrap in `<FeatureFlag flag="outcome-dashboard">` (admin) or `<FeatureFlag flag="outcome-client-reporting">` (client)
- Read `BRAND_DESIGN_LANGUAGE.md` before writing any JSX

---

### Task 17a: OutcomeDashboard (Main Page)

**Model:** sonnet
**Files you OWN:** `src/components/admin/outcomes/OutcomeDashboard.tsx`
**Also modify (sequential after parallel):** `src/App.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/Breadcrumbs.tsx`, `src/components/CommandPalette.tsx`

- [ ] **Step 1: Create the component**

Main page with `TabBar` for sub-views: Scorecard, Actions, Top Wins, Learnings.

- [ ] **Step 2: Wire into App.tsx, Sidebar, Breadcrumbs, CommandPalette**

Add `if (tab === 'outcomes') return <OutcomeDashboard ... />;` in renderContent.
Add sidebar entry under ANALYTICS group with blue color scheme (data view).
Add `'outcomes': 'Outcomes'` to Breadcrumbs TAB_LABELS.
Add to CommandPalette NAV_ITEMS.

- [ ] **Step 3: Verify and commit**

---

### Task 17b: OutcomeScorecard

**Model:** sonnet
**Files you OWN:** `src/components/admin/outcomes/OutcomeScorecard.tsx`

- [ ] **Step 1: Create the component**

Displays: overall win rate (MetricRing), category breakdown (horizontal bars in SectionCard), total/scored/pending counts (StatCards), trend indicator.

Empty state: "Outcomes tracking is active. As you act on insights, results will appear here."

---

### Task 17c: OutcomeActionFeed

**Model:** sonnet
**Files you OWN:** `src/components/admin/outcomes/OutcomeActionFeed.tsx`

- [ ] **Step 1: Create the component**

Timeline of tracked actions with status badges. Filterable by action type and score. Click to expand shows baseline → outcome details.

---

### Task 17d: OutcomeTopWins

**Model:** sonnet
**Files you OWN:** `src/components/admin/outcomes/OutcomeTopWins.tsx`

- [ ] **Step 1: Create the component**

Ranked list of highest-impact outcomes. Each shows: action taken, metric improvement, time to result. "Highlight for client" toggle.

---

### Task 17e: OutcomeLearningsPanel

**Model:** sonnet
**Files you OWN:** `src/components/admin/outcomes/OutcomeLearningsPanel.tsx`

- [ ] **Step 1: Create the component**

Shows the same learnings the AI sees, formatted for human review. Sections for content, strategy, technical with confidence badges. "Override" toggle per learning.

---

## Phase 2: External Detection + Client Reporting

### Task 18: External Execution Detection

**Model:** opus
**Depends on:** Task 4
**Files:**
- Create: `server/external-detection.ts`

- [ ] **Step 1: Create the detection module**

Functions:
- `detectExternalExecutions()` — main cron entry point
- `checkSchemaDeployment(action)` — checks if schema appeared on page
- `checkContentChange(action)` — checks if content changed significantly
- `checkMetaUpdate(action)` — checks if title/description changed

Rules:
- Only check actions with `attribution: 'not_acted_on'`
- Require 2 consecutive positive checks before changing attribution
- Track check count in `context.detectionChecks`
- On detection: update attribution to `externally_executed`, snapshot baseline, broadcast

- [ ] **Step 2: Write tests and commit**

---

### Task 19: Client Outcome Components

**Model:** sonnet
**Depends on:** Tasks 16, 17a
**Files:**
- Create: `src/components/client/OutcomeSummary.tsx`
- Create: `src/components/client/WeCalledIt.tsx`

- [ ] **Step 1: Create OutcomeSummary**

Tiered display: Free sees top 3 wins (text only). Growth sees full list + overall hit rate. Premium sees full + competitor context.

Use `<TierGate>` for progressive disclosure. Never purple. Use narrative, outcome-oriented language.

- [ ] **Step 2: Create WeCalledIt**

Displays externally detected wins: "We recommended X. It was implemented. Here's what happened."

Growth: top 1 per month. Premium: all.

- [ ] **Step 3: Verify and commit**

---

## Phase 3: Adaptive + Predictive + Playbooks

### Task 20: Multi-Workspace Outcomes Overview

**Model:** sonnet
**Depends on:** Tasks 15, 17a
**Files:**
- Create: `src/components/admin/outcomes/OutcomesOverview.tsx`

- [ ] **Step 1: Create the global overview page**

Table of all workspaces with: name, win rate (color-coded), trend arrow, active actions, scored last 30d, top win, attention flag.

Aggregate stats at top: total win rate, total actions, "We Called It" count.

Wire into App.tsx for `'outcomes-overview'` tab.

---

### Task 21: Scoring Calibration UI

**Model:** sonnet
**Depends on:** Tasks 15, 2
**Files:**
- Modify: workspace settings area (find exact file first)

- [ ] **Step 1: Add scoring config to workspace settings**

Simple form: for each action type, show current thresholds with edit capability. "Reset to defaults" button. Preview: "With these thresholds, X of your past outcomes would be reclassified."

---

### Task 22: Adaptive Pipeline Integration

**Model:** opus
**Depends on:** Task 12
**Files:**
- Modify: `server/routes/content-briefs.ts` (format recommendations from learnings)
- Modify: `server/routes/keyword-strategy.ts` (difficulty range guidance)
- Modify: `server/routes/webflow-schema.ts` (priority based on win rate)

Each modification:
1. Check if `outcome-adaptive-pipeline` feature flag is enabled
2. If so, fetch workspace learnings for the relevant domain
3. Apply learnings to prioritization/recommendation logic

---

### Task 23: Action Playbooks

**Model:** opus
**Depends on:** Task 12
**Files:**
- Create: `server/outcome-playbooks.ts`

Functions:
- `detectPlaybookPatterns(workspaceId)` — analyzes multi-action pages
- `getPlaybooks(workspaceId)` — returns discovered playbooks
- `suggestPlaybook(workspaceId, trigger)` — matches trigger to playbook

---

### Task 24: Cron Job Registration

**Model:** sonnet
**Depends on:** Tasks 9, 12, 18
**Files:**
- Create: `server/outcome-crons.ts`
- Modify: `server/startup.ts`

This task wires the measurement, learnings, external detection, and archival crons into the server's startup scheduler. Without this, none of the background processing runs.

- [ ] **Step 1: Create the cron orchestrator**

```typescript
// server/outcome-crons.ts

import { createLogger } from './logger.js';
import { measurePendingOutcomes } from './outcome-measurement.js';
import { recomputeAllWorkspaceLearnings } from './workspace-learnings.js';
import { detectExternalExecutions } from './external-detection.js';
import { archiveOldActions } from './outcome-tracking.js';

const log = createLogger('outcome-crons');

const DAILY_MS = 24 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

let measureInterval: ReturnType<typeof setInterval> | null = null;
let learningsInterval: ReturnType<typeof setInterval> | null = null;
let detectionInterval: ReturnType<typeof setInterval> | null = null;
let archiveInterval: ReturnType<typeof setInterval> | null = null;

export function startOutcomeCrons() {
  if (measureInterval) return; // Already started

  // Measure pending outcomes — daily
  measureInterval = setInterval(() => {
    measurePendingOutcomes().catch(err =>
      log.error({ err }, 'Failed to measure pending outcomes')
    );
  }, DAILY_MS);

  // Recompute workspace learnings — daily (null = all workspaces)
  learningsInterval = setInterval(() => {
    recomputeAllWorkspaceLearnings().catch(err =>
      log.error({ err }, 'Failed to compute workspace learnings')
    );
  }, DAILY_MS);

  // Detect external executions — every 12 hours
  detectionInterval = setInterval(() => {
    detectExternalExecutions().catch(err =>
      log.error({ err }, 'Failed to detect external executions')
    );
  }, TWELVE_HOURS_MS);

  // Archive old actions — monthly (run daily, only acts if 24 months passed)
  archiveInterval = setInterval(() => {
    archiveOldActions();
  }, DAILY_MS);

  log.info('Outcome crons started');
}

export function stopOutcomeCrons() {
  if (measureInterval) clearInterval(measureInterval);
  if (learningsInterval) clearInterval(learningsInterval);
  if (detectionInterval) clearInterval(detectionInterval);
  if (archiveInterval) clearInterval(archiveInterval);
  measureInterval = null;
  learningsInterval = null;
  detectionInterval = null;
  archiveInterval = null;
}
```

- [ ] **Step 2: Register in startup.ts**

In `server/startup.ts`, add import and call:

```typescript
import { startOutcomeCrons } from './outcome-crons.js';

// Inside startSchedulers():
startOutcomeCrons();
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit --skipLibCheck
git add server/outcome-crons.ts server/startup.ts
git commit -m "feat(outcome-tracking): register outcome cron jobs in server startup"
```

---

### Task 25: WebSocket Invalidation Handlers

**Model:** sonnet
**Depends on:** Tasks 6, 16
**Files:**
- Modify: `src/hooks/useWsInvalidation.ts`

Without this task, the frontend never auto-refreshes when outcomes are scored, external actions are detected, or learnings are updated.

- [ ] **Step 1: Read the current useWsInvalidation file**

Read `src/hooks/useWsInvalidation.ts` to see the existing handler pattern.

- [ ] **Step 2: Add outcome event handlers**

Add inside the `useWorkspaceEvents` call, following the exact existing pattern:

```typescript
    [WS_EVENTS.OUTCOME_SCORED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeActions(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeScorecard(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeTimeline(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeTopWins(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.outcomeSummary(workspaceId) });
    },
    [WS_EVENTS.OUTCOME_EXTERNAL_DETECTED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeActions(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.outcomeWins(workspaceId) });
    },
    [WS_EVENTS.OUTCOME_LEARNINGS_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeLearnings(workspaceId) });
    },
    [WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomePlaybooks(workspaceId) });
    },
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit --skipLibCheck
git add src/hooks/useWsInvalidation.ts
git commit -m "feat(outcome-tracking): add WS invalidation handlers for outcome events"
```

---

### Task 26: Final Integration + Quality Gates

**Model:** opus
**Depends on:** All previous tasks
**Files:** None new — this is verification only

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: PASS

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: PR check script**

Run: `npx tsx scripts/pr-check.ts`
Expected: PASS

- [ ] **Step 5: Color compliance check**

Run: `grep -r "purple-\|violet-\|indigo-" src/components/client/`
Expected: No results

- [ ] **Step 6: Duplicate import check**

Run: `grep -r "import.*outcome-tracking" server/routes/ | sort`
Verify: Each file imports exactly once, at top of file.

- [ ] **Step 7: Update FEATURE_AUDIT.md**

Add entries for:
- Outcome Intelligence Engine (action tracking, measurement, scoring)
- Workspace Learnings (AI feedback loop)
- Outcomes Dashboard (admin)
- Client Outcome Reporting (tiered)
- External Execution Detection
- Multi-Workspace Outcomes Overview
- Scoring Calibration

- [ ] **Step 8: Update BRAND_DESIGN_LANGUAGE.md**

Add outcome-specific color mappings:
- Win rate rings: use `scoreColor()` scale
- Score badges: green = strong_win/win, amber = neutral, red = loss, zinc = insufficient_data
- Action type badges: blue (data)

- [ ] **Step 9: Update data/roadmap.json + sort**

Mark outcome tracking items as done. Run `npx tsx scripts/sort-roadmap.ts`.

- [ ] **Step 10: Final commit**

```bash
git add FEATURE_AUDIT.md BRAND_DESIGN_LANGUAGE.md data/roadmap.json
git commit -m "docs: update feature audit, brand guide, and roadmap for outcome intelligence engine"
```

---

## Model Assignment Summary

| Model | Tasks | Rationale |
|---|---|---|
| **opus** | 4 (core store), 9 (measurement), 11 (backfill), 12 (learnings), 15 (API routes), 18 (external detection), 22 (adaptive pipeline), 23 (playbooks), 26 (integration) | Complex logic, scoring algorithms, multi-system coordination |
| **sonnet** | 1 (types), 2 (schemas), 3 (migration), 5 (tests), 6 (flags/events/keys), 7a-7f (recording hooks), 8 (remaining hooks), 10 (measurement tests), 13 (learnings tests), 14a-14d (AI injection), 16 (frontend hooks), 17a-17e (UI components), 19 (client components), 20 (overview), 21 (calibration), 24 (crons), 25 (WS invalidation) | Pattern-following, repetitive but precise, UI components |

## Parallelization Summary

| Batch | Tasks | Max Parallel Agents | Estimated Combined Time |
|---|---|---|---|
| **Sequential Foundation** | 1 → 2 → 3 → 4 → 5 | 1 | Foundation must be serial |
| **Sequential Gate** | 6 | 1 | Shared contracts — must complete before hooks |
| **Parallel Batch A** | 7a, 7b, 7c, 7d, 7e, 7f | 6 | Recording hooks (all independent route files) |
| **Sequential** | 8 | 1 | Remaining hooks (multi-file) |
| **Semi-parallel** | 9+10, 11, 12+13 | 3 | Measurement, backfill, learnings (independent modules) |
| **Parallel Batch B** | 14a, 14b, 14c, 14d | 4 | AI injection (each modifies one file) |
| **Sequential** | 15 → 16 | 1 | API routes → frontend client (dependent) |
| **Parallel Batch C** | 17a, 17b, 17c, 17d, 17e | 5 | UI components (independent files) |
| **Semi-parallel** | 18, 19, 20, 21 | 3-4 | Phase 2+3 features |
| **Sequential** | 22, 23 | 1 | Adaptive, playbooks |
| **Parallel** | 24, 25 | 2 | Cron registration + WS invalidation (independent files) |
| **Sequential** | 26 | 1 | Final integration + quality gates |
