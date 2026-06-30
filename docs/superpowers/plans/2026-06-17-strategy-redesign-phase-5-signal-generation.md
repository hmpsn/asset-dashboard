# Strategy Redesign — Phase 5: Signal Generation (freshness) — Implementation Plan

## Overview

Today the Strategy intelligence signals are computed **lazily** — only when a human loads `GET /api/public/insights/:id` with stale data, throttled to 24h, with **no cron**. Unviewed workspaces show stale/empty signals silently. Phase 5 makes signals stay fresh and makes staleness visible, plus fixes a "What Changed" misattribution bug. It's the only backend/cron phase of the redesign and is **not** gated by `strategy-decision-bands` (that flag is the band layout; this is signal freshness).

**Owning bounded context:** Analytics Intelligence (`server/analytics-intelligence.ts`, the insight store, crons, the background-job platform) + a small Strategy UI addition. **Grounding:** pre-plan audit `wf_ac49a0da-446` (8 agents) — every spec symbol verified against real code.

**Owner decisions (2026-06-17):**
- **Daily cron = conservative + kill-switch:** un-forced recompute (respects the 24h throttle, self-dedupes vs view-triggered), `hasRecentActivity(ws, 2)` gate, behind a new `signal-auto-recompute` feature flag (default OFF) so it's enabled after watching staging provider cost.
- **On-mutation = always enqueue the full recompute job** (every trigger: strategy edit, rank-snapshot, content publish), bounded by `hasActiveJob` dedup + apiCache's 15-min TTL. Also gated behind `signal-auto-recompute` (the automated paths dark-launch together).
- **Manual "Recompute now" + "Computed X ago" caption ship always-on** (manual = user-initiated, bounded).

---

## Key verified facts (corrections to the spec)

