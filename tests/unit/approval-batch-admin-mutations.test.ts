import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { ApprovalBatch } from '../../shared/types/approvals.js';

const mockAddActivity = vi.fn();
const mockCreateBatch = vi.fn();
const mockDeleteBatch = vi.fn();
const mockGetBatch = vi.fn();
const mockBroadcastToWorkspace = vi.fn();
const mockMirrorApprovalBatchToDeliverable = vi.fn();
const mockNotifyApprovalReady = vi.fn();
const mockGetPageState = vi.fn();
const mockClearPageState = vi.fn();
const mockGetClientPortalUrl = vi.fn();
const mockGetWorkspace = vi.fn();
const mockUpdatePageState = vi.fn();

vi.mock('../../server/activity-log.js', () => ({
  addActivity: mockAddActivity,
}));

vi.mock('../../server/approvals.js', () => ({
  createBatch: mockCreateBatch,
  deleteBatch: mockDeleteBatch,
  getBatch: mockGetBatch,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: mockBroadcastToWorkspace,
}));

vi.mock('../../server/domains/inbox/approval-batch-dual-write.js', () => ({
  mirrorApprovalBatchToDeliverable: mockMirrorApprovalBatchToDeliverable,
}));

vi.mock('../../server/email.js', () => ({
  notifyApprovalReady: mockNotifyApprovalReady,
}));

vi.mock('../../server/page-edit-states.js', () => ({
  getPageState: mockGetPageState,
}));

vi.mock('../../server/workspaces.js', () => ({
  clearPageState: mockClearPageState,
  getClientPortalUrl: mockGetClientPortalUrl,
  getWorkspace: mockGetWorkspace,
  updatePageState: mockUpdatePageState,
}));

