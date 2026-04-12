import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  copyGeneration,
  copyReview,
  copyBatch,
  copyExport,
  copyIntelligence,
} from '../../api/brand-engine';
import { useWorkspaceEvents } from '../useWorkspaceEvents';
import type {
  CopySectionStatus,
  ExportRequest,
} from '../../../shared/types/copy-pipeline';

// ═══ QUERIES ═══

export function useCopySections(wsId: string, entryId: string) {
  return useQuery({
    queryKey: ['admin-copy-sections', wsId, entryId],
    queryFn: () => copyReview.getSections(wsId, entryId),
    enabled: !!(wsId && entryId),
  });
}

export function useCopyStatus(wsId: string, entryId: string) {
  return useQuery({
    queryKey: ['admin-copy-status', wsId, entryId],
    queryFn: () => copyReview.getStatus(wsId, entryId),
    enabled: !!(wsId && entryId),
  });
}

export function useCopyMetadata(wsId: string, entryId: string) {
  return useQuery({
    queryKey: ['admin-copy-metadata', wsId, entryId],
    queryFn: () => copyReview.getMetadata(wsId, entryId),
    enabled: !!(wsId && entryId),
  });
}

export function useCopyIntelligence(wsId: string) {
  return useQuery({
    queryKey: ['admin-copy-intelligence', wsId],
    queryFn: () => copyIntelligence.getAll(wsId),
    enabled: !!wsId,
  });
}

export function usePromotablePatterns(wsId: string) {
  return useQuery({
    queryKey: ['admin-copy-promotable', wsId],
    queryFn: () => copyIntelligence.getPromotable(wsId),
    enabled: !!wsId,
  });
}

export function useBatchJob(wsId: string, batchId: string | null) {
  return useQuery({
    queryKey: ['admin-copy-batch', wsId, batchId],
    queryFn: () => copyBatch.getJob(wsId, batchId!),
    enabled: !!(wsId && batchId),
  });
}

// ═══ MUTATIONS ═══

export function useGenerateCopy(wsId: string, blueprintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      copyGeneration.generate(wsId, blueprintId, entryId),
    onSuccess: (_data, entryId) => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-sections', wsId, entryId] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-status', wsId, entryId] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-metadata', wsId, entryId] });
    },
  });
}

export function useRegenerateCopySection(wsId: string, blueprintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, sectionId, note, highlight }: { entryId: string; sectionId: string; note: string; highlight?: string }) =>
      copyGeneration.regenerateSection(wsId, blueprintId, entryId, sectionId, { note, highlight }),
    onSuccess: (_data, { entryId }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-sections', wsId, entryId] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-status', wsId, entryId] });
    },
  });
}

export function useUpdateSectionStatus(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sectionId, status }: { sectionId: string; status: CopySectionStatus }) =>
      copyReview.updateSectionStatus(wsId, sectionId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-sections'] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-status'] });
    },
  });
}

export function useUpdateSectionText(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sectionId, copy }: { sectionId: string; copy: string }) =>
      copyReview.updateSectionText(wsId, sectionId, copy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-sections'] });
    },
  });
}

export function useAddSuggestion(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sectionId, originalText, suggestedText }: { sectionId: string; originalText: string; suggestedText: string }) =>
      copyReview.addSuggestion(wsId, sectionId, { originalText, suggestedText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-sections'] });
    },
  });
}

export function useStartBatch(wsId: string, blueprintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryIds, mode, batchSize }: { entryIds: string[]; mode?: string; batchSize?: number }) =>
      copyBatch.start(wsId, blueprintId, { entryIds, mode, batchSize }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-batch', wsId] });
    },
  });
}

export function useExportCopy(wsId: string, blueprintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ExportRequest) =>
      copyExport.export(wsId, blueprintId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-sections'] });
    },
  });
}

export function useTogglePattern(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patternId, active }: { patternId: string; active: boolean }) =>
      copyIntelligence.update(wsId, patternId, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-intelligence', wsId] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-promotable', wsId] });
    },
  });
}

export function useDeletePattern(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patternId: string) =>
      copyIntelligence.remove(wsId, patternId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-intelligence', wsId] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-promotable', wsId] });
    },
  });
}

export function useExtractPatterns(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (steeringNotes: string[]) =>
      copyIntelligence.extract(wsId, steeringNotes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-intelligence', wsId] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-promotable', wsId] });
    },
  });
}

// ═══ WEBSOCKET INVALIDATION ═══

export function useCopyPipelineEvents(wsId: string) {
  const queryClient = useQueryClient();
  useWorkspaceEvents(wsId, {
    'copy:section_updated': () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-sections'] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-status'] });
    },
    'copy:metadata_updated': () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-metadata'] });
    },
    'copy:batch_progress': () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-batch'] });
    },
    'copy:batch_complete': () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-batch'] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-sections'] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-status'] });
    },
    'copy:intelligence_updated': () => {
      queryClient.invalidateQueries({ queryKey: ['admin-copy-intelligence'] });
      queryClient.invalidateQueries({ queryKey: ['admin-copy-promotable'] });
    },
  });
}
