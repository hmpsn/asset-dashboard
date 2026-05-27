// ── Briefing API client ─────────────────────────────────────────────────────
// Typed client wrappers for the briefing admin + public endpoints.
// All admin routes are workspace-scoped; the public read endpoint is tier-gated
// (free → 402) and lives at /api/public/briefing/:wsId.

import { get, post, patch } from './client';
import type {
  BriefingClientView,
  BriefingDraft,
  BriefingStory,
  PublishedBriefingResponse,
} from '../../shared/types/briefing';

/** Standalone wrapper matching the task spec signature. */
export function fetchBriefingPreview(workspaceId: string): Promise<BriefingClientView | null> {
  return get<{ briefing: BriefingClientView | null }>(
    `/api/briefing/${workspaceId}/preview`,
  ).then(r => r.briefing);
}

export const briefingApi = {
  // ── Admin ────────────────────────────────────────────────────────────────
  listDrafts: (workspaceId: string) =>
    get<{ drafts: BriefingDraft[] }>(`/api/briefing/${workspaceId}/drafts`).then(r => r.drafts),

  updateStories: (workspaceId: string, draftId: string, stories: BriefingStory[]) =>
    patch<{ draft: BriefingDraft }>(
      `/api/briefing/${workspaceId}/drafts/${draftId}/stories`,
      { stories },
    ).then(r => r.draft),

  approve: (workspaceId: string, draftId: string, adminNote?: string) =>
    post<{ draft: BriefingDraft }>(
      `/api/briefing/${workspaceId}/drafts/${draftId}/approve`,
      { adminNote },
    ).then(r => r.draft),

  publish: (workspaceId: string, draftId: string, adminNote?: string) =>
    post<{ draft: BriefingDraft }>(
      `/api/briefing/${workspaceId}/drafts/${draftId}/publish`,
      { adminNote },
    ).then(r => r.draft),

  skip: (workspaceId: string, draftId: string, adminNote: string) =>
    post<{ draft: BriefingDraft }>(
      `/api/briefing/${workspaceId}/drafts/${draftId}/skip`,
      { adminNote },
    ).then(r => r.draft),

  generateNow: (workspaceId: string) =>
    post<{ accepted: boolean; reason?: string }>(`/api/briefing/${workspaceId}/generate-now`, {}),

  /** Admin preview — returns the same enriched payload the client sees. */
  fetchBriefingPreview: (workspaceId: string) =>
    get<{ briefing: BriefingClientView | null }>(
      `/api/briefing/${workspaceId}/preview`,
    ).then(r => r.briefing),

  // ── Client (public, read-only) ───────────────────────────────────────────
  getPublished: (workspaceId: string) =>
    get<{ briefing: PublishedBriefingResponse | null }>(
      `/api/public/briefing/${workspaceId}`,
    ).then(r => r.briefing),
};
