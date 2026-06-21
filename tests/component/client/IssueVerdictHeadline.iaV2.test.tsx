import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { IssueVerdictHeadline } from '../../../src/components/client/the-issue/IssueVerdictHeadline';
import type { ROIData } from '../../../shared/types/roi';

const base: NonNullable<ROIData['outcomeVerdict']> = {
  outcomeCount: 12, outcomeUnitLabel: 'new patients', valuePerOutcome: 800,
  estimatedValue: 9600, monthlyRetainer: 2000,
  baseline: { engagementStart: '2026-01-01T00:00:00Z', baselineConversions: 4, baselineCapturedAt: '2026-01-01T00:00:00Z', state: 'ready' },
  baselineDeltaCount: 8, provenance: 'estimate_ga4', priorPeriodCount: 5,
};

describe('IssueVerdictHeadline — IA v2 MoM', () => {
  it('shows the month-over-month delta when iaV2 ON', () => {
    render(<IssueVerdictHeadline verdict={base} iaV2 />);
    expect(screen.getByText(/7\b.*vs last month/i)).toBeInTheDocument();
  });
  it('hides the MoM clause when iaV2 OFF (byte-identical)', () => {
    render(<IssueVerdictHeadline verdict={base} />);
    expect(screen.queryByText(/vs last month/i)).toBeNull();
  });
  it('shows the establishing line, never a fabricated delta, when priorPeriodCount is null', () => {
    render(<IssueVerdictHeadline verdict={{ ...base, priorPeriodCount: null }} iaV2 />);
    expect(screen.getByText(/establishing your month-over-month/i)).toBeInTheDocument();
    expect(screen.queryByText(/vs last month/i)).toBeNull();
  });
});

describe('IssueVerdictHeadline — IA v2 typed breakdown', () => {
  it('renders the typed breakdown row in the hero when iaV2 ON and breakdown present', () => {
    const withTypes = { ...base, outcomeTypeBreakdown: [
      { outcomeType: 'call' as const, label: 'calls', current: 41, baseline: null, priorPeriod: null },
      { outcomeType: 'form_fill' as const, label: 'form fills', current: 12, baseline: null, priorPeriod: null },
    ]};
    render(<IssueVerdictHeadline verdict={withTypes} iaV2 />);
    const row = screen.getByTestId('verdict-type-breakdown');
    expect(row).toHaveTextContent(/41\s*calls/i);
    expect(row).toHaveTextContent(/12\s*form fills/i);
  });
  it('omits the typed row when iaV2 OFF', () => {
    const withTypes = { ...base, outcomeTypeBreakdown: [
      { outcomeType: 'call' as const, label: 'calls', current: 41, baseline: null, priorPeriod: null },
    ]};
    render(<IssueVerdictHeadline verdict={withTypes} />);
    expect(screen.queryByTestId('verdict-type-breakdown')).toBeNull();
  });
});
