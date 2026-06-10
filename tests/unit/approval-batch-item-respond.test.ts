import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { ApprovalBatch } from '../../shared/types/approvals.js';

const mockAddActivity = vi.fn();
const mockGetBatch = vi.fn();
const mockUpdateItem = vi.fn();
const mockBroadcastToWorkspace = vi.fn();
const mockNotifyTeamActionApproved = vi.fn();
const mockNotifyTeamChangesRequested = vi.fn();
const mockGetPageState = vi.fn();
const mockGetWorkspace = vi.fn();
const mockUpdatePageState = vi.fn();
const mockWarn = vi.fn();
const mockInfo = vi.fn();

vi.mock('../../server/activity-log.js', () => ({
  addActivity: mockAddActivity,
}));

vi.mock('../../server/approvals.js', () => ({
  getBatch: mockGetBatch,
  updateItem: mockUpdateItem,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: mockBroadcastToWorkspace,
}));

vi.mock('../../server/email.js', () => ({
  notifyTeamActionApproved: mockNotifyTeamActionApproved,
  notifyTeamChangesRequested: mockNotifyTeamChangesRequested,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: mockWarn,
    info: mockInfo,
  })),
}));

vi.mock('../../server/page-edit-states.js', () => ({
  getPageState: mockGetPageState,
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mockGetWorkspace,
  updatePageState: mockUpdatePageState,
}));

