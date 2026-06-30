import type {
  OperationalSlice,
  InsightAcceptanceRate,
  IntelligenceOptions,
} from '../../shared/types/intelligence.js';
import type {
  TrackedAction,
  ActionPlaybook,
} from '../../shared/types/outcome-tracking.js';
import type { Workspace } from '../../shared/types/workspace.js';
import type { ApprovalBatch } from '../../shared/types/approvals.js';
import type { WorkOrder } from '../../shared/types/payments.js';
import type { RecommendationSet } from '../../shared/types/recommendations.js';
import type { ActivityEntry } from '../activity-log.js';
import type { Annotation as AnalyticsAnnotation } from '../analytics-annotations.js';
import type { Annotation as TimelineAnnotation } from '../annotations.js';
import type { Job } from '../jobs.js';
import { createLogger } from '../logger.js';
import { readOptionalSlicePart } from './optional-slice-part.js';

const log = createLogger('workspace-intelligence/operational');

export async function assembleOperational(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<OperationalSlice> {
  const recentActivity = await readOptionalSlicePart<
    OperationalSlice['recentActivity']
  >(
    'assembleOperational: activity log',
    workspaceId,
    [],
    async () => {
      const { listActivity } = await import('../activity-log.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const activity = listActivity(workspaceId, 20);
      return activity.map((a: ActivityEntry) => ({
        type: a.type ?? '',
        description: a.title ?? a.description ?? '',
        timestamp: a.createdAt ?? '',
      }));
    },
    { logger: log },
  );

  const analyticsAnnotations = await readOptionalSlicePart<
    OperationalSlice['annotations']
  >(
    'assembleOperational: analytics annotations',
    workspaceId,
    [],
    async () => {
      const { getAnnotations } = await import('../analytics-annotations.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const analyticsAnnotations: AnalyticsAnnotation[] =
        getAnnotations(workspaceId);
      return analyticsAnnotations.slice(0, 20).map((a) => ({
        date: a.date ?? '',
        label: a.label ?? '',
        pageUrl: a.pageUrl ?? undefined,
      }));
    },
    { logger: log },
  );
  const timelineAnnotations = await readOptionalSlicePart<
    OperationalSlice['annotations']
  >(
    'assembleOperational: timeline annotations',
    workspaceId,
    [],
    async () => {
      const { listAnnotations } = await import('../annotations.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const annotations: TimelineAnnotation[] = listAnnotations(workspaceId);
      return annotations
        .slice(0, 10)
        .map((a) => ({ date: a.date ?? '', label: a.label ?? '' }));
    },
    { logger: log },
  );
  const annotations = [...analyticsAnnotations, ...timelineAnnotations];

  const pendingJobs = await readOptionalSlicePart(
    'assembleOperational: jobs',
    workspaceId,
    0,
    async () => {
      const { listJobs } = await import('../jobs.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const jobs = listJobs(workspaceId);
      return jobs.filter(
        (j: Job) => j.status === 'pending' || j.status === 'running',
      ).length;
    },
    { logger: log },
  );

  // Time saved (usage tracking) + tier/entitlement (Task 4.2d)
  const effectiveTier = await readOptionalSlicePart<
    OperationalSlice['effectiveTier']
  >(
    'assembleOperational: usage tracking',
    workspaceId,
    undefined,
    async () => {
      const { getWorkspace, computeEffectiveTier } =
        await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const ws: Workspace | undefined = getWorkspace(workspaceId);
      return ws ? computeEffectiveTier(ws) : ('free' as const);
    },
    { logger: log },
  );
  const usageTracking = await readOptionalSlicePart<{
    timeSaved: OperationalSlice['timeSaved'];
    usageRemaining: OperationalSlice['usageRemaining'];
  }>(
    'assembleOperational: usage tracking',
    workspaceId,
    {
      timeSaved: null,
      usageRemaining: undefined,
    },
    async () => {
      if (!effectiveTier) {
        return { timeSaved: null, usageRemaining: undefined };
      }
      const { getUsageSummary } = await import('../usage-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const summary = getUsageSummary(workspaceId, effectiveTier);
      let totalMinutes = 0;
      const byFeature: Record<string, number> = {};
      const remaining: Record<string, number> = {};
      for (const [feature, data] of Object.entries(summary)) {
        const minutes = (data.used ?? 0) * 5;
        totalMinutes += minutes;
        if (minutes > 0) byFeature[feature] = minutes;
        remaining[feature] = data.remaining ?? 0;
      }
      return {
        timeSaved: totalMinutes > 0 ? { totalMinutes, byFeature } : null,
        usageRemaining: remaining,
      };
    },
    { logger: log },
  );
  const { timeSaved, usageRemaining } = usageTracking;

  // Page edit states summary (Task 4.2a)
  const pageEditStateSummary = await readOptionalSlicePart<
    OperationalSlice['pageEditStateSummary']
  >(
    'assembleOperational: page-edit-states',
    workspaceId,
    undefined,
    async () => {
      const { getAllPageStates } = await import('../page-edit-states.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const states = getAllPageStates(workspaceId);
      const byStatus: Record<string, number> = {};
      for (const state of Object.values(states)) {
        const s = state.status ?? 'unknown';
        byStatus[s] = (byStatus[s] ?? 0) + 1;
      }
      return { total: Object.keys(states).length, byStatus };
    },
    { logger: log },
  );

  // Approval queue
  const approvalQueue = await readOptionalSlicePart<
    OperationalSlice['approvalQueue']
  >(
    'assembleOperational: approval queue',
    workspaceId,
    { pending: 0, oldestAge: null },
    async () => {
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
      return {
        pending,
        oldestAge: pending > 0 ? Math.round(oldestMs / (60 * 60 * 1000)) : null,
      };
    },
    { logger: log },
  );

  const clientActionQueue = await readOptionalSlicePart<
    OperationalSlice['clientActionQueue']
  >(
    'assembleOperational: client action queue',
    workspaceId,
    { pending: 0, oldestAge: null },
    async () => {
      const { getClientActionQueueStats } =
        await import('../client-actions.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      return getClientActionQueueStats(workspaceId);
    },
    { logger: log },
  );

  // Recommendation queue
  const recommendationQueue = await readOptionalSlicePart(
    'assembleOperational: recommendation queue',
    workspaceId,
    { fixNow: 0, fixSoon: 0, fixLater: 0 },
    async () => {
      const { loadRecommendations, isActiveRec } = await import('../recommendations.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const recSet: RecommendationSet | null = loadRecommendations(workspaceId);
      const queue = { fixNow: 0, fixSoon: 0, fixLater: 0 };
      if (recSet?.recommendations) {
        for (const rec of recSet.recommendations) {
          if (isActiveRec(rec)) {
            if (rec.priority === 'fix_now') queue.fixNow++;
            else if (rec.priority === 'fix_soon') queue.fixSoon++;
            else queue.fixLater++;
          }
        }
      }
      return queue;
    },
    { logger: log },
  );

  // Action backlog
  const actionBacklog = await readOptionalSlicePart<
    OperationalSlice['actionBacklog']
  >(
    'assembleOperational: outcome tracking',
    workspaceId,
    { pendingMeasurement: 0, oldestAge: null },
    async () => {
      const { getPendingActions } = await import('../outcome-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const pending = getPendingActions();
      const wsActions: TrackedAction[] = pending.filter(
        (a: TrackedAction) => a.workspaceId === workspaceId,
      );
      let oldestAge: number | null = null;
      for (const action of wsActions) {
        const createdAtMs = new Date(action.createdAt ?? '').getTime();
        if (!Number.isFinite(createdAtMs)) continue;
        const ageDays = Math.floor(
          (Date.now() - createdAtMs) / (24 * 60 * 60 * 1000),
        );
        if (ageDays < 0) continue;
        if (oldestAge === null || ageDays > oldestAge) {
          oldestAge = ageDays;
        }
      }
      return { pendingMeasurement: wsActions.length, oldestAge };
    },
    { logger: log },
  );

  // Detected playbooks
  const detectedPlaybooks = await readOptionalSlicePart<string[]>(
    'assembleOperational: playbooks',
    workspaceId,
    [],
    async () => {
      const { getPlaybooks } = await import('../outcome-playbooks.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const playbooks = getPlaybooks(workspaceId);
      return playbooks
        .slice(0, 5)
        .map((p: ActionPlaybook) => p.name ?? '')
        .filter(Boolean);
    },
    { logger: log },
  );

  // Work orders
  const workOrders = await readOptionalSlicePart<
    OperationalSlice['workOrders']
  >(
    'assembleOperational: work orders',
    workspaceId,
    { active: 0, pending: 0 },
    async () => {
      const { listWorkOrders } = await import('../work-orders.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const orders = listWorkOrders(workspaceId);
      return {
        active: orders.filter((o: WorkOrder) => o.status === 'in_progress')
          .length,
        pending: orders.filter((o: WorkOrder) => o.status === 'pending').length,
      };
    },
    { logger: log },
  );

  // Insight acceptance rate
  const insightAcceptanceRate =
    await readOptionalSlicePart<InsightAcceptanceRate | null>(
      'assembleOperational: insight acceptance rate',
      workspaceId,
      null,
      async () => {
        const { getInsights } = await import('../analytics-insights-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
        const insights = getInsights(workspaceId);
        const totalShown = insights.length;
        const confirmed = insights.filter(
          (i) =>
            i.resolutionStatus === 'resolved' ||
            i.resolutionStatus === 'in_progress',
        ).length;
        // `dismissed` is a runtime-only value written by legacy code paths; the strict
        // `AnalyticsInsight['resolutionStatus']` union omits it, hence the string cast.
        const dismissed = insights.filter(
          (i) => (i.resolutionStatus as string) === 'dismissed',
        ).length;
        if (totalShown > 0) {
          return {
            totalShown,
            confirmed,
            dismissed,
            rate: confirmed / totalShown,
          };
        }
        return null;
      },
      { logger: log },
    );

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
    pageEditStateSummary,
    effectiveTier,
    usageRemaining,
  };
}
