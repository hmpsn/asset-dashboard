# Connected Intelligence Engine — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Analytics Hub UX overhaul + Intelligence Engine enrichment + feedback loops

---

## Problem Statement

The Analytics Hub shipped with an insight-first architecture, but the insight engine is siloed — it only reads raw GSC + GA4 numbers. Page titles, keyword strategy, audit issues, content pipeline status, schema data, and anomaly detection all exist in the platform but don't flow into insights. The result: generic insight cards showing truncated URLs with decontextualized numbers.

Additionally, insights don't feed back to other features. Strategy can't auto-suggest based on ranking momentum. Content Pipeline can't auto-generate briefs from quick wins. Admin Chat has insight context but it's shallow.

The UX also has gaps: no Search Insights tab, charts only show 2 metrics, annotations only appear on Overview, loading states are invisible, and the InsightCards are hard to read.

---

## Architecture

### Current State: Three Silos

1. **Analytics Intelligence** (`analytics-intelligence.ts`) — computes 7 insight types from raw GSC + GA4. No titles, no strategy context, no audit data.
2. **SEO Context** (`seo-context.ts`) — aggregates strategy + brand voice + keywords for AI prompts. Doesn't read insights.
3. **Anomaly Detection** (`anomaly-detection.ts`) — 12h background job detecting site-level changes. Doesn't feed into insight store.

### Proposed: Connected Intelligence Engine

**Inputs (new connections marked with ★):**
- Google Search Console (existing)
- Google Analytics 4 (existing)
- SEMRush/DataForSEO (existing)
- Audit snapshots (existing, partial)
- ★ Page titles from `page_keywords` table
- ★ Keyword strategy from workspace config
- ★ Audit issues from `seo-audit.ts`
- ★ Content pipeline status from `content_posts` / `content_briefs`
- ★ Schema validation from `schema_*` tables
- ★ Anomaly data from `anomalies` table

**New insight types:**
- `ranking_mover` — queries/pages with significant position changes (uses rank tracking history)
- `ctr_opportunity` — high-impression, low-CTR queries where actual CTR is below expected for position
- `serp_opportunity` — pages eligible for rich results based on schema + query analysis
- `strategy_alignment` — flags where ranking reality diverges from strategy intent
- `anomaly_digest` — surfaces anomaly detection results as insight feed items

**Outputs (new feedback loops marked with ★):**
- Analytics Hub display (existing, redesigned)
- Admin Chat context (existing, enriched)
- ★ Strategy: auto-suggest keywords, flag misalignment
- ★ Content Pipeline: auto-generate briefs from quick wins, prioritize by impact
- ★ Client Dashboard: narrative summaries, ROI attribution
- ★ Recommendations engine: read from insight store (currently skipped)

### Deduplication

**Content decay** is computed in two places: `analytics-intelligence.ts` (lighter, -20% threshold) and `content-decay.ts` (richer, -10% threshold, with AI recommendations). Resolution: the intelligence engine delegates to the standalone `content-decay.ts` engine and wraps results as insight store entries.

**Quick wins naming**: rename the algorithmic insight type from `quick_win` to `ranking_opportunity` to distinguish from AI-generated strategy quick wins.

---

## Phase 1: Hub UX + Enrichment

### 1.1 Insight-First Tab Structure

Every hub section defaults to an Insights sub-tab. Raw data becomes secondary.

**Overview tab:**
- Sub-tabs: **Insights** (default) / **Metrics**
- Insights sub-tab contains: summary pills → priority feed (top 5) → chart → annotations
- Metrics sub-tab contains: current StatCards + raw numbers

**Search Performance tab:**
- Sub-tabs: **Search Insights** (default) / **Queries** / **Pages**
- Search Insights contains the full priority feed filtered to search-domain insights

**Site Traffic tab:**
- Sub-tabs: **Traffic Insights** (default) / **Breakdown** / **Events**
- Traffic Insights contains the full priority feed filtered to traffic-domain insights
- "Breakdown" replaces the confusing "Overview" sub-tab name (sources, devices, countries, organic)

### 1.2 Priority Feed Component

A new `InsightFeed` component used on all three insight sub-tabs.

**Structure per item:**
- Severity icon (colored: red=critical, amber=high/warning, blue=opportunity, green=win)
- Title line: page title or query + what happened (e.g., "Claude Code Limits Guide dropped to page 2")
- Context line: position change, click impact, strategy alignment, pipeline status
- Severity badge (Critical / High / Warning / Opportunity / Win)

