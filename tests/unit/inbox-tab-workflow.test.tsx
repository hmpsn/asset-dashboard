import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxTab, type InboxFilter } from '../../src/components/client/InboxTab';
import type { ClientContentRequest, ClientRequest, ApprovalBatch } from '../../src/components/client/types';
import { useFeatureFlag } from '../../src/hooks/useFeatureFlag';
import { useBetaMode } from '../../src/components/client/BetaContext';
import { getOptional } from '../../src/api/client';

vi.mock('../../src/components/client/ApprovalBatchCard', () => ({
  ApprovalBatchCard: () => <div data-testid="approval-batch-card">approval-batch-card</div>,
}));

vi.mock('../../src/components/client/RequestsTab', () => ({
  RequestsTab: () => <div data-testid="requests-tab">requests-tab</div>,
}));

vi.mock('../../src/components/client/ContentTab', () => ({
  ContentTab: () => <div data-testid="content-tab">content-tab</div>,
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

function renderInboxTab(initialPath: string, initialFilter?: InboxFilter) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const approvalBatches: ApprovalBatch[] = [];
  const requests: ClientRequest[] = [];
  const contentRequests: ClientContentRequest[] = [];

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
                approvalsLoading={false}
                pendingApprovals={0}
                setApprovalBatches={setApprovalBatches}
                loadApprovals={vi.fn()}
                requests={requests}
                requestsLoading={false}
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
                hasCopyEntries={false}
                initialFilter={initialFilter}
                hidePrices={false}
                clientActions={[]}
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
  });

  it('maps legacy ?tab=requests to conversations', () => {
    renderInboxTab('/client/ws_test/inbox?tab=requests');

    expect(screen.getByLabelText('Conversations')).toBeInTheDocument();
    expect(screen.queryByLabelText('Decisions')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reviews')).not.toBeInTheDocument();
  });

  it('falls back from ?tab=reviews to decisions in beta mode', () => {
    mockUseBetaMode.mockReturnValue(true);

    renderInboxTab('/client/ws_test/inbox?tab=reviews', 'decisions');

    expect(screen.getByLabelText('Decisions')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reviews')).not.toBeInTheDocument();
  });

  it('shows decisions empty-state copy when there are no pending items', () => {
    renderInboxTab('/client/ws_test/inbox?tab=decisions');

    expect(screen.getByText('All caught up — no decisions needed right now.')).toBeInTheDocument();
  });
});
