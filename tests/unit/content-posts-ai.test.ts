import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBrief } from '../../server/content-brief.js';
import type { GeneratedPost } from '../../shared/types/content.ts';

const {
  callAIMock,
  isAnthropicConfiguredMock,
  isFeatureEnabledMock,
  buildContentGenerationContextV2Mock,
} = vi.hoisted(() => ({
  callAIMock: vi.fn(),
  isAnthropicConfiguredMock: vi.fn(() => false),
  isFeatureEnabledMock: vi.fn(() => false),
  buildContentGenerationContextV2Mock: vi.fn(),
}));

vi.mock('../../server/ai.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../server/ai.js')>()),
  callAI: callAIMock,
}));

vi.mock('../../server/anthropic-helpers.js', () => ({
  isAnthropicConfigured: isAnthropicConfiguredMock,
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}));

vi.mock('../../server/intelligence/generation-context-builders.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../server/intelligence/generation-context-builders.js')>()),
  buildContentGenerationContextV2: buildContentGenerationContextV2Mock,
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

import {
  callCreativeAI,
  callCreativeAIWithMetadata,
  generateIntroduction,
  generateSeoMeta,
  generateSection,
  scoreVoiceMatch,
  unifyPost,
  renderCreativeProviderCallInput,
} from '../../server/content-posts-ai.js';
import { renderAIProviderInput } from '../../server/ai.js';
import { fingerprintRenderedAIInput } from '../../server/generation-provenance.js';

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

function aiUserPrompt(callIndex = 0): string {
  const call = callAIMock.mock.calls[callIndex]?.[0] as {
    messages?: Array<{ content?: string }>;
  } | undefined;
  return call?.messages?.[0]?.content ?? '';
}

beforeEach(() => {
  callAIMock.mockReset();
  isAnthropicConfiguredMock.mockReset();
  isAnthropicConfiguredMock.mockReturnValue(false);
  isFeatureEnabledMock.mockReset();
  isFeatureEnabledMock.mockReturnValue(false);
  buildContentGenerationContextV2Mock.mockReset();
});

