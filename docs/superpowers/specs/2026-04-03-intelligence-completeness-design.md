# Intelligence Completeness — Design Spec
**Date:** 2026-04-03
**Status:** Approved for implementation planning
**Priority:** MUST ship before Platform Intelligence Enhancements (foundational prerequisite)

---

## Overview

The workspace intelligence system has 8 slices. 3 are completely stubbed (return `undefined`). 5 are implemented but have silent data gaps — data is being collected and stored correctly, but never reaches the intelligence layer. This means admin chat, strategy context, and every AI feature that reads from intelligence is working with an incomplete picture.

This spec resolves all data loss across all 8 slices. The unified provider chain (SEMRush + DataForSEO via `SeoDataProvider`) is used throughout — no direct API calls to either vendor.

---

## Slice Map

| Slice | Intuitive Name | Current State |
|-------|---------------|---------------|
| `seoContext` | Brand & Voice Intelligence | Implemented — gaps in backlinks, SERP features, rank tracking |
| `insights` | Analytics Intelligence | Implemented — solid, no gaps found |
| `learnings` | Outcome Intelligence | Implemented — gaps in topWins, winRateByActionType, roiAttribution |
| `pageProfile` | Search Intelligence | **Stubbed** — all data exists, never assembled |
| `contentPipeline` | Content Intelligence | Implemented — gaps in decay alerts, cannibalization warnings, suggested briefs |
| `siteHealth` | Technical Intelligence | Implemented — solid, no gaps found |
| `clientSignals` | Client Intelligence | **Stubbed** — partial data exists, some new collection needed |
| `operational` | Operational Intelligence | **Stubbed** — all data exists, never assembled |

---

## Slice 1: Brand & Voice Intelligence (`seoContext`)

### Current state
Implemented. Covers: keyword strategy, brand voice, personas, knowledge base, business context, page-level keyword overrides.

### Gaps
These fields are defined in the `SeoContextSlice` type but never populated:
- `backlinkProfile` — `BacklinksOverview` (totalBacklinks, referringDomains, followLinks, nofollowLinks, link type breakdown)
- `serpFeatures` — Domain-level SERP opportunities (featured_snippet, PAA, video, local_pack)
- `rankTrackingSummary` — Current tracked keyword positions + momentum

### Fix
All three data sources exist and are cached:

**Backlink profile:** Call `getBacklinksOverview(domain, workspaceId)` via `SeoDataProvider`. Already implemented in `server/semrush.ts`, 7-day file cache. Attach result to `seoContext.backlinkProfile`.

**SERP features:** `getDomainOrganicKeywords()` already returns raw `serpFeatures` codes per keyword during strategy generation. Call `parseSerpFeatures()` and aggregate domain-level opportunities using `hasSerpOpportunity()`. No new API call needed if strategy has been run — reuse from `page_keywords` table.

**Rank tracking summary:** Query `rank_tracking` table for current positions + week-over-week deltas for tracked keywords. Already stored, never surfaced here.

### Provider usage
All calls go through `SeoDataProvider` (abstracts SEMRush + DataForSEO). Never call `server/semrush.ts` directly from the intelligence assembler.

---

## Slice 2: Analytics Intelligence (`insights`)

### Current state
Fully implemented. Pulls top 100 insights from `analytics_insights` table, sorted by impact score. Grouped by type and severity. Page-specific filtering supported.

### Gaps
None found. No changes required.

---

## Slice 3: Outcome Intelligence (`learnings`)

### Current state
Implemented. Covers: overall win rate, top action types, recent trend, playbooks, confidence level.

### Gaps
These fields are defined in the type but not computed:
- `topWins` — Most successful individual actions with their outcome scores
- `winRateByActionType` — Breakdown of win rate per action category
- `roiAttribution` — Revenue/traffic value attributed to tracked actions

### Fix
All data exists in `tracked_actions` + `action_outcomes` + `roi_attributions` tables:

**topWins:** Query `action_outcomes` JOIN `tracked_actions` WHERE score IN ('win', 'strong_win'), ORDER BY created_at DESC, LIMIT 5. Already have all columns needed.

