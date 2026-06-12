/**
 * Component test: HealthScoreCard
 *
 * Same rounding regression guard as WorkspaceHealthBadge — compositeHealthScore
 * is a weighted float. The card must display Math.round(score) in both the
 * large score span and the MetricRing, never the raw decimal.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HealthScoreCard } from '../../src/components/client/HealthScoreCard';
import type { ClientCompositeHealthBreakdown } from '../../shared/types/intelligence';

const breakdown: ClientCompositeHealthBreakdown = {
  rows: [
    {
      id: 'retention',
      label: 'Retention signals',
      score: 60,
      weight: 40,
      description: 'Recent relationship signals are mostly steady, with one area to strengthen.',
    },
    {
      id: 'roi',
      label: 'ROI momentum',
      score: 70,
      weight: 30,
      description: 'Organic value is trending up compared with the prior period.',
    },
    {
      id: 'engagement',
      label: 'Portal engagement',
      score: 100,
      weight: 30,
      description: 'Recent portal activity is strong.',
    },
  ],
};

function renderCard(score: number | null, componentBreakdown?: ClientCompositeHealthBreakdown | null) {
  return render(
    <MemoryRouter>
      <HealthScoreCard score={score} workspaceId="ws-test" breakdown={componentBreakdown} />
    </MemoryRouter>,
  );
}

describe('HealthScoreCard', () => {
  it('rounds a decimal score to the nearest integer', () => {
    renderCard(73.5);
    // span shows rounded value
    const all = screen.getAllByText('74');
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('73.5')).toBeNull();
  });

  it('rounds down correctly', () => {
    renderCard(72.4);
    const all = screen.getAllByText('72');
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('72.4')).toBeNull();
  });

  it('shows the correct label for score >= 80', () => {
    renderCard(80);
    expect(screen.getByText(/performing well/i)).toBeInTheDocument();
  });

  it('shows the correct label for score 60-79', () => {
    renderCard(65.8);
    expect(screen.getByText(/room for improvement/i)).toBeInTheDocument();
  });

  it('shows the correct label for score < 60', () => {
    renderCard(45.2);
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  });

  it('uses rounded score for label threshold — 59.5 rounds to 60 and shows "room for improvement"', () => {
    renderCard(59.5);
    // Displayed score should be 60
    const all = screen.getAllByText('60');
    expect(all.length).toBeGreaterThanOrEqual(1);
    // Label must match the "60" tier, not "below 60"
    expect(screen.getByText(/room for improvement/i)).toBeInTheDocument();
    expect(screen.queryByText(/needs attention/i)).toBeNull();
  });

  it('renders nothing when score is null', () => {
    const { container } = renderCard(null);
    expect(container.firstChild).toBeNull();
  });

  it('renders an expandable client-safe component breakdown', () => {
    renderCard(77, breakdown);

    const summary = screen.getByText('What makes up this score');
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');

    fireEvent.click(summary);
    expect(details).toHaveAttribute('open');

    expect(screen.getByText('Retention signals')).toBeInTheDocument();
    expect(screen.getByText('ROI momentum')).toBeInTheDocument();
    expect(screen.getByText('Portal engagement')).toBeInTheDocument();
    expect(screen.getByText('40% weight')).toBeInTheDocument();
    expect(screen.getAllByText('30% weight')).toHaveLength(2);
    const breakdownText = details?.textContent ?? '';
    expect(breakdownText).not.toMatch(/churn|client-health warning|critical|warning|\bhigh\b|\bmedium\b|\blow\b/i);
  });
});
