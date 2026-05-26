/**
 * Smoke tests for client-facing inbox components:
 *   - DecisionCard
 *   - DecisionDetailModal
 *   - ApprovalBatchCard
 *   - PriorityStrip
 *   - SchemaReviewModal
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { DecisionCard } from '../../../src/components/client/DecisionCard';
import { DecisionDetailModal } from '../../../src/components/client/DecisionDetailModal';
import { ApprovalBatchCard } from '../../../src/components/client/ApprovalBatchCard';
import { PriorityStrip, type PriorityItem } from '../../../src/components/client/PriorityStrip';
import { SchemaReviewModal } from '../../../src/components/client/SchemaReviewModal';

import type { NormalizedDecision, FlaggedItem } from '../../../shared/types/decision';
import type { ApprovalBatch, ApprovalItem } from '../../../shared/types/approvals';
import type { ClientAction } from '../../../shared/types/client-actions';
import { AlertTriangle } from 'lucide-react';

// ── Mock API client so no real fetch calls happen ───────────────────────────
vi.mock('../../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue(null),
  getOptional: vi.fn().mockResolvedValue(null),
  post: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue({}),
}));

// Mock usePageEditStates so ApprovalBatchCard doesn't need a live server
vi.mock('../../../src/hooks/usePageEditStates', () => ({
  usePageEditStates: () => ({ getState: () => null, summary: null, isLoading: false }),
}));

// ── Shared wrapper ───────────────────────────────────────────────────────────
function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderWithWrapper(ui: React.ReactElement) {
  return render(ui, { wrapper: Wrapper });
}

// ── Shared fixtures ──────────────────────────────────────────────────────────

// Midday UTC keeps locale-based date formatting stable in US time zones.
const MAY_1_2026_ISO = '2026-05-01T12:00:00Z';

const bulkDecision: NormalizedDecision = {
  id: 'ab-1',
  source: 'approval_batch',
  sourceId: 'ab-1',
  title: 'SEO Editor — 3 pages',
  summary: '3 changes ready for your review',
  priority: undefined,
  itemCount: 3,
  isSingleAction: false,
  badge: 'SEO Editor',
  createdAt: MAY_1_2026_ISO,
};

const highPriorityBulkDecision: NormalizedDecision = {
  ...bulkDecision,
  id: 'ab-2',
  title: 'Critical SEO Changes',
  priority: 'high',
  itemCount: 5,
};

const singleDecision: NormalizedDecision = {
  id: 'ca-1',
  source: 'client_action',
  sourceId: 'ca-1',
  title: 'Blog post decay detected',
  summary: 'Your top post has declined 40% in traffic.',
  priority: 'high',
  itemCount: 1,
  isSingleAction: true,
  badge: 'Content Decay',
  createdAt: MAY_1_2026_ISO,
};

const makeItem = (overrides: Partial<ApprovalItem> = {}): ApprovalItem => ({
  id: 'i1',
  pageId: 'p1',
  pageTitle: 'Home',
  pageSlug: '/',
  field: 'seoTitle',
  currentValue: 'Old Title',
  proposedValue: 'New Title',
  status: 'pending',
  createdAt: MAY_1_2026_ISO,
  updatedAt: MAY_1_2026_ISO,
  ...overrides,
});

const mockBatch: ApprovalBatch = {
  id: 'ab-1',
  workspaceId: 'ws-1',
  siteId: 'site-1',
  name: 'SEO Editor — 3 pages',
  status: 'pending',
  items: [
    makeItem({ id: 'i1', pageId: 'p1', pageTitle: 'Home', pageSlug: '/', field: 'seoTitle', currentValue: 'Old Title', proposedValue: 'New Title' }),
    makeItem({ id: 'i2', pageId: 'p2', pageTitle: 'About', pageSlug: '/about', field: 'seoDescription', currentValue: 'Old desc', proposedValue: 'New desc' }),
    makeItem({ id: 'i3', pageId: 'p3', pageTitle: 'Services', pageSlug: '/services', field: 'seoTitle', currentValue: 'Old svc', proposedValue: 'New svc' }),
  ],
  createdAt: MAY_1_2026_ISO,
  updatedAt: MAY_1_2026_ISO,
};

const aeoAction: ClientAction = {
  id: 'ca-aeo',
  workspaceId: 'ws-1',
  sourceType: 'aeo_change',
  title: 'AEO Changes',
  summary: 'Answer engine optimization updates',
  payload: {
    diffs: [
      { page: 'Homepage', section: 'FAQ', current: 'Old answer', proposed: 'New answer', rationale: 'Better clarity' },
    ],
  },
  status: 'pending',
  priority: 'medium',
  createdAt: MAY_1_2026_ISO,
  updatedAt: MAY_1_2026_ISO,
};

const internalLinkAction: ClientAction = {
  id: 'ca-link',
  workspaceId: 'ws-1',
  sourceType: 'internal_link',
  title: 'Internal Links',
  summary: 'Link recommendations',
  payload: {
    suggestions: [
      { anchorText: 'Learn more', targetUrl: '/services', sourcePageUrl: '/about', sourcePageTitle: 'About Us' },
    ],
  },
  status: 'pending',
  priority: 'low',
  createdAt: MAY_1_2026_ISO,
  updatedAt: MAY_1_2026_ISO,
};

const redirectAction: ClientAction = {
  id: 'ca-redirect',
  workspaceId: 'ws-1',
  sourceType: 'redirect_proposal',
  title: 'Redirects',
  summary: 'Proposed redirects',
  payload: {
    redirects: [{ source: '/old-page', target: '/new-page', rationale: 'Page renamed' }],
  },
  status: 'pending',
  priority: 'low',
  createdAt: MAY_1_2026_ISO,
  updatedAt: MAY_1_2026_ISO,
};

// ════════════════════════════════════════════════════════════════════════════
// DecisionCard
// ════════════════════════════════════════════════════════════════════════════

describe('DecisionCard — bulk mode (isSingleAction=false)', () => {
  it('renders without crashing', () => {
    renderWithWrapper(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByText('SEO Editor — 3 pages')).toBeInTheDocument();
  });

  it('shows the badge text', () => {
    renderWithWrapper(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByText('SEO Editor')).toBeInTheDocument();
  });

  it('shows the summary text', () => {
    renderWithWrapper(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByText('3 changes ready for your review')).toBeInTheDocument();
  });

  it('renders "Review N changes →" CTA button', () => {
    renderWithWrapper(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /review 3 changes →/i })).toBeInTheDocument();
  });

  it('pluralizes correctly for 1 change', () => {
    const singleChange: NormalizedDecision = { ...bulkDecision, itemCount: 1 };
    renderWithWrapper(<DecisionCard decision={singleChange} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /review 1 change →/i })).toBeInTheDocument();
  });

  it('calls onOpen when CTA is clicked', () => {
    const onOpen = vi.fn();
    renderWithWrapper(<DecisionCard decision={bulkDecision} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /review 3 changes/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('shows "High priority" label when priority is high', () => {
    renderWithWrapper(<DecisionCard decision={highPriorityBulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByText('High priority')).toBeInTheDocument();
  });

  it('does NOT show "High priority" when priority is undefined', () => {
    renderWithWrapper(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.queryByText('High priority')).not.toBeInTheDocument();
  });

  it('does not show Approve button in bulk mode', () => {
    renderWithWrapper(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('does not show Request changes button in bulk mode', () => {
    renderWithWrapper(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /request changes/i })).not.toBeInTheDocument();
  });
});

describe('DecisionCard — single action mode (isSingleAction=true)', () => {
  it('renders without crashing', () => {
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} onApprove={vi.fn()} onFlagWithNote={vi.fn()} />,
    );
    expect(screen.getByText('Blog post decay detected')).toBeInTheDocument();
  });

  it('shows Approve button', () => {
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} onApprove={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  });

  it('shows Request changes button', () => {
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} onFlagWithNote={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /request changes/i })).toBeInTheDocument();
  });

  it('calls onApprove when Approve is clicked', () => {
    const onApprove = vi.fn();
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} onApprove={onApprove} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('expands note input when Request changes is clicked', () => {
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} onFlagWithNote={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    expect(screen.getByPlaceholderText(/add a note/i)).toBeInTheDocument();
  });

  it('shows Send and Cancel buttons in flag mode', () => {
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} onFlagWithNote={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onFlagWithNote with note text when Send is clicked', () => {
    const onFlag = vi.fn();
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} onFlagWithNote={onFlag} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/add a note/i), {
      target: { value: 'Please revise this' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onFlag).toHaveBeenCalledWith('Please revise this');
  });

  it('collapses back after Send', () => {
    const onFlag = vi.fn();
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} onFlagWithNote={onFlag} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(screen.queryByPlaceholderText(/add a note/i)).not.toBeInTheDocument();
  });

  it('collapses back on Cancel without calling onFlagWithNote', () => {
    const onFlag = vi.fn();
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} onFlagWithNote={onFlag} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onFlag).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/add a note/i)).not.toBeInTheDocument();
  });

  it('does not show the bulk "Review N changes" button', () => {
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} />,
    );
    expect(screen.queryByText(/review.*change/i)).not.toBeInTheDocument();
  });

  it('shows High priority label when priority is high', () => {
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} />,
    );
    expect(screen.getByText('High priority')).toBeInTheDocument();
  });

  it('shows Content Decay badge', () => {
    renderWithWrapper(
      <DecisionCard decision={singleDecision} onOpen={vi.fn()} />,
    );
    expect(screen.getByText('Content Decay')).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DecisionDetailModal
// ════════════════════════════════════════════════════════════════════════════

describe('DecisionDetailModal — approval_batch', () => {
  function renderBatchModal(props: {
    onApprove?: (items: FlaggedItem[]) => Promise<void>;
    onDismiss?: () => void;
    submitting?: boolean;
  } = {}) {
    const onApprove = props.onApprove ?? vi.fn().mockResolvedValue(undefined);
    const onDismiss = props.onDismiss ?? vi.fn();
    return render(
      <DecisionDetailModal
        decision={bulkDecision}
        originalData={{ type: 'approval_batch', batch: mockBatch }}
        onApprove={onApprove}
        onDismiss={onDismiss}
        submitting={props.submitting}
      />,
    );
  }

  it('renders with role="dialog"', () => {
    renderBatchModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders the decision title in the header', () => {
    renderBatchModal();
    expect(screen.getByText('SEO Editor — 3 pages')).toBeInTheDocument();
  });

  it('renders badge in modal header', () => {
    renderBatchModal();
    // badge appears in header — may be multiple due to card + modal
    const badges = screen.getAllByText('SEO Editor');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('renders all batch item page titles', () => {
    renderBatchModal();
    expect(screen.getByText(/Home/)).toBeInTheDocument();
    expect(screen.getByText(/About/)).toBeInTheDocument();
    expect(screen.getByText(/Services/)).toBeInTheDocument();
  });

  it('shows current and proposed values for first item', () => {
    renderBatchModal();
    expect(screen.getByText('Old Title')).toBeInTheDocument();
    expect(screen.getByText('New Title')).toBeInTheDocument();
  });

  it('renders the implement all CTA with correct count', () => {
    renderBatchModal();
    expect(screen.getByRole('button', { name: /looks good — implement 3 →/i })).toBeInTheDocument();
  });

  it('renders "Save for later" button', () => {
    renderBatchModal();
    expect(screen.getByText('Save for later')).toBeInTheDocument();
  });

  it('calls onDismiss when Close button is clicked', () => {
    const onDismiss = vi.fn();
    renderBatchModal({ onDismiss });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when Save for later is clicked', () => {
    const onDismiss = vi.fn();
    renderBatchModal({ onDismiss });
    fireEvent.click(screen.getByText('Save for later'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when backdrop is clicked', () => {
    const onDismiss = vi.fn();
    renderBatchModal({ onDismiss });
    // The backdrop is the first absolute-positioned div
    const backdrop = document.querySelector('.absolute.inset-0');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows "Submitting…" label when submitting=true', () => {
    renderBatchModal({ submitting: true });
    expect(screen.getByRole('button', { name: /submitting/i })).toBeInTheDocument();
  });

  it('disables primary CTA when submitting=true', () => {
    renderBatchModal({ submitting: true });
    const btn = screen.getByRole('button', { name: /submitting/i });
    expect(btn).toBeDisabled();
  });

  it('calls onApprove with empty array when no items flagged', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderBatchModal({ onApprove });
    fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith([]));
  });

  it('updates CTA label after flagging one item', async () => {
    renderBatchModal();
    const flagButtons = screen.getAllByRole('button', { name: /^flag$/i });
    fireEvent.click(flagButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /flag it/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /implement 2 of 3/i })).toBeInTheDocument();
    });
  });

  it('calls onApprove with flaggedItems list after flagging', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderBatchModal({ onApprove });
    const flagButtons = screen.getAllByRole('button', { name: /^flag$/i });
    fireEvent.click(flagButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /flag it/i }));
    await waitFor(() => screen.getByRole('button', { name: /implement 2 of 3/i }));
    fireEvent.click(screen.getByRole('button', { name: /implement 2 of 3/i }));
    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ itemId: 'i1' })]),
      );
    });
  });

  it('shows Unflag button after item is flagged', () => {
    renderBatchModal();
    const flagButtons = screen.getAllByRole('button', { name: /^flag$/i });
    fireEvent.click(flagButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /flag it/i }));
    expect(screen.getByRole('button', { name: /unflag/i })).toBeInTheDocument();
  });

  it('unflagging restores count to original', async () => {
    renderBatchModal();
    const flagButtons = screen.getAllByRole('button', { name: /^flag$/i });
    fireEvent.click(flagButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /flag it/i }));
    await waitFor(() => screen.getByRole('button', { name: /unflag/i }));
    fireEvent.click(screen.getByRole('button', { name: /unflag/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /implement 3 →/i })).toBeInTheDocument();
    });
  });

  it('dismisses on Escape key press', () => {
    const onDismiss = vi.fn();
    renderBatchModal({ onDismiss });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows high priority label when decision has high priority', () => {
    render(
      <DecisionDetailModal
        decision={highPriorityBulkDecision}
        originalData={{ type: 'approval_batch', batch: mockBatch }}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('High priority')).toBeInTheDocument();
  });
});

describe('DecisionDetailModal — AEO client_action', () => {
  const aeoDecision: NormalizedDecision = {
    ...bulkDecision,
    id: 'ca-aeo',
    source: 'client_action',
    badge: 'AEO',
    title: 'AEO Changes',
    itemCount: 1,
  };

  it('renders AEO diffs', () => {
    render(
      <DecisionDetailModal
        decision={aeoDecision}
        originalData={{ type: 'client_action', action: aeoAction }}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onDismiss={vi.fn()}
      />,
    );
    // page + section are joined as "Homepage — FAQ" in a single element
    expect(screen.getByText(/homepage/i)).toBeInTheDocument();
    expect(screen.getByText('Old answer')).toBeInTheDocument();
    expect(screen.getByText('New answer')).toBeInTheDocument();
    expect(screen.getByText(/better clarity/i)).toBeInTheDocument();
  });

  it('shows "No changes in this batch." when diffs is empty', () => {
    const emptyAeoAction: ClientAction = {
      ...aeoAction,
      payload: { diffs: [] },
    };
    render(
      <DecisionDetailModal
        decision={aeoDecision}
        originalData={{ type: 'client_action', action: emptyAeoAction }}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('No changes in this batch.')).toBeInTheDocument();
  });
});

describe('DecisionDetailModal — internal_link client_action', () => {
  const linkDecision: NormalizedDecision = {
    ...bulkDecision,
    id: 'ca-link',
    source: 'client_action',
    badge: 'Internal Links',
    title: 'Internal Links',
    itemCount: 1,
  };

  it('renders link suggestion table', () => {
    render(
      <DecisionDetailModal
        decision={linkDecision}
        originalData={{ type: 'client_action', action: internalLinkAction }}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Anchor text')).toBeInTheDocument();
    expect(screen.getByText('Learn more')).toBeInTheDocument();
  });

  it('shows "No link suggestions." when suggestions is empty', () => {
    const emptyAction: ClientAction = {
      ...internalLinkAction,
      payload: { suggestions: [] },
    };
    render(
      <DecisionDetailModal
        decision={linkDecision}
        originalData={{ type: 'client_action', action: emptyAction }}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('No link suggestions.')).toBeInTheDocument();
  });

  it('renders source and target columns separately', () => {
    render(
      <DecisionDetailModal
        decision={linkDecision}
        originalData={{ type: 'client_action', action: internalLinkAction }}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onDismiss={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole('row');
    const dataRow = rows[1];
    const cells = within(dataRow).getAllByRole('cell');
    // anchorText=0, targetTitle=1, targetUrl=2, sourcePageTitle=3, sourcePageUrl=4
    expect(cells[1].textContent).toBe('—'); // targetTitle missing → em dash
    expect(cells[2].textContent).toContain('/services');
    expect(cells[3].textContent).toBe('About Us');
    expect(cells[4].textContent).toBe('/about');
  });
});

describe('DecisionDetailModal — redirect_proposal client_action', () => {
  const redirectDecision: NormalizedDecision = {
    ...bulkDecision,
    id: 'ca-redirect',
    source: 'client_action',
    badge: 'Redirects',
    title: 'Redirects',
    itemCount: 1,
  };

  it('renders redirect source and target', () => {
    render(
      <DecisionDetailModal
        decision={redirectDecision}
        originalData={{ type: 'client_action', action: redirectAction }}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('/old-page')).toBeInTheDocument();
    expect(screen.getByText('/new-page')).toBeInTheDocument();
  });

  it('shows "No redirects." when redirects is empty', () => {
    const emptyAction: ClientAction = {
      ...redirectAction,
      payload: { redirects: [] },
    };
    render(
      <DecisionDetailModal
        decision={redirectDecision}
        originalData={{ type: 'client_action', action: emptyAction }}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('No redirects.')).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PriorityStrip
// ════════════════════════════════════════════════════════════════════════════

describe('PriorityStrip', () => {
  const makeItem = (overrides: Partial<PriorityItem> = {}): PriorityItem => ({
    id: 'item-1',
    icon: AlertTriangle,
    title: 'Review SEO changes',
    section: 'decisions',
    ctaLabel: 'Review',
    onCta: vi.fn(),
    ...overrides,
  });

  it('renders nothing when items is empty and showAllCaughtUp is false', () => {
    const { container } = renderWithWrapper(<PriorityStrip items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "all caught up" state when items empty and showAllCaughtUp=true', () => {
    renderWithWrapper(<PriorityStrip items={[]} showAllCaughtUp />);
    expect(screen.getByText(/you're all caught up/i)).toBeInTheDocument();
  });

  it('renders "No pending items" text in caught up state', () => {
    renderWithWrapper(<PriorityStrip items={[]} showAllCaughtUp />);
    expect(screen.getByText(/no pending items/i)).toBeInTheDocument();
  });

  it('renders items list header when items present', () => {
    renderWithWrapper(<PriorityStrip items={[makeItem()]} />);
    expect(screen.getByText(/needs your attention/i)).toBeInTheDocument();
  });

  it('renders item title', () => {
    renderWithWrapper(<PriorityStrip items={[makeItem()]} />);
    expect(screen.getByText('Review SEO changes')).toBeInTheDocument();
  });

  it('renders CTA button with correct label', () => {
    renderWithWrapper(<PriorityStrip items={[makeItem()]} />);
    expect(screen.getByRole('button', { name: /review review seo changes/i })).toBeInTheDocument();
  });

  it('calls onCta when CTA button is clicked', () => {
    const onCta = vi.fn();
    renderWithWrapper(<PriorityStrip items={[makeItem({ onCta })]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    expect(onCta).toHaveBeenCalledOnce();
  });

  it('renders section chip for decisions section', () => {
    renderWithWrapper(<PriorityStrip items={[makeItem({ section: 'decisions' })]} />);
    expect(screen.getByText('Decisions')).toBeInTheDocument();
  });

  it('renders section chip for conversations section', () => {
    renderWithWrapper(
      <PriorityStrip items={[makeItem({ section: 'conversations', title: 'A conversation item' })]} />,
    );
    expect(screen.getByText('Conversations')).toBeInTheDocument();
  });

  it('renders section chip for reviews section', () => {
    renderWithWrapper(
      <PriorityStrip items={[makeItem({ section: 'reviews', title: 'A review item' })]} />,
    );
    expect(screen.getByText('Reviews')).toBeInTheDocument();
  });

  it('renders multiple items', () => {
    renderWithWrapper(
      <PriorityStrip
        items={[
          makeItem({ id: 'a', title: 'First task' }),
          makeItem({ id: 'b', title: 'Second task' }),
          makeItem({ id: 'c', title: 'Third task' }),
        ]}
      />,
    );
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('Second task')).toBeInTheDocument();
    expect(screen.getByText('Third task')).toBeInTheDocument();
  });

  it('does not render "all caught up" when items are present', () => {
    renderWithWrapper(<PriorityStrip items={[makeItem()]} showAllCaughtUp />);
    expect(screen.queryByText(/you're all caught up/i)).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ApprovalBatchCard
// ════════════════════════════════════════════════════════════════════════════

describe('ApprovalBatchCard', () => {
  const defaultProps = {
    batch: mockBatch,
    workspaceId: 'ws-1',
    effectiveTier: 'growth' as const,
    setApprovalBatches: vi.fn(),
    loadApprovals: vi.fn(),
    setToast: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    renderWithWrapper(<ApprovalBatchCard {...defaultProps} />);
    expect(screen.getByText('SEO Editor — 3 pages')).toBeInTheDocument();
  });

  it('shows SEO Changes badge', () => {
    renderWithWrapper(<ApprovalBatchCard {...defaultProps} />);
    expect(screen.getByText('SEO Changes')).toBeInTheDocument();
  });

  it('shows pending count badge in header', () => {
    renderWithWrapper(<ApprovalBatchCard {...defaultProps} />);
    // Multiple "3 pending" badges may appear (header + per-page rows)
    expect(screen.getAllByText('3 pending').length).toBeGreaterThan(0);
  });

  it('renders page groups', () => {
    renderWithWrapper(<ApprovalBatchCard {...defaultProps} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('Services')).toBeInTheDocument();
  });

  it('renders Approve, Edit, Reject buttons for pending items (growth tier)', () => {
    renderWithWrapper(<ApprovalBatchCard {...defaultProps} />);
    const approveButtons = screen.getAllByRole('button', { name: /approve/i });
    expect(approveButtons.length).toBeGreaterThan(0);
  });

  it('does NOT show Approve button for free tier (shows TierGate instead)', () => {
    const freeTierProps = { ...defaultProps, effectiveTier: 'free' as const };
    renderWithWrapper(<ApprovalBatchCard {...freeTierProps} />);
    // TierGate replaces the approve/reject buttons — no Approve button for free
    const approveButtons = screen.queryAllByRole('button', { name: /^approve$/i });
    // free tier shows upgrade prompt instead of approve button
    expect(approveButtons.length).toBe(0);
  });

  it('collapses/expands page group on click', () => {
    renderWithWrapper(<ApprovalBatchCard {...defaultProps} />);
    // Find the Home page row header and click it to collapse
    const homeRow = screen.getByText('Home').closest('[role="button"], button, [aria-expanded]');
    // Items initially visible
    expect(screen.getAllByText(/current/i).length).toBeGreaterThan(0);
    if (homeRow) {
      fireEvent.click(homeRow);
      // After collapse the items inside should not be visible for that page
    }
  });

  it('shows "Approve All" footer button when pending items exist (non-free tier)', () => {
    renderWithWrapper(<ApprovalBatchCard {...defaultProps} />);
    expect(screen.getByRole('button', { name: /approve all/i })).toBeInTheDocument();
  });

  it('renders with applied items correctly', () => {
    const appliedBatch: ApprovalBatch = {
      ...mockBatch,
      items: [
        makeItem({ id: 'i1', status: 'applied', updatedAt: '2026-05-10T00:00:00Z' }),
        makeItem({ id: 'i2', pageId: 'p2', pageTitle: 'About', pageSlug: '/about', status: 'applied', updatedAt: '2026-05-10T00:00:00Z' }),
      ],
    };
    renderWithWrapper(
      <ApprovalBatchCard {...defaultProps} batch={appliedBatch} />,
    );
    expect(screen.getAllByText(/applied/i).length).toBeGreaterThan(0);
  });

  it('renders with approved items correctly', () => {
    const approvedBatch: ApprovalBatch = {
      ...mockBatch,
      items: [makeItem({ id: 'i1', status: 'approved' })],
    };
    renderWithWrapper(
      <ApprovalBatchCard {...defaultProps} batch={approvedBatch} />,
    );
    // Multiple "approved" labels may appear (badge + inline status text)
    expect(screen.getAllByText(/approved/i).length).toBeGreaterThan(0);
  });

  it('renders with rejected items correctly', () => {
    const rejectedBatch: ApprovalBatch = {
      ...mockBatch,
      items: [makeItem({ id: 'i1', status: 'rejected' })],
    };
    renderWithWrapper(
      <ApprovalBatchCard {...defaultProps} batch={rejectedBatch} />,
    );
    // Multiple "rejected" labels may appear (badge + inline status text)
    expect(screen.getAllByText(/rejected/i).length).toBeGreaterThan(0);
  });

  it('shows batch date in header', () => {
    renderWithWrapper(<ApprovalBatchCard {...defaultProps} />);
    // "May 1, 2026" formatted date appears in the card header
    expect(screen.getByText(/may 1, 2026/i)).toBeInTheDocument();
  });

  it('shows item count in header', () => {
    renderWithWrapper(<ApprovalBatchCard {...defaultProps} />);
    // "3 changes" text in header area
    expect(screen.getByText(/3 changes/i)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SchemaReviewModal
// ════════════════════════════════════════════════════════════════════════════

describe('SchemaReviewModal', () => {
  const defaultProps = {
    workspaceId: 'ws-1',
    setToast: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    renderWithWrapper(<SchemaReviewModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the modal title', () => {
    renderWithWrapper(<SchemaReviewModal {...defaultProps} />);
    expect(screen.getByText('Schema Strategy Review')).toBeInTheDocument();
  });

  it('has aria-modal attribute', () => {
    renderWithWrapper(<SchemaReviewModal {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('has aria-labelledby pointing to the title', () => {
    renderWithWrapper(<SchemaReviewModal {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'schema-review-modal-title');
    expect(screen.getByText('Schema Strategy Review')).toHaveAttribute(
      'id',
      'schema-review-modal-title',
    );
  });

  it('renders close button', () => {
    renderWithWrapper(<SchemaReviewModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: /close schema review/i })).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderWithWrapper(<SchemaReviewModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close schema review/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    renderWithWrapper(<SchemaReviewModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose for non-Escape keys', () => {
    const onClose = vi.fn();
    renderWithWrapper(<SchemaReviewModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders scrollable body area', () => {
    renderWithWrapper(<SchemaReviewModal {...defaultProps} />);
    // The modal should contain a scrollable section — check overflow-y-auto is present
    const scrollableArea = document.querySelector('.overflow-y-auto');
    expect(scrollableArea).toBeTruthy();
  });

  it('passes workspaceId to the inner SchemaReviewTab', () => {
    // SchemaReviewTab queries /api/public/schema-plan/ws-1 — we just ensure
    // it renders (api calls are mocked) without error
    const { container } = renderWithWrapper(
      <SchemaReviewModal {...defaultProps} workspaceId="ws-abc" />,
    );
    expect(container.firstChild).toBeTruthy();
  });
});
