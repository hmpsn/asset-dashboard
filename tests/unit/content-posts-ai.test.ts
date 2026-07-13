import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBrief } from '../../server/content-brief.js';
import type { GeneratedPost } from '../../shared/types/content.ts';

const { callAIMock, isAnthropicConfiguredMock } = vi.hoisted(() => ({
  callAIMock: vi.fn(),
  isAnthropicConfiguredMock: vi.fn(() => false),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: callAIMock,
}));

vi.mock('../../server/anthropic-helpers.js', () => ({
  isAnthropicConfigured: isAnthropicConfiguredMock,
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

import { callCreativeAI, generateSeoMeta, scoreVoiceMatch, unifyPost } from '../../server/content-posts-ai.js';

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

beforeEach(() => {
  callAIMock.mockReset();
  isAnthropicConfiguredMock.mockReset();
  isAnthropicConfiguredMock.mockReturnValue(false);
});

describe('callCreativeAI fallback correlation', () => {
  const opts = {
    operation: 'copy-generation' as const,
    systemPrompt: 'Write clearly.',
    userPrompt: 'Draft a paragraph.',
    maxTokens: 200,
    workspaceId: 'ws_test',
  };

  it('links a successful GPT fallback to the failed Claude attempt', async () => {
    isAnthropicConfiguredMock.mockReturnValue(true);
    callAIMock
      .mockRejectedValueOnce(new Error('Claude unavailable'))
      .mockResolvedValueOnce({ text: 'GPT draft' });

    await expect(callCreativeAI(opts)).resolves.toBe('GPT draft');
    expect(callAIMock).toHaveBeenCalledTimes(2);
    const claude = callAIMock.mock.calls[0][0];
    const gpt = callAIMock.mock.calls[1][0];
    expect(claude).toMatchObject({ provider: 'anthropic', executionChainId: expect.any(String) });
    expect(claude).not.toHaveProperty('fallbackUsed');
    expect(gpt).toMatchObject({ executionChainId: claude.executionChainId, fallbackUsed: true });
  });

  it('preserves the shared chain when the fallback also fails', async () => {
    isAnthropicConfiguredMock.mockReturnValue(true);
    callAIMock
      .mockRejectedValueOnce(new Error('Claude unavailable'))
      .mockRejectedValueOnce(new Error('GPT unavailable'));

    await expect(callCreativeAI(opts)).rejects.toThrow('GPT unavailable');
    expect(callAIMock.mock.calls[1][0]).toMatchObject({
      executionChainId: callAIMock.mock.calls[0][0].executionChainId,
      fallbackUsed: true,
    });
  });

  it('does not label GPT as fallback when Anthropic is unconfigured', async () => {
    callAIMock.mockResolvedValueOnce({ text: 'Primary GPT draft' });
    await expect(callCreativeAI(opts)).resolves.toBe('Primary GPT draft');
    expect(callAIMock).toHaveBeenCalledOnce();
    expect(callAIMock).toHaveBeenCalledWith(expect.objectContaining({ executionChainId: expect.any(String) }));
    expect(callAIMock.mock.calls[0][0]).not.toHaveProperty('fallbackUsed');
  });
});

describe('generateSeoMeta', () => {
  it('parses fenced JSON through the structured-output boundary', async () => {
    callAIMock.mockResolvedValueOnce({
      text: '```json\n{"seoTitle":"SEO Audit Checklist","seoMetaDescription":"A strong meta description."}\n```',
    });

    const result = await generateSeoMeta(makePost(), makeBrief(), 'ws_test');
    expect(result).toEqual({
      seoTitle: 'SEO Audit Checklist',
      seoMetaDescription: 'A strong meta description.',
    });
    expect(callAIMock).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'content-post-seo-meta',
    }));
  });

  it('returns null when structured JSON is malformed', async () => {
    callAIMock.mockResolvedValueOnce({
      text: '{"seoTitle":42,"seoMetaDescription":"Still wrong"}',
    });

    const result = await generateSeoMeta(makePost(), makeBrief(), 'ws_test');
    expect(result).toBeNull();
  });
});

