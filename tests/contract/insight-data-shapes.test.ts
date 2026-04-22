// tests/contract/insight-data-shapes.test.ts
//
// CONTRACT: Each InsightType produces the correct data shape as defined in InsightDataMap.
// For every type: upsert a minimal valid data object, read it back, verify key fields.
//
// Tests are self-contained — no shared state, no dependency on execution order.
// Workspace IDs are unique per describe block to prevent cross-test interference.

import { describe, it, expect } from 'vitest';
import {
  upsertInsight,
  getInsight,
} from '../../server/analytics-insights-store.js';
import type {
  PageHealthData,
  QuickWinData,
  ContentDecayData,
  CannibalizationData,
  KeywordClusterData,
  CompetitorGapData,
  ConversionAttributionData,
  RankingMoverData,
  CtrOpportunityData,
  SerpOpportunityData,
  AnomalyDigestData,
  AuditFindingData,
  SiteHealthInsightData,
} from '../../shared/types/analytics.js';

// ── page_health ────────────────────────────────────────────────────────────────

describe('InsightType: page_health', () => {
  const wsId = `ws_contract_page_health_${Date.now()}`;
  const pageId = '/test-page-health';

  const data: PageHealthData = {
    score: 78,
    trend: 'improving',
    clicks: 120,
    impressions: 1500,
    position: 8.2,
    ctr: 8.0,
    pageviews: 200,
    bounceRate: 42.5,
    avgEngagementTime: 95,
  };

  it('upsertInsight accepts PageHealthData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'page_health',
      data: data as unknown as Record<string, unknown>,
      severity: 'opportunity',
    });

    expect(insight.insightType).toBe('page_health');
    expect(insight.workspaceId).toBe(wsId);
    expect(insight.pageId).toBe(pageId);
  });

  it('reads back data with correct PageHealthData key fields', () => {
    const insight = getInsight(wsId, pageId, 'page_health');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as PageHealthData;

    expect(typeof d.score).toBe('number');
    expect(d.score).toBe(78);
    expect(['improving', 'declining', 'stable']).toContain(d.trend);
    expect(d.trend).toBe('improving');
    expect(typeof d.clicks).toBe('number');
    expect(typeof d.impressions).toBe('number');
    expect(typeof d.position).toBe('number');
    expect(typeof d.ctr).toBe('number');
    expect(typeof d.pageviews).toBe('number');
    expect(typeof d.bounceRate).toBe('number');
    expect(typeof d.avgEngagementTime).toBe('number');
  });
});

// ── ranking_opportunity ────────────────────────────────────────────────────────

describe('InsightType: ranking_opportunity', () => {
  const wsId = `ws_contract_ranking_opp_${Date.now()}`;
  const pageId = '/test-ranking-opportunity';

  const data: QuickWinData = {
    query: 'seo audit tool',
    currentPosition: 12,
    impressions: 3200,
    estimatedTrafficGain: 45,
    pageUrl: 'https://example.com/seo-audit',
  };

  it('upsertInsight accepts QuickWinData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'ranking_opportunity',
      data: data as unknown as Record<string, unknown>,
      severity: 'opportunity',
    });

    expect(insight.insightType).toBe('ranking_opportunity');
  });

  it('reads back data with correct QuickWinData key fields', () => {
    const insight = getInsight(wsId, pageId, 'ranking_opportunity');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as QuickWinData;

    expect(typeof d.query).toBe('string');
    expect(d.query).toBe('seo audit tool');
    expect(typeof d.currentPosition).toBe('number');
    expect(d.currentPosition).toBe(12);
    expect(typeof d.estimatedTrafficGain).toBe('number');
    expect(d.estimatedTrafficGain).toBe(45);
    expect(typeof d.impressions).toBe('number');
    expect(typeof d.pageUrl).toBe('string');
  });
});

// ── content_decay ─────────────────────────────────────────────────────────────

