import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Check } from 'lucide-react';
import { ActionPill } from '../../../src/components/ui/ActionPill';

describe('ActionPill', () => {
  it('renders children', () => {
    render(<ActionPill variant="approve">Approve</ActionPill>);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  const cases = [
    ['start', 'var(--teal)'],
    ['approve', 'var(--emerald)'],
    ['decline', 'var(--red)'],
    ['send', 'var(--blue)'],
    ['request-changes', 'var(--amber)'],
  ] as const;

  it.each(cases)('%s variant uses %s styleguide token', (variant, token) => {
    render(<ActionPill variant={variant}>X</ActionPill>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain(token);
  });

  it('renders optional icon', () => {
    render(
      <ActionPill variant="approve" icon={Check}>
        Approve
      </ActionPill>,
    );
    expect(screen.getByRole('button').querySelector('svg')).toBeTruthy();
  });

  it('fires onClick', () => {
    const fn = vi.fn();
    render(
      <ActionPill variant="approve" onClick={fn}>
        X
      </ActionPill>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('disabled prevents onClick', () => {
    const fn = vi.fn();
    render(
      <ActionPill variant="decline" disabled onClick={fn}>
        X
      </ActionPill>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('appends className', () => {
    render(
      <ActionPill variant="approve" className="custom-pill">
        X
      </ActionPill>,
    );
    expect(screen.getByRole('button').className).toContain('custom-pill');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <ActionPill variant="approve" ref={ref}>
        X
      </ActionPill>,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
