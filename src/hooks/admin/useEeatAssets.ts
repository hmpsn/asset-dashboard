import { useMutation, useQuery } from '@tanstack/react-query';
import { eeatAssetsApi, type CreateEeatAssetBody, type UpdateEeatAssetBody } from '../../api/eeatAssets';
import { queryKeys } from '../../lib/queryKeys';

export function useEeatAssets(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.admin.eeatAssets(workspaceId ?? ''),
    queryFn: () => eeatAssetsApi.list(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateEeatAsset(workspaceId: string) {
  return useMutation({
    mutationFn: (body: CreateEeatAssetBody) => eeatAssetsApi.create(workspaceId, body),
  });
}

export function useUpdateEeatAsset(workspaceId: string) {
  return useMutation({
    mutationFn: ({ assetId, body }: { assetId: string; body: UpdateEeatAssetBody }) =>
      eeatAssetsApi.update(workspaceId, assetId, body),
  });
}

export function useDeleteEeatAsset(workspaceId: string) {
  return useMutation({
    mutationFn: (assetId: string) => eeatAssetsApi.remove(workspaceId, assetId),
  });
}