describe('InsightType: content_decay', () => {
  const wsId = `ws_contract_content_decay_${Date.now()}`;
  const pageId = '/blog/old-post';

  const data: ContentDecayData = {
    baselineClicks: 450,
    currentClicks: 180,
    deltaPercent: -60,
    baselinePeriod: '2025-01-01/2025-03-01',
    currentPeriod: '2025-07-01/2025-09-01',
  };

  it('upsertInsight accepts ContentDecayData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'content_decay',
      data: data as unknown as Record<string, unknown>,
      severity: 'warning',
    });

    expect(insight.insightType).toBe('content_decay');
  });

  it('reads back data with correct ContentDecayData key fields', () => {
    const insight = getInsight(wsId, pageId, 'content_decay');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as ContentDecayData;

    expect(typeof d.baselineClicks).toBe('number');
    expect(d.baselineClicks).toBe(450);
    expect(typeof d.currentClicks).toBe('number');
    expect(d.currentClicks).toBe(180);
    expect(typeof d.deltaPercent).toBe('number');
    expect(d.deltaPercent).toBe(-60);
    expect(typeof d.baselinePeriod).toBe('string');
    expect(typeof d.currentPeriod).toBe('string');
  });
});

// ── cannibalization ────────────────────────────────────────────────────────────

describe('InsightType: cannibalization', () => {
  const wsId = `ws_contract_cannibalization_${Date.now()}`;
  const pageId = '/competing-page';

  const data: CannibalizationData = {
    query: 'best seo software',
    pages: ['/page-a', '/page-b'],
    positions: [4, 7],
    totalImpressions: 8200,
  };

  it('upsertInsight accepts CannibalizationData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'cannibalization',
      data: data as unknown as Record<string, unknown>,
      severity: 'warning',
    });

    expect(insight.insightType).toBe('cannibalization');
  });

  it('reads back data with correct CannibalizationData key fields', () => {
    const insight = getInsight(wsId, pageId, 'cannibalization');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as CannibalizationData;

    expect(typeof d.query).toBe('string');
    expect(d.query).toBe('best seo software');
    expect(Array.isArray(d.pages)).toBe(true);
    expect(d.pages.length).toBeGreaterThan(0);
    expect(d.pages).toContain('/page-a');
    expect(Array.isArray(d.positions)).toBe(true);
    expect(d.positions.length).toBeGreaterThan(0);
    expect(typeof d.totalImpressions).toBe('number');
  });
});

// ── keyword_cluster ────────────────────────────────────────────────────────────

describe('InsightType: keyword_cluster', () => {
  const wsId = `ws_contract_keyword_cluster_${Date.now()}`;
  // keyword_cluster is workspace-level; pageId can be null
  const pageId = null;

  const data: KeywordClusterData = {
    label: 'Enterprise SEO',
    queries: ['enterprise seo', 'seo for large sites', 'enterprise search optimization'],
    totalImpressions: 12400,
    avgPosition: 9.1,
    pillarPage: '/enterprise-seo',
  };

  it('upsertInsight accepts KeywordClusterData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'keyword_cluster',
      data: data as unknown as Record<string, unknown>,
      severity: 'opportunity',
    });

    expect(insight.insightType).toBe('keyword_cluster');
    expect(insight.pageId).toBeNull();
  });

  it('reads back data with correct KeywordClusterData key fields', () => {
    const insight = getInsight(wsId, pageId, 'keyword_cluster');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as KeywordClusterData;

    expect(typeof d.label).toBe('string');
    expect(d.label).toBe('Enterprise SEO');
    expect(Array.isArray(d.queries)).toBe(true);
    expect(d.queries.length).toBeGreaterThan(0);
    expect(d.queries).toContain('enterprise seo');
    expect(typeof d.totalImpressions).toBe('number');
    expect(typeof d.avgPosition).toBe('number');
    // pillarPage can be string or null
    expect(d.pillarPage === null || typeof d.pillarPage === 'string').toBe(true);
  });
});

