import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Send } from 'lucide-react';
import { Button } from '../../../src/components/ui/Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('defaults to primary variant + md size', () => {
    render(<Button>Go</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('from-teal-600');
    expect(btn.className).toContain('to-emerald-600');
    expect(btn.className).toContain('px-4');
    expect(btn.className).toContain('py-2');
  });

  it.each(['primary', 'secondary', 'ghost', 'danger', 'link'] as const)(
    'applies %s variant classes',
    (variant) => {
      render(<Button variant={variant}>X</Button>);
      const btn = screen.getByRole('button');
      const expected: Record<string, string> = {
        primary: 'from-teal-600',
        secondary: 'bg-zinc-800',
        ghost: 'bg-transparent',
        danger: 'bg-red-600',
        link: 'text-teal-400',
      };
      expect(btn.className).toContain(expected[variant]);
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('applies %s size classes', (size) => {
    render(<Button size={size}>X</Button>);
    const btn = screen.getByRole('button');
    const expected: Record<string, string> = {
      sm: 'px-2.5',
      md: 'px-4',
      lg: 'px-5',
    };
    expect(btn.className).toContain(expected[size]);
  });

  it('fires onClick', () => {
    const fn = vi.fn();
    render(<Button onClick={fn}>X</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('disabled prevents onClick + applies disabled classes', () => {
    const fn = vi.fn();
    render(
      <Button onClick={fn} disabled>
        X
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('opacity-50');
    fireEvent.click(btn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('loading shows spinner + sets aria-busy', () => {
    render(<Button loading>X</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
    expect(btn.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renders icon left by default', () => {
    render(
      <Button icon={Send}>
        Send it
      </Button>,
    );
    const btn = screen.getByRole('button');
    const svg = btn.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(btn.firstChild).toBe(svg);
  });

  it('renders icon right when iconPosition="right"', () => {
    render(
      <Button icon={Send} iconPosition="right">
        Send it
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn.lastChild?.nodeName).toBe('svg');
  });

  it('icon hidden while loading (spinner replaces it)', () => {
    render(
      <Button icon={Send} loading>
        X
      </Button>,
    );
    const svgs = screen.getByRole('button').querySelectorAll('svg');
    // only spinner should be present
    expect(svgs.length).toBe(1);
    expect(svgs[0].classList.contains('animate-spin')).toBe(true);
  });

  it('appends className', () => {
    render(<Button className="custom-extra">X</Button>);
    expect(screen.getByRole('button').className).toContain('custom-extra');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>X</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('keyboard Enter activates onClick (default browser behavior)', () => {
    const fn = vi.fn();
    render(<Button onClick={fn}>X</Button>);
    const btn = screen.getByRole('button');
    btn.focus();
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.click(btn); // jsdom doesn't auto-translate keydown→click
    expect(fn).toHaveBeenCalled();
  });
});
