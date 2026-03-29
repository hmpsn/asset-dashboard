# Outcome Intelligence Engine — Design Spec

> **Date:** 2026-03-29
> **Status:** Draft
> **Scope:** Platform-wide outcome tracking, AI feedback loops, predictive foundations, and adaptive pipeline integration

---

## Overview

The Outcome Intelligence Engine is a platform-wide nervous system that tracks every recommendation, action, and publication — measures what actually happened — and feeds those learnings back into every AI feature so the platform gets smarter over time.

**Core thesis:** The platform already generates good recommendations. What it lacks is memory. It doesn't know which recommendations worked, which content formats perform best, or which strategy calls were right. This engine closes that loop.

**Design principles:**
- Connection points are the foundation, not an afterthought — every system wires in from day one
- Backfill existing data so the system launches with learnings, not a cold start
- Measure fast (7-day early signals) and measure thoroughly (30/60/90-day scoring)
- Learnings flow into AI prompts automatically once confidence thresholds are met
- Everything is per-workspace — no cross-workspace data sharing

---

## Phase Structure

| Phase | What Ships | Time to Value |
|---|---|---|
| **Phase 0: Backfill** | Retroactive action scoring from existing DB data | Immediate — learnings exist on launch day |
| **Phase 1a: Recording Hooks** | Action registry wired into all systems, 7-day early signals | 1 week — data flowing from every touchpoint |
| **Phase 1b: Dashboard + AI Injection** | Win/loss UI, learnings in prompts, activity timeline | Immediate — backfill data powers this from day one |
| **Phase 2: Detection + Reporting** | External execution detection, client views, digest integration, "We Called It" | 2-4 weeks — as new external wins are detected |
| **Phase 3: Adaptive + Predictive** | Pipeline automation, decay velocity, seasonal baselines, playbook generation | Grows over time — gets smarter every month |

---

## Section 0: Backfill Engine

### Purpose

Retroactively create tracked actions and score outcomes from historical data already in the database, so the system launches with months of learnings instead of starting from zero.

### Data Sources for Backfill

| Existing Data | Becomes Action Type | Baseline Source | Outcome Source |
|---|---|---|---|
| `generated_posts` with `publishedAt` | `content_published` | GSC data for target keyword at publish date (interpolated from nearest available snapshot) | Current GSC performance for that page |
| `analytics_insights` with `resolution_status = 'resolved'` | `insight_acted_on` | Metric values at `computed_at` timestamp | Current metric values for that page |
| `page_keywords` with `created_at` | `strategy_keyword_added` | Position at creation time (stored in `previous_position` or first available snapshot) | Current position and clicks |
| `recommendations` with status `completed` | `audit_fix_applied` | Page health score at recommendation creation | Current page health score |
| `content_briefs` with linked posts | `brief_created` | Keyword position at brief creation (if ranking) | Whether content was produced and current performance |

### Backfill Process

1. Query each source table for historical records with timestamps
2. For each record, reconstruct the most accurate baseline possible from available data
3. Score outcome using current metrics vs reconstructed baseline
4. Mark backfilled actions with `source: 'backfill'` flag so they can be distinguished from live-tracked actions
5. Compute initial workspace learnings from backfilled outcomes

### Backfill Limitations

- Baselines are approximated — exact metric values at the historical point may not be available. Mark confidence as `estimated` vs `exact` on each baseline
- Pages that no longer exist are marked `inconclusive`
- Backfill runs once at engine initialization, then never again — all future actions are tracked live

---

## Section 1: Action Registry + Connection Points

### Core Schema

```
tracked_actions
├── id                    TEXT PRIMARY KEY
├── workspace_id          TEXT NOT NULL
├── action_type           TEXT NOT NULL  -- enum below
├── source_type           TEXT NOT NULL  -- 'insight' | 'brief' | 'post' | 'strategy' | 'audit' | 'schema' | 'internal_link' | 'approval'
├── source_id             TEXT           -- FK to originating record
├── page_url              TEXT           -- primary page affected
├── target_keyword        TEXT           -- primary keyword targeted (if applicable)
├── baseline_snapshot     TEXT (JSON)    -- frozen metrics at action time
├── trailing_history      TEXT (JSON)    -- trailing 12 weeks of primary metric (for predictive foundations)
├── attribution           TEXT NOT NULL  -- 'platform_executed' | 'externally_executed' | 'not_acted_on'
├── measurement_window    INTEGER        -- days (default 90)
├── source_flag           TEXT           -- 'live' | 'backfill'
├── baseline_confidence   TEXT           -- 'exact' | 'estimated'
├── context               TEXT (JSON)    -- extensible context (competitor data, seasonal tags, etc.)
├── created_at            TEXT NOT NULL
├── updated_at            TEXT NOT NULL
```

```
action_outcomes
├── id                    TEXT PRIMARY KEY
├── action_id             TEXT NOT NULL  -- FK to tracked_actions
├── checkpoint_days       INTEGER NOT NULL  -- 7, 30, 60, or 90
├── metrics_snapshot      TEXT (JSON)    -- metrics at this checkpoint
├── score                 TEXT           -- 'strong_win' | 'win' | 'neutral' | 'loss' | 'insufficient_data' | 'inconclusive'
├── delta_summary         TEXT (JSON)    -- computed deltas vs baseline
├── competitor_context    TEXT (JSON)    -- competitor activity during this window (future)
├── measured_at           TEXT NOT NULL
```

### Action Types

| Action Type | Trigger | Systems That Record It |
|---|---|---|
| `insight_acted_on` | User marks insight as "in progress" or "resolved" | Insights pipeline |
| `content_published` | Generated post published to Webflow | Content pipeline |
| `brief_created` | Content brief generated | Content pipeline |
| `strategy_keyword_added` | Keyword added to strategy | Strategy engine |
| `schema_deployed` | Schema markup published to page | Schema/audit system |
| `audit_fix_applied` | User marks recommendation as done | Audit system |
| `content_refreshed` | Existing content updated/republished | Content pipeline |
| `internal_link_added` | Internal link suggestion implemented | Internal links system |
| `meta_updated` | Title/description changed | Content pipeline / audit |
| `voice_calibrated` | Brand voice guidelines updated | Brand voice system |

### Baseline Snapshot Shape

The baseline snapshot varies by action type but always includes:

```typescript
interface BaselineSnapshot {
  // Always present
  captured_at: string;        // ISO timestamp

  // Present when page_url exists
  position?: number;          // Average GSC position
  clicks?: number;            // Clicks in trailing 28 days
  impressions?: number;       // Impressions in trailing 28 days
  ctr?: number;               // CTR as percentage (e.g., 6.3)

  // Present when GA4 is connected
  sessions?: number;          // Sessions in trailing 28 days
  bounce_rate?: number;       // As percentage
  engagement_rate?: number;   // As percentage
  conversions?: number;       // Conversion events in trailing 28 days

  // Present for audit-related actions
  page_health_score?: number; // 0-100

  // Present for schema actions
  rich_result_eligible?: boolean;
  rich_result_appearing?: boolean;

  // Present for voice-related actions
  voice_score?: number;       // 0-100 brand voice alignment
}
```

### Connection Points (All Systems)

Every system below gets a recording hook in Phase 1a. The hook captures the action + baseline at the moment of the event. These are lightweight — a single DB write per event.

| System | Event That Triggers Recording | What's Captured |
|---|---|---|
| **Insight resolution** | `PUT /api/insights/:id/resolve` | Insight type, page, severity, current metrics |
| **Content publishing** | Post published to Webflow | Target keyword, page URL, current rankings |
| **Brief generation** | `POST /api/content-briefs` | Target keyword, current position (if any), volume, difficulty |
| **Strategy updates** | Keyword added/removed from strategy | Keyword, current position, volume, difficulty |
| **Schema deployment** | Schema published to page | Schema type, page URL, current CTR, rich result status |
| **Audit recommendations** | Recommendation marked complete | Fix type, page URL, page health score, specific metric |
| **Internal links** | Link suggestion implemented | Source page, target page, current target page metrics |
| **Approval workflow** | Client approves/rejects brief or post | What was approved, time-to-approval, any feedback |
| **Brand voice** | Voice guidelines updated or voice score recorded | Pre/post voice scores on content |
| **Meta tag changes** | Title/description updated | Old vs new tags, current CTR, impressions |
| **AEO reviews** | AEO optimization applied | Page URL, current AI visibility metrics |
| **Activity log** | (Read-only connection) | Actions link back to activity entries for timeline view |

### Shared Types