describe('initial prose keyword policy', () => {
  const section = {
    heading: 'Technical SEO priorities',
    notes: 'Explain the priorities.',
    wordCount: 300,
    keywords: ['technical seo'],
  };

  it('preserves legacy intro and section prompts when output quality v2 is off', async () => {
    callAIMock.mockResolvedValue({ text: '<p>Draft</p>' });
    const brief = makeBrief();

    await generateIntroduction(brief, 'VOICE CONTEXT', 'ws_test');
    await generateIntroduction(brief, 'VOICE CONTEXT', 'ws_test', undefined, { outputQualityV2: false });
    await generateSection(brief, section, 0, [], 'VOICE CONTEXT', 'ws_test');
    await generateSection(brief, section, 0, [], 'VOICE CONTEXT', 'ws_test', undefined, { outputQualityV2: false });

    expect(aiUserPrompt(0)).toBe(aiUserPrompt(1));
    expect(aiUserPrompt(0)).toContain('SECONDARY KEYWORDS: technical seo');
    expect(aiUserPrompt(2)).toBe(aiUserPrompt(3));
    expect(aiUserPrompt(2)).toContain('Keywords to include naturally: technical seo');
  });

  it('treats secondary phrases as optional topical concepts in initial v2 prose', async () => {
    callAIMock.mockResolvedValue({ text: '<p>Draft</p>' });
    const brief = makeBrief();

    await generateIntroduction(brief, 'VOICE CONTEXT', 'ws_test', undefined, { outputQualityV2: true });
    await generateSection(brief, section, 0, [], 'VOICE CONTEXT', 'ws_test', undefined, { outputQualityV2: true });

    expect(aiUserPrompt(0)).toContain('SECONDARY KEYWORD TOPICS');
    expect(aiUserPrompt(0)).toContain('never force exact phrases');
    expect(aiUserPrompt(1)).toContain('exact strings are optional');
    expect(aiUserPrompt(1)).not.toContain('Keywords to include naturally');
  });
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
    expect(gpt).toMatchObject({
      provider: 'openai',
      executionChainId: claude.executionChainId,
      fallbackUsed: true,
    });
  });

  it('preserves the shared chain when the fallback also fails', async () => {
    isAnthropicConfiguredMock.mockReturnValue(true);
    callAIMock
      .mockRejectedValueOnce(new Error('Claude unavailable'))
      .mockRejectedValueOnce(new Error('GPT unavailable'));

    await expect(callCreativeAI(opts)).rejects.toThrow('GPT unavailable');
    expect(callAIMock.mock.calls[1][0]).toMatchObject({
      provider: 'openai',
      executionChainId: callAIMock.mock.calls[0][0].executionChainId,
      fallbackUsed: true,
    });
  });

  it('does not label GPT as fallback when Anthropic is unconfigured', async () => {
    callAIMock.mockResolvedValueOnce({ text: 'Primary GPT draft' });
    await expect(callCreativeAI(opts)).resolves.toBe('Primary GPT draft');
    expect(callAIMock).toHaveBeenCalledOnce();
    expect(callAIMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      executionChainId: expect.any(String),
    }));
    expect(callAIMock.mock.calls[0][0]).not.toHaveProperty('fallbackUsed');
  });

  it('lets budgeted callers reserve every dispatcher invocation with retries disabled', async () => {
    isAnthropicConfiguredMock.mockReturnValue(true);
    const execution = {
      runId: 'ai-run-fallback',
      executionChainId: 'chain-fallback',
      operation: 'copy-generation',
      provider: 'openai' as const,
      model: 'gpt-5.6-luna',
      attempts: 1,
      fallbackUsed: true,
      cacheOutcome: 'bypass' as const,
      startedAt: '2026-07-13T12:00:00.000Z',
      completedAt: '2026-07-13T12:00:01.000Z',
      durationMs: 1000,
    };
    callAIMock
      .mockRejectedValueOnce(new Error('Claude unavailable'))
      .mockResolvedValueOnce({
        text: 'GPT draft',
        tokens: { prompt: 20, completion: 5, total: 25 },
        execution,
      });
    const beforeProviderDispatch = vi.fn();

    await expect(callCreativeAIWithMetadata({
      ...opts,
      maxRetries: 0,
      beforeProviderDispatch,
    })).resolves.toEqual({
      text: 'GPT draft',
      tokens: { prompt: 20, completion: 5, total: 25 },
      execution,
    });
    expect(beforeProviderDispatch.mock.calls).toEqual([
      [{ provider: 'anthropic', fallback: false }],
      [{ provider: 'openai', fallback: true }],
    ]);
    expect(callAIMock.mock.calls[0][0]).toMatchObject({ maxRetries: 0 });
    expect(callAIMock.mock.calls[1][0]).toMatchObject({ maxRetries: 0 });
  });

  it('never dispatches a provider when its reservation is rejected', async () => {
    isAnthropicConfiguredMock.mockReturnValue(true);
    const budgetError = new Error('brand generation budget exhausted');

    await expect(callCreativeAIWithMetadata({
      ...opts,
      maxRetries: 0,
      beforeProviderDispatch: () => { throw budgetError; },
    })).rejects.toThrow(budgetError);
    expect(callAIMock).not.toHaveBeenCalled();
  });

  it('does not dispatch fallback when the bounded reservation is exhausted', async () => {
    isAnthropicConfiguredMock.mockReturnValue(true);
    callAIMock.mockRejectedValueOnce(new Error('Claude unavailable'));
    const budgetError = new Error('matrix generation budget exhausted');
    const beforeBoundedProviderDispatch = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => { throw budgetError; });

    await expect(callCreativeAIWithMetadata({
      ...opts,
      maxRetries: 0,
      beforeBoundedProviderDispatch,
    })).rejects.toThrow(budgetError);

    expect(beforeBoundedProviderDispatch).toHaveBeenCalledTimes(2);
    expect(beforeBoundedProviderDispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
    }));
    expect(beforeBoundedProviderDispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      provider: 'openai',
      model: 'gpt-5.6-terra',
    }));
    expect(callAIMock).toHaveBeenCalledOnce();
    expect(callAIMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      maxRetries: 0,
    }));
  });

  it('does not buy a fallback when metadata observation rejects a successful Claude call', async () => {
    isAnthropicConfiguredMock.mockReturnValue(true);
    callAIMock.mockResolvedValueOnce({
      text: 'Claude draft',
      tokens: { prompt: 20, completion: 5, total: 25 },
      execution: {
        runId: 'run_claude',
        executionChainId: 'chain_claude',
        operation: 'copy-generation',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        attempts: 1,
        cacheOutcome: 'miss',
        startedAt: '2026-07-13T12:00:00.000Z',
        completedAt: '2026-07-13T12:00:01.000Z',
        durationMs: 1_000,
      },
    });

    await expect(callCreativeAIWithMetadata({
      ...opts,
      onExecution: () => { throw new Error('provenance observer failed'); },
    })).rejects.toThrow('provenance observer failed');
    expect(callAIMock).toHaveBeenCalledOnce();
  });

  it('fingerprints registry-default research instructions exactly as dispatched', async () => {
    const execution = {
      runId: 'run_research',
      executionChainId: 'chain_research',
      operation: 'content-post-introduction',
      provider: 'openai' as const,
      model: 'gpt-5.6-terra',
      attempts: 1,
      cacheOutcome: 'miss' as const,
      startedAt: '2026-07-13T12:00:00.000Z',
      completedAt: '2026-07-13T12:00:01.000Z',
      durationMs: 1_000,
    };
    callAIMock.mockResolvedValueOnce({
      text: 'Primary GPT draft',
      tokens: { prompt: 20, completion: 5, total: 25 },
      execution,
    });
    const onExecution = vi.fn();

    await callCreativeAIWithMetadata({
      ...opts,
      operation: 'content-post-introduction',
      onExecution,
    });
    const providerInput = renderCreativeProviderCallInput(opts, 'openai');
    const expectedFingerprint = fingerprintRenderedAIInput(renderAIProviderInput({
      provider: 'openai',
      ...providerInput,
      researchMode: true,
    }));
    expect(onExecution).toHaveBeenCalledWith({ execution, inputFingerprint: expectedFingerprint });
    expect(callAIMock).toHaveBeenCalledWith(expect.objectContaining({ researchMode: true }));
  });
});

