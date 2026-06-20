import { describe, it, expect } from 'vitest';
import type { IssueVerdict, IssueOutcomeCount, OutcomeBaseline } from '../../shared/types/the-issue.js';
import type { OutcomeProvenance } from '../../shared/types/outcome-tracking.js';

describe('the-issue client payload types', () => {
  it('IssueVerdict carries the single provenance field', () => {
    const prov: OutcomeProvenance = 'estimate_ga4';
    const v: IssueVerdict = {
      outcomeNoun: 'new patients', current: 14, baseline: 6, priorPeriod: 9,
      unit: 'count', sentence: '14 new patients, up from 6 when we started', provenance: prov,
    };
    expect(v.provenance).toBe('estimate_ga4');
    expect(v.unit).toBe('count');
  });
  it('IssueOutcomeCount exposes per-unit dual baselines + namedRecordsAvailable honesty flag', () => {
    const c: IssueOutcomeCount = {
      units: [{ label: 'calls', current: 8, baseline: 3, priorPeriod: 5, eventName: 'phone_call' }],
      provenance: 'estimate_ga4', namedRecordsAvailable: false,
    };
    expect(c.namedRecordsAvailable).toBe(false);
    expect(c.units[0].eventName).toBe('phone_call');
  });
  it('OutcomeBaseline is engagement-anchored with establishing/ready states', () => {
    const b: OutcomeBaseline = {
      engagementStart: '2026-01-01T00:00:00.000Z', baselineConversions: null,
      baselineCapturedAt: null, state: 'establishing',
    };
    expect(b.state).toBe('establishing');
  });
});
