# Workspace Intelligence — Reference

> Assembly system, slice architecture, caching, and extension rules.
> Source: `server/workspace-intelligence.ts` (public facade), `server/intelligence/` (slice implementations), `shared/types/intelligence.ts`, `server/intelligence-cache.ts`

---

## Overview

`WorkspaceIntelligence` is a single structured object assembled on-demand from all workspace data sources. It normalizes data from 20+ modules (keyword strategy, insights, outcome tracking, site health, client signals, etc.) into typed slices that AI prompts and API endpoints can consume without reaching into individual stores.

**Consumers:**

- `server/admin-chat-context.ts` — admin AI chat system prompt
- `server/routes/client-intelligence.ts` — client portal intelligence API (`ClientIntelligence` shape)
- `server/routes/intelligence.ts` — admin debug endpoint
- 20+ content/SEO generation modules via `buildIntelPrompt()` (briefs, rewrites, audits, brandscript, etc.)
- `server/schema-intelligence.ts` — schema-owned wrapper for schema planning, schema context, page elements, and site inventory reads
- `server/routes/public-portal.ts` — public workspace context
- `server/intelligence-crons.ts` — cache warming

The primary entry points are:

```ts
// Assemble raw intelligence object (for field access + prompt injection)
buildWorkspaceIntelligence(workspaceId, opts?): Promise<WorkspaceIntelligence>

// Assemble + format as a prompt string in one call
buildIntelPrompt(workspaceId, slices, opts?): Promise<string>

// Format a pre-assembled object as a prompt string
formatForPrompt(intelligence, opts?): string
```

---

## Slice Architecture

Each slice is independently assembled. A failed assembler logs a warning and leaves its slice as `undefined` — consumers must check for slice presence. All slices are optional on `WorkspaceIntelligence`.

| Slice key | Interface | Contents |
|---|---|---|
| `seoContext` | `SeoContextSlice` | Keyword strategy, brand voice (raw + authority-resolved), business context, personas, knowledge base, rank tracking, backlink profile, SERP features, strategy history, quick wins (roiScore), cannibalization issues, enriched content gaps (opportunityScore + trendDirection), top-opportunity OV breakdown (emvPerWeek is admin/AI-only — never serialized to a client surface) |
| `insights` | `InsightsSlice` | Stored analytics insights: `all` (top 100 by impact), `byType` (top 25 per type by impact — payload-size cap, G3), `countsByType` + `countsByTypeBySeverity` + `bySeverity` (full PRE-cap rollups — the only valid sources for counts; the type×severity matrix serves jointly-filtered totals like the client summary scrub), top by impact, optional page filter. Never compute counts from `all`/`byType` lengths. |
| `learnings` | `LearningsSlice` | Outcome tracking summaries, win rates by action type, ROI attributions, WeCalledIt entries, playbooks, scoring config |
| `pageProfile` | `PageProfileSlice` | Per-page keyword targeting, audit issues, optimization score, rank history, content/schema/link health — **only assembled when `opts.pagePath` is provided** |
| `contentPipeline` | `ContentPipelineSlice` | Brief/post/matrix counts, coverage gaps, decay alerts, cannibalization warnings, schema deployment, copy pipeline metrics |
| `siteHealth` | `SiteHealthSlice` | Audit score + delta, dead links, redirect chains, orphan pages, CWV pass rates, schema errors, anomaly count, recent diagnostic reports, AEO readiness |
| `clientSignals` | `ClientSignalsSlice` | Keyword feedback, content gap votes, business priorities, approval patterns, churn risk + signals, ROI, engagement metrics, intent signals, composite health score |
| `operational` | `OperationalSlice` | Recent activity, annotations, pending jobs, approval queue, recommendation queue, action backlog, time saved, work orders, insight acceptance rate |
| `pageElements` | `PageElementSlice` | Persisted per-page media, citations, CTAs, forms, schema hints — **only assembled when `opts.pagePath` is provided** |
| `siteInventory` | `SiteInventorySlice` | Webflow page/CMS inventory for schema and site-aware workflows — **only assembled when `opts.siteId` and `opts.siteBaseUrl` are provided** |
| `localSeo` | `LocalSeoSlice` | Local SEO markets, visibility snapshots, candidates, and sampled prompt block |
| `entityResolution` | `EntityResolutionSlice` | Typed entity grounding candidates/results for schema surfaces (`knowsAbout`, `about`, `mentions`, `areaServed`) |
| `brand` | `BrandSlice` | Unified brand voice — authority-resolved Layer-1 block (`voicePromptBlock`) **plus** Layer-2 voice DNA + guardrails (`voiceDnaBlock`, calibrated-only) — + approved identity (structured + `identityPromptBlock`). Read-only; non-formattable; assembled on request. Consumed by the MCP `prepare_*_context` path (P2): inject `voiceDnaBlock` + `identityPromptBlock` only — NEVER `voicePromptBlock` alongside `seoContext.effectiveBrandVoiceBlock` (double-voice). |

