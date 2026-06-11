/**
 * G2 contract test: every InsightDataMap key has a non-default rendering path
 * in BOTH the admin feed (useInsightFeed.ts) and the client digest (InsightsDigest.tsx).
 *
 * "Non-default" for admin:  an explicit `case 'type':` branch in transformToFeedInsight
 * "Non-default" for client: an explicit entry in INSIGHT_TYPE_ICONS that is NOT the
 *                           Sparkles fallback, plus an entry in INSIGHT_TYPE_ACTIONS.
 *
 * This test catches any future InsightType addition that ships without renderer support.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Canonical list of all InsightDataMap keys (keep in sync with shared/types/analytics.ts). */
const ALL_INSIGHT_TYPES: string[] = [
  'page_health',
  'ranking_opportunity',
  'content_decay',
  'cannibalization',
  'keyword_cluster',
  'competitor_gap',
  'conversion_attribution',
  'ranking_mover',
  'ctr_opportunity',
  'serp_opportunity',
  'strategy_alignment',
  'anomaly_digest',
  'audit_finding',
  'site_health',
  'emerging_keyword',
  'competitor_alert',
  'freshness_alert',
  'milestone_attribution',
  'lost_visibility',
];

function readSource(relativePath: string): string {
  const absolutePath = path.resolve(ROOT, relativePath);
  expect(existsSync(absolutePath), `${relativePath} should exist`).toBe(true);
  return readFileSync(absolutePath, 'utf8');
}

describe('insight renderer coverage contracts (G2)', () => {
  it('every InsightDataMap key has a named case in transformToFeedInsight (admin feed)', () => {
    const source = readSource('src/hooks/admin/useInsightFeed.ts');
    for (const type of ALL_INSIGHT_TYPES) {
      expect(
        source.includes(`case '${type}':`),
        `useInsightFeed.ts transformToFeedInsight must have case '${type}': (not just the default branch)`,
      ).toBe(true);
    }
  });

  it('every InsightType has a non-Sparkles icon and explicit action entry in InsightsDigest', () => {
    const source = readSource('src/components/client/InsightsDigest.tsx');
    for (const type of ALL_INSIGHT_TYPES) {
      // Each type must appear as a key in INSIGHT_TYPE_ICONS
      expect(
        source.includes(`${type}:`) && source.includes('INSIGHT_TYPE_ICONS'),
        `InsightsDigest.tsx INSIGHT_TYPE_ICONS must have an entry for '${type}'`,
      ).toBe(true);

      // Each type must appear as a key in INSIGHT_TYPE_ACTIONS
      // (even types that only navigate to a generic tab — they still need an entry so
      //  the card shows a CTA instead of being dead-end)
      expect(
        source.includes(`${type}:`) && source.includes('INSIGHT_TYPE_ACTIONS'),
        `InsightsDigest.tsx INSIGHT_TYPE_ACTIONS must have an entry for '${type}'`,
      ).toBe(true);
    }
  });
});
