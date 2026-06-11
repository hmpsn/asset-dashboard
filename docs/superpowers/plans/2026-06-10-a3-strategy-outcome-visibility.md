# A3 — Strategy outcome visibility (audit #14)

**Branch:** `claude/core-a3-strategy-outcome-visibility` (base: `origin/staging` @ 413b3918, post-#1181/#1182)
**Lane:** A (after A1 merged + staging-verified). Single agent (Sonnet), reviewer Opus.

## Citation re-verification (done at plan time)

| Plan-time citation | Current state | Drift? |
|---|---|---|
| Once-ever guard at `keyword-strategy-persistence.ts:184` | Verified — `if (!getActionBySource('strategy', ws.id)) recordAction({...})` is still at line 184, inside the `writeKeywordStrategy` transaction | None |
| B2 double-record risk in `keyword-command-center.ts` ADD_TO_STRATEGY | Verified — B2's ADD_TO_STRATEGY (line ~3290) writes feedback + tracked row + `addKeywordToPageInTxn` (page_keywords artifact). It does **not** call `recordAction` anywhere in `keyword-command-center.ts` or its route file. No double-record path exists today. A4 will add Hub-side recording later via the exported key builder. | None (B2 added the page_keywords write + `/planned/<slug>` placeholder paths — accounted for below) |
| A1 merged learnings semantics | Verified — `recordAction` signature read from merged `server/outcome-tracking.ts` (RecordActionParams, `getActionByWorkspaceAndSource`, sourceFlag/baselineConfidence defaults) | None |
| `ActionType` unions in `shared/types/outcome-tracking.ts` | Verified — `'strategy_keyword_added'` exists; `Attribution` `'platform_executed'` exists | None |

## Design

### 1. Drop the once-ever guard (strategy-level action per regen)
Every `persistKeywordStrategy()` run records a strategy-level action unconditionally
(`actionType: 'strategy_keyword_added'`, `sourceType: 'strategy'`, `sourceId: ws.id`).
`sourceId` stays `ws.id` — `tests/integration/keyword-strategy-job-mutation-safety.test.ts`
asserts `getActionBySource('strategy', workspaceId)` presence/absence and no other module
queries `sourceType: 'strategy'`. Multiple rows per workspace are now legal; each regen is a
distinct trackable event.

### 2. Per-keyword actions for net-new pageMap primaries
Inside the same `writeKeywordStrategy` transaction (pr-check multi-step-write rule), after the
page-keyword upserts:

- Candidates = entries actually persisted this run (full mode: stamped full map; incremental
  mode: `analyzedMappings` only).
- Skip entries with empty `pagePath`/`primaryKeyword` and `/planned/...` placeholder paths
  (B2's planned pages are not live URLs — not scoreable).
- **Net-new gate:** the (normalized pagePath, lowercased keyword) pair was NOT in the prior
  `page_keywords` snapshot (`prevPageMapForHistory`, already read at txn start).
- **Idempotency gate (DB-backed):** no existing tracked action with
  `sourceType = STRATEGY_PAGE_KEYWORD_SOURCE_TYPE` and the deterministic `sourceId` key —
  covers remove-then-re-add across generations and any future caller (A4 Hub seam reuses the
  same key shape to stay dedup-compatible).
- Record with **real `pageUrl`** (normalized page path — `resolveFullPageUrl` in
  `outcome-measurement.ts` resolves relative paths, matching the `content-publish.ts`
  precedent), `targetKeyword`, and a baseline snapshot seeded from the pageMap entry's
  GSC metrics when present (`currentPosition`/`clicks`/`impressions`;
  `baselineConfidence: 'estimated'` when none).

### 3. Idempotency key shape (owned by `server/outcome-tracking.ts`)
```ts
export const STRATEGY_PAGE_KEYWORD_SOURCE_TYPE = 'strategy_page_keyword';
export function strategyPageKeywordSourceId(pagePath: string, primaryKeyword: string): string;
// → `${normalizePageUrl(pagePath).toLowerCase()}::${primaryKeyword.trim().toLowerCase()}`
```
Self-normalizing so every caller produces the same key for the same logical pair.
`sourceId` is checked via the existing `getActionByWorkspaceAndSource()` (workspace-scoped).

### State machines
No status mutation is introduced — `recordAction` INSERTs new pending rows
(`measurement_complete = 0`, the legal initial state); no approval/content/post status fields
are touched, so there is no `validateTransition()` call site. The guard test instead asserts
the recorded actions land in the legal initial state (pending, `attribution:
'platform_executed'`) and that the key builder is deterministic/normalizing.

## File ownership (exclusive)
- `server/keyword-strategy-persistence.ts`
- `server/outcome-tracking.ts` (key shape only)
- `tests/integration/a3-strategy-outcome-visibility.test.ts` (new)
- `tests/unit/keyword-strategy-persistence.test.ts` (mock factory must export the new symbols)
- `FEATURE_AUDIT.md`, `data/roadmap.json` (closeout)

## Tests (TDD — written first, fail on base)
1. Regen on a workspace with an existing strategy action records a NEW strategy-level action
   (count 1 → 2).
2. Per-keyword actions created for net-new primaries only; identical re-run creates zero
   duplicates; adding one page creates exactly one new action.
3. Remove-then-re-add a pair across generations → no duplicate (DB idempotency key).
4. `/planned/...` paths and empty primaries are skipped.
5. Guard: new actions are pending (`measurementComplete: false`), typed
   `'strategy_keyword_added'` / `'platform_executed'`, baseline carries `captured_at` + page
   metrics when available.
6. Key builder unit assertions (normalization, determinism).

## Verification gates
`npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts`, new test files,
`npm run test:integration -- keyword-strategy` targeted run.
