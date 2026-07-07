// @ds-rebuilt
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { put } from '../../api/client';
import { schemaImpact, type SchemaImpactData } from '../../api/schema';
import type { Workspace } from '../../components/WorkspaceSelector';
import { useWorkspaces } from './useWorkspaces';

export const adminSchemaKeys = {
  all: (workspaceId: string | undefined) => ['admin-schema', workspaceId ?? 'none'] as const,
  impact: (workspaceId: string | undefined) => [...adminSchemaKeys.all(workspaceId), 'impact'] as const,
  pageTypes: (siteId: string | undefined, workspaceId: string | undefined) =>
    [...adminSchemaKeys.all(workspaceId), 'page-types', siteId ?? 'none'] as const,
};

export interface AdminSchemaWorkspaceState {
  workspace: Workspace | undefined;
  siteId: string | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useAdminSchemaWorkspace(workspaceId: string): AdminSchemaWorkspaceState {
  const workspaces = useWorkspaces();
  const workspace = workspaces.data?.find((item) => item.id === workspaceId);

  return {
    workspace,
    siteId: workspace?.webflowSiteId,
    isLoading: workspaces.isLoading,
    isError: workspaces.isError,
    refetch: () => {
      void workspaces.refetch();
    },
  };
}

export function useAdminSchemaImpact(workspaceId: string | undefined) {
  return useQuery<SchemaImpactData | null>({
    queryKey: adminSchemaKeys.impact(workspaceId),
    queryFn: async () => {
      if (!workspaceId) return null;
      try {
        return await schemaImpact.get(workspaceId);
      } catch {
        return null;
      }
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

export function useSaveSchemaPageType(siteId: string | undefined, workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ pageId, pageType }: { pageId: string; pageType: string }) => {
      if (!siteId) throw new Error('A connected Webflow site is required.');
      return put(`/api/webflow/schema-page-types/${siteId}?workspaceId=${encodeURIComponent(workspaceId ?? '')}`, {
        pageId,
        pageType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminSchemaKeys.pageTypes(siteId, workspaceId) });
    },
  });
}

function queryKeyContainsSchema(queryKey: readonly unknown[]): boolean {
  return queryKey.some((part) => typeof part === 'string' && part.toLowerCase().includes('schema'));
}

export function useInvalidateAdminSchemaQueries(workspaceId: string | undefined, siteId: string | undefined) {
  const queryClient = useQueryClient();

  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: adminSchemaKeys.all(workspaceId) });
    queryClient.invalidateQueries({
      predicate: (query) => queryKeyContainsSchema(query.queryKey)
        && (!siteId || query.queryKey.some((part) => part === siteId))
        && (!workspaceId || query.queryKey.some((part) => part === workspaceId)),
    });
  }, [queryClient, siteId, workspaceId]);
}