function makeBatch(overrides: Partial<ApprovalBatch> = {}): ApprovalBatch {
  return {
    id: 'ab_1',
    workspaceId: 'ws_1',
    siteId: 'site_1',
    name: 'SEO Changes',
    status: 'pending',
    note: 'Please review',
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    items: [
      {
        id: 'item_1',
        pageId: 'page_1',
        pageTitle: 'Services',
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
  return import('../../server/domains/inbox/approval-batch-admin-mutations.js');
}

describe('approval-batch-admin-mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspace.mockReturnValue({
      id: 'ws_1',
      name: 'Workspace One',
      clientEmail: 'client@example.com',
    });
    mockGetClientPortalUrl.mockReturnValue('https://client.example/ws_1');
  });

  it('createApprovalBatchForClient mirrors, tracks page state, notifies, logs, and broadcasts', async () => {
    const batch = makeBatch();
    mockCreateBatch.mockReturnValue(batch);

    const { createApprovalBatchForClient } = await loadModule();
    const result = createApprovalBatchForClient({
      workspaceId: 'ws_1',
      siteId: 'site_1',
      name: 'SEO Changes',
      note: 'Please review',
      items: [
        {
          pageId: 'page_1',
          pageTitle: 'Services',
          pageSlug: '/services',
          field: 'seoTitle',
          currentValue: 'Services',
          proposedValue: 'Growth Services',
        },
      ],
    });

    expect(result).toBe(batch);
    expect(mockCreateBatch).toHaveBeenCalledWith(
      'ws_1',
      'site_1',
      'SEO Changes',
      [
        {
          pageId: 'page_1',
          pageTitle: 'Services',
          pageSlug: '/services',
          field: 'seoTitle',
          currentValue: 'Services',
          proposedValue: 'Growth Services',
        },
      ],
      'Please review',
    );
    expect(mockMirrorApprovalBatchToDeliverable).toHaveBeenCalledWith('ws_1', batch, {
      note: 'Please review',
      source: 'approvals-send',
    });
    expect(mockUpdatePageState).toHaveBeenCalledWith('ws_1', 'page_1', {
      status: 'in-review',
      fields: ['seoTitle'],
      approvalBatchId: 'ab_1',
      updatedBy: 'admin',
    });
    expect(mockNotifyApprovalReady).toHaveBeenCalledWith({
      clientEmail: 'client@example.com',
      workspaceName: 'Workspace One',
      workspaceId: 'ws_1',
      batchName: 'SEO Changes',
      itemCount: 1,
      dashboardUrl: 'https://client.example/ws_1',
    });
    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'approval_sent',
      'Sent "SEO Changes" to client for review',
      '1 item awaiting client review',
      {
        batchId: 'ab_1',
        itemCount: 1,
        pageIds: ['page_1'],
      },
    );
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.APPROVAL_UPDATE, {
      batchId: 'ab_1',
      action: 'created',
    });
  });

  it('createApprovalBatchForClient skips client email when the workspace has no clientEmail', async () => {
    mockCreateBatch.mockReturnValue(makeBatch({ id: 'ab_2' }));
    mockGetWorkspace.mockReturnValue({ id: 'ws_1', name: 'Workspace One', clientEmail: '' });

    const { createApprovalBatchForClient } = await loadModule();
    createApprovalBatchForClient({
      workspaceId: 'ws_1',
      siteId: 'site_1',
      name: 'No Email Batch',
      items: [
        {
          pageId: 'page_1',
          pageTitle: 'Services',
          pageSlug: '/services',
          field: 'seoTitle',
          currentValue: 'Services',
          proposedValue: 'Growth Services',
        },
      ],
    });

    expect(mockNotifyApprovalReady).not.toHaveBeenCalled();
    expect(mockBroadcastToWorkspace).toHaveBeenCalledTimes(1);
  });

  it('deleteApprovalBatchForClient clears only matching tracked page states, then logs and broadcasts', async () => {
    const batch = makeBatch({
      items: [
        makeBatch().items[0],
        {
          id: 'item_2',
          pageId: 'page_2',
          pageTitle: 'Pricing',
          pageSlug: '/pricing',
          field: 'seoDescription',
          currentValue: 'Pricing description',
          proposedValue: 'Updated pricing description',
          status: 'pending',
          createdAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '2026-06-10T00:00:00.000Z',
        },
      ],
    });
    mockGetBatch.mockReturnValue(batch);
    mockDeleteBatch.mockReturnValue(true);
    mockGetPageState.mockImplementation((_workspaceId: string, pageId: string) => {
      if (pageId === 'page_1') {
        return { status: 'approved', approvalBatchId: 'ab_1' };
      }
      if (pageId === 'page_2') {
        return { status: 'in-review', approvalBatchId: 'ab_other' };
      }
      return undefined;
    });

    const { deleteApprovalBatchForClient } = await loadModule();
    const result = deleteApprovalBatchForClient('ws_1', 'ab_1');

    expect(result).toBe(batch);
    expect(mockClearPageState).toHaveBeenCalledTimes(1);
    expect(mockClearPageState).toHaveBeenCalledWith('ws_1', 'page_1');
    expect(mockDeleteBatch).toHaveBeenCalledWith('ws_1', 'ab_1');
    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'approval_deleted',
      'Deleted approval batch "SEO Changes"',
      '2 items removed from client review',
      {
        batchId: 'ab_1',
        itemCount: 2,
        pageIds: ['page_1', 'page_2'],
      },
    );
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.APPROVAL_UPDATE, {
      batchId: 'ab_1',
      action: 'deleted',
    });
  });

  it('deleteApprovalBatchForClient returns null for a missing batch without side effects', async () => {
    mockGetBatch.mockReturnValue(null);

    const { deleteApprovalBatchForClient } = await loadModule();
    const result = deleteApprovalBatchForClient('ws_1', 'ab_missing');

    expect(result).toBeNull();
    expect(mockDeleteBatch).not.toHaveBeenCalled();
    expect(mockClearPageState).not.toHaveBeenCalled();
    expect(mockAddActivity).not.toHaveBeenCalled();
    expect(mockBroadcastToWorkspace).not.toHaveBeenCalled();
  });

  it('deleteApprovalBatchForClient suppresses delete-side effects when storage deletion fails', async () => {
    const batch = makeBatch();
    mockGetBatch.mockReturnValue(batch);
    mockDeleteBatch.mockReturnValue(false);
    mockGetPageState.mockReturnValue({ status: 'rejected', approvalBatchId: 'ab_1' });

    const { deleteApprovalBatchForClient } = await loadModule();
    const result = deleteApprovalBatchForClient('ws_1', 'ab_1');

    expect(result).toBeNull();
    expect(mockClearPageState).not.toHaveBeenCalled();
    expect(mockAddActivity).not.toHaveBeenCalled();
    expect(mockBroadcastToWorkspace).not.toHaveBeenCalled();
  });
});
