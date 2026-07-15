import { describe, it, expect } from 'vitest';
import { FEATURE_FLAGS, FEATURE_FLAG_CATALOG, FEATURE_FLAG_GROUPS, FEATURE_FLAG_GROUP_LABELS } from '../../shared/types/feature-flags';

// the-issue-client-reconciliation (P3) and the-issue-client-segment-inserts (P1) were
// retired as phantoms in flag-sunset Wave 1 (reserved keys, zero readers) — see the
// retired-flag assertions below. Re-add them if/when those features are actually built.
const FAMILY = [
  'the-issue-client-spine', 'the-issue-client-return-hook', 'the-issue-client-next-bets',
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
  it('carries a P1a roadmap link + pilot-clients rollout', () => {
    const meta = FEATURE_FLAG_CATALOG['the-issue-client-measured-capture'].lifecycle;
    expect(meta.rolloutTarget).toBe('pilot-clients');
    expect(meta.linkedRoadmapItemId).toBe('the-issue-client-redesign-p1a-measured-capture');
  });
  it('the P3 reconciliation phantom flag was retired (flag-sunset W1) — reserved key, zero readers', () => {
    expect('the-issue-client-reconciliation' in FEATURE_FLAGS).toBe(false);
    expect(FEATURE_FLAG_CATALOG['the-issue-client-reconciliation' as keyof typeof FEATURE_FLAG_CATALOG]).toBeUndefined();
  });
});

// Lane D (D1) — pin the P1b bundle's part→flag gating contract. P1b ships entirely on the two
// already-declared, default-OFF child flags (no net-new flag, DR-6):
//   - the-issue-client-measured-capture → admin setup-readiness checklist + admin named-leads
//   - the-issue-client-return-hook      → client one-pager export + client own-leads
// The negative is load-bearing: P1b parts MUST NOT be gated on the-issue-client-reconciliation
// (that flag is reserved for P3 CRM/call-tracking reconciliation). This locks the gating decision so
// a future refactor cannot silently re-home a P1b surface onto the wrong flag.
describe('P1b bundle gating (Lane D, D1)', () => {
  const P1B_CHILD_FLAGS = ['the-issue-client-measured-capture', 'the-issue-client-return-hook'] as const;

  it('both P1b child flags exist in the catalog and default OFF (no net-new flag)', () => {
    for (const key of P1B_CHILD_FLAGS) {
      expect(FEATURE_FLAGS[key], `${key} must exist`).toBe(false);
      expect(FEATURE_FLAG_CATALOG[key], `${key} must be in the catalog`).toBeDefined();
    }
  });

  it('both P1b child flags are grouped under "The Issue (Client)"', () => {
    const group = FEATURE_FLAG_GROUPS.find(g => g.label === 'The Issue (Client)');
    expect(group).toBeDefined();
    for (const key of P1B_CHILD_FLAGS) {
      expect(group!.keys).toContain(key);
      expect(FEATURE_FLAG_CATALOG[key].group).toBe('The Issue (Client)');
    }
  });

  it('the admin-half flag (measured-capture) carries its P1a roadmap link', () => {
    const meta = FEATURE_FLAG_CATALOG['the-issue-client-measured-capture'].lifecycle;
    expect(meta.linkedRoadmapItemId).toBe('the-issue-client-redesign-p1a-measured-capture');
    expect(meta.owner).toBeTruthy();
  });

  it('the client-half flag (return-hook) watches delivery cost on staging first + links its roadmap item', () => {
    const meta = FEATURE_FLAG_CATALOG['the-issue-client-return-hook'].lifecycle;
    expect(meta.rolloutTarget).toBe('staging-validation');
    expect(meta.linkedRoadmapItemId).toBe('the-issue-client-redesign-p1-return-hook');
    expect(meta.owner).toBeTruthy();
  });

  it('NEGATIVE — the P3 reconciliation flag was retired (flag-sunset W1); P1b was never gated on it', () => {
    // Retired as a phantom (catalog entry, zero readers). Re-add the key if/when P3
    // CRM/call-tracking reconciliation is actually built.
    expect('the-issue-client-reconciliation' in FEATURE_FLAGS).toBe(false);
    for (const key of P1B_CHILD_FLAGS) {
      expect(key).not.toBe('the-issue-client-reconciliation');
    }
  });
});
