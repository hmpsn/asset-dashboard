# Format Fidelity Audit & Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all confirmed data-loss gaps between the old `buildSeoContext().fullContext` path and the new `formatForPrompt()` path, add end-to-end format fidelity tests to prevent regression, audit Phase 3A tests for the same class of bug, and harden formatters against edge cases.

**Architecture:** Four workstreams: (1) fix data-loss gaps in `formatSeoContextSection` and `formatLearningsSection`, (2) wire `learningsDomain` filtering through `formatForPrompt` → `formatLearningsSection`, (3) write content-fidelity + edge-case tests for every `format*Section` function and standalone helper, (4) add pr-check and JSDoc guardrails to prevent recurrence.

**Tech Stack:** TypeScript (strict), Vitest, server/workspace-intelligence.ts, server/workspace-learnings.ts

---

## Audit Findings (what this plan fixes)

### Confirmed Data Loss — old `fullContext` → new `formatForPrompt`

| # | Gap | Severity | Location |
|---|-----|----------|----------|
| 1 | **Persona detail**: pain points, goals, objections, buyingStage, preferredContentFormat NEVER rendered at any verbosity in `formatSeoContextSection` | **Critical** | `workspace-intelligence.ts:1331-1347` |
| 2 | **Page-specific keywords**: primary keyword, secondary keywords, search intent, location override not rendered in `formatSeoContextSection` | **High** | `workspace-intelligence.ts:1374-1380` (only site keywords rendered) |
| 3 | **Domain-specific learnings**: content/strategy/technical sub-breakdowns (format comparison, avgDaysToPage1, winRateByDifficultyRange, etc.) all dropped | **High** | `workspace-intelligence.ts:1403-1447` |
| 4 | **Learnings domain filtering not wired**: `formatLearningsSection` renders ALL domains regardless of `learningsDomain` option. Old `formatLearningsForPrompt(learnings, domain)` filtered at render time. `PromptFormatOptions.learningsDomain` exists in the type but is dead code in `formatForPrompt`. | **Critical** | `workspace-intelligence.ts:1208-1209` |
| 5 | **Strong win rate** and **totalScoredActions count** dropped from learnings | **Medium** | `workspace-intelligence.ts:1419` |

### Assembled-but-Never-Rendered (new Phase 3A fields — no old-path regression)

| Formatter | Dropped fields |
|-----------|---------------|
| `formatClientSignalsSection` | keywordFeedback, contentGapVotes, businessPriorities, serviceRequests |
| `formatOperationalSection` | annotations, pendingJobs, workOrders, insightAcceptanceRate |
| `formatContentPipelineSection` | cannibalizationWarnings, per-page decay details |
| `formatSiteHealthSection` | redirectDetails, schemaValidation breakdown, per-CWV metrics (LCP/FID/CLS) |

### Runtime Safety Gaps

| Risk | Impact | Location |
|------|--------|----------|
| `Math.round(NaN * 100)` renders `"NaN%"` | Garbage in AI prompts | All formatters with win rate / percentage math |
| `roi.clickGain` undefined → `"+undefined clicks"` | Garbage in AI prompts | `formatLearningsSection` ROI block |
| Empty arrays pass `if (arr.length > 0)` but item fields may be undefined | Silent data corruption | All formatters iterating slice arrays |

### Test Coverage Gaps

| Function | Has content-fidelity test? |
|----------|---------------------------|
| `formatSeoContextSection` | Partial (brand voice only) |
| `formatInsightsSection` | Partial (severity counts only) |
| `formatLearningsSection` | Partial (win rate only) — **no domain filtering test** |
| `formatPageProfileSection` | **None** |
| `formatContentPipelineSection` | **None** |
| `formatSiteHealthSection` | **None** |
| `formatClientSignalsSection` | **None** |
| `formatOperationalSection` | **None** |
| `formatKeywordsForPrompt` | **None** |
| `formatPersonasForPrompt` | **None** |
| `formatPageMapForPrompt` | **None** |
| `formatBrandVoiceForPrompt` | **None** |
| `formatKnowledgeBaseForPrompt` | **None** |

### Deferred Items Resolved in This Plan

| Item from Phase 3B post-launch followup | Resolution |
|-----------------------------------------|------------|
| JSDoc on `SeoContextSlice.brandVoice` / `.knowledgeBase` | Task 1 sub-step |
| JSDoc explaining two-path format split | Task 1 sub-step |
| `formatSeoContextSection` verbosity audit (knowledgeBase) | Already fixed — renders at all verbosities with truncation at compact |
| Shared mock factory for `seo-context.ts` | Task 0b |

---

## Dependency Graph

```
Task 0   (rich fixture + shared mock factory)
  │
  ├─► Task 1   (fix persona + page kw + JSDoc)       ─┐
  ├─► Task 2   (fix learnings + domain filtering)     ─┤ independent, parallelizable
  └─► Task 3   (fix assembled-but-dropped × 4)        ─┘
       │
       ▼
Task 3b  (NaN/undefined guards across all formatters)
       │
       ├─► Task 4  (page profile fidelity test)        ─┐
       ├─► Task 5  (standalone helper fidelity tests)  ─┤ parallelizable
       ├─► Task 6  (Phase 3A test audit)               ─┘
       │
       ▼
Task 7   (pr-check rule for assembled-but-never-rendered)
       │
       ▼
Task 7b  (edge case + empty data tests — all formatters)
       │
       ▼
Task 8   (final verification + commit)
```

**Parallelization:** Tasks 1-3 are independent (different format functions). Tasks 4, 5, 6 are independent (different test files). Task 3b depends on Tasks 1-3 (format functions must be final before adding guards). Tasks 7, 7b depend on all fixes.

**Model assignments:** Tasks 0-3b = Sonnet (mechanical fixes). Tasks 4-5 = Sonnet (test writing). Task 6 = Opus (judgment — auditing existing tests). Task 7 = Sonnet (script). Task 7b = Sonnet (edge case tests).

---

## Task 0: Test Infrastructure — Shared Rich Intelligence Fixture + Mock Factory

**Files:**
- Create: `tests/fixtures/rich-intelligence.ts`
- Create: `tests/fixtures/seo-context-mock.ts`

This task creates two shared test infrastructure files:
1. A `WorkspaceIntelligence` object with ALL fields populated (rich fixture for format tests)
2. A shared `vi.mock` factory for `seo-context.ts` (currently duplicated across 10+ test files)

- [ ] **Step 1: Create the rich fixture file**

