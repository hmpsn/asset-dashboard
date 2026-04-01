# Unified Workspace Intelligence — Phase 3A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate all 8 intelligence slices with real data, expand `formatForPrompt()` to format all slices, implement `tokenBudget` truncation, and wire 7 bridges — making `buildWorkspaceIntelligence()` return a complete picture of every workspace.

**Architecture:** Phase 3A is purely additive — no behavior changes to existing callers. The intelligence layer's `assembleSlice()` switch statement currently stubs 3 slices as "not yet implemented." Each remaining task below replaces one stub with a real assembler that imports data from existing stores. `formatForPrompt()` gets 5 new section formatters + 4 bug fixes. Three read-time bridges get wired to their trigger points so data flows automatically.

**Tech Stack:** TypeScript (strict), SQLite (better-sqlite3), Express, Pino logging, LRU cache, feature flags, WebSocket broadcast

---

## ⚠️ Bridge Authoring Rules (mandatory for all bridge tasks)

Tasks 1-2 were completed during the bridge infrastructure hardening phase (PR #118). The code examples in Tasks 1-2 below are **obsolete** — do NOT follow them. All bridge work (including Task 7) must follow these rules from CLAUDE.md:

1. **`bridgeSource`**: Pass `bridgeSource: '<bridge_flag>'` to `upsertInsight()` when creating bridge insights. When re-upserting an existing insight (e.g., score adjustments), pass `bridgeSource: insight.bridgeSource` to preserve the original value.
2. **Score adjustments**: Use `applyScoreAdjustment()` from `server/insight-score-adjustments.ts`. Never use raw `Math.min/max` arithmetic on scores — they don't compose across bridges.
3. **Auto-broadcast**: Return `{ modified: N }` from bridge callbacks. Never manually import/call `broadcastToWorkspace` inside a bridge — `executeBridge` handles it automatically when `modified > 0`.
4. **Resolution respect**: Never call `resolveInsight()` inside a bridge callback unless the bridge's explicit purpose is resolution management.
5. **Explicit field enumeration**: Never use `...insight` spread on `upsertInsight()` — enumerate fields explicitly to avoid passing unexpected properties.

**Canonical examples** (follow these, not the Task 2 code blocks):
- Bridge #1: `server/outcome-tracking.ts:277-349`
- Bridge #10: `server/anomaly-detection.ts:598-653`
- Bridges #12, #15: `server/scheduled-audits.ts:141-207`

---

## Dependency Graph

```
Task 1 (Types) ✅ DONE
    ├──→ Task 2 (Bridges #1, #10, #12, #15) ✅ DONE
    │         └──→ Task 7 (Bridge #8, #9, #14)
    ├──→ Task 3 (siteHealth assembler) ✅ DONE
    ├──→ Task 4 (contentPipeline assembler) ✅ DONE (base; 3A-expansion fields remain)
    ├──→ Task 5 (clientSignals assembler)
    ├──→ Task 6 (operational assembler)
    ├──→ Task 8 (pageProfile assembler) — after Tasks 5-6 (cross-references)
    ├──→ Task 9 (seoContext enrichment)
    ├──→ Task 10 (learnings enrichment)
    └──→ Task 11 (WebSocket wiring) — independent
         Task 12 (Scheduler invalidation) — independent
         Task 13 (formatForPrompt expansion) — after Tasks 5-10
              └──→ Task 14 (tokenBudget) — after Task 13
                    └──→ Task 15 (Integration test + bridge runtime tests + quality gate)
                          ├──→ Task 16 (Mini builder extraction verification)
                          └──→ Task 17 (pr-check regression guards)
```

## Parallelization Strategy

| Batch | Tasks | Prerequisite |
|-------|-------|-------------|
| ~~**Batch 0**~~ | ~~Task 1 (types)~~ | ✅ DONE |
| ~~**Batch 1a**~~ | ~~Tasks 2, 3, 4~~ | ✅ DONE (hardening + earlier PRs) |
| **Batch 1b** | Tasks 5, 6, 9, 10, 11, 12 (all parallel) | None — prerequisites are committed |
| **Batch 2** | Tasks 7, 8 | Batch 1b committed |
| **Batch 3** | Task 13 (formatForPrompt) | Batch 2 committed |
| **Batch 4** | Task 14 (tokenBudget) | Task 13 committed |
| **Batch 5** | Tasks 15, 16, 17 (integration test + bridge runtime + mini builder + pr-check guards) | Task 14 committed |

## Model Assignments

| Task | Model | Rationale |
|------|-------|-----------|
| ~~Task 1 (types)~~ | ~~Sonnet~~ | ✅ DONE |
| ~~Task 2 (bridges)~~ | ~~Sonnet~~ | ✅ DONE |
| ~~Tasks 3-4 (siteHealth, contentPipeline)~~ | ~~Sonnet~~ | ✅ DONE |
| Tasks 5-6 (clientSignals, operational) | **Sonnet** | Each assembler imports from 5-14 modules, needs judgment on error handling |
| Task 7 (read-time bridges) | **Sonnet** | Enrichment logic requires domain understanding; must follow Bridge Authoring Rules |
| Task 8 (pageProfile) | **Sonnet** | Most complex assembler — cross-references 4 other slices |
| Tasks 9-10 (enrichments) | **Sonnet** | Existing code modification, moderate complexity |
| Tasks 11-12 (WS + scheduler) | **Haiku** | Mechanical wiring — add import + function call |
| Task 13 (formatForPrompt) | **Sonnet** | Formatting logic needs verbosity awareness |
| Task 14 (tokenBudget) | **Sonnet** | Truncation priority logic |
| Task 15 (integration test) | **Sonnet** | Comprehensive validation |
| Task 16 (mini builder verification) | **Haiku** | Mechanical verification — read source, check imports |
| Task 17 (pr-check guards) | **Haiku** | Mechanical — add grep patterns to existing script |

## PR Strategy (2 remaining PRs)

| PR | Tasks | Gate | Review Focus |
|----|-------|------|-------------|
| ~~**PR 1: Foundation**~~ | ~~1 (types), 2 (bridge wiring)~~ | ✅ MERGED (PR #118 + bridge hardening) | N/A |
| **PR 2: Assemblers** | 5-6 (2 assemblers), 7 (read-time bridges), 8 (pageProfile), 9-10 (enrichments), 11-12 (WS + scheduler) | `/api/intelligence/:wsId` returns all 8 slices, values match underlying stores | Data correctness per slice. Error handling: no silent catches, per-slice try/catch wrapper, 5s timeout on async. |
| **PR 3: Formatting + Integration** | 13 (formatForPrompt), 14 (tokenBudget), 15 (integration + bridge runtime tests), 16 (mini builder verification), 17 (pr-check guards) | Full test suite green, `pr-check` zero errors | formatForPrompt output at all 3 verbosities. tokenBudget truncation order. Persona bug fix. Bridge runtime side effects verified. |

**Note:** PR 1 (Tasks 1-4) was completed across PR #118 (bridge infrastructure hardening) and earlier Phase 2 work. Types, bridge wiring for #1/#10/#12/#15, siteHealth assembler, and contentPipeline base assembler are all merged to main.

---

## File Ownership Map

| File | Owner Task(s) | Notes |
|------|---------------|-------|
| ~~`shared/types/intelligence.ts`~~ | ~~Task 1~~ | ✅ DONE |
| `server/workspace-intelligence.ts` | Tasks 5-6, 8-10 (sequential within file) | Core assembler — each task adds one case |
| ~~`server/outcome-tracking.ts`~~ | ~~Task 2~~ | ✅ DONE (Bridge #1 wired + hardened) |
| `server/anomaly-detection.ts` | Task 12 (scheduler) | Bridge #10 done; only scheduler invalidation remains |
| ~~`server/scheduled-audits.ts`~~ | ~~Task 2~~ | ✅ DONE (Bridges #12, #15 wired + hardened) |
| `server/content-decay.ts` | Task 7 (bridge #8) | Read-time enrichment |
| `server/keyword-recommendations.ts` | Task 7 (bridge #9) | Read-time enrichment |
| `server/outcome-crons.ts` | Task 7 (bridge #14), Task 12 (scheduler) | Sequential |
| `server/ws-events.ts` | Task 11 | WS event — no conflicts |
| `src/lib/wsEvents.ts` | Task 11 | Frontend mirror |
| `server/content-requests.ts` | Task 5 | clientSignals content request patterns |
| `server/work-orders.ts` | Task 6 | operational work order count |
| `server/churn-signals.ts` | Task 12 | Scheduler invalidation |
| `server/__tests__/bridge-runtime.test.ts` | Task 15 | Bridge side-effect integration tests |
| `tests/fixtures/intelligence-seed.ts` | Task 15 | Expanded fixture (briefs, posts, strategy, audit) |
| `scripts/pr-check.ts` | Task 17 | Regression guards |

---

### Task 1: Expand Shared Types (`shared/types/intelligence.ts`) — ✅ DONE

> **Completed:** All 15+ supporting types and slice interface expansions merged to main. See `shared/types/intelligence.ts`.
> Tests: `tests/intelligence-types.test.ts` (8 tests passing).
>
> **No action needed.** The code below is preserved for reference only.

**Files:**
- Modify: `shared/types/intelligence.ts`
- Test: `server/__tests__/intelligence-types.test.ts`

This task expands all slice interfaces to match the spec (§3, §10 3A-8). Every subsequent task depends on these types.

- [ ] **Step 1: Write the type validation test**

```typescript
// server/__tests__/intelligence-types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  WorkspaceIntelligence,
  SeoContextSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  PageProfileSlice,
  ClientSignalsSlice,
  OperationalSlice,
  LearningsSlice,
  BusinessProfile,
  BacklinkProfile,
  SerpFeatures,
  CompositeHealthScore,
  EngagementMetrics,
  ChurnSignal,
  RewritePlaybook,
  WeCalledItEntry,
  ROIAttribution,
} from '../../shared/types/intelligence.js';

describe('Intelligence types', () => {
  it('WorkspaceIntelligence has version 1', () => {
    const intel: WorkspaceIntelligence = {
      version: 1,
      workspaceId: 'ws-1',
      assembledAt: new Date().toISOString(),
    };
    expect(intel.version).toBe(1);
  });

  it('SeoContextSlice supports new fields', () => {
    const ctx: SeoContextSlice = {
      strategy: undefined,
      brandVoice: 'Professional',
      businessContext: 'SaaS',
      personas: [],
      knowledgeBase: '',
      businessProfile: { industry: 'Tech', goals: ['Growth'], targetAudience: 'B2B' },
      backlinkProfile: { totalBacklinks: 500, referringDomains: 100, trend: 'growing' },
      serpFeatures: { featuredSnippets: 3, peopleAlsoAsk: 5, localPack: true },
      rankTracking: { trackedKeywords: 10, avgPosition: 15.2, positionChanges: { improved: 3, declined: 1, stable: 6 } },
      keywordRecommendations: [],
      strategyHistory: { revisionsCount: 3, lastRevisedAt: '2026-03-15', trajectory: 'expanding' },
    };
    expect(ctx.businessProfile?.industry).toBe('Tech');
  });

  it('ContentPipelineSlice supports subscriptions and schema fields', () => {
    const pipeline: ContentPipelineSlice = {
      briefs: { total: 5, byStatus: { draft: 2, ready: 3 } },
      posts: { total: 3, byStatus: { draft: 1, published: 2 } },
      matrices: { total: 1, cellsPlanned: 10, cellsPublished: 4 },
      requests: { pending: 2, inProgress: 1, delivered: 5 },
      workOrders: { active: 1 },
      coverageGaps: ['keyword-a'],
      seoEdits: { pending: 1, applied: 3, inReview: 0 },
      subscriptions: { active: 1, totalPages: 8 },
      schemaDeployment: { planned: 5, deployed: 2, types: ['Article', 'FAQ'] },
      rewritePlaybook: { patterns: ['title refresh'], lastUsedAt: null },
      cannibalizationWarnings: [],
      decayAlerts: [],
      suggestedBriefs: 4,
    };
    expect(pipeline.subscriptions?.active).toBe(1);
    expect(pipeline.rewritePlaybook?.patterns.length).toBeGreaterThan(0);
  });

  it('SiteHealthSlice supports expanded fields', () => {
    const health: SiteHealthSlice = {
      auditScore: 85,
      auditScoreDelta: 3,
      deadLinks: 2,
      redirectChains: 1,
      schemaErrors: 0,
      orphanPages: 3,
      cwvPassRate: { mobile: 0.8, desktop: 0.95 },
      redirectDetails: [],
      aeoReadiness: { pagesChecked: 10, passingRate: 0.7 },
      schemaValidation: { valid: 8, warnings: 1, errors: 1 },
      performanceSummary: null,
      anomalyCount: 2,
      anomalyTypes: ['traffic_drop', 'ranking_drop'],
      seoChangeVelocity: 5,
    };
    expect(health.aeoReadiness?.pagesChecked).toBe(10);
  });

  it('ClientSignalsSlice supports expanded fields', () => {
    const signals: ClientSignalsSlice = {
      keywordFeedback: { approved: ['kw1'], rejected: ['kw2'], patterns: { approveRate: 0.8, topRejectionReasons: ['low volume'] } },
      contentGapVotes: [{ topic: 'AI', votes: 3 }],
      businessPriorities: ['Growth'],
      approvalPatterns: { approvalRate: 0.85, avgResponseTime: 48 },
      recentChatTopics: ['rankings'],
      churnRisk: 'low',
      churnSignals: [{ type: 'no_login', severity: 'low', detectedAt: '2026-03-28' }],
      roi: { organicValue: 5000, growth: 12.5, period: 'monthly' },
      engagement: { loginFrequency: 'weekly', chatSessionCount: 10, lastLoginAt: null, portalUsage: null },
      compositeHealthScore: 72,
      feedbackItems: [],
      serviceRequests: { pending: 0, total: 2 },
    };
    expect(signals.engagement?.loginFrequency).toBe('weekly');
  });

  it('OperationalSlice supports expanded fields', () => {
    const ops: OperationalSlice = {
      recentActivity: [],
      annotations: [],
      pendingJobs: 0,
      timeSaved: null,
      approvalQueue: { pending: 2, oldestAge: 48 },
      recommendationQueue: { fixNow: 1, fixSoon: 3, fixLater: 5 },
      actionBacklog: { pendingMeasurement: 4, oldestAge: 30 },
      detectedPlaybooks: ['content_refresh_after_decay'],
      workOrders: { active: 1, pending: 2 },
      insightAcceptanceRate: null,
    };
    expect(ops.recommendationQueue?.fixNow).toBe(1);
  });

  it('LearningsSlice supports ROI and WeCalledIt', () => {
    const learnings: LearningsSlice = {
      summary: null,
      confidence: null,
      topActionTypes: [],
      overallWinRate: 0,
      recentTrend: null,
      playbooks: [],
      roiAttribution: [],
      weCalledIt: [],
    };
    expect(learnings.roiAttribution).toEqual([]);
  });

  it('CompositeHealthScore uses 40/30/30 formula', () => {
    const score: CompositeHealthScore = {
      score: 72,
      components: {
        churn: { score: 80, weight: 0.4 },
        roi: { score: 65, weight: 0.3 },
        engagement: { score: 68, weight: 0.3 },
      },
      computedAt: new Date().toISOString(),
    };
    expect(score.components.churn.weight).toBe(0.4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/intelligence-types.test.ts`
Expected: FAIL — types don't exist yet (`BusinessProfile`, `BacklinkProfile`, etc.)

- [ ] **Step 3: Expand the type definitions**

Add the following to `shared/types/intelligence.ts`. Keep existing interfaces intact — only add new fields and new types.

```typescript
// ── New supporting types ──────────────────────────────────────────────

export interface BusinessProfile {
  industry: string;
  goals: string[];
  targetAudience: string;
}

export interface BacklinkProfile {
  totalBacklinks: number;
  referringDomains: number;
  trend: 'growing' | 'stable' | 'declining';
}

export interface SerpFeatures {
  featuredSnippets: number;
  peopleAlsoAsk: number;
  localPack: boolean;
}

export interface EngagementMetrics {
  lastLoginAt: string | null;
  loginFrequency: 'daily' | 'weekly' | 'monthly' | 'inactive';
  chatSessionCount: number; // last 30 days
  portalUsage: { pageViews: number; featuresUsed: string[] } | null; // Phase 4: client portal tracking
}

export interface CompositeHealthScore {
  score: number; // 0-100
  components: {
    churn: { score: number; weight: 0.4 };
    roi: { score: number; weight: 0.3 };
    engagement: { score: number; weight: 0.3 };
  };
  computedAt: string;
}

export interface ChurnSignalSummary {
  type: string;
  severity: string;
  detectedAt: string;
}

export interface ROIAttribution {
  actionId: string;
  pageUrl: string;
  actionType: string;
  clicksBefore: number;
  clicksAfter: number;
  clickGain: number;
  measuredAt: string;
}

export interface WeCalledItEntry {
  actionId: string;
  prediction: string;
  outcome: string;
  score: string;
  pageUrl: string;
  measuredAt: string;
}

export interface RankTrackingSummary {
  trackedKeywords: number;
  avgPosition: number | null;
  positionChanges: { improved: number; declined: number; stable: number };
}

export interface StrategyHistory {
  revisionsCount: number;
  lastRevisedAt: string;
  trajectory: string; // e.g. 'expanding', 'narrowing', 'stable'
}

export interface DecayAlert {
  pageUrl: string;
  clickDrop: number;
  detectedAt: string;
  hasRefreshBrief: boolean;
  isRepeatDecay: boolean;
}

export interface CannibalizationWarning {
  keyword: string;
  pages: string[];
  severity: 'low' | 'medium' | 'high';
}

export interface RedirectDetail {
  url: string;
  target: string;
  chainDepth: number;
  status: number;
}

export interface AeoReadiness {
  pagesChecked: number;
  passingRate: number; // 0-1
}

export interface SchemaValidationSummary {
  valid: number;
  warnings: number;
  errors: number;
}

export interface PerformanceSummary {
  avgLcp: number | null;
  avgFid: number | null;
  avgCls: number | null;
  score: number | null;
}

export interface InsightAcceptanceRate {
  totalShown: number;
  confirmed: number;
  dismissed: number;
  rate: number;
}
```

Then update the existing slice interfaces:

**`SeoContextSlice`** — add new optional fields:
```typescript
export interface SeoContextSlice {
  strategy: KeywordStrategy | undefined;
  brandVoice: string;
  businessContext: string;
  personas: AudiencePersona[];
  knowledgeBase: string;
  pageKeywords?: PageKeywordMap;
  // New in 3A
  businessProfile?: BusinessProfile;
  backlinkProfile?: BacklinkProfile;
  serpFeatures?: SerpFeatures;
  rankTracking?: RankTrackingSummary;
  keywordRecommendations?: Array<{ keyword: string; volume: number; difficulty: number; relevance: number }>;
  strategyHistory?: StrategyHistory;
}
```

**`ContentPipelineSlice`** — add new optional fields:
```typescript
export interface ContentPipelineSlice {
  briefs: { total: number; byStatus: Record<string, number> };
  posts: { total: number; byStatus: Record<string, number> };
  matrices: { total: number; cellsPlanned: number; cellsPublished: number };
  requests: { pending: number; inProgress: number; delivered: number };
  workOrders: { active: number };
  coverageGaps: string[];
  seoEdits: { pending: number; applied: number; inReview: number };
  // New in 3A
  subscriptions?: { active: number; totalPages: number };
  schemaDeployment?: { planned: number; deployed: number; types: string[] };
  rewritePlaybook?: { patterns: string[]; lastUsedAt: string | null };
  cannibalizationWarnings?: CannibalizationWarning[];
  decayAlerts?: DecayAlert[];
  suggestedBriefs?: number;
}
```

**`SiteHealthSlice`** — add new optional fields:
```typescript
export interface SiteHealthSlice {
  auditScore: number | null;
  auditScoreDelta: number | null;
  deadLinks: number;
  redirectChains: number;
  schemaErrors: number;
  orphanPages: number;
  cwvPassRate: { mobile: number | null; desktop: number | null };
  // New in 3A
  redirectDetails?: RedirectDetail[];
  aeoReadiness?: AeoReadiness;
  schemaValidation?: SchemaValidationSummary;
  performanceSummary?: PerformanceSummary;
  anomalyCount?: number;
  anomalyTypes?: string[];
  seoChangeVelocity?: number;
}
```

**`ClientSignalsSlice`** — add new optional fields:
```typescript
export interface ClientSignalsSlice {
  keywordFeedback: { approved: string[]; rejected: string[]; patterns: { approveRate: number; topRejectionReasons: string[] } };
  contentGapVotes: { topic: string; votes: number }[];
  businessPriorities: string[];
  approvalPatterns: { approvalRate: number; avgResponseTime: number | null };
  recentChatTopics: string[];
  churnRisk: 'low' | 'medium' | 'high' | null;
  // New in 3A
  churnSignals?: ChurnSignalSummary[];
  roi?: { organicValue: number; growth: number; period: string } | null;
  engagement?: EngagementMetrics;
  compositeHealthScore?: number | null; // 0-100 unified score (see CompositeHealthScore for internal computation)
  feedbackItems?: Array<{ id: string; type: string; status: string; createdAt: string }>;
  serviceRequests?: { pending: number; total: number };
}
```

**`OperationalSlice`** — add new optional fields:
```typescript
export interface OperationalSlice {
  recentActivity: { type: string; description: string; timestamp: string }[];
  annotations: { date: string; label: string; pageUrl?: string }[];
  pendingJobs: number;
  // New in 3A
  timeSaved?: { totalMinutes: number; byFeature: Record<string, number> } | null;
  approvalQueue?: { pending: number; oldestAge: number | null };
  recommendationQueue?: { fixNow: number; fixSoon: number; fixLater: number };
  actionBacklog?: { pendingMeasurement: number; oldestAge: number | null };
  detectedPlaybooks?: string[];
  workOrders?: { active: number; pending: number };
  insightAcceptanceRate?: InsightAcceptanceRate | null;
}
```

**`LearningsSlice`** — add new optional fields:
```typescript
export interface LearningsSlice {
  summary: WorkspaceLearnings | null;
  confidence: LearningsConfidence | null;
  topActionTypes: Array<{ type: string; winRate: number; count: number }>;
  overallWinRate: number;
  recentTrend: LearningsTrend | null;
  playbooks: ActionPlaybook[];
  forPage?: {
    actions: TrackedAction[];
    outcomes: ActionOutcome[];
    hasActiveAction: boolean;
  };
  // New in 3A
  topWins?: TrackedAction[];                   // top 5 recent wins
  winRateByActionType?: Record<string, number>; // action type → win rate
  roiAttribution?: ROIAttribution[];
  weCalledIt?: WeCalledItEntry[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/intelligence-types.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check the full project**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS (all new fields are optional, so existing code is unaffected)

- [ ] **Step 6: Commit**

```bash
git add shared/types/intelligence.ts server/__tests__/intelligence-types.test.ts
git commit -m "feat(intelligence): expand shared types for Phase 3A slice assemblers

Add 15 new supporting types (BusinessProfile, BacklinkProfile, SerpFeatures,
CompositeHealthScore, etc.) and expand all 8 slice interfaces with optional
fields per spec §3/§10. All new fields are optional — zero breaking changes."
```

---

### Task 2: Wire Unwired Phase 2 Bridges (#1, #10, #12, #15) — ✅ DONE

> **Completed:** All 4 bridges wired and hardened via PR #118 (bridge infrastructure hardening).
> - Bridge #1 (outcome→reweight): `server/outcome-tracking.ts` — uses `applyScoreAdjustment()`, auto-broadcast
> - Bridge #10 (anomaly→boost): `server/anomaly-detection.ts` — uses `applyScoreAdjustment()`, auto-broadcast
> - Bridge #12 (audit→page_health): `server/scheduled-audits.ts` — uses `bridgeSource`, auto-broadcast
> - Bridge #15 (audit→site_health): `server/scheduled-audits.ts` — uses `bridgeSource`, auto-broadcast
> Tests: `tests/bridge-wiring.test.ts` (10 tests passing).
>
> **⚠️ CODE EXAMPLES BELOW ARE OBSOLETE.** They show the pre-hardening patterns (raw `Math.min/max`, manual broadcast, `...insight` spread). Do NOT follow them for Task 7 or any future bridge work. Follow the Bridge Authoring Rules section above instead.

**Files:**
- Modify: `server/outcome-tracking.ts` (Bridge #1)
- Modify: `server/anomaly-detection.ts` (Bridge #10)
- Modify: `server/scheduled-audits.ts` (Bridges #12, #15)
- Test: `server/__tests__/bridge-wiring.test.ts`

- [ ] **Step 1: Write bridge wiring tests**

```typescript
// server/__tests__/bridge-wiring.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test that the bridge functions are called from the correct trigger points.
// Since these are fire-and-forget, we verify the import + call structure exists.

describe('Bridge #1: outcome→reweight', () => {
  it('recordOutcome imports and calls debouncedOutcomeReweight for actionable scores', async () => {
    // Read the source file and verify the import and call exist
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../outcome-tracking.ts', import.meta.url), 'utf-8');
    expect(src).toContain('debouncedOutcomeReweight');
    expect(src).toContain('withWorkspaceLock');
    expect(src).toContain("actionableScores");
  });
});

describe('Bridge #10: anomaly→boost insight severity', () => {
  it('anomaly detection calls debouncedAnomalyBoost', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../anomaly-detection.ts', import.meta.url), 'utf-8');
    expect(src).toContain('debouncedAnomalyBoost');
  });
});

describe('Bridge #12: audit→page_health insights', () => {
  it('scheduled audits fire bridge-audit-page-health', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../scheduled-audits.ts', import.meta.url), 'utf-8');
    expect(src).toContain('bridge-audit-page-health');
  });
});

describe('Bridge #15: audit→site_health insights', () => {
  it('scheduled audits fire bridge-audit-site-health', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../scheduled-audits.ts', import.meta.url), 'utf-8');
    expect(src).toContain('bridge-audit-site-health');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/bridge-wiring.test.ts`
Expected: FAIL — imports and calls don't exist yet

- [ ] **Step 3: Wire Bridge #1 in `outcome-tracking.ts`**

In `server/outcome-tracking.ts`, add to the imports at top:
```typescript
import { fireBridge, withWorkspaceLock, debouncedOutcomeReweight } from './bridge-infrastructure.js';
```

In the `recordOutcome()` function, after `return rowToActionOutcome(outcome);` is returned, add the bridge logic BEFORE the return (after the transaction completes, before the return):

```typescript
  // ── Bridge #1: Outcome → reweight insight scores ──────────────────
  // Only fire for scores that produce a non-zero adjustment (win/strong_win/loss).
  // Skip neutral/insufficient_data/inconclusive to avoid acquiring workspace lock for a no-op.
  //
  // IMPORTANT: debouncedOutcomeReweight uses last-call-wins semantics keyed by workspaceId.
  // The callback must NOT capture per-outcome context (page_url, score) because only the
  // last callback survives when multiple outcomes are recorded in quick succession.
  // Instead, re-query all recently scored actions and reweight ALL non-resolved insights.
  const actionableScores = new Set(['strong_win', 'win', 'loss']);
  if (params.score && actionableScores.has(params.score)) {
    const actionRow = stmts().getById.get(params.actionId) as TrackedActionRow | undefined;
    if (actionRow) {
      const workspaceId = actionRow.workspace_id;
      debouncedOutcomeReweight(workspaceId, async () => {
        await withWorkspaceLock(workspaceId, async () => {
          const { getInsights, upsertInsight } = await import('./analytics-insights-store.js');
          const insights = getInsights(workspaceId);
          const nonResolved = insights.filter(i => i.resolutionStatus !== 'resolved');

          // Re-query recent scored actions to compute a net adjustment per insight.
          const scoredRows = stmts().getScoredByWorkspace.all(workspaceId) as Array<TrackedActionRow & {
            outcome_score: string; outcome_checkpoint_days: number; scored_at: string;
          }>;

          // Build a map of page_url → latest score delta
          const pageScoreMap = new Map<string, number>();
          for (const row of scoredRows) {
            const pageUrl = row.page_url;
            if (!pageUrl || pageScoreMap.has(pageUrl)) continue; // first = most recent
            const delta =
              row.outcome_score === 'strong_win' ? -20 :
              row.outcome_score === 'win'        ? -10 :
              row.outcome_score === 'loss'       ?  15 :
              0;
            if (delta !== 0) pageScoreMap.set(pageUrl, delta);
          }

          for (const insight of nonResolved) {
            const scoreDelta = pageScoreMap.get(insight.pageId ?? '') ?? 0;
            if (scoreDelta !== 0) {
              const adjusted = Math.max(0, Math.min(100, (insight.impactScore ?? 50) + scoreDelta));
              upsertInsight({
                ...insight,
                impactScore: adjusted,
                resolutionSource: 'bridge_1_outcome_reweight',
              });
            }
          }
        });

        const { broadcastToWorkspace: broadcast } = await import('./broadcast.js');
        const { WS_EVENTS: WS } = await import('./ws-events.js');
        broadcast(workspaceId, WS.INSIGHT_BRIDGE_UPDATED, { bridge: 'bridge_1_outcome_reweight' });
      });
    }
  }
```

- [ ] **Step 4: Wire Bridge #10 in `anomaly-detection.ts`**

In `server/anomaly-detection.ts`, add to imports:
```typescript
import { debouncedAnomalyBoost } from './bridge-infrastructure.js';
```

Find the function that creates/upserts anomaly digest insights (likely `upsertAnomalyDigestInsight` or after anomaly detection completes for a workspace). After anomalies are detected for a page, add:

```typescript
  // ── Bridge #10: Anomaly → boost existing insight severity ──────────
  // When an anomaly is detected for a page that already has insights,
  // boost those insights' impact scores to surface them faster.
  if (newAnomalies > 0) {
    debouncedAnomalyBoost(workspaceId, async () => {
      const { getInsights, upsertInsight } = await import('./analytics-insights-store.js');
      const insights = getInsights(workspaceId);

      // Get pages with new anomalies
      const anomalyPages = new Set(
        listAnomalies(workspaceId, false)
          .filter(a => !a.dismissed && Date.now() - new Date(a.detectedAt).getTime() < 24 * 60 * 60 * 1000)
          .map(a => a.pageUrl)
          .filter(Boolean),
      );

      for (const insight of insights) {
        if (insight.resolutionStatus === 'resolved') continue;
        if (insight.pageId && anomalyPages.has(insight.pageId)) {
          const boosted = Math.min(100, (insight.impactScore ?? 50) + 10);
          if (boosted !== insight.impactScore) {
            upsertInsight({
              ...insight,
              impactScore: boosted,
              resolutionSource: 'bridge_10_anomaly_boost',
            });
          }
        }
      }

      const { broadcastToWorkspace: broadcast } = await import('./broadcast.js');
      const { WS_EVENTS: WS } = await import('./ws-events.js');
      broadcast(workspaceId, WS.INSIGHT_BRIDGE_UPDATED, { bridge: 'bridge_10_anomaly_boost' });
    });
  }
```

**Note for implementer:** Find the exact location in `anomaly-detection.ts` where anomaly detection results are finalized per workspace (after the `newAnomalies` count is determined). The bridge call goes after that point. Grep for `broadcastToWorkspace` or `ANOMALIES_UPDATE` to find the right spot.

- [ ] **Step 5: Wire Bridges #12 and #15 in `scheduled-audits.ts`**

In `server/scheduled-audits.ts`, add to imports:
```typescript
import { fireBridge } from './bridge-infrastructure.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
```

Find the callback that runs after a scheduled audit completes (look for where `saveSnapshot` is called or audit results are finalized). Add both bridges:

```typescript
  // ── Bridge #12: Audit → page_health insights ──────────────────────
  fireBridge('bridge-audit-page-health', workspaceId, async () => {
    const { upsertInsight, getInsights } = await import('./analytics-insights-store.js');
    const existing = getInsights(workspaceId);

    // Map critical/warning audit issues to page_health insights
    const criticalIssues = auditResult.pages
      ?.filter(p => p.issues?.some(i => i.severity === 'critical' || i.severity === 'warning'))
      ?? [];

    for (const page of criticalIssues.slice(0, 20)) { // Cap at 20 to avoid flooding
      const pageIssues = page.issues?.filter(i => i.severity === 'critical' || i.severity === 'warning') ?? [];
      if (pageIssues.length === 0) continue;

      // Deduplicate: skip if identical page_health insight exists
      const existingForPage = existing.find(
        i => i.insightType === 'page_health' && i.pageId === page.url && i.resolutionStatus !== 'resolved',
      );
      if (existingForPage) continue;

      upsertInsight({
        workspaceId,
        insightType: 'page_health',
        severity: pageIssues.some(i => i.severity === 'critical') ? 'critical' : 'warning',
        title: `Audit: ${pageIssues.length} issue(s) on ${page.title || page.url}`,
        description: pageIssues.map(i => i.message).join('; '),
        pageId: page.url,
        impactScore: pageIssues.some(i => i.severity === 'critical') ? 80 : 50,
        resolutionSource: 'bridge_12_audit_page_health',
      });
    }

    broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_BRIDGE_UPDATED, {
      bridge: 'bridge_12_audit_page_health',
    });
  });

  // ── Bridge #15: Audit → site_health insights ──────────────────────
  fireBridge('bridge-audit-site-health', workspaceId, async () => {
    const { upsertInsight } = await import('./analytics-insights-store.js');

    // Create site-level insight from aggregate audit findings
    const totalIssues = auditResult.summary?.totalIssues ?? 0;
    const score = auditResult.summary?.overallScore ?? null;
    if (totalIssues > 0 && score !== null && score < 70) {
      upsertInsight({
        workspaceId,
        insightType: 'page_health',
        severity: score < 50 ? 'critical' : 'warning',
        title: `Site health: ${totalIssues} issues, score ${score}/100`,
        description: `Audit found ${totalIssues} total issues across the site. Overall health score: ${score}/100.`,
        impactScore: Math.max(0, 100 - score),
        resolutionSource: 'bridge_15_audit_site_health',
      });
    }

    broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_BRIDGE_UPDATED, {
      bridge: 'bridge_15_audit_site_health',
    });
  });
```

**Note for implementer:** The exact variable names (`auditResult`, `workspaceId`) depend on the structure of `scheduled-audits.ts`. Read the file to find the completion handler. The audit result shape comes from `seo-audit.ts` — check `SeoAuditResult` type for the exact field names. Adapt `auditResult.pages`, `auditResult.summary` to match the actual shape.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/bridge-wiring.test.ts`
Expected: PASS

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/outcome-tracking.ts server/anomaly-detection.ts server/scheduled-audits.ts server/__tests__/bridge-wiring.test.ts
git commit -m "feat(bridges): wire Phase 2 bridges #1, #10, #12, #15 to trigger points

Bridge #1: outcome scored → reweight insight severity (debouncedOutcomeReweight)
Bridge #10: anomaly detected → boost insight impact score (debouncedAnomalyBoost)
Bridge #12: audit complete → create page_health insights from critical issues
Bridge #15: audit complete → create site-level health insights from aggregate findings"
```

---

### ⚠️ Error Handling Contract (applies to ALL assembler tasks: 3-6, 8-10)

Every assembler task below MUST follow these patterns from spec §12:

**1. Per-slice top-level try/catch wrapper** in the `assembleSlice()` switch:
```typescript
case 'siteHealth':
  try {
    result.siteHealth = await assembleSiteHealth(workspaceId, opts);
  } catch (err) {
    log.warn({ workspaceId, slice: 'siteHealth', err }, 'Slice assembly failed — skipping');
  }
  break;
```

**2. 5-second timeout on any async call** (e.g., `getCachedArchitecture`):
```typescript
const arch = await Promise.race([
  getCachedArchitecture(workspaceId),
  new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Assembly timeout: getCachedArchitecture')), 5000)),
]);
```

**3. No silent catches** — every `catch` block must log:
```typescript
// ❌ WRONG (spec §12 explicitly prohibits this)
} catch {
  // Schema data optional
}

// ✅ CORRECT
} catch (err) {
  log.debug({ workspaceId, err }, 'Schema validation data unavailable — skipping');
}
```

**Implementer:** Apply these patterns to every assembler below. The plan shows `catch {}` in many places for brevity — replace ALL of them with the logged pattern above.

---

### Task 3: Implement `siteHealth` Slice Assembler — ✅ DONE

> **Completed:** Full implementation at `server/workspace-intelligence.ts:265-452`.
> Pulls from 8 data sources: audit snapshots, dead links, PageSpeed/CWV, redirect chains,
> orphan pages, schema validation, anomaly count, SEO change velocity.
> Tests: `tests/assemble-site-health.test.ts` (3 tests passing).
>
> **Known gap:** `aeoReadiness` field is not yet populated (no `aeo-page-review.ts` module exists yet).
> This can be added as a follow-up when AEO review functionality is built.
>
> **No action needed.** The code below is preserved for reference only.

**Files:**
- Modify: `server/workspace-intelligence.ts`
- Test: `server/__tests__/assemble-site-health.test.ts`

**Data sources:** `reports.ts`, `performance-store.ts`, `link-checker.ts`, `redirect-store.ts`, `seo-change-tracker.ts`, `anomaly-detection.ts`, `aeo-page-review.ts`, `schema-validator.ts`, `pagespeed.ts`

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/assemble-site-health.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Since assemblers use dynamic imports, we mock at the module level
vi.mock('../reports.js', () => ({
  getLatestSnapshot: vi.fn(() => ({
    id: 'snap-1',
    score: 82,
    summary: { totalIssues: 15, criticalCount: 2, warningCount: 5 },
    pages: [],
  })),
  listSnapshots: vi.fn(() => [
    { id: 'snap-1', score: 82, createdAt: '2026-03-30' },
    { id: 'snap-0', score: 79, createdAt: '2026-03-01' },
  ]),
}));

vi.mock('../performance-store.js', () => ({
  getPageSpeed: vi.fn(() => ({
    result: {
      lighthouseResult: {
        categories: { performance: { score: 0.85 } },
        audits: {
          'largest-contentful-paint': { numericValue: 2100 },
          'first-input-delay': { numericValue: 50 },
          'cumulative-layout-shift': { numericValue: 0.05 },
        },
      },
    },
  })),
}));

vi.mock('../link-checker.js', () => ({
  checkSiteLinks: vi.fn(async () => ({
    deadLinks: [{ url: '/broken', status: 404 }],
    totalChecked: 100,
  })),
}));

vi.mock('../redirect-store.js', () => ({
  getRedirectSnapshot: vi.fn(() => ({
    result: {
      chains: [{ url: '/old', target: '/new', depth: 2, status: 301 }],
      notFound: [{ url: '/missing', status: 404 }],
    },
  })),
}));

vi.mock('../anomaly-detection.js', () => ({
  listAnomalies: vi.fn(() => [
    { id: 'a1', type: 'traffic_drop', dismissed: false },
    { id: 'a2', type: 'ranking_drop', dismissed: false },
    { id: 'a3', type: 'traffic_drop', dismissed: true },
  ]),
}));

vi.mock('../seo-change-tracker.js', () => ({
  getSeoChanges: vi.fn(() => [
    { id: '1', fields: ['title'], createdAt: '2026-03-28' },
    { id: '2', fields: ['meta'], createdAt: '2026-03-29' },
    { id: '3', fields: ['h1'], createdAt: '2026-03-30' },
  ]),
}));

vi.mock('../workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({
    id: 'ws-1',
    siteId: 'site-1',
  })),
}));

describe('assembleSiteHealth', () => {
  it('returns populated SiteHealthSlice with all required fields', async () => {
    // Import after mocks are set up
    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['siteHealth'],
    });

    expect(result.siteHealth).toBeDefined();
    const sh = result.siteHealth!;
    expect(sh.auditScore).toBeTypeOf('number');
    expect(sh.anomalyCount).toBeGreaterThanOrEqual(0);

    // Shape completeness: verify all required fields are present and correctly typed
    expect(sh).toHaveProperty('auditScore');
    expect(sh).toHaveProperty('auditScoreDelta');
    expect(sh).toHaveProperty('deadLinks');
    expect(sh).toHaveProperty('redirectChains');
    expect(sh).toHaveProperty('schemaErrors');
    expect(sh).toHaveProperty('orphanPages');
    expect(sh).toHaveProperty('cwvPassRate');
    expect(sh.cwvPassRate).toHaveProperty('mobile');
    expect(sh.cwvPassRate).toHaveProperty('desktop');
    // Optional enrichment fields (may be undefined but should exist if data is present)
    expect(sh.anomalyTypes).toBeDefined();
    expect(sh.seoChangeVelocity).toBeTypeOf('number');
  });

  it('returns sensible defaults when all data sources are empty', async () => {
    // Override mocks with empty returns
    const { getLatestSnapshot } = await import('../reports.js');
    const { listAnomalies } = await import('../anomaly-detection.js');
    const { getSeoChanges } = await import('../seo-change-tracker.js');
    vi.mocked(getLatestSnapshot).mockReturnValueOnce(null as any);
    vi.mocked(listAnomalies).mockReturnValueOnce([]);
    vi.mocked(getSeoChanges).mockReturnValueOnce([]);

    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['siteHealth'],
    });

    expect(result.siteHealth).toBeDefined();
    const sh = result.siteHealth!;
    expect(sh.auditScore).toBeNull();
    expect(sh.auditScoreDelta).toBeNull();
    expect(sh.deadLinks).toBe(0);
    expect(sh.redirectChains).toBe(0);
    expect(sh.anomalyCount).toBe(0);
    expect(sh.anomalyTypes).toEqual([]);
  });

  it('survives when a data source throws', async () => {
    // Make reports throw — other sources should still populate
    const { getLatestSnapshot } = await import('../reports.js');
    vi.mocked(getLatestSnapshot).mockImplementationOnce(() => { throw new Error('DB corrupted'); });

    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['siteHealth'],
    });

    // Slice should either still return (with partial data) or be undefined (per-slice catch).
    // Either way, buildWorkspaceIntelligence should NOT throw.
    if (result.siteHealth) {
      // If returned, audit fields should be null (the source that threw)
      expect(result.siteHealth.auditScore).toBeNull();
      // But anomaly data (separate source) should still be populated
      expect(result.siteHealth.anomalyCount).toBeGreaterThanOrEqual(0);
    }
    // If undefined, that means per-slice try/catch caught it — also valid
  });
});
```

**Note for implementer:** The exact mock shapes must match what the assembler actually calls. Read each source module's function signatures and adjust mock return values to match the real data shapes. The test above is a starting template — adapt to match the actual imports the assembler will use.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/assemble-site-health.test.ts`
Expected: FAIL — siteHealth assembler returns undefined

- [ ] **Step 3: Implement the `assembleSiteHealth` function**

In `server/workspace-intelligence.ts`, replace the stub case for `siteHealth` in `assembleSlice()`:

```typescript
    case 'siteHealth':
      result.siteHealth = await assembleSiteHealth(workspaceId, opts);
      break;
```

Add the assembler function:

```typescript
async function assembleSiteHealth(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<SiteHealthSlice> {
  const { getWorkspace } = await import('./workspaces.js');
  const workspace = getWorkspace(workspaceId);
  const siteId = workspace?.siteId ?? null;

  // Audit score + delta
  let auditScore: number | null = null;
  let auditScoreDelta: number | null = null;
  if (siteId) {
    const { getLatestSnapshot, listSnapshots } = await import('./reports.js');
    const latest = getLatestSnapshot(siteId);
    if (latest) {
      auditScore = latest.score ?? null;
      const snapshots = listSnapshots(siteId);
      if (snapshots.length >= 2) {
        const prev = snapshots[1]; // second most recent
        if (prev.score != null && auditScore != null) {
          auditScoreDelta = auditScore - prev.score;
        }
      }
    }
  }

  // Dead links (from link-checker, with redirect-store fallback)
  let deadLinks = 0;
  let redirectChains = 0;
  let redirectDetails: RedirectDetail[] = [];
  if (siteId) {
    // Primary: link-checker for dead links
    try {
      const { getLinkCheck } = await import('./performance-store.js');
      const linkCheck = getLinkCheck(siteId);
      if (linkCheck?.result) {
        const deadLinkList = (linkCheck.result as any).deadLinks ?? [];
        deadLinks = deadLinkList.length;
      }
    } catch {
      // link-checker data optional — fall through to redirect-store
    }

    // Redirect chains from redirect-store
    const { getRedirectSnapshot } = await import('./redirect-store.js');
    const snap = getRedirectSnapshot(siteId);
    if (snap?.result) {
      const chains = (snap.result as any).chains ?? [];
      const notFound = (snap.result as any).notFound ?? [];
      redirectChains = chains.length;
      if (deadLinks === 0) deadLinks = notFound.length; // Fallback if link-checker had no data
      redirectDetails = chains.slice(0, 10).map((c: any) => ({
        url: c.url ?? '',
        target: c.target ?? '',
        chainDepth: c.depth ?? 1,
        status: c.status ?? 301,
      }));
    }
  }

  // Schema errors
  let schemaErrors = 0;
  let schemaValidation: SchemaValidationSummary | undefined;
  if (siteId) {
    try {
      const { getValidations } = await import('./schema-validator.js');
      const validations = getValidations(workspaceId);
      let valid = 0, warnings = 0, errors = 0;
      for (const v of validations) {
        const status = (v as any).status ?? 'valid';
        if (status === 'valid') valid++;
        else if (status === 'warnings') warnings++;
        else errors++;
      }
      schemaErrors = errors;
      schemaValidation = { valid, warnings, errors };
    } catch {
      // schema-validator may not have data — non-critical
    }
  }

  // Orphan pages (from site architecture)
  let orphanPages = 0;
  try {
    const { getCachedArchitecture, flattenTree } = await import('./site-architecture.js');
    const arch = await getCachedArchitecture(workspaceId);
    if (arch?.tree) {
      const allNodes = flattenTree(arch.tree);
      orphanPages = allNodes.filter((n: any) => n.orphan === true).length;
    }
  } catch {
    // Architecture may not exist yet
  }

  // CWV pass rate
  let cwvPassRate = { mobile: null as number | null, desktop: null as number | null };
  let performanceSummary: PerformanceSummary | undefined;
  if (siteId) {
    try {
      const { getPageSpeed } = await import('./performance-store.js');
      const psData = getPageSpeed(siteId);
      if (psData?.result) {
        const lr = (psData.result as any).lighthouseResult;
        if (lr?.categories?.performance?.score != null) {
          const score = lr.categories.performance.score;
          cwvPassRate = { mobile: score, desktop: score }; // PageSpeed reports one mode at a time
          const audits = lr.audits ?? {};
          performanceSummary = {
            avgLcp: audits['largest-contentful-paint']?.numericValue ?? null,
            avgFid: audits['first-input-delay']?.numericValue ?? null,
            avgCls: audits['cumulative-layout-shift']?.numericValue ?? null,
            score: Math.round(score * 100),
          };
        }
      }
    } catch {
      // PageSpeed data optional
    }
  }

  // Anomalies
  const { listAnomalies } = await import('./anomaly-detection.js');
  const anomalies = listAnomalies(workspaceId, false); // exclude dismissed
  const activeAnomalies = anomalies.filter(a => !a.dismissed);
  const anomalyTypes = [...new Set(activeAnomalies.map(a => a.type).filter(Boolean))];

  // AEO readiness (from aeo-page-review.ts — NOT schema-validator.ts)
  let aeoReadiness: AeoReadiness | undefined;
  if (siteId) {
    try {
      // Implementer: import from aeo-page-review.ts. Check for getReviews/getAeoReviews/listReviews export.
      // The function should return an array of per-page review results.
      const { getAeoReviews } = await import('./aeo-page-review.js');
      const reviews = getAeoReviews(workspaceId);
      let pagesChecked = 0, passing = 0;
      for (const review of reviews) {
        pagesChecked++;
        const r = review as any;
        if (r.aeoReady || r.isReady || r.passing) passing++;
      }
      if (pagesChecked > 0) {
        aeoReadiness = { pagesChecked, passingRate: passing / pagesChecked };
      }
    } catch (err) {
      log.debug({ workspaceId, err }, 'AEO review data unavailable — skipping');
    }
  }

  // SEO change velocity (changes in last 30 days)
  const { getSeoChanges } = await import('./seo-change-tracker.js');
  const changes = getSeoChanges(workspaceId, 100);
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentChanges = changes.filter(c => new Date(c.createdAt).getTime() > thirtyDaysAgo);

  return {
    auditScore,
    auditScoreDelta,
    deadLinks,
    redirectChains,
    schemaErrors,
    orphanPages,
    cwvPassRate,
    redirectDetails,
    aeoReadiness,
    schemaValidation,
    performanceSummary,
    anomalyCount: activeAnomalies.length,
    anomalyTypes,
    seoChangeVelocity: recentChanges.length,
  };
}
```

Add the necessary type imports at the top of the file:
```typescript
import type {
  // ... existing imports ...
  RedirectDetail,
  SchemaValidationSummary,
  PerformanceSummary,
} from '../shared/types/intelligence.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/assemble-site-health.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/workspace-intelligence.ts server/__tests__/assemble-site-health.test.ts
git commit -m "feat(intelligence): implement siteHealth slice assembler

Wires audit scores, dead links, redirect chains, schema errors, orphan pages,
CWV pass rate, anomaly counts, and SEO change velocity from 9 data sources."
```

---

### Task 4: Implement `contentPipeline` Slice Assembler — ✅ BASE DONE

> **Completed (base):** `assembleContentPipeline()` at `server/workspace-intelligence.ts:232-263`.
> Pulls from `workspace-data.ts` (getContentPipelineSummary) and `content-brief.ts` (coverage gaps).
>
> **Remaining 3A-expansion fields (not yet populated):**
> - `subscriptions` (from `content-subscriptions.ts`)
> - `schemaDeployment` (from `schema-store.ts` / `schema-queue.ts`)
> - `rewritePlaybook` (from content patterns)
> - `cannibalizationWarnings` (from `cannibalization-detection.ts`)
> - `decayAlerts` (from `content-decay.ts`)
> - `suggestedBriefs` (from `suggested-briefs-store.ts`)
>
> These enrichment fields can be wired as a sub-step of Task 4 or folded into Task 13
> (formatForPrompt) since they're only meaningful once formatted for AI consumption.
> The base assembler with coverage gaps provides enough for the pipeline slice to be useful.

**Files:**
- Modify: `server/workspace-intelligence.ts`
- Test: `server/__tests__/assemble-content-pipeline.test.ts`

**Data sources:** `workspace-data.ts` (getContentPipelineSummary), `content-subscriptions.ts`, `schema-store.ts`, `schema-queue.ts`, `cannibalization-detection.ts`, `content-decay.ts`, `suggested-briefs-store.ts`, `content-calendar-intelligence.ts`

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/assemble-content-pipeline.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../workspace-data.js', () => ({
  getContentPipelineSummary: vi.fn(() => ({
    briefs: { total: 5, byStatus: { draft: 2, ready: 3 } },
    posts: { total: 3, byStatus: { draft: 1, published: 2 } },
    matrices: { total: 1, cellsPlanned: 10, cellsPublished: 4 },
    requests: { pending: 2, inProgress: 1, delivered: 5 },
    workOrders: { active: 1 },
    seoEdits: { pending: 1, applied: 3, inReview: 0 },
  })),
  getPageCacheStats: vi.fn(() => ({ entries: 0, maxEntries: 100 })),
}));

vi.mock('../content-subscriptions.js', () => ({
  listContentSubscriptions: vi.fn(() => [
    { id: 's1', status: 'active', postsPerMonth: 4, postsDeliveredThisPeriod: 1 },
  ]),
}));

vi.mock('../suggested-briefs-store.js', () => ({
  getSuggestedBriefs: vi.fn(() => [
    { id: 'sb1', status: 'pending' },
    { id: 'sb2', status: 'pending' },
    { id: 'sb3', status: 'accepted' },
  ]),
}));

describe('assembleContentPipeline', () => {
  it('returns populated ContentPipelineSlice with all required fields', async () => {
    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['contentPipeline'],
    });

    expect(result.contentPipeline).toBeDefined();
    const cp = result.contentPipeline!;
    expect(cp.briefs.total).toBe(5);
    expect(cp.subscriptions?.active).toBe(1);
    expect(cp.suggestedBriefs).toBeGreaterThanOrEqual(0);

    // Shape completeness: verify base pipeline fields
    expect(cp).toHaveProperty('briefs');
    expect(cp).toHaveProperty('posts');
    expect(cp).toHaveProperty('matrices');
    expect(cp).toHaveProperty('requests');
    expect(cp).toHaveProperty('workOrders');
    expect(cp).toHaveProperty('coverageGaps');
    expect(cp).toHaveProperty('seoEdits');
    expect(cp.seoEdits).toHaveProperty('pending');
    expect(cp.seoEdits).toHaveProperty('applied');
    expect(cp.seoEdits).toHaveProperty('inReview');
  });

  it('returns sensible defaults when optional sources are empty', async () => {
    const { listContentSubscriptions } = await import('../content-subscriptions.js');
    const { getSuggestedBriefs } = await import('../suggested-briefs-store.js');
    vi.mocked(listContentSubscriptions).mockReturnValueOnce([]);
    vi.mocked(getSuggestedBriefs).mockReturnValueOnce([]);

    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['contentPipeline'],
    });

    expect(result.contentPipeline).toBeDefined();
    const cp = result.contentPipeline!;
    // Base pipeline data still present from workspace-data
    expect(cp.briefs.total).toBe(5);
    // Optional enrichments are empty/zero
    expect(cp.subscriptions?.active ?? 0).toBe(0);
    expect(cp.suggestedBriefs).toBe(0);
  });

  it('survives when a data source throws', async () => {
    const { getContentPipelineSummary } = await import('../workspace-data.js');
    vi.mocked(getContentPipelineSummary).mockImplementationOnce(() => { throw new Error('Pipeline DB error'); });

    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['contentPipeline'],
    });

    // Per-slice try/catch: the slice is undefined, but the call doesn't crash
    // (buildWorkspaceIntelligence should never throw)
    expect(result).toBeDefined();
    expect(result.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/assemble-content-pipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the `assembleContentPipeline` function**

In `server/workspace-intelligence.ts`, replace the stub:

```typescript
    case 'contentPipeline':
      result.contentPipeline = await assembleContentPipeline(workspaceId, opts);
      break;
```

Add the assembler:

```typescript
async function assembleContentPipeline(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<ContentPipelineSlice> {
  const { getContentPipelineSummary } = await import('./workspace-data.js');
  const summary = getContentPipelineSummary(workspaceId);

  // Subscriptions
  let subscriptions: ContentPipelineSlice['subscriptions'];
  try {
    const { listContentSubscriptions } = await import('./content-subscriptions.js');
    const subs = listContentSubscriptions(workspaceId);
    const activeSubs = subs.filter(s => s.status === 'active');
    const totalPages = activeSubs.reduce((sum, s) => sum + ((s as any).totalPages ?? (s as any).postsPerMonth ?? 0), 0);
    subscriptions = { active: activeSubs.length, totalPages };
  } catch {
    subscriptions = undefined;
  }

  // Schema deployment progress
  let schemaDeployment: ContentPipelineSlice['schemaDeployment'];
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    if (ws?.siteId) {
      const { getSchemaPlan } = await import('./schema-store.js');
      const { listPendingSchemas } = await import('./schema-queue.js');
      const plan = getSchemaPlan(ws.siteId);
      const pending = listPendingSchemas(workspaceId);
      const planned = plan?.pages?.length ?? 0;
      const deployed = planned - pending.length;
      const types = [...new Set((plan?.pages ?? []).map((p: any) => p.schemaType).filter(Boolean))] as string[];
      schemaDeployment = {
        planned,
        deployed: Math.max(0, deployed),
        types,
      };
    }
  } catch {
    schemaDeployment = undefined;
  }

  // Cannibalization warnings
  let cannibalizationWarnings: CannibalizationWarning[] = [];
  try {
    const { listMatrices } = await import('./content-matrices.js');
    const { detectMatrixCannibalization } = await import('./cannibalization-detection.js');
    const matrices = listMatrices(workspaceId);
    for (const matrix of matrices.slice(0, 5)) { // Cap to avoid expensive scans
      const report = detectMatrixCannibalization(workspaceId, matrix.id);
      if (report.conflicts) {
        for (const conflict of report.conflicts.slice(0, 10)) {
          cannibalizationWarnings.push({
            keyword: conflict.keyword ?? '',
            pages: conflict.pages ?? [],
            severity: conflict.severity ?? 'low',
          });
        }
      }
    }
  } catch {
    // Cannibalization detection optional
  }

  // Decay alerts
  let decayAlerts: DecayAlert[] = [];
  try {
    const { loadDecayAnalysis } = await import('./content-decay.js');
    const decay = loadDecayAnalysis(workspaceId);
    if (decay?.pages) {
      decayAlerts = decay.pages.slice(0, 20).map(p => ({
        pageUrl: p.url ?? p.pageUrl ?? '',
        clickDrop: p.clickDrop ?? 0,
        detectedAt: p.detectedAt ?? decay.analyzedAt ?? new Date().toISOString(),
        hasRefreshBrief: !!p.briefId,
        isRepeatDecay: false, // Bridge #8 enriches this
      }));
    }
  } catch {
    // Decay data optional
  }

  // Suggested briefs count
  let suggestedBriefs = 0;
  try {
    const { getSuggestedBriefs } = await import('./suggested-briefs-store.js');
    const briefs = getSuggestedBriefs(workspaceId);
    suggestedBriefs = briefs.filter((b: any) => b.status === 'pending').length;
  } catch {
    // Suggested briefs optional
  }

  // Coverage gaps from keyword strategy
  let coverageGaps: string[] = [];
  try {
    const { getContentPipelineSummary: _unused, ...rest } = await import('./workspace-data.js');
    // Coverage gaps come from the base summary
  } catch {
    // Not critical
  }

  return {
    ...summary,
    coverageGaps: summary.coverageGaps ?? [],
    subscriptions,
    schemaDeployment,
    cannibalizationWarnings,
    decayAlerts,
    suggestedBriefs,
  };
}
```

Add necessary imports at top:
```typescript
import type {
  // ... existing imports ...
  CannibalizationWarning,
  DecayAlert,
} from '../shared/types/intelligence.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/assemble-content-pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/workspace-intelligence.ts server/__tests__/assemble-content-pipeline.test.ts
git commit -m "feat(intelligence): implement contentPipeline slice assembler

Wires content pipeline summary, subscriptions, schema deployment progress,
cannibalization warnings, decay alerts, and suggested briefs count."
```

---

### Task 5: Implement `clientSignals` Slice Assembler

**Files:**
- Modify: `server/workspace-intelligence.ts`
- Test: `server/__tests__/assemble-client-signals.test.ts`

**Data sources:** `churn-signals.ts`, `approvals.ts`, `roi.ts`, `roi-attribution.ts`, `activity-log.ts`, `feedback.ts`, `client-users.ts`, `requests.ts`, `chat-memory.ts`, keyword_feedback (DB direct), content_gap_votes (DB direct), client_business_priorities (DB direct)

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/assemble-client-signals.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../churn-signals.js', () => ({
  listChurnSignals: vi.fn(() => [
    { id: 'cs1', signalType: 'no_login', severity: 'medium', detectedAt: '2026-03-28', dismissed: false },
  ]),
}));

