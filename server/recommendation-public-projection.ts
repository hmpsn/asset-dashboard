/**
 * Client-safe recommendation projection helpers.
 *
 * This module is the allow-list boundary for public recommendation reads.
 */
import type { EffectiveTier } from './workspaces.js';
import { sanitizePublicGain } from './recommendation-gain-sanitizer.js';
import { REC_POLICY_REGISTRY } from './recommendation-lifecycle.js';
import type {
  ClientFacingClientStatus,
  Recommendation,
  RecommendationSet,
} from '../shared/types/recommendations.js';
import { computeImpactBand } from '../shared/types/impact-band.js';

const CLIENT_FACING_STATUSES: readonly ClientFacingClientStatus[] = ['sent', 'approved', 'declined', 'discussing'];

function clientFacingStatus(status: Recommendation['clientStatus']): ClientFacingClientStatus | undefined {
  return status && (CLIENT_FACING_STATUSES as readonly string[]).includes(status)
    ? (status as ClientFacingClientStatus)
    : undefined;
}

type PublicRecommendation = Recommendation & {
  delivered?: boolean;
  actOn?: { mode: 'included' | 'priced' | 'locked'; requiredTier?: 'growth'; monetizable: boolean };
};

function actOnDescriptor(rec: Recommendation, effectiveTier: EffectiveTier): NonNullable<PublicRecommendation['actOn']> {
  const monetizable = REC_POLICY_REGISTRY[rec.type]?.monetizable ?? false;
  if (effectiveTier === 'free' && monetizable) {
    return { mode: 'locked', requiredTier: 'growth', monetizable };
  }
  return { mode: 'included', monetizable };
}

export function stripEmvFromPublicRecs(
  recs: Recommendation[],
  exposeClientStatus = false,
  effectiveTier: EffectiveTier = 'free',
): PublicRecommendation[] {
  return recs.map((r) => {
    const safeGain = typeof r.estimatedGain === 'string' ? sanitizePublicGain(r.estimatedGain) : r.estimatedGain;
    const out: PublicRecommendation = {
      id: r.id,
      workspaceId: r.workspaceId,
      priority: r.priority,
      type: r.type,
      title: r.title,
      description: r.description,
      insight: r.insight,
      impact: r.impact,
      effort: r.effort,
      impactScore: r.impactScore,
      source: r.source,
      affectedPages: r.affectedPages,
      trafficAtRisk: r.trafficAtRisk,
      impressionsAtRisk: r.impressionsAtRisk,
      estimatedGain: safeGain,
      actionType: r.actionType,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
    if (r.productType !== undefined) out.productType = r.productType;
    if (r.productPrice !== undefined) out.productPrice = r.productPrice;
    if (r.targetKeyword !== undefined) out.targetKeyword = r.targetKeyword;
    if (r.assignedTo !== undefined) out.assignedTo = r.assignedTo;
    if (r.backfilled !== undefined) out.backfilled = r.backfilled;
    if (r.opportunity) {
      const { emvPerWeek: rawEmvPerWeek, predictedEmv: _predictedEmv, roiPerEffortDay: _roiPerEffortDay, ...publicOpportunity } = r.opportunity;
      out.opportunity = publicOpportunity as Recommendation['opportunity'];
      const impactBand = computeImpactBand(rawEmvPerWeek);
      if (impactBand) out.impactBand = impactBand;
    }
    if (exposeClientStatus) {
      const cfStatus = clientFacingStatus(r.clientStatus);
      if (cfStatus) {
        out.clientStatus = cfStatus;
        out.delivered = r.status === 'completed';
      }
      out.actOn = actOnDescriptor(r, effectiveTier);
    }
    return out;
  });
}

export function toPublicRecommendationSet(
  set: RecommendationSet,
  recs: Recommendation[],
  exposeClientStatus = false,
  effectiveTier: EffectiveTier = 'free',
): RecommendationSet {
  return { ...set, recommendations: stripEmvFromPublicRecs(recs, exposeClientStatus, effectiveTier) };
}
