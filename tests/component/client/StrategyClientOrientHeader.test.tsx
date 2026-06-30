// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrategyClientOrientHeader } from '../../../src/components/client/strategy/StrategyClientOrientHeader';
import type { OrientMetrics } from '../../../shared/types/keyword-strategy-ux';

function orient(over: Partial<OrientMetrics> = {}): OrientMetrics {
  return {
    visibilityScore: 85, visibilityScoreDelta: 6,
    clicks: 1200, clicksDelta: 100, impressions: 50000, impressionsDelta: 2000,
    rankedKeywords: 80, rankedKeywordsDelta: 4, avgPosition: 8.4, avgPositionDelta: -1.2,
    ...over,
  };
}

describe('StrategyClientOrientHeader', () => {
  it('renders nothing when there are no orient metrics', () => {
    const { container } = render(<StrategyClientOrientHeader orient={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the plain-language visibility verdict + stat strip', () => {
    render(<StrategyClientOrientHeader orient={orient()} />);
    expect(screen.getByText('Search visibility')).toBeInTheDocument();
    expect(screen.getByText(/Your search visibility is strong/)).toBeInTheDocument();
    expect(screen.getByText('Clicks')).toBeInTheDocument();
    expect(screen.getByText('Ranked keywords')).toBeInTheDocument();
  });

  it('shows a dash for avg position when nothing ranks yet', () => {
    render(<StrategyClientOrientHeader orient={orient({ rankedKeywords: 0, avgPosition: 0 })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
