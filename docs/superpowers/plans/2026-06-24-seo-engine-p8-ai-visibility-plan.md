# SEO Decision Engine P8 — AI-Visibility / LLM Citation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). Read these THREE first: spec `docs/superpowers/specs/2026-06-24-seo-engine-p8-ai-visibility-design.md`, audit `docs/superpowers/audits/2026-06-24-seo-engine-p8-ai-visibility-audit.md`, fixture `tests/fixtures/dataforseo-llm-mentions.ts` (the ground-truth API shapes — build the parser against these, never guess field names). Steps use `- [ ]`.

**Goal:** A pure measurement layer — an "AI visibility" KPI (share-of-voice vs co-mentioned competitors + mention volume + before/after trend + source-domain AEO targets) from DataForSEO's LLM-mentions database, behind the `ai-visibility` flag (Growth+, observe-only budget). KPI-only — no new rec/insight.

**Architecture:** Mirrors the proven P6/P7 wave structure. `getLlmMentions` provider (one DB call per domain) → `llm_mention_snapshots` time-series → `llm-mentions-refresh` job → admin + client KPI surfaces + intelligence slice.

**Tech stack:** Express + better-sqlite3 + Zod + React Query + DataForSEO `ai_optimization/.../llm_mentions/aggregated_metrics`. Branch `seo-engine-p8-ai-visibility` (off staging, includes P7).

---

## File structure
**Create:** `server/db/migrations/155-llm-mention-snapshots.sql`, `server/llm-mentions-store.ts`, `server/llm-mentions.ts` (the job), `src/components/strategy/AiVisibilityPanel.tsx` (admin) + a small client KPI block, tests.
**Modify:** `shared/types/feature-flags.ts`, `shared/types/background-jobs.ts`, `server/seo-data-provider.ts`, `server/providers/dataforseo-provider.ts`, a strategy/SEO route file, `src/api/*` + `src/hooks/admin/*` (read + refresh hooks), `src/lib/queryKeys.ts`, `server/ws-events.ts` + `src/lib/wsEvents.ts` + `src/lib/wsInvalidation.ts` + `src/hooks/useWsInvalidation.ts` + `scripts/platform-domain-event-definitions.ts`, `tests/helpers/background-job-test-matrix.ts`, an intelligence slice (`server/intelligence/seo-context-slice.ts` or a new `ai-visibility-slice.ts`) + `shared/types/intelligence.ts`, a client Overview/Results component.

## Dependency graph
```
U0 contracts ──► U1 provider ‖ U2 store ──► U3 job+route ──► U4 admin KPI ‖ U5 client KPI + slice ──► U6 tests+gate ──► review ──► PR
```
Waves: U0 → {U1,U2} → U3 → {U4,U5} → U6. Diff-review after Wave 1 and the UI wave.
## Model assignments
U0/review/orchestration = **Opus**; U1 parser, U2 store, U3 job, U4/U5 UI+slice = **Sonnet**; mechanical registry edits = **Haiku**.

---

# Wave 0 — Task U0: Contracts (single commit, blocks all)

**Files (exclusive):** `shared/types/feature-flags.ts`, `server/db/migrations/155-llm-mention-snapshots.sql`, `server/seo-data-provider.ts`, `shared/types/background-jobs.ts`, `server/ws-events.ts`, `src/lib/wsEvents.ts`, `src/lib/wsInvalidation.ts`, `src/hooks/useWsInvalidation.ts`, `scripts/platform-domain-event-definitions.ts`.