**Data shape:**
```typescript
interface FeedInsight {
  id: string;
  type: InsightType;
  severity: 'critical' | 'warning' | 'opportunity' | 'positive';
  title: string;           // page title, not URL
  headline: string;        // "dropped to page 2", "CTR 1.2% vs 4.8% expected"
  context: string;         // "Position 4 → 11 · Lost ~2,400 clicks/mo · Strategy keyword match"
  pageUrl?: string;        // for drill-down
  domain: 'search' | 'traffic' | 'cross';  // for tab filtering
  impactScore: number;     // for ranking (higher = show first)
  actions?: FeedAction[];  // "View in Strategy", "Create Brief", etc.
}

interface FeedAction {
  label: string;           // "View in Strategy", "Create Brief", "View Audit"
  tab: Page;               // navigation target
  icon?: LucideIcon;
}
```

**Filtering:**
- Overview: shows all domains, top 5 by impact score
- Search Insights: filters to `domain === 'search'`, full list with filter chips (All / Drops / Opportunities / Wins)
- Traffic Insights: filters to `domain === 'traffic'`, full list with filter chips

### 1.3 Summary Pills

Colored count badges at the top of the Overview Insights sub-tab.

```
[● 4 drops] [● 8 opportunities] [● 3 wins] [● 162 schema gaps] [● 67 decaying]
```

- Clickable — filters the priority feed below
- Click again to deselect (return to mixed view)
- Colors: red=drops, amber=opportunities, green=wins, blue=schema, purple=decay

### 1.4 Chart System

One `AnnotatedTrendChart` component, configured per tab.

**Toggleable line chips:**
- Solid chip = active line on chart
- Outline chip = available, click to enable
- Max 3 active at once for readability
- Each tab has smart defaults pre-selected

**Per-tab configuration:**

| Tab | Available Lines | Defaults Active | Y-Axis |
|-----|----------------|-----------------|--------|
| Overview | Clicks, Impressions, Users, Sessions | Clicks + Users | Dual (GSC left, GA4 right) |
| Search Performance | Clicks, Impressions, CTR, Avg Position | Clicks + Impressions | Single (left) |
| Site Traffic | Users, Sessions, Pageviews | Users + Sessions | Single (left) |

**Annotations on all charts:**
- Same `AnnotatedTrendChart` component everywhere
- Same annotation markers (dashed line + colored dot + hover tooltip)
- Same click-to-create popover
- Same category colors (blue=site_change, amber=algorithm_update, purple=campaign, zinc=other)

**Changes to existing `AnnotatedTrendChart`:**
- Add `toggleableLines` prop: array of all available lines (active + inactive)
- Add `onToggleLine` callback for enabling/disabling lines
- Existing `lines` prop becomes the active subset
- Add max-active-lines enforcement (3)

**Changes to `useAnalyticsOverview`:**
- `trendData` already includes clicks, impressions, users, sessions
- Add pageviews to the merge (from GA4 trend data which already has it)
- Expose CTR and position from GSC trend data

### 1.5 Search Insights Content

New insight types computed by the intelligence engine:

**Ranking Movers** (`ranking_mover`):
- Compare current period vs previous period position per query-page pair
- Flag significant changes (>3 positions)
- Enriched with: page title, strategy keyword match, estimated click impact
- Source: GSC query-page data (existing) + `page_keywords` table (new connection)

**CTR Opportunities** (`ctr_opportunity`):
- Queries where actual CTR < expected CTR for position (using existing `EXPECTED_CTR_BY_POSITION` table)
- Minimum threshold: 100+ impressions
- Enriched with: page title, expected vs actual CTR, estimated click gain
- Source: GSC query data (existing)

**Page 1 Candidates** (enhancement of existing `ranking_opportunity`, renamed from `quick_win`):
- Queries in position 5-15 with significant impressions
- Enriched with: page title, strategy alignment, brief/pipeline status
- Source: GSC query-page data (existing) + strategy (new) + content pipeline (new)

**SERP Opportunities** (`serp_opportunity`):
- Pages with high impressions that could qualify for rich results
- Cross-reference with schema validation data
- Source: GSC pages (existing) + `schema_page_types` + `schema_validations` (new connections)

**Cannibalization** (existing, enhanced):
- Merge GSC-based retrospective detection with strategy-based prospective detection
- Show both "these pages ARE competing" and "this planned content WILL compete"

### 1.6 Insight Enrichment

All insights gain these fields at compute time:

```typescript
interface EnrichedInsight extends AnalyticsInsight {
  pageTitle?: string;           // from page_keywords or cleaned slug fallback
  strategyKeyword?: string;     // if page matches a strategy target
  strategyAlignment?: 'aligned' | 'misaligned' | 'untracked';
  auditIssues?: string[];       // linked audit findings (e.g., "missing canonical")
  pipelineStatus?: 'brief_exists' | 'in_progress' | 'published' | null;
  anomalyLinked?: boolean;      // if an anomaly was detected for this page/metric
}
```