function makeBatch(overrides: Partial<ApprovalBatch> = {}): ApprovalBatch {
  return {
    id: 'ab_1',
    workspaceId: 'ws_1',
    siteId: 'site_1',
    name: 'Approval Batch',
    status: 'pending',
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    items: [
      {
        id: 'item_1',
        pageId: 'page_1',
        pageTitle: 'Services Page',
        pageSlug: '/services',
        field: 'seoTitle',
        currentValue: 'Services',
        proposedValue: 'Growth Services',
        status: 'pending',
        createdAt: '2026-06-10T00:00:00.000Z',
        updatedAt: '2026-06-10T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

async function loadModule() {
  return import('../../server/domains/inbox/approval-batch-item-respond.js');
}

describe('approval-batch-item-respond', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspace.mockReturnValue({ id: 'ws_1', name: 'Workspace One' });
    mockUpdatePageState.mockReturnValue({ status: 'approved' });
  });

  it('respondToApprovalBatchItem approves an item, syncs page state, logs, notifies, and broadcasts', async () => {
    const beforeBatch = makeBatch();
    const approvedBatch = makeBatch({
      status: 'approved',
      items: [{ ...beforeBatch.items[0], status: 'approved' }],
    });
    mockGetBatch.mockReturnValue(beforeBatch);
    mockUpdateItem.mockReturnValue(approvedBatch);

    const { respondToApprovalBatchItem } = await loadModule();
    const result = respondToApprovalBatchItem({
      workspaceId: 'ws_1',
      batchId: 'ab_1',
      itemId: 'item_1',
      update: { status: 'approved' },
      actor: { id: 'client_1', name: 'Ava Client' },
    });

    expect(result).toEqual({ batch: approvedBatch });
    expect(mockUpdateItem).toHaveBeenCalledWith('ws_1', 'ab_1', 'item_1', { status: 'approved' });
    expect(mockUpdatePageState).toHaveBeenCalledWith('ws_1', 'page_1', {
      status: 'approved',
      updatedBy: 'client',
    });
    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'approval_applied',
      'Ava Client approved SEO title changes for Services Page',
      'New value: Growth Services',
      { batchId: 'ab_1', itemId: 'item_1', pageId: 'page_1' },
      { id: 'client_1', name: 'Ava Client' },
    );
    expect(mockNotifyTeamActionApproved).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      workspaceName: 'Workspace One',
      actionTitle: 'SEO change approved: SEO title',
      sourceType: 'seo_approval',
      actionSummary: 'Services Page',
      clientNote: undefined,
    });
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.APPROVAL_UPDATE, {
      batchId: 'ab_1',
      itemId: 'item_1',
      status: 'approved',
    });
  });

  it('refreshes rejection notes without duplicating rejection activity', async () => {
    const beforeBatch = makeBatch({
      status: 'rejected',
      items: [{ ...makeBatch().items[0], status: 'rejected', clientNote: 'Old note' }],
    });
    const updatedBatch = makeBatch({
      status: 'rejected',
      items: [{ ...beforeBatch.items[0], clientNote: 'New note' }],
    });
    mockGetBatch.mockReturnValue(beforeBatch);
    mockUpdateItem.mockReturnValue(updatedBatch);
    mockUpdatePageState.mockReturnValue({ status: 'rejected' });

    const { respondToApprovalBatchItem } = await loadModule();
    const result = respondToApprovalBatchItem({
      workspaceId: 'ws_1',
      batchId: 'ab_1',
      itemId: 'item_1',
      update: { status: 'rejected', clientNote: 'New note' },
      actor: { name: 'Ava Client' },
    });

    expect(result).toEqual({ batch: updatedBatch });
    expect(mockUpdatePageState).toHaveBeenCalledWith('ws_1', 'page_1', {
      status: 'rejected',
      updatedBy: 'client',
      rejectionNote: 'New note',
    });
    expect(mockAddActivity).not.toHaveBeenCalled();
    expect(mockNotifyTeamChangesRequested).not.toHaveBeenCalled();
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.APPROVAL_UPDATE, {
      batchId: 'ab_1',
      itemId: 'item_1',
      status: 'rejected',
    });
  });

  it('reverts an approved item back to pending and resets page state before restoring in-review', async () => {
    const beforeBatch = makeBatch({
      status: 'approved',
      items: [{ ...makeBatch().items[0], status: 'approved' }],
    });
    const revertedBatch = makeBatch({
      status: 'pending',
      items: [{ ...beforeBatch.items[0], status: 'pending' }],
    });
    mockGetBatch.mockReturnValue(beforeBatch);
    mockUpdateItem.mockReturnValue(revertedBatch);
    mockGetPageState.mockReturnValue({ status: 'approved', approvalBatchId: 'ab_1' });

    const { respondToApprovalBatchItem } = await loadModule();
    const result = respondToApprovalBatchItem({
      workspaceId: 'ws_1',
      batchId: 'ab_1',
      itemId: 'item_1',
      update: { status: 'pending' },
      actor: { name: 'Ava Client' },
    });

    expect(result).toEqual({ batch: revertedBatch });
    expect(mockUpdatePageState).toHaveBeenNthCalledWith(1, 'ws_1', 'page_1', {
      status: 'clean',
      updatedBy: 'client',
      rejectionNote: '',
    });
    expect(mockUpdatePageState).toHaveBeenNthCalledWith(2, 'ws_1', 'page_1', {
      status: 'in-review',
      updatedBy: 'client',
      rejectionNote: '',
    });
    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'approval_reverted',
      'Ava Client reverted SEO title decision for Services Page',
      undefined,
      { batchId: 'ab_1', itemId: 'item_1', pageId: 'page_1' },
      { name: 'Ava Client' },
    );
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.APPROVAL_UPDATE, {
      batchId: 'ab_1',
      itemId: 'item_1',
      status: 'pending',
    });
  });

  it('returns null when the item update misses the batch or item', async () => {
    mockGetBatch.mockReturnValue(makeBatch());
    mockUpdateItem.mockReturnValue(null);

    const { respondToApprovalBatchItem } = await loadModule();
    const result = respondToApprovalBatchItem({
      workspaceId: 'ws_1',
      batchId: 'ab_1',
      itemId: 'item_missing',
      update: { status: 'approved' },
    });

    expect(result).toBeNull();
    expect(mockUpdatePageState).not.toHaveBeenCalled();
    expect(mockAddActivity).not.toHaveBeenCalled();
    expect(mockBroadcastToWorkspace).not.toHaveBeenCalled();
  });
});
