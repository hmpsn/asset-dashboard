/**
 * Wave 25 — Unit tests for server/outcome-scoring-defaults.ts
 *
 * The module exports:
 *   - DEFAULT_SCORING_CONFIG: ScoringConfig — default thresholds for all ActionType values
 *   - resolveScoringConfig(override): deep-merges overrides, falls back to defaults when absent
 *
 * Tests verify:
 *   - DEFAULT_SCORING_CONFIG covers all ActionType values
 *   - Each entry has a primary_metric and valid thresholds shape
 *   - resolveScoringConfig returns defaults unchanged when override is null/undefined
 *   - resolveScoringConfig deep-merges partial overrides (preserves unspecified keys)
 *   - resolveScoringConfig replaces full entries when a complete override is provided
 *   - Threshold ordering: strong_win >= win >= neutral_band makes semantic sense
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  resolveScoringConfig,
} from '../../server/outcome-scoring-defaults.js';
import type { ActionType, ScoringConfig } from '../../shared/types/outcome-tracking.js';

// All action types defined in shared/types/outcome-tracking.ts. Kept in lockstep with the
// real ActionType union — the DEFAULT_SCORING_CONFIG completeness assertions below are only
// as strong as this list. Reconcile R8-PR1 (B13) added `gbp_review_reply` (ships dark).
const ALL_ACTION_TYPES: ActionType[] = [
  'insight_acted_on',
  'content_published',
  'brief_created',
  'strategy_keyword_added',
  'schema_deployed',
  'audit_fix_applied',
  'content_refreshed',
  'internal_link_added',
  'meta_updated',
  'voice_calibrated',
  'competitor_gap_closed',
  'cluster_published',
  'cannibalization_resolved',
  'local_visibility_won',
  'local_service_added',
  'topic_cluster_keep',
  'content_gap_keep',
  'gbp_review_reply',
];

// ── DEFAULT_SCORING_CONFIG ─────────────────────────────────────────────────────

describe('DEFAULT_SCORING_CONFIG', () => {
  it('contains an entry for every ActionType', () => {
    for (const actionType of ALL_ACTION_TYPES) {
      expect(DEFAULT_SCORING_CONFIG).toHaveProperty(actionType);
    }
  });

  it('each entry has a non-empty primary_metric string', () => {
    for (const actionType of ALL_ACTION_TYPES) {
      const entry = DEFAULT_SCORING_CONFIG[actionType];
      expect(typeof entry.primary_metric).toBe('string');
      expect(entry.primary_metric.length).toBeGreaterThan(0);
    }
  });

  it('each entry has thresholds with strong_win, win, and neutral_band', () => {
    for (const actionType of ALL_ACTION_TYPES) {
      const { thresholds } = DEFAULT_SCORING_CONFIG[actionType];
      expect(typeof thresholds.strong_win).toBe('number');
      expect(typeof thresholds.win).toBe('number');
      expect(typeof thresholds.neutral_band).toBe('number');
    }
  });

  it('strong_win threshold is >= win threshold for all action types', () => {
    for (const actionType of ALL_ACTION_TYPES) {
      const { thresholds } = DEFAULT_SCORING_CONFIG[actionType];
      expect(thresholds.strong_win).toBeGreaterThanOrEqual(thresholds.win);
    }
  });

  it('win threshold is >= neutral_band for all action types', () => {
    for (const actionType of ALL_ACTION_TYPES) {
      const { thresholds } = DEFAULT_SCORING_CONFIG[actionType];
      expect(thresholds.win).toBeGreaterThanOrEqual(thresholds.neutral_band);
    }
  });

  it('spot-checks known config values for content_published', () => {
    expect(DEFAULT_SCORING_CONFIG.content_published.primary_metric).toBe('position');
    expect(DEFAULT_SCORING_CONFIG.content_published.thresholds.strong_win).toBe(10);
    expect(DEFAULT_SCORING_CONFIG.content_published.thresholds.win).toBe(3);
    expect(DEFAULT_SCORING_CONFIG.content_published.thresholds.neutral_band).toBe(1);
  });

  it('spot-checks known config values for voice_calibrated', () => {
    expect(DEFAULT_SCORING_CONFIG.voice_calibrated.primary_metric).toBe('voice_score');
    expect(DEFAULT_SCORING_CONFIG.voice_calibrated.thresholds.strong_win).toBe(85);
  });
});

// ── resolveScoringConfig ───────────────────────────────────────────────────────

describe('resolveScoringConfig', () => {
  it('returns DEFAULT_SCORING_CONFIG reference when override is null', () => {
    const result = resolveScoringConfig(null);
    expect(result).toEqual(DEFAULT_SCORING_CONFIG);
  });

  it('returns DEFAULT_SCORING_CONFIG reference when override is undefined', () => {
    const result = resolveScoringConfig(undefined);
    expect(result).toEqual(DEFAULT_SCORING_CONFIG);
  });

  it('returns a copy (not the same reference) when merging an override', () => {
    const result = resolveScoringConfig({ content_published: DEFAULT_SCORING_CONFIG.content_published });
    expect(result).not.toBe(DEFAULT_SCORING_CONFIG);
  });

  it('deep-merges a partial override — preserves default thresholds for unspecified fields', () => {
    const override: Partial<ScoringConfig> = {
      content_published: {
        primary_metric: 'clicks',  // change only primary_metric
        thresholds: DEFAULT_SCORING_CONFIG.content_published.thresholds, // keep thresholds same
      },
    };
    const result = resolveScoringConfig(override);
    // Overridden action type uses new primary_metric
    expect(result.content_published.primary_metric).toBe('clicks');
    // Other action types remain unchanged
    expect(result.insight_acted_on).toEqual(DEFAULT_SCORING_CONFIG.insight_acted_on);
    expect(result.schema_deployed).toEqual(DEFAULT_SCORING_CONFIG.schema_deployed);
  });

  it('overrides thresholds when a full entry is provided', () => {
    const override: Partial<ScoringConfig> = {
      schema_deployed: {
        primary_metric: 'impressions',
        thresholds: { strong_win: 50, win: 25, neutral_band: 10 },
      },
    };
    const result = resolveScoringConfig(override);
    expect(result.schema_deployed.primary_metric).toBe('impressions');
    expect(result.schema_deployed.thresholds.strong_win).toBe(50);
    // Unrelated action types are unchanged
    expect(result.content_published).toEqual(DEFAULT_SCORING_CONFIG.content_published);
  });

  it('merges multiple action type overrides simultaneously', () => {
    const override: Partial<ScoringConfig> = {
      brief_created: {
        primary_metric: 'briefs_published',
        thresholds: { strong_win: 5, win: 3, neutral_band: 1 },
      },
      voice_calibrated: {
        primary_metric: 'voice_score',
        thresholds: { strong_win: 90, win: 75, neutral_band: 50 },
      },
    };
    const result = resolveScoringConfig(override);
    expect(result.brief_created.primary_metric).toBe('briefs_published');
    expect(result.voice_calibrated.thresholds.strong_win).toBe(90);
    // Untouched entries remain at defaults
    expect(result.audit_fix_applied).toEqual(DEFAULT_SCORING_CONFIG.audit_fix_applied);
  });
});
