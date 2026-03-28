// ── Miscellaneous API endpoints ────────────────────────────────────
import { get, post, patch, del, getSafe, getOptional, postForm } from './client';
import type { ContentSubscription, ContentSubscriptionPlanConfig } from '../../shared/types/content';

// ── Requests (client requests / support tickets) ────────────────
export const requests = {
  list: (params?: { workspaceId?: string }) => {
    const qs = params?.workspaceId ? `?workspaceId=${params.workspaceId}` : '';
    return get<unknown[]>(`/api/requests${qs}`);
  },

  create: (body: Record<string, unknown>) =>
    post<unknown>('/api/requests', body),

  update: (id: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/requests/${id}`, body),

  remove: (id: string) => del(`/api/requests/${id}`),

  bulkRemove: (ids: string[]) =>
    Promise.all(ids.map(id => del(`/api/requests/${id}`))),

  addNote: (requestId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/requests/${requestId}/notes`, body),

  addNoteWithFiles: (requestId: string, formData: FormData) =>
    postForm<unknown>(`/api/requests/${requestId}/notes-with-files`, formData),
};

// ── Public requests (client portal) ─────────────────────────────
export const publicRequests = {
  list: (wsId: string) =>
    getSafe<unknown[]>(`/api/public/requests/${wsId}`, []),

  create: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/requests/${wsId}`, body),

  addNote: (wsId: string, requestId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/requests/${wsId}/${requestId}/notes`, body),
};

// ── Approvals ───────────────────────────────────────────────────
export const approvals = {
  create: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/approvals/${wsId}`, body),

  list: (wsId: string) =>
    getSafe<unknown[]>(`/api/approvals/${wsId}`, []),

  remove: (wsId: string, batchId: string) =>
    del<{ ok: boolean }>(`/api/approvals/${wsId}/${batchId}`),

  remind: (wsId: string, batchId: string) =>
    post<{ ok: boolean; sentTo: string }>(`/api/approvals/${wsId}/${batchId}/remind`),

  publicList: (wsId: string) =>
    getSafe<unknown[]>(`/api/public/approvals/${wsId}`, []),

  publicUpdate: (wsId: string, batchId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/public/approvals/${wsId}/${batchId}`, body),
};

// ── Activity ────────────────────────────────────────────────────
export const activity = {
  list: (wsId: string, limit = 8) =>
    getSafe<unknown[]>(`/api/activity?workspaceId=${wsId}&limit=${limit}`, []),

  publicList: (wsId: string, limit = 20) =>
    getSafe<unknown[]>(`/api/public/activity/${wsId}?limit=${limit}`, []),
};

// ── Analytics Annotations (new system — admin-facing, with categories/edit) ──
export const analyticsAnnotations = {
  list: (wsId: string, opts?: { startDate?: string; endDate?: string; category?: string }) => {
    if (opts) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts)) { if (v != null) params.set(k, v); }
      const qs = params.toString();
      return getSafe<unknown[]>(`/api/google/annotations/${wsId}${qs ? '?' + qs : ''}`, []);
    }
    return getSafe<unknown[]>(`/api/google/annotations/${wsId}`, []);
  },

  create: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/google/annotations/${wsId}`, body),

  update: (wsId: string, id: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/google/annotations/${wsId}/${id}`, body),

  remove: (wsId: string, id: string) =>
    del(`/api/google/annotations/${wsId}/${id}`),
};

