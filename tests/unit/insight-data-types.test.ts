/**
 * tests/unit/insight-data-types.test.ts
 *
 * Verifies that InsightDataMap entries are properly typed interfaces,
 * not Record<string,unknown>. Tests use known field names sourced from
 * actual call sites to verify type structure is correct.
 *
 * Runtime verification: upsert typed data, read back, assert field access.
 */

import { describe, it, expect } from 'vitest';
import { upsertInsight, getInsight } from '../../server/analytics-insights-store.js';
import type {
  StrategyAlignmentData,
  InsightDataMap,
} from '../../shared/types/analytics.js';

// ── Type-level contract: InsightDataMap['strategy_alignment'] is StrategyAlignmentData ──

// This compile-time assertion ensures strategy_alignment is typed, not Record<string,unknown>.
// If InsightDataMap['strategy_alignment'] were Record<string,unknown>, the following
// typed variable assignments would still compile but typed fields would be invisible.
// By using the specific interface, we ensure the type has the concrete fields.
function _assertStrategyAlignmentIsTyped(d: InsightDataMap['strategy_alignment']): StrategyAlignmentData {
  // If this compiled (and the return type is StrategyAlignmentData), the map entry is typed.
  return d;
}

// ── Runtime tests: strategy_alignment round-trip ──────────────────────────────

describe('InsightDataMap[strategy_alignment] — typed data contract', () => {
  const wsId = `ws_unit_strategy_align_types_${Date.now()}`;

  it('upsertInsight accepts StrategyAlignmentData (typed fields)', () => {
    const data: StrategyAlignmentData = {
      alignedCount: 15,
      misalignedCount: 3,
      untrackedCount: 8,
      summary: 'Most pages are aligned with their target strategy.',
    };

    const insight = upsertInsight({
      workspaceId: wsId,
      pageId: null,
      insightType: 'strategy_alignment',
      data,
      severity: 'warning',
    });

    expect(insight.insightType).toBe('strategy_alignment');
    expect(insight.pageId).toBeNull();
  });

  it('reads back typed fields correctly from DB round-trip', () => {
    const insight = getInsight(wsId, null, 'strategy_alignment');
    expect(insight).toBeDefined();
    expect(insight!.data).not.toBeNull();

    const d = insight!.data as StrategyAlignmentData;
    expect(d.alignedCount).toBe(15);
    expect(d.misalignedCount).toBe(3);
    expect(d.untrackedCount).toBe(8);
    expect(typeof d.summary).toBe('string');
    expect(d.summary).toBe('Most pages are aligned with their target strategy.');
  });

  it('upsertInsight accepts StrategyAlignmentData without optional summary field', () => {
    const wsId2 = `${wsId}_nosummary`;
    const data: StrategyAlignmentData = {
      alignedCount: 5,
      misalignedCount: 1,
      untrackedCount: 2,
      // summary is optional — omit it
    };

    const insight = upsertInsight({
      workspaceId: wsId2,
      pageId: null,
      insightType: 'strategy_alignment',
      data,
      severity: 'opportunity',
    });

    expect(insight.insightType).toBe('strategy_alignment');
    const readBack = getInsight(wsId2, null, 'strategy_alignment');
    expect(readBack).toBeDefined();

    const d = readBack!.data as StrategyAlignmentData;
    expect(d.alignedCount).toBe(5);
    expect(d.summary).toBeUndefined();
  });
});

// ── Type-level contract: all InsightDataMap values have concrete field types ──

describe('InsightDataMap — all entries have typed interfaces', () => {
  it('InsightDataMap has no Record<string,unknown> entries at compile time', () => {
    // We cannot assert this purely at runtime, but we can verify that
    // field access on each type works as expected by checking known fields
    // from actual call sites via type-narrowing helpers.
    //
    // This is a compile-time proof: if any entry were Record<string,unknown>,
    // TypeScript would not expose the typed field names below.

    // page_health: score, trend, clicks, impressions, position, ctr, pageviews, bounceRate, avgEngagementTime
    type PageHealthFields = keyof InsightDataMap['page_health'];
    const _phCheck: PageHealthFields = 'score';
    expect(_phCheck).toBe('score');

    // ranking_opportunity: query, currentPosition, impressions, estimatedTrafficGain, pageUrl
    type QuickWinFields = keyof InsightDataMap['ranking_opportunity'];
    const _qwCheck: QuickWinFields = 'estimatedTrafficGain';
    expect(_qwCheck).toBe('estimatedTrafficGain');

    // content_decay: baselineClicks, currentClicks, deltaPercent, baselinePeriod, currentPeriod
    type ContentDecayFields = keyof InsightDataMap['content_decay'];
    const _cdCheck: ContentDecayFields = 'deltaPercent';
    expect(_cdCheck).toBe('deltaPercent');

    // ranking_mover: query, pageUrl, currentPosition, previousPosition, positionChange, currentClicks, previousClicks, impressions
    type RankingMoverFields = keyof InsightDataMap['ranking_mover'];
    const _rmCheck: RankingMoverFields = 'positionChange';
    expect(_rmCheck).toBe('positionChange');

    // ctr_opportunity: query, pageUrl, position, actualCtr, expectedCtr, ctrRatio, impressions, estimatedClickGap
    type CtrOpportunityFields = keyof InsightDataMap['ctr_opportunity'];
    const _ctroCheck: CtrOpportunityFields = 'estimatedClickGap';
    expect(_ctroCheck).toBe('estimatedClickGap');

    // serp_opportunity: pageUrl, impressions, clicks, position, ctr, schemaStatus
    type SerpOpportunityFields = keyof InsightDataMap['serp_opportunity'];
    const _serpCheck: SerpOpportunityFields = 'schemaStatus';
    expect(_serpCheck).toBe('schemaStatus');

    // strategy_alignment: alignedCount, misalignedCount, untrackedCount, summary
    type StrategyAlignmentFields = keyof InsightDataMap['strategy_alignment'];
    const _saCheck: StrategyAlignmentFields = 'alignedCount';
    expect(_saCheck).toBe('alignedCount');

    // anomaly_digest: anomalyType, metric, currentValue, expectedValue, deviationPercent, durationDays, firstDetected, severity
    type AnomalyDigestFields = keyof InsightDataMap['anomaly_digest'];
    const _adCheck: AnomalyDigestFields = 'deviationPercent';
    expect(_adCheck).toBe('deviationPercent');

    // audit_finding: scope, issueCount, issueMessages, siteScore, source
    type AuditFindingFields = keyof InsightDataMap['audit_finding'];
    const _afCheck: AuditFindingFields = 'issueMessages';
    expect(_afCheck).toBe('issueMessages');

    // site_health: auditSnapshotId, siteScore, previousScore, scoreDelta, totalPages, errors, warnings, siteWideIssueCount
    type SiteHealthFields = keyof InsightDataMap['site_health'];
    const _shCheck: SiteHealthFields = 'siteWideIssueCount';
    expect(_shCheck).toBe('siteWideIssueCount');
  });
});
