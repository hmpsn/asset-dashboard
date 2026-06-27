import crypto from 'crypto';

import { getInsights } from '../../analytics-insights-store.js';
import { loadDecayAnalysis } from '../../content-decay.js';
import { listDiagnosticReports } from '../../diagnostic-store.js';
import { createLogger } from '../../logger.js';
import { computeOpportunityValue } from '../../scoring/opportunity-value.js';
import { maxBoostForPages } from '../../scoring/opportunity-timing.js';
import { buildRecommendationStory } from '../../signal-story-registry.js';
import type { Recommendation, RecType } from '../../../shared/types/recommendations.js';
import type { AnalyticsInsight, CtrOpportunityData } from '../../../shared/types/analytics.js';
import {
  RecSource,
  deriveCanonicalRecommendationFields,
  mapToProduct,
  toPageSlug,
} from './rules.js';
import type { CtrOpportunityProducerContext, FailureAwareRecommendationProducerContext } from './producer-contexts.js';

const log = createLogger('recommendations');

export function appendContentDecayRecommendations(
  recs: Recommendation[],
  ctx: FailureAwareRecommendationProducerContext,
): void {
  try {
    const decayAnalysis = loadDecayAnalysis(ctx.workspaceId);
    if (decayAnalysis && decayAnalysis.decayingPages.length > 0) {
      const actionableDecay = decayAnalysis.decayingPages.filter(p => p.severity === 'critical' || p.severity === 'warning');

      for (const dp of actionableDecay) {
        const pageSlug = toPageSlug(dp.page);

        const product = mapToProduct('content_refresh', 1);
        const story = buildRecommendationStory('content_decay', {
          pagePath: dp.page,
          title: dp.title,
          clickDeclinePct: dp.clickDeclinePct,
          refreshRecommendation: dp.refreshRecommendation,
          severity: dp.severity,
          previousClicks: dp.previousClicks,
          currentClicks: dp.currentClicks,
          previousPosition: dp.previousPosition,
          currentPosition: dp.currentPosition,
        });
        const source = RecSource.decay(pageSlug);
        const opportunity = computeOpportunityValue({
          branch: 'decay',
          effortDays: ctx.effortDaysFor('content_refresh', source),
          previousClicks: dp.previousClicks,
          currentClicks: dp.currentClicks,
          currentPosition: dp.currentPosition,
          isRepeatDecay: dp.isRepeatDecay ?? null,
          authorityStrength: ctx.authorityStrength,
          timingBoost: maxBoostForPages(ctx.timingBoosts, [pageSlug]),
        }, ctx.opportunityOptions);
        const scoring = deriveCanonicalRecommendationFields(source, opportunity);
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId: ctx.workspaceId,
          priority: scoring.priority,
          type: 'content_refresh',
          title: story.title,
          description: story.description,
          insight: story.insight,
          impact: dp.severity === 'critical' ? 'high' : 'medium',
          effort: 'medium',
          impactScore: scoring.impactScore,
          opportunity,
          source,
          affectedPages: [pageSlug],
          trafficAtRisk: dp.previousClicks,
          impressionsAtRisk: dp.previousImpressions,
          estimatedGain: story.estimatedGain,
          actionType: product.productType ? 'purchase' : 'manual',
          productType: product.productType,
          productPrice: product.productPrice,
          status: 'pending',
          assignedTo: ctx.assignedTo,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        });
      }

      if (actionableDecay.length > 0) {
        log.info(`Added ${actionableDecay.length} content refresh recommendations for ${ctx.workspaceId}`);
      }
    }
  } catch (err) {
    ctx.failedCategories.add('decay');
    log.warn({ err }, 'Content decay data unavailable for recommendations');
  }
}

export function appendCtrOpportunityRecommendations(
  recs: Recommendation[],
  ctx: CtrOpportunityProducerContext,
): void {
  try {
    const ctrInsights = getInsights(ctx.workspaceId, 'ctr_opportunity');
    const topCtr = [...ctrInsights]
      .sort((a, b) => {
        const aGap = (a.data as CtrOpportunityData).estimatedClickGap ?? 0;
        const bGap = (b.data as CtrOpportunityData).estimatedClickGap ?? 0;
        return bGap - aGap;
      })
      .slice(0, 10);

    for (const insight of topCtr) {
      const d = insight.data as CtrOpportunityData;
      const pageSlug = toPageSlug(d.pageUrl ?? insight.pageId ?? '');
      const gap = d.estimatedClickGap ?? 0;
      if (gap <= 0) continue;
      const product = mapToProduct('metadata', 1);
      const story = buildRecommendationStory('ctr_opportunity', {
        pageSlug,
        actualCtr: d.actualCtr,
        expectedCtr: d.expectedCtr,
        impressions: d.impressions ?? 0,
        position: d.position ?? 0,
        gap,
      });
      const source = RecSource.ctrOpportunity(pageSlug);
      const opportunity = computeOpportunityValue({
        branch: 'ranking_opp',
        effortDays: ctx.effortDaysFor('metadata', source),
        expectedClickGap: d.estimatedClickGap ?? null,
        impressions: d.impressions ?? null,
        currentPosition: d.position ?? null,
        authorityStrength: ctx.authorityStrength,
        ctrCurve: ctx.ctrCurve,
        timingBoost: maxBoostForPages(ctx.timingBoosts, [pageSlug]),
      }, ctx.opportunityOptions);
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId: ctx.workspaceId,
        priority: scoring.priority,
        type: 'metadata',
        title: story.title,
        description: story.description,
        insight: story.insight,
        impact: gap > 100 ? 'high' : gap > 30 ? 'medium' : 'low',
        effort: 'low',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [pageSlug],
        trafficAtRisk: gap,
        impressionsAtRisk: d.impressions ?? 0,
        estimatedGain: story.estimatedGain,
        actionType: product.productType ? 'purchase' : 'manual',
        productType: product.productType,
        productPrice: product.productPrice,
        status: 'pending',
        assignedTo: ctx.assignedTo,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    }
  } catch (err) {
    ctx.failedCategories.add('insight:ctr_opportunity');
    log.warn({ err }, 'CTR opportunity insights unavailable for recommendations');
  }
}

