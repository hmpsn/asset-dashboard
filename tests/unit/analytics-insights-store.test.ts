/**
 * Unit tests for server/analytics-insights-store.ts — CRUD on analytics_insights table.
 */
import { describe, it, expect } from 'vitest';
import db from '../../server/db/index.js';
import {
  cloneInsightParams,
  deleteStaleInsightsByType,
  upsertInsight,
  upsertAnomalyDigestInsight,
  getInsights,
  getInsightsByDomain,
  getInsight,
  getInsightById,
  getUnresolvedInsights,
  resolveInsight,
  deleteInsightsForWorkspace,
  suppressInsights,
  stampDiagnosticReportId,
} from '../../server/analytics-insights-store.js';
import type { AnalyticsInsight, AnomalyDigestData } from '../../shared/types/analytics.js';

const pageHealthData = {
  score: 72,
  trend: 'improving' as const,
  clicks: 120,
  impressions: 1500,
  position: 8.2,
  ctr: 8.0,
  pageviews: 200,
  bounceRate: 42.5,
  avgEngagementTime: 95,
};

function makeWorkspaceId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function makeAnomalyData(overrides: Partial<AnomalyDigestData> = {}): AnomalyDigestData {
  return {
    anomalyType: 'traffic_drop',
    metric: 'clicks',
    currentValue: 40,
    expectedValue: 100,
    deviationPercent: -60,
    durationDays: 3,
    firstDetected: '2026-05-01T00:00:00.000Z',
    severity: 'warning',
    ...overrides,
  };
}

describe('upsertInsight', () => {
  it('creates a new insight and returns it', () => {
    const wsId = makeWorkspaceId('ws_ins');
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId: '/blog/test',
      insightType: 'page_health',
      data: pageHealthData,
      severity: 'opportunity',
    });

    expect(insight.id).toMatch(/^ins_/);
    expect(insight.workspaceId).toBe(wsId);
    expect(insight.pageId).toBe('/blog/test');
    expect(insight.insightType).toBe('page_health');
    expect((insight.data as typeof pageHealthData).score).toBe(72);
    expect((insight.data as typeof pageHealthData).trend).toBe('improving');
    expect(insight.severity).toBe('opportunity');
    expect(insight.computedAt).toBeDefined();
  });

  it('replaces existing insight with same workspace+page+type key', () => {
    const wsId = makeWorkspaceId('ws_upsert');
    const makeRankData = (gain: number) => ({ query: 'test kw', currentPosition: 12, impressions: 1000, estimatedTrafficGain: gain, pageUrl: '/home' });
    upsertInsight({
      workspaceId: wsId,
      pageId: '/home',
      insightType: 'ranking_opportunity',
      data: makeRankData(100),
      severity: 'opportunity',
    });
    const updated = upsertInsight({
      workspaceId: wsId,
      pageId: '/home',
      insightType: 'ranking_opportunity',
      data: makeRankData(250),
      severity: 'positive',
    });

    expect((updated.data as ReturnType<typeof makeRankData>).estimatedTrafficGain).toBe(250);
    expect(updated.severity).toBe('positive');

    const results = getInsights(wsId);
    const quickWins = results.filter(i => i.insightType === 'ranking_opportunity');
    expect(quickWins).toHaveLength(1);
  });

  it('supports null pageId for workspace-level insights', () => {
    const wsId = makeWorkspaceId('ws_nullpage');
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId: null,
      insightType: 'keyword_cluster',
      data: { clusters: 5 },
      severity: 'positive',
    });

    expect(insight.pageId).toBeNull();
  });
});

describe('getInsights', () => {
  it('returns all insights for a workspace', () => {
    const wsId = makeWorkspaceId('ws_list_ins');
    upsertInsight({ workspaceId: wsId, pageId: '/a', insightType: 'page_health', data: {}, severity: 'positive' });
    upsertInsight({ workspaceId: wsId, pageId: '/b', insightType: 'content_decay', data: {}, severity: 'warning' });

    const insights = getInsights(wsId);
    expect(insights.length).toBe(2);
    expect(insights.length > 0 && insights.every(i => i.workspaceId === wsId)).toBe(true);
  });

  it('can filter by insightType', () => {
    const wsId = makeWorkspaceId('ws_filter');
    upsertInsight({ workspaceId: wsId, pageId: '/a', insightType: 'page_health', data: {}, severity: 'positive' });
    upsertInsight({ workspaceId: wsId, pageId: '/b', insightType: 'content_decay', data: {}, severity: 'warning' });

    const decayOnly = getInsights(wsId, 'content_decay');
    expect(decayOnly).toHaveLength(1);
    expect(decayOnly[0].insightType).toBe('content_decay');
  });

  it('returns empty array for unknown workspace', () => {
    expect(getInsights('ws_nonexistent_xyz')).toEqual([]);
  });
});

