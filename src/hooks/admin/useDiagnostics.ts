import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { diagnostics } from '../../api/index.js';
import { queryKeys } from '../../lib/queryKeys';

export function useDiagnosticsList(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.diagnostics(workspaceId),
    queryFn: () => diagnostics.list(workspaceId),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId,
  });
}

export function useDiagnosticReport(workspaceId: string, reportId: string) {
  return useQuery({
    queryKey: queryKeys.admin.diagnosticDetail(workspaceId, reportId),
    queryFn: () => diagnostics.get(workspaceId, reportId),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId && !!reportId,
    refetchInterval: (query) => {
      const status = query.state.data?.report?.status;
      return (status === 'running' || status === 'pending') ? 5000 : false;
    },
  });
}

export function useDiagnosticForInsight(workspaceId: string, insightId: string) {
  return useQuery({
    queryKey: queryKeys.admin.diagnosticForInsight(workspaceId, insightId),
    queryFn: () => diagnostics.getForInsight(workspaceId, insightId),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId && !!insightId,
  });
}

export function useRunDiagnostic(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (insightId: string) => diagnostics.run(workspaceId, insightId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnostics(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnosticForInsightAll(workspaceId) });
    },
  });
}
