import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCockpitPortfolio } from '../../api/cockpitPortfolio';
import { getPresenceSnapshot, type PresenceMap } from '../../api/presence';
import { queryKeys } from '../../lib/queryKeys';
import { useGlobalAdminEvents } from '../useGlobalAdminEvents'; // global-events-ok -- presence:update is an audited global fan-out event.

export function useCockpitPortfolio() {
  return useQuery({
    queryKey: queryKeys.admin.cockpitPortfolio(),
    queryFn: ({ signal }) => getCockpitPortfolio(signal),
    staleTime: 30_000,
  });
}

export function usePortfolioPresence() {
  const queryClient = useQueryClient();
  const handlePresenceUpdate = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    queryClient.setQueryData<PresenceMap>(queryKeys.admin.presence(), payload as PresenceMap);
  }, [queryClient]);

  useGlobalAdminEvents({ 'presence:update': handlePresenceUpdate });

  return useQuery({
    queryKey: queryKeys.admin.presence(),
    queryFn: ({ signal }) => getPresenceSnapshot(signal),
    staleTime: 30_000,
  });
}
