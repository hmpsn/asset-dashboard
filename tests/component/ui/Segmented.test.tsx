import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Segmented } from '../../../src/components/ui/forms/Segmented';

const options = [
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
  { value: 'grid', label: 'Grid' },
];

describe('Segmented', () => {
  it('clicking a segment fires onChange with its value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Segmented options={options} value="list" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Board' }));
    expect(onChange).toHaveBeenCalledWith('board');
  });

  it('marks only the selected segment as aria-checked', () => {
    render(<Segmented options={options} value="board" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Board' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'false');
  });

  it('arrow key moves roving focus, and activating the focused segment selects it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Segmented options={options} value="list" onChange={onChange} />);

    const listSegment = screen.getByRole('radio', { name: 'List' });
    listSegment.focus();
    await user.keyboard('{ArrowRight}');

    const boardSegment = screen.getByRole('radio', { name: 'Board' });
    expect(document.activeElement).toBe(boardSegment);
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('board');
  });

  it('only one segment is tabbable at a time (roving tabindex)', () => {
    render(<Segmented options={options} value="board" onChange={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    const tabbable = radios.filter((r) => r.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveTextContent('Board');
  });
});