**winRateByActionType:** GROUP BY `tracked_actions.action_type`, compute `COUNT(wins) / COUNT(total)` per type. Straightforward aggregation.

**roiAttribution:** Query `roi_attributions` table (already populated by the ROI engine). Sum `attributedValue` grouped by `workspaceId` for the last 90 days.

Feature flag: `outcome-ai-injection` already gates this slice. No new flag needed.

---

## Slice 4: Search Intelligence (`pageProfile`)

### Current state
**Fully stubbed.** `assemblePageProfile()` logs "Slice not yet implemented — skipping" and returns `undefined`.

### What it should contain
Per-page intelligence: primary keyword, search intent, optimization score, recommendations, content gaps, rank history, audit issues, schema status, link health, SEO edit history, CWV status.

### Implementation
All data exists. Wire the assembler:

**From `page_keywords` table:**
- `primaryKeyword`, `secondaryKeywords`, `searchIntent`, `optimizationScore`
- `recommendations` (JSON array), `contentGaps` (JSON array)
- `primaryKeywordPresence`, `competitorKeywords`, `estimatedDifficulty`
- `serpFeatures` (from strategy enrichment)

**From `analytics_insights` table (page-filtered):**
- All insights where `pageId` matches — page_health, quick_win, rank_opportunity, content_decay, etc.

**From `seo_suggestions` table:**
- SEO edit history: title/meta changes, status (pending/applied/dismissed), selected variation

**From `schema_validations` table:**
- Page-level schema validation status, error types

**From site architecture cache:**
- Inbound/outbound link counts, orphan status

**From performance store (PageSpeed):**
- Per-page CWV scores (LCP, FID, CLS)

**From `tracked_actions` + `action_outcomes`:**
- Actions taken on this page and their outcomes (closed loop: what we did, did it work)

### Note on page-specific vs workspace-wide
`pageProfile` is always assembled with a `pagePath`. When called without one, return `undefined` (the slice is inherently per-page). This matches the existing `pagePath` optional param on `buildWorkspaceIntelligence()`.

---

## Slice 5: Content Intelligence (`contentPipeline`)

### Current state
Implemented. Covers: briefs by status, posts by status, matrices, requests, work orders, coverage gaps, SEO edits.

### Gaps
- `cannibalizationWarnings` — data lives in `analytics_insights` (type: `cannibalization`) but not included
- `decayAlerts` — data lives in `analytics_insights` (type: `content_decay`) but not included
- `suggestedBriefs` — `suggested_briefs` table is populated but count never surfaced here

### Fix

**cannibalizationWarnings:** Query `analytics_insights` WHERE `insightType = 'cannibalization'` AND `status != 'resolved'`. Return count + top 3 by impact score with `pageId` and `affectedKeyword`.

**decayAlerts:** Query `analytics_insights` WHERE `insightType = 'content_decay'` AND `status != 'resolved'`. Return count + top 3 by impact score.

**suggestedBriefs:** Query `suggested_briefs` WHERE `status = 'pending'`. Return count. Already stored, just not read.

These are read-only queries on already-populated tables. No new data collection needed.

---

## Slice 6: Technical Intelligence (`siteHealth`)

### Current state
Fully implemented. Covers: audit score + delta, dead links, CWV pass rate (mobile + desktop), redirect chains, schema errors, performance summary, orphan pages, anomaly count, SEO change velocity.

### Gaps
None found. No changes required.

---

## Slice 7: Client Intelligence (`clientSignals`)

### Current state
**Fully stubbed.** Returns `undefined`. `bridge-client-signal` flag is already defined in bridge infrastructure.

### What it should contain
Churn risk, ROI data, engagement patterns, approval behavior, recent chat topics, business priorities, composite health score.

### Implementation — two phases

**Phase 1: Wire existing data (all tables exist)**

`churnRisk` + `churnSignals`:
- Query `churn_signals` table WHERE `workspaceId` AND `dismissedAt IS NULL`
- Derive risk level: any critical signal = high, any warning = medium, else low
- Return signal types, severity, detectedAt

