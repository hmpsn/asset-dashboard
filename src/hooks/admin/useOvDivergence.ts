/**
 * useOvDivergence — React Query hook for the OV (Opportunity Value) divergence
 * shadow-log.
 *
 * Admin-only diagnostic. Fetches the most recent rows recording how the LEGACY
 * recommendation ranking diverges from the Opportunity-Value ranking for a
 * workspace, so an operator can decide whether OV is safe to flip on.
 *
 * Read-only — no broadcast/invalidation wiring needed (the shadow log is always
 * collected server-side; nothing the admin does here mutates it).
 */

import { useQuery } from '@tanstack/react-query';
import { ovDivergenceApi } from '../../api/ovDivergence';
import { queryKeys } from '../../lib/queryKeys';

/** Number of recent divergence rows to request (endpoint max is 100). */
const OV_DIVERGENCE_LIMIT = 50;

export function useOvDivergence(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.ovDivergence(workspaceId),
    queryFn: ({ signal }) => ovDivergenceApi.list(workspaceId, OV_DIVERGENCE_LIMIT, signal),
    staleTime: 5 * 60 * 1000, // 5 minutes — shadow-log rows accrue slowly
    enabled: !!workspaceId,
  });
}