describe('generateSeoMeta', () => {
  it('uses captured prompt authority exactly once when supplied by context v2', async () => {
    callAIMock.mockResolvedValueOnce({
      text: '{"seoTitle":"SEO Audit Checklist","seoMetaDescription":"A strong meta description."}',
    });

    await generateSeoMeta(makePost(), makeBrief(), 'ws_test', {
      promptAuthority: {
        systemVoiceBlock: '[Captured system voice]',
        customNotes: 'Captured notes',
      },
    });

    const system = callAIMock.mock.calls[0][0].system as string;
    expect(system.match(/\[Captured system voice\]/g)).toHaveLength(1);
    expect(system).toContain('Captured notes');
  });

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
  it('returns a typed short-input skip without spending a provider call', async () => {
    const result = await unifyPost(makePost(), makeBrief(), 'VOICE CONTEXT', 'ws_test');

    expect(result).toEqual({ status: 'skipped', reason: 'short_input' });
    expect(callAIMock).not.toHaveBeenCalled();
  });

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
      status: 'candidate',
      candidate: {
        introduction: '<p>Unified intro</p>',
        sections: ['<h2>Section</h2><p>Unified body</p>'],
        conclusion: '<h2>Next Steps</h2><p>Unified outro</p>',
      },
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
    const prompt = aiUserPrompt();
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
    const prompt = aiUserPrompt();
    expect(prompt).toContain('CONTENT GENERATION STYLE (concise)');
    expect(prompt).toContain('GENERATION STYLE PRIORITY');
    expect(prompt).toContain('PAGE-TYPE COPY CONTRACT (service)');
    expect(prompt).toContain('factual safety');
  });

  it('preserves the legacy exact keyword prompt when output quality v2 is off', async () => {
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
    callAIMock.mockResolvedValue({
      text: '{"introduction":"<p>Unified intro</p>","sections":["<h2>Section</h2><p>Unified body</p>"],"conclusion":"<h2>Next Steps</h2><p>Unified outro</p>"}',
    });

    await unifyPost(longPost, makeBrief(), 'VOICE CONTEXT', 'ws_test');
    await unifyPost(longPost, makeBrief(), 'VOICE CONTEXT', 'ws_test', {
      outputQualityV2: false,
    });

    const prompt = aiUserPrompt();
    expect(prompt).toContain('The following keywords from the brief MUST each appear at least once');
    expect(prompt).toContain('"seo audit", "technical seo"');
    expect(prompt).not.toContain('SECONDARY KEYWORD TOPICS');
    expect(aiUserPrompt(1)).toBe(prompt);
  });

  it('treats secondary keywords as topical targets under output quality v2', async () => {
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

    await unifyPost(longPost, makeBrief(), 'VOICE CONTEXT', 'ws_test', {
      outputQualityV2: true,
    });

    const prompt = aiUserPrompt();
    expect(prompt).toContain('PRIMARY KEYWORD COVERAGE');
    expect(prompt).toContain('"seo audit"');
    expect(prompt).toContain('SECONDARY KEYWORD TOPICS');
    expect(prompt).toContain('"technical seo"');
    expect(prompt).toContain('synonyms');
    expect(prompt).toContain('do not force exact-string matches');
    expect(prompt).not.toContain('keywords from the brief MUST each appear at least once');
  });

  it('adds grounded symmetric word-count correction only outside the v2 target band', async () => {
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
    const validResult = {
      text: '{"introduction":"<p>Unified intro</p>","sections":["<h2>Section</h2><p>Unified body</p>"],"conclusion":"<h2>Next Steps</h2><p>Unified outro</p>"}',
    };
    callAIMock.mockResolvedValue(validResult);

    await unifyPost(longPost, makeBrief(), 'VOICE CONTEXT', 'ws_test', {
      outputQualityV2: true,
    });
    const underPrompt = aiUserPrompt(0);
    expect(underPrompt).toContain('WORD COUNT EXPANSION REQUIRED');
    expect(underPrompt).toContain('Do not invent facts, examples, proof, offers, or claims');
    expect(underPrompt).not.toContain('WORD COUNT TRIM REQUIRED');

    await unifyPost(longPost, { ...makeBrief(), wordCountTarget: 200 }, 'VOICE CONTEXT', 'ws_test', {
      outputQualityV2: true,
    });
    const overPrompt = aiUserPrompt(1);
    expect(overPrompt).toContain('WORD COUNT TRIM REQUIRED');
    expect(overPrompt).not.toContain('WORD COUNT EXPANSION REQUIRED');

    await unifyPost(longPost, { ...makeBrief(), wordCountTarget: 280 }, 'VOICE CONTEXT', 'ws_test', {
      outputQualityV2: true,
    });
    const inBandPrompt = aiUserPrompt(2);
    expect(inBandPrompt).not.toContain('WORD COUNT EXPANSION REQUIRED');
    expect(inBandPrompt).not.toContain('WORD COUNT TRIM REQUIRED');
    expect(inBandPrompt).not.toContain('WORD COUNT CORRECTION REQUIRED');
  });

  it('uses template-section body words for v2 correction despite a large introduction and conclusion', async () => {
    const longFramingPost = {
      ...makePost(),
      introduction: `<p>${'intro '.repeat(500)}</p>`,
      sections: [{
        ...makePost().sections[0],
        content: `<h2>Section</h2><p>${'body '.repeat(260)}</p>`,
        wordCount: 260,
        targetWordCount: 1_200,
      }],
      conclusion: `<h2>Next Steps</h2><p>${'outro '.repeat(500)}</p>`,
    };
    callAIMock.mockResolvedValueOnce({
      text: '{"introduction":"<p>Unified intro</p>","sections":["<h2>Section</h2><p>Unified body</p>"],"conclusion":"<h2>Next Steps</h2><p>Unified outro</p>"}',
    });

    await unifyPost(longFramingPost, makeBrief(), 'VOICE CONTEXT', 'ws_test', {
      outputQualityV2: true,
    });

    const prompt = aiUserPrompt();
    expect(prompt).toContain('WORD COUNT EXPANSION REQUIRED');
    expect(prompt).toContain('Current template-section body: ~261 words');
    expect(prompt).toContain('body-only target');
    expect(prompt).not.toContain('WORD COUNT TRIM REQUIRED');
  });

  it('returns a typed invalid outcome when structured output has the wrong shape', async () => {
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
    expect(result).toEqual({ status: 'invalid', reason: 'schema_validation_failed' });
  });

  it('returns a typed invalid outcome when the section census is wrong', async () => {
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
      text: '{"introduction":"<p>New intro</p>","sections":["<p>One</p>","<p>Extra</p>"],"conclusion":"<p>New conclusion</p>"}',
    });

    const result = await unifyPost(longPost, makeBrief(), 'VOICE CONTEXT', 'ws_test');

    expect(result).toEqual({ status: 'invalid', reason: 'section_census_mismatch' });
  });

  it('lets provider and bounded-dispatch failures escape the typed output boundary', async () => {
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
    callAIMock.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(unifyPost(longPost, makeBrief(), 'VOICE CONTEXT', 'ws_test'))
      .rejects.toThrow('provider unavailable');
    await expect(unifyPost(longPost, makeBrief(), 'VOICE CONTEXT', 'ws_test', {
      beforeBoundedProviderDispatch: () => {
        throw new Error('authority changed');
      },
    })).rejects.toThrow('authority changed');
  });
});

