import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type DataColumn } from '../../../src/components/ui/DataTable';
import { expectNoA11yViolations } from '../a11y';

const columns: DataColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'score', label: 'Score', align: 'right', sortable: true },
];

const rows = [
  { name: 'Alpha', score: 30 },
  { name: 'Beta', score: 10 },
  { name: 'Gamma', score: 20 },
];

describe('DataTable', () => {
  it('cycles aria-sort across none -> ascending -> descending -> none on the sortable header', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} />);
    const header = screen.getByRole('columnheader', { name: 'Score' });

    expect(header).toHaveAttribute('aria-sort', 'none');

    await user.click(header);
    expect(header).toHaveAttribute('aria-sort', 'ascending');

    await user.click(header);
    expect(header).toHaveAttribute('aria-sort', 'descending');

    await user.click(header);
    expect(header).toHaveAttribute('aria-sort', 'none');
  });

  it('fires onRowClick when a row is activated via keyboard Enter or Space', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} onRowClick={onRowClick} />);

    // role="grid" ⇒ getAllByRole('row')[0] is the header row; [1] is the first
    // data row (rows stay role="row" for valid grid containment, not role="button").
    const firstRow = screen.getAllByRole('row')[1];
    firstRow.focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(rows[0], 0);

    onRowClick.mockClear();
    await user.keyboard(' ');
    expect(onRowClick).toHaveBeenCalledWith(rows[0], 0);
  });

  it('exposes valid grid semantics (role="grid" container with rows + gridcells)', async () => {
    const { container } = render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    // header row + 3 data rows
    expect(screen.getAllByRole('row').length).toBe(4);
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0);
    await expectNoA11yViolations(container);
  });

  it('renders the empty slot when rows is empty and not loading', () => {
    render(<DataTable columns={columns} rows={[]} empty="No rows found" />);
    expect(screen.getByText('No rows found')).toBeInTheDocument();
  });

  it('renders skeleton placeholder rows when loading', () => {
    const { container } = render(<DataTable columns={columns} rows={rows} loading />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });
});