**Page title resolution order:**
1. `page_keywords.page_title` (from keyword analysis)
2. Webflow page metadata title
3. Cleaned slug fallback: `/blog/best-ai-coding-agents` → "Best AI Coding Agents"

**Dual score display for page_health insights:**
The platform has two distinct page scores that measure different things:
- **Performance Score** (health score from `computePageHealthScores`): traffic performance — clicks, impressions, position, CTR, engagement. Low score = "nobody's finding this page."
- **Optimization Score** (from keyword analysis `optimizationScore`): on-page SEO quality — keyword in title/meta/content/URL, secondary keywords present. Low score = "the content needs SEO work."

Both scores should display together in the InsightFeed for `page_health` insights: "Performance: 16 · Optimization: 75" — this tells the user whether the problem is content quality or discoverability. Requires pulling `optimizationScore` from `page_keywords` during enrichment (add to `EnrichedInsight`).

### 1.7 Loading States

**Progressive rendering:**
- Chart renders as soon as raw GSC/GA4 trend data arrives (fast)
- Summary pills show skeleton placeholders while insights compute
- Priority feed shows 5 skeleton rows with shimmer animation
- Each section appears independently as its data becomes available

**Contextual messages:**
- "Analyzing search performance..." (while GSC insights compute)
- "Computing traffic patterns..." (while GA4 insights compute)
- "Cross-referencing strategy..." (while enrichment runs)

### 1.8 Content Decay Unification

- Remove `computeContentDecayInsights()` from `analytics-intelligence.ts`
- Instead, call `loadDecayAnalysis()` from `content-decay.ts` during insight computation
- Map the richer decay results (severity tiers, AI recommendations) into `analytics_insights` table entries
- Single source of truth for content decay across the platform

---

## Phase 2: Feedback Loops

### 2.1 Insights → Strategy

- Surface ranking movers as strategy suggestions: "This keyword is gaining momentum — consider adding to strategy"
- Flag misalignment: "You're targeting keyword X but ranking for keyword Y on this page"
- Auto-populate content gaps from competitor gap insights
- Display in KeywordStrategyPanel as a new "Intelligence Signals" section

### 2.2 Insights → Content Pipeline

- Quick wins / ranking opportunities generate "suggested briefs" in the pipeline
- Content decay insights trigger "refresh suggestions" with the AI recommendation from content-decay.ts
- Priority ordering in pipeline based on insight impact score
- Display as a new "AI Suggested" section in ContentPipeline

### 2.3 Anomalies → Insight Digest

- Merge anomaly detection results into the insight store as `anomaly_digest` type
- Site-level anomalies (traffic drops, score changes) appear in the Overview priority feed
- Page-level correlation: when an anomaly is detected, link it to affected page insights
- **Deduplication:** ongoing anomalies collapse into a single feed entry that updates rather than creating new items each detection cycle. Key on `(workspaceId, anomaly_type, metric)` — if an existing `anomaly_digest` insight matches, update its data (duration, current value) instead of inserting a duplicate. Display as "Traffic down 30% — ongoing for 5 days" rather than 10 separate entries. Only create a new feed entry when the anomaly resolves and a different one appears.

### 2.4 Insights → Admin Chat (enriched)

- `buildInsightsContext()` includes enriched fields (titles, strategy alignment, pipeline status)
- Chat can answer: "What should I work on for [client]?" with data-backed, actionable answers
- Proactive: when critical insights exist, chat mentions them unprompted

### 2.5 Audit Issues → Page Health Root Causes

- When a page_health score is low, include linked audit issues in the insight
- "Health score 45 — linked issues: missing canonical, weak title tag, no schema"
- Enables actionable next steps directly from the insight feed

### 2.7 Composite PageId Title Resolution

- `resolvePageTitle` currently produces ugly titles for composite pageId keys (e.g., `cannibalization::seo services` → "Cannibalization::seo Services")
- Split composite pageIds on `::` separator before title resolution — use the page URL portion for title lookup, query portion for context
- Insight types with composite keys: `ranking_mover` (`page::query`), `ctr_opportunity` (`page::query`), `cannibalization` (`cannibalization::query`), `keyword_cluster` (`cluster::label`)
- For cannibalization/cluster types where the first segment isn't a URL, use `data.query` or `data.label` as the title instead of parsing the pageId

**Prerequisite:** Data contracts audit must be complete before Phase 2 begins. Phase 2 adds more cross-module data flows that would inherit every unvalidated JSON boundary.

