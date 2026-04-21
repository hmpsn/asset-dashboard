import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../../src/components/ui/ConfirmDialog';

const defaultProps = {
  open: true,
  title: 'Test Title',
  message: 'Test message',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders title and message when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Test Title')).toBeTruthy();
    expect(screen.getByText('Test message')).toBeTruthy();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses custom button labels', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Apply" cancelLabel="Go Back" />);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go Back' })).toBeTruthy();
  });
});
