import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  getBrandIdentityInputSchema,
  updateBrandDeliverableInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import { getWorkspace } from '../../workspaces.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { listDeliverables, getDeliverable } from '../../brand-deliverable-read-model.js';
import {
  BrandDeliverableVersionConflictError,
  updateDeliverableContent,
} from '../../brand-identity.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { BRAND_IDENTITY_UPDATED_PAYLOAD, WS_EVENTS } from '../../ws-events.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';

const log = createLogger('mcp-tools-brand');

type McpToolResponse = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(payload: unknown): McpToolResponse {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

function err(message: string): McpToolResponse {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

export const brandTools: Tool[] = [
  {
    name: 'get_brand_identity',
    description:
      "Get a workspace's structured brand identity (mission, vision, values, tagline, elevator pitch, positioning) and voice status. Set includeDeliverables to also return every brand deliverable with its draft/approved status and version for deeper inspection. Use before content work to ground brand positioning.",
    inputSchema: toMcpJsonSchema(getBrandIdentityInputSchema),
  },
  {
    name: 'update_brand_deliverable',
    description:
      "Update the content of an existing brand deliverable (e.g. mission, values, tagline, brand story). First call get_brand_identity with includeDeliverables:true to get the deliverable's id and current version. Pass expectedVersion (that current version) to guard against clobbering a concurrent edit — a mismatch is rejected as a conflict so you can re-fetch and retry. The deliverable is reset to 'draft' on edit; updates the existing row only (it does not create new deliverables).",
    inputSchema: toMcpJsonSchema(updateBrandDeliverableInputSchema),
  },
];

export async function handleBrandTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResponse> {
  if (name === 'get_brand_identity') return handleGetBrandIdentity(args);
  if (name === 'update_brand_deliverable') return handleUpdateBrandDeliverable(args);
  return err(`Unknown tool: ${name}`);
}

async function handleGetBrandIdentity(args: Record<string, unknown>): Promise<McpToolResponse> {
  const parsed = getBrandIdentityInputSchema.safeParse(args);
  if (!parsed.success) {
    return err(`Validation failed: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { workspaceId, includeDeliverables } = parsed.data;
  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) return err(`Workspace not found: ${workspaceId}`);

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
    return ok(payload);
  } catch (e) {
    log.error({ err: e, workspaceId }, 'MCP tool error');
    const message = e instanceof Error ? e.message : String(e);
    return err(`Tool error: ${message}`);
  }
}

async function handleUpdateBrandDeliverable(args: Record<string, unknown>): Promise<McpToolResponse> {
  const parsed = updateBrandDeliverableInputSchema.safeParse(args);
  if (!parsed.success) {
    return err(`Validation failed: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { workspaceId, deliverableId, content, expectedVersion } = parsed.data;
  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) return err(`Workspace not found: ${workspaceId}`);

    if (expectedVersion === undefined) {
      log.warn({
        tool: 'update_brand_deliverable',
        workspaceId,
        deliverableId,
        omittedField: 'expectedVersion',
        deprecation: 'legacy_missing_expected_version',
      }, 'Deprecated MCP brand-deliverable update omitted its concurrency guard');
    }

    const existing = getDeliverable(workspaceId, deliverableId);
    if (!existing) return err(`Brand deliverable not found: ${deliverableId}`);

    const updated = updateDeliverableContent(
      workspaceId,
      deliverableId,
      content,
      expectedVersion,
    );
    // The getDeliverable guard above already handled "never existed", so the only
    // way updateDeliverableContent returns null here is a delete that raced in
    // between that read and this write.
    if (!updated) return err(`Brand deliverable not found: ${deliverableId}`);

    // No-op write (content identical) leaves the version untouched — don't emit a
    // misleading "Edited" activity entry, broadcast, or cache bust for a non-change.
    const changed = updated.version !== existing.version;
    if (changed) {
      const typeLabel = updated.deliverableType.replace(/_/g, ' ');
      addActivity(
        workspaceId,
        'brand_deliverable_refined',
        `Edited ${typeLabel} deliverable via MCP`,
        undefined,
        { source: 'mcp-chat', deliverableId, action: 'mcp_brand_deliverable_updated' },
      );
      broadcastToWorkspace(
        workspaceId,
        WS_EVENTS.BRAND_IDENTITY_UPDATED,
        BRAND_IDENTITY_UPDATED_PAYLOAD,
      );
      invalidateIntelligenceCache(workspaceId);
    }

    return ok({
      id: updated.id,
      deliverableType: updated.deliverableType,
      content: updated.content,
      status: updated.status,
      version: updated.version,
      tier: updated.tier,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      changed,
    });
  } catch (e) {
    if (e instanceof BrandDeliverableVersionConflictError) {
      // This existing tool intentionally retains its legacy text contract.
      // New B2 MCP tools use JSON-v1 envelopes; changing this payload would
      // break compatibility for current update_brand_deliverable consumers.
      return err(
        `Version conflict. Current version: ${e.actualVersion}. Re-fetch via get_brand_identity (includeDeliverables:true) before retrying.`,
      );
    }
    log.error({ err: e, workspaceId }, 'MCP tool error');
    const message = e instanceof Error ? e.message : String(e);
    return err(`Tool error: ${message}`);
  }
}
