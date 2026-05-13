import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { updateJob, unregisterAbort, isJobCancelled } from './jobs.js';
import { createLogger } from './logger.js';
import { recordSeoChange } from './seo-change-tracker.js';
import { updatePageSeo } from './webflow.js';
import { getWorkspace, updatePageState } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import type { SeoBulkAcceptFix } from './schemas/seo-bulk-jobs.js';

const log = createLogger('webflow-seo-bulk-accept-fixes-job');

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
              recordSeoChange(ws.id, fix.pageId, fix.publishedPath || fix.pageSlug || '', fix.pageName || '', [changedField], 'audit-fix');
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
