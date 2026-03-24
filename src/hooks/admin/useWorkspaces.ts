import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from '../../api/client';
import type { Workspace } from '../../components/WorkspaceSelector';

const WORKSPACES_KEY = ['admin-workspaces'] as const;

export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: WORKSPACES_KEY,
    queryFn: () => get<Workspace[]>('/api/workspaces'),
    staleTime: 60_000,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; webflowSiteId?: string; webflowSiteName?: string }) =>
      post<Workspace>('/api/workspaces', vars),
    onSuccess: () => { qc.invalidateQueries({ queryKey: WORKSPACES_KEY }); },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/api/workspaces/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: WORKSPACES_KEY }); },
  });
}

export function useLinkSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { workspaceId: string; siteId: string; siteName: string; token?: string }) =>
      patch<Workspace>(`/api/workspaces/${vars.workspaceId}`, {
        webflowSiteId: vars.siteId,
        webflowSiteName: vars.siteName,
        webflowToken: vars.token,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: WORKSPACES_KEY }); },
  });
}

export function useUnlinkSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      patch<Workspace>(`/api/workspaces/${workspaceId}`, { webflowSiteId: '', webflowSiteName: '' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: WORKSPACES_KEY }); },
  });
}

export { WORKSPACES_KEY };