```typescript
// tests/fixtures/rich-intelligence.ts
import type {
  WorkspaceIntelligence,
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
  PageProfileSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  ClientSignalsSlice,
  OperationalSlice,
} from '../../shared/types/intelligence.js';

export const RICH_SEO_CONTEXT: SeoContextSlice = {
  strategy: {
    siteKeywords: ['enterprise seo', 'analytics platform', 'seo tools', 'rank tracking', 'content optimization'],
    pageMap: [
      { pagePath: '/features', primaryKeyword: 'enterprise seo', secondaryKeywords: ['seo analytics', 'seo platform'], searchIntent: 'commercial', currentPosition: 5, previousPosition: 8 },
      { pagePath: '/pricing', primaryKeyword: 'seo pricing', secondaryKeywords: ['seo cost'], searchIntent: 'transactional', currentPosition: 12, previousPosition: 15 },
    ],
    opportunities: ['voice search optimization', 'featured snippets'],
    businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
    generatedAt: '2026-03-15T00:00:00Z',
  },
  brandVoice: 'Professional, data-driven, and authoritative. No fluff or filler content.',
  businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
  personas: [
    {
      id: 'p1',
      name: 'Marketing Director',
      description: 'Mid-level executive responsible for organic growth metrics',
      painPoints: ['Proving SEO ROI to C-suite', 'Managing multiple agency relationships'],
      goals: ['Increase organic traffic 30% YoY', 'Reduce dependency on paid channels'],
      objections: ['SEO takes too long to show results', 'Hard to attribute revenue to SEO'],
      preferredContentFormat: 'case studies and data reports',
      buyingStage: 'consideration',
    },
    {
      id: 'p2',
      name: 'SEO Manager',
      description: 'Hands-on practitioner running day-to-day SEO operations',
      painPoints: ['Manual keyword tracking across 500+ pages', 'Content decay detection'],
      goals: ['Automate rank monitoring', 'Catch content decay before traffic drops'],
      objections: ['Another tool to learn', 'Integration complexity with existing stack'],
      preferredContentFormat: 'how-to guides and technical docs',
      buyingStage: 'decision',
    },
  ],
  knowledgeBase: 'We specialize in enterprise SEO analytics with real-time rank tracking and AI-powered insights.',
  pageKeywords: {
    pagePath: '/features',
    primaryKeyword: 'enterprise seo',
    secondaryKeywords: ['seo analytics', 'seo platform'],
    searchIntent: 'commercial',
    currentPosition: 5,
    previousPosition: 8,
  },
  businessProfile: {
    industry: 'SaaS / MarTech',
    goals: ['Increase enterprise market share', 'Launch APAC region'],
    targetAudience: 'VP Marketing and SEO Directors at companies with 500+ employees',
  },
  rankTracking: {
    trackedKeywords: 47,
    avgPosition: 14.3,
    positionChanges: { improved: 12, declined: 5, stable: 30 },
  },
  strategyHistory: {
    revisionsCount: 3,
    lastRevisedAt: '2026-03-10T00:00:00Z',
    trajectory: 'expanding',
  },
};

export const RICH_INSIGHTS: InsightsSlice = {
  all: [
    { id: 'ins-1', insightType: 'content_decay', severity: 'warning', impactScore: 8, pageId: '/blog/old-post', title: 'Content decay detected', description: 'Traffic down 35%' } as any,
    { id: 'ins-2', insightType: 'ranking_opportunity', severity: 'opportunity', impactScore: 6, pageId: '/services', title: 'Ranking opportunity', description: 'Page 2 keyword' } as any,
  ],
  byType: { content_decay: [{ id: 'ins-1' } as any] },
  bySeverity: { critical: 0, warning: 1, opportunity: 1, positive: 0 },
  topByImpact: [
    { id: 'ins-1', insightType: 'content_decay', severity: 'warning', impactScore: 8, pageId: '/blog/old-post' } as any,
  ],
};

export const RICH_LEARNINGS: LearningsSlice = {
  summary: {
    workspaceId: 'ws-rich',
    computedAt: '2026-03-30T00:00:00Z',
    confidence: 'high' as const,
    totalScoredActions: 25,
    content: {
      winRateByFormat: { long_form: 0.75, listicle: 0.45, case_study: 0.82 },
      avgDaysToPage1: 38,
      refreshRecoveryRate: 0.67,
      bestPerformingTopics: ['seo tips', 'rank tracking guides', 'content strategy'],
      voiceAdherenceScore: 0.85,
    },
    strategy: {
      winRateByDifficultyRange: { '0-20': 0.85, '21-40': 0.65, '41-60': 0.35 },
      winRateByCheckpoint: {},
      bestIntentTypes: ['informational', 'commercial'],
      keywordVolumeSweetSpot: { min: 500, max: 8000 },
    },
    technical: {
      winRateByFixType: { meta_tag: 0.78, schema_markup: 0.62, internal_link: 0.55 },
      schemaTypesWithRichResults: ['FAQ', 'HowTo', 'Article'],
      avgHealthScoreImprovement: 12,
      internalLinkEffectiveness: 0.72,
    },
    overall: {
      totalWinRate: 0.62,
      strongWinRate: 0.28,
      topActionTypes: [
        { type: 'content_refreshed', winRate: 0.72, count: 10 },
        { type: 'meta_updated', winRate: 0.45, count: 8 },
        { type: 'internal_link_added', winRate: 0.55, count: 5 },
      ],
      recentTrend: 'improving' as const,
    },
  },
  confidence: 'high',
  topActionTypes: [
    { type: 'content_refreshed', winRate: 0.72, count: 10 },
    { type: 'meta_updated', winRate: 0.45, count: 8 },
    { type: 'internal_link_added', winRate: 0.55, count: 5 },
  ],
  overallWinRate: 0.62,
  recentTrend: 'improving',
  playbooks: [],
  weCalledIt: [
    { actionId: 'a1', prediction: 'Title change will boost CTR', outcome: 'CTR up 23%', score: 'win', pageUrl: '/blog/seo-tips', measuredAt: '2026-03-25T00:00:00Z' },
  ],
  roiAttribution: [
    { actionId: 'a2', pageUrl: '/services', actionType: 'content_refreshed', clicksBefore: 120, clicksAfter: 185, clickGain: 65, measuredAt: '2026-03-28T00:00:00Z' },
  ],
};

export const RICH_PAGE_PROFILE: PageProfileSlice = {
  pagePath: '/features',
  primaryKeyword: 'enterprise seo',
  searchIntent: 'commercial',
  optimizationScore: 78,
  recommendations: ['Add FAQ schema', 'Increase internal links to /pricing'],
  contentGaps: ['competitor comparison table', 'pricing transparency'],
  insights: [],
  actions: [],
  auditIssues: ['Missing H2 structure', 'OG image not set'],
  optimizationIssues: ['Keyword density too low in first 100 words', 'Missing keyword in meta description'],
  primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: true },
  competitorKeywords: ['best seo tool', 'seo software comparison', 'enterprise seo platform'],
  topicCluster: 'SEO Tools',
  estimatedDifficulty: 'medium',
  schemaStatus: 'warnings',
  linkHealth: { inbound: 15, outbound: 8, orphan: false },
  seoEdits: { currentTitle: 'Enterprise SEO Platform | Features', currentMeta: 'Discover our enterprise SEO features', lastEditedAt: '2026-03-20T00:00:00Z' },
  rankHistory: { current: 5, best: 3, trend: 'down' },
  contentStatus: 'published',
  cwvStatus: 'good',
};

export const RICH_CONTENT_PIPELINE: ContentPipelineSlice = {
  briefs: { total: 12, byStatus: { draft: 3, approved: 5, in_progress: 2, published: 2 } },
  posts: { total: 8, byStatus: { draft: 2, review: 3, published: 3 } },
  matrices: { total: 2, cellsPlanned: 24, cellsPublished: 10 },
  requests: { pending: 3, inProgress: 1, delivered: 5 },
  workOrders: { active: 2 },
  coverageGaps: ['voice search optimization', 'local seo strategy'],
  seoEdits: { pending: 4, applied: 12, inReview: 2 },
  subscriptions: { active: 2, totalPages: 8 },
  schemaDeployment: { planned: 10, deployed: 6, types: ['FAQ', 'Article', 'HowTo'] },
  cannibalizationWarnings: [
    { keyword: 'seo tools', pages: ['/features', '/blog/best-seo-tools'], severity: 'medium' },
  ],
  decayAlerts: [
    { pageUrl: '/blog/old-guide', clickDrop: 45, detectedAt: '2026-03-28T00:00:00Z', hasRefreshBrief: false, isRepeatDecay: false },
  ],
};

export const RICH_SITE_HEALTH: SiteHealthSlice = {
  auditScore: 82,
  auditScoreDelta: 3,
  deadLinks: 5,
  redirectChains: 2,
  schemaErrors: 3,
  orphanPages: 1,
  cwvPassRate: { mobile: 0.73, desktop: 0.91 },
  redirectDetails: [
    { url: '/old-page', target: '/new-page', chainDepth: 1, status: 301 },
    { url: '/legacy', target: '/old-page', chainDepth: 2, status: 301 },
  ],
  schemaValidation: { valid: 15, warnings: 4, errors: 3 },
  performanceSummary: { avgLcp: 2.1, avgFid: 45, avgCls: 0.08, score: 76 },
  anomalyCount: 2,
  anomalyTypes: ['traffic_spike', 'ranking_drop'],
  seoChangeVelocity: 14,
};

export const RICH_CLIENT_SIGNALS: ClientSignalsSlice = {
  keywordFeedback: {
    approved: ['enterprise seo', 'seo analytics'],
    rejected: ['cheap seo'],
    patterns: { approveRate: 0.8, topRejectionReasons: ['too broad', 'off-brand'] },
  },
  contentGapVotes: [
    { topic: 'AI in SEO', votes: 5 },
    { topic: 'Local SEO guide', votes: 3 },
  ],
  businessPriorities: ['Launch APAC market by Q3', 'Reduce CAC by 20%'],
  approvalPatterns: { approvalRate: 0.85, avgResponseTime: 48 },
  recentChatTopics: ['content decay', 'keyword cannibalization', 'schema markup'],
  churnRisk: 'low',
  churnSignals: [
    { type: 'declining_engagement', severity: 'low', detectedAt: '2026-03-25T00:00:00Z' },
  ],
  roi: { organicValue: 15000, growth: 12, period: '30d' },
  engagement: { lastLoginAt: '2026-03-30T00:00:00Z', loginFrequency: 'daily', chatSessionCount: 15, portalUsage: null },
  compositeHealthScore: 82,
  feedbackItems: [
    { id: 'f1', type: 'feature_request', status: 'new', createdAt: '2026-03-28T00:00:00Z' },
  ],
  serviceRequests: { pending: 1, total: 4 },
};

export const RICH_OPERATIONAL: OperationalSlice = {
  recentActivity: [
    { type: 'insight_resolved', description: 'Resolved content decay on /blog/old-guide', timestamp: '2026-03-30T10:00:00Z' },
    { type: 'brief_created', description: 'Created brief for voice search optimization', timestamp: '2026-03-30T09:00:00Z' },
    { type: 'approval_completed', description: 'Approved meta updates for /pricing', timestamp: '2026-03-29T16:00:00Z' },
  ],
  annotations: [
    { date: '2026-03-15', label: 'Core algorithm update', pageUrl: undefined },
  ],
  pendingJobs: 3,
  timeSaved: { totalMinutes: 240, byFeature: { 'auto-insights': 120, 'bulk-seo-edits': 80, 'content-briefs': 40 } },
  approvalQueue: { pending: 4, oldestAge: 72 },
  recommendationQueue: { fixNow: 2, fixSoon: 5, fixLater: 8 },
  actionBacklog: { pendingMeasurement: 6, oldestAge: 168 },
  detectedPlaybooks: ['content refresh after decay', 'meta optimization sprint'],
  workOrders: { active: 2, pending: 1 },
  insightAcceptanceRate: { totalShown: 50, confirmed: 35, dismissed: 10, rate: 0.7 },
};

export const RICH_INTELLIGENCE: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-rich',
  assembledAt: '2026-03-30T12:00:00.000Z',
  seoContext: RICH_SEO_CONTEXT,
  insights: RICH_INSIGHTS,
  learnings: RICH_LEARNINGS,
  pageProfile: RICH_PAGE_PROFILE,
  contentPipeline: RICH_CONTENT_PIPELINE,
  siteHealth: RICH_SITE_HEALTH,
  clientSignals: RICH_CLIENT_SIGNALS,
  operational: RICH_OPERATIONAL,
};
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/rich-intelligence.ts
git commit -m "test: add rich intelligence fixture for format fidelity tests"
```

