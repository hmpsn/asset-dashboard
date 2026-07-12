import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, getOptional, getSafe, patch, post } from '../../api/client';
import { workspaces as workspacesApi } from '../../api/workspaces';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';
import type { AdminWorkspaceView } from '../../../shared/types/workspace';

export interface GlobalOpsGscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface GlobalOpsHealthStatus {
  hasOpenAIKey: boolean;
  hasWebflowToken: boolean;
  hasGoogleAuth: boolean;
  hasEmailConfig: boolean;
  hasStripe: boolean;
}

export interface GlobalOpsStorageDirStats {
  name: string;
  bytes: number;
  fileCount: number;
  label: string;
}

export interface GlobalOpsStorageReport {
  totalBytes: number;
  totalFiles: number;
  breakdown: GlobalOpsStorageDirStats[];
  backupRetentionDays: number;
  chatSessionCount: number;
  oldestChatSession: string | null;
  timestamp: string;
}

export interface GlobalOpsStudioConfig {
  bookingUrl: string;
}

const PRUNE_ENDPOINTS = {
  backups: '/api/admin/storage/prune-backups',
  reports: '/api/admin/storage/prune-reports',
  chat: '/api/admin/storage/prune-chat',
  activity: '/api/admin/storage/prune-activity',
} as const;

export type GlobalOpsPruneType = keyof typeof PRUNE_ENDPOINTS;

export function useGlobalOpsWorkspaces() {
  return useQuery<AdminWorkspaceView[]>({
    queryKey: queryKeys.admin.workspaces(),
    queryFn: async () => get<AdminWorkspaceView[]>('/api/workspaces'),
    staleTime: STALE_TIMES.STABLE,
  });
}

export function useGlobalOpsGoogleStatus() {
  return useQuery({
    queryKey: queryKeys.admin.globalOpsGoogleStatus(),
    queryFn: () => get<{ connected: boolean; configured: boolean }>('/api/google/status'),
  });
}

export function useGlobalOpsGscSites(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.globalOpsGscSites(),
    queryFn: () => get<GlobalOpsGscSite[]>('/api/google/gsc-sites'),
    enabled,
  });
}

export function useGlobalOpsHealth() {
  return useQuery<GlobalOpsHealthStatus>({
    queryKey: queryKeys.admin.health(),
    queryFn: () => get<GlobalOpsHealthStatus>('/api/health'),
    staleTime: STALE_TIMES.STABLE,
    refetchOnWindowFocus: true,
  });
}

export function useGlobalOpsStorage() {
  return useQuery({
    queryKey: queryKeys.admin.globalOpsStorage(),
    queryFn: () => getOptional<GlobalOpsStorageReport>('/api/admin/storage-stats'),
  });
}

export function useGlobalOpsStudioConfig() {
  return useQuery({
    queryKey: queryKeys.admin.globalOpsStudioConfig(),
    queryFn: () => getSafe<GlobalOpsStudioConfig>('/api/studio-config', { bookingUrl: '' }),
  });
}

export function useDisconnectGlobalGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => post('/api/google/disconnect'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.globalOpsGoogleStatus() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.globalOpsGscSites() });
    },
  });
}

export function useGlobalOpsGoogleAuthUrl() {
  return useMutation({
    mutationFn: () => get<{ url?: string }>('/api/google/auth-url'),
  });
}

export function useSaveGlobalBookingUrl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingUrl: string) => patch('/api/studio-config', { bookingUrl }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.globalOpsStudioConfig() });
    },
  });
}

export function usePruneGlobalStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type: GlobalOpsPruneType) => post<{ bytesFreed?: number }>(PRUNE_ENDPOINTS[type], {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.globalOpsStorage() });
    },
  });
}

export function useArchiveWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, archived }: { workspaceId: string; archived: boolean }) =>
      workspacesApi.archive(workspaceId, archived) as Promise<AdminWorkspaceView>,
    onSuccess: (_workspace, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaces() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceOverview() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceDetail(vars.workspaceId) });
    },
  });
}
