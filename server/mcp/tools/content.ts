import type { Tool } from '@modelcontextprotocol/sdk/types';
import { getInsights } from '../../analytics-insights-store.js';
import { listKeywordGaps } from '../../keyword-gaps.js';
import { listTopicClusters } from '../../topic-clusters.js';
import { listCannibalizationIssues } from '../../cannibalization-issues.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { getWorkspace } from '../../workspaces.js';
import type { IntelligenceSlice } from '../../../shared/types/intelligence.js';
import { createLogger } from '../../logger.js';

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
];

const SEO_CONTEXT_SLICE: readonly IntelligenceSlice[] = ['seoContext'];

export async function handleContentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const workspaceId = args.workspaceId;
  if (typeof workspaceId !== 'string') {
    return { isError: true, content: [{ type: 'text' as const, text: 'Missing or invalid workspaceId' }] };
  }

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
      };
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
      const result = {
        gaps: listKeywordGaps(workspaceId),
        topicClusters: listTopicClusters(workspaceId),
        cannibalization: listCannibalizationIssues(workspaceId),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }

    if (name === 'get_seo_context') {
      const intel = await buildWorkspaceIntelligence(workspaceId, { slices: SEO_CONTEXT_SLICE });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(intel.seoContext ?? {}) }],
      };
    }

    return { isError: true, content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }] };
  } catch (err) {
    log.error({ err, tool: name, workspaceId }, 'MCP tool error');
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text' as const, text: `Tool error: ${message}` }] };
  }
}