```typescript
// shared/types/outcome-tracking.ts

type ActionType =
  | 'insight_acted_on'
  | 'content_published'
  | 'brief_created'
  | 'strategy_keyword_added'
  | 'schema_deployed'
  | 'audit_fix_applied'
  | 'content_refreshed'
  | 'internal_link_added'
  | 'meta_updated'
  | 'voice_calibrated';

type Attribution =
  | 'platform_executed'
  | 'externally_executed'
  | 'not_acted_on';

type OutcomeScore =
  | 'strong_win'
  | 'win'
  | 'neutral'
  | 'loss'
  | 'insufficient_data'
  | 'inconclusive';

type SourceFlag = 'live' | 'backfill';
type BaselineConfidence = 'exact' | 'estimated';

interface TrackedAction {
  id: string;
  workspaceId: string;
  actionType: ActionType;
  sourceType: string;
  sourceId: string | null;
  pageUrl: string | null;
  targetKeyword: string | null;
  baselineSnapshot: BaselineSnapshot;
  trailingHistory: TrailingHistory;
  attribution: Attribution;
  measurementWindow: number;
  sourceFlag: SourceFlag;
  baselineConfidence: BaselineConfidence;
  context: ActionContext;
  createdAt: string;
  updatedAt: string;
}

interface ActionOutcome {
  id: string;
  actionId: string;
  checkpointDays: 7 | 30 | 60 | 90;
  metricsSnapshot: BaselineSnapshot;
  score: OutcomeScore;
  deltaSummary: DeltaSummary;
  competitorContext: CompetitorContext | null;
  measuredAt: string;
}

interface TrailingHistory {
  metric: string;           // e.g., 'clicks', 'position'
  dataPoints: Array<{
    date: string;
    value: number;
  }>;                       // trailing 12 weeks, weekly buckets
}

interface DeltaSummary {
  primary_metric: string;
  baseline_value: number;
  current_value: number;
  delta_absolute: number;
  delta_percent: number;
  direction: 'improved' | 'declined' | 'stable';
}

interface ActionContext {
  // Extensible — populated as companion features ship
  competitorActivity?: CompetitorContext;
  seasonalTag?: { month: number; quarter: number };
  relatedActions?: string[];    // IDs of other actions on same page
  notes?: string;               // Admin-added context
}

interface CompetitorContext {
  // Future: populated by competitor intelligence layer
  competitorMovement?: Array<{
    domain: string;
    keyword: string;
    positionChange: number;
    newContent?: boolean;
  }>;
}
```

---

## Section 2: Outcome Measurement

### Measurement Schedule

Actions are measured at **4 checkpoints**: 7, 30, 60, and 90 days post-action.

| Checkpoint | Purpose | Scoring |
|---|---|---|
| **7-day** | Early signal — did anything move? | `on_track` / `no_movement` / `too_early` (not a final score) |
| **30-day** | First real measurement | Full outcome score |
| **60-day** | Primary measurement (Google has re-indexed/settled) | Full outcome score |
| **90-day** | Final score — the "official" outcome | Full outcome score, closes the action |

### Scoring Criteria

Scoring is relative to the **action type's primary metric**:

| Action Type | Primary Metric | strong_win | win | neutral | loss |
|---|---|---|---|---|---|
| `content_published` | Target keyword position | Reached page 1 | Position improved 3+ | Within +/- 10% | Position declined 3+ |
| `insight_acted_on` | Depends on insight type | Metric improved 30%+ | Improved 15%+ | Within +/- 10% | Declined 15%+ |
| `strategy_keyword_added` | Position for keyword | Reached top 10 | Position improved 5+ | Within +/- 3 | No ranking after 90 days |
| `schema_deployed` | CTR change | CTR up 20%+ and rich result appearing | CTR up 10%+ | Within +/- 5% | CTR declined or no rich result |
| `audit_fix_applied` | Page health score | Score up 15+ points | Score up 5+ points | Within +/- 3 | Score declined |
| `content_refreshed` | Click recovery vs pre-decay peak | Recovered 80%+ of peak | Recovered 40%+ | Recovered < 40% | Continued declining |
| `internal_link_added` | Target page position/clicks | Target improved 20%+ | Target improved 10%+ | Within +/- 10% | No change or declined |
| `meta_updated` | CTR change | CTR up 15%+ | CTR up 5%+ | Within +/- 5% | CTR declined |
| `voice_calibrated` | Next content's voice score | Score 85+ | Score 70-84 | Score 50-69 | Score < 50 |

### Edge Cases

- **Page deleted/redirected:** Mark as `inconclusive` with redirect target noted in context
- **Multiple actions on same page:** Tag all actions with `relatedActions` IDs. Attribution note: "This page had 3 actions in the measurement window — results are shared across all." Individual scoring still happens, but the dashboard flags multi-action pages
- **Seasonal normalization:** If trailing history shows a clear seasonal pattern (same dip last year), adjust the baseline expectation. Score against seasonally-adjusted expectation, not raw baseline
- **Insufficient traffic:** Pages with < 50 impressions in the measurement window score as `insufficient_data`
- **New pages (no baseline):** For `content_published` on new URLs, baseline is zero. Scoring shifts to absolute thresholds (e.g., reached page 1 = strong_win, page 2 = win, page 3+ = neutral, not indexed = loss)

### Measurement Cron Job

A scheduled job runs daily:

1. Query all `tracked_actions` where next checkpoint is due (created_at + checkpoint_days <= today)
2. For each action, fetch current metrics from GSC/GA4 (batch queries to minimize API calls)
3. Compute deltas against baseline
4. Score the outcome
5. Write to `action_outcomes`
6. If 90-day checkpoint, mark action as `measurement_complete`
7. Broadcast `OUTCOME_SCORED` event to workspace for real-time UI updates

---

## Section 3: AI Feedback Loop (Workspace Learnings)

### Purpose

Assemble outcome data into structured learnings that get injected into AI prompts, making every AI feature smarter based on what's actually worked for this workspace.

### Learnings Module

New module: `server/workspace-learnings.ts`

```typescript
interface WorkspaceLearnings {
  workspaceId: string;
  computedAt: string;
  confidence: 'high' | 'medium' | 'low';  // based on sample size
  totalScoredActions: number;

  content: ContentLearnings | null;       // null if < 10 scored content actions
  strategy: StrategyLearnings | null;     // null if < 10 scored strategy actions
  technical: TechnicalLearnings | null;   // null if < 10 scored audit/schema actions
  overall: OverallLearnings;
}

interface ContentLearnings {
  winRateByFormat: Record<string, number>;        // e.g., { 'case_study': 0.78, 'listicle': 0.40 }
  avgDaysToPage1: number | null;
  bestPerformingTopics: string[];                  // keyword clusters with highest win rate
  optimalWordCount: { min: number; max: number } | null;  // range with highest win rate
  refreshRecoveryRate: number;                     // % of refreshes that recovered traffic
  voiceScoreCorrelation: number | null;            // correlation between voice score and outcome
}

interface StrategyLearnings {
  winRateByDifficultyRange: Record<string, number>;  // e.g., { '0-20': 0.82, '20-40': 0.60, '40+': 0.35 }
  avgTimeToRank: Record<string, number>;              // days to page 1 by difficulty range
  bestIntentTypes: string[];                          // informational, transactional, etc.
  keywordVolumeSweetSpot: { min: number; max: number } | null;
}

interface TechnicalLearnings {
  winRateByFixType: Record<string, number>;    // e.g., { 'schema': 0.85, 'alt_text': 0.30, 'meta_tags': 0.65 }
  schemaTypesWithRichResults: string[];         // schema types that actually triggered rich results
  avgHealthScoreImprovement: number;
  internalLinkEffectiveness: number;            // win rate for internal link suggestions
}

interface OverallLearnings {
  totalWinRate: number;
  strongWinRate: number;
  topActionTypes: Array<{ type: ActionType; winRate: number; count: number }>;
  recentTrend: 'improving' | 'stable' | 'declining';  // win rate trend over last 3 months
}
```

### Confidence Thresholds

Learnings are only injected into prompts when there's enough data to be meaningful:

| Confidence | Criteria | Prompt Behavior |
|---|---|---|
| `high` | 25+ scored outcomes in category | Full learnings injected with specific numbers |
| `medium` | 10-24 scored outcomes | Learnings injected with hedging ("early data suggests...") |
| `low` | < 10 scored outcomes | Category omitted from prompt — not enough data |

### Prompt Injection Format

Learnings are formatted as concise natural language and appended to the system context for each AI call. Example for content brief generation:

```
WORKSPACE LEARNINGS (based on 47 tracked outcomes):
- Content win rate: 68% (32 of 47 actions showed measurable improvement)
- Case studies outperform listicles 2:1 for this workspace (78% vs 40% win rate)
- Keywords in difficulty 20-40 reach page 1 within 60 days 60% of the time
- Difficulty 40+ has only 35% success rate — recommend deprioritizing unless high business value
- Content refreshes recover traffic 72% of the time — prioritize refresh over new content for decaying pages
- Pages with FAQ schema see 23% higher CTR on average
- Optimal word count range: 1,500-2,500 words (highest win rate bracket)
- Voice scores above 80 correlate with 1.4x better outcomes

Apply these learnings when making recommendations. Weight toward proven patterns.
```

### Caching

- Learnings are recomputed **daily** via cron job (not on every AI call)
- Cached in `workspace_learnings` table as JSON
- AI callers read from cache: `getWorkspaceLearnings(workspaceId, domain)`
- Domain parameter filters to relevant learnings (content, strategy, technical, all)

### Systems That Receive Learnings

| AI Feature | Learnings Domain | How It's Used |
|---|---|---|
| Content brief generation | `content` | Format recommendations, word count, keyword difficulty guidance |
| Content post generation | `content` | Structure, tone, format preferences based on what performs |
| Insight recommendations | `technical` + `overall` | Priority weighting by fix-type win rate |
| Keyword strategy | `strategy` | Difficulty range guidance, intent type preferences |
| Admin chat | `all` | Full context so analyst Q&A reflects workspace history |
| Monthly digest | `overall` | Narrative grounded in actual outcome trends |
| SEO audit recommendations | `technical` | Prioritize fix types with proven impact |
| Internal link suggestions | `technical` | Weight by historical link effectiveness |
| Schema suggestions | `technical` | Recommend schema types that actually trigger rich results |
| AEO reviews | `content` + `technical` | Optimize based on what's worked for AI visibility |

---

## Section 4: Win/Loss Dashboard + Client Reporting

### Admin Dashboard

New tab or section within the admin workspace view:

**Scorecard Panel:**
- Overall win rate (donut chart) with trend arrow
- Win rate by category (content, technical, strategy) as horizontal bars
- Total actions tracked / scored / pending measurement
- Recent trend: improving / stable / declining

**Action Feed:**
- Timeline of tracked actions with current status
- Status badges: `pending` (gray), `7-day: on_track` (blue), `30-day: win` (green), `90-day: strong_win` (teal), `loss` (red)
- Filter by action type, score, date range
- Click-through to see full baseline → outcome details

**Top Wins Panel:**
- Highest-impact outcomes ranked by delta magnitude
- Each entry shows: action taken, metric improvement, time to result
- "Highlight for client" toggle to flag for client reporting

**Learnings Panel:**
- Human-readable version of workspace learnings (same data AI sees)
- Admin can verify learnings make sense before they influence AI output
- "Override" capability — admin can flag a learning as incorrect if the data is misleading

**Competitor Scoreboard (Phase 3):**
- Keywords won vs lost against each competitor
- Net keyword position changes
- Gamified framing: "+4 keywords gained vs competitor X this month"

### Client Dashboard (Tiered)

| Element | Free | Growth | Premium |
|---|---|---|---|
| Monthly wins summary | Top 3 wins, text only | Full list with metrics | Full list + competitor context |
| Recommendation hit rate | Hidden | Overall percentage | Per-category breakdown |
| "We Called It" highlights | Hidden | Top 1 per month | All detected external wins |
| ROI estimates | Hidden | Hidden | Time saved, traffic value gained, cost per result |
| Competitor scoreboard | Hidden | Hidden | Full scoreboard with trend |
| Action timeline | Hidden | Last 30 days | Full history with filters |

### "We Called It" Feature

When the system detects an `externally_executed` action that scored `win` or `strong_win`:

> **We recommended it. You implemented it. Here's what happened.**
> "On Feb 12, we recommended adding FAQ schema to your /pricing page. It was implemented outside our platform, and over the next 60 days, CTR increased 31% and the page began appearing in rich results."

This surfaces in:
- Client dashboard (Growth+)
- Monthly digest (Growth+)
- Admin dashboard (always)
- Activity timeline as a linked narrative

### Digest Integration

The existing monthly digest (`server/monthly-digest.ts`) gets a new section:

**"This Month's Outcomes"**
- Actions that reached a scoring checkpoint this month
- Top wins with before/after metrics
- Overall win rate trend
- "We Called It" highlights
- Recommendations still pending measurement (expectation setting)

---

## Section 5: External Execution Detection

### Purpose

Detect when recommendations were implemented outside the platform, so the system can track outcomes and credit its own advice.

### Detection Mechanisms

| Recommendation Type | Detection Signal | Check Method |
|---|---|---|
| Schema deployment | Schema markup appeared on page | Periodic page crawl — check for JSON-LD that matches the recommended schema type |
| Content refresh | Page content significantly changed | Compare content hash (or word count / heading structure) vs last known state |
| Meta tag update | Title or description changed | Periodic Webflow page fetch — compare meta tags vs baseline |
| Internal link added | New link to recommended target page | Crawl source page, check for link to target URL |
| New content published | New page targeting recommended keyword | Check Webflow for new pages, match against outstanding brief recommendations |
| Alt text added | Images now have alt attributes | Periodic page audit — compare alt text coverage |

### Detection Schedule

- **Daily light check:** For high-priority open recommendations (severity: high), check the most actionable signals (schema presence, meta tags)
- **Weekly deep check:** For all open recommendations, run full detection suite
- **On-demand:** When workspace data refreshes (GSC/GA4 sync), cross-reference against open recommendations

### Detection Flow

1. Query all `tracked_actions` where `attribution = 'not_acted_on'`
2. For each, run the relevant detection check
3. If signal detected:
   a. Update attribution to `externally_executed`
   b. Set `created_at` to detection time (measurement window starts now)
   c. Snapshot current baseline
   d. Broadcast `EXTERNAL_ACTION_DETECTED` event
   e. Generate "We Called It" entry

### False Positive Handling

- Require **two consecutive checks** confirming the signal before changing attribution (avoids flapping)
- Admin can manually override attribution if detection is wrong
- Detection confidence score: high (schema appeared exactly as recommended), medium (content changed but not sure if it matches recommendation), low (ambiguous signal)

---

## Section 6: Adaptive Pipeline Integration

### Purpose

Once the learnings system has enough data, it actively shapes what the platform suggests and prioritizes — not just informing AI prompts but changing pipeline behavior.

### Content Pipeline Adaptations

| Learnings Signal | Pipeline Effect |
|---|---|
| Content format X has high win rate | Brief generation defaults to that format; content requests auto-suggest it |
| Optimal word count range identified | Brief word count targets auto-set to winning range |
| Refresh recovery rate > 60% | Decay insights auto-generate refresh briefs (not just flag the problem) |
| Voice score > 80 correlates with better outcomes | Voice check becomes a gate before publishing (warning if score < 70) |
| Specific heading structures correlate with wins | Brief outlines incorporate proven structures |

### Strategy Pipeline Adaptations

| Learnings Signal | Pipeline Effect |
|---|---|
| Keywords in difficulty range Y consistently win | Strategy engine prioritizes that range, warns on high-difficulty targets |
| Specific intent types outperform | Strategy recommendations weight toward proven intents |
| Average time-to-rank by difficulty known | Strategy includes realistic timeline expectations |
| Certain keyword clusters over-index on wins | Related keyword suggestions pull from winning clusters |

### Technical Pipeline Adaptations

| Learnings Signal | Pipeline Effect |
|---|---|
| Schema type Z has 85% win rate | Schema recommendations for type Z get priority: high automatically |
| Internal links have low win rate | Deprioritize internal link suggestions, or add caveat |
| Alt text fixes rarely move metrics | Lower priority for alt text recommendations |
| Specific audit fix types drive real improvement | Bubble those fix types to top of recommendation list |

### Adaptation Thresholds

Adaptations only activate when:
- Category has 15+ scored outcomes (prevents premature automation)
- Win rate difference between options is statistically meaningful (>15% gap)
- Admin has not manually overridden the learning

### Adaptation Visibility

All adaptations are visible in the admin Learnings Panel:
- "The system is currently auto-prioritizing FAQ schema recommendations based on 85% win rate (23 of 27 actions)"
- Admin can disable any specific adaptation without disabling the whole system

---

## Section 7: Predictive Foundations

### Purpose

Lay groundwork for forecasting issues before they happen, using data structures built into the outcome tracking layer from day one.

