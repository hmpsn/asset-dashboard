import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StrategyKeywordFeedbackSummaryCard } from '../../../src/components/client/strategy/StrategyKeywordFeedbackSummaryCard';
import type { ClientKeywordFeedbackSummary } from '../../../shared/types/intelligence';

function makeSummary(overrides: Partial<ClientKeywordFeedbackSummary> = {}): ClientKeywordFeedbackSummary {
  return {
    approvedCount: 3,
    rejectedCount: 1,
    approveRate: 0.75,
    approvedSamples: ['seo consulting', 'technical seo audit'],
    rejectedSamples: ['cheap backlinks'],
    rejectionReasons: ['Off-brand'],
    ...overrides,
  };
}

describe('StrategyKeywordFeedbackSummaryCard', () => {
  it('renders approve-rate, counts, samples, and rejection reasons', () => {
    render(<StrategyKeywordFeedbackSummaryCard summary={makeSummary()} />);

    expect(screen.getByText('Keyword Feedback')).toBeInTheDocument();
    expect(screen.getByText(/You approved/i)).toHaveTextContent('You approved 75% of keyword suggestions.');
    expect(screen.getByText(/3 keywords marked relevant/i)).toBeInTheDocument();
    expect(screen.getByText('seo consulting')).toBeInTheDocument();
    expect(screen.getByText('technical seo audit')).toBeInTheDocument();
    expect(screen.getByText('cheap backlinks')).toBeInTheDocument();
    expect(screen.getByText('Common reason: Off-brand')).toBeInTheDocument();

    const progress = screen.getByRole('progressbar', { name: /keyword suggestion approval rate/i });
    expect(progress).toHaveAttribute('aria-valuenow', '75');
  });

  it('does not render when there is no feedback to summarize', () => {
    const { container } = render(
      <StrategyKeywordFeedbackSummaryCard
        summary={makeSummary({
          approvedCount: 0,
          rejectedCount: 0,
          approveRate: 0,
          approvedSamples: [],
          rejectedSamples: [],
          rejectionReasons: [],
        })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('clamps invalid approve rates before display', () => {
    render(<StrategyKeywordFeedbackSummaryCard summary={makeSummary({ approveRate: 1.4 })} />);

    expect(screen.getByText(/You approved/i)).toHaveTextContent('You approved 100% of keyword suggestions.');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});
