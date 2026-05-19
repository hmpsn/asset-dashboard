// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildWorkspaceIntelligenceMock,
  callAIMock,
  upsertMeetingBriefMock,
  broadcastToWorkspaceMock,
} = vi.hoisted(() => ({
  buildWorkspaceIntelligenceMock: vi.fn(),
  callAIMock: vi.fn(),
  upsertMeetingBriefMock: vi.fn(),
  broadcastToWorkspaceMock: vi.fn(),
}));

vi.mock('../workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: buildWorkspaceIntelligenceMock,
}));

vi.mock('../ai.js', () => ({
  callAI: callAIMock,
}));

vi.mock('../prompt-assembly.js', () => ({
  buildSystemPrompt: vi.fn(() => 'SYSTEM PROMPT'),
  getCustomPromptNotes: vi.fn(() => null),
}));

vi.mock('../meeting-brief-store.js', () => ({
  getMeetingBriefHash: vi.fn(() => null),
  upsertMeetingBrief: upsertMeetingBriefMock,
}));

vi.mock('../broadcast.js', () => ({
  broadcastToWorkspace: broadcastToWorkspaceMock,
}));

vi.mock('../ws-events.js', () => ({
  WS_EVENTS: { MEETING_BRIEF_GENERATED: 'meeting-brief:generated' },
}));

import { generateMeetingBrief } from '../meeting-brief-generator.js';

const baseIntel = {
  version: 1,
  workspaceId: 'ws_test',
  assembledAt: '2026-05-19T00:00:00.000Z',
  insights: {
    byType: { ranking_opportunity: [] },
    bySeverity: { critical: 0, warning: 0, opportunity: 0, positive: 0 },
    topByImpact: [],
  },
  learnings: {
    availability: 'ready',
    overallWinRate: 0.6,
    topWins: [],
  },
  siteHealth: { auditScore: 80, auditScoreDelta: 2 },
  contentPipeline: {
    briefs: { total: 1, byStatus: {} },
    posts: { total: 2, byStatus: {} },
  },
  clientSignals: { businessPriorities: [] },
  seoContext: { strategy: { siteKeywords: ['seo audit'] } },
};

describe('generateMeetingBrief structured output handling', () => {
  beforeEach(() => {
    buildWorkspaceIntelligenceMock.mockReset();
    callAIMock.mockReset();
    upsertMeetingBriefMock.mockReset();
    broadcastToWorkspaceMock.mockReset();
    buildWorkspaceIntelligenceMock.mockResolvedValue(baseIntel);
  });

  it('retries once when the first response is invalid structured output', async () => {
    callAIMock
      .mockResolvedValueOnce({ text: '{"wins":"wrong-shape"}' })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          situationSummary: 'Momentum is positive.',
          wins: ['Improved rankings'],
          attention: ['Refresh thin page'],
          recommendations: [{ action: 'Update page copy', rationale: 'Recent decay signal' }],
        }),
      });

    const result = await generateMeetingBrief('ws_test');

    expect(callAIMock).toHaveBeenCalledTimes(2);
    expect(callAIMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      operation: 'meeting-brief',
    }));
    expect(callAIMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operation: 'meeting-brief',
    }));
    expect(result.situationSummary).toBe('Momentum is positive.');
    expect(upsertMeetingBriefMock).toHaveBeenCalled();
    expect(broadcastToWorkspaceMock).toHaveBeenCalledWith('ws_test', 'meeting-brief:generated', {});
  });

  it('throws after retry when structured output is still invalid', async () => {
    callAIMock
      .mockResolvedValueOnce({ text: '{"wins":"wrong-shape"}' })
      .mockResolvedValueOnce({ text: '{"attention":42}' });

    await expect(generateMeetingBrief('ws_test')).rejects.toThrow(
      'Meeting brief AI returned invalid structured output after retry',
    );
  });
});
