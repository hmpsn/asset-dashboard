# Client Insights Briefing Refactor — Pre-Plan Audit

**Date:** 2026-04-28
**Spec:** `docs/superpowers/specs/2026-04-28-client-insights-briefing-refactor-design.md`
**Audit method:** 6 parallel `Explore` agents covering: (1) approvals/pipeline patterns, (2) email + monthly-report convergence, (3) voice/AI authority, (4) candidate-pool sources, (5) client UI/NAV, (6) public portal + intelligence + types.

---

## TL;DR

The spec is implementable as written, but **8 spec assumptions need correction** before plan-writing. Most are minor (TTL number, exact field shapes). Three are structurally important:

1. **`weCalledIt` shape** — wider than spec; plan must consume the actual interface.
2. **Narrative endpoint** — does NOT call `generateMonthlyDigest`; calls `buildClientInsights` (`server/insight-narrative.ts`). Phase 4 plan changes accordingly.
3. **No `scrubClientIntelligence` function** — visibility is enforced by the response-formatter wrappers in `server/routes/client-intelligence.ts`. `latestBriefing: BriefingSummary | null` flows through automatically because `BriefingSummary` has no admin-only fields.

The infrastructure is ready: `broadcastToWorkspace`, `useWorkspaceEvents`, `addActivity`, `buildSystemPrompt`, `callAI`, `<TierGate>`, `parseJsonSafeArray`, `createStmtCache`, `validate(z.…)` all exist and are the correct primitives to reuse.

---

## Spec Corrections (apply during plan-writing)

| # | Spec claim | Reality | Action |
|---|---|---|---|
| 1 | "intelligence cache is workspace-level with 6h refresh" (§9 V9) | TTL is **5 min** — `INTELLIGENCE_CACHE_TTL = 5 * 60 * 1000` (`server/workspace-intelligence.ts:125`). Query-time, not cron-driven. | Plan can ignore the "is the cache stale on Monday afternoon" worry — every read assembles fresh data. Document the 5-min TTL in the freshness check. |
| 2 | `weCalledIt` shape `{ prediction: string; score: number; pageUrl?: string }` (§2) | Actual: `{ actionId: string; prediction: string; outcome: 'strong_win'; score: 'strong_win'; pageUrl: string; measuredAt: string; }` (`workspace-intelligence.ts:525-532`) | `BriefingStory` Win-category sourceRefs use `actionId` for traceability; recency basis is `measuredAt`; no numeric score to multiply with — actionability is a category multiplier only. |
| 3 | "`/api/public/insights/:workspaceId/narrative` calls `generateMonthlyDigest`" (§7 row, §9 V9) | Actually calls `buildClientInsights` from `server/insight-narrative.ts` (`server/routes/public-analytics.ts:124`). | Phase 4 narrative-endpoint replacement is **decoupled** from `monthly-digest.ts`. Plan re-targets the correct callsite. |
| 4 | "scrubClientIntelligence / public-portal serializer — confirm latestBriefing is automatically scrubbed" (§9 V4) | No `scrubClientIntelligence` function exists. Tier gating + per-formatter allowlists in `server/routes/client-intelligence.ts:33-179` handle visibility. `clientSignals` slice is excluded for `tier === 'free'` (line 145). | Since `BriefingSummary = { weekOf, publishedAt, storyCount, hasHero }` has no admin-only data, **no formatter changes needed** — adding `latestBriefing` to `ClientSignalsSlice` is sufficient. Document this in the plan so a worker doesn't add a redundant scrubber. |
| 5 | "Monday-only competitor cron" (§3) | `intelligence-crons.ts:88` — fires every 24h after a 15-min startup delay; runs only on **day 1 of week**. Output stored in `competitor_snapshots` (mig 070) and `competitor_alerts` (mig 071). Briefing reads competitor signals from `analytics_insights` rows where `insightType === 'competitor_alert'` (already upserted by the cron). | Plan reads from `analytics_insights` for competitive signals, not directly from competitor tables. Pre-flight freshness check uses `MAX(competitor_snapshots.created_at)` for the workspace. |
| 6 | "deep-link infrastructure already exists" / `?tab=` two-halves contract (§3, CLAUDE.md) | Client routing is **path-based**: `/client/:workspaceId/:tab` via `clientPath()`. `?tab=` is the admin-side pattern. CLAUDE.md's `?tab=` contract applies inside a tab page (e.g., sub-tabs like Inbox sub-sections). | `BriefingStory.drillIn = { page: ExplorePage; tab?: string; queryParams?: Record<string, string> }`. Renderer composes `${clientPath(wsId, page)}${tab ? '?tab=' + tab : ''}` plus optional query params. |
| 7 | "anomaly-detection.ts:506 — verify it routes through `buildSystemPrompt()`" (§9 V12) | Confirmed inconsistency: `anomaly-detection.ts:500-527` inlines the system prompt as a `messages[0]` with `role:'system'` and does NOT call `buildSystemPrompt`. No voice DNA injected. | **Out of scope** for this feature. Add a one-line note to the spec's §7 inventory and spawn a follow-up task. Briefing job uses `buildSystemPrompt` correctly; anomaly cleanup is unrelated. |
| 8 | `ClientTab` union covers all rendered tabs (§6) | `ClientTab = 'overview' \| 'performance' \| 'search' \| 'health' \| 'strategy' \| 'analytics' \| 'inbox' \| 'approvals' \| 'requests' \| 'content' \| 'plans' \| 'roi' \| 'brand'`. Missing `'content-plan'` and `'schema-review'` — current NAV bypasses TypeScript via `as ClientTab` casts (lines 437, 439). | Pre-existing tech debt. Plan **does not fix** this in Phase 3 NAV refactor (out-of-scope, but flagged for a follow-up task). NAV continues to use the casts. |

