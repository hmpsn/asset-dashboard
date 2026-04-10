// src/api/intelligence.ts
// Intelligence API client — typed fetch wrappers for the intelligence endpoints.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §8

import { get } from './client.js';
import type { WorkspaceIntelligence, IntelligenceSlice } from '../../shared/types/intelligence.js';

export const intelligenceApi = {
  /** Fetch workspace intelligence with optional slice filtering */
  getIntelligence(
    workspaceId: string,
    slices?: readonly IntelligenceSlice[],
    pagePath?: string,
    learningsDomain?: 'content' | 'strategy' | 'technical' | 'all',
    signal?: AbortSignal,
  ): Promise<WorkspaceIntelligence> {
    const params = new URLSearchParams();
    if (slices?.length) params.set('slices', slices.join(','));
    if (pagePath) params.set('pagePath', pagePath);
    if (learningsDomain) params.set('learningsDomain', learningsDomain);
    const qs = params.toString();
    return get<WorkspaceIntelligence>(
      `/api/intelligence/${workspaceId}${qs ? `?${qs}` : ''}`,
      signal,
    );
  },

  /** Fetch intelligence cache health stats */
  getHealth(signal?: AbortSignal) {
    return get<{ caches: Record<string, { entries: number; maxEntries: number }> }>(
      '/api/intelligence/health',
      signal,
    );
  },
};
