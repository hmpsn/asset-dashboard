import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_JOB_METADATA,
  BACKGROUND_JOB_TYPES,
  getBackgroundJobLabel,
  isBackgroundJobCancellable,
  isBackgroundJobType,
  isSystemJobType,
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
      expect(['user', 'system']).toContain(metadata.class);
      expect(['ephemeral', 'domain-store', 'domain-store-and-result']).toContain(metadata.resultBehavior);
    }
  });

  it('classifies the single system-originated job type as system, everything else as user', () => {
    // INTELLIGENCE_RECOMPUTE is the only system-originated type today — created solely
    // via server/intelligence-recompute-job.ts enqueueIntelligenceRecompute, called from
    // insight-recompute-cron, rank-tracking-scheduler, and keyword-strategy-follow-ons
    // (see docs/rules/background-generation.md #System Job Class).
    expect(isSystemJobType(BACKGROUND_JOB_TYPES.INTELLIGENCE_RECOMPUTE)).toBe(true);
    expect(isSystemJobType(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION)).toBe(false);
    expect(isSystemJobType(BACKGROUND_JOB_TYPES.SEO_AUDIT)).toBe(false);
    expect(isSystemJobType(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION)).toBe(false);
  });

  it('defaults unknown job types to user-originated (safe default: never hide an unrecognized job from the admin feed)', () => {
    expect(isSystemJobType('some-unknown-job-type')).toBe(false);
  });

  it('identifies known and unknown job types', () => {
    expect(isBackgroundJobType(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR)).toBe(true);
    expect(isBackgroundJobType('tenancy-regression')).toBe(false);
    expect(isBackgroundJobType('constructor')).toBe(false);
  });

  it('centralizes labels and cancellation semantics', () => {
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE)).toBe('Bulk SEO Rewrite');
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY)).toBe('Keyword Strategy');
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION)).toBe('Content Brief Generation');
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION)).toBe('Copy Batch Generation');
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION)).toBe('Schema Plan Generation');
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION)).toBe('Recommendations Generation');
    expect(getBackgroundJobLabel('future-job')).toBe('future-job');
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR)).toBe(true);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION)).toBe(true);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH)).toBe(true);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION)).toBe(false);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION)).toBe(false);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION)).toBe(false);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION)).toBe(false);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY)).toBe(false);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.SEO_AUDIT)).toBe(false);
    expect(isBackgroundJobCancellable('future-job')).toBe(true);
  });
});