### 7a: Historical Trend Storage

Every `tracked_action` stores a `trailing_history` field — the trailing 12 weeks of the primary metric at baseline time. This gives every action a mini time-series.

**Why it matters:** Enables "this page was already declining when we intervened" vs "it was stable and then improved" — critical for accurate outcome attribution and future trend extrapolation.

### 7b: Decay Velocity Scoring

For `content_decay` insights, compute a **rate of decline**, not just a binary "it dropped":

```typescript
interface DecayVelocity {
  metric: string;             // 'clicks', 'position', 'impressions'
  weeklyRate: number;         // average change per week
  accelerating: boolean;      // is the rate of decline increasing?
  projectedWeeksToThreshold: number | null;  // weeks until page falls off page 1 (or other threshold)
}
```

Surfaces as: "This page is losing ~5 positions/month. At this rate, it will drop off page 1 in approximately 3 weeks."

### 7c: Seasonal Baseline Tagging

Every action outcome is tagged with `seasonalTag: { month, quarter }`. Over time, this builds a seasonal model per workspace:

- "Q1 traffic is typically 15% below Q3 for this workspace"
- Anomaly detection adjusts thresholds by season
- Outcome scoring accounts for seasonality (a Q1 "loss" might be normal seasonal behavior)

Requires 12+ months of data to be reliable. Until then, tagging is passive (data collected but not used for adjustment).

### 7d: Competitor Movement Cadence (Future)

When the competitor intelligence companion ships, record rate-of-change metrics:

- Competitor content publishing frequency
- Competitor keyword position movement rates
- Competitor backlink acquisition rate

Enables: "Competitor X publishes 3 articles/month targeting your keywords — you need to maintain at least 2/month to hold position" and "Competitor Y is gaining 2 positions/month on your #1 keyword — consider a defensive content refresh."

### 7e: Risk Scoring (Future)

Combine all predictive signals into a per-page **vulnerability score**:

```typescript
interface PageRiskScore {
  pageUrl: string;
  riskScore: number;          // 0-100
  factors: Array<{
    factor: string;           // 'position_volatility', 'competitor_pressure', 'content_age', 'decay_velocity'
    contribution: number;     // how much this factor contributes to the score
    detail: string;           // human-readable explanation
  }>;
  recommendedAction: string;  // 'refresh_content', 'add_schema', 'build_links', 'monitor'
  urgency: 'immediate' | 'soon' | 'watch';
}
```

### 7f: Proactive Alerts

When risk scores cross thresholds, generate proactive insights:

- "Act Now" — risk score > 80, immediate action recommended
- "Watch" — risk score 50-80, monitoring recommended
- "Opportunity" — positive predictive signal (competitor losing ground, seasonal upswing approaching)

These integrate with the existing insight pipeline as a new insight category.

---

## Section 8: Action Playbooks

### Purpose

Once the system has enough outcome data, it can detect **winning sequences** — combinations of actions that consistently produce good results — and codify them as repeatable playbooks.

### Playbook Detection

The system analyzes multi-action pages (pages with 2+ tracked actions in a 30-day window) to find patterns:

```typescript
interface Playbook {
  id: string;
  workspaceId: string;
  name: string;                         // auto-generated, admin-editable
  triggerCondition: string;             // e.g., "content_decay detected"
  actionSequence: Array<{
    actionType: ActionType;
    timing: string;                     // "within 7 days", "within 14 days"
    detail: string;                     // "refresh content with updated statistics"
  }>;
  historicalWinRate: number;            // % of times this sequence produced a win
  sampleSize: number;                   // how many times this sequence has been observed
  confidence: 'high' | 'medium' | 'low';
  averageOutcome: {
    metric: string;
    avgImprovement: number;
    avgDaysToResult: number;
  };
}
```

**Example playbook:**

> **"Content Decay Recovery Protocol"**
> Trigger: Content decay insight detected (clicks down 20%+)
> Sequence:
> 1. Refresh content with updated data/statistics (within 7 days)
> 2. Add or update FAQ schema (within 7 days)
> 3. Add 2-3 internal links from high-authority pages (within 14 days)
>
> Historical win rate: 82% (14 of 17 instances)
> Average recovery: 73% of peak traffic within 60 days

### Playbook Activation

- **Phase 3a (passive):** System detects patterns, surfaces them in the admin Learnings Panel as "Discovered Patterns"
- **Phase 3b (suggested):** When a trigger condition is met, suggest the playbook: "We've seen this pattern before — this sequence works 82% of the time. Create actions?"
- **Phase 3c (automated):** Admin can set playbooks to auto-execute (auto-generate briefs, auto-prioritize recommendations) with confirmation

### Minimum Thresholds

- Pattern must have occurred 5+ times before surfacing as a discovered pattern
- Win rate must be > 60% to suggest as a playbook
- Must be > 75% with 10+ observations to offer auto-execution

---

## Technical Considerations

### Database Impact

- New tables: `tracked_actions`, `action_outcomes`, `workspace_learnings`
- Estimated row growth: ~50-200 tracked actions per workspace per month, ~4 outcomes per action = ~200-800 outcome rows per workspace per month
- SQLite handles this volume easily; no performance concerns
- Indexes on: `(workspace_id, action_type)`, `(workspace_id, created_at)`, `(attribution)`, `(measurement_window)`

### API Impact

- GSC/GA4 re-measurement queries are batched (one API call per workspace per day, not per action)
- Webflow page checks for external detection are rate-limited (max 10 pages per workspace per check)
- SEMRush: no additional calls until competitor companion ships
- AI token increase: ~5-10% on existing spend (learnings context in prompts)

### Cron Jobs

| Job | Frequency | Purpose |
|---|---|---|
| `measure-outcomes` | Daily | Score actions at due checkpoints |
| `detect-external` | Daily (high priority) / Weekly (all) | Check for externally executed recommendations |
| `compute-learnings` | Daily | Recompute workspace learnings cache |
| `detect-playbooks` | Weekly | Analyze multi-action pages for patterns |
| `compute-risk-scores` | Daily (Phase 3) | Update page vulnerability scores |

### Error Handling

- API failures during measurement: retry next day, don't skip the checkpoint
- Missing data (page deleted, API unavailable): mark outcome as `inconclusive` with reason
- Backfill errors: log and skip individual records, don't fail the entire backfill
- Learning computation errors: serve stale cache, never inject corrupted learnings

### Migration Strategy

1. Create tables with all fields from day one (no iterative migrations)
2. Run backfill as a one-time script after migration
3. Activate recording hooks across all systems
4. Enable learnings computation once backfill completes
5. Enable UI components
6. Enable external detection
7. Enable adaptive pipeline (after confidence thresholds met)

---

## Success Metrics

| Metric | Target | Measured By |
|---|---|---|
| Actions tracked per workspace/month | 30+ | DB query |
| Backfill coverage | 80%+ of historical actions reconstructed | Backfill completion report |
| Time to first learning | Day 1 (via backfill) | Learnings computation log |
| AI output improvement | Measurable preference in A/B (learnings vs no learnings) | Admin feedback / content performance |
| Client retention impact | Reduced churn for workspaces with outcome visibility | Stripe subscription data |
| "We Called It" detection rate | 50%+ of external implementations detected | Detection audit |
| Playbook discovery | 3+ playbooks per workspace within 6 months | Playbook table |

---

## Out of Scope (for this spec)

- Cross-workspace learning (each workspace is fully isolated)
- Competitor intelligence companion (separate spec, but schema is ready for it)
- Custom ML models / fine-tuning (learnings are prompt-injected, not model-trained)
- Real-time outcome scoring (daily batch is sufficient)
- Client self-service action tracking (admin-only for v1)

---

## Addendum A: Exact Integration Points

Every recording hook maps to a specific file, route, and function in the existing codebase. This is the authoritative reference for where to add `recordAction()` calls.

### Hook Map

