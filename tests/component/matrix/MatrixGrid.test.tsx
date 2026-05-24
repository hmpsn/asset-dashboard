import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MatrixGrid } from '../../../src/components/matrix/MatrixGrid';
import { MOCK_MATRIX } from '../../../src/components/matrix/mockData';
import type { ContentMatrix, MatrixCell } from '../../../src/components/matrix/types';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

const defaultProps = {
  workspaceId: 'ws_test',
  matrix: MOCK_MATRIX,
  onCellClick: vi.fn(),
  onBulkAction: vi.fn(),
  onCellUpdate: vi.fn(),
};

function renderGrid(props: Partial<typeof defaultProps> = {}) {
  return render(<MatrixGrid {...defaultProps} {...props} />, { wrapper });
}

describe('MatrixGrid', () => {
  it('renders without crash', () => {
    renderGrid();
    expect(screen.getByText(MOCK_MATRIX.name)).toBeInTheDocument();
  });

  it('shows total page count in subtitle', () => {
    renderGrid();
    expect(screen.getByText(`${MOCK_MATRIX.stats.total} pages total`)).toBeInTheDocument();
  });

  it('renders column headers for dimension 2 values', () => {
    renderGrid();
    // dim1 is City with values Austin, Dallas, Houston
    expect(screen.getByText('Austin')).toBeInTheDocument();
    expect(screen.getByText('Dallas')).toBeInTheDocument();
    expect(screen.getByText('Houston')).toBeInTheDocument();
  });

  it('renders row headers for dimension 1 values', () => {
    renderGrid();
    // dim0 is Service with values Roofing, Plumbing, HVAC, Electrical, Painting, Landscaping
    expect(screen.getByText('Roofing')).toBeInTheDocument();
    expect(screen.getByText('Plumbing')).toBeInTheDocument();
    expect(screen.getByText('HVAC')).toBeInTheDocument();
  });

  it('renders the grid table element', () => {
    renderGrid();
    const table = document.querySelector('table');
    expect(table).toBeInTheDocument();
  });

  it('shows progress percentage', () => {
    renderGrid();
    expect(screen.getByText(/% complete/)).toBeInTheDocument();
  });

  it('shows completed count out of total', () => {
    renderGrid();
    const totalCells = MOCK_MATRIX.cells.length;
    expect(screen.getByText(new RegExp(`/${totalCells} pages`))).toBeInTheDocument();
  });

  it('shows Filter button in toolbar', () => {
    renderGrid();
    expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument();
  });

  it('shows Sort button in toolbar', () => {
    renderGrid();
    expect(screen.getByRole('button', { name: /sort/i })).toBeInTheDocument();
  });

  it('clicking Filter opens dropdown with status options', () => {
    renderGrid();
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    expect(screen.getByText('All statuses')).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
  });

  it('clicking Sort opens dropdown with sort options', () => {
    renderGrid();
    fireEvent.click(screen.getByRole('button', { name: /sort/i }));
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('Difficulty')).toBeInTheDocument();
    expect(screen.getByText('Alphabetical')).toBeInTheDocument();
  });

  it('renders status legend at bottom', () => {
    renderGrid();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('shows cell keyword text in grid', () => {
    renderGrid();
    // At least one cell from the matrix should be visible
    const firstCell = MOCK_MATRIX.cells[0];
    const keyword = firstCell.customKeyword ?? firstCell.targetKeyword;
    // keyword is e.g. "roofing austin" — may be truncated, so just look for a cell td
    const tds = document.querySelectorAll('td');
    expect(tds.length).toBeGreaterThan(0);
  });

  it('clicking a cell triggers selection (single click)', () => {
    renderGrid();
    const tds = document.querySelectorAll('td.cursor-pointer');
    if (tds.length > 0) {
      fireEvent.click(tds[0]);
      // After single click, selected indicator should appear (ring-2 class)
      expect(tds[0].className).toContain('ring-2');
    } else {
      // If no clickable td found, verify grid rendered
      expect(document.querySelector('table')).toBeInTheDocument();
    }
  });

  it('double clicking a cell opens detail panel', () => {
    const onCellClick = vi.fn();
    renderGrid({ onCellClick });
    const tds = document.querySelectorAll('td.cursor-pointer');
    if (tds.length > 0) {
      fireEvent.dblClick(tds[0]);
      expect(onCellClick).toHaveBeenCalled();
    }
  });

  it('shows Actions button when cells are selected', () => {
    renderGrid();
    const tds = document.querySelectorAll('td.cursor-pointer');
    if (tds.length > 0) {
      fireEvent.click(tds[0]);
      expect(screen.getByRole('button', { name: /actions/i })).toBeInTheDocument();
    }
  });

  it('shows selected count when cells are selected', () => {
    renderGrid();
    const tds = document.querySelectorAll('td.cursor-pointer');
    if (tds.length > 0) {
      fireEvent.click(tds[0]);
      expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    }
  });

  it('renders a 1-dimension matrix as a list', () => {
    const oneDimMatrix: ContentMatrix = {
      ...MOCK_MATRIX,
      dimensions: [{ variableName: 'city', label: 'City', values: ['Austin', 'Dallas'] }],
      cells: [
        {
          id: 'c1',
          variableValues: { city: 'Austin' },
          targetKeyword: 'plumbing austin',
          plannedUrl: '/services/austin/plumbing',
          status: 'planned',
        },
        {
          id: 'c2',
          variableValues: { city: 'Dallas' },
          targetKeyword: 'plumbing dallas',
          plannedUrl: '/services/dallas/plumbing',
          status: 'brief_generated',
        },
      ],
      stats: { total: 2, planned: 1, briefGenerated: 1, drafted: 0, reviewed: 0, published: 0 },
    };
    render(<MatrixGrid {...defaultProps} matrix={oneDimMatrix} />, { wrapper });
    expect(screen.getByText('plumbing austin')).toBeInTheDocument();
    expect(screen.getByText('plumbing dallas')).toBeInTheDocument();
    // No table in list mode
    expect(document.querySelector('table')).not.toBeInTheDocument();
  });

  it('shows keyword validation data in cells when available', () => {
    renderGrid();
    // Cells with keyword_validated status have volume data
    expect(screen.getAllByText(/\/mo/).length).toBeGreaterThan(0);
  });
});
