import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SectionLabel } from '../../src/components/ui/SectionLabel';

describe('SectionLabel', () => {
  it('renders the children text', () => {
    const { getByText } = render(<SectionLabel>Page Performance</SectionLabel>);
    expect(getByText('Page Performance')).toBeInTheDocument();
  });

  it('the element className includes t-label, text-[var(--brand-text-muted)], uppercase, and tracking-wider', () => {
    const { container } = render(<SectionLabel>Organic Traffic</SectionLabel>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('t-label');
    expect(el.className).toContain('text-[var(--brand-text-muted)]');
    expect(el.className).toContain('uppercase');
    expect(el.className).toContain('tracking-wider');
  });

  it('merges custom className', () => {
    const { container } = render(<SectionLabel className="mb-2">Label</SectionLabel>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('mb-2');
  });
});
