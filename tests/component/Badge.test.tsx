import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CheckCircle2 } from 'lucide-react';
import { Badge } from '../../src/components/ui/Badge';

describe('Badge', () => {
  it('renders label text', () => {
    render(<Badge label="New" />);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('uses zinc color by default', () => {
    const { container } = render(<Badge label="Default" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-zinc-800');
    expect(span.className).toContain('text-zinc-500');
  });

  it('applies specified color classes', () => {
    const { container } = render(<Badge label="Hot" color="red" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-red-500/8');
    expect(span.className).toContain('text-red-400/80');
  });

  it('applies each supported color correctly', () => {
    const colors = ['teal', 'blue', 'emerald', 'amber', 'red', 'orange', 'zinc'] as const;
    for (const color of colors) {
      const { container, unmount } = render(<Badge label={color} color={color} />);
      const span = container.querySelector('span')!;
      expect(span.className).toContain(`text-${color}-`);
      unmount();
    }
  });

  it('prefers tone over the compatibility color alias', () => {
    const { container } = render(<Badge label="Action" color="red" tone="teal" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('text-teal-400');
    expect(span.className).not.toContain('text-red-400');
  });

  it('renders outline, solid, size, and shape variants', () => {
    const { container, rerender } = render(<Badge label="Outline" tone="blue" variant="outline" shape="pill" />);
    let span = container.querySelector('span')!;
    expect(span.className).toContain('border-blue-500/25');
    expect(span.className).toContain('rounded-[var(--radius-pill)]');

    rerender(<Badge label="Solid" tone="emerald" variant="solid" size="md" />);
    span = container.querySelector('span')!;
    expect(span.className).toContain('bg-emerald-600');
    expect(span.className).toContain('t-caption');
  });

  it('renders an optional icon and dot', () => {
    const { container } = render(<Badge label="Done" tone="emerald" icon={CheckCircle2} dot />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.bg-emerald-400\\/80')).not.toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(<Badge label="Tag" className="mt-2" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('mt-2');
  });

  it('renders as a span element', () => {
    const { container } = render(<Badge label="Span" />);
    expect(container.querySelector('span')).not.toBeNull();
  });
});