- [ ] **Migration 155** `server/db/migrations/155-llm-mention-snapshots.sql`:
```sql
-- 155-llm-mention-snapshots.sql
-- SEO Decision Engine P8: LLM-mention (AI-visibility) time series. The trend IS the before/after
-- AEO proof. mentions/ai_search_volume NULLable; readers treat absent as 0 (never invented).
CREATE TABLE IF NOT EXISTS llm_mention_snapshots (
  workspace_id      TEXT NOT NULL,
  snapshot_date     TEXT NOT NULL,
  platform          TEXT NOT NULL,                 -- 'chat_gpt' (room for 'google')
  domain            TEXT,
  mentions          INTEGER,
  ai_search_volume  INTEGER,
  share_of_voice    REAL,                           -- 0..1 (own ÷ own+competitors)
  competitor_brands TEXT NOT NULL DEFAULT '[]',     -- JSON [{name,mentions,aiSearchVolume}]
  source_domains    TEXT NOT NULL DEFAULT '[]',     -- JSON [{domain,mentions}]
  fetched_at        TEXT NOT NULL,
  PRIMARY KEY (workspace_id, snapshot_date, platform),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_llm_mentions_ws ON llm_mention_snapshots(workspace_id, platform, snapshot_date);
```
- [ ] **Provider types** in `server/seo-data-provider.ts` (near the P7 BusinessListing types):
```ts
export interface LlmMentionsRequest {
  domain: string;
  platform?: 'chat_gpt' | 'google';   // default chat_gpt
  locationName?: string;
  languageCode?: string;
}
export interface LlmMentionCompetitor { name: string; mentions: number; aiSearchVolume?: number; }
export interface LlmMentionSource { domain: string; mentions: number; }
export interface LlmMentionsResult {
  domain: string;
  platform: string;
  mentions: number;                    // 0 when no data (NEVER invented)
  aiSearchVolume: number;
  shareOfVoice: number;                // 0..1
  competitors: LlmMentionCompetitor[];
  sourceDomains: LlmMentionSource[];
}
```
Add to `SeoDataProvider` (optional): `getLlmMentions?(request: LlmMentionsRequest, workspaceId: string): Promise<LlmMentionsResult>;`
- [ ] **Flag** `shared/types/feature-flags.ts`: `'ai-visibility': false` (after `local-gbp`); catalog entry (mirror `local-gbp`, dates = commit day, `linkedRoadmapItemId: 'seo-engine-p8-ai-visibility-llm-citation'`, label `'AI visibility — LLM citation share-of-voice vs competitors'`); add `'ai-visibility'` to `FEATURE_FLAG_GROUPS['SEO Decision Engine']`.
- [ ] **Job type** `shared/types/background-jobs.ts`: `LLM_MENTIONS_REFRESH: 'llm-mentions-refresh'` + metadata `{ label: 'Refreshing AI visibility', description: 'Reads LLM-mention share-of-voice + source domains for the client domain.', cancellable: true, resultBehavior: 'domain-store' }`.
- [ ] **WS event + registries**: `ws-events.ts` + `src/lib/wsEvents.ts` mirror `LLM_MENTIONS_SNAPSHOTS_REFRESHED: 'llm-mentions:snapshots_refreshed'`; `src/lib/wsInvalidation.ts` admin case → `[queryKeys.admin.aiVisibility(workspaceId), queryKeys.admin.keywordStrategy(workspaceId), queryKeys.admin.intelligenceAll(workspaceId)]` (add `aiVisibility` query key in U4 if not yet — for U0 just reference `keywordStrategy`+`intelligenceAll`, U4 adds the panel key to both the queryKeys file and this case); `useWsInvalidation.ts` handler; `platform-domain-event-definitions.ts` CONTEXT_BY_EVENT_KEY (`seo-health`) + payload note.
- [ ] **Gate + commit:** `npm run typecheck && npm run verify:feature-flags && npx tsx scripts/pr-check.ts`. Commit `feat(seo): P8 U0 contracts — llm_mention_snapshots + ai-visibility flag/job/event`.

---

# Wave 1 (parallel) — after U0

