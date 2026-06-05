import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_GROUPS,
} from '../../shared/types/feature-flags.js';

// Wave 4 — Keyword Hub P0-T1. The `keyword-hub` flag dark-launches the whole Hub
// (KCC + Rank Tracker consolidation). It MUST be OFF by default (dark), grouped,
// and pass the import-time grouping-consistency assertion + verify:feature-flags.
describe('keyword-hub feature flag (Wave 4 P0)', () => {
  it('exists and is OFF by default (dark launch)', () => {
    expect(FEATURE_FLAGS['keyword-hub']).toBe(false);
  });

  it('has a catalog entry grouped under "Keyword Hub" with staging-validation rollout', () => {
    const entry = FEATURE_FLAG_CATALOG['keyword-hub'];
    expect(entry).toBeDefined();
    expect(entry.group).toBe('Keyword Hub');
    expect(entry.lifecycle.rolloutTarget).toBe('staging-validation');
    expect(entry.lifecycle.linkedRoadmapItemId).toBe('keyword-hub-wave4');
  });

  it('is registered in exactly one group (the "Keyword Hub" group)', () => {
    const groupsWithKey = FEATURE_FLAG_GROUPS.filter(g => g.keys.includes('keyword-hub'));
    expect(groupsWithKey).toHaveLength(1);
    expect(groupsWithKey[0].label).toBe('Keyword Hub');
  });

  it('importing the module runs assertFeatureFlagGroupingConsistency() without throwing', () => {
    // The module evaluates assertFeatureFlagGroupingConsistency() at import time
    // (it throws if a key is missing from a group, mis-grouped, duplicated, or
    // references an unknown key). Reaching this assertion at all proves the import
    // — and therefore the consistency check — succeeded for `keyword-hub`.
    expect(Object.keys(FEATURE_FLAG_CATALOG)).toContain('keyword-hub');
  });
});
