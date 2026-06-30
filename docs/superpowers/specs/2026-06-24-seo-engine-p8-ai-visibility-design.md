# SEO Decision Engine P8 — AI-Visibility / LLM Citation (Design Spec)

**Date:** 2026-06-24
**Roadmap item:** `seo-engine-p8-ai-visibility-llm-citation` (FINAL program phase)
**Pre-plan audit:** `docs/superpowers/audits/2026-06-24-seo-engine-p8-ai-visibility-audit.md`
**Fixture (validated API shapes):** `tests/fixtures/dataforseo-llm-mentions.ts`
**Depends on:** P4 (geo), P5 (credit-budget-gate). Closes the AEO loop that P3 opened (content production) with MEASUREMENT.

**Goal:** Measure whether the client is actually cited by LLMs — an "AI visibility" KPI (share-of-voice vs co-mentioned competitors + mention volume + a before/after trend + the source domains LLMs cite) — proving the existing AEO work pays off. A pure measurement layer behind the `ai-visibility` flag (Growth+, paid, observe-only budget). OFF = byte-identical.

---

## Locked decisions (from brainstorm, 2026-06-24)

1. **Data source = the mentions DATABASE only** (`ai_optimization/.../llm_mentions/aggregated_metrics`). No direct LLM prompting (deferred — the aggregate trend is the before/after proof; direct-prompt detection is fuzzy + per-call cost).
2. **Deliverable = KPI only.** A measurement dashboard (admin + client). No new recommendation or insight type — the AEO *actions* stay the existing `aeo-*` recs (P3). P8 proves they work.
3. **Headline KPI = share-of-voice** (own mentions ÷ (own + co-mentioned competitors)), alongside mention volume + trend + the source-domain AEO targets.
4. **Competitor set = the API's `brand_entities_title`** (the brands LLM answers co-mention — the *right* competitive set for AI share-of-voice; no manual config).
5. **Platform = `chat_gpt`** for v1 (Google AI mode = an easy follow-on; the endpoint takes a `platform` param).
6. **Cadence = manual trigger** for the phase (each refresh writes a dated snapshot → accrues the trend). Weekly automation deferred, consistent with P6/P7.
7. **Tier = Growth + Premium**, **budget = observe-only** `assertCreditBudget` (consistent with P5/P6/P7).

---

## Architecture

### A. Flag + gating (Wave 0)
`ai-visibility` in `FEATURE_FLAGS` + `FEATURE_FLAG_CATALOG` (lifecycle: owner `analytics-intelligence`, `createdAt`/`lastReviewedAt` = commit day, `rolloutTarget: staging-validation`, `linkedRoadmapItemId: seo-engine-p8-ai-visibility-llm-citation`, `staleAuditCadence: weekly`) + `FEATURE_FLAG_GROUPS['SEO Decision Engine']`. Lifecycle-anchor test. Route + UI gated Growth+ via `computeEffectiveTier` + `<TierGate>`/`<FeatureFlag>`.

### B. Provider (Wave 1)
- `getLlmMentions(request, workspaceId)` on `SeoDataProvider` (optional) + `DataForSeoProvider`, reusing `runDataForSeoOperation` (cache + `logCreditUsage` + credit/capability breakers), new `CACHE_TTL_LLM_MENTIONS = 336` (~14d — DB data is slow-moving). Request `{ domain, platform?, ownerBrandNames?, locationName?, languageCode? }` (P4 geo defaults). Endpoint `ai_optimization/.../llm_mentions/aggregated_metrics`, body `[{ target:[{ domain }], platform:'chat_gpt', location_name, language_code }]`. Capability breaker on 40204.
- Pure `parseLlmMentions(items, ownerDomain)` (fixture-grounded, exported, never throws): from `items[0].total`, read `platform[0].mentions` + `ai_search_volume` (headline); `brand_entities_title` → `competitors: { name, mentions, aiSearchVolume }[]`; `sources_domain` → `sourceDomains: { domain, mentions }[]`; derive `shareOfVoice = mentions / (mentions + Σ competitor.mentions)` (0 when no data). **Gotcha:** empty group arrays → `mentions: 0`, never invented.
- **Return** `LlmMentionsResult`: `{ domain, platform, mentions, aiSearchVolume, shareOfVoice, competitors: {name,mentions,aiSearchVolume}[], sourceDomains: {domain,mentions}[] }`.

### C. Data model — migration 155 (Wave 0)
`llm_mention_snapshots` time-series (mirrors `serp_snapshots`):
```
workspace_id    TEXT NOT NULL,
snapshot_date   TEXT NOT NULL,
platform        TEXT NOT NULL,             -- 'chat_gpt' (room for 'google')
domain          TEXT,
mentions        INTEGER,                    -- NULL/absent → treated as 0 by readers
ai_search_volume INTEGER,
share_of_voice  REAL,                       -- 0..1 (own ÷ own+competitors)
competitor_brands TEXT NOT NULL DEFAULT '[]', -- JSON [{name,mentions,aiSearchVolume}]
source_domains    TEXT NOT NULL DEFAULT '[]', -- JSON [{domain,mentions}]
fetched_at      TEXT NOT NULL,
PRIMARY KEY (workspace_id, snapshot_date, platform),
FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
```
Store `server/llm-mentions-store.ts` (`rowToLlmMentionSnapshot` mapper — `parseJsonSafeArray` for the two JSON columns, NULL→undefined; `storeLlmMentionSnapshot` transaction upsert; `getLatestLlmMentions(workspaceId)`; `getLlmMentionsTrend(workspaceId, platform?)` date-ascending for the chart). `createStmtCache`, workspace-scoped.

