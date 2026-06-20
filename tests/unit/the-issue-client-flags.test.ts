import { describe, it, expect } from 'vitest';
import { FEATURE_FLAGS, FEATURE_FLAG_CATALOG, FEATURE_FLAG_GROUPS, FEATURE_FLAG_GROUP_LABELS } from '../../shared/types/feature-flags';

const FAMILY = [
  'the-issue-client-spine', 'the-issue-client-reconciliation', 'the-issue-client-return-hook',
  'the-issue-client-segment-inserts', 'the-issue-client-next-bets',
] as const;

describe('the-issue-client feature flag family', () => {
  it('declares every family member as default-OFF', () => {
    for (const key of FAMILY) expect(FEATURE_FLAGS[key], `${key} must exist`).toBe(false);
  });
  it('the P0 master flag carries pilot-clients rollout + a linked roadmap item', () => {
    const meta = FEATURE_FLAG_CATALOG['the-issue-client-spine'].lifecycle;
    expect(meta.rolloutTarget).toBe('pilot-clients');
    expect(meta.linkedRoadmapItemId).toBe('the-issue-client-redesign-p0');
    expect(meta.owner).toBeTruthy();
  });
  it('the return-hook child watches delivery cost on staging first', () => {
    expect(FEATURE_FLAG_CATALOG['the-issue-client-return-hook'].lifecycle.rolloutTarget).toBe('staging-validation');
  });
  it('every family member is grouped under "The Issue (Client)"', () => {
    expect(FEATURE_FLAG_GROUP_LABELS).toContain('The Issue (Client)');
    const group = FEATURE_FLAG_GROUPS.find(g => g.label === 'The Issue (Client)');
    expect(group).toBeDefined();
    for (const key of FAMILY) {
      expect(group!.keys).toContain(key);
      expect(FEATURE_FLAG_CATALOG[key]).toBeDefined();
    }
  });
});
