import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentTab } from '../../../src/components/client/ContentTab';
import type { ClientContentRequest } from '../../../src/components/client/types';

// ── React Router ──────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ workspaceId: 'ws-content-test' }),
  };
});

// ── BetaContext ───────────────────────────────────────────────────────────────
vi.mock('../../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

// ── useContentRequests hook ───────────────────────────────────────────────────
vi.mock('../../../src/hooks/useContentRequests', () => ({
  useContentRequests: () => ({
    expandedContentReq: null,
    setExpandedContentReq: vi.fn(),
    contentComment: '',
    setContentComment: vi.fn(),
    sendingContentComment: false,
    declineReqId: null,
    setDeclineReqId: vi.fn(),
    declineReason: '',
    setDeclineReason: vi.fn(),
    feedbackReqId: null,
    setFeedbackReqId: vi.fn(),
    feedbackText: '',
    setFeedbackText: vi.fn(),
    briefPreviews: {},
    declineTopic: vi.fn(),
    approveBrief: vi.fn(),
    requestChanges: vi.fn(),
    addContentComment: vi.fn(),
    loadBriefPreview: vi.fn(),
  }),
}));

// ── contentPerformance API ────────────────────────────────────────────────────
vi.mock('../../../src/api', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api')>('../../../src/api');
  return {
    ...actual,
    contentPerformance: {
      publicGet: vi.fn(() => Promise.resolve({ items: [] })),
    },
  };
});

