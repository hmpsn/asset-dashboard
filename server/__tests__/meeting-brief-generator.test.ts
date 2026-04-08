// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { assembleMeetingBriefMetrics, buildBriefPrompt } from '../meeting-brief-generator.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';

// Minimal intelligence fixture — only the slices our code touches
const MOCK_INTELLIGENCE: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'test-ws',
  assembledAt: '2026-04-07T12:00:00Z',
  siteHealth: {
    auditScore: 83,
    auditScoreDelta: 5,
    deadLinks: 2,
    redirectChains: 0,
    schemaErrors: 1,
    orphanPages: 0,
    cwvPassRate: { mobile: null, desktop: null },
  },
  insights: {
    all: [],
    byType: {
      ranking_opportunity: [{ id: '1' } as any, { id: '2' } as any, { id: '3' } as any], // as-any-ok: partial InsightRecord fixtures
    },
    bySeverity: { critical: 2, warning: 5, opportunity: 8, positive: 3 },
    topByImpact: [
      {
        id: 'top-1',
        workspaceId: 'test-ws',
        pageId: 'page-1',
        insightType: 'ranking_opportunity',
        data: { keyword: 'test keyword', position: 12 },
        severity: 'critical',
        computedAt: '2026-04-07T12:00:00Z',
        pageTitle: 'About Us',
      } as any, // as-any-ok: partial InsightRecord fixture
    ],
  },
  contentPipeline: {
    briefs: { total: 4, byStatus: {} },
    posts: { total: 2, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 1, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 },
    coverageGaps: [],
    seoEdits: { pending: 0, applied: 0, inReview: 0 },
  },
  learnings: {
    summary: null,
    confidence: null,
    topActionTypes: [],
    overallWinRate: 0.72,
    recentTrend: null,
    playbooks: [],
  },
};

describe('assembleMeetingBriefMetrics', () => {
  it('extracts metrics from intelligence slices', () => {
    const metrics = assembleMeetingBriefMetrics(MOCK_INTELLIGENCE);
    expect(metrics.siteHealthScore).toBe(83);
    expect(metrics.openRankingOpportunities).toBe(3);
    expect(metrics.contentInPipeline).toBe(6); // 4 briefs + 2 posts
    expect(metrics.overallWinRate).toBe(72); // 0.72 * 100, rounded
    expect(metrics.criticalIssues).toBe(2);
  });

  it('handles missing slices gracefully', () => {
    const sparse: WorkspaceIntelligence = {
      version: 1,
      workspaceId: 'x',
      assembledAt: '',
    };
    const metrics = assembleMeetingBriefMetrics(sparse);
    expect(metrics.siteHealthScore).toBeNull();
    expect(metrics.openRankingOpportunities).toBe(0);
    expect(metrics.contentInPipeline).toBe(0);
    expect(metrics.overallWinRate).toBeNull();
    expect(metrics.criticalIssues).toBe(0);
  });
});

describe('buildBriefPrompt', () => {
  it('includes key intelligence signals in the prompt', () => {
    const prompt = buildBriefPrompt(MOCK_INTELLIGENCE);
    expect(prompt).toContain('ranking_opportunity');
    expect(prompt).toContain('CRITICAL');
    expect(prompt).toContain('JSON');
  });

  it('includes site health score and win rate', () => {
    const prompt = buildBriefPrompt(MOCK_INTELLIGENCE);
    expect(prompt).toContain('83');
    expect(prompt).toContain('72%');
  });

  it('handles sparse intelligence without crashing', () => {
    const sparse: WorkspaceIntelligence = {
      version: 1,
      workspaceId: 'x',
      assembledAt: '',
    };
    const prompt = buildBriefPrompt(sparse);
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('unknown');
  });
});