describe('scoreVoiceMatch', () => {
  it('uses one v2 voice-review projection with captured system authority', async () => {
    isFeatureEnabledMock.mockReturnValue(true);
    buildContentGenerationContextV2Mock.mockResolvedValue({
      authority: {
        systemVoiceBlock: '[Captured score voice]',
        userVoiceBlock: '[Voice examples]',
        identityPromptBlock: '',
        customNotes: null,
        voice: { status: 'calibrated', readiness: 'finalized', profileRevision: 3, voiceVersion: 2 },
      },
      projections: {
        brief: '[Brief context]',
        draft: '[Draft context]',
        voiceReview: '[V2 voice review context]',
      },
    });
    callAIMock.mockResolvedValueOnce({
      text: '{"voiceScore": 92, "voiceFeedback":"Strong match."}',
    });

    await scoreVoiceMatch(makePost(), makeBrief(), 'ws_test');

    expect(buildContentGenerationContextV2Mock).toHaveBeenCalledTimes(1);
    const call = callAIMock.mock.calls[0][0];
    expect((call.system as string).match(/\[Captured score voice\]/g)).toHaveLength(1);
    expect(call.messages[0].content).toContain('[V2 voice review context]');
    expect(call.messages[0].content).not.toContain('[Captured score voice]');
  });

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
