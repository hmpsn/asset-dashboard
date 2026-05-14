import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxTab, type InboxFilter } from '../../src/components/client/InboxTab';
import type { ClientContentRequest, ClientRequest, ApprovalBatch } from '../../src/components/client/types';
import { useFeatureFlag } from '../../src/hooks/useFeatureFlag';
import { useBetaMode } from '../../src/components/client/BetaContext';
import { getOptional } from '../../src/api/client';
import type { ClientAction } from '../../shared/types/client-actions';

vi.mock('../../src/components/client/ApprovalBatchCard', () => ({
  ApprovalBatchCard: () => <div data-testid="approval-batch-card">approval-batch-card</div>,
}));

vi.mock('../../src/components/client/RequestsTab', () => ({
  RequestsTab: ({
    requestsLoading,
    requests,
  }: {
    requestsLoading: boolean;
    requests: Array<unknown>;
  }) => (
    <div data-testid="requests-tab">
      {requestsLoading ? 'requests-loading' : `requests-count:${requests.length}`}
    </div>
  ),
}));

vi.mock('../../src/components/client/ContentTab', () => ({
  ContentTab: ({
    contentRequests,
  }: {
    contentRequests: Array<{ status: string }>;
  }) => (
    <div data-testid="content-tab">
      {`content-count:${contentRequests.length}`}
      <span data-testid="content-review-count">
        {contentRequests.filter((item) => item.status === 'client_review' || item.status === 'post_review').length}
      </span>
    </div>
  ),
}));

vi.mock('../../src/components/client/ClientCopyReview', () => ({
  ClientCopyReview: () => <div data-testid="copy-review">copy-review</div>,
}));

vi.mock('../../src/components/client/SchemaReviewModal', () => ({
  SchemaReviewModal: () => null,
}));

vi.mock('../../src/components/client/ClientActionDetailModal', () => ({
  ClientActionDetailModal: () => null,
}));

vi.mock('../../src/components/client/DecisionDetailModal', () => ({
  DecisionDetailModal: () => null,
}));

vi.mock('../../src/components/client/DecisionCard', () => ({
  DecisionCard: ({ decision }: { decision: { title: string } }) => (
    <div data-testid="decision-card">{decision.title}</div>
  ),
}));

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn(),
}));

vi.mock('../../src/components/client/BetaContext', () => ({
  useBetaMode: vi.fn(),
}));

vi.mock('../../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/client')>('../../src/api/client');
  return {
    ...actual,
    getOptional: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  };
});

const mockUseFeatureFlag = vi.mocked(useFeatureFlag);
const mockUseBetaMode = vi.mocked(useBetaMode);
const mockGetOptional = vi.mocked(getOptional);

