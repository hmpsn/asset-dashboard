import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

let capturedPrompt = '';

vi.mock('../../server/openai-helpers.js', async (orig) => {
  const actual = await orig<typeof import('../../server/openai-helpers.js')>();
  return {
    ...actual,
    callOpenAI: async (args: { messages: { role: string; content: string }[] }) => {
      capturedPrompt = args.messages[0].content;
      return { text: 'Refresh plan.' };
    },
  };
});

vi.mock('../../server/search-console.js', async (orig) => {
  const actual = await orig<typeof import('../../server/search-console.js')>();
  return {
    ...actual,
    getQueryPageData: async () => [
      { query: 'best plumber near me', page: 'https://example.com/plumbing', clicks: 12, impressions: 800, position: 12.4, ctr: 1.5 },
      { query: 'plumber denver',        page: 'https://example.com/plumbing', clicks: 5,  impressions: 200, position: 14.1, ctr: 2.5 },
      { query: 'unrelated page term',   page: 'https://example.com/other',    clicks: 2,  impressions: 50,  position: 22.0, ctr: 4.0 },
    ],
  };
});

describe('generateRefreshRecommendation — GSC query breakdown', () => {
  let ws: import('../../server/workspaces.js').Workspace;
  let cleanup: () => void;

  beforeAll(async () => {
    const seed = seedWorkspace({
      gscPropertyUrl: 'https://example.com/',
    });
    ws = (await import('../../server/workspaces.js')).getWorkspace(seed.workspaceId)!;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
    vi.resetModules();
  });

  it('injects top-impression queries for the specific page into the prompt', async () => {
    const { generateRefreshRecommendation } = await import('../../server/content-decay.js');
    await generateRefreshRecommendation(ws, {
      page: '/plumbing',
      currentClicks: 50, previousClicks: 200, clickDeclinePct: -75,
      currentImpressions: 2000, previousImpressions: 4000, impressionChangePct: -50,
      currentPosition: 12.4, previousPosition: 4.2, positionChange: 8.2,
      severity: 'critical',
    });
    expect(capturedPrompt).toContain('TOP SEARCH QUERIES FOR THIS PAGE');
    expect(capturedPrompt).toContain('best plumber near me');
    expect(capturedPrompt).toContain('plumber denver');
    expect(capturedPrompt).not.toContain('unrelated page term');
  });
});