`shared/types/intelligence.ts` owns the registry constants:

- `INTELLIGENCE_SLICES` — every valid slice key. Facade defaults, API validation, and MCP validation must read from this.
- `OPTION_SCOPED_INTELLIGENCE_SLICES` — slices that need additional options and intentionally return `undefined` without them.
- `PROMPT_FORMATTABLE_INTELLIGENCE_SLICES` — slices accepted by `formatForPrompt()`/debug prompt output. `siteInventory` is intentionally excluded because it is structured data, not a prompt section.

Do not add local `VALID_SLICES` arrays in routes, MCP tools, tests, or consumers. Add the slice to the shared registry, then update assembler, formatter, route/MCP contract tests, and option-scoped tests together.

Requesting only the slices you need reduces assembly time:

```ts
const intel = await buildWorkspaceIntelligence(workspaceId, {
  slices: ['seoContext', 'insights'],
});
```

---

## Assembly Functions

Each assembler is an `async` function that loads data from modules via dynamic `import()`. Dynamic imports degrade gracefully — if a module or its DB table doesn't exist (e.g., older migration environments), the assembler catches the error, logs at `debug`, and returns a partial or default result.

| Assembler | Primary data sources |
|---|---|
| `assembleSeoContext` | `intelligence/seo-context-source.ts` (brand voice authority + knowledge/raw readers), `workspaces.ts` (keyword strategy, business context, personas, intelligence profile, business profile), `page-keywords.ts` (live page keyword map), `content-gaps.ts` (enriched content gaps), `quick-wins.ts` (quick wins + roiScore), `cannibalization-issues.ts`, `recommendations.ts` (`loadRecommendations` → top-opportunity OV breakdown), `rank-tracking.ts`, `strategy_history` table |
| `assembleInsights` | `analytics-insights-store.ts` (all workspace insights; `all` capped at 100 and `byType` at 25/type by impact score; `countsByType`/`bySeverity` computed pre-cap) |
| `assembleLearnings` | `workspace-learnings.ts`, `outcome-playbooks.ts`, `roi-attribution.ts`, `outcome-tracking.ts` (WeCalledIt, TopWins) — default-on, with typed empty/degraded availability states |
| `assemblePageProfile` | `page-keywords.ts`, `rank-tracking.ts`, `recommendations.ts`, `analytics-insights-store.ts`, `audit-page.ts`, `schema-validator.ts`, `site-architecture.ts`, `seo-change-tracker.ts`, `content-posts.ts`, `content-decay.ts`, `content-brief.ts` |
| `assembleContentPipeline` | `workspace-data.ts` (summary counts), `content-brief.ts`, `content-subscriptions.ts`, `schema-store.ts`, `content-matrices.ts`, `cannibalization-detection.ts`, `content-decay.ts`, `suggested-briefs-store.ts`, copy pipeline SQL via `copyStmts()` |
| `assembleSiteHealth` | `reports.ts` (audit snapshot), `performance-store.ts` (dead links, PageSpeed/CWV), `redirect-store.ts`, `site-architecture.ts` (orphan pages), `schema-validator.ts`, `anomaly-detection.ts`, `seo-change-tracker.ts`, `diagnostic-store.ts`, AEO review files |
| `assembleClientSignals` | `keyword_feedback` table, `content_gap_votes` table, `client_business_priorities` table, `churn-signals.ts`, `approvals.ts`, `client-users.ts`, `chat-memory.ts`, `activity-log.ts`, `roi.ts`, `requests.ts`, `client-signals-store.ts` |
| `assembleOperational` | `activity-log.ts`, `analytics-annotations.ts`, `annotations.ts`, `jobs.ts`, `usage-tracking.ts`, `approvals.ts`, `recommendations.ts`, `outcome-tracking.ts`, `outcome-playbooks.ts`, `work-orders.ts`, `analytics-insights-store.ts` |
| `assembleBrand` | `intelligence/seo-context-source.ts` (`buildEffectiveBrandVoiceBlock` authority-resolved voice block + `getRawBrandVoice` legacy detection), `voice-profile-read-model.ts` (`getVoiceProfile` calibration status), `brand-deliverable-read-model.ts` (`listDeliverables` → approved identity), `voice-dna-layer2.ts` (`voiceDNAToPromptInstructions` + `guardrailsToPromptInstructions` → `voiceDnaBlock`, calibrated-only). Leaf-import only — never `brand-identity.ts` or `voice-calibration.ts` (would close a facade cycle). |

