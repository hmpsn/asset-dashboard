import type { Tool } from '@modelcontextprotocol/sdk/types';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { getWorkspace } from '../../workspaces.js';
import { INTELLIGENCE_SLICES, isIntelligenceSlice } from '../../../shared/types/intelligence.js';
import type { IntelligenceOptions } from '../../../shared/types/intelligence.js';
import { createLogger } from '../../logger.js';

const log = createLogger('mcp-tools-intelligence');

export const intelligenceTools: Tool[] = [
  {
    name: 'get_workspace_intelligence',
    description:
      'Get the full intelligence bundle for a workspace — the same context used by AdminChat. Includes SEO context, insights summary, content pipeline, site health, client signals, and keyword context. Use when you need the complete picture before making decisions about a workspace. Pass specific slices to reduce response size.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
        slices: {
          type: 'array',
          items: { type: 'string' },
          description:
            `Optional: limit to specific slices. Valid values: ${INTELLIGENCE_SLICES.join(', ')}. Omit for all slices. The localSeo slice carries the full bounded candidate universe (capped at 1000) plus a pre-formatted prompt block — external agents get the full data; internal AI prompts use the sampled block.`,
        },
        pagePath: {
          type: 'string',
          description: 'Optional page path for page-scoped slices such as pageProfile and pageElements.',
        },
        siteId: {
          type: 'string',
          description: 'Optional Webflow site ID for siteInventory assembly.',
        },
        siteBaseUrl: {
          type: 'string',
          description: 'Optional resolved live base URL for siteInventory assembly.',
        },
      },
      required: ['workspaceId'],
    },
  },
];

export async function handleIntelligenceTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (name !== 'get_workspace_intelligence') {
    return { isError: true, content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }] };
  }

  const workspaceId = args.workspaceId;
  if (typeof workspaceId !== 'string') {
    return { isError: true, content: [{ type: 'text' as const, text: 'Missing or invalid workspaceId' }] };
  }

  const requestedSlices = Array.isArray(args.slices)
    ? (args.slices as string[]).filter(isIntelligenceSlice)
    : [...INTELLIGENCE_SLICES];

  if (requestedSlices.length === 0) {
    return { isError: true, content: [{ type: 'text' as const, text: 'No valid intelligence slices specified' }] };
  }

  if (requestedSlices.length === 0) {
    return { isError: true, content: [{ type: 'text' as const, text: 'No valid intelligence slices specified' }] };
  }

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
      };
    }

    const pagePath = typeof args.pagePath === 'string' ? args.pagePath : undefined;
    const siteId = typeof args.siteId === 'string' ? args.siteId : undefined;
    const siteBaseUrl = typeof args.siteBaseUrl === 'string' ? args.siteBaseUrl : undefined;
    const opts: IntelligenceOptions = {
      slices: requestedSlices,
      pagePath,
      siteId,
      siteBaseUrl,
    };
    const intel = await buildWorkspaceIntelligence(workspaceId, opts); // bwi-all-ok: MCP read model intentionally returns the full registered bundle when slices are omitted
    return { content: [{ type: 'text' as const, text: JSON.stringify(intel) }] };
  } catch (err) {
    log.error({ err, workspaceId, slices: requestedSlices }, 'Intelligence assembly failed');
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Intelligence assembly failed: ${message}` }],
    };
  }
}
