import type { Tool } from '@modelcontextprotocol/sdk/types';
import { getContentPerformanceInputSchema } from '../../../shared/types/mcp-action-schemas.js';
import { getInsights } from '../../analytics-insights-store.js';
import { listKeywordGaps } from '../../keyword-gaps.js';
import { listTopicClusters } from '../../topic-clusters.js';
import { listCannibalizationIssues } from '../../cannibalization-issues.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { getWorkspace } from '../../workspaces.js';
import type { IntelligenceSlice } from '../../../shared/types/intelligence.js';
import { getPrimaryMarketLocationCode } from '../../local-seo.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { handleContentPerformance } from '../../routes/content-requests.js';
import {
  mcpInternalError,
  mcpNotFoundError,
  mcpValidationError,
  zodErrorToMcp,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-content');

export const contentTools: Tool[] = [
  {
    name: 'get_content_decay',
    description:
      'Get pages losing organic traffic over time, sorted by decay severity (most severe first). The starting point for rewrite prioritization. Each result includes the page path, traffic decline percentage, and baseline vs current click counts.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
        limit: {
          type: 'number',
          description: 'Maximum pages to return (default: 20)',
        },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_keyword_analysis',
    description:
      'Get keyword gaps (opportunities not yet targeted), topic cluster coverage, and cannibalization conflicts for a workspace. Use before content planning to understand what to write and what to fix.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_seo_context',
    description:
      "Get the SEO context for a workspace: domain health, brand voice, business context, and GSC ranking signals. Use before any content or schema work to understand the site's current SEO state.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_content_performance',
    description:
      'Get post/request content performance with GSC and GA4 metrics, publish age, source metadata, and brief execution coverage where available.',
    inputSchema: toMcpJsonSchema(getContentPerformanceInputSchema),
  },
];

export const CONTENT_HANDLED_TOOL_NAMES = Object.freeze([
  'get_content_decay',
  'get_keyword_analysis',
  'get_seo_context',
  'get_content_performance',
] as const);

type ContentHandledToolName = (typeof CONTENT_HANDLED_TOOL_NAMES)[number];

function isContentHandledToolName(name: string): name is ContentHandledToolName {
  return CONTENT_HANDLED_TOOL_NAMES.includes(name as ContentHandledToolName);
}

const SEO_CONTEXT_SLICE: readonly IntelligenceSlice[] = ['seoContext'];

export async function handleContentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (!isContentHandledToolName(name)) {
    return mcpNotFoundError('Unknown tool: the requested tool does not exist.', { resource_type: 'tool' });
  }

  const workspaceId = args.workspaceId;
  if (typeof workspaceId !== 'string') {
    return mcpValidationError('Invalid tool input at workspaceId: Expected a workspace ID.', {
      field_path: 'workspaceId',
      constraint: 'Expected a non-empty workspace ID.',
    });
  }

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });
    }

    if (name === 'get_content_decay') {
      const limit = typeof args.limit === 'number' ? Math.max(0, Math.floor(args.limit)) : 20;
      const decayInsights = getInsights(workspaceId, 'content_decay')
        .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0))
        .slice(0, limit)
        .map(i => ({
          pageId: i.pageId,
          severity: i.severity,
          impactScore: i.impactScore,
          data: i.data,
        }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(decayInsights) }] };
    }

    if (name === 'get_keyword_analysis') {
      const { getDiscoveredQuerySummary, getLostVisibilityQueries } = await import('../../client-discovered-queries.js'); // dynamic-import-ok - optional discovery table degrades through outer tool error handling
      const geo = (() => {
        try {
          return getPrimaryMarketLocationCode(workspaceId);
        } catch (err) {
          log.debug({ err, workspaceId }, 'get_keyword_analysis: geoVolumeLabel optional, degrading gracefully');
          return null;
        }
      })();
      const result = {
        gaps: listKeywordGaps(workspaceId),
        topicClusters: listTopicClusters(workspaceId),
        cannibalization: listCannibalizationIssues(workspaceId),
        lostVisibility: getLostVisibilityQueries(workspaceId),
        discovered_query_summary: (() => {
          try {
            return getDiscoveredQuerySummary(workspaceId);
          } catch (err) {
            log.debug({ err, workspaceId }, 'get_keyword_analysis: discovered query summary unavailable, degrading gracefully');
            return null;
          }
        })(),
        geoVolumeLabel: geo?.label ?? null,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }

    if (name === 'get_seo_context') {
      const intel = await buildWorkspaceIntelligence(workspaceId, { slices: SEO_CONTEXT_SLICE });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(intel.seoContext ?? {}) }],
      };
    }

    if (name === 'get_content_performance') {
      const parsed = getContentPerformanceInputSchema.safeParse(args);
      if (!parsed.success) {
        return zodErrorToMcp(parsed.error);
      }
      const data = await handleContentPerformance(parsed.data.workspaceId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }

    return mcpNotFoundError('Unknown tool: the requested tool does not exist.', { resource_type: 'tool' });
  } catch (err) {
    log.error({ err, tool: name, workspaceId }, 'MCP tool error');
    return mcpInternalError();
  }
}
