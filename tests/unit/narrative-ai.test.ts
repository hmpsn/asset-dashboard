import { readFileSync } from 'fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const { callAIMock } = vi.hoisted(() => ({
  callAIMock: vi.fn(),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: callAIMock,
}));

import { callNarrativeAI, withContentHashCache } from '../../server/narrative-ai.js';

const logger = {
  debug: vi.fn(),
  error: vi.fn(),
};

const schema = z.object({
  title: z.string(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('narrative-ai', () => {
  it('calls the named AI operation and parses valid structured output', async () => {
    callAIMock.mockResolvedValueOnce({ text: '{"title":"Clear next move"}' });

    await expect(callNarrativeAI({
      workspaceId: 'ws_1',
      operation: 'strategy-pov',
      systemPrompt: 'system',
      prompt: 'prompt',
      schema,
      parserContext: 'strategy-pov',
      maxTokens: 1500,
      logger,
      retryDebugMessage: 'retrying',
      retryFailureLogMessage: 'failed after retry',
      retryFailureMessage: 'failed after retry',
    })).resolves.toEqual({ title: 'Clear next move' });

    expect(callAIMock).toHaveBeenCalledTimes(1);
    expect(callAIMock).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'strategy-pov',
      system: 'system',
      messages: [{ role: 'user', content: 'prompt' }],
      maxTokens: 1500,
      temperature: 0.3,
      workspaceId: 'ws_1',
    }));
  });

  it('retries once with the invalid response as assistant context', async () => {
    callAIMock
      .mockResolvedValueOnce({ text: '{"title":42}' })
      .mockResolvedValueOnce({ text: '{"title":"Fixed JSON"}' });

    await expect(callNarrativeAI({
      workspaceId: 'ws_1',
      operation: 'meeting-brief',
      systemPrompt: 'system',
      prompt: 'prompt',
      schema,
      parserContext: 'meeting-brief',
      maxTokens: 2000,
      normalize: parsed => ({ ...parsed, title: parsed.title.toUpperCase() }),
      logger,
      retryDebugMessage: 'retrying',
      retryFailureLogMessage: 'failed after retry',
      retryFailureMessage: 'failed after retry',
    })).resolves.toEqual({ title: 'FIXED JSON' });

    expect(callAIMock).toHaveBeenCalledTimes(2);
    expect(callAIMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operation: 'meeting-brief',
      messages: [
        { role: 'user', content: 'prompt' },
        { role: 'assistant', content: '{"title":42}' },
        { role: 'user', content: 'Your response was not valid JSON. Return only the JSON object, no explanation.' },
      ],
      temperature: 0.1,
    }));
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ issues: expect.any(Array) }),
      'retrying',
    );
  });

  it('throws the caller-owned final error message when retry parsing fails', async () => {
    callAIMock
      .mockResolvedValueOnce({ text: '{"title":42}' })
      .mockResolvedValueOnce({ text: '{"title":false}' });

    await expect(callNarrativeAI({
      workspaceId: 'ws_1',
      operation: 'strategy-pov',
      systemPrompt: 'system',
      prompt: 'prompt',
      schema,
      parserContext: 'strategy-pov',
      maxTokens: 1500,
      logger,
      retryDebugMessage: 'retrying',
      retryFailureLogMessage: 'failed after retry',
      retryFailureMessage: 'caller stable failure',
    })).rejects.toThrow('caller stable failure');

    expect(callAIMock).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_1',
        rawRetry: '{"title":false}',
      }),
      'failed after retry',
    );
  });

  it('short-circuits with the unchanged signal when the content hash matches', () => {
    const run = vi.fn();

    expect(() => withContentHashCache({
      workspaceId: 'ws_1',
      hash: 'same',
      cachedHash: 'same',
      unchangedSignal: 'UNCHANGED',
      unchangedLogMessage: 'unchanged',
      logger,
      run,
    })).toThrow('UNCHANGED');

    expect(run).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith({ workspaceId: 'ws_1' }, 'unchanged');
  });

  it('runs when cache use is disabled even if the content hash matches', () => {
    const run = vi.fn(() => 'generated');

    expect(withContentHashCache({
      workspaceId: 'ws_1',
      hash: 'same',
      cachedHash: 'same',
      unchangedSignal: 'UNCHANGED',
      unchangedLogMessage: 'unchanged',
      logger,
      canUseCache: false,
      run,
    })).toBe('generated');
  });

  it('keeps narrative AI retry/cache mechanics out of feature generators', () => {
    const meetingBrief = readFileSync('server/meeting-brief-generator.ts', 'utf-8'); // readFile-ok — source contract for narrative AI extraction.
    const strategyPov = readFileSync('server/strategy-pov-generator.ts', 'utf-8'); // readFile-ok — source contract for narrative AI extraction.

    expect(meetingBrief).not.toMatch(/\bcallAI\(/);
    expect(meetingBrief).not.toContain('parseStructuredAIOutput');
    expect(strategyPov).not.toMatch(/\bcallAI\(/);
    expect(strategyPov).not.toContain('parseStructuredAIOutput');
    expect(meetingBrief).toContain('callNarrativeAI');
    expect(strategyPov).toContain('callNarrativeAI');
  });
});
