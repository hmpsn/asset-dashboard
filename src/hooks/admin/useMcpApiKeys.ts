/**
 * useMcpApiKeys — admin hook for the per-workspace MCP API key management surface.
 *
 * - useQuery: GET the full list of keys (all workspaces, metadata only) + whether
 *   the env master key is configured.
 * - create: mutateAsync so the caller can read back `plaintextKeyOnceShown` from the
 *   resolved result and reveal it once (it is never returned again).
 * - revoke: fire-and-forget mutation; both mutations invalidate the list on success.
 *
 * These keys are global admin infra (not workspace-scoped in the UI), so there is no
 * WS broadcast to subscribe to — the list refetches on mutation.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { mcpApiKeysApi } from '../../api/mcpApiKeys';
import type { CreateMcpApiKeyResult, McpApiKeySummary } from '../../../shared/types/mcp-api-keys';

export interface UseMcpApiKeysResult {
  keys: McpApiKeySummary[];
  masterKeyConfigured: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  create: (vars: { workspaceId: string; label: string }) => Promise<CreateMcpApiKeyResult>;
  isCreating: boolean;
  createError: unknown;
  revoke: (id: string) => void;
  isRevoking: boolean;
}

export function useMcpApiKeys(): UseMcpApiKeysResult {
  const qc = useQueryClient();
  const key = queryKeys.admin.mcpApiKeys();

  const query = useQuery({
    queryKey: key,
    queryFn: () => mcpApiKeysApi.list(),
    staleTime: 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: (vars: { workspaceId: string; label: string }) =>
      mcpApiKeysApi.create(vars.workspaceId, vars.label),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => mcpApiKeysApi.revoke(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  return {
    keys: query.data?.keys ?? [],
    masterKeyConfigured: query.data?.masterKeyConfigured ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    create: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    createError: createMutation.error,
    revoke: revokeMutation.mutate,
    isRevoking: revokeMutation.isPending,
  };
}
