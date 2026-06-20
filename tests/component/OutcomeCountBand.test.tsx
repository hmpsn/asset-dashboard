import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IssueOutcomeCount } from '../../shared/types/the-issue';
import { OutcomeCountBand } from '../../src/components/client/the-issue/OutcomeCountBand';

const count: IssueOutcomeCount = {
  units: [
    { label: 'calls', current: 9, baseline: 4, priorPeriod: 7, eventName: 'phone_call' },
    { label: 'form fills', current: 5, baseline: 2, priorPeriod: 6, eventName: 'generate_lead' },
  ],
  byType: [],
  provenance: 'estimate_ga4', namedRecordsAvailable: false,
};

// P1a: typed, measured outcome breakdown ("23 form fills · 41 calls").
const typedCount: IssueOutcomeCount = {
  units: [
    { label: 'form fills', current: 23, baseline: 10, priorPeriod: 18, eventName: 'form_submit', outcomeType: 'form_fill' },
    { label: 'calls', current: 41, baseline: 22, priorPeriod: 39, eventName: 'phone_call', outcomeType: 'call' },
  ],
  byType: [
    { outcomeType: 'form_fill', label: 'form fills', current: 23, baseline: 10, priorPeriod: 18 },
    { outcomeType: 'call', label: 'calls', current: 41, baseline: 22, priorPeriod: 39 },
  ],
  provenance: 'measured_action', namedRecordsAvailable: false,
};

describe('OutcomeCountBand', () => {
  it('renders one hero stat per pinned-event unit with the current count', () => {
    render(<OutcomeCountBand count={count} />);
    expect(screen.getByText('calls')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('form fills')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
  it('shows BOTH trends: vs last period AND since we started', () => {
    render(<OutcomeCountBand count={count} />);
    expect(screen.getAllByText(/vs last period/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/since we started/i).length).toBeGreaterThan(0);
  });
  it('shows the honest upsell affordance when named records are unavailable (P0)', () => {
    render(<OutcomeCountBand count={count} />);
    expect(screen.getByText(/names available with call/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view names/i })).not.toBeInTheDocument();
  });
  it('thin state: no units → set-up CTA, never a zero count as an outcome', () => {
    render(<OutcomeCountBand count={{ units: [], byType: [], provenance: 'estimate_ga4', namedRecordsAvailable: false }} />);
    expect(screen.getByText(/no conversion events configured/i)).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });
  it('honest flat period: priorPeriod === current renders "flat vs last period"', () => {
    render(<OutcomeCountBand count={{ units: [{ label: 'calls', current: 7, baseline: 4, priorPeriod: 7 }],
      byType: [], provenance: 'estimate_ga4', namedRecordsAvailable: false }} />);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/flat vs last period/i)).toBeInTheDocument();
  });

  // ── P1a: typed, measured outcome units ──────────────────────────────────────
  it('renders each typed unit with its label, count, and a [data-outcome-type] tag', () => {
    const { container } = render(<OutcomeCountBand count={typedCount} />);
    expect(screen.getByText('form fills')).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.getByText('calls')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(container.querySelector('[data-outcome-type="form_fill"]')).not.toBeNull();
    expect(container.querySelector('[data-outcome-type="call"]')).not.toBeNull();
  });
  it('keeps the honest names affordance for typed measured units (names not yet captured here)', () => {
    render(<OutcomeCountBand count={typedCount} />);
    expect(screen.getByText(/names available with call/i)).toBeInTheDocument();
  });
  it('byte-identical degradation: an untyped estimate unit renders label-only, NO [data-outcome-type]', () => {
    const { container } = render(<OutcomeCountBand count={count} />);
    expect(container.querySelector('[data-outcome-type]')).toBeNull();
    expect(screen.getByText('calls')).toBeInTheDocument();
    expect(screen.getByText('form fills')).toBeInTheDocument();
  });
});
