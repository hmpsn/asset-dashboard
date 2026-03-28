/**
 * Unit tests for server/analytics-insights-store.ts — CRUD on analytics_insights table.
 */
import { describe, it, expect } from 'vitest';
import {
  upsertInsight,
  getInsights,
  getInsight,
  deleteInsightsForWorkspace,
} from '../../server/analytics-insights-store.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';

describe('upsertInsight', () => {
  it('creates a new insight and returns it', () => {
    const wsId = 'ws_ins_' + Date.now();
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId: '/blog/test',
      insightType: 'page_health',
      data: { score: 72, trend: 'improving' },
      severity: 'opportunity',
    });

    expect(insight.id).toMatch(/^ins_/);
    expect(insight.workspaceId).toBe(wsId);
    expect(insight.pageId).toBe('/blog/test');
    expect(insight.insightType).toBe('page_health');
    expect(insight.data).toEqual({ score: 72, trend: 'improving' });
    expect(insight.severity).toBe('opportunity');
    expect(insight.computedAt).toBeDefined();
  });

  it('replaces existing insight with same workspace+page+type key', () => {
    const wsId = 'ws_upsert_' + Date.now();
    upsertInsight({
      workspaceId: wsId,
      pageId: '/home',
      insightType: 'ranking_opportunity',
      data: { estimatedGain: 100 },
      severity: 'opportunity',
    });
    const updated = upsertInsight({
      workspaceId: wsId,
      pageId: '/home',
      insightType: 'ranking_opportunity',
      data: { estimatedGain: 250 },
      severity: 'positive',
    });

    expect(updated.data).toEqual({ estimatedGain: 250 });
    expect(updated.severity).toBe('positive');

    const results = getInsights(wsId);
    const quickWins = results.filter(i => i.insightType === 'ranking_opportunity');
    expect(quickWins).toHaveLength(1);
  });

  it('supports null pageId for workspace-level insights', () => {
    const wsId = 'ws_nullpage_' + Date.now();
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
    const wsId = 'ws_list_ins_' + Date.now();
    upsertInsight({ workspaceId: wsId, pageId: '/a', insightType: 'page_health', data: {}, severity: 'positive' });
    upsertInsight({ workspaceId: wsId, pageId: '/b', insightType: 'content_decay', data: {}, severity: 'warning' });

    const insights = getInsights(wsId);
    expect(insights.length).toBe(2);
    expect(insights.every(i => i.workspaceId === wsId)).toBe(true);
  });

  it('can filter by insightType', () => {
    const wsId = 'ws_filter_' + Date.now();
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
    const wsId = 'ws_get_' + Date.now();
    upsertInsight({ workspaceId: wsId, pageId: '/services', insightType: 'ranking_opportunity', data: { pos: 7 }, severity: 'opportunity' });

    const insight = getInsight(wsId, '/services', 'ranking_opportunity');
    expect(insight).toBeDefined();
    expect(insight!.data).toEqual({ pos: 7 });
  });

  it('returns undefined when no matching insight exists', () => {
    expect(getInsight('ws_nobody', '/nope', 'page_health')).toBeUndefined();
  });
});

describe('deleteInsightsForWorkspace', () => {
  it('removes all insights for a workspace', () => {
    const wsId = 'ws_del_ins_' + Date.now();
    upsertInsight({ workspaceId: wsId, pageId: '/a', insightType: 'page_health', data: {}, severity: 'positive' });
    upsertInsight({ workspaceId: wsId, pageId: '/b', insightType: 'content_decay', data: {}, severity: 'warning' });

    const deleted = deleteInsightsForWorkspace(wsId);
    expect(deleted).toBe(2);
    expect(getInsights(wsId)).toEqual([]);
  });
});

// Type-level smoke test — ensures AnalyticsInsight shape is exported correctly
describe('AnalyticsInsight type', () => {
  it('has correct shape', () => {
    const wsId = 'ws_type_' + Date.now();
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