| Event | File | Route | Hook Location | Data Available at Hook |
|---|---|---|---|---|
| **Insight resolved** | `server/routes/insights.ts` | `PUT /api/insights/:workspaceId/:insightId/resolve` | After `resolveInsight()` returns (~line 34) | `workspaceId`, `insightId`, `status` (in_progress/resolved), `note`, `updated` object |
| **Content published** | `server/routes/content-posts.ts` | `PATCH /api/content-posts/:workspaceId/:postId` | After `publishCollectionItems()` succeeds (~line 175) | `workspaceId`, `postId`, `targetKeyword`, `slug`, `webflowItemId`, `publishedAt` |
| **Brief created** | `server/routes/content-briefs.ts` | `POST /api/content-briefs/:workspaceId/generate` | After `generateBrief()` returns (~line 150) | `workspaceId`, `brief.id`, `targetKeyword`, `suggestedTitle`, `intent`, `wordCountTarget` |
| **Strategy keyword added** | `server/routes/keyword-strategy.ts` | `POST /api/webflow/keyword-strategy/:workspaceId` | After strategy is saved (~line 150+) | `workspaceId`, keyword clusters, competitor gaps, performance metrics |
| **Schema deployed** | `server/routes/webflow-schema.ts` | `POST /api/webflow/schema-publish/:siteId` | After `publishSchemaToPage()` (~line 147) | `siteId`, `pageId`, schema type (JSON-LD object), validation results |
| **Audit fix applied** | `server/routes/recommendations.ts` | `PATCH /api/public/recommendations/:workspaceId/:recId` | When `status === 'completed'` (~line 57-93) | `workspaceId`, `recId`, `priority`, `affectedPages[]` |
| **Internal link added** | `server/routes/webflow-analysis.ts` | `GET /api/webflow/internal-links/:siteId` | After `saveInternalLinks()` (~line 245) | `siteId`, `workspaceId`, suggestions with `{fromPage, toPage, anchorText, reason, priority}` |
| **Meta tag updated** | `server/routes/approvals.ts` | `POST /api/public/approvals/:workspaceId/:batchId/apply` | After `updatePageSeo()` (~line 274) | `workspaceId`, `batchId`, approved items with `{field, pageId, proposedValue}` |
| **Content refreshed** | `server/routes/content-decay.ts` | `POST /api/content-decay/:workspaceId/recommendations` | After `generateBatchRecommendations()` (~line 39) | `workspaceId`, `maxPages`, decay analysis with `{recommendations[], pages[]}` |
| **Approval workflow** | `server/routes/approvals.ts` | `PATCH /api/public/approvals/:workspaceId/:batchId/:itemId` | Lines 201-231 (approve/reject/revert) | `workspaceId`, `batchId`, `itemId`, `status`, time-to-approval |
| **Brand voice updated** | `server/routes/workspaces.ts` | `PUT /api/workspaces/:id/business-profile` | After save (~line 303) | `workspaceId`, `businessProfile` object with voice guidelines |
| **Voice generated** | `server/routes/workspaces.ts` | `POST /api/workspaces/:id/generate-brand-voice` | After generation (~line 440) | `workspaceId`, generated voice guide with tone, style, vocabulary |

### Activity Types to Add

New entries needed in `server/activity-log.ts` `ActivityType` union (existing types shown for reference):

```typescript
// Existing (relevant):
// 'insight_resolved', 'content_published', 'brief_generated',
// 'approval_applied', 'schema_published', 'content_updated'

// New:
| 'outcome_scored'          // When a 30/60/90-day checkpoint completes
| 'external_action_detected' // When external execution is detected
| 'playbook_suggested'      // When a playbook pattern is discovered
| 'learnings_updated'       // When workspace learnings are recomputed (admin-visible)
```

---

## Addendum B: API Endpoints

### New REST Endpoints

```
# Action tracking
GET    /api/outcomes/:workspaceId/actions           # List tracked actions (filterable by type, status, score)
GET    /api/outcomes/:workspaceId/actions/:actionId  # Single action with all checkpoints
POST   /api/outcomes/:workspaceId/actions/:actionId/note  # Admin adds context note to action

# Outcome data
GET    /api/outcomes/:workspaceId/scorecard          # Aggregate win/loss stats for dashboard
GET    /api/outcomes/:workspaceId/top-wins            # Highest-impact outcomes
GET    /api/outcomes/:workspaceId/timeline            # Action timeline with scores

# Learnings
GET    /api/outcomes/:workspaceId/learnings           # Current workspace learnings (what AI sees)
PATCH  /api/outcomes/:workspaceId/learnings/:id/override  # Admin overrides a specific learning

# Playbooks (Phase 3)
GET    /api/outcomes/:workspaceId/playbooks           # Discovered playbooks
PATCH  /api/outcomes/:workspaceId/playbooks/:id       # Enable/disable auto-execution

# Client-facing (public routes)
GET    /api/public/outcomes/:workspaceId/summary      # Tiered summary (respects workspace tier)
GET    /api/public/outcomes/:workspaceId/wins          # "We Called It" highlights
```

### Route Organization

New route file: `server/routes/outcomes.ts`
- Mounted at `/api/outcomes` and `/api/public/outcomes`
- Follows existing pattern from `server/routes/insights.ts`
- Admin routes use `authenticateToken` middleware
- Public routes use `authenticateClientToken` middleware

---

## Addendum C: WebSocket Events + React Query Keys

### New WebSocket Events

Add to both `server/ws-events.ts` and `src/lib/wsEvents.ts`:

```typescript
// Convention: 'category:action' (lowercase, colon-separated)
OUTCOME_SCORED: 'outcome:scored',               // 7/30/60/90-day checkpoint completed
EXTERNAL_ACTION_DETECTED: 'outcome:external',   // External execution detected
LEARNINGS_UPDATED: 'outcome:learnings_updated',  // Daily learnings recomputation
PLAYBOOK_DISCOVERED: 'outcome:playbook',         // New playbook pattern found
```

### New React Query Keys

Add to `src/lib/queryKeys.ts`:

```typescript
admin: {
  // ... existing keys ...
  outcomeActions: (wsId: string) => ['admin-outcome-actions', wsId] as const,
  outcomeScorecard: (wsId: string) => ['admin-outcome-scorecard', wsId] as const,
  outcomeTimeline: (wsId: string) => ['admin-outcome-timeline', wsId] as const,
  outcomeLearnings: (wsId: string) => ['admin-outcome-learnings', wsId] as const,
  outcomePlaybooks: (wsId: string) => ['admin-outcome-playbooks', wsId] as const,
  outcomeTopWins: (wsId: string) => ['admin-outcome-top-wins', wsId] as const,
},
client: {
  // ... existing keys ...
  outcomeSummary: (wsId: string) => ['client-outcome-summary', wsId] as const,
  outcomeWins: (wsId: string) => ['client-outcome-wins', wsId] as const,
}
```

### WebSocket → Query Invalidation Map

```typescript
// In useWebSocket handler:
'outcome:scored'             → invalidate ['admin-outcome-actions', wsId],
                               ['admin-outcome-scorecard', wsId],
                               ['admin-outcome-timeline', wsId],
                               ['admin-outcome-top-wins', wsId]
'outcome:external'           → invalidate ['admin-outcome-actions', wsId],
                               ['client-outcome-wins', wsId]
'outcome:learnings_updated'  → invalidate ['admin-outcome-learnings', wsId]
'outcome:playbook'           → invalidate ['admin-outcome-playbooks', wsId]
```

---

## Addendum D: Feature Flags

Add to `shared/types/feature-flags.ts`:

```typescript
export const FEATURE_FLAGS = {
  // ... existing flags ...
  'outcome-tracking': false,           // Phase 0+1: action registry, measurement, backfill
  'outcome-dashboard': false,          // Phase 1b: admin scorecard and learnings panel
  'outcome-ai-injection': false,       // Phase 1b: learnings injected into AI prompts
  'outcome-client-reporting': false,   // Phase 2: client-facing outcome views
  'outcome-external-detection': false, // Phase 2: external execution detection
  'outcome-adaptive-pipeline': false,  // Phase 3: pipeline auto-prioritization
  'outcome-playbooks': false,          // Phase 3: action playbook discovery
  'outcome-predictive': false,         // Phase 3: risk scores, proactive alerts
} as const;
```

**Env var pattern:** `FEATURE_OUTCOME_TRACKING=true` enables `'outcome-tracking'`.

**Rollout order:**
1. `outcome-tracking` — enables recording hooks and measurement cron (no UI)
2. `outcome-dashboard` + `outcome-ai-injection` — enables admin visibility and AI improvements
3. `outcome-client-reporting` + `outcome-external-detection` — enables client-facing features
4. `outcome-adaptive-pipeline` + `outcome-playbooks` + `outcome-predictive` — enables Phase 3

---

## Addendum E: UI Placement + Navigation

### Admin Dashboard

**New Page:** `'outcomes'` added to `Page` type in `src/routes.ts`

**Sidebar placement:** Under the Analytics group, after "Performance":
```
Analytics Hub
Performance
Content Performance
→ Outcomes        ← NEW
```

**Components to build:**

