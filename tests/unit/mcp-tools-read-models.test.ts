import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  computeEffectiveTier: vi.fn(),
  getClientPortalUrl: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  addActivity: vi.fn(),
  toAdminWorkspaceView: vi.fn(),
  normalizeSocialProfiles: vi.fn(),
  invalidateIntelligenceCache: vi.fn(),
  listBatches: vi.fn(),
  listRequests: vi.fn(),
  countPendingClientActions: vi.fn(),
  listClientActions: vi.fn(),
  getInsights: vi.fn(),
  getInsightsByDomain: vi.fn(),
  getUnresolvedInsights: vi.fn(),
  listKeywordGaps: vi.fn(),
  listTopicClusters: vi.fn(),
  listCannibalizationIssues: vi.fn(),
  getDiscoveredQuerySummary: vi.fn(),
  getLostVisibilityQueries: vi.fn(),
  handleContentPerformance: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(),
  getPrimaryMarketLocationCode: vi.fn(),
  listDeliverables: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: h.getWorkspace,
  listWorkspaces: h.listWorkspaces,
  createWorkspace: h.createWorkspace,
  updateWorkspace: h.updateWorkspace,
  deleteWorkspace: h.deleteWorkspace,
  computeEffectiveTier: h.computeEffectiveTier,
  getClientPortalUrl: h.getClientPortalUrl,
}));

vi.mock('../../server/approvals.js', () => ({
  listBatches: h.listBatches,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcast: h.broadcast,
  broadcastToWorkspace: h.broadcastToWorkspace,
}));

vi.mock('../../server/activity-log.js', () => ({
  addActivity: h.addActivity,
}));

vi.mock('../../server/serializers/admin-workspace-view.js', () => ({
  toAdminWorkspaceView: h.toAdminWorkspaceView,
}));

vi.mock('../../server/social-profiles.js', () => ({
  normalizeSocialProfiles: h.normalizeSocialProfiles,
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: h.buildWorkspaceIntelligence,
}));
vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: h.invalidateIntelligenceCache,
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
  getInsightsByDomain: h.getInsightsByDomain,
  getUnresolvedInsights: h.getUnresolvedInsights,
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
  getDiscoveredQuerySummary: h.getDiscoveredQuerySummary,
  getLostVisibilityQueries: h.getLostVisibilityQueries,
}));

vi.mock('../../server/routes/content-requests.js', () => ({
  handleContentPerformance: h.handleContentPerformance,
}));

vi.mock('../../server/local-seo.js', () => ({
  getPrimaryMarketLocationCode: h.getPrimaryMarketLocationCode,
}));

vi.mock('../../server/brand-deliverable-read-model.js', () => ({
  listDeliverables: h.listDeliverables,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ error: h.loggerError, debug: h.loggerDebug, info: vi.fn(), warn: vi.fn() }),
}));