// ── Annotations ─────────────────────────────────────────────────
export const annotations = {
  list: (wsId: string) =>
    getSafe<unknown[]>(`/api/annotations/${wsId}`, []),

  create: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/annotations/${wsId}`, body),

  remove: (wsId: string, id: string) =>
    del(`/api/annotations/${wsId}/${id}`),

  publicList: (wsId: string) =>
    getSafe<unknown[]>(`/api/public/annotations/${wsId}`, []),
};

// ── Anomalies ───────────────────────────────────────────────────
export const anomalies = {
  listAll: () =>
    getSafe<unknown[]>('/api/anomalies', []),

  list: (wsId: string) =>
    getSafe<unknown[]>(`/api/anomalies/${wsId}`, []),

  publicList: (wsId: string) =>
    getSafe<unknown[]>(`/api/public/anomalies/${wsId}`, []),

  dismiss: (id: string) =>
    post<unknown>(`/api/anomalies/${id}/dismiss`),

  acknowledge: (id: string) =>
    post<unknown>(`/api/anomalies/${id}/acknowledge`),

  scan: () =>
    post<unknown>('/api/anomalies/scan'),
};

// ── Churn signals ───────────────────────────────────────────────
export const churnSignals = {
  list: (wsId: string) =>
    getSafe<unknown[]>(`/api/churn-signals/${wsId}`, []),
};

// ── Jobs ────────────────────────────────────────────────────────
export const jobs = {
  list: () => get<unknown[]>('/api/jobs'),

  create: (body: Record<string, unknown>) =>
    post<unknown>('/api/jobs', body),

  cancel: (jobId: string) => del(`/api/jobs/${jobId}`),
};

// ── Chat (admin + public) ───────────────────────────────────────
export const chat = {
  adminAsk: (body: { workspaceId: string; question: string; sessionId: string; days?: number }) =>
    post<{ answer?: string; error?: string; mode?: string; dataSourceCount?: number }>('/api/admin-chat', body),

  publicAsk: (wsId: string, body: { question: string; context: Record<string, unknown>; sessionId: string; betaMode?: boolean }) =>
    post<{ answer?: string; error?: string }>(`/api/public/search-chat/${wsId}`, body),

  sessions: (wsId: string, channel?: string) => {
    const qs = channel ? `?channel=${channel}` : '';
    return getSafe<unknown[]>(`/api/public/chat-sessions/${wsId}${qs}`, []);
  },

  session: (wsId: string, sessionId: string) =>
    getOptional<{ messages?: Array<{ role: string; content: string }> }>(`/api/public/chat-sessions/${wsId}/${sessionId}`),
};

// ── Roadmap ─────────────────────────────────────────────────────
export const roadmap = {
  get: () => get<unknown>('/api/roadmap'),

  update: (itemId: number, body: Record<string, unknown>) =>
    patch<unknown>(`/api/roadmap/${itemId}`, body),

  updateItem: (itemId: number, body: Record<string, unknown>) =>
    patch<unknown>(`/api/roadmap/item/${itemId}`, body),
};

// ── Recommendations ─────────────────────────────────────────────
export const recommendations = {
  list: (wsId: string) =>
    getOptional<unknown>(`/api/public/recommendations/${wsId}`),

  generate: (wsId: string) =>
    post<unknown>(`/api/public/recommendations/${wsId}/generate`),

  update: (wsId: string, recId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/public/recommendations/${wsId}/${recId}`, body),

  remove: (wsId: string, recId: string) =>
    del(`/api/public/recommendations/${wsId}/${recId}`),
};

// ── Feedback ────────────────────────────────────────────────────
export const feedback = {
  submit: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/feedback/${wsId}`, body),

  list: (wsId: string) =>
    getSafe<unknown[]>(`/api/feedback/${wsId}`, []),
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

// ── Upload ──────────────────────────────────────────────────────
export const upload = {
  clipboard: (folder: string, formData: FormData) =>
    postForm<unknown>(`/api/upload/${folder}/clipboard`, formData),
};

// ── Settings ────────────────────────────────────────────────────
export const settings = {
  getFeatures: (wsId: string) =>
    getOptional<unknown>(`/api/settings/${wsId}/features`),

  updateFeatures: (wsId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/settings/${wsId}/features`, body),
};

// ── Sales report ────────────────────────────────────────────────
export const salesReport = {
  get: () => get<unknown>('/api/sales-report'),
  refresh: () => post<unknown>('/api/sales-report/refresh'),
  list: () => getSafe<unknown[]>('/api/sales-reports', []),
  getById: (id: string) => getOptional<unknown>(`/api/sales-report/${id}`),
};

