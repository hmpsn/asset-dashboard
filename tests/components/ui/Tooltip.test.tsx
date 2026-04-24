import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Tooltip } from '../../../src/components/ui/overlay/Tooltip';

// Module-level saved handle to the original window.matchMedia so afterEach
// can unconditionally restore it even if a test throws before its own
// cleanup can run. Prevents the reduced-motion mock leaking into later
// tests in this file.
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
});

describe('Tooltip', () => {
  it('does not render tooltip by default', () => {
    render(
      <Tooltip content="Helpful text">
        <button>Hover me</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  describe('with fake timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('shows tooltip after delay on mouseenter', () => {
      render(
        <Tooltip content="Helpful text" delay={500}>
          <button>Hover me</button>
        </Tooltip>,
      );
      fireEvent.mouseEnter(screen.getByRole('button'));
      expect(screen.queryByRole('tooltip')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(screen.queryByRole('tooltip')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(2);
      });
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('cancels pending show on mouseleave', () => {
      render(
        <Tooltip content="Helpful text" delay={500}>
          <button>Hover me</button>
        </Tooltip>,
      );
      const btn = screen.getByRole('button');
      fireEvent.mouseEnter(btn);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      fireEvent.mouseLeave(btn);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });

  it('shows tooltip instantly on focus', () => {
    render(
      <Tooltip content="Helpful text" delay={500}>
        <button>Focus me</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('hides tooltip on blur', () => {
    render(
      <Tooltip content="Helpful text">
        <button>Focus me</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('wires aria-describedby on the trigger while visible', () => {
    render(
      <Tooltip content="Tip body">
        <button>Focus me</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-describedby') ?? '').not.toMatch(/tooltip/);
    fireEvent.focus(btn);
    const tip = screen.getByRole('tooltip');
    const describedBy = btn.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy!.split(' ')).toContain(tip.id);
  });

  it('preserves trigger props (onClick, onFocus) after cloning', () => {
    const onClick = vi.fn();
    const onFocus = vi.fn();
    render(
      <Tooltip content="Tip">
        <button onClick={onClick} onFocus={onFocus}>
          Click
        </button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.focus(btn);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('portals the tooltip to document.body, not into the trigger tree', () => {
    const { container } = render(
      <Tooltip content="Portal tip">
        <button>Hover me</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button'));
    const tip = screen.getByRole('tooltip');
    // The portaled element is a direct child of document.body.
    expect(document.body.contains(tip)).toBe(true);
    // It is NOT a descendant of the component's own render container.
    expect(container.contains(tip)).toBe(false);
  });

  it('skips transition class when prefers-reduced-motion is set', () => {
    // Mock is restored unconditionally by the module-level afterEach above.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;
    render(
      <Tooltip content="Tip">
        <button>Hover</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button'));
    const tip = screen.getByRole('tooltip');
    expect(tip.className).not.toMatch(/transition-opacity/);
  });
});
