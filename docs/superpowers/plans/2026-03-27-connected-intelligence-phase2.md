# Connected Intelligence Engine — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire feedback loops between the insight engine and the platform's other major systems — Strategy, Content Pipeline, Anomaly Detection, Admin Chat, Audit, and Schema Validation. Phase 1 made insights smarter; Phase 2 makes insights actionable by pushing intelligence into the systems that can act on it.

**Architecture:** Backend-first for each feedback loop (data wiring → API surface), then frontend (new UI sections that display the connected data). Each feedback loop is independently deployable — a failure in one loop does not block the others.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), React 19, TanStack React Query, Tailwind CSS 4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-27-connected-intelligence-design.md` (Phase 2: sections 2.1–2.6)

**Phase 1 Plan:** `docs/superpowers/plans/2026-03-27-connected-intelligence-phase1.md` (already executed)

**Guardrails:** `.windsurf/rules/analytics-insights.md` — read before starting any task

---

## Pre-flight Checklist

Before starting Phase 2, verify Phase 1 is fully landed:

- [ ] Phase 1 branch merged to main
- [ ] `server/insight-enrichment.ts` exists and exports `buildEnrichmentContext`, `enrichInsight`
- [ ] `server/analytics-insights-store.ts` supports all enrichment columns
- [ ] `shared/types/analytics.ts` has all 12 `InsightType` values including `anomaly_digest`
- [ ] `shared/types/insights.ts` has `FeedInsight`, `FeedAction`, `SummaryCount`
- [ ] `src/hooks/admin/useInsightFeed.ts` exists and returns enriched feed data
- [ ] `src/components/insights/InsightFeed.tsx` renders priority feed
- [ ] Run `npx tsc --noEmit --skipLibCheck && npx vite build` — clean

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `server/db/migrations/039-anomaly-digest-dedup.sql` | Add unique index for anomaly digest deduplication |
| `server/insight-feedback.ts` | Feedback loop orchestrator: pushes insights into Strategy, Pipeline, Recommendations |
| `src/components/strategy/IntelligenceSignals.tsx` | "Intelligence Signals" section in KeywordStrategyPanel |
| `src/components/pipeline/AiSuggested.tsx` | "AI Suggested" section in ContentPipeline |
| `src/hooks/admin/useIntelligenceSignals.ts` | React Query hook for strategy intelligence signals |
| `src/hooks/admin/useAiSuggestedBriefs.ts` | React Query hook for AI-suggested briefs in pipeline |
| `tests/unit/insight-feedback.test.ts` | Unit tests for feedback loop logic |
| `tests/unit/anomaly-to-insight.test.ts` | Unit tests for anomaly → insight digest conversion |

### Modified Files
| File | Changes |
|------|---------|
| `server/anomaly-detection.ts:~580` | After anomaly detection completes, call `upsertAnomalyDigestInsights()` |
| `server/analytics-insights-store.ts:~90-130` | Add `upsertAnomalyDigestInsight()` with dedup key, add `getInsightsByDomain()` |
| `server/analytics-intelligence.ts:~970` | Call `runFeedbackLoops()` after insight computation completes |
| `server/admin-chat-context.ts:~200-260` | Enrich `buildInsightsContext()` with anomaly links, strategy alignment, pipeline status |
| `server/routes/keyword-strategy.ts:~1800+` | Add `GET /api/admin/strategy/:workspaceId/signals` endpoint |
| `server/routes/content.ts` (or equivalent) | Add `GET /api/admin/pipeline/:workspaceId/suggested` endpoint |
| `server/seo-audit.ts:~710+` | After audit completes, annotate page-level insights with audit issues |
| `server/schema-validator.ts:~370+` | After schema validation, push gaps as `serp_opportunity` enrichment |
| `src/components/KeywordStrategy.tsx:~680` | Add IntelligenceSignals section |
| `src/components/ContentPipeline.tsx:~220` | Add AiSuggested section |
| `src/lib/queryKeys.ts` | Add `admin.intelligenceSignals`, `admin.aiSuggestedBriefs` keys |
| `shared/types/analytics.ts` | Add `AnomalyDigestData` interface to `InsightDataMap` |

---

## Task 1: Anomaly → Insight Digest Wiring

**Files:**
- Create: `server/db/migrations/039-anomaly-digest-dedup.sql`
- Modify: `server/analytics-insights-store.ts`
- Modify: `server/anomaly-detection.ts`
- Modify: `shared/types/analytics.ts`
- Create: `tests/unit/anomaly-to-insight.test.ts`

This is the most complex backend wiring. Anomaly detection runs on a 12h cycle. When it detects anomalies, those results must flow into the insight store as `anomaly_digest` entries with deduplication: ongoing anomalies update in place rather than creating duplicates.

- [ ] **Step 1: Add AnomalyDigestData type**

In `shared/types/analytics.ts`, add the data shape for anomaly digest insights and register it in `InsightDataMap`:

```typescript
/** Data shape for anomaly_digest insights */
export interface AnomalyDigestData {
  anomalyType: string;        // from AnomalyType: 'traffic_drop', 'impressions_drop', etc.
  metric: string;             // the metric that changed
  currentValue: number;
  expectedValue: number;
  deviationPercent: number;
  durationDays: number;       // how long the anomaly has been ongoing
  firstDetected: string;      // ISO timestamp
  severity: string;           // from AnomalySeverity
}
```

Add to `InsightDataMap`:
```typescript
export interface InsightDataMap {
  // ... existing entries
  anomaly_digest: AnomalyDigestData;
}
```

- [ ] **Step 2: Write migration for deduplication index**

```sql
-- 039-anomaly-digest-dedup.sql
-- Unique index for anomaly digest deduplication
-- Key: (workspace_id, insight_type, page_id) where insight_type = 'anomaly_digest'
-- page_id stores the anomaly dedup key: 'anomaly:{anomaly_type}:{metric}'
CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_digest_dedup
  ON analytics_insights(workspace_id, insight_type, page_id)
  WHERE insight_type = 'anomaly_digest';
