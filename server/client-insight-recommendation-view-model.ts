import type {
  ClientFacingClientStatus,
  ClientRecResponseSummary,
  Recommendation,
  RecommendationSet,
} from '../shared/types/recommendations.js';
import { isFeatureEnabled } from './feature-flags.js';
import { stripEmvFromPublicRecs, toPublicRecommendationSet } from './recommendation-public-projection.js';
import { computeRecommendationSummary, loadRecommendations } from './recommendations.js';
import { applyWordingOverrides, getSortOrderMap } from './rec-operator-overrides.js';
import { computeEffectiveTier, getWorkspace } from './workspaces.js';
import type { EffectiveTier } from './workspaces.js';

export interface ClientRecommendationSetFilters {
  status?: string;
  priority?: string;
  clientStatus?: string;
}

export function buildClientRecommendationSetView(
  workspaceId: string,
  filters: ClientRecommendationSetFilters = {},
): RecommendationSet | null {
  let set = loadRecommendations(workspaceId);
  if (!set) {
    if (!getWorkspace(workspaceId)) return null;
    set = {
      workspaceId,
      generatedAt: new Date().toISOString(),
      recommendations: [],
      summary: computeRecommendationSummary([]),
    };
  }

  const exposeClientStatus = isFeatureEnabled('strategy-the-issue', workspaceId);
  let effectiveTier: EffectiveTier = 'free';
  let recs = filterClientRecommendationSet(set.recommendations, filters, exposeClientStatus);

  if (exposeClientStatus) {
    const ws = getWorkspace(workspaceId);
    if (ws) effectiveTier = computeEffectiveTier(ws);
    recs = applyClientRecommendationCopyAndOrder(workspaceId, recs);
  }

  return toPublicRecommendationSet(set, recs, exposeClientStatus, effectiveTier);
}

export function buildClientRecommendationView(
  workspaceId: string,
  rec: Recommendation,
): Recommendation {
  const exposeClientStatus = isFeatureEnabled('strategy-the-issue', workspaceId);
  const effectiveTier: EffectiveTier = exposeClientStatus
    ? (() => {
        const ws = getWorkspace(workspaceId);
        return ws ? computeEffectiveTier(ws) : 'free';
      })()
    : 'free';
  return stripEmvFromPublicRecs([rec], exposeClientStatus, effectiveTier)[0];
}

export function buildClientRecommendationResponsesView(
  recs: Recommendation[],
): ClientRecResponseSummary {
  const responded = recs.filter(
    (r) =>
      r.clientStatus === 'approved' ||
      r.clientStatus === 'declined' ||
      r.clientStatus === 'discussing',
  );
  const recent = [...responded]
    .sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt))
    .slice(0, 5)
    .map((r) => ({
      title: r.title,
      clientStatus: (r.clientStatus ?? 'sent') as ClientFacingClientStatus,
      respondedAt: r.updatedAt ?? r.createdAt,
    }));

  return {
    approved: responded.filter((r) => r.clientStatus === 'approved').length,
    declined: responded.filter((r) => r.clientStatus === 'declined').length,
    discussing: responded.filter((r) => r.clientStatus === 'discussing').length,
    recent,
  };
}

function filterClientRecommendationSet(
  recs: Recommendation[],
  filters: ClientRecommendationSetFilters,
  exposeClientStatus: boolean,
): Recommendation[] {
  let filtered = recs;
  if (filters.status) filtered = filtered.filter(r => r.status === filters.status);
  if (filters.priority) filtered = filtered.filter(r => r.priority === filters.priority);
  if (exposeClientStatus && filters.clientStatus) {
    filtered = filtered.filter(r => r.clientStatus === filters.clientStatus);
  }
  return filtered;
}

function applyClientRecommendationCopyAndOrder(
  workspaceId: string,
  recs: Recommendation[],
): Recommendation[] {
  let projected = applyWordingOverrides(workspaceId, recs);
  const sortOrderMap = getSortOrderMap(workspaceId);
  if (sortOrderMap.size === 0) return projected;

  projected = projected
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const aOrder = sortOrderMap.get(a.r.id);
      const bOrder = sortOrderMap.get(b.r.id);
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder || a.i - b.i;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      return a.i - b.i;
    })
    .map(({ r }) => r);
  return projected;
}
