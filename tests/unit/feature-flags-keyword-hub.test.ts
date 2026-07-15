import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_GROUPS,
} from '../../shared/types/feature-flags.js';

// Wave 4 — Keyword Hub Phase C cutover (2026-06-11). The `keyword-hub` umbrella flag
// was RETIRED once the Hub became the only keyword surface (KCC + Rank Tracker deleted).
// The `keyword-value-scoring` flag was also RETIRED (value-first scoring is now
// unconditional). `keyword-universe-full` — the sole surviving member of the "Keyword
// Hub" group — was itself retired in flag-sunset Wave 2b (2026-07-02): it was globally
// ON in prod, so the uncapped keyword-universe coverage path is now unconditional. The
// "Keyword Hub" group is retained (empty) in FEATURE_FLAG_GROUPS/FEATURE_FLAG_GROUP_LABELS
// for possible future Hub-scoped flags.
describe('Keyword Hub feature-flag group (post-keyword-hub retirement)', () => {
  it('keyword-hub flag is fully retired (removed from defaults, catalog, and groups)', () => {
    expect('keyword-hub' in FEATURE_FLAGS).toBe(false);
    expect('keyword-hub' in FEATURE_FLAG_CATALOG).toBe(false);
    const groupsWithKey = FEATURE_FLAG_GROUPS.filter(g =>
      (g.keys as readonly string[]).includes('keyword-hub'),
    );
    expect(groupsWithKey).toHaveLength(0);
  });

  it('keyword-universe-full is fully retired (removed from defaults, catalog, and groups)', () => {
    expect('keyword-universe-full' in FEATURE_FLAGS).toBe(false);
    expect('keyword-universe-full' in FEATURE_FLAG_CATALOG).toBe(false);
    const groupsWithKey = FEATURE_FLAG_GROUPS.filter(g =>
      (g.keys as readonly string[]).includes('keyword-universe-full'),
    );
    expect(groupsWithKey).toHaveLength(0);
  });

  it('keyword-value-scoring is fully retired (removed from defaults, catalog, and groups)', () => {
    expect('keyword-value-scoring' in FEATURE_FLAGS).toBe(false);
    expect('keyword-value-scoring' in FEATURE_FLAG_CATALOG).toBe(false);
    const groupsWithKey = FEATURE_FLAG_GROUPS.filter(g =>
      (g.keys as readonly string[]).includes('keyword-value-scoring'),
    );
    expect(groupsWithKey).toHaveLength(0);
  });

  it('the Keyword Hub group is now empty — every flag it ever gated has been retired', () => {
    const hubBucket = FEATURE_FLAG_GROUPS.find(g => g.label === 'Keyword Hub');
    expect(hubBucket?.keys).toEqual([]);
  });

  it('importing the module runs assertFeatureFlagGroupingConsistency() without throwing', () => {
    // The module evaluates assertFeatureFlagGroupingConsistency() at import time
    // (it throws if a key is missing from a group, mis-grouped, duplicated, or
    // references an unknown key). Reaching this assertion at all proves the import
    // — and therefore the consistency check — succeeded post-retirement.
    expect(Object.keys(FEATURE_FLAG_CATALOG)).not.toContain('keyword-hub');
  });
});
