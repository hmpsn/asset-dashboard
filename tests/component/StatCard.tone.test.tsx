import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatCard } from '../../src/components/ui/StatCard';

describe('StatCard tone prop', () => {
  it('renders with no tone — root element className does NOT contain bg-gradient-to-br', () => {
    const { container } = render(<StatCard label="Clicks" value={42} />);
    expect((container.firstChild as HTMLElement).className).not.toContain('bg-gradient-to-br');
  });

  it('renders with tone="neutral" — root element className does NOT contain bg-gradient-to-br', () => {
    const { container } = render(<StatCard label="Clicks" value={42} tone="neutral" />);
    expect((container.firstChild as HTMLElement).className).not.toContain('bg-gradient-to-br');
  });

  it('renders with tone="emerald" — root element className contains from-emerald-500/8 and border-emerald-500/20', () => {
    const { container } = render(<StatCard label="Score" value={80} tone="emerald" />);
    const className = (container.firstChild as HTMLElement).className;
    expect(className).toContain('from-emerald-500/8');
    expect(className).toContain('border-emerald-500/20');
  });

  it('renders with tone="blue" — root element className contains from-blue-500/8', () => {
    const { container } = render(<StatCard label="Sessions" value={1200} tone="blue" />);
    const className = (container.firstChild as HTMLElement).className;
    expect(className).toContain('from-blue-500/8');
  });
});
