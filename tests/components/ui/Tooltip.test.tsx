import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Drawer } from '../../../src/components/ui/overlay/Drawer';
import { Modal } from '../../../src/components/ui/overlay/Modal';
import { Tooltip } from '../../../src/components/ui/overlay/Tooltip';

// Module-level saved handle to the original window.matchMedia so afterEach
// can unconditionally restore it even if a test throws before its own
// cleanup can run. Prevents the reduced-motion mock leaking into later
// tests in this file.
const originalMatchMedia = window.matchMedia;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function IndependentModalController({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen((current) => !current)}>
        {open ? 'Unmount independent modal' : 'Mount independent modal'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <Modal.Header title="Independent modal" />
        <Modal.Body>Modal body</Modal.Body>
      </Modal>
    </>
  );
}

function OverlayStackTransitionHarness({ modalInitiallyOpen }: { modalInitiallyOpen: boolean }) {
  return (
    <>
      <Drawer open onClose={() => undefined} title="Persistent drawer">
        <Tooltip content="Persistent drawer tip" delay={0}>
          <button>Persistent drawer trigger</button>
        </Tooltip>
      </Drawer>
      <IndependentModalController initiallyOpen={modalInitiallyOpen} />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it('keeps an ordinary page tooltip on the normal tooltip layer', () => {
    render(
      <Tooltip content="Page tip">
        <button>Page trigger</button>
      </Tooltip>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Page trigger' }));

    const tip = screen.getByRole('tooltip');
    expect(tip.style.zIndex).toBe('var(--z-tooltip)');
    expect(tip.style.pointerEvents).toBe('none');
  });

  it('shares one overlay-stack observer and disconnects it after the last visible tooltip hides', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    class TestMutationObserver {
      constructor(_callback: MutationCallback) {}
      observe = observe;
      disconnect = disconnect;
      takeRecords = () => [];
    }
    vi.stubGlobal('MutationObserver', TestMutationObserver);

    render(
      <>
        <Tooltip content="First tip"><button>First trigger</button></Tooltip>
        <Tooltip content="Second tip"><button>Second trigger</button></Tooltip>
      </>,
    );
    expect(observe).not.toHaveBeenCalled();

    fireEvent.focus(screen.getByRole('button', { name: 'First trigger' }));
    fireEvent.focus(screen.getByRole('button', { name: 'Second trigger' }));
    expect(observe).toHaveBeenCalledTimes(1);

    fireEvent.blur(screen.getByRole('button', { name: 'First trigger' }));
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByRole('button', { name: 'Second trigger' }));
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('elevates a tooltip triggered inside the topmost canonical Drawer', () => {
    render(
      <Drawer open onClose={() => undefined} title="Asset detail">
        <Tooltip content="Drawer tip">
          <button>Drawer trigger</button>
        </Tooltip>
      </Drawer>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Drawer trigger' }));

    expect(screen.getByRole('tooltip').style.zIndex).toBe('var(--z-modal-fullscreen)');
  });

  it('elevates a tooltip triggered inside the topmost canonical Modal', () => {
    render(
      <Modal open onClose={() => undefined}>
        <Modal.Header title="Edit asset" />
        <Modal.Body>
          <Tooltip content="Modal tip">
            <button>Modal trigger</button>
          </Tooltip>
        </Modal.Body>
      </Modal>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Modal trigger' }));

    expect(screen.getByRole('tooltip').style.zIndex).toBe('var(--z-modal-fullscreen)');
  });

  it('keeps a background tooltip on the normal layer while a Drawer is open', () => {
    render(
      <>
        <Tooltip content="Background tip">
          <button>Background trigger</button>
        </Tooltip>
        <Drawer open onClose={() => undefined} title="Foreground drawer">
          Drawer body
        </Drawer>
      </>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Background trigger' }));

    expect(screen.getByRole('tooltip').style.zIndex).toBe('var(--z-tooltip)');
  });

  it('elevates only the tooltip in the topmost panel when a Modal is stacked over a Drawer', () => {
    render(
      <>
        <Drawer open onClose={() => undefined} title="Lower drawer">
          <Tooltip content="Lower tip">
            <button>Lower trigger</button>
          </Tooltip>
        </Drawer>
        <Modal open onClose={() => undefined}>
          <Modal.Header title="Top modal" />
          <Modal.Body>
            <Tooltip content="Top tip">
              <button>Top trigger</button>
            </Tooltip>
          </Modal.Body>
        </Modal>
      </>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Lower trigger' }));
    const lowerTip = screen.getByText('Lower tip').closest<HTMLElement>('[role="tooltip"]');
    expect(lowerTip?.style.zIndex).toBe('var(--z-tooltip)');

    fireEvent.blur(screen.getByRole('button', { name: 'Lower trigger' }));
    fireEvent.focus(screen.getByRole('button', { name: 'Top trigger' }));
    const topTip = screen.getByText('Top tip').closest<HTMLElement>('[role="tooltip"]');
    expect(topTip?.style.zIndex).toBe('var(--z-modal-fullscreen)');
  });

  it('demotes a still-visible Drawer tooltip when an independent Modal mounts above it', async () => {
    render(<OverlayStackTransitionHarness modalInitiallyOpen={false} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Persistent drawer trigger' }));

    const tip = screen.getByRole('tooltip');
    expect(tip.style.zIndex).toBe('var(--z-modal-fullscreen)');

    fireEvent.click(screen.getByRole('button', { name: 'Mount independent modal' }));

    await waitFor(() => expect(tip.style.zIndex).toBe('var(--z-tooltip)'));
  });

  it('elevates a still-visible Drawer tooltip when an independent top Modal unmounts', async () => {
    render(<OverlayStackTransitionHarness modalInitiallyOpen />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Persistent drawer trigger' }));

    const tip = screen.getByRole('tooltip');
    expect(tip.style.zIndex).toBe('var(--z-tooltip)');

    fireEvent.click(screen.getByRole('button', { name: 'Unmount independent modal' }));

    await waitFor(() => expect(tip.style.zIndex).toBe('var(--z-modal-fullscreen)'));
  });

  it('continues to clamp fixed positioning inside the viewport gutter', () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBounds() {
      return this.getAttribute('data-tooltip') === 'true'
        ? rect(0, 0, 120, 40)
        : rect(0, 0, 20, 20);
    });

    render(
      <Tooltip content="Clamped tip" placement="top">
        <button>Edge trigger</button>
      </Tooltip>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Edge trigger' }));

    const tip = screen.getByRole('tooltip');
    expect(tip.style.top).toBe('4px');
    expect(tip.style.left).toBe('4px');
    bounds.mockRestore();
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
