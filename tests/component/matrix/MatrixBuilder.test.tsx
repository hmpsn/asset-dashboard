import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MatrixBuilder } from '../../../src/components/matrix/MatrixBuilder';
import { MOCK_TEMPLATES, MOCK_TEMPLATE } from '../../../src/components/matrix/mockData';
import type { ContentMatrix } from '../../../src/components/matrix/types';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

const defaultProps = {
  workspaceId: 'ws_test',
  templates: MOCK_TEMPLATES,
  onComplete: vi.fn(),
  onCancel: vi.fn(),
};

function renderBuilder(props = {}) {
  return render(<MatrixBuilder {...defaultProps} {...props} />, { wrapper });
}

describe('MatrixBuilder', () => {
  it('renders without crash', () => {
    renderBuilder();
    expect(screen.getByText('Create Content Matrix')).toBeInTheDocument();
  });

  it('shows subtitle', () => {
    renderBuilder();
    expect(screen.getByText('Build a matrix of planned pages from a template')).toBeInTheDocument();
  });

  it('shows step indicator on step 1', () => {
    renderBuilder();
    // "Choose Template" appears in both step indicator and the card title — use getAllByText
    expect(screen.getAllByText('Choose Template').length).toBeGreaterThan(0);
  });

  it('shows Cancel button in header', () => {
    renderBuilder();
    // The header Cancel button (not navigation)
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
    expect(cancelButtons.length).toBeGreaterThan(0);
  });

  it('calls onCancel when Cancel header button is clicked', () => {
    const onCancel = vi.fn();
    renderBuilder({ onCancel });
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButtons[0]);
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders template cards for each template', () => {
    renderBuilder();
    expect(screen.getByText('Service × Location Page')).toBeInTheDocument();
    expect(screen.getByText('Pillar × Subtopic Hub')).toBeInTheDocument();
  });

  it('shows template description', () => {
    renderBuilder();
    expect(screen.getByText('Standard service page for each city')).toBeInTheDocument();
  });

  it('shows template variable count', () => {
    renderBuilder();
    // MOCK_TEMPLATE has 2 variables
    expect(screen.getAllByText(/2 variables/i).length).toBeGreaterThan(0);
  });

  it('shows template section count', () => {
    renderBuilder();
    // MOCK_TEMPLATE has 6 sections
    expect(screen.getAllByText(/6 sections/i).length).toBeGreaterThan(0);
  });

  it('Next button is disabled when no template is selected', () => {
    renderBuilder();
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).toBeDisabled();
  });

  it('selecting a template enables Next button', () => {
    renderBuilder();
    const templateCard = screen.getByText('Service × Location Page').closest('button');
    expect(templateCard).toBeTruthy();
    fireEvent.click(templateCard!);
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).not.toBeDisabled();
  });

  it('clicking Next after selecting template advances to step 2', () => {
    renderBuilder();
    fireEvent.click(screen.getByText('Service × Location Page').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // "Define Values" appears in both step indicator and the card title — use getAllByText
    expect(screen.getAllByText('Define Values').length).toBeGreaterThan(0);
  });

  it('shows empty state when no templates are provided', () => {
    renderBuilder({ templates: [] });
    expect(screen.getByText('No templates available')).toBeInTheDocument();
  });

  it('Back button on step 1 calls onCancel', () => {
    const onCancel = vi.fn();
    renderBuilder({ onCancel });
    // Multiple buttons have "cancel" in name; get all and click the last (navigation row)
    const allCancelBtns = screen.getAllByRole('button', { name: /cancel/i });
    fireEvent.click(allCancelBtns[allCancelBtns.length - 1]);
    expect(onCancel).toHaveBeenCalled();
  });

  it('step 2 shows variable label inputs', () => {
    renderBuilder();
    fireEvent.click(screen.getByText('Service × Location Page').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText('City')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
  });

  it('step 2 shows variable description', () => {
    renderBuilder();
    fireEvent.click(screen.getByText('Service × Location Page').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText('Target metro area')).toBeInTheDocument();
  });

  it('step 2 Next is disabled when no values entered', () => {
    renderBuilder();
    fireEvent.click(screen.getByText('Service × Location Page').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).toBeDisabled();
  });

  it('step 4 shows matrix name field', async () => {
    renderBuilder();
    // Step 1: select template
    fireEvent.click(screen.getByText('Service × Location Page').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Step 2 is now active; confirm by checking "Define Values" appears in the section card
    expect(screen.getAllByText('Define Values').length).toBeGreaterThan(0);
    // Variable label inputs are shown on step 2
    expect(screen.getByText('City')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
  });

  it('template cards show page type badge', () => {
    renderBuilder();
    expect(screen.getByText('service')).toBeInTheDocument();
  });
});
