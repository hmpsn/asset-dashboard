import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Popover } from '../overlay/Popover';

afterEach(() => {
  cleanup();
});

function Harness({
  closeOnSelect = true,
  onAction,
  onDelete,
}: {
  closeOnSelect?: boolean;
  onAction?: () => void;
  onDelete?: () => void;
}) {
  return (
    <Popover
      trigger={<button data-testid="trigger">Menu</button>}
      closeOnSelect={closeOnSelect}
    >
      <Popover.Item onClick={onAction} data-testid="item-action">
        Action
      </Popover.Item>
      <Popover.Separator />
      <Popover.Item onClick={onDelete} danger data-testid="item-delete">
        Delete
      </Popover.Item>
    </Popover>
  );
}

describe('Popover', () => {
  it('does not render menu until trigger is clicked', () => {
    render(<Harness />);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('trigger')).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByTestId('trigger')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on trigger click and sets aria-expanded', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByTestId('trigger')).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape key', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on outside click', () => {
    render(
      <>
        <div data-testid="outside">outside</div>
        <Harness />
      </>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('invokes item onClick and closes when closeOnSelect is true', () => {
    const onAction = vi.fn();
    render(<Harness onAction={onAction} closeOnSelect={true} />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.click(screen.getByTestId('item-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stays open when closeOnSelect is false', () => {
    const onAction = vi.fn();
    render(<Harness onAction={onAction} closeOnSelect={false} />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.click(screen.getByTestId('item-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeInTheDocument();
  });

  it('renders items with role=menuitem', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('Action');
    expect(items[1].textContent).toBe('Delete');
  });

  it('ArrowDown cycles focus through items', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    // Let the post-open focus effect fire.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const items = screen.getAllByRole('menuitem');
    items[0].focus();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    // Wraps back to first.
    expect(document.activeElement).toBe(items[0]);
  });

  it('ArrowUp navigates backward and wraps', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const items = screen.getAllByRole('menuitem');
    items[0].focus();
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[1]);
  });

  it('ArrowUp with nothing focused lands on last item (off-by-one fix)', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    // Do NOT wait for the post-open focus rAF — keep activeElement outside the menu
    // so activeIdx === -1 when ArrowUp fires.
    const items = screen.getAllByRole('menuitem');
    // Ensure focus is outside the popover items.
    screen.getByTestId('trigger').focus();
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    // Should land on the last item, not the second-to-last.
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('danger item has red text class', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    const deleteItem = screen.getByTestId('item-delete');
    expect(deleteItem.className).toMatch(/text-red-400/);
  });
});
