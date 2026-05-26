import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  listBatches: vi.fn(),
  listRequests: vi.fn(),
  countPendingClientActions: vi.fn(),
  listClientActions: vi.fn(),
  getInsights: vi.fn(),
  listKeywordGaps: vi.fn(),
  listTopicClusters: vi.fn(),
  listCannibalizationIssues: vi.fn(),
  getLostVisibilityQueries: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(),
  getPrimaryMarketLocationCode: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: h.getWorkspace,
  listWorkspaces: h.listWorkspaces,
}));

vi.mock('../../server/approvals.js', () => ({
  listBatches: h.listBatches,
}));

vi.mock('../../server/requests.js', () => ({
  listRequests: h.listRequests,
}));

vi.mock('../../server/client-actions.js', () => ({
  countPendingClientActions: h.countPendingClientActions,
  listClientActions: h.listClientActions,
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: h.getInsights,
}));

vi.mock('../../server/keyword-gaps.js', () => ({
  listKeywordGaps: h.listKeywordGaps,
}));

vi.mock('../../server/topic-clusters.js', () => ({
  listTopicClusters: h.listTopicClusters,
}));

vi.mock('../../server/cannibalization-issues.js', () => ({
  listCannibalizationIssues: h.listCannibalizationIssues,
}));

vi.mock('../../server/client-discovered-queries.js', () => ({
  getLostVisibilityQueries: h.getLostVisibilityQueries,
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: h.buildWorkspaceIntelligence,
}));

vi.mock('../../server/local-seo.js', () => ({
  getPrimaryMarketLocationCode: h.getPrimaryMarketLocationCode,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ error: h.loggerError, debug: h.loggerDebug, info: vi.fn(), warn: vi.fn() }),
}));

import { handleWorkspaceTool, pendingCounts } from '../../server/mcp/tools/workspaces.js';
import { handleClientTool } from '../../server/mcp/tools/clients.js';
import { handleInsightTool } from '../../server/mcp/tools/insights.js';
import { handleContentTool } from '../../server/mcp/tools/content.js';
import { handleIntelligenceTool } from '../../server/mcp/tools/intelligence.js';

function parseContent(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? 'null');
}

