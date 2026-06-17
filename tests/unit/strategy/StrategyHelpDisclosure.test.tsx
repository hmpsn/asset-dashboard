import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrategyHelpDisclosure } from '../../../src/components/strategy/StrategyHelpDisclosure';

describe('StrategyHelpDisclosure (Phase 4c)', () => {
  it('is collapsed by default — the glossary/how-it-works content is hidden', () => {
    render(<StrategyHelpDisclosure hasAnyRanking />);
    expect(screen.getByText(/How it works & metric glossary/)).toBeInTheDocument();
    expect(screen.queryByText('Metric glossary')).not.toBeInTheDocument();
    expect(screen.queryByText(/How it works:/)).not.toBeInTheDocument();
  });

  it('expands to show the how-it-works prose and the metric glossary', () => {
    render(<StrategyHelpDisclosure hasAnyRanking />);
    fireEvent.click(screen.getByText(/How it works & metric glossary/));
    expect(screen.getByText('Metric glossary')).toBeInTheDocument();
    expect(screen.getByText(/How it works:/)).toBeInTheDocument();
    // a glossary term
    expect(screen.getByText('KD %')).toBeInTheDocument();
  });

  it('does NOT contain the stale "Rank Tracker" reference (retired feature)', () => {
    render(<StrategyHelpDisclosure hasAnyRanking />);
    fireEvent.click(screen.getByText(/How it works & metric glossary/));
    expect(screen.queryByText(/Rank Tracker/)).not.toBeInTheDocument();
  });
});