describe('getInsight', () => {
  it('returns a specific insight by workspace+page+type', () => {
    const wsId = makeWorkspaceId('ws_get');
    const data = { query: 'test kw', currentPosition: 7, impressions: 500, estimatedTrafficGain: 50, pageUrl: '/services' };
    upsertInsight({ workspaceId: wsId, pageId: '/services', insightType: 'ranking_opportunity', data, severity: 'opportunity' });

    const insight = getInsight(wsId, '/services', 'ranking_opportunity');
    expect(insight).toBeDefined();
    expect((insight!.data as typeof data).currentPosition).toBe(7);
  });

  it('returns undefined when no matching insight exists', () => {
    expect(getInsight('ws_nobody', '/nope', 'page_health')).toBeUndefined();
  });
});

describe('deleteInsightsForWorkspace', () => {
  it('removes all insights for a workspace', () => {
    const wsId = makeWorkspaceId('ws_del_ins');
    upsertInsight({ workspaceId: wsId, pageId: '/a', insightType: 'page_health', data: {}, severity: 'positive' });
    upsertInsight({ workspaceId: wsId, pageId: '/b', insightType: 'content_decay', data: {}, severity: 'warning' });

    const deleted = deleteInsightsForWorkspace(wsId);
    expect(deleted).toBe(2);
    expect(getInsights(wsId)).toEqual([]);
  });
});