## Task U1: provider `getLlmMentions` + `parseLlmMentions`
**Files:** `server/providers/dataforseo-provider.ts`, `tests/unit/llm-mentions-parser.test.ts`. **Read first:** the fixture, P6 `getNationalSerp`/`parseNationalSerp` + `runDataForSeoOperation`/`getTaskResult`/`cleanDomain`/`cacheKeyPart` + the `CACHE_TTL_*` block.
- [ ] **Failing test** (`tests/unit/llm-mentions-parser.test.ts`) against `LLM_MENTIONS_AGG`: `parseLlmMentions(items, 'squareup.com')` → `mentions===2704`, `aiSearchVolume===58439`, `competitors` includes `{name:'Square',...}` (from `brand_entities_title`), `sourceDomains` includes `{domain:'squareup.com', mentions:1031}`, `shareOfVoice` ≈ `2704/(2704 + Σ competitor mentions)`; against `LLM_MENTIONS_AGG_EMPTY` → `mentions===0`, `shareOfVoice===0`, empty arrays.
- [ ] **Implement** pure `export function parseLlmMentions(items: unknown[], ownerDomain: string, platform: string): LlmMentionsResult` (defensive, never throws; read `items[0].total.{platform,brand_entities_title,sources_domain}`; group elements `{key, mentions, ai_search_volume}`; shareOfVoice = mentions/(mentions+Σ competitor.mentions) or 0) + `getLlmMentions(request, workspaceId)` reusing `runDataForSeoOperation` (endpoint `ai_optimization/.../llm_mentions/aggregated_metrics` — confirm the exact live path used by the MCP probe; body `[{ target:[{domain}], platform, location_name, language_code }]`; `CACHE_TTL_LLM_MENTIONS=336`; cache key domain+platform+location; 40204 → `markCapabilityDisabled`). Run → pass. typecheck + commit.

## Task U2: `llm-mentions-store`
**Files:** `server/llm-mentions-store.ts`, `tests/unit/llm-mentions-store.test.ts`. **Read first:** `server/serp-snapshots-store.ts` (template), `json-validation`, `stmt-cache`.
- [ ] **Failing round-trip test** (reuse the serp-snapshots-store harness; migration 155 auto-applies): store a snapshot (mentions 72, shareOfVoice 0.14, competitors [...], sourceDomains [...]) → `getLatestLlmMentions(ws)` returns it; JSON columns via `parseJsonSafeArray`; NULL mentions → undefined; upsert-not-duplicate on `(ws,date,platform)`; `getLlmMentionsTrend(ws)` date-ascending; workspace-scoped.
- [ ] **Implement** `LlmMentionSnapshotRow` + `LlmMentionSnapshot` + `rowToLlmMentionSnapshot` + `storeLlmMentionSnapshot(workspaceId, date, platform, data)` (transaction upsert) + `getLatestLlmMentions(workspaceId)` + `getLlmMentionsTrend(workspaceId, platform?)`. `createStmtCache`, workspace-scoped. Run → pass. typecheck + commit.

**→ Wave 1 diff-review checkpoint** (typecheck, both tests, single `parseLlmMentions`).

---

# Wave 2 — Task U3: job + route
**Files:** `server/llm-mentions.ts`, a strategy/SEO route file (find where strategy/rank routes live — `server/routes/`), `src/api/*`, `src/hooks/admin/*`, `tests/helpers/background-job-test-matrix.ts`. **Read first:** `server/national-serp.ts` (job template), the P6/P7 route gating, `workspaceProviderGeo`, `getLlmMentions`, `storeLlmMentionSnapshot`.
- [ ] `runLlmMentionsRefreshJob(workspaceId, jobId)`: resolve owner domain + tier (Growth+ defense no-op), `assertCreditBudget(workspaceId,'llm_mentions',tier)` observe-only, `getLlmMentions({domain, platform:'chat_gpt', ...geo})`, `storeLlmMentionSnapshot(today,'chat_gpt',result)`, broadcast `LLM_MENTIONS_SNAPSHOTS_REFRESHED`, `addActivity`, summary `{ mentions, shareOfVoice }`. Single call — keep cancel + budget wiring; `unregisterAbort` in finally.
- [ ] `POST /api/.../refresh-ai-visibility` (`requireWorkspaceAccess` only): flag→404, workspace→404, Growth+→403, observe-only budget, `hasActiveJob` per-ws+global→409, `createJob` → `registerAbort` → fire-and-forget `.catch` → `{ jobId }`.
- [ ] `localStrategy.refreshAiVisibility(ws)` api + `useAiVisibilityRefresh(ws)` hook (`trackJob(LLM_MENTIONS_REFRESH,…)` + invalidate the ai-visibility key). Matrix entry `[BACKGROUND_JOB_TYPES.LLM_MENTIONS_REFRESH]: entry('LLM_MENTIONS_REFRESH', {expectedLabel:'Refreshing AI visibility', expectedCancellable:true, expectedResultBehavior:'domain-store'}, 'tests/integration/ai-visibility-routes.test.ts')`.
- [ ] typecheck + pr-check + commit.

