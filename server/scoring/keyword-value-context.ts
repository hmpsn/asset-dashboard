import type { Workspace } from '../../shared/types/workspace.js';
import { getLocalSeoPosture, listLocalSeoMarkets } from '../local-seo.js';
import type { KeywordValueInput, ScoringContext } from './keyword-value-score.js';
import { computeKeywordValueScore } from './keyword-value-score.js';

/** Build the per-workspace Layer 1 scoring context once per read path. */
export function buildKeywordValueScoringContext(workspace: Workspace): ScoringContext {
  return {
    posture: getLocalSeoPosture(workspace.id),
    markets: listLocalSeoMarkets(workspace.id),
    city: workspace.businessProfile?.address?.city?.toLowerCase(),
    state: workspace.businessProfile?.address?.state?.toLowerCase(),
  };
}

export function computeKeywordValueScoreWithFallback(
  input: KeywordValueInput,
  ctx: ScoringContext | undefined,
  fallback: number,
): number {
  return ctx ? computeKeywordValueScore(input, ctx) ?? fallback : fallback;
}
