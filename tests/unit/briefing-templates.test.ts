/**
 * Golden tests for the deterministic briefing-story templates (Phase 2.5a).
 *
 * One block per template type. Each verifies:
 *   - Required fields present in output
 *   - Narrative cites at least one number (regex /\d/)
 *   - Narrative contains zero banned hedge words
 *   - dataReceipt populated
 *   - Returns null when required input fields are missing
 *
 * Plus dispatcher tests covering the registered InsightType set.
 */
import { describe, it, expect } from 'vitest';
import { buildStoryFromInsight as rankingMover } from '../../server/briefing-templates/ranking-mover.js';
import { buildStoryFromInsight as rankingOpportunity } from '../../server/briefing-templates/ranking-opportunity.js';
import { buildStoryFromInsight as anomalyDigest } from '../../server/briefing-templates/anomaly-digest.js';
import { buildStoryFromInsight as ctrOpportunity } from '../../server/briefing-templates/ctr-opportunity.js';
import { buildStoryFromInsight as freshnessAlert } from '../../server/briefing-templates/freshness-alert.js';
import { buildStoryFromInsight as cannibalization } from '../../server/briefing-templates/cannibalization.js';
import { buildStoryFromInsight as contentDecay } from '../../server/briefing-templates/content-decay.js';
import { buildStoryFromInsight as auditFinding } from '../../server/briefing-templates/audit-finding.js';
import { buildStoryFromInsight as competitorAlert } from '../../server/briefing-templates/competitor-alert.js';
import { buildStoryFromInsight as pageHealth } from '../../server/briefing-templates/page-health.js';
import { buildStoryFromContentGap } from '../../server/briefing-templates/content-gap.js';
import {
  buildStoryFromInsight as dispatch,
  buildStoryFromContentGap as dispatchGap,
  SUPPORTED_INSIGHT_TYPES,
} from '../../server/briefing-templates/index.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type { ContentGap } from '../../shared/types/workspace.js';

const HEDGES = /\b(potentially|could|may|appears to|suggests|might|seems)\b/i;
const ctx = { workspaceId: 'ws_test', tier: 'growth' as const };

function baseInsight<T extends string>(type: T, overrides: Record<string, unknown> = {}) {
  return {
    id: `ins_${type}`,
    workspaceId: 'ws_test',
    pageId: '/test',
    insightType: type,
    severity: 'positive',
    computedAt: new Date().toISOString(),
    pageTitle: 'Test Page',
    impactScore: 70,
    data: {},
    ...overrides,
  } as unknown as AnalyticsInsight;
}

const VALID_CATEGORIES: ReadonlyArray<string> = ['win', 'risk', 'opportunity', 'competitive', 'period_change'];
const VALID_DRILL_PAGES: ReadonlyArray<string> = ['performance', 'health', 'strategy', 'content-plan', 'roi', 'brand'];

function expectStoryShape(story: ReturnType<typeof rankingMover> | null) {
  expect(story).not.toBeNull();
  if (!story) return;
  // Required scalar fields
  expect(story.id.length).toBeGreaterThan(0);
  expect(story.headline.length).toBeGreaterThan(0);
  expect(story.narrative.length).toBeGreaterThan(0);
  // Voice contract
  expect(story.narrative).toMatch(/\d/);
  expect(story.narrative).not.toMatch(HEDGES);
  expect(story.headline).not.toMatch(HEDGES);
  expect(story.dataReceipt).toBeTruthy();
  expect(story.dataReceipt!).not.toMatch(HEDGES);
  // Enum / discriminated fields
  expect(VALID_CATEGORIES).toContain(story.category);
  expect(VALID_DRILL_PAGES).toContain(story.drillIn.page);
  // Metric badges — 0 to 2, each with non-empty value + label strings
  expect(story.metrics.length).toBeLessThanOrEqual(2);
  for (const m of story.metrics) {
    expect(m.value.length).toBeGreaterThan(0);
    expect(m.label.length).toBeGreaterThan(0);
  }
  // sourceRefs — exactly one ref pointing back to the underlying record
  expect(story.sourceRefs.length).toBeGreaterThanOrEqual(1);
  for (const ref of story.sourceRefs) {
    expect(ref.id.length).toBeGreaterThan(0);
  }
  // isHeadline always false from templates (cron promotes downstream)
  expect(story.isHeadline).toBe(false);
}

