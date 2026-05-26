/**
 * Component test: HealthScoreCard
 *
 * Same rounding regression guard as WorkspaceHealthBadge — compositeHealthScore
 * is a weighted float. The card must display Math.round(score) in both the
 * large score span and the MetricRing, never the raw decimal.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HealthScoreCard } from '../../src/components/client/HealthScoreCard';

function renderCard(score: number | null) {
  return render(
    <MemoryRouter>
      <HealthScoreCard score={score} workspaceId="ws-test" />
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
});
