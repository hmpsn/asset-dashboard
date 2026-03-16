// ── Content API (briefs, posts, content requests) ─────────────────
import { get, post, patch, del, getSafe, getOptional } from './client';

export const contentBriefs = {
  list: (wsId: string) =>
    get<unknown[]>(`/api/content-briefs/${wsId}`),

  generate: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/content-briefs/${wsId}/generate`, body),

  update: (wsId: string, briefId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/content-briefs/${wsId}/${briefId}`, body),

  remove: (wsId: string, briefId: string) =>
    del(`/api/content-briefs/${wsId}/${briefId}`),
};

export const contentPosts = {
  list: (wsId: string) =>
    get<unknown[]>(`/api/content-posts/${wsId}`),

  generate: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/content-posts/${wsId}/generate`, body),

  update: (wsId: string, postId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/content-posts/${wsId}/${postId}`, body),

  remove: (wsId: string, postId: string) =>
    del(`/api/content-posts/${wsId}/${postId}`),

  getById: (wsId: string, postId: string) =>
    get<unknown>(`/api/content-posts/${wsId}/${postId}`),

  regenerateSection: (wsId: string, postId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/content-posts/${wsId}/${postId}/regenerate-section`, body),

  versions: (wsId: string, postId: string) =>
    getSafe<unknown[]>(`/api/content-posts/${wsId}/${postId}/versions`, []),

  revertVersion: (wsId: string, postId: string, versionId: string) =>
    post<unknown>(`/api/content-posts/${wsId}/${postId}/versions/${versionId}/revert`),

  publishToWebflow: (wsId: string, postId: string, body?: { generateImage?: boolean }) =>
    post<{ success: boolean; itemId?: string; slug?: string; isUpdate?: boolean; error?: string; post?: unknown }>(
      `/api/content-posts/${wsId}/${postId}/publish-to-webflow`, body,
    ),
};

export const contentRequests = {
  list: (wsId: string) =>
    get<unknown[]>(`/api/content-requests/${wsId}`),

  create: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/content-requests/${wsId}`, body),

  update: (wsId: string, reqId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/content-requests/${wsId}/${reqId}`, body),

  remove: (wsId: string, reqId: string) =>
    del(`/api/content-requests/${wsId}/${reqId}`),
};

// ── Public content endpoints (client portal) ────────────────────
export const publicContent = {
  requests: (wsId: string) =>
    getSafe<unknown[]>(`/api/public/content-requests/${wsId}`, []),

  requestTopic: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-requests/${wsId}`, body),

  createRequest: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-request/${wsId}`, body),

  submitRequest: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-request/${wsId}/submit`, body),

  decline: (wsId: string, reqId: string, body?: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-request/${wsId}/${reqId}/decline`, body),

  approve: (wsId: string, reqId: string) =>
    post<unknown>(`/api/public/content-request/${wsId}/${reqId}/approve`),

  requestChanges: (wsId: string, reqId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-request/${wsId}/${reqId}/request-changes`, body),

  comment: (wsId: string, reqId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-request/${wsId}/${reqId}/comment`, body),

  upgrade: (wsId: string, reqId: string) =>
    post<unknown>(`/api/public/content-request/${wsId}/${reqId}/upgrade`),

  briefPreview: (wsId: string, briefId: string) =>
    getOptional<unknown>(`/api/public/content-brief/${wsId}/${briefId}`),
};

// ── Content decay ───────────────────────────────────────────────
export const contentDecay = {
  get: (wsId: string) =>
    get<unknown>(`/api/content-decay/${wsId}`),

  analyze: (wsId: string) =>
    post<unknown>(`/api/content-decay/${wsId}/analyze`),

  recommendations: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/content-decay/${wsId}/recommendations`, body),
};