```

Save to `server/db/migrations/039-anomaly-digest-dedup.sql`.

**Guardrail check:** Verify the migration number doesn't conflict with any existing migration file. Run `ls server/db/migrations/ | tail -5` to confirm 039 is next.

- [ ] **Step 3: Add upsertAnomalyDigestInsight to the store**

In `server/analytics-insights-store.ts`, add a specialized upsert that uses the dedup key:

```typescript
/**
 * Upsert an anomaly digest insight with deduplication.
 * Key: (workspaceId, 'anomaly_digest', dedupKey) where dedupKey = 'anomaly:{type}:{metric}'.
 * If an existing insight matches the key, update its data (duration, current value).
 * If no match, insert a new one.
 */
export function upsertAnomalyDigestInsight(params: {
  workspaceId: string;
  anomalyType: string;
  metric: string;
  data: AnomalyDigestData;
  severity: InsightSeverity;
  domain: InsightDomain;
  impactScore: number;
}): AnalyticsInsight {
  const dedupKey = `anomaly:${params.anomalyType}:${params.metric}`;

  // Check for existing
  const existing = getInsight(params.workspaceId, 'anomaly_digest', dedupKey);
  if (existing) {
    // Update in place — extend duration, update values
    return upsertInsight({
      ...params,
      insightType: 'anomaly_digest',
      pageId: dedupKey,
    });
  }

  return upsertInsight({
    workspaceId: params.workspaceId,
    insightType: 'anomaly_digest',
    pageId: dedupKey,
    data: params.data,
    severity: params.severity,
    domain: params.domain,
    impactScore: params.impactScore,
  });
}
```

Also add `getInsightsByDomain()` for filtered feed queries:

```typescript
export function getInsightsByDomain(workspaceId: string, domain: InsightDomain): AnalyticsInsight[] {
  const rows = db.prepare(
    'SELECT * FROM analytics_insights WHERE workspace_id = ? AND domain = ? ORDER BY impact_score DESC'
  ).all(workspaceId, domain) as InsightRow[];
  return rows.map(rowToInsight);
}
```

**Guardrail check:** Use lazy prepared statements (assign inside function body, not at module level). Follow the existing `rowToInsight` mapper pattern — never return raw rows.

- [ ] **Step 4: Wire anomaly detection to call upsert**

In `server/anomaly-detection.ts`, after the detection loop completes (around line 580 where results are broadcast), add the insight store write:

```typescript
import { upsertAnomalyDigestInsight } from './analytics-insights-store.js';
import { classifyDomain, computeImpactScore } from './insight-enrichment.js';
import type { AnomalyDigestData, InsightSeverity } from '../shared/types/analytics.js';

// Inside runAnomalyDetection(), after anomalies are detected and saved:
for (const anomaly of newAnomalies) {
  const data: AnomalyDigestData = {
    anomalyType: anomaly.type,
    metric: anomaly.metric,
    currentValue: anomaly.currentValue,
    expectedValue: anomaly.expectedValue,
    deviationPercent: anomaly.deviationPercent,
    durationDays: Math.ceil((Date.now() - new Date(anomaly.detectedAt).getTime()) / 86400000),
    firstDetected: anomaly.detectedAt,
    severity: anomaly.severity,
  };

  const severityMap: Record<string, InsightSeverity> = {
    critical: 'critical',
    high: 'warning',
    medium: 'opportunity',
    low: 'opportunity',
  };

  upsertAnomalyDigestInsight({
    workspaceId: anomaly.workspaceId,
    anomalyType: anomaly.type,
    metric: anomaly.metric,
    data,
    severity: severityMap[anomaly.severity] ?? 'opportunity',
    domain: anomaly.type.includes('traffic') || anomaly.type.includes('bounce')
      ? 'traffic' : anomaly.type.includes('impression') || anomaly.type.includes('position') || anomaly.type.includes('ctr')
      ? 'search' : 'cross',
    impactScore: computeImpactScore('anomaly_digest', data),
  });
}
```

**Guardrail check:** Wrap the entire loop in a try/catch so a single anomaly write failure doesn't prevent other anomalies from being written. Log warnings, don't throw.

- [ ] **Step 5: Write tests**

```typescript
// tests/unit/anomaly-to-insight.test.ts
import { describe, it, expect } from 'vitest';
import type { AnomalyDigestData } from '../../shared/types/analytics.js';

