import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Modal } from '../overlay/Modal';

afterEach(() => {
  cleanup();
  // Ensure scroll lock is released between tests.
  document.body.style.overflow = '';
});

function Harness({
  open,
  onClose,
  size,
}: {
  open: boolean;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <Modal open={open} onClose={onClose} size={size}>
      <Modal.Header title="Dialog title" onClose={onClose} />
      <Modal.Body>
        <input data-testid="first-input" defaultValue="one" />
        <input data-testid="second-input" defaultValue="two" />
      </Modal.Body>
      <Modal.Footer>
        <button data-testid="confirm-btn">Confirm</button>
      </Modal.Footer>
    </Modal>
  );
}

describe('Modal', () => {
  it('renders nothing when open is false', () => {
    render(<Harness open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders when open is true', () => {
    render(<Harness open={true} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Dialog title')).toBeInTheDocument();
  });

  it('sets ARIA role, aria-modal, and aria-labelledby', () => {
    render(<Harness open={true} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const titleEl = document.getElementById(labelledBy!);
    expect(titleEl?.textContent).toBe('Dialog title');
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    const backdrop = document.querySelector('[data-modal-backdrop="true"]') as HTMLElement;
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when the panel is clicked', () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the header close button is clicked', () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks body scroll while open and restores on close', () => {
    const { rerender } = render(<Harness open={true} onClose={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Harness open={false} onClose={() => {}} />);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('traps focus: Tab from last focusable wraps to first', () => {
    render(<Harness open={true} onClose={() => {}} />);
    const confirmBtn = screen.getByTestId('confirm-btn');
    const closeBtn = screen.getByRole('button', { name: /close/i });
    confirmBtn.focus();
    expect(document.activeElement).toBe(confirmBtn);
    fireEvent.keyDown(document, { key: 'Tab' });
    // First focusable is the close button (X) before the body inputs.
    expect(document.activeElement).toBe(closeBtn);
  });

  it('traps focus backward: Shift+Tab from first focusable wraps to last', () => {
    render(<Harness open={true} onClose={() => {}} />);
    const closeBtn = screen.getByRole('button', { name: /close/i });
    const confirmBtn = screen.getByTestId('confirm-btn');
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn);
  });

  it('applies size max-width classes', () => {
    const { rerender } = render(<Harness open={true} onClose={() => {}} size="sm" />);
    expect(screen.getByRole('dialog').className).toMatch(/max-w-\[24rem\]/);
    rerender(<Harness open={true} onClose={() => {}} size="xl" />);
    expect(screen.getByRole('dialog').className).toMatch(/max-w-\[64rem\]/);
  });

  it('restores focus to original trigger after multiple parent re-renders with new onClose references', async () => {
    // Simulates the most common React pattern: parent passes an inline arrow function
    // as onClose. Each re-render produces a new function reference, which would
    // retrigger the focus-capture effect if it had [open, onClose] as deps.
    // After the fix, the capture effect has deps=[open] only, so the captured
    // element is the trigger BEFORE the modal opened, not whatever is focused inside.
    const trigger = document.createElement('button');
    trigger.setAttribute('data-testid', 'outside-trigger');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    let rerenderFn: ReturnType<typeof render>['rerender'];
    await act(async () => {
      const result = render(<Harness open={true} onClose={() => {}} />);
      rerenderFn = result.rerender;
    });

    // Re-render several times with a fresh onClose reference each call (inline arrow).
    // In between, focus should naturally shift to something inside the modal.
    await act(async () => {
      rerenderFn(<Harness open={true} onClose={() => { /* re-render 1 */ }} />);
      rerenderFn(<Harness open={true} onClose={() => { /* re-render 2 */ }} />);
      rerenderFn(<Harness open={true} onClose={() => { /* re-render 3 */ }} />);
    });

    // Now close the modal — focus should restore to the original trigger.
    await act(async () => {
      rerenderFn(<Harness open={false} onClose={() => {}} />);
    });

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
