import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';

const mockDeleteBatch = vi.fn();
const mockAddActivity = vi.fn();
const mockBroadcastToWorkspace = vi.fn();
const mockCancelSchemaPlanDeliverable = vi.fn();
const mockMirrorSchemaPlanToDeliverable = vi.fn();
const mockSyncSchemaPlanDeliverable = vi.fn();
const mockNotifyApprovalReady = vi.fn();
const mockWarn = vi.fn();
const mockDeleteSchemaPlan = vi.fn();
const mockDeleteSchemaSnapshot = vi.fn();
const mockGetSchemaPlan = vi.fn();
const mockUpdateSchemaPlanRoles = vi.fn();
const mockUpdateSchemaPlanStatus = vi.fn();
const mockBroadcastSchemaPlanUpdated = vi.fn();
const mockGetActiveSchemaPlanGenerationJobId = vi.fn();
const mockInvalidateIntelligenceCache = vi.fn();
const mockGetClientPortalUrl = vi.fn();
const mockGetWorkspace = vi.fn();

vi.mock('../../server/approvals.js', () => ({
  deleteBatch: mockDeleteBatch,
}));

vi.mock('../../server/activity-log.js', () => ({
  addActivity: mockAddActivity,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: mockBroadcastToWorkspace,
}));

vi.mock('../../server/domains/inbox/schema-plan-dual-write.js', () => ({
  cancelSchemaPlanDeliverable: mockCancelSchemaPlanDeliverable,
  mirrorSchemaPlanToDeliverable: mockMirrorSchemaPlanToDeliverable,
  syncSchemaPlanDeliverable: mockSyncSchemaPlanDeliverable,
}));

vi.mock('../../server/email.js', () => ({
  notifyApprovalReady: mockNotifyApprovalReady,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: mockWarn,
  })),
}));

vi.mock('../../server/schema-store.js', () => ({
  deleteSchemaPlan: mockDeleteSchemaPlan,
  deleteSchemaSnapshot: mockDeleteSchemaSnapshot,
  getSchemaPlan: mockGetSchemaPlan,
  updateSchemaPlanRoles: mockUpdateSchemaPlanRoles,
  updateSchemaPlanStatus: mockUpdateSchemaPlanStatus,
}));

vi.mock('../../server/schema-plan-generation-job.js', () => ({
  broadcastSchemaPlanUpdated: mockBroadcastSchemaPlanUpdated,
  getActiveSchemaPlanGenerationJobId: mockGetActiveSchemaPlanGenerationJobId,
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  invalidateIntelligenceCache: mockInvalidateIntelligenceCache,
}));

vi.mock('../../server/workspaces.js', () => ({
  getClientPortalUrl: mockGetClientPortalUrl,
  getWorkspace: mockGetWorkspace,
}));