- [ ] **Step 4: Create shared seo-context mock factory**

Currently 10+ test files each declare their own `vi.mock('../server/seo-context.js', () => ({ ... }))`. Every new export to `seo-context.ts` requires updating all 10. Extract a shared factory:

```typescript
// tests/fixtures/seo-context-mock.ts
import { vi } from 'vitest';

/**
 * Shared mock factory for seo-context.ts.
 * Usage: vi.mock('../server/seo-context.js', () => seoContextMock());
 * Override individual fns: vi.mocked(seoContext.getRawBrandVoice).mockReturnValue('Custom');
 */
export function seoContextMock() {
  return {
    buildSeoContext: vi.fn(() => ({
      strategy: {
        siteKeywords: ['enterprise seo', 'analytics platform', 'seo tools'],
        pageMap: [{ pagePath: '/features', primaryKeyword: 'enterprise seo', secondaryKeywords: ['seo analytics'] }],
        opportunities: [],
        businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
        generatedAt: new Date().toISOString(),
      },
      brandVoiceBlock: '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nProfessional, data-driven, and authoritative. No fluff.',
      businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
      knowledgeBlock: '\n\nBUSINESS KNOWLEDGE BASE:\nWe specialize in enterprise SEO analytics.',
      personasBlock: '',
      keywordBlock: '',
      fullContext: '',
    })),
    getRawBrandVoice: vi.fn(() => 'Professional, data-driven, and authoritative. No fluff.'),
    getRawKnowledge: vi.fn(() => 'We specialize in enterprise SEO analytics.'),
    clearSeoContextCache: vi.fn(),
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/seo-context-mock.ts
git commit -m "test: add shared seo-context mock factory — replaces 10 duplicate mocks"
```

> **Note:** Migrating existing test files to use the shared factory is Task 8 (Phase 3A audit). New tests written in this plan should import from the factory.

---

## Task 1: Fix Persona Rendering in `formatSeoContextSection`

**Files:**
- Modify: `server/workspace-intelligence.ts:1331-1347`

The current code at standard verbosity renders `- Marketing Director: Mid-level executive respons...` (truncated to 60 chars). It drops pain points, goals, objections, buyingStage, and preferredContentFormat at ALL verbosity levels — even `detailed`.

The standalone `formatPersonasForPrompt` renders the full persona block matching the old `buildPersonasContext()`. `formatSeoContextSection` must match.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/format-seo-context-section.test.ts`:

```typescript
// tests/unit/format-seo-context-section.test.ts
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { RICH_SEO_CONTEXT } from '../fixtures/rich-intelligence.js';

const intel: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-test',
  assembledAt: '2026-03-30T12:00:00.000Z',
  seoContext: RICH_SEO_CONTEXT,
};

describe('formatSeoContextSection persona fidelity', () => {
  it('renders persona pain points at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('Proving SEO ROI to C-suite');
    expect(result).toContain('Manual keyword tracking across 500+ pages');
  });

  it('renders persona goals at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('Increase organic traffic 30% YoY');
    expect(result).toContain('Automate rank monitoring');
  });

  it('renders persona objections at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('SEO takes too long to show results');
    expect(result).toContain('Another tool to learn');
  });

  it('renders persona buying stage at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('consideration');
    expect(result).toContain('decision');
  });

  it('renders preferred content format at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('case studies and data reports');
    expect(result).toContain('how-to guides and technical docs');
  });

  it('renders persona pain points at standard verbosity (not just names)', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['seoContext'] });
    // Standard should include pain points, goals — the AI needs this context
    expect(result).toContain('Proving SEO ROI to C-suite');
  });

  it('compact verbosity renders names + buying stage only', () => {
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['seoContext'] });
    expect(result).toContain('Marketing Director');
    expect(result).toContain('SEO Manager');
    // Compact should NOT include pain points
    expect(result).not.toContain('Proving SEO ROI');
  });
});

