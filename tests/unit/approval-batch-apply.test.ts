import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { ApprovalBatch } from '../../shared/types/approvals.js';

const mockGetBatch = vi.fn();
const mockMarkBatchApplied = vi.fn();
const mockAddActivity = vi.fn();
const mockBroadcastToWorkspace = vi.fn();
const mockFindBySourceRef = vi.fn();
const mockClassifyApprovalBatch = vi.fn();
const mockMarkDeliverableApplied = vi.fn();
const mockNormalizePageUrl = vi.fn((value: string) => value.replace(/^\//, ''));
const mockWarn = vi.fn();
const mockCaptureBaselineFromGsc = vi.fn();
const mockGetActionBySource = vi.fn();
const mockRecordAction = vi.fn();
const mockResolveRecommendationsForChange = vi.fn();
const mockRecordSeoChange = vi.fn();
const mockPublishCollectionItems = vi.fn();
const mockUpdateCollectionItem = vi.fn();
const mockUpdatePageSeo = vi.fn();
const mockGetTokenForSite = vi.fn();
const mockGetWorkspace = vi.fn();
const mockUpdatePageState = vi.fn();
const mockIsClientApplyableFields = vi.fn();

vi.mock('../../server/approvals.js', () => ({
  getBatch: mockGetBatch,
  markBatchApplied: mockMarkBatchApplied,
}));

vi.mock('../../server/activity-log.js', () => ({
  addActivity: mockAddActivity,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: mockBroadcastToWorkspace,
}));

vi.mock('../../server/client-deliverables.js', () => ({
  findBySourceRef: mockFindBySourceRef,
}));

vi.mock('../../server/domains/inbox/deliverable-adapters/approval-batch-classifier.js', () => ({
  classifyApprovalBatch: mockClassifyApprovalBatch,
}));

vi.mock('../../server/domains/inbox/send-to-client.js', () => ({
  markDeliverableApplied: mockMarkDeliverableApplied,
}));

vi.mock('../../server/utils/page-address.js', () => ({
  normalizePageUrl: mockNormalizePageUrl,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: mockWarn,
  })),
}));

vi.mock('../../server/outcome-measurement.js', () => ({
  captureBaselineFromGsc: mockCaptureBaselineFromGsc,
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getActionBySource: mockGetActionBySource,
  recordAction: mockRecordAction,
}));

vi.mock('../../server/domains/recommendations/resolution-service.js', () => ({
  resolveRecommendationsForChange: mockResolveRecommendationsForChange,
}));

vi.mock('../../server/seo-change-tracker.js', () => ({
  recordSeoChange: mockRecordSeoChange,
}));

vi.mock('../../server/webflow.js', () => ({
  publishCollectionItems: mockPublishCollectionItems,
  updateCollectionItem: mockUpdateCollectionItem,
  updatePageSeo: mockUpdatePageSeo,
}));

vi.mock('../../server/workspaces.js', () => ({
  getTokenForSite: mockGetTokenForSite,
  getWorkspace: mockGetWorkspace,
  updatePageState: mockUpdatePageState,
}));

vi.mock('../../shared/applyability.js', () => ({
  isClientApplyableFields: mockIsClientApplyableFields,
}));