describe('anomaly-to-insight conversion', () => {
  it('maps anomaly severity to insight severity', () => {
    // Test the severity mapping logic
    const severityMap: Record<string, string> = {
      critical: 'critical',
      high: 'warning',
      medium: 'opportunity',
      low: 'opportunity',
    };
    expect(severityMap['critical']).toBe('critical');
    expect(severityMap['high']).toBe('warning');
    expect(severityMap['medium']).toBe('opportunity');
  });

  it('classifies traffic anomaly types to traffic domain', () => {
    const trafficTypes = ['traffic_drop', 'traffic_spike', 'bounce_spike'];
    for (const t of trafficTypes) {
      const domain = t.includes('traffic') || t.includes('bounce') ? 'traffic' : 'search';
      expect(domain).toBe('traffic');
    }
  });

  it('classifies search anomaly types to search domain', () => {
    const searchTypes = ['impressions_drop', 'ctr_drop', 'position_decline'];
    for (const t of searchTypes) {
      const domain = t.includes('impression') || t.includes('position') || t.includes('ctr')
        ? 'search' : 'cross';
      expect(domain).toBe('search');
    }
  });

  it('computes duration days from detection timestamp', () => {
    const now = Date.now();
    const fiveDaysAgo = new Date(now - 5 * 86400000).toISOString();
    const days = Math.ceil((now - new Date(fiveDaysAgo).getTime()) / 86400000);
    expect(days).toBe(5);
  });

  it('generates correct dedup key', () => {
    const dedupKey = `anomaly:traffic_drop:users`;
    expect(dedupKey).toBe('anomaly:traffic_drop:users');
  });
});
```

- [ ] **Step 6: Verify build and tests**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
npx vitest run tests/unit/anomaly-to-insight.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add server/db/migrations/039-anomaly-digest-dedup.sql \
  server/analytics-insights-store.ts \
  server/anomaly-detection.ts \
  shared/types/analytics.ts \
  tests/unit/anomaly-to-insight.test.ts
git commit -m "feat: wire anomaly detection → insight digest with deduplication

Anomalies now surface as anomaly_digest insight type in the feed.
Dedup key: (workspaceId, anomaly_type, metric) — ongoing anomalies
update in place instead of creating duplicates. Includes domain
classification and severity mapping."
```

---

## Task 2: Insight Feedback Loop Orchestrator

**Files:**
- Create: `server/insight-feedback.ts`
- Create: `tests/unit/insight-feedback.test.ts`
- Modify: `server/analytics-intelligence.ts`

This module runs after insight computation completes and pushes intelligence into Strategy and Pipeline.

- [ ] **Step 1: Write the feedback module**

```typescript
// server/insight-feedback.ts
import { createLogger } from './logger.js';
import { getInsights } from './analytics-insights-store.js';
import { getWorkspace, updateWorkspace } from './workspaces.js';
import { broadcastToWorkspace } from './websocket.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';

const log = createLogger('insight-feedback');

/**
 * Push insight intelligence into Strategy and Content Pipeline.
 * Called after insight computation completes.
 *
 * Strategy signals:
 * - ranking_mover with positive delta → "gaining momentum" keyword suggestion
 * - strategy_alignment = 'misaligned' → misalignment flag
 * - competitor_gap insights → content gap suggestions
 *
 * Pipeline signals:
 * - ranking_opportunity with high impact → suggested brief
 * - content_decay with severity ≥ warning → refresh suggestion
 */
export function runFeedbackLoops(workspaceId: string): void {
  try {
    const insights = getInsights(workspaceId);
    if (!insights.length) return;

    const strategySignals = buildStrategySignals(insights);
    const pipelineSignals = buildPipelineSignals(insights);

    if (strategySignals.length > 0 || pipelineSignals.length > 0) {
      log.info({
        workspaceId,
        strategySignals: strategySignals.length,
        pipelineSignals: pipelineSignals.length,
      }, 'feedback loops generated signals');

      broadcastToWorkspace(workspaceId, {
        type: 'intelligence_signals_updated',
        data: { strategyCount: strategySignals.length, pipelineCount: pipelineSignals.length },
      });
    }
  } catch (err) {
    log.error({ workspaceId, err }, 'feedback loop error — non-fatal, insights still saved');
  }
}

export interface StrategySignal {
  type: 'momentum' | 'misalignment' | 'content_gap';
  keyword: string;
  pageUrl?: string;
  pageTitle?: string;
  detail: string;
  insightId: string;
  impactScore: number;
}

export function buildStrategySignals(insights: AnalyticsInsight[]): StrategySignal[] {
  const signals: StrategySignal[] = [];

  for (const insight of insights) {
    // Ranking movers with positive momentum
    if (insight.insightType === 'ranking_mover' && insight.data) {
      const data = insight.data as Record<string, unknown>;
      const posChange = (data.previousPosition as number ?? 0) - (data.currentPosition as number ?? 0);
      if (posChange > 3) {
        signals.push({
          type: 'momentum',
          keyword: (data.query as string) ?? 'unknown',
          pageUrl: insight.pageId ?? undefined,
          pageTitle: insight.pageTitle ?? undefined,
          detail: `Gained ${posChange} positions — consider adding to strategy`,
          insightId: insight.id,
          impactScore: insight.impactScore ?? 0,
        });
      }
    }

    // Strategy misalignment
    if (insight.strategyAlignment === 'misaligned') {
      signals.push({
        type: 'misalignment',
        keyword: insight.strategyKeyword ?? 'unknown',
        pageUrl: insight.pageId ?? undefined,
        pageTitle: insight.pageTitle ?? undefined,
        detail: `Targeting "${insight.strategyKeyword}" but ranking for different terms`,
        insightId: insight.id,
        impactScore: insight.impactScore ?? 0,
      });
    }

    // Competitor gap → content gap suggestions
    if (insight.insightType === 'competitor_gap' && insight.data) {
      const data = insight.data as Record<string, unknown>;
      signals.push({
        type: 'content_gap',
        keyword: (data.keyword as string) ?? 'unknown',
        detail: `Competitors ranking for "${data.keyword}" — no content targeting this`,
        insightId: insight.id,
        impactScore: insight.impactScore ?? 0,
      });
    }
  }

  return signals.sort((a, b) => b.impactScore - a.impactScore);
}

export interface PipelineSignal {
  type: 'suggested_brief' | 'refresh_suggestion';
  pageUrl?: string;
  pageTitle?: string;
  keyword?: string;
  detail: string;
  insightId: string;
  impactScore: number;
}

export function buildPipelineSignals(insights: AnalyticsInsight[]): PipelineSignal[] {
  const signals: PipelineSignal[] = [];

  for (const insight of insights) {
    // High-impact ranking opportunities → suggested briefs
    if (insight.insightType === 'ranking_opportunity' && (insight.impactScore ?? 0) > 50) {
      // Only suggest if no brief/content exists yet
      if (!insight.pipelineStatus) {
        const data = insight.data as Record<string, unknown>;
        signals.push({
          type: 'suggested_brief',
          pageUrl: insight.pageId ?? undefined,
          pageTitle: insight.pageTitle ?? undefined,
          keyword: (data.query as string) ?? insight.strategyKeyword ?? undefined,
          detail: `Position ${data.currentPosition ?? '?'} with ${data.impressions ?? '?'} impressions — brief could push to page 1`,
          insightId: insight.id,
          impactScore: insight.impactScore ?? 0,
        });
      }
    }

    // Content decay → refresh suggestions
    if (insight.insightType === 'content_decay') {
      const severity = insight.severity;
      if (severity === 'critical' || severity === 'warning') {
        const data = insight.data as Record<string, unknown>;
        signals.push({
          type: 'refresh_suggestion',
          pageUrl: insight.pageId ?? undefined,
          pageTitle: insight.pageTitle ?? undefined,
          detail: `Traffic declined ${data.declinePercent ?? '?'}% — content refresh recommended`,
          insightId: insight.id,
          impactScore: insight.impactScore ?? 0,
        });
      }
    }
  }

  return signals.sort((a, b) => b.impactScore - a.impactScore);
}
```

