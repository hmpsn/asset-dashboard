import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_GROUPS,
} from '../../shared/types/feature-flags.js';

// Wave 4 — Keyword Hub Phase C cutover (2026-06-11). The `keyword-hub` umbrella flag
// was RETIRED once the Hub became the only keyword surface (KCC + Rank Tracker deleted).
// The "Keyword Hub" group survives with its two coverage/scoring sub-flags, which keep
// their own independent removal conditions.
describe('Keyword Hub feature-flag group (post-keyword-hub retirement)', () => {
  it('keyword-hub flag is fully retired (removed from defaults, catalog, and groups)', () => {
    expect('keyword-hub' in FEATURE_FLAGS).toBe(false);
    expect('keyword-hub' in FEATURE_FLAG_CATALOG).toBe(false);
    const groupsWithKey = FEATURE_FLAG_GROUPS.filter(g =>
      (g.keys as readonly string[]).includes('keyword-hub'),
    );
    expect(groupsWithKey).toHaveLength(0);
  });

  it('keyword-universe-full survives, defaults OFF, and stays in the Keyword Hub group', () => {
    expect(FEATURE_FLAGS['keyword-universe-full']).toBe(false);
    const entry = FEATURE_FLAG_CATALOG['keyword-universe-full'];
    expect(entry.group).toBe('Keyword Hub');
    expect(entry.lifecycle.owner).toBe('analytics-intelligence');
    expect(entry.lifecycle.linkedRoadmapItemId).toBeTruthy();
    const hubBucket = FEATURE_FLAG_GROUPS.find(g => g.label === 'Keyword Hub');
    expect(hubBucket?.keys).toContain('keyword-universe-full');
  });

  it('keyword-value-scoring survives, defaults OFF, and stays in the Keyword Hub group', () => {
    expect(FEATURE_FLAGS['keyword-value-scoring']).toBe(false);
    const entry = FEATURE_FLAG_CATALOG['keyword-value-scoring'];
    expect(entry.group).toBe('Keyword Hub');
    const hubBucket = FEATURE_FLAG_GROUPS.find(g => g.label === 'Keyword Hub');
    expect(hubBucket?.keys).toContain('keyword-value-scoring');
  });

  it('the Keyword Hub group retains exactly the two surviving keys', () => {
    const hubBucket = FEATURE_FLAG_GROUPS.find(g => g.label === 'Keyword Hub');
    expect(hubBucket?.keys).toEqual(['keyword-universe-full', 'keyword-value-scoring']);
  });

  it('importing the module runs assertFeatureFlagGroupingConsistency() without throwing', () => {
    // The module evaluates assertFeatureFlagGroupingConsistency() at import time
    // (it throws if a key is missing from a group, mis-grouped, duplicated, or
    // references an unknown key). Reaching this assertion at all proves the import
    // — and therefore the consistency check — succeeded post-retirement.
    expect(Object.keys(FEATURE_FLAG_CATALOG)).not.toContain('keyword-hub');
  });
});