function makePlan(overrides: Partial<SchemaSitePlan> = {}): SchemaSitePlan {
  return {
    id: 'plan_1',
    siteId: 'site_1',
    workspaceId: 'ws_1',
    siteUrl: 'https://example.test',
    canonicalEntities: [],
    pageRoles: [
      {
        pagePath: '/',
        pageTitle: 'Home',
        role: 'homepage',
        primaryType: 'Organization',
        entityRefs: [],
      },
    ],
    status: 'draft',
    generatedAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

async function loadModule() {
  return import('../../server/domains/schema/schema-plan-admin-mutations.js');
}

describe('schema-plan-admin-mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveSchemaPlanGenerationJobId.mockReturnValue(null);
    mockGetWorkspace.mockReturnValue({
      id: 'ws_1',
      name: 'Schema Workspace',
      clientEmail: 'client@example.test',
    });
    mockGetClientPortalUrl.mockReturnValue('https://client.example.test/schema');
  });

  it('updates schema plan roles, invalidates intelligence, syncs deliverables, and broadcasts', async () => {
    const existing = makePlan({ status: 'sent_to_client' });
    const updated = makePlan({
      status: 'sent_to_client',
      pageRoles: [{ ...existing.pageRoles[0], pageTitle: 'Updated Home' }],
    });
    mockGetSchemaPlan.mockReturnValue(existing);
    mockUpdateSchemaPlanRoles.mockReturnValue(updated);

    const { updateSchemaPlanForAdmin } = await loadModule();
    const result = updateSchemaPlanForAdmin('site_1', updated.pageRoles, []);

    expect(result).toEqual({ ok: true, value: updated });
    expect(mockInvalidateIntelligenceCache).toHaveBeenCalledWith('ws_1');
    expect(mockSyncSchemaPlanDeliverable).toHaveBeenCalledWith(updated);
    expect(mockBroadcastSchemaPlanUpdated).toHaveBeenCalledWith('ws_1', {
      siteId: 'site_1',
      action: 'updated',
      status: 'sent_to_client',
    });
  });

  it('sends a schema plan to the client with deliverable, email, activity, and broadcasts', async () => {
    const plan = makePlan({ status: 'draft' });
    const sent = makePlan({ status: 'sent_to_client' });
    mockGetSchemaPlan.mockReturnValue(plan);
    mockUpdateSchemaPlanStatus.mockReturnValue(sent);
    mockMirrorSchemaPlanToDeliverable.mockReturnValue({ id: 'deliverable_1', type: 'schema_plan' });

    const { sendSchemaPlanToClientForReview } = await loadModule();
    const result = sendSchemaPlanToClientForReview('site_1');

    expect(result).toEqual({ ok: true, value: { plan: sent } });
    expect(mockMirrorSchemaPlanToDeliverable).toHaveBeenCalledWith('ws_1', sent);
    expect(mockBroadcastToWorkspace).toHaveBeenNthCalledWith(1, 'ws_1', WS_EVENTS.DELIVERABLE_SENT, {
      deliverableId: 'deliverable_1',
      type: 'schema_plan',
    });
    expect(mockNotifyApprovalReady).toHaveBeenCalledWith({
      clientEmail: 'client@example.test',
      workspaceName: 'Schema Workspace',
      workspaceId: 'ws_1',
      batchName: 'Schema Strategy Review',
      itemCount: 1,
      dashboardUrl: 'https://client.example.test/schema',
    });
    expect(mockBroadcastSchemaPlanUpdated).toHaveBeenCalledWith('ws_1', {
      siteId: 'site_1',
      action: 'sent_to_client',
      status: 'sent_to_client',
    });
    expect(mockBroadcastToWorkspace).toHaveBeenNthCalledWith(2, 'ws_1', WS_EVENTS.SCHEMA_PLAN_SENT, {
      siteId: 'site_1',
    });
    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'schema_plan_sent',
      'Schema strategy sent to client for review',
      '1 pages',
    );
    expect(mockInvalidateIntelligenceCache).toHaveBeenCalledWith('ws_1');
  });

  it('rejects sendSchemaPlanToClientForReview when plan is already sent_to_client (state precondition)', async () => {
    mockGetSchemaPlan.mockReturnValue(makePlan({ status: 'sent_to_client' }));

    const { sendSchemaPlanToClientForReview } = await loadModule();
    const result = sendSchemaPlanToClientForReview('site_1');

    expect(result).toMatchObject({
      ok: false,
      status: 422,
      error: expect.stringContaining("sent_to_client"),
    });
    expect(mockUpdateSchemaPlanStatus).not.toHaveBeenCalled();
    expect(mockMirrorSchemaPlanToDeliverable).not.toHaveBeenCalled();
  });

  it('rejects sendSchemaPlanToClientForReview when plan is already active (state precondition)', async () => {
    mockGetSchemaPlan.mockReturnValue(makePlan({ status: 'active' }));

    const { sendSchemaPlanToClientForReview } = await loadModule();
    const result = sendSchemaPlanToClientForReview('site_1');

    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(mockUpdateSchemaPlanStatus).not.toHaveBeenCalled();
  });

  it('allows sendSchemaPlanToClientForReview from client_changes_requested (resend after revision)', async () => {
    const plan = makePlan({ status: 'client_changes_requested' });
    const sent = makePlan({ status: 'sent_to_client' });
    mockGetSchemaPlan.mockReturnValue(plan);
    mockUpdateSchemaPlanStatus.mockReturnValue(sent);
    mockMirrorSchemaPlanToDeliverable.mockReturnValue({ id: 'deliverable_2', type: 'schema_plan' });

    const { sendSchemaPlanToClientForReview } = await loadModule();
    const result = sendSchemaPlanToClientForReview('site_1');

    expect(result).toEqual({ ok: true, value: { plan: sent } });
    expect(mockUpdateSchemaPlanStatus).toHaveBeenCalledWith('site_1', 'sent_to_client');
  });

  it('returns a conflict when admin schema-plan activation races an active generation job', async () => {
    mockGetSchemaPlan.mockReturnValue(makePlan({ status: 'sent_to_client' }));
    mockGetActiveSchemaPlanGenerationJobId.mockReturnValue('job_123');

    const { activateSchemaPlanForAdmin } = await loadModule();
    const result = activateSchemaPlanForAdmin('site_1');

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Schema plan generation is in progress. Wait for it to finish before editing this plan.',
      jobId: 'job_123',
    });
    expect(mockUpdateSchemaPlanStatus).not.toHaveBeenCalled();
  });

  it('deletes a schema plan, removes the snapshot, and avoids duplicate invalidation when preview batch cleanup already did it', async () => {
    mockGetSchemaPlan.mockReturnValue(makePlan({
      status: 'sent_to_client',
      clientPreviewBatchId: 'batch_preview_1',
    }));
    mockDeleteSchemaSnapshot.mockReturnValue(true);
    mockDeleteBatch.mockReturnValue(true);

    const { deleteSchemaPlanForAdmin } = await loadModule();
    const result = deleteSchemaPlanForAdmin('site_1');

    expect(result).toEqual({ ok: true, value: { success: true } });
    expect(mockDeleteSchemaPlan).toHaveBeenCalledWith('site_1');
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED, {
      siteId: 'site_1',
      action: 'deleted',
    });
    expect(mockDeleteBatch).toHaveBeenCalledWith('ws_1', 'batch_preview_1');
    expect(mockInvalidateIntelligenceCache).not.toHaveBeenCalled();
    expect(mockCancelSchemaPlanDeliverable).toHaveBeenCalledWith('ws_1', 'site_1');
    expect(mockBroadcastSchemaPlanUpdated).toHaveBeenCalledWith('ws_1', {
      siteId: 'site_1',
      action: 'deleted',
      status: undefined,
    });
  });
});
