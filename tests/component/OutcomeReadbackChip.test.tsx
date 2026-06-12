import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OutcomeReadbackChip } from '../../src/components/ui/OutcomeReadbackChip';
import type { OutcomeReadback } from '../../shared/types/outcome-tracking';

function makeOutcome(over: Partial<OutcomeReadback>): OutcomeReadback {
  return {
    actionId: 'a1',
    actionType: 'strategy_keyword_added',
    score: 'win',
    checkpointDays: 30,
    primaryMetric: 'position',
    direction: 'improved',
    baselineValue: 14,
    currentValue: 6,
    baselinePosition: 14,
    currentPosition: 6,
    baselineClicks: null,
    currentClicks: null,
    measuredAt: new Date().toISOString(),
    ...over,
  };
}

describe('OutcomeReadbackChip', () => {
  it('renders a position improvement as "#14 → #6" with the verdict and timeframe', () => {
    render(<OutcomeReadbackChip outcome={makeOutcome({})} />);
    const chip = screen.getByText(/#14 → #6 · Win · 30d/);
    expect(chip).toBeInTheDocument();
  });

  it('uses emerald tone for an improved direction', () => {
    const { container } = render(<OutcomeReadbackChip outcome={makeOutcome({ direction: 'improved' })} />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('emerald');
  });

  it('uses red tone for a declined direction', () => {
    const { container } = render(
      <OutcomeReadbackChip outcome={makeOutcome({ direction: 'declined', score: 'loss' })} />,
    );
    const span = container.querySelector('span')!;
    expect(span.className).toContain('red');
  });

  it('renders a clicks delta when position is absent', () => {
    render(
      <OutcomeReadbackChip
        outcome={makeOutcome({
          primaryMetric: 'clicks',
          baselinePosition: null,
          currentPosition: null,
          baselineClicks: 3,
          currentClicks: 25,
          checkpointDays: 90,
        })}
      />,
    );
    expect(screen.getByText(/3 → 25 clicks · Win · 90d/)).toBeInTheDocument();
  });

  it('hides the timeframe when showTimeframe is false', () => {
    render(<OutcomeReadbackChip outcome={makeOutcome({})} showTimeframe={false} />);
    expect(screen.getByText('#14 → #6 · Win')).toBeInTheDocument();
  });
});
