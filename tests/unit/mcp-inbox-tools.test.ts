/**
 * Tests for the inbox decision MCP tools (MCP audit P0 — close the read-only inbox).
 *
 * These tools are thin wrappers over already-tested domain services
 * (updateAdminClientAction, respondToApprovalBatchItem — see
 * client-actions-mutations.test.ts / approval-batch-admin-mutations.test.ts), so
 * this suite verifies the WRAPPER contract: correct arg mapping, the workspace
 * guard, error/not-found handling, and — critically — the decline-only +
 * honest-actor policy for approval items (an agent can request changes but can
 * NEVER approve on the client's behalf, and the activity is attributed to the
 * agent, not "Client").
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

const h = vi.hoisted(() => ({
  updateAdminClientAction: vi.fn(),
  respondToApprovalBatchItem: vi.fn(),
  getWorkspace: vi.fn(),
}));
vi.mock('../../server/domains/inbox/client-actions-mutations.js', () => ({ updateAdminClientAction: h.updateAdminClientAction }));
vi.mock('../../server/domains/inbox/approval-batch-item-respond.js', () => ({ respondToApprovalBatchItem: h.respondToApprovalBatchItem }));
vi.mock('../../server/workspaces.js', () => ({ getWorkspace: h.getWorkspace, listWorkspaces: vi.fn(() => []) }));
// Heavy + unused by these branches — stub to keep the module light.
vi.mock('../../server/workspace-intelligence.js', () => ({ buildWorkspaceIntelligence: vi.fn() }));

import { handleClientTool } from '../../server/mcp/tools/clients.js';
import { WorkspaceMutationError } from '../../server/workspace-mutation-helper.js';

const WS = 'ws-1';
function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? 'null');
}

describe('inbox decision MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getWorkspace.mockImplementation((id: string) => (id === WS ? { id: WS, name: 'WS One' } : undefined));
  });

  describe('respond_to_client_action', () => {
    it('routes the status + note through to updateAdminClientAction and returns the updated action', async () => {
      h.updateAdminClientAction.mockReturnValue({ id: 'ca_1', status: 'completed' });
      const result = await handleClientTool('respond_to_client_action', {
        workspaceId: WS, actionId: 'ca_1', status: 'completed', clientNote: 'done',
      });
      expect(result.isError).toBeFalsy();
      expect(parse(result)).toMatchObject({ id: 'ca_1', status: 'completed' });
      expect(h.updateAdminClientAction).toHaveBeenCalledWith(WS, 'ca_1', { status: 'completed', clientNote: 'done' });
    });

    it('omits clientNote when not provided', async () => {
      h.updateAdminClientAction.mockReturnValue({ id: 'ca_1', status: 'archived' });
      await handleClientTool('respond_to_client_action', { workspaceId: WS, actionId: 'ca_1', status: 'archived' });
      expect(h.updateAdminClientAction).toHaveBeenCalledWith(WS, 'ca_1', { status: 'archived' });
    });

    it('errors on a missing workspace before calling the service', async () => {
      const result = await handleClientTool('respond_to_client_action', { workspaceId: 'nope', actionId: 'ca_1', status: 'completed' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Workspace not found');
      expect(h.updateAdminClientAction).not.toHaveBeenCalled();
    });

    it('surfaces a service error (e.g. invalid transition / not found)', async () => {
      h.updateAdminClientAction.mockImplementation(() => {
        throw new WorkspaceMutationError(404, 'Client action not found');
      });
      const result = await handleClientTool('respond_to_client_action', { workspaceId: WS, actionId: 'missing', status: 'completed' });
      expect(result.isError).toBe(true);
      expect(parse(result)).toMatchObject({
        code: 'not_found',
        details: { resource_type: 'client_action' },
      });
    });

    it('rejects an invalid status (not in the allowed enum)', async () => {
      const result = await handleClientTool('respond_to_client_action', { workspaceId: WS, actionId: 'ca_1', status: 'applied' });
      expect(result.isError).toBe(true);
      expect(parse(result)).toMatchObject({ code: 'validation_failed' });
      expect(h.updateAdminClientAction).not.toHaveBeenCalled();
    });
  });

  describe('respond_to_approval_item (decline-only)', () => {
    it("always declines ('rejected') and attributes the action to the agent, not the client", async () => {
      h.respondToApprovalBatchItem.mockReturnValue({ batch: { id: 'b1', items: [] } });
      const result = await handleClientTool('respond_to_approval_item', {
        workspaceId: WS, batchId: 'b1', itemId: 'i1', clientNote: 'tighten the copy',
      });
      expect(result.isError).toBeFalsy();
      expect(h.respondToApprovalBatchItem).toHaveBeenCalledWith({
        workspaceId: WS,
        batchId: 'b1',
        itemId: 'i1',
        update: { status: 'rejected', clientNote: 'tighten the copy' },
        actor: { name: 'MCP agent' },
      });
    });

    it('cannot be coerced into approving: an extra status arg is ignored, always rejects', async () => {
      h.respondToApprovalBatchItem.mockReturnValue({ batch: { id: 'b1', items: [] } });
      // Even if a caller smuggles status: 'approved', the schema strips it and the
      // handler hardcodes 'rejected' — there is no approve path via MCP.
      await handleClientTool('respond_to_approval_item', {
        workspaceId: WS, batchId: 'b1', itemId: 'i1', status: 'approved',
      });
      const call = h.respondToApprovalBatchItem.mock.calls[0]?.[0] as { update: { status: string } };
      expect(call.update.status).toBe('rejected');
    });

    it('returns not found when the batch/item does not exist', async () => {
      h.respondToApprovalBatchItem.mockReturnValue(null);
      const result = await handleClientTool('respond_to_approval_item', { workspaceId: WS, batchId: 'b1', itemId: 'gone' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not found');
    });

    it('errors on a missing workspace before calling the service', async () => {
      const result = await handleClientTool('respond_to_approval_item', { workspaceId: 'nope', batchId: 'b1', itemId: 'i1' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Workspace not found');
      expect(h.respondToApprovalBatchItem).not.toHaveBeenCalled();
    });

    it('rejects invalid args (missing itemId)', async () => {
      const result = await handleClientTool('respond_to_approval_item', { workspaceId: WS, batchId: 'b1' });
      expect(result.isError).toBe(true);
      expect(parse(result)).toMatchObject({ code: 'validation_failed' });
    });
  });
});
