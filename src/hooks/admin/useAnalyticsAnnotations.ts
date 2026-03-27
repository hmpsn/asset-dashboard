/**
 * React Query hooks for analytics annotations (admin CRUD).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { analyticsAnnotations as api } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

export interface Annotation {
  id: string;
  workspaceId: string;
  date: string;
  label: string;
  category: string;
  createdBy?: string;
  createdAt: string;
}

export function useAnalyticsAnnotations(workspaceId: string) {
  return useQuery<Annotation[]>({
    queryKey: queryKeys.admin.analyticsAnnotations(workspaceId),
    queryFn: async () => {
      const data = await api.list(workspaceId);
      return Array.isArray(data) ? (data as Annotation[]) : [];
    },
    enabled: !!workspaceId,
    staleTime: STALE_TIMES.NORMAL,
  });
}

export function useCreateAnnotation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { date: string; label: string; category: string }) =>
      api.create(workspaceId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.analyticsAnnotations(workspaceId) });
    },
  });
}

export function useUpdateAnnotation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; date?: string; label?: string; category?: string }) =>
      api.update(workspaceId, id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.analyticsAnnotations(workspaceId) });
    },
  });
}

export function useDeleteAnnotation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.remove(workspaceId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.analyticsAnnotations(workspaceId) });
    },
  });
}
