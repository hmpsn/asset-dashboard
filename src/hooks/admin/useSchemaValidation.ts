/**
 * React Query hooks for schema validation data.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schemaValidation, type SchemaValidationRecord } from '../../api/schema';
import type { WholeSiteSchemaGraphValidationResult } from '../../../shared/types/schema-validation';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

/** All validation records for a site */
export function useSchemaValidations(siteId: string | undefined, workspaceId?: string) {
  return useQuery<SchemaValidationRecord[]>({
    queryKey: queryKeys.admin.schemaValidations(siteId ?? '', workspaceId),
    queryFn: async () => {
      const records = await schemaValidation.getAll(siteId!, workspaceId);
      return Array.isArray(records) ? records : [];
    },
    enabled: !!siteId,
    staleTime: STALE_TIMES.STABLE,
  });
}

/** Whole-site JSON-LD graph validation for the latest generated snapshot */
export function useSchemaGraphValidation(siteId: string | undefined, workspaceId?: string, enabled = true) {
  return useQuery<WholeSiteSchemaGraphValidationResult | null>({
    queryKey: queryKeys.admin.schemaGraphValidation(siteId ?? '', workspaceId),
    queryFn: async () => schemaValidation.getGraph(siteId!, workspaceId),
    enabled: !!siteId && enabled,
    staleTime: STALE_TIMES.STABLE,
  });
}

/** Validate a single page's schema and invalidate the validations list */
export function useValidateSchema(siteId: string | undefined, workspaceId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { pageId: string; schema: Record<string, unknown> }) =>
      schemaValidation.validate(siteId!, body, workspaceId),
    onSuccess: () => {
      if (siteId) {
        qc.invalidateQueries({ queryKey: queryKeys.admin.schemaValidations(siteId, workspaceId) });
        qc.invalidateQueries({ queryKey: queryKeys.admin.schemaGraphValidation(siteId, workspaceId) });
      }
    },
  });
}
