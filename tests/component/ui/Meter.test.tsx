import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Meter } from '../../../src/components/ui/Meter';
import { expectNoA11yViolations } from '../a11y';

describe('Meter', () => {
  it('exposes correct aria-valuenow/min/max', () => {
    render(<Meter value={40} max={100} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '40');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps a value above max to max (fill width 100%)', () => {
    render(<Meter value={150} max={100} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('clamps a value below 0 to 0', () => {
    render(<Meter value={-20} max={100} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Meter value={40} max={100} label="Storage used" showValue />);
    await expectNoA11yViolations(container);
  }, 15_000);
});