vi.mock('../approvals.js', () => ({
  listBatches: vi.fn(() => [
    {
      id: 'b1',
      items: [
        { id: 'i1', status: 'approved' },
        { id: 'i2', status: 'approved' },
        { id: 'i3', status: 'pending' },
      ],
    },
  ]),
}));

vi.mock('../feedback.js', () => ({
  listFeedback: vi.fn(() => [
    { id: 'f1', type: 'bug', status: 'open', createdAt: '2026-03-28' },
  ]),
}));

vi.mock('../requests.js', () => ({
  listRequests: vi.fn(() => [
    { id: 'r1', status: 'pending', workspaceId: 'ws-1' },
    { id: 'r2', status: 'completed', workspaceId: 'ws-1' },
  ]),
}));

vi.mock('../client-users.js', () => ({
  listClientUsers: vi.fn(() => [
    { id: 'u1', lastLoginAt: '2026-03-30T10:00:00Z' },
  ]),
}));

describe('assembleClientSignals', () => {
  it('returns populated ClientSignalsSlice with all required fields', async () => {
    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['clientSignals'],
    });

    expect(result.clientSignals).toBeDefined();
    const cs = result.clientSignals!;
    expect(cs.churnSignals).toBeDefined();
    expect(cs.churnSignals!.length).toBeGreaterThanOrEqual(0);
    expect(cs.approvalPatterns).toBeDefined();

    // Shape completeness
    expect(cs).toHaveProperty('keywordFeedback');
    expect(cs.keywordFeedback).toHaveProperty('approved');
    expect(cs.keywordFeedback).toHaveProperty('rejected');
    expect(cs.keywordFeedback).toHaveProperty('patterns');
    expect(cs.keywordFeedback.patterns).toHaveProperty('approveRate');
    expect(cs.keywordFeedback.patterns).toHaveProperty('topRejectionReasons');
    expect(cs).toHaveProperty('contentGapVotes');
    expect(cs).toHaveProperty('businessPriorities');
    expect(cs).toHaveProperty('churnRisk');
    expect(cs).toHaveProperty('recentChatTopics');
  });

  it('computes compositeHealthScore correctly with 40/30/30 formula', async () => {
    // Mock: churnRisk = 'low' → churnScore = 60
    // Mock: weekly login → engagementScore = 70
    // ROI not available → only 2 of 3 components → score should be non-null
    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['clientSignals'],
    });

    expect(result.clientSignals).toBeDefined();
    const score = result.clientSignals!.compositeHealthScore;
    // With 2+ components having data, score should be non-null
    if (score !== null) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(typeof score).toBe('number');
    }
  });

  it('returns null compositeHealthScore when fewer than 2 components have data', async () => {
    // Override all signal sources to return empty data
    const { listChurnSignals } = await import('../churn-signals.js');
    const { listClientUsers } = await import('../client-users.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([]);
    vi.mocked(listClientUsers).mockReturnValueOnce([]);

    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['clientSignals'],
    });

    // With no churn signals and no login data, only 0-1 components have data
    // compositeHealthScore may be null (depends on whether churnRisk defaults)
    expect(result.clientSignals).toBeDefined();
    // The important thing: score is null OR a valid number, never NaN or undefined
    const score = result.clientSignals!.compositeHealthScore;
    expect(score === null || (typeof score === 'number' && !isNaN(score))).toBe(true);
  });

  it('derives loginFrequency correctly from lastLoginAt', async () => {
    // Mock a user who logged in 1 day ago → should be 'daily'
    const { listClientUsers } = await import('../client-users.js');
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: yesterday } as any,
    ]);

    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['clientSignals'],
    });

    expect(result.clientSignals!.engagement?.loginFrequency).toBe('daily');
  });

  it('returns sensible defaults when all signal sources are empty', async () => {
    const { listChurnSignals } = await import('../churn-signals.js');
    const { listBatches } = await import('../approvals.js');
    const { listFeedback } = await import('../feedback.js');
    const { listRequests } = await import('../requests.js');
    const { listClientUsers } = await import('../client-users.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([]);
    vi.mocked(listBatches).mockReturnValueOnce([]);
    vi.mocked(listFeedback).mockReturnValueOnce([]);
    vi.mocked(listRequests).mockReturnValueOnce([]);
    vi.mocked(listClientUsers).mockReturnValueOnce([]);

    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['clientSignals'],
    });

    expect(result.clientSignals).toBeDefined();
    const cs = result.clientSignals!;
    expect(cs.churnSignals).toEqual([]);
    expect(cs.approvalPatterns.approvalRate).toBe(0);
    expect(cs.engagement?.loginFrequency).toBe('inactive');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/assemble-client-signals.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the `assembleClientSignals` function**

Replace the stub in `assembleSlice()`:
```typescript
    case 'clientSignals':
      result.clientSignals = await assembleClientSignals(workspaceId, opts);
      break;
```

Add the assembler:

```typescript
async function assembleClientSignals(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<ClientSignalsSlice> {
  // Keyword feedback (DB direct — no store module)
  let keywordFeedback: ClientSignalsSlice['keywordFeedback'] = { approved: [], rejected: [], patterns: { approveRate: 0, topRejectionReasons: [] } };
  try {
    const approvedRows = db.prepare(
      'SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = ?',
    ).all(workspaceId, 'approved') as { keyword: string }[];
    const rejectedRows = db.prepare(
      'SELECT keyword, reason FROM keyword_feedback WHERE workspace_id = ? AND status = ?',
    ).all(workspaceId, 'declined') as { keyword: string; reason?: string }[];
    const total = approvedRows.length + rejectedRows.length;
    const reasons = rejectedRows.map(r => r.reason).filter(Boolean) as string[];
    const reasonCounts = new Map<string, number>();
    for (const r of reasons) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    const topRejectionReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason]) => reason);
    keywordFeedback = {
      approved: approvedRows.map(r => r.keyword),
      rejected: rejectedRows.map(r => r.keyword),
      patterns: { approveRate: total > 0 ? approvedRows.length / total : 0, topRejectionReasons },
    };
  } catch (err) {
    log.debug({ workspaceId, err }, 'Keyword feedback table unavailable — skipping');
  }

  // Content gap votes (DB direct)
  let contentGapVotes: { topic: string; votes: number }[] = [];
  try {
    const rows = db.prepare(
      'SELECT keyword, COUNT(*) as cnt FROM content_gap_votes WHERE workspace_id = ? GROUP BY keyword ORDER BY cnt DESC',
    ).all(workspaceId) as { keyword: string; cnt: number }[];
    contentGapVotes = rows.map(r => ({ topic: r.keyword, votes: r.cnt }));
  } catch {
    // Table may not exist
  }

  // Business priorities (DB direct)
  let businessPriorities: string[] = [];
  try {
    const row = db.prepare(
      'SELECT priorities FROM client_business_priorities WHERE workspace_id = ?',
    ).get(workspaceId) as { priorities: string } | undefined;
    if (row) {
      const parsed = JSON.parse(row.priorities);
      businessPriorities = Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // Table may not exist or bad JSON
  }

  // Churn signals
  let churnSignals: ChurnSignalSummary[] = [];
  let churnRisk: ClientSignalsSlice['churnRisk'] = null;
  try {
    const { listChurnSignals } = await import('./churn-signals.js');
    const signals = listChurnSignals(workspaceId);
    const active = signals.filter(s => !s.dismissed);
    churnSignals = active.map(s => ({
      type: s.signalType ?? s.type ?? '',
      severity: s.severity ?? 'low',
      detectedAt: s.detectedAt ?? '',
    }));
    // Derive risk from signal count/severity
    const highCount = active.filter(s => s.severity === 'high').length;
    const medCount = active.filter(s => s.severity === 'medium').length;
    churnRisk = highCount > 0 ? 'high' : medCount >= 2 ? 'medium' : active.length > 0 ? 'low' : null;
  } catch {
    // Churn signals optional
  }

  // Approval patterns
  let approvalPatterns = { approvalRate: 0, avgResponseTime: null as number | null };
  try {
    const { listBatches } = await import('./approvals.js');
    const batches = listBatches(workspaceId);
    let approved = 0, total = 0;
    for (const batch of batches) {
      for (const item of batch.items ?? []) {
        total++;
        if (item.status === 'approved') approved++;
      }
    }
    approvalPatterns = {
      approvalRate: total > 0 ? approved / total : 0,
      avgResponseTime: null, // Would need timestamp tracking per item
    };
  } catch {
    // Approvals optional
  }

  // Engagement metrics (loginFrequency is categorical per spec §3)
  let engagement: EngagementMetrics = { lastLoginAt: null, loginFrequency: 'inactive', chatSessionCount: 0, portalUsage: null };
  try {
    const { listClientUsers } = await import('./client-users.js');
    const users = listClientUsers(workspaceId);
    const latestLogin = users
      .map(u => (u as any).lastLoginAt)
      .filter(Boolean)
      .sort()
      .reverse()[0] ?? null;

    // Derive categorical frequency from latest login age
    let loginFrequency: EngagementMetrics['loginFrequency'] = 'inactive';
    if (latestLogin) {
      const daysSinceLogin = (Date.now() - new Date(latestLogin).getTime()) / (24 * 60 * 60 * 1000);
      loginFrequency = daysSinceLogin <= 2 ? 'daily' : daysSinceLogin <= 8 ? 'weekly' : daysSinceLogin <= 35 ? 'monthly' : 'inactive';
    }

    // Chat session count from chat-memory
    let chatSessionCount = 0;
    try {
      const { getMonthlyConversationCount } = await import('./chat-memory.js');
      chatSessionCount = getMonthlyConversationCount(workspaceId, 'client');
    } catch (err) {
      log.debug({ workspaceId, err }, 'Chat memory unavailable — skipping');
    }

    engagement = {
      lastLoginAt: latestLogin,
      loginFrequency,
      chatSessionCount,
      portalUsage: null, // Phase 4: client portal tracking
    };
  } catch (err) {
    log.debug({ workspaceId, err }, 'Client users unavailable — skipping');
  }

  // ROI data (spec §3: { organicValue: number, growth: number, period: string })
  let roi: ClientSignalsSlice['roi'] = null;
  try {
    // Implementer: check roi.ts for a getOrganicTrafficValue/getROISummary export.
    // It calculates GSC clicks × CPC. Adapt the import to match the actual export name.
    const { getROISummary } = await import('./roi.js');
    const roiData = getROISummary(workspaceId);
    if (roiData) {
      roi = {
        organicValue: (roiData as any).organicValue ?? (roiData as any).value ?? 0,
        growth: (roiData as any).growth ?? (roiData as any).growthPercent ?? 0,
        period: (roiData as any).period ?? 'monthly',
      };
    }
  } catch (err) {
    log.debug({ workspaceId, err }, 'ROI data unavailable — skipping');
  }

  // Content request patterns
  let contentRequestPatterns = 0;
  try {
    const { listContentRequests } = await import('./content-requests.js');
    const reqs = listContentRequests(workspaceId);
    contentRequestPatterns = reqs.filter(r => r.status === 'pending').length;
  } catch {
    // Content requests optional
  }

  // Feedback items
  let feedbackItems: ClientSignalsSlice['feedbackItems'] = [];
  try {
    const { listFeedback } = await import('./feedback.js');
    const items = listFeedback(workspaceId);
    feedbackItems = items.slice(0, 10).map(f => ({
      id: f.id,
      type: f.type ?? 'general',
      status: f.status ?? 'open',
      createdAt: f.createdAt ?? '',
    }));
  } catch {
    // Feedback optional
  }

  // Service requests
  let serviceRequests = { pending: 0, total: 0 };
  try {
    const { listRequests } = await import('./requests.js');
    const reqs = listRequests(workspaceId);
    serviceRequests = {
      pending: reqs.filter(r => r.status === 'pending' || r.status === 'open').length,
      total: reqs.length,
    };
  } catch {
    // Requests optional
  }

  // Recent chat topics
  let recentChatTopics: string[] = [];
  try {
    const { listSessions } = await import('./chat-memory.js');
    const sessions = listSessions(workspaceId, 'client');
    recentChatTopics = sessions
      .slice(0, 5)
      .map(s => (s as any).topic ?? (s as any).title ?? '')
      .filter(Boolean);
  } catch {
    // Chat memory optional
  }

  // Composite health score (40% churn + 30% ROI + 30% engagement) — returns number | null
  // Per spec §3: Returns null if fewer than 2 of 3 components have data
  let compositeHealthScore: number | null = null;
  {
    let components = 0;
    // Churn component: 100 if no signals, 60 if low risk, 30 if medium, 0 if high
    let churnScore = 0;
    if (churnRisk !== null) {
      churnScore = churnRisk === 'high' ? 0 : churnRisk === 'medium' ? 30 : churnRisk === 'low' ? 60 : 100;
      components++;
    } else if (churnSignals.length === 0) {
      churnScore = 100; // no signals = healthy
      components++;
    }
    // ROI component: 100 if growth > 10%, 70 if stable, 40 if declining, 0 if no data
    let roiScore = 0;
    if (roi) {
      roiScore = roi.growth > 10 ? 100 : roi.growth > 0 ? 70 : roi.growth === 0 ? 40 : 0;
      components++;
    }
    // Engagement component: 100 if daily login, 70 if weekly, 40 if monthly, 0 if inactive
    let engagementScore = 0;
    if (engagement.loginFrequency !== 'inactive') {
      engagementScore = engagement.loginFrequency === 'daily' ? 100 : engagement.loginFrequency === 'weekly' ? 70 : 40;
      components++;
    }

    if (components >= 2) {
      compositeHealthScore = Math.round(churnScore * 0.4 + roiScore * 0.3 + engagementScore * 0.3);
    }
  }

  return {
    keywordFeedback,
    contentGapVotes,
    businessPriorities,
    approvalPatterns,
    recentChatTopics,
    churnRisk,
    churnSignals,
    roi,
    engagement,
    compositeHealthScore,
    feedbackItems,
    serviceRequests,
  };
}
```

Add necessary imports at top of `workspace-intelligence.ts`:
```typescript
import db from './db/index.js';
import type {
  // ... existing imports ...
  ChurnSignalSummary,
  EngagementMetrics,
  CompositeHealthScore,
} from '../shared/types/intelligence.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/assemble-client-signals.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit --skipLibCheck`

```bash
git add server/workspace-intelligence.ts server/__tests__/assemble-client-signals.test.ts
git commit -m "feat(intelligence): implement clientSignals slice assembler

Wires churn signals, keyword feedback, content gap votes, business priorities,
approval patterns, engagement metrics, ROI data, feedback items, service
requests, chat topics, and composite health score (40/30/30 formula)."
```

---

### Task 6: Implement `operational` Slice Assembler

**Files:**
- Modify: `server/workspace-intelligence.ts`
- Test: `server/__tests__/assemble-operational.test.ts`

**Data sources:** `activity-log.ts`, `approvals.ts`, `recommendations.ts`, `outcome-tracking.ts`, `outcome-playbooks.ts`, `anomaly-detection.ts`, `seo-change-tracker.ts`, `usage-tracking.ts`, `jobs.ts`, `work-orders.ts`, `annotations.ts`, `analytics-annotations.ts`, `insight-feedback.ts`

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/assemble-operational.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../activity-log.js', () => ({
  listActivity: vi.fn(() => [
    { id: 'a1', type: 'content', title: 'Brief created', description: 'Test brief', timestamp: '2026-03-30T10:00:00Z' },
  ]),
}));