function renderInboxTab(
  initialPath: string,
  options?: {
    initialFilter?: InboxFilter;
    approvalsLoading?: boolean;
    clientActions?: ClientAction[];
    requestsLoading?: boolean;
    requests?: ClientRequest[];
    contentRequests?: ClientContentRequest[];
    hasCopyEntries?: boolean;
  },
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const approvalBatches: ApprovalBatch[] = [];
  const requests: ClientRequest[] = options?.requests ?? [];
  const contentRequests: ClientContentRequest[] = options?.contentRequests ?? [];

  const setApprovalBatches = vi.fn();
  const setContentRequests = vi.fn();
  const setToast = vi.fn();
  const setPricingModal = vi.fn();

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/client/:workspaceId/inbox"
            element={
              <InboxTab
                workspaceId="ws_test"
                effectiveTier="growth"
                approvalBatches={approvalBatches}
                approvalsLoading={options?.approvalsLoading ?? false}
                pendingApprovals={0}
                setApprovalBatches={setApprovalBatches}
                loadApprovals={vi.fn()}
                requests={requests}
                requestsLoading={options?.requestsLoading ?? false}
                clientUser={null}
                loadRequests={vi.fn()}
                contentRequests={contentRequests}
                setContentRequests={setContentRequests}
                briefPrice={null}
                fullPostPrice={null}
                fmtPrice={(n) => `$${n}`}
                setPricingModal={setPricingModal}
                pricingConfirming={false}
                setToast={setToast}
                contentPlanReviewCells={[]}
                hasCopyEntries={options?.hasCopyEntries ?? false}
                initialFilter={options?.initialFilter}
                hidePrices={false}
                clientActions={options?.clientActions ?? []}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InboxTab workflow routing (new inbox IA)', () => {
  beforeEach(() => {
    mockUseFeatureFlag.mockReturnValue(true);
    mockUseBetaMode.mockReturnValue(false);
    mockGetOptional.mockResolvedValue(null);
  });

  it('honors ?tab=conversations deep-link and renders conversations section', () => {
    renderInboxTab('/client/ws_test/inbox?tab=conversations');

    expect(screen.getByLabelText('Conversations')).toBeInTheDocument();
    expect(screen.queryByLabelText('Decisions')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reviews')).not.toBeInTheDocument();
    expect(screen.getByTestId('requests-tab')).toBeInTheDocument();
    expect(screen.getByText('requests-count:0')).toBeInTheDocument();
  });

  it('maps legacy ?tab=requests to conversations', () => {
    renderInboxTab('/client/ws_test/inbox?tab=requests');

    expect(screen.getByLabelText('Conversations')).toBeInTheDocument();
    expect(screen.queryByLabelText('Decisions')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reviews')).not.toBeInTheDocument();
  });

  it('maps legacy ?tab=approvals to decisions', () => {
    renderInboxTab('/client/ws_test/inbox?tab=approvals');
    expect(screen.getByLabelText('Decisions')).toBeInTheDocument();
  });

  it('maps legacy ?tab=copy to reviews', () => {
    renderInboxTab('/client/ws_test/inbox?tab=copy');
    expect(screen.getByLabelText('Reviews')).toBeInTheDocument();
  });

  it('falls back from ?tab=reviews to decisions in beta mode', () => {
    mockUseBetaMode.mockReturnValue(true);

    renderInboxTab('/client/ws_test/inbox?tab=reviews', { initialFilter: 'decisions' });

    expect(screen.getByLabelText('Decisions')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reviews')).not.toBeInTheDocument();
  });

  it('shows decisions empty-state copy when there are no pending items', () => {
    renderInboxTab('/client/ws_test/inbox?tab=decisions');

    expect(screen.getByText('All caught up — no decisions needed right now.')).toBeInTheDocument();
  });

  it('hides decisions empty-state copy while approvals are loading', () => {
    renderInboxTab('/client/ws_test/inbox?tab=decisions', { approvalsLoading: true });
    expect(screen.queryByText('All caught up — no decisions needed right now.')).not.toBeInTheDocument();
  });

  it('renders pending client actions in decisions section', () => {
    const now = new Date().toISOString();
    const action: ClientAction = {
      id: 'ca_1',
      workspaceId: 'ws_test',
      sourceType: 'content_decay',
      title: 'Refresh service page',
      summary: 'Decay detected',
      payload: { targetKeyword: 'service keyword' },
      status: 'pending',
      priority: 'high',
      createdAt: now,
      updatedAt: now,
    };

    renderInboxTab('/client/ws_test/inbox?tab=decisions', { clientActions: [action] });

    expect(screen.getByTestId('decision-card')).toBeInTheDocument();
    expect(screen.getByText('Refresh service page')).toBeInTheDocument();
  });

  it('shows completed-mode empty state after switching modes', () => {
    renderInboxTab('/client/ws_test/inbox?tab=decisions');
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    expect(screen.getByText('No completed items yet')).toBeInTheDocument();
  });

  it('falls back to provided initial filter for unknown deep-link values', () => {
    renderInboxTab('/client/ws_test/inbox?tab=not-a-filter', { initialFilter: 'conversations' });
    expect(screen.getByLabelText('Conversations')).toBeInTheDocument();
    expect(screen.queryByLabelText('Decisions')).not.toBeInTheDocument();
  });

  it('passes requests loading state through the conversations section', () => {
    renderInboxTab('/client/ws_test/inbox?tab=conversations', { requestsLoading: true });
    expect(screen.getByText('requests-loading')).toBeInTheDocument();
  });

  it('renders reviews section with schema + content review surfaces', async () => {
    mockGetOptional.mockResolvedValue({
      id: 'schema-plan-1',
      siteId: 'site_1',
      workspaceId: 'ws_test',
      siteUrl: 'https://example.test',
      canonicalEntities: [],
      pageRoles: [{
        pagePath: '/',
        pageTitle: 'Home',
        role: 'homepage',
        primaryType: 'WebPage',
        entityRefs: [],
      }],
      status: 'sent_to_client',
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const reviewItem: ClientContentRequest = {
      id: 'cr_1',
      topic: 'Homepage refresh',
      targetKeyword: 'homepage refresh',
      intent: 'informational',
      status: 'client_review',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'strategy',
      comments: [],
      serviceType: 'brief_only',
      briefId: null,
      postId: null,
    };

    renderInboxTab('/client/ws_test/inbox?tab=reviews', {
      contentRequests: [reviewItem],
      hasCopyEntries: true,
    });

    expect(await screen.findByLabelText('Reviews')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /review schema plan/i })).toBeInTheDocument();
    expect(screen.getByTestId('content-tab')).toBeInTheDocument();
    expect(screen.getByText('content-count:1')).toBeInTheDocument();
    expect(screen.getByTestId('copy-review')).toBeInTheDocument();
  });

  it('keeps reviews section stable when schema summary lookup fails', async () => {
    mockGetOptional.mockRejectedValueOnce(new Error('schema fetch failed'));

    const reviewItem: ClientContentRequest = {
      id: 'cr_error_1',
      topic: 'Fallback review topic',
      targetKeyword: 'fallback review keyword',
      intent: 'informational',
      status: 'post_review',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'client',
      comments: [],
      serviceType: 'brief_only',
      briefId: null,
      postId: null,
    };

    renderInboxTab('/client/ws_test/inbox?tab=reviews', {
      contentRequests: [reviewItem],
      hasCopyEntries: true,
    });

    expect(await screen.findByLabelText('Reviews')).toBeInTheDocument();
    expect(screen.getByText('content-count:1')).toBeInTheDocument();
    expect(screen.getByTestId('copy-review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review schema plan/i })).not.toBeInTheDocument();
  });

  it('renders legacy inbox layout sections when the feature flag is off', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    renderInboxTab('/client/ws_test/inbox?tab=all');

    expect(screen.getByLabelText('Needs Action & Requests')).toBeInTheDocument();
    expect(screen.getByLabelText('SEO Changes')).toBeInTheDocument();
    expect(screen.getByLabelText('Content')).toBeInTheDocument();
  });
});
