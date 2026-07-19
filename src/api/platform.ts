// ── Platform foundation API endpoints ────────────────────────────
import { get, post, del, getSafe, patch, put } from './client';
import type { FeaturesData } from '../../shared/types/features';
import type { WorkspaceIntegrationHealth } from '../../shared/types/integration-health';
import type { WorkspaceObservabilityReport } from '../../shared/types/platform-observability';
import type { RoadmapData, RoadmapItem, RoadmapItemPatch } from '../../shared/types/roadmap';
import type { FeatureFlagKey, WorkspaceFeatureFlagMeta } from '../../shared/types/feature-flags';
import type { WorkQueueClassification } from '../../shared/types/work-queue';
import type { WorkspaceOverviewItem } from '../../shared/types/workspace-overview';
import type { CockpitVerdict } from '../../shared/types/cockpit';
import type { AdminMoneyFrame } from '../../shared/types/outcome-tracking';
import type { PendingRepliesSummary } from '../../shared/types/requests';

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

// ── Per-workspace feature-flag overrides (admin canary control) ──
// Admin-only (HMAC). `enabled: null` clears the override → reverts to the
// global → env → default chain. Mirrors the global feature-flag endpoints.
export const workspaceFeatureFlags = {
  list: (wsId: string) =>
    get<WorkspaceFeatureFlagMeta[]>(`/api/admin/workspaces/${wsId}/feature-flags`),

  setOverride: (wsId: string, key: FeatureFlagKey, enabled: boolean | null) =>
    put<{ success: true; workspaceId: string; key: string; enabled: boolean | null }>(
      `/api/admin/workspaces/${wsId}/feature-flags/${key}`,
      { enabled },
    ),
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
  list: () => getSafe<WorkspaceOverviewItem[]>('/api/workspace-overview', []),
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
  workQueue?: WorkQueueClassification;
  cockpitVerdict?: CockpitVerdict | null;
  moneyFrame?: AdminMoneyFrame | null;
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
  pendingReplies: PendingRepliesSummary;
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
