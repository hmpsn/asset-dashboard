import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CellDetailPanel } from '../../../src/components/matrix/CellDetailPanel';
import type { MatrixCell } from '../../../src/components/matrix/types';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

// Minimal planned cell — no keyword validation, no brief
const PLANNED_CELL: MatrixCell = {
  id: 'cell_001',
  variableValues: { service: 'Roofing', city: 'Austin' },
  targetKeyword: 'roofing austin',
  plannedUrl: '/services/austin/roofing',
  status: 'planned',
};

// Cell with keyword validation data
const VALIDATED_CELL: MatrixCell = {
  id: 'cell_002',
  variableValues: { service: 'Plumbing', city: 'Dallas' },
  targetKeyword: 'plumbing dallas',
  plannedUrl: '/services/dallas/plumbing',
  status: 'keyword_validated',
  keywordValidation: { volume: 320, difficulty: 28, cpc: 4.5, validatedAt: '2024-01-01T00:00:00Z' },
};

// Cell with brief and post IDs
const BRIEF_CELL: MatrixCell = {
  id: 'cell_003',
  variableValues: { service: 'HVAC', city: 'Houston' },
  targetKeyword: 'hvac houston',
  plannedUrl: '/services/houston/hvac',
  status: 'brief_generated',
  briefId: 'brief_123',
  postId: 'post_456',
};

// Cell with a flag comment
const FLAGGED_CELL: MatrixCell = {
  id: 'cell_004',
  variableValues: { service: 'Painting', city: 'Austin' },
  targetKeyword: 'painting austin',
  plannedUrl: '/services/austin/painting',
  status: 'flagged',
  clientFlag: 'Please revise tone',
};

// Cell with a recommended keyword and candidates
const RECOMMENDED_CELL: MatrixCell = {
  id: 'cell_005',
  variableValues: { service: 'Electrical', city: 'Dallas' },
  targetKeyword: 'electrical dallas',
  plannedUrl: '/services/dallas/electrical',
  status: 'keyword_validated',
  keywordValidation: { volume: 200, difficulty: 30, cpc: 3.2, validatedAt: '2024-01-01T00:00:00Z' },
  recommendedKeyword: 'electrician services dallas tx',
  keywordCandidates: [
    { keyword: 'electrical dallas', volume: 200, difficulty: 30, cpc: 3.2, source: 'pattern', isRecommended: false },
    {
      keyword: 'electrician services dallas tx',
      volume: 260,
      difficulty: 27,
      cpc: 3.8,
      source: 'semrush_related',
      isRecommended: true,
      authorityAssessment: {
        posture: 'within_current_authority_range',
        note: 'Good authority match',
        competitorDomainRating: 40,
        yourDomainRating: 42,
      },
    },
  ],
};

// Cell with status history
const HISTORY_CELL: MatrixCell = {
  id: 'cell_006',
  variableValues: { service: 'Landscaping', city: 'Houston' },
  targetKeyword: 'landscaping houston',
  plannedUrl: '/services/houston/landscaping',
  status: 'approved',
  briefId: 'brief_789',
  statusHistory: [
    { from: 'planned', to: 'keyword_validated', at: '2024-01-01T12:00:00Z' },
    { from: 'keyword_validated', to: 'brief_generated', at: '2024-01-02T12:00:00Z' },
    { from: 'brief_generated', to: 'approved', at: '2024-01-03T12:00:00Z' },
  ],
};

const defaultProps = {
  cell: PLANNED_CELL,
  onClose: vi.fn(),
  onCellUpdate: vi.fn(),
};

function renderPanel(props: Partial<typeof defaultProps> & { cell?: MatrixCell } = {}) {
  return render(<CellDetailPanel {...defaultProps} {...props} />, { wrapper });
}

