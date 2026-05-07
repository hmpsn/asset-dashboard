import type { OperationalSlice, InsightAcceptanceRate, IntelligenceOptions } from '../../shared/types/intelligence.js';
import type { TrackedAction, ActionPlaybook } from '../../shared/types/outcome-tracking.js';
import type { Workspace } from '../../shared/types/workspace.js';
import type { ApprovalBatch } from '../../shared/types/approvals.js';
import type { WorkOrder } from '../../shared/types/payments.js';
import type { RecommendationSet } from '../../shared/types/recommendations.js';
import type { ActivityEntry } from '../activity-log.js';
import type { Annotation as AnalyticsAnnotation } from '../analytics-annotations.js';
import type { Annotation as TimelineAnnotation } from '../annotations.js';
import type { Job } from '../jobs.js';
import { createLogger } from '../logger.js';

const log = createLogger('workspace-intelligence/operational');

export async function assembleOperational(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<OperationalSlice> {
  // Recent activity
  let recentActivity: OperationalSlice['recentActivity'] = [];
  try {
    const { listActivity } = await import('../activity-log.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const activity = listActivity(workspaceId, 20);
    recentActivity = activity.map((a: ActivityEntry) => ({
      type: a.type ?? '',
      description: a.title ?? a.description ?? '',
      timestamp: a.createdAt ?? '',
    }));
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: activity log optional, degrading gracefully');
  }

  // Annotations (merge both sources)
  let annotations: OperationalSlice['annotations'] = [];
  try {
    const { getAnnotations } = await import('../analytics-annotations.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const analyticsAnnotations: AnalyticsAnnotation[] = getAnnotations(workspaceId);
    annotations = analyticsAnnotations.slice(0, 20).map(a => ({
      date: a.date ?? '',
      label: a.label ?? '',
      pageUrl: a.pageUrl ?? undefined,
    }));
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: analytics annotations optional, degrading gracefully');
  }
  try {
    const { listAnnotations } = await import('../annotations.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const timelineAnnotations: TimelineAnnotation[] = listAnnotations(workspaceId);
    for (const a of timelineAnnotations.slice(0, 10)) {
      annotations.push({ date: a.date ?? '', label: a.label ?? '' });
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: timeline annotations optional, degrading gracefully');
  }

  // Pending jobs
  let pendingJobs = 0;
  try {
    const { listJobs } = await import('../jobs.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const jobs = listJobs(workspaceId);
    pendingJobs = jobs.filter((j: Job) => j.status === 'pending' || j.status === 'running').length;
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: jobs optional, degrading gracefully');
  }

  // Time saved (usage tracking)
  let timeSaved: OperationalSlice['timeSaved'] = null;
  try {
    const { getUsageSummary } = await import('../usage-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const ws: Workspace | undefined = getWorkspace(workspaceId);
    const tier = ws?.tier ?? 'free';
    const summary = getUsageSummary(workspaceId, tier);
    let totalMinutes = 0;
    const byFeature: Record<string, number> = {};
    for (const [feature, data] of Object.entries(summary)) {
      const minutes = (data.used ?? 0) * 5;
      totalMinutes += minutes;
      if (minutes > 0) byFeature[feature] = minutes;
    }
    if (totalMinutes > 0) {
      timeSaved = { totalMinutes, byFeature };
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: usage tracking optional, degrading gracefully');
  }

  // Approval queue
  let approvalQueue: OperationalSlice['approvalQueue'] = { pending: 0, oldestAge: null };
  try {
    const { listBatches } = await import('../approvals.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const batches: ApprovalBatch[] = listBatches(workspaceId);
    let pending = 0;
    let oldestMs = 0;
    for (const batch of batches) {
      for (const item of batch.items ?? []) {
        if (item.status === 'pending') {
          pending++;
          const age = Date.now() - new Date(item.createdAt ?? '').getTime();
          if (age > oldestMs) oldestMs = age;
        }
      }
    }
    approvalQueue = { pending, oldestAge: pending > 0 ? Math.round(oldestMs / (60 * 60 * 1000)) : null };
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: approval queue optional, degrading gracefully');
  }

  let clientActionQueue: OperationalSlice['clientActionQueue'] = { pending: 0, oldestAge: null };
  try {
    const { getClientActionQueueStats } = await import('../client-actions.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    clientActionQueue = getClientActionQueueStats(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: client action queue optional, degrading gracefully');
  }

  // Recommendation queue
  let recommendationQueue = { fixNow: 0, fixSoon: 0, fixLater: 0 };
  try {
    const { loadRecommendations } = await import('../recommendations.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const recSet: RecommendationSet | null = loadRecommendations(workspaceId);
    if (recSet?.recommendations) {
      for (const rec of recSet.recommendations) {
        if (rec.status === 'pending' || !rec.status) {
          if (rec.priority === 'fix_now') recommendationQueue.fixNow++;
          else if (rec.priority === 'fix_soon') recommendationQueue.fixSoon++;
          else recommendationQueue.fixLater++;
        }
      }
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: recommendation queue optional, degrading gracefully');
  }

  // Action backlog
  let actionBacklog: OperationalSlice['actionBacklog'] = { pendingMeasurement: 0, oldestAge: null };
  try {
    const { getPendingActions } = await import('../outcome-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const pending = getPendingActions();
    const wsActions: TrackedAction[] = pending.filter((a: TrackedAction) => a.workspaceId === workspaceId);
    let oldestAge: number | null = null;
    if (wsActions.length > 0) {
      const oldest = wsActions.reduce((min, a) =>
        new Date(a.createdAt).getTime() < new Date(min.createdAt).getTime() ? a : min,
      );
      oldestAge = Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    }
    actionBacklog = { pendingMeasurement: wsActions.length, oldestAge };
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: outcome tracking optional, degrading gracefully');
  }

  // Detected playbooks
  let detectedPlaybooks: string[] = [];
  try {
    const { getPlaybooks } = await import('../outcome-playbooks.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const playbooks = getPlaybooks(workspaceId);
    detectedPlaybooks = playbooks.slice(0, 5).map((p: ActionPlaybook) => p.name ?? '').filter(Boolean);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: playbooks optional, degrading gracefully');
  }

  // Work orders
  let workOrders: OperationalSlice['workOrders'] = { active: 0, pending: 0 };
  try {
    const { listWorkOrders } = await import('../work-orders.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const orders = listWorkOrders(workspaceId);
    workOrders = {
      active: orders.filter((o: WorkOrder) => o.status === 'in_progress').length,
      pending: orders.filter((o: WorkOrder) => o.status === 'pending').length,
    };
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: work orders optional, degrading gracefully');
  }

  // Insight acceptance rate
  let insightAcceptanceRate: InsightAcceptanceRate | null = null;
  try {
    const { getInsights } = await import('../analytics-insights-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const insights = getInsights(workspaceId);
    const totalShown = insights.length;
    const confirmed = insights.filter(i => i.resolutionStatus === 'resolved' || i.resolutionStatus === 'in_progress').length;
    // `dismissed` is a runtime-only value written by legacy code paths; the strict
    // `AnalyticsInsight['resolutionStatus']` union omits it, hence the string cast.
    const dismissed = insights.filter(i => (i.resolutionStatus as string) === 'dismissed').length;
    if (totalShown > 0) {
      insightAcceptanceRate = {
        totalShown,
        confirmed,
        dismissed,
        rate: confirmed / totalShown,
      };
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleOperational: insight acceptance rate optional, degrading gracefully');
  }

  return {
    recentActivity,
    annotations,
    pendingJobs,
    timeSaved,
    approvalQueue,
    clientActionQueue,
    recommendationQueue,
    actionBacklog,
    detectedPlaybooks,
    workOrders,
    insightAcceptanceRate,
  };
}
