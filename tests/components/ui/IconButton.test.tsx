import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { X } from 'lucide-react';
import { IconButton } from '../../../src/components/ui/IconButton';

describe('IconButton', () => {
  it('renders with required label as aria-label', () => {
    render(<IconButton icon={X} label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it.each(['sm', 'md', 'lg'] as const)('applies %s size dimensions', (size) => {
    render(<IconButton icon={X} label="Close" size={size} />);
    const btn = screen.getByRole('button');
    const expected: Record<string, string> = { sm: 'w-6', md: 'w-8', lg: 'w-10' };
    expect(btn.className).toContain(expected[size]);
  });

  it.each(['ghost', 'solid'] as const)('applies %s variant', (variant) => {
    render(<IconButton icon={X} label="Close" variant={variant} />);
    const btn = screen.getByRole('button');
    if (variant === 'ghost') expect(btn.className).toContain('bg-transparent');
    else expect(btn.className).toContain('bg-zinc-800');
  });

  it('fires onClick', () => {
    const fn = vi.fn();
    render(<IconButton icon={X} label="Close" onClick={fn} />);
    fireEvent.click(screen.getByRole('button'));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('disabled prevents onClick + dims', () => {
    const fn = vi.fn();
    render(<IconButton icon={X} label="Close" onClick={fn} disabled />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('opacity-50');
    fireEvent.click(btn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('appends className', () => {
    render(<IconButton icon={X} label="Close" className="custom-x" />);
    expect(screen.getByRole('button').className).toContain('custom-x');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<IconButton icon={X} label="Close" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