| Component | Location | Primitives Used |
|---|---|---|
| `OutcomeDashboard.tsx` | `src/components/admin/outcomes/` | `PageHeader`, `SectionCard`, `TabBar` |
| `OutcomeScorecard.tsx` | Same | `StatCard`, `MetricRing` for win rate |
| `OutcomeActionFeed.tsx` | Same | `DataList`, `StatusBadge`, `Badge` |
| `OutcomeTopWins.tsx` | Same | `SectionCard`, `CompactStatBar` |
| `OutcomeLearningsPanel.tsx` | Same | `SectionCard` with toggleable overrides |
| `OutcomeTimeline.tsx` | Same | Custom timeline (follows activity log pattern) |

**Client Dashboard integration:**

| Component | Location | Tier Gate |
|---|---|---|
| `ClientOutcomeSummary.tsx` | `src/components/client/` | Free: top 3 wins. Growth+: full. Premium: with competitor context |
| `ClientWeCalledIt.tsx` | Same | Growth+: top 1. Premium: all |

**Empty States (pre-data):**

| State | Message | CTA |
|---|---|---|
| No tracked actions yet | "Outcomes tracking is active. As you act on insights, publish content, and deploy fixes, results will appear here." | None (passive) |
| Actions tracked but no scores yet | "12 actions are being tracked. First results will appear in 7 days." | View pending actions |
| Backfill complete, learnings available | "Based on your history, we've already identified patterns." | View learnings |

### Route Registration Checklist

Per CLAUDE.md route conventions:
1. `src/routes.ts` — add `'outcomes'` to `Page` union
2. `src/App.tsx` — add `renderContent()` case
3. `src/components/layout/Sidebar.tsx` — add sidebar entry under Analytics
4. `src/components/layout/Breadcrumbs.tsx` — add to `TAB_LABELS`
5. `src/components/CommandPalette.tsx` — add to `NAV_ITEMS`

---

## Addendum F: Migration SQL

```sql
-- Migration: 044_outcome_tracking.sql

CREATE TABLE IF NOT EXISTS tracked_actions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  page_url TEXT,
  target_keyword TEXT,
  baseline_snapshot TEXT NOT NULL DEFAULT '{}',
  trailing_history TEXT NOT NULL DEFAULT '{}',
  attribution TEXT NOT NULL DEFAULT 'not_acted_on',
  measurement_window INTEGER NOT NULL DEFAULT 90,
  measurement_complete INTEGER NOT NULL DEFAULT 0,
  source_flag TEXT NOT NULL DEFAULT 'live',
  baseline_confidence TEXT NOT NULL DEFAULT 'exact',
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_tracked_actions_workspace ON tracked_actions(workspace_id, action_type);
CREATE INDEX idx_tracked_actions_attribution ON tracked_actions(workspace_id, attribution);
CREATE INDEX idx_tracked_actions_created ON tracked_actions(workspace_id, created_at);
CREATE INDEX idx_tracked_actions_page ON tracked_actions(workspace_id, page_url);
CREATE INDEX idx_tracked_actions_measurement ON tracked_actions(measurement_complete, created_at);

CREATE TABLE IF NOT EXISTS action_outcomes (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  checkpoint_days INTEGER NOT NULL,
  metrics_snapshot TEXT NOT NULL DEFAULT '{}',
  score TEXT,
  delta_summary TEXT NOT NULL DEFAULT '{}',
  competitor_context TEXT NOT NULL DEFAULT '{}',
  measured_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (action_id) REFERENCES tracked_actions(id) ON DELETE CASCADE
);

CREATE INDEX idx_action_outcomes_action ON action_outcomes(action_id, checkpoint_days);
CREATE UNIQUE INDEX idx_action_outcomes_unique ON action_outcomes(action_id, checkpoint_days);

CREATE TABLE IF NOT EXISTS workspace_learnings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  learnings TEXT NOT NULL DEFAULT '{}',
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_playbooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  action_sequence TEXT NOT NULL DEFAULT '[]',
  historical_win_rate REAL NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'low',
  average_outcome TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_action_playbooks_workspace ON action_playbooks(workspace_id);
```

---

## Addendum G: Testing Strategy

### Unit Tests

| Module | Test Focus |
|---|---|
| `server/outcome-tracking.ts` | `recordAction()` creates correct baseline snapshots per action type |
| `server/outcome-measurement.ts` | Scoring logic: verify thresholds produce correct scores for each action type |
| `server/outcome-measurement.ts` | Edge cases: page deleted, insufficient data, multi-action pages |
| `server/workspace-learnings.ts` | Learnings computation: correct aggregation, confidence thresholds, formatting |
| `server/workspace-learnings.ts` | Cache behavior: stale cache served on error, daily refresh |
| `server/outcome-backfill.ts` | Backfill: correct source mapping, estimated vs exact baselines, skip-on-error |
| `server/external-detection.ts` | Detection signals: schema appeared, content changed, meta updated |
| `server/external-detection.ts` | False positive handling: two-check confirmation |
| `server/outcome-playbooks.ts` | Pattern detection: correct sequence matching, threshold enforcement |

### Integration Tests

| Test | Verifies |
|---|---|
| Publish content → action recorded → 7-day check → scored | Full lifecycle |
| Resolve insight → action recorded → metrics fetched → scored | Insight flow |
| Backfill script → learnings computed → AI prompt includes learnings | Backfill → AI loop |
| External detection → attribution changed → "We Called It" generated | External flow |
| Multiple actions on same page → all scored, multi-action flag set | Multi-action handling |

### Test Data Strategy

- Tests use deterministic GSC/GA4 mock data with known outcomes
- Backfill tests use seeded DB with known historical records
- Scoring tests cover all 5 outcome scores for each action type
- Empty array assertions always check `length > 0` first (per CLAUDE.md)

### What NOT to Test (per CLAUDE.md)

- Don't test SQLite internals or migration SQL directly
- Don't test React Query caching behavior (trust the library)
- Don't test WebSocket delivery (covered by existing ws tests)

---

## Addendum H: Zod Schemas for JSON Columns

All JSON columns must be validated with Zod schemas via `parseJsonSafe`/`parseJsonSafeArray` from `server/db/json-validation.ts`. Never bare `JSON.parse`.

New file: `server/schemas/outcome-schemas.ts`