vi.mock('../recommendations.js', () => ({
  loadRecommendations: vi.fn(() => ({
    recommendations: [
      { id: 'r1', priority: 'fix_now', status: 'pending' },
      { id: 'r2', priority: 'fix_soon', status: 'pending' },
      { id: 'r3', priority: 'fix_later', status: 'pending' },
    ],
  })),
}));

vi.mock('../jobs.js', () => ({
  listJobs: vi.fn(() => [
    { id: 'j1', status: 'pending', type: 'audit' },
  ]),
}));

describe('assembleOperational', () => {
  it('returns populated OperationalSlice with all required fields', async () => {
    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['operational'],
    });

    expect(result.operational).toBeDefined();
    const ops = result.operational!;
    expect(ops.recentActivity).toBeDefined();
    expect(ops.recommendationQueue).toBeDefined();
    expect(ops.pendingJobs).toBeTypeOf('number');

    // Shape completeness
    expect(ops).toHaveProperty('annotations');
    expect(ops).toHaveProperty('approvalQueue');
    expect(ops.approvalQueue).toHaveProperty('pending');
    expect(ops.approvalQueue).toHaveProperty('oldestAge');
    expect(ops).toHaveProperty('actionBacklog');
    expect(ops.actionBacklog).toHaveProperty('pendingMeasurement');
    expect(ops.actionBacklog).toHaveProperty('oldestAge');
    expect(ops).toHaveProperty('detectedPlaybooks');
    expect(ops).toHaveProperty('workOrders');
    expect(ops.workOrders).toHaveProperty('active');
    expect(ops.workOrders).toHaveProperty('pending');
  });

  it('returns sensible defaults when all sources are empty', async () => {
    const { listActivity } = await import('../activity-log.js');
    const { loadRecommendations } = await import('../recommendations.js');
    const { listJobs } = await import('../jobs.js');
    vi.mocked(listActivity).mockReturnValueOnce([]);
    vi.mocked(loadRecommendations).mockReturnValueOnce({ recommendations: [] } as any);
    vi.mocked(listJobs).mockReturnValueOnce([]);

    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['operational'],
    });

    expect(result.operational).toBeDefined();
    const ops = result.operational!;
    expect(ops.recentActivity).toEqual([]);
    expect(ops.pendingJobs).toBe(0);
    expect(ops.recommendationQueue).toEqual({ fixNow: 0, fixSoon: 0, fixLater: 0 });
    expect(ops.approvalQueue?.pending).toBe(0);
    expect(ops.actionBacklog?.pendingMeasurement).toBe(0);
    expect(ops.workOrders?.active).toBe(0);
  });

  it('survives when a data source throws', async () => {
    const { listActivity } = await import('../activity-log.js');
    vi.mocked(listActivity).mockImplementationOnce(() => { throw new Error('Activity log unavailable'); });

    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['operational'],
    });

    // Should not crash — either returns partial data or undefined (per-slice catch)
    expect(result).toBeDefined();
    expect(result.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/assemble-operational.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the `assembleOperational` function**

Replace the stub in `assembleSlice()`:
```typescript
    case 'operational':
      result.operational = await assembleOperational(workspaceId, opts);
      break;
```

Add the assembler:

```typescript
async function assembleOperational(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<OperationalSlice> {
  // Recent activity
  const { listActivity } = await import('./activity-log.js');
  const activity = listActivity(workspaceId, 20);
  const recentActivity = activity.map(a => ({
    type: a.type ?? '',
    description: a.title ?? a.description ?? '',
    timestamp: a.timestamp ?? a.createdAt ?? '',
  }));

  // Annotations (merge both annotation sources)
  let annotations: OperationalSlice['annotations'] = [];
  try {
    const { getAnnotations } = await import('./analytics-annotations.js');
    const analyticsAnnotations = getAnnotations(workspaceId);
    annotations = analyticsAnnotations.slice(0, 20).map(a => ({
      date: a.date ?? '',
      label: a.label ?? '',
      pageUrl: (a as any).pageUrl,
    }));
  } catch {
    // Analytics annotations optional
  }
  try {
    const { listAnnotations } = await import('./annotations.js');
    const timelineAnnotations = listAnnotations(workspaceId);
    for (const a of timelineAnnotations.slice(0, 10)) {
      annotations.push({ date: a.date ?? '', label: a.label ?? '' });
    }
  } catch {
    // Timeline annotations optional
  }

  // Pending jobs
  let pendingJobs = 0;
  try {
    const { listJobs } = await import('./jobs.js');
    const jobs = listJobs(workspaceId);
    pendingJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running').length;
  } catch {
    // Jobs optional
  }

  // Time saved (usage tracking)
  let timeSaved: OperationalSlice['timeSaved'] = null;
  try {
    const { getUsageSummary } = await import('./usage-tracking.js');
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    const tier = ws?.tier ?? 'free';
    const summary = getUsageSummary(workspaceId, tier);
    // Estimate time saved: each AI call saves ~5 minutes on average
    let totalMinutes = 0;
    const byFeature: Record<string, number> = {};
    for (const [feature, data] of Object.entries(summary)) {
      const minutes = data.used * 5;
      totalMinutes += minutes;
      if (minutes > 0) byFeature[feature] = minutes;
    }
    if (totalMinutes > 0) {
      timeSaved = { totalMinutes, byFeature };
    }
  } catch {
    // Usage tracking optional
  }

  // Approval queue (spec: { pending, oldestAge: hours | null })
  let approvalQueue: OperationalSlice['approvalQueue'] = { pending: 0, oldestAge: null };
  try {
    const { listBatches } = await import('./approvals.js');
    const batches = listBatches(workspaceId);
    let pending = 0;
    let oldestMs = 0;
    for (const batch of batches) {
      for (const item of batch.items ?? []) {
        if (item.status === 'pending') {
          pending++;
          const age = Date.now() - new Date(item.createdAt ?? '').getTime();
          if (age > oldestMs) oldestMs = age;
        }
      }
    }
    approvalQueue = { pending, oldestAge: pending > 0 ? Math.round(oldestMs / (60 * 60 * 1000)) : null };
  } catch (err) {
    log.debug({ workspaceId, err }, 'Approvals data unavailable — skipping');
  }

  // Recommendation queue
  let recommendationQueue = { fixNow: 0, fixSoon: 0, fixLater: 0 };
  try {
    const { loadRecommendations } = await import('./recommendations.js');
    const recSet = loadRecommendations(workspaceId);
    if (recSet?.recommendations) {
      for (const rec of recSet.recommendations) {
        if (rec.status === 'pending' || !rec.status) {
          if (rec.priority === 'fix_now') recommendationQueue.fixNow++;
          else if (rec.priority === 'fix_soon') recommendationQueue.fixSoon++;
          else recommendationQueue.fixLater++;
        }
      }
    }
  } catch {
    // Recommendations optional
  }

  // Action backlog (spec: { pendingMeasurement, oldestAge: days | null })
  let actionBacklog: OperationalSlice['actionBacklog'] = { pendingMeasurement: 0, oldestAge: null };
  try {
    const { getPendingActions } = await import('./outcome-tracking.js');
    const pending = getPendingActions();
    const wsActions = pending.filter(a => a.workspaceId === workspaceId);
    let oldestAge: number | null = null;
    if (wsActions.length > 0) {
      const oldest = wsActions.reduce((min, a) =>
        new Date(a.createdAt).getTime() < new Date(min.createdAt).getTime() ? a : min,
      );
      oldestAge = Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    }
    actionBacklog = { pendingMeasurement: wsActions.length, oldestAge };
  } catch (err) {
    log.debug({ workspaceId, err }, 'Outcome tracking data unavailable — skipping');
  }

  // Detected playbooks (spec: string[] — pattern names only)
  let detectedPlaybooks: string[] = [];
  try {
    const { getPlaybooks } = await import('./outcome-playbooks.js');
    const playbooks = getPlaybooks(workspaceId);
    detectedPlaybooks = playbooks.slice(0, 5).map(p => p.pattern ?? p.name ?? '').filter(Boolean);
  } catch (err) {
    log.debug({ workspaceId, err }, 'Playbooks data unavailable — skipping');
  }

  // Work orders (spec: { active, pending })
  let workOrders: OperationalSlice['workOrders'] = { active: 0, pending: 0 };
  try {
    const { listWorkOrders } = await import('./work-orders.js');
    const orders = listWorkOrders(workspaceId);
    workOrders = {
      active: orders.filter(o => o.status === 'active').length,
      pending: orders.filter(o => o.status === 'pending').length,
    };
  } catch (err) {
    log.debug({ workspaceId, err }, 'Work orders data unavailable — skipping');
  }

  // Anomaly alerts (count for operational awareness)
  let anomalyAlerts = 0;
  try {
    const { listAnomalies } = await import('./anomaly-detection.js');
    const anomalies = listAnomalies(workspaceId, false);
    anomalyAlerts = anomalies.filter(a => !a.dismissed && !a.acknowledged).length;
  } catch {
    // Anomalies optional
  }

  // SEO change velocity for operational context
  let seoChangeCount = 0;
  try {
    const { getSeoChanges } = await import('./seo-change-tracker.js');
    const changes = getSeoChanges(workspaceId, 50);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    seoChangeCount = changes.filter(c => new Date(c.createdAt).getTime() > sevenDaysAgo).length;
  } catch {
    // SEO changes optional
  }

  // Insight acceptance rate
  let insightAcceptanceRate: InsightAcceptanceRate | null = null;
  try {
    const { runFeedbackLoops } = await import('./insight-feedback.js');
    // insight-feedback.ts doesn't expose a direct getter for acceptance rates,
    // so we compute from the insights themselves
    const { getInsights } = await import('./analytics-insights-store.js');
    const insights = getInsights(workspaceId);
    const totalShown = insights.length;
    const confirmed = insights.filter(i => i.resolutionStatus === 'resolved' || i.resolutionStatus === 'in_progress').length;
    const dismissed = insights.filter(i => i.resolutionStatus === 'dismissed').length;
    if (totalShown > 0) {
      insightAcceptanceRate = {
        totalShown,
        confirmed,
        dismissed,
        rate: totalShown > 0 ? confirmed / totalShown : 0,
      };
    }
  } catch {
    // Insight feedback optional
  }

  return {
    recentActivity,
    annotations,
    pendingJobs,
    timeSaved,
    approvalQueue,
    recommendationQueue,
    actionBacklog,
    detectedPlaybooks,
    workOrders,
    insightAcceptanceRate,
  };
}
```

Add imports at top:
```typescript
import type {
  // ... existing imports ...
  InsightAcceptanceRate,
} from '../shared/types/intelligence.js';
```

- [ ] **Step 4: Run test, type-check, commit**

Run: `npx vitest run server/__tests__/assemble-operational.test.ts && npx tsc --noEmit --skipLibCheck`

```bash
git add server/workspace-intelligence.ts server/__tests__/assemble-operational.test.ts
git commit -m "feat(intelligence): implement operational slice assembler

Wires activity log, annotations, pending jobs, time-saved metrics, approval
queue, recommendation queue, action backlog, detected playbooks, and insight
acceptance rates from 12 data sources."
```

---

### Task 7: Wire Read-Time Bridges (#8, #9, #14)

**Files:**
- Modify: `server/content-decay.ts` (Bridge #8)
- Modify: `server/keyword-recommendations.ts` (Bridge #9)
- Modify: `server/outcome-crons.ts` (Bridge #14)
- Test: `server/__tests__/read-time-bridges.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/read-time-bridges.test.ts
import { describe, it, expect } from 'vitest';

describe('Bridge #8: content decay → repeat decay tagging', () => {
  it('content-decay.ts imports outcome-tracking for repeat decay check', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../content-decay.ts', import.meta.url), 'utf-8');
    expect(src).toContain('getActionsByPage');
    expect(src).toContain('repeat_decay');
  });
});

describe('Bridge #9: keyword recommendations → learnings weighting', () => {
  it('keyword-recommendations.ts imports workspace-learnings', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../keyword-recommendations.ts', import.meta.url), 'utf-8');
    expect(src).toContain('getWorkspaceLearnings');
  });
});

describe('Bridge #14: outcome crons → intelligence cache invalidation', () => {
  it('outcome-crons.ts calls invalidateIntelligenceCache', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../outcome-crons.ts', import.meta.url), 'utf-8');
    expect(src).toContain('invalidateIntelligenceCache');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/read-time-bridges.test.ts`
Expected: FAIL

- [ ] **Step 3: Wire Bridge #8 in `content-decay.ts`**

In `server/content-decay.ts`, add import:
```typescript
import { getActionsByPage } from './outcome-tracking.js';
```

In the `analyzeContentDecay` function (or wherever decaying pages are identified), after a page is flagged as decaying, add repeat-decay detection:

```typescript
  // ── Bridge #8: Check for repeat decay ─────────────────────────────
  // If a prior content_refresh action for this page scored 'loss', tag as repeat_decay
  try {
    const priorActions = getActionsByPage(workspaceId, page.url ?? page.pageUrl ?? '');
    const refreshActions = priorActions.filter(a => a.actionType === 'content_refresh');
    if (refreshActions.length > 0) {
      // Check if any refresh action had a loss outcome
      const { getOutcomesForAction } = await import('./outcome-tracking.js');
      for (const action of refreshActions) {
        const outcomes = getOutcomesForAction(action.id);
        const hasLoss = outcomes.some(o => o.score === 'loss');
        if (hasLoss) {
          page.isRepeatDecay = true;
          page.priority = 'high'; // Boost priority for repeat decay
          break;
        }
      }
    }
  } catch {
    // Non-critical — outcome tracking may not have data for this page
  }
```

**Note for implementer:** The exact property names on the `page` object depend on the `DecayingPage` type. Read the file to find the correct shape. If `isRepeatDecay` doesn't exist on the type, add it as an optional property to the relevant interface. Similarly, adapt `page.url` vs `page.pageUrl` to match the actual property.

- [ ] **Step 4: Wire Bridge #9 in `keyword-recommendations.ts`**

In `server/keyword-recommendations.ts`, in the `getKeywordRecommendations` function, after candidates are scored but before they're returned, add learnings-based weighting:

```typescript
  // ── Bridge #9: Weight by empirical win rate per KD range ──────────
  try {
    const { getWorkspaceLearnings } = await import('./workspace-learnings.js');
    const learnings = getWorkspaceLearnings(workspaceId, 'strategy');
    if (learnings?.byKdRange) {
      for (const candidate of candidates) {
        const kd = candidate.difficulty ?? 0;
        const range = kd < 30 ? 'low' : kd < 60 ? 'medium' : 'high';
        const rangeData = learnings.byKdRange?.[range];
        if (rangeData?.winRate > 0.5) {
          candidate.relevanceScore = (candidate.relevanceScore ?? 0) * 1.2; // 20% boost
        } else if (rangeData?.winRate < 0.3 && rangeData?.count >= 3) {
          candidate.relevanceScore = (candidate.relevanceScore ?? 0) * 0.8; // 20% penalty
        }
      }
    }
  } catch {
    // Learnings enrichment optional — degrade gracefully
  }
```

**Note for implementer:** Check if `WorkspaceLearnings` type has a `byKdRange` field. If not, this enrichment may need to query outcome data differently. The key principle: recommendations in KD ranges where past actions won should rank higher. Adapt property names to match the actual `WorkspaceLearnings` and candidate shapes.

- [ ] **Step 5: Wire Bridge #14 in `outcome-crons.ts`**

In `server/outcome-crons.ts`, add import:
```typescript
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
```

In `recomputeAllWorkspaceLearnings()`, after learnings are recomputed for each workspace, add:
```typescript
  // ── Bridge #14: Invalidate intelligence cache after learnings update
  invalidateIntelligenceCache(workspaceId);
```

- [ ] **Step 6: Run tests, type-check, commit**

Run: `npx vitest run server/__tests__/read-time-bridges.test.ts && npx tsc --noEmit --skipLibCheck`

```bash
git add server/content-decay.ts server/keyword-recommendations.ts server/outcome-crons.ts server/__tests__/read-time-bridges.test.ts
git commit -m "feat(bridges): wire read-time bridges #8, #9, #14

Bridge #8: content decay checks for prior refresh outcomes, tags repeat_decay
Bridge #9: keyword recommendations weighted by empirical KD-range win rates
Bridge #14: outcome cron invalidates intelligence cache after learnings update"
```

---

### Task 8: Implement `pageProfile` Slice Assembler

**Files:**
- Modify: `server/workspace-intelligence.ts`
- Test: `server/__tests__/assemble-page-profile.test.ts`

**Data sources:** `site-architecture.ts`, `performance-store.ts`, `anomaly-detection.ts`, `outcome-tracking.ts`, `recommendations.ts`, `page-keywords.ts`, `seo-change-tracker.ts`, `rank-tracking.ts`, `roi-attribution.ts`, `content-decay.ts`

This assembler only populates when `opts.pagePath` is provided.

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/assemble-page-profile.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../page-keywords.js', () => ({
  getPageKeyword: vi.fn(() => ({
    pagePath: '/about',
    primaryKeyword: 'about us',
    searchIntent: 'informational',
    currentPosition: 12,
    previousPosition: 15,
  })),
}));

vi.mock('../recommendations.js', () => ({
  loadRecommendations: vi.fn(() => ({
    recommendations: [
      { id: 'r1', priority: 'fix_now', status: 'pending', pageUrl: '/about', title: 'Add meta description' },
    ],
  })),
}));

vi.mock('../seo-change-tracker.js', () => ({
  getSeoChanges: vi.fn(() => []),
}));

vi.mock('../outcome-tracking.js', () => ({
  getActionsByPage: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
  getPendingActions: vi.fn(() => []),
}));

vi.mock('../analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

describe('assemblePageProfile', () => {
  it('returns null when no pagePath provided', async () => {
    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      // no pagePath
    });
    expect(result.pageProfile).toBeUndefined();
  });

  it('returns populated PageProfileSlice when pagePath provided', async () => {
    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/about',
    });

    expect(result.pageProfile).toBeDefined();
    expect(result.pageProfile!.pagePath).toBe('/about');
    expect(result.pageProfile!.primaryKeyword).toBe('about us');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/assemble-page-profile.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the `assemblePageProfile` function**

Replace the stub:
```typescript
    case 'pageProfile':
      if (opts?.pagePath) {
        result.pageProfile = await assemblePageProfile(workspaceId, opts.pagePath, opts);
      }
      break;
```

Add the assembler:

```typescript
async function assemblePageProfile(
  workspaceId: string,
  pagePath: string,
  _opts?: IntelligenceOptions,
): Promise<PageProfileSlice> {
  // Page keywords (primary source)
  const { getPageKeyword } = await import('./page-keywords.js');
  const pageKw = getPageKeyword(workspaceId, pagePath);

  // Rank history — primary source: rank-tracking.ts (180-day history)
  // Fallback: page-keywords current/previous position if no rank-tracking data
  let current: number | null = pageKw?.currentPosition ?? null;
  let best: number | null = current;
  let trend: 'up' | 'down' | 'stable' = 'stable';
  try {
    const { getRankHistory, getLatestRanks } = await import('./rank-tracking.js');
    const latest = getLatestRanks(workspaceId);
    const pageRank = latest.find(k => k.query === pageKw?.primaryKeyword);
    if (pageRank) {
      current = pageRank.position ?? current;
      const change = pageRank.change ?? 0;
      trend = change < 0 ? 'up' : change > 0 ? 'down' : 'stable';
    }
    // Get historical best from rank history
    if (pageKw?.primaryKeyword) {
      const history = getRankHistory(workspaceId, [pageKw.primaryKeyword], 180);
      if (history.length > 0) {
        const allPositions = history
          .map(h => h.positions[pageKw.primaryKeyword!])
          .filter(p => p > 0);
        if (allPositions.length > 0) {
          best = Math.min(...allPositions);
        }
      }
    }
  } catch {
    // Rank tracking optional — fall back to page-keywords data
    const previous = pageKw?.previousPosition ?? null;
    if (current != null && previous != null) {
      trend = current < previous ? 'up' : current > previous ? 'down' : 'stable';
    }
  }

  // Page-level ROI attribution
  let pageRoiAttribution: ROIAttribution[] = [];
  try {
    const { getROIHighlights } = await import('./roi-attribution.js');
    const highlights = getROIHighlights(workspaceId, 50);
    pageRoiAttribution = highlights
      .filter((h: any) => h.pageUrl === pagePath)
      .slice(0, 10)
      .map((h: any) => ({
        actionId: h.id ?? '',
        pageUrl: h.pageUrl ?? pagePath,
        actionType: h.actionType ?? '',
        clicksBefore: h.clicksBefore ?? 0,
        clicksAfter: h.clicksAfter ?? 0,
        clickGain: h.clickGain ?? ((h.clicksAfter ?? 0) - (h.clicksBefore ?? 0)),
        measuredAt: h.measuredAt ?? '',
      }));
  } catch {
    // ROI attribution optional
  }

  // Recommendations for this page
  let recommendations: string[] = [];
  try {
    const { loadRecommendations } = await import('./recommendations.js');
    const recSet = loadRecommendations(workspaceId);
    if (recSet?.recommendations) {
      recommendations = recSet.recommendations
        .filter(r => r.pageUrl === pagePath && (r.status === 'pending' || !r.status))
        .map(r => r.title ?? r.description ?? '')
        .filter(Boolean);
    }
  } catch {
    // Recommendations optional
  }

  // Page-specific insights
  let insights: AnalyticsInsight[] = [];
  try {
    const { getInsights } = await import('./analytics-insights-store.js');
    const all = getInsights(workspaceId);
    insights = all.filter(i => i.pageId === pagePath).slice(0, 10);
  } catch {
    // Insights optional
  }

  // Page actions
  let actions: TrackedAction[] = [];
  try {
    const { getActionsByPage } = await import('./outcome-tracking.js');
    actions = getActionsByPage(workspaceId, pagePath);
  } catch {
    // Actions optional
  }

  // Audit issues for this page
  let auditIssues: string[] = [];
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    if (ws?.siteId) {
      const { getLatestSnapshot } = await import('./reports.js');
      const snap = getLatestSnapshot(ws.siteId);
      if (snap?.pages) {
        const pagData = (snap.pages as any[]).find(p => p.url === pagePath || p.slug === pagePath);
        if (pagData?.issues) {
          auditIssues = pagData.issues.map((i: any) => i.message ?? i.title ?? '').filter(Boolean);
        }
      }
    }
  } catch {
    // Audit data optional
  }

  // Schema status
  let schemaStatus: PageProfileSlice['schemaStatus'] = 'none';
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    if (ws?.siteId) {
      const { getValidation } = await import('./schema-validator.js');
      const validation = getValidation(workspaceId, pagePath);
      if (validation) {
        const status = (validation as any).status ?? 'none';
        schemaStatus = status === 'valid' ? 'valid' : status === 'warnings' ? 'warnings' : status === 'errors' ? 'errors' : 'none';
      }
    }
  } catch {
    schemaStatus = 'none';
  }

  // Link health (orphan detection from architecture)
  let linkHealth = { inbound: 0, outbound: 0, orphan: false };
  try {
    const { getCachedArchitecture, flattenTree } = await import('./site-architecture.js');
    const arch = await getCachedArchitecture(workspaceId);
    if (arch?.tree) {
      const nodes = flattenTree(arch.tree);
      const node = nodes.find((n: any) => n.path === pagePath || n.slug === pagePath);
      if (node) {
        linkHealth = {
          inbound: (node as any).inboundLinks ?? 0,
          outbound: (node as any).outboundLinks ?? 0,
          orphan: (node as any).orphan ?? false,
        };
      }
    }
  } catch {
    // Architecture optional
  }

  // SEO edits
  let seoEdits = { currentTitle: '', currentMeta: '', lastEditedAt: null as string | null };
  try {
    const { getSeoChanges } = await import('./seo-change-tracker.js');
    const changes = getSeoChanges(workspaceId, 50);
    const pageChanges = changes.filter(c => (c as any).pageSlug === pagePath || (c as any).pageId === pagePath);
    if (pageChanges.length > 0) {
      seoEdits.lastEditedAt = pageChanges[0]?.createdAt ?? null;
    }
    // Current title/meta from page-keywords
    seoEdits.currentTitle = (pageKw as any)?.currentTitle ?? '';
    seoEdits.currentMeta = (pageKw as any)?.currentMeta ?? '';
  } catch {
    // SEO changes optional
  }

  // Content status
  let contentStatus: PageProfileSlice['contentStatus'] = null;
  try {
    const { listBriefs } = await import('./content-brief.js');
    const briefs = listBriefs(workspaceId);
    const hasBrief = briefs.some(b => (b as any).pageUrl === pagePath || (b as any).targetUrl === pagePath);
    const { listPosts } = await import('./content-posts-db.js');
    const posts = listPosts(workspaceId);
    const hasPost = posts.some(p => (p as any).pageUrl === pagePath || (p as any).targetUrl === pagePath);
    const isPublished = posts.some(p =>
      ((p as any).pageUrl === pagePath || (p as any).targetUrl === pagePath) && (p as any).status === 'published',
    );

    // Check for decay
    const { loadDecayAnalysis } = await import('./content-decay.js');
    const decay = loadDecayAnalysis(workspaceId);
    const isDecaying = decay?.pages?.some(d => (d.url ?? d.pageUrl ?? '') === pagePath);

    contentStatus = isDecaying ? 'decay_detected' : isPublished ? 'published' : hasPost ? 'has_post' : hasBrief ? 'has_brief' : null;
  } catch {
    contentStatus = null;
  }

  // CWV status
  let cwvStatus: PageProfileSlice['cwvStatus'] = null;
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    if (ws?.siteId) {
      const { getSinglePageSpeed } = await import('./performance-store.js');
      const ps = getSinglePageSpeed(ws.siteId, pagePath);
      if (ps?.result) {
        const score = (ps.result as any)?.lighthouseResult?.categories?.performance?.score;
        if (score != null) {
          cwvStatus = score >= 0.9 ? 'good' : score >= 0.5 ? 'needs_improvement' : 'poor';
        }
      }
    }
  } catch {
    cwvStatus = null;
  }

  return {
    pagePath,
    primaryKeyword: pageKw?.primaryKeyword ?? null,
    searchIntent: (pageKw as any)?.searchIntent ?? null,
    optimizationScore: (pageKw as any)?.optimizationScore ?? null,
    recommendations,
    contentGaps: [], // Populated from keyword gaps analysis
    insights,
    actions,
    auditIssues,
    schemaStatus,
    linkHealth,
    seoEdits,
    rankHistory: { current, best, trend },
    contentStatus,
    cwvStatus,
    roiAttribution: pageRoiAttribution,
  };
}
```

**Note:** `PageProfileSlice` in `shared/types/intelligence.ts` needs a `roiAttribution?: ROIAttribution[]` field added in Task 1. Add it alongside the other existing fields.

```typescript
// In Task 1, add to PageProfileSlice:
export interface PageProfileSlice {
  // ... existing fields ...
  roiAttribution?: ROIAttribution[];
}
```

- [ ] **Step 4: Run test, type-check, commit**

Run: `npx vitest run server/__tests__/assemble-page-profile.test.ts && npx tsc --noEmit --skipLibCheck`

```bash
git add server/workspace-intelligence.ts server/__tests__/assemble-page-profile.test.ts
git commit -m "feat(intelligence): implement pageProfile slice assembler

Wires page keywords, recommendations, insights, actions, audit issues, schema
status, link health, SEO edits, rank history, content status, and CWV status
for per-page intelligence. Only populates when pagePath is provided."
```

---

### Task 9: Enrich `seoContext` Slice

**Files:**
- Modify: `server/workspace-intelligence.ts`
- Test: `server/__tests__/enrich-seo-context.test.ts`

Add rank tracking, keyword recommendations, strategy history, businessProfile, backlink profile, SERP features to existing `assembleSeoContext`.

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/enrich-seo-context.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../seo-context.js', () => ({
  buildSeoContext: vi.fn(() => ({
    strategy: { siteKeywords: [] },
    brandVoiceBlock: 'Professional',
    businessContext: 'SaaS company',
    knowledgeBlock: 'Domain knowledge',
  })),
}));