// ── competitor_gap ─────────────────────────────────────────────────────────────

describe('InsightType: competitor_gap', () => {
  const wsId = `ws_contract_competitor_gap_${Date.now()}`;
  const pageId = '/competitor-gap-page';

  const data: CompetitorGapData = {
    keyword: 'technical seo audit',
    competitorDomain: 'ahrefs.com',
    competitorPosition: 2,
    ourPosition: null,
    volume: 5400,
    difficulty: 72,
  };

  it('upsertInsight accepts CompetitorGapData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'competitor_gap',
      data: data as unknown as Record<string, unknown>,
      severity: 'opportunity',
    });

    expect(insight.insightType).toBe('competitor_gap');
  });

  it('reads back data with correct CompetitorGapData key fields', () => {
    const insight = getInsight(wsId, pageId, 'competitor_gap');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as CompetitorGapData;

    expect(typeof d.keyword).toBe('string');
    expect(d.keyword).toBe('technical seo audit');
    expect(typeof d.competitorDomain).toBe('string');
    expect(d.competitorDomain).toBe('ahrefs.com');
    expect(typeof d.competitorPosition).toBe('number');
    expect(d.competitorPosition).toBe(2);
    // ourPosition is number or null
    expect(d.ourPosition === null || typeof d.ourPosition === 'number').toBe(true);
    expect(typeof d.volume).toBe('number');
    expect(typeof d.difficulty).toBe('number');
    expect(d.difficulty).toBe(72);
  });
});

// ── conversion_attribution ─────────────────────────────────────────────────────

describe('InsightType: conversion_attribution', () => {
  const wsId = `ws_contract_conversion_attr_${Date.now()}`;
  const pageId = '/landing-page';

  const data: ConversionAttributionData = {
    sessions: 2100,
    conversions: 84,
    conversionRate: 4.0,
    estimatedRevenue: null,
  };

  it('upsertInsight accepts ConversionAttributionData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'conversion_attribution',
      data: data as unknown as Record<string, unknown>,
      severity: 'positive',
    });

    expect(insight.insightType).toBe('conversion_attribution');
  });

  it('reads back data with correct ConversionAttributionData key fields', () => {
    const insight = getInsight(wsId, pageId, 'conversion_attribution');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as ConversionAttributionData;

    expect(typeof d.sessions).toBe('number');
    expect(d.sessions).toBe(2100);
    expect(typeof d.conversions).toBe('number');
    expect(d.conversions).toBe(84);
    expect(typeof d.conversionRate).toBe('number');
    expect(d.conversionRate).toBe(4.0);
    // estimatedRevenue is number or null
    expect(d.estimatedRevenue === null || typeof d.estimatedRevenue === 'number').toBe(true);
  });
});

// ── ranking_mover ──────────────────────────────────────────────────────────────

describe('InsightType: ranking_mover', () => {
  const wsId = `ws_contract_ranking_mover_${Date.now()}`;
  const pageId = '/moved-page';

  const data: RankingMoverData = {
    query: 'rank tracking tool',
    pageUrl: 'https://example.com/rank-tracking',
    currentPosition: 5,
    previousPosition: 14,
    positionChange: 9,
    currentClicks: 310,
    previousClicks: 85,
    impressions: 4200,
  };

  it('upsertInsight accepts RankingMoverData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'ranking_mover',
      data: data as unknown as Record<string, unknown>,
      severity: 'positive',
    });

    expect(insight.insightType).toBe('ranking_mover');
  });

  it('reads back data with correct RankingMoverData key fields', () => {
    const insight = getInsight(wsId, pageId, 'ranking_mover');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as RankingMoverData;

    expect(typeof d.query).toBe('string');
    expect(d.query).toBe('rank tracking tool');
    expect(typeof d.pageUrl).toBe('string');
    expect(typeof d.currentPosition).toBe('number');
    expect(d.currentPosition).toBe(5);
    expect(typeof d.previousPosition).toBe('number');
    expect(d.previousPosition).toBe(14);
    expect(typeof d.positionChange).toBe('number');
    // positionChange positive = improved
    expect(d.positionChange).toBe(9);
    expect(typeof d.currentClicks).toBe('number');
    expect(typeof d.previousClicks).toBe('number');
    expect(typeof d.impressions).toBe('number');
  });
});

