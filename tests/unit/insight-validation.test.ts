/**
 * Unit tests for the insight validation pass in server/analytics-intelligence.ts.
 *
 * Tests the deterministic rules that suppress contradictory, duplicate,
 * and low-confidence insights after computation.
 */
import { describe, it, expect } from 'vitest';
import { upsertInsight, getInsights, resolveInsight } from '../../server/analytics-insights-store.js';
import { validateInsightBatch } from '../../server/analytics-intelligence.js';

/** Helper: create a workspace with a unique ID for test isolation */
function ws() {
  return 'ws_val_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

// ── Contradiction suppression ────────────────────────────────────

describe('validateInsightBatch — contradiction rules', () => {
  it('suppresses weaker signal when ranking_opportunity + content_decay on same page', () => {
    const workspaceId = ws();
    // ranking_opportunity is severity 'opportunity' (rank 2)
    upsertInsight({
      workspaceId,
      pageId: '/blog/test',
      insightType: 'ranking_opportunity',
      data: { query: 'seo tips', currentPosition: 7, impressions: 500, estimatedTrafficGain: 100, pageUrl: '/blog/test' },
      severity: 'opportunity',
    });
    // content_decay is severity 'warning' (rank 3) — stronger signal
    upsertInsight({
      workspaceId,
      pageId: '/blog/test',
      insightType: 'content_decay',
      data: { baselineClicks: 100, currentClicks: 50, deltaPercent: -50, baselinePeriod: 'prev', currentPeriod: 'curr' },
      severity: 'warning',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(1);

    const remaining = getInsights(workspaceId);
    expect(remaining).toHaveLength(1);
    // content_decay (warning) is stronger than ranking_opportunity (opportunity)
    expect(remaining[0].insightType).toBe('content_decay');
  });

  it('suppresses weaker signal when ctr_opportunity + content_decay on same page', () => {
    const workspaceId = ws();
    upsertInsight({
      workspaceId,
      pageId: '/services',
      insightType: 'ctr_opportunity',
      data: { query: 'seo agency', pageUrl: '/services', position: 3, actualCtr: 2, expectedCtr: 10, ctrRatio: 0.2, impressions: 5000, estimatedClickGap: 400 },
      severity: 'opportunity',
    });
    upsertInsight({
      workspaceId,
      pageId: '/services',
      insightType: 'content_decay',
      data: { baselineClicks: 200, currentClicks: 80, deltaPercent: -60, baselinePeriod: 'prev', currentPeriod: 'curr' },
      severity: 'critical',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(1);

    const remaining = getInsights(workspaceId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].insightType).toBe('content_decay');
  });
});

// ── Severity clash on same page ──────────────────────────────────

describe('validateInsightBatch — severity clash', () => {
  it('suppresses positive insight when same page also has critical insight', () => {
    const workspaceId = ws();
    upsertInsight({
      workspaceId,
      pageId: '/blog/post',
      insightType: 'page_health',
      data: { score: 85, trend: 'improving', clicks: 500, impressions: 8000, position: 3, ctr: 6, pageviews: 1200, bounceRate: 30, avgEngagementTime: 120 },
      severity: 'positive',
    });
    upsertInsight({
      workspaceId,
      pageId: '/blog/post',
      insightType: 'content_decay',
      data: { baselineClicks: 300, currentClicks: 50, deltaPercent: -83, baselinePeriod: 'prev', currentPeriod: 'curr' },
      severity: 'critical',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(1);

    const remaining = getInsights(workspaceId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].severity).toBe('critical');
  });
});

// ── Non-contradictory insights preserved ─────────────────────────

describe('validateInsightBatch — non-contradictory insights', () => {
  it('preserves insights on the same page when they are not contradictory', () => {
    const workspaceId = ws();
    // page_health + cannibalization on the same page are not contradictory
    upsertInsight({
      workspaceId,
      pageId: '/blog/guide',
      insightType: 'page_health',
      data: { score: 60, trend: 'stable', clicks: 200, impressions: 4000, position: 5, ctr: 5, pageviews: 600, bounceRate: 45, avgEngagementTime: 80 },
      severity: 'opportunity',
    });
    upsertInsight({
      workspaceId,
      pageId: '/blog/guide',
      insightType: 'cannibalization',
      data: { query: 'seo guide', pages: ['/blog/guide', '/blog/seo'], positions: [5, 8], totalImpressions: 5000 },
      severity: 'warning',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(0);

    const remaining = getInsights(workspaceId);
    expect(remaining).toHaveLength(2);
  });

  it('preserves insights on different pages even if contradictory types', () => {
    const workspaceId = ws();
    upsertInsight({
      workspaceId,
      pageId: '/page-a',
      insightType: 'ranking_opportunity',
      data: { query: 'kw', currentPosition: 7, impressions: 500, estimatedTrafficGain: 100, pageUrl: '/page-a' },
      severity: 'opportunity',
    });
    upsertInsight({
      workspaceId,
      pageId: '/page-b',
      insightType: 'content_decay',
      data: { baselineClicks: 100, currentClicks: 50, deltaPercent: -50, baselinePeriod: 'prev', currentPeriod: 'curr' },
      severity: 'warning',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(0);

    expect(getInsights(workspaceId)).toHaveLength(2);
  });
});

// ── Low-confidence suppression ───────────────────────────────────

describe('validateInsightBatch — low-confidence suppression', () => {
  it('suppresses ranking_opportunity with low impressions', () => {
    const workspaceId = ws();
    upsertInsight({
      workspaceId,
      pageId: '/low-traffic',
      insightType: 'ranking_opportunity',
      data: { query: 'obscure', currentPosition: 12, impressions: 30, estimatedTrafficGain: 2, pageUrl: '/low-traffic' },
      severity: 'opportunity',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(1);
    expect(getInsights(workspaceId)).toHaveLength(0);
  });

  it('suppresses content_decay with minimal absolute click loss', () => {
    const workspaceId = ws();
    upsertInsight({
      workspaceId,
      pageId: '/minor-decay',
      insightType: 'content_decay',
      data: { baselineClicks: 15, currentClicks: 10, deltaPercent: -33, baselinePeriod: 'prev', currentPeriod: 'curr' },
      severity: 'warning',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(1);
    expect(getInsights(workspaceId)).toHaveLength(0);
  });

  it('suppresses ctr_opportunity with tiny click gap', () => {
    const workspaceId = ws();
    upsertInsight({
      workspaceId,
      pageId: '/tiny-gap',
      insightType: 'ctr_opportunity',
      data: { query: 'kw', pageUrl: '/tiny-gap', position: 3, actualCtr: 9, expectedCtr: 10, ctrRatio: 0.9, impressions: 100, estimatedClickGap: 2 },
      severity: 'opportunity',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(1);
    expect(getInsights(workspaceId)).toHaveLength(0);
  });

  it('preserves high-confidence entries above thresholds', () => {
    const workspaceId = ws();
    upsertInsight({
      workspaceId,
      pageId: '/high-traffic',
      insightType: 'ranking_opportunity',
      data: { query: 'seo tips', currentPosition: 7, impressions: 5000, estimatedTrafficGain: 200, pageUrl: '/high-traffic' },
      severity: 'opportunity',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(0);
    expect(getInsights(workspaceId)).toHaveLength(1);
  });
});

// ── No-op when no contradictions ─────────────────────────────────

describe('validateInsightBatch — no-op scenarios', () => {
  it('returns 0 when workspace has no insights', () => {
    const workspaceId = ws();
    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(0);
  });

  it('returns 0 when all insights are clean', () => {
    const workspaceId = ws();
    upsertInsight({
      workspaceId,
      pageId: '/healthy',
      insightType: 'page_health',
      data: { score: 80, trend: 'improving', clicks: 500, impressions: 8000, position: 3, ctr: 6, pageviews: 1200, bounceRate: 30, avgEngagementTime: 120 },
      severity: 'positive',
    });
    upsertInsight({
      workspaceId,
      pageId: '/opportunity',
      insightType: 'ranking_opportunity',
      data: { query: 'good kw', currentPosition: 5, impressions: 3000, estimatedTrafficGain: 150, pageUrl: '/opportunity' },
      severity: 'opportunity',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(0);
    expect(getInsights(workspaceId)).toHaveLength(2);
  });
});

// ── Protected insights (resolved / bridge-sourced) ───────────────

describe('validateInsightBatch — resolved & bridge-sourced protection', () => {
  it('does NOT suppress a resolved insight even if it would normally be contradictory', () => {
    const workspaceId = ws();
    // ranking_opportunity on same page as content_decay — normally the weaker one is suppressed
    const ro = upsertInsight({
      workspaceId,
      pageId: '/blog/protected',
      insightType: 'ranking_opportunity',
      data: { query: 'seo tips', currentPosition: 7, impressions: 500, estimatedTrafficGain: 100, pageUrl: '/blog/protected' },
      severity: 'opportunity',
    });
    upsertInsight({
      workspaceId,
      pageId: '/blog/protected',
      insightType: 'content_decay',
      data: { baselineClicks: 100, currentClicks: 50, deltaPercent: -50, baselinePeriod: 'prev', currentPeriod: 'curr' },
      severity: 'warning',
    });

    // Mark the ranking_opportunity as resolved — it should be protected
    resolveInsight(ro.id, workspaceId, 'resolved', 'Fixed by team');

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(0);

    const remaining = getInsights(workspaceId);
    expect(remaining).toHaveLength(2);
    expect(remaining.find((i) => i.id === ro.id)).toBeDefined();
  });

  it('does NOT suppress an in_progress insight even if it would normally be contradictory', () => {
    const workspaceId = ws();
    const ro = upsertInsight({
      workspaceId,
      pageId: '/blog/wip',
      insightType: 'ranking_opportunity',
      data: { query: 'kw', currentPosition: 7, impressions: 500, estimatedTrafficGain: 100, pageUrl: '/blog/wip' },
      severity: 'opportunity',
    });
    upsertInsight({
      workspaceId,
      pageId: '/blog/wip',
      insightType: 'content_decay',
      data: { baselineClicks: 100, currentClicks: 50, deltaPercent: -50, baselinePeriod: 'prev', currentPeriod: 'curr' },
      severity: 'warning',
    });

    resolveInsight(ro.id, workspaceId, 'in_progress');

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(0);

    expect(getInsights(workspaceId)).toHaveLength(2);
  });

  it('does NOT suppress a bridge-sourced insight even if low-confidence', () => {
    const workspaceId = ws();
    // Low impressions would normally suppress this ranking_opportunity
    upsertInsight({
      workspaceId,
      pageId: '/bridge/page',
      insightType: 'ranking_opportunity',
      data: { query: 'obscure', currentPosition: 12, impressions: 5, estimatedTrafficGain: 1, pageUrl: '/bridge/page' },
      severity: 'opportunity',
      bridgeSource: 'strategy-bridge',
    });

    const suppressed = validateInsightBatch(workspaceId);
    expect(suppressed).toBe(0);
    expect(getInsights(workspaceId)).toHaveLength(1);
  });

  it('does NOT suppress a bridge-sourced insight even if contradictory', () => {
    const workspaceId = ws();
    upsertInsight({
      workspaceId,
      pageId: '/bridge/conflict',
      insightType: 'ranking_opportunity',
      data: { query: 'kw', currentPosition: 7, impressions: 500, estimatedTrafficGain: 100, pageUrl: '/bridge/conflict' },
      severity: 'opportunity',
      bridgeSource: 'pipeline-bridge',
    });
    upsertInsight({
      workspaceId,
      pageId: '/bridge/conflict',
      insightType: 'content_decay',
      data: { baselineClicks: 100, currentClicks: 50, deltaPercent: -50, baselinePeriod: 'prev', currentPeriod: 'curr' },
      severity: 'warning',
    });

    const suppressed = validateInsightBatch(workspaceId);
    // The non-bridge content_decay is not contradictory with a protected insight, so nothing suppressed
    expect(suppressed).toBe(0);
    expect(getInsights(workspaceId)).toHaveLength(2);
  });
});
