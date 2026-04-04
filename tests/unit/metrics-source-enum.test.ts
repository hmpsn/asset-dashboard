// tests/unit/metrics-source-enum.test.ts
import { describe, it, expect } from 'vitest';
import { METRICS_SOURCE } from '../../shared/types/keywords.js';

describe('METRICS_SOURCE', () => {
  it('EXACT equals exact', () => {
    expect(METRICS_SOURCE.EXACT).toBe('exact');
  });

  it('PARTIAL_MATCH equals partial_match', () => {
    expect(METRICS_SOURCE.PARTIAL_MATCH).toBe('partial_match');
  });

  it('BULK_LOOKUP equals bulk_lookup', () => {
    expect(METRICS_SOURCE.BULK_LOOKUP).toBe('bulk_lookup');
  });

  it('AI_ESTIMATE equals ai_estimate', () => {
    expect(METRICS_SOURCE.AI_ESTIMATE).toBe('ai_estimate');
  });

  it('has exactly 4 keys', () => {
    expect(Object.keys(METRICS_SOURCE)).toHaveLength(4);
  });
});
