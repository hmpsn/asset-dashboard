import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { updateJob, unregisterAbort, isJobCancelled } from './jobs.js';
import { createLogger } from './logger.js';
import { recordSeoChange } from './seo-change-tracker.js';
import { updatePageSeo } from './webflow.js';
import { getWorkspace, updatePageState } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import { normalizePageUrl } from './utils/page-address.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { resolveRecommendationsForChange } from './domains/recommendations/resolution-service.js';
import { getActionByWorkspaceAndSource, recordAction } from './outcome-tracking.js';
import type { SeoBulkAcceptFix } from './schemas/seo-bulk-jobs.js';

const log = createLogger('webflow-seo-bulk-accept-fixes-job');

/**
 * Reconcile R8-PR1 (Task B13) — attribution seam for the bulk audit-fix apply path.
 * Records a `meta_updated` tracked action AT THE MOMENT the Webflow SEO field write
 * succeeds for one fix — never before (a failed `updatePageSeo` call must record
 * nothing). sourceId is `${pageId}-${check}`, matching the `appliedKey` this job already
 * uses to identify one applied fix, so re-running bulk-accept on the same (page, check)
 * pair is idempotent via getActionByWorkspaceAndSource. Mirrors the other meta_updated
 * producer, server/domains/inbox/approval-batch-apply.ts (sourceType 'approval'), using
 * sourceType 'audit' to keep the two producers' dedup spaces distinct. Guarded so a
 * tracking failure can never abort the job — mirrors recordSchemaOutcomeAction in
 * server/domains/schema/publish-schema-to-live.ts.
 */
function recordBulkAcceptFixOutcomeAction(
  workspaceId: string,
  fix: SeoBulkAcceptFix,
  changedField: string,
  pagePath: string,
): void {
  const sourceId = `${fix.pageId}-${fix.check}`;
  try {
    if (getActionByWorkspaceAndSource(workspaceId, 'audit', sourceId)) return;
    recordAction({ // recordAction-ok: only reached after updatePageSeo succeeds, workspaceId is from a resolved workspace
      workspaceId,
      actionType: 'meta_updated',
      sourceType: 'audit',
      sourceId,
      pageUrl: pagePath || null,
      targetKeyword: null,
      baselineSnapshot: {
        captured_at: new Date().toISOString(),
      },
      attribution: 'platform_executed',
      // R6 (B11): a bulk audit fix is a PAGE-ref (sourceId is the fix key, not a titled
      // producer) — no `source` snapshot in scope, mirroring the schema-deploy seam.
      // The generic per-action-type label is the honest display (FM-2).
      context: {
        notes: `Bulk audit fix applied: ${changedField} on ${fix.pageName || fix.pageId}`,
      },
    });
  } catch (err) {
    log.warn({ err, workspaceId, pageId: fix.pageId, check: fix.check }, 'Failed to record outcome action for bulk audit fix');
  }
}

interface RunSeoBulkAcceptFixesJobOptions {
  jobId: string;
  workspaceId: string;
  fixes: SeoBulkAcceptFix[];
  token: string;
  signal: AbortSignal;
}

