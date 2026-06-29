import type { Tool } from '@modelcontextprotocol/sdk/types';
import { getBrandIdentityInputSchema } from '../../../shared/types/mcp-action-schemas.js';
import { getWorkspace } from '../../workspaces.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { listDeliverables } from '../../brand-deliverable-read-model.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';

const log = createLogger('mcp-tools-brand');

export const brandTools: Tool[] = [
  {
    name: 'get_brand_identity',
    description:
      "Get a workspace's structured brand identity (mission, vision, values, tagline, elevator pitch, positioning) and voice status. Set includeDeliverables to also return every brand deliverable with its draft/approved status and version for deeper inspection. Use before content work to ground brand positioning.",
    inputSchema: toMcpJsonSchema(getBrandIdentityInputSchema),
  },
];

export async function handleBrandTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (name !== 'get_brand_identity') {
    return { isError: true, content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }] };
  }

  const parsed = getBrandIdentityInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Validation failed: ${JSON.stringify(parsed.error.issues)}` }],
    };
  }

  const { workspaceId, includeDeliverables } = parsed.data;
  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return { isError: true, content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }] };
    }

    const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['brand'] });
    const brand = intel.brand;
    const payload: Record<string, unknown> = {
      availability: brand?.availability ?? 'no_data',
      identity: brand?.identity ?? {},
      voice_status: brand?.voice.status ?? 'none',
      identity_prompt_block: brand?.identityPromptBlock ?? '',
    };
    if (includeDeliverables) {
      payload.deliverables = listDeliverables(workspaceId).map(d => ({
        id: d.id,
        deliverableType: d.deliverableType,
        content: d.content,
        status: d.status,
        version: d.version,
        tier: d.tier,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }));
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
  } catch (err) {
    log.error({ err, workspaceId }, 'MCP tool error');
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text' as const, text: `Tool error: ${message}` }] };
  }
}
