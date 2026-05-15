import type { Tool } from '@modelcontextprotocol/sdk/types';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { getWorkspace } from '../../workspaces.js';
import type { IntelligenceSlice } from '../../../shared/types/intelligence.js';

const ALL_INTELLIGENCE_SLICES: IntelligenceSlice[] = [
  'seoContext',
  'insights',
  'learnings',
  'pageProfile',
  'pageElements',
  'siteInventory',
  'contentPipeline',
  'siteHealth',
  'clientSignals',
  'operational',
];

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
            'Optional: limit to specific slices. Valid values: seoContext, insights, learnings, pageProfile, pageElements, siteInventory, contentPipeline, siteHealth, clientSignals, operational. Omit for all slices.',
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
    ? (args.slices as IntelligenceSlice[])
    : ALL_INTELLIGENCE_SLICES;

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
      };
    }

    const intel = await buildWorkspaceIntelligence(workspaceId, { slices: requestedSlices });
    return { content: [{ type: 'text' as const, text: JSON.stringify(intel) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Intelligence assembly failed: ${message}` }],
    };
  }
}
