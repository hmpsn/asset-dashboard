// server/outcome-scoring-defaults.ts
// Default scoring thresholds for each action type

import type { ScoringConfig } from '../shared/types/outcome-tracking.js';

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  content_published: {
    primary_metric: 'position',
    thresholds: { strong_win: 10, win: 3, neutral_band: 1 },
  },
  insight_acted_on: {
    primary_metric: 'clicks',
    thresholds: { strong_win: 30, win: 15, neutral_band: 10 },
  },
  strategy_keyword_added: {
    primary_metric: 'position',
    thresholds: { strong_win: 10, win: 5, neutral_band: 3 },
  },
  schema_deployed: {
    primary_metric: 'ctr',
    thresholds: { strong_win: 20, win: 10, neutral_band: 5 },
  },
  audit_fix_applied: {
    primary_metric: 'page_health_score',
    thresholds: { strong_win: 15, win: 5, neutral_band: 3 },
  },
  content_refreshed: {
    primary_metric: 'click_recovery',
    thresholds: { strong_win: 80, win: 40, neutral_band: 20 },
  },
  internal_link_added: {
    primary_metric: 'target_improvement',
    thresholds: { strong_win: 20, win: 10, neutral_band: 5 },
  },
  meta_updated: {
    primary_metric: 'ctr',
    thresholds: { strong_win: 15, win: 5, neutral_band: 5 },
  },
  brief_created: {
    primary_metric: 'content_produced',
    thresholds: { strong_win: 1, win: 1, neutral_band: 0 },
  },
  voice_calibrated: {
    primary_metric: 'voice_score',
    thresholds: { strong_win: 85, win: 70, neutral_band: 10 },
  },
};

export function resolveScoringConfig(
  override: Partial<ScoringConfig> | null | undefined,
): ScoringConfig {
  if (!override) return DEFAULT_SCORING_CONFIG;
  // Deep-merge: shallow spread would replace entire per-action-type entries, losing
  // default thresholds when the workspace override only specifies a partial entry
  // (e.g. just primary_metric). Merge each action type individually instead.
  const result = { ...DEFAULT_SCORING_CONFIG };
  for (const key of Object.keys(override) as Array<keyof ScoringConfig>) {
    if (override[key]) {
      result[key] = { ...DEFAULT_SCORING_CONFIG[key], ...override[key] };
    }
  }
  return result;
}
