import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspaceFeatureFlags } from '../../api/platform';
import { queryKeys } from '../../lib/queryKeys';
import type { FeatureFlagKey, WorkspaceFeatureFlagMeta } from '../../../shared/types/feature-flags';

/**
 * useWorkspaceFeatureFlags — per-workspace feature-flag override admin read hook.
 *
 * Reads GET /api/admin/workspaces/:workspaceId/feature-flags via the typed api
 * wrapper (no raw fetch). Returns each flag's workspace-resolved value + source
 * (`'workspace'` when a per-workspace override exists, else the global chain) plus
 * the inherited/global value a clear would revert to. Admin-only (HMAC).
 */
export function useWorkspaceFeatureFlags(workspaceId: string | undefined) {
  return useQuery<WorkspaceFeatureFlagMeta[]>({
    queryKey: workspaceId
      ? queryKeys.admin.workspaceFeatureFlags(workspaceId)
      : ['admin-workspace-feature-flags-disabled'],
    queryFn: () => workspaceFeatureFlags.list(workspaceId as string),
    enabled: !!workspaceId,
    staleTime: 10_000,
  });
}

/**
 * useSetWorkspaceFlagOverride — set / clear a per-workspace flag override.
 *
 * Calls PUT /api/admin/workspaces/:workspaceId/feature-flags/:key with
 * `{ enabled }` (`true` = force ON, `false` = force OFF, `null` = clear → revert
 * to global → env → default). Invalidates this workspace's flags query on success
 * so the UI refetches the resolved value + source. No broadcast — the flag changes
 * future generation, not a live client surface.
 */
export function useSetWorkspaceFlagOverride(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: FeatureFlagKey; enabled: boolean | null }) =>
      workspaceFeatureFlags.setOverride(workspaceId, key, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.workspaceFeatureFlags(workspaceId),
      });
    },
  });
}