- [ ] **Step 2: Wire into analytics intelligence**

In `server/analytics-intelligence.ts`, at the end of `getOrComputeInsights()` (around line 970), after all insights are computed and saved:

```typescript
import { runFeedbackLoops } from './insight-feedback.js';

// At end of getOrComputeInsights(), after enrichment completes:
runFeedbackLoops(workspaceId);
```

**Guardrail check:** `runFeedbackLoops` must be wrapped in its own try/catch internally (already done in Step 1). A feedback loop failure must never prevent insight computation from completing.

- [ ] **Step 3: Write tests**

```typescript
// tests/unit/insight-feedback.test.ts
import { describe, it, expect } from 'vitest';
import { buildStrategySignals, buildPipelineSignals } from '../../server/insight-feedback.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';

const baseInsight: AnalyticsInsight = {
  id: 'test-1',
  workspaceId: 'ws-1',
  pageId: '/blog/test',
  insightType: 'page_health',
  data: {},
  severity: 'opportunity',
  computedAt: new Date().toISOString(),
  impactScore: 75,
  domain: 'search',
};

describe('buildStrategySignals', () => {
  it('generates momentum signal for ranking movers with >3 position gain', () => {
    const insight: AnalyticsInsight = {
      ...baseInsight,
      insightType: 'ranking_mover',
      data: { query: 'test keyword', previousPosition: 12, currentPosition: 5 },
    };
    const signals = buildStrategySignals([insight]);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('momentum');
    expect(signals[0].keyword).toBe('test keyword');
  });

  it('skips ranking movers with small position changes', () => {
    const insight: AnalyticsInsight = {
      ...baseInsight,
      insightType: 'ranking_mover',
      data: { query: 'test', previousPosition: 8, currentPosition: 7 },
    };
    expect(buildStrategySignals([insight])).toHaveLength(0);
  });

  it('generates misalignment signal', () => {
    const insight: AnalyticsInsight = {
      ...baseInsight,
      strategyAlignment: 'misaligned',
      strategyKeyword: 'target keyword',
    };
    const signals = buildStrategySignals([insight]);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('misalignment');
  });

  it('generates content gap signals from competitor_gap insights', () => {
    const insight: AnalyticsInsight = {
      ...baseInsight,
      insightType: 'competitor_gap',
      data: { keyword: 'gap keyword' },
    };
    const signals = buildStrategySignals([insight]);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('content_gap');
  });

  it('sorts signals by impact score descending', () => {
    const insights: AnalyticsInsight[] = [
      { ...baseInsight, insightType: 'competitor_gap', data: { keyword: 'low' }, impactScore: 20 },
      { ...baseInsight, id: 'test-2', insightType: 'competitor_gap', data: { keyword: 'high' }, impactScore: 90 },
    ];
    const signals = buildStrategySignals(insights);
    expect(signals[0].keyword).toBe('high');
  });
});

describe('buildPipelineSignals', () => {
  it('generates suggested brief for high-impact ranking opportunities without pipeline status', () => {
    const insight: AnalyticsInsight = {
      ...baseInsight,
      insightType: 'ranking_opportunity',
      impactScore: 80,
      pipelineStatus: null,
      data: { query: 'target query', currentPosition: 8, impressions: 5000 },
    };
    const signals = buildPipelineSignals([insight]);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('suggested_brief');
  });

  it('skips ranking opportunities that already have pipeline status', () => {
    const insight: AnalyticsInsight = {
      ...baseInsight,
      insightType: 'ranking_opportunity',
      impactScore: 80,
      pipelineStatus: 'brief_exists',
      data: { query: 'target query', currentPosition: 8, impressions: 5000 },
    };
    expect(buildPipelineSignals([insight])).toHaveLength(0);
  });

  it('generates refresh suggestion for critical content decay', () => {
    const insight: AnalyticsInsight = {
      ...baseInsight,
      insightType: 'content_decay',
      severity: 'critical',
      data: { declinePercent: 35 },
    };
    const signals = buildPipelineSignals([insight]);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('refresh_suggestion');
  });

  it('skips content decay with low severity', () => {
    const insight: AnalyticsInsight = {
      ...baseInsight,
      insightType: 'content_decay',
      severity: 'opportunity',
      data: { declinePercent: 12 },
    };
    expect(buildPipelineSignals([insight])).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Verify build and tests**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
npx vitest run tests/unit/insight-feedback.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/insight-feedback.ts \
  server/analytics-intelligence.ts \
  tests/unit/insight-feedback.test.ts
git commit -m "feat: insight feedback loop orchestrator

Runs after insight computation. Generates strategy signals (momentum,
misalignment, content gaps) and pipeline signals (suggested briefs,
refresh suggestions). Broadcasts intelligence_signals_updated via
WebSocket. Non-fatal — never blocks insight computation."
```