export async function runSeoBulkAcceptFixesJob({
  jobId,
  workspaceId,
  fixes,
  token,
  signal,
}: RunSeoBulkAcceptFixesJobOptions): Promise<void> {
  try {
    updateJob(jobId, { status: 'running', message: 'Applying fixes to Webflow...' });

    const ws = getWorkspace(workspaceId);
    let done = 0;
    let failed = 0;
    const applied: string[] = [];
    // Slugs of pages whose audit fixes actually applied — used to resolve the
    // matching audit recommendations in-place after the loop. These fixes carry
    // their slug in hand (publishedPath/pageSlug); this job never writes the
    // page_edit_states slug, so we must NOT round-trip through getPageState here.
    const appliedSlugs = new Set<string>();

    for (const fix of fixes) {
      if (isJobCancelled(jobId) || signal.aborted) break;

      try {
        const fields: Record<string, unknown> = {};
        if (fix.check === 'title') {
          fields.seo = { title: fix.suggestedFix };
        } else if (fix.check === 'meta-description') {
          fields.seo = { description: fix.suggestedFix };
        } else if (fix.check === 'og-tags' && fix.message?.includes('title')) {
          fields.openGraph = { title: fix.suggestedFix };
        } else if (fix.check === 'og-tags' && fix.message?.includes('description')) {
          fields.openGraph = { description: fix.suggestedFix };
        }

        if (Object.keys(fields).length > 0) {
          const seoResult = await updatePageSeo(fix.pageId, fields, token);
          if (!seoResult.success) {
            log.warn({ pageId: fix.pageId, check: fix.check, error: seoResult.error }, 'bulk-accept-fixes: Webflow update failed');
            failed++;
          } else {
            const appliedKey = `${fix.pageId}-${fix.check}`;
            applied.push(appliedKey);

            if (ws) {
              const changedField = fix.check === 'meta-description' ? 'description' : fix.check;
              updatePageState(ws.id, fix.pageId, {
                status: 'live',
                source: 'audit',
                fields: [changedField],
                updatedBy: 'admin',
              });
              const pagePath = fix.publishedPath
                ? normalizePageUrl(fix.publishedPath)
                : fix.pageSlug ? normalizePageUrl(fix.pageSlug) : '';
              if (pagePath) appliedSlugs.add(pagePath);
              recordSeoChange(ws.id, fix.pageId, pagePath, fix.pageName || '', [changedField], 'audit-fix');
              recordBulkAcceptFixOutcomeAction(ws.id, fix, changedField, pagePath);
              broadcastToWorkspace(ws.id, WS_EVENTS.PAGE_STATE_UPDATED, {
                pageId: fix.pageId,
                fields: [changedField],
                source: 'audit-fix',
              });
            } else {
              log.debug({ workspaceId, pageId: fix.pageId }, 'bulk-accept-fixes: workspace missing during local state tracking');
            }
          }
        } else {
          log.debug({ pageId: fix.pageId, check: fix.check }, 'bulk-accept-fixes: unrecognized check type, skipping');
        }
        done++;
      } catch (err) {
        log.error({ err, pageId: fix.pageId, check: fix.check }, 'bulk-accept-fixes: fix failed');
        failed++;
        done++;
      }

      updateJob(jobId, {
        progress: done,
        message: `Applied ${done}/${fixes.length} fixes${failed > 0 ? ` (${failed} failed)` : ''}...`,
      });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_PROGRESS, {
        jobId,
        operation: 'bulk-accept-fixes',
        done,
        total: fixes.length,
        failed,
        appliedKey: applied[applied.length - 1] ?? null,
      });
    }

    if (signal.aborted) {
      updateJob(jobId, {
        status: 'cancelled',
        progress: done,
        message: `Cancelled after ${done} fixes`,
        result: { applied: applied.length, failed, total: fixes.length, appliedKeys: applied },
      });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_FAILED, {
        jobId,
        operation: 'bulk-accept-fixes',
        error: 'Cancelled',
      });
      return;
    }

    if (applied.length === 0 && failed > 0) {
      const errorMessage = `Bulk accept fixes failed for all ${fixes.length} fixes`;
      updateJob(jobId, {
        status: 'error',
        progress: done,
        message: errorMessage,
        error: errorMessage,
        result: { applied: applied.length, failed, total: fixes.length, appliedKeys: applied },
      });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_FAILED, {
        jobId,
        operation: 'bulk-accept-fixes',
        error: errorMessage,
        failed,
        total: fixes.length,
      });
      return;
    }

    updateJob(jobId, {
      status: 'done',
      progress: done,
      message: `Applied ${applied.length}/${fixes.length} fixes${failed > 0 ? ` (${failed} failed)` : ''}`,
      result: { applied: applied.length, failed, total: fixes.length, appliedKeys: applied },
    });
    broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_COMPLETE, {
      jobId,
      operation: 'bulk-accept-fixes',
      applied: applied.length,
      failed,
      total: fixes.length,
      appliedKeys: applied,
    });
    if (applied.length > 0) invalidateIntelligenceCache(workspaceId);

    // These are AUDIT fixes, so resolve any audit-category recommendations
    // covering the fixed pages in-place — otherwise the already-applied audit
    // items linger on the client priority list until the next GSC-lagged full
    // audit. Pass source:'audit' so only audit-category recs are touched (a
    // keyword/decay rec on the same page is untouched). The slugs are in hand
    // (publishedPath/pageSlug); no getPageState round-trip. Guarded so a resolver
    // failure can never abort the job's completion side-effects (activity log).
    if (appliedSlugs.size > 0) {
      try {
        resolveRecommendationsForChange(workspaceId, { affectedPages: [...appliedSlugs], source: 'audit' }); // rec-refresh-ok
      } catch (err) {
        log.warn({ err, jobId }, 'bulk-accept-fixes: failed to resolve recommendations after applying audit fixes');
      }
    }

    if (applied.length > 0) {
      const fixLabel = applied.length === 1 ? 'fix' : 'fixes';
      addActivity(
        workspaceId,
        'seo_updated',
        `Bulk audit fix: ${applied.length} ${fixLabel} applied`,
        `Background job applied ${applied.length}/${fixes.length} audit fixes to Webflow`,
        { applied: applied.length, failed, total: fixes.length },
      );
    }
  } catch (err) {
    log.error({ err }, 'bulk-accept-fixes: job failed');
    updateJob(jobId, { status: 'error', error: String(err) });
    broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_FAILED, {
      jobId,
      operation: 'bulk-accept-fixes',
      error: String(err),
    });
  } finally {
    unregisterAbort(jobId);
  }
}
