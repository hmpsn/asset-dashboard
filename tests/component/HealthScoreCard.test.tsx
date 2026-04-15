/**
 * Component test: HealthScoreCard
 *
 * Same rounding regression guard as WorkspaceHealthBadge — compositeHealthScore
 * is a weighted float. The card must display Math.round(score) in both the
 * large score span and the MetricRing, never the raw decimal.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthScoreCard } from '../../src/components/client/HealthScoreCard';

describe('HealthScoreCard', () => {
  it('rounds a decimal score to the nearest integer', () => {
    render(<HealthScoreCard score={73.5} />);
    // span shows rounded value
    const all = screen.getAllByText('74');
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('73.5')).toBeNull();
  });

  it('rounds down correctly', () => {
    render(<HealthScoreCard score={72.4} />);
    const all = screen.getAllByText('72');
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('72.4')).toBeNull();
  });

  it('shows the correct label for score >= 80', () => {
    render(<HealthScoreCard score={80} />);
    expect(screen.getByText(/performing well/i)).toBeInTheDocument();
  });

  it('shows the correct label for score 60-79', () => {
    render(<HealthScoreCard score={65.8} />);
    expect(screen.getByText(/room for improvement/i)).toBeInTheDocument();
  });

  it('shows the correct label for score < 60', () => {
    render(<HealthScoreCard score={45.2} />);
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  });

  it('renders nothing when score is null', () => {
    const { container } = render(<HealthScoreCard score={null} />);
    expect(container.firstChild).toBeNull();
  });
});
