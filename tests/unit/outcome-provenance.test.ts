import { describe, it, expect } from 'vitest';
import type { OutcomeProvenance } from '../../shared/types/outcome-tracking.js';

describe('OutcomeProvenance enum', () => {
  it('admits the three phased provenance tiers in confidence order', () => {
    // P1a inserted `measured_action` between the P0 estimate tier and the P3 reconciled tier.
    const p0: OutcomeProvenance = 'estimate_ga4';
    const p1a: OutcomeProvenance = 'measured_action';
    const p3: OutcomeProvenance = 'actual_reconciled';
    expect([p0, p1a, p3]).toEqual(['estimate_ga4', 'measured_action', 'actual_reconciled']);
  });
});