---

## Findings by Section

### A. Generation pipeline & approvals (briefing job + admin review)

| Topic | File:Line | Notes |
|---|---|---|
| **Migration counter** | `server/db/migrations/074-sent-reminders.sql` | Next migration: **`077-briefing-drafts.sql`** |
| **Approval batch state machine** | `server/approvals.ts:10`, `:148-167` | `validateTransition(...)` + `recalcBatchStatus(batch)` — derives batch status from item statuses. Briefing has simpler state (single doc per week), so we use a flat enum, not derived. |
| **Status enum (briefing — new)** | n/a | `'draft' \| 'approved' \| 'published' \| 'skipped'` per spec §4. We do NOT mirror approvals' `'pending' \| 'partial' \| 'approved' \| 'rejected' \| 'applied'`. |
| **Routes pattern** | `server/routes/approvals.ts:74-78,108-129,179-251` | GET list, PATCH status, DELETE retract, POST remind. Briefing routes mirror: GET drafts list, PATCH approve/edit/skip, POST publish, optional POST regenerate. |
| **Query keys** | `src/lib/queryKeys.ts:35,157` | Convention: `queryKeys.admin.<resource>(wsId)`, `queryKeys.client.<resource>(wsId)`. Add: `queryKeys.admin.briefingDrafts(wsId)`, `queryKeys.client.briefing(wsId)`. |
| **`broadcastToWorkspace` import** | `server/broadcast.ts:31-33` | `export function broadcastToWorkspace(workspaceId: string, event: string, data: unknown)`. Used pattern: `broadcastToWorkspace(wsId, WS_EVENTS.<NAME>, { …payload })`. |
| **`addActivity` signature** | `server/activity-log.ts:210` | `addActivity(workspaceId, type, title, description?, metadata?, actor?)`. New types to add: `'briefing_generated'`, `'briefing_published'`, `'briefing_skipped'`, `'briefing_auto_published'`. |
| **`parseJsonFallback` mapper** | `server/approvals.ts:46-76` | Existing pattern that "heals" historical bad rows. Briefing `rowToDraft` mirrors: `parseJsonSafeArray(row.stories, briefingStorySchema, 'briefing_drafts:stories')`. |
| **`createStmtCache` / `stmts()`** | (per CLAUDE.md) | All briefing DB access via `briefingStmts()` cache. No local `let stmt` variables. |
| **`useWorkspaceEvents` example** | `src/components/ClientDashboard.tsx:180-198`, `src/hooks/useWorkspaceEvents.ts:18-22` | Hook accepts `(wsId, handlers, identity?)`. Handlers map event-name → callback that invalidates a React Query key. |
| **`auto_publish_briefings` storage** | `server/workspaces.ts:64-69,148,295,400-410` | Existing per-workspace toggles (`analytics_client_view`, `auto_reports`, `auto_report_frequency`) live as **columns on `workspaces`**, NOT a settings table. Add two columns: `auto_publish_briefings INTEGER NOT NULL DEFAULT 0`, `auto_publish_after_hours INTEGER NOT NULL DEFAULT 24`. Map to `autoPublishBriefings: boolean`, `autoPublishAfterHours: number` in `Workspace` type. |
| **Feature flag naming** | `shared/types/feature-flags.ts` | Convention is **kebab-case**. Spec's `client_insights_briefing_v2` becomes **`client-briefing-v2`** (or `client-insights-briefing-v2`). Plan uses `client-briefing-v2`. |
| **WS_EVENTS additions** | `server/ws-events.ts` | Add: `BRIEFING_GENERATED: 'briefing:generated'`, `BRIEFING_PUBLISHED: 'briefing:published'`. |

### B. Voice & AI authority (briefing prompt construction)

