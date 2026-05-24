/**
 * Component tests for ApprovalsTab.
 *
 * Covers: loading state, empty state, approval batch rendering,
 * filter bar, approve/reject/edit actions, single-item vs batch
 * level approve-all, tier gating, schema field preview.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalsTab } from '../../../src/components/client/ApprovalsTab';
import type { ApprovalBatch, ApprovalItem } from '../../../src/components/client/types';

// ── React Router ──────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

// ── API client ────────────────────────────────────────────────────────────────
const patchMock = vi.fn();
const postMock = vi.fn();
vi.mock('../../../src/api/client', () => ({
  patch: (...args: unknown[]) => patchMock(...args),
  post: (...args: unknown[]) => postMock(...args),
  get: vi.fn(),
  getOptional: vi.fn(),
  del: vi.fn(),
}));

// ── usePageEditStates — returns no edit state by default ──────────────────────
vi.mock('../../../src/hooks/usePageEditStates', () => ({
  usePageEditStates: () => ({
    getState: () => undefined,
    states: {},
    loading: false,
    refresh: vi.fn(),
    summary: { clean: 0, issueDetected: 0, fixProposed: 0, inReview: 0, approved: 0, rejected: 0, live: 0, total: 0 },
  }),
}));

// ── React Query — simple mock so usePageEditStates' inner useQuery resolves ───
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => ({ data: {}, isLoading: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'item-1',
    pageId: 'page-1',
    pageTitle: 'Home Page',
    pageSlug: 'home',
    field: 'seoTitle',
    currentValue: 'Old Title',
    proposedValue: 'New SEO Title',
    status: 'pending',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBatch(overrides: Partial<ApprovalBatch> = {}): ApprovalBatch {
  return {
    id: 'batch-1',
    workspaceId: 'ws-1',
    siteId: 'site-1',
    name: 'May SEO Batch',
    status: 'pending',
    items: [makeItem()],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

const baseProps = {
  workspaceId: 'ws-1',
  approvalBatches: [] as ApprovalBatch[],
  approvalsLoading: false,
  pendingApprovals: 0,
  effectiveTier: 'growth' as const,
  setApprovalBatches: vi.fn(),
  loadApprovals: vi.fn(),
  setToast: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalsTab — basic rendering', () => {
  it('renders without crashing when batches are empty', () => {
    render(<ApprovalsTab {...baseProps} />);
    expect(screen.getByText('SEO Change Approvals')).toBeInTheDocument();
  });

  it('shows description text', () => {
    render(<ApprovalsTab {...baseProps} />);
    expect(screen.getByText(/Review proposed SEO changes/i)).toBeInTheDocument();
  });

  it('does not show pending badge when pendingApprovals is 0', () => {
    render(<ApprovalsTab {...baseProps} />);
    // The badge text is "N pending" — only the empty state message contains "pending"
    // which reads "No pending approvals" — so we check the badge specifically
    expect(screen.queryByText(/^\d+ pending$/)).not.toBeInTheDocument();
  });

  it('shows pending badge when pendingApprovals > 0', () => {
    render(<ApprovalsTab {...baseProps} pendingApprovals={3} />);
    expect(screen.getByText('3 pending')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalsTab — loading state', () => {
  it('shows loading state while approvalsLoading is true', () => {
    render(<ApprovalsTab {...baseProps} approvalsLoading={true} />);
    expect(screen.getByText(/Loading approvals/i)).toBeInTheDocument();
  });

  it('does not show loading state when approvalsLoading is false', () => {
    render(<ApprovalsTab {...baseProps} approvalsLoading={false} />);
    expect(screen.queryByText(/Loading approvals/i)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalsTab — empty state', () => {
  it('shows empty state when no batches and not loading', () => {
    render(<ApprovalsTab {...baseProps} />);
    expect(screen.getByText('No pending approvals')).toBeInTheDocument();
  });

  it('shows empty state description text', () => {
    render(<ApprovalsTab {...baseProps} />);
    expect(screen.getByText(/Your agency will send SEO changes here/i)).toBeInTheDocument();
  });

  it('does not show empty state while loading', () => {
    render(<ApprovalsTab {...baseProps} approvalsLoading={true} />);
    expect(screen.queryByText('No pending approvals')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalsTab — batch rendering', () => {
  it('renders batch name as section heading', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} pendingApprovals={1} />);
    expect(screen.getByText('May SEO Batch')).toBeInTheDocument();
  });

  it('shows item count in batch subtitle', () => {
    const batch = makeBatch({ items: [makeItem(), makeItem({ id: 'item-2' })] });
    render(<ApprovalsTab {...baseProps} approvalBatches={[batch]} />);
    // Multiple "2 changes" nodes may appear — assert at least one exists
    expect(screen.getAllByText(/2 changes/i).length).toBeGreaterThan(0);
  });

  it('shows page title in item row', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByText('Home Page')).toBeInTheDocument();
  });

  it('shows page slug in item row', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByText('/home')).toBeInTheDocument();
  });

  it('shows pending badge on batch when items are pending', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    // "1 pending" badge should appear on the batch card
    expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
  });

  it('shows proposed value for non-schema fields', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByText('New SEO Title')).toBeInTheDocument();
  });

  it('shows current value for the item', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByText('Old Title')).toBeInTheDocument();
  });

  it('shows reason text when item has a reason', () => {
    const item = makeItem({ reason: 'Missing target keyword in title' });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    expect(screen.getByText(/Missing target keyword/i)).toBeInTheDocument();
  });

  it('shows field label "SEO Title" for seoTitle field', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByText('SEO Title')).toBeInTheDocument();
  });

  it('shows field label "Meta Description" for seoDescription field', () => {
    const item = makeItem({ field: 'seoDescription', proposedValue: 'New description' });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    expect(screen.getByText('Meta Description')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalsTab — filter bar', () => {
  it('shows filter bar when batches exist', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    // Multiple "All" buttons may exist (filter + confirm); assert at least one
    expect(screen.getAllByRole('button', { name: /All/i }).length).toBeGreaterThan(0);
  });

  it('shows Needs Action filter chip', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByRole('button', { name: /Needs Action/i })).toBeInTheDocument();
  });

  it('shows Ready to Apply filter chip', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByRole('button', { name: /Ready to Apply/i })).toBeInTheDocument();
  });

  it('shows Applied filter chip', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByRole('button', { name: /Applied/i })).toBeInTheDocument();
  });

  it('does not show filter bar when no batches', () => {
    render(<ApprovalsTab {...baseProps} />);
    expect(screen.queryByRole('button', { name: /Needs Action/i })).not.toBeInTheDocument();
  });

  it('clicking Needs Action filter shows only pending batches', () => {
    const pending = makeBatch({ id: 'b1', name: 'Pending Batch' });
    const applied = makeBatch({
      id: 'b2',
      name: 'Applied Batch',
      items: [makeItem({ status: 'applied' })],
    });
    render(<ApprovalsTab {...baseProps} approvalBatches={[pending, applied]} />);
    fireEvent.click(screen.getByRole('button', { name: /Needs Action/i }));
    expect(screen.getByText('Pending Batch')).toBeInTheDocument();
    expect(screen.queryByText('Applied Batch')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalsTab — item status states', () => {
  it('shows Approve button for pending items (non-free tier)', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    // Both item-level Approve and batch-level "Approve All" buttons appear
    const approveBtns = screen.getAllByRole('button', { name: /Approve/i });
    expect(approveBtns.length).toBeGreaterThan(0);
  });

  it('shows Edit button for non-schema pending items', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
  });

  it('shows Reject button for pending items', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument();
  });

  it('shows tier gate for free tier instead of action buttons', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} effectiveTier="free" />);
    // TierGate renders a "Upgrade" prompt — no Approve button visible
    expect(screen.queryByRole('button', { name: /^Approve$/i })).not.toBeInTheDocument();
  });

  it('shows approved status when item is approved', () => {
    const item = makeItem({ status: 'approved' });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    expect(screen.getByText(/Approved — will be applied/i)).toBeInTheDocument();
  });

  it('shows Undo button for approved item', () => {
    const item = makeItem({ status: 'approved' });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    expect(screen.getByRole('button', { name: /Undo/i })).toBeInTheDocument();
  });

  it('shows rejected status when item is rejected', () => {
    const item = makeItem({ status: 'rejected' });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    // "Rejected" appears in the status badge and as inline text — assert at least one
    expect(screen.getAllByText(/Rejected/i).length).toBeGreaterThan(0);
  });

  it('shows client rejection note when present', () => {
    const item = makeItem({ status: 'rejected', clientNote: 'Wrong keyword' });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    expect(screen.getByText(/Wrong keyword/i)).toBeInTheDocument();
  });

  it('shows applied status with date', () => {
    const item = makeItem({ status: 'applied', updatedAt: '2026-05-10T12:00:00.000Z' });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    expect(screen.getByText(/Applied to live site/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalsTab — batch-level approve all', () => {
  it('shows "Approve All" button when batch has pending items and tier is not free', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByRole('button', { name: /Approve All/i })).toBeInTheDocument();
  });

  it('does not show "Approve All" when tier is free', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} effectiveTier="free" />);
    expect(screen.queryByRole('button', { name: /Approve All \(/i })).not.toBeInTheDocument();
  });

  it('does not show "Approve All" when no items are pending', () => {
    const item = makeItem({ status: 'approved' });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    expect(screen.queryByRole('button', { name: /Approve All \(/i })).not.toBeInTheDocument();
  });

  it('clicking Approve All opens a confirm dialog', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve All/i }));
    expect(screen.getByText(/Approve all changes/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalsTab — schema field', () => {
  it('shows "Structured Data (JSON-LD)" label for schema field', () => {
    const item = makeItem({
      field: 'schema',
      proposedValue: JSON.stringify({ '@graph': [{ '@type': 'Organization' }] }),
    });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    expect(screen.getByText('Structured Data (JSON-LD)')).toBeInTheDocument();
  });

  it('shows schema type badge for parsed schema types', () => {
    const item = makeItem({
      field: 'schema',
      proposedValue: JSON.stringify({ '@graph': [{ '@type': 'Organization' }] }),
    });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    expect(screen.getByText('Organization')).toBeInTheDocument();
  });

  it('does not show Edit button for schema items', () => {
    const item = makeItem({
      field: 'schema',
      proposedValue: '{}',
    });
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch({ items: [item] })]} />);
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalsTab — collapsible page rows', () => {
  it('page items are visible by default (not collapsed)', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    expect(screen.getByText('New SEO Title')).toBeInTheDocument();
  });

  it('clicking page row header toggles collapse', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    const pageRow = screen.getByText('Home Page');
    fireEvent.click(pageRow);
    // After collapse the proposed value should not be visible
    expect(screen.queryByText('New SEO Title')).not.toBeInTheDocument();
    // Clicking again re-expands
    fireEvent.click(pageRow);
    expect(screen.getByText('New SEO Title')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalsTab — reject flow', () => {
  it('clicking Reject shows rejection note input', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    expect(screen.getByPlaceholderText(/Reason for rejection/i)).toBeInTheDocument();
  });

  it('reject flow shows Confirm Reject button', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    expect(screen.getByRole('button', { name: /Confirm Reject/i })).toBeInTheDocument();
  });

  it('cancel rejection returns to normal state', () => {
    render(<ApprovalsTab {...baseProps} approvalBatches={[makeBatch()]} />);
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByPlaceholderText(/Reason for rejection/i)).not.toBeInTheDocument();
  });
});