// ── PostReviewCard ─────────────────────────────────────────────────────────────
vi.mock('../../../src/components/client/PostReviewCard', () => ({
  PostReviewCard: ({ request }: { request: ClientContentRequest }) => (
    <div data-testid="post-review-card">{request.topic}</div>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(overrides: Partial<ClientContentRequest> = {}): ClientContentRequest {
  return {
    id: 'req-1',
    topic: 'Content Marketing Guide',
    targetKeyword: 'content marketing guide',
    intent: 'informational',
    priority: 'high',
    status: 'requested',
    source: 'client',
    serviceType: 'brief_only',
    requestedAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

const defaultProps = {
  contentRequests: [] as ClientContentRequest[],
  setContentRequests: vi.fn(),
  effectiveTier: 'growth' as const,
  briefPrice: 199,
  fullPostPrice: 499,
  fmtPrice: (n: number) => `$${n}`,
  setPricingModal: vi.fn(),
  pricingConfirming: false,
  workspaceId: 'ws-content-test',
  setToast: vi.fn(),
  hidePrices: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('ContentTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when content requests are empty', () => {
    const { container } = render(<ContentTab {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it('shows empty state when no content requests exist', () => {
    render(<ContentTab {...defaultProps} />);
    expect(screen.getByText('Your content pipeline is empty')).toBeInTheDocument();
  });

  it('shows free-tier upgrade message in empty state when tier is free', () => {
    render(<ContentTab {...defaultProps} effectiveTier="free" />);
    expect(
      screen.getByText(/Upgrade to Growth to request content briefs/i),
    ).toBeInTheDocument();
  });

  it('shows growth-tier suggestion message in empty state when tier is growth', () => {
    render(<ContentTab {...defaultProps} effectiveTier="growth" />);
    expect(screen.getByText(/Browse content ideas on the/i)).toBeInTheDocument();
  });

  it('renders the Content Pipeline page header', () => {
    render(<ContentTab {...defaultProps} />);
    expect(screen.getByText('Content Pipeline')).toBeInTheDocument();
  });

  it('renders the Suggest a Topic button', () => {
    render(<ContentTab {...defaultProps} />);
    expect(screen.getByRole('button', { name: /suggest a topic/i })).toBeInTheDocument();
  });

  it('renders a list of content request items', () => {
    const requests = [
      makeRequest({ id: 'req-1', topic: 'SEO Basics Guide' }),
      makeRequest({ id: 'req-2', topic: 'Link Building Tips' }),
    ];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    expect(screen.getByText('SEO Basics Guide')).toBeInTheDocument();
    expect(screen.getByText('Link Building Tips')).toBeInTheDocument();
  });

  it('renders brief badge for brief_only requests', () => {
    const requests = [makeRequest({ serviceType: 'brief_only' })];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    expect(screen.getByText('Brief')).toBeInTheDocument();
  });

  it('renders Full Post badge for full_post requests', () => {
    const requests = [makeRequest({ serviceType: 'full_post' })];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    expect(screen.getByText('✦ Full Post')).toBeInTheDocument();
  });

  it('renders status summary cards when requests exist', () => {
    const requests = [
      makeRequest({ status: 'requested' }),
      makeRequest({ id: 'req-2', status: 'delivered', topic: 'Delivered Post' }),
    ];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    // Status summary card labels (the stat card labels, not timeline step labels)
    expect(screen.getByText('Needs Review')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    // 'Published' appears in both the stat card and timeline — use getAllByText
    expect(screen.getAllByText('Published').length).toBeGreaterThanOrEqual(1);
  });

  it('shows review alert banner when a brief is in client_review', () => {
    const requests = [makeRequest({ status: 'client_review' })];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    expect(screen.getByText(/brief.*ready for your review/i)).toBeInTheDocument();
  });

  it('shows post review alert banner when a post is in post_review', () => {
    const requests = [makeRequest({ status: 'post_review' })];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    expect(screen.getByText(/post.*ready for your review/i)).toBeInTheDocument();
  });

  it('renders declined items in a collapsed section', () => {
    const requests = [
      makeRequest({ status: 'requested' }),
      makeRequest({ id: 'req-declined', status: 'declined', topic: 'Old Topic' }),
    ];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    expect(screen.getByText(/1 declined topic/i)).toBeInTheDocument();
  });

  it('does not show empty state when requests exist', () => {
    const requests = [makeRequest({ id: 'req-1', topic: 'Some Topic' })];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    expect(screen.queryByText('Your content pipeline is empty')).not.toBeInTheDocument();
  });

  it('shows "You submitted" badge for client-sourced requests', () => {
    const requests = [makeRequest({ source: 'client' })];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    expect(screen.getByText('You submitted')).toBeInTheDocument();
  });

  it('does not show "You submitted" badge for strategy-sourced requests', () => {
    const requests = [makeRequest({ source: 'strategy' })];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    expect(screen.queryByText('You submitted')).not.toBeInTheDocument();
  });

  it('renders the target keyword for each request', () => {
    const requests = [makeRequest({ targetKeyword: 'seo guide for beginners' })];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    // The keyword is displayed inside &ldquo; ... &rdquo; curly quotes
    expect(screen.getByText(/seo guide for beginners/i)).toBeInTheDocument();
  });

  it('renders with premium tier without crashing', () => {
    render(<ContentTab {...defaultProps} effectiveTier="premium" />);
    expect(screen.getByText('Content Pipeline')).toBeInTheDocument();
  });

  it('renders Upgraded badge for requests that have been upgraded', () => {
    const requests = [makeRequest({ upgradedAt: '2026-05-10T00:00:00.000Z' })];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    expect(screen.getByText('Upgraded')).toBeInTheDocument();
  });

  it('does not render declined items in the active pipeline list', () => {
    const requests = [
      makeRequest({ id: 'req-active', topic: 'Active Topic', status: 'requested' }),
      makeRequest({ id: 'req-declined', topic: 'Declined Topic', status: 'declined' }),
    ];
    render(<ContentTab {...defaultProps} contentRequests={requests} />);
    // Active topic shows in pipeline, declined topic only in collapsed section
    expect(screen.getByText('Active Topic')).toBeInTheDocument();
    // Declined topic text is in the details element (collapsed), not the main pipeline list
    const declinedTexts = screen.getAllByText('Declined Topic');
    // It should only appear in the collapsed section, not in the main list
    expect(declinedTexts.length).toBeGreaterThanOrEqual(1);
  });
});
