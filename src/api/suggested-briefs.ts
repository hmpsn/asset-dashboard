import { get, patch, post } from './client';
import type { SuggestedBrief } from '../../shared/types/intelligence.js';

export type { SuggestedBrief };

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
