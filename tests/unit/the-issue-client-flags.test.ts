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

describe('the-issue-client-measured-capture (P1a website-native capture)', () => {
  it('registered, default-OFF, grouped under "The Issue (Client)"', () => {
    expect(FEATURE_FLAGS['the-issue-client-measured-capture']).toBe(false);
    const group = FEATURE_FLAG_GROUPS.find(g => g.label === 'The Issue (Client)');
    expect(group!.keys).toContain('the-issue-client-measured-capture');
  });
  it('carries a P1a roadmap link + pilot-clients rollout, distinct from the P3 reconciliation flag', () => {
    const meta = FEATURE_FLAG_CATALOG['the-issue-client-measured-capture'].lifecycle;
    expect(meta.rolloutTarget).toBe('pilot-clients');
    expect(meta.linkedRoadmapItemId).toBe('the-issue-client-redesign-p1a-measured-capture');
  });
  it('the P3 reconciliation flag stays reserved for CRM/call-tracking (NOT P1a)', () => {
    expect(FEATURE_FLAGS['the-issue-client-reconciliation']).toBe(false);
    expect(FEATURE_FLAG_CATALOG['the-issue-client-reconciliation'].lifecycle.removalCondition).toMatch(/CRM|call.?tracking|P3/i);
  });
});
