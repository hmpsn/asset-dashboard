import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { diagnostics } from '../../api/index.js';
import { useWorkspaceEvents } from '../useWorkspaceEvents.js';
import { WS_EVENTS } from '../../lib/wsEvents.js';

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
      // Invalidate all forInsight queries for this workspace so the CTA shows "Analyzing..." immediately
      qc.invalidateQueries({ queryKey: ['admin-diagnostic-for-insight', workspaceId] });
    },
  });
}

/**
 * Registers the diagnostic:complete WS handler.
 * Call this from any component that's mounted while the insight feed is visible
 * so cache invalidation fires even when DiagnosticReportPage is not mounted.
 */
export function useDiagnosticEvents(workspaceId: string) {
  const qc = useQueryClient();
  useWorkspaceEvents(workspaceId, {
    [WS_EVENTS.DIAGNOSTIC_COMPLETE]: () => {
      qc.invalidateQueries({ queryKey: ['admin-diagnostic-for-insight', workspaceId] });
      qc.invalidateQueries({ queryKey: ['admin-diagnostics', workspaceId] });
      qc.invalidateQueries({ queryKey: ['admin-insights', workspaceId] });
    },
  });
}