| Topic | File:Line | Notes |
|---|---|---|
| **`buildSystemPrompt` signature** | `server/prompt-assembly.ts:131-178` | `buildSystemPrompt(workspaceId, baseInstructions, customNotes?)` — sync, returns `string`. Injects voice DNA + guardrails when `voice_profiles.status === 'calibrated'`. Briefing instructions are passed as `baseInstructions`. |
| **`callAI` signature** | `server/ai.ts:12-77` | `callAI({ provider?, model?, system?, messages, maxTokens?, temperature?, feature, workspaceId? })`. **Caller passes `system` in** — `callAI` does not call `buildSystemPrompt`. Briefing job: `const system = buildSystemPrompt(wsId, briefingInstructions); await callAI({ provider: 'anthropic', model: ..., system, messages: [...], feature: 'client-briefing', workspaceId: wsId });` |
| **`content-brief.ts` voice path** | `server/content-brief.ts:11,16,1205` | Uses `buildSystemPrompt()` ✓ — no inline duplication. Single Layer 2 authority confirmed. |
| **`copy-generation.ts` voice path** | `server/copy-generation.ts:7,103,105` | Uses `buildSystemPrompt()` ✓ via `callAnthropic` (not unified `callAI`). For the briefing job, prefer `callAI` (the canonical dispatcher per CLAUDE.md). |
| **`anomaly-detection.ts` voice path** | `server/anomaly-detection.ts:500-527` | **Inconsistency** — inlines `messages[0]` system role, no `buildSystemPrompt`. Out of scope; flag follow-up. |
| **`outcome-ai-injection` flag gate** | `server/monthly-digest.ts:120-146` | When OFF, omits `weCalledIt`/learnings injection but digest still generates. **Briefing decision:** respect the same flag — when OFF, skip the prediction-based Win-category injection but still generate the briefing from non-prediction sources. (Aligns with monthly-digest's "soft-degrade" pattern; consistent UX.) |
| **`assembleClientSignals` location** | `server/workspace-intelligence.ts:1086` | `async function assembleClientSignals(workspaceId, _opts?): Promise<ClientSignalsSlice>`. Has access to module-scoped DB statements. Latest-briefing read slots in after the engagement metrics block. |
| **`assembleLearnings` weCalledIt** | `server/workspace-intelligence.ts:458-567`, fields lines 525-532 | Returns `LearningsSlice` containing `weCalledIt: WeCalledItEntry[]` capped at 5 items, sorted by `measuredAt`. Source: `getActionsByWorkspace()` filtered to `outcomes.score === 'strong_win'`. |

### C. Candidate-pool data sources

| Source | Read function (file:line) | Type | Freshness predicate |
|---|---|---|---|
| `analytics_insights` | `getInsights(wsId, type?)`, `getUnresolvedInsights(wsId)` (`server/analytics-insights-store.ts:205,304`) | `AnalyticsInsight[]` | `computedAt > now - 8d`; `severity ∈ ('critical','warning')`; `resolutionStatus !== 'resolved'` |
| `recommendations` | `loadRecommendations(wsId): RecommendationSet \| null` (`server/recommendations.ts:272`) | `Recommendation[]` | `status === 'pending'`; `priority === 'fix_now'` for risks; `updatedAt > now - 14d` |
| `audit_schedules` snapshot | `getSchedule(wsId)` (`server/scheduled-audits.ts:65`) | `AuditSchedule` | `lastRunAt > now - 8d`; W/W delta = `lastScore` vs prior — **note: prior score is not stored long-term**, so audit-delta stories require a small history table OR computed inline from `audit_snapshots` if such exists (verify in plan). |
| `weCalledIt` predictions | `assembleLearnings(wsId)` then `.weCalledIt` (`server/workspace-intelligence.ts:458,521-532`) | `WeCalledItEntry[]` | `measuredAt > now - 30d`. Only `outcome === 'strong_win'` is included. |
| `competitor_alerts` | Read via `analytics_insights` rows where `insightType === 'competitor_alert'` (upserted by `intelligence-crons.ts:127`) | `AnalyticsInsight` | `computedAt > now - 8d`. Pre-flight uses `MAX(competitor_snapshots.created_at) > now - 8d`. |

**Materiality scoring** (per spec §2):
```
score = impact × recencyDecay × actionability
```
- `impact`: from `impactScore` (insights/recommendations); for `weCalledIt`, fixed weight (e.g., 60); for audit deltas, `|scoreDelta|` clamped 0–100.
- `recencyDecay`: `Math.exp(-daysOld / halfLifeDays)` where `halfLifeDays` is per-source (insights: 7, recs: 10, audit: 7, weCalledIt: 14, competitive: 7).
- `actionability` (multiplier): risk=1.5, opportunity=1.2, win=1.0, period_change=0.9, competitive=0.85.

### D. Client UI (Insights page rendering, NAV, TierGate, MonthlyDigest)

| Topic | File:Line | Notes |
|---|---|---|
| **OverviewTab section order** | `src/components/client/OverviewTab.tsx:107-474` | Welcome → HealthScoreCard → 5-stat row → action-needed banner → CTA banner → MonthlyDigest → IntelligenceSummaryCard → PredictionShowcaseCard → 3/5+2/5 grid (InsightsDigest left; Insights Engine + Content Opportunities right). Phase 2 replaces this entire body with the new briefing component. |
| **NAV array** | `src/components/ClientDashboard.tsx:430-443` | Up to 10 conditional entries. Phase 3 collapses to 4: Insights, Inbox, Plans, Explore (drawer). |
| **`isPaid` / `betaMode` derivations** | `ClientDashboard.tsx:418,425,429` | `effectiveTier = betaMode ? 'premium' : (ws?.tier \|\| 'free')`; `isPaid = effectiveTier !== 'free'`. **Recommendation for Free-tier gate:** use `effectiveTier === 'free'` (single check, includes betaMode override). |
| **`<TierGate>` props** | `src/components/ui/TierGate.tsx:21-31` | `{ tier, required, feature, teaser?, children, className?, compact?, roiValue?, onGateHit? }`. `TIER_LEVEL = { free: 0, growth: 1, premium: 2 }`. Briefing wraps in `<TierGate tier={effectiveTier} required="growth" feature="Weekly Briefing">`. |
| **MonthlyDigest** | `src/components/client/MonthlyDigest.tsx:11-33` | `{ workspaceId, tier }`; data via `useMonthlyDigest(wsId)`; gated by inner `<TierGate required="growth">`. **Phase 2 repurposes:** Free tier renders `<MonthlyDigest tier="growth" workspaceId={...}>` to bypass the gate; Premium/Growth path doesn't render it. (Or simpler: Free renders it directly inside its own free-tier branch with no `<TierGate>` wrapper around it. Plan picks the cleaner pattern.) |
| **ClientChatWidget** | `src/components/client/ClientChatWidget.tsx:20-29` | Exposes `ClientChatWidgetApi = { openChat(); askAi(q): Promise<void> }`. Quick-question buttons currently in `OverviewTab.tsx:361-396` — to relocate, add `quickQuestions?: string[]` prop to `ClientChatWidget` and render in collapsed-state header or initial-message area. |
| **`useWorkspaceEvents` invocation** | `ClientDashboard.tsx:180-198` | Existing 12-handler block; add `'briefing:published': () => refetchClient('briefing', '/api/public/briefing/${workspaceId}')`. |
| **Path-based deep linking** | `src/routes.ts:38-42` | `clientPath(workspaceId, tab?, betaMode?)` → `/client/:wsId/:tab`. `BriefingStory.drillIn` renderer: `${clientPath(wsId, page, betaMode)}${tab ? '?tab=' + tab : ''}${queryParams ? '&' + new URLSearchParams(queryParams) : ''}`. |
| **API client modules** | `src/api/` | 13 modules (intelligence.ts, content.ts, etc). New: **`src/api/briefing.ts`** for `getBriefing`, `getBriefingDrafts`, `approveBriefing`, `editBriefing`, `publishBriefing`, `regenerateBriefing`. |

### E. Public portal & intelligence integration

| Topic | File:Line | Notes |
|---|---|---|
| **`GET /api/public/workspace/:id` allowlist** | `server/routes/public-portal.ts:34-85` | Manually curated `res.json({ id, name, … })`. Adding `latestBriefing` requires explicit append. **Decision:** the briefing summary is delivered via a dedicated endpoint, not the workspace blob. So this list does NOT change. |
| **`GET /api/public/briefing/:wsId` (NEW)** | `server/routes/public-portal.ts` (new handler) | Returns the latest **published** `BriefingDraft` with `stories` parsed. Auth: respect `clientPortalEnabled` + `client_portal_password` like other public endpoints. Tier-gates: returns 402 (or 403) if `tier === 'free'`. |
| **`/api/public/insights/:wsId/narrative`** | `server/routes/public-analytics.ts:124` | Calls `buildClientInsights(wsId)` from `server/insight-narrative.ts`. **Phase 4 change:** for `tier !== 'free'` AND a published briefing exists for the current week, return briefing summary; else fall back to `buildClientInsights`. Path is independent from `monthly-digest.ts`. |
| **`scrubClientIntelligence`** | n/a | Function does not exist. Per-formatter allowlists handle visibility (`server/routes/client-intelligence.ts:36-132`). `BriefingSummary` has no admin-only fields → no formatter changes. |
| **`ClientSignalsSlice` add field** | `shared/types/intelligence.ts:219-242` | Add: `latestBriefing: BriefingSummary \| null` (no `?:` — make it explicit). Import: `import type { BriefingSummary } from './briefing.js'`. |
| **`ContextCategory`** | `server/admin-chat-context.ts:49-65` | No new category. `'client'` category already pulls `clientSignals` slice → briefing summary auto-surfaces in client-related chat questions. |
| **`assembleClientSignals` extension** | `server/workspace-intelligence.ts:1086` | After existing field assembly, add a `briefingStmts().latestPublished.get(wsId)` read; build `BriefingSummary` (or `null`); include in returned slice. |
| **Activity-log type registration** | `server/activity-log.ts:18-110` | Existing types include `brief_generated`, `brief_approved`. Add new types: `briefing_generated`, `briefing_published`, `briefing_skipped`, `briefing_auto_published` (separate from `brief_*` which are content-brief domain). |

### F. Email + monthly-report convergence (Phase 4)

| Topic | File:Line | Notes |
|---|---|---|
| **`monthly-report.ts` weekly-mode** | `server/monthly-report.ts:22,196-242,225-234` | 6h poll → if `autoReports && autoReportFrequency === 'weekly' && sent[wsId] !== currentWeek()`, calls `renderMonthlyReport()` → `sendEmail()`. **Does NOT call `generateMonthlyDigest`** — uses raw aggregated metrics. |
| **`notifyClient*` helpers** | `server/email.ts:159-185` | Pattern: `notifyClientBriefReady({ clientEmail, workspaceName, workspaceId?, topic, targetKeyword, dashboardUrl? })` → `queueEmail(makeEvent(...))`. Phase 1 adds `notifyClientBriefingReady({ clientEmail, workspaceName, workspaceId, weekOf, dashboardUrl })`. |
| **Email transport** | `server/email.ts:1-2,9-11,22-48` | nodemailer SMTP (not Resend/SendGrid). Env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME`. |
| **`autoReportFrequency` shape** | `shared/types/workspace.ts`, DB col `auto_report_frequency` | `'weekly' \| 'monthly'`, default `'monthly'`. Workspace column. No separate `briefing_email_enabled` toggle today — Phase 4 reuses `autoReports + autoReportFrequency === 'weekly'` as the gate. |

---

## Existing Coverage Verification

| Area | Coverage | Gaps |
|---|---|---|
| Activity logging | All 4 approval mutations log via `addActivity` (`server/routes/approvals.ts:216,222,242,326`) | New `briefing_*` activity types must be added to the union (line 18-110 of `activity-log.ts`). |
| WS event broadcast | `broadcastToWorkspace` is the single primitive; pr-check enforces it for workspace mutations | New `BRIEFING_GENERATED`/`BRIEFING_PUBLISHED` constants must be added to `WS_EVENTS`. |
| Frontend invalidation | `useWorkspaceEvents` is the workspace-scoped subscription primitive (per CLAUDE.md, `useGlobalAdminEvents` would not work) | `ClientDashboard.tsx:180-198` and `WorkspaceHome.tsx` (admin) need new handlers. |
| Voice DNA injection | `buildSystemPrompt` is the single Layer 2 authority for content-brief and copy-generation | Anomaly detection bypasses it (out of scope). Briefing must use `buildSystemPrompt` from day one. |
| Tier gating | `<TierGate>` covers UI; `tier !== 'free'` slice gating covers API responses | Briefing public endpoint must add an explicit tier check (responses formatter does not currently gate `latestBriefing` field — but slice itself is excluded for free tier). |
| Public-portal serialization (CLAUDE.md "DB column + mapper lockstep") | `server/routes/public-portal.ts:34-85` is explicit allowlist | Briefing uses a dedicated endpoint; workspace blob doesn't need editing. |
| pr-check enforcement | Existing rules cover: bare `JSON.parse`, missing `workspace_id` scoping, broadcast/handler pairing, `getOrCreate*` nullable returns, `text-green-400` use, format-helper-after-authority-layer | Recommend a NEW pr-check rule: "every `WS_EVENTS.<NAME>` server emit must have a frontend `useWorkspaceEvents` handler". Currently only documented in CLAUDE.md as Data Flow Rule #2 — not mechanized. (Out of scope for this feature; flag separately.) |

---

## Infrastructure Recommendations (extract to plan)

### Shared utilities to create

1. **`server/briefing-candidates.ts`** — collector functions:
   - `collectInsightCandidates(wsId, weekStart): InsightCandidate[]`
   - `collectRecommendationCandidates(wsId, weekStart): RecommendationCandidate[]`
   - `collectAuditDeltaCandidates(wsId, weekStart): AuditDeltaCandidate[]`
   - `collectWeCalledItCandidates(wsId, weekStart): PredictionCandidate[]`
   - `collectCompetitiveCandidates(wsId, weekStart): CompetitiveCandidate[]`
   - `scoreCandidates(all: Candidate[]): ScoredCandidate[]` (materiality)
   - `topNByMateriality(scored: ScoredCandidate[], n: 10): ScoredCandidate[]`

2. **`server/briefing-prompt.ts`** — single source of truth for the prompt:
   - `buildBriefingInstructions(): string` — returns the Markdown-tagged briefing instructions ("pick 3-5, tag exactly one as headline, write 2-sentence narrative, suggest 0-2 metric badges").
   - `briefingResponseSchema: z.ZodType<BriefingAIResponse>` — Zod schema validating the AI response (JSON contract).

3. **`server/briefing-store.ts`** — DB layer:
   - `briefingStmts()` cache with: `insertDraft`, `getDraftByWeek(wsId, weekOf)`, `latestPublished(wsId)`, `listDrafts(wsId, limit?)`, `updateDraftStatus`, `updateDraftStories`, `markPublished`, `markSkipped`.
   - `rowToBriefing(row): BriefingDraft` mapper using `parseJsonSafeArray(row.stories, briefingStorySchema, 'briefing_drafts:stories')`.
   - `upsertDraft(input): BriefingDraft` — UNIQUE constraint on `(workspace_id, week_of)` enables idempotent rerun.

4. **`server/briefing-cron.ts`** — schedule + pre-flight + dispatch:
   - `startBriefingCron()` — registered from `server/startup.ts`. Internally a `setInterval` polling on a fixed cadence (consistent with `monthly-report.ts` and `intelligence-crons.ts` patterns) checking `if (it's now ≥ Monday 14:00 UTC && !alreadyRanThisWeek) { runForAllEligibleWorkspaces() }`.
   - `runBriefingForWorkspace(wsId, opts?)` — exported for manual admin trigger.
   - Pre-flight uses freshness checks per Section C.

5. **`server/email-templates.ts`** — extension:
   - `renderBriefingReadyEmail({ workspaceName, weekOf, dashboardUrl, storyCount, heroHeadline })` — mirrors `renderMonthlyReport`'s pattern but for the new "your briefing is ready" notification.

### pr-check rules to add

1. **`briefing_drafts.stories` JSON parse must use `parseJsonSafeArray`** — pattern-based: any `JSON.parse(<x>.stories)` in `briefing-store.ts` fails. Mechanizes the existing CLAUDE.md "bare `JSON.parse` on DB columns" rule for this specific column.
2. **`briefing-candidate-refresh` bridge must follow bridge authoring rules** — applies the existing pr-check rule for bridges (per `docs/rules/bridge-authoring.md`).

(These are small additions; full mechanization deferred to post-Phase-1 PR if time allows.)

### Tests required

| Test | File | Type |
|---|---|---|
| Briefing store rowToDraft round-trip + bad-row healing | `tests/unit/briefing-store.test.ts` | unit |
| Materiality scoring properties (recency monotone, actionability rank) | `tests/unit/briefing-candidates.test.ts` | unit |
| Cron runs for eligible workspaces only (skips free, defers stale) | `tests/integration/briefing-cron.test.ts` | integration (port 13320) |
| Admin draft list/approve/edit/publish/skip lifecycle | `tests/integration/briefing-routes.test.ts` | integration (port 13321) |
| Public briefing endpoint tier gating + pw protection | `tests/integration/briefing-public.test.ts` | integration (port 13322) |
| `assembleClientSignals` includes `latestBriefing` after publish; null before | `tests/integration/intelligence-briefing-slice.test.ts` | integration (port 13323) |
| `useWorkspaceEvents` handler invalidates `client-briefing` query on `briefing:published` | `tests/contract/briefing-ws-handler.test.ts` | contract |
| `buildSystemPrompt` invoked with `briefingInstructions` (voice DNA injected when calibrated) | `tests/unit/briefing-prompt.test.ts` | unit (mock voice profile) |
| Tab deep-link wiring: drillIn render produces correct path | `tests/contract/briefing-deep-link.test.ts` | contract |
| AI response Zod schema rejects missing-field / extra-field payloads | `tests/unit/briefing-response-schema.test.ts` | unit |
| Briefing-published email rendering | `tests/unit/briefing-email.test.ts` | unit |

(All integration tests use unique ports per CLAUDE.md rule.)

### Documentation updates

- `FEATURE_AUDIT.md` — new entry per phase. Phase 1 entry: "Weekly Briefing — Generation Pipeline (dark-launched)".
- `data/roadmap.json` — sprint entry per phase, marked `pending` → `done` per phase.
- `BRAND_DESIGN_LANGUAGE.md` — Phase 2 entry: "magazine briefing layout" (hero card + divider rows + amber action strip + inline metric badges). Confirm color use: amber for action strip, teal for hero accent + inline-metric badges, category icons for divider rows.
- `data/features.json` — client-impactful feature; entry added in Phase 2 (when client visibility ships).
- `docs/rules/automated-rules.md` — regenerate via `npm run rules:generate` if pr-check rules added.
- New: `docs/rules/briefing-pipeline.md` — feature-specific reference doc covering candidate-pool contracts, prompt schema, AI-response validation, and the freshness-check pre-flight (per CLAUDE.md "feature-specific guardrails before first commit" rule for multi-phase features).
- Per-phase acceptance checklists embedded in plan task list.

---

## Parallelization Strategy

### Per-phase PR boundaries (CLAUDE.md "phase-per-PR" rule)

```
PR 1 (Phase 1) → staging → main : Generation pipeline (dark-launched, no client UI)
PR 2 (Phase 2) → staging → main : Client Insights page rendering (flag-gated)
PR 3 (Phase 3) → staging → main : Navigation simplification (flag-gated)
PR 4 (Phase 4) → staging → main : Email + narrative-endpoint convergence (post-soak)
```

Each PR ships independently. The feature flag `client-briefing-v2` keeps the in-progress state hidden from production until Phase 2 lands behind the flag, Phase 3 lands behind the flag, and Phase 4 flips the default.

### Phase 1 — Generation pipeline (PR 1)

```
Pre-batch (sequential, MUST commit before any parallel work):
  T1.0  Migration 077-briefing-drafts.sql + workspace columns                 [haiku]
  T1.1  shared/types/briefing.ts (BriefingStory, BriefingDraft, BriefingSummary, BriefingCategory, ExplorePage) [haiku]
  T1.2  shared/types/feature-flags.ts add 'client-briefing-v2'                 [haiku]
  T1.3  shared/types/activity.ts add 4 new activity types                      [haiku]
  T1.4  server/ws-events.ts add BRIEFING_GENERATED, BRIEFING_PUBLISHED         [haiku]
  T1.5  server/briefing-store.ts (full DB layer + rowToDraft + Zod schema)     [sonnet]
  T1.6  server/briefing-prompt.ts (instructions + response schema)             [opus]

Parallel batch A (after pre-batch commits):
  T1.7  server/briefing-candidates.ts (5 collectors + scoring)        [sonnet]   // owns: briefing-candidates.ts
  T1.8  server/email.ts notifyClientBriefingReady + email-templates.ts render   [haiku]   // owns: email.ts (additions only), email-templates.ts (additions)
  T1.9  server/routes/briefing.ts (admin routes: list/approve/edit/publish/skip/regenerate) [sonnet]   // owns: server/routes/briefing.ts
  T1.10 server/routes/public-portal.ts add GET /api/public/briefing/:wsId      [sonnet]   // owns: NEW handler block in public-portal.ts (sequential file, run alone)

Sequential after batch A:
  T1.11 server/app.ts register routes/briefing.ts                              [haiku]
  T1.12 server/briefing-cron.ts + register from server/startup.ts              [opus]    // pre-flight + AI dispatch + bridge integration
  T1.13 server/scheduled-audits.ts add bridge-fire 4: briefing-candidate-refresh [sonnet]

Parallel batch B (frontend admin review, after T1.11):
  T1.14 src/api/briefing.ts (typed client wrappers)                            [haiku]
  T1.15 src/hooks/admin/useBriefingDrafts.ts + admin invalidation hook         [haiku]
  T1.16 src/components/admin/BriefingReviewQueue.tsx (mirrors PendingApprovals UX) [sonnet]
  T1.17 Wire admin route in WorkspaceHome.tsx (or wherever admin Insights tab lives) [sonnet]

Sequential verification:
  T1.18 Tests for briefing-store, briefing-candidates, briefing-prompt schema  [sonnet]
  T1.19 Integration tests for cron, routes, public endpoint                    [sonnet]
  T1.20 docs updates (FEATURE_AUDIT, roadmap, briefing-pipeline.md)            [haiku]
```

### Phase 2 — Client Insights page rendering (PR 2)

```
Pre-batch:
  T2.0  shared/types/intelligence.ts add ClientSignalsSlice.latestBriefing     [haiku]
  T2.1  server/workspace-intelligence.ts assembleClientSignals reads briefing  [sonnet]

Parallel batch A:
  T2.2  src/components/client/Briefing/ActionQueueStrip.tsx                    [sonnet]
  T2.3  src/components/client/Briefing/HeroStoryCard.tsx                       [sonnet]
  T2.4  src/components/client/Briefing/SecondaryStoryRow.tsx                   [sonnet]
  T2.5  src/components/client/Briefing/FreeTierUpgradeCTA.tsx                  [haiku]

Sequential:
  T2.6  src/components/client/Briefing/InsightsBriefingPage.tsx (composes A above + flag gate + free-tier branch) [sonnet]
  T2.7  src/components/client/OverviewTab.tsx flag-conditional swap            [sonnet]
  T2.8  src/components/client/ClientChatWidget.tsx accept quickQuestions prop  [haiku]
  T2.9  src/hooks/client/useClientBriefing.ts                                  [haiku]
  T2.10 useWorkspaceEvents handler addition in ClientDashboard.tsx             [haiku]

Sequential verification:
  T2.11 Tests: contract test for deep-link, integration test for slice include [sonnet]
  T2.12 Visual check on staging (one workspace, real briefing)
```

### Phase 3 — Navigation simplification (PR 3)

```
Sequential (single agent, low parallelism):
  T3.0 src/components/client/ExploreDrawer.tsx                                  [sonnet]
  T3.1 src/components/ClientDashboard.tsx NAV array reduced to 4 + drawer wired [sonnet]
  T3.2 Flag-gated render path (when off, render existing 10-tab NAV)            [sonnet]
  T3.3 Tests for drawer keyboard nav + flag-off fallback                        [sonnet]
```

### Phase 4 — Email + narrative endpoint (PR 4)

```
Sequential:
  T4.0 server/monthly-report.ts: weekly-frequency Premium/Growth replaces metrics email with notifyClientBriefingReady [sonnet]
  T4.1 server/routes/public-analytics.ts /narrative: paid-tier returns latest briefing summary [sonnet]
  T4.2 Flip 'client-briefing-v2' default to true                                [haiku]
  T4.3 Retire the §7-table components (delete files + references)               [sonnet]
  T4.4 docs cleanup + cleanup-PR scheduling (+2 weeks for flag removal)         [haiku]
```

---

## Model Assignments Summary

| Task type | Model | Examples |
|---|---|---|
| Migration SQL, type additions, barrel exports, route registration | `haiku` | T1.0–T1.4, T2.0, T4.2 |
| Service layers, route handlers, React components | `sonnet` | T1.5, T1.7, T1.9, T1.13, T2.2-T2.7, T3.0-T3.3 |
| Prompt engineering, cron orchestration, materiality scoring authority | `opus` | T1.6, T1.12 |
| Spec compliance + code quality reviewers | `opus` | post-batch reviews |

---

## File Ownership Matrix (Phase 1 example)

| Task | Owns (modify freely) | May read but NOT modify |
|---|---|---|
| T1.5 briefing-store | `server/briefing-store.ts` (new) | `shared/types/briefing.ts` (T1.1), `server/db.ts`, `server/db/migrations/` |
| T1.6 briefing-prompt | `server/briefing-prompt.ts` (new) | `server/prompt-assembly.ts`, `server/ai.ts` |
| T1.7 briefing-candidates | `server/briefing-candidates.ts` (new) | `analytics-insights-store.ts`, `recommendations.ts`, `scheduled-audits.ts`, `workspace-intelligence.ts` |
| T1.8 email helpers | `server/email.ts` (additions only — append `notifyClientBriefingReady`), `server/email-templates.ts` (append `renderBriefingReadyEmail`) | All other files |
| T1.9 admin routes | `server/routes/briefing.ts` (new) | `server/briefing-store.ts`, `server/middleware/validate.ts`, `server/middleware/requireWorkspaceAccess.ts` |
| T1.10 public portal | `server/routes/public-portal.ts` (single new handler block, between existing handlers — must coordinate) | All other files |
| T1.12 cron | `server/briefing-cron.ts` (new), `server/startup.ts` (single import + call) | `server/briefing-store.ts`, `server/briefing-candidates.ts`, `server/briefing-prompt.ts`, `server/ai.ts`, `server/prompt-assembly.ts` |
| T1.13 audit bridge | `server/scheduled-audits.ts` (single bridge-fire addition near lines 146/182/235) | `server/briefing-store.ts` |

---

## Phase 1 Verification Strategy

| Verification | Command / approach |
|---|---|
| Migration applies cleanly + workspace columns added | `sqlite3 data/dashboard.db ".schema briefing_drafts"` and `.schema workspaces \| grep auto_publish` |
| Type contracts shared correctly | `npm run typecheck` passes |
| Manual cron trigger generates a briefing | `curl -X POST http://localhost:3000/api/briefing/:wsId/generate-now` (admin auth header) |
| AI response shape matches Zod schema | unit test `tests/unit/briefing-response-schema.test.ts` |
| Pre-flight defers correctly when stale | unit test in `tests/unit/briefing-cron.test.ts` mocking `getSchedule` to return stale `lastRunAt` |
| Bridge fires on audit completion | integration test `tests/integration/briefing-cron.test.ts` simulates audit complete, verifies candidate-pool freshness mark |
| WS broadcast pair works | `tests/contract/briefing-ws-handler.test.ts` |
| `outcome-ai-injection=false` softly degrades briefing | unit test toggling flag, asserting predictions block omitted from prompt context but generation proceeds |
| Voice DNA injected when profile calibrated | unit test in `tests/unit/briefing-prompt.test.ts` mocking voice profile |
| Activity log entries written | integration test asserting `briefing_published` row in `activity_log` after publish |
| Admin review UI: status badges, expand/collapse, retract, remind | manual visual check + Playwright smoke if time |
| Full quality gates | `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts` |

---

## Open Questions for the User (resolve before plan-writing finalizes)

1. **Briefing AI provider preference** — `callAI` defaults to OpenAI. The spec mentions "creative prose" which CLAUDE.md routes to Anthropic. **Recommend:** explicit `provider: 'anthropic', model: 'claude-sonnet-4-20250514'` (matches `copy-generation.ts` precedent for editorial tone). Confirm before finalizing T1.12.

2. **`outcome-ai-injection` strict gating** — when flag is OFF, do we (a) skip the briefing entirely (consistent with strong-degrade) or (b) generate without weCalledIt predictions (consistent with monthly-digest soft-degrade)? **Recommend (b)** — soft degrade. Confirm before finalizing T1.12.

3. **Free-tier briefing visibility timing** — Phase 2 shows free-tier upgrade CTA + repurposed `MonthlyDigest`. The `MonthlyDigest` itself is gated by an inner `<TierGate required="growth">`. **Decision needed:** for Free, do we (a) bypass the inner gate by passing `tier="growth"` as a fake-up, or (b) refactor `MonthlyDigest` to accept a `bypassTierGate?: boolean` prop, or (c) extract the `MonthlyDigestContent` body into a non-gated component and have both Free and the gated path import it? **Recommend (c)** — cleaner separation. Confirm before T2.5/T2.6.

4. **Phase 1 admin review entry point** — does the admin briefing review queue land on the workspace home page (`WorkspaceHome.tsx`), the existing approvals area, or a new admin route `/ws/:id/briefing-review`? **Recommend:** new section on `WorkspaceHome.tsx` (alongside `<PendingApprovals>`), since briefing review is workspace-scoped admin work that should be visible at a glance. Confirm before T1.17.

5. **Cron storage of "last run this week"** — `monthly-report.ts` uses an in-memory `sent[wsId] = currentWeek()` map; this is NOT persistent across restarts. **Decision:** for the briefing job, should we (a) reuse the in-memory pattern (acceptable since restarts are rare and the cron polls every Monday afternoon), or (b) persist `last_briefing_run_week_of` on the workspace row? **Recommend (b)** — durability matters for a once-weekly process. Adds one column to migration 077.

---

## Hand-off

This audit is complete. **Next step:** present these findings to the user for review (especially the 5 open questions and the 8 spec corrections), get answers, then write the implementation plan with verified scope.
