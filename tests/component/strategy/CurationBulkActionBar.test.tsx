import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CurationBulkActionBar } from '../../../src/components/strategy/CurationBulkActionBar';

describe('CurationBulkActionBar', () => {
  const base = { selectedCount: 0, isAllInFilter: false, isPending: false, onAction: vi.fn(), onClear: vi.fn() };

  it('renders nothing at zero selection', () => {
    const { container } = render(<CurationBulkActionBar {...base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected count and fires send/throttle', () => {
    const onAction = vi.fn();
    render(<CurationBulkActionBar {...base} selectedCount={3} onAction={onAction} />);
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send 3/i }));
    expect(onAction).toHaveBeenCalledWith('send');
  });

  it('arm-then-confirms bulk strike — first click does NOT fire strike', () => {
    const onAction = vi.fn();
    render(<CurationBulkActionBar {...base} selectedCount={2} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: /strike 2/i }));
    expect(onAction).not.toHaveBeenCalledWith('strike');
    fireEvent.click(screen.getByRole('button', { name: /confirm strike/i }));
    expect(onAction).toHaveBeenCalledWith('strike');
  });
});
