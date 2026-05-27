/**
 * Component tests for InboxTab.
 *
 * Heavy sub-components (ApprovalsTab, RequestsTab, ContentTab, ClientCopyReview,
 * SchemaReviewModal, ApprovalBatchCard, DecisionCard, DecisionDetailModal,
 * ClientActionDetailModal) are stubbed so tests remain focused on InboxTab's own
 * behaviour: header, mode toggle, filter chip routing via ?tab= param, section
 * visibility, and empty states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InboxTab } from '../../../src/components/client/InboxTab';
import type { ApprovalBatch, ClientRequest, ClientContentRequest } from '../../../src/components/client/types';
import type { ClientAction } from '../../../shared/types/client-actions';

// ── BetaContext ───────────────────────────────────────────────────────────────
vi.mock('../../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

// ── Feature flags — new-inbox-ia off by default ───────────────────────────────
let mockNewInboxIa = false;
vi.mock('../../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (key: string) => key === 'new-inbox-ia' ? mockNewInboxIa : false,
}));

// ── API client ────────────────────────────────────────────────────────────────
vi.mock('../../../src/api/client', () => ({
  patch: vi.fn(() => Promise.resolve({})),
  post: vi.fn(() => Promise.resolve({})),
  get: vi.fn(),
  getOptional: vi.fn(() => Promise.resolve(null)),
  del: vi.fn(),
}));

// ── React Query ───────────────────────────────────────────────────────────────
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => ({ data: null, isLoading: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

// ── Heavy sub-components ──────────────────────────────────────────────────────
vi.mock('../../../src/components/client/ApprovalsTab', () => ({
  ApprovalsTab: () => <div data-testid="approvals-tab" />,
}));

vi.mock('../../../src/components/client/RequestsTab', () => ({
  RequestsTab: () => <div data-testid="requests-tab" />,
}));

vi.mock('../../../src/components/client/ContentTab', () => ({
  ContentTab: () => <div data-testid="content-tab" />,
}));

vi.mock('../../../src/components/client/ClientCopyReview', () => ({
  ClientCopyReview: () => <div data-testid="copy-review" />,
}));

vi.mock('../../../src/components/client/SchemaReviewModal', () => ({
  SchemaReviewModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="schema-modal">
      <button onClick={onClose}>Close schema modal</button>
    </div>
  ),
}));

vi.mock('../../../src/components/client/ApprovalBatchCard', () => ({
  ApprovalBatchCard: ({ batch }: { batch: ApprovalBatch }) => (
    <div data-testid="approval-batch-card">{batch.name}</div>
  ),
}));

vi.mock('../../../src/components/client/DecisionCard', () => ({
  DecisionCard: ({ decision }: { decision: { title: string } }) => (
    <div data-testid="decision-card">{decision.title}</div>
  ),
}));

vi.mock('../../../src/components/client/DecisionDetailModal', () => ({
  DecisionDetailModal: () => <div data-testid="decision-detail-modal" />,
}));

vi.mock('../../../src/components/client/ClientActionDetailModal', () => ({
  ClientActionDetailModal: () => <div data-testid="client-action-detail-modal" />,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApprovalBatch(overrides: Partial<ApprovalBatch> = {}): ApprovalBatch {
  return {
    id: 'batch-1',
    workspaceId: 'ws-1',
    siteId: 'site-1',
    name: 'May Batch',
    status: 'pending',
    items: [{
      id: 'item-1',
      pageId: 'page-1',
      pageTitle: 'Home',
      pageSlug: 'home',
      field: 'seoTitle',
      currentValue: 'Old',
      proposedValue: 'New',
      status: 'pending',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeClientAction(overrides: Partial<ClientAction> = {}): ClientAction {
  return {
    id: 'action-1',
    workspaceId: 'ws-1',
    sourceType: 'aeo_change',
    title: 'Update AEO content',
    summary: 'Answer Engine Optimization update',
    status: 'pending',
    priority: 'high',
    payload: {},
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

const baseProps = {
  workspaceId: 'ws-1',
  effectiveTier: 'growth' as const,
  approvalBatches: [] as ApprovalBatch[],
  clientActions: [] as ClientAction[],
  approvalsLoading: false,
  pendingApprovals: 0,
  setApprovalBatches: vi.fn(),
  loadApprovals: vi.fn(),
  requests: [] as ClientRequest[],
  requestsLoading: false,
  clientUser: null,
  loadRequests: vi.fn(),
  contentRequests: [] as ClientContentRequest[],
  setContentRequests: vi.fn(),
  briefPrice: null,
  fullPostPrice: null,
  fmtPrice: (n: number) => `$${n}`,
  setPricingModal: vi.fn(),
  pricingConfirming: false,
  setToast: vi.fn(),
  contentPlanReviewCells: [],
  hasCopyEntries: false,
  hidePrices: false,
};

function renderInbox(route = '/client/ws-1/inbox', props = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <InboxTab {...baseProps} {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNewInboxIa = false;
});

// ─────────────────────────────────────────────────────────────────────────────

describe('InboxTab — basic rendering', () => {
  it('renders without crashing', () => {
    renderInbox();
    expect(screen.getByText(/SEO changes, requests, and content/i)).toBeInTheDocument();
  });

  it('shows the inbox description', () => {
    renderInbox();
    expect(screen.getByText(/SEO changes, requests, and content/i)).toBeInTheDocument();
  });

  it('renders Active / Completed mode toggle', () => {
    renderInbox();
    expect(screen.getByRole('button', { name: /Active/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Completed/i })).toBeInTheDocument();
  });

  it('starts in Active mode by default', () => {
    renderInbox();
    const activeBtn = screen.getByRole('button', { name: /Active/i });
    expect(activeBtn).toHaveAttribute('aria-pressed', 'true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('InboxTab — filter chips (legacy layout)', () => {
  it('renders All filter chip', () => {
    renderInbox();
    expect(screen.getByRole('button', { name: /All/i })).toBeInTheDocument();
  });

  it('renders Decisions filter chip', () => {
    renderInbox();
    expect(screen.getByRole('button', { name: /Decisions/i })).toBeInTheDocument();
  });

  it('renders Conversations filter chip', () => {
    renderInbox();
    expect(screen.getByRole('button', { name: /Conversations/i })).toBeInTheDocument();
  });

  it('renders Reviews filter chip (non-beta legacy layout)', () => {
    renderInbox();
    expect(screen.getByRole('button', { name: /Reviews/i })).toBeInTheDocument();
  });

  it('keeps Decisions count parity with new inbox layout when schema review is pending', () => {
    const schemaPlan = {
      status: 'sent_to_client',
      pageRoles: [{ id: 'role-1' }],
    } as never;

    const legacy = renderInbox('/client/ws-1/inbox?tab=decisions', {
      schemaPlan,
      clientActions: [makeClientAction()],
    });
    const legacyChip = screen.getByRole('button', { name: /Decisions/i });
    const legacyCount = legacyChip.querySelector('span')?.textContent;
    legacy.unmount();

    mockNewInboxIa = true;
    const modern = renderInbox('/client/ws-1/inbox?tab=decisions', {
      schemaPlan,
      clientActions: [makeClientAction()],
    });
    const modernChip = screen.getByRole('button', { name: /Decisions/i });
    const modernCount = modernChip.querySelector('span')?.textContent;

    expect(legacyCount).toBe('1');
    expect(modernCount).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('InboxTab — ?tab= deep-link contract', () => {
  it('activates Decisions section when ?tab=decisions', () => {
    renderInbox('/client/ws-1/inbox?tab=decisions');
    const decisionsBtn = screen.getByRole('button', { name: /Decisions/i });
    expect(decisionsBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('activates Conversations section when ?tab=conversations', () => {
    renderInbox('/client/ws-1/inbox?tab=conversations');
    const conversationsBtn = screen.getByRole('button', { name: /Conversations/i });
    expect(conversationsBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('activates Reviews section when ?tab=reviews', () => {
    renderInbox('/client/ws-1/inbox?tab=reviews');
    const reviewsBtn = screen.getByRole('button', { name: /Reviews/i });
    expect(reviewsBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('defaults to Decisions when no tab param is provided', () => {
    renderInbox('/client/ws-1/inbox');
    const decisionsBtn = screen.getByRole('button', { name: /Decisions/i });
    expect(decisionsBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('handles legacy alias: ?tab=approvals maps to decisions', () => {
    renderInbox('/client/ws-1/inbox?tab=approvals');
    const decisionsBtn = screen.getByRole('button', { name: /Decisions/i });
    expect(decisionsBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('handles legacy alias: ?tab=requests maps to conversations', () => {
    renderInbox('/client/ws-1/inbox?tab=requests');
    const conversationsBtn = screen.getByRole('button', { name: /Conversations/i });
    expect(conversationsBtn).toHaveAttribute('aria-pressed', 'true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('InboxTab — section visibility (legacy layout)', () => {
  it('shows "Needs Action & Requests" section when filter is all', () => {
    renderInbox('/client/ws-1/inbox?tab=all');
    expect(screen.getByRole('region', { name: /Needs Action & Requests/i })).toBeInTheDocument();
  });

  it('shows "SEO Changes" section when filter is decisions', () => {
    renderInbox('/client/ws-1/inbox?tab=decisions');
    // The SEO Changes section header is rendered as a button
    expect(screen.getByRole('button', { name: /SEO Changes/i })).toBeInTheDocument();
  });

  it('shows "Content" section when filter is reviews', () => {
    renderInbox('/client/ws-1/inbox?tab=reviews');
    expect(screen.getByRole('region', { name: /Content/i })).toBeInTheDocument();
  });

  it('shows requests tab inside Conversations section', () => {
    renderInbox('/client/ws-1/inbox?tab=conversations');
    expect(screen.getByTestId('requests-tab')).toBeInTheDocument();
  });

  it('shows content tab inside Content section (reviews filter)', () => {
    renderInbox('/client/ws-1/inbox?tab=reviews');
    expect(screen.getByTestId('content-tab')).toBeInTheDocument();
  });

  it('hides Content section when filter is conversations', () => {
    renderInbox('/client/ws-1/inbox?tab=conversations');
    expect(screen.queryByRole('region', { name: /^Content$/i })).not.toBeInTheDocument();
  });

  it('clicking filter chip switches visible section', () => {
    renderInbox('/client/ws-1/inbox');
    // Default is decisions — SEO Changes should be present
    expect(screen.getByRole('button', { name: /SEO Changes/i })).toBeInTheDocument();
    // Switch to Reviews
    fireEvent.click(screen.getByRole('button', { name: /Reviews/i }));
    expect(screen.getByRole('region', { name: /Content/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('InboxTab — copy review strip', () => {
  it('shows ClientCopyReview when hasCopyEntries is true (reviews filter)', () => {
    renderInbox('/client/ws-1/inbox?tab=reviews', { hasCopyEntries: true });
    expect(screen.getByTestId('copy-review')).toBeInTheDocument();
  });

  it('does not show ClientCopyReview when hasCopyEntries is false', () => {
    renderInbox('/client/ws-1/inbox?tab=reviews', { hasCopyEntries: false });
    expect(screen.queryByTestId('copy-review')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('InboxTab — mode toggle', () => {
  it('switches to Completed mode when Completed button is clicked', () => {
    renderInbox();
    fireEvent.click(screen.getByRole('button', { name: /Completed/i }));
    const completedBtn = screen.getByRole('button', { name: /Completed/i });
    expect(completedBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows empty state in Completed mode when nothing is completed', () => {
    renderInbox();
    fireEvent.click(screen.getByRole('button', { name: /Completed/i }));
    expect(screen.getByText('No completed items yet')).toBeInTheDocument();
  });

  it('hides filter chips in Completed mode', () => {
    renderInbox();
    fireEvent.click(screen.getByRole('button', { name: /Completed/i }));
    // Filter chips are only rendered in active mode
    expect(screen.queryByRole('button', { name: /Decisions/i })).not.toBeInTheDocument();
  });

  it('renders ApprovalsTab stub in Completed mode for applied batches', () => {
    const appliedBatch = makeApprovalBatch({
      id: 'applied-batch',
      name: 'Applied Batch',
      status: 'applied',
      items: [{
        id: 'item-1',
        pageId: 'page-1',
        pageTitle: 'Home',
        pageSlug: 'home',
        field: 'seoTitle',
        currentValue: 'Old',
        proposedValue: 'New',
        status: 'applied',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-10T00:00:00.000Z',
      }],
    });
    renderInbox('/client/ws-1/inbox', { approvalBatches: [appliedBatch] });
    fireEvent.click(screen.getByRole('button', { name: /Completed/i }));
    // ApprovalsTab is stubbed; the "Completed — SEO Changes" heading still renders
    expect(screen.getByText('Completed — SEO Changes')).toBeInTheDocument();
  });

  it('shows Completed — Actions section for completed client actions', () => {
    const completedAction = makeClientAction({ id: 'ca-done', title: 'Done Action', status: 'approved' });
    renderInbox('/client/ws-1/inbox', { clientActions: [completedAction] });
    fireEvent.click(screen.getByRole('button', { name: /Completed/i }));
    expect(screen.getByText('Done Action')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('InboxTab — decision cards', () => {
  it('shows pending client actions in Needs Action section (legacy layout)', () => {
    const action = makeClientAction({ sourceType: 'aeo_change', title: 'AEO Update Action' });
    renderInbox('/client/ws-1/inbox?tab=decisions', { clientActions: [action] });
    // In legacy layout the action title appears directly in the Needs Action section
    expect(screen.getByText('AEO Update Action')).toBeInTheDocument();
  });

  it('renders Requests tab in the Conversations section', () => {
    renderInbox('/client/ws-1/inbox?tab=conversations');
    expect(screen.getByTestId('requests-tab')).toBeInTheDocument();
  });
});
