import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { put, get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { CmsSchemaFieldMapping, SchemaFieldTarget } from '../../../shared/types/site-inventory';
import type {
  CmsMappingCollection,
  CmsMappingsResponse,
  SchemaMappingCollection,
} from './schemaSuggesterTypes';

export const MAX_SCHEMA_MAPPING_COLLECTIONS = 4;

export const SCHEMA_FIELD_MAPPING_TARGETS: Array<{
  target: SchemaFieldTarget;
  label: string;
  roles: Array<'location' | 'service'>;
}> = [
  { target: 'streetAddress', label: 'Street', roles: ['location'] },
  { target: 'addressLocality', label: 'City', roles: ['location'] },
  { target: 'addressRegion', label: 'State', roles: ['location'] },
  { target: 'postalCode', label: 'ZIP', roles: ['location'] },
  { target: 'phone', label: 'Phone', roles: ['location'] },
  { target: 'email', label: 'Email', roles: ['location'] },
  { target: 'openingHours', label: 'Hours', roles: ['location'] },
  { target: 'serviceName', label: 'Service name', roles: ['service'] },
  { target: 'serviceType', label: 'Service type', roles: ['service'] },
  { target: 'areaServed', label: 'Area served', roles: ['service'] },
  { target: 'price', label: 'Price', roles: ['service'] },
  { target: 'priceCurrency', label: 'Currency', roles: ['service'] },
];

interface UseSchemaSuggesterCmsWorkflowOptions {
  siteId: string;
  workspaceId?: string;
}

export function useSchemaSuggesterCmsWorkflow({
  siteId,
  workspaceId,
}: UseSchemaSuggesterCmsWorkflowOptions) {
  const [cmsMappingError, setCmsMappingError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const cmsMappingsQuery = useQuery({
    queryKey: queryKeys.admin.schemaCmsFieldMappings(siteId, workspaceId),
    queryFn: () => get<CmsMappingsResponse>(
      `/api/webflow/schema-cms-field-mappings/${siteId}?workspaceId=${encodeURIComponent(workspaceId ?? '')}`,
    ),
    enabled: !!siteId && !!workspaceId,
    staleTime: 30_000,
  });

  const saveCmsMappingMutation = useMutation({
    mutationFn: async ({ collection, target, slug }: { collection: CmsMappingCollection; target: SchemaFieldTarget; slug: string }) => {
      const fieldMappings = { ...(collection.mapping?.fieldMappings ?? {}) };
      const trimmed = slug.trim();
      if (trimmed) {
        fieldMappings[target] = trimmed;
      } else {
        delete fieldMappings[target];
      }
      const mapping = await put<CmsSchemaFieldMapping>(
        `/api/webflow/schema-cms-field-mappings/${siteId}?workspaceId=${encodeURIComponent(workspaceId ?? '')}`,
        {
          collectionId: collection.collectionId,
          collectionName: collection.collectionName,
          collectionSlug: collection.collectionSlug,
          schemaFieldSlug: collection.mapping?.schemaFieldSlug || collection.recommendedFieldSlug,
          collectionRole: collection.mapping?.collectionRole,
          fieldMappings,
        },
      );
      return { collectionId: collection.collectionId, mapping };
    },
    onMutate: () => setCmsMappingError(null),
    onSuccess: ({ collectionId, mapping }) => {
      queryClient.setQueryData<CmsMappingsResponse>(
        queryKeys.admin.schemaCmsFieldMappings(siteId, workspaceId),
        old => ({
          collections: (old?.collections ?? []).map(collection => (
            collection.collectionId === collectionId ? { ...collection, mapping } : collection
          )),
        }),
      );
    },
    onError: err => {
      setCmsMappingError(err instanceof Error ? err.message : 'Failed to save CMS field mapping');
    },
  });

  const cmsMappings = cmsMappingsQuery.data?.collections ?? [];
  const savingCmsMapping = saveCmsMappingMutation.isPending && saveCmsMappingMutation.variables
    ? `${saveCmsMappingMutation.variables.collection.collectionId}:${saveCmsMappingMutation.variables.target}`
    : null;

  const saveCmsFieldMapping = (collection: CmsMappingCollection, target: SchemaFieldTarget, slug: string) => {
    if (!workspaceId) return;
    saveCmsMappingMutation.mutate({ collection, target, slug });
  };

  const schemaMappingCollections = useMemo(() => cmsMappings
    .map(collection => {
      const role = collection.mapping?.collectionRole
        || (/(location|locations|clinic|clinics|store|stores|branch|branches)/i.test(`${collection.collectionName} ${collection.collectionSlug}`)
          ? 'location'
          : /(service|services|treatment|treatments|procedure|procedures)/i.test(`${collection.collectionName} ${collection.collectionSlug}`)
            ? 'service'
            : undefined);
      return role === 'location' || role === 'service' ? { ...collection, schemaRole: role } : null;
    })
    .filter((collection): collection is SchemaMappingCollection => Boolean(collection)), [cmsMappings]);

  return {
    cmsMappingError,
    savingCmsMapping,
    fieldMappingTargets: SCHEMA_FIELD_MAPPING_TARGETS,
    schemaMappingCollections,
    saveCmsFieldMapping,
  };
}
