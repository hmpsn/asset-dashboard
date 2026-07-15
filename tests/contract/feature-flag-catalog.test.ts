import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_GROUPS,
  FEATURE_FLAG_KEYS,
  type FeatureFlagKey,
} from '../../shared/types/feature-flags.js';

const GENERATION_FLAGS = [
  'content-matrix-generation',
  'content-generation-context-v2',
  'brand-deliverable-generation',
] as const satisfies readonly FeatureFlagKey[];

const EXPECTED_OWNER: Record<(typeof GENERATION_FLAGS)[number], string> = {
  'content-matrix-generation': 'content-pipeline',
  'content-generation-context-v2': 'content-pipeline',
  'brand-deliverable-generation': 'brand-engine',
};

const EXPECTED_ROADMAP_ITEM: Record<(typeof GENERATION_FLAGS)[number], string> = {
  'content-matrix-generation': 'mcp-content-matrix-generation',
  'content-generation-context-v2': 'genq-content-context-v2',
  'brand-deliverable-generation': 'mcp-brand-deliverable-generation',
};

describe('MCP deliverable-generation rollout flags', () => {
  it('registers the three generation-program flags OFF in the 24-flag catalog', () => {
    expect(FEATURE_FLAG_KEYS).toHaveLength(24);
    for (const key of GENERATION_FLAGS) {
      expect(FEATURE_FLAGS[key]).toBe(false);
    }
  });

  it('keeps generation flags OFF with phase-correct staging lifecycle metadata', () => {
    for (const key of GENERATION_FLAGS) {
      const entry = FEATURE_FLAG_CATALOG[key];
      expect(entry.group).toBe('Platform Intelligence Enhancements');
      expect(entry.lifecycle).toMatchObject({
        owner: EXPECTED_OWNER[key],
        rolloutTarget: 'staging-validation',
        linkedRoadmapItemId: EXPECTED_ROADMAP_ITEM[key],
        staleAuditCadence: 'weekly',
      });
    }
    expect(FEATURE_FLAG_CATALOG['content-matrix-generation'].lifecycle.status).toBe('reserved');
    expect(FEATURE_FLAG_CATALOG['content-matrix-generation'].lifecycle.removalCondition)
      .toContain('2026-08-03');
    expect(FEATURE_FLAG_CATALOG['brand-deliverable-generation'].lifecycle.status).toBe('active');
    expect(FEATURE_FLAG_CATALOG['brand-deliverable-generation'].lifecycle.removalCondition)
      .toContain('B3');
    expect(FEATURE_FLAG_CATALOG['content-generation-context-v2'].lifecycle).toMatchObject({
      status: 'active',
      createdAt: '2026-07-14',
      lastReviewedAt: '2026-07-14',
    });
    expect(FEATURE_FLAG_CATALOG['content-generation-context-v2'].lifecycle.removalCondition)
      .toContain('2026-08-11');
  });

  it('uses the existing platform-intelligence group and adds no composite flag', () => {
    const group = FEATURE_FLAG_GROUPS.find(entry => entry.label === 'Platform Intelligence Enhancements');
    expect(group?.keys).toEqual(GENERATION_FLAGS);
    expect(FEATURE_FLAG_KEYS).not.toContain('brand-content-onboarding');
  });
});