The `siteHealth` assembler has a 5-second timeout. If it exceeds the timeout the slice is omitted rather than blocking the full assembly.

---

## Caching and Single-Flight

### LRU cache

```
Size: 200 entries
TTL: 5 minutes (INTELLIGENCE_CACHE_TTL)
Max staleness: 24 hours (entries older than 24 hours are evicted regardless of stale flag)
```

Cache keys encode all options that affect the assembled result:

```
intelligence:{workspaceId}:{sortedSlices}:{pagePath}:{learningsDomain}:site={siteId}:base={siteBaseUrl}:wf={tokenFingerprint}[:bl]
```

The `site`, `base`, and `wf` segments isolate `siteInventory` calls by Webflow site identity and token fingerprint without storing raw Webflow tokens in cache keys. The `:bl` suffix is appended only when `opts.enrichWithBacklinks` is true — backlink data requires a network call and must not be served from a non-backlink-enriched cache entry.

Schema consumers should use `buildSchemaIntelligence()` rather than calling slice assemblers or reading `ws.keywordStrategy` directly. That wrapper resolves workspace/site identity once, calls `buildWorkspaceIntelligence()` with schema-owned options, and exposes the resolved `seoContext.strategy`, `siteInventory`, `pageKeywords`, `pageElements`, and optional `entityResolution` surfaces.

### Single-flight deduplication

Concurrent calls with the same cache key share a single assembly `Promise`. A thundering-herd stampede (e.g., 10 parallel chat sessions for the same workspace) triggers one DB read, not ten. Implemented in `server/intelligence-cache.ts` via an `inflight` Map of in-progress promises.

### Partial-slice optimization

Callers that request only a subset of slices get a separately cached entry. This means a `['seoContext']` call and a full `ALL_SLICES` call have distinct cache keys and are assembled independently.

---

## `compositeHealthScore` Formula

Defined inline in `assembleClientSignals`. Exposed on `ClientSignalsSlice.compositeHealthScore` (0–100) and surfaced on `ClientIntelligence.compositeHealthScore` (Growth+ tier only).

**Weighted components:**

| Component | Weight | Score mapping |
|---|---|---|
| Churn | 0.4 | `high` → 0, `medium` → 30, `low` → 60, `null` → 100 |
| ROI | 0.3 | growth > 10% → 100, growth > 0 → 70, growth = 0 → 40, negative → 0 |
| Engagement | 0.3 | `daily` → 100, `weekly` → 70, `monthly` → 40, `inactive` → excluded |

**Normalization:** weights are summed only for components that loaded successfully. The score is only computed when at least 2 components are available (`components >= 2`). If fewer components loaded, `compositeHealthScore` is `null`.

```ts
if (components >= 2 && totalWeight > 0) {
  compositeHealthScore = Math.round(weightedSum / totalWeight);
}
```

The churn component is excluded if `listChurnSignals()` threw (e.g., table missing on older DB). This prevents a missing churn table from dragging all scores to 0.

---

## How to Add a New Data Source (mandatory rule)

Per CLAUDE.md data flow rule 6:

> Any new table or store that captures workspace activity must be surfaced in `server/intelligence/`. Each slice lives at `server/intelligence/<name>-slice.ts` and exports a single `assembleX(workspaceId, opts?)` function plus a typed interface. `server/workspace-intelligence.ts` is the public facade — call `buildWorkspaceIntelligence()` from there; do not call slice functions directly.

