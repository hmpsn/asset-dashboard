// ── Platform foundation API endpoints ────────────────────────────
import { get, post, del, getSafe, patch } from './client';
import type { FeaturesData } from '../../shared/types/features';
import type { WorkspaceIntegrationHealth } from '../../shared/types/integration-health';
import type { WorkspaceObservabilityReport } from '../../shared/types/platform-observability';
import type { RoadmapData, RoadmapItem, RoadmapItemPatch } from '../../shared/types/roadmap';

// ── Jobs ────────────────────────────────────────────────────────
export const jobs = {
  list: () => get<unknown[]>('/api/jobs'),

  get: (jobId: string) =>
    get<{ id: string; status: 'pending' | 'running' | 'done' | 'error' | 'cancelled'; progress?: number; total?: number }>(`/api/jobs/${jobId}`),

  create: (body: Record<string, unknown>) =>
    post<unknown>('/api/jobs', body),

  cancel: (jobId: string) => del(`/api/jobs/${jobId}`),
};

// ── Roadmap ─────────────────────────────────────────────────────
export const roadmap = {
  get: () => get<RoadmapData>('/api/roadmap'),

  updateItem: (itemId: number | string, sprintId: string, body: RoadmapItemPatch) =>
    patch<{ ok: true; item: RoadmapItem }>(
      `/api/roadmap/item/${encodeURIComponent(String(itemId))}?sprintId=${encodeURIComponent(sprintId)}`,
      body,
    ),
};

// ── Features ─────────────────────────────────────────────────────
export const features = {
  get: () => get<FeaturesData>('/api/features'),
};

// ── Notifications ───────────────────────────────────────────────
export const notifications = {
  list: () => getSafe<unknown[]>('/api/notifications', []),

  markRead: (id: string) =>
    patch<unknown>(`/api/notifications/${id}/read`, {}),

  markAllRead: () =>
    post<unknown>('/api/notifications/mark-all-read'),
};

// ── Workspace overview (notification aggregation) ───────────────
export const workspaceOverview = {
  list: () => getSafe<unknown[]>('/api/workspace-overview', []),
};

// ── Workspace home (aggregated) ─────────────────────────────────
export interface WorkspaceHomeData {
  ranks: unknown[];
  requests: unknown[];
  contentRequests: unknown[];
  activity: unknown[];
  annotations: unknown[];
  churnSignals: unknown[];
  workOrders: unknown[];
  searchData: { totalClicks: number; totalImpressions: number; avgCtr: number; avgPosition: number } | null;
  ga4Data: { totalUsers: number; totalSessions: number; totalPageviews: number; newUserPercentage: number } | null;
  comparison: { users?: { current: number; previous: number }; sessions?: { current: number; previous: number } } | null;
  contentPipeline?: { templateCount: number; matrixCount: number; totalCells: number; publishedCells: number; reviewCells: number; approvedCells: number; inProgressCells: number };
  contentVelocity?: {
    monthly: Array<{ month: string; published: number }>;
    currentMonthPublished: number;
    trailingThreeMonthAvg: number;
    previousThreeMonthAvg: number;
    trendPct: number | null;
  } | null;
  contentDecay?: { critical: number; warning: number; watch: number; totalDecaying: number; avgDeclinePct: number } | null;
  weeklySummary?: { seoUpdates: number; auditsRun: number; contentGenerated: number; contentPublished: number; requestsResolved: number } | null;
}

export const workspaceHome = {
  get: (wsId: string, days = 28) =>
    get<WorkspaceHomeData>(`/api/workspace-home/${wsId}?days=${days}`),
};

// ── Workspace badges (lightweight) ──────────────────────────────
export interface WorkspaceBadges {
  pendingRequests: number;
  hasContent: boolean;
}

export const workspaceBadges = {
  get: (wsId: string) =>
    get<WorkspaceBadges>(`/api/workspace-badges/${wsId}`),
};

// ── Integration Health ──────────────────────────────────────────
export const integrationHealth = {
  get: (wsId: string) =>
    get<WorkspaceIntegrationHealth>(`/api/integrations/health/${wsId}`),
};

export const observability = {
  get: (wsId: string, days = 14) =>
    get<WorkspaceObservabilityReport>(`/api/observability/${wsId}?days=${days}`),
};
