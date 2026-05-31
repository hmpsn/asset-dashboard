import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  addKeywordsBatchInputSchema,
  addKeywordToStrategyInputSchema,
  getKeywordStrategyInputSchema,
  removePageKeywordInputSchema,
  replaceKeywordStrategyInputSchema,
  researchKeywordsInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import type { PageKeywordMap } from '../../../shared/types/workspace.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { createLogger } from '../../logger.js';
import {
  deletePageKeyword,
  getPageKeyword,
  listPageKeywords,
  listPageKeywordsLite,
  upsertAndCleanPageKeywords,
  upsertPageKeyword,
  upsertPageKeywordsBatch,
} from '../../page-keywords.js';
import { getConfiguredProvider } from '../../seo-data-provider.js';
import type { ProviderName } from '../../seo-data-provider.js';
import { invalidateIntelligenceCache } from '../../workspace-intelligence.js';
import { WS_EVENTS } from '../../ws-events.js';
import { consumeHandle, issueHandle } from '../handles.js';
import { slugify } from '../../helpers.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { recordPaidCall } from '../paid-call-counter.js';
import {
  buildDashboardUrl,
  mcpError,
  mcpSuccess,
  requireWorkspace,
  zodErrorToMcp,
  type McpToolErrorResponse,
  type McpToolSuccessResponse,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-keyword-actions');

export const keywordActionTools: Tool[] = [
  {
    name: 'research_keywords',
    description: '[Paid API] Research keyword metrics and return reusable research handles for follow-up strategy mutations.',
    inputSchema: toMcpJsonSchema(researchKeywordsInputSchema),
  },
  {
    name: 'add_keyword_to_strategy',
    description: 'Persist a keyword into strategy targeting for an existing page or a new planned page.',
    inputSchema: toMcpJsonSchema(addKeywordToStrategyInputSchema),
  },
  {
    name: 'get_keyword_strategy',
    description: 'Read page-level keyword targeting strategy for a workspace.',
    inputSchema: toMcpJsonSchema(getKeywordStrategyInputSchema),
  },
  {
    name: 'remove_page_keyword',
    description: 'Remove keyword targeting for a specific page path.',
    inputSchema: toMcpJsonSchema(removePageKeywordInputSchema),
  },
  {
    name: 'add_keywords_batch',
    description: 'Batch upsert page keyword entries for a workspace.',
    inputSchema: toMcpJsonSchema(addKeywordsBatchInputSchema),
  },
  {
    name: 'replace_keyword_strategy',
    description: 'Replace the full page-keyword strategy set for a workspace.',
    inputSchema: toMcpJsonSchema(replaceKeywordStrategyInputSchema),
  },
];

function parseMarketLocationCode(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function pagePathFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch (err) {
    log.debug({ err, url }, 'add_keyword_to_strategy received non-URL page target; using raw path');
    return url;
  }
}

async function handleResearchKeywords(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = researchKeywordsInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const { workspace_id: workspaceId, terms, market } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const preferredProvider: ProviderName | undefined =
    workspace.seoDataProvider === 'dataforseo' || workspace.seoDataProvider === 'semrush'
      ? workspace.seoDataProvider
      : undefined;
  const provider = getConfiguredProvider(preferredProvider);
  if (!provider) return mcpError('No SEO data provider is configured for this workspace');

  try {
    const metrics = await provider.getKeywordMetrics(
      terms,
      workspaceId,
      undefined,
      parseMarketLocationCode(market),
    );
    const { warning } = recordPaidCall(terms.length);

    const results = metrics.map((item) => {
      const researchHandle = issueHandle('keyword-research', workspaceId, {
        term: item.keyword,
        market,
        volume: item.volume,
        difficulty: item.difficulty,
        cpc: item.cpc,
        competition: item.competition,
        results: item.results,
        trend: item.trend,
      });
      return {
        term: item.keyword,
        research_handle: researchHandle,
        volume: item.volume,
        difficulty: item.difficulty,
        cpc: item.cpc,
        competition: item.competition,
        results_count: item.results,
        trend: item.trend,
      };
    });

    return mcpSuccess({ results, warning });
  } catch (err) {
    log.error({ err, workspaceId, terms }, 'research_keywords failed');
    const message = err instanceof Error ? err.message : String(err);
    return mcpError(`Keyword research failed: ${message}`);
  }
}

async function handleAddKeywordToStrategy(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = addKeywordToStrategyInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const { workspace_id: workspaceId, research_handle: researchHandle, term, target } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  let resolvedTerm = term?.trim() ?? '';
  if (researchHandle) {
    try {
      const payload = consumeHandle<{ term: string }>(researchHandle, 'keyword-research', workspaceId);
      resolvedTerm = payload.term.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpError(message);
    }
  }
  if (!resolvedTerm) return mcpError('No keyword term resolved');

  let next: PageKeywordMap;
  if (target.kind === 'existing_page') {
    const pagePath = pagePathFromUrl(target.page_url);
    const existing = getPageKeyword(workspaceId, pagePath);
    if (existing) {
      const secondarySet = new Set(existing.secondaryKeywords.map(k => k.toLowerCase()));
      if (
        existing.primaryKeyword.toLowerCase() !== resolvedTerm.toLowerCase()
        && !secondarySet.has(resolvedTerm.toLowerCase())
      ) {
        existing.secondaryKeywords = [...existing.secondaryKeywords, resolvedTerm];
      }
      next = existing;
    } else {
      next = {
        pagePath,
        pageTitle: target.page_url,
        primaryKeyword: resolvedTerm,
        secondaryKeywords: [],
      };
    }
  } else {
    next = {
      pagePath: `/planned/${slugify(target.topic) || 'page'}`,
      pageTitle: target.topic,
      primaryKeyword: resolvedTerm,
      secondaryKeywords: [],
      searchIntent: target.intent,
    };
  }

  upsertPageKeyword(workspaceId, next);
  broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, {
    workspaceId,
    action: 'mcp_keyword_added',
    term: resolvedTerm,
    pagePath: next.pagePath,
  });
  invalidateIntelligenceCache(workspaceId);
  addActivity(
    workspaceId,
    'keyword_added',
    `Added keyword "${resolvedTerm}" to strategy`,
    `Page: ${next.pagePath}`,
    {
      source: 'mcp-chat',
      keyword: resolvedTerm,
      pagePath: next.pagePath,
      action: 'mcp_keyword_added',
    },
  );

  return mcpSuccess({
    ok: true,
    term: resolvedTerm,
    page_path: next.pagePath,
    dashboard_url: buildDashboardUrl(workspaceId, 'content-plan'),
  });
}

