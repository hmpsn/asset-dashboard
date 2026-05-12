/**
 * Component tests for ApprovalBatchCard — verifies rendering and interaction
 * for inline approval batch cards in the Decisions section.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ApprovalBatch, ApprovalItem } from '../../shared/types/approvals';

vi.mock('../../src/api/client', () => ({
  patch: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../src/hooks/usePageEditStates', () => ({
  usePageEditStates: () => ({ getState: () => undefined }),
}));

import { ApprovalBatchCard } from '../../src/components/client/ApprovalBatchCard';
import { patch } from '../../src/api/client';

const mockPatch = vi.mocked(patch);

function makeItem(overrides?: Partial<ApprovalItem>): ApprovalItem {
  return {
    id: 'item-1',
    pageId: 'page-1',
    pageTitle: 'Homepage',
    pageSlug: '/',
    field: 'seoTitle',
    currentValue: 'Old Title',
    proposedValue: 'New SEO Title',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeBatch(overrides?: Partial<ApprovalBatch>): ApprovalBatch {
  return {
    id: 'batch-1',
    workspaceId: 'ws-1',
    siteId: 'site-1',
    name: 'Q2 SEO Pass',
    status: 'pending',
    items: [makeItem()],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const defaultProps = {
  workspaceId: 'ws-1',
  effectiveTier: 'growth' as const,
  setApprovalBatches: vi.fn(),
  loadApprovals: vi.fn(),
  setToast: vi.fn(),
};

describe('ApprovalBatchCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders batch name and SEO Changes badge', () => {
    render(<ApprovalBatchCard {...defaultProps} batch={makeBatch()} />);
    expect(screen.getByText('Q2 SEO Pass')).toBeInTheDocument();
    expect(screen.getByText('SEO Changes')).toBeInTheDocument();
  });

  it('renders item count in header', () => {
    render(<ApprovalBatchCard {...defaultProps} batch={makeBatch()} />);
    // Item count appears in both the card header and per-page row — just confirm it's present
    expect(screen.getAllByText(/1 change/).length).toBeGreaterThan(0);
  });

  it('shows Approve, Edit, and Reject buttons for pending items (growth tier)', () => {
    render(<ApprovalBatchCard {...defaultProps} batch={makeBatch()} />);
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('renders TierGate instead of action buttons for free tier', () => {
    render(<ApprovalBatchCard {...defaultProps} effectiveTier="free" batch={makeBatch()} />);
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject')).not.toBeInTheDocument();
    // TierGate renders a compact gate with the feature name
    expect(screen.getByText(/Approve & Edit Changes/i)).toBeInTheDocument();
  });

  it('shows Undo for approved items', () => {
    const batch = makeBatch({
      items: [makeItem({ id: 'item-2', status: 'approved' })],
    });
    render(<ApprovalBatchCard {...defaultProps} batch={batch} />);
    // The approved state renders "Approved — will be applied..." inline text
    expect(screen.getByText(/will be applied when you push changes live/i)).toBeInTheDocument();
    expect(screen.getByText('Undo')).toBeInTheDocument();
  });

  it('shows Undo and client note for rejected items', () => {
    const batch = makeBatch({
      items: [makeItem({ id: 'item-3', status: 'rejected', clientNote: 'Tone is off' })],
    });
    render(<ApprovalBatchCard {...defaultProps} batch={batch} />);
    // The rejected state renders both a status badge and an inline "Rejected" label with Undo
    expect(screen.getByText('Undo')).toBeInTheDocument();
    expect(screen.getByText(/Tone is off/i)).toBeInTheDocument();
  });

  it('shows applied date for applied items', () => {
    const batch = makeBatch({
      items: [makeItem({ id: 'item-4', status: 'applied', updatedAt: '2026-01-15T00:00:00.000Z' })],
    });
    render(<ApprovalBatchCard {...defaultProps} batch={batch} />);
    expect(screen.getByText(/Applied to live site on/i)).toBeInTheDocument();
  });

  it('collapses and expands page rows on click', () => {
    render(<ApprovalBatchCard {...defaultProps} batch={makeBatch()} />);
    // Item actions visible initially (expanded by default)
    expect(screen.getByText('Approve')).toBeInTheDocument();

    // Click the page header row to collapse — it's a button containing 'Homepage'
    const pageButton = screen.getByRole('button', { name: /Homepage/i });
    fireEvent.click(pageButton);
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();

    // Click again to expand
    fireEvent.click(pageButton);
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('page header button has aria-expanded reflecting collapsed state', () => {
    render(<ApprovalBatchCard {...defaultProps} batch={makeBatch()} />);
    const pageButton = screen.getByRole('button', { name: /Homepage/i });
    // Starts expanded
    expect(pageButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(pageButton);
    // Collapsed
    expect(pageButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('calls patch when Approve is clicked', async () => {
    const approvedBatch = makeBatch({ items: [makeItem({ status: 'approved' })] });
    mockPatch.mockResolvedValue(approvedBatch);

    render(<ApprovalBatchCard {...defaultProps} batch={makeBatch()} />);
    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        expect.stringContaining('/batch-1/item-1'),
        { status: 'approved' },
      );
    });
  });

  it('retains edit draft if patch fails', async () => {
    mockPatch.mockRejectedValue(new Error('network error'));

    render(<ApprovalBatchCard {...defaultProps} batch={makeBatch()} />);
    // Open edit mode
    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'My edited title' } });

    fireEvent.click(screen.getByText('Save Edit'));

    await waitFor(() => {
      expect(defaultProps.setToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });
    // Edit UI should still be open with the draft preserved
    expect(screen.getByDisplayValue('My edited title')).toBeInTheDocument();
  });

  it('shows Approve All footer button when multiple pending items exist', () => {
    const batch = makeBatch({
      items: [
        makeItem({ id: 'i1', field: 'seoTitle' }),
        makeItem({ id: 'i2', field: 'seoDescription', pageId: 'page-1' }),
      ],
    });
    render(<ApprovalBatchCard {...defaultProps} batch={batch} />);
    expect(screen.getByText(/Approve All \(2\)/i)).toBeInTheDocument();
  });

  it('opens confirm dialog when Approve All is clicked', () => {
    const batch = makeBatch({
      items: [
        makeItem({ id: 'i1', field: 'seoTitle' }),
        makeItem({ id: 'i2', field: 'seoDescription' }),
      ],
    });
    render(<ApprovalBatchCard {...defaultProps} batch={batch} />);
    fireEvent.click(screen.getByText(/Approve All \(2\)/i));
    // ConfirmDialog should be visible
    expect(screen.getByText('Approve all changes')).toBeInTheDocument();
  });

  it('shows pending badge count in card header', () => {
    render(<ApprovalBatchCard {...defaultProps} batch={makeBatch()} />);
    // "1 pending" appears in both the card header and the per-page row — confirm at least one
    expect(screen.getAllByText('1 pending').length).toBeGreaterThan(0);
  });

  it('shows approved badge when batch has approved items', () => {
    const batch = makeBatch({
      items: [
        makeItem({ id: 'i1', status: 'pending' }),
        makeItem({ id: 'i2', field: 'seoDescription', status: 'approved' }),
      ],
    });
    render(<ApprovalBatchCard {...defaultProps} batch={batch} />);
    expect(screen.getAllByText('1 pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 approved').length).toBeGreaterThan(0);
  });
});
