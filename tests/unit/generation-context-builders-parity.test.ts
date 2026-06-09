import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';

vi.mock('../../server/workspace-intelligence.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/workspace-intelligence.js')>();
  return {
    ...actual,
    buildWorkspaceIntelligence: vi.fn(),
  };
});

import { buildSeoPromptContext } from '../../server/intelligence/generation-context-builders.js';
import {
  buildWorkspaceIntelligence,
  formatForPrompt,
  formatPageMapForPrompt,
} from '../../server/workspace-intelligence.js';

const realisticIntelligence: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-seo',
  assembledAt: '2026-06-09T00:00:00.000Z',
  seoContext: {
    strategy: {
      id: 'strategy-1',
      workspaceId: 'ws-seo',
      siteKeywords: [{ keyword: 'enterprise seo analytics', intent: 'commercial' }],
      pageMap: [
        {
          pagePath: '/services/seo',
          primaryKeyword: 'enterprise seo analytics',
          secondaryKeywords: ['seo reporting platform', 'agency seo dashboard'],
        },
        {
          pagePath: '/pricing',
          primaryKeyword: 'seo analytics pricing',
          secondaryKeywords: ['seo platform cost'],
        },
      ],
      businessContext: 'SEO analytics platform',
      status: 'active',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z',
    } as never,
    brandVoice: 'Confident, technical, and operator-focused.',
    effectiveBrandVoiceBlock: '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nConfident, technical, and operator-focused.',
    businessContext: 'We help agency teams operationalize SEO reporting and decision-making.',
    personas: [
      {
        id: 'persona-1',
        name: 'Agency Ops Lead',
        description: 'Runs reporting and delivery workflows for SEO teams.',
        painPoints: ['Too many disconnected tools'],
        goals: ['Give clients faster, clearer answers'],
        objections: ['Does this replace existing reporting?'],
      },
    ],
    knowledgeBase: 'Prefer specific metrics, revenue framing, and direct recommendations.',
  },
  learnings: {
    availability: 'ready',
    summary: null,
    confidence: 'medium',
    topActionTypes: [{ type: 'content_refreshed', winRate: 0.72, count: 11 }],
    overallWinRate: 0.64,
    recentTrend: 'improving',
    playbooks: [],
  },
};

describe('buildSeoPromptContext parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue(realisticIntelligence);
  });

  it('matches the legacy manual composition with real formatter output', async () => {
    const result = await buildSeoPromptContext('ws-seo');
    const legacy = formatForPrompt(realisticIntelligence, {
      verbosity: 'detailed',
      sections: ['seoContext', 'learnings'],
      tokenBudget: undefined,
      learningsDomain: 'all',
    }) + formatPageMapForPrompt(realisticIntelligence.seoContext);

    expect(result.promptContext).toBe(formatForPrompt(realisticIntelligence, {
      verbosity: 'detailed',
      sections: ['seoContext', 'learnings'],
      tokenBudget: undefined,
      learningsDomain: 'all',
    }));
    expect(result.pageMapContext).toBe(formatPageMapForPrompt(realisticIntelligence.seoContext));
    expect(result.seoPromptContext).toBe(legacy);
  });

  it('preserves manual parity when tokenBudget and content-domain learnings are threaded through', async () => {
    const result = await buildSeoPromptContext('ws-seo', {
      learningsDomain: 'content',
      tokenBudget: 120,
    });
    const legacy = formatForPrompt(realisticIntelligence, {
      verbosity: 'detailed',
      sections: ['seoContext', 'learnings'],
      tokenBudget: 120,
      learningsDomain: 'content',
    }) + formatPageMapForPrompt(realisticIntelligence.seoContext);

    expect(result.seoPromptContext).toBe(legacy);
  });
});
