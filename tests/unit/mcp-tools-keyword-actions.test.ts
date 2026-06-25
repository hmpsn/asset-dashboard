import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetHandleStoreForTests } from '../../server/mcp/handles.js';

const h = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  addActivity: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  addKeywordToPage: vi.fn(),
  addKeywordToPageInTxn: vi.fn(),
  getPageKeyword: vi.fn(),
  upsertPageKeyword: vi.fn(),
  getConfiguredProvider: vi.fn(),
  invalidateIntelligenceCache: vi.fn(),
  recordPaidCall: vi.fn(),
  loggerDebug: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: h.getWorkspace,
}));

vi.mock('../../server/activity-log.js', () => ({
  addActivity: h.addActivity,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: h.broadcastToWorkspace,
}));

vi.mock('../../server/page-keywords.js', () => ({
  addKeywordToPage: h.addKeywordToPage,
  addKeywordToPageInTxn: h.addKeywordToPageInTxn,
  getPageKeyword: h.getPageKeyword,
  upsertPageKeyword: h.upsertPageKeyword,
}));

vi.mock('../../server/seo-data-provider.js', () => ({
  getConfiguredProvider: h.getConfiguredProvider,
  normalizeRuntimeSeoDataProvider: (provider?: string | null) => provider === 'dataforseo' || provider === 'semrush' ? 'dataforseo' : 'dataforseo',
}));

vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: h.invalidateIntelligenceCache,
}));

vi.mock('../../server/mcp/paid-call-counter.js', () => ({
  recordPaidCall: h.recordPaidCall,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ debug: h.loggerDebug, error: h.loggerError, info: vi.fn(), warn: vi.fn() }),
}));

import { handleKeywordActionTool, keywordActionTools } from '../../server/mcp/tools/keyword-actions.js';

