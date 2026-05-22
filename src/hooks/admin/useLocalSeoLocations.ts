import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { localSeo, type CreateLocationBody } from '../../api/localSeo';
import { queryKeys } from '../../lib/queryKeys';

export function useLocalSeoLocations(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.localSeoLocations(workspaceId),
    queryFn: () => localSeo.listLocations(workspaceId),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateLocation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLocationBody) => localSeo.createLocation(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeoLocations(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeo(workspaceId) });
    },
  });
}

export function useUpdateLocation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ locationId, body }: { locationId: string; body: Partial<CreateLocationBody> }) =>
      localSeo.updateLocation(workspaceId, locationId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeoLocations(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeo(workspaceId) });
    },
  });
}

export function useDeleteLocation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (locationId: string) => localSeo.deleteLocation(workspaceId, locationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeoLocations(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeo(workspaceId) });
    },
  });
}
