import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetHandleStoreForTests } from '../../server/mcp/handles.js';
import { __resetPaidCallCounterForTests } from '../../server/mcp/paid-call-counter.js';

vi.mock('../../server/seo-data-provider.js', () => ({
  getConfiguredProvider: vi.fn(),
}));
vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));
vi.mock('../../server/page-keywords.js', () => ({
  deletePageKeyword: vi.fn(),
  getPageKeyword: vi.fn(),
  listPageKeywords: vi.fn(),
  listPageKeywordsLite: vi.fn(),
  upsertAndCleanPageKeywords: vi.fn(),
  upsertPageKeyword: vi.fn(),
  upsertPageKeywordsBatch: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../../server/workspace-intelligence.js', () => ({
  invalidateIntelligenceCache: vi.fn(),
}));
vi.mock('../../server/activity-log.js', () => ({
  addActivity: vi.fn(),
}));

import { getConfiguredProvider } from '../../server/seo-data-provider.js';
import { getWorkspace } from '../../server/workspaces.js';
import {
  deletePageKeyword,
  getPageKeyword,
  listPageKeywords,
  upsertAndCleanPageKeywords,
  upsertPageKeyword,
  upsertPageKeywordsBatch,
} from '../../server/page-keywords.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { invalidateIntelligenceCache } from '../../server/workspace-intelligence.js';
import { addActivity } from '../../server/activity-log.js';
import { handleKeywordActionTool, keywordActionTools } from '../../server/mcp/tools/keyword-actions.js';

describe('mcp keyword action tools', () => {
  beforeEach(() => {
    __resetHandleStoreForTests();
    __resetPaidCallCounterForTests();
    vi.clearAllMocks();
    delete process.env.MCP_PAID_CALL_WARN_AFTER;
    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'ws-1',
      name: 'Workspace',
      seoDataProvider: 'dataforseo',
    });
    (getConfiguredProvider as ReturnType<typeof vi.fn>).mockReturnValue({
      getKeywordMetrics: vi.fn().mockResolvedValue([
        {
          keyword: 'new keyword',
          volume: 100,
          difficulty: 20,
          cpc: 1.5,
          competition: 0.4,
          results: 1000,
          trend: [],
        },
      ]),
    });
  });

  it('registers keyword action tools', () => {
    expect(keywordActionTools.map(t => t.name)).toEqual([
      'research_keywords',
      'add_keyword_to_strategy',
      'get_keyword_strategy',
      'remove_page_keyword',
      'add_keywords_batch',
      'replace_keyword_strategy',
    ]);
  });

  it('research_keywords returns metrics + handles', async () => {
    (getConfiguredProvider as ReturnType<typeof vi.fn>).mockReturnValue({
      getKeywordMetrics: vi.fn().mockResolvedValue([
        {
          keyword: 'hvac marketing',
          volume: 100,
          difficulty: 32,
          cpc: 2.2,
          competition: 0.4,
          results: 12000,
          trend: [1, 2, 3],
        },
      ]),
    });

    const result = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-1',
      terms: ['hvac marketing'],
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as { results: Array<{ research_handle: string; volume: number }> };
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].research_handle).toMatch(/^keyword-research_/);
    expect(payload.results[0].volume).toBe(100);
  });

  it('research_keywords emits soft-cap warning when threshold hit', async () => {
    process.env.MCP_PAID_CALL_WARN_AFTER = '2';
    __resetPaidCallCounterForTests();
    (getConfiguredProvider as ReturnType<typeof vi.fn>).mockReturnValue({
      getKeywordMetrics: vi.fn().mockResolvedValue([
        {
          keyword: 'a',
          volume: 1,
          difficulty: 1,
          cpc: 0,
          competition: 0,
          results: 1,
          trend: [],
        },
        {
          keyword: 'b',
          volume: 1,
          difficulty: 1,
          cpc: 0,
          competition: 0,
          results: 1,
          trend: [],
        },
      ]),
    });

    const result = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-1',
      terms: ['a', 'b'],
    });
    const payload = JSON.parse(result.content[0].text) as { warning?: string };
    expect(payload.warning).toMatch(/paid_call_count: 2/);
  });

  it('add_keyword_to_strategy upserts + broadcasts + logs activity', async () => {
    (getPageKeyword as ReturnType<typeof vi.fn>).mockReturnValue({
      pagePath: '/blog/existing',
      pageTitle: 'Existing',
      primaryKeyword: 'old',
      secondaryKeywords: ['legacy'],
    });

    const research = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'ws-1',
      terms: ['new keyword'],
    });
    const researchPayload = JSON.parse(research.content[0].text) as { results: Array<{ research_handle: string }> };
    const handle = researchPayload.results[0].research_handle;

    const result = await handleKeywordActionTool('add_keyword_to_strategy', {
      workspace_id: 'ws-1',
      research_handle: handle,
      target: { kind: 'existing_page', page_url: 'https://example.com/blog/existing' },
    });

    expect(result.isError).toBeUndefined();
    expect(upsertPageKeyword).toHaveBeenCalledOnce();
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'strategy:updated',
      expect.objectContaining({ action: 'mcp_keyword_added' }),
    );
    expect(invalidateIntelligenceCache).toHaveBeenCalledWith('ws-1');
    expect(addActivity).toHaveBeenCalledWith(
      'ws-1',
      'keyword_added',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ source: 'mcp-chat' }),
    );
  });

  it('returns error when workspace does not exist', async () => {
    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const result = await handleKeywordActionTool('research_keywords', {
      workspace_id: 'missing',
      terms: ['x'],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Workspace not found/);
  });

  it('supports strategy read + CRUD helpers', async () => {
    (listPageKeywords as ReturnType<typeof vi.fn>).mockReturnValue([
      { pagePath: '/a', pageTitle: 'A', primaryKeyword: 'kw', secondaryKeywords: [] },
    ]);

    const listResult = await handleKeywordActionTool('get_keyword_strategy', {
      workspace_id: 'ws-1',
    });
    expect(listResult.isError).toBeUndefined();

    const removeResult = await handleKeywordActionTool('remove_page_keyword', {
      workspace_id: 'ws-1',
      page_path: '/a',
    });
    expect(removeResult.isError).toBeUndefined();
    expect(deletePageKeyword).toHaveBeenCalledWith('ws-1', '/a');

    const batchResult = await handleKeywordActionTool('add_keywords_batch', {
      workspace_id: 'ws-1',
      entries: [{ pagePath: '/a', pageTitle: 'A', primaryKeyword: 'kw', secondaryKeywords: [] }],
    });
    expect(batchResult.isError).toBeUndefined();
    expect(upsertPageKeywordsBatch).toHaveBeenCalledTimes(1);

    const replaceResult = await handleKeywordActionTool('replace_keyword_strategy', {
      workspace_id: 'ws-1',
      entries: [{ pagePath: '/a', pageTitle: 'A', primaryKeyword: 'kw', secondaryKeywords: [] }],
    });
    expect(replaceResult.isError).toBeUndefined();
    expect(upsertAndCleanPageKeywords).toHaveBeenCalledTimes(1);
  });
});
