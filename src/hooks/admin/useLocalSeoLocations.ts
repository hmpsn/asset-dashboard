import { useMutation, useQuery } from '@tanstack/react-query';
import { localSeo, type CreateLocationBody } from '../../api/localSeo';
import { queryKeys } from '../../lib/queryKeys';

export function useLocalSeoLocations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.admin.localSeoLocations(workspaceId ?? ''),
    queryFn: () => localSeo.listLocations(workspaceId!),
    enabled: Boolean(workspaceId),
    // WS invalidation (LOCAL_SEO_UPDATED → useWsInvalidation) is the primary freshness
    // path. staleTime only limits redundant background refetches on window focus.
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateLocation(workspaceId: string) {
  return useMutation({
    mutationFn: (body: CreateLocationBody) => localSeo.createLocation(workspaceId, body),
    // Cache is refreshed via WS LOCAL_SEO_UPDATED broadcast → useWsInvalidation.
    // No onSuccess invalidation needed here — it would cause a redundant second refetch.
  });
}

export function useUpdateLocation(workspaceId: string) {
  return useMutation({
    mutationFn: ({ locationId, body }: { locationId: string; body: Partial<CreateLocationBody> }) =>
      localSeo.updateLocation(workspaceId, locationId, body),
    // Cache is refreshed via WS LOCAL_SEO_UPDATED broadcast → useWsInvalidation.
  });
}

export function useDeleteLocation(workspaceId: string) {
  return useMutation({
    mutationFn: (locationId: string) => localSeo.deleteLocation(workspaceId, locationId),
    // Cache is refreshed via WS LOCAL_SEO_UPDATED broadcast → useWsInvalidation.
  });
}
