import { get, patch, post } from './client';

export interface SuggestedBrief {
  id: string;
  workspaceId: string;
  keyword: string;
  pageUrl: string | null;
  source: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed';
  createdAt: string;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  dismissedKeywordHash: string | null;
}

export const suggestedBriefsApi = {
  list(workspaceId: string, includeAll = false, signal?: AbortSignal) {
    const qs = includeAll ? '?all=true' : '';
    return get<SuggestedBrief[]>(`/api/suggested-briefs/${workspaceId}${qs}`, signal);
  },

  get(workspaceId: string, briefId: string, signal?: AbortSignal) {
    return get<SuggestedBrief>(`/api/suggested-briefs/${workspaceId}/${briefId}`, signal);
  },

  update(workspaceId: string, briefId: string, status: 'accepted' | 'dismissed') {
    return patch<SuggestedBrief>(`/api/suggested-briefs/${workspaceId}/${briefId}`, { status });
  },

  snooze(workspaceId: string, briefId: string, until: string) {
    return post<SuggestedBrief>(`/api/suggested-briefs/${workspaceId}/${briefId}/snooze`, { until });
  },

  dismiss(workspaceId: string, briefId: string) {
    return post<SuggestedBrief>(`/api/suggested-briefs/${workspaceId}/${briefId}/dismiss`, {});
  },
};