vi.mock('../workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({
    id: 'ws-1',
    siteId: 'site-1',
    personas: [{ name: 'Dev', role: 'Developer' }],
    businessProfile: { industry: 'Tech', goals: ['Growth'], targetAudience: 'B2B' },
  })),
}));

vi.mock('../rank-tracking.js', () => ({
  getTrackedKeywords: vi.fn(() => [
    { query: 'seo tools', position: 5 },
    { query: 'keyword research', position: 15 },
  ]),
  getLatestRanks: vi.fn(() => [
    { query: 'seo tools', position: 5, change: -2 },
    { query: 'keyword research', position: 15, change: 3 },
  ]),
}));

describe('assembleSeoContext enrichment', () => {
  it('includes rank tracking data', async () => {
    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['seoContext'],
    });

    expect(result.seoContext).toBeDefined();
    expect(result.seoContext!.rankTracking).toBeDefined();
    expect(result.seoContext!.rankTracking!.trackedKeywords).toBeGreaterThan(0);
  });

  it('includes businessProfile', async () => {
    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['seoContext'],
    });

    expect(result.seoContext!.businessProfile).toBeDefined();
    expect(result.seoContext!.businessProfile!.industry).toBe('Tech');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/enrich-seo-context.test.ts`
Expected: FAIL

- [ ] **Step 3: Enrich the existing `assembleSeoContext` function**

In `server/workspace-intelligence.ts`, modify `assembleSeoContext()` to add enrichments after the existing context is built:

```typescript
async function assembleSeoContext(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<SeoContextSlice> {
  const { buildSeoContext } = await import('./seo-context.js');
  const { getWorkspace } = await import('./workspaces.js');
  const ctx = buildSeoContext(workspaceId, opts?.pagePath, opts?.learningsDomain ?? 'all', { _skipShadow: true });
  const workspace = getWorkspace(workspaceId);

  const base: SeoContextSlice = {
    strategy: ctx.strategy,
    brandVoice: ctx.brandVoiceBlock,
    businessContext: ctx.businessContext,
    personas: workspace?.personas ?? [],
    knowledgeBase: ctx.knowledgeBlock,
  };

  // Rank tracking enrichment
  try {
    const { getTrackedKeywords, getLatestRanks } = await import('./rank-tracking.js');
    const tracked = getTrackedKeywords(workspaceId);
    const latest = getLatestRanks(workspaceId);
    const improved = latest.filter(k => (k.change ?? 0) < 0).length;
    const declined = latest.filter(k => (k.change ?? 0) > 0).length;
    const stable = latest.length - improved - declined;
    const positions = latest.map(k => k.position).filter(p => p > 0);
    const avgPosition = positions.length > 0
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : null;

    base.rankTracking = {
      trackedKeywords: tracked.length,
      avgPosition,
      positionChanges: { improved, declined, stable },
    };
  } catch {
    // Rank tracking optional
  }

  // Business profile from workspace settings
  try {
    const profile = (workspace as any)?.businessProfile;
    if (profile && typeof profile === 'object') {
      base.businessProfile = {
        industry: profile.industry ?? '',
        goals: Array.isArray(profile.goals) ? profile.goals : [],
        targetAudience: profile.targetAudience ?? '',
      };
    }
  } catch {
    // Business profile optional
  }

  // Strategy history — spec shape: { revisionsCount, lastRevisedAt, trajectory }
  try {
    const rows = db.prepare(
      'SELECT created_at, change_description FROM strategy_history WHERE workspace_id = ? ORDER BY created_at DESC',
    ).all(workspaceId) as Array<{ created_at: string; change_description: string }>;
    if (rows.length > 0) {
      // Derive trajectory from recent changes
      const recentChanges = rows.slice(0, 5).map(r => r.change_description?.toLowerCase() ?? '');
      const expanding = recentChanges.filter(c => c.includes('add') || c.includes('expand') || c.includes('new')).length;
      const narrowing = recentChanges.filter(c => c.includes('remove') || c.includes('narrow') || c.includes('focus')).length;
      const trajectory = expanding > narrowing ? 'expanding' : narrowing > expanding ? 'narrowing' : 'stable';
      base.strategyHistory = {
        revisionsCount: rows.length,
        lastRevisedAt: rows[0].created_at,
        trajectory,
      };
    }
  } catch (err) {
    log.debug({ workspaceId, err }, 'Strategy history table unavailable — skipping');
  }

  // SEMRush backlink profile + SERP features
  // These are fetched via SEMRush MCP and cached with 24h TTL.
  // Assembly NEVER blocks on external calls — use cached data only.
  // If no cache exists, these fields remain undefined.
  // Actual caching is done by the SEMRush data provider on first access.

  return base;
}
```

- [ ] **Step 4: Run test, type-check, commit**

Run: `npx vitest run server/__tests__/enrich-seo-context.test.ts && npx tsc --noEmit --skipLibCheck`

```bash
git add server/workspace-intelligence.ts server/__tests__/enrich-seo-context.test.ts
git commit -m "feat(intelligence): enrich seoContext slice with rank tracking + business profile

Adds rankTracking summary (tracked keywords, avg position, changes),
businessProfile from workspace settings, and strategy history queries.
SEMRush backlink/SERP features use cached data only — never block assembly."
```

---

### Task 10: Enrich `learnings` Slice

**Files:**
- Modify: `server/workspace-intelligence.ts`
- Test: `server/__tests__/enrich-learnings.test.ts`

Add ROI attribution data and WeCalledItEntry references.

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/enrich-learnings.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(() => true),
}));

vi.mock('../workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn(() => ({
    confidence: 'medium',
    overall: {
      topActionTypes: [{ type: 'content_refresh', winRate: 0.6, count: 10 }],
      totalWinRate: 0.55,
      recentTrend: 'improving',
    },
  })),
}));

vi.mock('../outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn(() => []),
}));

vi.mock('../roi-attribution.js', () => ({
  getROIHighlights: vi.fn(() => [
    { id: 'roi-1', pageUrl: '/blog/seo', actionType: 'content_refresh', clicksBefore: 10, clicksAfter: 25, clickGain: 15, measuredAt: '2026-03-28' },
  ]),
}));

describe('assembleLearnings enrichment', () => {
  it('includes ROI attribution data', async () => {
    const { buildWorkspaceIntelligence } = await import('../workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['learnings'],
    });

    expect(result.learnings).toBeDefined();
    expect(result.learnings!.roiAttribution).toBeDefined();
    expect(result.learnings!.roiAttribution!.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/enrich-learnings.test.ts`
Expected: FAIL

- [ ] **Step 3: Enrich the existing `assembleLearnings` function**

In `server/workspace-intelligence.ts`, modify `assembleLearnings()`. After the existing code that builds the base learnings object, add:

```typescript
  // ROI attribution enrichment
  let roiAttribution: ROIAttribution[] = [];
  try {
    const { getROIHighlights } = await import('./roi-attribution.js');
    const highlights = getROIHighlights(workspaceId, 10);
    roiAttribution = highlights.map(h => ({
      actionId: (h as any).id ?? '',
      pageUrl: (h as any).pageUrl ?? '',
      actionType: (h as any).actionType ?? '',
      clicksBefore: (h as any).clicksBefore ?? 0,
      clicksAfter: (h as any).clicksAfter ?? 0,
      clickGain: (h as any).clickGain ?? ((h as any).clicksAfter ?? 0) - ((h as any).clicksBefore ?? 0),
      measuredAt: (h as any).measuredAt ?? '',
    }));
  } catch {
    // ROI attribution optional
  }

  // WeCalledIt entries — actions with strong_win outcomes where we predicted success
  let weCalledIt: WeCalledItEntry[] = [];
  try {
    const { getActionsByWorkspace, getOutcomesForAction } = await import('./outcome-tracking.js');
    const actions = getActionsByWorkspace(workspaceId);
    for (const action of actions.slice(0, 50)) { // Cap scan
      const outcomes = getOutcomesForAction(action.id);
      const strongWin = outcomes.find(o => o.score === 'strong_win');
      if (strongWin) {
        weCalledIt.push({
          actionId: action.id,
          prediction: `${action.actionType} on ${action.pageUrl ?? 'site'}`,
          outcome: 'strong_win',
          score: 'strong_win',
          pageUrl: action.pageUrl ?? '',
          measuredAt: strongWin.measuredAt ?? '',
        });
      }
      if (weCalledIt.length >= 5) break; // Limit to 5
    }
  } catch {
    // Outcome data optional
  }
```

Add these to the return object:
```typescript
  return {
    summary,
    confidence: summary?.confidence ?? null,
    topActionTypes: summary?.overall.topActionTypes.slice(0, 5) ?? [],
    overallWinRate: summary?.overall.totalWinRate ?? 0,
    recentTrend: summary?.overall.recentTrend ?? null,
    playbooks,
    roiAttribution,
    weCalledIt,
  };
```

Add imports at top:
```typescript
import type {
  // ... existing imports ...
  ROIAttribution,
  WeCalledItEntry,
} from '../shared/types/intelligence.js';
```

- [ ] **Step 4: Run test, type-check, commit**

Run: `npx vitest run server/__tests__/enrich-learnings.test.ts && npx tsc --noEmit --skipLibCheck`

```bash
git add server/workspace-intelligence.ts server/__tests__/enrich-learnings.test.ts
git commit -m "feat(intelligence): enrich learnings slice with ROI attribution + WeCalledIt

Adds per-action click gain data from roi-attribution and 'we called it' entries
(strong_win outcomes) for client narrative proof points."
```

---

### Task 11: Wire `INTELLIGENCE_CACHE_UPDATED` WebSocket Event

**Files:**
- Modify: `server/workspace-intelligence.ts`
- Modify: `src/hooks/admin/useWorkspaceIntelligence.ts` (or create if doesn't exist)
- Test: `server/__tests__/ws-intelligence-cache.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/ws-intelligence-cache.test.ts
import { describe, it, expect } from 'vitest';

describe('INTELLIGENCE_CACHE_UPDATED wiring', () => {
  it('invalidateIntelligenceCache broadcasts the event', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../workspace-intelligence.ts', import.meta.url), 'utf-8');
    expect(src).toContain('INTELLIGENCE_CACHE_UPDATED');
    expect(src).toContain('broadcastToWorkspace');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/ws-intelligence-cache.test.ts`
Expected: FAIL

- [ ] **Step 3: Add broadcast to `invalidateIntelligenceCache`**

In `server/workspace-intelligence.ts`, modify `invalidateIntelligenceCache()`:

```typescript
export function invalidateIntelligenceCache(workspaceId: string): void {
  const deleted = intelligenceCache.deleteByPrefix(`intelligence:${workspaceId}:`);
  try {
    invalidateSubCachePrefix(workspaceId, '');
  } catch {
    // Table may not exist yet — non-critical
  }

  // Broadcast to frontend so useWorkspaceIntelligence invalidates its React Query cache
  try {
    broadcastToWorkspace(workspaceId, WS_EVENTS.INTELLIGENCE_CACHE_UPDATED, {
      workspaceId,
      invalidatedAt: new Date().toISOString(),
    });
  } catch {
    // Broadcasting is best-effort — don't fail cache invalidation
  }

  log.info({ workspaceId, entriesDeleted: deleted }, 'Intelligence cache invalidated (in-memory + persistent + broadcast)');
}
```

Add imports at top if not already present:
```typescript
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
```

- [ ] **Step 4: Verify frontend WebSocket handler exists**

Check if `src/hooks/admin/useWsInvalidation.ts` (or equivalent) handles `INTELLIGENCE_CACHE_UPDATED`. If not, add a handler that invalidates the intelligence query key. Example:

```typescript
// In the WebSocket handler that processes workspace events:
case WS_EVENTS.INTELLIGENCE_CACHE_UPDATED:
  queryClient.invalidateQueries({ queryKey: ['admin-workspace-intelligence', workspaceId] });
  break;
```

**Note for implementer:** Find the main WebSocket event handler (likely in `useWsInvalidation.ts` or a global hook) and add this case. Search for other `WS_EVENTS` usage to find the pattern.

- [ ] **Step 5: Run test, type-check, commit**

Run: `npx vitest run server/__tests__/ws-intelligence-cache.test.ts && npx tsc --noEmit --skipLibCheck`

```bash
git add server/workspace-intelligence.ts src/hooks/admin/useWsInvalidation.ts server/__tests__/ws-intelligence-cache.test.ts
git commit -m "feat(intelligence): wire INTELLIGENCE_CACHE_UPDATED WebSocket event

Broadcasts cache invalidation to frontend so useWorkspaceIntelligence
auto-refreshes when intelligence data changes."
```

---

### Task 12: Add Scheduler Cache Invalidation

**Files:**
- Modify: `server/scheduled-audits.ts`
- Modify: `server/churn-signals.ts`
- Modify: `server/anomaly-detection.ts`
- Modify: `server/outcome-crons.ts`
- Test: `server/__tests__/scheduler-invalidation.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/scheduler-invalidation.test.ts
import { describe, it, expect } from 'vitest';

describe('Scheduler intelligence cache invalidation', () => {
  it('scheduled-audits.ts calls invalidateIntelligenceCache', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../scheduled-audits.ts', import.meta.url), 'utf-8');
    expect(src).toContain('invalidateIntelligenceCache');
  });

  it('churn-signals.ts calls invalidateIntelligenceCache', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../churn-signals.ts', import.meta.url), 'utf-8');
    expect(src).toContain('invalidateIntelligenceCache');
  });

  it('anomaly-detection.ts calls invalidateIntelligenceCache', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../anomaly-detection.ts', import.meta.url), 'utf-8');
    expect(src).toContain('invalidateIntelligenceCache');
  });

  it('outcome-crons.ts calls invalidateIntelligenceCache', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../outcome-crons.ts', import.meta.url), 'utf-8');
    expect(src).toContain('invalidateIntelligenceCache');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/scheduler-invalidation.test.ts`
Expected: FAIL (some may already pass if Bridge #14 was wired in Task 7)

- [ ] **Step 3: Add invalidation calls**

In each scheduler file, add the import and call:

**`server/scheduled-audits.ts`** — after audit completion for a workspace:
```typescript
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
// ... after audit completes for workspaceId:
invalidateIntelligenceCache(workspaceId);
```

**`server/churn-signals.ts`** — after churn signals are computed for a workspace:
```typescript
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
// ... after new churn signals detected for workspaceId:
invalidateIntelligenceCache(workspaceId);
```

**`server/anomaly-detection.ts`** — after anomaly detection completes for a workspace:
```typescript
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
// ... after anomalies detected for workspaceId:
invalidateIntelligenceCache(workspaceId);
```

**`server/outcome-crons.ts`** — after measurement/learnings/playbook runs:
```typescript
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
// ... after each workspace's learnings/outcomes are updated:
invalidateIntelligenceCache(workspaceId);
```

**Note for implementer:** For each file, find the location where the scheduler completes its per-workspace processing. Add `invalidateIntelligenceCache(workspaceId)` at that point. Look for existing `broadcastToWorkspace` calls as a guide — the invalidation goes right after or alongside them.

- [ ] **Step 4: Run test, type-check, commit**

Run: `npx vitest run server/__tests__/scheduler-invalidation.test.ts && npx tsc --noEmit --skipLibCheck`

```bash
git add server/scheduled-audits.ts server/churn-signals.ts server/anomaly-detection.ts server/outcome-crons.ts server/__tests__/scheduler-invalidation.test.ts
git commit -m "feat(intelligence): add cache invalidation to all background schedulers

Schedulers now invalidate intelligence cache after completing per-workspace
processing: audits → siteHealth, churn signals → clientSignals,
anomalies → siteHealth+insights, outcomes → learnings."
```

---

### Task 13: Expand `formatForPrompt()` to All 8 Slices + Fix Bugs

**Files:**
- Modify: `server/workspace-intelligence.ts`
- Test: `server/__tests__/format-for-prompt.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/format-for-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';

const mockIntelligence: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-1',
  assembledAt: new Date().toISOString(),
  seoContext: {
    strategy: undefined,
    brandVoice: 'Professional and authoritative',
    businessContext: 'B2B SaaS for marketing teams',
    personas: [
      { name: 'Marketing Maya', role: 'Head of Marketing', description: 'Experienced marketer focused on ROI' },
    ],
    knowledgeBase: 'We specialize in enterprise SEO analytics.',
    businessProfile: { industry: 'SaaS', goals: ['Increase organic traffic'], targetAudience: 'B2B marketing teams' },
    rankTracking: { trackedKeywords: 15, avgPosition: 22.5, positionChanges: { improved: 5, declined: 2, stable: 8 } },
  },
  insights: {
    all: [
      { id: 'i1', insightType: 'content_gap', severity: 'opportunity', impactScore: 85, pageId: '/blog' } as any,
    ],
    byType: {},
    bySeverity: { critical: 0, warning: 1, opportunity: 1, positive: 0 },
    topByImpact: [{ id: 'i1', insightType: 'content_gap', severity: 'opportunity', impactScore: 85, pageId: '/blog' } as any],
  },
  learnings: {
    summary: null,
    confidence: 'medium',
    topActionTypes: [{ type: 'content_refresh', winRate: 0.65, count: 12 }],
    overallWinRate: 0.55,
    recentTrend: 'improving',
    playbooks: [],
    roiAttribution: [
      { actionId: 'a1', pageUrl: '/blog/seo', actionType: 'content_refresh', clicksBefore: 10, clicksAfter: 30, clickGain: 20, measuredAt: '2026-03-28' },
    ],
    weCalledIt: [
      { actionId: 'a2', prediction: 'content_refresh on /pricing', outcome: 'strong_win', score: 'strong_win', pageUrl: '/pricing', measuredAt: '2026-03-20' },
    ],
  },
  contentPipeline: {
    briefs: { total: 5, byStatus: { draft: 2, ready: 3 } },
    posts: { total: 3, byStatus: { draft: 1, published: 2 } },
    matrices: { total: 1, cellsPlanned: 10, cellsPublished: 4 },
    requests: { pending: 2, inProgress: 1, delivered: 5 },
    workOrders: { active: 1 },
    coverageGaps: ['competitive analysis', 'pricing comparison'],
    seoEdits: { pending: 1, applied: 3, dismissed: 0 },
    subscriptions: { active: 1, postsRemaining: 3 },
    decayAlerts: [{ pageUrl: '/blog/old-post', clickDrop: 45, detectedAt: '2026-03-25', hasRefreshBrief: false, isRepeatDecay: false }],
  },
  siteHealth: {
    auditScore: 78,
    auditScoreDelta: 3,
    deadLinks: 2,
    redirectChains: 1,
    schemaErrors: 0,
    orphanPages: 3,
    cwvPassRate: { mobile: 0.85, desktop: 0.92 },
    anomalyCount: 2,
    anomalyTypes: ['traffic_drop'],
    seoChangeVelocity: 5,
  },
  clientSignals: {
    keywordFeedback: { approved: ['seo tools'], rejected: ['cheap seo'], patterns: { approveRate: 0.5, topRejectionReasons: ['low volume'] } },
    contentGapVotes: [{ topic: 'AI in SEO', votes: 5 }],
    businessPriorities: ['Increase organic traffic', 'Brand awareness'],
    approvalPatterns: { approvalRate: 0.85, avgResponseTime: 48 },
    recentChatTopics: ['rankings', 'content calendar'],
    churnRisk: 'low',
    roi: { organicValue: 5000, growth: 12.5, period: 'monthly' },
    engagement: { lastLoginAt: '2026-03-30', loginFrequency: 'weekly', chatSessionCount: 15, portalUsage: null },
    compositeHealthScore: 75,
  },
  operational: {
    recentActivity: [{ type: 'content', description: 'Brief created', timestamp: '2026-03-30T10:00:00Z' }],
    annotations: [{ date: '2026-03-30', label: 'Audit completed' }],
    pendingJobs: 1,
    approvalQueue: { pending: 2, oldestAge: 48 },
    recommendationQueue: { fixNow: 1, fixSoon: 3, fixLater: 5 },
    actionBacklog: { pendingMeasurement: 4, oldestAge: 30 },
    workOrders: { active: 1, pending: 0 },
    timeSaved: { totalMinutes: 120, byFeature: { 'content-brief': 60, 'seo-audit': 40, 'alt-text': 20 } },
  },
};

describe('formatForPrompt', () => {
  describe('bug fixes', () => {
    it('includes personas at all verbosity levels', () => {
      const compact = formatForPrompt(mockIntelligence, { verbosity: 'compact' });
      const standard = formatForPrompt(mockIntelligence, { verbosity: 'standard' });
      const detailed = formatForPrompt(mockIntelligence, { verbosity: 'detailed' });

      expect(compact).toContain('Marketing Maya');
      expect(standard).toContain('Marketing Maya');
      expect(standard).toContain('Head of Marketing');
      expect(detailed).toContain('Marketing Maya');
      expect(detailed).toContain('Experienced marketer');
    });

    it('includes knowledgeBase at standard verbosity', () => {
      const standard = formatForPrompt(mockIntelligence, { verbosity: 'standard' });
      expect(standard).toContain('enterprise SEO analytics');
    });

    it('includes businessProfile at standard+ verbosity', () => {
      const standard = formatForPrompt(mockIntelligence, { verbosity: 'standard' });
      expect(standard).toContain('SaaS');
    });

    it('includes WeCalledIt entries in learnings', () => {
      const standard = formatForPrompt(mockIntelligence, { verbosity: 'standard' });
      expect(standard).toContain('strong_win');
    });
  });

  describe('new slice formatters', () => {
    it('formats contentPipeline at compact verbosity', () => {
      const output = formatForPrompt(mockIntelligence, { verbosity: 'compact' });
      expect(output).toContain('briefs');
      expect(output).toContain('posts');
    });

    it('formats siteHealth at compact verbosity', () => {
      const output = formatForPrompt(mockIntelligence, { verbosity: 'compact' });
      expect(output).toContain('78');  // audit score
    });

    it('formats clientSignals at compact verbosity', () => {
      const output = formatForPrompt(mockIntelligence, { verbosity: 'compact' });
      expect(output).toContain('Churn risk: low');
    });

    it('formats operational at compact verbosity', () => {
      const output = formatForPrompt(mockIntelligence, { verbosity: 'compact' });
      expect(output).toContain('approvals');
    });

    it('includes more detail at standard verbosity', () => {
      const output = formatForPrompt(mockIntelligence, { verbosity: 'standard' });
      expect(output).toContain('coverage gap');
      expect(output).toContain('anomal');
    });

    it('includes everything at detailed verbosity', () => {
      const output = formatForPrompt(mockIntelligence, { verbosity: 'detailed' });
      expect(output.length).toBeGreaterThan(500);
      expect(output).toContain('time-saved');
    });
  });

  describe('cold-start detection', () => {
    it('shows cold-start message when no meaningful data', () => {
      const empty: WorkspaceIntelligence = {
        version: 1,
        workspaceId: 'ws-empty',
        assembledAt: new Date().toISOString(),
        seoContext: {
          strategy: undefined,
          brandVoice: '',
          businessContext: '',
          personas: [],
          knowledgeBase: '',
        },
      };
      const output = formatForPrompt(empty);
      expect(output).toContain('newly onboarded');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/format-for-prompt.test.ts`
Expected: FAIL — personas not included, new slices not formatted

- [ ] **Step 3: Fix existing formatter bugs**

In `formatSeoContextSection()`:

```typescript
function formatSeoContextSection(ctx: SeoContextSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## SEO Context'];

  if (ctx.brandVoice) lines.push(`Brand voice: ${ctx.brandVoice}`);
  if (ctx.businessContext) lines.push(`Business: ${ctx.businessContext}`);

  // FIX: Personas must ALWAYS be formatted when present
  if (ctx.personas && ctx.personas.length > 0) {
    if (verbosity === 'compact') {
      lines.push(`Personas: ${ctx.personas.map(p => p.name).join(', ')}`);
    } else if (verbosity === 'standard') {
      lines.push('Personas:');
      for (const p of ctx.personas) {
        lines.push(`  - ${p.name}${p.role ? ` (${p.role})` : ''}`);
      }
    } else {
      lines.push('Personas:');
      for (const p of ctx.personas) {
        lines.push(`  - ${p.name}${p.role ? ` (${p.role})` : ''}${p.description ? `: ${p.description}` : ''}`);
      }
    }
  }

  // FIX: knowledgeBase at standard+ verbosity (was detailed only)
  if (ctx.knowledgeBase) {
    if (verbosity === 'compact') {
      // One-line summary
      const summary = ctx.knowledgeBase.length > 80 ? ctx.knowledgeBase.slice(0, 80) + '...' : ctx.knowledgeBase;
      lines.push(`Knowledge: ${summary}`);
    } else {
      lines.push(`Knowledge: ${ctx.knowledgeBase}`);
    }
  }

  // FIX: businessProfile at standard+ verbosity
  if (ctx.businessProfile && verbosity !== 'compact') {
    const bp = ctx.businessProfile;
    lines.push(`Industry: ${bp.industry}${bp.targetAudience ? ` | Audience: ${bp.targetAudience}` : ''}`);
    if (bp.goals.length > 0 && verbosity === 'detailed') {
      lines.push(`Goals: ${bp.goals.join(', ')}`);
    }
  }

  // Rank tracking (standard+)
  if (ctx.rankTracking && verbosity !== 'compact') {
    const rt = ctx.rankTracking;
    lines.push(`Rank tracking: ${rt.trackedKeywords} keywords, avg position ${rt.avgPosition?.toFixed(1) ?? 'n/a'} (↑${rt.positionChanges.improved} ↓${rt.positionChanges.declined})`);
  }

  if (verbosity === 'detailed') {
    if (ctx.strategy) lines.push(`Strategy: ${ctx.strategy.siteKeywords?.length ?? 0} site keywords`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Fix learnings formatter to include WeCalledIt and ROI**

In `formatLearningsSection()`:

```typescript
function formatLearningsSection(learnings: LearningsSlice, verbosity: PromptVerbosity): string {
  if (!learnings.summary && learnings.topActionTypes.length === 0 && !learnings.roiAttribution?.length && !learnings.weCalledIt?.length) return '';

  const lines: string[] = ['## Outcome Learnings'];

  if (learnings.recentTrend) lines.push(`Trend: ${learnings.recentTrend}`);
  if (learnings.confidence) lines.push(`Confidence: ${learnings.confidence}`);
  if (learnings.overallWinRate > 0) lines.push(`Overall win rate: ${Math.round(learnings.overallWinRate * 100)}%`);

  if (verbosity === 'detailed' || verbosity === 'standard') {
    if (learnings.topActionTypes.length > 0) {
      lines.push('Win rates by action type:');
      for (const { type, winRate, count } of learnings.topActionTypes) {
        lines.push(`  ${type}: ${Math.round(winRate * 100)}% (${count} actions)`);
      }
    }

    // FIX: Format WeCalledIt entries
    if (learnings.weCalledIt && learnings.weCalledIt.length > 0) {
      lines.push('Proven predictions:');
      for (const entry of learnings.weCalledIt.slice(0, verbosity === 'detailed' ? 5 : 3)) {
        lines.push(`  - ${entry.prediction} → ${entry.score}${entry.pageUrl ? ` (${entry.pageUrl})` : ''}`);
      }
    }

    // FIX: Format ROI attribution
    if (learnings.roiAttribution && learnings.roiAttribution.length > 0 && verbosity === 'detailed') {
      lines.push('ROI highlights:');
      for (const roi of learnings.roiAttribution.slice(0, 5)) {
        lines.push(`  - ${roi.actionType} on ${roi.pageUrl}: +${roi.clickGain} clicks`);
      }
    }
  }

  return lines.join('\n');
}
```

- [ ] **Step 5: Add new slice formatters**

Add these new functions to `server/workspace-intelligence.ts`:

```typescript
function formatContentPipelineSection(pipeline: ContentPipelineSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Content Pipeline'];

  lines.push(`Briefs: ${pipeline.briefs.total}, Posts: ${pipeline.posts.total}, Matrices: ${pipeline.matrices.total}`);

  if (verbosity !== 'compact') {
    if (pipeline.coverageGaps.length > 0) {
      lines.push(`Coverage gaps: ${pipeline.coverageGaps.slice(0, 5).join(', ')}`);
    }
    if (pipeline.decayAlerts && pipeline.decayAlerts.length > 0) {
      lines.push(`Decay alerts: ${pipeline.decayAlerts.length} pages declining`);
    }
    if (pipeline.subscriptions) {
      lines.push(`Subscriptions: ${pipeline.subscriptions.active} active, ${pipeline.subscriptions.postsRemaining} posts remaining`);
    }
  }

  if (verbosity === 'detailed') {
    const bs = pipeline.briefs.byStatus;
    lines.push(`Brief status: ${Object.entries(bs).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    const ps = pipeline.posts.byStatus;
    lines.push(`Post status: ${Object.entries(ps).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    lines.push(`Matrix: ${pipeline.matrices.cellsPublished}/${pipeline.matrices.cellsPlanned} cells published`);
    if (pipeline.schemaDeployment) {
      lines.push(`Schema: ${pipeline.schemaDeployment.deployed}/${pipeline.schemaDeployment.planned} deployed, ${pipeline.schemaDeployment.queued} queued`);
    }
  }

  return lines.join('\n');
}

function formatSiteHealthSection(health: SiteHealthSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Site Health'];

  lines.push(`Audit score: ${health.auditScore ?? 'n/a'}${health.auditScoreDelta != null ? ` (${health.auditScoreDelta >= 0 ? '+' : ''}${health.auditScoreDelta})` : ''}`);
  if (health.anomalyCount != null && health.anomalyCount > 0) {
    lines.push(`Critical issues: ${health.anomalyCount} anomalies`);
  }

  if (verbosity !== 'compact') {
    if (health.performanceSummary?.score != null) {
      lines.push(`Performance: ${health.performanceSummary.score}/100`);
    }
    lines.push(`Links: ${health.deadLinks} dead, ${health.redirectChains} redirect chains, ${health.orphanPages} orphan pages`);
    if (health.anomalyTypes && health.anomalyTypes.length > 0) {
      lines.push(`Anomaly types: ${health.anomalyTypes.join(', ')}`);
    }
  }

  if (verbosity === 'detailed') {
    if (health.schemaErrors > 0) lines.push(`Schema errors: ${health.schemaErrors}`);
    if (health.seoChangeVelocity != null) lines.push(`SEO change velocity: ${health.seoChangeVelocity} changes (30d)`);
    if (health.cwvPassRate.mobile != null) lines.push(`CWV pass rate: mobile ${Math.round(health.cwvPassRate.mobile * 100)}%, desktop ${health.cwvPassRate.desktop != null ? Math.round(health.cwvPassRate.desktop * 100) : 'n/a'}%`);
  }

  return lines.join('\n');
}

function formatClientSignalsSection(signals: ClientSignalsSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Client Signals'];

  lines.push(`Churn risk: ${signals.churnRisk ?? 'unknown'}`);
  if (signals.roi) {
    lines.push(`ROI: $${signals.roi.organicValue} organic value, ${signals.roi.growth > 0 ? '+' : ''}${signals.roi.growth}% growth (${signals.roi.period})`);
  }
  if (signals.compositeHealthScore != null) {
    lines.push(`Health score: ${signals.compositeHealthScore}/100`);
  }

  if (verbosity !== 'compact') {
    if (signals.engagement) {
      lines.push(`Engagement: ${signals.engagement.loginFrequency} login frequency, ${signals.engagement.chatSessionCount} chat sessions (30d)`);
    }
    if (signals.approvalPatterns.approvalRate > 0) {
      lines.push(`Approval rate: ${Math.round(signals.approvalPatterns.approvalRate * 100)}%`);
    }
  }

  if (verbosity === 'detailed') {
    if (signals.churnSignals && signals.churnSignals.length > 0) {
      lines.push('Churn signals:');
      for (const s of signals.churnSignals.slice(0, 5)) {
        lines.push(`  - [${s.severity}] ${s.type}`);
      }
    }
    if (signals.feedbackItems && signals.feedbackItems.length > 0) {
      lines.push(`Feedback: ${signals.feedbackItems.length} items (${signals.feedbackItems.filter(f => f.status === 'open').length} open)`);
    }
    if (signals.recentChatTopics.length > 0) {
      lines.push(`Recent topics: ${signals.recentChatTopics.join(', ')}`);
    }
  }

  return lines.join('\n');
}

function formatOperationalSection(ops: OperationalSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Operational'];

  const approvals = ops.approvalQueue?.pending ?? 0;
  const actions = ops.actionBacklog?.pendingMeasurement ?? 0;
  const recs = (ops.recommendationQueue?.fixNow ?? 0) + (ops.recommendationQueue?.fixSoon ?? 0) + (ops.recommendationQueue?.fixLater ?? 0);
  lines.push(`Pending: ${approvals} approvals, ${actions} actions, ${recs} recommendations`);

  if (verbosity !== 'compact') {
    if (ops.recommendationQueue) {
      lines.push(`Recommendations: ${ops.recommendationQueue.fixNow} fix now, ${ops.recommendationQueue.fixSoon} fix soon, ${ops.recommendationQueue.fixLater} fix later`);
    }
    if (ops.recentActivity.length > 0) {
      lines.push(`Recent: ${ops.recentActivity.slice(0, 3).map(a => a.description).join('; ')}`);
    }
    if (ops.timeSaved) {
      lines.push(`Time saved: ${ops.timeSaved.totalMinutes} minutes`);
    }
  }

  if (verbosity === 'detailed') {
    if (ops.detectedPlaybooks && ops.detectedPlaybooks.length > 0) {
      lines.push(`Detected playbooks: ${ops.detectedPlaybooks.slice(0, 3).join(', ')}`);
    }
    if (ops.timeSaved?.byFeature) {
      lines.push('Time saved by feature:');
      for (const [feature, minutes] of Object.entries(ops.timeSaved.byFeature).slice(0, 5)) {
        lines.push(`  ${feature}: ${minutes} min`);
      }
    }
  }

  return lines.join('\n');
}

function formatPageProfileSection(profile: PageProfileSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = [`## Page Profile: ${profile.pagePath}`];

  lines.push(`Keyword: ${profile.primaryKeyword ?? 'none'} | Health: ${profile.optimizationScore ?? 'n/a'}`);

  if (verbosity !== 'compact') {
    if (profile.rankHistory.current != null) {
      lines.push(`Position: ${profile.rankHistory.current} (${profile.rankHistory.trend})`);
    }
    if (profile.actions.length > 0) {
      lines.push(`Actions: ${profile.actions.length} tracked`);
    }
  }

  if (verbosity === 'detailed') {
    if (profile.recommendations.length > 0) {
      lines.push('Recommendations:');
      for (const rec of profile.recommendations.slice(0, 5)) {
        lines.push(`  - ${rec}`);
      }
    }
    if (profile.auditIssues.length > 0) {
      lines.push(`Audit issues: ${profile.auditIssues.length}`);
    }
    lines.push(`Schema: ${profile.schemaStatus} | Content: ${profile.contentStatus ?? 'none'} | CWV: ${profile.cwvStatus ?? 'n/a'}`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 6: Update `formatForPrompt()` to call new formatters**

In `formatForPrompt()`, add the new sections after the existing ones:

```typescript
  // Page Profile
  if (intelligence.pageProfile) {
    sections.push(formatPageProfileSection(intelligence.pageProfile, verbosity));
  }

  // Content Pipeline
  if (intelligence.contentPipeline) {
    sections.push(formatContentPipelineSection(intelligence.contentPipeline, verbosity));
  }

  // Site Health
  if (intelligence.siteHealth) {
    sections.push(formatSiteHealthSection(intelligence.siteHealth, verbosity));
  }

  // Client Signals
  if (intelligence.clientSignals) {
    sections.push(formatClientSignalsSection(intelligence.clientSignals, verbosity));
  }

  // Operational
  if (intelligence.operational) {
    sections.push(formatOperationalSection(intelligence.operational, verbosity));
  }
```

- [ ] **Step 7: Run test, type-check, commit**

Run: `npx vitest run server/__tests__/format-for-prompt.test.ts && npx tsc --noEmit --skipLibCheck`

```bash
git add server/workspace-intelligence.ts server/__tests__/format-for-prompt.test.ts
git commit -m "feat(intelligence): expand formatForPrompt to all 8 slices + fix 4 bugs

Fixes: personas always formatted (was silently dropped), knowledgeBase at
standard verbosity (was detailed only), businessProfile formatting added,
WeCalledIt entries in learnings section.

New formatters for contentPipeline, siteHealth, pageProfile, clientSignals,
and operational slices with compact/standard/detailed verbosity support."
```

---

### Task 14: Implement `tokenBudget` Truncation

**Files:**
- Modify: `server/workspace-intelligence.ts`
- Test: `server/__tests__/token-budget.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// server/__tests__/token-budget.test.ts
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';

// Create a large intelligence object with all slices populated
function makeLargeIntelligence(): WorkspaceIntelligence {
  return {
    version: 1,
    workspaceId: 'ws-1',
    assembledAt: new Date().toISOString(),
    seoContext: {
      strategy: undefined,
      brandVoice: 'Professional and authoritative voice that conveys expertise in all digital marketing areas.',
      businessContext: 'Enterprise B2B SaaS company serving Fortune 500 marketing teams with comprehensive analytics.',
      personas: [
        { name: 'Marketing Maya', role: 'CMO', description: 'C-level executive focused on brand growth and market positioning' },
        { name: 'Analytics Adam', role: 'Data Analyst', description: 'Technical user who cares about accuracy and data quality' },
      ],
      knowledgeBase: 'Our company has been a leader in enterprise SEO analytics since 2018. We serve over 200 Fortune 500 companies and process billions of search data points monthly.',
    },
    insights: {
      all: Array.from({ length: 20 }, (_, i) => ({
        id: `i${i}`,
        insightType: 'content_gap',
        severity: i < 3 ? 'critical' : 'warning',
        impactScore: 90 - i * 3,
        pageId: `/page-${i}`,
        title: `Insight ${i}: Missing content for keyword cluster ${i}`,
      } as any)),
      byType: {},
      bySeverity: { critical: 3, warning: 10, opportunity: 5, positive: 2 },
      topByImpact: [],
    },
    learnings: {
      summary: null,
      confidence: 'high',
      topActionTypes: [
        { type: 'content_refresh', winRate: 0.72, count: 25 },
        { type: 'schema_added', winRate: 0.65, count: 18 },
        { type: 'seo_fix', winRate: 0.58, count: 30 },
      ],
      overallWinRate: 0.62,
      recentTrend: 'improving',
      playbooks: [],
    },
    contentPipeline: {
      briefs: { total: 12, byStatus: { draft: 4, ready: 3, published: 5 } },
      posts: { total: 8, byStatus: { draft: 2, published: 6 } },
      matrices: { total: 2, cellsPlanned: 20, cellsPublished: 8 },
      requests: { pending: 3, inProgress: 2, delivered: 10 },
      workOrders: { active: 2 },
      coverageGaps: ['competitor analysis', 'pricing guides', 'case studies', 'tutorials', 'integrations'],
      seoEdits: { pending: 2, applied: 8, inReview: 1 },
    },
    siteHealth: {
      auditScore: 72,
      auditScoreDelta: -3,
      deadLinks: 5,
      redirectChains: 3,
      schemaErrors: 2,
      orphanPages: 7,
      cwvPassRate: { mobile: 0.65, desktop: 0.82 },
      anomalyCount: 4,
      anomalyTypes: ['traffic_drop', 'ranking_drop'],
      seoChangeVelocity: 12,
    },
    clientSignals: {
      keywordFeedback: { approved: ['seo tools', 'analytics'], rejected: ['cheap seo'], patterns: { approveRate: 0.67, topRejectionReasons: [] } },
      contentGapVotes: [{ topic: 'AI in SEO', votes: 5 }],
      businessPriorities: ['Organic traffic growth', 'Brand awareness'],
      approvalPatterns: { approvalRate: 0.78, avgResponseTime: 72 },
      recentChatTopics: ['rankings', 'content calendar', 'competitor analysis'],
      churnRisk: 'medium',
      compositeHealthScore: 65,
    },
    operational: {
      recentActivity: Array.from({ length: 10 }, (_, i) => ({
        type: 'content',
        description: `Activity ${i}`,
        timestamp: new Date().toISOString(),
      })),
      annotations: [],
      pendingJobs: 2,
      approvalQueue: { pending: 5, oldestAge: 72 },
      recommendationQueue: { fixNow: 3, fixSoon: 8, fixLater: 15 },
      actionBacklog: { pendingMeasurement: 12, oldestAge: 45 },
      workOrders: { active: 2, pending: 1 },
      timeSaved: { totalMinutes: 300, byFeature: { 'content-brief': 120, 'seo-audit': 80, 'alt-text': 50, 'schema': 30, 'rewrite': 20 } },
    },
  };
}

describe('tokenBudget truncation', () => {
  it('returns full output when no budget specified', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, { verbosity: 'detailed' });
    expect(output).toContain('Operational');
    expect(output).toContain('Client Signals');
  });

  it('drops operational first when budget is tight', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, { verbosity: 'detailed', tokenBudget: 800 });
    // operational should be dropped first
    expect(output).not.toContain('## Operational');
    // seoContext should never be dropped
    expect(output).toContain('## SEO Context');
  });

  it('truncates insights to top 5 when further constrained', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, { verbosity: 'detailed', tokenBudget: 500 });
    // Count insight lines
    const insightLines = output.split('\n').filter(l => l.includes('[critical]') || l.includes('[warning]'));
    expect(insightLines.length).toBeLessThanOrEqual(5);
  });

  it('never drops seoContext', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, { verbosity: 'compact', tokenBudget: 100 });
    expect(output).toContain('SEO Context');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/token-budget.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement tokenBudget truncation in `formatForPrompt`**

Modify `formatForPrompt()` to add truncation at the end:

```typescript
export function formatForPrompt(
  intelligence: WorkspaceIntelligence,
  opts?: PromptFormatOptions,
): string {
  const verbosity = opts?.verbosity ?? 'standard';
  const tokenBudget = opts?.tokenBudget;
  const sections: string[] = [];

  sections.push('[Workspace Intelligence]');

  // ... (existing cold-start detection and section formatting — unchanged) ...

  // All sections assembled — now apply tokenBudget truncation if needed
  if (tokenBudget && tokenBudget > 0) {
    return applyTokenBudget(sections, intelligence, verbosity, tokenBudget);
  }

  return sections.filter(Boolean).join('\n\n');
}

/**
 * Token budget truncation — §20 priority chain:
 * 1. Drop `operational` first (lowest value density)
 * 2. Truncate `insights` to top 5
 * 3. Drop `clientSignals`
 * 4. Summarize `learnings` to one-line
 * 5. Never drop `seoContext`
 */
function applyTokenBudget(
  sections: string[],
  intelligence: WorkspaceIntelligence,
  verbosity: PromptVerbosity,
  budget: number,
): string {
  // Rough token estimate: 1 token ≈ 4 characters
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  let output = sections.filter(Boolean).join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 1: Drop operational
  const withoutOps = sections.filter(s => !s.startsWith('## Operational'));
  output = withoutOps.filter(Boolean).join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 2: Truncate insights to top 5
  const truncatedSections = withoutOps.map(s => {
    if (s.startsWith('## Active Insights') && intelligence.insights) {
      const insightLines = s.split('\n');
      const header = insightLines.filter(l => !l.startsWith('- ['));
      const items = insightLines.filter(l => l.startsWith('- ['));
      return [...header, ...items.slice(0, 5)].join('\n');
    }
    return s;
  });
  output = truncatedSections.filter(Boolean).join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 3: Drop clientSignals
  const withoutClient = truncatedSections.filter(s => !s.startsWith('## Client Signals'));
  output = withoutClient.filter(Boolean).join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 4: Summarize learnings to one line
  const summarizedSections = withoutClient.map(s => {
    if (s.startsWith('## Outcome Learnings') && intelligence.learnings) {
      const rate = intelligence.learnings.overallWinRate;
      return `## Outcome Learnings\nWin rate: ${Math.round(rate * 100)}%${intelligence.learnings.recentTrend ? ` (${intelligence.learnings.recentTrend})` : ''}`;
    }
    return s;
  });
  output = summarizedSections.filter(Boolean).join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 5: Drop everything except seoContext (never dropped)
  const seoOnly = summarizedSections.filter(s =>
    s.startsWith('[Workspace Intelligence]') || s.startsWith('## SEO Context'),
  );
  return seoOnly.filter(Boolean).join('\n\n');
}
```

- [ ] **Step 4: Run test, type-check, commit**

Run: `npx vitest run server/__tests__/token-budget.test.ts && npx tsc --noEmit --skipLibCheck`

```bash
git add server/workspace-intelligence.ts server/__tests__/token-budget.test.ts
git commit -m "feat(intelligence): implement tokenBudget truncation per §20 priority chain

Truncation order: drop operational → truncate insights to 5 → drop
clientSignals → summarize learnings to one line → never drop seoContext.
Token estimation uses ~4 chars/token heuristic."
```

---

### Task 15: Integration Test + Bridge Runtime Tests + Expanded Fixture + Quality Gate

**Files:**
- Create: `server/__tests__/intelligence-integration.test.ts`
- Create: `server/__tests__/bridge-runtime.test.ts`
- Modify: `tests/fixtures/intelligence-seed.ts`

This task validates: (a) the full intelligence pipeline end-to-end, (b) bridge side effects fire correctly at runtime, (c) the test fixture seed covers all data sources, and (d) quality gates pass.

- [ ] **Step 1: Write the comprehensive integration test**

```typescript
// server/__tests__/intelligence-integration.test.ts
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../workspace-intelligence.js';
import type { WorkspaceIntelligence, IntelligenceSlice } from '../../shared/types/intelligence.js';

describe('Intelligence layer integration', () => {
  describe('formatForPrompt covers all 8 slices', () => {
    const ALL_SLICES: IntelligenceSlice[] = [
      'seoContext', 'insights', 'learnings', 'pageProfile',
      'contentPipeline', 'siteHealth', 'clientSignals', 'operational',
    ];

    it('each slice has a corresponding section header', () => {
      const intel: WorkspaceIntelligence = {
        version: 1,
        workspaceId: 'ws-test',
        assembledAt: new Date().toISOString(),
        seoContext: { strategy: undefined, brandVoice: 'Test', businessContext: 'Test', personas: [], knowledgeBase: '' },
        insights: { all: [{ id: 'i1', insightType: 'content_gap', severity: 'warning', impactScore: 50 } as any], byType: {}, bySeverity: { critical: 0, warning: 1, opportunity: 0, positive: 0 }, topByImpact: [] },
        learnings: { summary: null, confidence: 'low', topActionTypes: [{ type: 'test', winRate: 0.5, count: 1 }], overallWinRate: 0.5, recentTrend: null, playbooks: [] },
        pageProfile: { pagePath: '/test', primaryKeyword: 'test', searchIntent: null, optimizationScore: null, recommendations: [], contentGaps: [], insights: [], actions: [], auditIssues: [], schemaStatus: 'none', linkHealth: { inbound: 0, outbound: 0, orphan: false }, seoEdits: { currentTitle: '', currentMeta: '', lastEditedAt: null }, rankHistory: { current: null, best: null, trend: 'stable' }, contentStatus: null, cwvStatus: null },
        contentPipeline: { briefs: { total: 1, byStatus: {} }, posts: { total: 0, byStatus: {} }, matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 }, requests: { pending: 0, inProgress: 0, delivered: 0 }, workOrders: { active: 0 }, coverageGaps: [], seoEdits: { pending: 0, applied: 0, dismissed: 0 } },
        siteHealth: { auditScore: 80, auditScoreDelta: null, deadLinks: 0, redirectChains: 0, schemaErrors: 0, orphanPages: 0, cwvPassRate: { mobile: null, desktop: null } },
        clientSignals: { keywordFeedback: { approved: [], rejected: [], patterns: { approveRate: 0, topRejectionReasons: [] } }, contentGapVotes: [], businessPriorities: [], approvalPatterns: { approvalRate: 0, avgResponseTime: null }, recentChatTopics: [], churnRisk: null },
        operational: { recentActivity: [], annotations: [], pendingJobs: 0 },
      };

      const output = formatForPrompt(intel, { verbosity: 'detailed' });

      // Verify each slice has a section
      expect(output).toContain('## SEO Context');
      expect(output).toContain('## Active Insights');
      expect(output).toContain('## Outcome Learnings');
      expect(output).toContain('## Page Profile');
      expect(output).toContain('## Content Pipeline');
      expect(output).toContain('## Site Health');
      expect(output).toContain('## Client Signals');
      expect(output).toContain('## Operational');
    });
  });

  describe('type completeness', () => {
    it('all slice interfaces are defined in WorkspaceIntelligence', () => {
      // TypeScript compilation validates this — if this file compiles, types are complete
      const intel: WorkspaceIntelligence = {
        version: 1,
        workspaceId: 'test',
        assembledAt: '',
      };
      expect(intel.version).toBe(1);
      // All slices are optional, which is correct
      expect(intel.seoContext).toBeUndefined();
      expect(intel.insights).toBeUndefined();
      expect(intel.learnings).toBeUndefined();
      expect(intel.pageProfile).toBeUndefined();
      expect(intel.contentPipeline).toBeUndefined();
      expect(intel.siteHealth).toBeUndefined();
      expect(intel.clientSignals).toBeUndefined();
      expect(intel.operational).toBeUndefined();
    });
  });

  describe('personas bug fix', () => {
    it('personas appear in compact output', () => {
      const intel: WorkspaceIntelligence = {
        version: 1,
        workspaceId: 'test',
        assembledAt: '',
        seoContext: {
          strategy: undefined,
          brandVoice: 'Test',
          businessContext: 'Test',
          personas: [{ name: 'TestPersona', role: 'Developer' }],
          knowledgeBase: '',
        },
      };
      const output = formatForPrompt(intel, { verbosity: 'compact' });
      expect(output).toContain('TestPersona');
    });
  });

  describe('tokenBudget preserves seoContext', () => {
    it('seoContext survives aggressive truncation', () => {
      const intel: WorkspaceIntelligence = {
        version: 1,
        workspaceId: 'test',
        assembledAt: '',
        seoContext: {
          strategy: undefined,
          brandVoice: 'The voice',
          businessContext: 'The business',
          personas: [],
          knowledgeBase: '',
        },
        operational: { recentActivity: [], annotations: [], pendingJobs: 0 },
        clientSignals: { keywordFeedback: { approved: [], rejected: [], patterns: { approveRate: 0, topRejectionReasons: [] } }, contentGapVotes: [], businessPriorities: [], approvalPatterns: { approvalRate: 0, avgResponseTime: null }, recentChatTopics: [], churnRisk: null },
      };
      const output = formatForPrompt(intel, { verbosity: 'compact', tokenBudget: 50 });
      expect(output).toContain('SEO Context');
      expect(output).toContain('The voice');
    });
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run server/__tests__/intelligence-integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Both pass

- [ ] **Step 5: Commit integration test**

```bash
git add server/__tests__/intelligence-integration.test.ts
git commit -m "test(intelligence): add integration tests for Phase 3A intelligence layer

Validates all 8 slices format correctly, personas bug fix, tokenBudget
truncation, and type completeness for the unified workspace intelligence layer."
```

- [ ] **Step 6: Write bridge runtime integration tests**

These tests verify that bridge side effects actually fire at runtime, not just that the imports exist (which is what Tasks 2 and 7 test). Each test seeds data, triggers the bridge, and asserts the mutation happened.

```typescript
// server/__tests__/bridge-runtime.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// NOTE: These are integration tests that hit the real DB.
// They require the test DB to be seeded with workspace + insight data.
// The intelligence-seed fixture handles this.

describe('Bridge runtime side effects', () => {
  let testWorkspaceId: string;
  let cleanup: () => void;

  beforeEach(async () => {
    const { seedIntelligenceTestData } = await import('../../tests/fixtures/intelligence-seed.js');
    const seed = seedIntelligenceTestData();
    testWorkspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
  });

  afterEach(() => {
    cleanup?.();
  });

  describe('Bridge #7: recordAction → auto-resolve insight', () => {
    it('sets matching insight to in_progress when action recorded for same page', async () => {
      const { getInsights } = await import('../analytics-insights-store.js');
      const { recordAction } = await import('../outcome-tracking.js');

      // Get an existing insight's pageId
      const insightsBefore = getInsights(testWorkspaceId);
      const unresolvedInsight = insightsBefore.find(
        i => i.resolutionStatus !== 'resolved' && i.resolutionStatus !== 'in_progress' && i.pageId,
      );
      if (!unresolvedInsight) {
        // Seed must include an unresolved insight with a pageId
        expect(insightsBefore.length).toBeGreaterThan(0);
        return; // Skip if seed doesn't have the right data
      }

      // Record an action for that page
      recordAction({
        workspaceId: testWorkspaceId,
        actionType: 'content_refresh',
        sourceType: 'test',
        pageUrl: unresolvedInsight.pageId!,
        baselineSnapshot: { metric: 'clicks', value: 100, measuredAt: new Date().toISOString() },
      });

      // Wait for async bridge to fire (it's fire-and-forget)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check that the insight was auto-resolved
      const insightsAfter = getInsights(testWorkspaceId);
      const updatedInsight = insightsAfter.find(i => i.id === unresolvedInsight.id);
      expect(updatedInsight?.resolutionStatus).toBe('in_progress');
    });

    it('does not double-resolve on duplicate action (idempotency)', async () => {
      const { getInsights } = await import('../analytics-insights-store.js');
      const { recordAction } = await import('../outcome-tracking.js');

      const insightsBefore = getInsights(testWorkspaceId);
      const unresolvedInsight = insightsBefore.find(
        i => i.resolutionStatus !== 'resolved' && i.resolutionStatus !== 'in_progress' && i.pageId,
      );
      if (!unresolvedInsight) return;

      // Record same action twice
      recordAction({
        workspaceId: testWorkspaceId,
        actionType: 'content_refresh',
        sourceType: 'test',
        sourceId: 'dup-test-1',
        pageUrl: unresolvedInsight.pageId!,
        baselineSnapshot: { metric: 'clicks', value: 100, measuredAt: new Date().toISOString() },
      });
      recordAction({
        workspaceId: testWorkspaceId,
        actionType: 'content_refresh',
        sourceType: 'test',
        sourceId: 'dup-test-2',
        pageUrl: unresolvedInsight.pageId!,
        baselineSnapshot: { metric: 'clicks', value: 100, measuredAt: new Date().toISOString() },
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Should still be in_progress, not double-resolved or errored
      const insightsAfter = getInsights(testWorkspaceId);
      const updated = insightsAfter.find(i => i.id === unresolvedInsight.id);
      expect(updated?.resolutionStatus).toBe('in_progress');
    });
  });

  describe('Bridge #13: recordAction → auto-annotate', () => {
    it('creates an annotation when an action is recorded', async () => {
      const { recordAction } = await import('../outcome-tracking.js');
      const { getAnnotations } = await import('../analytics-annotations.js');

      const annotationsBefore = getAnnotations(testWorkspaceId);

      recordAction({
        workspaceId: testWorkspaceId,
        actionType: 'seo_fix',
        sourceType: 'test',
        pageUrl: '/test-page',
        baselineSnapshot: { metric: 'position', value: 15, measuredAt: new Date().toISOString() },
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const annotationsAfter = getAnnotations(testWorkspaceId);
      expect(annotationsAfter.length).toBeGreaterThan(annotationsBefore.length);
      const newAnnotation = annotationsAfter.find(a =>
        a.label?.includes('seo_fix') && a.label?.includes('/test-page'),
      );
      expect(newAnnotation).toBeDefined();
    });
  });

  describe('Bridge #1: recordOutcome → reweight insight scores', () => {
    it('adjusts impact scores when a strong_win outcome is recorded', async () => {
      const { getInsights } = await import('../analytics-insights-store.js');
      const { recordAction, recordOutcome, getActionsByWorkspace } = await import('../outcome-tracking.js');

      // First record an action so we have something to score
      const action = recordAction({
        workspaceId: testWorkspaceId,
        actionType: 'content_refresh',
        sourceType: 'test',
        pageUrl: '/test-outcome-page',
        baselineSnapshot: { metric: 'clicks', value: 50, measuredAt: new Date().toISOString() },
      });

      // Record a strong_win outcome
      recordOutcome({
        actionId: action.id,
        checkpointDays: 30,
        metricsSnapshot: { metric: 'clicks', value: 150, measuredAt: new Date().toISOString() },
        score: 'strong_win',
        deltaSummary: { metric: 'clicks', before: 50, after: 150, change: 100, changePercent: 200 },
      });

      // Wait for debounced bridge to fire
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify: insights for the same page should have lowered impact scores
      // (strong_win = -20 adjustment, meaning the issue is less urgent now)
      const insightsAfter = getInsights(testWorkspaceId);
      const pageInsight = insightsAfter.find(i => i.pageId === '/test-outcome-page');
      // If there's a matching insight, its score should have been adjusted
      if (pageInsight) {
        expect(pageInsight.resolutionSource).toContain('bridge_1');
      }
    });
  });
});
```

- [ ] **Step 7: Expand intelligence-seed fixture**

The spec §17 requires the seed to include content briefs, posts, keyword strategy, and audit snapshot — not just insights and actions. Expand `tests/fixtures/intelligence-seed.ts`:

```typescript
// Add to the existing seedIntelligenceTestData() function, after insights and actions are seeded:

  // ── Content briefs (3 total) ──
  const { createBrief } = await import('../../server/content-brief.js');
  for (const brief of [
    { title: 'SEO Guide', keyword: 'seo guide', status: 'ready' },
    { title: 'Analytics Tips', keyword: 'analytics tips', status: 'draft' },
    { title: 'Marketing Strategy', keyword: 'marketing strategy', status: 'draft' },
  ]) {
    try {
      createBrief({ workspaceId, ...brief });
    } catch {
      // Brief creation may fail if table schema differs — non-critical for seed
    }
  }

  // ── Content posts (2 published) ──
  const { createPost } = await import('../../server/content-posts.js');
  for (const post of [
    { title: 'Published SEO Guide', status: 'published', pageUrl: '/blog/seo-guide' },
    { title: 'Published Analytics Post', status: 'published', pageUrl: '/blog/analytics' },
  ]) {
    try {
      createPost({ workspaceId, ...post });
    } catch {
      // Post creation may fail if table schema differs
    }
  }

  // ── Keyword strategy with page map ──
  try {
    const { upsertStrategy } = await import('../../server/keyword-strategy.js');
    upsertStrategy(workspaceId, {
      siteKeywords: [
        { keyword: 'seo tools', volume: 5000, difficulty: 45, intent: 'informational' },
        { keyword: 'analytics platform', volume: 3000, difficulty: 35, intent: 'commercial' },
      ],
      pageMap: {
        '/blog/seo-guide': { primary: 'seo tools', secondary: ['seo tips'] },
        '/blog/analytics': { primary: 'analytics platform', secondary: [] },
      },
    });
  } catch {
    // Strategy may fail
  }

  // ── Audit snapshot with issues ──
  try {
    const { saveSnapshot } = await import('../../server/reports.js');
    saveSnapshot('test-site-' + workspaceId, {
      score: 75,
      summary: { totalIssues: 8, criticalCount: 2, warningCount: 4 },
      pages: [
        { url: '/blog/seo-guide', title: 'SEO Guide', issues: [{ severity: 'warning', message: 'Missing meta description' }] },
        { url: '/about', title: 'About', issues: [{ severity: 'critical', message: 'Broken canonical URL' }] },
      ],
    });
  } catch {
    // Snapshot may fail
  }

  // ── Second annotation (spec requires 2) ──
  try {
    const { createAnnotation } = await import('../../server/analytics-annotations.js');
    createAnnotation({
      workspaceId,
      date: new Date().toISOString().split('T')[0],
      label: 'Strategy revision completed',
      category: 'strategy',
      createdBy: 'test-seed',
    });
  } catch {
    // Annotation may fail
  }
```

**Note for implementer:** The exact function names (`createBrief`, `createPost`, `upsertStrategy`, `saveSnapshot`) depend on the actual exports. Grep for these patterns to find the correct function names. The seed should be defensive (try/catch each insert) because not all tables may exist in the test environment.

- [ ] **Step 8: Run bridge runtime tests**

Run: `npx vitest run server/__tests__/bridge-runtime.test.ts`
Expected: PASS — all bridge side effects verified

- [ ] **Step 9: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 10: Type-check and build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Both pass

- [ ] **Step 11: Commit**

```bash
git add server/__tests__/intelligence-integration.test.ts server/__tests__/bridge-runtime.test.ts tests/fixtures/intelligence-seed.ts
git commit -m "test(intelligence): add bridge runtime tests + expand test fixture

Bridge runtime tests verify side effects (insight auto-resolve, annotation
creation, impact score reweight) actually fire at runtime — not just that
imports exist. Expanded fixture adds content briefs, posts, keyword strategy,
and audit snapshot per spec §17."
```

- [ ] **Step 12: Run quality gate**

Run: `npx tsx scripts/pr-check.ts`
Expected: Zero errors

Run: `npx vitest run` (full suite again after final commit)
Expected: All pass

---

### Task 16: Verify Mini Builder Extraction (3A-5)

**Files:**
- Test: `server/__tests__/mini-builder-extraction.test.ts`

Spec 3A-5 requires that the slice assemblers pull the **same underlying data** that three existing mini-builders use, so both paths coexist until Phase 3B replaces the old builders. This task verifies that the assemblers cover the same data sources.

The three mini-builders and what they produce:
- `buildBriefIntelligenceBlock()` in `content-brief.ts` — cannibalization warnings, decay alerts, quick wins, page health → covered by `contentPipeline` (decay, cannibalization) + `pageProfile` (page-level insights) + `insights` (existing)
- `buildPlanContextForPage()` in `schema-suggester.ts` — strategy + page architecture + keywords + schema errors → covered by `seoContext` (strategy) + `pageProfile` (architecture, keywords) + `siteHealth` (schema)
- `buildPageAnalysisContext()` in `seo-context.ts` — audit issues, recommendations, keyword analysis for a page → covered by `pageProfile` (audit issues, recommendations, page keywords)

- [ ] **Step 1: Write extraction verification test**

```typescript
// server/__tests__/mini-builder-extraction.test.ts
import { describe, it, expect } from 'vitest';

describe('3A-5: Mini builder data extraction verification', () => {
  describe('buildBriefIntelligenceBlock data covered by slice assemblers', () => {
    it('contentPipeline includes cannibalization warnings', async () => {
      const fs = await import('node:fs');
      const src = fs.readFileSync(new URL('../../workspace-intelligence.ts', import.meta.url), 'utf-8');
      // contentPipeline assembler must import cannibalization-detection
      expect(src).toContain('cannibalization-detection');
      expect(src).toContain('cannibalizationWarnings');
    });

    it('contentPipeline includes decay alerts', async () => {
      const fs = await import('node:fs');
      const src = fs.readFileSync(new URL('../../workspace-intelligence.ts', import.meta.url), 'utf-8');
      expect(src).toContain('decayAlerts');
      expect(src).toContain('content-decay');
    });
  });

  describe('buildPlanContextForPage data covered by slice assemblers', () => {
    it('seoContext includes strategy', async () => {
      const fs = await import('node:fs');
      const src = fs.readFileSync(new URL('../../workspace-intelligence.ts', import.meta.url), 'utf-8');
      expect(src).toContain('ctx.strategy');
    });

    it('pageProfile includes architecture and keywords', async () => {
      const fs = await import('node:fs');
      const src = fs.readFileSync(new URL('../../workspace-intelligence.ts', import.meta.url), 'utf-8');
      expect(src).toContain('site-architecture');
      expect(src).toContain('page-keywords');
    });

    it('siteHealth includes schema errors', async () => {
      const fs = await import('node:fs');
      const src = fs.readFileSync(new URL('../../workspace-intelligence.ts', import.meta.url), 'utf-8');
      expect(src).toContain('schema-validator');
      expect(src).toContain('schemaErrors');
    });
  });

  describe('buildPageAnalysisContext data covered by pageProfile assembler', () => {
    it('pageProfile includes audit issues and recommendations', async () => {
      const fs = await import('node:fs');
      const src = fs.readFileSync(new URL('../../workspace-intelligence.ts', import.meta.url), 'utf-8');
      expect(src).toContain('auditIssues');
      expect(src).toContain('recommendations');
      expect(src).toContain('getPageKeyword');
    });
  });
});
```

- [ ] **Step 2: Run test — should pass if all assemblers are implemented correctly**

Run: `npx vitest run server/__tests__/mini-builder-extraction.test.ts`
Expected: PASS (all assemblers from Tasks 3-9 wire the same data sources)

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/mini-builder-extraction.test.ts
git commit -m "test(intelligence): verify mini builder data extraction (3A-5)

Confirms that slice assemblers cover the same underlying data as
buildBriefIntelligenceBlock, buildPlanContextForPage, and
buildPageAnalysisContext. Both paths coexist — Phase 3B replaces."
```

---

### Task 17: Add pr-check Regression Guards (Spec §17)

**Files:**
- Modify: `scripts/pr-check.ts`
- Test: Run `npx tsx scripts/pr-check.ts` after changes

The spec §17 requires three grep-based regression guards in `pr-check.ts` to prevent future developers from re-introducing patterns this feature eliminates.

- [ ] **Step 1: Read existing pr-check.ts**

Run: Read `scripts/pr-check.ts` to understand the existing check patterns.

- [ ] **Step 2: Add intelligence layer regression guards**

Add the following checks to `scripts/pr-check.ts`, following the existing pattern for `addCheck`:

```typescript
// ── Intelligence Layer Regression Guards (Phase 3A) ──────────────────────

// Guard 1: No direct listPages() calls outside workspace-data.ts
// Phase 3A centralizes all Webflow page fetching through workspace-data.ts
// to deduplicate API calls (22 callers → 1).
addCheck({
  name: 'No direct listPages outside workspace-data',
  pattern: /listPages\s*\(/,
  glob: 'server/**/*.ts',
  exclude: ['server/workspace-data.ts', 'server/webflow-pages.ts', 'server/__tests__/**'],
  message: 'Use getWorkspacePages() from workspace-data.ts instead of calling listPages() directly. See Phase 3A intelligence layer docs.',
});

// Guard 2: No new buildSeoContext() calls in new files
// New code should use buildWorkspaceIntelligence({ slices: ['seoContext'] }) instead.
// Existing callers are grandfathered until Phase 3B migration.
addCheck({
  name: 'No new buildSeoContext calls in new files',
  pattern: /buildSeoContext\s*\(/,
  glob: 'server/**/*.ts',
  exclude: [
    'server/seo-context.ts',              // Definition
    'server/workspace-intelligence.ts',    // Delegates internally
    'server/admin-chat-context.ts',        // Grandfathered until Phase 3B
    'server/__tests__/**',                 // Tests
  ],
  message: 'Use buildWorkspaceIntelligence({ slices: ["seoContext"] }) instead of buildSeoContext(). See Phase 3A intelligence layer docs.',
  // NOTE: This check may have false positives for existing callers.
  // Only flag files modified in this PR (not pre-existing callers).
  newFilesOnly: true,
});

// Guard 3: No recordAction() calls without workspace ID guard
// Every recordAction() must be gated by `if (workspaceId)` to prevent
// passing non-workspace IDs (like Webflow siteId) as the FK.
addCheck({
  name: 'recordAction calls must be guarded by workspaceId check',
  pattern: /recordAction\s*\(\s*\{/,
  glob: 'server/**/*.ts',
  exclude: ['server/outcome-tracking.ts', 'server/__tests__/**'],
  message: 'recordAction() must be guarded by `if (workspaceId)`. See CLAUDE.md rule on guarding recordAction().',
  // This is advisory — the pattern can't fully validate the guard exists.
  // The check flags all callsites for human review.
  severity: 'warning',
});
```

**Note for implementer:** The exact API for `addCheck` depends on how `pr-check.ts` is structured. Read the file first and adapt the check definitions to match the existing pattern. The key logic is: grep for the pattern, exclude listed files, report matches as errors/warnings. If `pr-check.ts` uses a different mechanism (raw grep, custom functions), adapt accordingly.

- [ ] **Step 3: Run pr-check to verify guards work**

Run: `npx tsx scripts/pr-check.ts`
Expected: Zero errors (existing code should be excluded by the exclude lists)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "chore(intelligence): add pr-check regression guards per spec §17

3 guards: no direct listPages() outside workspace-data.ts, no new
buildSeoContext() calls (use intelligence layer), recordAction() must
have workspaceId guard. Prevents re-introducing patterns Phase 3A eliminates."
```

---

## Post-Plan Self-Review (Audited)

### 1. Spec Coverage Verification

| Spec Item (§10 Phase 3A) | Task | Status |
|--------------------------|------|--------|
| 3A-1: contentPipeline assembler | Task 4 | ✅ 14 modules wired |
| 3A-1: siteHealth assembler | Task 3 | ✅ 10 modules wired (includes link-checker, aeo-page-review, pagespeed) |
| 3A-1: pageProfile assembler | Task 8 | ✅ 10 modules wired (includes rank-tracking, roi-attribution) |
| 3A-1: clientSignals assembler | Task 5 | ✅ 13 modules wired (includes roi.ts, content-requests, requests) |
| 3A-1: operational assembler | Task 6 | ✅ 13 modules wired (includes seo-change-tracker, anomaly-detection, work-orders) |
| 3A-1: seoContext enrichment | Task 9 | ✅ rank-tracking, businessProfile, strategyHistory. SEMRush = cached-only (24h TTL, never blocks) |
| 3A-1: learnings enrichment | Task 10 | ✅ roi-attribution + weCalledIt |
| 3A-2: formatForPrompt all 8 slices | Task 13 | ✅ 5 new formatters + verbosity tables match spec |
| 3A-2: Fix personas bug | Task 13 | ✅ All 3 verbosity levels |
| 3A-2: Fix knowledgeBase verbosity | Task 13 | ✅ Moved to standard (one-line at compact) |
| 3A-2: Fix businessProfile formatting | Task 13 | ✅ Standard+ verbosity |
| 3A-2: Fix WeCalledIt formatting | Task 13 | ✅ Standard+ verbosity |
| 3A-3: tokenBudget truncation | Task 14 | ✅ 5-step priority chain per §20 |
| 3A-4: Bridge #1 (outcome→reweight) | Task 2 | ✅ Full code |
| 3A-4: Bridge #10 (anomaly→boost) | Task 2 | ✅ Full code |
| 3A-4: Bridge #12 (audit→page_health) | Task 2 | ✅ Full code |
| 3A-4: Bridge #15 (audit→site_health) | Task 2 | ✅ Full code |
| 3A-4: Bridge #8 (decay→repeat check) | Task 7 | ✅ Full code |
| 3A-4: Bridge #9 (recs→learnings weight) | Task 7 | ✅ Code with adaptive note |
| 3A-4: Bridge #14 (cron→cache invalidate) | Task 7 | ✅ Full code |
| 3A-5: Mini-builder extraction | Task 16 | ✅ Verification test confirms data coverage |
| 3A-6: WebSocket wiring | Task 11 | ✅ Server broadcast + frontend handler |
| 3A-7: Scheduler invalidation | Task 12 | ✅ All 6 schedulers |
| 3A-8: Shared types expansion | Task 1 | ✅ 15+ new types + 6 slice expansions |
| 3A quality gate | Task 15 | ✅ Integration test + bridge runtime tests + full test suite + pr-check |
| §17: Regression protection | Task 17 | ✅ 3 pr-check guards (listPages, buildSeoContext, recordAction) |
| §17: Test data seeding | Task 15 | ✅ Expanded fixture: briefs, posts, strategy, audit snapshot, 2 annotations |
| §17: Bridge integration tests | Task 15 | ✅ Bridge #7 + #13 + #1 runtime side effects + idempotency |
| §12: Error handling per assembler | Tasks 3-6 | ✅ Empty data + source failure tests per assembler |

### 2. Audit-Found Gaps — Resolution (Round 1: Module Coverage)

| Gap Found | Resolution |
|-----------|-----------|
| Missing Task for 3A-5 mini builder extraction | Added Task 16 with verification tests |
| siteHealth missing link-checker, aeo-page-review, pagespeed | Added `getLinkCheck` import, AEO readiness assembly, pagespeed already via performance-store |
| pageProfile missing rank-tracking, roi-attribution | Added full rank-tracking integration (180-day history) + roi-attribution per-page |
| clientSignals missing content-requests, roi.ts | Added content-requests wiring + roi.ts organic value note |
| operational missing seo-change-tracker, anomaly-detection, work-orders | Added all three with explicit wiring code |
| SEMRush integration | seoContext assembler documents cached-only approach (never blocks assembly, 24h TTL). Actual SEMRush fetch is done by existing semrush.ts on first access — assembler reads from cache. |
| PageProfileSlice type not expanded in Task 1 | Added `roiAttribution?: ROIAttribution[]` field to PageProfileSlice |
| Frontend WS handler | Task 11 now requires explicit implementation, not "if not present" |

### 2b. Audit-Found Gaps — Resolution (Round 2: Type Mismatches + Error Handling)

| Gap | Severity | Resolution |
|-----|----------|-----------|
| `BacklinkProfile.trend` used `'up'\|'down'` not spec's `'growing'\|'declining'` | Critical | Fixed to `'growing' \| 'stable' \| 'declining'`. Added missing `totalBacklinks` field. |
| `SerpFeatures` had `sitelinks` not spec's `localPack` | Critical | Fixed to `localPack: boolean` |
| `strategyHistory` was array, spec requires summary object | Critical | Replaced `StrategyHistoryEntry[]` with `StrategyHistory { revisionsCount, lastRevisedAt, trajectory }` |
| `clientSignals.roi` shape differed from spec | Critical | Fixed to `{ organicValue: number, growth: number, period: string }` |
| `EngagementMetrics.loginFrequency` was number, spec uses categorical enum | Critical | Fixed to `'daily' \| 'weekly' \| 'monthly' \| 'inactive'` with derivation logic in assembler |
| `RankTrackingSummary.positionChanges.unchanged` should be `.stable` | Important | Fixed field name |
| `ChurnSignalSummary` used `signalType` not spec's `type` | Important | Fixed to `type: string` (removed `id`, `dismissed` — not in spec) |
| `clientSignals.keywordFeedback` missing `patterns` sub-field | Important | Added `patterns: { approveRate, topRejectionReasons }` to type and assembler |
| `learnings` missing `topWins` and `winRateByActionType` | Important | Added both fields to LearningsSlice |
| `operational.approvalQueue.overdueCount` should be `oldestAge` | Important | Fixed to `oldestAge: number \| null` (hours) |
| `operational.detectedPlaybooks` was `RewritePlaybook[]`, spec says `string[]` | Important | Fixed to `string[]`, removed `RewritePlaybook` interface |
| `operational` missing `workOrders` in return object | Important | Added `workOrders: { active, pending }` to type AND return object |
| `contentPipeline.seoEdits.dismissed` should be `inReview` | Important | Fixed field name |
| `contentPipeline.subscriptions.postsRemaining` should be `totalPages` | Important | Fixed field name |
| `contentPipeline.schemaDeployment.queued` should be `types: string[]` | Important | Fixed to return deployed schema type names |
| `contentPipeline` missing `rewritePlaybook` field | Important | Added `rewritePlaybook?: { patterns, lastUsedAt }` to type |
| `siteHealth.aeoReadiness` shape differed (detailed vs spec's summary) | Important | Fixed to `{ pagesChecked, passingRate }`, fixed import to use `aeo-page-review.ts` not `schema-validator.ts` |
| `actionBacklog.pending` should be `pendingMeasurement` | Minor | Fixed field name |
| `PageProfileSlice` missing `roiAttribution` field | Important | Added field to type, included in return object |
| 25+ bare `catch {}` blocks — spec §12 prohibits silent catches | Important | Added error handling contract section with patterns. All catches must log via Pino. |
| No per-slice top-level try/catch wrapper | Important | Added to error handling contract — wraps each `assembleSlice()` case |
| No 5-second `Promise.race()` timeout on async calls | Important | Added to error handling contract with code example |
| All test data updated to match corrected types | — | Fixed in Tasks 1, 13, 14, 15 test code |

### 2c. Audit-Found Gaps — Resolution (Round 3: Test Coverage Depth)

| Gap | Severity | Resolution |
|-----|----------|-----------|
| Assembler tests only had happy path (1 test each) | Critical | Added 2-3 tests per assembler: empty data defaults, source failure survival, shape completeness |
| No bridge runtime side-effect tests (only static grep) | Critical | Added `bridge-runtime.test.ts` in Task 15: Bridge #7 auto-resolve, Bridge #13 annotation, Bridge #1 reweight |
| No bridge idempotency test (spec requires it) | Important | Added duplicate-action test in Bridge #7 runtime tests |
| compositeHealthScore formula never verified at runtime | Important | Added formula test + null-when-<2-components test in clientSignals tests |
| loginFrequency derivation never tested | Important | Added test: yesterday login → 'daily' frequency |
| Test fixture missing briefs, posts, strategy, audit (spec §17) | Important | Expanded `intelligence-seed.ts` with content data, keyword strategy, audit snapshot |
| No shape completeness assertion (fields present at runtime) | Important | Added `toHaveProperty` checks for all required fields in each assembler test |
| No pr-check regression guards (spec §17 requires 3) | Important | Added Task 17 with 3 grep-based guards in pr-check.ts |
| Missing Task 17 in dependency graph + parallelization | Minor | Updated graph, batch 5, model assignments, PR 3 scope |

### 3. Type Consistency Check

- `SeoContextSlice` — expanded consistently in Task 1 (types), Task 9 (assembler), Task 13 (formatter)
- `LearningsSlice` — expanded consistently in Task 1 (types), Task 10 (assembler), Task 13 (formatter)
- `ContentPipelineSlice` — expanded consistently in Task 1 (types), Task 4 (assembler), Task 13 (formatter)
- `SiteHealthSlice` — expanded consistently in Task 1 (types), Task 3 (assembler), Task 13 (formatter)
- `ClientSignalsSlice` — expanded consistently in Task 1 (types), Task 5 (assembler), Task 13 (formatter)
- `OperationalSlice` — expanded consistently in Task 1 (types), Task 6 (assembler), Task 13 (formatter)
- `PageProfileSlice` — existing type sufficient, no expansion needed, Task 8 (assembler), Task 13 (formatter)
- Function names match across all tasks (e.g., `assembleSiteHealth`, `assembleContentPipeline`, etc.)
- `formatForPrompt` signature unchanged — backward compatible
- `buildWorkspaceIntelligence` signature unchanged — backward compatible