describe('unifyPost', () => {
  it('returns unified content when valid structured output is returned', async () => {
    const longPost = {
      ...makePost(),
      introduction: `<p>${'intro '.repeat(120)}</p>`,
      sections: [{
        ...makePost().sections[0],
        content: `<h2>Section</h2><p>${'body '.repeat(260)}</p>`,
        wordCount: 260,
        targetWordCount: 280,
      }],
      conclusion: `<h2>Next Steps</h2><p>${'outro '.repeat(80)}</p>`,
    };
    callAIMock.mockResolvedValueOnce({
      text: '{"introduction":"<p>Unified intro</p>","sections":["<h2>Section</h2><p>Unified body</p>"],"conclusion":"<h2>Next Steps</h2><p>Unified outro</p>"}',
    });

    const result = await unifyPost(longPost, makeBrief(), 'VOICE CONTEXT', 'ws_test');
    expect(result).toEqual({
      introduction: '<p>Unified intro</p>',
      sections: ['<h2>Section</h2><p>Unified body</p>'],
      conclusion: '<h2>Next Steps</h2><p>Unified outro</p>',
    });
    expect(callAIMock).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'content-post-unify',
    }));
  });

  it('adds density review and SEO-mechanics removal rules for location pages', async () => {
    const longPost = {
      ...makePost(),
      introduction: `<p>${'intro '.repeat(120)}</p>`,
      sections: [{
        ...makePost().sections[0],
        content: `<h2>Section</h2><p>${'body '.repeat(260)}</p>`,
        wordCount: 260,
        targetWordCount: 280,
      }],
      conclusion: `<h2>Next Steps</h2><p>${'outro '.repeat(80)}</p>`,
    };
    callAIMock.mockResolvedValueOnce({
      text: '{"introduction":"<p>Unified intro</p>","sections":["<h2>Section</h2><p>Unified body</p>"],"conclusion":"<h2>Next Steps</h2><p>Unified outro</p>"}',
    });

    await unifyPost(longPost, { ...makeBrief(), pageType: 'location' }, 'VOICE CONTEXT', 'ws_test');
    const prompt = JSON.stringify(callAIMock.mock.calls[0]?.[0] ?? {});
    expect(prompt).toContain('PAGE-TYPE DENSITY REVIEW REQUIRED');
    expect(prompt).toContain('PAGE-TYPE COPY CONTRACT (location)');
    expect(prompt).toContain('remove reader-facing SEO mechanics');
    expect(prompt).toContain('NAP consistency');
  });

  it('includes generation style guidance without removing page-type safety rules', async () => {
    const longPost = {
      ...makePost(),
      introduction: `<p>${'intro '.repeat(120)}</p>`,
      sections: [{
        ...makePost().sections[0],
        content: `<h2>Section</h2><p>${'body '.repeat(260)}</p>`,
        wordCount: 260,
        targetWordCount: 280,
      }],
      conclusion: `<h2>Next Steps</h2><p>${'outro '.repeat(80)}</p>`,
    };
    callAIMock.mockResolvedValueOnce({
      text: '{"introduction":"<p>Unified intro</p>","sections":["<h2>Section</h2><p>Unified body</p>"],"conclusion":"<h2>Next Steps</h2><p>Unified outro</p>"}',
    });

    await unifyPost(longPost, { ...makeBrief(), pageType: 'service', generationStyle: 'concise' }, 'VOICE CONTEXT', 'ws_test');
    const prompt = JSON.stringify(callAIMock.mock.calls[0]?.[0] ?? {});
    expect(prompt).toContain('CONTENT GENERATION STYLE (concise)');
    expect(prompt).toContain('GENERATION STYLE PRIORITY');
    expect(prompt).toContain('PAGE-TYPE COPY CONTRACT (service)');
    expect(prompt).toContain('factual safety');
  });

  it('returns null when structured output has the wrong shape', async () => {
    const longPost = {
      ...makePost(),
      introduction: `<p>${'intro '.repeat(120)}</p>`,
      sections: [{
        ...makePost().sections[0],
        content: `<h2>Section</h2><p>${'body '.repeat(260)}</p>`,
        wordCount: 260,
        targetWordCount: 280,
      }],
      conclusion: `<h2>Next Steps</h2><p>${'outro '.repeat(80)}</p>`,
    };
    callAIMock.mockResolvedValueOnce({
      text: '{"introduction":"<p>Intro</p>","sections":"not-an-array","conclusion":"<h2>Outro</h2>"}',
    });

    const result = await unifyPost(longPost, makeBrief(), 'VOICE CONTEXT', 'ws_test');
    expect(result).toBeNull();
  });
});

describe('scoreVoiceMatch', () => {
  it('fails closed when AI returns a non-finite voiceScore', async () => {
    callAIMock.mockResolvedValueOnce({
      text: '{"voiceScore":"NaN","voiceFeedback":"Looks okay."}',
    });

    const result = await scoreVoiceMatch(makePost(), makeBrief(), 'ws_test');
    expect(result.voiceScore).toBeNull();
    expect(result.voiceFeedback).toContain('could not parse AI response');
  });

  it('returns a clamped rounded score for valid numeric output', async () => {
    callAIMock.mockResolvedValueOnce({
      text: '{"voiceScore": 101.6, "voiceFeedback":"Strong match."}',
    });

    const result = await scoreVoiceMatch(makePost(), makeBrief(), 'ws_test');
    expect(result.voiceScore).toBe(100);
    expect(result.voiceFeedback).toBe('Strong match.');
    expect(callAIMock).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'voice-scoring',
    }));
  });

  it('preserves a valid score when voiceFeedback is blank', async () => {
    callAIMock.mockResolvedValueOnce({
      text: '{"voiceScore": 87, "voiceFeedback":""}',
    });

    const result = await scoreVoiceMatch(makePost(), makeBrief(), 'ws_test');
    expect(result.voiceScore).toBe(87);
    expect(result.voiceFeedback).toBe('No feedback provided.');
  });
});
