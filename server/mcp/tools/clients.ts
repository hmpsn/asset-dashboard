import type { Tool } from '@modelcontextprotocol/sdk/types';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import { listBatches } from '../../approvals.js';
import { listRequests } from '../../requests.js';
import { listClientActions, countPendingClientActions } from '../../client-actions.js';
import { updateAdminClientAction } from '../../domains/inbox/client-actions-mutations.js';
import { respondToApprovalBatchItem } from '../../domains/inbox/approval-batch-item-respond.js';
import { getWorkspace, listWorkspaces } from '../../workspaces.js';
import { pendingCounts } from './workspaces.js';
import {
  respondToClientActionInputSchema,
  respondToApprovalItemInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import type { IntelligenceSlice } from '../../../shared/types/intelligence.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';

const log = createLogger('mcp-tools-clients');

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
  {
    name: 'respond_to_client_action',
    description:
      "Update a client action's status to close the loop on it (use the actionId from get_pending_work's clientActions). status: 'completed' (done), 'archived' (dismiss), 'approved', 'changes_requested', or 'pending' (reopen). Resolving (completed/approved) also updates the linked insight + outcome learning. Errors on an illegal status transition or unknown id.",
    inputSchema: toMcpJsonSchema(respondToClientActionInputSchema),
  },
  {
    name: 'respond_to_approval_item',
    description:
      "Decline / request changes on a single approval item (use batchId + itemId from get_pending_work's approvalBatches). Provide clientNote with the requested changes — the team is notified. NOTE: this is the ONLY approval action available via MCP: an agent CANNOT approve approval items on the client's behalf (approval is the client's own review decision), so this tool only ever rejects/requests-changes.",
    inputSchema: toMcpJsonSchema(respondToApprovalItemInputSchema),
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
        const { pendingApprovals, pendingRequests, pendingActions } = pendingCounts(workspaceId);

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

    if (name === 'respond_to_client_action') {
      const parsed = respondToClientActionInputSchema.safeParse(args);
      if (!parsed.success) {
        return { isError: true, content: [{ type: 'text' as const, text: `Validation failed: ${JSON.stringify(parsed.error.issues)}` }] };
      }
      const { workspaceId, actionId, status, clientNote } = parsed.data;
      const ws = getWorkspace(workspaceId);
      if (!ws) {
        return { isError: true, content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }] };
      }
      // Routes through the admin client-action service, which validates the status
      // transition and fires its own activity + broadcast + insight/outcome feedback.
      // It throws (404 not found / 409 invalid transition) — caught by the outer handler.
      const updated = updateAdminClientAction(workspaceId, actionId, {
        status,
        ...(clientNote !== undefined ? { clientNote } : {}),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(updated) }] };
    }

    if (name === 'respond_to_approval_item') {
      const parsed = respondToApprovalItemInputSchema.safeParse(args);
      if (!parsed.success) {
        return { isError: true, content: [{ type: 'text' as const, text: `Validation failed: ${JSON.stringify(parsed.error.issues)}` }] };
      }
      const { workspaceId, batchId, itemId, clientNote } = parsed.data;
      const ws = getWorkspace(workspaceId);
      if (!ws) {
        return { isError: true, content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }] };
      }
      // Decline-only: always 'rejected' (request changes). Agents cannot approve on the
      // client's behalf. actor is named honestly so the ACTIVITY LOG (the user-facing
      // "who decided" surface) attributes the decision to the agent, not the client.
      // (The internal page-edit-state provenance marker still records updatedBy:'client'
      // — its union has no 'agent' value — but that is a coarse internal marker, not the
      // user-facing attribution, so it is left as the existing model.) The service
      // validates the transition, syncs page state, notifies the team, and broadcasts
      // APPROVAL_UPDATE.
      const result = respondToApprovalBatchItem({
        workspaceId,
        batchId,
        itemId,
        update: { status: 'rejected', ...(clientNote !== undefined ? { clientNote } : {}) },
        actor: { name: 'MCP agent' },
      });
      if (!result) {
        return { isError: true, content: [{ type: 'text' as const, text: `Approval item not found: ${batchId}/${itemId}` }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.batch) }] };
    }

    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    log.error({ err, tool: name }, 'MCP tool error');
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text' as const, text: `Tool error: ${message}` }] };
  }
}
