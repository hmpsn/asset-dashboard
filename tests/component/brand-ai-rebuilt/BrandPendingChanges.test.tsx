import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandPendingChanges } from '../../../src/components/brand-ai-rebuilt/BrandPendingChanges';
import { ToastProvider } from '../../../src/components/Toast';

const api = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getReadiness: vi.fn(),
  attestSamples: vi.fn(),
  listIdentity: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('../../../src/api/brand-engine', () => ({
  voice: {
    getProfile: api.getProfile,
    getReadiness: api.getReadiness,
    attestSamples: api.attestSamples,
  },
  identity: {
    list: api.listIdentity,
    updateStatus: api.updateStatus,
  },
}));

function renderPending(onReviewVoice = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrandPendingChanges workspaceId="ws_brand" onReviewVoice={onReviewVoice} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onReviewVoice };
}

describe('BrandPendingChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProfile.mockResolvedValue({
      id: 'vp_1',
      workspaceId: 'ws_brand',
      revision: 7,
      status: 'calibrating',
      samples: [{
        id: 'sample_1',
        voiceProfileId: 'vp_1',
        content: 'The complete voice proposal stays visible.',
        contextTag: 'body',
        source: 'mcp_proposed',
        sortOrder: 1,
        createdAt: '2026-07-15T12:00:00.000Z',
      }],
    });
    api.getReadiness.mockResolvedValue({
      readiness: { state: 'missing', blockingReasons: ['Human finalization required.'] },
      eligibleAnchors: { items: [], nextCursor: null, hasMore: false },
    });
    api.listIdentity.mockResolvedValue([{
      id: 'deliverable_1',
      workspaceId: 'ws_brand',
      deliverableType: 'tagline',
      content: 'The complete draft tagline stays visible.',
      status: 'draft',
      version: 1,
      tier: 'essentials',
      createdAt: '2026-07-15T12:00:00.000Z',
      updatedAt: '2026-07-15T12:00:00.000Z',
    }]);
    api.attestSamples.mockResolvedValue({ samples: [{ id: 'sample_1' }], profileRevision: 8 });
    api.updateStatus.mockResolvedValue({ id: 'deliverable_1', status: 'approved' });
  });

  it('shows one discoverable count and the complete exact approval set', async () => {
    renderPending();

    const trigger = await screen.findByRole('button', { name: 'Review 3 pending Brand and AI items' });
    fireEvent.click(trigger);

    expect(screen.getByText('The complete voice proposal stays visible.')).toBeInTheDocument();
    expect(screen.getByText('The complete draft tagline stays visible.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve all 2 changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and lock voice' })).toBeInTheDocument();
  });

  it('approves exactly the visible proposals and draft deliverables', async () => {
    renderPending();
    fireEvent.click(await screen.findByRole('button', { name: 'Review 3 pending Brand and AI items' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve all 2 changes' }));

    await waitFor(() => {
      expect(api.attestSamples).toHaveBeenCalledWith('ws_brand', ['sample_1'], 7);
      expect(api.updateStatus).toHaveBeenCalledWith('ws_brand', 'deliverable_1', 'approved', 1);
    });
  });

  it('routes the separate voice authority decision to the voice workflow', async () => {
    const { onReviewVoice } = renderPending();
    fireEvent.click(await screen.findByRole('button', { name: 'Review 3 pending Brand and AI items' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review and lock voice' }));
    expect(onReviewVoice).toHaveBeenCalledTimes(1);
  });

  it('does not report an empty queue when approval reads fail', async () => {
    api.getProfile.mockRejectedValueOnce(new Error('Voice read failed'));
    renderPending();

    const trigger = await screen.findByRole('button', { name: 'Review Brand and AI approval status' });
    expect(trigger).toHaveTextContent('Approvals unavailable');
    fireEvent.click(trigger);
    expect(screen.getByText('Approval status unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Everything is approved')).not.toBeInTheDocument();
  });
});