function makeBatch(overrides: Partial<ApprovalBatch> = {}): ApprovalBatch {
  return {
    id: 'batch_1',
    workspaceId: 'ws_1',
    siteId: 'site_1',
    name: 'Approval Batch',
    status: 'approved',
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    items: [
      {
        id: 'item_1',
        pageId: 'page_1',
        pageTitle: 'Services Page',
        pageSlug: '/services',
        publishedPath: '/services',
        field: 'seoTitle',
        currentValue: 'Old Title',
        proposedValue: 'New Title',
        status: 'approved',
        createdAt: '2026-06-10T00:00:00.000Z',
        updatedAt: '2026-06-10T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

async function loadModule() {
  return import('../../server/domains/inbox/approval-batch-apply.js');
}

describe('approval-batch-apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspace.mockReturnValue({ id: 'ws_1', webflowSiteId: 'site_1' });
    mockGetTokenForSite.mockReturnValue('webflow-token');
    mockIsClientApplyableFields.mockReturnValue(true);
    mockUpdatePageSeo.mockResolvedValue({ success: true });
    mockUpdateCollectionItem.mockResolvedValue({ success: true });
    mockPublishCollectionItems.mockResolvedValue({ success: true });
    mockClassifyApprovalBatch.mockReturnValue('seo_edit');
    mockGetActionBySource.mockReturnValue(null);
    mockRecordAction.mockReturnValue({ id: 'action_1' });
  });

  it('applies approved SEO items, records follow-up side effects, and flips the mirror on full success', async () => {
    const batch = makeBatch();
    mockGetBatch.mockReturnValue(batch);
    mockFindBySourceRef.mockReturnValue({ id: 'deliverable_1' });

    const { applyApprovedBatchItems } = await loadModule();
    const result = await applyApprovedBatchItems('ws_1', 'batch_1');

    expect(result).toEqual({
      ok: true,
      results: [{ itemId: 'item_1', pageId: 'page_1', success: true }],
      applied: 1,
      failed: 0,
    });
    expect(mockUpdatePageSeo).toHaveBeenCalledWith('page_1', { seo: { title: 'New Title' } }, 'webflow-token');
    expect(mockMarkBatchApplied).toHaveBeenCalledWith('ws_1', 'batch_1', ['item_1']);
    expect(mockUpdatePageState).toHaveBeenCalledWith('ws_1', 'page_1', { status: 'live', updatedBy: 'admin' });
    expect(mockRecordSeoChange).toHaveBeenCalledWith('ws_1', 'page_1', 'services', 'Services Page', ['title'], 'approval');
    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'approval_applied',
      'Applied 1 approved SEO changes',
      'Batch: Approval Batch',
      { batchId: 'batch_1', appliedCount: 1 },
    );
    expect(mockMarkDeliverableApplied).toHaveBeenCalledWith('ws_1', 'deliverable_1');
    expect(mockBroadcastToWorkspace).toHaveBeenNthCalledWith(1, 'ws_1', WS_EVENTS.APPROVAL_APPLIED, {
      batchId: 'batch_1',
      applied: 1,
    });
    expect(mockBroadcastToWorkspace).toHaveBeenNthCalledWith(2, 'ws_1', WS_EVENTS.PAGE_STATE_UPDATED, {
      pageIds: ['page_1'],
      source: 'approval',
    });
    expect(mockRecordAction).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      sourceType: 'approval',
      sourceId: 'item_1',
      pageUrl: 'services',
    }));
    expect(mockCaptureBaselineFromGsc).toHaveBeenCalledWith('action_1', 'ws_1', 'services');
    expect(mockResolveRecommendationsForChange).toHaveBeenCalledWith('ws_1', {
      affectedPages: ['/services'],
    });
  });

  it('preserves partial-success semantics and skips mirror flip when one item fails', async () => {
    const batch = makeBatch({
      items: [
        makeBatch().items[0],
        {
          id: 'item_2',
          pageId: 'page_2',
          pageTitle: 'About Page',
          pageSlug: '/about',
          publishedPath: '/about',
          field: 'seoDescription',
          currentValue: 'Old Description',
          proposedValue: 'New Description',
          status: 'approved',
          createdAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '2026-06-10T00:00:00.000Z',
        },
      ],
    });
    mockGetBatch.mockReturnValue(batch);
    mockUpdatePageSeo.mockImplementation(async (pageId: string) => (
      pageId === 'page_1'
        ? { success: true }
        : { success: false, error: 'Webflow API error on second item' }
    ));

    const { applyApprovedBatchItems } = await loadModule();
    const result = await applyApprovedBatchItems('ws_1', 'batch_1');

    expect(result).toEqual({
      ok: true,
      results: [
        { itemId: 'item_1', pageId: 'page_1', success: true },
        { itemId: 'item_2', pageId: 'page_2', success: false, error: 'Webflow API error on second item' },
      ],
      applied: 1,
      failed: 1,
    });
    expect(mockMarkBatchApplied).toHaveBeenCalledWith('ws_1', 'batch_1', ['item_1']);
    expect(mockMarkDeliverableApplied).not.toHaveBeenCalled();
    expect(mockUpdatePageState).toHaveBeenCalledTimes(1);
    expect(mockUpdatePageState).toHaveBeenCalledWith('ws_1', 'page_1', { status: 'live', updatedBy: 'admin' });
    expect(mockBroadcastToWorkspace).toHaveBeenNthCalledWith(2, 'ws_1', WS_EVENTS.PAGE_STATE_UPDATED, {
      pageIds: ['page_1'],
      source: 'approval',
    });
    expect(mockResolveRecommendationsForChange).toHaveBeenCalledWith('ws_1', {
      affectedPages: ['/services'],
    });
  });

  it('returns a guard error before Webflow writes when approved items are not client-applyable', async () => {
    mockGetBatch.mockReturnValue(makeBatch({
      items: [{ ...makeBatch().items[0], field: 'schemaJson' }],
    }));
    mockIsClientApplyableFields.mockReturnValue(false);

    const { applyApprovedBatchItems } = await loadModule();
    const result = await applyApprovedBatchItems('ws_1', 'batch_1');

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Only static page SEO title/meta approvals and real CMS item approvals can be applied by clients.',
    });
    expect(mockUpdatePageSeo).not.toHaveBeenCalled();
    expect(mockMarkBatchApplied).not.toHaveBeenCalled();
    expect(mockBroadcastToWorkspace).not.toHaveBeenCalled();
  });
});
