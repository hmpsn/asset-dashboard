import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_JOB_METADATA,
  BACKGROUND_JOB_TYPES,
  getBackgroundJobLabel,
  isBackgroundJobCancellable,
  isBackgroundJobType,
} from '../../shared/types/background-jobs';

describe('background job metadata', () => {
  it('defines metadata for every known job type', () => {
    const types = Object.values(BACKGROUND_JOB_TYPES);
    expect(types.length).toBeGreaterThan(0);

    for (const type of types) {
      const metadata = BACKGROUND_JOB_METADATA[type];
      expect(metadata.label.length).toBeGreaterThan(0);
      expect(metadata.description.length).toBeGreaterThan(0);
      expect(typeof metadata.cancellable).toBe('boolean');
      expect(['ephemeral', 'domain-store', 'domain-store-and-result']).toContain(metadata.resultBehavior);
    }
  });

  it('identifies known and unknown job types', () => {
    expect(isBackgroundJobType(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR)).toBe(true);
    expect(isBackgroundJobType('tenancy-regression')).toBe(false);
    expect(isBackgroundJobType('constructor')).toBe(false);
  });

  it('centralizes labels and cancellation semantics', () => {
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE)).toBe('Bulk SEO Rewrite');
    expect(getBackgroundJobLabel('future-job')).toBe('future-job');
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR)).toBe(true);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.SEO_AUDIT)).toBe(false);
    expect(isBackgroundJobCancellable('future-job')).toBe(true);
  });
});
