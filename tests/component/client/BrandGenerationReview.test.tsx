import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client';
import { BrandGenerationReview } from '../../../src/components/client/inbox/BrandGenerationReview';
import { queryKeys } from '../../../src/lib/queryKeys';
import type {
  ClientDeliverable,
  ClientDeliverableItem,
} from '../../../shared/types/client-deliverable';
import type { BrandDeliverableType } from '../../../shared/types/brand-engine';

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  respondToBrandReview: vi.fn(),
  genericRespond: vi.fn(),
}));

vi.mock('../../../src/api/deliverables', () => ({
  publicDeliverables: {
    list: (...args: unknown[]) => apiMocks.list(...args),
    respondToBrandReview: (...args: unknown[]) => apiMocks.respondToBrandReview(...args),
    respond: (...args: unknown[]) => apiMocks.genericRespond(...args),
  },
}));

const REVIEW_TOKEN_A = 'a'.repeat(64);
const REVIEW_TOKEN_B = 'b'.repeat(64);

function makeItem(
  target: BrandDeliverableType,
  status: 'awaiting_client' | 'approved' | 'changes_requested' = 'awaiting_client',
  overrides: Partial<ClientDeliverableItem> = {},
  reviewToken = REVIEW_TOKEN_A,
): ClientDeliverableItem {
  return {
    id: `item-${target}`,
    deliverableId: 'review-1',
    status,
    targetRef: null,
    collectionId: null,
    field: target,
    currentValue: null,
    proposedValue: `## ${target}\n\nA grounded ${target} direction.\n\nSecond paragraph with the full strategic rationale.`,
    clientValue: null,
    clientNote: status === 'changes_requested' ? 'Make this warmer and more specific.' : null,
    applyable: false,
    itemPayload: {
      schemaVersion: 1,
      family: 'brand_generation',
      reviewKind: 'brand_suite',
      target,
      reviewToken,
    },
    sortOrder: 0,
    createdAt: '2026-07-14T10:00:00.000Z',
    ...overrides,
  };
}

function makeSuite(overrides: Partial<ClientDeliverable> = {}): ClientDeliverable {
  return {
    id: 'review-1',
    workspaceId: 'ws-1',
    externalRef: null,
    type: 'brand_generation',
    kind: 'review',
    status: 'awaiting_client',
    title: 'Brand system review',
    summary: 'Review each grounded brand piece.',
    payload: {
      schemaVersion: 1,
      family: 'brand_generation',
      reviewKind: 'brand_suite',
    },
    note: null,
    clientResponseNote: null,
    parentDeliverableId: null,
    sentAt: '2026-07-14T10:00:00.000Z',
    decidedAt: null,
    dueAt: null,
    appliedAt: null,
    generatedAt: null,
    source: null,
    sourceRef: null,
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    items: [makeItem('mission')],
    ...overrides,
  };
}

function makeFoundation(): ClientDeliverable {
  return makeSuite({
    id: 'foundation-review',
    title: 'Brand voice foundation review',
    summary: 'Internal source references must never render: run-secret-123.',
    payload: {
      schemaVersion: 1,
      family: 'brand_generation',
      reviewKind: 'voice_foundation',
      runId: 'run-secret-123',
    },
    items: [{
      ...makeItem('mission'),
      id: 'item-foundation',
      deliverableId: 'foundation-review',
      field: 'voice_foundation',
      proposedValue: '## Direction\n\nWarm, direct, and evidence-led.\n\nUse confident language without hype.',
      itemPayload: {
        schemaVersion: 1,
        family: 'brand_generation',
        reviewKind: 'voice_foundation',
        target: 'voice_foundation',
        reviewToken: REVIEW_TOKEN_A,
        generationItemId: 'generation-secret-456',
      },
    }],
  });
}

function renderReview(deliverable: ClientDeliverable = makeSuite()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <BrandGenerationReview
        workspaceId="ws-1"
        deliverable={deliverable}
        ageLabel="Sent today"
      />
    </QueryClientProvider>,
  );
  return { queryClient, ...rendered };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.list.mockResolvedValue({ deliverables: [makeSuite()] });
  apiMocks.respondToBrandReview.mockImplementation(async (
    _workspaceId: string,
    deliverableId: string,
    request: { deliverableItemId: string; decision: 'approve' | 'changes_requested' },
  ) => ({
    reviewDeliverableId: deliverableId,
    deliverableItemId: request.deliverableItemId,
    itemStatus: request.decision === 'approve' ? 'approved' : 'changes_requested',
    bundleStatus: request.decision === 'approve' ? 'approved' : 'changes_requested',
  }));
});