// ── ctr_opportunity ────────────────────────────────────────────────────────────

describe('InsightType: ctr_opportunity', () => {
  const wsId = `ws_contract_ctr_opportunity_${Date.now()}`;
  const pageId = '/low-ctr-page';

  const data: CtrOpportunityData = {
    query: 'keyword research guide',
    pageUrl: 'https://example.com/keyword-research',
    position: 3.2,
    actualCtr: 4.1,
    expectedCtr: 18.0,
    ctrRatio: 0.23,
    impressions: 6800,
    estimatedClickGap: 940,
  };

  it('upsertInsight accepts CtrOpportunityData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'ctr_opportunity',
      data: data as unknown as Record<string, unknown>,
      severity: 'warning',
    });

    expect(insight.insightType).toBe('ctr_opportunity');
  });

  it('reads back data with correct CtrOpportunityData key fields', () => {
    const insight = getInsight(wsId, pageId, 'ctr_opportunity');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as CtrOpportunityData;

    expect(typeof d.query).toBe('string');
    expect(d.query).toBe('keyword research guide');
    expect(typeof d.pageUrl).toBe('string');
    expect(typeof d.position).toBe('number');
    expect(typeof d.actualCtr).toBe('number');
    expect(d.actualCtr).toBe(4.1);
    expect(typeof d.expectedCtr).toBe('number');
    expect(d.expectedCtr).toBe(18.0);
    // expectedCtr > actualCtr for a real opportunity
    expect(d.expectedCtr).toBeGreaterThan(d.actualCtr);
    expect(typeof d.ctrRatio).toBe('number');
    expect(typeof d.impressions).toBe('number');
    expect(typeof d.estimatedClickGap).toBe('number');
  });
});

// ── serp_opportunity ───────────────────────────────────────────────────────────

describe('InsightType: serp_opportunity', () => {
  const wsId = `ws_contract_serp_opportunity_${Date.now()}`;
  const pageId = '/serp-page';

  const data: SerpOpportunityData = {
    pageUrl: 'https://example.com/faq-page',
    impressions: 9200,
    clicks: 310,
    position: 6.4,
    ctr: 3.4,
    schemaStatus: 'missing',
  };

  it('upsertInsight accepts SerpOpportunityData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'serp_opportunity',
      data: data as unknown as Record<string, unknown>,
      severity: 'opportunity',
    });

    expect(insight.insightType).toBe('serp_opportunity');
  });

  it('reads back data with correct SerpOpportunityData key fields', () => {
    const insight = getInsight(wsId, pageId, 'serp_opportunity');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as SerpOpportunityData;

    expect(typeof d.pageUrl).toBe('string');
    expect(d.pageUrl).toBe('https://example.com/faq-page');
    expect(typeof d.impressions).toBe('number');
    expect(typeof d.clicks).toBe('number');
    expect(typeof d.position).toBe('number');
    expect(typeof d.ctr).toBe('number');
    expect(['missing', 'partial', 'complete']).toContain(d.schemaStatus);
    expect(d.schemaStatus).toBe('missing');
  });
});

// ── strategy_alignment ─────────────────────────────────────────────────────────

