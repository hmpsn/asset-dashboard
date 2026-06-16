import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrategyHowItWorks } from '../../../src/components/strategy/StrategyHowItWorks';

describe('StrategyHowItWorks', () => {
  it('renders How it works heading', () => {
    render(<StrategyHowItWorks displayedSeoDataMode="none" hasAnyRanking={true} />);
    expect(screen.getByText(/How it works:/i)).toBeInTheDocument();
  });

  it('renders the DataForSEO line when displayedSeoDataMode is not none', () => {
    render(<StrategyHowItWorks displayedSeoDataMode="full" hasAnyRanking={true} />);
    expect(screen.getByText(/DataForSEO data:/i)).toBeInTheDocument();
  });

  it('does not render the DataForSEO line when displayedSeoDataMode is none', () => {
    render(<StrategyHowItWorks displayedSeoDataMode="none" hasAnyRanking={true} />);
    expect(screen.queryByText(/DataForSEO data:/i)).not.toBeInTheDocument();
  });

  it('does not render the DataForSEO line when displayedSeoDataMode is undefined', () => {
    render(<StrategyHowItWorks hasAnyRanking={true} />);
    expect(screen.queryByText(/DataForSEO data:/i)).not.toBeInTheDocument();
  });

  it('renders the GSC connect tip when hasAnyRanking is false', () => {
    render(<StrategyHowItWorks displayedSeoDataMode="none" hasAnyRanking={false} />);
    expect(screen.getByText(/Connect Google Search Console/i)).toBeInTheDocument();
  });

  it('does not render the GSC connect tip when hasAnyRanking is true', () => {
    render(<StrategyHowItWorks displayedSeoDataMode="none" hasAnyRanking={true} />);
    expect(screen.queryByText(/Connect Google Search Console/i)).not.toBeInTheDocument();
  });
});
