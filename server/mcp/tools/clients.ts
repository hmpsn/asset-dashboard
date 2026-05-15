import type { Tool } from '@modelcontextprotocol/sdk/types';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { listBatches } from '../../approvals.js';
import { listRequests } from '../../requests.js';
import { listClientActions, countPendingClientActions } from '../../client-actions.js';
import { getWorkspace, listWorkspaces } from '../../workspaces.js';
import type { IntelligenceSlice } from '../../../shared/types/intelligence.js';

const CLIENT_SIGNALS_SLICE: readonly IntelligenceSlice[] = ['clientSignals'];

export const clientTools: Tool[] = [
  {
    name: 'get_client_signals',
    description:
      'Get client portal engagement signals for a workspace: last login time, decision response rate, flagged concerns, and conversation activity. Use to gauge how a client is feeling about the engagement.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_pending_work',
    description:
      'Get all pending approvals, content requests, and client actions. Omit workspaceId to get a cross-workspace summary of everything that needs attention across all clients.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description:
            'Optional: filter to a specific workspace. Omit to see pending work across all workspaces.',
        },
      },
      required: [],
    },
  },
];

export async function handleClientTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    if (name === 'get_client_signals') {
      const workspaceId = args.workspaceId;
      if (typeof workspaceId !== 'string') {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Missing or invalid workspaceId' }],
        };
      }
      const ws = getWorkspace(workspaceId);
      if (!ws) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
        };
      }
      const intel = await buildWorkspaceIntelligence(workspaceId, { slices: CLIENT_SIGNALS_SLICE });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(intel.clientSignals ?? null) }],
      };
    }

    if (name === 'get_pending_work') {
      const workspaceId = args.workspaceId;

      if (typeof workspaceId === 'string') {
        // Single workspace mode
        const ws = getWorkspace(workspaceId);
        if (!ws) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
          };
        }
        const approvalBatches = listBatches(workspaceId);
        const requests = listRequests(workspaceId);
        const clientActions = listClientActions(workspaceId);

        const pendingApprovals = approvalBatches
          .flatMap(b => b.items)
          .filter(i => i.status === 'pending').length;
        const pendingRequests = requests.filter(r => r.status === 'new').length;
        const pendingActions = countPendingClientActions(workspaceId);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              workspaceId,
              pendingApprovals,
              pendingRequests,
              pendingActions,
              totalPending: pendingApprovals + pendingRequests + pendingActions,
              approvalBatches: approvalBatches.filter(b =>
                b.items.some(i => i.status === 'pending'),
              ),
              requests: requests.filter(r => r.status === 'new'),
              clientActions: clientActions.filter(a => a.status === 'pending'),
            }),
          }],
        };
      }

      // Cross-workspace mode (no workspaceId provided)
      const allWorkspaces = listWorkspaces();
      // listRequests with no arg returns all requests across workspaces
      const allRequests = listRequests();
      const pendingRequestsAll = allRequests.filter(r => r.status === 'new');

      const workspaces = allWorkspaces.map(ws => {
        const batches = listBatches(ws.id);
        const pendingApprovals = batches
          .flatMap(b => b.items)
          .filter(i => i.status === 'pending').length;
        const pendingActions = countPendingClientActions(ws.id);
        const pendingRequests = pendingRequestsAll.filter(r => r.workspaceId === ws.id).length;
        const total = pendingApprovals + pendingRequests + pendingActions;
        return { id: ws.id, name: ws.name, pendingApprovals, pendingRequests, pendingActions, total };
      }).filter(w => w.total > 0);

      const totalPending = workspaces.reduce((sum, w) => sum + w.total, 0);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ totalPending, workspaces }),
        }],
      };
    }

    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text' as const, text: `Tool error: ${message}` }] };
  }
}
