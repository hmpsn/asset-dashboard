/**
 * Integration test: generateBrief injects decay query context block
 * when decayQueryContext is provided.
 *
 * Port: n/a (direct function call, no HTTP server needed)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import {
  setupOpenAIMocks,
  mockOpenAIJsonResponse,
  getCapturedOpenAICalls,
  resetOpenAIMocks,
} from '../mocks/openai.js';

setupOpenAIMocks();

// Mock workspace-intelligence to avoid needing a fully-populated workspace
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => ({
    version: 1,
    workspaceId: '',
    assembledAt: new Date().toISOString(),
    seoContext: {
      strategy: { siteKeywords: [], businessContext: '', pageMap: [] },
      brandVoice: '',
      effectiveBrandVoiceBlock: '',
      knowledgeBase: '',
      businessContext: '',
      personas: null,
      pageKeywords: null,
    },
    pageProfile: null,
  })),
  formatKeywordsForPrompt: vi.fn(() => ''),
  formatPersonasForPrompt: vi.fn(() => ''),
  formatPageMapForPrompt: vi.fn(() => ''),
  formatKnowledgeBaseForPrompt: vi.fn(() => ''),
}));

vi.mock('../../server/web-scraper.js', () => ({
  buildReferenceContext: vi.fn(() => ''),
  buildSerpContext: vi.fn(() => ''),
  buildStyleExampleContext: vi.fn(() => ''),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import db from '../../server/db/index.js';
import { generateBrief } from '../../server/content-brief.js';

const TEST_WS_ID = `ws_brief_decay_${Date.now()}`;
const now = new Date().toISOString();

function makeMockBriefResponse() {
  return {
    executiveSummary: 'x',
    suggestedTitle: 't',
    suggestedMetaDesc: 'm',
    secondaryKeywords: [],
    contentFormat: 'guide',
    toneAndStyle: 'tone',
    outline: [{ heading: 'H', notes: 'n', wordCount: 100 }],
    wordCountTarget: 1000,
  };
}

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, tier, created_at) VALUES (?, ?, ?, 'growth', ?)`,
  ).run(TEST_WS_ID, 'Decay Context Test WS', 'decay-context-test', now);
  process.env.OPENAI_API_KEY = 'test-key-for-decay-context';
});

afterAll(() => {
  db.prepare(`DELETE FROM content_briefs WHERE workspace_id = ?`).run(TEST_WS_ID);
  db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(TEST_WS_ID);
});

beforeEach(() => {
  resetOpenAIMocks();
  mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());
});

describe('generateBrief — decay query context', () => {
  it('injects DECAY CONTEXT block when decayQueryContext is provided', async () => {
    await generateBrief(TEST_WS_ID, 'best plumber', {
      decayQueryContext:
        'DECAY CONTEXT: This page has lost 50% of search clicks. Top queries:\n- "best plumber denver": 10 clicks, 400 impressions, pos 15.0',
    });

    const calls = getCapturedOpenAICalls();
    expect(calls.length).toBeGreaterThan(0);
    const allUserContent = calls.flatMap(c =>
      c.messages.filter((m: { role: string; content?: string }) => m.role === 'user').map((m: { content?: string }) => m.content ?? ''),
    );
    expect(allUserContent.some(c => c.includes('DECAY CONTEXT: This page has lost 50%'))).toBe(true);
    expect(allUserContent.some(c => c.includes('best plumber denver'))).toBe(true);
  });

  it('does NOT inject DECAY CONTEXT block when decayQueryContext is absent', async () => {
    await generateBrief(TEST_WS_ID, 'best plumber', {});

    const calls = getCapturedOpenAICalls();
    expect(calls.length).toBeGreaterThan(0);
    const allUserContent = calls.flatMap(c =>
      c.messages.filter((m: { role: string; content?: string }) => m.role === 'user').map((m: { content?: string }) => m.content ?? ''),
    );
    expect(allUserContent.every(c => !c.includes('DECAY CONTEXT'))).toBe(true); // every-ok: empty means no user messages, which is also passing (no decay context injected)
  });

  it('handles decayQueryContext containing already-sanitized query strings without crashing', async () => {
    // Upstream callers (server/routes/content-requests.ts) sanitize queries via
    // sanitizeQueryForPrompt before assembling decayQueryContext. This test
    // verifies generateBrief passes such pre-sanitized content through opaquely
    // (control chars stripped, newlines collapsed, length capped at 150).
    const sanitizedBlock =
      'DECAY CONTEXT: This page has lost 40% of search clicks. Top queries:\n' +
      '- "query with tabs stripped and safe brackets": 20 clicks, 500 impressions, pos 12.3\n' +
      '- "another clean query": 5 clicks, 80 impressions, pos 18.0';

    await expect(
      generateBrief(TEST_WS_ID, 'best plumber', { decayQueryContext: sanitizedBlock }),
    ).resolves.toBeDefined();

    const calls = getCapturedOpenAICalls();
    const allUserContent = calls.flatMap(c =>
      c.messages.filter((m: { role: string; content?: string }) => m.role === 'user').map((m: { content?: string }) => m.content ?? ''),
    );
    expect(allUserContent.some(c => c.includes('another clean query'))).toBe(true);
    // Injection markers that sanitization would remove must never reach the prompt.
    expect(allUserContent.every(c => !c.includes('<|im_start|>'))).toBe(true); // every-ok: no user messages is also a passing case
  });
});
