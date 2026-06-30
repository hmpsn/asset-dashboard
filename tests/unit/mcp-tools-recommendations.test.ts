import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));
vi.mock('../../server/recommendations.js', () => ({
  isActiveRec: vi.fn(),
  loadRecommendations: vi.fn(),
}));
vi.mock('../../server/recommendation-lifecycle.js', () => ({
  sendRecommendation: vi.fn(),
  throttleRecommendation: vi.fn(),
  strikeRecommendation: vi.fn(),
}));
vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../../server/activity-log.js', () => ({
  addActivity: vi.fn(),
}));

import { getWorkspace } from '../../server/workspaces.js';
import { isActiveRec, loadRecommendations } from '../../server/recommendations.js';
import {
  sendRecommendation,
  throttleRecommendation,
  strikeRecommendation,
} from '../../server/recommendation-lifecycle.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { addActivity } from '../../server/activity-log.js';
import { InvalidTransitionError } from '../../server/state-machines.js';
import {
  recommendationActionTools,
  handleRecommendationActionTool,
} from '../../server/mcp/tools/recommendation-actions.js';

type Mock = ReturnType<typeof vi.fn>;

function makeRec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rec_1',
    workspaceId: 'ws-1',
    priority: 'fix_now',
    type: 'content',
    title: 'Refresh the HVAC pillar',
    description: 'Traffic is decaying on the pillar page.',
    insight: 'why',
    impact: 'high',
    effort: 'medium',
    impactScore: 82,
    source: 'content_decay',
    affectedPages: ['/blog/hvac'],
    trafficAtRisk: 100,
    impressionsAtRisk: 1000,
    estimatedGain: '+12% clicks',
    actionType: 'content_creation',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mcp recommendation action tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getWorkspace as Mock).mockReturnValue({ id: 'ws-1', name: 'Workspace' });
    (isActiveRec as Mock).mockReturnValue(true);
    (loadRecommendations as Mock).mockReturnValue(null);
  });

  it('registers recommendation action tool names', () => {
    expect(recommendationActionTools.map(t => t.name)).toEqual([
      'list_recommendations',
      'apply_recommendation',
    ]);
  });

  it('list_recommendations returns the active set by default', async () => {
    const active = makeRec({ id: 'rec_active' });
    const struck = makeRec({ id: 'rec_struck', lifecycle: 'struck' });
    (loadRecommendations as Mock).mockReturnValue({
      workspaceId: 'ws-1',
      generatedAt: '2026-01-02T00:00:00.000Z',
      recommendations: [active, struck],
    });
    // Only the active rec satisfies isActiveRec.
    (isActiveRec as Mock).mockImplementation((rec: { id: string }) => rec.id === 'rec_active');

    const result = await handleRecommendationActionTool('list_recommendations', { workspace_id: 'ws-1' });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as {
      recommendations: Array<{ recommendation_id: string }>;
      filter: string;
      generated_at: string | null;
    };
    expect(payload.filter).toBe('active');
    expect(payload.generated_at).toBe('2026-01-02T00:00:00.000Z');
    expect(payload.recommendations).toHaveLength(1);
    expect(payload.recommendations[0].recommendation_id).toBe('rec_active');
  });

  it('list_recommendations with filter:all returns every rec', async () => {
    (loadRecommendations as Mock).mockReturnValue({
      workspaceId: 'ws-1',
      generatedAt: '2026-01-02T00:00:00.000Z',
      recommendations: [makeRec({ id: 'rec_a' }), makeRec({ id: 'rec_b', lifecycle: 'struck' })],
    });
    const result = await handleRecommendationActionTool('list_recommendations', {
      workspace_id: 'ws-1',
      filter: 'all',
    });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as { recommendations: unknown[]; filter: string };
    expect(payload.filter).toBe('all');
    expect(payload.recommendations).toHaveLength(2);
    // isActiveRec must NOT be used to filter when filter:'all'.
    expect(isActiveRec).not.toHaveBeenCalled();
  });

  it('list_recommendations returns empty when no recommendation set exists', async () => {
    (loadRecommendations as Mock).mockReturnValue(null);
    const result = await handleRecommendationActionTool('list_recommendations', { workspace_id: 'ws-1' });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as { recommendations: unknown[]; generated_at: null };
    expect(payload.recommendations).toEqual([]);
    expect(payload.generated_at).toBeNull();
  });

  it('apply_recommendation dispatches send → sendRecommendation, broadcasts + logs', async () => {
    (sendRecommendation as Mock).mockReturnValue(makeRec({ clientStatus: 'sent' }));
    const result = await handleRecommendationActionTool('apply_recommendation', {
      workspace_id: 'ws-1',
      recommendation_id: 'rec_1',
      action: 'send',
    });
    expect(result.isError).toBeUndefined();
    expect(sendRecommendation).toHaveBeenCalledWith('ws-1', 'rec_1');
    expect(throttleRecommendation).not.toHaveBeenCalled();
    expect(strikeRecommendation).not.toHaveBeenCalled();
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'recommendations:updated',
      expect.objectContaining({ recId: 'rec_1', clientStatus: 'sent' }),
    );
    expect(addActivity).toHaveBeenCalledWith(
      'ws-1',
      'rec_sent',
      expect.stringContaining('sent to client'),
      expect.any(String),
      expect.objectContaining({ source: 'mcp-chat' }),
    );
  });

  it('apply_recommendation dispatches throttle → throttleRecommendation with days', async () => {
    (throttleRecommendation as Mock).mockReturnValue(makeRec({ lifecycle: 'throttled' }));
    const result = await handleRecommendationActionTool('apply_recommendation', {
      workspace_id: 'ws-1',
      recommendation_id: 'rec_1',
      action: 'throttle',
      throttle_days: 30,
    });
    expect(result.isError).toBeUndefined();
    expect(throttleRecommendation).toHaveBeenCalledWith('ws-1', 'rec_1', 30);
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'recommendations:updated',
      expect.objectContaining({ recId: 'rec_1', lifecycle: 'throttled' }),
    );
    expect(addActivity).toHaveBeenCalledWith(
      'ws-1',
      'rec_throttled',
      expect.stringContaining('throttled 30d'),
      expect.any(String),
      expect.objectContaining({ source: 'mcp-chat' }),
    );
  });

  it('apply_recommendation rejects throttle without throttle_days', async () => {
    const result = await handleRecommendationActionTool('apply_recommendation', {
      workspace_id: 'ws-1',
      recommendation_id: 'rec_1',
      action: 'throttle',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('throttle_days is required');
    expect(throttleRecommendation).not.toHaveBeenCalled();
  });

  it('apply_recommendation dispatches strike → strikeRecommendation', async () => {
    (strikeRecommendation as Mock).mockReturnValue(makeRec({ lifecycle: 'struck' }));
    const result = await handleRecommendationActionTool('apply_recommendation', {
      workspace_id: 'ws-1',
      recommendation_id: 'rec_1',
      action: 'strike',
    });
    expect(result.isError).toBeUndefined();
    expect(strikeRecommendation).toHaveBeenCalledWith('ws-1', 'rec_1');
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'recommendations:updated',
      expect.objectContaining({ recId: 'rec_1', lifecycle: 'struck' }),
    );
    expect(addActivity).toHaveBeenCalledWith(
      'ws-1',
      'rec_struck',
      expect.stringContaining('struck'),
      expect.any(String),
      expect.objectContaining({ source: 'mcp-chat' }),
    );
  });

  it('apply_recommendation returns mcpError when the rec is not found (null)', async () => {
    (sendRecommendation as Mock).mockReturnValue(null);
    const result = await handleRecommendationActionTool('apply_recommendation', {
      workspace_id: 'ws-1',
      recommendation_id: 'rec_missing',
      action: 'send',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Recommendation not found');
    expect(broadcastToWorkspace).not.toHaveBeenCalled();
    expect(addActivity).not.toHaveBeenCalled();
  });

  it('apply_recommendation surfaces an illegal transition as an mcpError', async () => {
    (sendRecommendation as Mock).mockImplementation(() => {
      throw new InvalidTransitionError('recommendation', 'sent', 'sent');
    });
    const result = await handleRecommendationActionTool('apply_recommendation', {
      workspace_id: 'ws-1',
      recommendation_id: 'rec_1',
      action: 'send',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot send recommendation');
    expect(broadcastToWorkspace).not.toHaveBeenCalled();
  });

  it('apply_recommendation rejects an unknown action via the zod enum', async () => {
    const result = await handleRecommendationActionTool('apply_recommendation', {
      workspace_id: 'ws-1',
      recommendation_id: 'rec_1',
      action: 'approve',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
    expect(sendRecommendation).not.toHaveBeenCalled();
    expect(throttleRecommendation).not.toHaveBeenCalled();
    expect(strikeRecommendation).not.toHaveBeenCalled();
  });

  it('returns workspace + unknown-tool errors', async () => {
    (getWorkspace as Mock).mockReturnValueOnce(undefined);
    const noWorkspace = await handleRecommendationActionTool('list_recommendations', { workspace_id: 'ws-missing' });
    expect(noWorkspace.isError).toBe(true);
    expect(noWorkspace.content[0].text).toContain('Workspace not found');

    const unknown = await handleRecommendationActionTool('unknown_rec_action', { workspace_id: 'ws-1' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain('Unknown recommendation action tool');
  });
});
