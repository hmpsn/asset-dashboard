import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  addKeywordToStrategyInputSchema,
  researchKeywordsInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import type { PageKeywordMap } from '../../../shared/types/workspace.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { createLogger } from '../../logger.js';
import { getPageKeyword, upsertPageKeyword } from '../../page-keywords.js';
import { getConfiguredProvider } from '../../seo-data-provider.js';
import type { ProviderName } from '../../seo-data-provider.js';
import { invalidateIntelligenceCache } from '../../workspace-intelligence.js';
import { WS_EVENTS } from '../../ws-events.js';
import { consumeHandle, issueHandle } from '../handles.js';
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
];

function parseMarketLocationCode(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'page';
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
      pagePath: `/planned/${slugify(target.topic)}`,
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

export async function handleKeywordActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  if (name === 'research_keywords') return handleResearchKeywords(args);
  if (name === 'add_keyword_to_strategy') return handleAddKeywordToStrategy(args);
  return mcpError(`Unknown keyword action tool: ${name}`);
}