describe('analytics insight secondary operations', () => {
  it('cloneInsightParams preserves enrichment fields for re-upsert callers', () => {
    const wsId = makeWorkspaceId('ws_clone');
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId: '/clone',
      insightType: 'page_health',
      data: pageHealthData,
      severity: 'warning',
      pageTitle: 'Clone Page',
      strategyKeyword: 'clone keyword',
      strategyAlignment: 'aligned',
      auditIssues: '["Missing H1"]',
      pipelineStatus: 'published',
      anomalyLinked: true,
      impactScore: 88,
      domain: 'search',
      resolutionSource: 'test-source',
      bridgeSource: 'bridge-test',
    });

    expect(cloneInsightParams(insight)).toMatchObject({
      workspaceId: wsId,
      pageId: '/clone',
      insightType: 'page_health',
      pageTitle: 'Clone Page',
      strategyKeyword: 'clone keyword',
      strategyAlignment: 'aligned',
      auditIssues: '["Missing H1"]',
      pipelineStatus: 'published',
      anomalyLinked: true,
      impactScore: 88,
      domain: 'search',
      resolutionSource: 'test-source',
      bridgeSource: 'bridge-test',
    });
  });

  it('filters insights by domain ordered by impact score', () => {
    const wsId = makeWorkspaceId('ws_domain');
    upsertInsight({
      workspaceId: wsId,
      pageId: '/low',
      insightType: 'page_health',
      data: pageHealthData,
      severity: 'warning',
      impactScore: 10,
      domain: 'traffic',
    });
    upsertInsight({
      workspaceId: wsId,
      pageId: '/high',
      insightType: 'content_decay',
      data: {},
      severity: 'critical',
      impactScore: 90,
      domain: 'traffic',
    });
    upsertInsight({
      workspaceId: wsId,
      pageId: '/search',
      insightType: 'ranking_opportunity',
      data: { query: 'kw', currentPosition: 8, impressions: 100, estimatedTrafficGain: 20, pageUrl: '/search' },
      severity: 'opportunity',
      impactScore: 100,
      domain: 'search',
    });

    const traffic = getInsightsByDomain(wsId, 'traffic');
    expect(traffic.map(insight => insight.pageId)).toEqual(['/high', '/low']);
  });

  it('resolves insights within workspace scope and lists unresolved critical/warning rows', () => {
    const wsId = makeWorkspaceId('ws_resolution');
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId: '/resolve',
      insightType: 'page_health',
      data: pageHealthData,
      severity: 'critical',
      impactScore: 42,
    });
    const warning = upsertInsight({
      workspaceId: wsId,
      pageId: '/warning',
      insightType: 'content_decay',
      data: {},
      severity: 'warning',
      impactScore: 30,
    });
    upsertInsight({
      workspaceId: wsId,
      pageId: '/positive',
      insightType: 'ranking_opportunity',
      data: { query: 'kw', currentPosition: 8, impressions: 100, estimatedTrafficGain: 20, pageUrl: '/positive' },
      severity: 'positive',
      impactScore: 100,
    });

    expect(resolveInsight(insight.id, 'wrong-workspace', 'resolved')).toBeUndefined();

    const inProgress = resolveInsight(insight.id, wsId, 'in_progress', 'Working it', 'admin');
    expect(inProgress?.resolutionStatus).toBe('in_progress');
    expect(inProgress?.resolutionNote).toBe('Working it');
    expect(inProgress?.resolvedAt).toBeNull();

    const resolved = resolveInsight(insight.id, wsId, 'resolved', 'Fixed', 'bridge');
    expect(resolved?.resolutionStatus).toBe('resolved');
    expect(resolved?.resolutionSource).toBe('bridge');
    expect(resolved?.resolvedAt).toEqual(expect.any(String));

    const unresolved = getUnresolvedInsights(wsId);
    expect(unresolved.map(item => item.id)).toEqual([warning.id]);
  });

  it('deletes stale unresolved non-bridge rows while preserving resolved and bridge rows', () => {
    const wsId = makeWorkspaceId('ws_stale');
    const stale = upsertInsight({
      workspaceId: wsId,
      pageId: '/stale',
      insightType: 'page_health',
      data: pageHealthData,
      severity: 'warning',
    });
    const resolved = upsertInsight({
      workspaceId: wsId,
      pageId: '/resolved',
      insightType: 'page_health',
      data: pageHealthData,
      severity: 'warning',
    });
    const bridged = upsertInsight({
      workspaceId: wsId,
      pageId: '/bridged',
      insightType: 'page_health',
      data: pageHealthData,
      severity: 'warning',
      bridgeSource: 'audit',
    });
    const fresh = upsertInsight({
      workspaceId: wsId,
      pageId: '/fresh',
      insightType: 'page_health',
      data: pageHealthData,
      severity: 'warning',
    });

    resolveInsight(resolved.id, wsId, 'resolved');
    db.prepare('UPDATE analytics_insights SET computed_at = ? WHERE id IN (?, ?, ?) AND workspace_id = ?')
      .run('2026-01-01T00:00:00.000Z', stale.id, resolved.id, bridged.id, wsId);

    const deleted = deleteStaleInsightsByType(wsId, 'page_health', '2026-02-01T00:00:00.000Z');
    expect(deleted).toBe(1);
    expect(getInsightById(stale.id, wsId)).toBeUndefined();
    expect(getInsightById(resolved.id, wsId)).toBeDefined();
    expect(getInsightById(bridged.id, wsId)).toBeDefined();
    expect(getInsightById(fresh.id, wsId)).toBeDefined();
  });

  it('suppresses selected IDs only within the requested workspace', () => {
    const wsId = makeWorkspaceId('ws_suppress');
    const otherWsId = makeWorkspaceId('ws_suppress_other');
    const first = upsertInsight({ workspaceId: wsId, pageId: '/a', insightType: 'page_health', data: pageHealthData, severity: 'warning' });
    const second = upsertInsight({ workspaceId: wsId, pageId: '/b', insightType: 'content_decay', data: {}, severity: 'critical' });
    const other = upsertInsight({ workspaceId: otherWsId, pageId: '/a', insightType: 'page_health', data: pageHealthData, severity: 'warning' });

    expect(suppressInsights(wsId, [])).toBe(0);
    expect(suppressInsights(wsId, [first.id, other.id])).toBe(1);
    expect(getInsightById(first.id, wsId)).toBeUndefined();
    expect(getInsightById(second.id, wsId)).toBeDefined();
    expect(getInsightById(other.id, otherWsId)).toBeDefined();
  });

  it('deduplicates anomaly digest insights and stamps diagnostic report IDs', () => {
    const wsId = makeWorkspaceId('ws_anomaly');
    const first = upsertAnomalyDigestInsight({
      workspaceId: wsId,
      anomalyType: 'traffic_drop',
      metric: 'clicks',
      data: makeAnomalyData({ currentValue: 40 }),
      severity: 'warning',
      domain: 'traffic',
      impactScore: 50,
    });
    const second = upsertAnomalyDigestInsight({
      workspaceId: wsId,
      anomalyType: 'traffic_drop',
      metric: 'clicks',
      data: makeAnomalyData({ currentValue: 25 }),
      severity: 'critical',
      domain: 'traffic',
      impactScore: 80,
    });

    expect(second.id).toBe(first.id);
    expect(second.pageId).toBe('anomaly:traffic_drop:clicks');
    expect(second.anomalyLinked).toBe(true);
    expect((second.data as AnomalyDigestData).currentValue).toBe(25);
    expect(getInsights(wsId, 'anomaly_digest')).toHaveLength(1);

    stampDiagnosticReportId(wsId, second.id, 'diag-123');
    const stamped = getInsightById(second.id, wsId);
    expect((stamped?.data as AnomalyDigestData).diagnosticReportId).toBe('diag-123');

    stampDiagnosticReportId('wrong-workspace', second.id, 'diag-wrong');
    const afterWrongWorkspace = getInsightById(second.id, wsId);
    expect((afterWrongWorkspace?.data as AnomalyDigestData).diagnosticReportId).toBe('diag-123');
  });
});

// Type-level smoke test — ensures AnalyticsInsight shape is exported correctly
describe('AnalyticsInsight type', () => {
  it('has correct shape', () => {
    const wsId = makeWorkspaceId('ws_type');
    const insight: AnalyticsInsight = upsertInsight({
      workspaceId: wsId,
      pageId: '/test',
      insightType: 'cannibalization',
      data: { pages: ['/a', '/b'], query: 'test keyword' },
      severity: 'critical',
    });

    const validSeverities: AnalyticsInsight['severity'][] = ['critical', 'warning', 'opportunity', 'positive'];
    expect(validSeverities).toContain(insight.severity);
  });
});
