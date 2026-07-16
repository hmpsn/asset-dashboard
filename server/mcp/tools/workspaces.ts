import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import {
  createWorkspaceInputSchema,
  deleteWorkspaceInputSchema,
  updateWorkspaceInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import { addActivity } from '../../activity-log.js';
import { broadcast, broadcastToWorkspace } from '../../broadcast.js';
import {
  computeEffectiveTier,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  getClientPortalUrl,
  listWorkspaces,
  updateWorkspace,
} from '../../workspaces.js';
import { listBatches } from '../../approvals.js';
import { listRequests } from '../../requests.js';
import { countPendingClientActions } from '../../client-actions.js';
import { toAdminWorkspaceView } from '../../serializers/admin-workspace-view.js';
import { normalizeSocialProfiles } from '../../social-profiles.js';
import { normalizeRuntimeSeoDataProvider } from '../../seo-data-provider.js';
import { WS_EVENTS, ADMIN_EVENTS } from '../../ws-events.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';
import {
  buildDashboardUrl,
  mcpInternalError,
  mcpNotFoundError,
  mcpSuccess,
  mcpValidationError,
  requireWorkspace,
  zodErrorToMcp,
  type McpToolErrorResponse,
  type McpToolSuccessResponse,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-workspaces');

export const workspaceTools: Tool[] = [
  {
    name: 'list_workspaces',
    description:
      'List all client workspaces with health score, tier, trial status, and pending work counts. Use this to identify which clients need attention.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_workspace_overview',
    description:
      'Get a detailed snapshot of a single workspace: health score, tier, pending approval/request/action counts, and recent activity.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'create_workspace',
    description: 'Create a new workspace for onboarding and automation workflows.',
    inputSchema: toMcpJsonSchema(createWorkspaceInputSchema),
  },
  {
    name: 'update_workspace',
    description: 'Update a workspace using a moderate allowlist of safe operational fields.',
    inputSchema: toMcpJsonSchema(updateWorkspaceInputSchema),
  },
  {
    name: 'delete_workspace',
    description: 'Delete a workspace when confirm is set to "delete_workspace".',
    inputSchema: toMcpJsonSchema(deleteWorkspaceInputSchema),
  },
];

function pendingApprovalsCount(workspaceId: string): number {
  const batches = listBatches(workspaceId);
  return batches
    .flatMap(b => b.items)
    .filter(i => i.status === 'pending').length;
}

function pendingRequestsCount(workspaceId: string): number {
  // 'new' is the initial/open request status (equivalent to pending)
  return listRequests(workspaceId).filter(r => r.status === 'new').length;
}

export function pendingCounts(workspaceId: string) {
  const pendingApprovals = pendingApprovalsCount(workspaceId);
  const pendingRequests = pendingRequestsCount(workspaceId);
  const pendingActions = countPendingClientActions(workspaceId);
  return { pendingApprovals, pendingRequests, pendingActions };
}

async function handleListWorkspaces() {
  const rows = listWorkspaces();

  const workspaces = rows.map(ws => ({
    id: ws.id,
    name: ws.name,
    tier: ws.tier ?? 'free',
    liveDomain: ws.liveDomain ?? null,
    ...pendingCounts(ws.id),
  }));

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(workspaces) }],
  };
}

async function handleGetWorkspaceOverview(args: Record<string, unknown>) {
  const workspaceId = args.workspaceId;
  if (typeof workspaceId !== 'string') {
    return mcpValidationError('Invalid tool input at workspaceId: Expected a workspace ID.', {
      field_path: 'workspaceId',
      constraint: 'Expected a non-empty workspace ID.',
    });
  }
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });
  }

  const counts = pendingCounts(workspaceId);

  const overview = {
    id: ws.id,
    name: ws.name,
    tier: ws.tier ?? 'free',
    effective_tier: computeEffectiveTier(ws),
    client_portal_url: getClientPortalUrl(ws) ?? null,
    liveDomain: ws.liveDomain ?? null,
    ...counts,
    totalPending: counts.pendingApprovals + counts.pendingRequests + counts.pendingActions,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(overview) }],
  };
}

async function handleCreateWorkspace(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = createWorkspaceInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { name, webflow_site_id: webflowSiteId, webflow_site_name: webflowSiteName } = parsed.data;
  const ws = createWorkspace(name, webflowSiteId, webflowSiteName);
  const safe = toAdminWorkspaceView(ws);

  broadcast(ADMIN_EVENTS.WORKSPACE_CREATED, safe);
  broadcastToWorkspace(ws.id, WS_EVENTS.WORKSPACE_UPDATED, safe);
  addActivity(
    ws.id,
    'note',
    `MCP created workspace "${ws.name}"`,
    undefined,
    {
      source: 'mcp-chat',
      workspaceId: ws.id,
      action: 'mcp_workspace_created',
    },
  );

  return mcpSuccess({
    ok: true,
    workspace: safe,
    dashboard_url: buildDashboardUrl(ws.id),
  });
}