async function handleGetKeywordStrategy(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = getKeywordStrategyInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, lite } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const entries = lite ? listPageKeywordsLite(workspaceId) : listPageKeywords(workspaceId);
  return mcpSuccess({
    entries,
    count: entries.length,
    dashboard_url: buildDashboardUrl(workspaceId, 'content-plan'),
  });
}

async function handleRemovePageKeyword(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = removePageKeywordInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, page_path: pagePath } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  deletePageKeyword(workspaceId, pagePath);
  broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, {
    workspaceId,
    action: 'mcp_page_keyword_removed',
    pagePath,
  });
  invalidateIntelligenceCache(workspaceId);
  addActivity(
    workspaceId,
    'strategy_generated',
    `Removed keyword targeting for "${pagePath}"`,
    undefined,
    {
      source: 'mcp-chat',
      pagePath,
      action: 'mcp_page_keyword_removed',
    },
  );

  return mcpSuccess({
    ok: true,
    page_path: pagePath,
    dashboard_url: buildDashboardUrl(workspaceId, 'content-plan'),
  });
}

async function handleAddKeywordsBatch(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = addKeywordsBatchInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, entries } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  upsertPageKeywordsBatch(workspaceId, entries as PageKeywordMap[]);
  broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, {
    workspaceId,
    action: 'mcp_keywords_batch_added',
    count: entries.length,
  });
  invalidateIntelligenceCache(workspaceId);
  addActivity(
    workspaceId,
    'keyword_added',
    `Batch added/updated ${entries.length} keyword mappings`,
    undefined,
    {
      source: 'mcp-chat',
      count: entries.length,
      action: 'mcp_keywords_batch_added',
    },
  );

  return mcpSuccess({
    ok: true,
    added_count: entries.length,
    dashboard_url: buildDashboardUrl(workspaceId, 'content-plan'),
  });
}

async function handleReplaceKeywordStrategy(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = replaceKeywordStrategyInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, entries } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  upsertAndCleanPageKeywords(workspaceId, entries as PageKeywordMap[]);
  broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, {
    workspaceId,
    action: 'mcp_keyword_strategy_replaced',
    count: entries.length,
  });
  invalidateIntelligenceCache(workspaceId);
  addActivity(
    workspaceId,
    'strategy_generated',
    `Replaced keyword strategy mappings (${entries.length} pages)`,
    undefined,
    {
      source: 'mcp-chat',
      count: entries.length,
      action: 'mcp_keyword_strategy_replaced',
    },
  );

  return mcpSuccess({
    ok: true,
    count: entries.length,
    dashboard_url: buildDashboardUrl(workspaceId, 'content-plan'),
  });
}

export async function handleKeywordActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  if (name === 'research_keywords') return handleResearchKeywords(args);
  if (name === 'add_keyword_to_strategy') return handleAddKeywordToStrategy(args);
  if (name === 'get_keyword_strategy') return handleGetKeywordStrategy(args);
  if (name === 'remove_page_keyword') return handleRemovePageKeyword(args);
  if (name === 'add_keywords_batch') return handleAddKeywordsBatch(args);
  if (name === 'replace_keyword_strategy') return handleReplaceKeywordStrategy(args);
  return mcpError(`Unknown keyword action tool: ${name}`);
}