```typescript
import { z } from '../middleware/validate.js';

// --- Baseline Snapshot ---

export const baselineSnapshotSchema = z.object({
  captured_at: z.string(),

  // GSC metrics (present when page_url exists)
  position: z.number().optional(),
  clicks: z.number().optional(),
  impressions: z.number().optional(),
  /** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: z.number().optional(),

  // GA4 metrics (present when GA4 connected)
  sessions: z.number().optional(),
  /** Already a percentage. */
  bounce_rate: z.number().optional(),
  /** Already a percentage. */
  engagement_rate: z.number().optional(),
  conversions: z.number().optional(),

  // Audit metrics
  page_health_score: z.number().min(0).max(100).optional(),

  // Schema metrics
  rich_result_eligible: z.boolean().optional(),
  rich_result_appearing: z.boolean().optional(),

  // Voice metrics
  voice_score: z.number().min(0).max(100).optional(),
});

export type BaselineSnapshot = z.infer<typeof baselineSnapshotSchema>;

// --- Trailing History ---

export const trailingDataPointSchema = z.object({
  date: z.string(),
  value: z.number(),
});

export const trailingHistorySchema = z.object({
  metric: z.string(),
  dataPoints: z.array(trailingDataPointSchema),
});

export type TrailingHistory = z.infer<typeof trailingHistorySchema>;

// --- Delta Summary ---

export const deltaSummarySchema = z.object({
  primary_metric: z.string(),
  baseline_value: z.number(),
  current_value: z.number(),
  delta_absolute: z.number(),
  delta_percent: z.number(),
  direction: z.enum(['improved', 'declined', 'stable']),
});

export type DeltaSummary = z.infer<typeof deltaSummarySchema>;

// --- Action Context ---

export const competitorMovementSchema = z.object({
  domain: z.string(),
  keyword: z.string(),
  positionChange: z.number(),
  newContent: z.boolean().optional(),
});

export const competitorContextSchema = z.object({
  competitorMovement: z.array(competitorMovementSchema).optional(),
});

export const actionContextSchema = z.object({
  competitorActivity: competitorContextSchema.optional(),
  seasonalTag: z.object({
    month: z.number().min(1).max(12),
    quarter: z.number().min(1).max(4),
  }).optional(),
  relatedActions: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type ActionContext = z.infer<typeof actionContextSchema>;

// --- Playbook Action Sequence ---

export const playbookStepSchema = z.object({
  actionType: z.enum([
    'insight_acted_on', 'content_published', 'brief_created',
    'strategy_keyword_added', 'schema_deployed', 'audit_fix_applied',
    'content_refreshed', 'internal_link_added', 'meta_updated',
    'voice_calibrated',
  ]),
  timing: z.string(),
  detail: z.string(),
});

export const playbookSequenceSchema = z.array(playbookStepSchema);

// --- Playbook Average Outcome ---

export const playbookOutcomeSchema = z.object({
  metric: z.string(),
  avgImprovement: z.number(),
  avgDaysToResult: z.number(),
});

// --- Workspace Learnings (cached JSON) ---

export const contentLearningsSchema = z.object({
  winRateByFormat: z.record(z.string(), z.number()),
  avgDaysToPage1: z.number().nullable(),
  bestPerformingTopics: z.array(z.string()),
  optimalWordCount: z.object({ min: z.number(), max: z.number() }).nullable(),
  refreshRecoveryRate: z.number(),
  voiceScoreCorrelation: z.number().nullable(),
});

export const strategyLearningsSchema = z.object({
  winRateByDifficultyRange: z.record(z.string(), z.number()),
  avgTimeToRank: z.record(z.string(), z.number()),
  bestIntentTypes: z.array(z.string()),
  keywordVolumeSweetSpot: z.object({ min: z.number(), max: z.number() }).nullable(),
});

export const technicalLearningsSchema = z.object({
  winRateByFixType: z.record(z.string(), z.number()),
  schemaTypesWithRichResults: z.array(z.string()),
  avgHealthScoreImprovement: z.number(),
  internalLinkEffectiveness: z.number(),
});

export const overallLearningsSchema = z.object({
  totalWinRate: z.number(),
  strongWinRate: z.number(),
  topActionTypes: z.array(z.object({
    type: z.string(),
    winRate: z.number(),
    count: z.number(),
  })),
  recentTrend: z.enum(['improving', 'stable', 'declining']),
});

export const workspaceLearningsSchema = z.object({
  workspaceId: z.string(),
  computedAt: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  totalScoredActions: z.number(),
  content: contentLearningsSchema.nullable(),
  strategy: strategyLearningsSchema.nullable(),
  technical: technicalLearningsSchema.nullable(),
  overall: overallLearningsSchema,
});

export type WorkspaceLearnings = z.infer<typeof workspaceLearningsSchema>;

// --- Scoring Thresholds (configurable per workspace) ---

export const scoringThresholdSchema = z.object({
  strong_win: z.number(),
  win: z.number(),
  neutral_band: z.number(),  // +/- this value = neutral
  // Anything outside neutral that isn't a win = loss
});

export const scoringConfigSchema = z.object({
  content_published: z.object({
    primary_metric: z.literal('position'),
    thresholds: scoringThresholdSchema,
  }),
  insight_acted_on: z.object({
    primary_metric: z.literal('varies'),
    thresholds: scoringThresholdSchema,
  }),
  strategy_keyword_added: z.object({
    primary_metric: z.literal('position'),
    thresholds: scoringThresholdSchema,
  }),
  schema_deployed: z.object({
    primary_metric: z.literal('ctr'),
    thresholds: scoringThresholdSchema,
  }),
  audit_fix_applied: z.object({
    primary_metric: z.literal('page_health_score'),
    thresholds: scoringThresholdSchema,
  }),
  content_refreshed: z.object({
    primary_metric: z.literal('click_recovery'),
    thresholds: scoringThresholdSchema,
  }),
  internal_link_added: z.object({
    primary_metric: z.literal('target_improvement'),
    thresholds: scoringThresholdSchema,
  }),
  meta_updated: z.object({
    primary_metric: z.literal('ctr'),
    thresholds: scoringThresholdSchema,
  }),
  voice_calibrated: z.object({
    primary_metric: z.literal('voice_score'),
    thresholds: scoringThresholdSchema,
  }),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
```

### Default Scoring Thresholds

Stored as a constant, overridable per workspace:

```typescript
// server/outcome-scoring-defaults.ts

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  content_published: {
    primary_metric: 'position',
    thresholds: { strong_win: 10, win: 3, neutral_band: 1 },
    // strong_win: reached top 10; win: improved 3+; neutral: within +/- 1
  },
  insight_acted_on: {
    primary_metric: 'varies',
    thresholds: { strong_win: 30, win: 15, neutral_band: 10 },
    // Percentage improvement thresholds
  },
  strategy_keyword_added: {
    primary_metric: 'position',
    thresholds: { strong_win: 10, win: 5, neutral_band: 3 },
    // strong_win: reached top 10; win: improved 5+; neutral: within +/- 3
  },
  schema_deployed: {
    primary_metric: 'ctr',
    thresholds: { strong_win: 20, win: 10, neutral_band: 5 },
    // Percentage CTR change thresholds
  },
  audit_fix_applied: {
    primary_metric: 'page_health_score',
    thresholds: { strong_win: 15, win: 5, neutral_band: 3 },
    // Absolute health score change
  },
  content_refreshed: {
    primary_metric: 'click_recovery',
    thresholds: { strong_win: 80, win: 40, neutral_band: 20 },
    // Percentage of peak traffic recovered
  },
  internal_link_added: {
    primary_metric: 'target_improvement',
    thresholds: { strong_win: 20, win: 10, neutral_band: 5 },
    // Percentage improvement in target page metrics
  },
  meta_updated: {
    primary_metric: 'ctr',
    thresholds: { strong_win: 15, win: 5, neutral_band: 5 },
    // Percentage CTR change
  },
  voice_calibrated: {
    primary_metric: 'voice_score',
    thresholds: { strong_win: 85, win: 70, neutral_band: 10 },
    // Absolute voice score (strong_win/win are minimums, not deltas)
  },
};
```

---

## Addendum I: Row Mappers

Per CLAUDE.md: every table requires a `rowToX()` mapper. DB rows use snake_case; TypeScript uses camelCase.

New file: `server/db/outcome-mappers.ts`

