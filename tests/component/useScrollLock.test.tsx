/**
 * useScrollLock — background scroll lock for modal/drawer surfaces.
 *
 * Covers both shells: the client portal scrolls <body>, while the admin shell
 * scrolls an inner <main>. The hook must lock html + body AND the nearest <main>
 * ancestor of the drawer, and restore the prior values on close.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { useRef } from 'react';
import { render } from '@testing-library/react';
import { useScrollLock } from '../../src/hooks/useScrollLock';

function Harness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollLock(active, ref);
  return (
    <main>
      <div ref={ref}>drawer</div>
    </main>
  );
}

afterEach(() => {
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
});

describe('useScrollLock', () => {
  it('locks html + body + nearest <main> while active and restores them on unmount', () => {
    document.body.style.overflow = 'scroll'; // a pre-existing value that must be restored
    const { unmount, container } = render(<Harness active={true} />);
    const main = container.querySelector('main') as HTMLElement;

    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    expect(main.style.overflow).toBe('hidden');

    unmount();
    // body restored to its prior value, not blindly cleared
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.documentElement.style.overflow).toBe('');
    // scrollbar-compensation padding is also unwound (no leftover inline padding)
    expect(document.body.style.paddingRight).toBe('');
    expect(main.style.paddingRight).toBe('');
  });

  it('does nothing while inactive', () => {
    render(<Harness active={false} />);
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
  });
});