`roi`:
- Query `roi_snapshots` for latest snapshot (organicTrafficValue, growthPercent, estimatedMonthlyValue)
- Query `roi_attributions` for last 90 days — sum attributedValue, count attributed actions

`engagement`:
- Query `activity_log` WHERE `workspaceId` AND `actor = 'client'` for last 30 days
- Count: chat sessions, approvals acted on, requests submitted, portal logins (from `client_users.lastLoginAt`)
- Derive: active (≥3 client actions/week), moderate (1-2/week), low (<1/week)

`approvalPatterns`:
- Query `approval_batches` WHERE `workspaceId`, compute approvalRate (approved/total), avgResponseTime (approvedAt - createdAt)

`compositeHealthScore`:
- Weighted score: 40% churn risk inverse, 30% ROI growth trend, 30% engagement level
- Churn risk maps: low=100, medium=50, high=0
- ROI growth maps: positive growth=100, flat=50, declining=0
- Engagement maps: active=100, moderate=50, low=0
- Final: `(churnScore × 0.4) + (roiScore × 0.3) + (engagementScore × 0.3)` → rounds to integer 0–100

**Phase 2: New data collection (requires additions)**

`recentChatTopics`:
- New: store semantic topic tags on `chat_sessions` at session close
- Derive from the last user message or AI summary (short tag array: ["content strategy", "keyword rankings"])
- Store as JSON column on existing `chat_sessions` table
- No new table needed

`businessPriorities`:
- New: add `priorities` JSON column to workspace settings
- Admin-editable: ["Grow new patients", "Rank for implants locally"]
- Exposed in workspace settings UI (smart placeholder-powered, see Platform Enhancements spec)

`keywordFeedback`:
- Existing: `keyword_feedback` table tracks thumbs up/down per keyword
- Wire: query approved/rejected keywords, detect patterns (e.g., consistently rejecting high-difficulty)

`serviceRequests`:
- Wire from new `client_signals` table (from Platform Enhancements spec 1.1)
- Dependency: Platform Enhancements Group 1 must ship first, OR stub this field until then

### `formatClientSignalsSection()` in `formatForPrompt()`
Add verbosity-aware formatting:
- **Compact:** composite health score + churn level + ROI trend
- **Standard:** + engagement summary + approval rate + recent signal count
- **Detailed:** + full churn signal breakdown + ROI figures + feedback patterns

---

## Slice 8: Operational Intelligence (`operational`)

### Current state
**Fully stubbed.** Returns `undefined`. All underlying data is actively collected.

### What it should contain
Recent activity stream, annotations, pending work, action backlog, detected playbooks, work orders, insight acceptance rate.

### Implementation
All data exists. Wire the assembler:

**`recentActivity`:**
- Query `activity_log` WHERE `workspaceId` ORDER BY `createdAt` DESC LIMIT 20
- Map to `{ type, description, timestamp, actor }` — columns exist directly

**`annotations`:**
- Query `analytics_annotations` WHERE `workspaceId` ORDER BY `date` DESC LIMIT 10
- Map to `{ date, label, pageUrl? }` — columns exist directly

**`pendingJobs`:**
- Query active jobs from job queue — `scheduled_audits` WHERE `status = 'pending'` + any background tasks

**`actionBacklog`:**
- Query `tracked_actions` WHERE `workspaceId` AND `status = 'pending_measurement'`
- Count of actions awaiting outcome scoring

**`detectedPlaybooks`:**
- Call `getPlaybooks(workspaceId)` from `outcome-playbooks.ts` — already implemented
- Return count + top 3 by confidence

**`workOrders`:**
- Query `work_orders` WHERE `workspaceId` AND `status != 'completed'`
- Return count by status

**`insightAcceptanceRate`:**
- Query `insight_resolutions` WHERE `workspaceId` AND `createdAt > 30 days ago`
- Compute: resolved_positively / total_resolved (dismissed vs actioned)

**`timeSaved`:**
- New: requires feature usage tracking. Out of scope for this pass — return `null` with graceful fallback. Add tracking in a follow-on spec.