async function handleUpdateWorkspace(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = updateWorkspaceInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, updates } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const normalizedSocialProfiles = normalizeSocialProfiles(updates.business_profile?.socialProfiles);
  const businessProfile = updates.business_profile === undefined
    ? undefined
    : updates.business_profile === null
      ? null
      : {
        ...updates.business_profile,
        ...(normalizedSocialProfiles !== undefined ? { socialProfiles: normalizedSocialProfiles } : {}),
      };

  const mappedUpdates = {
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.webflow_site_id !== undefined ? { webflowSiteId: updates.webflow_site_id } : {}),
    ...(updates.webflow_site_name !== undefined ? { webflowSiteName: updates.webflow_site_name } : {}),
    ...(updates.live_domain !== undefined ? { liveDomain: updates.live_domain } : {}),
    ...(updates.gsc_property_url !== undefined ? { gscPropertyUrl: updates.gsc_property_url } : {}),
    ...(updates.ga4_property_id !== undefined ? { ga4PropertyId: updates.ga4_property_id } : {}),
    ...(updates.client_email !== undefined ? { clientEmail: updates.client_email } : {}),
    ...(updates.tier !== undefined ? { tier: updates.tier } : {}),
    ...(updates.trial_ends_at !== undefined ? { trialEndsAt: updates.trial_ends_at } : {}),
    ...(updates.client_portal_enabled !== undefined ? { clientPortalEnabled: updates.client_portal_enabled } : {}),
    ...(updates.seo_client_view !== undefined ? { seoClientView: updates.seo_client_view } : {}),
    ...(updates.analytics_client_view !== undefined ? { analyticsClientView: updates.analytics_client_view } : {}),
    ...(updates.site_intelligence_client_view !== undefined ? { siteIntelligenceClientView: updates.site_intelligence_client_view } : {}),
    ...(updates.onboarding_enabled !== undefined ? { onboardingEnabled: updates.onboarding_enabled } : {}),
    ...(updates.onboarding_completed !== undefined ? { onboardingCompleted: updates.onboarding_completed } : {}),
    ...(updates.publish_target !== undefined ? { publishTarget: updates.publish_target } : {}),
    ...(updates.seo_data_provider !== undefined ? { seoDataProvider: normalizeRuntimeSeoDataProvider(updates.seo_data_provider) } : {}),
    ...(updates.business_profile !== undefined ? { businessProfile } : {}),
    ...(updates.intelligence_profile !== undefined ? { intelligenceProfile: updates.intelligence_profile } : {}),
  };

  const next = updateWorkspace(workspaceId, mappedUpdates);
  if (!next) return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });

  const safe = toAdminWorkspaceView(next);
  invalidateIntelligenceCache(workspaceId);
  broadcast(WS_EVENTS.WORKSPACE_UPDATED, safe);
  broadcastToWorkspace(workspaceId, WS_EVENTS.WORKSPACE_UPDATED, safe);
  addActivity(
    workspaceId,
    'note',
    `MCP updated workspace "${next.name}"`,
    undefined,
    {
      source: 'mcp-chat',
      workspaceId,
      action: 'mcp_workspace_updated',
      updatedFields: Object.keys(updates),
    },
  );

  return mcpSuccess({
    ok: true,
    workspace: safe,
    dashboard_url: buildDashboardUrl(workspaceId),
  });
}

async function handleDeleteWorkspace(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = deleteWorkspaceInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  addActivity(
    workspaceId,
    'note',
    `MCP deleted workspace "${workspace.name}"`,
    undefined,
    {
      source: 'mcp-chat',
      workspaceId,
      action: 'mcp_workspace_deleted',
    },
  );
  const deleted = deleteWorkspace(workspaceId);
  if (!deleted) return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });
  broadcast(ADMIN_EVENTS.WORKSPACE_DELETED, { id: workspaceId });

  return mcpSuccess({
    ok: true,
    workspace_id: workspaceId,
    deleted: true,
    dashboard_url: buildDashboardUrl(workspaceId),
  });
}

export async function handleWorkspaceTool(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    switch (name) {
      case 'list_workspaces':
        return await handleListWorkspaces();
      case 'get_workspace_overview':
        return await handleGetWorkspaceOverview(args);
      case 'create_workspace':
        return await handleCreateWorkspace(args);
      case 'update_workspace':
        return await handleUpdateWorkspace(args);
      case 'delete_workspace':
        return await handleDeleteWorkspace(args);
      default:
        return mcpNotFoundError('Unknown tool: the requested tool does not exist.', { resource_type: 'tool' });
    }
  } catch (err) {
    log.error({ err, tool: name }, 'MCP tool error');
    return mcpInternalError();
  }
}