- `getOrComputeInsights(workspaceId, insightType?, { force? })` — `server/analytics-intelligence.ts:891`. The throttle entry (24h via `isStale(MAX(computed_at))`, L896–910). `force:true` bypasses it. **`computeAndPersistInsights` (L1115) is module-PRIVATE — do NOT export it; call `getOrComputeInsights(ws, undefined, {force:true})`** (it runs the full compute).
- `refreshContentDecayInsights(ws): Promise<void>` — `:934`, the scoped-refresher template. **Cheap ONLY because `loadDecayAnalysis` reads persisted data — no provider fetch.** Every *other* insight type derives from the GSC/GA4/SEMRush `Promise.all` (L1143–1171), so a "scoped" refresh of those is NOT cheap → must go through the job.
- `hasRecentActivity(workspaceId, withinDays=30)` — `server/activity-log.ts:327`. **Exists; reuse.** `withinDays` is interpolated as `-N days` in SQL → must be a positive integer. The 30-day window is for the cheap 6h LRU-warm cron; the daily *recompute* uses a tighter **2**.
- The existing 6h cron (`server/intelligence-crons.ts:runIntelligenceRefresh`) only warms the workspace-intelligence LRU via `buildWorkspaceIntelligence` — it does **NOT** recompute insights. The daily insight cron is net-new and SEPARATE (don't extend the 6h one — would 4× provider cost).
- `queueKeywordStrategyPostUpdateFollowOns({ workspaceId })` — `server/keyword-strategy-follow-ons.ts:68` — the **single shared hook reached by BOTH AI-regen AND the manual PATCH** (and content publish via `publish-post-to-webflow.ts:285`). Today only queues llms.txt + delayed rec regen. The on-mutation enqueue hooks here (one edit covers strategy edit + publish). Rank-snapshot is a separate hook in `rank-tracking-scheduler.ts`.
- `INTELLIGENCE_SIGNALS_UPDATED` (`server/ws-events.ts:65`) — broadcast from `insight-feedback.ts:43` (the `runFeedbackLoops` step), FE invalidates `queryKeys.admin.intelligenceSignals` at `src/lib/wsInvalidation.ts:265-267`. **Live-update half is COMPLETE — do NOT add a second broadcast/handler** (data-flow violation).
- The signals payload (`GET /api/webflow/keyword-strategy/:id/signals`, `keyword-strategy.ts:679`→`buildStrategySignals(getInsights(ws.id))`) carries **NO `computedAt`** today. `computedAt` IS on every `AnalyticsInsight` (store mapper `:111`). Thread `MAX(computedAt)` onto the response envelope — no new column/table.
- `strategy_history`: the ONLY production writer is `keyword-strategy-persistence.ts:190` (INSERT + LIMIT-5 prune, inside `writeKeywordStrategy`'s txn). The manual PATCH (`routes/keyword-strategy.ts:462`) does NOT snapshot → StrategyDiff misattributes human edits to the last regen. `StrategyDiff`/`/diff` read the latest history row — no read-side change needed.
- Background-job platform: `BACKGROUND_JOB_TYPES` + `BACKGROUND_JOB_METADATA` (`shared/types/background-jobs.ts`, lockstep) + `server/jobs.ts` (`createJob`/`updateJob`/`getJob`/`hasActiveJob`). Worker template: `server/recommendation-generation-job.ts`. Route template: `recommendations.ts:96-114` (POST → hasActiveJob reuse-or-create → `setTimeout(worker, 100)` → `{jobId}`). FE surfacing is AUTOMATIC via `useBackgroundTasks` + `NotificationBell` off the job label — no per-type FE code. **Verify** `BACKGROUND_JOB_TRANSITIONS` (`server/state-machines.ts`) permits `pending→error`/`running→error` (FM-2) before relying on it.

---

## PR split (3 sub-PRs → staging, each with a normal single-agent review)

| Sub-PR | Scope | Flag? |
|---|---|---|
| **5a — strategy_history snapshot on manual PATCH** | Extract a shared `snapshotStrategyHistory(...)` helper from `writeKeywordStrategy`; call it inside the PATCH `applyPatch` transaction so human edits create a history boundary. Fixes the StrategyDiff misattribution (spec §10). | none |
| **5b — Recompute job + manual "Recompute now" + "Computed X ago"** | New `INTELLIGENCE_RECOMPUTE` job type + worker (`getOrComputeInsights force:true` → feedback loop); POST recompute route (`{jobId}`); thread `computedAt` into the signals payload; IntelligenceSignals caption + Recompute button (always-on). | none |
| **5c — Automated recompute (cron + on-mutation), dark-launched** | Daily activity-gated cron (`hasRecentActivity(ws,2)` + staleness check → enqueue 5b's job); on-mutation enqueue from `queueKeywordStrategyPostUpdateFollowOns` (strategy edit + publish) + the rank-snapshot scheduler. All behind `signal-auto-recompute` (default OFF). | `signal-auto-recompute` |

Sequential: 5a (independent) → 5b (job foundation) → 5c (reuses 5b's job). Each merges before the next opens.

---

## Execution discipline (every task)
Per `docs/PLAN_WRITING_GUIDE.md`: READ the real code → write the failing test from the assertions → confirm red → implement minimally against real signatures → green + typecheck → commit. Never transcribe; if real code contradicts a contract here, STOP and report. Model ladder (Anthropic): Sonnet for the route/worker/UI tasks; Opus for the cron/on-mutation wiring (broadcast/txn/cost-sensitive) and review.

---

## Sub-PR 5a — strategy_history snapshot on manual PATCH

### Contracts
**New shared helper** in `server/keyword-strategy-persistence.ts` (co-located with the existing snapshot logic at L182–194), extracted and reused:
```ts
/** Snapshot the prior strategy state into strategy_history (capped to 5 rows). Idempotent-by-guard:
 *  no-ops when previousStrategy has no generatedAt (no boundary to record). Must be called INSIDE a
 *  db.transaction(), BEFORE the replaceAll*/upsert calls clobber the table-backed arrays. */
export function snapshotStrategyHistory(
  workspaceId: string,
  previousStrategy: StoredKeywordStrategy | undefined,
  priorArrays: { contentGaps; quickWins; keywordGaps; topicClusters; cannibalization; pageMap },
): void
```
- Body = the exact INSERT (`strategy_json` = prior blob **spread with the 5 table-backed arrays**, `page_map_json` = prior `listPageKeywords`, `generated_at` = **prior** `generatedAt`) + the LIMIT-5 prune (`persistence.ts:190,193`). Guard: only when `previousStrategy?.generatedAt` exists (mirror `:181`).
- Refactor `persistKeywordStrategy`/`writeKeywordStrategy` to call it (behavior-preserving — same SQL).

**Manual PATCH path** (`server/routes/keyword-strategy.ts:462`, `applyPatch` txn at `:466`): at the TOP of the transaction body, BEFORE the `replaceAll*`/`upsert` calls (`:469–485`), read the prior table-backed arrays (`listContentGaps`/`listQuickWins`/`listKeywordGaps`/`listTopicClusters`/`listCannibalizationIssues`/`listPageKeywords` — all already imported `:16-21`) + `ws.keywordStrategy`, and call `snapshotStrategyHistory(...)`. Use the **prior** `generatedAt`, not the new one stamped at `:507`. Stays inside the existing `db.transaction()` (pr-check txn rule).

### Tests (5a)
- Integration (extend `tests/integration/keyword-strategy-routes-extended.test.ts` — it already seeds strategy_history): PATCH-editing `siteKeywords` on a workspace with an existing blob creates a new `strategy_history` row whose `generated_at` = the PRIOR generatedAt; then `/diff` attributes the change to the new boundary (not the last regen). Table-only edit with no prior blob → no snapshot (guard).
- Unit: `snapshotStrategyHistory` no-ops without `previousStrategy.generatedAt`; prunes to 5; preserves the 5 table-backed arrays in `strategy_json`.

---

## Sub-PR 5b — Recompute job + manual trigger + freshness caption

### Contracts
**New job type** (`shared/types/background-jobs.ts`, BOTH maps in lockstep):
```ts
INTELLIGENCE_RECOMPUTE: 'intelligence-recompute'   // BACKGROUND_JOB_TYPES
// BACKGROUND_JOB_METADATA: { label: 'Refreshing signals', cancellable: false, resultBehavior: 'domain-store' }
```
Verify `BACKGROUND_JOB_TRANSITIONS` (`server/state-machines.ts`) allows `pending→error`/`running→error` (else `updateJob` swallows the FM-2 error status).

**New worker** `server/intelligence-recompute-job.ts` (model on `server/recommendation-generation-job.ts`):
```ts
export async function runIntelligenceRecomputeJob(jobId: string, workspaceId: string): Promise<void>
// guard getJob(jobId)?.status === 'cancelled'; updateJob(running, progress 0/100);
// await getOrComputeInsights(workspaceId, undefined, { force: true });  // exported, runs full compute + feedback loop
// addActivity(...); updateJob(done). catch → updateJob({status:'error', error}) (FM-2).
```
The feedback-loop step inside `getOrComputeInsights`/`runFeedbackLoops` already broadcasts `INTELLIGENCE_SIGNALS_UPDATED` → the card auto-invalidates. **Empty-signals edge case:** if a recompute yields 0 signals the broadcast doesn't fire (`insight-feedback.ts:43`) — the `JOB_UPDATED(done)` broadcast still reaches the FE; if the caption doesn't refresh in that case, fire a defensive invalidation or an unconditional completion event (decide at impl; prefer the existing event paths).

**New route** `POST /api/webflow/keyword-strategy/:workspaceId/signals/recompute` (`server/routes/keyword-strategy.ts`, `requireWorkspaceAccess`): `hasActiveJob(INTELLIGENCE_RECOMPUTE, ws.id)` reuse-or-create → `createJob(...)` → `setTimeout(() => void runIntelligenceRecomputeJob(jobId, ws.id), 100)` → `res.json({ jobId })`. (Admin route — never `requireAuth`.)

**Signals payload `computedAt`** (`keyword-strategy.ts:679` GET /signals + `useIntelligenceSignals.ts` `SignalsResponse`): add `computedAt?: string` to the envelope, sourced from `insights.length ? insights.reduce((n,i)=> i.computedAt>n?i.computedAt:n, insights[0].computedAt) : undefined` (mirror `analytics-intelligence.ts:902-905`). Return it on **both** the success branch and the fallback branch (and `undefined` in the catch) — missing the fallback silently drops it.

**IntelligenceSignals UI** (`src/components/strategy/IntelligenceSignals.tsx`): in the `SectionCard` **`action` slot** (right-aligned — NOT `titleExtra`, which is left-aligned and holds the count Badge), render: a muted "Computed {`timeAgo(data.computedAt)`} ago" caption (`src/lib/timeAgo.ts:20`; `t-caption-sm` carries no color → add `text-[var(--brand-text-muted)]`) + a teal "Recompute now" `Button` (Four Laws: action=teal) wired to a `useMutation` hook (`src/hooks/admin/`) that POSTs the recompute route then `trackJob(INTELLIGENCE_RECOMPUTE, jobId, ...)` via `useBackgroundTasks` (NotificationBell surfaces progress; no manual invalidate — the WS broadcast handles it). Disable the button while a job is active. No raw `fetch` in the component.

### Tests (5b)
- Worker FM-2: mock the provider/`getOrComputeInsights` to throw → assert the job ends `error` (not `done`). Happy path → `done` + insights upserted.
- Route: POST returns `{jobId}`; a second POST while active reuses the same job (`hasActiveJob`).
- Signals payload: `computedAt` present on success AND fallback branches; `undefined` on catch.
- Component: caption renders `timeAgo` when `computedAt` present, nothing when absent; Recompute button present + teal; clicking fires the mutation.

---

## Sub-PR 5c — Automated recompute (cron + on-mutation), behind `signal-auto-recompute`

### Contracts
**Feature flag** `signal-auto-recompute` (default `false`) added to `FEATURE_FLAG_CATALOG` (`shared/types/feature-flags.ts`) BEFORE the first 5c commit (bump the lifecycle as-of date). **Verify the server-side flag read** — find how `/api/feature-flags` resolves and whether there's a server `isFeatureEnabled(flag)` helper; if not, add a minimal server-side reader (the cron + on-mutation hooks are server-side). If no clean server flag read exists, fall back to an env kill-switch (`SIGNAL_AUTO_RECOMPUTE`) and document it. Manual recompute (5b) is NOT behind the flag.

**Daily cron** — new module `server/insight-recompute-cron.ts` (model structure on `intelligence-crons.ts`: module-level `DAILY_MS = 24*60*60*1000`, `let interval/startupTimeout/isRunning`, `.unref()`, re-entrancy guard):
```ts
async function runDailyInsightRecompute(): Promise<void>
//  if (!isSignalAutoRecomputeEnabled()) return;            // kill-switch
//  for (const ws of listWorkspaces()) {
//    if (!hasRecentActivity(ws.id, 2)) continue;           // cost gate (positive int)
//    const newest = MAX(getInsights(ws.id).computedAt);    // cheap DB read
//    if (!isStale(newest)) continue;                       // un-forced: skip fresh
//    if (hasActiveJob(INTELLIGENCE_RECOMPUTE, ws.id)) continue;
//    const { jobId } = createJob(INTELLIGENCE_RECOMPUTE, { workspaceId: ws.id });
//    void runIntelligenceRecomputeJob(jobId, ws.id);
//  }
export function startInsightRecomputeCron(): void
export function stopInsightRecomputeCron(): void
```
Register `start*` in `server/startup.ts` (alongside `startIntelligenceCrons` `:35`) AND the paired `stop*` in `server/index.ts:gracefulShutdown` **in the same commit** (start/stop symmetry is a hard convention — timers must clear before `db.close()`).

**On-mutation enqueue** (Q2: always enqueue) — a small shared helper `enqueueIntelligenceRecompute(workspaceId)` (guards on the flag + `hasActiveJob` dedup, then `createJob` + dispatch):
- **Strategy edit + content publish:** call it from `queueKeywordStrategyPostUpdateFollowOns` (`server/keyword-strategy-follow-ons.ts:68`) — covers regen + manual PATCH + publish in one place, runs post-commit (never inside the strategy txn — ai/provider work after commit, per the ai-call-before-db-write rule). NOTE: this hook has other callers (`outcome-crons.ts`, `content-requests.ts`) — confirm they should also trigger a recompute, or gate the enqueue to the strategy/publish call sites specifically.
- **Rank-snapshot reconciliation:** call it from `server/rank-tracking-scheduler.ts` after `storeRankSnapshot` (already a background context; the existing `lost_visibility` bridge stays — do NOT double-compute it).
- All enqueues are flag-gated + `hasActiveJob`-deduped. `apiCache` (15-min TTL) absorbs repeated provider pulls across near-simultaneous triggers.

### Tests (5c)
- Cron gating (no timers/ports — call `runDailyInsightRecompute` directly with seeded state): flag OFF → enqueues nothing; flag ON + `hasRecentActivity=false` → skips; flag ON + active + fresh (<24h) → skips; flag ON + active + stale → enqueues exactly one job; active job present → no duplicate.
- On-mutation: `enqueueIntelligenceRecompute` no-ops when flag OFF; enqueues when ON; dedupes via `hasActiveJob`.
- Feature-flag catalog: `npm run verify:feature-flags` clean (flag grouped + lifecycle date valid).

---

## Task dependency graph
```
5a (snapshotStrategyHistory + PATCH wiring)            → review → staging   [independent]
5b (job type → worker → route → signals computedAt → UI) → review → staging
     T1 job type + BACKGROUND_JOB_TRANSITIONS verify
       → T2 worker  → T3 route  ∥  T4 signals computedAt → T5 IntelligenceSignals UI
5c (after 5b merged):
     T1 signal-auto-recompute flag + server flag read
       → T2 daily cron (+ startup/shutdown wiring)  ∥  T3 enqueueIntelligenceRecompute + the 3 trigger hooks
     → review → staging
```

## File ownership (controller-built)
New: `server/intelligence-recompute-job.ts`, `server/insight-recompute-cron.ts`, the recompute route + UI hook. Shared/sequential: `shared/types/background-jobs.ts`, `shared/types/feature-flags.ts`, `server/keyword-strategy-persistence.ts`, `server/routes/keyword-strategy.ts`, `server/keyword-strategy-follow-ons.ts`, `server/rank-tracking-scheduler.ts`, `server/startup.ts`, `server/index.ts`, `src/components/strategy/IntelligenceSignals.tsx`, `src/hooks/admin/useIntelligenceSignals.ts`. Must-not-break: the live-update broadcast (don't add a second one); `computeAndPersistInsights` stays private; `upsertInsight` ON CONFLICT resolution-preservation.

## Systemic improvements
- **Shared helpers:** `snapshotStrategyHistory` (5a) + `enqueueIntelligenceRecompute` (5c) both extract duplicated logic per the "extract shared interaction patterns" rule.
- **pr-check:** none new required; existing rules (background-generation `// background-generation-ok`, broadcast-after-mutation, txn-guard, requireAuth-on-admin) all apply — honor them, don't suppress.
- **Server-side feature-flag read** — if 5c has to add one, that's reusable infra for future server-gated features.

## Verification (each sub-PR)
```
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
npm run verify:feature-flags   # 5c
git diff origin/staging...HEAD --name-only   # scope check before PR
```
Docs after each: `FEATURE_AUDIT.md`, `data/roadmap.json` (+ sort), `data/features.json` if client-relevant (Phase 5 is admin-facing). Manual: 5b — click "Recompute now", confirm NotificationBell job + caption updates; 5a — PATCH-edit a strategy, confirm What Changed attributes it correctly; 5c — flag ON in staging, watch one cron sweep + provider-call volume before enabling in prod.

## Out of scope / follow-ups
- Per-insight-type freshness (the caption uses workspace-wide MAX(computedAt) — matches the throttle).
- A persisted "last recompute" timestamp / `workspace.lastActiveAt` (no new tables; the activity log + insight `computed_at` suffice).
- Typed activity gate (gate on specific activity types vs any) — `hasRecentActivity(2)` is the v1; tighten to typed if a stray `note`/`chat` keeps dead workspaces "active".
