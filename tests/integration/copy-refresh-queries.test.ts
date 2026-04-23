import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13323);
let capturedPrompt = '';

vi.doMock('../../server/openai-helpers.js', async (orig) => {
  const actual = await orig<typeof import('../../server/openai-helpers.js')>();
  return {
    ...actual,
    callOpenAI: async (args: { messages: { role: string; content: string }[] }) => {
      capturedPrompt = args.messages[0].content;
      return { text: JSON.stringify({ suggestions: [] }) };
    },
  };
});

vi.doMock('../../server/copy-review.js', async (orig) => {
  const actual = await orig<typeof import('../../server/copy-review.js')>();
  return {
    ...actual,
    getSectionsForEntry: () => [
      { id: 'sec_1', sectionPlanItemId: 'sp_x_hero', generatedCopy: 'Old hero copy...' },
    ],
  };
});

describe('suggestCopyRefresh — topQueries in prompt', () => {
  let cleanup: () => void;
  beforeAll(async () => { await ctx.startServer(); const s = seedWorkspace({}); cleanup = s.cleanup; });
  afterAll(async () => { cleanup(); await ctx.stopServer(); vi.resetModules(); });

  it('includes topQueries in the AI prompt when provided', async () => {
    const { suggestCopyRefresh } = await import('../../server/copy-refresh.js');
    const s = seedWorkspace({});
    await suggestCopyRefresh(s.workspaceId, 'entry_x', {
      url: '/plumbing',
      decayType: 'click_decline',
      severity: 'critical',
      metrics: { clickDeclinePct: -60 },
      topQueries: [
        { query: 'best plumber near me', clicks: 10, impressions: 400, position: 15.2 },
        { query: 'plumber denver',        clicks: 3,  impressions: 120, position: 18.0 },
      ],
    });
    expect(capturedPrompt).toContain('Top search queries for this page');
    expect(capturedPrompt).toContain('best plumber near me');
    expect(capturedPrompt).toContain('pos 15.2');
    s.cleanup();
  });
});
