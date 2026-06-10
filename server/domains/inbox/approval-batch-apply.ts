import { getBatch, markBatchApplied } from '../../approvals.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { findBySourceRef } from '../../client-deliverables.js';
import { classifyApprovalBatch } from './deliverable-adapters/approval-batch-classifier.js';
import { markDeliverableApplied } from './send-to-client.js';
import { normalizePageUrl } from '../../helpers.js';
import { createLogger } from '../../logger.js';
import { captureBaselineFromGsc } from '../../outcome-measurement.js';
import { getActionBySource, recordAction } from '../../outcome-tracking.js';
import { resolveRecommendationsForChange } from '../../recommendations.js';
import { recordSeoChange } from '../../seo-change-tracker.js';
import {
  publishCollectionItems,
  updateCollectionItem,
  updatePageSeo,
} from '../../webflow.js';
import {
  getTokenForSite,
  getWorkspace,
  updatePageState,
} from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import { isClientApplyableFields } from '../../../shared/applyability.js';

const log = createLogger('approval-batch-apply');

export interface ApprovalBatchApplyItemResult {
  itemId: string;
  pageId: string;
  success: boolean;
  error?: string;
}

export type ApplyApprovedBatchItemsResult =
  | { ok: false; status: 404 | 400; error: string }
  | {
    ok: true;
    results: ApprovalBatchApplyItemResult[];
    applied: number;
    failed: number;
  };

function normalizeSeoChangeField(field: string): string {
  if (field === 'seoTitle') return 'title';
  if (field === 'seoDescription') return 'description';
  const normalized = field.trim().toLowerCase();
  if (normalized.includes('title')) return 'title';
  if (normalized.includes('description') || normalized.includes('desc')) return 'description';
  return normalized || field;
}

