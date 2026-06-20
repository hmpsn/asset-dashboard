import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Recommendation } from '../../shared/types/recommendations';
import type { ROIData } from '../../shared/types/roi';
import { IssueVerdictHeadline } from '../../src/components/client/the-issue/IssueVerdictHeadline';
import { hasTemporalLanguage } from '../../src/components/client/the-issue/evergreenCopy';

const verdict: NonNullable<ROIData['outcomeVerdict']> = {
  outcomeCount: 14,
  outcomeUnitLabel: 'new patients',
  valuePerOutcome: 800,
  estimatedValue: 11_234,
  monthlyRetainer: 1_500,
  baseline: {
    engagementStart: '2026-01-01T00:00:00Z',
    baselineConversions: 6,
    baselineCapturedAt: '2026-01-01T00:00:00Z',
    state: 'ready',
  },
  baselineDeltaCount: 8,
  provenance: 'estimate_ga4',
};

describe('IssueVerdictHeadline', () => {
  it('leads with a banded estimated dollar value, the outcome count, and an estimate label', () => {
    render(<IssueVerdictHeadline verdict={verdict} topRec={null} />);
    expect(screen.getByText(/~\$11,000/)).toBeInTheDocument();
    expect(screen.getByText(/14 new patients/)).toBeInTheDocument();
    expect(screen.getByText(/estimate/i)).toBeInTheDocument();
  });
  it('renders the baseline anchor and passes the verdict-zone evergreen guard', () => {
    const { container } = render(<IssueVerdictHeadline verdict={verdict} topRec={null} />);
    expect(screen.getByText(/up from 6/)).toBeInTheDocument();
    expect(hasTemporalLanguage(container.textContent ?? '', 'verdict')).toBe(false);
  });
  it('never renders a MetricRing (D3 / Reversal 3)', () => {
    const { container } = render(<IssueVerdictHeadline verdict={verdict} topRec={null} />);
    expect(container.querySelector('[data-metric-ring]')).toBeNull();
  });
  it('thin state: baseline null → establishing copy, no fabricated delta', () => {
    render(<IssueVerdictHeadline verdict={{ ...verdict, baselineDeltaCount: null,
      baseline: { ...verdict.baseline, baselineConversions: null, state: 'establishing' } }} topRec={null} />);
    expect(screen.getByText(/establishing your baseline/i)).toBeInTheDocument();
    expect(screen.queryByText(/up from/)).not.toBeInTheDocument();
  });
  it('null verdict → honest no-number degradation', () => {
    render(<IssueVerdictHeadline verdict={null} topRec={null} />);
    expect(screen.queryByText(/~\$/)).not.toBeInTheDocument();
    expect(screen.getByText(/appears here as outcomes land/i)).toBeInTheDocument();
  });
  it('KEEPS the opt-in why-bars when topRec carries an opportunity breakdown', () => {
    const topRec = { id: 'r1', title: 'Publish KPI guide',
      opportunity: { components: [{ dimension: 'demand', contribution: 0.7, evidence: '900 searches/mo' }] },
    } as unknown as Recommendation;
    render(<IssueVerdictHeadline verdict={verdict} topRec={topRec} />);
    fireEvent.click(screen.getByRole('button', { name: /why this is the move/i }));
    expect(screen.getByText('Publish KPI guide')).toBeInTheDocument();
  });

  // ── P1a: measured_action provenance ─────────────────────────────────────────
  const measured: NonNullable<ROIData['outcomeVerdict']> = { ...verdict, provenance: 'measured_action' };

  it('measured_action → BANDED dollar (~$, value = exact count × estimated rate) + measured disclosure', () => {
    // Dollar-overclaim fix: the COUNT graduates to measured, but the DOLLAR stays banded (~$) because
    // value = count × an estimated lead rate. Exact dollars arrive only at P3 actual_reconciled.
    render(<IssueVerdictHeadline verdict={measured} topRec={null} />);
    expect(screen.getByText(/~\$11,000/)).toBeInTheDocument();
    expect(screen.queryByText(/\$11,234/)).not.toBeInTheDocument();
    expect(screen.getByText(/measured from real actions/i)).toBeInTheDocument();
    // Measured framing, NOT estimate framing — but the dollar itself is honestly approximate.
    expect(screen.queryByText(/this is an estimate/i)).not.toBeInTheDocument();
  });
  it('estimate_ga4 stays banded ~ + estimate disclosure (byte-identical to P0)', () => {
    render(<IssueVerdictHeadline verdict={verdict} topRec={null} />);
    expect(screen.getByText(/~\$11,000/)).toBeInTheDocument();
    expect(screen.getByText(/this is an estimate/i)).toBeInTheDocument();
  });
  it('measured branch passes the verdict-zone evergreen guard (no temporal language)', () => {
    const { container } = render(<IssueVerdictHeadline verdict={measured} topRec={null} />);
    expect(hasTemporalLanguage(container.textContent ?? '', 'verdict')).toBe(false);
  });
});
