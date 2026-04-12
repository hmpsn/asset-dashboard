import { useQuery } from '@tanstack/react-query';
import { blueprints as blueprintsApi, blueprintVersions as blueprintVersionsApi } from '../../api/brand-engine';
import { queryKeys } from '../../lib/queryKeys';

export function useBlueprints(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.blueprints(wsId),
    queryFn: () => blueprintsApi.list(wsId),
    enabled: !!wsId,
  });
}

export function useBlueprint(wsId: string, blueprintId: string) {
  return useQuery({
    queryKey: queryKeys.admin.blueprint(wsId, blueprintId),
    queryFn: () => blueprintsApi.getById(wsId, blueprintId),
    enabled: !!(wsId && blueprintId),
  });
}

export function useBlueprintVersions(wsId: string, blueprintId: string) {
  return useQuery({
    queryKey: queryKeys.admin.blueprintVersions(wsId, blueprintId),
    queryFn: () => blueprintVersionsApi.list(wsId, blueprintId),
    enabled: !!(wsId && blueprintId),
  });
}
