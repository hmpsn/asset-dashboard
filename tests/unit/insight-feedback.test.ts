import { describe, it, expect } from 'vitest';
import {
  buildStrategySignals,
  buildPipelineSignals,
} from '../../server/insight-feedback.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';

/** Minimal base insight fixture — override fields as needed per test. */
function makeInsight(overrides: Partial<AnalyticsInsight> = {}): AnalyticsInsight {
  return {
    id: 'ins_001',
    workspaceId: 'ws_test',
    pageId: '/blog/test-page',
    insightType: 'page_health',
    data: {},
    severity: 'opportunity',
    computedAt: new Date().toISOString(),
    pageTitle: 'Test Page',
    strategyKeyword: null,
    strategyAlignment: null,
    pipelineStatus: null,
    anomalyLinked: false,
    impactScore: 50,
    domain: 'search',
    ...overrides,
  };
}

// ── Strategy signals ──────────────────────────────────────────────

describe('buildStrategySignals', () => {
  it('generates momentum signal for ranking movers gaining >3 positions', () => {
    const insight = makeInsight({
      id: 'mover_1',
      insightType: 'ranking_mover',
      data: { query: 'best ai tools', previousPosition: 15, currentPosition: 8, impressions: 500 },
      impactScore: 75,
    });

    const signals = buildStrategySignals([insight]);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('momentum');
    expect(signals[0].keyword).toBe('best ai tools');
    expect(signals[0].detail).toContain('Gained 7 positions');
    expect(signals[0].insightId).toBe('mover_1');
  });

  it('skips ranking movers with <=3 position gain', () => {
    const smallMove = makeInsight({
      insightType: 'ranking_mover',
      data: { query: 'small move', previousPosition: 10, currentPosition: 8 },
    });
    const noMove = makeInsight({
      insightType: 'ranking_mover',
      data: { query: 'no move', previousPosition: 5, currentPosition: 5 },
    });
    const dropped = makeInsight({
      insightType: 'ranking_mover',
      data: { query: 'dropped', previousPosition: 5, currentPosition: 12 },
    });

    const signals = buildStrategySignals([smallMove, noMove, dropped]);
    expect(signals.length).toBe(0);
  });

  it('generates misalignment signal when strategyAlignment is misaligned', () => {
    const insight = makeInsight({
      id: 'misaligned_1',
      insightType: 'page_health',
      strategyAlignment: 'misaligned',
      strategyKeyword: 'seo agency',
      impactScore: 60,
    });

    const signals = buildStrategySignals([insight]);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('misalignment');
    expect(signals[0].keyword).toBe('seo agency');
    expect(signals[0].detail).toContain('seo agency');
  });

  it('does not generate misalignment for aligned or untracked insights', () => {
    const aligned = makeInsight({ strategyAlignment: 'aligned' });
    const untracked = makeInsight({ strategyAlignment: 'untracked' });
    const none = makeInsight({ strategyAlignment: null });

    const signals = buildStrategySignals([aligned, untracked, none]);
    expect(signals.length).toBe(0);
  });

  it('generates content_gap signal from competitor_gap insights', () => {
    const insight = makeInsight({
      id: 'gap_1',
      insightType: 'competitor_gap',
      data: { keyword: 'react seo', competitorDomain: 'rival.com', competitorPosition: 3, ourPosition: null, volume: 1200, difficulty: 40 },
      impactScore: 80,
    });

    const signals = buildStrategySignals([insight]);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('content_gap');
    expect(signals[0].keyword).toBe('react seo');
    expect(signals[0].detail).toContain('react seo');
  });

  it('sorts signals by impactScore descending', () => {
    const low = makeInsight({
      id: 'gap_low',
      insightType: 'competitor_gap',
      data: { keyword: 'low' },
      impactScore: 20,
    });
    const high = makeInsight({
      id: 'gap_high',
      insightType: 'competitor_gap',
      data: { keyword: 'high' },
      impactScore: 90,
    });
    const mid = makeInsight({
      id: 'gap_mid',
      insightType: 'competitor_gap',
      data: { keyword: 'mid' },
      impactScore: 55,
    });

    const signals = buildStrategySignals([low, high, mid]);
    expect(signals.length).toBe(3);
    expect(signals[0].impactScore).toBe(90);
    expect(signals[1].impactScore).toBe(55);
    expect(signals[2].impactScore).toBe(20);
  });

  it('returns empty array for empty input', () => {
    expect(buildStrategySignals([]).length).toBe(0);
  });
});

