import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricTile } from '../../../src/components/ui/MetricTile';

describe('MetricTile', () => {
  it('renders label and value', () => {
    render(<MetricTile label="Sessions" value="1,204" />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('1,204')).toBeInTheDocument();
  });

  it('shows an up-trend indicator for a positive delta', () => {
    const { container } = render(<MetricTile label="Clicks" value={100} delta={12} />);
    expect(container.querySelector('svg.lucide-trending-up')).toBeInTheDocument();
  });

  it('shows a down-trend indicator for a negative delta', () => {
    const { container } = render(<MetricTile label="Clicks" value={100} delta={-8} />);
    expect(container.querySelector('svg.lucide-trending-down')).toBeInTheDocument();
  });

  it('renders a neutral indicator (not up/down) for a zero delta', () => {
    const { container } = render(<MetricTile label="Clicks" value={100} delta={0} />);
    expect(container.querySelector('svg.lucide-trending-up')).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-trending-down')).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-minus')).toBeInTheDocument();
  });
});
