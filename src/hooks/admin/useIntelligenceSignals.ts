/**
 * useIntelligenceSignals — React Query hook for strategy intelligence signals.
 *
 * Fetches momentum keywords, misalignment flags, and content gap suggestions
 * derived from the insight engine's feedback loop.
 */

import { useQuery } from '@tanstack/react-query';
import { getSafe } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { StrategySignal } from '../../../shared/types/insights.js';

interface SignalsResponse {
  signals: StrategySignal[];
}

export function useIntelligenceSignals(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.intelligenceSignals(workspaceId),
    queryFn: ({ signal }) =>
      getSafe<SignalsResponse>(
        `/api/webflow/keyword-strategy/${workspaceId}/signals`,
        { signals: [] },
        signal,
      ),
    staleTime: 5 * 60 * 1000, // 5 minutes — signals don't change frequently
    enabled: !!workspaceId,
  });
}