// ── Work orders ────────────────────────────────────────────────
export const workOrders = {
  list: (wsId: string) =>
    getSafe<unknown[]>(`/api/work-orders/${wsId}`, []),
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

// ── Redirect manager ────────────────────────────────────────────
export const redirects = {
  list: (siteId: string) =>
    getSafe<unknown[]>(`/api/webflow/redirects/${siteId}`, []),

  save: (siteId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/webflow/redirects/${siteId}`, body),

  scan: (siteId: string) =>
    get<unknown>(`/api/webflow/redirect-scan/${siteId}`),

  snapshot: (siteId: string) =>
    getOptional<unknown>(`/api/webflow/redirect-snapshot/${siteId}`),
};

// ── Content subscriptions ──────────────────────────────────────
export const contentSubscriptions = {
  list: (wsId: string) =>
    getSafe<ContentSubscription[]>(`/api/content-subscriptions/${wsId}`, []),

  get: (id: string) =>
    getOptional<ContentSubscription>(`/api/content-subscription/${id}`),

  create: (wsId: string, body: { plan: string; topicSource?: string; preferredPageTypes?: string[]; notes?: string }) =>
    post<ContentSubscription>(`/api/content-subscriptions/${wsId}`, body),

  update: (id: string, body: Record<string, unknown>) =>
    patch<ContentSubscription>(`/api/content-subscription/${id}`, body),

  remove: (id: string) => del(`/api/content-subscription/${id}`),

  markDelivered: (id: string, count?: number) =>
    post<ContentSubscription>(`/api/content-subscription/${id}/delivered`, { count: count || 1 }),

  // Client-facing
  plans: () =>
    getSafe<ContentSubscriptionPlanConfig[]>('/api/public/content-plans', []),

  clientStatus: (wsId: string) =>
    getOptional<{ subscription: ContentSubscription | null; plans: ContentSubscriptionPlanConfig[] }>(`/api/public/content-subscription/${wsId}`),

  subscribe: (wsId: string, plan: string) =>
    post<{ sessionId: string; url: string }>(`/api/public/content-subscribe/${wsId}`, { plan }),
};

// ── Stripe ───────────────────────────────────────────────────
export const stripe = {
  getConfig: () =>
    getOptional<unknown>('/api/stripe/config'),

  saveKeys: (body: { secretKey?: string; webhookSecret?: string; publishableKey?: string }) =>
    post<unknown>('/api/stripe/config/keys', body),

  saveProducts: (body: Record<string, unknown>) =>
    post<unknown>('/api/stripe/config/products', body),

  deleteConfig: () => del('/api/stripe/config'),
};

// ── Auth ─────────────────────────────────────────────────────
export const auth = {
  logout: () => post<void>('/api/auth/logout'),
};

// ── Public: keyword feedback ─────────────────────────────────
export const keywordFeedback = {
  get: (wsId: string) =>
    getSafe<unknown[]>(`/api/public/keyword-feedback/${wsId}`, []),

  submit: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/keyword-feedback/${wsId}`, body),
};

// ── Public: tracked keywords ─────────────────────────────────
export const trackedKeywords = {
  get: (wsId: string) =>
    getSafe<{ keywords: Array<{ query: string; pinned: boolean; addedAt: string }> }>(
      `/api/public/tracked-keywords/${wsId}`,
      { keywords: [] },
    ),

  remove: (wsId: string, keyword: string) =>
    del<{ keywords: Array<{ query: string; pinned: boolean; addedAt: string }> }>(
      `/api/public/tracked-keywords/${wsId}`,
      { keyword },
    ),
};

// ── Public: business priorities ───────────────────────────────
export const businessPriorities = {
  get: (wsId: string) =>
    getSafe<{ priorities: Array<{ text: string; category: string }> }>(
      `/api/public/business-priorities/${wsId}`,
      { priorities: [] },
    ),
};
