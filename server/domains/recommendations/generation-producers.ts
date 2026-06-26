import crypto from 'crypto';

import { getInsights } from '../../analytics-insights-store.js';
import { assessAuthorityFromBacklinks, kdClassificationNote } from '../../authority-context.js';
import { listCannibalizationIssues } from '../../cannibalization-issues.js';
import { listContentGaps } from '../../content-gaps.js';
import { loadDecayAnalysis } from '../../content-decay.js';
import { listDiagnosticReports } from '../../diagnostic-store.js';
import { listKeywordGaps } from '../../keyword-gaps.js';
import { createLogger } from '../../logger.js';
import { listPageKeywords } from '../../page-keywords.js';
import { listQuickWins } from '../../quick-wins.js';
import type { AuditSnapshot } from '../../reports.js';
import { deriveValueIntent } from '../../scoring/keyword-value-score.js';
import { computeOpportunityValue, type ComputeOptions } from '../../scoring/opportunity-value.js';
import { maxBoostForPages } from '../../scoring/opportunity-timing.js';
import { buildRecommendationStory } from '../../signal-story-registry.js';
import { listTopicClusters } from '../../topic-clusters.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import type {
  Recommendation,
  RecPriority,
  RecType,
} from '../../../shared/types/recommendations.js';
import type {
  AnalyticsInsight,
  CannibalizationData,
  CtrOpportunityData,
} from '../../../shared/types/analytics.js';
import {
  RecSource,
  auditInsight,
  cannibalizationUrlSetKey,
  checkToRecType,
  deriveCanonicalRecommendationFields,
  getRecoveryRate,
  getTrafficForSlug,
  getTrafficScore,
  inferPageType,
  isCriticalCheck,
  isIntentMismatch,
  mapToProduct,
  strategyInsight,
  toPageSlug,
  type RecSourceCategory,
  type TrafficMap,
} from './rules.js';

const log = createLogger('recommendations');

export type RecommendationAssignedTo = 'team' | 'client';

export interface RecommendationProducerScoringContext {
  workspaceId: string;
  now: string;
  assignedTo: RecommendationAssignedTo;
  effortDaysFor: (type: RecType, source: string) => number | null;
  authorityStrength: number | null;
  timingBoosts: Map<string, number>;
  opportunityOptions: ComputeOptions;
}

export interface AuditRecommendationProducerContext extends RecommendationProducerScoringContext {
  audit: AuditSnapshot;
  traffic: TrafficMap;
  conversionMap: Map<string, number>;
}

export interface FailureAwareRecommendationProducerContext extends RecommendationProducerScoringContext {
  failedCategories: Set<RecSourceCategory>;
}

export interface CtrOpportunityProducerContext extends FailureAwareRecommendationProducerContext {
  ctrCurve: Record<number, number> | null;
}

type BacklinkProfileForAuthority = Parameters<typeof assessAuthorityFromBacklinks>[1];

export interface StrategyRecommendationProducerContext extends CtrOpportunityProducerContext {
  traffic: TrafficMap;
  declinedKeywords: Set<string>;
  inFlightContentKeywords: Set<string>;
  domainStrength: number;
  backlinkProfile: BacklinkProfileForAuthority;
}

