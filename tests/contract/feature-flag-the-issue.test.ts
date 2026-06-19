import { describe, it, expect } from 'vitest';
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_GROUPS,
} from '../../shared/types/feature-flags.js';

describe('strategy-the-issue feature flag', () => {
  it('is registered and defaults OFF', () => {
    expect(FEATURE_FLAGS['strategy-the-issue']).toBe(false);
  });

  it('has a catalog entry in the Strategy group at staging-validation', () => {
    const entry = FEATURE_FLAG_CATALOG['strategy-the-issue'];
    expect(entry).toBeTruthy();
    expect(entry.group).toBe('Strategy');
    expect(entry.lifecycle.rolloutTarget).toBe('staging-validation');
    expect(entry.lifecycle.owner).toBe('analytics-intelligence');
  });

  it('is listed in the Strategy flag group (grouping-consistency contract)', () => {
    const strategy = FEATURE_FLAG_GROUPS.find((g) => g.label === 'Strategy');
    expect(strategy?.keys).toContain('strategy-the-issue');
  });
});
