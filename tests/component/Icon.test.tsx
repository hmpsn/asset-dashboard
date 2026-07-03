import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Search } from 'lucide-react';
import { Icon } from '../../src/components/ui/Icon';
import { ICON_NAMES } from '../../src/components/ui/iconNames';

describe('Icon', () => {
  it('renders a Font Awesome Sharp Regular glyph from a semantic name', () => {
    const { container } = render(<Icon name="search" size="lg" />);
    const i = container.querySelector('i');
    expect(i).not.toBeNull();
    // search → magnifying-glass per ICON_NAMES
    expect(ICON_NAMES.search).toBe('magnifying-glass');
    expect(i!.className).toContain('fa-sharp');
    expect(i!.className).toContain('fa-regular');
    expect(i!.className).toContain('fa-magnifying-glass');
    expect(i!.getAttribute('aria-hidden')).toBe('true');
  });

  it('passes an unknown name through as the literal fa- glyph', () => {
    const { container } = render(<Icon name="rocket-launch" />);
    expect(container.querySelector('i')!.className).toContain('fa-rocket-launch');
  });

  it('renders raw fa classes when `fa` is given (overrides name)', () => {
    const { container } = render(<Icon fa="fa-sharp fa-solid fa-star" name="home" />);
    const cls = container.querySelector('i')!.className;
    expect(cls).toContain('fa-solid');
    expect(cls).toContain('fa-star');
    expect(cls).not.toContain('fa-house');
  });

  it('still renders a lucide component via `as` (migration path)', () => {
    const { container } = render(<Icon as={Search} size="md" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('i')).toBeNull();
  });

  it('exposes role="img" + the label when aria-label is passed (semantic icon)', () => {
    const { getByRole } = render(<Icon name="alert" aria-label="Warning" />);
    expect(getByRole('img', { name: 'Warning' })).toBeInTheDocument();
  });

  it('renders an empty sized span when no name/fa/as is given (never throws)', () => {
    const { container } = render(<Icon />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.tagName).toBe('SPAN');
    expect(span.querySelector('i')).toBeNull();
    expect(span.querySelector('svg')).toBeNull();
  });
});