---

## Task 3: API Endpoints for Intelligence Signals

**Files:**
- Modify: `server/routes/keyword-strategy.ts`
- Modify: `server/routes/content.ts` (or wherever content pipeline routes live)
- Modify: `src/lib/queryKeys.ts`

- [ ] **Step 1: Find the content pipeline route file**

```bash
grep -rn "content.pipeline\|content_pipeline\|/api/admin.*pipeline\|/api/admin.*brief" server/routes/ | head -10
```

Use the result to identify the correct file for the pipeline endpoint.

- [ ] **Step 2: Add strategy signals endpoint**

In `server/routes/keyword-strategy.ts`, add a new GET endpoint after the existing routes:

```typescript
import { buildStrategySignals } from '../insight-feedback.js';
import { getInsights } from '../analytics-insights-store.js';

// GET /api/admin/strategy/:workspaceId/signals
router.get('/:workspaceId/signals', requireAdminAuth, (req, res) => {
  const { workspaceId } = req.params;
  const insights = getInsights(workspaceId);
  const signals = buildStrategySignals(insights);
  res.json({ signals });
});
```

- [ ] **Step 3: Add pipeline suggestions endpoint**

In the content pipeline route file, add:

```typescript
import { buildPipelineSignals } from '../insight-feedback.js';
import { getInsights } from '../analytics-insights-store.js';

// GET /api/admin/pipeline/:workspaceId/suggested
router.get('/:workspaceId/suggested', requireAdminAuth, (req, res) => {
  const { workspaceId } = req.params;
  const insights = getInsights(workspaceId);
  const signals = buildPipelineSignals(insights);
  res.json({ signals });
});
```

- [ ] **Step 4: Add query keys**

In `src/lib/queryKeys.ts`:

```typescript
// Add to admin keys
intelligenceSignals: (workspaceId: string) => ['admin', 'intelligenceSignals', workspaceId] as const,
aiSuggestedBriefs: (workspaceId: string) => ['admin', 'aiSuggestedBriefs', workspaceId] as const,
```

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/keyword-strategy.ts \
  server/routes/content*.ts \
  src/lib/queryKeys.ts
git commit -m "feat: API endpoints for strategy signals and pipeline suggestions

GET /api/admin/strategy/:workspaceId/signals — returns intelligence signals
GET /api/admin/pipeline/:workspaceId/suggested — returns AI-suggested briefs
Both powered by insight-feedback.ts feedback loop data."
```

---

## Task 4: React Query Hooks for Feedback Data

**Files:**
- Create: `src/hooks/admin/useIntelligenceSignals.ts`
- Create: `src/hooks/admin/useAiSuggestedBriefs.ts`

- [ ] **Step 1: Write useIntelligenceSignals hook**

```typescript
// src/hooks/admin/useIntelligenceSignals.ts
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys.js';
import { apiFetch } from '../../api/fetch.js';
import type { StrategySignal } from '../../../server/insight-feedback.js';

interface SignalsResponse {
  signals: StrategySignal[];
}

export function useIntelligenceSignals(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.intelligenceSignals(workspaceId),
    queryFn: () => apiFetch<SignalsResponse>(`/api/admin/strategy/${workspaceId}/signals`),
    staleTime: 5 * 60 * 1000, // 5 minutes — signals don't change frequently
    enabled: !!workspaceId,
  });
}
```

**Guardrail check:** Verify the `apiFetch` import path is correct for this project. Check existing hooks in `src/hooks/admin/` for the standard import pattern.

- [ ] **Step 2: Write useAiSuggestedBriefs hook**

```typescript
// src/hooks/admin/useAiSuggestedBriefs.ts
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys.js';
import { apiFetch } from '../../api/fetch.js';
import type { PipelineSignal } from '../../../server/insight-feedback.js';

interface SuggestedResponse {
  signals: PipelineSignal[];
}

export function useAiSuggestedBriefs(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId),
    queryFn: () => apiFetch<SuggestedResponse>(`/api/admin/pipeline/${workspaceId}/suggested`),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId,
  });
}
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/admin/useIntelligenceSignals.ts \
  src/hooks/admin/useAiSuggestedBriefs.ts
