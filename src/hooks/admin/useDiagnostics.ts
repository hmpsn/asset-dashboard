import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { diagnostics } from '../../api/index.js';

const DIAGNOSTICS_KEYS = {
  list: (workspaceId: string) => ['admin-diagnostics', workspaceId] as const,
  detail: (workspaceId: string, reportId: string) => ['admin-diagnostics', workspaceId, reportId] as const,
  forInsight: (workspaceId: string, insightId: string) => ['admin-diagnostic-for-insight', workspaceId, insightId] as const,
};

export function useDiagnosticsList(workspaceId: string) {
  return useQuery({
    queryKey: DIAGNOSTICS_KEYS.list(workspaceId),
    queryFn: () => diagnostics.list(workspaceId),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId,
  });
}

export function useDiagnosticReport(workspaceId: string, reportId: string) {
  return useQuery({
    queryKey: DIAGNOSTICS_KEYS.detail(workspaceId, reportId),
    queryFn: () => diagnostics.get(workspaceId, reportId),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId && !!reportId,
  });
}

export function useDiagnosticForInsight(workspaceId: string, insightId: string) {
  return useQuery({
    queryKey: DIAGNOSTICS_KEYS.forInsight(workspaceId, insightId),
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
      qc.invalidateQueries({ queryKey: DIAGNOSTICS_KEYS.list(workspaceId) });
    },
  });
}
