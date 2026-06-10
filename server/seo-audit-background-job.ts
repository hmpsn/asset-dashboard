import { addActivity } from './activity-log.js';
import { getEffectiveAudit, getEffectivePreviousScore } from './audit-snapshot-views.js';
import { broadcastToWorkspace } from './broadcast.js';
import { notifyClientAuditComplete, notifyClientRecommendationsReady } from './email.js';
import { isProgrammingError } from './errors.js';
import {
  createJob,
  updateJob,
} from './jobs.js';
import { createLogger } from './logger.js';
import {
  generateRecommendations,
  loadRecommendations,
} from './recommendations.js';
import {
  getLatestSnapshotBefore,
  saveSnapshot,
} from './reports.js';
import { runSeoAudit } from './seo-audit.js';
import { handleOnDemandSeoAuditResult } from './webflow-seo-audit-bridges.js';
import { getBrandName, getClientPortalUrl, getWorkspace, getWorkspaceBySiteId } from './workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('seo-audit-background-job');

export interface StartSeoAuditBackgroundJobParams {
  workspaceId?: string;
  siteId: string;
  token: string;
  skipLinkCheck?: boolean;
}

export interface StartedSeoAuditBackgroundJob {
  jobId: string;
}

export function startSeoAuditBackgroundJob(
  params: StartSeoAuditBackgroundJobParams,
): StartedSeoAuditBackgroundJob {
  const { workspaceId, siteId, token, skipLinkCheck = false } = params;
  const job = createJob(BACKGROUND_JOB_TYPES.SEO_AUDIT, {
    message: 'Running SEO audit...',
    workspaceId,
  });

  void (async () => {
    try {
      updateJob(job.id, { status: 'running', message: 'Scanning pages...' });
      const result = await runSeoAudit(siteId, token, workspaceId, skipLinkCheck);

      const workspace = workspaceId
        ? getWorkspace(workspaceId)
        : getWorkspaceBySiteId(siteId);
      const siteName = getBrandName(workspace) || siteId;
      const snapshot = saveSnapshot(siteId, siteName, result);
      const effectiveResult = getEffectiveAudit(result, workspace?.auditSuppressions || []);
      let effectivePreviousScore = snapshot.previousScore;

      if (workspace) {
        effectivePreviousScore = getEffectivePreviousScore(snapshot, workspace.auditSuppressions || []);
        addActivity(
          workspace.id,
          'audit_completed',
          `Site audit completed — score ${effectiveResult.siteScore}`,
          `${effectiveResult.totalPages} pages scanned, ${effectiveResult.errors} errors, ${effectiveResult.warnings} warnings`,
          { score: effectiveResult.siteScore, previousScore: effectivePreviousScore },
        );
        handleOnDemandSeoAuditResult(workspace, effectiveResult);
        broadcastToWorkspace(workspace.id, WS_EVENTS.AUDIT_COMPLETE, {
          score: effectiveResult.siteScore,
          previousScore: effectivePreviousScore,
        });
      }

      updateJob(job.id, {
        status: 'done',
        result: {
          ...effectiveResult,
          previousScore: effectivePreviousScore,
          snapshotId: snapshot.id,
        },
        message: `Audit complete — score ${effectiveResult.siteScore}`,
      });

      if (workspace) {
        try {
          await generateRecommendations(workspace.id);
          log.info(`Auto-regenerated recommendations for ${workspace.id}`);

          if (workspace.clientEmail) {
            const dashboardUrl = getClientPortalUrl(workspace);
            const recommendationSet = loadRecommendations(workspace.id);
            const recommendations = recommendationSet?.recommendations || [];
            const honestRecommendationCount = recommendations.filter(
              (recommendation) =>
                recommendation.status !== 'completed' &&
                recommendation.status !== 'dismissed' &&
                !recommendation.backfilled,
            ).length;

            if (honestRecommendationCount > 0) {
              notifyClientRecommendationsReady({
                clientEmail: workspace.clientEmail,
                workspaceName: workspace.name,
                workspaceId: workspace.id,
                recCount: honestRecommendationCount,
                dashboardUrl,
              });
            }
          }
        } catch (recommendationsError) {
          log.error({ err: recommendationsError }, 'Failed to regenerate recommendations');
        }

        if (workspace.clientEmail) {
          const dashboardUrl = getClientPortalUrl(workspace);
          const allIssues: Array<{ message: string; severity: string }> = [];

          for (const page of effectiveResult.pages) {
            for (const issue of page.issues) {
              if (issue.severity === 'error' || issue.severity === 'warning') {
                allIssues.push({ message: issue.message, severity: issue.severity });
              }
            }
          }

          const seen = new Map<string, { message: string; severity: string }>();
          for (const issue of allIssues) {
            const existing = seen.get(issue.message);
            if (!existing || (issue.severity === 'error' && existing.severity !== 'error')) {
              seen.set(issue.message, issue);
            }
          }

          const uniqueIssues = [...seen.values()];
          uniqueIssues.sort((left, right) => (left.severity === 'error' ? 0 : 1) - (right.severity === 'error' ? 0 : 1));
          const topIssues = uniqueIssues.slice(0, 5);

          let fixedCount = 0;
          if (effectivePreviousScore != null) {
            const previous = getLatestSnapshotBefore(workspace.webflowSiteId!, snapshot.id);
            if (previous) {
              const previousAudit = getEffectiveAudit(previous.audit, workspace.auditSuppressions || []);
              const previousIssueKeys = new Set<string>();
              for (const page of previousAudit.pages) {
                for (const issue of page.issues) previousIssueKeys.add(`${page.pageId}:${issue.check}`);
              }

              const currentIssueKeys = new Set<string>();
              for (const page of effectiveResult.pages) {
                for (const issue of page.issues) currentIssueKeys.add(`${page.pageId}:${issue.check}`);
              }

              for (const key of previousIssueKeys) {
                if (!currentIssueKeys.has(key)) fixedCount++;
              }
            }
          }

          notifyClientAuditComplete({
            clientEmail: workspace.clientEmail,
            workspaceName: workspace.name,
            workspaceId: workspace.id,
            score: effectiveResult.siteScore,
            previousScore: effectivePreviousScore,
            totalPages: effectiveResult.totalPages,
            errors: effectiveResult.errors,
            warnings: effectiveResult.warnings,
            topIssues,
            fixedCount,
            dashboardUrl,
          });
        }
      }
    } catch (err) {
      if (isProgrammingError(err)) { // url-fetch-ok
        log.warn({ err }, 'seo-audit background job failed with programming error');
      } else {
        log.debug({ err }, 'seo-audit background job failed — degrading gracefully');
      }
      updateJob(job.id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        message: 'Audit failed',
      });
    }
  })();

  return { jobId: job.id };
}
