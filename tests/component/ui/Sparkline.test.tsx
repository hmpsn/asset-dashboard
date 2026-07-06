import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from '../../../src/components/ui/Sparkline';
import { expectNoA11yViolations } from '../a11y';

describe('Sparkline', () => {
  it('renders a polyline for a multi-point series', () => {
    const { container } = render(<Sparkline data={[1, 5, 2, 8, 4]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeInTheDocument();
    expect(polyline?.getAttribute('points')).not.toContain('NaN');
  });

  it('renders safely with no NaN for an empty series', () => {
    const { container } = render(<Sparkline data={[]} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(container.querySelector('polyline')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders safely for a single-point series', () => {
    const { container } = render(<Sparkline data={[5]} />);
    const line = container.querySelector('line');
    expect(line).toBeInTheDocument();
    expect(line?.getAttribute('x1')).not.toBe('NaN');
    expect(line?.getAttribute('y1')).not.toBe('NaN');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Sparkline data={[1, 5, 2, 8, 4]} label="Weekly clicks trend" />);
    await expectNoA11yViolations(container);
  }, 15_000);
});