describe('briefing template: ranking_mover', () => {
  it('renders a complete story for a positive mover', () => {
    const insight = baseInsight('ranking_mover', {
      data: { query: 'fleet maintenance austin', pageUrl: '/services/fleet', currentPosition: 4, previousPosition: 11, positionChange: 7, currentClicks: 142, previousClicks: 23, impressions: 1840 },
    });
    expectStoryShape(rankingMover(insight, ctx));
  });
  it('returns null when positionChange is non-positive (a drop)', () => {
    const insight = baseInsight('ranking_mover', {
      data: { query: 'q', pageUrl: '/p', currentPosition: 11, previousPosition: 4, positionChange: -7, currentClicks: 23, previousClicks: 142, impressions: 1840 },
    });
    expect(rankingMover(insight, ctx)).toBeNull();
  });
});

describe('briefing template: ranking_opportunity', () => {
  it('renders a story for position 11', () => {
    const insight = baseInsight('ranking_opportunity', {
      data: { query: 'hvac repair austin', pageUrl: '/hvac', currentPosition: 11, impressions: 2400, estimatedTrafficGain: 250 },
    });
    expectStoryShape(rankingOpportunity(insight, ctx));
  });
  it('returns null when position is on page 1', () => {
    const insight = baseInsight('ranking_opportunity', {
      data: { query: 'q', pageUrl: '/p', currentPosition: 5, impressions: 100, estimatedTrafficGain: 0 },
    });
    expect(rankingOpportunity(insight, ctx)).toBeNull();
  });
});

describe('briefing template: anomaly_digest (positive)', () => {
  it('renders a story for a click surge', () => {
    const insight = baseInsight('anomaly_digest', {
      data: { anomalyType: 'spike', metric: 'clicks', currentValue: 450, expectedValue: 200, deviationPercent: 125, durationDays: 3, firstDetected: new Date().toISOString(), severity: 'high' },
    });
    expectStoryShape(anomalyDigest(insight, ctx));
  });
  it('returns null for drops (currentValue < expectedValue)', () => {
    const insight = baseInsight('anomaly_digest', {
      data: { anomalyType: 'drop', metric: 'clicks', currentValue: 100, expectedValue: 200, deviationPercent: -50, durationDays: 3, firstDetected: new Date().toISOString(), severity: 'high' },
    });
    expect(anomalyDigest(insight, ctx)).toBeNull();
  });
});

describe('briefing template: ctr_opportunity', () => {
  it('renders a story for under-performing CTR', () => {
    const insight = baseInsight('ctr_opportunity', {
      data: { query: 'hvac', pageUrl: '/hvac', position: 5, actualCtr: 2.1, expectedCtr: 6.3, ctrRatio: 0.33, impressions: 1500, estimatedClickGap: 63 },
    });
    expectStoryShape(ctrOpportunity(insight, ctx));
  });
  it('returns null when impressions below threshold', () => {
    const insight = baseInsight('ctr_opportunity', {
      data: { query: 'q', pageUrl: '/p', position: 5, actualCtr: 1, expectedCtr: 5, ctrRatio: 0.2, impressions: 50, estimatedClickGap: 5 },
    });
    expect(ctrOpportunity(insight, ctx)).toBeNull();
  });
});

describe('briefing template: freshness_alert', () => {
  it('renders a story for >180d stale page', () => {
    const insight = baseInsight('freshness_alert', {
      data: { pagePath: '/blog/old', lastAnalyzedAt: '2025-09-01T00:00:00Z', daysSinceLastAnalysis: 240, impressions: 1200, clicks: 80 },
    });
    expectStoryShape(freshnessAlert(insight, ctx));
  });
  it('returns null when not yet stale (<90d)', () => {
    const insight = baseInsight('freshness_alert', {
      data: { pagePath: '/p', lastAnalyzedAt: '2026-04-01T00:00:00Z', daysSinceLastAnalysis: 45 },
    });
    expect(freshnessAlert(insight, ctx)).toBeNull();
  });
});