### 2.6 Schema Gaps → Insight Recommendations

- High-traffic pages missing recommended schema types surface as SERP opportunities
- Cross-reference `schema_page_types` with page impressions/clicks
- "This page gets 50K impressions but has no Article schema — adding it could improve CTR"

### 2.8 Signal-to-Noise Tuning — Actionable Feed, Not Fire Hose

Phase 1 surfaces every computed insight (393 drops + 86 opportunities in production). This overwhelms rather than guides. Phase 2 should tune the feed to feel like a prioritized work list:

- **Minimum impact threshold** — insights below a configurable impact score don't appear in the feed (still stored in DB for completeness, just hidden from default view). Start with bottom 20% filtered.
- **Consolidation** — group related insights instead of showing each individually. "5 pages lost position for 'ai coding' queries" instead of 5 separate ranking_mover items for the same keyword cluster.
- **Staleness** — insights older than 30 days auto-demote in the feed. A ranking drop from 6 weeks ago that hasn't been resolved isn't actionable anymore — it's context.
- **Resolution tracking** — mark insights as "addressed" when a brief is created, content is refreshed, or schema is added. Resolved insights move to a "Recently addressed" collapsible, not the main feed.
- **Feed caps** — Overview: 5 (existing). Detail tabs: 10 with expand (existing). Full "all insights" view: paginated, 25 per page.
- **Severity recalibration** — review whether 393 "drops" is correct or whether the thresholds are too sensitive. A page going from position 3 → 6 is flagged the same as position 3 → 15. Consider scaling severity by absolute impact (traffic lost), not just position delta magnitude.

---

## Phase 3: Client Intelligence

### 3.1 Client-Facing Insight Narrative

Different insight framing for the client dashboard:
- Admin sees: "What should I do next" (action-oriented, technical)
- Client sees: "Here's what's happening + here's what you can do" (informative, revenue-driving)

**Critical framing rule:** Client narratives must NEVER imply work is being done unless the client has purchased that service. The pattern is: **observation → context → CTA that drives revenue**.

| ❌ Never say | ✅ Say instead |
|-------------|---------------|
| "We're working on a recovery plan" | "A content refresh could help recover this ranking." + **[Request Content Refresh]** |
| "We're monitoring this trend" | "3 pages are showing content decay." + **[View Recommendations]** |
| "Our team is addressing this" | "Schema markup typically improves CTR by 20-30%." + **[Learn About Schema]** |

Example admin: "Claude Code Limits Guide dropped to page 2 — position 4 → 11, lost ~2,400 clicks/mo"
Example client: "Your Claude Code Limits page dropped from position 4 to 11 this week. A content refresh could help recover this ranking." + **[Request Content Refresh]**

Every client-facing insight should end with either:
- A **purchase CTA** ("Request Content Refresh", "Order Schema Markup", "Upgrade to Growth")
- A **self-service action** ("Review in Strategy", "Check Audit Details")
- **Nothing** (for positive insights — "Your best content drove 78 conversions this month" needs no CTA)

### 3.2 ROI Attribution

- Track which optimizations led to which ranking/traffic improvements
- "Content refresh on [page] 2 weeks ago → position improved from 8 to 3 → +1,200 clicks/mo"
- Requires linking content pipeline actions to subsequent metric changes

### 3.3 Monthly Performance Digests

- Auto-generated monthly summary of wins, issues addressed, and impact
- Uses insight data + content pipeline history + anomaly log
- Exportable as a client-facing report

### 3.4 Upsell Signals

- Surface opportunities that require tier upgrades
- "162 pages could qualify for rich results — Schema analysis available on Growth plan"
- Ties to existing `TierGate` soft-gating system

### 3.5 Admin Action Items

- Admin-specific view: unresolved insights as a work queue
- Track resolution: "Resolved — brief created", "Resolved — content refreshed"
- Feeds into workspace activity log

### 3.6 AI Insight Narratives (Premium Feature)

**Tier:** Premium only. Gated via `TierGate` — Growth/Free see computational insights, Premium gets AI narratives.

**Refresh:** Weekly (not daily). Computed once per week per workspace on a scheduled job. Stored in DB alongside the computational insight. Cost: ~$0.01-0.02/workspace/week (~$0.50-1.00/workspace/year).

**What it adds:**
- Human-readable explanations on top of computational insights: "Your SEO tips page dropped 4 positions — likely related to the March core update. Competitors have added 2026 benchmarks you're missing."
- Cross-referencing that formulas can't do: "This ranking drop is expected — you have a content refresh in progress that should recover it."
- Smart prioritization narrative: "Focus on these 3 pages first — they drive 60% of your organic traffic and all show CTR below expected."

