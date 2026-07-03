import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Drawer } from '../../../src/components/ui/overlay/Drawer';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="Focus Trap">
      <button data-testid="first-inside">Inside First</button>
      <button data-testid="last-inside">Inside Last</button>
    </Drawer>
  );
}

describe('Drawer', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(<Drawer open={false} title="Hidden" />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the dialog with title when open', () => {
    render(<Drawer open title="My Drawer" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('My Drawer')).toBeInTheDocument();
  });

  it('sets aria-modal and aria-labelledby wired to the title', () => {
    render(<Drawer open title="Labelled Drawer" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Labelled Drawer');
  });

  it('traps focus: Tab from the last focusable wraps to the first', () => {
    render(<Harness open onClose={() => {}} />);
    const closeBtn = screen.getByRole('button', { name: /close/i });
    const lastInside = screen.getByTestId('last-inside');
    lastInside.focus();
    expect(document.activeElement).toBe(lastInside);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);
  });

  it('traps focus backward: Shift+Tab from the first focusable wraps to the last', () => {
    render(<Harness open onClose={() => {}} />);
    const closeBtn = screen.getByRole('button', { name: /close/i });
    const lastInside = screen.getByTestId('last-inside');
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastInside);
  });

  it('restores focus to the previously-focused element when the drawer closes', () => {
    const trigger = document.createElement('button');
    trigger.setAttribute('data-testid', 'outside-trigger');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(<Harness open onClose={() => {}} />);
    // Focus something inside the drawer to simulate user interaction.
    screen.getByTestId('first-inside').focus();
    expect(document.activeElement).not.toBe(trigger);

    rerender(<Harness open={false} onClose={() => {}} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('fires onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<Drawer open onClose={onClose} title="Escape Test" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('fires onClose on backdrop click when closeOnBackdrop is true (default)', () => {
    const onClose = vi.fn();
    render(<Drawer open onClose={onClose} title="Backdrop Test" />);
    const backdrop = document.querySelector('[data-drawer-backdrop="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop as Element);
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT fire onClose on backdrop click when closeOnBackdrop is false', () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="No Backdrop Close" closeOnBackdrop={false} />,
    );
    const backdrop = document.querySelector('[data-drawer-backdrop="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop as Element);
    fireEvent.click(backdrop as Element);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not fire onClose when the panel itself is clicked', () => {
    const onClose = vi.fn();
    render(<Drawer open onClose={onClose} title="Panel Click" />);
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});
