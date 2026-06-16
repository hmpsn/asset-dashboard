import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrategyFeedbackNudge } from '../../../src/components/strategy/StrategyFeedbackNudge';

describe('StrategyFeedbackNudge', () => {
  it('renders requested and declined counts', () => {
    render(<StrategyFeedbackNudge requestedCount={2} declinedCount={1} />);
    expect(screen.getByText(/New client feedback since last strategy generation/i)).toBeInTheDocument();
    expect(screen.getByText(/2 requested keywords/i)).toBeInTheDocument();
    expect(screen.getByText(/1 declined keyword/i)).toBeInTheDocument();
  });
});
