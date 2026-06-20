import { describe, it, expect } from 'vitest';
import type { OutcomeProvenance } from '../../shared/types/outcome-tracking.js';

describe('OutcomeProvenance enum', () => {
  it('admits exactly the two phased provenance values', () => {
    const p0: OutcomeProvenance = 'estimate_ga4';
    const p1: OutcomeProvenance = 'actual_reconciled';
    expect([p0, p1]).toEqual(['estimate_ga4', 'actual_reconciled']);
  });
});
