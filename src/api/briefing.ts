// ── Briefing API client ─────────────────────────────────────────────────────
// Typed client wrappers for the briefing admin + public endpoints.
// All admin routes are workspace-scoped; the public read endpoint is tier-gated
// (free → 402) and lives at /api/public/briefing/:wsId.

import { get, post, patch } from './client';
import type {
  BriefingDraft,
  BriefingStory,
  PublishedBriefingResponse,
} from '../../shared/types/briefing';

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

  // ── Client (public, read-only) ───────────────────────────────────────────
  getPublished: (workspaceId: string) =>
    get<{ briefing: PublishedBriefingResponse | null }>(
      `/api/public/briefing/${workspaceId}`,
    ).then(r => r.briefing),
};
