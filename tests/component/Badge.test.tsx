import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(span.className).toContain('bg-red-500/10');
    expect(span.className).toContain('text-red-400');
  });

  it('applies each supported color correctly', () => {
    const colors = ['teal', 'blue', 'emerald', 'green', 'amber', 'red', 'orange', 'purple', 'zinc'] as const;
    for (const color of colors) {
      const { container, unmount } = render(<Badge label={color} color={color} />);
      const span = container.querySelector('span')!;
      expect(span.className).toContain(`text-${color}-`);
      unmount();
    }
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
