// src/hooks/admin/useWorkspaceIntelligence.ts
// React Query hook for the Unified Workspace Intelligence Layer.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §8

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { intelligenceApi } from '../../api/intelligence';
import type { IntelligenceSlice } from '../../../shared/types/intelligence.js';

/**
 * Fetches workspace intelligence via the API.
 * Returns typed WorkspaceIntelligence with optional slice filtering.
 *
 * @param workspaceId - Workspace to fetch intelligence for
 * @param slices - Optional array of slices to include (default: all)
 * @param pagePath - Optional page path for per-page enrichment
 */
export function useWorkspaceIntelligence(
  workspaceId: string,
  slices?: IntelligenceSlice[],
  pagePath?: string,
  learningsDomain?: 'content' | 'strategy' | 'technical' | 'all',
) {
  return useQuery({
    queryKey: queryKeys.admin.intelligence(workspaceId, slices, pagePath),
    queryFn: ({ signal }) => intelligenceApi.getIntelligence(workspaceId, slices, pagePath, learningsDomain, signal),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 min — matches server cache TTL
  });
}
