import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { ClientSignal, ClientSignalStatus } from '../../../../shared/types/client-signals';

// ── Fetch all signals for a workspace ──

export function useClientSignals(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.admin.clientSignals(workspaceId) : ['admin-client-signals-disabled'],
    queryFn: () => get<ClientSignal[]>(`/api/client-signals/${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

// ── Update signal status ──

export function useUpdateSignalStatus(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ClientSignalStatus }) =>
      patch<ClientSignal>(`/api/client-signals/${id}/status`, { status }),
    onSuccess: () => {
      if (workspaceId) {
        qc.invalidateQueries({ queryKey: queryKeys.admin.clientSignals(workspaceId) });
      }
    },
  });
}

// ── Create signal (from client portal) ──

export function useCreateClientSignal(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      type: 'content_interest' | 'service_interest';
      triggerMessage: string;
      chatContext: Array<{ role: 'user' | 'assistant'; content: string }>;
    }) =>
      post<{ ok: boolean; signalId: string }>(`/api/public/signal/${workspaceId}`, body),
    onSuccess: () => {
      if (workspaceId) {
        qc.invalidateQueries({ queryKey: queryKeys.admin.clientSignals(workspaceId) });
      }
    },
  });
}