describe('CellDetailPanel', () => {
  it('renders without crash', () => {
    renderPanel();
    // Panel should be in DOM
    expect(document.querySelector('.fixed')).toBeInTheDocument();
  });

  it('shows the cell title derived from variable values', () => {
    renderPanel({ cell: PLANNED_CELL });
    // cellTitle = variableValues entries joined by " in "
    expect(screen.getByText('Roofing in Austin')).toBeInTheDocument();
  });

  it('shows cell status badge', () => {
    renderPanel({ cell: PLANNED_CELL });
    expect(screen.getByText(/planned/i)).toBeInTheDocument();
  });

  it('shows the planned URL', () => {
    renderPanel({ cell: PLANNED_CELL });
    expect(screen.getByText('/services/austin/roofing')).toBeInTheDocument();
  });

  it('shows variable key-value pairs', () => {
    renderPanel({ cell: PLANNED_CELL });
    expect(screen.getByText('Roofing')).toBeInTheDocument();
    expect(screen.getByText('Austin')).toBeInTheDocument();
  });

  it('shows target keyword', () => {
    renderPanel({ cell: PLANNED_CELL });
    // The keyword is wrapped in &ldquo;...&rdquo; which renders as curly quotes split across text nodes
    expect(screen.getByText((content) => content.includes('roofing austin'))).toBeInTheDocument();
  });

  it('shows keyword validation stats when available', () => {
    renderPanel({ cell: VALIDATED_CELL });
    expect(screen.getByText('320')).toBeInTheDocument();   // volume
    expect(screen.getByText('28')).toBeInTheDocument();    // difficulty
    expect(screen.getByText('$4.5')).toBeInTheDocument();  // cpc
  });

  it('shows "No brief generated yet" when no briefId', () => {
    renderPanel({ cell: PLANNED_CELL });
    expect(screen.getByText('No brief generated yet')).toBeInTheDocument();
  });

  it('shows "No post created yet" when no postId', () => {
    renderPanel({ cell: PLANNED_CELL });
    expect(screen.getByText('No post created yet')).toBeInTheDocument();
  });

  it('shows View Brief button when briefId present', () => {
    renderPanel({ cell: BRIEF_CELL });
    expect(screen.getByText('View Brief')).toBeInTheDocument();
  });

  it('shows View Post button when postId present', () => {
    renderPanel({ cell: BRIEF_CELL });
    expect(screen.getByText('View Post')).toBeInTheDocument();
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    renderPanel({ cell: PLANNED_CELL, onClose });
    fireEvent.click(screen.getByRole('button', { name: /close details panel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Generate Page action button when onGenerateBrief provided and no briefId', () => {
    const onGenerateBrief = vi.fn();
    renderPanel({ cell: PLANNED_CELL, onGenerateBrief });
    expect(screen.getByRole('button', { name: /generate page/i })).toBeInTheDocument();
  });

  it('Generate Page button calls onGenerateBrief with cell id', () => {
    const onGenerateBrief = vi.fn();
    renderPanel({ cell: PLANNED_CELL, onGenerateBrief });
    fireEvent.click(screen.getByRole('button', { name: /generate page/i }));
    expect(onGenerateBrief).toHaveBeenCalledWith(PLANNED_CELL.id);
  });

  it('does not show Generate Page button when brief already exists', () => {
    const onGenerateBrief = vi.fn();
    renderPanel({ cell: BRIEF_CELL, onGenerateBrief });
    expect(screen.queryByRole('button', { name: /generate page/i })).not.toBeInTheDocument();
  });

  it('shows Send to client button when onSendReview provided and brief exists, not in review/published status', () => {
    const onSendReview = vi.fn();
    renderPanel({ cell: BRIEF_CELL, onSendReview });
    expect(screen.getByRole('button', { name: /send to client/i })).toBeInTheDocument();
  });

  it('Send to client button calls onSendReview with cell id', () => {
    const onSendReview = vi.fn();
    renderPanel({ cell: BRIEF_CELL, onSendReview });
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    expect(onSendReview).toHaveBeenCalledWith(BRIEF_CELL.id);
  });

  it('shows Flag for Changes button when onFlag provided', () => {
    const onFlag = vi.fn();
    renderPanel({ cell: PLANNED_CELL, onFlag });
    expect(screen.getByRole('button', { name: /flag for changes/i })).toBeInTheDocument();
  });

  it('clicking Flag for Changes shows the flag form', () => {
    const onFlag = vi.fn();
    renderPanel({ cell: PLANNED_CELL, onFlag });
    fireEvent.click(screen.getByRole('button', { name: /flag for changes/i }));
    expect(screen.getByPlaceholderText(/describe what needs to change/i)).toBeInTheDocument();
  });

  it('Submit Flag button is disabled when flag comment is empty', () => {
    const onFlag = vi.fn();
    renderPanel({ cell: PLANNED_CELL, onFlag });
    fireEvent.click(screen.getByRole('button', { name: /flag for changes/i }));
    expect(screen.getByRole('button', { name: /submit flag/i })).toBeDisabled();
  });

  it('Submit Flag calls onFlag with cell id and comment', () => {
    const onFlag = vi.fn();
    renderPanel({ cell: PLANNED_CELL, onFlag });
    fireEvent.click(screen.getByRole('button', { name: /flag for changes/i }));
    const textarea = screen.getByPlaceholderText(/describe what needs to change/i);
    fireEvent.change(textarea, { target: { value: 'Update the headline please' } });
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));
    expect(onFlag).toHaveBeenCalledWith(PLANNED_CELL.id, 'Update the headline please');
  });

  it('Cancel in flag form hides the form', () => {
    const onFlag = vi.fn();
    renderPanel({ cell: PLANNED_CELL, onFlag });
    fireEvent.click(screen.getByRole('button', { name: /flag for changes/i }));
    expect(screen.getByPlaceholderText(/describe what needs to change/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByPlaceholderText(/describe what needs to change/i)).not.toBeInTheDocument();
  });

  it('shows recommended keyword section when recommendedKeyword differs from current keyword', () => {
    renderPanel({ cell: RECOMMENDED_CELL });
    // The recommended keyword appears in multiple elements (recommendation box + candidate list)
    const matches = screen.getAllByText((content) => content.includes('electrician services dallas tx'));
    expect(matches.length).toBeGreaterThan(0);
  });

  it('shows Accept Recommendation button when recommendation present', () => {
    renderPanel({ cell: RECOMMENDED_CELL });
    expect(screen.getByRole('button', { name: /accept recommendation/i })).toBeInTheDocument();
  });

  it('Accept Recommendation calls onCellUpdate with recommended keyword', () => {
    const onCellUpdate = vi.fn();
    renderPanel({ cell: RECOMMENDED_CELL, onCellUpdate });
    fireEvent.click(screen.getByRole('button', { name: /accept recommendation/i }));
    expect(onCellUpdate).toHaveBeenCalledWith(RECOMMENDED_CELL.id, { customKeyword: 'electrician services dallas tx' });
  });

  it('shows All Candidates section when candidates exist', () => {
    renderPanel({ cell: RECOMMENDED_CELL });
    expect(screen.getByText('All Candidates')).toBeInTheDocument();
  });

  it('shows status timeline when statusHistory is present', () => {
    renderPanel({ cell: HISTORY_CELL });
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Keyword Optimized')).toBeInTheDocument();
    expect(screen.getByText('Brief Generated')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('shows expected schema types when present', () => {
    const cellWithSchema: MatrixCell = {
      ...PLANNED_CELL,
      id: 'cell_schema',
      expectedSchemaTypes: ['LocalBusiness', 'Service'],
    };
    renderPanel({ cell: cellWithSchema });
    expect(screen.getByText('LocalBusiness')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
  });

  it('shows approved status badge correctly', () => {
    renderPanel({ cell: HISTORY_CELL });
    // Status badge text includes "Approved"
    expect(screen.getAllByText(/approved/i).length).toBeGreaterThan(0);
  });
});