**What it does NOT do:**
- Does NOT auto-generate briefs or content (that's a paid service, not a free automation)
- Does NOT auto-create pipeline items (recommendations surface as CTAs: "Request Content Refresh" → drives purchase flow)
- Does NOT replace computational insights (AI narratives layer ON TOP of the existing feed, not instead of it)

**Implementation:**
- Single GPT-4.1-mini call per workspace per week, batching top 15 insights with enrichment context
- Stored as `ai_narrative` field on each insight row (nullable, populated only for Premium)
- Frontend: `InsightFeedItem` shows narrative below the context line when available, styled differently (italic, lighter color)
- Admin view: always shows AI narratives (agency pays for Premium, not the client)
- Client view: shows narrative framed as "Our analysis" (Phase 3.1 narrative framing applies)

**Revenue alignment:**
- AI narratives make the value of the platform more visible → justifies Premium pricing
- Recommendations end in CTAs that drive content purchases → revenue, not cost
- Weekly cadence means clients check in regularly → engagement, not churn

---

## Data Model Changes

### New columns on `analytics_insights` table:

```sql
ALTER TABLE analytics_insights ADD COLUMN page_title TEXT;
ALTER TABLE analytics_insights ADD COLUMN strategy_keyword TEXT;
ALTER TABLE analytics_insights ADD COLUMN strategy_alignment TEXT;  -- 'aligned' | 'misaligned' | 'untracked'
ALTER TABLE analytics_insights ADD COLUMN audit_issues TEXT;        -- JSON array
ALTER TABLE analytics_insights ADD COLUMN pipeline_status TEXT;     -- 'brief_exists' | 'in_progress' | 'published'
ALTER TABLE analytics_insights ADD COLUMN anomaly_linked INTEGER DEFAULT 0;
ALTER TABLE analytics_insights ADD COLUMN impact_score REAL DEFAULT 0;
ALTER TABLE analytics_insights ADD COLUMN domain TEXT DEFAULT 'cross';  -- 'search' | 'traffic' | 'cross'
```

### New insight types:

Add to `InsightType` enum: `ranking_mover`, `ctr_opportunity`, `serp_opportunity`, `strategy_alignment`, `anomaly_digest`.

Rename `quick_win` → `ranking_opportunity` (migration to update existing rows).

---

## Component Changes

### New Components

- `InsightFeed` — priority-ranked feed used on all insight sub-tabs
- `SummaryPills` — clickable count badges for the Overview
- `InsightFeedItem` — single feed row (icon + title + context + severity badge)
- `InsightSkeleton` — loading state for feed items

### Modified Components

- `AnnotatedTrendChart` — add toggleable line chips, max-3 enforcement, `onToggleLine` callback
- `AnalyticsOverview` — restructure to Insights/Metrics sub-tabs, replace InsightCards with InsightFeed
- `SearchDetail` — add Search Insights sub-tab as default, add AnnotatedTrendChart
- `TrafficDetail` — rename "Overview" sub-tab to "Breakdown", make Insights default
- `useAnalyticsOverview` — expose additional trend fields (pageviews, CTR, position), add enrichment data

### Removed/Replaced

- `InsightCards` on Overview → replaced by `InsightFeed` + `SummaryPills` (InsightCards component retained for Metrics sub-tab, but with page title fix)
- `TrendChart` in TrafficDetail → replaced by `AnnotatedTrendChart` with traffic line config
- `computeContentDecayInsights()` in analytics-intelligence.ts → delegates to content-decay.ts

---

## Migration Path

Phase 1 is backward-compatible. Existing insight data continues to work. New columns have defaults. New insight types are additive. The `quick_win` → `ranking_opportunity` rename requires a data migration but the API can support both during transition.

Phases 2 and 3 are additive — they add new connections and UI sections without breaking existing flows.

---

## Success Criteria

**Phase 1:**
- Every insight shows a page title, not a raw URL
- Search Performance has an Insights tab with ranking movers and CTR opportunities
- Charts are toggleable with annotations on all tabs
- Loading states show progressive skeletons with contextual messages
- Content decay computation is unified (single source of truth)

**Phase 2:**
- Strategy panel shows intelligence signals derived from insights
- Content Pipeline shows AI-suggested briefs from quick wins
- Anomalies appear in the insight feed
- Admin Chat provides richer, insight-backed answers

**Phase 3:**
- Client dashboard shows narrative insight summaries
- Monthly performance digests are auto-generated
- ROI attribution links optimizations to outcomes
- Upsell signals surface in client-facing insights