export async function applyApprovedBatchItems(
  workspaceId: string,
  batchId: string,
): Promise<ApplyApprovedBatchItemsResult> {
  const batch = getBatch(workspaceId, batchId);
  if (!batch) return { ok: false, status: 404, error: 'Batch not found' };

  const ws = getWorkspace(workspaceId);
  if (!ws?.webflowSiteId) return { ok: false, status: 400, error: 'No site linked' };

  const token = getTokenForSite(ws.webflowSiteId) || undefined;
  if (!token) return { ok: false, status: 400, error: 'No Webflow API token' };

  const approved = batch.items.filter(item => item.status === 'approved');
  if (approved.length === 0) return { ok: false, status: 400, error: 'No approved items to apply' };

  if (approved.some(item => !isClientApplyableFields({
    field: item.field,
    targetRef: item.pageId,
    collectionId: item.collectionId ?? null,
  }))) {
    return {
      ok: false,
      status: 400,
      error: 'Only static page SEO title/meta approvals and real CMS item approvals can be applied by clients.',
    };
  }

  const results: ApprovalBatchApplyItemResult[] = [];
  const appliedIds: string[] = [];

  for (const item of approved) {
    try {
      // Synthetic CMS IDs come from sitemap discovery and are not writable via Webflow's API.
      if (item.pageId.startsWith('cms-')) {
        throw new Error('CMS pages discovered via sitemap must be updated directly in Webflow — synthetic page ID cannot be written via the API');
      }

      const value = item.clientValue || item.proposedValue;
      if (item.collectionId) {
        const cmsResult = await updateCollectionItem(item.collectionId, item.pageId, { [item.field]: value }, token);
        if (cmsResult.success === false) throw new Error(cmsResult.error || 'CMS item update failed');

        const publishResult = await publishCollectionItems(item.collectionId, [item.pageId], token);
        if (publishResult.success === false) {
          log.warn(
            {
              batchId,
              collectionId: item.collectionId,
              itemId: item.pageId,
              field: item.field,
            },
            'CMS approval apply updated draft but publish failed',
          );
          throw new Error(publishResult.error || 'CMS item publish failed');
        }
      } else {
        const fields = item.field === 'seoTitle'
          ? { seo: { title: value } }
          : { seo: { description: value } };
        const seoResult = await updatePageSeo(item.pageId, fields, token);
        if (!seoResult.success) throw new Error(seoResult.error || 'SEO update failed');
      }

      appliedIds.push(item.id);
      results.push({ itemId: item.id, pageId: item.pageId, success: true });
    } catch (err) {
      results.push({
        itemId: item.id,
        pageId: item.pageId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (appliedIds.length > 0) {
    markBatchApplied(workspaceId, batchId, appliedIds);

    for (const result of results) {
      if (!result.success) continue;
      updatePageState(workspaceId, result.pageId, { status: 'live', updatedBy: 'admin' });
      const appliedItem = approved.find(item => item.id === result.itemId);
      if (!appliedItem) continue;
      const fieldName = normalizeSeoChangeField(appliedItem.field);
      const rawAppliedPagePath = appliedItem.publishedPath || appliedItem.pageSlug || '';
      const pagePath = rawAppliedPagePath ? normalizePageUrl(rawAppliedPagePath) : '';
      recordSeoChange(workspaceId, result.pageId, pagePath, appliedItem.pageTitle || '', [fieldName], 'approval');
    }

    const batchData = getBatch(workspaceId, batchId);
    addActivity(
      workspaceId,
      'approval_applied',
      `Applied ${appliedIds.length} approved SEO changes`,
      batchData ? `Batch: ${batchData.name}` : undefined,
      { batchId, appliedCount: appliedIds.length },
    );
  }

  const failed = results.length - appliedIds.length;
  if (failed === 0 && appliedIds.length === approved.length) {
    try {
      const type = classifyApprovalBatch(batch);
      const mirror = findBySourceRef(workspaceId, type, `${type}:${batchId}`);
      if (mirror) markDeliverableApplied(workspaceId, mirror.id);
    } catch (err) {
      log.warn({ err, batchId }, 'unified mirror apply-sync failed (swallowed; webflow already applied)');
    }
  }

  broadcastToWorkspace(workspaceId, WS_EVENTS.APPROVAL_APPLIED, {
    batchId,
    applied: appliedIds.length,
  });

  if (appliedIds.length > 0) {
    broadcastToWorkspace(workspaceId, WS_EVENTS.PAGE_STATE_UPDATED, {
      pageIds: results.filter(result => result.success).map(result => result.pageId),
      source: 'approval',
    });
  }

  try {
    for (const item of approved.filter(approvedItem => appliedIds.includes(approvedItem.id))) {
      const fieldName = normalizeSeoChangeField(item.field);
      if (fieldName !== 'title' && fieldName !== 'description') continue;
      if (getActionBySource('approval', item.id)) continue;

      const rawPagePath = item.publishedPath || item.pageSlug || '';
      const pagePath = rawPagePath ? normalizePageUrl(rawPagePath) : null;
      const action = recordAction({ // recordAction-ok — workspaceId is from route param, always valid
        workspaceId,
        actionType: 'meta_updated',
        sourceType: 'approval',
        sourceId: item.id,
        pageUrl: pagePath,
        targetKeyword: null,
        baselineSnapshot: {
          captured_at: new Date().toISOString(),
        },
        attribution: 'platform_executed',
      });
      if (pagePath) void captureBaselineFromGsc(action.id, workspaceId, pagePath);
    }
  } catch (err) {
    log.warn({ err, batchId }, 'Failed to record outcome action for approval apply');
  }

  if (appliedIds.length > 0) {
    const appliedPages = approved
      .filter(item => appliedIds.includes(item.id))
      .map(item => item.publishedPath || item.pageSlug || '')
      .filter(Boolean);
    if (appliedPages.length > 0) {
      try {
        resolveRecommendationsForChange(workspaceId, { affectedPages: appliedPages });
      } catch (err) {
        log.warn({ err, batchId }, 'Failed to resolve recommendations after approval apply');
      }
    }
  }

  return {
    ok: true,
    results,
    applied: appliedIds.length,
    failed,
  };
}
