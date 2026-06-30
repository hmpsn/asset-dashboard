import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidTransitionError } from '../../server/state-machines.js';
import { WorkspaceMutationError } from '../../server/workspace-mutation-helper.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { ClientAction } from '../../shared/types/client-actions.js';

const mockAddActivity = vi.fn();
const mockCreateClientAction = vi.fn();
const mockGetActiveClientActionBySource = vi.fn();
const mockGetClientAction = vi.fn();
const mockUpdateClientAction = vi.fn();
const mockNotifyApprovalReady = vi.fn();
const mockNotifyTeamActionApproved = vi.fn();
const mockEnqueuePlaybook = vi.fn();
const mockGetClientPortalUrl = vi.fn();
const mockGetWorkspace = vi.fn();
const mockBroadcastToWorkspace = vi.fn();
const mockInvalidateIntelligenceCache = vi.fn();
const mockApplyFeedbackLoop = vi.fn();

vi.mock('../../server/activity-log.js', () => ({
  addActivity: mockAddActivity,
}));

vi.mock('../../server/client-actions.js', () => ({
  createClientAction: mockCreateClientAction,
  getActiveClientActionBySource: mockGetActiveClientActionBySource,
  getClientAction: mockGetClientAction,
  updateClientAction: mockUpdateClientAction,
}));

vi.mock('../../server/email.js', () => ({
  notifyApprovalReady: mockNotifyApprovalReady,
  notifyTeamActionApproved: mockNotifyTeamActionApproved,
}));

vi.mock('../../server/playbooks.js', () => ({
  enqueuePlaybook: mockEnqueuePlaybook,
}));

vi.mock('../../server/workspaces.js', () => ({
  getClientPortalUrl: mockGetClientPortalUrl,
  getWorkspace: mockGetWorkspace,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: mockBroadcastToWorkspace,
}));

vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: mockInvalidateIntelligenceCache,
}));

vi.mock('../../server/domains/inbox/client-action-feedback-loop.js', () => ({
  applyClientActionFeedbackLoop: mockApplyFeedbackLoop,
}));

