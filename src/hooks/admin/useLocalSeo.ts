import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { localSeo } from '../../api/localSeo';
import { queryKeys } from '../../lib/queryKeys';
import { useBackgroundTasks } from '../useBackgroundTasks';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import type { LocalSeoLocationLookupRequest, LocalSeoMarketUpdateRequest, LocalSeoRefreshRequest } from '../../../shared/types/local-seo';

export function useLocalSeo(workspaceId: string, options: { includeSnapshots?: boolean } = {}) {
  const includeSnapshots = options.includeSnapshots === true;
  return useQuery({
    queryKey: queryKeys.admin.localSeoVariant(workspaceId, includeSnapshots),
    queryFn: () => includeSnapshots ? localSeo.getWithSnapshots(workspaceId) : localSeo.getSummary(workspaceId),
    enabled: !!workspaceId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useLocalSeoRefresh(workspaceId: string) {
  const queryClient = useQueryClient();
  const { trackJob } = useBackgroundTasks();
  return useMutation({
    mutationFn: (body: LocalSeoRefreshRequest = {}) => localSeo.refresh(workspaceId, body),
    onSuccess: (result) => {
      if (result.jobId) {
        trackJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, result.jobId, { workspaceId });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeo(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(workspaceId) });
    },
  });
}

// SEO Decision Engine P7 (local-gbp): trigger a GBP + reviews refresh and track the job.
export function useLocalGbpRefresh(workspaceId: string) {
  const queryClient = useQueryClient();
  const { trackJob } = useBackgroundTasks();
  return useMutation({
    mutationFn: () => localSeo.refreshGbp(workspaceId),
    onSuccess: (result) => {
      if (result.jobId) {
        trackJob(BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH, result.jobId, { workspaceId });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeo(workspaceId) });
    },
  });
}

export function useLocalSeoUpdate(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LocalSeoMarketUpdateRequest) => localSeo.update(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeo(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(workspaceId) });
    },
  });
}

export function useSetPrimaryMarket(workspaceId: string) {
  return useMutation({
    mutationFn: (marketId: string) => localSeo.setPrimaryMarket(workspaceId, marketId),
  });
}

export function useLocalSeoLocationLookup(workspaceId: string) {
  return useMutation({
    mutationFn: (body: LocalSeoLocationLookupRequest) => localSeo.locationLookup(workspaceId, body),
  });
}