export function appendDiagnosticRecommendations(
  recs: Recommendation[],
  ctx: FailureAwareRecommendationProducerContext,
): void {
  try {
    const reports = listDiagnosticReports(ctx.workspaceId);
    const completedReports = reports
      .filter(r => r.status === 'completed' && r.remediationActions?.length > 0)
      .slice(0, 3);

    for (const report of completedReports) {
      for (let actionIdx = 0; actionIdx < Math.min(report.remediationActions.length, 5); actionIdx++) {
        const action = report.remediationActions[actionIdx];
        const recType: RecType = action.owner === 'content' ? 'content' : 'technical';
        const source = RecSource.diagnostic(report.id, actionIdx, action.title);
        const opportunity = computeOpportunityValue({
          branch: 'diagnostic',
          effortDays: ctx.effortDaysFor(recType, source),
          llmLabel: action.impact,
          authorityStrength: ctx.authorityStrength,
          timingBoost: maxBoostForPages(ctx.timingBoosts, action.pageUrls?.map(toPageSlug) ?? []),
        }, ctx.opportunityOptions);
        const scoring = deriveCanonicalRecommendationFields(source, opportunity);
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId: ctx.workspaceId,
          priority: scoring.priority,
          type: recType,
          title: `Diagnostic: ${action.title}`,
          description: action.description,
          insight: `Identified by deep diagnostic investigation (report ${report.id.slice(0, 8)}). ${action.description}`,
          impact: action.impact,
          effort: action.effort,
          impactScore: scoring.impactScore,
          opportunity,
          source,
          affectedPages: action.pageUrls?.map(toPageSlug) ?? [],
          trafficAtRisk: 0,
          impressionsAtRisk: 0,
          estimatedGain: `Diagnostic-identified fix (${action.priority} priority, ${action.effort} effort)`,
          actionType: 'manual',
          status: 'pending',
          assignedTo: ctx.assignedTo,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        });
      }
    }
  } catch (err) {
    ctx.failedCategories.add('diagnostic');
    log.warn({ err }, 'Diagnostic reports unavailable for recommendations');
  }
}

export function appendFreshnessRecommendations(
  recs: Recommendation[],
  ctx: FailureAwareRecommendationProducerContext,
): void {
  try {
    const freshnessInsights = getInsights(ctx.workspaceId, 'freshness_alert') as Array<AnalyticsInsight<'freshness_alert'>>;
    const topFreshness = [...freshnessInsights]
      .sort((a, b) => b.data.daysSinceLastAnalysis - a.data.daysSinceLastAnalysis)
      .slice(0, 10);
    for (const insight of topFreshness) {
      const d = insight.data;
      const trafficAtRisk = d.impressions ?? 0;
      const product = mapToProduct('content_refresh', 1);
      const story = buildRecommendationStory('freshness_alert', {
        pagePath: d.pagePath,
        daysSinceLastAnalysis: d.daysSinceLastAnalysis,
        trafficAtRisk,
      });
      const pageSlug = toPageSlug(d.pagePath);
      const source = RecSource.freshnessAlert(pageSlug);
      const opportunity = computeOpportunityValue({
        branch: 'freshness',
        effortDays: ctx.effortDaysFor('content_refresh', source),
        impressions: trafficAtRisk,
        authorityStrength: ctx.authorityStrength,
        timingBoost: maxBoostForPages(ctx.timingBoosts, [pageSlug]),
      }, ctx.opportunityOptions);
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId: ctx.workspaceId,
        priority: scoring.priority,
        type: 'content_refresh',
        title: story.title,
        description: story.description,
        insight: story.insight,
        impact: d.daysSinceLastAnalysis > 180 ? 'high' : 'medium',
        effort: 'medium',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [pageSlug],
        trafficAtRisk,
        impressionsAtRisk: trafficAtRisk,
        estimatedGain: story.estimatedGain,
        actionType: product.productType ? 'purchase' : 'manual',
        productType: product.productType,
        productPrice: product.productPrice,
        status: 'pending',
        assignedTo: ctx.assignedTo,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    }
    if (topFreshness.length > 0) {
      log.info(`Added ${topFreshness.length} content freshness recommendations for ${ctx.workspaceId}`);
    }
  } catch (err) {
    ctx.failedCategories.add('insight:freshness_alert');
    log.warn({ err }, 'Content freshness insights unavailable for recommendations');
  }
}
