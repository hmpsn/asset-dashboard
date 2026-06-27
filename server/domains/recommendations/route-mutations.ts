/**
 * Mutation helpers for recommendation routes.
 *
 * Routes own HTTP validation, broadcasts, activity, and emails. These helpers
 * own only recommendation persistence mutations.
 */
import crypto from 'crypto';
import db from '../../db/index.js';
import {
  sendRecommendation,
  strikeRecommendation,
  throttleRecommendation,
} from '../../recommendation-lifecycle.js';
import { InvalidTransitionError } from '../../state-machines.js';
import type { Recommendation } from '../../../shared/types/recommendations.js';
import { computeRecommendationSummary } from './rules.js';
import { loadRecommendations, saveRecommendations } from './status-service.js';

export type BulkRecommendationAction = 'send' | 'throttle' | 'strike';

export function applyBulkRecommendationAction(params: {
  workspaceId: string;
  recIds: string[];
  action: BulkRecommendationAction;
  throttleDays?: 7 | 30 | 90;
}): Recommendation[] {
  const { workspaceId, recIds, action, throttleDays } = params;
  const mutated: Recommendation[] = [];
  const apply = db.transaction(() => {
    for (const recId of recIds) {
      let rec: Recommendation | null = null;
      try {
        if (action === 'send') rec = sendRecommendation(workspaceId, recId);
        else if (action === 'throttle') rec = throttleRecommendation(workspaceId, recId, throttleDays!);
        else rec = strikeRecommendation(workspaceId, recId);
      } catch (err) {
        if (err instanceof InvalidTransitionError) continue;
        throw err;
      }
      if (rec) mutated.push(rec);
    }
  });
  apply();
  return mutated;
}

export interface CompetitorRecommendationInput {
  keyword: string;
  competitorDomain?: string;
  title?: string;
  description?: string;
  insight?: string;
}

export function mintCompetitorRecommendation(
  workspaceId: string,
  input: CompetitorRecommendationInput,
): { rec: Recommendation; created: boolean } {
  const { keyword, competitorDomain, title, description, insight } = input;
  const persist = db.transaction((): { rec: Recommendation; created: boolean } => {
    const set = loadRecommendations(workspaceId) ?? {
      workspaceId,
      generatedAt: new Date().toISOString(),
      recommendations: [] as Recommendation[],
      summary: computeRecommendationSummary([]),
    };

    const existing = set.recommendations.find(
      r => r.type === 'competitor' && r.targetKeyword === keyword,
    );
    if (existing) return { rec: existing, created: false };

    const now = new Date().toISOString();
    const competitorLabel = competitorDomain ? `${competitorDomain} ` : 'A competitor ';
    const rec: Recommendation = {
      id: `rec_${crypto.randomBytes(6).toString('hex')}`,
      workspaceId,
      type: 'competitor',
      priority: 'fix_soon',
      title: title || `Target "${keyword}" (competitor gap)`,
      description:
        description ||
        `${competitorLabel}ranks for "${keyword}" - you don't. Targeting this term captures demand a competitor already owns.`,
      insight:
        insight ||
        `Competitors ranking for high-demand keywords you ignore is lost organic traffic. Building content or optimizing a page for "${keyword}" lets you compete for a term with proven search demand.`,
      impact: 'medium',
      effort: 'medium',
      impactScore: 60,
      source: `competitor:${keyword}`,
      affectedPages: [],
      trafficAtRisk: 0,
      impressionsAtRisk: 0,
      estimatedGain: `Capturing "${keyword}" targets a term a competitor already ranks for`,
      actionType: 'manual',
      targetKeyword: keyword,
      status: 'pending',
      clientStatus: 'system',
      lifecycle: 'active',
      createdAt: now,
      updatedAt: now,
    };

    set.recommendations.push(rec);
    set.summary = computeRecommendationSummary(set.recommendations);
    saveRecommendations(set);
    return { rec, created: true };
  });
  return persist();
}

export interface ManualRecommendationInput {
  type: Recommendation['type'];
  title: string;
  insight: string;
  description?: string;
  priority?: Recommendation['priority'];
  targetKeyword?: string;
  affectedPages?: string[];
}

export function mintManualRecommendation(
  workspaceId: string,
  input: ManualRecommendationInput,
): Recommendation {
  const now = new Date().toISOString();
  const rec: Recommendation = {
    id: `rec_${crypto.randomBytes(6).toString('hex')}`,
    workspaceId,
    type: input.type,
    priority: input.priority ?? 'fix_soon',
    title: input.title,
    description: input.description || input.insight,
    insight: input.insight,
    impact: 'medium',
    effort: 'medium',
    impactScore: 40,
    source: `manual:${crypto.randomBytes(6).toString('hex')}`,
    affectedPages: input.affectedPages ?? [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'Operator-authored recommendation',
    actionType: 'manual',
    status: 'pending',
    clientStatus: 'system',
    lifecycle: 'active',
    createdAt: now,
    updatedAt: now,
  };
  if (input.targetKeyword) rec.targetKeyword = input.targetKeyword;

  const persist = db.transaction(() => {
    const set = loadRecommendations(workspaceId) ?? {
      workspaceId,
      generatedAt: now,
      recommendations: [] as Recommendation[],
      summary: computeRecommendationSummary([]),
    };
    set.recommendations.push(rec);
    set.summary = computeRecommendationSummary(set.recommendations);
    saveRecommendations(set);
  });
  persist();
  return rec;
}