describe('BrandGenerationReview', () => {
  it('approves exactly one item through the specialized brand-review request shape', async () => {
    const { queryClient } = renderReview();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));

    await waitFor(() => {
      expect(apiMocks.respondToBrandReview).toHaveBeenCalledWith(
        'ws-1',
        'review-1',
        { deliverableItemId: 'item-mission', reviewToken: REVIEW_TOKEN_A, decision: 'approve' },
        expect.any(AbortSignal),
      );
    });
    expect(apiMocks.genericRespond).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalled();
    expect(await screen.findByText('Approval recorded')).toBeInTheDocument();
  });

  it('patches the token-matching item and parent before background invalidation completes', async () => {
    const suite = makeSuite();
    const { queryClient } = renderReview(suite);
    queryClient.setQueryData(queryKeys.client.unifiedInbox('ws-1'), { deliverables: [suite] });
    const invalidation = new Promise<void>(() => {});
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
      .mockReturnValue(invalidation);

    fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(1));
    const confirmation = await screen.findByText('Approval recorded');
    expect(confirmation.closest('[role="status"]')).toHaveFocus();
    const cached = queryClient.getQueryData<{ deliverables: ClientDeliverable[] }>(
      queryKeys.client.unifiedInbox('ws-1'),
    );
    expect(cached?.deliverables[0].status).toBe('approved');
    expect(cached?.deliverables[0].items?.[0].status).toBe('approved');
  });

  it('clears an optimistic terminal decision when the same child is resent for review', async () => {
    const first = makeSuite();
    const { rerender, queryClient } = renderReview(first);

    fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));
    expect(await screen.findByText('Approval recorded')).toBeInTheDocument();

    const resent = makeSuite({
      items: [makeItem('mission', 'awaiting_client', {}, REVIEW_TOKEN_B)],
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <BrandGenerationReview
          workspaceId="ws-1"
          deliverable={resent}
          ageLabel="Sent just now"
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Approve Mission Statement' })).toBeEnabled();
    expect(screen.queryByText('Approval recorded')).not.toBeInTheDocument();
  });

  it('makes the change-request form focus-managed and explicitly required', async () => {
    renderReview();

    const trigger = screen.getByRole('button', { name: 'Request changes to Mission Statement' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const formId = trigger.getAttribute('aria-controls');

    fireEvent.click(trigger);
    const textarea = screen.getByPlaceholderText('Tell your team what to revise…');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(formId).not.toBeNull();
    expect(document.getElementById(formId!)).toBeInTheDocument();
    expect(textarea).toBeRequired();
    await waitFor(() => expect(textarea).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('preserves item B’s open note when only sibling A and the parent status update', async () => {
    const initial = makeSuite({
      items: [makeItem('mission'), makeItem('values')],
    });
    const { rerender, queryClient } = renderReview(initial);

    fireEvent.click(screen.getByRole('button', { name: 'Request changes to Core Values' }));
    const textarea = screen.getByPlaceholderText('Tell your team what to revise…');
    fireEvent.change(textarea, { target: { value: 'Keep this specific note for values.' } });

    const siblingUpdated = makeSuite({
      status: 'partial',
      updatedAt: '2026-07-14T11:00:00.000Z',
      items: [makeItem('mission', 'approved'), makeItem('values')],
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <BrandGenerationReview workspaceId="ws-1" deliverable={siblingUpdated} ageLabel="Sent today" />
      </QueryClientProvider>,
    );

    expect(await screen.findByPlaceholderText('Tell your team what to revise…'))
      .toHaveValue('Keep this specific note for values.');
    expect(screen.getByRole('button', { name: 'Request changes to Core Values' }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('requires a specific note before sending a changes request', () => {
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Request changes to Mission Statement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send change request' }));

    expect(screen.getByText('Add a note so your team knows what to change.')).toBeInTheDocument();
    expect(apiMocks.respondToBrandReview).not.toHaveBeenCalled();
  });

  it('sends a trimmed required note for one changes-requested item', async () => {
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Request changes to Mission Statement' }));
    fireEvent.change(screen.getByPlaceholderText('Tell your team what to revise…'), {
      target: { value: '  Make the promise more concrete.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send change request' }));

    await waitFor(() => {
      expect(apiMocks.respondToBrandReview).toHaveBeenCalledWith(
        'ws-1',
        'review-1',
        {
          deliverableItemId: 'item-mission',
          reviewToken: REVIEW_TOKEN_A,
          decision: 'changes_requested',
          note: 'Make the promise more concrete.',
        },
        expect.any(AbortSignal),
      );
    });
    expect(apiMocks.genericRespond).not.toHaveBeenCalled();
    const savedNote = await screen.findByText('Your note: Make the promise more concrete.');
    expect(savedNote).toBeInTheDocument();
    expect(savedNote.closest('[role="alert"]')).toHaveFocus();
  });

  it('retains approved and changes-requested siblings in an honest partial bundle', () => {
    const partial = makeSuite({
      status: 'partial',
      items: [
        makeItem('mission', 'approved'),
        makeItem('tagline', 'changes_requested'),
        makeItem('values', 'awaiting_client'),
      ],
    });
    renderReview(partial);

    expect(screen.getByText('Partially reviewed')).toBeInTheDocument();
    expect(screen.getByText('Mission Statement')).toBeInTheDocument();
    expect(screen.getByText('Tagline')).toBeInTheDocument();
    expect(screen.getByText('Core Values')).toBeInTheDocument();
    expect(screen.getByText('Your note: Make this warmer and more specific.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve Mission Statement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve Tagline' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve Core Values' })).toBeInTheDocument();
  });

  it('frames the voice foundation as advisory and never as finalized authority', () => {
    renderReview(makeFoundation());

    expect(screen.getByText('Advisory voice foundation')).toBeInTheDocument();
    expect(screen.getByText(/it does not finalize your brand voice/i)).toBeInTheDocument();
    expect(screen.getByText(/your team owns final voice selection/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve Voice Foundation' })).toHaveTextContent('Approve this direction');
    expect(screen.queryByText('run-secret-123')).not.toBeInTheDocument();
    expect(screen.queryByText('generation-secret-456')).not.toBeInTheDocument();
  });

  it('uses a keyboard-operable disclosure for the full draft', () => {
    renderReview();
    const summary = screen.getByText('Read full mission statement').closest('summary');
    const details = summary?.closest('details');

    expect(summary).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(summary!);
    expect(details).toHaveAttribute('open');
  });

  it('renders operator review instructions as safe prose', () => {
    const { container } = renderReview(makeSuite({
      note: 'One piece was revised after your first review.\n\n```chart\n{}\n```',
    }));

    expect(screen.getByText('Note from your team')).toBeInTheDocument();
    expect(screen.getByText('One piece was revised after your first review.')).toBeInTheDocument();
    expect(screen.getByText('{}').closest('pre')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="chart"]')).toBeNull();
  });

  it('shows item-scoped loading and disables competing actions while saving', async () => {
    apiMocks.respondToBrandReview.mockReturnValue(new Promise(() => {}));
    renderReview(makeSuite({
      items: [makeItem('mission'), makeItem('values')],
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));

    await waitFor(() => {
      expect(screen.getByText('Saving decision…')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Approve Mission Statement' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve Core Values' })).toBeDisabled();
  });

  it('uses uncertainty copy and re-enables only after a same-token awaiting refetch', async () => {
    apiMocks.respondToBrandReview.mockRejectedValueOnce(new Error('network unavailable'));
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));

    const alert = await screen.findByRole('alert');
    expect(apiMocks.list).toHaveBeenCalledWith('ws-1', expect.any(AbortSignal));
    expect(within(alert).getByText('Decision not confirmed')).toBeInTheDocument();
    expect(within(alert).getByText('We couldn’t confirm whether it saved.')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve Mission Statement' })).toBeEnabled();
  });

  it('keeps an uncertain item locked when the confirming inbox refetch fails', async () => {
    apiMocks.respondToBrandReview.mockRejectedValueOnce(new Error('network unavailable'));
    apiMocks.list.mockRejectedValueOnce(new Error('inbox unavailable'));
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));

    const message = await screen.findByText('We couldn’t confirm whether it saved.');
    expect(message.closest('[role="alert"]')).toHaveFocus();
    expect(within(message.closest('[role="alert"]')!).queryByRole('button', { name: 'Dismiss' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve Mission Statement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request changes to Mission Statement' })).not.toBeInTheDocument();
  });

  it('bounds a hung PATCH, then reconciles through a same-token confirming read', async () => {
    vi.useFakeTimers();
    try {
      apiMocks.respondToBrandReview.mockReturnValueOnce(new Promise(() => {}));
      renderReview();

      fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });

      expect(apiMocks.list).toHaveBeenCalledWith('ws-1', expect.any(AbortSignal));
      expect(screen.getByText('We couldn’t confirm whether it saved.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Approve Mission Statement' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a hung confirming GET and settles into the locked unknown state', async () => {
    vi.useFakeTimers();
    try {
      apiMocks.respondToBrandReview.mockRejectedValueOnce(new Error('response unavailable'));
      apiMocks.list.mockReturnValueOnce(new Promise(() => {}));
      renderReview();

      fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      const message = screen.getByText('We couldn’t confirm whether it saved.');
      expect(message.closest('[role="alert"]')).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Approve Mission Statement' })).not.toBeInTheDocument();
      expect(apiMocks.list.mock.calls[0]?.[1]).toMatchObject({ aborted: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a same-token committed decision as success when its HTTP response was lost', async () => {
    apiMocks.respondToBrandReview.mockRejectedValueOnce(new Error('response lost after commit'));
    apiMocks.list.mockResolvedValueOnce({
      deliverables: [makeSuite({
        status: 'approved',
        items: [makeItem('mission', 'approved')],
      })],
    });
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));

    const confirmation = await screen.findByText('Approval recorded');
    expect(confirmation.closest('[role="status"]')).toHaveFocus();
    expect(screen.queryByText('Decision not confirmed')).not.toBeInTheDocument();
    expect(screen.queryByText('We couldn’t confirm whether it saved.')).not.toBeInTheDocument();
  });

  it('shows an authoritative concurrent-review outcome when the terminal decision differs', async () => {
    apiMocks.respondToBrandReview.mockRejectedValueOnce(new Error('response lost'));
    apiMocks.list.mockResolvedValueOnce({
      deliverables: [makeSuite({
        status: 'changes_requested',
        items: [makeItem('mission', 'changes_requested')],
      })],
    });
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));

    const concurrent = await screen.findByText(
      'This piece was already reviewed by someone else. Your inbox now shows that decision.',
    );
    expect(concurrent.closest('[role="alert"]')).toHaveFocus();
    expect(screen.getByText('Your note: Make this warmer and more specific.').closest('[role="alert"]'))
      .toHaveTextContent('Changes requested');
    expect(screen.queryByText('Decision not confirmed')).not.toBeInTheDocument();
  });

  it('locks a conflicted item until a changed server projection confirms a resend', async () => {
    apiMocks.respondToBrandReview.mockRejectedValueOnce(new ApiError(409, 'revision conflict'));
    const initial = makeSuite();
    const { rerender, queryClient } = renderReview(initial);

    fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));

    const conflictMessage = await screen.findByText('This piece changed; your team must resend it.');
    expect(conflictMessage.closest('[role="alert"]')).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Approve Mission Statement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request changes to Mission Statement' })).not.toBeInTheDocument();

    // A parent rerender without a changed durable projection must not revive stale actions.
    rerender(
      <QueryClientProvider client={queryClient}>
        <BrandGenerationReview workspaceId="ws-1" deliverable={makeSuite()} ageLabel="Sent today" />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Approve Mission Statement' })).not.toBeInTheDocument();

    const resent = makeSuite({
      items: [makeItem('mission', 'awaiting_client', {}, REVIEW_TOKEN_B)],
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <BrandGenerationReview workspaceId="ws-1" deliverable={resent} ageLabel="Sent just now" />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Approve Mission Statement' })).toBeEnabled();
    expect(screen.queryByText('This piece changed; your team must resend it.')).not.toBeInTheDocument();
  });

  it('moves focus from a rejected change form to the stable conflict banner', async () => {
    apiMocks.respondToBrandReview.mockRejectedValueOnce(new ApiError(409, 'revision conflict'));
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Request changes to Mission Statement' }));
    fireEvent.change(screen.getByPlaceholderText('Tell your team what to revise…'), {
      target: { value: 'Please make this more specific.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send change request' }));

    const conflictMessage = await screen.findByText('This piece changed; your team must resend it.');
    expect(conflictMessage.closest('[role="alert"]')).toHaveFocus();
    expect(screen.queryByPlaceholderText('Tell your team what to revise…')).not.toBeInTheDocument();
  });

  it('does not let a late rev-N success overlay a rev-N+1 resend', async () => {
    let resolveDecision: (value: {
      reviewDeliverableId: string;
      deliverableItemId: string;
      itemStatus: 'approved';
      bundleStatus: 'approved';
    }) => void = () => {};
    apiMocks.respondToBrandReview.mockReturnValueOnce(new Promise((resolve) => {
      resolveDecision = resolve;
    }));
    const { rerender, queryClient } = renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Approve Mission Statement' }));
    const resent = makeSuite({
      items: [makeItem('mission', 'awaiting_client', {}, REVIEW_TOKEN_B)],
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <BrandGenerationReview workspaceId="ws-1" deliverable={resent} ageLabel="Sent just now" />
      </QueryClientProvider>,
    );
    queryClient.setQueryData(
      queryKeys.client.unifiedInbox('ws-1'),
      { deliverables: [resent] },
    );

    await act(async () => {
      resolveDecision({
        reviewDeliverableId: 'review-1',
        deliverableItemId: 'item-mission',
        itemStatus: 'approved',
        bundleStatus: 'approved',
      });
    });

    expect(await screen.findByRole('button', { name: 'Approve Mission Statement' })).toBeEnabled();
    expect(screen.queryByText('Approval recorded')).not.toBeInTheDocument();
    const cached = queryClient.getQueryData<{ deliverables: ClientDeliverable[] }>(
      queryKeys.client.unifiedInbox('ws-1'),
    );
    expect(cached?.deliverables[0].status).toBe('awaiting_client');
    expect(cached?.deliverables[0].items?.[0].status).toBe('awaiting_client');
    expect(cached?.deliverables[0].items?.[0].itemPayload?.reviewToken).toBe(REVIEW_TOKEN_B);
  });

  it('treats reserved rich-block fences as prose instead of executing malformed ChatBlocks', () => {
    const review = makeSuite({
      items: [makeItem('mission', 'awaiting_client', {
        proposedValue: '## Direction\n\n```chart\n{}\n```\n\nKeep this grounded.',
      })],
    });

    expect(() => renderReview(review)).not.toThrow();
    const reservedFence = screen.getByText('{}');
    expect(reservedFence.tagName).toBe('CODE');
    expect(reservedFence.closest('pre')).toBeInTheDocument();
  });

  it('preserves raw URLs and Markdown link destinations as escaped, non-clickable prose', () => {
    const rawUrl = 'https://example.com/proof?one=1&two=2';
    const linkDestination = 'https://docs.example.com/source?x=1&y=2';
    const review = makeSuite({
      items: [makeItem('mission', 'awaiting_client', {
        proposedValue: `Read ${rawUrl} and [the supporting source](${linkDestination}).`,
      })],
    });

    const { container } = renderReview(review);
    fireEvent.click(screen.getByText('Read full mission statement'));

    expect(container).toHaveTextContent(rawUrl);
    expect(container).toHaveTextContent(linkDestination);
    expect(container.querySelector('a')).toBeNull();
  });

  it('fails closed when the client-safe review projection is malformed', () => {
    renderReview(makeSuite({ payload: { family: 'brand_generation', reviewKind: 'brand_suite' } }));

    expect(screen.getByText('Brand review unavailable')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t open this review');
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('fails closed when the parent status disagrees with its child-derived status', () => {
    renderReview(makeSuite({ status: 'approved' }));

    expect(screen.getByText('Brand review unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('fails closed when a projected child review token is not lowercase 64-character hex', () => {
    const invalidTokenItem = makeItem('mission');
    invalidTokenItem.itemPayload = {
      ...invalidTokenItem.itemPayload,
      reviewToken: 'A'.repeat(64),
    };
    renderReview(makeSuite({ items: [invalidTokenItem] }));

    expect(screen.getByText('Brand review unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });
});
