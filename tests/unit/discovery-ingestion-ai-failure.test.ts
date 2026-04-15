/**
 * Unit test: discovery-ingestion AI failure retry semantics.
 *
 * When callOpenAI throws (transient outage, rate limit, etc.), processSource()
 * must return early WITHOUT calling markProcessed. The source must remain
 * unprocessed so the next invocation retries it.
 *
 * Previously the catch block set `result = { text: '{}' }` which flowed
 * through to persist() and marked the source processed with zero extractions,
 * permanently skipping it unless `opts.force` was set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock heavy dependencies before importing the module ──────────────────────
vi.mock('../../server/openai-helpers.js', () => ({
  callOpenAI: vi.fn(),
}));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn().mockResolvedValue({}),
  formatForPrompt: vi.fn().mockReturnValue(''),
  buildIntelPrompt: vi.fn().mockResolvedValue(''),
}));

import { callOpenAI } from '../../server/openai-helpers.js';
import {
  addSource,
  processSource,
  listExtractionsBySource,
} from '../../server/discovery-ingestion.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const mockCallOpenAI = vi.mocked(callOpenAI);

describe('processSource — AI failure retry semantics', () => {
  let wsId: string;
  let sourceId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    const ws = createWorkspace('Discovery Ingestion Test');
    wsId = ws.id;
    const src = addSource(wsId, 'test.txt', 'brand_doc', 'Sample brand content');
    sourceId = src.id;
  });

  afterEach(() => {
    deleteWorkspace(wsId);
  });

  it('returns empty array and leaves source unprocessed when AI throws', async () => {
    mockCallOpenAI.mockRejectedValueOnce(new Error('OpenAI rate limit exceeded'));

    const result = await processSource(wsId, sourceId);

    // Should return empty — no extractions from failed AI call
    expect(result).toEqual([]);

    // Source must remain unprocessed so it retries on the next invocation
    // (verified by attempting to process again without force — if it were
    // marked processed, this would throw SourceAlreadyProcessedError)
    mockCallOpenAI.mockResolvedValueOnce({ text: JSON.stringify({ extractions: [] }) });
    await expect(processSource(wsId, sourceId)).resolves.toEqual([]);
  });

  it('marks source as processed when AI succeeds with empty extractions', async () => {
    mockCallOpenAI.mockResolvedValueOnce({ text: JSON.stringify({ extractions: [] }) });

    await processSource(wsId, sourceId);

    // Second call without force should throw SourceAlreadyProcessedError
    // because the source IS now marked processed (AI succeeded)
    mockCallOpenAI.mockResolvedValueOnce({ text: JSON.stringify({ extractions: [] }) });
    await expect(processSource(wsId, sourceId)).rejects.toThrow(/already been processed/i);
  });

  it('does not persist extractions when AI throws', async () => {
    mockCallOpenAI.mockRejectedValueOnce(new Error('Timeout'));

    await processSource(wsId, sourceId);

    const extractions = listExtractionsBySource(wsId, sourceId);
    expect(extractions).toHaveLength(0);
  });
});
