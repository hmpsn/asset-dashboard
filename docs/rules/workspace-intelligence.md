# Workspace Intelligence — Reference

> Assembly system, slice architecture, caching, and extension rules.
> Source: `server/workspace-intelligence.ts`, `shared/types/intelligence.ts`, `server/intelligence-cache.ts`

---

## Overview

`WorkspaceIntelligence` is a single structured object assembled on-demand from all workspace data sources. It normalizes data from 20+ modules (keyword strategy, insights, outcome tracking, site health, client signals, etc.) into typed slices that AI prompts and API endpoints can consume without reaching into individual stores.

**Consumers:**

- `server/admin-chat-context.ts` — admin AI chat system prompt
- `server/routes/client-intelligence.ts` — client portal intelligence API (`ClientIntelligence` shape)
- `server/routes/intelligence.ts` — admin debug endpoint
- 20+ content/SEO generation modules via `buildIntelPrompt()` (briefs, rewrites, audits, brandscript, etc.)
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
| `seoContext` | `SeoContextSlice` | Keyword strategy, brand voice (raw + authority-resolved), business context, personas, knowledge base, rank tracking, backlink profile, SERP features, strategy history |
| `insights` | `InsightsSlice` | All stored analytics insights grouped by type/severity, top by impact, optional page filter |
| `learnings` | `LearningsSlice` | Outcome tracking summaries, win rates by action type, ROI attributions, WeCalledIt entries, playbooks, scoring config |
| `pageProfile` | `PageProfileSlice` | Per-page keyword targeting, audit issues, optimization score, rank history, content/schema/link health — **only assembled when `opts.pagePath` is provided** |
| `contentPipeline` | `ContentPipelineSlice` | Brief/post/matrix counts, coverage gaps, decay alerts, cannibalization warnings, schema deployment, copy pipeline metrics |
| `siteHealth` | `SiteHealthSlice` | Audit score + delta, dead links, redirect chains, orphan pages, CWV pass rates, schema errors, anomaly count, recent diagnostic reports, AEO readiness |
| `clientSignals` | `ClientSignalsSlice` | Keyword feedback, content gap votes, business priorities, approval patterns, churn risk + signals, ROI, engagement metrics, intent signals, composite health score |
| `operational` | `OperationalSlice` | Recent activity, annotations, pending jobs, approval queue, recommendation queue, action backlog, time saved, work orders, insight acceptance rate |

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
| `assembleSeoContext` | `seo-context.ts` (keyword strategy, brand voice, business context), `page-keywords.ts` (live page keyword map), `rank-tracking.ts`, `workspaces.ts` (intelligence profile, business profile), `strategy_history` table |
| `assembleInsights` | `analytics-insights-store.ts` (all workspace insights, capped at 100 by impact score) |
| `assembleLearnings` | `workspace-learnings.ts`, `outcome-playbooks.ts`, `roi-attribution.ts`, `outcome-tracking.ts` (WeCalledIt, TopWins) — **gated by `outcome-ai-injection` feature flag** |
| `assemblePageProfile` | `page-keywords.ts`, `rank-tracking.ts`, `recommendations.ts`, `analytics-insights-store.ts`, `audit-page.ts`, `schema-validator.ts`, `site-architecture.ts`, `seo-change-tracker.ts`, `content-posts.ts`, `content-decay.ts`, `content-brief.ts` |
| `assembleContentPipeline` | `workspace-data.ts` (summary counts), `content-brief.ts`, `content-subscriptions.ts`, `schema-store.ts`, `content-matrices.ts`, `cannibalization-detection.ts`, `content-decay.ts`, `suggested-briefs-store.ts`, copy pipeline SQL via `copyStmts()` |
| `assembleSiteHealth` | `reports.ts` (audit snapshot), `performance-store.ts` (dead links, PageSpeed/CWV), `redirect-store.ts`, `site-architecture.ts` (orphan pages), `schema-validator.ts`, `anomaly-detection.ts`, `seo-change-tracker.ts`, `diagnostic-store.ts`, AEO review files |
| `assembleClientSignals` | `keyword_feedback` table, `content_gap_votes` table, `client_business_priorities` table, `churn-signals.ts`, `approvals.ts`, `client-users.ts`, `chat-memory.ts`, `activity-log.ts`, `roi.ts`, `feedback.ts`, `requests.ts`, `client-signals-store.ts` |
| `assembleOperational` | `activity-log.ts`, `analytics-annotations.ts`, `annotations.ts`, `jobs.ts`, `usage-tracking.ts`, `approvals.ts`, `recommendations.ts`, `outcome-tracking.ts`, `outcome-playbooks.ts`, `work-orders.ts`, `analytics-insights-store.ts` |

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
intelligence:{workspaceId}:{sortedSlices}:{pagePath}:{learningsDomain}[:bl]
```

The `:bl` suffix is appended only when `opts.enrichWithBacklinks` is true — backlink data requires a network call and must not be served from a non-backlink-enriched cache entry.

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

> Any new table or store that captures workspace activity must be surfaced in `server/workspace-intelligence.ts`. Add a field to the appropriate slice interface in `shared/types/intelligence.ts` AND read from the new store inside the corresponding `assemble*` function.

### Step-by-step pattern

**1. Add the field to the slice interface** (`shared/types/intelligence.ts`):

```ts
export interface ClientSignalsSlice {
  // ... existing fields ...

  /** New data source: count of unresolved feedback escalations */
  escalationCount?: number;
}
```

Use `?` (optional) because the field may not be available on older DBs or when the module hasn't shipped yet.

**2. Read from the store in the assembler** (`server/workspace-intelligence.ts`):

```ts
async function assembleClientSignals(workspaceId: string, _opts?: IntelligenceOptions): Promise<ClientSignalsSlice> {
  // ... existing assembly ...

  let escalationCount: number | undefined;
  try {
    const { getEscalationCount } = await import('./escalations.js');
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
- SEO edit application (`routes/webflow-seo.ts`)
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