export function appendAuditRecommendations(
  recs: Recommendation[],
  ctx: AuditRecommendationProducerContext,
): void {
  const { audit, assignedTo, conversionMap, now, traffic, workspaceId } = ctx;

  const issueGroups: Map<string, {
    check: string;
    severity: 'error' | 'warning' | 'info';
    category?: string;
    pages: { slug: string; pageTitle: string; message: string; recommendation: string }[];
    totalTrafficScore: number;
    totalClicks: number;
    totalImpressions: number;
  }> = new Map();

  for (const page of audit.audit.pages) {
    for (const issue of page.issues) {
      const key = issue.check;
      if (!issueGroups.has(key)) {
        issueGroups.set(key, {
          check: issue.check,
          severity: issue.severity,
          category: issue.category,
          pages: [] as { slug: string; pageTitle: string; message: string; recommendation: string }[],
          totalTrafficScore: 0,
          totalClicks: 0,
          totalImpressions: 0,
        });
      }
      const group = issueGroups.get(key)!;
      const ts = getTrafficScore(traffic, page.slug, conversionMap.get(page.slug));
      const t = getTrafficForSlug(traffic, page.slug);
      group.pages.push({ slug: page.slug, pageTitle: page.slug, message: issue.message, recommendation: issue.recommendation });
      group.totalTrafficScore += ts;
      group.totalClicks += t.clicks;
      group.totalImpressions += t.impressions;
    }
  }

  for (const [, group] of issueGroups) {
    const isCrit = isCriticalCheck(group.check);
    const recType = checkToRecType(group.check, group.category);
    const product = mapToProduct(recType, group.pages.length);

    const sortedPages = group.pages
      .map(p => ({ ...p, ts: getTrafficScore(traffic, p.slug, conversionMap.get(p.slug)) }))
      .sort((a, b) => b.ts - a.ts);

    const impact: 'high' | 'medium' | 'low' =
      group.severity === 'error' ? 'high' : group.severity === 'warning' ? 'medium' : 'low';
    const effort: 'low' | 'medium' | 'high' =
      recType === 'metadata' || recType === 'accessibility' ? 'low'
      : recType === 'schema' ? 'medium'
      : 'medium';

    const rate = getRecoveryRate(group.check);
    const estimatedGain =
      group.totalClicks > 0
        ? `Fixing this could increase organic clicks by ${rate.perRec} on ${group.pages.length} affected page${group.pages.length !== 1 ? 's' : ''}`
        : `Improves SEO health score and search engine compatibility across ${group.pages.length} page${group.pages.length !== 1 ? 's' : ''}`;

    const source = RecSource.audit(group.check);
    const opportunity = computeOpportunityValue({
      branch: 'technical',
      effortDays: ctx.effortDaysFor(recType, source),
      severity: group.severity,
      isCritical: isCrit,
      currentClicks: group.totalClicks,
      authorityStrength: ctx.authorityStrength,
      timingBoost: maxBoostForPages(ctx.timingBoosts, sortedPages.map(p => p.slug)),
    }, ctx.opportunityOptions);
    const scoring = deriveCanonicalRecommendationFields(source, opportunity);
    recs.push({
      id: `rec_${crypto.randomBytes(6).toString('hex')}`,
      workspaceId,
      priority: scoring.priority,
      type: recType,
      title: `${group.check.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — ${group.pages.length} page${group.pages.length !== 1 ? 's' : ''}`,
      description: sortedPages[0].recommendation,
      insight: auditInsight(group.check, group.severity, group.pages.length, group.totalClicks, sortedPages.map(p => p.slug)),
      impact,
      effort,
      impactScore: scoring.impactScore,
      opportunity,
      source,
      affectedPages: sortedPages.map(p => p.slug),
      trafficAtRisk: group.totalClicks,
      impressionsAtRisk: group.totalImpressions,
      estimatedGain,
      actionType: product.productType ? 'purchase' : 'manual',
      productType: product.productType,
      productPrice: product.productPrice,
      status: 'pending',
      assignedTo,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const issue of audit.audit.siteWideIssues) {
    const isCrit = isCriticalCheck(issue.check);

    const pages = issue.affectedPages || [];
    const pageTraffic = pages.reduce((sum, slug) => {
      const t = getTrafficForSlug(traffic, slug.replace(/^\//, ''));
      return sum + t.clicks;
    }, 0);
    const pageImpressions = pages.reduce((sum, slug) => {
      const t = getTrafficForSlug(traffic, slug.replace(/^\//, ''));
      return sum + t.impressions;
    }, 0);

    const estimatedGain = pages.length > 0
      ? `Affects ${pages.length} page${pages.length !== 1 ? 's' : ''} on the site`
      : 'Affects the entire site';

    const source = RecSource.auditSiteWide(issue.check);
    const opportunity = computeOpportunityValue({
      branch: 'technical',
      effortDays: ctx.effortDaysFor('technical', source),
      severity: isCrit ? 'error' : 'warning',
      isCritical: isCrit,
      currentClicks: pageTraffic,
      authorityStrength: ctx.authorityStrength,
      timingBoost: maxBoostForPages(ctx.timingBoosts, pages.map(p => p.replace(/^\//, ''))),
    }, ctx.opportunityOptions);
    const scoring = deriveCanonicalRecommendationFields(source, opportunity);
    recs.push({
      id: `rec_${crypto.randomBytes(6).toString('hex')}`,
      workspaceId,
      priority: scoring.priority,
      type: 'technical',
      title: `Site-Wide: ${issue.check.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
      description: issue.recommendation,
      insight: issue.message,
      impact: isCrit ? 'high' : 'medium',
      effort: 'low',
      impactScore: scoring.impactScore,
      opportunity,
      source,
      affectedPages: pages.map(p => p.replace(/^\//, '')),
      trafficAtRisk: pageTraffic,
      impressionsAtRisk: pageImpressions,
      estimatedGain,
      actionType: 'manual',
      status: 'pending',
      assignedTo,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export function appendStrategyRecommendations(
  recs: Recommendation[],
  ctx: StrategyRecommendationProducerContext,
): void {
  const {
    assignedTo,
    backlinkProfile,
    declinedKeywords,
    domainStrength,
    failedCategories,
    inFlightContentKeywords,
    now,
    traffic,
    workspaceId,
  } = ctx;

  const quickWins = listQuickWins(workspaceId);
  if (quickWins.length > 0) {
    for (const qw of quickWins) {
      if (qw.currentKeyword && declinedKeywords.has(keywordComparisonKey(qw.currentKeyword))) continue;

      const t = getTrafficForSlug(traffic, qw.pagePath.replace(/^\//, ''));
      const hasTraffic = t.clicks > 0 || t.impressions > 0;
      const priority: RecPriority = !hasTraffic
        ? 'fix_later'
        : qw.estimatedImpact === 'high' ? 'fix_now' : 'fix_soon';
      const source = RecSource.strategyQuickWin();
      const opportunity = computeOpportunityValue({
        branch: 'quick_win',
        effortDays: ctx.effortDaysFor('strategy', source),
        roiScore: qw.roiScore ?? null,
        llmLabel: qw.estimatedImpact,
        authorityStrength: ctx.authorityStrength,
        timingBoost: maxBoostForPages(ctx.timingBoosts, [qw.pagePath.replace(/^\//, '')]),
      }, ctx.opportunityOptions);
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: hasTraffic ? scoring.priority : priority,
        type: 'strategy',
        title: `Quick Win: ${qw.action}`,
        description: qw.rationale,
        insight: strategyInsight('quick_win', qw),
        impact: qw.estimatedImpact as 'high' | 'medium' | 'low',
        effort: 'low',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [qw.pagePath.replace(/^\//, '')],
        trafficAtRisk: t.clicks,
        impressionsAtRisk: t.impressions,
        estimatedGain: `${qw.estimatedImpact} impact potential based on current traffic and keyword position`,
        actionType: 'manual',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const strategyContentGaps = listContentGaps(workspaceId);
  if (strategyContentGaps.length > 0) {
    for (const cg of strategyContentGaps) {
      if (cg.targetKeyword && declinedKeywords.has(keywordComparisonKey(cg.targetKeyword))) continue;

      if (cg.targetKeyword && inFlightContentKeywords.has(keywordComparisonKey(cg.targetKeyword))) continue;

      const kdNote = cg.difficulty != null ? kdClassificationNote(cg.difficulty, domainStrength) : '';
      const authorityAssessment = assessAuthorityFromBacklinks(cg.difficulty ?? null, backlinkProfile);
      const story = buildRecommendationStory('content_gap', {
        topic: cg.topic,
        targetKeyword: cg.targetKeyword,
        rationale: cg.rationale,
        suggestedPageType: cg.suggestedPageType,
        intent: cg.intent,
        kdNote,
        authorityContext: authorityAssessment.note,
      });
      const source = RecSource.strategyContentGap();
      const opportunity = computeOpportunityValue({
        branch: 'content_gap',
        effortDays: ctx.effortDaysFor('content', source),
        opportunityScore: cg.opportunityScore ?? null,
        volume: cg.volume ?? null,
        difficulty: cg.difficulty ?? null,
        trendDirection: cg.trendDirection ?? null,
        llmLabel: cg.priority,
        intent: deriveValueIntent(cg.targetKeyword, cg.intent),
        authorityStrength: ctx.authorityStrength,
        ctrCurve: ctx.ctrCurve,
        timingBoost: maxBoostForPages(ctx.timingBoosts, []),
      }, ctx.opportunityOptions);
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      const product = mapToProduct('content', 1, cg.suggestedPageType);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: 'content',
        title: story.title,
        description: story.description,
        insight: story.insight,
        impact: cg.priority as 'high' | 'medium' | 'low',
        effort: 'high',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [],
        trafficAtRisk: 0,
        impressionsAtRisk: 0,
        estimatedGain: story.estimatedGain,
        actionType: 'content_creation',
        ...product,
        targetKeyword: cg.targetKeyword,
        status: 'pending',
        assignedTo,
        ...(cg.backfilled ? { backfilled: true as const } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const pageKeywords = listPageKeywords(workspaceId);
  if (pageKeywords.length > 0) {
    for (const pm of pageKeywords) {
      if (pm.primaryKeyword && declinedKeywords.has(keywordComparisonKey(pm.primaryKeyword))) continue;

      if (pm.currentPosition && pm.currentPosition > 3 && pm.currentPosition <= 20 && pm.impressions && pm.impressions > 100) {
        const authorityAssessment = assessAuthorityFromBacklinks(pm.difficulty ?? null, backlinkProfile);
        const story = buildRecommendationStory('ranking_opportunity', {
          keyword: pm.primaryKeyword,
          pagePath: pm.pagePath,
          currentPosition: pm.currentPosition,
          impressions: pm.impressions,
          authorityContext: authorityAssessment.note,
        });
        const source = RecSource.strategyRankingOpp();
        const opportunity = computeOpportunityValue({
          branch: 'ranking_opp',
          effortDays: ctx.effortDaysFor('strategy', source),
          volume: pm.volume ?? null,
          currentPosition: pm.currentPosition ?? null,
          difficulty: pm.difficulty ?? null,
          impressions: pm.impressions ?? null,
          cpc: pm.cpc ?? null,
          intent: deriveValueIntent(pm.primaryKeyword, pm.searchIntent),
          authorityStrength: ctx.authorityStrength,
          ctrCurve: ctx.ctrCurve,
          timingBoost: maxBoostForPages(ctx.timingBoosts, [pm.pagePath.replace(/^\//, '')]),
        }, ctx.opportunityOptions);
        const scoring = deriveCanonicalRecommendationFields(source, opportunity);
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: scoring.priority,
          type: 'strategy',
          title: story.title,
          description: story.description,
          insight: story.insight,
          impact: pm.currentPosition <= 10 ? 'high' : 'medium',
          effort: 'medium',
          impactScore: scoring.impactScore,
          opportunity,
          source,
          affectedPages: [pm.pagePath.replace(/^\//, '')],
          trafficAtRisk: pm.clicks || 0,
          impressionsAtRisk: pm.impressions || 0,
          estimatedGain: story.estimatedGain,
          actionType: 'manual',
          status: 'pending',
          assignedTo,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  let intentMismatchCount = 0;
  for (const pk of pageKeywords) {
    if (intentMismatchCount >= 10) break;
    if (!pk.searchIntent) continue;
    const pageType = inferPageType(pk.pagePath);
    const { mismatch, reason } = isIntentMismatch(pageType, pk.searchIntent);
    if (!mismatch) continue;
    intentMismatchCount++;
    const pageSlug = toPageSlug(pk.pagePath);
    const source = RecSource.strategyIntentMismatch(pageSlug);
    const opportunity = computeOpportunityValue({
      branch: 'ranking_opp',
      effortDays: ctx.effortDaysFor('strategy', source),
      volume: pk.volume ?? null,
      currentPosition: pk.currentPosition ?? null,
      difficulty: pk.difficulty ?? null,
      impressions: pk.impressions ?? null,
      cpc: pk.cpc ?? null,
      intent: deriveValueIntent(pk.primaryKeyword, pk.searchIntent),
      authorityStrength: ctx.authorityStrength,
      ctrCurve: ctx.ctrCurve,
      timingBoost: maxBoostForPages(ctx.timingBoosts, [pageSlug]),
    }, ctx.opportunityOptions);
    const scoring = deriveCanonicalRecommendationFields(source, opportunity);
    recs.push({
      id: `rec_${crypto.randomBytes(6).toString('hex')}`,
      workspaceId,
      priority: scoring.priority,
      type: 'strategy',
      title: `Intent Mismatch: /${pageSlug} (${pageType} page targeting ${pk.searchIntent} keyword)`,
      description: reason,
      insight: `Pages rank better when page type matches search intent. ${reason}`,
      impact: 'medium',
      effort: 'medium',
      impactScore: scoring.impactScore,
      opportunity,
      source,
      affectedPages: [pageSlug],
      trafficAtRisk: 0,
      impressionsAtRisk: 0,
      estimatedGain: 'Aligning page type with intent typically improves CTR and conversion rate',
      actionType: 'manual',
      status: 'pending',
      assignedTo,
      createdAt: now,
      updatedAt: now,
    });
  }

  try {
    const keywordGaps = listKeywordGaps(workspaceId).slice(0, 10);
    for (const kg of keywordGaps) {
      if (declinedKeywords.has(keywordComparisonKey(kg.keyword))) continue;
      const source = RecSource.keywordGap(kg.keyword);
      const opportunity = computeOpportunityValue({
        branch: 'ranking_opp',
        effortDays: ctx.effortDaysFor('keyword_gap', source),
        volume: kg.volume,
        difficulty: kg.difficulty,
        currentPosition: kg.competitorPosition,
        authorityStrength: ctx.authorityStrength,
        ctrCurve: ctx.ctrCurve,
        timingBoost: maxBoostForPages(ctx.timingBoosts, []),
      }, ctx.opportunityOptions);
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: 'keyword_gap',
        title: `Keyword Gap: "${kg.keyword}"`,
        description: `${kg.competitorDomain} ranks #${kg.competitorPosition} for "${kg.keyword}" (volume ${kg.volume.toLocaleString()}, difficulty ${kg.difficulty}) — you don't. Targeting this term captures demand a competitor already owns.`,
        insight: `Competitors ranking for high-demand keywords you ignore is lost organic traffic. Building content or optimizing a page for "${kg.keyword}" lets you compete for a term with proven search demand.`,
        impact: kg.volume > 1000 ? 'high' : kg.volume > 200 ? 'medium' : 'low',
        effort: 'high',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [],
        targetKeyword: kg.keyword,
        trafficAtRisk: 0,
        impressionsAtRisk: 0,
        estimatedGain: `Capturing "${kg.keyword}" targets a term with ${kg.volume.toLocaleString()} monthly searches a competitor already ranks for`,
        actionType: 'content_creation',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (err) {
    failedCategories.add('keyword_gap');
    log.warn({ err, workspaceId }, 'Keyword gaps unavailable for recommendations');
  }

  try {
    const clusters = listTopicClusters(workspaceId);
    const cluster = clusters[0];
    if (cluster) {
      const opportunityScore = Math.max(0, Math.min(100, 100 - cluster.coveragePercent));
      const source = RecSource.topicCluster(cluster.topic);
      const opportunity = computeOpportunityValue({
        branch: 'content_gap',
        effortDays: ctx.effortDaysFor('topic_cluster', source),
        opportunityScore,
        authorityStrength: ctx.authorityStrength,
        ctrCurve: ctx.ctrCurve,
        timingBoost: maxBoostForPages(ctx.timingBoosts, []),
      }, ctx.opportunityOptions);
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      const gapPreview = cluster.gap.slice(0, 5).join(', ');
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: 'topic_cluster',
        title: `Build Topical Authority: "${cluster.topic}"`,
        description: `You cover ${Math.round(cluster.coveragePercent)}% of the "${cluster.topic}" cluster (${cluster.ownedCount}/${cluster.totalCount} keywords). Filling the gaps${gapPreview ? ` (${gapPreview})` : ''} builds the topical depth search engines reward.`,
        insight: `Topical authority compounds — covering a cluster comprehensively signals expertise and lifts every page in it. "${cluster.topic}" is your weakest cluster, so it has the most room to grow.`,
        impact: opportunityScore > 60 ? 'high' : opportunityScore > 30 ? 'medium' : 'low',
        effort: 'high',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [],
        trafficAtRisk: 0,
        impressionsAtRisk: 0,
        estimatedGain: `Filling the "${cluster.topic}" cluster (currently ${Math.round(cluster.coveragePercent)}% covered) builds topical authority across related pages`,
        actionType: 'content_creation',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (err) {
    failedCategories.add('topic_cluster');
    log.warn({ err, workspaceId }, 'Topic clusters unavailable for recommendations');
  }

  try {
    const issues = listCannibalizationIssues(workspaceId);
    const insightUrlSets = new Set<string>();
    try {
      for (const ins of getInsights(workspaceId, 'cannibalization')) {
        if (ins.resolutionStatus === 'resolved') continue;
        const data = ins.data as CannibalizationData;
        const pages = Array.isArray(data?.pages) ? data.pages : [];
        if (pages.length > 0) insightUrlSets.add(cannibalizationUrlSetKey(pages));
      }
    } catch (err) {
      log.debug({ err, workspaceId }, 'Cannibalization insight dedupe unavailable — minting recs without cross-link');
    }
    for (const item of issues) {
      const urlSetKey = cannibalizationUrlSetKey(item.pages.map(p => p.path));
      if (insightUrlSets.has(urlSetKey)) {
        failedCategories.add('cannibalization');
        continue;
      }
      const severity: 'error' | 'warning' | 'info' =
        item.severity === 'high' ? 'error' : item.severity === 'medium' ? 'warning' : 'info';
      const currentClicks = item.pages.reduce((sum, p) => sum + (p.clicks ?? 0), 0);
      const source = RecSource.cannibalization(urlSetKey);
      const opportunity = computeOpportunityValue({
        branch: 'technical',
        effortDays: ctx.effortDaysFor('cannibalization', source),
        severity,
        currentClicks,
        authorityStrength: ctx.authorityStrength,
        ctrCurve: ctx.ctrCurve,
        timingBoost: maxBoostForPages(ctx.timingBoosts, item.pages.map(p => toPageSlug(p.path))),
      }, ctx.opportunityOptions);
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: 'cannibalization',
        title: `Keyword Cannibalization: "${item.keyword}"`,
        description: `${item.pages.length} pages compete for "${item.keyword}", splitting ranking signals. ${item.recommendation}`,
        insight: `When multiple pages target the same keyword, search engines struggle to pick a winner — diluting authority and capping rankings. Consolidating to one canonical page recovers the combined strength.`,
        impact: item.severity === 'high' ? 'high' : item.severity === 'medium' ? 'medium' : 'low',
        effort: 'medium',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: item.pages.map(p => p.path),
        trafficAtRisk: currentClicks,
        impressionsAtRisk: item.pages.reduce((sum, p) => sum + (p.impressions ?? 0), 0),
        estimatedGain: `Consolidating ${item.pages.length} competing pages for "${item.keyword}" recovers split ranking signals`,
        actionType: 'manual',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (err) {
    failedCategories.add('cannibalization');
    log.warn({ err, workspaceId }, 'Cannibalization issues unavailable for recommendations');
  }
}

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