describe('mcp keyword action tools', () => {
  beforeEach(() => {
    __resetHandleStoreForTests();
    vi.clearAllMocks();

    h.getWorkspace.mockReturnValue({ id: 'ws-1', seoDataProvider: 'dataforseo' });
    h.recordPaidCall.mockReturnValue({ warning: undefined });
    h.getConfiguredProvider.mockReturnValue({
      getKeywordMetrics: vi.fn().mockResolvedValue([
        {
          keyword: 'best hvac tips',
          volume: 1200,
          difficulty: 32,
          cpc: 2.1,
          competition: 0.58,
          results: 990000,
          trend: [1, 2, 3],
        },
      ]),
    });
    h.getPageKeyword.mockReturnValue(undefined);
  });

  it('registers keyword action tool names', () => {
    expect(keywordActionTools.map(t => t.name)).toEqual([
      'research_keywords',
      'add_keyword_to_strategy',
      'get_keyword_strategy',
      'remove_page_keyword',
      'add_keywords_batch',
      'replace_keyword_strategy',
    ]);
  });

  it('research_keywords returns provider metrics and reusable handles', async () => {
    const res = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-1',
      terms: ['best hvac tips'],
      market: '2840',
    });

    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0].text) as { results: Array<{ term: string; research_handle: string }> };
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]?.term).toBe('best hvac tips');
    expect(payload.results[0]?.research_handle).toMatch(/^keyword-research_/);
    expect(h.recordPaidCall).toHaveBeenCalledWith(1);
  });

  it('research_keywords handles missing provider and provider errors', async () => {
    h.getConfiguredProvider.mockReturnValue(null);
    const noProvider = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-1',
      terms: ['hvac'],
    });
    expect(noProvider.isError).toBe(true);

    h.getConfiguredProvider.mockReturnValue({
      getKeywordMetrics: vi.fn().mockRejectedValue(new Error('provider timeout')),
    });
    const providerErr = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-1',
      terms: ['hvac'],
      market: 'not-a-number',
    });
    expect(providerErr.isError).toBe(true);
    expect(providerErr.content[0].text).toContain('Keyword research failed: provider timeout');
  });

  it('add_keyword_to_strategy supports research_handle source and new_page target slugging', async () => {
    // Set up getPageKeyword to return the newly-created row so the searchIntent patch runs.
    h.getPageKeyword.mockReturnValueOnce({
      pagePath: '/planned/ai-seo-2026',
      pageTitle: 'AI & SEO 2026!!',
      primaryKeyword: 'best hvac tips',
      secondaryKeywords: [],
    });

    const researched = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-1',
      terms: ['AI + SEO 2026'],
    });
    const researchPayload = JSON.parse(researched.content[0].text) as {
      results: Array<{ research_handle: string }>;
    };

    const added = await handleKeywordActionTool('add_keyword_to_strategy', {
      workspace_id: 'ws-1',
      research_handle: researchPayload.results[0]?.research_handle,
      target: { kind: 'new_page', topic: 'AI & SEO 2026!!', intent: 'commercial' },
    });

    expect(added.isError).toBeUndefined();
    // addKeywordToPage (shared helper) is called first for the planned entry.
    expect(h.addKeywordToPage).toHaveBeenCalledWith('ws-1', '/planned/ai-seo-2026', 'best hvac tips', 'AI & SEO 2026!!');
    // searchIntent is patched onto the row via upsertPageKeyword after addKeywordToPage.
    expect(h.upsertPageKeyword).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      pagePath: '/planned/ai-seo-2026',
      searchIntent: 'commercial',
    }));
    expect(h.broadcastToWorkspace).toHaveBeenCalledWith('ws-1', 'strategy:updated', expect.objectContaining({ action: 'mcp_keyword_added' }));
    expect(h.invalidateIntelligenceCache).toHaveBeenCalledWith('ws-1');
    expect(h.addActivity).toHaveBeenCalledWith('ws-1', 'keyword_added', expect.any(String), expect.any(String), expect.objectContaining({ source: 'mcp-chat' }));
  });

  it('add_keyword_to_strategy routes existing_page target through addKeywordToPage helper', async () => {
    // addKeywordToPage (shared helper) is now responsible for merge-as-secondary and dedupe.
    // These unit tests verify that the MCP tool calls the shared helper with the correct args.
    const a = await handleKeywordActionTool('add_keyword_to_strategy', {
      workspace_id: 'ws-1',
      term: 'furnace tune up',
      target: { kind: 'existing_page', page_url: 'https://example.com/services/hvac' },
    });
    expect(a.isError).toBeUndefined();
    expect(h.addKeywordToPage).toHaveBeenCalledWith('ws-1', '/services/hvac', 'furnace tune up');

    h.addKeywordToPage.mockClear();

    const b = await handleKeywordActionTool('add_keyword_to_strategy', {
      workspace_id: 'ws-1',
      term: 'AC REPAIR',
      target: { kind: 'existing_page', page_url: 'https://example.com/services/hvac' },
    });
    expect(b.isError).toBeUndefined();
    expect(h.addKeywordToPage).toHaveBeenCalledWith('ws-1', '/services/hvac', 'AC REPAIR');
  });

  it('rejects unresolved terms, invalid handles, and unknown tool names', async () => {
    const unresolved = await handleKeywordActionTool('add_keyword_to_strategy', {
      workspace_id: 'ws-1',
      term: '   ',
      target: { kind: 'new_page', topic: 'Test', intent: 'informational' },
    });
    expect(unresolved.isError).toBe(true);
    expect(unresolved.content[0].text).toContain('No keyword term resolved');

    const invalidHandle = await handleKeywordActionTool('add_keyword_to_strategy', {
      workspace_id: 'ws-1',
      research_handle: 'keyword-research_00000000-0000-0000-0000-000000000000',
      target: { kind: 'new_page', topic: 'Test', intent: 'informational' },
    });
    expect(invalidHandle.isError).toBe(true);

    const unknown = await handleKeywordActionTool('unknown_keyword_tool', { workspace_id: 'ws-1' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain('Unknown keyword action tool');
  });

  it('covers validation/workspace guards and non-Error provider failures', async () => {
    const invalidResearch = await handleKeywordActionTool('research_keywords', { workspace_id: 'ws-1' });
    expect(invalidResearch.isError).toBe(true);
    expect(invalidResearch.content[0].text).toContain('Validation failed');

    const invalidAdd = await handleKeywordActionTool('add_keyword_to_strategy', { workspace_id: 'ws-1' });
    expect(invalidAdd.isError).toBe(true);
    expect(invalidAdd.content[0].text).toContain('Validation failed');

    h.getWorkspace.mockReturnValueOnce(undefined);
    const missingWs = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-missing',
      terms: ['hvac'],
    });
    expect(missingWs.isError).toBe(true);
    expect(missingWs.content[0].text).toContain('Workspace not found');

    h.getConfiguredProvider.mockReturnValue({
      getKeywordMetrics: vi.fn().mockRejectedValue('provider exploded'),
    });
    const providerErr = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-1',
      terms: ['hvac'],
      market: '123',
    });
    expect(providerErr.isError).toBe(true);
    expect(providerErr.content[0].text).toContain('Keyword research failed: provider exploded');
  });

  it('normalizes legacy semrush provider preference and covers page/url fallback branches', async () => {
    h.getWorkspace.mockReturnValueOnce({ id: 'ws-1', seoDataProvider: 'semrush' });
    const semrush = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-1',
      terms: ['hvac'],
    });
    expect(semrush.isError).toBeUndefined();
    expect(h.getConfiguredProvider).toHaveBeenLastCalledWith('dataforseo');

    // existing_page with root URL → addKeywordToPage called with pagePath '/'
    const rootPath = await handleKeywordActionTool('add_keyword_to_strategy', {
      workspace_id: 'ws-1',
      term: 'furnace tune up',
      target: { kind: 'existing_page', page_url: 'https://example.com' },
    });
    expect(rootPath.isError).toBeUndefined();
    expect(h.addKeywordToPage).toHaveBeenLastCalledWith('ws-1', '/', 'furnace tune up');

    // new_page with all-punctuation topic → slug falls back to 'page'
    const slugFallback = await handleKeywordActionTool('add_keyword_to_strategy', {
      workspace_id: 'ws-1',
      term: 'furnace tune up',
      target: { kind: 'new_page', topic: '!!!', intent: 'informational' },
    });
    expect(slugFallback.isError).toBeUndefined();
    expect(h.addKeywordToPage).toHaveBeenLastCalledWith('ws-1', '/planned/page', 'furnace tune up', '!!!');
  });

  it('covers URL-parse fallback and remaining workspace/provider branches', async () => {
    h.getWorkspace.mockReturnValueOnce({ id: 'ws-1', seoDataProvider: 'unknown-provider' });
    await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-1',
      terms: ['hvac'],
    });
    expect(h.getConfiguredProvider).toHaveBeenLastCalledWith('dataforseo');

    h.getWorkspace.mockReturnValueOnce(undefined);
    const missingWs = await handleKeywordActionTool('add_keyword_to_strategy', {
      workspace_id: 'ws-missing',
      term: 'hvac',
      target: { kind: 'new_page', topic: 'HVAC', intent: 'informational' },
    });
    expect(missingWs.isError).toBe(true);
    expect(missingWs.content[0].text).toContain('Workspace not found');
  });
});
