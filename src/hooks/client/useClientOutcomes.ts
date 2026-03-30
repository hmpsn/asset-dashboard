/**
 * useClientOutcomes — React Query hooks for the Outcome Intelligence Engine (client).
 *
 * Uses public endpoints — no admin auth required, gated by workspace token.
 * Covers: outcome summary scorecard and "we called it" wins feed.
 */

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { clientOutcomesApi } from '../../api/outcomes';

// ── Outcome summary scorecard ──────────────────────────────────────────────

export function useClientOutcomeSummary(wsId: string) {
  return useQuery({
    queryKey: queryKeys.client.outcomeSummary(wsId),
    queryFn: ({ signal }) => clientOutcomesApi.getSummary(wsId, signal),
    enabled: !!wsId,
    staleTime: 10 * 60 * 1000, // 10 min — client data changes less frequently
  });
}

// ── "We Called It" wins feed ───────────────────────────────────────────────

export function useClientOutcomeWins(wsId: string) {
  return useQuery({
    queryKey: queryKeys.client.outcomeWins(wsId),
    queryFn: ({ signal }) => clientOutcomesApi.getWins(wsId, signal),
    enabled: !!wsId,
    staleTime: 10 * 60 * 1000, // 10 min — client data changes less frequently
  });
}
