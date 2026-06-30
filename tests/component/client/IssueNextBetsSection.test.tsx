/**
 * Component tests for IssueNextBetsSection — the "Your next bets" $-forecast band.
 * Pure prop-driven (no router/hooks); gating-by-data (renders nothing when no rec has a $ band).
 * It is a FORECAST summary — no per-bet greenlight; a single "Review your plan" CTA hands off to
 * the plan where the tier-gated greenlight lives (per adversarial review C1/I1/M1).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IssueNextBetsSection } from '../../../src/components/client/the-issue/IssueNextBetsSection';
import type { Recommendation } from '../../../shared/types/recommendations';

function rec(id: string, title: string, range: [number, number] | undefined, opportunityValue: number): Recommendation {
  return {
    id,
    title,
    impactBand: range ? { band: 'medium', monthlyRangeUsd: range } : { band: 'low' },
    impactScore: 0,
    opportunity: { value: opportunityValue },
  } as unknown as Recommendation;
}

const base = {
  valuePerOutcome: 850,
  outcomeUnitLabel: 'new patient',
  onReviewPlan: vi.fn(),
};

describe('IssueNextBetsSection', () => {
  it('renders the forecast band — title, per-bet rows, combined projection, and a review-plan CTA', () => {
    render(
      <IssueNextBetsSection
        {...base}
        recs={[rec('a', 'Refresh services page', [900, 1700], 90), rec('b', 'New invisalign hub', [400, 800], 50)]}
      />,
    );
    expect(screen.getByText('Your next bets')).toBeInTheDocument();
    expect(screen.getByText('Refresh services page')).toBeInTheDocument();
    expect(screen.getByText('New invisalign hub')).toBeInTheDocument();
    expect(screen.getByText(/from your next 2 moves/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review your plan/i })).toBeInTheDocument();
  });

  it('renders nothing when no rec carries a $ band (all below the display floor)', () => {
    const { container } = render(<IssueNextBetsSection {...base} recs={[rec('a', 'No-$ move', undefined, 90)]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a forecast — no per-bet greenlight; the single CTA hands off to the plan', () => {
    const onReviewPlan = vi.fn();
    render(<IssueNextBetsSection {...base} onReviewPlan={onReviewPlan} recs={[rec('a', 'Move A', [900, 1700], 90)]} />);
    expect(screen.queryByRole('button', { name: /act on this/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /review your plan/i }));
    expect(onReviewPlan).toHaveBeenCalledTimes(1);
  });

  it('surfaces outcome-units when the $ band reaches ≥1 outcome', () => {
    render(<IssueNextBetsSection {...base} recs={[rec('a', 'Move A', [900, 1700], 90)]} />);
    expect(screen.getAllByText(/new patient/i).length).toBeGreaterThan(0); // 1700/850 = 2 → shown
  });

  it('uses an honest "up to N" phrase when the low end rounds to 0 but the high reaches ≥1', () => {
    // $500 low ÷ $850 = 0.6 → floor 0; $1,700 high ÷ $850 = 2 → "up to 2", never overstating the floor as 1.
    render(<IssueNextBetsSection {...base} recs={[rec('a', 'Move A', [500, 1700], 90)]} />);
    expect(screen.getAllByText(/up to 2 new patients/i).length).toBeGreaterThan(0);
  });

  it('omits outcome-units entirely when there is no per-outcome value', () => {
    render(
      <IssueNextBetsSection
        {...base}
        valuePerOutcome={null}
        outcomeUnitLabel={null}
        recs={[rec('a', 'Move A', [900, 1700], 90)]}
      />,
    );
    expect(screen.queryByText(/new patient/i)).not.toBeInTheDocument();
  });
});
