import { describe, expect, it } from 'vitest';

import { BRAND_CONTENT_ONBOARDING_STATUSES } from '../../shared/types/brand-content-onboarding.js';
import { LIFECYCLE_REGISTRY } from '../../shared/types/lifecycle.js';
import {
  BRAND_CONTENT_ONBOARDING_TRANSITIONS,
  validateTransition,
} from '../../server/state-machines.js';

describe('brand content onboarding lifecycle', () => {
  it('registers every locked status against the guarded transition table', () => {
    expect(Object.keys(BRAND_CONTENT_ONBOARDING_TRANSITIONS))
      .toEqual([...BRAND_CONTENT_ONBOARDING_STATUSES]);

    const lifecycle = LIFECYCLE_REGISTRY.find(
      entry => entry.entity === 'brand_content_onboarding',
    );
    expect(lifecycle).toBeDefined();
    expect(lifecycle?.states).toEqual([...BRAND_CONTENT_ONBOARDING_STATUSES]);
    expect(lifecycle?.transitions).toBe(BRAND_CONTENT_ONBOARDING_TRANSITIONS);
  });

  it('requires the page-review gate before publish readiness', () => {
    expect(BRAND_CONTENT_ONBOARDING_TRANSITIONS.content_generating)
      .toContain('awaiting_content_review');
    expect(BRAND_CONTENT_ONBOARDING_TRANSITIONS.content_generating)
      .not.toContain('ready_to_publish');
    expect(() => validateTransition(
      'brand_content_onboarding',
      BRAND_CONTENT_ONBOARDING_TRANSITIONS,
      'content_generating',
      'ready_to_publish',
    )).toThrow(/Invalid brand_content_onboarding transition/);
    expect(validateTransition(
      'brand_content_onboarding',
      BRAND_CONTENT_ONBOARDING_TRANSITIONS,
      'awaiting_content_review',
      'ready_to_publish',
    )).toBe('ready_to_publish');
  });

  it('allows needs-attention recovery only to non-terminal workflow states', () => {
    const recoveryTargets = BRAND_CONTENT_ONBOARDING_TRANSITIONS.needs_attention;
    expect(recoveryTargets).toContain('awaiting_operator_review');
    expect(recoveryTargets).toContain('content_generating');
    expect(recoveryTargets).not.toContain('ready_to_publish');
    expect(recoveryTargets).not.toContain('intake_ready');
  });
});
