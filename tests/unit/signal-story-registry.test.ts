import { describe, expect, it } from 'vitest';

import type {
  AnalyticsInsight,
  AuditFindingData,
  MilestoneAttributionData,
  SiteHealthInsightData,
} from '../../shared/types/analytics.js';
import {
  buildClientInsightStory,
  buildRecommendationStory,
  SUPPORTED_BRIEFING_INSIGHT_TYPES,
} from '../../server/signal-story-registry.js';

describe('signal-story-registry', () => {
  it('maps site_health insights without falling back to generic copy', () => {
    const insight: AnalyticsInsight<'site_health'> = {
      id: 'insight-site-health',
      workspaceId: 'ws_test',
      pageId: null,
      insightType: 'site_health',
      severity: 'warning',
      computedAt: '2026-05-19T00:00:00.000Z',
      impactScore: 84,
      domain: 'cross',
      data: {
        auditSnapshotId: 'audit_1',
        siteScore: 74,
        previousScore: 79,
        scoreDelta: -5,
        totalPages: 37,
        errors: 2,
        warnings: 62,
        siteWideIssueCount: 7,
      } satisfies SiteHealthInsightData,
    };

    const story = buildClientInsightStory(insight);

    expect(story).not.toBeNull();
    expect(story?.headline).not.toContain('Update on');
    expect(story?.narrative).toContain('74');
    expect(story?.narrative).toContain('37');
    expect(story?.impact).toContain('site-wide');
  });

  it('maps milestone_attribution insights into explicit win language', () => {
    const insight: AnalyticsInsight<'milestone_attribution'> = {
      id: 'insight-milestone',
      workspaceId: 'ws_test',
      pageId: '/guides/invisalign',
      insightType: 'milestone_attribution',
      severity: 'positive',
      computedAt: '2026-05-19T00:00:00.000Z',
      impactScore: 91,
      domain: 'search',
      data: {
        briefId: 'brief_1',
        briefTitle: 'Invisalign Guide',
        pageUrl: '/guides/invisalign',
        thresholdCrossed: 'fifty_clicks',
        currentClicks: 58,
        daysSinceDelivery: 32,
        trafficValue: 1425,
      } satisfies MilestoneAttributionData,
    };

    const story = buildClientInsightStory(insight);

    expect(story).not.toBeNull();
    expect(story?.headline).not.toContain('Update on');
    expect(story?.narrative).toContain('58');
    expect(story?.impact).toContain('$1,425');
  });

  it('maps audit_finding insights into explicit site or page work', () => {
    const insight: AnalyticsInsight<'audit_finding'> = {
      id: 'insight-audit',
      workspaceId: 'ws_test',
      pageId: '/contact',
      pageTitle: 'Contact',
      insightType: 'audit_finding',
      severity: 'warning',
      computedAt: '2026-05-19T00:00:00.000Z',
      impactScore: 55,
      domain: 'search',
      data: {
        scope: 'page',
        issueCount: 3,
        issueMessages: 'Missing title; missing meta description',
        source: 'audit-cron',
      } satisfies AuditFindingData,
    };

    const story = buildClientInsightStory(insight);

    expect(story).not.toBeNull();
    expect(story?.headline).toContain('Contact');
    expect(story?.narrative).toContain('3');
    expect(story?.headline).not.toContain('Update on');
  });

  it('builds centralized recommendation copy for overlapping content-decay stories', () => {
    const story = buildRecommendationStory('content_decay', {
      pagePath: '/services/invisalign',
      title: 'Invisalign',
      clickDeclinePct: -42,
      refreshRecommendation: null,
      severity: 'critical',
      previousClicks: 180,
      currentClicks: 104,
      previousPosition: 4.2,
      currentPosition: 8.1,
    });

    expect(story.title).toContain('Content Decay');
    expect(story.description).toContain('42%');
    expect(story.insight).toContain('Position moved');
    expect(story.estimatedGain).toContain('clicks/mo');
  });

  it('keeps briefing milestone support routed through the shared registry boundary', () => {
    expect(SUPPORTED_BRIEFING_INSIGHT_TYPES).toContain('milestone_attribution');
    expect(SUPPORTED_BRIEFING_INSIGHT_TYPES).toContain('content_decay');
    expect(SUPPORTED_BRIEFING_INSIGHT_TYPES).not.toContain('site_health');
  });
});