describe('formatSeoContextSection page keyword fidelity', () => {
  it('renders page-specific keyword targeting at detailed verbosity when pageKeywords present', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    // Must include page-specific primary keyword, not just site-level keywords
    expect(result).toContain('enterprise seo');
    // Must include search intent
    expect(result).toContain('commercial');
  });

  it('renders secondary keywords when pageKeywords present', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('seo analytics');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/format-seo-context-section.test.ts`
Expected: Multiple FAIL — pain points, goals, objections, buying stage, preferred format all missing from output.

- [ ] **Step 3: Fix persona rendering in `formatSeoContextSection`**

In `server/workspace-intelligence.ts`, replace the persona block (lines ~1331-1347) with:

```typescript
  // Personas — always include when present
  // Must match formatPersonasForPrompt (standalone helper) for content parity
  if (ctx.personas && ctx.personas.length > 0) {
    if (verbosity === 'compact') {
      // Compact: names + buying stage only
      lines.push(`Personas: ${ctx.personas.map(p => `${p.name}${p.buyingStage ? ` (${p.buyingStage})` : ''}`).join(', ')}`);
    } else {
      // Standard + detailed: full persona detail (pain points, goals, objections)
      // AI models need this context to write audience-relevant content
      lines.push('TARGET AUDIENCE PERSONAS:');
      for (const p of ctx.personas) {
        const parts = [`  **${p.name}**${p.buyingStage ? ` (${p.buyingStage} stage)` : ''}: ${p.description}`];
        if (p.painPoints.length) parts.push(`    Pain points: ${p.painPoints.join('; ')}`);
        if (p.goals.length) parts.push(`    Goals: ${p.goals.join('; ')}`);
        if (p.objections.length) parts.push(`    Objections: ${p.objections.join('; ')}`);
        if (p.preferredContentFormat) parts.push(`    Prefers: ${p.preferredContentFormat}`);
        lines.push(parts.join('\n'));
      }
    }
  }
```

- [ ] **Step 4: Fix page-specific keyword rendering in `formatSeoContextSection`**

After the site keywords block (line ~1380), add page-specific keyword rendering:

```typescript
  // Page-specific keyword targeting — when pagePath was provided, show the page's own keywords
  if (ctx.pageKeywords) {
    const pk = ctx.pageKeywords;
    lines.push(`THIS PAGE'S TARGET: "${pk.primaryKeyword}"`);
    if (pk.secondaryKeywords?.length) {
      lines.push(`  Secondary: ${pk.secondaryKeywords.join(', ')}`);
    }
    if (pk.searchIntent) {
      lines.push(`  Intent: ${pk.searchIntent}`);
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/format-seo-context-section.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: 1406+ pass, 6 ECONNREFUSED (baseline)

- [ ] **Step 7: Add JSDoc on raw fields + two-path format split comment**

In `shared/types/intelligence.ts`, add JSDoc to `SeoContextSlice`:

```typescript
export interface SeoContextSlice {
  strategy: KeywordStrategy | undefined;
  /** Raw text — no headers. Use formatBrandVoiceForPrompt() before injecting into prompts.
   *  formatSeoContextSection renders this with an emphatic BRAND VOICE header automatically. */
  brandVoice: string;
  businessContext: string;
  personas: AudiencePersona[];
  /** Raw text — no headers. Use formatKnowledgeBaseForPrompt() before injecting into prompts.
   *  formatSeoContextSection renders this with a KNOWLEDGE BASE header automatically. */
  knowledgeBase: string;
```

In `server/workspace-intelligence.ts`, add a comment block above `formatSeoContextSection`:

```typescript
/**
 * Renders SeoContextSlice as a `## SEO Context` summary block for formatForPrompt().
 *
 * TWO-PATH FORMAT SPLIT: Callers using formatForPrompt() get this combined block.
 * Callers that need individual fields at different prompt positions use the standalone
 * helpers instead: formatBrandVoiceForPrompt(), formatKeywordsForPrompt(), etc.
 * These intentionally produce DIFFERENT output (standalone helpers add emphatic standalone
 * headers; this function renders compact inline labels within the ## SEO Context block).
 */
```

- [ ] **Step 8: Commit**

```bash
git add server/workspace-intelligence.ts shared/types/intelligence.ts tests/unit/format-seo-context-section.test.ts
git commit -m "fix: formatSeoContextSection renders full persona detail + page keywords

Persona pain points, goals, objections, buying stage, and preferred content
format were silently dropped at all verbosity levels. Page-specific keyword
targeting (primary, secondary, intent) was assembled but never rendered.
Both now match the old buildSeoContext().fullContext output.

Also adds JSDoc on raw SeoContextSlice fields and documents the two-path
format split to prevent future confusion."
```

---

## Task 2: Fix Learnings — Domain Filtering + Domain-Specific Rendering

**Files:**
- Modify: `server/workspace-intelligence.ts:1208-1209` (wire domain through formatForPrompt)
- Modify: `server/workspace-intelligence.ts:1403-1447` (formatLearningsSection)

**Two bugs to fix:**

1. `formatLearningsSection` renders only headline metrics — drops strong win rate, totalScoredActions, and ALL domain-specific learnings (content/strategy/technical breakdowns).

2. **Critical:** `formatForPrompt` never passes `opts.learningsDomain` to `formatLearningsSection`. The field exists in `PromptFormatOptions` but is dead code. Old `formatLearningsForPrompt(learnings, domain)` filtered at render time — e.g., `content-posts-ai.ts` passes `learningsDomain: 'content'` to get only content learnings. Without domain filtering, every caller gets ALL domains, polluting context with irrelevant learnings.

**Root cause confirmed:** `getWorkspaceLearnings(workspaceId, _domain)` ignores the domain parameter (underscore-prefixed). It always returns the full `WorkspaceLearnings` with all domain sub-objects. Domain filtering was always a render-time operation in the old path.

The old `formatLearningsForPrompt` in `workspace-learnings.ts` (lines 481-605) rendered rich domain-specific detail. The new formatter must produce equivalent output.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/format-seo-context-section.test.ts` (rename file to `format-section-fidelity.test.ts` if desired, or create a new file `tests/unit/format-learnings-section.test.ts`):

```typescript
// tests/unit/format-learnings-section.test.ts
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { RICH_LEARNINGS } from '../fixtures/rich-intelligence.js';

const intel: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-test',
  assembledAt: '2026-03-30T12:00:00.000Z',
  learnings: RICH_LEARNINGS,
  // Provide minimal seoContext to avoid cold-start detection
  seoContext: {
    strategy: undefined,
    brandVoice: 'Test voice',
    businessContext: 'Test context',
    personas: [],
    knowledgeBase: '',
  },
};

describe('formatLearningsSection fidelity', () => {
  it('renders strong win rate alongside overall', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    // Old: "Overall win rate: 62% (28% strong wins)"
    expect(result).toContain('62%');
    expect(result).toContain('28%');
  });

  it('renders totalScoredActions count', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    // Old: "WORKSPACE LEARNINGS (25 tracked outcomes, high confidence):"
    expect(result).toContain('25');
  });

  it('renders content domain learnings at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    // avgDaysToPage1
    expect(result).toContain('38');
    // bestPerformingTopics
    expect(result).toContain('seo tips');
    // refreshRecoveryRate
    expect(result).toContain('67%');
  });

  it('renders strategy domain learnings at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    // winRateByDifficultyRange — best range
    expect(result).toContain('0-20');
    // bestIntentTypes
    expect(result).toContain('informational');
    // keywordVolumeSweetSpot
    expect(result).toContain('500');
    expect(result).toContain('8000');
  });

  it('renders technical domain learnings at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    // schemaTypesWithRichResults
    expect(result).toContain('FAQ');
    expect(result).toContain('HowTo');
    // avgHealthScoreImprovement
    expect(result).toContain('12');
    // internalLinkEffectiveness
    expect(result).toContain('72%');
  });

  it('renders format comparison for content learnings', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    // case_study outperforms long_form: "case study outperforms long form (82% vs 75%)"
    expect(result).toContain('82%');
    expect(result).toContain('75%');
  });

  it('standard verbosity includes domain learnings summary (not just action types)', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['learnings'] });
    // Standard should include at least the top domain insight per domain
    expect(result).toContain('content_refreshed');
    // Should include strong win rate
    expect(result).toContain('28%');
  });

  it('compact verbosity renders only headline metrics', () => {
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['learnings'] });
    expect(result).toContain('62%');
    // Should NOT include domain-specific details
    expect(result).not.toContain('avgDaysToPage1');
    expect(result).not.toContain('seo tips');
  });

  // ── Domain filtering ──────────────────────────────────────────────────

  it('domain=content renders ONLY content learnings (not strategy or technical)', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'], learningsDomain: 'content' });
    // Content-specific: avgDaysToPage1, bestPerformingTopics, refreshRecoveryRate
    expect(result).toContain('38');
    expect(result).toContain('seo tips');
    // Must NOT include strategy or technical
    expect(result).not.toContain('0-20'); // winRateByDifficultyRange
    expect(result).not.toContain('Best intent types');
    expect(result).not.toContain('schema_markup'); // winRateByFixType
    expect(result).not.toContain('Schema types producing');
  });

  it('domain=strategy renders ONLY strategy learnings (not content or technical)', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'], learningsDomain: 'strategy' });
    // Strategy-specific: winRateByDifficultyRange, keywordVolumeSweetSpot, bestIntentTypes
    expect(result).toContain('0-20');
    expect(result).toContain('informational');
    // Must NOT include content or technical
    expect(result).not.toContain('seo tips');
    expect(result).not.toContain('page 1');
    expect(result).not.toContain('Schema types producing');
  });

  it('domain=all renders all domains', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'], learningsDomain: 'all' });
    expect(result).toContain('seo tips'); // content
    expect(result).toContain('0-20'); // strategy
    expect(result).toContain('FAQ'); // technical
  });

  it('default domain (no learningsDomain param) renders all domains', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('seo tips'); // content
    expect(result).toContain('0-20'); // strategy
    expect(result).toContain('FAQ'); // technical
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/format-learnings-section.test.ts`
Expected: Multiple FAIL — strong win rate, totalScoredActions, domain-specific details all missing.

- [ ] **Step 3: Wire domain through formatForPrompt → formatLearningsSection**

In `formatForPrompt` (line ~1208), change:
```typescript
// BEFORE:
sections.push(formatLearningsSection(intelligence.learnings, verbosity));

// AFTER:
sections.push(formatLearningsSection(intelligence.learnings, verbosity, opts?.learningsDomain ?? 'all'));
```

Update `formatLearningsSection` signature:
```typescript
// BEFORE:
function formatLearningsSection(learnings: LearningsSlice, verbosity: PromptVerbosity): string {

// AFTER:
function formatLearningsSection(learnings: LearningsSlice, verbosity: PromptVerbosity, domain: 'content' | 'strategy' | 'technical' | 'all' = 'all'): string {
```

- [ ] **Step 4: Implement the full fix**

Replace `formatLearningsSection` in `server/workspace-intelligence.ts` (lines ~1403-1447):

```typescript
function formatLearningsSection(learnings: LearningsSlice, verbosity: PromptVerbosity, domain: 'content' | 'strategy' | 'technical' | 'all' = 'all'): string {
  const hasBaseContent = !!learnings.recentTrend || !!learnings.confidence || learnings.overallWinRate > 0;
  const hasStandardContent = learnings.topActionTypes.length > 0 || (learnings.weCalledIt?.length ?? 0) > 0;
  const hasDetailedContent = (learnings.roiAttribution?.length ?? 0) > 0 || !!learnings.summary?.content || !!learnings.summary?.strategy || !!learnings.summary?.technical;
  const willRender =
    hasBaseContent ||
    ((verbosity === 'standard' || verbosity === 'detailed') && hasStandardContent) ||
    (verbosity === 'detailed' && hasDetailedContent);
  if (!willRender) return '';

  const lines: string[] = [];
  const summary = learnings.summary;

  // Header with scored actions count (matches old formatLearningsForPrompt)
  const totalActions = summary?.totalScoredActions ?? 0;
  lines.push(`## Outcome Learnings${totalActions > 0 ? ` (${totalActions} tracked outcomes, ${learnings.confidence ?? 'unknown'} confidence)` : ''}`);

  if (learnings.recentTrend && learnings.recentTrend !== 'stable') lines.push(`Trend: ${learnings.recentTrend}`);

  // Overall win rate with strong wins (matches old: "62% (28% strong wins)")
  if (learnings.overallWinRate > 0) {
    const strongRate = summary?.overall?.strongWinRate;
    const strongSuffix = strongRate != null ? ` (${Math.round(strongRate * 100)}% strong wins)` : '';
    lines.push(`Overall win rate: ${Math.round(learnings.overallWinRate * 100)}%${strongSuffix}`);
  }

  if (verbosity === 'detailed' || verbosity === 'standard') {
    if (learnings.topActionTypes.length > 0) {
      lines.push('Win rates by action type:');
      for (const { type, winRate, count } of learnings.topActionTypes) {
        lines.push(`  ${type}: ${Math.round(winRate * 100)}% (${count} actions)`);
      }
    }

    // Domain-specific learnings from summary (matches old formatLearningsForPrompt)
    // Domain filtering: only render domains matching the requested learningsDomain
    if (summary) {
      // Content learnings
      if ((domain === 'content' || domain === 'all') && summary.content) {
        const c = summary.content;
        const topFormats = Object.entries(c.winRateByFormat)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2);
        if (topFormats.length >= 2) {
          const [f1, r1] = topFormats[0];
          const [f2, r2] = topFormats[1];
          lines.push(`${f1.replace(/_/g, ' ')} outperforms ${f2.replace(/_/g, ' ')} (${Math.round(r1 * 100)}% vs ${Math.round(r2 * 100)}% win rate)`);
        }
        if (c.avgDaysToPage1 != null) lines.push(`Content reaches page 1 in ~${c.avgDaysToPage1} days on average`);
        if (c.refreshRecoveryRate > 0) lines.push(`Content refreshes recover traffic ${Math.round(c.refreshRecoveryRate * 100)}% of the time`);
        if (c.bestPerformingTopics.length > 0) lines.push(`Best performing topics: ${c.bestPerformingTopics.slice(0, 3).join(', ')}`);
      }

      // Strategy learnings
      if ((domain === 'strategy' || domain === 'all') && summary.strategy) {
        const s = summary.strategy;
        const topDifficulty = Object.entries(s.winRateByDifficultyRange).sort((a, b) => b[1] - a[1]).slice(0, 1);
        if (topDifficulty.length > 0) {
          const [range, rate] = topDifficulty[0];
          lines.push(`Keywords with difficulty ${range} have highest win rate (${Math.round(rate * 100)}%)`);
        }
        if (s.keywordVolumeSweetSpot) lines.push(`Optimal keyword volume range: ${s.keywordVolumeSweetSpot.min}–${s.keywordVolumeSweetSpot.max}/month`);
        if (s.bestIntentTypes.length > 0) lines.push(`Best intent types: ${s.bestIntentTypes.join(', ')}`);
      }

      // Technical learnings
      if ((domain === 'technical' || domain === 'all') && summary.technical) {
        const t = summary.technical;
        const topFix = Object.entries(t.winRateByFixType).sort((a, b) => b[1] - a[1]).slice(0, 1);
        if (topFix.length > 0) {
          const [fixType, rate] = topFix[0];
          lines.push(`${fixType.replace(/_/g, ' ')} has highest technical win rate (${Math.round(rate * 100)}%)`);
        }
        if (t.schemaTypesWithRichResults.length > 0) lines.push(`Schema types producing rich results: ${t.schemaTypesWithRichResults.join(', ')}`);
        if (t.avgHealthScoreImprovement > 0) lines.push(`Average health score improvement: +${t.avgHealthScoreImprovement}`);
        if (t.internalLinkEffectiveness > 0) lines.push(`Internal link additions improve rankings ${Math.round(t.internalLinkEffectiveness * 100)}% of the time`);
      }
    }

    // WeCalledIt proven predictions
    if (learnings.weCalledIt && learnings.weCalledIt.length > 0) {
      lines.push('Proven predictions:');
      for (const entry of learnings.weCalledIt.slice(0, verbosity === 'detailed' ? 5 : 3)) {
        lines.push(`  - ${entry.prediction} → ${entry.score}${entry.pageUrl ? ` (${entry.pageUrl})` : ''}`);
      }
    }

    // ROI attribution — detailed only
    if (learnings.roiAttribution && learnings.roiAttribution.length > 0 && verbosity === 'detailed') {
      lines.push('ROI highlights:');
      for (const roi of learnings.roiAttribution.slice(0, 5)) {
        lines.push(`  - ${roi.actionType} on ${roi.pageUrl}: +${roi.clickGain} clicks`);
      }
    }
  }

  // Cap at 15 content lines (after header) to stay within token budget
  if (lines.length > 16) {
    return [...lines.slice(0, 16), '  (additional learnings truncated)'].join('\n');
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/format-learnings-section.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: 1406+ pass, 6 ECONNREFUSED (baseline). Check `format-for-prompt.test.ts` specifically — it verifies win rates and action types which should still pass with the richer output.

- [ ] **Step 6: Commit**

```bash
git add server/workspace-intelligence.ts tests/unit/format-learnings-section.test.ts
git commit -m "fix: formatLearningsSection renders domain-specific learnings + strong win rate

Was only rendering headline metrics (trend, confidence, overall win rate,
top action types). Now renders content/strategy/technical domain breakdowns
(format comparison, avgDaysToPage1, winRateByDifficultyRange, etc.),
strong win rate, and totalScoredActions count — matching old
formatLearningsForPrompt output."
```

---

## Task 3: Render Assembled-but-Dropped Fields in Remaining Formatters

**Files:**
- Modify: `server/workspace-intelligence.ts` — 4 format functions

These are Phase 3A fields that were assembled but never rendered. Not a regression from the old path, but wasted DB queries and lost context.

**Decision per field:**

| Formatter | Field | Action |
|-----------|-------|--------|
| `formatClientSignalsSection` | `keywordFeedback` | **Render** at detailed — shows client keyword preferences |
| `formatClientSignalsSection` | `contentGapVotes` | **Render** at detailed — shows what topics client wants |
| `formatClientSignalsSection` | `businessPriorities` | **Render** at standard+ — high-value context |
| `formatClientSignalsSection` | `serviceRequests` | **Render** at standard+ — operational signal |
| `formatOperationalSection` | `annotations` | **Render** at detailed — provides timeline context |
| `formatOperationalSection` | `pendingJobs` | **Render** at standard+ — operational state |
| `formatOperationalSection` | `workOrders` | **Render** at standard+ — operational state |
| `formatOperationalSection` | `insightAcceptanceRate` | **Render** at detailed — adoption signal |
| `formatContentPipelineSection` | `cannibalizationWarnings` | **Render** at detailed — SEO-critical |
| `formatContentPipelineSection` | decay alert details | **Render** at detailed — page URLs + drop % |
| `formatSiteHealthSection` | `redirectDetails` | **Skip** — too granular for prompt context |
| `formatSiteHealthSection` | `schemaValidation` breakdown | **Render** at detailed — valid/warning/error counts |
| `formatSiteHealthSection` | CWV metrics (LCP/FID/CLS) | **Render** at detailed — actionable perf data |

- [ ] **Step 1: Write failing tests**

Create `tests/unit/format-remaining-sections.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import {
  RICH_SEO_CONTEXT,
  RICH_CLIENT_SIGNALS,
  RICH_OPERATIONAL,
  RICH_CONTENT_PIPELINE,
  RICH_SITE_HEALTH,
} from '../fixtures/rich-intelligence.js';

// Minimal seoContext to avoid cold-start
const minSeo = { ...RICH_SEO_CONTEXT, personas: [], pageKeywords: undefined };

describe('formatClientSignalsSection assembled fields', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-t', assembledAt: '2026-03-30T00:00:00Z',
    seoContext: minSeo,
    clientSignals: RICH_CLIENT_SIGNALS,
  };

  it('renders businessPriorities at standard verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['clientSignals'] });
    expect(result).toContain('Launch APAC');
  });

  it('renders keywordFeedback at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['clientSignals'] });
    expect(result).toContain('enterprise seo');
    expect(result).toContain('80%');
  });

  it('renders contentGapVotes at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['clientSignals'] });
    expect(result).toContain('AI in SEO');
  });

  it('renders serviceRequests at standard verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['clientSignals'] });
    expect(result).toContain('1 pending');
  });
});

describe('formatOperationalSection assembled fields', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-t', assembledAt: '2026-03-30T00:00:00Z',
    seoContext: minSeo,
    operational: RICH_OPERATIONAL,
  };

  it('renders pendingJobs at standard verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['operational'] });
    expect(result).toContain('3');
  });

  it('renders annotations at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['operational'] });
    expect(result).toContain('Core algorithm update');
  });

  it('renders insightAcceptanceRate at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['operational'] });
    expect(result).toContain('70%');
  });

  it('renders workOrders at standard verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['operational'] });
    expect(result).toContain('work order');
  });
});

describe('formatContentPipelineSection assembled fields', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-t', assembledAt: '2026-03-30T00:00:00Z',
    seoContext: minSeo,
    contentPipeline: RICH_CONTENT_PIPELINE,
  };

  it('renders cannibalization warnings at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['contentPipeline'] });
    expect(result).toContain('seo tools');
    expect(result).toContain('cannibalization');
  });

  it('renders decay alert page URLs at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['contentPipeline'] });
    expect(result).toContain('/blog/old-guide');
    expect(result).toContain('45');
  });
});

describe('formatSiteHealthSection assembled fields', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-t', assembledAt: '2026-03-30T00:00:00Z',
    seoContext: minSeo,
    siteHealth: RICH_SITE_HEALTH,
  };

  it('renders schema validation breakdown at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['siteHealth'] });
    expect(result).toContain('15 valid');
  });

  it('renders CWV metrics at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['siteHealth'] });
    expect(result).toContain('LCP');
    expect(result).toContain('2.1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/format-remaining-sections.test.ts`
Expected: Multiple FAIL

- [ ] **Step 3: Fix `formatClientSignalsSection`**

Add to `formatClientSignalsSection` in `server/workspace-intelligence.ts`:

After the existing `verbosity !== 'compact'` block (line ~1525), add inside it:

```typescript
    if (signals.businessPriorities.length > 0) {
      lines.push(`Business priorities: ${signals.businessPriorities.join('; ')}`);
    }
    if (signals.serviceRequests) {
      lines.push(`Service requests: ${signals.serviceRequests.pending} pending, ${signals.serviceRequests.total} total`);
    }
```

After the existing `verbosity === 'detailed'` block content, add:

```typescript
    if (signals.keywordFeedback.approved.length > 0 || signals.keywordFeedback.rejected.length > 0) {
      lines.push(`Keyword feedback: ${Math.round(signals.keywordFeedback.patterns.approveRate * 100)}% approve rate`);
      if (signals.keywordFeedback.approved.length > 0) {
        lines.push(`  Approved: ${signals.keywordFeedback.approved.slice(0, 5).join(', ')}`);
      }
      if (signals.keywordFeedback.patterns.topRejectionReasons.length > 0) {
        lines.push(`  Top rejection reasons: ${signals.keywordFeedback.patterns.topRejectionReasons.join(', ')}`);
      }
    }
    if (signals.contentGapVotes.length > 0) {
      lines.push(`Content gap votes: ${signals.contentGapVotes.slice(0, 5).map(v => `${v.topic} (${v.votes})`).join(', ')}`);
    }
```

- [ ] **Step 4: Fix `formatOperationalSection`**

Add to `formatOperationalSection`:

Inside `verbosity !== 'compact'` block:

```typescript
    if (ops.pendingJobs > 0) {
      lines.push(`Background jobs: ${ops.pendingJobs} pending`);
    }
    if (ops.workOrders) {
      lines.push(`Work orders: ${ops.workOrders.active} active, ${ops.workOrders.pending} pending`);
    }
```

Inside `verbosity === 'detailed'` block:

```typescript
    if (ops.annotations.length > 0) {
      lines.push('Timeline annotations:');
      for (const a of ops.annotations.slice(0, 5)) {
        lines.push(`  - ${a.date}: ${a.label}`);
      }
    }
    if (ops.insightAcceptanceRate) {
      lines.push(`Insight acceptance rate: ${Math.round(ops.insightAcceptanceRate.rate * 100)}% (${ops.insightAcceptanceRate.confirmed}/${ops.insightAcceptanceRate.totalShown})`);
    }
```

- [ ] **Step 5: Fix `formatContentPipelineSection`**

Inside `verbosity === 'detailed'` block, add:

```typescript
    if (pipeline.cannibalizationWarnings && pipeline.cannibalizationWarnings.length > 0) {
      lines.push('Keyword cannibalization:');
      for (const cw of pipeline.cannibalizationWarnings.slice(0, 5)) {
        lines.push(`  - "${cw.keyword}" [${cw.severity}]: ${cw.pages.join(', ')}`);
      }
    }
    if (pipeline.decayAlerts && pipeline.decayAlerts.length > 0) {
      lines.push('Decay alert details:');
      for (const da of pipeline.decayAlerts.slice(0, 5)) {
        lines.push(`  - ${da.pageUrl}: -${da.clickDrop}% clicks${da.isRepeatDecay ? ' (repeat decay)' : ''}`);
      }
    }
```

- [ ] **Step 6: Fix `formatSiteHealthSection`**

Inside `verbosity === 'detailed'` block, add:

```typescript
    if (health.schemaValidation) {
      lines.push(`Schema validation: ${health.schemaValidation.valid} valid, ${health.schemaValidation.warnings} warnings, ${health.schemaValidation.errors} errors`);
    }
    if (health.performanceSummary) {
      const ps = health.performanceSummary;
      const parts: string[] = [];
      if (ps.avgLcp != null) parts.push(`LCP: ${ps.avgLcp.toFixed(1)}s`);
      if (ps.avgFid != null) parts.push(`FID: ${ps.avgFid}ms`);
      if (ps.avgCls != null) parts.push(`CLS: ${ps.avgCls.toFixed(2)}`);
      if (parts.length > 0) lines.push(`Core Web Vitals: ${parts.join(', ')}`);
    }
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/unit/format-remaining-sections.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run`
Expected: 1406+ pass, 6 ECONNREFUSED (baseline)

- [ ] **Step 9: Commit**

```bash
git add server/workspace-intelligence.ts tests/unit/format-remaining-sections.test.ts
git commit -m "fix: render assembled-but-dropped fields in 4 format functions

formatClientSignalsSection: +keywordFeedback, contentGapVotes,
businessPriorities, serviceRequests
formatOperationalSection: +annotations, pendingJobs, workOrders,
insightAcceptanceRate
formatContentPipelineSection: +cannibalizationWarnings, decay details
formatSiteHealthSection: +schemaValidation breakdown, CWV metrics"
```

---

## Task 3b: NaN/Undefined Guards Across All Formatters

**Files:**
- Modify: `server/workspace-intelligence.ts` (all format functions)

Audit found that `Math.round(NaN * 100)` renders `"NaN%"` and undefined numeric fields render as `"+undefined clicks"`. Add defensive guards.

- [ ] **Step 1: Create a safe percentage helper**

Add near the top of the formatter section in `workspace-intelligence.ts`:

```typescript
/** Safely format a 0-1 rate as a percentage string. Returns 'n/a' for NaN/null/undefined. */
function pct(rate: number | null | undefined): string {
  if (rate == null || isNaN(rate)) return 'n/a';
  return `${Math.round(rate * 100)}%`;
}
```

- [ ] **Step 2: Replace all raw `Math.round(x * 100)%` calls with `pct(x)`**

Search `server/workspace-intelligence.ts` for all instances of `Math.round(` inside format functions and replace with `pct()` where the value is a 0-1 rate. Key locations:

- `formatLearningsSection`: `overallWinRate`, `strongWinRate`, `winRate` in topActionTypes, `winRateByFormat` entries, `refreshRecoveryRate`, `winRateByDifficultyRange`, `internalLinkEffectiveness`, `winRateByFixType`
- `formatClientSignalsSection`: `approvalRate`, `keywordFeedback.patterns.approveRate`
- `formatOperationalSection`: `insightAcceptanceRate.rate`

- [ ] **Step 3: Guard numeric fields in ROI attribution**

```typescript
// BEFORE:
lines.push(`  - ${roi.actionType} on ${roi.pageUrl}: +${roi.clickGain} clicks`);

// AFTER:
lines.push(`  - ${roi.actionType} on ${roi.pageUrl}: +${roi.clickGain ?? 0} clicks`);
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS (guards are additive — no behavior change for valid data)

- [ ] **Step 5: Commit**

```bash
git add server/workspace-intelligence.ts
git commit -m "fix: add NaN/undefined guards in all format functions

Math.round(NaN * 100) renders 'NaN%' and undefined fields render as
'+undefined clicks'. Add pct() safe percentage helper and null-coalesce
all numeric template interpolations."
```

---

## Task 4: Comprehensive Page Profile Fidelity Test

**Files:**
- Create: `tests/unit/format-page-profile-section.test.ts`

`formatPageProfileSection` is the most complex formatter. Test every field at all 3 verbosity levels.

- [ ] **Step 1: Write comprehensive fidelity test**

```typescript
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { RICH_SEO_CONTEXT, RICH_PAGE_PROFILE } from '../fixtures/rich-intelligence.js';

const minSeo = { ...RICH_SEO_CONTEXT, personas: [], pageKeywords: undefined };

const intel: WorkspaceIntelligence = {
  version: 1, workspaceId: 'ws-t', assembledAt: '2026-03-30T00:00:00Z',
  seoContext: minSeo,
  pageProfile: RICH_PAGE_PROFILE,
};

describe('formatPageProfileSection fidelity', () => {
  it('renders page path and primary keyword at all verbosities', () => {
    for (const verbosity of ['compact', 'standard', 'detailed'] as const) {
      const result = formatForPrompt(intel, { verbosity, sections: ['pageProfile'] });
      expect(result).toContain('/features');
      expect(result).toContain('enterprise seo');
    }
  });

  it('renders optimization score at all verbosities', () => {
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['pageProfile'] });
    expect(result).toContain('78');
  });

  it('renders rank position and trend at standard+', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['pageProfile'] });
    expect(result).toContain('5');
    expect(result).toContain('down');
  });

  it('renders optimization issues at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('Keyword density too low');
  });

  it('renders recommendations at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('Add FAQ schema');
  });

  it('renders content gaps at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('competitor comparison table');
  });

  it('renders keyword presence gaps at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('meta');
  });

  it('renders competitor keywords at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('best seo tool');
  });

  it('renders schema/content/cwv status at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('warnings');
    expect(result).toContain('published');
    expect(result).toContain('good');
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/unit/format-page-profile-section.test.ts`
Expected: ALL PASS (page profile formatter should already render these — this test CONFIRMS coverage)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/format-page-profile-section.test.ts
git commit -m "test: add page profile format fidelity tests (all fields, all verbosities)"
```

---

## Task 5: Standalone Helper Fidelity Tests

**Files:**
- Create: `tests/unit/format-standalone-helpers.test.ts`

Tests for all 5 standalone helpers. These helpers are used by callers that need individual formatted blocks (not the combined `formatForPrompt` output).

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  formatBrandVoiceForPrompt,
  formatKnowledgeBaseForPrompt,
  formatKeywordsForPrompt,
  formatPersonasForPrompt,
  formatPageMapForPrompt,
} from '../../server/workspace-intelligence.js';
import { RICH_SEO_CONTEXT } from '../fixtures/rich-intelligence.js';