describe('briefing template: cannibalization', () => {
  it('renders a story for high severity (3+ pages)', () => {
    const insight = baseInsight('cannibalization', {
      data: { query: 'plumbing services', pages: ['/a', '/b', '/c'], positions: [5, 8, 14], totalImpressions: 800 },
    });
    expectStoryShape(cannibalization(insight, ctx));
  });
  it('returns null when fewer than 2 pages compete', () => {
    const insight = baseInsight('cannibalization', {
      data: { query: 'q', pages: ['/a'], positions: [5], totalImpressions: 100 },
    });
    expect(cannibalization(insight, ctx)).toBeNull();
  });
});

describe('briefing template: content_decay (simplified)', () => {
  it('renders a story for ≥15% drop', () => {
    const insight = baseInsight('content_decay', {
      data: { baselineClicks: 87, currentClicks: 54, deltaPercent: -38, baselinePeriod: 'Feb 2026', currentPeriod: 'Apr 2026' },
    });
    expectStoryShape(contentDecay(insight, ctx));
  });
  it('returns null when drop is below threshold', () => {
    const insight = baseInsight('content_decay', {
      data: { baselineClicks: 100, currentClicks: 92, deltaPercent: -8, baselinePeriod: 'Feb', currentPeriod: 'Apr' },
    });
    expect(contentDecay(insight, ctx)).toBeNull();
  });
});

describe('briefing template: audit_finding (workspace scope)', () => {
  it('renders a story for site-scoped findings', () => {
    const insight = baseInsight('audit_finding', {
      pageId: null,
      severity: 'warning',
      data: { scope: 'site', issueCount: 15, issueMessages: 'Missing alt text on 12 pages; broken internal links on 3 pages', siteScore: 85, source: 'bridge-audit-site-health' },
    });
    expectStoryShape(auditFinding(insight, ctx));
  });
  it('returns null for page-scoped findings', () => {
    const insight = baseInsight('audit_finding', {
      data: { scope: 'page', issueCount: 3, issueMessages: 'foo', source: 'x' },
    });
    expect(auditFinding(insight, ctx)).toBeNull();
  });
});

describe('briefing template: competitor_alert (Watch List only)', () => {
  it('renders a story for keyword_gained', () => {
    const insight = baseInsight('competitor_alert', {
      data: { competitorDomain: 'plumber-pros.com', alertType: 'keyword_gained', keyword: 'fleet maintenance', previousPosition: 8, currentPosition: 2, positionChange: 6, volume: 1200, snapshotDate: '2026-04-28' },
    });
    const story = competitorAlert(insight, ctx);
    expectStoryShape(story);
    expect(story?.isHeadline).toBe(false); // never lead
  });
  it('returns null when domain is missing', () => {
    const insight = baseInsight('competitor_alert', {
      data: { alertType: 'new_keyword', keyword: 'foo', snapshotDate: '2026-04-28' },
    });
    expect(competitorAlert(insight, ctx)).toBeNull();
  });
});

describe('briefing template: page_health (Watch List only)', () => {
  it('renders a story for low-score declining page', () => {
    const insight = baseInsight('page_health', {
      data: { score: 45, trend: 'declining', clicks: 320, impressions: 5400, position: 12, ctr: 5.9, pageviews: 480, bounceRate: 65, avgEngagementTime: 32, errorCount: 2, warningCount: 4 },
    });
    const story = pageHealth(insight, ctx);
    expectStoryShape(story);
    expect(story?.isHeadline).toBe(false);
  });
  it('returns null for healthy improving pages', () => {
    const insight = baseInsight('page_health', {
      data: { score: 85, trend: 'improving', clicks: 100, impressions: 1000, position: 5, ctr: 10, pageviews: 200, bounceRate: 30, avgEngagementTime: 60 },
    });
    expect(pageHealth(insight, ctx)).toBeNull();
  });
});

