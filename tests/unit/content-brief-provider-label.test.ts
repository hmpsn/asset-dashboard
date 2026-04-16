import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../server/openai-helpers.js', () => ({
  callOpenAI: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// Set required env var before module import
process.env.OPENAI_API_KEY = 'test-key-for-unit-tests';

import { callOpenAI } from '../../server/openai-helpers.js';
import { generateBrief } from '../../server/content-brief.js';

const mockCallOpenAI = vi.mocked(callOpenAI);

const MOCK_BRIEF = JSON.stringify({
  suggestedTitle: 'Test Title',
  suggestedMetaDesc: 'Test meta',
  executiveSummary: 'Test summary',
  contentFormat: 'blog',
  toneAndStyle: 'professional',
  wordCountTarget: 1500,
  intent: 'informational',
  audience: 'marketers',
  secondaryKeywords: [],
  outline: [],
  peopleAlsoAsk: [],
  topicalEntities: [],
  competitorInsights: '',
  internalLinkSuggestions: [],
  ctaRecommendations: [],
  eeatGuidance: null,
  contentChecklist: [],
  schemaRecommendations: [],
  keywordValidation: null,
  realTopResults: [],
  realPeopleAlsoAsk: [],
  serpAnalysis: null,
});

const WS_ID = 'test-ws-content-brief-label';

describe('generateBrief — provider label', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses DataForSEO as provider label when specified', async () => {
    mockCallOpenAI.mockResolvedValue({ content: MOCK_BRIEF, usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } });

    await generateBrief(WS_ID, 'test keyword', {
      keywordMetrics: { keyword: 'test keyword', volume: 5000, difficulty: 55, cpc: 2.0, competition: 0.5, results: 0, trend: [] },
      relatedKeywords: [],
      providerLabel: 'DataForSEO',
    }).catch(() => {});

    const calls = mockCallOpenAI.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const promptArg = JSON.stringify(calls[0]);
    expect(promptArg).toContain('DataForSEO');
    expect(promptArg).not.toContain('from SEMRush');
  });

  it('omits "Total results" line when results = 0', async () => {
    mockCallOpenAI.mockResolvedValue({ content: MOCK_BRIEF, usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } });

    await generateBrief(WS_ID, 'zero results kw', {
      keywordMetrics: { keyword: 'zero results kw', volume: 1000, difficulty: 30, cpc: 0.5, competition: 0.3, results: 0, trend: [] },
      providerLabel: 'DataForSEO',
    }).catch(() => {});

    const promptArg = JSON.stringify(mockCallOpenAI.mock.calls[0]);
    expect(promptArg).not.toContain('Total results');
  });

  it('includes "Total results" line when results > 0', async () => {
    mockCallOpenAI.mockResolvedValue({ content: MOCK_BRIEF, usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } });

    await generateBrief(WS_ID, 'has results kw', {
      keywordMetrics: { keyword: 'has results kw', volume: 1000, difficulty: 30, cpc: 0.5, competition: 0.3, results: 4500000, trend: [] },
      providerLabel: 'SEMRush',
    }).catch(() => {});

    const promptArg = JSON.stringify(mockCallOpenAI.mock.calls[0]);
    expect(promptArg).toContain('Total results');
    expect(promptArg).toContain('4,500,000');
  });
});
