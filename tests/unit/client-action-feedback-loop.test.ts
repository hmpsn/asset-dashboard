import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientAction } from '../../shared/types/client-actions.js';

const mockGetInsights = vi.fn();
const mockResolveInsight = vi.fn();
const mockGetActionByWorkspaceAndSource = vi.fn();
const mockRecordAction = vi.fn();
const mockUpdateActionContext = vi.fn();
const mockUpdateAttribution = vi.fn();
const mockToInsightPageId = vi.fn();
const mockWarn = vi.fn();

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: mockGetInsights,
  resolveInsight: mockResolveInsight,
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getActionByWorkspaceAndSource: mockGetActionByWorkspaceAndSource,
  recordAction: mockRecordAction,
  updateActionContext: mockUpdateActionContext,
  updateAttribution: mockUpdateAttribution,
}));

vi.mock('../../server/helpers.js', () => ({
  toInsightPageId: mockToInsightPageId,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({ warn: mockWarn })),
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    transaction: (fn: (...args: any[]) => any) => {
      const tx = (...args: any[]) => fn(...args);
      (tx as any).immediate = (...args: any[]) => fn(...args);
      return tx;
    },
  },
}));

function makeAction(overrides: Partial<ClientAction> = {}): ClientAction {
  return {
    id: 'ca_1',
    workspaceId: 'ws_1',
    sourceType: 'internal_link',
    sourceId: 'src_1',
    title: 'Action title',
    summary: 'Action summary',
    payload: {},
    status: 'approved',
    priority: 'medium',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

async function loadModule() {
  return import('../../server/domains/inbox/client-action-feedback-loop.js');
}

describe('client-action-feedback-loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToInsightPageId.mockImplementation((url: string) => url.toLowerCase());
    mockGetInsights.mockReturnValue([]);
    mockResolveInsight.mockReturnValue({ id: 'resolved' });
    mockGetActionByWorkspaceAndSource.mockReturnValue(null);
    mockRecordAction.mockReturnValue({ id: 'tracked_1' });
  });

  it('prefers explicit origin insightIds and marks them in_progress on approved', async () => {
    mockGetInsights.mockReturnValue([
      { id: 'i1', pageId: '/a', strategyKeyword: 'hvac', resolutionStatus: null, data: {} },
      { id: 'i2', pageId: '/b', strategyKeyword: 'plumber', resolutionStatus: 'resolved', data: {} },
    ]);

    const action = makeAction({
      payload: {
        metadata: {
          origin: {
            insightIds: ['i1', 'i2', 'missing'],
            pageUrl: '/unused-fallback',
            targetKeyword: 'unused',
          },
        },
      },
    });

    const { applyClientActionFeedbackLoop } = await loadModule();
    applyClientActionFeedbackLoop('ws_1', action, 'approved');

    expect(mockResolveInsight).toHaveBeenCalledTimes(1);
    expect(mockResolveInsight).toHaveBeenCalledWith(
      'i1',
      'ws_1',
      'in_progress',
      'Auto-progressed from client action approval: Action title',
      'client_action_feedback_loop',
    );
  });

  it('uses single-match page/keyword fallback and resolves insight on completed', async () => {
    mockGetInsights.mockReturnValue([
      {
        id: 'i_match',
        pageId: '/services/plumbing',
        strategyKeyword: 'plumbing repair',
        resolutionStatus: null,
        data: { keyword: 'plumbing repair' },
      },
      {
        id: 'i_other',
        pageId: '/blog/post',
        strategyKeyword: 'other keyword',
        resolutionStatus: 'resolved',
        data: { query: 'other keyword' },
      },
    ]);

    const action = makeAction({
      status: 'completed',
      payload: {
        metadata: {
          origin: {
            pageUrl: '/services/plumbing',
            targetKeyword: 'plumbing repair',
          },
        },
      },
    });

    const { applyClientActionFeedbackLoop } = await loadModule();
    applyClientActionFeedbackLoop('ws_1', action, 'completed');

    expect(mockResolveInsight).toHaveBeenCalledWith(
      'i_match',
      'ws_1',
      'resolved',
      'Auto-resolved from client action completion: Action title',
      'client_action_feedback_loop',
    );
  });

  it('does not resolve by fallback when page/keyword matching is ambiguous', async () => {
    mockGetInsights.mockReturnValue([
      { id: 'i1', pageId: '/page', strategyKeyword: 'same kw', resolutionStatus: null, data: {} },
      { id: 'i2', pageId: '/page', strategyKeyword: 'same kw', resolutionStatus: null, data: {} },
    ]);

    const action = makeAction({
      payload: {
        metadata: {
          origin: {
            pageUrl: '/page',
            targetKeyword: 'same kw',
          },
        },
      },
    });

    const { applyClientActionFeedbackLoop } = await loadModule();
    applyClientActionFeedbackLoop('ws_1', action, 'approved');

    expect(mockResolveInsight).not.toHaveBeenCalled();
  });

  it('reads fallback origin metadata from legacy payload.page fields', async () => {
    mockGetInsights.mockReturnValue([
      { id: 'i_legacy', pageId: '/legacy', strategyKeyword: null, resolutionStatus: null, data: { query: 'legacy kw' } },
    ]);

    const action = makeAction({
      payload: {
        page: {
          page: '/legacy',
          targetKeyword: 'legacy kw',
        },
      },
    });

    const { applyClientActionFeedbackLoop } = await loadModule();
    applyClientActionFeedbackLoop('ws_1', action, 'approved');

    expect(mockResolveInsight).toHaveBeenCalledWith(
      'i_legacy',
      'ws_1',
      'in_progress',
      'Auto-progressed from client action approval: Action title',
      'client_action_feedback_loop',
    );
  });

  it('upgrades existing source-tracked action attribution/context instead of creating a lifecycle action', async () => {
    mockGetInsights.mockReturnValue([]);
    mockGetActionByWorkspaceAndSource.mockImplementation((workspaceId: string, sourceType: string, sourceId: string) => {
      if (workspaceId === 'ws_1' && sourceType === 'internal_link' && sourceId === 'src_track') {
        return {
          id: 'tracked_existing',
          attribution: 'user_executed',
          context: { relatedActions: ['ca_old'] },
        };
      }
      return null;
    });

    const action = makeAction({
      id: 'ca_new',
      payload: {
        metadata: {
          origin: {
            trackingSourceId: 'src_track',
          },
        },
      },
    });

    const { applyClientActionFeedbackLoop } = await loadModule();
    applyClientActionFeedbackLoop('ws_1', action, 'approved');

    expect(mockUpdateAttribution).toHaveBeenCalledWith('tracked_existing', 'ws_1', 'platform_executed');
    expect(mockUpdateActionContext).toHaveBeenCalledWith('tracked_existing', 'ws_1', {
      relatedActions: ['ca_old', 'ca_new'],
    });
    expect(mockRecordAction).not.toHaveBeenCalled();
  });

  it('creates lifecycle tracked action when no existing source/lifecycle actions exist', async () => {
    const action = makeAction({
      id: 'ca_lifecycle',
      sourceType: 'content_decay',
      status: 'completed',
      title: 'Refresh top page',
      payload: {
        metadata: {
          origin: {
            pageUrl: '/pricing',
            targetKeyword: 'pricing software',
          },
        },
      },
    });

    const { applyClientActionFeedbackLoop } = await loadModule();
    applyClientActionFeedbackLoop('ws_1', action, 'completed');

    expect(mockRecordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_1',
        actionType: 'content_refreshed',
        sourceType: 'client_action',
        sourceId: 'ca_lifecycle',
        pageUrl: '/pricing',
        targetKeyword: 'pricing software',
        attribution: 'platform_executed',
      }),
    );
  });

  it('updates attribution only for pre-existing lifecycle action and skips duplicate recordAction', async () => {
    mockGetActionByWorkspaceAndSource.mockImplementation((workspaceId: string, sourceType: string, sourceId: string) => {
      if (workspaceId === 'ws_1' && sourceType === 'client_action' && sourceId === 'ca_1') {
        return {
          id: 'existing_lifecycle',
          attribution: 'user_executed',
          context: { relatedActions: [] },
        };
      }
      return null;
    });

    const { applyClientActionFeedbackLoop } = await loadModule();
    applyClientActionFeedbackLoop('ws_1', makeAction(), 'approved');

    expect(mockUpdateAttribution).toHaveBeenCalledWith('existing_lifecycle', 'ws_1', 'platform_executed');
    expect(mockRecordAction).not.toHaveBeenCalled();
  });

  it('logs and swallows failures so mutation flow does not crash callers', async () => {
    mockGetInsights.mockImplementation(() => {
      throw new Error('insights store offline');
    });

    const { applyClientActionFeedbackLoop } = await loadModule();

    expect(() => applyClientActionFeedbackLoop('ws_1', makeAction(), 'approved')).not.toThrow();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws_1', actionId: 'ca_1', status: 'approved' }),
      'client action feedback loop failed',
    );
  });
});
