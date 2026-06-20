import { describe, it, expect } from 'vitest';
import type { OutcomeProvenance } from '../../shared/types/outcome-tracking.js';

describe('OutcomeProvenance — P1a measured_action tier', () => {
  it('admits the three phased provenance tiers in confidence order', () => {
    const tiers: OutcomeProvenance[] = ['estimate_ga4', 'measured_action', 'actual_reconciled'];
    expect(tiers).toEqual(['estimate_ga4', 'measured_action', 'actual_reconciled']);
  });
  it('measured_action is assignable wherever OutcomeProvenance is expected', () => {
    const p: OutcomeProvenance = 'measured_action';
    expect(p).toBe('measured_action');
  });
});