---

# Wave 3 (parallel) — Task U4 admin KPI ‖ Task U5 client KPI + slice
## U4: admin `AiVisibilityPanel`
**Files:** `src/components/strategy/AiVisibilityPanel.tsx` (+ mount), the read endpoint `GET /api/.../ai-visibility` (flag off → empty), `src/api/*`, `src/hooks/admin/*`, `src/lib/queryKeys.ts` (`aiVisibility` key). **Read first:** P7 `GbpReviewsPanel` (the read-endpoint + flag-gate + Four Laws pattern), `MetricRing`/`StatCard`, a trend/sparkline component.
- [ ] Read endpoint returns `{ latest, trend, competitors, sourceDomains }`. Panel: share-of-voice headline (MetricRing from `shareOfVoice*100` or StatCard), mention volume + trend sparkline, competitor share-of-voice list, source-domain AEO targets. `<TierGate>`/`<FeatureFlag flag="ai-visibility">`, blue data / score colors, **no purple**, flag-gated "Refresh AI visibility" button. Component test (mock flag + hooks). typecheck + build + pr-check + commit.

## U5: client KPI + intelligence slice
**Files:** a client Overview/Results component, an intelligence slice (`seo-context-slice.ts` or new) + `shared/types/intelligence.ts`. **Read first:** the client OverviewTab KPI pattern, `assembleLocalSeo`/`reviewSummary` (P7) as the slice template.
- [ ] Client KPI block (flag/tier gated, before/after framing, aggregates only, no purple) reading the ai-visibility endpoint. Extend a slice with `aiVisibility?: { mentions, shareOfVoice, topCompetitor?, topSourceDomain? }` populated from `getLatestLlmMentions`; append a line to the formatted block. typecheck + commit.

**→ UI diff-review checkpoint** (Four Laws grep on both surfaces = empty).

---

# Wave 4 — Task U6: tests + full gate
**Files:** `tests/integration/ai-visibility-routes.test.ts`; component-mock fixups. **Read first:** `tests/integration/local-gbp-routes.test.ts` (template).
- [ ] Integration: flag OFF→404, Free→403, Growth→jobId (poll to done + assert `job.type===LLM_MENTIONS_REFRESH`), seeded ai-visibility read → no 500. Add the new hook/flag mocks to any component test that now mounts the panel.
- [ ] **Full gate (sequential):** typecheck → vite build → `--project unit` → `--project component` → `--project contract` (MUST run) → pr-check → verify:feature-flags. Fix all. Commit.

---

# Verification + handoff
- [ ] **Scaled review** (parallel agents used): `scaled-code-review` over `git diff origin/staging...HEAD` — logic (share-of-voice math, empty→0, parser) · security (route gating, workspace-scoped SQL, aggregates-only no transcripts leak) · compliance (flag/job/event/migration lockstep, Four Laws, no requireAuth, KPI-only no insight) · edge cases (no data, no domain, flag-off byte-identical, cancel). Fix Critical/Important.
- [ ] **PR → staging**, watch CI green, merge.
- [ ] **Docs:** `FEATURE_AUDIT.md` (#533), `data/roadmap.json` (mark `seo-engine-p8-ai-visibility-llm-citation` done + notes + sort), `BRAND_DESIGN_LANGUAGE.md` (only if a new pattern).

---

## Self-review (plan vs spec)
**Coverage:** §A→U0 flag; §B→U1; §C→U0 migration + U2; §D→U3; §E→U4+U5; §F→U6. All covered.
**Placeholders:** the exact route file + the precise live `aggregated_metrics` endpoint path are resolved by reading code/the MCP probe in U1/U3 (noted, not guessed). Thresholds/constants named (CACHE_TTL_LLM_MENTIONS=336).
**Type consistency:** `LlmMentionsRequest`/`LlmMentionsResult`/`LlmMentionCompetitor`/`LlmMentionSource` (U0) → U1; `LlmMentionSnapshot`/`getLatestLlmMentions`/`getLlmMentionsTrend` (U2) → U3/U4/U5; `LLM_MENTIONS_REFRESH`/`LLM_MENTIONS_SNAPSHOTS_REFRESHED` (U0) → U3. Consistent.
