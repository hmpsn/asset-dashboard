import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PredictionShowcaseCard } from '../../../src/components/client/PredictionShowcaseCard';
import type { WeCalledItEntry } from '../../../shared/types/intelligence';

const prediction: WeCalledItEntry = {
  actionId: 'action-1',
  prediction: 'refreshing the service page would increase qualified search clicks',
  outcome: 'Clicks grew from 100 to 175 after the page refresh.',
  score: 'strong_win',
  pageUrl: '/services',
  measuredAt: '2026-05-20T00:00:00.000Z',
};

describe('PredictionShowcaseCard', () => {
  it('renders a before and after story using only recorded prediction fields', () => {
    render(<PredictionShowcaseCard predictions={[prediction]} />);

    expect(screen.getByText('Predictions That Came True')).toBeInTheDocument();
    expect(screen.getByText('Strong Win')).toBeInTheDocument();
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
    expect(screen.getByText(/We predicted refreshing the service page/i)).toBeInTheDocument();
    expect(screen.getByText('Clicks grew from 100 to 175 after the page refresh.')).toBeInTheDocument();
    expect(screen.getAllByText('/services')).toHaveLength(2);
    expect(screen.getByText((_, element) => element?.textContent === 'Confirmed May 20, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/undefined|null/i)).not.toBeInTheDocument();
  });

  it('does not print enum-like outcome payloads as client copy', () => {
    render(<PredictionShowcaseCard predictions={[{ ...prediction, outcome: 'strong_win' }]} />);

    expect(screen.getByText('Strong Win confirmed for this recommendation.')).toBeInTheDocument();
    expect(screen.queryByText('strong_win')).not.toBeInTheDocument();
  });

  it('renders the existing empty state when there are no predictions', () => {
    render(<PredictionShowcaseCard predictions={[]} />);

    expect(screen.getByText('Building your prediction track record')).toBeInTheDocument();
    expect(screen.getByText(/strategy recommendations play out/i)).toBeInTheDocument();
  });
});