---

## Cross-Cutting Concerns

### Cache invalidation call sites
Every mutation that changes slice data must invalidate the relevant sub-cache key:

| Mutation | Invalidation call |
|----------|------------------|
| New insight upserted | `invalidateSubCache(wsId, 'slice:insights')` |
| Strategy regenerated | `invalidateSubCache(wsId, 'slice:seoContext')` + `invalidateSubCache(wsId, 'slice:pageProfile')` |
| Brief/post status changes | `invalidateSubCache(wsId, 'slice:contentPipeline')` |
| Audit completes | `invalidateSubCache(wsId, 'slice:siteHealth')` |
| Churn signal created/dismissed | `invalidateSubCache(wsId, 'slice:clientSignals')` |
| Activity logged | `invalidateSubCache(wsId, 'slice:operational')` |
| Action outcome scored | `invalidateSubCache(wsId, 'slice:learnings')` + `invalidateSubCache(wsId, 'slice:clientSignals')` |

### `INTELLIGENCE_CACHE_UPDATED` WebSocket broadcast
This event is defined but never fired. Wire it: after any `invalidateIntelligenceCache()` or `invalidateSubCachePrefix()` call, broadcast `INTELLIGENCE_CACHE_UPDATED` to the workspace. Frontend React Query hooks invalidate automatically. One connection, every consumer benefits.

### `formatForPrompt()` extension
Currently only formats `seoContext`, `insights`, `learnings`. Add formatters for all newly-implemented slices:
- `formatPageProfileSection(slice, verbosity)` — for page-specific AI calls
- `formatContentPipelineSection(slice, verbosity)` — includes decay/cannibalization warnings
- `formatClientSignalsSection(slice, verbosity)` — compact: health score + churn; detailed: full breakdown
- `formatOperationalSection(slice, verbosity)` — activity stream + pending work summary

### Admin chat context (`assembleAdminContext`)
The question classifier already has categories for `'client'`, `'content'`, `'page_analysis'`, `'activity'` — but only fetches data from separate queries, not the intelligence slices. Once slices are populated, update the relevant categories to read from the assembled intelligence instead of making duplicate queries. Reduces latency and ensures consistency.

---

## What Needs New Data Collection

Most gaps are wiring problems, not collection problems. The short list of genuinely new collection:

| Field | Slice | What's needed |
|-------|-------|--------------|
| `recentChatTopics` | clientSignals | Topic tags on `chat_sessions` at session close |
| `businessPriorities` | clientSignals | `priorities` JSON column on workspace + admin UI |
| `timeSaved` | operational | Feature usage tracking (deferred — return null for now) |

Everything else already exists in the database.

---

## Implementation Order

Dependencies between slices:

1. **No dependencies** (implement in parallel): `seoContext` gaps, `learnings` gaps, `contentPipeline` gaps, `operational`, `siteHealth` (no-op)
2. **Depends on page_keywords being populated**: `pageProfile` — requires strategy to have been run at least once
3. **Depends on new data collection**: `clientSignals.recentChatTopics`, `clientSignals.businessPriorities` — Phase 2, after Phase 1 ships
4. **Depends on Platform Enhancements Group 1**: `clientSignals.serviceRequests` — stub field until `client_signals` table exists

Recommended batching:
- **Batch A (parallel):** seoContext gaps + learnings gaps + contentPipeline gaps + operational assembler + INTELLIGENCE_CACHE_UPDATED broadcast + formatForPrompt extensions
- **Batch B (after A):** pageProfile assembler + clientSignals Phase 1 + admin chat context update
- **Batch C (after Platform Enhancements Group 1):** clientSignals Phase 2 (serviceRequests, recentChatTopics, businessPriorities)

---

## Out of Scope

- `timeSaved` computation (requires new feature usage instrumentation — separate spec)
- Per-keyword approval voting UI (separate spec — needed for `keywordFeedback` completeness)
- Content gap voting mechanism (separate spec)
- Competitor authority deep-dive via `getTopReferringDomains()` (too credit-heavy for intelligence build time)