### Step-by-step pattern

**1. Add the field to the slice interface** (`shared/types/intelligence.ts`):

```ts
export interface ClientSignalsSlice {
  // ... existing fields ...

  /** New data source: count of unresolved escalations */
  escalationCount?: number;
}
```

Use `?` (optional) because the field may not be available on older DBs or when the module hasn't shipped yet.

**2. Read from the store in the assembler** (`server/intelligence/client-signals-slice.ts`):

```ts
export async function assembleClientSignals(workspaceId: string, _opts?: IntelligenceOptions): Promise<ClientSignalsSlice> {
  // ... existing assembly ...

  let escalationCount: number | undefined;
  try {
    const { getEscalationCount } = await import('../escalations.js');
    escalationCount = getEscalationCount(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: escalations optional, degrading gracefully');
  }

  return {
    // ... existing return fields ...
    escalationCount,
  };
}
```

**3. Choose the right slice:**

| Data type | Slice to use |
|---|---|
| Client-facing engagement signals | `clientSignals` (`ClientSignalsSlice`) |
| SEO keyword/strategy/rank data | `seoContext` (`SeoContextSlice`) |
| Content briefs/posts/matrices | `contentPipeline` (`ContentPipelineSlice`) |
| Site audit, CWV, dead links | `siteHealth` (`SiteHealthSlice`) |
| Tracked actions and outcomes | `learnings` (`LearningsSlice`) |
| Per-page analysis | `pageProfile` (`PageProfileSlice`) |
| Jobs, annotations, queues | `operational` (`OperationalSlice`) |

**4. Degrading gracefully is required.** Every new data source read must be wrapped in `try/catch` with `log.debug(...)`. Intelligence assembly must never throw — a missing table or renamed export must produce a partial result, not a 500.

**5. Dynamic imports for circular-dependency risk.** If the new module statically imports from `workspace-intelligence.ts`, use `await import('./your-module.js')` inside the assembler (not a top-level import). See the `anomaly-detection.ts` and `churn-signals.ts` patterns in the source.

---

## Cache Invalidation

### Explicit invalidation

```ts
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
invalidateIntelligenceCache(workspaceId);
```

This does three things:
1. Deletes all LRU entries with the `intelligence:{workspaceId}:` prefix
2. Invalidates the persistent sub-cache via `invalidateSubCachePrefix(workspaceId, '')`
3. Broadcasts `WS_EVENTS.INTELLIGENCE_CACHE_UPDATED` so frontend `useWorkspaceIntelligence` hooks invalidate their React Query cache

### When `invalidateIntelligenceCache` is called

It is called from 16+ locations on any mutation that changes workspace intelligence data, including:

- Keyword strategy changes (`routes/keyword-strategy.ts`, `routes/webflow-keywords.ts`)
- Voice calibration updates (`routes/voice-calibration.ts`)
- Brand identity / brandscript saves (`routes/brand-identity.ts`, `routes/brandscript.ts`)
- Copy pipeline writes (`routes/copy-pipeline.ts`)
- SEO edit application (`routes/webflow-seo-apply.ts`)
- Workspace settings updates (`routes/workspaces.ts`)
- Discovery ingestion completions (`routes/discovery-ingestion.ts`)
- Churn signal detection (`churn-signals.ts`)
- Anomaly detection (`anomaly-detection.ts`)
- Scheduled audits (`scheduled-audits.ts`)
- Outcome cron measurements (`outcome-crons.ts`)

### Natural TTL expiry

If no explicit invalidation occurs, entries expire after 5 minutes. Entries that are stale (marked but not yet evicted) are never served if older than 24 hours.

---

## Token Budget Priority Chain

When `opts.tokenBudget` is set, `formatForPrompt()` truncates slices in this order (lowest value dropped first):

1. Drop `operational`
2. Truncate `insights` to top 5
3. Drop `clientSignals`
4. Summarize `learnings` to one line
5. Drop `pageProfile`
6. Drop `siteHealth`
7. Drop `contentPipeline`
8. `seoContext` is never dropped

---

## Brand Voice Authority Rule

`SeoContextSlice` exposes two brand voice fields:

| Field | Use |
|---|---|
| `brandVoice` | Raw `workspace.brandVoice` text — for UI editing and diagnostics **only**. Never inject directly into prompts. |
| `effectiveBrandVoiceBlock` | Pre-formatted prompt block with voice-profile authority applied. Inject directly. Empty string when no brand voice is configured. |

Prompt callers must use `effectiveBrandVoiceBlock`. The raw field intentionally has no standalone format helper — any such helper would bypass the voice-profile authority chain. See CLAUDE.md "Authority-layered fields" rule.

---

## `pageProfile` Slice — Conditional Assembly

`assemblePageProfile` is only called when `opts.pagePath` is set. A request for `slices: ['pageProfile']` without a `pagePath` returns `undefined` for that slice — this is intentional and not a bug.

```ts
// Correct — page-specific analysis
const intel = await buildWorkspaceIntelligence(workspaceId, {
  slices: ['pageProfile', 'seoContext'],
  pagePath: '/blog/my-post',
});

// intel.pageProfile will be undefined — pagePath required
const intel = await buildWorkspaceIntelligence(workspaceId, {
  slices: ['pageProfile'],
});
```

---

## `ClientIntelligence` vs `WorkspaceIntelligence`

`ClientIntelligence` (`shared/types/intelligence.ts`) is a scrubbed, tier-gated view assembled in `server/routes/client-intelligence.ts` from a `WorkspaceIntelligence` object. It must never expose:

- `knowledgeBase`, `brandVoice`, `churnRisk`, `impactScore`
- `operational` slice
- Admin-only insight types (e.g., `strategy_alignment`)
- Bridge source tags

The `compositeHealthScore` field flows from `WorkspaceIntelligence.clientSignals.compositeHealthScore` into `ClientIntelligence.compositeHealthScore` — the formula lives in `assembleClientSignals`, not in the client route.

## `localSeo` Slice — Full Candidates for MCP, Sampled Prompt Block for AI

The `localSeo` slice (added 2026-05-21) is the canonical source of local SEO context for AdminChat, content/recommendation generation, and external MCP consumers.

**Two-layer design:**

- `candidates: ReadonlyArray<...>` — the FULL bounded candidate universe. Capped only by `LOCAL_CANDIDATE_HARD_CAP = 1000` in `server/local-seo.ts`. MCP consumers (`get_workspace_intelligence`) receive this entire array so external agents can analyze the full set programmatically.
- `effectiveLocalSeoBlock: string` — the pre-formatted prompt block. Stratified sample (top 8 per active market, capped at 50 total) so prompt tokens stay bounded even on hyper-local workspaces. **Per the authority-layered-fields rule, AI consumers inject this string directly** — never construct an alternate prompt block from `candidates`.

**Per-consumer integration:**

- **AdminChat** (`server/admin-chat-context.ts`) — slice included on `performance`/`general` question categories and when the question mentions local signals (local, near me, GBP, market, location, city).
- **Content generation** (`buildContentGenerationContext`) — slice included when the workspace has at least one active local market (cheap active-markets check via `listLocalSeoMarkets`). Content paths can further narrow via `selectRelevantLocalCandidates(slice, targetKeyword, limit)` exported from `server/intelligence/local-seo-slice.ts`, which boosts token-overlap and market-match candidates above unrelated higher-score ones so per-piece prompts only see locally relevant context.
- **Recommendation generation** (`buildRecommendationGenerationContext`) — same active-markets gate; uses the broader stratified sample (no relevance helper).
- **MCP** (`server/mcp/tools/intelligence.ts`) — `localSeo` is part of the default ALL slices and is accepted via the explicit `slices` arg. Returns the full slice JSON including the entire `candidates` array.

**Empty-but-valid baseline:** when the `local-seo-visibility` feature flag is off OR no markets are configured, the slice returns a typed object with empty arrays and a short explanatory `effectiveLocalSeoBlock`. Consumers never see `undefined`. Token cost on non-local workspaces is ~80 characters when the slice is requested.

**Market-scoped candidates:** `LocalSeoKeywordCandidate` is owned by `server/domains/local-seo/types.ts` and includes `marketId`, so the stratified sampler in `assembleLocalSeo` can group candidates by active market and the relevance helper can apply market-bonus scoring.
