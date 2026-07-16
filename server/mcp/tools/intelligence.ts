import type { Tool } from '@modelcontextprotocol/sdk/types';
import { getWorkspaceIntelligenceInputSchema } from '../../../shared/types/mcp-action-schemas.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { getWorkspace } from '../../workspaces.js';
import { INTELLIGENCE_SLICES, isIntelligenceSlice } from '../../../shared/types/intelligence.js';
import type { IntelligenceOptions } from '../../../shared/types/intelligence.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';
import {
  mcpInternalError,
  mcpNotFoundError,
  mcpValidationError,
  zodErrorToMcp,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-intelligence');

export const intelligenceTools: Tool[] = [
  {
    name: 'get_workspace_intelligence',
    description:
      'Get the full intelligence bundle for a workspace — the same context used by AdminChat. Includes SEO context, insights summary, content pipeline, site health, client signals, and keyword context. Use when you need the complete picture before making decisions about a workspace. Pass specific slices to reduce response size.',
    inputSchema: toMcpJsonSchema(getWorkspaceIntelligenceInputSchema),
  },
];

export async function handleIntelligenceTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (name !== 'get_workspace_intelligence') {
    return mcpNotFoundError('Unknown tool: the requested tool does not exist.', { resource_type: 'tool' });
  }

  const parsed = getWorkspaceIntelligenceInputSchema.safeParse(args);
  if (!parsed.success) {
    return zodErrorToMcp(parsed.error);
  }
  const {
    workspaceId,
    slices: sliceArgs,
    pagePath,
    siteId: siteIdArg,
    siteBaseUrl: siteBaseUrlArg,
    enrich_with_backlinks: enrichWithBacklinks,
    resolve_entity_references: resolveEntityReferences,
    include_site_inventory: includeSiteInventory,
  } = parsed.data;
  if (typeof workspaceId !== 'string') {
    return mcpValidationError('Invalid tool input at workspaceId: Expected a workspace ID.', {
      field_path: 'workspaceId',
      constraint: 'Expected a non-empty workspace ID.',
    });
  }

  let requestedSlices = Array.isArray(sliceArgs)
    ? sliceArgs.filter(isIntelligenceSlice)
    : [...INTELLIGENCE_SLICES];
  if (includeSiteInventory && !requestedSlices.includes('siteInventory')) {
    requestedSlices = [...requestedSlices, 'siteInventory'];
  }

  if (requestedSlices.length === 0) {
    return mcpValidationError('Invalid tool input at slices: Select at least one supported intelligence slice.', {
      field_path: 'slices',
      constraint: 'At least one supported intelligence slice is required.',
    });
  }

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });
    }

    const normalizeBaseUrl = (value: string | undefined): string | undefined => {
      if (!value) return undefined;
      if (value.startsWith('http://') || value.startsWith('https://')) return value;
      return `https://${value}`;
    };
    const siteId = siteIdArg ?? (includeSiteInventory ? ws.webflowSiteId : undefined);
    const siteBaseUrl = normalizeBaseUrl(siteBaseUrlArg ?? (includeSiteInventory ? ws.liveDomain : undefined));
    const webflowToken = includeSiteInventory ? ws.webflowToken : undefined;
    const opts: IntelligenceOptions = {
      slices: requestedSlices,
      pagePath,
      siteId,
      siteBaseUrl,
      webflowToken,
      enrichWithBacklinks,
      resolveEntityReferences,
    };
    const intel = await buildWorkspaceIntelligence(workspaceId, opts); // bwi-all-ok: MCP read model intentionally returns the full registered bundle when slices are omitted
    return { content: [{ type: 'text' as const, text: JSON.stringify(intel) }] };
  } catch (err) {
    log.error({ err, workspaceId, slices: requestedSlices }, 'Intelligence assembly failed');
    return mcpInternalError();
  }
}
