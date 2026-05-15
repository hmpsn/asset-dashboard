import type { Tool } from '@modelcontextprotocol/sdk/types';
import { getWorkspace, listWorkspaces } from '../../workspaces.js';
import { listBatches } from '../../approvals.js';
import { listRequests } from '../../requests.js';
import { countPendingClientActions } from '../../client-actions.js';

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

function pendingCounts(workspaceId: string) {
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
  const workspaceId = args.workspaceId as string;
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
    };
  }

  const counts = pendingCounts(workspaceId);

  const overview = {
    id: ws.id,
    name: ws.name,
    tier: ws.tier ?? 'free',
    liveDomain: ws.liveDomain ?? null,
    ...counts,
    totalPending: counts.pendingApprovals + counts.pendingRequests + counts.pendingActions,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(overview) }],
  };
}

export async function handleWorkspaceTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case 'list_workspaces':
        return handleListWorkspaces();
      case 'get_workspace_overview':
        return handleGetWorkspaceOverview(args);
      default:
        return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text', text: `Tool error: ${message}` }] };
  }
}