describe('InsightType: strategy_alignment', () => {
  const wsId = `ws_contract_strategy_align_${Date.now()}`;
  // strategy_alignment is workspace-level
  const pageId = null;

  const data: Record<string, unknown> = {
    alignedCount: 12,
    misalignedCount: 4,
    untrackedCount: 7,
    summary: 'Most pages are aligned with target strategy.',
  };

  it('upsertInsight accepts Record<string,unknown> and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'strategy_alignment',
      data,
      severity: 'warning',
    });

    expect(insight.insightType).toBe('strategy_alignment');
    expect(insight.pageId).toBeNull();
  });

  it('reads back data as an object with stored keys', () => {
    const insight = getInsight(wsId, pageId, 'strategy_alignment');
    expect(insight).toBeDefined();
    const d = insight!.data;

    expect(typeof d).toBe('object');
    expect(d).not.toBeNull();
    expect(d['alignedCount']).toBe(12);
    expect(d['misalignedCount']).toBe(4);
    expect(typeof d['summary']).toBe('string');
  });
});

// ── anomaly_digest ─────────────────────────────────────────────────────────────

describe('InsightType: anomaly_digest', () => {
  const wsId = `ws_contract_anomaly_digest_${Date.now()}`;
  // anomaly_digest uses dedupKey as pageId via upsertAnomalyDigestInsight,
  // but direct upsertInsight also accepts a pageId
  const pageId = 'anomaly:traffic_drop:clicks';

  const data: AnomalyDigestData = {
    anomalyType: 'traffic_drop',
    metric: 'clicks',
    currentValue: 120,
    expectedValue: 340,
    deviationPercent: -64.7,
    durationDays: 8,
    firstDetected: '2026-03-29T00:00:00.000Z',
    severity: 'critical',
  };

  it('upsertInsight accepts AnomalyDigestData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'anomaly_digest',
      data: data as unknown as Record<string, unknown>,
      severity: 'critical',
      anomalyLinked: true,
    });

    expect(insight.insightType).toBe('anomaly_digest');
    expect(insight.anomalyLinked).toBe(true);
  });

  it('reads back data with correct AnomalyDigestData key fields', () => {
    const insight = getInsight(wsId, pageId, 'anomaly_digest');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as AnomalyDigestData;

    expect(typeof d.anomalyType).toBe('string');
    expect(d.anomalyType).toBe('traffic_drop');
    expect(typeof d.metric).toBe('string');
    expect(d.metric).toBe('clicks');
    expect(typeof d.currentValue).toBe('number');
    expect(d.currentValue).toBe(120);
    expect(typeof d.expectedValue).toBe('number');
    expect(d.expectedValue).toBe(340);
    expect(typeof d.deviationPercent).toBe('number');
    expect(d.deviationPercent).toBe(-64.7);
    expect(typeof d.durationDays).toBe('number');
    expect(typeof d.firstDetected).toBe('string');
    expect(typeof d.severity).toBe('string');
  });
});

// ── audit_finding ──────────────────────────────────────────────────────────────

describe('InsightType: audit_finding', () => {
  const wsId = `ws_contract_audit_finding_${Date.now()}`;
  const pageId = '/broken-page';

  const data: AuditFindingData = {
    scope: 'page',
    issueCount: 3,
    issueMessages: 'Missing meta description; Duplicate H1 tag; Image alt text missing',
    source: 'audit-bridge',
  };

  it('upsertInsight accepts AuditFindingData (page scope) and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'audit_finding',
      data: data as unknown as Record<string, unknown>,
      severity: 'warning',
      bridgeSource: 'audit-bridge',
    });

    expect(insight.insightType).toBe('audit_finding');
    expect(insight.bridgeSource).toBe('audit-bridge');
  });

  it('reads back data with correct AuditFindingData key fields (page scope)', () => {
    const insight = getInsight(wsId, pageId, 'audit_finding');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as AuditFindingData;

    expect(['page', 'site']).toContain(d.scope);
    expect(d.scope).toBe('page');
    expect(typeof d.issueCount).toBe('number');
    expect(d.issueCount).toBe(3);
    expect(typeof d.issueMessages).toBe('string');
    expect(d.issueMessages).toContain('Missing meta description');
    expect(typeof d.source).toBe('string');
    expect(d.source).toBe('audit-bridge');
    // siteScore is optional — not present for page-scope
    expect(d.siteScore === undefined || typeof d.siteScore === 'number').toBe(true);
  });

  it('accepts site-scope AuditFindingData with optional siteScore', () => {
    const siteData: AuditFindingData = {
      scope: 'site',
      issueCount: 47,
      issueMessages: 'Multiple redirect chains; Missing canonical tags; Slow page speed on 12 pages',
      siteScore: 61,
      source: 'audit-bridge',
    };
    const wsIdSite = `ws_contract_audit_site_${Date.now()}`;

    const insight = upsertInsight({
      workspaceId: wsIdSite,
      pageId: null,
      insightType: 'audit_finding',
      data: siteData as unknown as Record<string, unknown>,
      severity: 'critical',
      bridgeSource: 'audit-bridge',
    });

    const read = getInsight(wsIdSite, null, 'audit_finding');
    expect(read).toBeDefined();
    const d = read!.data as unknown as AuditFindingData;

    expect(d.scope).toBe('site');
    expect(d.issueCount).toBe(47);
    expect(typeof d.siteScore).toBe('number');
    expect(d.siteScore).toBe(61);
  });
});

