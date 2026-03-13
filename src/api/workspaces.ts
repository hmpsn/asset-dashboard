// ── Workspaces API ─────────────────────────────────────────────────
import { get, post, patch, del, getOptional } from './client';

export const workspaces = {
  list: () => get<unknown[]>('/api/workspaces'),

  getById: (id: string) => get<unknown>(`/api/workspaces/${id}`),

  create: (body: { name: string; folder?: string }) =>
    post<unknown>('/api/workspaces', body),

  update: (id: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/workspaces/${id}`, body),

  remove: (id: string) => del(`/api/workspaces/${id}`),

  // ── Audit suppressions ────────────────────────────────────────
  getSuppressions: (wsId: string) =>
    get<string[]>(`/api/workspaces/${wsId}/audit-suppressions`),

  addSuppression: (wsId: string, check: string) =>
    post<unknown>(`/api/workspaces/${wsId}/audit-suppressions`, { check }),

  removeSuppression: (wsId: string, check: string) =>
    del(`/api/workspaces/${wsId}/audit-suppressions`, undefined),

  // ── Client users ──────────────────────────────────────────────
  updateClientUser: (wsId: string, userId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/workspaces/${wsId}/client-users/${userId}`, body),

  removeClientUser: (wsId: string, userId: string) =>
    del(`/api/workspaces/${wsId}/client-users/${userId}`),

  // ── AI generation ─────────────────────────────────────────────
  generateBrandVoice: (wsId: string) =>
    post<unknown>(`/api/workspaces/${wsId}/generate-brand-voice`),

  generateKnowledgeBase: (wsId: string) =>
    post<unknown>(`/api/workspaces/${wsId}/generate-knowledge-base`),

  generatePersonas: (wsId: string) =>
    post<unknown>(`/api/workspaces/${wsId}/generate-personas`),
};

// ── Public workspace info (client portal) ───────────────────────
export const publicWorkspaces = {
  getInfo: (wsId: string) =>
    getOptional<unknown>(`/api/public/workspace/${wsId}`),
};
