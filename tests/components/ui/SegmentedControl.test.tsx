import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from '../../../src/components/ui/SegmentedControl';

const OPTS = [
  { id: 'one', label: 'One' },
  { id: 'two', label: 'Two' },
  { id: 'three', label: 'Three' },
];

describe('SegmentedControl', () => {
  it('renders all options as radio buttons', () => {
    render(<SegmentedControl options={OPTS} value="one" onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
  });

  it('marks active option with aria-checked=true', () => {
    render(<SegmentedControl options={OPTS} value="two" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Two' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'One' })).toHaveAttribute('aria-checked', 'false');
  });

  it('fires onChange on click', () => {
    const fn = vi.fn();
    render(<SegmentedControl options={OPTS} value="one" onChange={fn} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Three' }));
    expect(fn).toHaveBeenCalledWith('three');
  });

  it('ArrowRight moves selection forward', () => {
    const fn = vi.fn();
    render(<SegmentedControl options={OPTS} value="one" onChange={fn} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'One' }), { key: 'ArrowRight' });
    expect(fn).toHaveBeenCalledWith('two');
  });

  it('ArrowLeft wraps to last', () => {
    const fn = vi.fn();
    render(<SegmentedControl options={OPTS} value="one" onChange={fn} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'One' }), { key: 'ArrowLeft' });
    expect(fn).toHaveBeenCalledWith('three');
  });

  it('skips disabled options when navigating', () => {
    const opts = [
      { id: 'one', label: 'One' },
      { id: 'two', label: 'Two', disabled: true },
      { id: 'three', label: 'Three' },
    ];
    const fn = vi.fn();
    render(<SegmentedControl options={opts} value="one" onChange={fn} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'One' }), { key: 'ArrowRight' });
    expect(fn).toHaveBeenCalledWith('three');
  });

  it.each(['sm', 'md'] as const)('%s size applies correct padding', (size) => {
    render(<SegmentedControl options={OPTS} value="one" onChange={() => {}} size={size} />);
    const btn = screen.getByRole('radio', { name: 'One' });
    if (size === 'sm') expect(btn.className).toContain('px-2');
    else expect(btn.className).toContain('px-3');
  });

  it('applies optional aria-label to group', () => {
    render(
      <SegmentedControl options={OPTS} value="one" onChange={() => {}} label="View mode" />,
    );
    expect(screen.getByRole('radiogroup', { name: 'View mode' })).toBeInTheDocument();
  });

  it('appends className to group', () => {
    render(
      <SegmentedControl options={OPTS} value="one" onChange={() => {}} className="custom-sc" />,
    );
    expect(screen.getByRole('radiogroup').className).toContain('custom-sc');
  });

  it('forwards ref to group', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<SegmentedControl options={OPTS} value="one" onChange={() => {}} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