describe('formatBrandVoiceForPrompt', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatBrandVoiceForPrompt(null)).toBe('');
    expect(formatBrandVoiceForPrompt(undefined)).toBe('');
    expect(formatBrandVoiceForPrompt('')).toBe('');
  });

  it('wraps brand voice in emphatic header', () => {
    const result = formatBrandVoiceForPrompt('Professional and data-driven.');
    expect(result).toContain('BRAND VOICE');
    expect(result).toContain('MUST match');
    expect(result).toContain('Professional and data-driven.');
  });
});

describe('formatKnowledgeBaseForPrompt', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatKnowledgeBaseForPrompt(null)).toBe('');
    expect(formatKnowledgeBaseForPrompt(undefined)).toBe('');
    expect(formatKnowledgeBaseForPrompt('')).toBe('');
  });

  it('wraps knowledge in emphatic header', () => {
    const result = formatKnowledgeBaseForPrompt('We specialize in enterprise SEO.');
    expect(result).toContain('BUSINESS KNOWLEDGE BASE');
    expect(result).toContain('We specialize in enterprise SEO.');
  });
});

describe('formatKeywordsForPrompt', () => {
  it('returns empty string for null/undefined', () => {
    expect(formatKeywordsForPrompt(null)).toBe('');
    expect(formatKeywordsForPrompt(undefined)).toBe('');
  });

  it('renders site target keywords', () => {
    const result = formatKeywordsForPrompt(RICH_SEO_CONTEXT);
    expect(result).toContain('Site target keywords');
    expect(result).toContain('enterprise seo');
    expect(result).toContain('analytics platform');
  });

  it('renders page-specific keyword targeting when pageKeywords present', () => {
    const result = formatKeywordsForPrompt(RICH_SEO_CONTEXT);
    expect(result).toContain('enterprise seo');
  });

  it('renders business context from strategy', () => {
    const result = formatKeywordsForPrompt(RICH_SEO_CONTEXT);
    expect(result).toContain('Fortune 500');
  });
});

