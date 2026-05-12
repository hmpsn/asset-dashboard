import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBrief } from '../../server/content-brief.js';
import type { GeneratedPost } from '../../shared/types/content.ts';

const { callAIMock } = vi.hoisted(() => ({
  callAIMock: vi.fn(),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: callAIMock,
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => ({
    version: 1,
    workspaceId: 'ws_test',
    assembledAt: new Date().toISOString(),
    seoContext: null,
    learnings: null,
    pageProfile: null,
  })),
  formatForPrompt: vi.fn(() => 'VOICE CONTEXT'),
  formatPageMapForPrompt: vi.fn(() => ''),
}));

import { scoreVoiceMatch } from '../../server/content-posts-ai.js';

function makeBrief(): ContentBrief {
  return {
    id: 'brief_1',
    workspaceId: 'ws_test',
    targetKeyword: 'seo audit',
    secondaryKeywords: ['technical seo'],
    suggestedTitle: 'SEO Audit Checklist',
    suggestedMetaDesc: 'Meta',
    outline: [],
    wordCountTarget: 1200,
    intent: 'informational',
    audience: 'Marketing teams',
    competitorInsights: 'Insights',
    internalLinkSuggestions: [],
    createdAt: new Date().toISOString(),
  };
}

function makePost(): GeneratedPost {
  return {
    id: 'post_1',
    workspaceId: 'ws_test',
    briefId: 'brief_1',
    targetKeyword: 'seo audit',
    title: 'SEO Audit Checklist',
    metaDescription: 'Meta',
    introduction: '<p>Intro</p>',
    sections: [{
      index: 0,
      heading: 'Section',
      content: '<h2>Section</h2><p>Body copy</p>',
      wordCount: 100,
      targetWordCount: 120,
      keywords: ['seo'],
      status: 'done',
    }],
    conclusion: '<h2>Next Steps</h2><p>Outro</p>',
    totalWordCount: 150,
    targetWordCount: 1200,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('scoreVoiceMatch', () => {
  beforeEach(() => {
    callAIMock.mockReset();
  });

  it('fails closed when AI returns a non-finite voiceScore', async () => {
    callAIMock.mockResolvedValueOnce({
      text: '{"voiceScore":"NaN","voiceFeedback":"Looks okay."}',
    });

    const result = await scoreVoiceMatch(makePost(), makeBrief(), 'ws_test');
    expect(result.voiceScore).toBeNull();
    expect(result.voiceFeedback).toContain('invalid score');
  });

  it('returns a clamped rounded score for valid numeric output', async () => {
    callAIMock.mockResolvedValueOnce({
      text: '{"voiceScore": 101.6, "voiceFeedback":"Strong match."}',
    });

    const result = await scoreVoiceMatch(makePost(), makeBrief(), 'ws_test');
    expect(result.voiceScore).toBe(100);
    expect(result.voiceFeedback).toBe('Strong match.');
  });
});