function makeAction(overrides: Partial<ClientAction> = {}): ClientAction {
  return {
    id: 'ca_1',
    workspaceId: 'ws_1',
    sourceType: 'internal_link',
    sourceId: 'src_1',
    title: 'Add links',
    summary: 'Add two links',
    payload: {},
    status: 'pending',
    priority: 'medium',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

async function loadModule() {
  return import('../../server/domains/inbox/client-actions-mutations.js');
}

describe('client-actions-mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspace.mockReturnValue({ id: 'ws_1', name: 'Workspace One', clientEmail: 'client@example.com' });
    mockGetClientPortalUrl.mockReturnValue('https://client.example/ws_1');
  });

  it('createAdminClientAction returns existing active action and suppresses side effects for duplicates', async () => {
    const existing = makeAction({ id: 'ca_existing' });
    mockGetActiveClientActionBySource.mockReturnValue(existing);

    const { createAdminClientAction } = await loadModule();
    const action = createAdminClientAction('ws_1', {
      sourceType: 'internal_link',
      sourceId: 'src_1',
      title: 'Duplicate title',
      summary: 'Duplicate summary',
    });

    expect(action).toBe(existing);
    expect(mockCreateClientAction).not.toHaveBeenCalled();
    expect(mockAddActivity).not.toHaveBeenCalled();
    expect(mockNotifyApprovalReady).not.toHaveBeenCalled();
    expect(mockBroadcastToWorkspace).not.toHaveBeenCalled();
    expect(mockInvalidateIntelligenceCache).not.toHaveBeenCalled();
  });

  it('createAdminClientAction creates and broadcasts new action, including approval email', async () => {
    const created = makeAction({ id: 'ca_created', title: 'New action', summary: 'Do thing' });
    mockGetActiveClientActionBySource.mockReturnValue(null);
    mockCreateClientAction.mockReturnValue(created);

    const { createAdminClientAction } = await loadModule();
    const action = createAdminClientAction('ws_1', {
      sourceType: 'internal_link',
      sourceId: 'src_2',
      title: 'New action',
      summary: 'Do thing',
      priority: 'high',
    });

    expect(action).toBe(created);
    expect(mockCreateClientAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      sourceType: 'internal_link',
      sourceId: 'src_2',
      title: 'New action',
      summary: 'Do thing',
      priority: 'high',
    });
    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'client_action_sent',
      'Sent to client: New action',
      'Do thing',
      { actionId: 'ca_created', sourceType: 'internal_link' },
    );
    expect(mockNotifyApprovalReady).toHaveBeenCalledWith({
      clientEmail: 'client@example.com',
      workspaceName: 'Workspace One',
      workspaceId: 'ws_1',
      batchName: 'New action',
      itemCount: 1,
      dashboardUrl: 'https://client.example/ws_1',
    });
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.CLIENT_ACTION_UPDATE, {
      actionId: 'ca_created',
      action: 'created',
    });
    expect(mockInvalidateIntelligenceCache).toHaveBeenCalledWith('ws_1');
  });

  it('createAdminClientAction skips approval email when workspace has no client email', async () => {
    const created = makeAction({ id: 'ca_created_2' });
    mockGetActiveClientActionBySource.mockReturnValue(null);
    mockCreateClientAction.mockReturnValue(created);
    mockGetWorkspace.mockReturnValue({ id: 'ws_1', name: 'Workspace One', clientEmail: '' });

    const { createAdminClientAction } = await loadModule();
    createAdminClientAction('ws_1', {
      sourceType: 'internal_link',
      sourceId: 'src_3',
      title: 'No email action',
      summary: 'No email summary',
    });

    expect(mockNotifyApprovalReady).not.toHaveBeenCalled();
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.CLIENT_ACTION_UPDATE, {
      actionId: 'ca_created_2',
      action: 'created',
    });
  });

  it('updateAdminClientAction maps invalid state transitions to a 409 mutation error', async () => {
    mockGetClientAction.mockReturnValue(makeAction({ status: 'approved' }));
    mockUpdateClientAction.mockImplementation(() => {
      throw new InvalidTransitionError('client action', 'approved', 'pending');
    });

    const { updateAdminClientAction } = await loadModule();

    let caught: unknown;
    try {
      updateAdminClientAction('ws_1', 'ca_1', { status: 'pending' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkspaceMutationError);
    expect((caught as WorkspaceMutationError).status).toBe(409);
    expect((caught as WorkspaceMutationError).message).toContain("Invalid client action transition");
    expect(mockApplyFeedbackLoop).not.toHaveBeenCalled();
    expect(mockBroadcastToWorkspace).not.toHaveBeenCalled();
  });

  it('updateAdminClientAction triggers completed feedback loop and completion activity only on actual transition', async () => {
    mockGetClientAction.mockReturnValue(makeAction({ status: 'approved' }));
    const completed = makeAction({ status: 'completed', title: 'Finalize fix', summary: 'Fix shipped' });
    mockUpdateClientAction.mockReturnValue(completed);

    const { updateAdminClientAction } = await loadModule();
    const action = updateAdminClientAction('ws_1', 'ca_1', { status: 'completed' });

    expect(action).toBe(completed);
    expect(mockApplyFeedbackLoop).toHaveBeenCalledWith('ws_1', completed, 'completed');
    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'client_action_completed',
      'Completed client action: Finalize fix',
      'Fix shipped',
      { actionId: 'ca_1', sourceType: 'internal_link' },
    );
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.CLIENT_ACTION_UPDATE, {
      actionId: 'ca_1',
      action: 'updated',
    });
  });

  it('updateAdminClientAction does not trigger feedback loop when status is unchanged', async () => {
    mockGetClientAction.mockReturnValue(makeAction({ status: 'approved' }));
    const unchanged = makeAction({ status: 'approved' });
    mockUpdateClientAction.mockReturnValue(unchanged);

    const { updateAdminClientAction } = await loadModule();
    updateAdminClientAction('ws_1', 'ca_1', { title: 'Retitle only' });

    expect(mockApplyFeedbackLoop).not.toHaveBeenCalled();
    expect(mockAddActivity).not.toHaveBeenCalledWith(
      expect.anything(),
      'client_action_completed',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('respondToPublicClientAction rejects non-pending actions with conflict', async () => {
    mockGetClientAction.mockReturnValue(makeAction({ status: 'completed' }));

    const { respondToPublicClientAction } = await loadModule();

    expect(() =>
      respondToPublicClientAction('ws_1', 'ca_1', { status: 'approved' }, { name: 'Client User' }),
    ).toThrow('This action is no longer awaiting client response');

    expect(mockUpdateClientAction).not.toHaveBeenCalled();
    expect(mockApplyFeedbackLoop).not.toHaveBeenCalled();
  });

  it('respondToPublicClientAction approved path triggers feedback loop, team notify, playbook, and responded broadcast', async () => {
    mockGetClientAction.mockReturnValue(makeAction({ status: 'pending', title: 'Fix title' }));
    const approved = makeAction({ status: 'approved', title: 'Fix title' });
    mockUpdateClientAction.mockReturnValue(approved);

    const { respondToPublicClientAction } = await loadModule();
    const action = respondToPublicClientAction(
      'ws_1',
      'ca_1',
      { status: 'approved', clientNote: 'Looks good' },
      { id: 'user_1', name: 'Ava Client' },
    );

    expect(action).toBe(approved);
    expect(mockUpdateClientAction).toHaveBeenCalledWith('ws_1', 'ca_1', {
      status: 'approved',
      clientNote: 'Looks good',
    });
    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'client_action_approved',
      'Ava Client approved Fix title',
      'Looks good',
      { actionId: 'ca_1', sourceType: 'internal_link' },
      { id: 'user_1', name: 'Ava Client' },
    );
    expect(mockApplyFeedbackLoop).toHaveBeenCalledWith('ws_1', approved, 'approved');
    expect(mockNotifyTeamActionApproved).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      workspaceName: 'Workspace One',
      actionTitle: 'Fix title',
      sourceType: 'internal_link',
      actionSummary: approved.summary,
      clientNote: 'Looks good',
      dashboardUrl: 'https://client.example/ws_1',
    });
    expect(mockEnqueuePlaybook).toHaveBeenCalledWith('ws_1', approved);
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.CLIENT_ACTION_UPDATE, {
      actionId: 'ca_1',
      action: 'responded',
    });
  });

  it('respondToPublicClientAction changes_requested path does not trigger feedback loop or team notify', async () => {
    mockGetClientAction.mockReturnValue(makeAction({ status: 'pending', title: 'Fix title' }));
    const requestedChanges = makeAction({ status: 'changes_requested', title: 'Fix title' });
    mockUpdateClientAction.mockReturnValue(requestedChanges);

    const { respondToPublicClientAction } = await loadModule();
    respondToPublicClientAction('ws_1', 'ca_1', { status: 'changes_requested', clientNote: 'Need edits' }, undefined);

    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'client_action_changes_requested',
      'Client requested changes on Fix title',
      'Need edits',
      { actionId: 'ca_1', sourceType: 'internal_link' },
      undefined,
    );
    expect(mockApplyFeedbackLoop).not.toHaveBeenCalled();
    expect(mockNotifyTeamActionApproved).not.toHaveBeenCalled();
    expect(mockEnqueuePlaybook).not.toHaveBeenCalled();
  });
});