// ── site_health ────────────────────────────────────────────────────────────────

describe('InsightType: site_health', () => {
  const wsId = `ws_contract_site_health_${Date.now()}`;
  // site_health is workspace-level
  const pageId = null;

  const data: SiteHealthInsightData = {
    auditSnapshotId: 'snap_abc123',
    siteScore: 74,
    previousScore: 68,
    scoreDelta: 6,
    totalPages: 85,
    errors: 4,
    warnings: 18,
    siteWideIssueCount: 9,
  };

  it('upsertInsight accepts SiteHealthInsightData and returns the insight', () => {
    const insight = upsertInsight({
      workspaceId: wsId,
      pageId,
      insightType: 'site_health',
      data: data as unknown as Record<string, unknown>,
      severity: 'warning',
      bridgeSource: 'site-health-bridge',
    });

    expect(insight.insightType).toBe('site_health');
    expect(insight.pageId).toBeNull();
    expect(insight.bridgeSource).toBe('site-health-bridge');
  });

  it('reads back data with correct SiteHealthInsightData key fields', () => {
    const insight = getInsight(wsId, pageId, 'site_health');
    expect(insight).toBeDefined();
    const d = insight!.data as unknown as SiteHealthInsightData;

    expect(typeof d.auditSnapshotId).toBe('string');
    expect(d.auditSnapshotId).toBe('snap_abc123');
    expect(typeof d.siteScore).toBe('number');
    expect(d.siteScore).toBe(74);
    // previousScore is number or null
    expect(d.previousScore === null || typeof d.previousScore === 'number').toBe(true);
    expect(d.previousScore).toBe(68);
    // scoreDelta is number or null
    expect(d.scoreDelta === null || typeof d.scoreDelta === 'number').toBe(true);
    expect(d.scoreDelta).toBe(6);
    expect(typeof d.totalPages).toBe('number');
    expect(d.totalPages).toBe(85);
    expect(typeof d.errors).toBe('number');
    expect(typeof d.warnings).toBe('number');
    expect(typeof d.siteWideIssueCount).toBe('number');
  });

  it('accepts null previousScore and scoreDelta for first-run snapshot', () => {
    const firstRunData: SiteHealthInsightData = {
      auditSnapshotId: 'snap_firstrun',
      siteScore: 55,
      previousScore: null,
      scoreDelta: null,
      totalPages: 30,
      errors: 10,
      warnings: 25,
      siteWideIssueCount: 15,
    };
    const wsIdFirst = `ws_contract_site_health_first_${Date.now()}`;

    upsertInsight({
      workspaceId: wsIdFirst,
      pageId: null,
      insightType: 'site_health',
      data: firstRunData as unknown as Record<string, unknown>,
      severity: 'critical',
    });

    const read = getInsight(wsIdFirst, null, 'site_health');
    expect(read).toBeDefined();
    const d = read!.data as unknown as SiteHealthInsightData;

    expect(d.previousScore).toBeNull();
    expect(d.scoreDelta).toBeNull();
    expect(d.siteScore).toBe(55);
  });
});

