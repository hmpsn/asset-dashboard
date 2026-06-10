# F1 — Site-synthesis model upgrade + GenerationQuality persistence + admin metrics re-attach

> Lane F of the 2026-06-10 core-features remediation run. Audit items #6 + #7, one PR.
> Branch: `claude/core-f1-synthesis-quality` off `origin/staging`.

## Problem statement

Four defects in the keyword-strategy generation + read path:

1. **Under-powered synthesis model (#6).** The `keyword-site-synthesis` operation — the single
   highest-leverage AI call in the platform (closed-set site-level strategy synthesis:
   siteKeywords, opportunities, contentGaps, quickWins) — runs on `gpt-5.4-mini` at 3000 max
   tokens. Both the model tier and the token budget are too small for the synthesis quality this
   call carries.

2. **GenerationQuality is computed but never persisted (#7a).** `keyword-strategy-generation.ts`
   assembles a typed `GenerationQuality` record (poolSize, aiReturnedCount, suppressedCount,
   backfilledCount, floorHit) at the end of every run, but only `log.info`'s it and returns it on
   the in-memory result. There is no durable store, so generation quality cannot be queried,
   trended, or used by future calibration work.

3. **`siteKeywordMetrics` silently dropped from the admin GET (#7b).** After the table-strip
   migration moved `siteKeywordMetrics` out of the workspace blob and into the
   `site_keyword_metrics` table, the admin GET (`routes/keyword-strategy.ts`) destructured the
   assembled strategy but omitted `siteKeywordMetrics`, and `serializeKeywordStrategy` re-attaches
   the five normalized arrays but NOT `siteKeywordMetrics`. The result spreads `...strategy` (the
   blob, whose `siteKeywordMetrics` is now `undefined`), so paid metrics vanish from the admin UI.
   The public route (`public-content.ts`) does re-attach it correctly — that is the mirror.

4. **The guard test masks the omission (#7c).** `keyword-strategy-admin-assembler.test.ts` seeds
   `siteKeywordMetrics` into BOTH the workspace blob (via `updateWorkspace`) AND the table with
   identical values. The blob value makes the assertion pass even though the route drops the
   assembled (table) value — the test cannot detect the regression.

## Owned files (Rule 2)

- `server/ai-operation-registry.ts` — model/token contract for `keyword-site-synthesis`.
- `server/keyword-strategy-ai-synthesis.ts` — the two `callNamedStrategyAI(... , 3000)` call sites.
- `server/keyword-strategy-generation.ts` — persist the quality record.
- `server/routes/keyword-strategy.ts` — re-attach `siteKeywordMetrics` in the admin GET.
- `server/db/migrations/129-generation-quality.sql` — new table (migration set pattern).
- `server/generation-quality-store.ts` — new store module (createStmtCache, rowToX, write path).
- `shared/types/generation-quality.ts` — extend with the persisted-row shape (StoredGenerationQuality).
- Tests (contract + integration), this plan doc.

**Reads (do NOT modify):** `server/routes/public-content.ts` (mirror reference), `server/ai.ts`.

## Approach

### 1. Model upgrade (#6)

- Registry `keyword-site-synthesis`: `defaultModel: 'gpt-5.4-mini'` → `'gpt-5.4'`. Update the
  `modelIntent`/comments to reflect the higher tier. `defaultTimeoutMs` is already `90_000` (the
  `long` profile) — appropriate for `gpt-5.4` at the larger budget; `executionMode` stays
  `background-only` (this op only runs inside the background generation job). Keep
  `defaultResponseFormat`, `defaultMaxRetries`, `researchMode` intact (schema validation contract
  unchanged).
- There is no `defaultMaxTokens` registry field — `maxTokens` is always passed at the call site.
  Raise both `callNamedStrategyAI(ws.id, 'keyword-site-synthesis', ..., 3000)` sites to `4500`.
- The closed-set candidate pool + 3-stage sanitizer contracts are untouched — only the model and
  token allocation change.

### 2. Persist GenerationQuality (#7a)

- Migration `129-generation-quality.sql`: `CREATE TABLE generation_quality` — one row per
  generation run, workspace-scoped. Columns: `id` (INTEGER PK autoincrement), `workspace_id`
  (TEXT NOT NULL, FK to workspaces ON DELETE CASCADE), `pool_size`, `ai_returned_count`,
  `suppressed_count`, `backfilled_count` (all INTEGER NOT NULL), `floor_hit` (INTEGER NOT NULL
  0/1), `created_at` (TEXT NOT NULL, ISO timestamp). Index on `(workspace_id, created_at DESC)`
  for "latest run" reads.
- `server/generation-quality-store.ts`: `createStmtCache`-backed prepared statements; a
  `GenerationQualityRow` interface; a `rowToStoredGenerationQuality()` mapper; a
  `recordGenerationQuality(quality)` write path; `listGenerationQuality(workspaceId)` +
  `getLatestGenerationQuality(workspaceId)` readers for tests/future consumers. workspace_id
  scoping on every statement; INTEGER 0/1 ↔ boolean at the mapper boundary.
- `shared/types/generation-quality.ts`: add a `StoredGenerationQuality` interface (the run-level
  fields + `id` + `createdAt`). The existing `GenerationQuality` stays the write-side input.
- Call `recordGenerationQuality(generationQuality)` at the existing telemetry site in
  `keyword-strategy-generation.ts` (log + persist). Durable side-effect after the strategy is
  persisted — wrapped so a store failure never breaks generation (log + swallow).

### 3. Re-attach siteKeywordMetrics in the admin GET (#7b)

- Destructure `siteKeywordMetrics` from `assembled` (the assembler already resolves it from the
  table).
- Add a `siteKeywordMetrics` parameter to `serializeKeywordStrategy` and include it in the
  returned object (mirror of `public-content.ts`: `length > 0 ? ... : undefined`). The explicit
  key wins over the `...strategy` spread.
- Pass it through at the call site.

### 4. Fix the masking test (#7c)

- Make the fixtures **divergent**: the table carries the REAL metrics; the blob carries a
  DIFFERENT value. Assert the admin response equals the TABLE value, not the blob — so the test
  fails if the route drops the assembled metrics and falls back to the blob spread.

## Tests (TDD — red first)

1. **Contract** (`tests/contract/keyword-site-synthesis-operation.test.ts`): registry entry has
   `defaultModel === 'gpt-5.4'`, `defaultTimeoutMs === 90_000`, `executionMode ===
   'background-only'`, and the schema-validation fields are intact.
2. **Integration — admin re-attach** (extend `keyword-strategy-admin-assembler.test.ts`):
   divergent fixtures (table ≠ blob); admin GET returns the TABLE value; parallel public-route
   assertion that both read paths agree and neither reads the blob.
3. **Integration — quality persistence**
   (`tests/integration/generation-quality-persistence.test.ts`): a generation run persists exactly
   one `generation_quality` row with all five fields + workspace scoping.
4. **FM-2 — AI failure path**: mock the synthesis AI to fail validation (typed-empty →
   deterministic backfill floor); assert a quality row is STILL written recording `floor_hit = 1`
   and `backfilled_count > 0`. The flag-ON synthesis path degrades to typed-empty + backfill
   rather than throwing, so the run reaches the persistence site.

## DB-column + mapper lockstep (CLAUDE.md)

Migration SQL + `GenerationQualityRow` interface + `rowToStoredGenerationQuality` mapper +
`recordGenerationQuality` write path + the `StoredGenerationQuality` shared type all ship in this
one commit. The table is internal-only (never serialized on a public route), so there is no
public-portal field list to update.