describe('mcp read-model tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    h.getWorkspace.mockImplementation((id: string) => {
      if (id === 'ws-1') return { id: 'ws-1', name: 'Workspace One', tier: 'growth', liveDomain: 'example.com' };
      if (id === 'ws-2') return { id: 'ws-2', name: 'Workspace Two', tier: 'free', liveDomain: null };
      if (id === 'ws-3') return { id: 'ws-3', name: 'Workspace Three' };
      return undefined;
    });

    h.listWorkspaces.mockReturnValue([
      { id: 'ws-1', name: 'Workspace One', tier: 'growth', liveDomain: 'example.com' },
      { id: 'ws-2', name: 'Workspace Two', tier: 'free', liveDomain: null },
      { id: 'ws-3', name: 'Workspace Three' },
    ]);

    h.listBatches.mockImplementation((workspaceId: string) => {
      if (workspaceId === 'ws-1') {
        return [{ items: [{ status: 'pending' }, { status: 'approved' }] }];
      }
      return [{ items: [{ status: 'approved' }] }];
    });

    h.listRequests.mockImplementation((workspaceId?: string) => {
      if (workspaceId === 'ws-1') return [{ id: 'r1', workspaceId: 'ws-1', status: 'new' }, { id: 'r2', workspaceId: 'ws-1', status: 'done' }];
      if (workspaceId === 'ws-2') return [{ id: 'r3', workspaceId: 'ws-2', status: 'new' }];
      if (workspaceId === 'ws-3') return [];
      return [
        { id: 'r1', workspaceId: 'ws-1', status: 'new' },
        { id: 'r2', workspaceId: 'ws-1', status: 'done' },
        { id: 'r3', workspaceId: 'ws-2', status: 'new' },
      ];
    });

    h.countPendingClientActions.mockImplementation((workspaceId: string) => (workspaceId === 'ws-1' ? 2 : 0));
    h.listClientActions.mockImplementation((workspaceId: string) => (
      workspaceId === 'ws-1'
        ? [{ status: 'pending', id: 'a1' }, { status: 'done', id: 'a2' }]
        : []
    ));

    h.getInsights.mockImplementation((_workspaceId: string, type?: string) => {
      if (type === 'anomaly_digest') {
        return [
          { id: 'an-1', resolutionStatus: 'open' },
          { id: 'an-2', resolutionStatus: 'resolved' },
        ];
      }
      if (type === 'content_decay') {
        return [
          { pageId: 'p1', impactScore: 2, severity: 'medium', data: { decline: 10 } },
          { pageId: 'p2', impactScore: 9, severity: 'high', data: { decline: 30 } },
        ];
      }
      return [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }];
    });

    h.listKeywordGaps.mockReturnValue([{ keyword: 'gap' }]);
    h.listTopicClusters.mockReturnValue([{ topic: 'cluster' }]);
    h.listCannibalizationIssues.mockReturnValue([{ page: '/dup' }]);
    h.getLostVisibilityQueries.mockReturnValue([{ keyword: 'lost' }]);
    h.getPrimaryMarketLocationCode.mockReturnValue({ label: 'United States' });

    h.buildWorkspaceIntelligence.mockResolvedValue({
      clientSignals: { sentiment: 'healthy' },
      seoContext: { domain: 'example.com' },
      requestedSlices: ['insights'],
    });
  });

  it('workspace tools provide pending counts, overview, and error branches', async () => {
    expect(pendingCounts('ws-1')).toEqual({ pendingApprovals: 1, pendingRequests: 1, pendingActions: 2 });

    const list = await handleWorkspaceTool('list_workspaces', {});
    const listPayload = parseContent(list) as Array<{ id: string; pendingApprovals: number }>;
    expect(listPayload).toHaveLength(3);
    expect(listPayload[0]?.id).toBe('ws-1');

    const overview = await handleWorkspaceTool('get_workspace_overview', { workspaceId: 'ws-1' });
    const overviewPayload = parseContent(overview) as { totalPending: number };
    expect(overviewPayload.totalPending).toBe(4);

    const overviewFallback = await handleWorkspaceTool('get_workspace_overview', { workspaceId: 'ws-3' });
    const overviewFallbackPayload = parseContent(overviewFallback) as { tier: string; liveDomain: string | null };
    expect(overviewFallbackPayload.tier).toBe('free');
    expect(overviewFallbackPayload.liveDomain).toBeNull();

    const missingId = await handleWorkspaceTool('get_workspace_overview', {});
    expect(missingId.isError).toBe(true);

    const missingWs = await handleWorkspaceTool('get_workspace_overview', { workspaceId: 'ws-missing' });
    expect(missingWs.isError).toBe(true);

    const unknown = await handleWorkspaceTool('unknown_workspace_tool', {});
    expect(unknown.isError).toBe(true);

    h.listWorkspaces.mockImplementationOnce(() => { throw new Error('db down'); });
    const caught = await handleWorkspaceTool('list_workspaces', {});
    expect(caught.isError).toBe(true);
    expect(caught.content[0]?.text).toContain('Tool error: db down');

    h.listWorkspaces.mockImplementationOnce(() => { throw 'non-error-failure'; });
    const caughtString = await handleWorkspaceTool('list_workspaces', {});
    expect(caughtString.isError).toBe(true);
    expect(caughtString.content[0]?.text).toContain('Tool error: non-error-failure');
  });

  it('client tools handle single-workspace and cross-workspace pending work flows', async () => {
    const bad = await handleClientTool('get_client_signals', {});
    expect(bad.isError).toBe(true);

    const missing = await handleClientTool('get_client_signals', { workspaceId: 'ws-missing' });
    expect(missing.isError).toBe(true);

    const signals = await handleClientTool('get_client_signals', { workspaceId: 'ws-1' });
    expect(parseContent(signals)).toEqual({ sentiment: 'healthy' });

    const single = await handleClientTool('get_pending_work', { workspaceId: 'ws-1' });
    const singlePayload = parseContent(single) as { totalPending: number; requests: Array<{ status: string }>; clientActions: Array<{ status: string }> };
    expect(singlePayload.totalPending).toBe(4);
    expect(singlePayload.requests).toHaveLength(1);
    expect(singlePayload.clientActions).toHaveLength(1);

    const cross = await handleClientTool('get_pending_work', {});
    const crossPayload = parseContent(cross) as { totalPending: number; workspaces: Array<{ id: string; total: number }> };
    expect(crossPayload.totalPending).toBeGreaterThan(0);
    expect(crossPayload.workspaces.some(w => w.id === 'ws-1')).toBe(true);

    const unknown = await handleClientTool('unknown_client_tool', {});
    expect(unknown.isError).toBe(true);

    h.listRequests.mockImplementationOnce(() => { throw new Error('request read failed'); });
    const caught = await handleClientTool('get_pending_work', {});
    expect(caught.isError).toBe(true);
    expect(caught.content[0]?.text).toContain('Tool error: request read failed');
  });

  it('insight tools handle filters and anomaly resolved toggle', async () => {
    const missing = await handleInsightTool('get_insights', {});
    expect(missing.isError).toBe(true);

    const notFound = await handleInsightTool('get_insights', { workspaceId: 'ws-missing' });
    expect(notFound.isError).toBe(true);

    const insights = await handleInsightTool('get_insights', { workspaceId: 'ws-1', type: 'page_health', limit: 2.9 });
    const insightsPayload = parseContent(insights) as Array<unknown>;
    expect(insightsPayload).toHaveLength(2);

    const anomaliesOpen = await handleInsightTool('get_anomalies', { workspaceId: 'ws-1' });
    const anomaliesOpenPayload = parseContent(anomaliesOpen) as Array<{ resolutionStatus: string }>;
    expect(anomaliesOpenPayload).toHaveLength(1);
    expect(anomaliesOpenPayload[0]?.resolutionStatus).toBe('open');

    const anomaliesAll = await handleInsightTool('get_anomalies', { workspaceId: 'ws-1', resolved: true });
    expect((parseContent(anomaliesAll) as Array<unknown>).length).toBe(2);

    const unknown = await handleInsightTool('unknown_insight_tool', { workspaceId: 'ws-1' });
    expect(unknown.isError).toBe(true);

    h.getInsights.mockImplementationOnce(() => { throw new Error('insight read failure'); });
    const caught = await handleInsightTool('get_insights', { workspaceId: 'ws-1' });
    expect(caught.isError).toBe(true);
    expect(caught.content[0]?.text).toContain('Tool error: insight read failure');
  });

  it('content tools cover decay, keyword analysis, seo context, unknown, and error fallback', async () => {
    const missing = await handleContentTool('get_content_decay', {});
    expect(missing.isError).toBe(true);

    const notFound = await handleContentTool('get_content_decay', { workspaceId: 'ws-missing' });
    expect(notFound.isError).toBe(true);

    const decay = await handleContentTool('get_content_decay', { workspaceId: 'ws-1', limit: 1.8 });
    const decayPayload = parseContent(decay) as Array<{ pageId: string }>;
    expect(decayPayload).toHaveLength(1);
    expect(decayPayload[0]?.pageId).toBe('p2');

    const analysis = await handleContentTool('get_keyword_analysis', { workspaceId: 'ws-1' });
    const analysisPayload = parseContent(analysis) as { geoVolumeLabel: string | null; gaps: Array<unknown>; lostVisibility: Array<unknown> };
    expect(analysisPayload.geoVolumeLabel).toBe('United States');
    expect(analysisPayload.gaps).toHaveLength(1);
    expect(analysisPayload.lostVisibility).toHaveLength(1);

    h.getPrimaryMarketLocationCode.mockImplementationOnce(() => { throw new Error('geo unavailable'); });
    const analysisNoGeo = await handleContentTool('get_keyword_analysis', { workspaceId: 'ws-1' });
    expect((parseContent(analysisNoGeo) as { geoVolumeLabel: string | null }).geoVolumeLabel).toBeNull();

    const seoContext = await handleContentTool('get_seo_context', { workspaceId: 'ws-1' });
    expect(parseContent(seoContext)).toEqual({ domain: 'example.com' });

    const unknown = await handleContentTool('unknown_content_tool', { workspaceId: 'ws-1' });
    expect(unknown.isError).toBe(true);

    h.getInsights.mockImplementationOnce(() => { throw new Error('decay crash'); });
    const caught = await handleContentTool('get_content_decay', { workspaceId: 'ws-1' });
    expect(caught.isError).toBe(true);
    expect(caught.content[0]?.text).toContain('Tool error: decay crash');
  });

  it('intelligence tool validates name/workspace and filters invalid slices', async () => {
    const unknown = await handleIntelligenceTool('unknown_intel', { workspaceId: 'ws-1' });
    expect(unknown.isError).toBe(true);

    const missing = await handleIntelligenceTool('get_workspace_intelligence', {});
    expect(missing.isError).toBe(true);

    const notFound = await handleIntelligenceTool('get_workspace_intelligence', { workspaceId: 'ws-missing' });
    expect(notFound.isError).toBe(true);

    const ok = await handleIntelligenceTool('get_workspace_intelligence', {
      workspaceId: 'ws-1',
      slices: ['insights', 'invalid-slice'],
    });
    expect(ok.isError).toBeUndefined();
    expect(h.buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-1', {
      slices: ['insights'],
    });

    const invalidSlices = await handleIntelligenceTool('get_workspace_intelligence', {
      workspaceId: 'ws-1',
      slices: ['invalid-slice'],
    });
    expect(invalidSlices.isError).toBe(true);
    expect(invalidSlices.content[0]?.text).toContain('No valid intelligence slices');

    h.buildWorkspaceIntelligence.mockRejectedValueOnce(new Error('assembly failed'));
    const caught = await handleIntelligenceTool('get_workspace_intelligence', { workspaceId: 'ws-1' });
    expect(caught.isError).toBe(true);
    expect(caught.content[0]?.text).toContain('Intelligence assembly failed: assembly failed');
  });
});
