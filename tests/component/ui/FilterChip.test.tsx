import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterChip } from '../../../src/components/ui/forms/FilterChip';

describe('FilterChip', () => {
  it('clicking the chip fires onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<FilterChip label="Commercial" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Commercial' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('aria-pressed reflects the active prop', () => {
    const { rerender } = render(<FilterChip label="Commercial" active={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Commercial' })).toHaveAttribute('aria-pressed', 'false');

    rerender(<FilterChip label="Commercial" active onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Commercial' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('remove button fires onRemove and does not fire onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<FilterChip label="Commercial" active onClick={onClick} onRemove={onRemove} />);

    await user.click(screen.getByRole('button', { name: 'Remove Commercial' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders an optional count', () => {
    render(<FilterChip label="Commercial" count={7} onClick={vi.fn()} />);
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
