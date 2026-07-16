import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  createBrandDeliverableInputSchema,
  getBrandIdentityInputSchema,
  updateBrandDeliverableInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import { MCP_TOOL_ERROR_CODES } from '../../../shared/types/mcp-runtime.js';
import { getWorkspace } from '../../workspaces.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { listDeliverables, getDeliverable } from '../../brand-deliverable-read-model.js';
import {
  BrandDeliverableAlreadyExistsError,
  BrandDeliverableVersionConflictError,
  createOperatorAuthoredDeliverable,
  updateDeliverableContent,
} from '../../brand-identity.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { BRAND_IDENTITY_UPDATED_PAYLOAD, WS_EVENTS } from '../../ws-events.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { mcpJsonV1Error } from '../tool-errors.js';
import {
  mcpConflictError,
  mcpInternalError,
  mcpNotFoundError,
  mcpSuccess,
  zodErrorToMcp,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-brand');

type McpToolResponse = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(payload: unknown): McpToolResponse {
  return mcpSuccess(payload);
}

export const brandTools: Tool[] = [
  {
    name: 'get_brand_identity',
    description:
      "Get a workspace's structured brand identity (mission, vision, values, tagline, elevator pitch, positioning) and voice status. Set includeDeliverables to also return every brand deliverable with its draft/approved status and version for deeper inspection. Use before content work to ground brand positioning.",
    inputSchema: toMcpJsonSchema(getBrandIdentityInputSchema),
  },
  {
    name: 'create_brand_deliverable',
    description:
      'Create one operator-authored brand deliverable without AI generation. Use this for finalized positioning or messaging supplied by the studio/client. The new deliverable is always saved as draft and still requires explicit human approval before page generation can use it; this tool cannot approve, finalize voice, send, or publish. If the workspace already has that deliverable type, use update_brand_deliverable instead.',
    inputSchema: toMcpJsonSchema(createBrandDeliverableInputSchema),
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
  if (name === 'create_brand_deliverable') return handleCreateBrandDeliverable(args);
  if (name === 'update_brand_deliverable') return handleUpdateBrandDeliverable(args);
  return mcpNotFoundError('Unknown tool: the requested tool does not exist.', { resource_type: 'tool' });
}

async function handleGetBrandIdentity(args: Record<string, unknown>): Promise<McpToolResponse> {
  const parsed = getBrandIdentityInputSchema.safeParse(args);
  if (!parsed.success) {
    return zodErrorToMcp(parsed.error);
  }

  const { workspaceId, includeDeliverables } = parsed.data;
  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });

    const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['brand'] });
    const brand = intel.brand;
    const deliverables = listDeliverables(workspaceId);
    const approved = deliverables.filter(item => item.status === 'approved').length;
    const pending = deliverables.length - approved;
    const identity = brand?.identity ?? {};
    const hasIdentity = Object.keys(identity).length > 0;
    const payload: Record<string, unknown> = {
      availability: !hasIdentity && pending > 0
        ? 'pending_approval'
        : brand?.availability ?? 'no_data',
      identity,
      voice_status: brand?.voice.status ?? 'none',
      identity_prompt_block: brand?.identityPromptBlock ?? '',
      deliverable_counts: {
        approved,
        pending,
        total: deliverables.length,
      },
    };
    if (includeDeliverables) {
      payload.deliverables = deliverables.map(d => ({
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
    return mcpInternalError();
  }
}

async function handleCreateBrandDeliverable(args: Record<string, unknown>): Promise<McpToolResponse> {
  const parsed = createBrandDeliverableInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const {
    workspace_id: workspaceId,
    deliverable_type: deliverableType,
    content,
  } = parsed.data;
  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });

    const created = createOperatorAuthoredDeliverable(
      workspaceId,
      deliverableType,
      content,
    );
    const typeLabel = created.deliverableType.replace(/_/g, ' ');
    addActivity(
      workspaceId,
      'brand_deliverable_generated',
      `Created operator-authored ${typeLabel} deliverable via MCP`,
      undefined,
      {
        source: 'mcp-chat',
        deliverableId: created.id,
        action: 'mcp_brand_deliverable_created',
      },
    );
    broadcastToWorkspace(
      workspaceId,
      WS_EVENTS.BRAND_IDENTITY_UPDATED,
      BRAND_IDENTITY_UPDATED_PAYLOAD,
    );
    invalidateIntelligenceCache(workspaceId);

    return ok({
      id: created.id,
      deliverable_type: created.deliverableType,
      content: created.content,
      status: created.status,
      version: created.version,
      tier: created.tier,
      created_at: created.createdAt,
      updated_at: created.updatedAt,
      created: true,
      approval_required: true,
    });
  } catch (error) {
    if (error instanceof BrandDeliverableAlreadyExistsError) {
      return mcpJsonV1Error({
        code: MCP_TOOL_ERROR_CODES.CONFLICT,
        message: 'That brand deliverable type already exists. Read it with get_brand_identity and use update_brand_deliverable instead.',
        retryable: false,
        details: {
          deliverable_id: error.existing.id,
          deliverable_type: error.existing.deliverableType,
          current_version: error.existing.version,
          current_status: error.existing.status,
        },
      }) as McpToolResponse;
    }
    log.error({ err: error, workspaceId }, 'MCP tool error');
    return mcpInternalError();
  }
}

async function handleUpdateBrandDeliverable(args: Record<string, unknown>): Promise<McpToolResponse> {
  const parsed = updateBrandDeliverableInputSchema.safeParse(args);
  if (!parsed.success) {
    return zodErrorToMcp(parsed.error);
  }

  const { workspaceId, deliverableId, content, expectedVersion } = parsed.data;
  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });

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
    if (!existing) return mcpNotFoundError('Brand deliverable not found.', {
      resource_type: 'brand_deliverable',
    });

    const updated = updateDeliverableContent(
      workspaceId,
      deliverableId,
      content,
      expectedVersion,
    );
    // The getDeliverable guard above already handled "never existed", so the only
    // way updateDeliverableContent returns null here is a delete that raced in
    // between that read and this write.
    if (!updated) return mcpNotFoundError('Brand deliverable not found.', {
      resource_type: 'brand_deliverable',
    });

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
      return mcpConflictError(
        'The brand deliverable changed. Re-fetch get_brand_identity with includeDeliverables:true before retrying.',
        { current_version: e.actualVersion },
      );
    }
    log.error({ err: e, workspaceId }, 'MCP tool error');
    return mcpInternalError();
  }
}
