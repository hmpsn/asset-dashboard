/**
 * Component tests for ISSUE 2a — ContentTab SOLO mode (single-item review).
 *
 * Asserts:
 *  - soloRequestId → only that request's block renders; all pipeline chrome (PageHeader / stat grid /
 *    topic form trigger / banners / declined list) is absent;
 *  - solo not-found (seeded id not in the prop array) → contextual "Loading review…" message;
 *  - legacy mode (no soloRequestId) → full chrome + the multi-item list renders (byte-identical guard),
 *    AND loadBriefPreview is NOT called without a seed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ClientContentRequest } from '../../src/components/client/types';

// ── Mocks ──
const mockLoadBriefPreview = vi.fn();
// Capture the seed the hook receives so we can assert solo seeds the expand.
const mockUseContentRequests = vi.fn();
vi.mock('../../src/hooks/useContentRequests', () => ({
  useContentRequests: (opts: { initialExpandedRequestId?: string }) => {
    mockUseContentRequests(opts);
    return {
      expandedContentReq: opts.initialExpandedRequestId ?? null,
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
      loadBriefPreview: mockLoadBriefPreview,
    };
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

// contentPerformance.publicGet is fired by a ContentTab effect when there are published items.
vi.mock('../../src/api', () => ({
  contentPerformance: { publicGet: vi.fn().mockResolvedValue({ items: [] }) },
}));

import { ContentTab } from '../../src/components/client/ContentTab';

function makeRequest(overrides: Partial<ClientContentRequest> = {}): ClientContentRequest {
  return {
    id: 'cr-1',
    topic: 'Spring campaign topic',
    targetKeyword: 'spring keyword',
    intent: 'informational',
    priority: 'medium',
    status: 'client_review',
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const baseProps = {
  setContentRequests: vi.fn(),
  effectiveTier: 'growth' as const,
  briefPrice: null,
  fullPostPrice: null,
  fmtPrice: (n: number) => `$${n}`,
  setPricingModal: vi.fn(),
  pricingConfirming: false,
  workspaceId: 'ws-1',
  setToast: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContentTab solo mode', () => {
  it('soloRequestId → renders only that request; pipeline chrome is absent', () => {
    const requests = [
      makeRequest({ id: 'cr-1', topic: 'Spring campaign topic' }),
      makeRequest({ id: 'cr-2', topic: 'Other unrelated topic' }),
    ];
    render(<ContentTab {...baseProps} contentRequests={requests} soloRequestId="cr-1" />);

    // Only the soloed request renders.
    expect(screen.getByText('Spring campaign topic')).toBeInTheDocument();
    expect(screen.queryByText('Other unrelated topic')).not.toBeInTheDocument();

    // Chrome absent: PageHeader title, stat-grid labels, topic-form trigger.
    expect(screen.queryByText('Content Pipeline')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Suggest a Topic/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Needs Review')).not.toBeInTheDocument();
    expect(screen.queryByText('In Progress')).not.toBeInTheDocument();
  });

  it('solo not-found (seeded id not in the prop array) → contextual loading message', () => {
    const requests = [makeRequest({ id: 'cr-2', topic: 'Other unrelated topic' })];
    render(<ContentTab {...baseProps} contentRequests={requests} soloRequestId="cr-1" />);

    expect(screen.getByText('Loading review…')).toBeInTheDocument();
    // Not a blank modal — the not-found fallback rendered, and the pipeline header is still absent.
    expect(screen.queryByText('Content Pipeline')).not.toBeInTheDocument();
  });

  it('legacy mode (no soloRequestId) → full chrome + multi-item list, loadBriefPreview NOT called', () => {
    const requests = [
      makeRequest({ id: 'cr-1', topic: 'First topic' }),
      makeRequest({ id: 'cr-2', topic: 'Second topic' }),
    ];
    render(<ContentTab {...baseProps} contentRequests={requests} />);

    // Full chrome present.
    expect(screen.getByText('Content Pipeline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Suggest a Topic/ })).toBeInTheDocument();
    // Both items render (no narrowing).
    expect(screen.getByText('First topic')).toBeInTheDocument();
    expect(screen.getByText('Second topic')).toBeInTheDocument();

    // No seed → the mount brief-preview effect is inert.
    expect(mockLoadBriefPreview).not.toHaveBeenCalled();
    // The hook seed is undefined in legacy mode.
    expect(mockUseContentRequests).toHaveBeenCalledWith(
      expect.objectContaining({ initialExpandedRequestId: undefined }),
    );
  });

  it('soloRequestId with a briefId → loadBriefPreview is called for the seed on mount', () => {
    const requests = [makeRequest({ id: 'cr-1', briefId: 'brief-9' })];
    render(<ContentTab {...baseProps} contentRequests={requests} soloRequestId="cr-1" />);
    expect(mockLoadBriefPreview).toHaveBeenCalledWith('brief-9');
    // The hook seed is the solo id.
    expect(mockUseContentRequests).toHaveBeenCalledWith(
      expect.objectContaining({ initialExpandedRequestId: 'cr-1' }),
    );
  });
});