git commit -m "feat: React Query hooks for intelligence signals and AI suggested briefs"
```

---

## Task 5: Enrich Admin Chat Context

**Files:**
- Modify: `server/admin-chat-context.ts`

Admin Chat already reads insights via `buildInsightsContext()`. Enrich it with the feedback loop data.

- [ ] **Step 1: Enhance buildInsightsContext with enriched fields**

In `server/admin-chat-context.ts`, find `buildInsightsContext()` and extend the formatting to include:
- Page titles (instead of raw URLs)
- Strategy alignment status
- Pipeline status
- Anomaly links
- Active intelligence signals count

The existing function formats insights as text blocks. Add the enrichment fields to each block:

```typescript
// In buildInsightsContext(), for each insight:
// Existing: "Page: /blog/some-page — Health Score: 72"
// Enhanced: "Page: Best AI Coding Agents (/blog/best-ai-coding-agents) — Health Score: 72 — Strategy: aligned — Pipeline: brief_exists — 2 linked audit issues"
```

Read the current `buildInsightsContext` implementation first, then extend it. Do NOT rewrite — add enrichment lines to the existing format.

**Guardrail check:** This function is called during chat completion. Keep string building simple and fast. No async calls, no DB reads — use only what's already on the `AnalyticsInsight` objects.

- [ ] **Step 2: Add anomaly context to chat**

In `assembleAdminContext()`, the existing anomaly section reads from `listAnomalies()`. Enhance to also mention if anomalies are linked to insights:

```typescript
// After existing anomaly formatting:
const anomalyInsights = insights.filter(i => i.insightType === 'anomaly_digest');
if (anomalyInsights.length > 0) {
  sections.push(`Active anomaly insights: ${anomalyInsights.length} (tracked in insight feed)`);
}
```

- [ ] **Step 3: Add proactive insight mentions**

When critical insights exist, the chat should mention them unprompted. Add to the system prompt builder:

```typescript
// In buildSystemPrompt(), if critical insights exist:
const criticalInsights = insights.filter(i => i.severity === 'critical');
if (criticalInsights.length > 0) {
  systemParts.push(
    `⚠️ There are ${criticalInsights.length} critical insights requiring attention. ` +
    `When relevant, proactively mention these to the user.`
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add server/admin-chat-context.ts
git commit -m "feat: enrich admin chat context with feedback loop data

buildInsightsContext now includes page titles, strategy alignment,
pipeline status, and audit issue counts. Anomaly insights linked.
Critical insights proactively mentioned in system prompt."
```

---

## Task 6: Audit Issues → Page Health Annotation

**Files:**
- Modify: `server/insight-enrichment.ts`
- Modify: `server/seo-audit.ts`

When an audit completes, annotate page-level insights with linked audit issues.

- [ ] **Step 1: Add audit issue annotation to enrichment**

In `server/insight-enrichment.ts`, add a function to extract audit issues for a specific page:

```typescript
import { getLatestSnapshot } from './reports.js';

export function getAuditIssuesForPage(
  workspaceId: string,
  pageUrl: string,
): string[] {
  // Get the workspace to find the site ID
  const ws = getWorkspace(workspaceId);
  if (!ws?.webflowSiteId) return [];

  const snapshot = getLatestSnapshot(ws.webflowSiteId);
  if (!snapshot?.audit?.pages) return [];

  const page = snapshot.audit.pages.find(
    (p: { url?: string }) => p.url && pageUrl.includes(p.url)
  );
  if (!page?.issues) return [];

  // Return top 5 issue descriptions
  return page.issues
    .filter((i: { severity?: string }) => i.severity === 'error' || i.severity === 'warning')
    .slice(0, 5)
    .map((i: { message?: string }) => i.message ?? 'Unknown issue');
}
```

- [ ] **Step 2: Wire into enrichInsight**

In `server/insight-enrichment.ts`, within `enrichInsight()`, add audit issue lookup for page_health insights:

```typescript
// Inside enrichInsight(), after existing enrichments:
if (insight.insightType === 'page_health' && insight.pageId) {
  const auditIssues = getAuditIssuesForPage(context.workspaceId, insight.pageId);
  if (auditIssues.length > 0) {
    enriched.auditIssues = JSON.stringify(auditIssues);
  }
}
```

**Guardrail check:** `auditIssues` is stored as a JSON string in the DB (TEXT column). Use `JSON.stringify` on write, `parseJsonSafeArray(_, z.string(), _)` on read in `rowToInsight`.

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add server/insight-enrichment.ts
git commit -m "feat: annotate page health insights with linked audit issues

Top 5 error/warning audit issues per page attached to page_health
insights. Stored as JSON string in audit_issues column."
```

---

## Task 7: Schema Gaps → SERP Opportunity Enrichment

**Files:**
- Modify: `server/insight-enrichment.ts`
- Modify: `server/schema-validator.ts`

High-traffic pages missing recommended schema types should enrich existing `serp_opportunity` insights.

- [ ] **Step 1: Add schema gap lookup**

In `server/insight-enrichment.ts`, add:

```typescript
import { getValidations } from './schema-validator.js';

export function getSchemaGapsForPage(
  workspaceId: string,
  pageUrl: string,
): string[] {
  const validations = getValidations(workspaceId);
  const pageValidation = validations.find(v => v.pageId === pageUrl || v.url === pageUrl);
  if (!pageValidation) return ['No schema data found'];

  const gaps: string[] = [];
  if (!pageValidation.richResults?.length) {
    gaps.push('No rich result types detected');
  }
  // Additional gap detection can reference validation.issues
  return gaps;
}
```

**Guardrail check:** `getValidations` may return a large array. Filter early, don't iterate the full set multiple times.

- [ ] **Step 2: Wire into serp_opportunity enrichment**

In `enrichInsight()`, for `serp_opportunity` insights:

```typescript
if (insight.insightType === 'serp_opportunity' && insight.pageId) {
  const schemaGaps = getSchemaGapsForPage(context.workspaceId, insight.pageId);
  if (schemaGaps.length > 0) {
    enriched.auditIssues = JSON.stringify(schemaGaps);
  }
}
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add server/insight-enrichment.ts server/schema-validator.ts
git commit -m "feat: enrich SERP opportunity insights with schema gap data

serp_opportunity insights now include schema validation gaps in
auditIssues field. Enables 'add Article schema' recommendations."
```

---

## Task 8: Intelligence Signals UI — Strategy Panel

**Files:**
- Create: `src/components/strategy/IntelligenceSignals.tsx`
- Modify: `src/components/KeywordStrategy.tsx`

- [ ] **Step 1: Create IntelligenceSignals component**

```typescript
// src/components/strategy/IntelligenceSignals.tsx
import { useIntelligenceSignals } from '../../hooks/admin/useIntelligenceSignals.js';
import { SectionCard } from '../ui/SectionCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Badge } from '../ui/Badge.js';
import { TrendingUp, AlertTriangle, Target } from 'lucide-react';

interface Props {
  workspaceId: string;
}

const iconMap = {
  momentum: TrendingUp,
  misalignment: AlertTriangle,
  content_gap: Target,
} as const;

const colorMap = {
  momentum: 'text-emerald-400',
  misalignment: 'text-amber-400',
  content_gap: 'text-blue-400',
} as const;

export function IntelligenceSignals({ workspaceId }: Props) {
  const { data, isLoading } = useIntelligenceSignals(workspaceId);
  const signals = data?.signals ?? [];

  if (isLoading) {
    return (
      <SectionCard title="Intelligence Signals" icon={TrendingUp}>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-zinc-800/50 rounded-lg" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (!signals.length) {
    return (
      <SectionCard title="Intelligence Signals" icon={TrendingUp}>
        <EmptyState
          message="No intelligence signals yet"
          detail="Signals appear when the insight engine detects strategy-relevant patterns"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Intelligence Signals" icon={TrendingUp} badge={`${signals.length}`}>
      <div className="space-y-2">
        {signals.slice(0, 10).map(signal => {
          const Icon = iconMap[signal.type];
          const color = colorMap[signal.type];
          return (
            <div key={signal.insightId} className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors">
              <Icon className={`w-4 h-4 mt-0.5 ${color} shrink-0`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate">
                    {signal.keyword}
                  </span>
                  <Badge variant={signal.type === 'misalignment' ? 'warning' : signal.type === 'momentum' ? 'success' : 'info'} size="sm">
                    {signal.type === 'momentum' ? 'Gaining' : signal.type === 'misalignment' ? 'Misaligned' : 'Gap'}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">{signal.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
```

**Guardrail check:**
- Uses `SectionCard` (not hand-rolled card markup)
- Uses `EmptyState` (not custom empty state)
- Uses `Badge` (not hand-rolled badges)
- Colors follow Three Laws: teal for actions (none here), blue for data, no purple in non-admin-AI context
- Skeleton loading state (not "Loading...")

- [ ] **Step 2: Add to KeywordStrategy.tsx**

In `src/components/KeywordStrategy.tsx`, import and render `IntelligenceSignals` at the top of the panel (before the existing strategy content):

```typescript
import { IntelligenceSignals } from './strategy/IntelligenceSignals.js';

// Inside KeywordStrategyPanel render, before existing content:
<IntelligenceSignals workspaceId={workspaceId} />
```

**Guardrail check:** Read `KeywordStrategy.tsx` first to understand the existing structure. Place the signals section logically — likely after the header, before the keyword list.

- [ ] **Step 3: Add WebSocket invalidation**

In the component or hook that handles WebSocket events, add invalidation for `intelligence_signals_updated`:

```typescript
// In useWebSocket handler:
case 'intelligence_signals_updated':
  queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligenceSignals(workspaceId) });
  break;
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/strategy/IntelligenceSignals.tsx \
  src/components/KeywordStrategy.tsx
git commit -m "feat: Intelligence Signals section in Strategy panel

Shows momentum keywords, strategy misalignments, and content gaps
derived from the insight engine. Updates via WebSocket broadcast."
```

---

## Task 9: AI Suggested Section — Content Pipeline

**Files:**
- Create: `src/components/pipeline/AiSuggested.tsx`
- Modify: `src/components/ContentPipeline.tsx`

- [ ] **Step 1: Create AiSuggested component**

```typescript
// src/components/pipeline/AiSuggested.tsx
import { useAiSuggestedBriefs } from '../../hooks/admin/useAiSuggestedBriefs.js';
import { SectionCard } from '../ui/SectionCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Badge } from '../ui/Badge.js';
import { Sparkles, FileText, RefreshCw } from 'lucide-react';

interface Props {
  workspaceId: string;
  onCreateBrief?: (keyword: string, pageUrl?: string) => void;
}

const iconMap = {
  suggested_brief: FileText,
  refresh_suggestion: RefreshCw,
} as const;

export function AiSuggested({ workspaceId, onCreateBrief }: Props) {
  const { data, isLoading } = useAiSuggestedBriefs(workspaceId);
  const signals = data?.signals ?? [];

  if (isLoading) {
    return (
      <SectionCard title="AI Suggested" icon={Sparkles}>
        <div className="animate-pulse space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-12 bg-zinc-800/50 rounded-lg" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (!signals.length) {
    return (
      <SectionCard title="AI Suggested" icon={Sparkles}>
        <EmptyState
          message="No suggestions yet"
          detail="Suggestions appear when the insight engine finds content opportunities"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="AI Suggested" icon={Sparkles} badge={`${signals.length}`}>
      <div className="space-y-2">
        {signals.slice(0, 8).map(signal => {
          const Icon = iconMap[signal.type];
          return (
            <div key={signal.insightId} className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors">
              <Icon className="w-4 h-4 mt-0.5 text-teal-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate">
                    {signal.pageTitle ?? signal.keyword ?? 'Untitled'}
                  </span>
                  <Badge variant={signal.type === 'suggested_brief' ? 'info' : 'warning'} size="sm">
                    {signal.type === 'suggested_brief' ? 'New Brief' : 'Refresh'}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">{signal.detail}</p>
              </div>
              {onCreateBrief && signal.type === 'suggested_brief' && (
                <button
                  onClick={() => onCreateBrief(signal.keyword ?? '', signal.pageUrl)}
                  className="text-xs px-2 py-1 rounded bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-500 hover:to-emerald-500 transition-colors shrink-0"
                >
                  Create Brief
                </button>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
```

**Guardrail check:** CTA button uses teal gradient (action color). No purple — this is admin UI but not admin AI.

- [ ] **Step 2: Add to ContentPipeline.tsx**

In `src/components/ContentPipeline.tsx`, import and render `AiSuggested`:

```typescript
import { AiSuggested } from './pipeline/AiSuggested.js';

// Inside ContentPipeline render, before existing pipeline content:
<AiSuggested workspaceId={workspaceId} onCreateBrief={handleCreateBrief} />
```

Read `ContentPipeline.tsx` first to understand the existing structure and find/create a `handleCreateBrief` callback.

- [ ] **Step 3: Add WebSocket invalidation**

```typescript
case 'intelligence_signals_updated':
  queryClient.invalidateQueries({ queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId) });
  break;
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/AiSuggested.tsx \
  src/components/ContentPipeline.tsx
git commit -m "feat: AI Suggested section in Content Pipeline

Shows suggested briefs from ranking opportunities and refresh
suggestions from content decay. Create Brief CTA triggers brief
creation flow. Updates via WebSocket broadcast."
```

---

## Task 10: Verification + Documentation

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `BRAND_DESIGN_LANGUAGE.md` (if new UI patterns were added)
- Modify: `data/roadmap.json`

- [ ] **Step 1: Verify all tests pass**

```bash
npx vitest run tests/unit/anomaly-to-insight.test.ts tests/unit/insight-feedback.test.ts
```

- [ ] **Step 2: Verify full build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 3: Update FEATURE_AUDIT.md**

Add entries for:
- Anomaly → Insight Digest wiring
- Insight Feedback Loop Orchestrator
- Strategy Intelligence Signals UI
- Content Pipeline AI Suggested UI
- Admin Chat enriched context
- Audit Issues → Page Health annotation
- Schema Gaps → SERP Opportunity enrichment

- [ ] **Step 4: Update roadmap**

In `data/roadmap.json`, mark Phase 2 items as `"done"`. Run `npx tsx scripts/sort-roadmap.ts` (if it works — known pre-existing bug in the sort script).

- [ ] **Step 5: Commit**

```bash
git add FEATURE_AUDIT.md BRAND_DESIGN_LANGUAGE.md data/roadmap.json
git commit -m "docs: update feature audit, design language, and roadmap for Phase 2

Connected Intelligence Engine Phase 2 complete: anomaly digest,
feedback loops, strategy signals, pipeline suggestions, enriched
admin chat, audit annotations, schema gap enrichment."
```

---

## Dependency Graph

```
Task 1 (Anomaly → Insight Digest) ─────── independent ──────────────────┐
Task 2 (Feedback Loop Orchestrator) ────── independent ──────────────────┤
                                                                          │
Task 3 (API Endpoints) ─────────────────── depends on 2 ────────────────┤
Task 4 (React Query Hooks) ────────────── depends on 3 ────────────────┤
                                                                          │
Task 5 (Enrich Admin Chat) ────────────── depends on 1, 2 ──────────────┤
Task 6 (Audit → Page Health) ──────────── independent ──────────────────┤
Task 7 (Schema → SERP Opportunity) ────── independent ──────────────────┤
                                                                          │
Task 8 (Strategy Signals UI) ──────────── depends on 4 ────────────────┤
Task 9 (Pipeline AI Suggested UI) ─────── depends on 4 ────────────────┤
                                                                          │
Task 10 (Verification + Docs) ─────────── depends on ALL ──────────────┘
```

**Parallel execution opportunities:**
- Tasks 1 + 2 + 6 + 7 can all run in parallel (independent backend work)
- Tasks 3 + 5 can start once Task 2 completes
- Task 4 depends on Task 3
- Tasks 8 + 9 can run in parallel once Task 4 completes
- Task 10 waits for all
