import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { meetingBriefApi } from '../../api';

export function useAdminMeetingBrief(workspaceId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.admin.meetingBrief(workspaceId),
    queryFn: () => meetingBriefApi.get(workspaceId),
    staleTime: 10 * 60 * 1000, // 10 min — brief changes only on explicit regenerate
    enabled: !!workspaceId,
  });

  const generate = useMutation({
    mutationFn: () => meetingBriefApi.generate(workspaceId),
    onSuccess: (data) => {
      // Set cache directly from mutation response — eliminates refetch flicker on first generation
      qc.setQueryData(queryKeys.admin.meetingBrief(workspaceId), data);
    },
  });

  return {
    brief: query.data?.brief ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    generate: generate.mutate,
    isGenerating: generate.isPending,
    generateError: generate.error,
    /** True when the server returned unchanged:true (data hadn't changed). */
    wasUnchanged: generate.data?.unchanged ?? false,
  };
}