import { handleWorkspaceTool, pendingCounts } from '../../server/mcp/tools/workspaces.js';
import { handleClientTool } from '../../server/mcp/tools/clients.js';
import { handleInsightTool } from '../../server/mcp/tools/insights.js';
import { handleContentTool } from '../../server/mcp/tools/content.js';
import { handleIntelligenceTool } from '../../server/mcp/tools/intelligence.js';
import { handleBrandTool } from '../../server/mcp/tools/brand.js';

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
    h.computeEffectiveTier.mockImplementation((ws: { tier?: string }) => ws.tier ?? 'free');
    h.getClientPortalUrl.mockImplementation((ws: { id: string }) => `https://app.example.com/client/${ws.id}`);
    h.createWorkspace.mockImplementation((name: string) => ({
      id: 'ws-new',
      name,
      tier: 'free',
      folder: 'ws-new',
      createdAt: '2026-01-01T00:00:00.000Z',
    }));
    h.updateWorkspace.mockImplementation((id: string, updates: Record<string, unknown>) => ({
      id,
      name: typeof updates.name === 'string' ? updates.name : 'Workspace One',
      tier: 'growth',
      folder: id,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...updates,
    }));
    h.deleteWorkspace.mockReturnValue(true);
    h.toAdminWorkspaceView.mockImplementation((ws: { id: string; name: string; tier?: string }) => ({
      id: ws.id,
      name: ws.name,
      tier: ws.tier ?? 'free',
      folder: 'folder',
      createdAt: '2026-01-01T00:00:00.000Z',
      hasPassword: false,
      isTrial: false,
      trialDaysRemaining: 0,
      effectiveTier: ws.tier ?? 'free',
    }));
    h.normalizeSocialProfiles.mockImplementation((profiles: string[] | undefined) => profiles);

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
      if (type) {
        return [{ id: `${type}-1`, insightType: type }, { id: `${type}-2`, insightType: type }];
      }
      return [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }];
    });
    h.getInsightsByDomain.mockReturnValue([
      { id: 'd1', insightType: 'content_decay' },
      { id: 'd2', insightType: 'page_health' },
    ]);
    h.getUnresolvedInsights.mockReturnValue([{ id: 'u1' }, { id: 'u2' }]);

    h.listKeywordGaps.mockReturnValue([{ keyword: 'gap' }]);
    h.listTopicClusters.mockReturnValue([{ topic: 'cluster' }]);
    h.listCannibalizationIssues.mockReturnValue([{ page: '/dup' }]);
    h.getDiscoveredQuerySummary.mockReturnValue({ total: 3, byIntent: { informational: 2, commercial: 1 } });
    h.getLostVisibilityQueries.mockReturnValue([{ keyword: 'lost' }]);
    h.handleContentPerformance.mockResolvedValue({ items: [{ id: 'perf-1' }] });
    h.getPrimaryMarketLocationCode.mockReturnValue({ label: 'United States' });

    h.buildWorkspaceIntelligence.mockResolvedValue({
      clientSignals: { sentiment: 'healthy' },
      seoContext: { domain: 'example.com' },
      requestedSlices: ['insights'],
      brand: {
        availability: 'ready',
        identity: { mission: 'Make SEO simple', tagline: 'Grow with clarity' },
        voice: { status: 'calibrated', readiness: 'finalized', profileRevision: 4, voiceVersion: 1 },
        voicePromptBlock: 'voice block — should NOT leak',
        voiceDnaBlock: 'voice DNA — should NOT leak',
        identityPromptBlock: 'IDENTITY: Make SEO simple',
      },
    });

    h.listDeliverables.mockImplementation((workspaceId: string) => (
      workspaceId === 'ws-1'
        ? [
            { id: 'd1', deliverableType: 'mission', content: 'Make SEO simple', status: 'approved', version: 2, tier: 'core', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', workspaceId: 'ws-1' },
            { id: 'd2', deliverableType: 'tagline', content: 'Grow with clarity', status: 'draft', version: 1, tier: 'core', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', workspaceId: 'ws-1' },
          ]
        : []
    ));
  });

  it('workspace tools provide pending counts, overview, and error branches', async () => {
    expect(pendingCounts('ws-1')).toEqual({ pendingApprovals: 1, pendingRequests: 1, pendingActions: 2 });

    const list = await handleWorkspaceTool('list_workspaces', {});
    const listPayload = parseContent(list) as Array<{ id: string; pendingApprovals: number }>;
    expect(listPayload).toHaveLength(3);
    expect(listPayload[0]?.id).toBe('ws-1');

    const overview = await handleWorkspaceTool('get_workspace_overview', { workspaceId: 'ws-1' });
    const overviewPayload = parseContent(overview) as {
      totalPending: number;
      effective_tier: string;
      client_portal_url: string | null;
    };
    expect(overviewPayload.totalPending).toBe(4);
    expect(overviewPayload.effective_tier).toBe('growth');
    expect(overviewPayload.client_portal_url).toContain('/client/ws-1');

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

  it('workspace mutation tools validate input and support create/update/delete', async () => {
    const created = await handleWorkspaceTool('create_workspace', { name: 'Created Workspace' });
    expect(created.isError).toBeUndefined();
    expect(h.createWorkspace).toHaveBeenCalledWith('Created Workspace', undefined, undefined);

    const invalidCreate = await handleWorkspaceTool('create_workspace', {});
    expect(invalidCreate.isError).toBe(true);

    const updated = await handleWorkspaceTool('update_workspace', {
      workspace_id: 'ws-1',
      updates: { name: 'Updated Workspace', business_profile: { socialProfiles: ['https://example.com'] } },
    });
    expect(updated.isError).toBeUndefined();
    expect(h.updateWorkspace).toHaveBeenCalledWith('ws-1', expect.objectContaining({ name: 'Updated Workspace' }));
    expect(h.invalidateIntelligenceCache).toHaveBeenCalledWith('ws-1');

    h.updateWorkspace.mockReturnValueOnce(null);
    const updateMissing = await handleWorkspaceTool('update_workspace', {
      workspace_id: 'ws-1',
      updates: { name: 'Missing' },
    });
    expect(updateMissing.isError).toBe(true);

    const deleted = await handleWorkspaceTool('delete_workspace', {
      workspace_id: 'ws-1',
      confirm: 'delete_workspace',
    });
    expect(deleted.isError).toBeUndefined();
    expect(h.deleteWorkspace).toHaveBeenCalledWith('ws-1');

    const invalidDelete = await handleWorkspaceTool('delete_workspace', {
      workspace_id: 'ws-1',
      confirm: 'delete',
    });
    expect(invalidDelete.isError).toBe(true);
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

    const insights = await handleInsightTool('get_insights', { workspaceId: 'ws-1', type: 'page_health', limit: 2 });
    const insightsPayload = parseContent(insights) as Array<unknown>;
    expect(insightsPayload).toHaveLength(2);

    const domainInsights = await handleInsightTool('get_insights', { workspaceId: 'ws-1', domain: 'search', type: 'content_decay' });
    expect((parseContent(domainInsights) as Array<{ insightType: string }>)[0]?.insightType).toBe('content_decay');
    expect(h.getInsightsByDomain).toHaveBeenCalledWith('ws-1', 'search');

    const unresolved = await handleInsightTool('get_unresolved_insights', { workspaceId: 'ws-1', limit: 1 });
    expect((parseContent(unresolved) as Array<unknown>)).toHaveLength(1);
    expect(h.getUnresolvedInsights).toHaveBeenCalledWith('ws-1');

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
    expect(analysisPayload).toHaveProperty('discovered_query_summary');

    h.getPrimaryMarketLocationCode.mockImplementationOnce(() => { throw new Error('geo unavailable'); });
    const analysisNoGeo = await handleContentTool('get_keyword_analysis', { workspaceId: 'ws-1' });
    expect((parseContent(analysisNoGeo) as { geoVolumeLabel: string | null }).geoVolumeLabel).toBeNull();

    const seoContext = await handleContentTool('get_seo_context', { workspaceId: 'ws-1' });
    expect(parseContent(seoContext)).toEqual({ domain: 'example.com' });

    const performance = await handleContentTool('get_content_performance', { workspaceId: 'ws-1' });
    expect(parseContent(performance)).toEqual({ items: [{ id: 'perf-1' }] });

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

  it('brand tool returns identity + voice status without deliverables by default', async () => {
    const result = await handleBrandTool('get_brand_identity', { workspaceId: 'ws-1' });
    expect(result.isError).toBeUndefined();

    const payload = parseContent(result) as {
      availability: string;
      identity: Record<string, string>;
      voice_status: string;
      identity_prompt_block: string;
      deliverable_counts: { approved: number; pending: number; total: number };
      deliverables?: unknown;
    };
    expect(payload.availability).toBe('ready');
    expect(payload.identity).toEqual({ mission: 'Make SEO simple', tagline: 'Grow with clarity' });
    expect(payload.voice_status).toBe('calibrated');
    expect(payload.identity_prompt_block).toBe('IDENTITY: Make SEO simple');
    expect(payload.deliverable_counts).toEqual({ approved: 1, pending: 1, total: 2 });
    expect(payload).not.toHaveProperty('deliverables');
    // Voice content must NOT leak from this identity-scoped tool.
    expect(payload).not.toHaveProperty('voicePromptBlock');
    expect(payload).not.toHaveProperty('voiceDnaBlock');
    expect(h.buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-1', { slices: ['brand'] });
    expect(h.listDeliverables).toHaveBeenCalledWith('ws-1');
  });

  it('brand tool returns full deliverable list (draft + approved) when includeDeliverables is true', async () => {
    const result = await handleBrandTool('get_brand_identity', { workspaceId: 'ws-1', includeDeliverables: true });
    expect(result.isError).toBeUndefined();

    const payload = parseContent(result) as {
      deliverables: Array<{ id: string; deliverableType: string; status: string; version: number; tier: string }>;
    };
    expect(h.listDeliverables).toHaveBeenCalledWith('ws-1');
    expect(payload.deliverables).toHaveLength(2);
    expect(payload.deliverables.map(d => d.status)).toEqual(['approved', 'draft']);
    expect(payload.deliverables[0]).toEqual({
      id: 'd1', deliverableType: 'mission', content: 'Make SEO simple',
      status: 'approved', version: 2, tier: 'core',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('brand tool reports pending approval instead of ready/no-data beside an empty identity', async () => {
    h.buildWorkspaceIntelligence.mockResolvedValueOnce({ requestedSlices: ['brand'] });
    const result = await handleBrandTool('get_brand_identity', { workspaceId: 'ws-1' });
    const payload = parseContent(result) as {
      availability: string; identity: Record<string, string>; voice_status: string; identity_prompt_block: string;
    };
    expect(payload.availability).toBe('pending_approval');
    expect(payload.identity).toEqual({});
    expect(payload.voice_status).toBe('none');
    expect(payload.identity_prompt_block).toBe('');
  });

  it('brand tool errors on unknown tool, missing workspace, invalid args, and assembly throw', async () => {
    const unknown = await handleBrandTool('unknown_brand_tool', { workspaceId: 'ws-1' });
    expect(unknown.isError).toBe(true);

    const notFound = await handleBrandTool('get_brand_identity', { workspaceId: 'ws-missing' });
    expect(notFound.isError).toBe(true);
    expect(notFound.content[0]?.text).toContain('Workspace not found: ws-missing');

    const invalid = await handleBrandTool('get_brand_identity', {});
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]?.text).toContain('Validation failed');

    h.buildWorkspaceIntelligence.mockRejectedValueOnce(new Error('brand assembly boom'));
    const caught = await handleBrandTool('get_brand_identity', { workspaceId: 'ws-1' });
    expect(caught.isError).toBe(true);
    expect(caught.content[0]?.text).toContain('Tool error: brand assembly boom');
  });
});
