/**
 * Contract tests for The Issue (Client) P0 shared types.
 * Pins the producer/consumer contract: IssueVerdict / IssueOutcomeCount / OutcomeBaseline,
 * Workspace.outcomeValue, ROIData.outcomeVerdict, and the closed OutcomeProvenance union.
 * The @ts-expect-error lines are the executable acceptance for Lane A's type declarations —
 * a third provenance value, or a missing additive field, fails typecheck here.
 */
import { describe, it, expect } from 'vitest';
import type { IssueVerdict, IssueOutcomeCount, OutcomeBaseline } from '../../shared/types/the-issue.js';
import type { OutcomeProvenance } from '../../shared/types/outcome-tracking.js';
import type { Workspace } from '../../shared/types/workspace.js';
import type { ROIData } from '../../shared/types/roi.js';

describe('the-issue P0 type contracts', () => {
  it('IssueVerdict pins its full shape (count unit)', () => {
    const v: IssueVerdict = {
      outcomeNoun: 'new patients', current: 14, baseline: 6, priorPeriod: 9,
      unit: 'count', sentence: '14 new patients, up from 6 when we started', provenance: 'estimate_ga4',
    };
    expect(v.unit).toBe('count');
  });

  it('IssueVerdict admits a dollars unit', () => {
    const v: IssueVerdict = {
      outcomeNoun: 'pipeline $', current: 42000, baseline: null, priorPeriod: null,
      unit: 'dollars', sentence: '$42,000 in pipeline since we started', provenance: 'estimate_ga4',
    };
    expect(v.unit).toBe('dollars');
  });

  it('OutcomeProvenance is a closed two-value union', () => {
    const ok: OutcomeProvenance[] = ['estimate_ga4', 'actual_reconciled'];
    expect(ok).toHaveLength(2);
    // @ts-expect-error — no third provenance value is permitted
    const bad: OutcomeProvenance = 'estimate_crm';
    expect(bad).toBeDefined();
  });

  it('IssueOutcomeCount + OutcomeBaseline pin their shapes', () => {
    const count: IssueOutcomeCount = {
      units: [{ label: 'calls', current: 8, baseline: 3, priorPeriod: 5, eventName: 'phone_call' }],
      provenance: 'estimate_ga4', namedRecordsAvailable: false,
    };
    const baseline: OutcomeBaseline = {
      engagementStart: '2026-01-01T00:00:00.000Z', baselineConversions: 6,
      baselineCapturedAt: '2026-01-01T00:00:00.000Z', state: 'ready',
    };
    expect(count.units[0].label).toBe('calls');
    expect(baseline.state).toBe('ready');
  });

  it('Workspace.outcomeValue is additive + optional with a closed basis union', () => {
    const ov: NonNullable<Workspace['outcomeValue']> = {
      valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate',
    };
    expect(ov.basis).toBe('agency_estimate');
    // @ts-expect-error — basis is a closed union
    const bad: NonNullable<Workspace['outcomeValue']>['basis'] = 'guessed';
    expect(bad).toBeDefined();
  });

  it('ROIData.outcomeVerdict is additive — legacy Pick still satisfies', () => {
    // A legacy consumer that only reads organicTrafficValue must remain valid (additive contract).
    const legacy: Pick<ROIData, 'organicTrafficValue'> = { organicTrafficValue: 1234 };
    expect(legacy.organicTrafficValue).toBe(1234);
  });

  it('P0 invariant: outcomeVerdict.provenance is estimate_ga4', () => {
    const verdict: NonNullable<ROIData['outcomeVerdict']> = {
      outcomeCount: 14, outcomeUnitLabel: 'new patient', valuePerOutcome: 800,
      estimatedValue: 11200, monthlyRetainer: 1500,
      baseline: { engagementStart: '2026-01-01T00:00:00.000Z', baselineConversions: 6, baselineCapturedAt: '2026-01-01T00:00:00.000Z', state: 'ready' },
      baselineDeltaCount: 8, provenance: 'estimate_ga4',
    };
    expect(verdict.provenance).toBe('estimate_ga4');
  });
});
