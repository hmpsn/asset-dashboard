import crypto from 'crypto';

import type { Recommendation } from '../../../shared/types/recommendations.js';
import { computeOpportunityValue } from '../../scoring/opportunity-value.js';
import { maxBoostForPages } from '../../scoring/opportunity-timing.js';
import {
  RecSource,
  auditInsight,
  checkToRecType,
  deriveCanonicalRecommendationFields,
  getRecoveryRate,
  getTrafficForSlug,
  getTrafficScore,
  isCriticalCheck,
  mapToProduct,
} from './rules.js';
import type { AuditRecommendationProducerContext } from './producer-contexts.js';

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