### D. Job + route (Wave 2)
- `LLM_MENTIONS_REFRESH: 'llm-mentions-refresh'` in `BACKGROUND_JOB_TYPES` + `BACKGROUND_JOB_METADATA` (`label: 'Refreshing AI visibility'`, `cancellable: true`, `resultBehavior: 'domain-store'`) + matrix entry → signal test.
- `runLlmMentionsRefreshJob(workspaceId, jobId)` (ported pattern: tier defense no-op, owner domain + brand name resolution, `assertCreditBudget(workspaceId,'llm_mentions',tier)` observe-only, `getLlmMentions`, `storeLlmMentionSnapshot(today)`, broadcast, activity, summary `{ mentions, shareOfVoice }`). Single call (one domain) — lightweight; no big loop, but keep cancel + budget wiring for consistency.
- `POST /api/strategy/:workspaceId/refresh-ai-visibility` (or under an existing SEO route group; `requireWorkspaceAccess` only): flag → workspace → Growth+ tier → observe-only budget → `hasActiveJob` (per-ws + global) → `createJob` → fire-and-forget → `{ jobId }`.
- `LLM_MENTIONS_SNAPSHOTS_REFRESHED: 'llm-mentions:snapshots_refreshed'` (server `ws-events.ts` + `src/lib/wsEvents.ts` mirror + centralized `wsInvalidation.ts` admin switch → the AI-visibility read query key + the relevant Strategy/intelligence keys + `useWsInvalidation.ts` + `platform-domain-event-definitions.ts`).

### E. KPI surface — the deliverable (Wave 3)
- Read endpoint `GET /api/strategy/:workspaceId/ai-visibility` (flag off → empty payload): `{ latest: snapshot|null, trend: snapshot[], competitors, sourceDomains }` from the store. Hook `useAiVisibility(workspaceId)` + api method + query key.
- **Admin** `AiVisibilityPanel` — share-of-voice headline (a `MetricRing` 0–100 from `shareOfVoice*100`, or a `StatCard`), mention volume + the trend (a sparkline/line chart from `trend`), the competitor share-of-voice breakdown, and the source-domain AEO targets. `<TierGate>`/`<FeatureFlag flag="ai-visibility">`, Four Laws (blue data, score colors, **no purple**), a flag-gated "Refresh AI visibility" button (`useLlmMentionsRefresh`). Mount on the Strategy surface.
- **Client** — a compact AI-visibility KPI on the Overview/Results tab framed as before/after proof (*"You're named in AI answers N times — X% share of voice in your category, up since we started."*). Aggregates only; flag/tier gated; client-narrative tone (no admin jargon, no purple).
- **Intelligence** — extend a slice (`seoContext` or a small `aiVisibility` summary) with `{ mentions, shareOfVoice, topCompetitor, topSourceDomain }` so AdminChat/AI context see it; append a line to the formatted block.

### F. Testing (Wave 4)
Fixture-grounded `parseLlmMentions` tests (incl. `LLM_MENTIONS_AGG_EMPTY` → 0/empty, share-of-voice math). Store round-trip (JSON columns, NULL→undefined, upsert, workspace-scoped). Integration `tests/integration/ai-visibility-routes.test.ts` (route gating flag OFF→404 / Free→403 / Growth→jobId + job-type assertion; seeded `ai-visibility` read → no 500). Component test for `AiVisibilityPanel` (mock the flag + hooks; share-of-voice + trend + competitor render). Full gate INCLUDING the contract project (`ws-invalidation-coverage`, `background-job-coverage`), `verify:feature-flags`, pr-check.

---

## Scaffolding lockstep (anti-silent-CI)
Flag (3 sites + lifecycle test) · job type (2 sites + matrix + signal test) · WS event (server + mirror + invalidation switch incl. the KPI's own query key + hook + platform-domain) · migration 155 + store mapper + public/client serialization. No new insight type (KPI-only) → no 7-part insight lockstep.

## Non-goals (deferred)
- Direct LLM prompting / question-level before/after proof (the aggregate trend suffices for v1).
- A new "get cited" recommendation or insight type (KPI-only; existing `aeo-*` recs are the actions).
- Google AI-mode platform (chat_gpt only for v1; `platform` column leaves room).
- Weekly cron automation (manual trigger accrues the trend; cron is a fast-follow).
- Hard budget enforcement (observe-only).

## Success criteria
- Flag OFF = byte-identical (no fetch, no UI, no snapshot).
- A refresh writes a dated `llm_mention_snapshots` row; repeated refreshes accrue the trend.
- Admin sees share-of-voice + mention volume + trend + competitor + source-domain breakdown; client sees the before/after KPI; both aggregates-only, Growth+ gated, no purple.
- AI-visibility summary reaches the intelligence slice / AdminChat.
- Full gate + contract project + feature-flags green; scaled review clean.