```typescript
import { parseJsonSafe } from './json-validation.js';
import {
  baselineSnapshotSchema,
  trailingHistorySchema,
  actionContextSchema,
  deltaSummarySchema,
  competitorContextSchema,
  playbookSequenceSchema,
  playbookOutcomeSchema,
  scoringConfigSchema,
} from '../schemas/outcome-schemas.js';
import type {
  TrackedAction,
  ActionOutcome,
  ActionPlaybook,
} from '../../shared/types/outcome-tracking.js';

interface TrackedActionRow {
  id: string;
  workspace_id: string;
  action_type: string;
  source_type: string;
  source_id: string | null;
  page_url: string | null;
  target_keyword: string | null;
  baseline_snapshot: string;
  trailing_history: string;
  attribution: string;
  measurement_window: number;
  measurement_complete: number;
  source_flag: string;
  baseline_confidence: string;
  context: string;
  created_at: string;
  updated_at: string;
}

interface ActionOutcomeRow {
  id: string;
  action_id: string;
  checkpoint_days: number;
  metrics_snapshot: string;
  score: string | null;
  delta_summary: string;
  competitor_context: string;
  measured_at: string;
}

interface ActionPlaybookRow {
  id: string;
  workspace_id: string;
  name: string;
  trigger_condition: string;
  action_sequence: string;
  historical_win_rate: number;
  sample_size: number;
  confidence: string;
  average_outcome: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const EMPTY_BASELINE = { captured_at: new Date().toISOString() };
const EMPTY_HISTORY = { metric: '', dataPoints: [] };
const EMPTY_CONTEXT = {};
const EMPTY_DELTA = {
  primary_metric: '',
  baseline_value: 0,
  current_value: 0,
  delta_absolute: 0,
  delta_percent: 0,
  direction: 'stable' as const,
};

export function rowToTrackedAction(row: TrackedActionRow): TrackedAction {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actionType: row.action_type as TrackedAction['actionType'],
    sourceType: row.source_type,
    sourceId: row.source_id,
    pageUrl: row.page_url,
    targetKeyword: row.target_keyword,
    baselineSnapshot: parseJsonSafe(row.baseline_snapshot, baselineSnapshotSchema, EMPTY_BASELINE, 'tracked_actions.baseline_snapshot'),
    trailingHistory: parseJsonSafe(row.trailing_history, trailingHistorySchema, EMPTY_HISTORY, 'tracked_actions.trailing_history'),
    attribution: row.attribution as TrackedAction['attribution'],
    measurementWindow: row.measurement_window,
    measurementComplete: row.measurement_complete === 1,
    sourceFlag: row.source_flag as TrackedAction['sourceFlag'],
    baselineConfidence: row.baseline_confidence as TrackedAction['baselineConfidence'],
    context: parseJsonSafe(row.context, actionContextSchema, EMPTY_CONTEXT, 'tracked_actions.context'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToActionOutcome(row: ActionOutcomeRow): ActionOutcome {
  return {
    id: row.id,
    actionId: row.action_id,
    checkpointDays: row.checkpoint_days as ActionOutcome['checkpointDays'],
    metricsSnapshot: parseJsonSafe(row.metrics_snapshot, baselineSnapshotSchema, EMPTY_BASELINE, 'action_outcomes.metrics_snapshot'),
    score: row.score as ActionOutcome['score'],
    deltaSummary: parseJsonSafe(row.delta_summary, deltaSummarySchema, EMPTY_DELTA, 'action_outcomes.delta_summary'),
    competitorContext: parseJsonSafe(row.competitor_context, competitorContextSchema, null, 'action_outcomes.competitor_context'),
    measuredAt: row.measured_at,
  };
}

export function rowToActionPlaybook(row: ActionPlaybookRow): ActionPlaybook {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    triggerCondition: row.trigger_condition,
    actionSequence: parseJsonSafe(row.action_sequence, playbookSequenceSchema, [], 'action_playbooks.action_sequence'),
    historicalWinRate: row.historical_win_rate,
    sampleSize: row.sample_size,
    confidence: row.confidence as ActionPlaybook['confidence'],
    averageOutcome: parseJsonSafe(row.average_outcome, playbookOutcomeSchema, { metric: '', avgImprovement: 0, avgDaysToResult: 0 }, 'action_playbooks.average_outcome'),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

---

## Addendum J: Data Retention Policy

### Retention Rules

| Data | Retention | Rationale |
|---|---|---|
| `tracked_actions` (active) | Indefinite while measurement window is open | Needed for scoring |
| `tracked_actions` (measurement_complete) | **24 months** after final checkpoint | Long enough for seasonal analysis and trend detection |
| `action_outcomes` | Same as parent `tracked_actions` | Tied to action lifecycle |
| `workspace_learnings` | Always current (single row per workspace, overwritten daily) | Cache, not historical |
| `action_playbooks` | Indefinite (admin-managed) | Playbooks are curated artifacts |
| Backfilled actions (`source_flag = 'backfill'`) | Same 24-month rule from final checkpoint | No special treatment |

### Archival Process

- **Monthly cron job:** `archive-old-outcomes`
  - Moves `tracked_actions` + `action_outcomes` older than 24 months to `tracked_actions_archive` / `action_outcomes_archive` tables (same schema)
  - Archive tables are read-only — queryable for historical analysis but not included in learnings computation
  - Admin can export archived data as CSV from the Outcomes dashboard

### Archive Migration SQL

```sql
-- Added to migration file alongside main tables

CREATE TABLE IF NOT EXISTS tracked_actions_archive (
  -- Identical schema to tracked_actions
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  page_url TEXT,
  target_keyword TEXT,
  baseline_snapshot TEXT NOT NULL DEFAULT '{}',
  trailing_history TEXT NOT NULL DEFAULT '{}',
  attribution TEXT NOT NULL DEFAULT 'not_acted_on',
  measurement_window INTEGER NOT NULL DEFAULT 90,
  measurement_complete INTEGER NOT NULL DEFAULT 0,
  source_flag TEXT NOT NULL DEFAULT 'live',
  baseline_confidence TEXT NOT NULL DEFAULT 'exact',
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS action_outcomes_archive (
  -- Identical schema to action_outcomes
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  checkpoint_days INTEGER NOT NULL,
  metrics_snapshot TEXT NOT NULL DEFAULT '{}',
  score TEXT,
  delta_summary TEXT NOT NULL DEFAULT '{}',
  competitor_context TEXT NOT NULL DEFAULT '{}',
  measured_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tracked_actions_archive_workspace ON tracked_actions_archive(workspace_id);
CREATE INDEX idx_action_outcomes_archive_action ON action_outcomes_archive(action_id);
```

### Why 24 Months

- Covers two full seasonal cycles (needed for seasonal normalization in Section 7c)
- Long enough for playbook pattern detection across multiple occurrences
- Short enough to prevent stale data from skewing learnings
- At ~800 outcome rows/workspace/month, 24 months = ~19,200 rows per workspace. SQLite handles this easily.

---

## Addendum K: Multi-Workspace Admin Overview

### Purpose

Joshua manages multiple client workspaces. A global admin view shows outcome health across all clients without switching workspaces.

### Location

**New global tab:** `'outcomes-overview'` added to `GLOBAL_TABS` in `src/routes.ts`

**Sidebar placement:** Under global admin section (alongside Settings, Roadmap, AI Usage):
```
Settings
Roadmap
AI Usage
Revenue
→ Outcomes Overview    ← NEW
```

### Overview Dashboard

**Workspace Scorecard Table:**

| Column | Description |
|---|---|
| Workspace name | Client name with link to workspace outcomes tab |
| Win rate | Overall win rate (color-coded: green >70%, amber 40-70%, red <40%) |
| Trend | Arrow: improving / stable / declining over last 3 months |
| Active actions | Count of actions currently being measured |
| Scored (30d) | Actions that reached a checkpoint in the last 30 days |
| Top win | Best outcome this month (one-liner) |
| Attention needed | Flag if: win rate declining, no actions in 30 days, or "We Called It" opportunity |

**Aggregate Stats (top of page):**
- Total win rate across all workspaces
- Total actions tracked / scored this month
- "We Called It" detections this month
- Best-performing workspace this month

**Insights Panel:**
- "Client X hasn't had any new actions in 45 days — consider reaching out"
- "Client Y's win rate jumped from 52% to 78% — good candidate for case study"
- "Schema deployments have 85% win rate across all clients — consider making this a standard offering"

### API Endpoint

```
GET /api/outcomes/overview    # Admin-only, returns all workspace scorecards
```

Uses existing `authenticateToken` (admin JWT). Queries `tracked_actions` + `action_outcomes` grouped by `workspace_id`. Cached for 1 hour.

### Components

| Component | Primitives |
|---|---|
| `OutcomesOverview.tsx` in `src/components/admin/outcomes/` | `PageHeader`, `SectionCard`, `DataList` |
| `WorkspaceOutcomeRow.tsx` | `StatusBadge`, `Badge`, inline sparkline for trend |

---

## Addendum L: Scoring Calibration

### Purpose

Different workspaces operate in different competitive environments. A local dentist and a SaaS company have very different expectations for what "winning" looks like. Scoring thresholds should be tunable.

### Default vs Custom Thresholds

Every workspace starts with `DEFAULT_SCORING_CONFIG` (defined in Addendum H). Admins can override per workspace.

### Storage

New column on `workspaces` table:

```sql
-- Migration addition
ALTER TABLE workspaces ADD COLUMN scoring_config TEXT DEFAULT NULL;
```

- `NULL` = use defaults
- When set, validated against `scoringConfigSchema` (partial overrides allowed — only override the action types you want to change, inherit defaults for the rest)

### Partial Override Schema

```typescript
// Partial override — only specify what you want to change
export const scoringConfigOverrideSchema = scoringConfigSchema.partial();

// Resolution: merge default + override
export function resolveScoringConfig(
  override: Partial<ScoringConfig> | null
): ScoringConfig {
  if (!override) return DEFAULT_SCORING_CONFIG;
  return {
    ...DEFAULT_SCORING_CONFIG,
    ...override,
  };
}
```

### UI

- Located in workspace settings (not the outcomes dashboard)
- Simple form: for each action type, show current thresholds with edit capability
- "Reset to defaults" button
- Preview: "With these thresholds, X of your past outcomes would be reclassified"
- Changes are prospective only — existing scores are not retroactively changed (but admin can trigger a one-time rescore)

### API

```
GET    /api/workspaces/:id/scoring-config     # Returns resolved config (defaults + overrides)
PATCH  /api/workspaces/:id/scoring-config     # Update overrides
DELETE /api/workspaces/:id/scoring-config     # Reset to defaults
POST   /api/workspaces/:id/scoring-config/rescore  # One-time rescore of all outcomes
```

### Auto-Calibration (Phase 3 Enhancement)

Once the system has enough data (50+ scored outcomes), it could suggest threshold adjustments:

> "Based on your outcome data, the current 'win' threshold of 3 positions for content_published catches 80% of meaningful improvements. Consider lowering to 2 to capture more incremental wins."

This is a suggestion only — never auto-changes thresholds without admin approval.