describe('formatPersonasForPrompt', () => {
  it('returns empty string for null/undefined/empty array', () => {
    expect(formatPersonasForPrompt(null)).toBe('');
    expect(formatPersonasForPrompt(undefined)).toBe('');
    expect(formatPersonasForPrompt([])).toBe('');
  });

  it('renders persona names and descriptions', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('Marketing Director');
    expect(result).toContain('SEO Manager');
  });

  it('renders pain points', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('Proving SEO ROI to C-suite');
    expect(result).toContain('Manual keyword tracking');
  });

  it('renders goals', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('Increase organic traffic');
    expect(result).toContain('Automate rank monitoring');
  });

  it('renders objections', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('SEO takes too long');
    expect(result).toContain('Another tool to learn');
  });

  it('renders buying stage', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('consideration');
    expect(result).toContain('decision');
  });

  it('renders preferred content format', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('case studies');
    expect(result).toContain('how-to guides');
  });

  it('includes TARGET AUDIENCE header', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('TARGET AUDIENCE PERSONAS');
  });
});

describe('formatPageMapForPrompt', () => {
  it('returns empty string for null/undefined', () => {
    expect(formatPageMapForPrompt(null)).toBe('');
    expect(formatPageMapForPrompt(undefined)).toBe('');
  });

  it('renders page-to-keyword map', () => {
    const result = formatPageMapForPrompt(RICH_SEO_CONTEXT);
    expect(result).toContain('/features');
    expect(result).toContain('enterprise seo');
  });

  it('renders cannibalization warning header', () => {
    const result = formatPageMapForPrompt(RICH_SEO_CONTEXT);
    expect(result).toContain('KEYWORD');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/format-standalone-helpers.test.ts`
Expected: ALL PASS (these helpers already render correctly — this is coverage confirmation)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/format-standalone-helpers.test.ts
git commit -m "test: add fidelity tests for all 5 standalone format helpers"
```

---

## Task 6: Phase 3A Test Audit

**Files:**
- Modify: `tests/unit/format-for-prompt.test.ts`
- Modify: `tests/intel-prompt-equivalence.test.ts` (if needed)

The existing Phase 3A tests use sparse fixtures that don't catch rendering completeness. Audit and strengthen them.

- [ ] **Step 1: Read existing test fixtures**

Read `tests/unit/format-for-prompt.test.ts` and compare `richIntelligence` fixture against `RICH_INTELLIGENCE` from Task 0. List every field that the existing fixture has as empty/missing that the rich fixture populates.

- [ ] **Step 2: Upgrade `format-for-prompt.test.ts` to use rich fixture**

Replace the sparse `richIntelligence` fixture with `RICH_INTELLIGENCE` import. Update assertions to verify:
- Persona detail appears (not just brand voice)
- Site keyword names appear (not just count)
- Domain-specific learnings appear at detailed verbosity
- Page profile fields appear when slice is present

```typescript
import { RICH_INTELLIGENCE, RICH_SEO_CONTEXT } from '../fixtures/rich-intelligence.js';

// Replace richIntelligence with RICH_INTELLIGENCE in all tests
// Add new assertions:

it('includes persona pain points at standard verbosity', () => {
  const result = formatForPrompt(RICH_INTELLIGENCE, { verbosity: 'standard' });
  expect(result).toContain('Proving SEO ROI');
});

it('includes domain-specific learnings at detailed verbosity', () => {
  const result = formatForPrompt(RICH_INTELLIGENCE, { verbosity: 'detailed' });
  expect(result).toContain('seo tips'); // bestPerformingTopics
  expect(result).toContain('informational'); // bestIntentTypes
});

it('includes site keyword names (not just count)', () => {
  const result = formatForPrompt(RICH_INTELLIGENCE, { verbosity: 'standard' });
  expect(result).toContain('enterprise seo');
  expect(result).not.toMatch(/\d+ site keywords/); // should never show just a count
});
```

- [ ] **Step 3: Audit `intel-prompt-equivalence.test.ts`**

Read each test. For any that check only surface-level presence ("contains 'Professional'"), add deeper checks. Particularly:
- Test 1 (brand voice): also check emphatic header is present
- Test 3 (knowledge base): also check emphatic header is present
- Test 4 (site keywords): already fixed ✓
- Test 6 (learnings): add check for domain-specific content

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS (the fixes from Tasks 1-3 ensure the richer assertions pass)

- [ ] **Step 5: Commit**

```bash
git add tests/unit/format-for-prompt.test.ts tests/intel-prompt-equivalence.test.ts
git commit -m "test: audit and strengthen Phase 3A format tests with rich fixtures

Replace sparse test fixtures with RICH_INTELLIGENCE import. Add assertions
for persona detail, domain-specific learnings, keyword names, and emphatic
headers — the gaps that let the Phase 3B data loss bugs ship undetected."
```

---

## Task 7: pr-check Rule for Assembled-but-Never-Rendered

**Files:**
- Modify: `scripts/pr-check.ts`

Add a check that warns when a slice interface in `shared/types/intelligence.ts` has fields not referenced in the corresponding `format*Section` function. This prevents future "assembled but silently dropped" bugs.

- [ ] **Step 1: Read current pr-check.ts**

Read `scripts/pr-check.ts` to understand the existing check pattern.

- [ ] **Step 2: Add assembled-but-dropped detection**

Add a new check section that:
1. Parses each slice interface in `shared/types/intelligence.ts` to extract field names
2. For each format function, greps for each field name
3. Warns on any field present in the interface but not referenced in the formatter

This is a heuristic (field name grep) not a type-level check — but it catches the common case.

```typescript
// In pr-check.ts, add:
{
  title: 'Assembled-but-never-rendered field check',
  check: () => {
    const sliceFile = readFileSync('shared/types/intelligence.ts', 'utf-8');
    const formatFile = readFileSync('server/workspace-intelligence.ts', 'utf-8');

    // Map: slice name → fields
    const sliceFieldMap: Record<string, string[]> = {};
    const sliceRegex = /export interface (\w+Slice) \{([^}]+)\}/g;
    let match;
    while ((match = sliceRegex.exec(sliceFile)) !== null) {
      const [, name, body] = match;
      const fields = [...body.matchAll(/^\s+(\w+)\??:/gm)].map(m => m[1]);
      sliceFieldMap[name] = fields;
    }

    // Map: slice name → format function name
    const formatFnMap: Record<string, string> = {
      SeoContextSlice: 'formatSeoContextSection',
      InsightsSlice: 'formatInsightsSection',
      LearningsSlice: 'formatLearningsSection',
      PageProfileSlice: 'formatPageProfileSection',
      ContentPipelineSlice: 'formatContentPipelineSection',
      SiteHealthSlice: 'formatSiteHealthSection',
      ClientSignalsSlice: 'formatClientSignalsSection',
      OperationalSlice: 'formatOperationalSection',
    };

    const warnings: string[] = [];
    for (const [sliceName, fields] of Object.entries(sliceFieldMap)) {
      const fnName = formatFnMap[sliceName];
      if (!fnName) continue;

      // Extract format function body
      const fnStart = formatFile.indexOf(`function ${fnName}(`);
      if (fnStart === -1) continue;
      const fnEnd = formatFile.indexOf('\nfunction ', fnStart + 1);
      const fnBody = formatFile.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 3000);

      for (const field of fields) {
        if (!fnBody.includes(field)) {
          warnings.push(`[warn] ${sliceName}.${field} is not referenced in ${fnName}()`);
        }
      }
    }

    return warnings;
  },
}
```

- [ ] **Step 3: Run pr-check**

Run: `npx tsx scripts/pr-check.ts`
Expected: Zero errors, possibly some warnings for deliberately skipped fields (like `redirectDetails`)

- [ ] **Step 4: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "chore: pr-check rule for assembled-but-never-rendered slice fields

Warns when a field exists in a slice interface but is not referenced
in the corresponding format function. Prevents silent data loss when
new fields are added to assemblers but forgotten in formatters."
```

---

## Task 7b: Edge Case + Empty Data Tests

**Files:**
- Create: `tests/unit/format-edge-cases.test.ts`

Every formatter needs a test with the slice populated but all arrays empty and optional fields null. This catches `"NaN%"`, `"undefined"`, and crashes on empty data.

- [ ] **Step 1: Write edge case tests**

```typescript
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type {
  WorkspaceIntelligence,
  SeoContextSlice,
  LearningsSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  ClientSignalsSlice,
  OperationalSlice,
} from '../../shared/types/intelligence.js';

// Minimal seoContext to avoid cold-start
const minSeo: SeoContextSlice = {
  strategy: undefined, brandVoice: 'x', businessContext: '', personas: [], knowledgeBase: '',
};

function makeIntel(overrides: Partial<WorkspaceIntelligence>): WorkspaceIntelligence {
  return { version: 1, workspaceId: 'ws-edge', assembledAt: '2026-01-01T00:00:00Z', seoContext: minSeo, ...overrides };
}

describe('format functions never output NaN, undefined, or null literals', () => {
  const FORBIDDEN = /NaN|undefined|(?<!\w)null(?!\w)/;

  it('seoContext with empty personas, no strategy, no pageKeywords', () => {
    const result = formatForPrompt(makeIntel({
      seoContext: { ...minSeo, personas: [], strategy: undefined, pageKeywords: undefined },
    }), { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).not.toMatch(FORBIDDEN);
  });

  it('learnings with null summary, empty arrays, zero win rate', () => {
    const emptyLearnings: LearningsSlice = {
      summary: null, confidence: null, topActionTypes: [], overallWinRate: 0,
      recentTrend: null, playbooks: [], weCalledIt: [], roiAttribution: [],
    };
    const result = formatForPrompt(makeIntel({ learnings: emptyLearnings }), { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).not.toMatch(FORBIDDEN);
  });

  it('contentPipeline with empty arrays and null optional fields', () => {
    const empty: ContentPipelineSlice = {
      briefs: { total: 0, byStatus: {} }, posts: { total: 0, byStatus: {} },
      matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
      requests: { pending: 0, inProgress: 0, delivered: 0 },
      workOrders: { active: 0 }, coverageGaps: [],
      seoEdits: { pending: 0, applied: 0, inReview: 0 },
      cannibalizationWarnings: [], decayAlerts: [],
    };
    const result = formatForPrompt(makeIntel({ contentPipeline: empty }), { verbosity: 'detailed', sections: ['contentPipeline'] });
    expect(result).not.toMatch(FORBIDDEN);
  });

  it('siteHealth with null optional fields', () => {
    const empty: SiteHealthSlice = {
      auditScore: null, auditScoreDelta: null, deadLinks: 0, redirectChains: 0,
      schemaErrors: 0, orphanPages: 0, cwvPassRate: { mobile: null, desktop: null },
      performanceSummary: null, anomalyCount: 0, anomalyTypes: [],
    };
    const result = formatForPrompt(makeIntel({ siteHealth: empty }), { verbosity: 'detailed', sections: ['siteHealth'] });
    expect(result).not.toMatch(FORBIDDEN);
  });

  it('clientSignals with empty arrays and null optional fields', () => {
    const empty: ClientSignalsSlice = {
      keywordFeedback: { approved: [], rejected: [], patterns: { approveRate: 0, topRejectionReasons: [] } },
      contentGapVotes: [], businessPriorities: [],
      approvalPatterns: { approvalRate: 0, avgResponseTime: null },
      recentChatTopics: [], churnRisk: null,
      churnSignals: [], roi: null, engagement: undefined, compositeHealthScore: null,
      feedbackItems: [], serviceRequests: undefined,
    };
    const result = formatForPrompt(makeIntel({ clientSignals: empty }), { verbosity: 'detailed', sections: ['clientSignals'] });
    expect(result).not.toMatch(FORBIDDEN);
  });

  it('operational with empty arrays and null optional fields', () => {
    const empty: OperationalSlice = {
      recentActivity: [], annotations: [], pendingJobs: 0,
      timeSaved: null, approvalQueue: undefined, recommendationQueue: undefined,
      actionBacklog: undefined, detectedPlaybooks: [], workOrders: undefined,
      insightAcceptanceRate: null,
    };
    const result = formatForPrompt(makeIntel({ operational: empty }), { verbosity: 'detailed', sections: ['operational'] });
    expect(result).not.toMatch(FORBIDDEN);
  });

  it('all formatters with verbosity=compact produce no forbidden literals', () => {
    const result = formatForPrompt(makeIntel({}), { verbosity: 'compact' });
    expect(result).not.toMatch(FORBIDDEN);
  });
});

describe('verbosity-dependent truncation', () => {
  it('learnings weCalledIt: detailed shows up to 5, standard shows up to 3', () => {
    const manyPredictions = Array.from({ length: 6 }, (_, i) => ({
      actionId: `a${i}`, prediction: `Prediction ${i}`, outcome: `Outcome ${i}`,
      score: 'win', pageUrl: `/page-${i}`, measuredAt: '2026-03-25T00:00:00Z',
    }));
    const learnings: LearningsSlice = {
      summary: null, confidence: 'high', topActionTypes: [],
      overallWinRate: 0.5, recentTrend: 'stable', playbooks: [],
      weCalledIt: manyPredictions, roiAttribution: [],
    };
    const detailed = formatForPrompt(makeIntel({ learnings }), { verbosity: 'detailed', sections: ['learnings'] });
    const standard = formatForPrompt(makeIntel({ learnings }), { verbosity: 'standard', sections: ['learnings'] });

    // Detailed: up to 5 predictions
    expect((detailed.match(/Prediction/g) ?? []).length).toBeLessThanOrEqual(5);
    // Standard: up to 3 predictions
    expect((standard.match(/Prediction/g) ?? []).length).toBeLessThanOrEqual(3);
    // Standard shows fewer than detailed
    expect((standard.match(/Prediction/g) ?? []).length).toBeLessThan((detailed.match(/Prediction/g) ?? []).length);
  });
});
```

- [ ] **Step 2: Run edge case tests**

Run: `npx vitest run tests/unit/format-edge-cases.test.ts`
Expected: ALL PASS (after NaN guard task)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/format-edge-cases.test.ts
git commit -m "test: add edge case + empty data tests for all format functions

Tests that no formatter outputs NaN, undefined, or null literals when
given empty arrays, null optional fields, or zero values. Also verifies
verbosity-dependent truncation (weCalledIt: 5 at detailed, 3 at standard)."
```

---

## Task 8: Final Verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 2: Build**

Run: `npx vite build`
Expected: success

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: ALL new tests pass, baseline maintained

- [ ] **Step 4: PR check**

Run: `npx tsx scripts/pr-check.ts`
Expected: zero errors

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: format fidelity audit complete — all gaps fixed and tested"
```