describe('briefing template: content_gap', () => {
  it('renders a story for a high-value gap', () => {
    const gap: ContentGap = {
      topic: 'Fleet maintenance scheduling',
      targetKeyword: 'best fleet maintenance schedule',
      intent: 'informational',
      priority: 'high',
      rationale: 'High volume, low competition.',
      volume: 8600,
      difficulty: 27,
      impressions: 142,
      competitorProof: 'Plumber Pros ranks #2 for this term.',
      opportunityScore: 88,
    };
    const story = buildStoryFromContentGap(gap, ctx);
    expectStoryShape(story);
    // Content assertions for hasImpressions && hasCompetitorProof branch:
    // competitorProof ends with "." — the template must strip it to avoid "..".
    expect(story!.narrative).not.toMatch(/\.\./);
    expect(story!.narrative).toContain('while Plumber Pros ranks #2 for this term.');
  });
  it('returns null without targetKeyword', () => {
    const gap = { topic: 'x', targetKeyword: '', volume: 1000, intent: 'informational', priority: 'low', rationale: '' } as ContentGap;
    expect(buildStoryFromContentGap(gap, ctx)).toBeNull();
  });

  it('produces grammatical narrative when competitorProof is present but impressions is absent (Devin PR #380)', () => {
    // Previously untested branch — competitorProof is a full clause, not a
    // bare noun; the template now wraps it as a parenthetical to avoid the
    // "Plumber Pros ranks #2. is capturing..." garbled-prose bug.
    const gap: ContentGap = {
      topic: 'Fleet maintenance scheduling',
      targetKeyword: 'best fleet maintenance schedule',
      intent: 'informational',
      priority: 'high',
      rationale: 'High volume, low competition.',
      volume: 8600,
      difficulty: 27,
      competitorProof: 'Plumber Pros ranks #2 for this term.',
    };
    const story = buildStoryFromContentGap(gap, ctx);
    expect(story).not.toBeNull();
    if (!story) return;
    // Sentence 2 must NOT start with the competitorProof clause directly.
    expect(story.narrative).not.toMatch(/Plumber Pros ranks #2 for this term\. is capturing/);
    // It SHOULD wrap the proof as a parenthetical inside a properly-subjected sentence.
    expect(story.narrative).toMatch(/\(Plumber Pros ranks #2 for this term\)/);
    expectStoryShape(story);
  });
});

// ── Dispatcher ────────────────────────────────────────────────────────────────

describe('briefing-templates dispatcher', () => {
  it('exposes a SUPPORTED_INSIGHT_TYPES list of registered types', () => {
    expect(SUPPORTED_INSIGHT_TYPES.length).toBeGreaterThanOrEqual(10);
    expect(SUPPORTED_INSIGHT_TYPES).toContain('ranking_mover');
    expect(SUPPORTED_INSIGHT_TYPES).toContain('page_health');
    // content_gap goes through buildStoryFromContentGap (different signature),
    // so it's not in the InsightType-keyed dispatcher map.
  });

  it('dispatches ranking_mover correctly via index', () => {
    const insight = baseInsight('ranking_mover', {
      data: { query: 'q', pageUrl: '/p', currentPosition: 4, previousPosition: 11, positionChange: 7, currentClicks: 142, previousClicks: 23, impressions: 1840 },
    });
    const story = dispatch(insight, ctx);
    expect(story).not.toBeNull();
    expect(story?.category).toBe('win');
  });

  it('returns null for unsupported InsightType', () => {
    const insight = baseInsight('strategy_alignment', {
      data: { alignedCount: 5, misalignedCount: 2, untrackedCount: 3 },
    });
    expect(dispatch(insight, ctx)).toBeNull();
  });

  it('dispatches content_gap via buildStoryFromContentGap', () => {
    const gap: ContentGap = {
      topic: 'x', targetKeyword: 'y', intent: 'informational', priority: 'high', rationale: '', volume: 5000, difficulty: 30,
    };
    expect(dispatchGap(gap, ctx)).not.toBeNull();
  });

  // ── Phase 2.5c additions ──

  it('Phase 2.5c — registers milestone_attribution as a supported InsightType', () => {
    expect(SUPPORTED_INSIGHT_TYPES).toContain('milestone_attribution');
  });

  it('Phase 2.5c — dispatches milestone_attribution correctly via index', () => {
    const insight = baseInsight('milestone_attribution', {
      severity: 'positive',
      data: {
        briefId: 'cr_123',
        briefTitle: 'Best Fleet Maintenance Practices',
        pageUrl: '/blog/fleet-maintenance',
        thresholdCrossed: 'fifty_clicks',
        currentClicks: 53,
        daysSinceDelivery: 47,
        trafficValue: 135,
      },
    });
    const story = dispatch(insight, ctx);
    expect(story).not.toBeNull();
    expect(story!.category).toBe('win');
    expect(story!.leadEligible).toBe(true);
    expect(story!.headline).toMatch(/50 clicks/);
    expect(story!.narrative).toMatch(/53/);
    expect(story!.narrative).toMatch(/\$135/);
    expect(story!.dataReceipt).toMatch(/threshold/i);
  });
});

// ── Phase 2.5c: milestone_attribution template ──

describe('milestone-attribution template', () => {
  it('rejects when currentClicks <= 0', () => {
    const insight = baseInsight('milestone_attribution', {
      severity: 'positive',
      data: { briefId: 'b', briefTitle: 't', pageUrl: '/p', thresholdCrossed: 'first_clicks', currentClicks: 0, daysSinceDelivery: 10, trafficValue: 0 },
    });
    expect(dispatch(insight, ctx)).toBeNull();
  });

  it('rejects when briefId is empty', () => {
    const insight = baseInsight('milestone_attribution', {
      severity: 'positive',
      data: { briefId: '', briefTitle: 't', pageUrl: '/p', thresholdCrossed: 'first_clicks', currentClicks: 3, daysSinceDelivery: 10, trafficValue: 5 },
    });
    expect(dispatch(insight, ctx)).toBeNull();
  });

  it('frames each threshold with its proper voice', () => {
    const fst = dispatch(baseInsight('milestone_attribution', {
      severity: 'positive',
      data: { briefId: 'b1', briefTitle: 'My Brief', pageUrl: '/p', thresholdCrossed: 'first_clicks', currentClicks: 3, daysSinceDelivery: 30, trafficValue: 8 },
    }), ctx);
    const fty = dispatch(baseInsight('milestone_attribution', {
      severity: 'positive',
      data: { briefId: 'b2', briefTitle: 'My Brief', pageUrl: '/p', thresholdCrossed: 'fifty_clicks', currentClicks: 53, daysSinceDelivery: 47, trafficValue: 135 },
    }), ctx);
    const hndr = dispatch(baseInsight('milestone_attribution', {
      severity: 'positive',
      data: { briefId: 'b3', briefTitle: 'My Brief', pageUrl: '/p', thresholdCrossed: 'hundred_clicks', currentClicks: 105, daysSinceDelivery: 60, trafficValue: 280 },
    }), ctx);
    expect(fst!.headline).toMatch(/driving clicks/i);
    expect(fty!.headline).toMatch(/50 clicks/i);
    expect(hndr!.headline).toMatch(/100 clicks/i);
  });

  it('milestone narrative + receipt contain no banned hedge words', () => {
    const story = dispatch(baseInsight('milestone_attribution', {
      severity: 'positive',
      data: { briefId: 'b', briefTitle: 'Test', pageUrl: '/p', thresholdCrossed: 'fifty_clicks', currentClicks: 60, daysSinceDelivery: 40, trafficValue: 100 },
    }), ctx);
    expect(story!.narrative).not.toMatch(HEDGES);
    expect(story!.dataReceipt).not.toMatch(HEDGES);
  });
});

// ── Phase 2.5c: weCalledIt template ──
// Note: weCalledIt isn't in INSIGHT_DISPATCHERS (input is TrackedAction +
// ActionOutcome, not AnalyticsInsight). Imported directly.

import { buildStoryFromWeCalledIt } from '../../server/briefing-templates/we-called-it.js';

describe('we-called-it template', () => {
  function baseAction(overrides: Record<string, unknown> = {}) {
    return {
      id: 'act_test',
      workspaceId: 'ws_test',
      actionType: 'brief_created',
      sourceType: 'content_request',
      sourceId: 'cr_1',
      pageUrl: '/services/fleet',
      targetKeyword: 'fleet maintenance austin',
      baselineSnapshot: { captured_at: '2026-03-14T00:00:00Z' },
      trailingHistory: { samples: [] },
      attribution: 'platform_executed',
      measurementWindow: 60,
      sourceFlag: null,
      baselineConfidence: 'high',
      context: {},
      createdAt: '2026-03-14T00:00:00Z',
      updatedAt: '2026-04-22T00:00:00Z',
      measurementComplete: 0,
      ...overrides,
    } as unknown as Parameters<typeof buildStoryFromWeCalledIt>[0]['action'];
  }

  function baseOutcome(overrides: Record<string, unknown> = {}) {
    return {
      id: 'out_test',
      actionId: 'act_test',
      checkpointDays: 30,
      metricsSnapshot: { captured_at: '2026-04-22T00:00:00Z', clicks: 142, position: 4 },
      score: 'strong_win',
      deltaSummary: {
        primary_metric: 'clicks',
        baseline_value: 23,
        current_value: 142,
        delta_absolute: 119,
        delta_percent: 517,
        secondary_signals: [],
      },
      competitorContext: null,
      measuredAt: '2026-04-22T00:00:00Z',
      ...overrides,
    } as unknown as Parameters<typeof buildStoryFromWeCalledIt>[0]['outcome'];
  }

  it('returns null when outcome.score !== strong_win', () => {
    const r = buildStoryFromWeCalledIt({
      action: baseAction(),
      outcome: baseOutcome({ score: 'win' }),
    }, ctx);
    expect(r).toBeNull();
  });

  it('returns null when action has no pageUrl AND no targetKeyword', () => {
    const r = buildStoryFromWeCalledIt({
      action: baseAction({ pageUrl: null, targetKeyword: null }),
      outcome: baseOutcome(),
    }, ctx);
    expect(r).toBeNull();
  });

  it('builds a win story with predicted/delivery dates and days-to-deliver', () => {
    const r = buildStoryFromWeCalledIt({ action: baseAction(), outcome: baseOutcome() }, ctx);
    expect(r).not.toBeNull();
    expect(r!.category).toBe('win');
    expect(r!.leadEligible).toBe(true);
    expect(r!.headline.length).toBeGreaterThan(0);
    expect(r!.narrative).toMatch(/142/); // current_value
    expect(r!.metrics.find((m) => m.label === 'predicted')).toBeTruthy();
    expect(r!.metrics.find((m) => m.label === 'to deliver')).toBeTruthy();
    expect(r!.dataReceipt).toMatch(/recorded/);
    expect(r!.narrative).not.toMatch(HEDGES);
    expect(r!.dataReceipt).not.toMatch(HEDGES);
  });

  it('says "ahead of schedule" only when daysToDeliver <= measurementWindow', () => {
    // Action created 2026-03-14, outcome measured 2026-04-22 = 39 days.
    // measurementWindow = 60 → 39 <= 60 → "ahead of schedule".
    const ahead = buildStoryFromWeCalledIt({ action: baseAction(), outcome: baseOutcome() }, ctx);
    expect(ahead!.dataReceipt).toMatch(/ahead of schedule/);
  });

  it('drops "ahead of schedule" when daysToDeliver exceeds measurementWindow', () => {
    // Action created 2026-03-14, outcome measured 2026-06-01 = 79 days.
    // measurementWindow = 60 → 79 > 60 → just the day count, no
    // "ahead of schedule" claim. Devin caught the original code asserting
    // the claim unconditionally, which would be factually wrong copy in a
    // client-facing trust-play story.
    const r = buildStoryFromWeCalledIt({
      action: baseAction({ measurementWindow: 60 }),
      outcome: baseOutcome({ measuredAt: '2026-06-01T00:00:00Z' }),
    }, ctx);
    expect(r!.dataReceipt).not.toMatch(/ahead of schedule/);
    expect(r!.dataReceipt).toMatch(/79 days/);
  });
});
