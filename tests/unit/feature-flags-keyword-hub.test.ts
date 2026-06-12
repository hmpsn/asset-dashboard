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
  it('keyword-value-scoring flag exists, defaults OFF, and is in the Keyword Hub group', () => {
    expect(FEATURE_FLAGS['keyword-value-scoring']).toBe(false);
    const entry = FEATURE_FLAG_CATALOG['keyword-value-scoring'];
    expect(entry.group).toBe('Keyword Hub');
    expect(entry.lifecycle.owner).toBe('analytics-intelligence');
    expect(entry.lifecycle.linkedRoadmapItemId).toBeTruthy();
    const hubBucket = FEATURE_FLAG_GROUPS.find(g => g.label === 'Keyword Hub');
    expect(hubBucket?.keys).toContain('keyword-value-scoring');
  });

  it('exists and is ON by default (Phase B cutover flip, 2026-06-11)', () => {
    expect(FEATURE_FLAGS['keyword-hub']).toBe(true);
  });

  it('has a catalog entry grouped under "Keyword Hub" with all-clients rollout', () => {
    const entry = FEATURE_FLAG_CATALOG['keyword-hub'];
    expect(entry).toBeDefined();
    expect(entry.group).toBe('Keyword Hub');
    expect(entry.lifecycle.rolloutTarget).toBe('all-clients');
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