// ── Pipeline signals ──────────────────────────────────────────────

describe('buildPipelineSignals', () => {
  it('generates suggested_brief for high-impact ranking opportunities without pipeline status', () => {
    const insight = makeInsight({
      id: 'opp_1',
      insightType: 'ranking_opportunity',
      data: { query: 'best seo tools', currentPosition: 12, impressions: 800 },
      impactScore: 70,
      pipelineStatus: null,
    });

    const signals = buildPipelineSignals([insight]);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('suggested_brief');
    expect(signals[0].keyword).toBe('best seo tools');
    expect(signals[0].detail).toContain('Position 12');
    expect(signals[0].detail).toContain('800 impressions');
  });

  it('skips ranking opportunities that already have pipeline status', () => {
    const withBrief = makeInsight({
      insightType: 'ranking_opportunity',
      data: { query: 'already tracked', currentPosition: 11, impressions: 500 },
      impactScore: 80,
      pipelineStatus: 'brief_exists',
    });
    const inProgress = makeInsight({
      insightType: 'ranking_opportunity',
      data: { query: 'in progress', currentPosition: 9, impressions: 600 },
      impactScore: 75,
      pipelineStatus: 'in_progress',
    });

    const signals = buildPipelineSignals([withBrief, inProgress]);
    expect(signals.length).toBe(0);
  });

  it('skips ranking opportunities with impactScore <= 50', () => {
    const lowImpact = makeInsight({
      insightType: 'ranking_opportunity',
      data: { query: 'low impact', currentPosition: 15, impressions: 100 },
      impactScore: 30,
      pipelineStatus: null,
    });
    const borderline = makeInsight({
      insightType: 'ranking_opportunity',
      data: { query: 'borderline', currentPosition: 14, impressions: 200 },
      impactScore: 50,
      pipelineStatus: null,
    });

    const signals = buildPipelineSignals([lowImpact, borderline]);
    expect(signals.length).toBe(0);
  });

  it('generates refresh_suggestion for critical content decay', () => {
    const insight = makeInsight({
      id: 'decay_1',
      insightType: 'content_decay',
      severity: 'critical',
      data: { deltaPercent: -45, baselineClicks: 200, currentClicks: 110 },
      impactScore: 85,
    });

    const signals = buildPipelineSignals([insight]);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('refresh_suggestion');
    expect(signals[0].detail).toContain('-45');
    expect(signals[0].detail).toContain('content refresh recommended');
  });

  it('generates refresh_suggestion for warning content decay', () => {
    const insight = makeInsight({
      id: 'decay_2',
      insightType: 'content_decay',
      severity: 'warning',
      data: { deltaPercent: -25 },
      impactScore: 55,
    });

    const signals = buildPipelineSignals([insight]);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('refresh_suggestion');
  });

  it('skips content decay with opportunity or positive severity', () => {
    const opportunity = makeInsight({
      insightType: 'content_decay',
      severity: 'opportunity',
      data: { deltaPercent: -10 },
      impactScore: 60,
    });
    const positive = makeInsight({
      insightType: 'content_decay',
      severity: 'positive',
      data: { deltaPercent: 5 },
      impactScore: 40,
    });

    const signals = buildPipelineSignals([opportunity, positive]);
    expect(signals.length).toBe(0);
  });

  it('sorts signals by impactScore descending', () => {
    const decay = makeInsight({
      id: 'decay_sort',
      insightType: 'content_decay',
      severity: 'critical',
      data: { deltaPercent: -50 },
      impactScore: 90,
    });
    const opp = makeInsight({
      id: 'opp_sort',
      insightType: 'ranking_opportunity',
      data: { query: 'sort test', currentPosition: 11, impressions: 400 },
      impactScore: 60,
      pipelineStatus: null,
    });

    const signals = buildPipelineSignals([opp, decay]);
    expect(signals.length).toBe(2);
    expect(signals[0].impactScore).toBe(90);
    expect(signals[1].impactScore).toBe(60);
  });

  it('returns empty array for empty input', () => {
    expect(buildPipelineSignals([]).length).toBe(0);
  });
});