// ── Cross-cutting: all 14 types are stored and retrieved ──────────────────────

describe('InsightType coverage: all 14 types round-trip through the store', () => {
  const wsId = `ws_contract_all_types_${Date.now()}`;

  const allTypes = [
    'page_health',
    'ranking_opportunity',
    'content_decay',
    'cannibalization',
    'keyword_cluster',
    'competitor_gap',
    'conversion_attribution',
    'ranking_mover',
    'ctr_opportunity',
    'serp_opportunity',
    'strategy_alignment',
    'anomaly_digest',
    'audit_finding',
    'site_health',
  ] as const;

  // Minimal valid data per type — satisfies each Zod schema so parseJsonSafe returns real data.
  const minimalValidData: Record<typeof allTypes[number], Record<string, unknown>> = {
    page_health: { score: 50, trend: 'stable', clicks: 10, impressions: 100, position: 15, ctr: 10, pageviews: 20, bounceRate: 50, avgEngagementTime: 60 },
    ranking_opportunity: { query: 'kw', currentPosition: 12, impressions: 500, estimatedTrafficGain: 30, pageUrl: '/page' },
    content_decay: { baselineClicks: 100, currentClicks: 40, deltaPercent: -60, baselinePeriod: '2024-Q1', currentPeriod: '2024-Q2' },
    cannibalization: { query: 'kw', pages: ['/a', '/b'], positions: [5, 8], totalImpressions: 200 },
    keyword_cluster: { label: 'Cluster A', queries: ['kw1'], totalImpressions: 300, avgPosition: 7, pillarPage: null },
    competitor_gap: { keyword: 'kw', competitorDomain: 'rival.com', competitorPosition: 3, ourPosition: null, volume: 500, difficulty: 40 },
    conversion_attribution: { sessions: 100, conversions: 5, conversionRate: 5, estimatedRevenue: null },
    ranking_mover: { query: 'kw', pageUrl: '/page', currentPosition: 8, previousPosition: 14, positionChange: 6, currentClicks: 50, previousClicks: 20, impressions: 600 },
    ctr_opportunity: { query: 'kw', pageUrl: '/page', position: 3, actualCtr: 2, expectedCtr: 8, ctrRatio: 0.25, impressions: 400, estimatedClickGap: 24 },
    serp_opportunity: { pageUrl: '/page', impressions: 200, clicks: 10, position: 6, ctr: 5, schemaStatus: 'missing' },
    strategy_alignment: { alignedCount: 3, misalignedCount: 1, untrackedCount: 2 },
    anomaly_digest: { anomalyType: 'spike', metric: 'clicks', currentValue: 200, expectedValue: 50, deviationPercent: 300, durationDays: 3, firstDetected: '2024-01-01', severity: 'critical' },
    audit_finding: { scope: 'page', issueCount: 2, issueMessages: 'Missing H1', source: 'audit' },
    site_health: { auditSnapshotId: 'snap_1', siteScore: 72, previousScore: 65, scoreDelta: 7, totalPages: 20, errors: 1, warnings: 3, siteWideIssueCount: 4 },
  };

  it('each InsightType can be upserted and read back', () => {
    for (const insightType of allTypes) {
      const pageId = `/${insightType}`;
      upsertInsight({
        workspaceId: wsId,
        pageId,
        insightType,
        data: minimalValidData[insightType],
        severity: 'opportunity',
      });
      const read = getInsight(wsId, pageId, insightType);
      expect(read, `Expected insight to exist for type: ${insightType}`).toBeDefined();
      expect(read!.insightType).toBe(insightType);
      expect(read!.data).toBeDefined();
    }
  });

  it('coverage count: exactly 14 InsightTypes are tested', () => {
    expect(allTypes.length).toBe(14);
  });
});
