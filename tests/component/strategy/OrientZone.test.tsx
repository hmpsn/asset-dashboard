// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrientZone } from '../../../src/components/strategy/OrientZone';
import type { OrientMetrics } from '../../../shared/types/keyword-strategy-ux';

const orient: OrientMetrics = {
  visibilityScore: 62,
  visibilityScoreDelta: 4,
  clicks: 8400,
  clicksDelta: 900,
  impressions: 210000,
  impressionsDelta: 5000,
  rankedKeywords: 312,
  rankedKeywordsDelta: 18,
  avgPosition: 14.2,
  avgPositionDelta: -0.8,
};

describe('OrientZone', () => {
  it('renders nothing without orient data', () => {
    const { container } = render(<OrientZone orient={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the score, the band verdict, and the 4-stat strip', () => {
    render(<OrientZone orient={orient} />);
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText(/Building visibility/)).toBeInTheDocument();
    expect(screen.getByText('Clicks')).toBeInTheDocument();
    expect(screen.getByText('Impressions')).toBeInTheDocument();
    expect(screen.getByText('Ranked keywords')).toBeInTheDocument();
    expect(screen.getByText('Avg position')).toBeInTheDocument();
    expect(screen.getByText('#14.2')).toBeInTheDocument();
    expect(screen.getByText('improved 0.8')).toBeInTheDocument(); // inverted-metric directional label
  });

  it('shows an em-dash for avg position when nothing ranks', () => {
    render(<OrientZone orient={{ ...orient, rankedKeywords: 0, avgPosition: 0, avgPositionDelta: null }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('uses the low-visibility verdict for a sub-60 score', () => {
    render(<OrientZone orient={{ ...orient, visibilityScore: 45, visibilityScoreDelta: -3 }} />);
    expect(screen.getByText(/Low visibility/)).toBeInTheDocument();
  });

  it('uses the strong-visibility verdict for a score of 80+', () => {
    render(<OrientZone orient={{ ...orient, visibilityScore: 88, visibilityScoreDelta: 2 }} />);
    expect(screen.getByText(/Strong search visibility/)).toBeInTheDocument();
  });
});
